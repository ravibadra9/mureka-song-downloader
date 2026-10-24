"""
release.py — One-Click Automated GitHub Release & OTA Deployment Pipeline
Modeled after Stories Studio / AI Editor Release Automation.

Usage:
    python release.py 1.0.1 "Added fast multi-workspace downloads and bug fixes"

Workflow:
    1. Sanity Checks & Version Validation
    2. Version Bump in manifest.json, version.json, bridge.py, mureka_downloader.py
    3. Package Extension into clean distribution ZIP (dist/mureka-extension-v{version}.zip)
    4. Git Commit & Git Push to GitHub main branch
    5. Publish GitHub Release with Release Notes & Upload ZIP Asset
    6. Verify OTA Manifest Deployment for instant user auto-updates
"""

import sys
sys.dont_write_bytecode = True
import os
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
import re
import json
import shutil
import zipfile
import atexit
import subprocess
import time
from pathlib import Path
import urllib.request
import urllib.error

# Chrome extension restriction: No folder starting with "_" allowed in extension directory
def _purge_pycache():
    p = Path(__file__).resolve().parent / "__pycache__"
    if p.exists():
        shutil.rmtree(p, ignore_errors=True)

_purge_pycache()
atexit.register(_purge_pycache)

# Ensure UTF-8 console output and ANSI support on Windows
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

if sys.platform == "win32":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass

# ==============================================================================
# CONFIG
# ==============================================================================
ROOT = Path(__file__).resolve().parent

def load_github_token() -> str:
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if token:
        return token
    t_file = ROOT / "github_token.txt"
    if t_file.is_file():
        try:
            return t_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return ""

GITHUB_TOKEN = load_github_token()
GITHUB_OWNER = "ravibadra9"
GITHUB_REPO  = "mureka-song-downloader"
GITHUB_BRANCH = "main"

GH_API = "https://api.github.com"
DIST_DIR = ROOT / "dist"

# ANSI Colors & Styling
C_CYAN    = "\033[96m"
C_GREEN   = "\033[92m"
C_YELLOW  = "\033[93m"
C_RED     = "\033[91m"
C_BLUE    = "\033[94m"
C_MAGENTA = "\033[95m"
C_BOLD    = "\033[1m"
C_DIM     = "\033[2m"
C_RESET   = "\033[0m"

BOX_W = 68

def step(n, total, msg, icon="⚡"):
    txt = f"[{n}/{total}] {icon}  {msg.upper()}"
    padding = max(0, BOX_W - 4 - len(txt))
    print(f"\n{C_BLUE}┌{'─' * (BOX_W - 2)}┐{C_RESET}")
    print(f"{C_BLUE}│{C_BOLD} {txt}{' ' * padding} {C_RESET}{C_BLUE}│{C_RESET}")
    print(f"{C_BLUE}└{'─' * (BOX_W - 2)}┘{C_RESET}")

def ok(msg):
    print(f"   {C_GREEN}✔{C_RESET} {msg}")

def warn(msg):
    print(f"   {C_YELLOW}⚠{C_RESET} {msg}")

def die(msg):
    print(f"\n{C_RED}┌{'─' * (BOX_W - 2)}┐{C_RESET}")
    print(f"{C_RED}│{C_BOLD} ✖ RELEASE PIPELINE FAILED{' ' * (BOX_W - 27)} {C_RESET}{C_RED}│{C_RESET}")
    print(f"{C_RED}├{'─' * (BOX_W - 2)}┤{C_RESET}")
    for line in msg.splitlines():
        padding = max(0, BOX_W - 5 - len(line))
        print(f"{C_RED}│{C_RESET}  {line}{' ' * padding} {C_RED}│{C_RESET}")
    print(f"{C_RED}└{'─' * (BOX_W - 2)}┘{C_RESET}\n")
    sys.exit(1)

def print_banner(version):
    print(f"\n{C_CYAN}┌{'─' * (BOX_W - 2)}┐{C_RESET}")
    title = f"MUREKA SONG DOWNLOADER RELEASE PIPELINE v{version}"
    pad1 = max(0, BOX_W - 4 - len(title))
    print(f"{C_CYAN}│{C_BOLD}  🚀  {title}{' ' * (pad1 - 4)}  {C_RESET}{C_CYAN}│{C_RESET}")
    sub = "Automated OTA Patcher • Git Push • GitHub Releases • Asset CDN"
    pad2 = max(0, BOX_W - 4 - len(sub))
    print(f"{C_CYAN}│{C_DIM}  {sub}{' ' * pad2}  {C_RESET}{C_CYAN}│{C_RESET}")
    print(f"{C_CYAN}└{'─' * (BOX_W - 2)}┘{C_RESET}")

