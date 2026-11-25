"""TikTok desktop sandbox login and creator-inbox upload for Windows."""
import hashlib
import hmac
import json
import os
import secrets
import socket
import sys
import tempfile
import time
import tkinter as tk
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import win32crypt

REDIRECT = "http://127.0.0.1:3455/callback/"
API = "https://open.tiktokapis.com"
TOKEN = API + "/v2/oauth/token/"
VAULT = Path(os.environ["LOCALAPPDATA"]) / "Cynetic" / "tiktok-sandbox.dpapi"


class TikTokError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


http = build_opener(NoRedirect())


def request(url, data, headers, method="POST"):
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with http.open(req, timeout=90) as response:
            return response.read()
    except HTTPError as exc:
        try:
            error = json.loads(exc.read(32768)).get("error")
            code = error.get("code") if isinstance(error, dict) else error
        except (UnicodeError, ValueError, AttributeError):
            code = None
        # Only report the error code. URLs and response bodies can carry credentials.
        safe = code if isinstance(code, str) and code.replace("_", "").isalnum() else "request failed"
        raise TikTokError(f"TikTok HTTP {exc.code}: {safe}") from None
    except (URLError, TimeoutError, OSError):
        raise TikTokError("Network request interrupted. Check your connection.") from None


def exchange(form):
    return json.loads(request(TOKEN, urlencode(form).encode(), {
        "Content-Type": "application/x-www-form-urlencoded",
    }))


def api(path, token, payload):
    reply = json.loads(request(API + path, json.dumps(payload).encode(), {
        "Content-Type": "application/json; charset=UTF-8",
        "Authorization": "Bearer " + token,
    }))
    code = reply.get("error", {}).get("code")
    if code != "ok":
        raise TikTokError(f"TikTok API: {code}")
    return reply["data"]


def store(session):
    sealed = win32crypt.CryptProtectData(json.dumps(session).encode(), "Cynetic TikTok", None, None, None, 1)
    VAULT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=VAULT.parent, delete=False) as tmp:
        staged = Path(tmp.name)
        tmp.write(sealed)
    try:
        os.replace(staged, VAULT)
    finally:
        staged.unlink(missing_ok=True)


def load():
    if not VAULT.is_file():
        return None
    plain = win32crypt.CryptUnprotectData(VAULT.read_bytes(), None, None, None, 1)[1]
    return json.loads(plain)


def credentials(root, key=""):
    form = tk.Toplevel(root)
    form.title("Cynetic · TikTok Sandbox")
    form.resizable(False, False)
    panel = ttk.Frame(form, padding=18)
    panel.pack()
    entries = []
    for row, label in enumerate(("Client key", "Client secret")):
        ttk.Label(panel, text=label).grid(row=row, column=0, sticky="w", padx=(0, 12), pady=6)
        entry = ttk.Entry(panel, width=38, show="*" if row else "")
        entry.grid(row=row, column=1)
        entries.append(entry)
    entries[0].insert(0, key)
    result = []
    def submit(event=None):
        values = [e.get().strip() for e in entries]
        if all(values):
            result.extend(values)
            form.destroy()
    ttk.Button(panel, text="Continue with TikTok", command=submit).grid(row=2, column=1, sticky="e", pady=(10, 0))
    form.bind("<Return>", submit)
    form.bind("<Escape>", lambda event: form.destroy())
    form.lift()
    form.attributes("-topmost", True)
    entries[0].focus_force()
    root.wait_window(form)
    return result


class CallbackServer(HTTPServer):
    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    allow_reuse_address = False

    def get_request(self):
        client, addr = super().get_request()
        client.settimeout(2)
        return client, addr


