"""Offline tests for the TikTok callback, session vault and draft transfer."""
import hashlib
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "plate"))
import tiktok


class SandboxTests(unittest.TestCase):
    def test_callback_and_token_exchange(self):
        # Use an ephemeral port so a real login can run alongside this test.
        expected = {}
        servers = []
        original = tiktok.CallbackServer
        def listener(addr, handler):
            server = original((addr[0], 0), handler)
            servers.append(server)
            return server
        def browser(url):
            expected.update({k: v[0] for k, v in parse_qs(urlsplit(url).query).items()})
            def callback():
                from urllib.request import Request
                port = servers[0].server_port
                for state in ("incorrect", expected["state"]):
                    req = Request(f"http://127.0.0.1:{port}/callback/?" + urlencode({"code":"test-code","state":state}),
                                  headers={"Host":"127.0.0.1:3455"})
                    try:
                        with urlopen(req, timeout=3) as resp:
                            resp.read()
                    except HTTPError as exc:
                        if state != "incorrect" or exc.code != 400:
                            raise
            threading.Thread(target=callback, daemon=True).start()
        def exchange(form):
            self.assertEqual(expected["code_challenge"], hashlib.sha256(form["code_verifier"].encode()).hexdigest())
            self.assertEqual(form["redirect_uri"], tiktok.REDIRECT)
            self.assertEqual(form["code"], "test-code")
            self.assertEqual(expected["scope"], "video.upload")
            return dict(scope="video.upload", access_token="test-access", refresh_token="test-refresh", expires_in=3600)
        with patch.object(tiktok, "CallbackServer", listener), patch.object(tiktok.os, "startfile", browser), patch.object(tiktok, "exchange", exchange):
            self.assertEqual(tiktok.authorize("test-key", "test-secret")["access"], "test-access")

    def test_refresh_and_vault(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(tiktok, "VAULT", Path(tmp)/"test.dpapi"):
            tokens = dict(scope="video.upload",access_token="test-access",refresh_token="old",expires_in=-1)
            session = tiktok.session_from("test-key", "test-secret", tokens)
            tiktok.store(session)
            self.assertNotIn(b"test-secret", tiktok.VAULT.read_bytes())
            self.assertEqual(tiktok.load(), session)
            tokens.update(access_token="new",refresh_token="rotated",expires_in=3600)
            with patch.object(tiktok, "exchange", return_value=tokens):
                self.assertEqual(tiktok.access(session), "new")
            self.assertEqual(tiktok.load()["refresh"], "rotated")

    def test_draft_only_and_chunk_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp)/"video.mp4"
            size = 65*1024**2+37
            with f.open("wb") as stream:
                stream.truncate(size)
            ranges = []
            def init(path, token, payload):
                self.assertEqual(path, "/v2/post/publish/inbox/video/init/")
                self.assertEqual(payload["source_info"]["total_chunk_count"], 4)
                return dict(publish_id="draft",upload_url="https://example.invalid/upload")
            def put(url, data, headers, method):
                self.assertEqual(method,"PUT")
                self.assertNotIn("Authorization", headers)
                start = sum(ranges)
                ranges.append(len(data))
                self.assertEqual(headers["Content-Range"], f"bytes {start}-{sum(ranges)-1}/{size}")
            with patch.object(tiktok, "api", init), patch.object(tiktok, "request", put):
                self.assertEqual(tiktok.upload("test-access", f), "draft")
            self.assertEqual(sum(ranges),size)
            self.assertEqual(tiktok.chunk_plan(32_633_840), (32_633_840, 1))
            with patch.object(tiktok, "api", return_value={"status":"SEND_TO_USER_INBOX"}):
                self.assertIn("Delivered",tiktok.delivery("test-access","draft"))


if __name__ == "__main__":
    unittest.main()
