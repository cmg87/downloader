"""Single-user Instaloader bridge. Requests/replies use NDJSON; secrets stay server-side."""
import contextlib
import io
import json
import os
import re
import sys
import time
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urljoin, urlparse

import instaloader


class Worker:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.session_file = self.directory / "session.json"
        self.loader = None
        self.anonymous = self.new_loader()
        self.pending = None
        self.verified = False
        self.inspections = {}
        try:
            saved = json.loads(self.session_file.read_text())
            loader = self.new_loader()
            loader.load_session(saved["username"], saved["cookies"])
            self.loader = loader
        except (OSError, ValueError, KeyError, TypeError):
            pass

    @staticmethod
    def new_loader():
        return instaloader.Instaloader(quiet=True, max_connection_attempts=1,
                                      request_timeout=30, fatal_status_codes=[400, 401, 403, 429])

    def save(self, loader):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = self.session_file.with_suffix(".tmp")
        data = {"username": loader.context.username, "cookies": loader.save_session()}
        temporary.write_text(json.dumps(data))
        temporary.chmod(0o600)
        temporary.replace(self.session_file)

    def status(self):
        if self.pending:
            return {"state": self.pending["state"], "username": self.pending["username"],
                    "challengeUrl": self.pending.get("challengeUrl")}
        if self.loader:
            return {"state": "connected", "username": self.loader.context.username}
        return {"state": "disconnected"}

    def finish_login(self, loader):
        # login()/two_factor_login() set username only after an authenticated response.
        if not loader.context.username:
            raise ValueError("Instagram did not validate this login. Try again.")
        self.save(loader)
        self.loader = loader
        self.pending = None
        self.verified = True
        # Public inspection results don't depend on which account completes login.
        self.inspections = {key: value for key, value in self.inspections.items() if not value.get("requiresLogin", True)}
        return self.status()

    def import_browser_session(self, cookies, username=None):
        if not cookies.get("sessionid") or not cookies.get("ds_user_id"):
            raise ValueError("Finish signing in to Instagram in the opened window.")
        candidate = self.new_loader()
        candidate.load_session(username or "browser", cookies)
        # Verify the browser session through Instaloader before replacing a saved login.
        diagnostics = []
        original_error = candidate.context.error
        candidate.context.error = lambda *args, **kwargs: diagnostics.append(args)
        try:
            validated = candidate.test_login()
        finally:
            candidate.context.error = original_error
        if not validated:
            if diagnostics:
                raise ValueError("The browser provided a session, but Instaloader could not validate it yet. Complete any verification in Instagram; this app will retry.")
            raise ValueError("Instagram did not validate the browser session. Finish any verification in its window and try again.")
        if username and username.casefold() != validated.casefold():
            raise ValueError("Instagram reported a different account. Try signing in again.")
        candidate.load_session(validated, cookies)
        return self.finish_login(candidate)

    @staticmethod
    def checkpoint_url(message):
        match = re.search(r"(?:https://[^\s]+|/challenge/[^\s]+)", message)
        if not match:
            return None
        url = urljoin("https://www.instagram.com/", match.group(0))
        parsed = urlparse(url)
        if parsed.scheme == "https" and parsed.hostname in ("www.instagram.com", "instagram.com") and not parsed.username:
            return url
        return None

    def login(self, username, password):
        self.pending = {"username": username, "password": password, "loader": self.new_loader(), "state": "disconnected"}
        return self.retry_login()

    def retry_login(self):
        if not self.pending:
            raise ValueError("Enter your Instagram login again.")
        pending = self.pending
        loader = pending["loader"]
        try:
            loader.login(pending["username"], pending["password"])
            return self.finish_login(loader)
        except instaloader.TwoFactorAuthRequiredException:
            pending["state"] = "code-required"
            return self.status()
        except instaloader.LoginException as error:
            if "checkpoint" in str(error).lower() or "challenge" in str(error).lower():
                pending["state"] = "challenge"
                pending["challengeUrl"] = self.checkpoint_url(str(error)) or "https://www.instagram.com/"
                return self.status()
            self.pending = None
            raise
        except Exception:
            self.pending = None
            raise

    def ensure_login(self):
        if self.pending or not self.loader:
            raise ValueError("Stories require an Instagram login. Public posts and reels can be tried without one.")
        if not self.verified:
            # test_login() returns None for both expired sessions and network failures.
            # Capture its diagnostics so a temporary outage never deletes a good session.
            diagnostics = []
            original_error = self.loader.context.error
            self.loader.context.error = lambda *args, **kwargs: diagnostics.append(args)
            try:
                username = self.loader.test_login()
            finally:
                self.loader.context.error = original_error
            if username is None and diagnostics:
                raise instaloader.ConnectionException("Could not validate the stored session.")
            if not username or username.casefold() != self.loader.context.username.casefold():
                self.loader = None
                self.session_file.unlink(missing_ok=True)
                raise ValueError("Your Instagram session expired. Log in again.")
            self.verified = True
        return self.loader

    def inspect(self, target):
        if target["kind"] == "post":
            # Public posts can be read anonymously, including while login is pending.
            loader = self.loader if self.loader and not self.pending else self.anonymous
        else:
            loader = self.ensure_login()
        items = []
        title = ""
        def add(item, index=1):
            video = item.is_video
            items.append({"id": str(len(items) + 1), "type": "video" if video else "image",
                          "thumbnail": item.url, "url": item.video_url if video else item.url,
                          "date": item.date_utc, "name": f"Instagram @{item.owner_username} [{item.mediaid}-{index}]"})
        if target["kind"] == "post":
            try:
                post = instaloader.Post.from_shortcode(loader.context, target["shortcode"])
            except instaloader.LoginRequiredException:
                if loader is not self.loader:
                    raise
                self.loader = None
                self.verified = False
                self.session_file.unlink(missing_ok=True)
                loader = self.anonymous
                post = instaloader.Post.from_shortcode(loader.context, target["shortcode"])
            title = f"Post by @{post.owner_username}"
            if post.typename == "GraphSidecar":
                for index, node in enumerate(post.get_sidecar_nodes(), 1):
                    items.append({"id": str(index), "type": "video" if node.is_video else "image",
                                  "thumbnail": node.display_url, "url": node.video_url if node.is_video else node.display_url,
                                  "date": post.date_utc, "name": f"Instagram @{post.owner_username} [{post.mediaid}-{index}]"})
            else:
                add(post)
        else:
            profile = instaloader.Profile.from_username(loader.context, target["username"])
            stories = loader.get_stories(userids=[profile.userid])
            title = f"Stories by @{profile.username}"
            for story in stories:
                for item in story.get_items():
                    if target.get("mediaId") and str(item.mediaid) != target["mediaId"]:
                        continue
                    add(item)
        if not items:
            raise ValueError("No available media found. This story may have expired or the account has no current stories.")
        if loader is self.loader:
            self.save(loader)
        self.inspections = {key: value for key, value in self.inspections.items() if time.time() - value["created"] < 1800}
        if len(self.inspections) >= 30:
            self.inspections.pop(next(iter(self.inspections)))
        inspection_id = str(uuid.uuid4())
        self.inspections[inspection_id] = {"items": items, "created": time.time(), "username": loader.context.username, "requiresLogin": target["kind"] != "post"}
        return {"id": inspection_id, "title": title,
                "items": [{key: item[key] for key in ("id", "type", "thumbnail")} for item in items]}

    def download(self, request):
        inspection = self.inspections.get(request["inspectionId"])
        if not inspection or time.time() - inspection["created"] > 1800:
            raise ValueError("Inspect the link again before downloading.")
        loader = self.ensure_login() if inspection["requiresLogin"] else self.anonymous
        if inspection["requiresLogin"] and inspection["username"] != loader.context.username:
            raise ValueError("Inspect the link again before downloading.")
        ids = request["itemIds"]
        items = [item for item in inspection["items"] if item["id"] in ids]
        if not items or len(items) != len(set(ids)):
            raise ValueError("Select available items to download.")
        output = Path(request["outputDir"])
        staging = Path(request["stagingDir"])
        output.mkdir(parents=True, exist_ok=True)
        staging.mkdir(parents=True, exist_ok=True)
        files = []
        for item in items:
            name = re.sub(r"[^\w @.\[\]-]", "_", item["name"])[:170]
            filename = name + (".mp4" if item["type"] == "video" else ".jpg")
            path = (output if len(items) == 1 else staging) / filename
            if not path.exists():
                part = path.with_suffix(path.suffix + ".part")
                try:
                    with contextlib.closing(loader.context.get_raw(item["url"])) as response:
                        with part.open("wb") as file:
                            for chunk in response.iter_content(256 * 1024):
                                file.write(chunk)
                    if part.stat().st_size == 0:
                        raise ValueError("Instagram returned an empty file.")
                    part.replace(path)
                finally:
                    part.unlink(missing_ok=True)
            files.append(path)
        if len(files) == 1:
            result = files[0]
        else:
            result = output / f"Instagram [{request['inspectionId']}].zip"
            part = result.with_suffix(".zip.part")
            try:
                with zipfile.ZipFile(part, "w", compression=zipfile.ZIP_STORED) as archive:
                    for file in files:
                        archive.write(file, file.name)
                part.replace(result)
            finally:
                part.unlink(missing_ok=True)
        if loader is self.loader:
            self.save(loader)
        return {"filePath": str(result)}

    def handle(self, request):
        try:
            return self.dispatch(request)
        except instaloader.LoginRequiredException:
            # Only an explicit login rejection invalidates a saved session.
            requires_login = request.get("action") == "inspect" and request.get("target", {}).get("kind") != "post"
            if request.get("action") == "download":
                requires_login = self.inspections.get(request.get("inspectionId"), {}).get("requiresLogin", False)
            if requires_login:
                self.loader = None
                self.verified = False
                self.inspections.clear()
                self.session_file.unlink(missing_ok=True)
            raise

    def dispatch(self, request):
        action = request["action"]
        if action == "status":
            return self.status()
        if action == "login":
            return self.login(request["username"], request["password"])
        if action == "browser-session":
            return self.import_browser_session(request["cookies"], request.get("username"))
        if action == "retry":
            return self.retry_login()
        if action == "code":
            if not self.pending or self.pending["state"] != "code-required":
                raise ValueError("No verification code is pending. Log in again.")
            loader = self.pending["loader"]
            loader.two_factor_login(request["code"])
            return self.finish_login(loader)
        if action == "logout":
            self.pending = None
            self.loader = None
            self.verified = False
            self.inspections.clear()
            self.session_file.unlink(missing_ok=True)
            return self.status()
        if action == "inspect":
            return self.inspect(request["target"])
        if action == "download":
            return self.download(request)
        raise ValueError("Unknown Instagram action.")