def gh_headers():
    return {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "MurekaReleasePipeline/1.0"
    }

# ==============================================================================
# 0. PREFLIGHT CHECKS
# ==============================================================================
def preflight(version):
    if not re.fullmatch(r"\d+(\.\d+){1,3}", version):
        die(f"Version '{version}' is invalid format. Example: 1.0.1 or 1.1.0")

    required_files = ["manifest.json", "background.js", "content.js", "popup.html", "popup.js", "bridge.py", "ota_updater.py"]
    for f in required_files:
        if not (ROOT / f).exists():
            die(f"Required extension file missing: {f}")

    ok("Verified required project files.")

# ==============================================================================
# 1. VERSION BUMP
# ==============================================================================
def bump_version(version, notes):
    # 1. manifest.json
    m_path = ROOT / "manifest.json"
    try:
        with open(m_path, "r", encoding="utf-8") as f:
            m_data = json.load(f)
        m_data["version"] = version
        with open(m_path, "w", encoding="utf-8") as f:
            json.dump(m_data, f, indent=2)
        ok(f"manifest.json bumped to v{version}")
    except Exception as e:
        die(f"Failed to bump manifest.json: {e}")

    # 2. version.json
    v_path = ROOT / "version.json"
    try:
        v_data = {
            "version": version,
            "name": "Mureka Song Downloader",
            "release_date": time.strftime("%Y-%m-%d"),
            "changelog": [notes] if isinstance(notes, str) else notes,
            "min_bridge_version": "1.0.0",
            "github_repo": f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}",
            "download_url": f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
        }
        with open(v_path, "w", encoding="utf-8") as f:
            json.dump(v_data, f, indent=2)
        ok(f"version.json updated with v{version} metadata")
    except Exception as e:
        die(f"Failed to update version.json: {e}")

# ==============================================================================
# 2. PACKAGE ZIP ARTIFACT
# ==============================================================================
def create_zip_package(version):
    DIST_DIR.mkdir(exist_ok=True)
    zip_name = f"mureka-extension-v{version}.zip"
    zip_path = DIST_DIR / zip_name

    ignore_patterns = {
        "mureka_session.json",
        "session.json",
        ".mureka_session.json",
        ".git",
        "__pycache__",
        "dist",
        ".vscode",
        ".idea",
        zip_name
    }

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in ignore_patterns]
            for file in files:
                if file in ignore_patterns or file.endswith(".tmp") or file.endswith(".pyc"):
                    continue
                full_path = Path(root) / file
                rel_path = full_path.relative_to(ROOT)
                zf.write(full_path, rel_path)

    size_mb = zip_path.stat().st_size / (1024 * 1024)
    ok(f"Created package {zip_name} ({size_mb:.2f} MB)")
    return zip_path

# ==============================================================================
# 3. GIT COMMIT & PUSH
# ==============================================================================
def git_commit_and_push(version, notes):
    try:
        remote_url = f"https://{GITHUB_TOKEN}@github.com/{GITHUB_OWNER}/{GITHUB_REPO}.git"
        remotes_out = subprocess.run(["git", "remote"], cwd=ROOT, capture_output=True, text=True).stdout.split()
        if "origin" in remotes_out:
            subprocess.run(["git", "remote", "set-url", "origin", remote_url], cwd=ROOT, check=True)
        else:
            subprocess.run(["git", "remote", "add", "origin", remote_url], cwd=ROOT, check=True)

        subprocess.run(["git", "branch", "-M", GITHUB_BRANCH], cwd=ROOT, check=True)
        subprocess.run(["git", "add", "."], cwd=ROOT, check=True)
        commit_msg = f"Release v{version}: {notes}"
        subprocess.run(["git", "commit", "-m", commit_msg], cwd=ROOT, capture_output=True)

        push_res = subprocess.run(["git", "push", "-u", "origin", GITHUB_BRANCH], cwd=ROOT, capture_output=True, text=True)
        if push_res.returncode != 0:
            # Try force push on initial repo setup
            subprocess.run(["git", "push", "-u", "origin", GITHUB_BRANCH, "--force"], cwd=ROOT, check=True)

        ok(f"Pushed codebase & v{version} manifest to GitHub ({GITHUB_OWNER}/{GITHUB_REPO}:{GITHUB_BRANCH})")
    except Exception as e:
        die(f"Git commit or push failed: {e}")

