# 🎵 Mureka Song Downloader - All Workspaces (Extension + Python Tool)

> **Mureka.ai k kisi bhi account k sabhi Workspaces k songs ko 1-click me batch download krne ka ultimate system.**
> 
> Works directly inside **Google Chrome (Extension)** as well as standalone on **Desktop (Python GUI & CLI)** with automatic workspace folder sorting, MP3/Lossless WAV selection, synchronized lyrics (`.lrc`), and ZIP export.

---

## 🌟 Key Highlights & Features (खासियत)

1. **⚡ Download All Workspaces Simultaneously**:
   - Aapke Mureka account me jitne bhi workspaces hain (jaise *Morning Serenity*, *Golden Hour*, *Peaceful Chill 4*, *My workspace*, etc.), ye un sabhi workspaces ko detect karta hai aur ek saath saare songs download kar sakta hai.

2. **📁 Automatic Workspace Folder Sorting**:
   - Downloads automatically organize ho jaate hain har workspace ke alag folder me:
     ```
     Downloads/Mureka/
     ├── Morning Serenity/
     │   ├── 19. Stand by Me Remix.mp3
     │   ├── 19. Stand by Me Remix.lrc
     │   └── 18. Watch the Sun Rise.mp3
     ├── Golden Hour/
     │   ├── 17. Before You Go.mp3
     │   └── 16. Best Part.mp3
     └── Peaceful Chill 4/
         └── ...
     ```

3. **🎵 Dual Quality Support**:
   - **MP3 (320kbps High Quality)**: Fast, universal, and ready for streaming.
   - **WAV (16-bit Lossless Studio Master)**: Perfect for music production & remixing (requires Pro/Premier tier).

4. **🎯 Two Complete Ways to Use (Extension OR Python)**:
   - **Method A (Chrome Extension)**:
     - 100% in-browser, no Python required!
     - Mureka website par direct floating `[🎵 Download Songs]` button deta hai.
     - Extension Popup, Dedicated Full Tab Studio, ya Chrome Side Panel me chala sakte hain.
     - In-browser ZIP archive export built-in.
   - **Method B (Python Standalone Tool & GUI)**:
     - High-speed multi-threaded desktop application (`mureka_downloader.py` / `start_downloader.bat`).
     - Modern Dark Studio GUI matching Mureka's theme.
     - CLI command support for power users.

---

## 🚀 1. How to Install the Chrome Extension

1. Open **Google Chrome**.
2. Address bar me type karein: `chrome://extensions/` aur **Enter** dabayein.
3. Top-right corner me **Developer mode** toggle ko **ON** karein.
4. Top-left corner me **Load unpacked** button par click karein.
5. Ye folder select karein:
   ```
   c:\Users\admin\Desktop\tools\Mureka song Downloader Extension
   ```
6. **Done!** **Mureka Song Downloader** Chrome toolbar me pin ho jayega.

---

## 💡 2. How to Use via Chrome Extension (Mureka Website Par)

