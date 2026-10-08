import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("instagram_worker", Path(__file__).resolve().parents[1] / "scripts/instagram-worker.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class InstagramWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.worker = module.Worker(self.root / "session")
    def tearDown(self): self.temp.cleanup()
    def login(self): return self.worker.handle({"action": "login", "username": "example", "password": "fake-password"})
    def test_saved_session_reuses_login_after_restart_without_password(self):
        self.login()
        saved = json.loads(self.worker.session_file.read_text())
        self.assertNotIn("password", saved)
        self.assertEqual(saved["username"], "example")
        restarted = module.Worker(self.root / "session")
        self.assertEqual(restarted.status()["state"], "connected")
        self.assertEqual(restarted.loader.attempts, 0)
        restarted.inspect({"kind": "stories", "username": "example"})
        self.assertEqual(restarted.loader.attempts, 0)
    def test_code_retry_preserves_pending_context(self):
        result = self.worker.login("verify", "fake-password")
        self.assertEqual(result["state"], "code-required")
        context = self.worker.pending["loader"]
        with self.assertRaises(module.instaloader.BadCredentialsException):
            self.worker.handle({"action": "code", "code": "000000"})
        self.assertIs(self.worker.pending["loader"], context)
        self.assertEqual(self.worker.handle({"action": "code", "code": "123456"})["state"], "connected")
        self.assertIsNone(self.worker.pending)
    def test_checkpoint_is_visible_and_retry_finishes_login(self):
        result = self.worker.login("checkpoint", "fake-password")
        self.assertEqual(result["state"], "challenge")
        self.assertEqual(result["challengeUrl"], "https://www.instagram.com/challenge/123/")
        self.assertEqual(self.worker.retry_login()["state"], "connected")
        self.assertIsNone(module.Worker.checkpoint_url("https://evil.example/challenge/"))
    def test_failed_login_does_not_replace_saved_session(self):
        self.login()
        original = self.worker.session_file.read_text()
        with self.assertRaises(module.instaloader.BadCredentialsException): self.worker.login("different", "wrong")
        self.assertEqual(self.worker.session_file.read_text(), original)
    def test_expired_session_requests_login_without_retrying_credentials(self):
        self.worker.directory.mkdir()
        self.worker.session_file.write_text(json.dumps({"username": "expired", "cookies": {"fake": "saved"}}))
        restarted = module.Worker(self.worker.directory)
        with self.assertRaisesRegex(ValueError, "session expired"): restarted.inspect({"kind": "stories", "username": "example"})
        self.assertEqual(restarted.status()["state"], "disconnected")
        self.assertFalse(restarted.session_file.exists())
    def test_post_carousel_and_targeted_story_download_originals(self):
        self.login()
        for shortcode, kind in [("photo", "image"), ("video", "video")]:
            result = self.worker.inspect({"kind": "post", "shortcode": shortcode})
            self.assertEqual(result["items"][0]["type"], kind)
        album = self.worker.inspect({"kind": "post", "shortcode": "album"})
        self.assertEqual([item["type"] for item in album["items"]], ["image", "video"])
        request = {"action": "download", "inspectionId": album["id"], "itemIds": ["1", "2"], "outputDir": str(self.root / "out"), "stagingDir": str(self.root / "stage")}
        result = self.worker.handle(request)
        with zipfile.ZipFile(result["filePath"]) as archive:
            self.assertEqual(len(archive.namelist()), 2)
            self.assertTrue(any(name.endswith(".mp4") for name in archive.namelist()))
            self.assertTrue(any(name.endswith(".jpg") for name in archive.namelist()))
            self.assertTrue(all(archive.read(name) == b"original-media-bytes" for name in archive.namelist()))
        story = self.worker.inspect({"kind": "stories", "username": "example", "mediaId": "102"})
        self.assertEqual(len(story["items"]), 1)
        self.assertEqual(story["items"][0]["type"], "video")
        request.update(inspectionId=story["id"], itemIds=["1"])
        result = self.worker.handle(request)
        self.assertTrue(result["filePath"].endswith(".mp4"))
        self.assertEqual(Path(result["filePath"]).read_bytes(), b"original-media-bytes")
    def test_temporary_validation_failure_preserves_saved_session(self):
        self.worker.directory.mkdir()
        self.worker.session_file.write_text(json.dumps({"username": "offline", "cookies": {"fake": "saved"}}))
        restarted = module.Worker(self.worker.directory)
        original = restarted.session_file.read_text()
        with self.assertRaises(module.instaloader.ConnectionException): restarted.inspect({"kind": "stories", "username": "example"})
        self.assertEqual(restarted.session_file.read_text(), original)
        self.assertEqual(restarted.status()["state"], "connected")
    def test_stale_inspection_invalid_selection_and_no_stories_are_visible(self):
        self.login()
        album = self.worker.inspect({"kind": "post", "shortcode": "album"})
        request = {"inspectionId": album["id"], "itemIds": ["99"], "outputDir": str(self.root / "out"), "stagingDir": str(self.root / "stage")}
        with self.assertRaisesRegex(ValueError, "Select available"): self.worker.download(request)
        self.worker.inspections[album["id"]]["created"] = 0
        with self.assertRaisesRegex(ValueError, "Inspect the link again"): self.worker.download(request)
        with self.assertRaisesRegex(ValueError, "No available media"): self.worker.inspect({"kind": "stories", "username": "empty"})
    def test_signout_clears_session_and_inspections(self):
        self.login()
        self.worker.inspect({"kind": "post", "shortcode": "photo"})
        self.assertEqual(self.worker.handle({"action": "logout"}), {"state": "disconnected"})
        self.assertFalse(self.worker.session_file.exists())
        self.assertFalse(self.worker.inspections)
    def test_explicit_login_rejection_during_use_prompts_login_again(self):
        self.login()
        self.worker.loader.get_stories = lambda **kwargs: (_ for _ in ()).throw(module.instaloader.LoginRequiredException())
        with self.assertRaises(module.instaloader.LoginRequiredException): self.worker.handle({"action": "inspect", "target": {"kind": "stories", "username": "example"}})
        self.assertEqual(self.worker.status()["state"], "disconnected")
        self.assertFalse(self.worker.session_file.exists())
    def test_public_photos_videos_and_albums_download_without_login(self):
        for shortcode in ["photo", "video", "album"]:
            inspected = self.worker.inspect({"kind": "post", "shortcode": shortcode})
            result = self.worker.download({"inspectionId": inspected["id"], "itemIds": [item["id"] for item in inspected["items"]], "outputDir": str(self.root / "out"), "stagingDir": str(self.root / "stage")})
            self.assertTrue(Path(result["filePath"]).exists())
        self.assertEqual(self.worker.status()["state"], "disconnected")
        self.assertFalse(self.worker.session_file.exists())
        with self.assertRaisesRegex(ValueError, "Stories require"): self.worker.inspect({"kind": "stories", "username": "example"})
    def test_public_post_is_not_blocked_by_pending_or_failed_login(self):
        self.worker.login("verify", "fake-password")
        inspected = self.worker.inspect({"kind": "post", "shortcode": "photo"})
        self.assertEqual(len(inspected["items"]), 1)
        with self.assertRaises(module.instaloader.BadCredentialsException): self.worker.login("example", "wrong")
        self.assertEqual(len(self.worker.inspect({"kind": "post", "shortcode": "video"})["items"]), 1)
    def test_browser_login_validates_identity_and_persists_for_restart(self):
        public_post = self.worker.inspect({"kind": "post", "shortcode": "photo"})
        result = self.worker.import_browser_session({"sessionid": "fake", "ds_user_id": "123", "fake_username": "example"})
        self.assertEqual(result, {"state": "connected", "username": "example"})
        self.assertEqual(module.Worker(self.worker.directory).status()["username"], "example")
        self.assertIsNone(self.worker.pending)
        self.assertIn(public_post["id"], self.worker.inspections)
    def test_incomplete_or_rejected_browser_session_never_replaces_saved_login(self):
        self.login()
        original = self.worker.session_file.read_text()
        for cookies in [{}, {"sessionid": "fake", "ds_user_id": "123"}]:
            with self.assertRaises(ValueError): self.worker.import_browser_session(cookies)
            self.assertEqual(self.worker.session_file.read_text(), original)
    def test_expired_saved_login_falls_back_to_anonymous_public_post(self):
        self.worker.directory.mkdir()
        self.worker.session_file.write_text(json.dumps({"username": "expired", "cookies": {"fake": "saved"}}))
        restarted = module.Worker(self.worker.directory)
        self.assertEqual(len(restarted.handle({"action": "inspect", "target": {"kind": "post", "shortcode": "photo"}})["items"]), 1)
        self.assertEqual(restarted.status()["state"], "disconnected")
    def test_anonymous_login_required_does_not_erase_a_good_saved_account(self):
        self.login()
        original = self.worker.session_file.read_text()
        self.worker.login("verify", "fake-password")
        with self.assertRaises(module.instaloader.LoginRequiredException): self.worker.handle({"action": "inspect", "target": {"kind": "post", "shortcode": "loginonly"}})
        self.assertEqual(self.worker.session_file.read_text(), original)

if __name__ == "__main__": unittest.main()
