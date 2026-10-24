"""
🎵 Mureka Song Downloader - Standalone Python Desktop App & CLI Tool
Downloads songs from ALL workspaces in your Mureka.ai account with automatic folder organization.

Usage:
  GUI Mode:
    python mureka_downloader.py
    (or double-click start_downloader.bat)

  CLI Mode:
    python mureka_downloader.py --all
    python mureka_downloader.py --workspace "Morning Serenity" --format mp3
    python mureka_downloader.py --all --format wav --output "D:/MyMusic"
"""

import sys
sys.dont_write_bytecode = True
import os
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
import re
import json
import time
import shutil
import atexit
import argparse
import threading
from pathlib import Path

_MUREKA_DIR = Path(__file__).resolve().parent

# Chrome extension restriction: No folder starting with "_" allowed in extension directory
def _purge_pycache(target_dir=_MUREKA_DIR):
    try:
        p = target_dir / "__pycache__"
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
    except Exception:
        pass

_purge_pycache()
atexit.register(_purge_pycache)
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request
import urllib.parse

# Force UTF-8 on Windows
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

# Default target directory
DEFAULT_DOWNLOAD_DIR = Path.home() / "Desktop" / "Mureka_Songs"
DEFAULT_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Common session file locations
CANDIDATE_SESSION_FILES = [
    Path.home() / ".mureka_session.json",
    Path.home() / "Downloads" / "Mureka" / "mureka_session.json",
    Path(__file__).parent / "mureka_session.json",
    Path(__file__).parent / "session.json"
]

def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]', '_', str(name or 'song')).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = re.sub(r'[\.\s]+$', '', cleaned)
    cleaned = re.sub(r'^\.+', '', cleaned)
    return cleaned[:100] or 'song'