def authorize(key, secret):
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    result = {}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = urlsplit(self.path)
            query = parse_qs(path.query)
            if (self.headers.get("Host") != "127.0.0.1:3455" or path.path != "/callback/"
                    or not hmac.compare_digest(query.get("state", [""])[0].encode(), state.encode())):
                self.send_error(400)
                return
            result["code"] = query.get("code", [""])[0]
            result["error"] = query.get("error", [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(b"Return to Cynetic to see the connection result.")
    params = dict(client_key=key, redirect_uri=REDIRECT, response_type="code", scope="video.upload",
                  state=state, code_challenge=hashlib.sha256(verifier.encode()).hexdigest(),
                  code_challenge_method="S256")
    with CallbackServer(("127.0.0.1", 3455), Handler) as server:
        server.timeout = .5
        os.startfile("https://www.tiktok.com/v2/auth/authorize/?" + urlencode(params))
        deadline = time.monotonic() + 300
        while not result and time.monotonic() < deadline:
            server.handle_request()
    if not result.get("code") or result.get("error"):
        raise TikTokError("Authorization was declined or timed out. Reconnect to try again.")
    tokens = exchange(dict(client_key=key, client_secret=secret, code=result["code"], redirect_uri=REDIRECT,
                           code_verifier=verifier, grant_type="authorization_code"))
    return session_from(key, secret, tokens)


def session_from(key, secret, tokens):
    if "video.upload" not in tokens.get("scope", "").split(","):
        raise TikTokError("Enable video.upload in the sandbox and grant it on the TikTok consent screen.")
    return dict(client_key=key, client_secret=secret, access=tokens["access_token"],
                refresh=tokens["refresh_token"], expires=time.time() + tokens["expires_in"])


def access(session):
    if session["expires"] < time.time() + 120:
        tokens = exchange(dict(client_key=session["client_key"], client_secret=session["client_secret"],
                               refresh_token=session["refresh"], grant_type="refresh_token"))
        session.update(session_from(session["client_key"], session["client_secret"], tokens))
        store(session)
    return session["access"]


def chunk_plan(size):
    if not 0 < size <= 4_000_000_000:
        raise TikTokError("Choose a nonempty MP4 of up to 4 GB.")
    chunk = size if size <= 64 * 1024**2 else 16 * 1024**2
    return chunk, size // chunk


def upload(token, path):
    with path.open("rb") as movie:
        size = os.fstat(movie.fileno()).st_size
        chunk, count = chunk_plan(size)
        init = api("/v2/post/publish/inbox/video/init/", token, {"source_info": {
            "source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk, "total_chunk_count": count,
        }})
        url = init["upload_url"]
        if urlsplit(url).scheme != "https":
            raise TikTokError("TikTok returned an invalid upload address.")
        for i in range(count):
            start = i * chunk
            length = size - start if i == count - 1 else chunk
            data = movie.read(length)
            if len(data) != length:
                raise TikTokError("The selected file changed during upload.")
            request(url, data, {"Content-Type": "video/mp4",
                                "Content-Range": f"bytes {start}-{start+length-1}/{size}"}, "PUT")
    return init["publish_id"]


def delivery(token, publish_id):
    for _ in range(26):
        status = api("/v2/post/publish/status/fetch/", token, {"publish_id": publish_id})
        if status["status"] in ("SEND_TO_USER_INBOX", "PUBLISH_COMPLETE"):
            return "Delivered. Open your TikTok inbox to review the video."
        if status["status"] == "FAILED":
            raise TikTokError("TikTok processing failed: " + str(status.get("fail_reason", "unknown reason")))
        time.sleep(3)
    return "Transfer complete. TikTok is still processing the video. Check your TikTok inbox later."


@contextmanager
def locked():
    import msvcrt
    VAULT.parent.mkdir(parents=True, exist_ok=True)
    with (VAULT.parent / "tiktok-session.lock").open("a+b") as f:
        f.seek(0)
        try:
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise TikTokError("Another TikTok operation is already open.") from None
        try:
            yield
        finally:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def run(mode):
    root = tk.Tk()
    root.withdraw()
    try:
        with locked():
            session = load()
            if mode == "--tiktok-connect" or not session:
                pair = credentials(root, session["client_key"] if session else "")
                if not pair:
                    return 0
                session = authorize(*pair)
                store(session)
            if mode == "--tiktok-connect":
                msg = "Connected. TikTok granted permission to send drafts."
            elif mode == "--tiktok-draft":
                selected = filedialog.askopenfilename(parent=root, title="Select an MP4 to send to your TikTok inbox",
                                                      filetypes=[("MP4 video", "*.mp4")])
                if not selected:
                    return 0
                path = Path(selected)
                if not messagebox.askokcancel("TikTok draft", f"Send {path.name} to the connected TikTok inbox?", parent=root):
                    return 0
                token = access(session)
                publish_id = upload(token, path)
                msg = delivery(token, publish_id)
            else:
                return 1
        messagebox.showinfo("Cynetic · TikTok", msg, parent=root)
        return 0
    except Exception as exc:
        msg = str(exc) if isinstance(exc, TikTokError) else (
            "Could not start the local callback or access the session. Check port 3455 and reconnect."
            if isinstance(exc, OSError) else "Could not complete the TikTok connection. Check the sandbox settings.")
        messagebox.showerror("Cynetic · TikTok", msg, parent=root)
        return 1
    finally:
        root.destroy()


if __name__ == "__main__":
    sys.exit(run(sys.argv[1]))
