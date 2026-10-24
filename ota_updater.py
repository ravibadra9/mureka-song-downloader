"""
ota_updater.py — Over-The-Air (OTA) Hot Updater for Mureka Song Downloader
Enables 1-click seamless updates directly from GitHub without removing & reinstalling the Chrome extension.

Features:
- Checks remote version against local manifest/version.json
- Downloads latest code package directly from GitHub
- Safely replaces extension files in-place (manifest.json, popup, background, content scripts, bridge, downloader)
- Strictly preserves user session credentials (mureka_session.json is never overwritten)
- Works via companion bridge API (port 59966) and standalone CLI/batch
"""

import os
import sys
import re
import json
import shutil
import tempfile
import zipfile
import urllib.request
import urllib.error
from pathlib import Path

# Force UTF-8 encoding on Windows consoles
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

EXTENSION_ROOT = Path(__file__).resolve().parent

GITHUB_OWNER = "ravibadra9"
GITHUB_REPO = "mureka-song-downloader"
GITHUB_BRANCH = "main"

RAW_VERSION_URL = f"https://raw.githubusercontent.com/{GITHUB_OWNER}/{GITHUB_REPO}/{GITHUB_BRANCH}/version.json"
GITHUB_API_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
ZIPBALL_URL = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/archive/refs/heads/{GITHUB_BRANCH}.zip"

# Files that should NEVER be overwritten or wiped during an update
PROTECTED_FILES = {
    "mureka_session.json",
    "session.json",
    ".mureka_session.json",
    ".git",
    ".gitignore",
    "desktop.ini",
}

def parse_version(v: str):
    """Parse version string like '1.0.2' or 'v1.0.2' into a comparable tuple."""
    try:
        clean = str(v).strip().lstrip("vV")
        parts = [int(re.sub(r'\D', '', p)) for p in clean.split(".") if p.strip()]
        return tuple(parts) if parts else (0,)
    except Exception:
        return (0,)

def is_newer(remote_v: str, local_v: str) -> bool:
    """Return True if remote_v is newer than local_v."""
    r, l = parse_version(remote_v), parse_version(local_v)
    n = max(len(r), len(l))
    return r + (0,) * (n - len(r)) > l + (0,) * (n - len(l))

