"""Deterministic Instaloader stand-in; never connects to Instagram."""
from datetime import datetime, timezone
from types import SimpleNamespace

class LoginException(Exception): pass
class BadCredentialsException(LoginException): pass
class TwoFactorAuthRequiredException(LoginException): pass
class LoginRequiredException(Exception): pass
class ProfileNotExistsException(Exception): pass
class QueryReturnedNotFoundException(Exception): pass
class ConnectionException(Exception): pass

class Response:
    def iter_content(self, size):
        yield b"original-media-bytes"
    def close(self): pass

class Context:
    def __init__(self): self.username = None
    def get_raw(self, url): return Response()
    def error(self, *args, **kwargs): pass

class Instaloader:
    def __init__(self, **kwargs):
        self.context = Context()
        self.attempts = 0
        self.pending = None
    def load_session(self, username, cookies):
        self.context.username = username
        self.cookies = cookies
    def save_session(self): return {"fake_session": "saved"}
    def login(self, username, password):
        self.attempts += 1
        if password == "wrong": raise BadCredentialsException("wrong password")
        if username == "verify":
            self.pending = username
            raise TwoFactorAuthRequiredException()
        if username == "checkpoint" and self.attempts == 1:
            raise LoginException("Login: Checkpoint required. Point your browser to /challenge/123/ - follow the instructions, then retry.")
        self.context.username = username
    def two_factor_login(self, code):
        if code != "123456": raise BadCredentialsException("invalid code")
        self.context.username = self.pending
    def test_login(self):
        if self.context.username == "browser": return self.cookies.get("fake_username")
        if self.context.username == "offline":
            self.context.error("Network unavailable")
            return None
        return None if self.context.username == "expired" else self.context.username
    def get_stories(self, userids):
        if userids == [999]: return iter([])
        return iter([SimpleNamespace(get_items=lambda: iter([media(False, "101"), media(True, "102")]))])

class Profile:
    @staticmethod
    def from_username(context, username):
        return SimpleNamespace(username=username, userid=999 if username == "empty" else 123)

def media(video, mediaid):
    return SimpleNamespace(is_video=video, url="/icons/app-mark.png", video_url="fake:video", owner_username="example", mediaid=mediaid, date_utc=datetime.now(timezone.utc))

class Post:
    @staticmethod
    def from_shortcode(context, shortcode):
        if context.username == "expired" or (context.username is None and shortcode == "loginonly"):
            raise LoginRequiredException()
        post = media(shortcode == "video", "201")
        post.typename = "GraphSidecar" if shortcode == "album" else "GraphVideo" if shortcode == "video" else "GraphImage"
        post.get_sidecar_nodes = lambda: iter([SimpleNamespace(is_video=False, display_url="/icons/app-mark.png", video_url=None), SimpleNamespace(is_video=True, display_url="/icons/app-mark.png", video_url="fake:video")])
        return post
