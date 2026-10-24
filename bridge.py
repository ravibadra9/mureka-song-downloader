"""
Mureka Song Downloader - Local Companion Bridge (v1.0.0)
High-performance local backend for the Mureka Song Downloader Chrome Extension.

Features:
- Port 59966 HTTP REST API
- Multi-threaded hardware-accelerated batch downloads directly to Desktop/Mureka_Songs
- Real-time progress, speed & count tracking (/progress)
- Session synchronization from Chrome Extension
- One-click folder opening (/open-folder)
"""

import sys
sys.dont_write_bytecode = True
import os
import re
import json
import time
import shutil
import subprocess
import threading
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import ota_updater
except ImportError:
    ota_updater = None

# Force UTF-8 on Windows stdout/stderr
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

PORT = 59966
DOWNLOAD_DIR = Path.home() / "Desktop" / "Mureka_Songs"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

BRIDGE_VERSION = "1.0.0"
if ota_updater:
    try:
        BRIDGE_VERSION = ota_updater.get_local_version_info().get("version", "1.0.0")
    except Exception:
        pass

SESSION_FILE = Path.home() / ".mureka_session.json"
LOCAL_SESSION_FILE = Path(__file__).parent / "mureka_session.json"
ACTIVE_COOKIES = ""
ACTIVE_TOKEN = ""

def load_initial_session():
    global ACTIVE_COOKIES, ACTIVE_TOKEN
    for p in [LOCAL_SESSION_FILE, SESSION_FILE]:
        if p.is_file():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        ACTIVE_COOKIES = data.get("cookies", "")
                        ACTIVE_TOKEN = data.get("access_token", "")
                    elif isinstance(data, list):
                        ACTIVE_COOKIES = "; ".join([f"{c.get('name')}={c.get('value')}" for c in data if 'name' in c and 'value' in c])
                    if ACTIVE_COOKIES or ACTIVE_TOKEN:
                        break
            except Exception:
                pass

load_initial_session()

# Global Progress State
PROGRESS = {
    "status": "idle",
    "completed": 0,
    "total": 0,
    "percent": 0.0,
    "current_song": "",
    "speed": "",
    "status_text": "Ready"
}

def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]', '_', str(name or 'song')).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned[:100] or 'song'

def download_single_song(item: dict, base_dir: Path, out_format: str, sort_folders: bool, save_lyrics: bool):
    global PROGRESS
    title = sanitize_filename(item.get("title", f"Song_{item.get('song_id', 'unknown')}"))
    ws_name = sanitize_filename(item.get("workspace_name", "My workspace"))
    url = item.get("mp3_url") or item.get("url") or item.get("audio_url")

    if not url:
        return False

    url = url.strip()
    if not url.startswith("http"):
        url = f"https://cdn.mureka.ai/{url.lstrip('/')}"

    target_dir = base_dir / ws_name if sort_folders else base_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    ext = "wav" if out_format == "wav" else "mp3"
    target_file = target_dir / f"{title}.{ext}"

    # Download file if not exists or size is 0
    if not target_file.is_file() or target_file.stat().st_size == 0:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        }
        if ACTIVE_TOKEN:
            headers["Authorization"] = f"Bearer {ACTIVE_TOKEN}"
        if ACTIVE_COOKIES:
            headers["Cookie"] = ACTIVE_COOKIES

        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp, open(target_file, "wb") as out_f:
            shutil.copyfileobj(resp, out_f)

    # Save lyrics if present
    lyrics = item.get("lyrics")
    if save_lyrics and lyrics and lyrics.strip():
        lyrics_file = target_dir / f"{title}.lrc"
        with open(lyrics_file, "w", encoding="utf-8") as lf:
            lf.write(lyrics.strip())

    return True

def run_batch_download_thread(songs: list, out_format: str, sort_folders: bool, save_lyrics: bool):
    global PROGRESS
    total = len(songs)
    PROGRESS = {
        "status": "downloading",
        "completed": 0,
        "total": total,
        "percent": 0.0,
        "current_song": "",
        "speed": "",
        "status_text": f"Starting batch download of {total} songs..."
    }

    start_time = time.time()
    completed = 0

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(download_single_song, s, DOWNLOAD_DIR, out_format, sort_folders, save_lyrics): s
            for s in songs
        }

        for fut in as_completed(futures):
            item = futures[fut]
            completed += 1
            pct = round((completed / total) * 100, 1) if total > 0 else 100.0
            title = item.get("title", "Song")

            elapsed = max(0.1, time.time() - start_time)
            speed = f"{completed / elapsed:.1f} songs/sec"

            PROGRESS = {
                "status": "downloading",
                "completed": completed,
                "total": total,
                "percent": pct,
                "current_song": title,
                "speed": speed,
                "status_text": f"Downloaded [{completed}/{total}]: {title}"
            }

    PROGRESS["status"] = "finished"
    PROGRESS["percent"] = 100.0
    PROGRESS["status_text"] = f"Finished! {completed} songs saved to {DOWNLOAD_DIR}"
    print(f"[Bridge] Batch download complete: {completed} songs saved.")

class BridgeHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/status":
            self._send_json({
                "online": True,
                "version": BRIDGE_VERSION,
                "download_dir": str(DOWNLOAD_DIR),
                "session_active": bool(ACTIVE_COOKIES),
                "progress_status": PROGRESS["status"],
                "ota_supported": bool(ota_updater)
            })
            return

        if path == "/ota/check":
            if ota_updater:
                update_info = ota_updater.check_for_updates()
                self._send_json(update_info)
            else:
                self._send_json({"update_available": False, "error": "ota_updater not loaded"})
            return

        if path == "/progress":
            self._send_json(PROGRESS)
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        global ACTIVE_COOKIES, ACTIVE_TOKEN
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
        try:
            body = json.loads(post_body)
        except Exception:
            body = {}

        if path == "/ota/apply":
            if not ota_updater:
                self._send_json({"success": False, "error": "ota_updater module not available"}, 500)
                return

            res = ota_updater.apply_update()
            self._send_json(res)

            # If update succeeded, schedule hot restart of companion bridge
            if res.get("success"):
                def _do_restart():
                    time.sleep(1.0)
                    print("[OTA] Restarting companion bridge process with new code...")
                    os._exit(42)
                threading.Thread(target=_do_restart, daemon=True).start()
            return

        if path == "/ota/restart":
            self._send_json({"success": True, "message": "Bridge is restarting..."})
            def _manual_restart():
                time.sleep(0.5)
                os._exit(42)
            threading.Thread(target=_manual_restart, daemon=True).start()
            return

        if path == "/sync-session":
            cookies = body.get("cookies", "")
            token = body.get("access_token", "")
            if cookies or token:
                if cookies:
                    ACTIVE_COOKIES = cookies
                if token:
                    ACTIVE_TOKEN = token
                try:
                    for sf in [LOCAL_SESSION_FILE, SESSION_FILE]:
                        with open(sf, "w", encoding="utf-8") as f:
                            json.dump({
                                "cookies": ACTIVE_COOKIES,
                                "access_token": ACTIVE_TOKEN,
                                "timestamp": time.time()
                            }, f, indent=2)
                except Exception as e:
                    print(f"Failed to persist session: {e}")
                print(f"[Bridge] Session synced (cookies={bool(ACTIVE_COOKIES)}, token={bool(ACTIVE_TOKEN)}).")
                self._send_json({"success": True, "message": "Session synced successfully"})
            else:
                self._send_json({"success": False, "error": "No cookies or token provided"}, 400)
            return

        if path == "/download-batch":
            songs = body.get("songs", [])
            out_format = body.get("format", "mp3")
            sort_folders = body.get("sort_folders", True)
            save_lyrics = body.get("save_lyrics", True)

            if not songs:
                self._send_json({"success": False, "error": "No songs in payload"}, 400)
                return

            threading.Thread(
                target=run_batch_download_thread,
                args=(songs, out_format, sort_folders, save_lyrics),
                daemon=True
            ).start()

            self._send_json({
                "success": True,
                "message": f"Queued {len(songs)} songs for background download",
                "count": len(songs),
                "download_dir": str(DOWNLOAD_DIR)
            })
            return

        if path == "/open-folder":
            try:
                if sys.platform == "win32":
                    os.startfile(str(DOWNLOAD_DIR))
                elif sys.platform == "darwin":
                    subprocess.Popen(["open", str(DOWNLOAD_DIR)])
                else:
                    subprocess.Popen(["xdg-open", str(DOWNLOAD_DIR)])
                self._send_json({"success": True, "path": str(DOWNLOAD_DIR)})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)
            return

        self.send_response(404)
        self.end_headers()

    def _send_json(self, data: dict, status_code: int = 200):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def log_message(self, format, *args):
        pass

def start_server():
    server = HTTPServer(("127.0.0.1", PORT), BridgeHandler)
    print("=" * 65)
    print(f" 🎵 MUREKA COMPANION BRIDGE v1.0.0 ACTIVE on http://127.0.0.1:{PORT}")
    print(f" 📁 Target Download Directory: {DOWNLOAD_DIR}")
    print(f" 🔑 Session Status: {'Active' if ACTIVE_COOKIES else 'Waiting for Extension Sync'}")
    print("=" * 65)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down bridge...")
        server.server_close()

if __name__ == "__main__":
    start_server()