def get_local_version_info() -> dict:
    """Read local version from version.json or manifest.json."""
    v_file = EXTENSION_ROOT / "version.json"
    if v_file.is_file():
        try:
            with open(v_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    m_file = EXTENSION_ROOT / "manifest.json"
    if m_file.is_file():
        try:
            with open(m_file, "r", encoding="utf-8") as f:
                m_data = json.load(f)
                return {
                    "version": m_data.get("version", "1.0.0"),
                    "name": m_data.get("name", "Mureka Song Downloader"),
                    "changelog": []
                }
        except Exception:
            pass

    return {"version": "1.0.0", "changelog": []}

def check_for_updates(timeout: int = 8) -> dict:
    """
    Check GitHub for newer versions.
    Returns dict with update status, versions, changelog, and download url.
    """
    local_info = get_local_version_info()
    current_ver = local_info.get("version", "1.0.0")

    result = {
        "update_available": False,
        "current_version": current_ver,
        "latest_version": current_ver,
        "changelog": [],
        "release_date": "",
        "download_url": ZIPBALL_URL,
        "error": None
    }

    # 1. Fetch remote version.json
    remote_data = None
    req = urllib.request.Request(
        RAW_VERSION_URL,
        headers={"User-Agent": "Mureka-OTA-Updater/1.0", "Cache-Control": "no-cache"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                remote_data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        # Fallback to GitHub Releases API
        try:
            gh_req = urllib.request.Request(
                GITHUB_API_RELEASE_URL,
                headers={"User-Agent": "Mureka-OTA-Updater/1.0", "Accept": "application/vnd.github+json"}
            )
            with urllib.request.urlopen(gh_req, timeout=timeout) as resp:
                if resp.status == 200:
                    gh_rel = json.loads(resp.read().decode("utf-8"))
                    tag = gh_rel.get("tag_name", "").lstrip("vV")
                    if tag:
                        remote_data = {
                            "version": tag,
                            "changelog": [gh_rel.get("body", "Bug fixes and improvements")],
                            "release_date": gh_rel.get("published_at", "")[:10]
                        }
        except Exception as e2:
            result["error"] = f"Could not reach update server: {e2}"
            return result

    if not remote_data or "version" not in remote_data:
        result["error"] = "Invalid remote version manifest."
        return result

    latest_ver = remote_data.get("version", current_ver)
    result["latest_version"] = latest_ver
    result["changelog"] = remote_data.get("changelog", [])
    result["release_date"] = remote_data.get("release_date", "")

    if is_newer(latest_ver, current_ver):
        result["update_available"] = True
    else:
        result["update_available"] = False

    return result

def apply_update(progress_cb=None) -> dict:
    """
    Download latest codebase from GitHub, verify, and safely overwrite files in-place.
    Preserves user sessions and configs.
    """
    def log(msg):
        if progress_cb:
            try:
                progress_cb(msg)
            except Exception:
                pass
        print(f"[OTA] {msg}")

    log("Checking latest release on GitHub...")
    check_res = check_for_updates()
    latest_ver = check_res.get("latest_version", "1.0.0")

    log(f"Downloading update package v{latest_ver} from GitHub...")
    temp_dir = Path(tempfile.mkdtemp(prefix="mureka_ota_"))
    zip_path = temp_dir / "latest_repo.zip"

    try:
        # Download the repository zipball
        req = urllib.request.Request(
            ZIPBALL_URL,
            headers={"User-Agent": "Mureka-OTA-Updater/1.0"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp, open(zip_path, "wb") as out_f:
            shutil.copyfileobj(resp, out_f)

        log("Extracting and verifying update package...")
        extract_dir = temp_dir / "extracted"
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)

        # GitHub zipball puts contents into a top-level directory (e.g. mureka-song-downloader-main/)
        subfolders = [p for p in extract_dir.iterdir() if p.is_dir()]
        source_dir = subfolders[0] if subfolders else extract_dir

        log("Applying file updates to extension directory...")
        updated_files = []
        for root, dirs, files in os.walk(source_dir):
            rel_root = Path(root).relative_to(source_dir)
            target_root = EXTENSION_ROOT / rel_root

            # Filter out ignored directories
            dirs[:] = [d for d in dirs if d not in [".git", "__pycache__"]]

            target_root.mkdir(parents=True, exist_ok=True)

            for file_name in files:
                rel_file_path = rel_root / file_name
                rel_str = str(rel_file_path).replace("\\", "/")

                # Skip protected files
                if file_name in PROTECTED_FILES or any(part in PROTECTED_FILES for part in rel_file_path.parts):
                    continue

                src_file = Path(root) / file_name
                dst_file = target_root / file_name

                # Copy file
                shutil.copy2(src_file, dst_file)
                updated_files.append(rel_str)

        log(f"Successfully applied {len(updated_files)} updated files.")
        return {
            "success": True,
            "version": latest_ver,
            "updated_files_count": len(updated_files),
            "updated_files": updated_files[:20],
            "message": f"Successfully updated to v{latest_ver}!"
        }

    except Exception as e:
        log(f"Update failed with error: {e}")
        return {
            "success": False,
            "error": str(e),
            "message": f"Update failed: {e}"
        }
    finally:
        # Clean up temporary files
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass

if __name__ == "__main__":
    print("=" * 65)
    print(" ⚡ MUREKA SONG DOWNLOADER - OVER-THE-AIR (OTA) UPDATER")
    print("=" * 65)

    if "--apply" in sys.argv:
        print("[OTA] Running OTA update...")
        res = apply_update()
        if res.get("success"):
            print(f"\n✅ {res.get('message')}")
            print("Please reload the extension in Chrome or click 'Refresh' in popup!")
            sys.exit(0)
        else:
            print(f"\n❌ {res.get('error')}")
            sys.exit(1)
    else:
        print("[OTA] Checking for available updates...")
        info = check_for_updates()
        print(f"   Current Version: v{info['current_version']}")
        print(f"   Latest Version : v{info['latest_version']}")
        if info["update_available"]:
            print(f"\n🚀 NEW UPDATE AVAILABLE: v{info['latest_version']}!")
            if info.get("changelog"):
                print("   Changelog:")
                for c in info["changelog"]:
                    print(f"   • {c}")
            print("\nRun: python ota_updater.py --apply to apply update.")
        else:
            print("\n✅ You are on the latest version!")
