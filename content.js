/**
 * Mureka Song Downloader - Content Script
 * Injected on https://www.mureka.ai/*
 * Provides an in-page floating studio, direct API extraction with Bearer token authentication,
 * and handles messages from the extension popup/sidebar.
 */

(function () {
  'use strict';

  let isModalOpen = false;
  let workspaces = [];
  let selectedWorkspaceIds = new Set();
  let isDownloading = false;
  let cancelRequested = false;

  // Extract Access Token from document.cookie or localStorage
  function getAccessToken() {
    try {
      // 1. From cookie Mureka_ai_globaldata
      const match = document.cookie.match(/Mureka_ai_globaldata=([^;]+)/);
      if (match && match[1]) {
        const decoded = decodeURIComponent(match[1]);
        const data = JSON.parse(decoded);
        const token = data?.session_token?.access_token;
        if (token) return token;
      }
    } catch (_) {}

    try {
      // 2. From localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('userDataStore') || key.includes('SkyMusic') || key.includes('session'))) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            const token = data?.session_token?.access_token || data?.access_token || data?.token;
            if (token) return token;
          } catch (_) {}
        }
      }
    } catch (_) {}

    return null;
  }

  // Resolve audio URL to CDN
  function resolveAudioUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
      return url;
    }
    const clean = url.replace(/^\/+/, '');
    return `https://cdn.mureka.ai/${clean}`;
  }

  // Sanitize filename & folder name (Windows safe, no illegal chars or trailing dots)
  function sanitizeName(name, fallback = 'Song') {
    if (!name) return fallback;
    let clean = String(name)
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    clean = clean.replace(/[\.\s]+$/, ''); // Remove trailing dots & spaces for Windows
    clean = clean.replace(/^\.+/, '');     // Remove leading dots
    return clean.slice(0, 100) || fallback;
  }

  // Initialize once DOM is ready
  function init() {
    if (document.getElementById('mureka-dl-fab')) return;
    createFloatingButton();
    setupKeyboardShortcuts();
    setupMessageListener();
  }

  // Create Floating Action Button (FAB)
  function createFloatingButton() {
    const fab = document.createElement('div');
    fab.id = 'mureka-dl-fab';
    fab.title = 'Mureka Song Downloader (Click to open studio)';
    fab.innerHTML = `
      <span class="fab-icon">🎵</span>
      <span>Download Songs</span>
      <span class="fab-badge" id="mureka-fab-badge">All</span>
    `;

    fab.addEventListener('click', toggleModal);
    document.body.appendChild(fab);
  }

  // Keyboard shortcut Alt+M
  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if ((e.altKey && e.key.toLowerCase() === 'm') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd')) {
        e.preventDefault();
        toggleModal();
      }
    });
  }

  // Toggle Modal
  function toggleModal() {
    if (isModalOpen) {
      closeModal();
    } else {
      openModal();
    }
  }

  // Setup message listener for communication with popup / background
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      const { action } = request;

      if (action === 'PAGE_GET_WORKSPACES') {
        getWorkspacesFromPage().then(list => {
          sendResponse({ success: true, list });
        }).catch(err => {
          sendResponse({ success: false, error: err.message, list: [] });
        });
        return true;
      }

      if (action === 'PAGE_GET_USER') {
        const user = getAccountInfo();
        sendResponse({ success: true, ...user });
        return true;
      }

      if (action === 'PAGE_FETCH_SONGS') {
        fetchWorkspaceSongs(request.folderId, request.wsName || '').then(songs => {
          sendResponse({ success: true, songs });
        }).catch(err => {
          sendResponse({ success: false, error: err.message, songs: [] });
        });
        return true;
      }
    });
  }

  // Open Modal
  async function openModal() {
    if (document.getElementById('mureka-dl-overlay')) return;
    isModalOpen = true;

    const overlay = document.createElement('div');
    overlay.id = 'mureka-dl-overlay';
    overlay.innerHTML = `
      <div id="mureka-dl-modal">
        <div class="mureka-modal-header">
          <div class="mureka-modal-title">
            <span>🎵 Mureka Song Downloader</span>
            <span class="badge-tag">All Workspaces</span>
          </div>
          <div class="mureka-modal-actions">
            <button class="mureka-icon-btn" id="mureka-btn-studio" title="Open Full Studio Tab">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
            <button class="mureka-icon-btn" id="mureka-btn-close" title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>

        <div class="mureka-modal-body">
          <div class="mureka-user-card" id="mureka-user-info">
            <div class="mureka-user-left">
              <div class="mureka-avatar">M</div>
              <div>
                <div class="mureka-username" id="mureka-ui-user">Loading user...</div>
                <div class="mureka-tier" id="mureka-ui-tier">Connected</div>
              </div>
            </div>
            <div class="mureka-user-stats">
              <span>Workspaces: <strong class="mureka-stat-val" id="mureka-stat-ws">--</strong></span>
              <span>Total Songs: <strong class="mureka-stat-val" id="mureka-stat-songs">--</strong></span>
            </div>
          </div>

          <div class="mureka-section-title">
            <span>Select Workspaces to Download</span>
            <label class="mureka-checkbox-label">
              <input type="checkbox" id="mureka-select-all" checked>
              <span>Select All</span>
            </label>
          </div>

          <div class="mureka-workspace-grid" id="mureka-ws-container">
            <div style="grid-column: 1/-1; text-align: center; padding: 30px; color: #94a3b8;">
              Fetching all workspaces from your Mureka account...
            </div>
          </div>

          <div class="mureka-options-row">
            <div class="mureka-option-group">
              <label class="mureka-select">
                <span>Format:</span>
                <select id="mureka-opt-format">
                  <option value="mp3">MP3 - 320kbps High Quality</option>
                  <option value="wav">WAV - Lossless Studio Audio</option>
                </select>
              </label>
            </div>

            <div class="mureka-option-group">
              <label class="mureka-checkbox-label">
                <input type="checkbox" id="mureka-opt-lyrics" checked>
                <span>Save Lyrics (.lrc)</span>
              </label>
              <label class="mureka-checkbox-label">
                <input type="checkbox" id="mureka-opt-folders" checked>
                <span>Sort into Folders</span>
              </label>
            </div>
          </div>

          <div class="mureka-progress-box" id="mureka-progress-box" style="display: none;">
            <div class="mureka-progress-header">
              <span id="mureka-prog-title">Preparing download...</span>
              <span id="mureka-prog-percent">0%</span>
            </div>
            <div class="mureka-progress-bar-bg">
              <div class="mureka-progress-bar-fill" id="mureka-prog-fill"></div>
            </div>
            <div class="mureka-progress-status">
              <span id="mureka-prog-detail">0 / 0 songs</span>
              <span id="mureka-prog-speed">--</span>
            </div>
          </div>
        </div>

        <div class="mureka-modal-footer">
          <div style="font-size: 12px; color: #94a3b8;">
            <span id="mureka-selected-count">0 workspaces selected</span>
          </div>
          <div class="mureka-btn-group">
            <button class="mureka-btn mureka-btn-secondary" id="mureka-btn-zip" title="Download all selected workspaces packaged as a single ZIP archive">
              📦 Export ZIP
            </button>
            <button class="mureka-btn mureka-btn-purple" id="mureka-btn-bridge" title="Send to high-speed Python companion bridge">
              ⚡ Python Bridge
            </button>
            <button class="mureka-btn mureka-btn-primary" id="mureka-btn-download">
              🚀 Start Download
            </button>
          </div>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.body.appendChild(overlay);

    // Bind modal actions
    document.getElementById('mureka-btn-close').addEventListener('click', closeModal);
    document.getElementById('mureka-btn-studio').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_STUDIO' });
      closeModal();
    });

    document.getElementById('mureka-select-all').addEventListener('change', (e) => {
      const checked = e.target.checked;
      selectedWorkspaceIds.clear();
      if (checked) {
        workspaces.forEach(ws => selectedWorkspaceIds.add(ws.id));
      }
      renderWorkspaceGrid();
      updateSelectedCount();
    });

    document.getElementById('mureka-btn-download').addEventListener('click', () => startDownload(false));
    document.getElementById('mureka-btn-zip').addEventListener('click', () => startDownload(true));
    document.getElementById('mureka-btn-bridge').addEventListener('click', sendToPythonBridge);

    // Fetch initial data
    loadAccountData();
    await loadWorkspaces();
  }

  // Close Modal
  function closeModal() {
    const overlay = document.getElementById('mureka-dl-overlay');
    if (overlay) {
      if (isDownloading) {
        if (!confirm('A download is currently running. Do you want to close and cancel?')) {
          return;
        }
        cancelRequested = true;
      }
      overlay.remove();
    }
    isModalOpen = false;
  }

  // Get user profile info
  function getAccountInfo() {
    try {
      const match = document.cookie.match(/Mureka_ai_globaldata=([^;]+)/);
      if (match && match[1]) {
        const decoded = decodeURIComponent(match[1]);
        const data = JSON.parse(decoded);
        const u = data?.userInfo?.user || {};
        return {
          username: u.stage_name || u.email || 'Mureka User',
          tier: u.vip_name || (u.is_vip ? 'VIP' : 'Free'),
          gold: data?.userInfo?.credits || 0,
          totalSongs: data?.userInfo?.feed_list_count || 0
        };
      }
    } catch (_) {}

    return {
      username: 'Mureka User',
      tier: 'Active',
      gold: 0,
      totalSongs: 0
    };
  }

  // Load user profile info to DOM
  function loadAccountData() {
    const info = getAccountInfo();
    const uEl = document.getElementById('mureka-ui-user');
    const tEl = document.getElementById('mureka-ui-tier');
    if (uEl) uEl.textContent = info.username;
    if (tEl) tEl.textContent = `${info.tier.toUpperCase()} (${info.gold} Gold)`;
  }

  // Full extraction logic from page
  async function getWorkspacesFromPage() {
    let list = [];
    const token = getAccessToken();

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'X-App-Name': 'SkyMusic.Ai'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 1. Try in-page API with pagination
    try {
      let lastId = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await fetch(`/api/pgc/folder/list?last_id=${lastId}&size=50&require_trash=true`, {
          headers: headers,
          credentials: 'include'
        });
        const data = await res.json();
        if (data && (data.code === 0 || data.code === 200) && data.data) {
          const pageList = data.data.list || [];
          pageList.forEach(item => {
            if (!list.some(x => Number(x.id) === Number(item.id))) {
              list.push({
                id: Number(item.id),
                name: item.name || 'Workspace',
                song_count: Number(item.song_count) || 0,
                type: Number(item.type) || 1
              });
            }
          });
          hasMore = Boolean(data.data.more) && Boolean(data.data.last_id) && pageList.length > 0;
          lastId = data.data.last_id || 0;
        } else {
          hasMore = false;
        }
      }
    } catch (e) {
      console.warn('In-page folder list API failed:', e);
    }

    // 2. Try window.__INITIAL_STATE__
    if (list.length === 0 && window.__INITIAL_STATE__?.libraryFolder?.folders?.length > 0) {
      window.__INITIAL_STATE__.libraryFolder.folders.forEach(item => {
        list.push({
          id: Number(item.id),
          name: item.name || 'Workspace',
          song_count: Number(item.song_count) || 0,
          type: Number(item.type) || 1
        });
      });
    }

    // 3. Fallback: Parse DOM elements
    if (list.length === 0) {
      list = extractWorkspacesFromDOM();
    }

    return list;
  }

  // Load Workspaces list via /api/pgc/folder/list
  async function loadWorkspaces() {
    try {
      const list = await getWorkspacesFromPage();

      workspaces = list.length > 0 ? list : [{ id: 0, name: 'My workspace', song_count: 0 }];
      selectedWorkspaceIds = new Set(workspaces.map(w => w.id));

      const totalSongs = workspaces.reduce((sum, w) => sum + (Number(w.song_count) || 0), 0);
      const wsCountEl = document.getElementById('mureka-stat-ws');
      const songsCountEl = document.getElementById('mureka-stat-songs');
      if (wsCountEl) wsCountEl.textContent = String(workspaces.length);
      if (songsCountEl) songsCountEl.textContent = String(totalSongs);

      const fabBadge = document.getElementById('mureka-fab-badge');
      if (fabBadge) fabBadge.textContent = `${totalSongs} Songs`;

      renderWorkspaceGrid();
      updateSelectedCount();
    } catch (err) {
      console.error('Failed to load workspaces:', err);
      const container = document.getElementById('mureka-ws-container');
      if (container) {
        container.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #ef4444;">
            Failed to load workspaces. Please make sure you are logged into Mureka.
          </div>
        `;
      }
    }
  }

  // Extract Workspaces from DOM if API needs fallback
  function extractWorkspacesFromDOM() {
    const list = [];
    const elements = document.querySelectorAll('*');

    elements.forEach(el => {
      const text = (el.innerText || '').trim();
      if (!text || text.length > 80 || text.includes('\n')) return;

      const match = text.match(/^([a-zA-Z0-9\s\-_&'’]+?)\s+(\d+)$/);
      if (match) {
        const name = match[1].trim();
        const count = parseInt(match[2], 10);
        if (!['WORKSPACE', 'Create Music', 'Create Video', 'Studio', 'Tools', 'Library'].includes(name)) {
          if (!list.some(x => x.name.toLowerCase() === name.toLowerCase())) {
            list.push({
              id: list.length + 1,
              name: name,
              song_count: count,
              type: name.toLowerCase() === 'trash' ? 2 : (name.toLowerCase().includes('my workspace') ? 3 : 1)
            });
          }
        }
      }
    });

    return list;
  }

  // Render workspace selection cards
  function renderWorkspaceGrid() {
    const container = document.getElementById('mureka-ws-container');
    if (!container) return;

    if (workspaces.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #94a3b8;">
          No workspaces found in this account.
        </div>
      `;
      return;
    }

    container.innerHTML = workspaces.map(ws => {
      const isSelected = selectedWorkspaceIds.has(ws.id);
      const isTrash = ws.type === 2 || ws.name.toLowerCase() === 'trash';
      const icon = isTrash ? '🗑️' : '📁';

      return `
        <div class="mureka-ws-card ${isSelected ? 'selected' : ''}" data-id="${ws.id}">
          <div class="mureka-ws-info">
            <span>${icon}</span>
            <span class="mureka-ws-name" title="${ws.name}">${ws.name}</span>
          </div>
          <span class="mureka-ws-count">${ws.song_count || 0}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.mureka-ws-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = Number(card.getAttribute('data-id')) || card.getAttribute('data-id');
        if (selectedWorkspaceIds.has(id)) {
          selectedWorkspaceIds.delete(id);
          card.classList.remove('selected');
        } else {
          selectedWorkspaceIds.add(id);
          card.classList.add('selected');
        }
        updateSelectedCount();
      });
    });
  }

  function updateSelectedCount() {
    const el = document.getElementById('mureka-selected-count');
    const selectAll = document.getElementById('mureka-select-all');
    if (el) {
      el.textContent = `${selectedWorkspaceIds.size} of ${workspaces.length} workspaces selected`;
    }
    if (selectAll) {
      selectAll.checked = selectedWorkspaceIds.size === workspaces.length;
    }
  }

  // Extract song title with comprehensive fallbacks across song & feed objects
  function extractSongTitle(song, feed = {}) {
    const candidates = [
      song.title,
      song.song_name,
      song.name,
      song.title_alias,
      song.track_name,
      feed.title,
      feed.song_title,
      feed.prompt,
      feed.name,
      feed.desc,
      feed.description,
      song.prompt
    ];
    for (const c of candidates) {
      if (c && typeof c === 'string' && c.trim()) {
        return c.trim();
      }
    }
    return `Song_${song.song_id || Date.now()}`;
  }

  // Fetch all songs for a workspace with pagination
  async function fetchWorkspaceSongs(folderId, wsName = '') {
    const allSongs = [];
    let lastId = '';
    let hasMore = true;
    const token = getAccessToken();

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'X-App-Name': 'SkyMusic.Ai'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    while (hasMore) {
      if (cancelRequested) break;
      const params = new URLSearchParams({ size: '30' });
      if (Number(folderId) > 0) {
        params.append('folder_id', folderId);
      }
      if (lastId) {
        params.append('last_id', lastId);
      }

      const res = await fetch(`/api/pgc/feed/list?${params.toString()}`, {
        headers: headers,
        credentials: 'include'
      });
      const data = await res.json();

      if (data && (data.code === 0 || data.code === 200) && data.data) {
        const feedList = data.data.list || [];
        feedList.forEach(feed => {
          const songsInFeed = Array.isArray(feed.songs) && feed.songs.length > 0
            ? feed.songs
            : (feed.song_id || feed.mp3_url || feed.audio_url ? [feed] : []);

          songsInFeed.forEach(song => {
            if (song.song_id && (song.mp3_url || song.url || song.audio_url)) {
              const title = extractSongTitle(song, feed);
              allSongs.push({
                ...song,
                title: title,
                workspace_name: wsName,
                folder_id: folderId,
                feed_title: feed.title || '',
                prompt: feed.prompt || song.prompt || '',
                mp3_url: resolveAudioUrl(song.mp3_url || song.url || song.audio_url)
              });
            }
          });
        });

        hasMore = Boolean(data.data.more) && Boolean(data.data.last_id) && feedList.length > 0;
        lastId = data.data.last_id || '';
      } else {
        hasMore = false;
      }
    }

    return allSongs;
  }

  // Request actual download URL from Mureka if needed (for WAV / Lossless or MP3)
  async function getDownloadUrl(songId, format = 'mp3') {
    const t = format === 'wav' ? 9 : 1; // 9 = FLAC/WAV, 1 = MP3
    const token = getAccessToken();
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch('/api/pgc/song/download', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({ song_id: songId, t: t })
      });
      const data = await res.json();
      if (data && (data.code === 0 || data.code === 200) && data.data?.oss_key) {
        return resolveAudioUrl(data.data.oss_key);
      }
    } catch (_) {}
    return null;
  }

  // Batch Download Flow
  async function startDownload(asZip = false) {
    if (selectedWorkspaceIds.size === 0) {
      alert('Please select at least one workspace to download.');
      return;
    }

    const format = document.getElementById('mureka-opt-format')?.value || 'mp3';
    const saveLyrics = document.getElementById('mureka-opt-lyrics')?.checked ?? true;
    const sortFolders = document.getElementById('mureka-opt-folders')?.checked ?? true;

    const progBox = document.getElementById('mureka-progress-box');
    const progTitle = document.getElementById('mureka-prog-title');
    const progPercent = document.getElementById('mureka-prog-percent');
    const progFill = document.getElementById('mureka-prog-fill');
    const progDetail = document.getElementById('mureka-prog-detail');

    if (progBox) progBox.style.display = 'block';

    const btnDownload = document.getElementById('mureka-btn-download');
    const btnZip = document.getElementById('mureka-btn-zip');
    if (btnDownload) btnDownload.disabled = true;
    if (btnZip) btnZip.disabled = true;

    isDownloading = true;
    cancelRequested = false;

    try {
      const targetWorkspaces = workspaces.filter(w => selectedWorkspaceIds.has(w.id));
      const downloadQueue = [];

      for (let i = 0; i < targetWorkspaces.length; i++) {
        if (cancelRequested) break;
        const ws = targetWorkspaces[i];
        if (progTitle) progTitle.textContent = `Scanning workspace [${ws.name}] (${i + 1}/${targetWorkspaces.length})...`;

        const songs = await fetchWorkspaceSongs(ws.id, ws.name);
        songs.forEach(song => {
          downloadQueue.push({
            ...song,
            workspace_name: ws.name
          });
        });
      }

      if (downloadQueue.length === 0) {
        alert('No downloadable songs found in the selected workspaces.');
        return;
      }

      if (progTitle) progTitle.textContent = `Downloading ${downloadQueue.length} songs...`;

      let zip = null;
      if (asZip && window.JSZip) {
        zip = new window.JSZip();
      }

      // Variation tracker per workspace to prevent duplicate overwrites
      const titleTracker = new Map();
      function getUniqueTitle(wsName, rawTitle) {
        const cleanWs = sanitizeName(wsName, 'My workspace');
        const cleanTitle = sanitizeName(rawTitle, 'Song');
        if (!titleTracker.has(cleanWs)) {
          titleTracker.set(cleanWs, new Map());
        }
        const counts = titleTracker.get(cleanWs);
        const lower = cleanTitle.toLowerCase();
        const count = (counts.get(lower) || 0) + 1;
        counts.set(lower, count);

        const uniqueTitle = count > 1 ? `${cleanTitle} (v${count})` : cleanTitle;
        return { cleanWs, uniqueTitle };
      }

      let completedCount = 0;

      for (let i = 0; i < downloadQueue.length; i++) {
        if (cancelRequested) break;

        const song = downloadQueue[i];
        const rawTitle = song.title || song.song_name || song.feed_title || `Song_${song.song_id}`;
        const { cleanWs: wsFolder, uniqueTitle: title } = getUniqueTitle(song.workspace_name, rawTitle);

        const pct = Math.round(((i + 1) / downloadQueue.length) * 100);
        if (progFill) progFill.style.width = `${pct}%`;
        if (progPercent) progPercent.textContent = `${pct}%`;
        if (progDetail) progDetail.textContent = `${i + 1} / ${downloadQueue.length} songs (${wsFolder}/${title})`;

        // Get download URL
        let downloadUrl = null;
        if (format === 'wav') {
          downloadUrl = await getDownloadUrl(song.song_id, 'wav');
        }
        if (!downloadUrl) {
          downloadUrl = resolveAudioUrl(song.mp3_url || song.url || song.audio_url);
        }

        if (!downloadUrl) {
          console.warn('Skipping song with no URL:', title);
          continue;
        }

        const ext = format === 'wav' ? 'wav' : 'mp3';
        const filename = `${title}.${ext}`;
        const targetPath = sortFolders ? `Mureka/${wsFolder}/${filename}` : `Mureka/${filename}`;

        if (asZip && zip) {
          try {
            const blobRes = await fetch(downloadUrl);
            const blob = await blobRes.blob();
            const folder = sortFolders ? zip.folder(wsFolder) : zip;
            folder.file(filename, blob);

            if (saveLyrics && song.lyrics) {
              folder.file(`${title}.lrc`, song.lyrics);
            }
          } catch (e) {
            console.error('ZIP fetch error:', e);
          }
        } else {
          // Native Chrome Download: Fetch blob in page context for zero redirects and 100% path enforcement
          let blobUrlToRevoke = null;
          let downloadSrc = downloadUrl;
          try {
            const bRes = await fetch(downloadUrl);
            if (bRes.ok) {
              const blob = await bRes.blob();
              downloadSrc = URL.createObjectURL(blob);
              blobUrlToRevoke = downloadSrc;
            }
          } catch (fetchErr) {
            console.warn('Direct blob fetch failed, falling back to direct URL:', fetchErr);
            downloadSrc = downloadUrl;
          }

          await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'DOWNLOAD_SONG',
              url: downloadSrc,
              filename: targetPath
            }, () => {
              if (blobUrlToRevoke) {
                setTimeout(() => URL.revokeObjectURL(blobUrlToRevoke), 15000);
              }
              resolve();
            });
          });

          // Also download lyrics if selected
          if (saveLyrics && song.lyrics) {
            const lyricsBlob = new Blob([song.lyrics], { type: 'text/plain;charset=utf-8' });
            const lyricsUrl = URL.createObjectURL(lyricsBlob);
            chrome.runtime.sendMessage({
              action: 'DOWNLOAD_SONG',
              url: lyricsUrl,
              filename: sortFolders ? `Mureka/${wsFolder}/${title}.lrc` : `Mureka/${title}.lrc`
            });
          }

          // Small delay to prevent browser queue saturation
          await new Promise(r => setTimeout(r, 200));
        }

        completedCount++;
      }

      // If ZIP export was chosen, generate the zip blob now
      if (asZip && zip) {
        if (progTitle) progTitle.textContent = 'Generating ZIP archive...';
        const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
          if (progPercent) progPercent.textContent = `${Math.round(metadata.percent)}%`;
          if (progFill) progFill.style.width = `${Math.round(metadata.percent)}%`;
        });

        const zipUrl = URL.createObjectURL(zipBlob);
        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_SONG',
          url: zipUrl,
          filename: `Mureka_Songs_${Date.now()}.zip`
        });
      }

      if (progTitle) {
        progTitle.textContent = cancelRequested ? 'Download cancelled.' : `🎉 Completed! Downloaded ${completedCount} songs into your Downloads/Mureka folder.`;
      }
    } catch (err) {
      console.error('Download error:', err);
      if (progTitle) progTitle.textContent = `Error: ${err.message}`;
    } finally {
      isDownloading = false;
      if (btnDownload) btnDownload.disabled = false;
      if (btnZip) btnZip.disabled = false;
    }
  }

  // Send to Python Companion Bridge
  async function sendToPythonBridge() {
    if (selectedWorkspaceIds.size === 0) {
      alert('Please select at least one workspace to download.');
      return;
    }

    const btn = document.getElementById('mureka-btn-bridge');
    const originalText = btn ? btn.textContent : '⚡ Python Bridge';
    if (btn) btn.textContent = 'Connecting...';

    // 1. Check if bridge is online
    chrome.runtime.sendMessage({ action: 'CHECK_LOCAL_BRIDGE' }, async (res) => {
      if (!res || !res.online) {
        if (confirm('Local Companion Bridge is not currently running.\n\nDouble-click start_bridge.bat or start_downloader.bat to activate high-speed direct saving into workspace folders.')) {
          chrome.runtime.sendMessage({ action: 'OPEN_STUDIO' });
        }
        if (btn) btn.textContent = originalText;
        return;
      }

      // 2. Sync active session
      if (btn) btn.textContent = 'Syncing session...';
      await new Promise(r => chrome.runtime.sendMessage({ action: 'BRIDGE_SYNC_SESSION' }, r));

      // 3. Scan selected workspaces and collect songs
      const progBox = document.getElementById('mureka-progress-box');
      const progTitle = document.getElementById('mureka-prog-title');
      const progPercent = document.getElementById('mureka-prog-percent');
      const progFill = document.getElementById('mureka-prog-fill');
      const progDetail = document.getElementById('mureka-prog-detail');

      if (progBox) progBox.style.display = 'block';
      if (progTitle) progTitle.textContent = 'Preparing songs for Python Bridge...';

      const format = document.getElementById('mureka-opt-format')?.value || 'mp3';
      const saveLyrics = document.getElementById('mureka-opt-lyrics')?.checked ?? true;
      const sortFolders = document.getElementById('mureka-opt-folders')?.checked ?? true;

      const targetWorkspaces = workspaces.filter(w => selectedWorkspaceIds.has(w.id));
      const downloadQueue = [];

      for (let i = 0; i < targetWorkspaces.length; i++) {
        const ws = targetWorkspaces[i];
        if (progTitle) progTitle.textContent = `Scanning workspace [${ws.name}] (${i + 1}/${targetWorkspaces.length})...`;
        const songs = await fetchWorkspaceSongs(ws.id, ws.name);
        songs.forEach(song => downloadQueue.push(song));
      }

      if (downloadQueue.length === 0) {
        alert('No downloadable songs found in selected workspaces.');
        if (btn) btn.textContent = originalText;
        return;
      }

      // 4. Send batch to Python Bridge
      if (btn) btn.textContent = '⚡ Downloading...';
      const payload = {
        format: format,
        sort_folders: sortFolders,
        save_lyrics: saveLyrics,
        songs: downloadQueue.map(s => ({
          song_id: s.song_id,
          title: s.title,
          workspace_name: s.workspace_name,
          mp3_url: s.mp3_url,
          lyrics: s.lyrics
        }))
      };

      chrome.runtime.sendMessage({
        action: 'BRIDGE_DOWNLOAD',
        payload: payload
      }, (resp) => {
        if (!resp || !resp.success) {
          alert(`Python Bridge error: ${resp?.error || 'Failed to start batch'}`);
          if (btn) btn.textContent = originalText;
          return;
        }

        // 5. Monitor bridge progress
        const timer = setInterval(() => {
          chrome.runtime.sendMessage({ action: 'BRIDGE_PROGRESS' }, (pollRes) => {
            if (!pollRes || !pollRes.data) return;
            const d = pollRes.data;
            if (progFill) progFill.style.width = `${d.percent}%`;
            if (progPercent) progPercent.textContent = `${d.percent}%`;
            if (progDetail) progDetail.textContent = `${d.completed} / ${d.total} songs (${d.speed || ''})`;
            if (progTitle) progTitle.textContent = d.status_text || 'Downloading via Python Bridge...';

            if (d.status === 'finished') {
              clearInterval(timer);
              if (btn) btn.textContent = '⚡ Finished!';
              setTimeout(() => { if (btn) btn.textContent = originalText; }, 4000);
            }
          });
        }, 1000);
      });
    });
  }

  // Launch on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