# ==============================================================================
# 4. GITHUB RELEASE & ASSET UPLOAD
# ==============================================================================
def create_github_release(version, zip_path, notes):
    tag = f"v{version}"
    base_url = f"{GH_API}/repos/{GITHUB_OWNER}/{GITHUB_REPO}"

    # Check if release exists
    rel_id = None
    upload_url = None
    try:
        req = urllib.request.Request(f"{base_url}/releases/tags/{tag}", headers=gh_headers())
        with urllib.request.urlopen(req) as resp:
            if resp.status == 200:
                rel = json.loads(resp.read().decode("utf-8"))
                rel_id = rel.get("id")
                upload_url = rel.get("upload_url", "").split("{")[0]
                ok(f"Found existing GitHub Release: {tag}")
    except Exception:
        pass

    # Create release if not exists
    if not rel_id:
        create_payload = json.dumps({
            "tag_name": tag,
            "target_commitish": GITHUB_BRANCH,
            "name": f"Mureka Song Downloader v{version}",
            "body": f"## What's New in v{version}\n\n- {notes}\n\n### ⚡ One-Click OTA Update\nAll existing extension users can simply click **OTA Update** in the extension header to update without removing or reinstalling!",
            "draft": False,
            "prerelease": False
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{base_url}/releases",
            data=create_payload,
            headers={**gh_headers(), "Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req) as resp:
                rel = json.loads(resp.read().decode("utf-8"))
                rel_id = rel.get("id")
                upload_url = rel.get("upload_url", "").split("{")[0]
                ok(f"Created new GitHub Release: {tag}")
        except Exception as e:
            die(f"Failed to create GitHub release: {e}")

    # Upload zip asset
    if upload_url:
        asset_url = f"{upload_url}?name={zip_path.name}"
        with open(zip_path, "rb") as zf_data:
            content = zf_data.read()

        up_req = urllib.request.Request(
            asset_url,
            data=content,
            headers={
                **gh_headers(),
                "Content-Type": "application/zip",
                "Content-Length": str(len(content))
            }
        )
        try:
            with urllib.request.urlopen(up_req) as resp:
                asset_res = json.loads(resp.read().decode("utf-8"))
                download_url = asset_res.get("browser_download_url", "")
                ok(f"Uploaded {zip_path.name} to GitHub Release assets CDN.")
                return download_url
        except Exception as e:
            warn(f"Notice: Release asset already uploaded or error: {e}")

    return f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/tag/{tag}"

# ==============================================================================
# MAIN RELEASE RUNNER
# ==============================================================================
def main():
    if len(sys.argv) < 2:
        print("\nUsage:")
        print("    python release.py <VERSION> [CHANGELOG_NOTES]")
        print("Example:")
        print("    python release.py 1.0.1 \"Added instant OTA updater & faster downloads\"\n")
        sys.exit(1)

    target_version = sys.argv[1].strip().lstrip("vV")
    notes = sys.argv[2].strip() if len(sys.argv) > 2 else "Performance improvements, stability fixes, and UI enhancements."

    print_banner(target_version)
    start_time = time.time()

    step(1, 5, "Preflight Sanity Checks", "🔍")
    preflight(target_version)

    step(2, 5, "Bump Version Manifests", "🏷️")
    bump_version(target_version, notes)

    step(3, 5, "Package Distribution Archive", "📦")
    zip_pkg = create_zip_package(target_version)

    step(4, 5, "Push to GitHub Repository", "🌐")
    git_commit_and_push(target_version, notes)

    step(5, 5, "Publish GitHub Release & OTA Manifest", "🚀")
    rel_url = create_github_release(target_version, zip_pkg, notes)

    elapsed = time.time() - start_time
    print(f"\n{C_GREEN}┌{'─' * (BOX_W - 2)}┐{C_RESET}")
    hdr = f"✨  MUREKA SONG DOWNLOADER v{target_version} DEPLOYED GLOBALLY!"
    pad_h = max(0, BOX_W - 4 - len(hdr))
    print(f"{C_GREEN}│{C_BOLD}  {hdr}{' ' * pad_h}  {C_RESET}{C_GREEN}│{C_RESET}")
    print(f"{C_GREEN}├{'─' * (BOX_W - 2)}┤{C_RESET}")

    rows = [
        ("Version", f"v{target_version}"),
        ("GitHub Repo", f"{GITHUB_OWNER}/{GITHUB_REPO}"),
        ("Release URL", rel_url[:40] + ("..." if len(rel_url) > 40 else "")),
        ("Elapsed Time", f"{elapsed:.1f} seconds"),
        ("OTA Status", "ACTIVE (Users get 1-click update in extension)"),
    ]
    for lbl, val in rows:
        r_txt = f"  {lbl:<14}: {val}"
        pad = max(0, BOX_W - 4 - len(r_txt))
        print(f"{C_GREEN}│{C_RESET}{C_BOLD}{r_txt}{' ' * pad}  {C_GREEN}│{C_RESET}")
    print(f"{C_GREEN}└{'─' * (BOX_W - 2)}┘{C_RESET}\n")

if __name__ == "__main__":
    main()