### Option 1: In-Page Floating Studio Button (Direct on Mureka.ai)
1. Chrome me open karein: [https://www.mureka.ai/create](https://www.mureka.ai/create).
2. Screen ke bottom-right corner me aapko vibrant floating button dikhega:
   **`[🎵 Download Songs - All]`**.
3. Us par click karein:
   - Aapke account ke sabhi **11+ workspaces** live song count ke saath display honge.
   - **"Select All"** check karein (ya jinko download karna hai unhe select karein).
   - Audio format select karein: `MP3` ya `WAV`.
   - **`🚀 Start Download`** click karein!
   - Sabhi songs aapke computer ke `Downloads/Mureka/<Workspace Name>/` folder me download hone lagenge.

### Option 2: Extension Popup / Full Studio Tab
1. Chrome toolbar me Mureka Extension icon par click karein.
2. Chahein to top-right se **`Full Tab`** ya **`Side Panel`** me open kar sakte hain.
3. Saare workspaces aur live progress bars aapke samne honge.
4. **`📦 Export ZIP`** se pure workspaces ko ek single zip archive me bhi download kar sakte hain.

---

## 🐍 3. How to Use via Python Tool (Standalone Desktop GUI & CLI)

Agar aap Python ke zariye high-speed background downloads chahte hain:

### GUI Mode (Desktop App)
1. Is folder me jayein:
   `c:\Users\admin\Desktop\tools\Mureka song Downloader Extension`
2. Simply double-click karein:
   **`start_downloader.bat`**
3. Ek sleek Dark Studio Window open hogi:
   - Saare workspaces detect honge.
   - Aap save location change kar sakte hain (Browse button se).
   - Number of download threads (1 se 10 parallel threads) adjust kar sakte hain.
   - Click karein **`🚀 DOWNLOAD ALL SELECTED WORKSPACES`**.

### CLI Mode (Command Line)
Terminal ya CMD me:
```bash
# Sabhi workspaces k saare songs download karein
python mureka_downloader.py --all

# Sirf ek specific workspace download karein
python mureka_downloader.py --workspace "Morning Serenity" --format mp3

# Lossless WAV format me custom path par download karein
python mureka_downloader.py --all --format wav --output "D:/My_Mureka_Library" --threads 8
```

---

## ⚡ 4. Local Companion Bridge (Optional Hardware Accelerator)

Extension ke andar ek option hai **"⚡ Python Bridge"**:
- Agar aap chahein ki Chrome downloads ke bajaye local Python bridge high-speed downloads handle kare, to double-click karein:
  **`start_bridge.bat`**
- Bridge `http://127.0.0.1:59966` par run hone lagega.
- Extension se 1-click me batch transfer ho jayega aur local files `Desktop/Mureka_Songs/` me save ho jayengi.

---

---

## ⚡ 4. 1-Click Over-The-Air (OTA) Updates (बिना Reinstall किए Update)

**Extension ko bar-bar remove aur reinstall karne ki koi zarurat nahi hai!**

Jab bhi GitHub repository par koi naya update, bug fix ya feature aayega:
1. Extension ke top header me **⚡ OTA Update** button par green glowing dot show hoga.
2. Click karein **OTA Update** par.
3. Click karein **🚀 Update Now (Auto-Reload)**.
4. Companion Bridge GitHub se latest code download karke in-place replace kar dega aur extension Chrome me **apne aap reload** ho jayegi!
5. **Desktop shortcut**: Aap folder me maujood `update.bat` ko double-click karke bhi 2 second me full codebase update kar sakte hain.

---

## 🚀 5. Automated GitHub Release Pipeline (Developers ke liye)

Naya version release aur deploy karne ke liye bas ek command chalaayein:
```bash
python release.py 1.0.1 "Added faster download worker and bug fixes"
```
Ye script automatically:
1. `manifest.json` aur `version.json` me version bump karega.
2. Clean ZIP package compile karega `dist/mureka-extension-v1.0.1.zip`.
3. Codebase ko GitHub `main` branch par commit aur push karega.
4. GitHub par **Release Tag** banakar ZIP asset upload karega.
5. Sabhi active extension users ko bina reinstall kiye **OTA Update** available ho jayega!

---

## 📁 File Structure

```
Mureka song Downloader Extension/
├── manifest.json            # Chrome Extension Manifest V3 configuration
├── background.js           # Background service worker (Cookies, Downloads & OTA reload)
├── content.js              # In-page floating studio injected into mureka.ai
├── popup.html              # Modern Dark Studio GUI with OTA Update Modal
├── popup.js                # Frontend controller & OTA update client
├── version.json            # Version descriptor & OTA tracking manifest
├── ota_updater.py          # Standalone & bridge-integrated OTA patch engine
├── update.bat              # 1-click desktop batch updater
├── release.py              # Automated 1-click GitHub Release & push pipeline
├── bridge.py               # Local companion HTTP bridge server with OTA endpoints
├── start_bridge.bat        # 1-click launcher for Companion Bridge (auto-restarts on OTA)
├── mureka_downloader.py    # Full Python Desktop GUI & CLI batch tool
├── start_downloader.bat    # 1-click launcher for Python Desktop App
├── css/
│   ├── style.css           # Studio Dark theme styling & OTA modal styles
│   └── content.css         # In-page floating modal styles
├── lib/
│   ├── jszip.min.js        # High-performance client-side ZIP packaging
│   ├── lame.min.js         # MP3 encoding utilities
│   └── wav-encoder.js      # Lossless WAV generator
├── icons/                  # High-res extension icons (16, 32, 48, 128px)
└── README.md               # Complete Documentation & Usage Guide
```

---

## ❓ Frequently Asked Questions (FAQ)

- **Q: Kya mujhe extension update karne ke liye bar-bar remove aur load karna padega?**  
  *Bilkul nahi!* Built-in OTA updater se bas 1-click karein, sare changes disk par apply hokar extension Chrome me bina remove kiye live reload ho jayegi.

- **Q: Kya mera login session update karne par delete hoga?**  
  *Nahi!* `mureka_session.json` aur login cookies OTA updates ke dauran protected rehte hain aur kabhi overwrite nahi hote.

- **Q: Kya mere sabhi 11 workspaces ke 400+ songs ek saath download honge?**  
  *Haan!* "Select All" checked rakh kar download par click karein, system har workspace ke andar jaakar saare songs extract karke organize karega.