class MurekaAPIClient:
    """Core API Client for Mureka.ai"""
    BASE_URL = "https://www.mureka.ai"
    CDN_URL = "https://cdn.mureka.ai"

    def __init__(self, cookie_string: str = "", access_token: str = ""):
        self.cookie_string = cookie_string.strip() if cookie_string else ""
        self.access_token = access_token.strip() if access_token else ""
        self.session = urllib.request.build_opener()
        self._extract_token_if_needed()

    def _extract_token_if_needed(self):
        if not self.access_token and self.cookie_string:
            match = re.search(r'Mureka_ai_globaldata=([^;]+)', self.cookie_string)
            if match:
                try:
                    val = urllib.parse.unquote(match.group(1))
                    data = json.loads(val)
                    self.access_token = data.get("session_token", {}).get("access_token", "")
                except Exception:
                    pass

    def set_cookies(self, cookies: str):
        self.cookie_string = cookies.strip()
        self._extract_token_if_needed()

    def set_token(self, token: str):
        self.access_token = token.strip()

    def _request(self, endpoint: str, method: str = "GET", params: dict = None, body: dict = None) -> dict:
        url = endpoint if endpoint.startswith("http") else f"{self.BASE_URL}{endpoint if endpoint.startswith('/') else '/' + endpoint}"
        if params:
            url += f"?{urllib.parse.urlencode(params)}"

        headers = {
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "X-App-Name": "SkyMusic.Ai",
            "X-Auth-Timestamp": str(int(time.time() * 1000))
        }

        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"

        if self.cookie_string:
            headers["Cookie"] = self.cookie_string

        req_body = None
        if body is not None:
            req_body = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=req_body, headers=headers, method=method)
        try:
            with self.session.open(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data
        except Exception as e:
            return {"code": -1, "msg": str(e), "error": str(e)}

    def get_profile(self) -> dict:
        return self._request("/api/pgc/profile")

    def get_workspaces(self) -> list:
        folders = []
        last_id = 0
        has_more = True
        while has_more:
            res = self._request("/api/pgc/folder/list", params={"last_id": last_id, "size": 50, "require_trash": "true"})
            if res.get("code") in (0, 200) and isinstance(res.get("data"), dict):
                p_list = res["data"].get("list", [])
                for item in p_list:
                    if not any(x.get("id") == item.get("id") for x in folders):
                        folders.append(item)
                has_more = bool(res["data"].get("more")) and bool(res["data"].get("last_id")) and len(p_list) > 0
                last_id = res["data"].get("last_id", 0)
            else:
                has_more = False
        return folders

    def get_workspace_songs(self, folder_id: int, on_progress=None) -> list:
        songs = []
        last_id = ""
        has_more = True

        while has_more:
            params = {"size": 30}
            if folder_id > 0:
                params["folder_id"] = folder_id
            if last_id:
                params["last_id"] = last_id

            res = self._request("/api/pgc/feed/list", params=params)
            if res.get("code") in (0, 200) and isinstance(res.get("data"), dict):
                data = res["data"]
                feed_list = data.get("list", [])
                for feed in feed_list:
                    songs_in_feed = feed.get("songs") if isinstance(feed.get("songs"), list) and len(feed.get("songs")) > 0 else ([feed] if (feed.get("song_id") or feed.get("mp3_url") or feed.get("audio_url")) else [])
                    for s in songs_in_feed:
                        if s.get("song_id") and (s.get("mp3_url") or s.get("url") or s.get("audio_url")):
                            title = (
                                s.get("title") or s.get("song_name") or s.get("name")
                                or feed.get("title") or feed.get("song_title") or feed.get("prompt") or feed.get("name") or feed.get("desc")
                                or s.get("prompt") or f"Song_{s.get('song_id')}"
                            )
                            s["title"] = str(title).strip()
                            s["feed_title"] = feed.get("title", "")
                            s["folder_id"] = folder_id
                            url = s.get("mp3_url") or s.get("url") or s.get("audio_url")
                            if url and not url.startswith("http"):
                                s["mp3_url"] = f"{self.CDN_URL}/{url.lstrip('/')}"
                            songs.append(s)

                if on_progress:
                    on_progress(len(songs))

                has_more = bool(data.get("more")) and bool(data.get("last_id")) and len(feed_list) > 0
                last_id = data.get("last_id", "")
            else:
                has_more = False

        return songs

    def get_download_url(self, song_id: str, fmt: str = "mp3") -> str | None:
        t_val = 9 if fmt == "wav" else 1 # 9 = FLAC/lossless, 1 = MP3
        res = self._request("/api/pgc/song/download", method="POST", body={"song_id": song_id, "t": t_val})
        if res.get("code") in (0, 200) and isinstance(res.get("data"), dict):
            key = res["data"].get("oss_key", "")
            if key:
                return key if key.startswith("http") else f"{self.CDN_URL}/{key.lstrip('/')}"
        return None

def find_saved_session() -> tuple[str, str]:
    """Returns (cookie_string, access_token)"""
    for p in CANDIDATE_SESSION_FILES:
        if p.is_file():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                    if not content:
                        continue
                    data = json.loads(content)

                    # Case A: Array of cookie dicts (Netscape / JSON Chrome cookies)
                    if isinstance(data, list):
                        c_str = "; ".join([f"{c.get('name')}={c.get('value')}" for c in data if 'name' in c and 'value' in c])
                        token = ""
                        for c in data:
                            if c.get("name") == "Mureka_ai_globaldata":
                                try:
                                    val = urllib.parse.unquote(c.get("value", ""))
                                    parsed = json.loads(val)
                                    token = parsed.get("session_token", {}).get("access_token", "")
                                except Exception:
                                    pass
                        if c_str or token:
                            return c_str, token

                    # Case B: Standard session dict
                    elif isinstance(data, dict):
                        c_str = data.get("cookies", "")
                        token = data.get("access_token", "")
                        if not token and c_str:
                            match = re.search(r'Mureka_ai_globaldata=([^;]+)', c_str)
                            if match:
                                try:
                                    val = urllib.parse.unquote(match.group(1))
                                    parsed = json.loads(val)
                                    token = parsed.get("session_token", {}).get("access_token", "")
                                except Exception:
                                    pass
                        if c_str or token:
                            return c_str, token
            except Exception:
                pass
    return "", ""

def download_song_worker(api: MurekaAPIClient, item: dict, base_dir: Path, fmt: str, sort_folders: bool, save_lyrics: bool, save_cover: bool) -> bool:
    raw_title = item.get("title") or item.get("song_name") or item.get("name") or item.get("feed_title") or item.get("prompt") or f"Song_{item.get('song_id')}"
    title = sanitize_filename(raw_title)
    ws_name = sanitize_filename(item.get("workspace_name", "My workspace"))
    target_dir = base_dir / ws_name if sort_folders else base_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    ext = "wav" if fmt == "wav" else "mp3"
    target_file = target_dir / f"{title}.{ext}"

    # Handle variation / duplicate title collision so duplicate variations don't overwrite each other
    if target_file.is_file() and target_file.stat().st_size > 0:
        ver = 2
        while True:
            candidate = target_dir / f"{title} (v{ver}).{ext}"
            if not candidate.is_file() or candidate.stat().st_size == 0:
                target_file = candidate
                title = f"{title} (v{ver})"
                break
            ver += 1

    if not target_file.is_file() or target_file.stat().st_size == 0:
        audio_url = None
        if fmt == "wav":
            audio_url = api.get_download_url(item.get("song_id"), "wav")
        if not audio_url:
            audio_url = item.get("mp3_url") or item.get("url") or item.get("audio_url")

        if not audio_url:
            return False

        audio_url = audio_url.strip()
        if not audio_url.startswith("http"):
            audio_url = f"https://cdn.mureka.ai/{audio_url.lstrip('/')}"

        req = urllib.request.Request(audio_url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Cookie": api.cookie_string
        })
        with urllib.request.urlopen(req, timeout=60) as resp, open(target_file, "wb") as out_f:
            shutil.copyfileobj(resp, out_f)

    # Save lyrics (.lrc)
    lyrics = item.get("lyrics")
    if save_lyrics and lyrics and lyrics.strip():
        lyrics_file = target_dir / f"{title}.lrc"
        with open(lyrics_file, "w", encoding="utf-8") as lf:
            lf.write(lyrics.strip())

    # Save cover art (.jpg)
    cover_url = item.get("image_url") or item.get("cover")
    if save_cover and cover_url:
        cover_file = target_dir / f"{title}.jpg"
        if not cover_file.is_file():
            try:
                c_req = urllib.request.Request(cover_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(c_req, timeout=30) as c_resp, open(cover_file, "wb") as cf:
                    shutil.copyfileobj(c_resp, cf)
            except Exception:
                pass

    return True

# =====================================================================
# GUI Application (Tkinter Modern Dark Studio)
# =====================================================================
def run_gui():
    import tkinter as tk
    from tkinter import ttk, messagebox, filedialog

    root = tk.Tk()
    root.title("Mureka Song Downloader - Studio Desktop")
    root.geometry("860x700")
    root.minsize(780, 600)
    root.configure(bg="#0a0c14")

    # Styling colors
    BG_DARK = "#0a0c14"
    BG_CARD = "#121522"
    BG_CARD_LIGHT = "#171c2f"
    TEXT_MAIN = "#f8fafc"
    TEXT_MUTED = "#94a3b8"
    ACCENT_EMERALD = "#10b981"
    ACCENT_CYAN = "#06b6d4"
    BORDER_COLOR = "#20263b"

    # API instance with discovered session
    cookies_str, access_token = find_saved_session()
    api = MurekaAPIClient(cookie_string=cookies_str, access_token=access_token)

    # App State
    workspaces_data = []
    ws_vars = {}
    is_downloading = False
    cancel_download = False

    # Header
    header_frame = tk.Frame(root, bg=BG_CARD, height=60, bd=0, highlightbackground=BORDER_COLOR, highlightthickness=1)
    header_frame.pack(fill="x", side="top")

    lbl_title = tk.Label(header_frame, text="🎵 MUREKA ALL-WORKSPACES DOWNLOADER", font=("Segoe UI", 14, "bold"), fg="#ffffff", bg=BG_CARD)
    lbl_title.pack(side="left", padx=20, pady=12)

    lbl_user = tk.Label(header_frame, text="Checking session...", font=("Segoe UI", 10), fg=TEXT_MUTED, bg=BG_CARD)
    lbl_user.pack(side="right", padx=20, pady=12)

    # Main Scrollable Body
    main_frame = tk.Frame(root, bg=BG_DARK)
    main_frame.pack(fill="both", expand=True, padx=20, pady=16)

    # Top Controls Bar: Destination & Session
    ctrl_frame = tk.Frame(main_frame, bg=BG_CARD, bd=0, highlightbackground=BORDER_COLOR, highlightthickness=1)
    ctrl_frame.pack(fill="x", pady=(0, 14), padx=2, ipady=8)

    dest_var = tk.StringVar(value=str(DEFAULT_DOWNLOAD_DIR))

    tk.Label(ctrl_frame, text="Save Folder:", font=("Segoe UI", 9, "bold"), fg=TEXT_MUTED, bg=BG_CARD).grid(row=0, column=0, padx=12, pady=6, sticky="w")
    entry_dest = tk.Entry(ctrl_frame, textvariable=dest_var, font=("Segoe UI", 9), bg="#080a10", fg="#ffffff", insertbackground="#ffffff", relief="flat", highlightbackground=BORDER_COLOR, highlightthickness=1)
    entry_dest.grid(row=0, column=1, padx=6, pady=6, sticky="ew")

    def browse_dir():
        d = filedialog.askdirectory(initialdir=dest_var.get())
        if d:
            dest_var.set(d)

    btn_browse = tk.Button(ctrl_frame, text="Browse…", font=("Segoe UI", 9), bg=BG_CARD_LIGHT, fg="#ffffff", relief="flat", padx=10, command=browse_dir)
    btn_browse.grid(row=0, column=2, padx=10, pady=6)

    ctrl_frame.grid_columnconfigure(1, weight=1)

    # Workspaces Panel Frame
    ws_panel = tk.Frame(main_frame, bg=BG_CARD, bd=0, highlightbackground=BORDER_COLOR, highlightthickness=1)
    ws_panel.pack(fill="both", expand=True, pady=(0, 14), padx=2)

    ws_header = tk.Frame(ws_panel, bg=BG_CARD_LIGHT, height=36)
    ws_header.pack(fill="x")

    lbl_ws_header = tk.Label(ws_header, text="📁 WORKSPACES IN YOUR ACCOUNT", font=("Segoe UI", 10, "bold"), fg="#ffffff", bg=BG_CARD_LIGHT)
    lbl_ws_header.pack(side="left", padx=12, pady=8)

    select_all_var = tk.BooleanVar(value=True)

    def toggle_select_all():
        val = select_all_var.get()
        for v in ws_vars.values():
            v.set(val)
        update_selected_count_label()

    chk_select_all = tk.Checkbutton(ws_header, text="Select All", variable=select_all_var, font=("Segoe UI", 9), fg="#ffffff", bg=BG_CARD_LIGHT, selectcolor="#080a10", activebackground=BG_CARD_LIGHT, activeforeground="#ffffff", command=toggle_select_all)
    chk_select_all.pack(side="right", padx=12, pady=8)

    # Scrollable Workspace Canvas
    canvas_frame = tk.Frame(ws_panel, bg=BG_CARD)
    canvas_frame.pack(fill="both", expand=True, padx=8, pady=8)

    canvas = tk.Canvas(canvas_frame, bg=BG_CARD, highlightthickness=0)
    scrollbar = tk.Scrollbar(canvas_frame, orient="vertical", command=canvas.yview)
    scroll_content = tk.Frame(canvas, bg=BG_CARD)

    scroll_content.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
    canvas.create_window((0, 0), window=scroll_content, anchor="nw")
    canvas.configure(yscrollcommand=scrollbar.set)

    canvas.pack(side="left", fill="both", expand=True)
    scrollbar.pack(side="right", fill="y")

    # Options Row
    opts_frame = tk.Frame(main_frame, bg=BG_CARD, bd=0, highlightbackground=BORDER_COLOR, highlightthickness=1)
    opts_frame.pack(fill="x", pady=(0, 14), padx=2, ipady=6)

    tk.Label(opts_frame, text="Format:", font=("Segoe UI", 9, "bold"), fg=TEXT_MUTED, bg=BG_CARD).pack(side="left", padx=(14, 4))
    fmt_var = tk.StringVar(value="mp3")
    fmt_menu = ttk.Combobox(opts_frame, textvariable=fmt_var, values=["mp3", "wav"], width=8, state="readonly")
    fmt_menu.pack(side="left", padx=4)

    lyrics_var = tk.BooleanVar(value=True)
    chk_lyrics = tk.Checkbutton(opts_frame, text="Save Lyrics (.lrc)", variable=lyrics_var, font=("Segoe UI", 9), fg="#ffffff", bg=BG_CARD, selectcolor="#080a10", activebackground=BG_CARD, activeforeground="#ffffff")
    chk_lyrics.pack(side="left", padx=16)

    folder_var = tk.BooleanVar(value=True)
    chk_folder = tk.Checkbutton(opts_frame, text="Folder per Workspace", variable=folder_var, font=("Segoe UI", 9), fg="#ffffff", bg=BG_CARD, selectcolor="#080a10", activebackground=BG_CARD, activeforeground="#ffffff")
    chk_folder.pack(side="left", padx=8)

    # Threads
    tk.Label(opts_frame, text="Threads:", font=("Segoe UI", 9, "bold"), fg=TEXT_MUTED, bg=BG_CARD).pack(side="left", padx=(16, 4))
    thread_var = tk.IntVar(value=5)
    spin_threads = tk.Spinbox(opts_frame, from_=1, to=12, width=4, textvariable=thread_var, bg="#080a10", fg="#ffffff", buttonbackground=BG_CARD_LIGHT)
    spin_threads.pack(side="left", padx=4)

    # Progress & Status Box
    prog_frame = tk.Frame(main_frame, bg=BG_CARD, bd=0, highlightbackground=BORDER_COLOR, highlightthickness=1)
    prog_frame.pack(fill="x", pady=(0, 14), padx=2, ipady=8)

    lbl_status = tk.Label(prog_frame, text="Ready to scan and download.", font=("Segoe UI", 9), fg="#ffffff", bg=BG_CARD, anchor="w")
    lbl_status.pack(fill="x", padx=14, pady=(2, 4))

    prog_bar = ttk.Progressbar(prog_frame, orient="horizontal", mode="determinate")
    prog_bar.pack(fill="x", padx=14, pady=4)

    lbl_stats_detail = tk.Label(prog_frame, text="0 / 0 songs", font=("Segoe UI", 8), fg=TEXT_MUTED, bg=BG_CARD, anchor="w")
    lbl_stats_detail.pack(fill="x", padx=14)

    # Action Buttons
    action_frame = tk.Frame(main_frame, bg=BG_DARK)
    action_frame.pack(fill="x", padx=2)

    lbl_selected_summary = tk.Label(action_frame, text="0 workspaces selected", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_DARK)
    lbl_selected_summary.pack(side="left", pady=4)

    btn_download = tk.Button(action_frame, text="🚀 DOWNLOAD ALL SELECTED WORKSPACES", font=("Segoe UI", 11, "bold"), bg=ACCENT_EMERALD, fg="#ffffff", activebackground="#059669", activeforeground="#ffffff", relief="flat", padx=20, pady=8)
    btn_download.pack(side="right")

    btn_open = tk.Button(action_frame, text="📂 Open Folder", font=("Segoe UI", 10), bg=BG_CARD_LIGHT, fg="#ffffff", relief="flat", padx=12, pady=7, command=lambda: os.startfile(dest_var.get()) if os.name == 'nt' else None)
    btn_open.pack(side="right", padx=10)

    def update_selected_count_label():
        selected_count = sum(1 for v in ws_vars.values() if v.get())
        total_songs = sum(ws.get("song_count", 0) for ws in workspaces_data if ws_vars.get(ws["id"], tk.BooleanVar()).get())
        lbl_selected_summary.config(text=f"{selected_count} of {len(workspaces_data)} workspaces selected ({total_songs} total songs)")
        btn_download.config(text=f"🚀 DOWNLOAD {total_songs} SONGS")

    def populate_workspaces():
        nonlocal workspaces_data, ws_vars
        lbl_status.config(text="Connecting to Mureka and querying workspaces...")
        root.update()

        # Check profile
        prof = api.get_profile()
        if prof.get("code") in (0, 200) and prof.get("data"):
            data = prof["data"]
            u = data.get("user") or data
            username = u.get("stage_name") or u.get("username") or u.get("email", "Artist")
            tier = u.get("vip_name") or ("VIP" if u.get("is_vip") else "Free")
            credits = data.get("credits") or u.get("credits", 0)
            lbl_user.config(text=f"User: {username} | Tier: {str(tier).upper()} | Gold: {credits}")
        elif api.access_token or api.cookie_string:
            lbl_user.config(text="Session Active (Connected)")
        else:
            lbl_user.config(text="⚠️ Session Missing! Paste cookies or sync from Extension.")

        ws_list = api.get_workspaces()
        if not ws_list:
            ws_list = [{"id": 0, "name": "My workspace", "type": 3, "song_count": 0}]

        workspaces_data = ws_list
        for widget in scroll_content.winfo_children():
            widget.destroy()

        ws_vars = {}
        for idx, ws in enumerate(workspaces_data):
            v = tk.BooleanVar(value=True)
            ws_vars[ws["id"]] = v

            row = tk.Frame(scroll_content, bg=BG_CARD, highlightbackground=BORDER_COLOR, highlightthickness=1)
            row.pack(fill="x", expand=True, pady=3, padx=4)

            chk = tk.Checkbutton(row, text=f"📁  {ws.get('name', 'Workspace')}", variable=v, font=("Segoe UI", 10, "bold"), fg="#ffffff", bg=BG_CARD, selectcolor="#080a10", activebackground=BG_CARD, activeforeground="#ffffff", command=update_selected_count_label)
            chk.pack(side="left", padx=10, pady=6)

            cnt_lbl = tk.Label(row, text=f"{ws.get('song_count', 0)} songs", font=("Segoe UI", 9, "bold"), fg=ACCENT_EMERALD, bg=BG_CARD_LIGHT, padx=8, pady=2)
            cnt_lbl.pack(side="right", padx=10, pady=6)

        update_selected_count_label()
        lbl_status.config(text=f"Loaded {len(workspaces_data)} workspaces successfully.")

    def start_download():
        nonlocal is_downloading, cancel_download
        if is_downloading:
            return

        selected_ws = [ws for ws in workspaces_data if ws_vars.get(ws["id"], tk.BooleanVar()).get()]
        if not selected_ws:
            messagebox.showwarning("No Selection", "Please select at least one workspace to download.")
            return

        is_downloading = True
        cancel_download = False
        btn_download.config(state="disabled")

        def worker():
            out_base = Path(dest_var.get())
            out_base.mkdir(parents=True, exist_ok=True)
            selected_fmt = fmt_var.get()
            do_sort = folder_var.get()
            do_lyrics = lyrics_var.get()
            workers = thread_var.get()

            all_songs = []
            for idx, ws in enumerate(selected_ws):
                lbl_status.config(text=f"Scanning workspace [{ws.get('name')}] ({idx + 1}/{len(selected_ws)})...")
                songs = api.get_workspace_songs(ws["id"])
                for s in songs:
                    s["workspace_name"] = ws.get("name", "My workspace")
                    all_songs.append(s)

            total_songs = len(all_songs)
            if total_songs == 0:
                lbl_status.config(text="No songs found to download.")
                btn_download.config(state="normal")
                return

            lbl_status.config(text=f"Starting download of {total_songs} songs across {len(selected_ws)} workspaces...")
            prog_bar["maximum"] = total_songs
            prog_bar["value"] = 0

            completed = 0
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {
                    executor.submit(download_song_worker, api, s, out_base, selected_fmt, do_sort, do_lyrics, False): s
                    for s in all_songs
                }

                for fut in as_completed(futures):
                    s_item = futures[fut]
                    completed += 1
                    pct = round((completed / total_songs) * 100, 1)
                    title = s_item.get("title", "Song")

                    root.after(0, lambda c=completed, t=total_songs, tit=title, p=pct: (
                        prog_bar.configure(value=c),
                        lbl_stats_detail.configure(text=f"{c} / {t} songs ({p}%)"),
                        lbl_status.configure(text=f"Downloaded: {tit}")
                    ))

            lbl_status.config(text=f"🎉 All {completed} songs downloaded successfully to {out_base}!")
            btn_download.config(state="normal")
            messagebox.showinfo("Download Complete", f"Successfully downloaded {completed} songs from {len(selected_ws)} workspaces!\n\nSaved to:\n{out_base}")

        threading.Thread(target=worker, daemon=True).start()

    btn_download.config(command=start_download)

    # Initial load in background thread
    threading.Thread(target=populate_workspaces, daemon=True).start()

    root.mainloop()

# =====================================================================
# CLI Application
# =====================================================================
def run_cli():
    parser = argparse.ArgumentParser(description="Mureka All-Workspaces Song Downloader CLI")
    parser.add_argument("--all", action="store_true", help="Download songs from ALL workspaces")
    parser.add_argument("--workspace", type=str, help="Specific workspace name or ID to download")
    parser.add_argument("--format", choices=["mp3", "wav"], default="mp3", help="Audio format (mp3 or wav)")
    parser.add_argument("--output", type=str, default=str(DEFAULT_DOWNLOAD_DIR), help="Output folder")
    parser.add_argument("--threads", type=int, default=5, help="Number of download threads")
    parser.add_argument("--no-lyrics", action="store_true", help="Skip lyrics download")
    parser.add_argument("--cookies", type=str, default="", help="Cookie string (or auto-detected from session file)")

    args = parser.parse_args()

    cookie_str = args.cookies
    token_str = ""
    if not cookie_str:
        cookie_str, token_str = find_saved_session()
    if not cookie_str and not token_str:
        print("[Error] No Mureka session cookies or access token found.")
        print("Please export session from the Chrome Extension or pass --cookies '...'")
        sys.exit(1)

    api = MurekaAPIClient(cookie_string=cookie_str, access_token=token_str)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 65)
    print(" 🎵 MUREKA ALL-WORKSPACES SONG DOWNLOADER (CLI)")
    print(f" Output Directory: {out_dir}")
    print(f" Format: {args.format.upper()} | Threads: {args.threads}")
    print("=" * 65)

    workspaces = api.get_workspaces()
    if not workspaces:
        print("[Warning] No workspaces returned. Querying default workspace...")
        workspaces = [{"id": 0, "name": "My workspace", "song_count": 0}]

    target_ws = []
    if args.all:
        target_ws = workspaces
    elif args.workspace:
        target_ws = [ws for ws in workspaces if args.workspace.lower() in ws.get("name", "").lower() or str(ws.get("id")) == args.workspace]
        if not target_ws:
            print(f"[Error] Workspace matching '{args.workspace}' not found.")
            sys.exit(1)
    else:
        print("\nAvailable Workspaces:")
        for idx, ws in enumerate(workspaces):
            print(f" [{idx + 1}] {ws.get('name')} ({ws.get('song_count', 0)} songs)")
        choice = input("\nEnter workspace number (or 'all'): ").strip()
        if choice.lower() == "all":
            target_ws = workspaces
        else:
            try:
                target_ws = [workspaces[int(choice) - 1]]
            except Exception:
                print("Invalid choice.")
                sys.exit(1)

    all_songs = []
    for ws in target_ws:
        print(f"\nScanning workspace: {ws.get('name')}...")
        songs = api.get_workspace_songs(ws["id"])
        print(f"  -> Found {len(songs)} songs.")
        for s in songs:
            s["workspace_name"] = ws.get("name", "My workspace")
            all_songs.append(s)

    total = len(all_songs)
    print(f"\nTotal downloadable songs: {total}")
    if total == 0:
        return

    completed = 0
    start_time = time.time()
    with ThreadPoolExecutor(max_workers=args.threads) as executor:
        futures = {
            executor.submit(download_song_worker, api, s, out_dir, args.format, True, not args.no_lyrics, False): s
            for s in all_songs
        }

        for fut in as_completed(futures):
            item = futures[fut]
            completed += 1
            pct = (completed / total) * 100
            title = item.get("title", "Song")
            ws_n = item.get("workspace_name", "")
            print(f" [{completed}/{total} - {pct:.1f}%] Saved: [{ws_n}] {title}")

    elapsed = time.time() - start_time
    print("\n" + "=" * 65)
    print(f" [SUCCESS] Downloaded {completed}/{total} songs in {elapsed:.1f}s.")
    print(f" Files saved to: {out_dir}")
    print("=" * 65)

if __name__ == "__main__":
    if len(sys.argv) > 1 and ("--all" in sys.argv or "--workspace" in sys.argv or "--help" in sys.argv):
        run_cli()
    else:
        run_gui()