def friendly_error(error):
    if isinstance(error, ValueError):
        return str(error)
    if isinstance(error, instaloader.BadCredentialsException):
        if "code" in str(error).lower() or "2fa" in str(error).lower():
            return "Instagram rejected that verification code. Enter a new code or use browser sign-in."
        return "Instaloader could not log in with that password. Use Log in with Instagram to sign in directly on Instagram."
    if isinstance(error, instaloader.LoginRequiredException):
        return "Instagram requires a session for this link. Use Log in with Instagram, then try again."
    message = str(error).lower()
    if "429" in message or "please wait" in message or "feedback_required" in message:
        return "Instagram is limiting requests. Wait a while before trying again."
    if "checkpoint" in message or "challenge" in message:
        return "Instagram requires account verification. Open Instagram to complete it, then try again."
    if isinstance(error, (instaloader.ProfileNotExistsException, instaloader.QueryReturnedNotFoundException)):
        return "Instagram could not find that account or media. It may be private, deleted, or expired."
    if isinstance(error, instaloader.LoginException):
        return "Instagram could not complete login. Check the account in Instagram, then try again."
    if isinstance(error, instaloader.ConnectionException):
        return "Instagram could not be reached or rejected the request. Try again later."
    return "Instagram could not complete the request. Try again."


def main():
    directory = os.environ.get("MEDIA_DOWNLOADER_INSTAGRAM_DIR", str(Path.home() / ".config/media-downloader/instagram"))
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        worker = Worker(directory)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            # Instaloader prints diagnostics; they must never corrupt the protocol or expose secrets.
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                result = worker.handle(request)
            reply = {"id": request["id"], "result": result}
        except Exception as error:
            reply = {"id": request.get("id"), "error": friendly_error(error), "session": worker.status()}
        print(json.dumps(reply), flush=True)


if __name__ == "__main__":
    main()
