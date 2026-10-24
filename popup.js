/**
 * Mureka Song Downloader - Studio Frontend Controller (v1.0.0)
 * Manages full multi-workspace song fetching, queue downloading, ZIP packaging, and bridge synchronization.
 */

(function () {
  'use strict';

  // State
  const state = {
    workspaces: [],
    selectedWorkspaceIds: new Set(),
    user: null,
    isDownloading: false,
    isPaused: false,
    isCancelled: false,
    selectedEngine: 'chrome', // 'chrome' | 'zip' | 'bridge'
    bridgeOnline: false,
    downloadQueue: [],
    completedCount: 0,
    totalCount: 0,
    startTime: 0
  };

  // DOM Elements
  const elements = {
    // Header & User
    body: document.body,
    btnOtaUpdate: document.getElementById('btn-ota-update'),
    otaPulseDot: document.getElementById('ota-pulse-dot'),
    btnOtaLabel: document.getElementById('btn-ota-label'),
    btnOpenFull: document.getElementById('btn-open-full'),
    btnOpenSidePanel: document.getElementById('btn-open-sidepanel'),
    btnRefreshAll: document.getElementById('btn-refresh-all'),
    uiAvatar: document.getElementById('ui-avatar'),
    uiUsername: document.getElementById('ui-username'),
    uiTier: document.getElementById('ui-tier'),
    uiGold: document.getElementById('ui-gold'),
    bridgePill: document.getElementById('bridge-pill'),
    bridgeDot: document.getElementById('bridge-dot'),
    bridgeLabel: document.getElementById('bridge-label'),

    // OTA Modal Elements
    modalOta: document.getElementById('modal-ota'),
    btnOtaModalClose: document.getElementById('btn-ota-modal-close'),
    otaModalVersionTag: document.getElementById('ota-modal-version-tag'),
    otaStatusTitle: document.getElementById('ota-status-title'),
    otaStatusDate: document.getElementById('ota-status-date'),
    otaStatusDesc: document.getElementById('ota-status-desc'),
    otaChangelogBox: document.getElementById('ota-changelog-box'),
    otaChangelogList: document.getElementById('ota-changelog-list'),
    otaProgressBox: document.getElementById('ota-progress-box'),
    otaProgressFill: document.getElementById('ota-progress-fill'),
    otaProgressMsg: document.getElementById('ota-progress-msg'),
    btnOtaCheckAgain: document.getElementById('btn-ota-check-again'),
    btnOtaApplyNow: document.getElementById('btn-ota-apply-now'),

    // Stats
    statTotalWs: document.getElementById('stat-total-ws'),
    statTotalSongs: document.getElementById('stat-total-songs'),
    statSelectedWs: document.getElementById('stat-selected-ws'),
    statSelectedSongs: document.getElementById('stat-selected-songs'),

    // Workspaces
    chkSelectAll: document.getElementById('chk-select-all'),
    inputSearchWs: document.getElementById('input-search-ws'),
    workspaceList: document.getElementById('workspace-list'),

    // Settings
    selectAudioFormat: document.getElementById('select-audio-format'),
    chkSortFolders: document.getElementById('chk-sort-folders'),
    chkSaveLyrics: document.getElementById('chk-save-lyrics'),
    chkSkipExisting: document.getElementById('chk-skip-existing'),

    // Engines
    engineChrome: document.getElementById('engine-chrome'),
    engineZip: document.getElementById('engine-zip'),
    engineBridge: document.getElementById('engine-bridge'),

    // Actions
    btnStartDownload: document.getElementById('btn-start-download'),
    btnStartIcon: document.getElementById('btn-start-icon'),
    btnStartText: document.getElementById('btn-start-text'),
    btnQuickZip: document.getElementById('btn-quick-zip'),
    btnSyncPython: document.getElementById('btn-sync-python'),

    // Progress
    progressCard: document.getElementById('progress-card'),
    progCurrentStatus: document.getElementById('prog-current-status'),
    progOverallPct: document.getElementById('prog-overall-pct'),
    progOverallFill: document.getElementById('prog-overall-fill'),
    progCountDetail: document.getElementById('prog-count-detail'),
    btnProgPause: document.getElementById('btn-prog-pause'),
    btnProgCancel: document.getElementById('btn-prog-cancel'),

    // Logs & Footer
    consoleLogs: document.getElementById('console-logs'),
    btnClearLogs: document.getElementById('btn-clear-logs'),
    linkOpenDownloads: document.getElementById('link-open-downloads'),
    linkMurekaSite: document.getElementById('link-mureka-site')
  };

  // Helper: Append formatted log
  function log(msg, type = 'info') {
    if (!elements.consoleLogs) return;
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${time}] ${msg}`;
    elements.consoleLogs.appendChild(entry);
    elements.consoleLogs.scrollTop = elements.consoleLogs.scrollHeight;
  }

  // Sanitize file & folder names
  function sanitizeName(name) {
    return (name || 'song').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  // Initialize
  async function init() {
    // Mode check
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'full') {
      elements.body.classList.add('full-studio-mode');
      if (elements.btnOpenFull) elements.btnOpenFull.style.display = 'none';
    }

    bindEvents();
    checkBridgeStatus();
    checkOtaSilently();
    log('Initializing Mureka Studio Downloader...', 'cyan');

    await fetchUserProfile();
    await fetchWorkspaces();
  }

  // Bind Event Listeners
  function bindEvents() {
    // OTA Update Button
    if (elements.btnOtaUpdate) {
      elements.btnOtaUpdate.addEventListener('click', () => {
        openOtaModal(true);
      });
    }

    if (elements.btnOtaModalClose) {
      elements.btnOtaModalClose.addEventListener('click', closeOtaModal);
    }

    if (elements.modalOta) {
      elements.modalOta.addEventListener('click', (e) => {
        if (e.target === elements.modalOta) closeOtaModal();
      });
    }

    if (elements.btnOtaCheckAgain) {
      elements.btnOtaCheckAgain.addEventListener('click', () => {
        performOtaCheck(false);
      });
    }

    if (elements.btnOtaApplyNow) {
      elements.btnOtaApplyNow.addEventListener('click', performOtaApply);
    }

    if (elements.btnOpenFull) {
      elements.btnOpenFull.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'OPEN_STUDIO' });
      });
    }

    if (elements.btnOpenSidePanel) {
      elements.btnOpenSidePanel.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'OPEN_SIDEPANEL' });
      });
    }

    if (elements.btnRefreshAll) {
      elements.btnRefreshAll.addEventListener('click', async () => {
        log('Refreshing Mureka account and workspaces...', 'cyan');
        await fetchUserProfile();
        await fetchWorkspaces();
        checkBridgeStatus();
        checkOtaSilently();
      });
    }

    // Workspaces select all
    if (elements.chkSelectAll) {
      elements.chkSelectAll.addEventListener('change', (e) => {
        const checked = e.target.checked;
        state.selectedWorkspaceIds.clear();
        if (checked) {
          state.workspaces.forEach(ws => state.selectedWorkspaceIds.add(ws.id));
        }
        renderWorkspaceList();
        updateSelectionStats();
      });
    }

    // Search filter
    if (elements.inputSearchWs) {
      elements.inputSearchWs.addEventListener('input', () => {
        renderWorkspaceList();
      });
    }

    // Engine Selection
    const engines = [
      { el: elements.engineChrome, id: 'chrome' },
      { el: elements.engineZip, id: 'zip' },
      { el: elements.engineBridge, id: 'bridge' }
    ];

    engines.forEach(({ el, id }) => {
      if (!el) return;
      el.addEventListener('click', () => {
        engines.forEach(e => e.el && e.el.classList.remove('active'));
        el.classList.add('active');
        state.selectedEngine = id;
        log(`Download engine switched to: ${id.toUpperCase()}`, 'info');
        updateButtonText();
      });
    });

    // Start Download
    if (elements.btnStartDownload) {
      elements.btnStartDownload.addEventListener('click', () => {
        startBatchDownload(state.selectedEngine);
      });
    }

    // Quick ZIP button
    if (elements.btnQuickZip) {
      elements.btnQuickZip.addEventListener('click', () => {
        startBatchDownload('zip');
      });
    }

    // Sync Python button
    if (elements.btnSyncPython) {
      elements.btnSyncPython.addEventListener('click', syncPythonSession);
    }

    // Progress Controls
    if (elements.btnProgPause) {
      elements.btnProgPause.addEventListener('click', () => {
        state.isPaused = !state.isPaused;
        elements.btnProgPause.textContent = state.isPaused ? 'Resume' : 'Pause';
        log(state.isPaused ? '⏸ Download queue paused.' : '▶ Download queue resumed.', 'warn');
      });
    }

    if (elements.btnProgCancel) {
      elements.btnProgCancel.addEventListener('click', () => {
        if (confirm('Are you sure you want to cancel ongoing downloads?')) {
          state.isCancelled = true;
          log('🛑 Cancellation requested by user.', 'error');
        }
      });
    }

    // Clear logs
    if (elements.btnClearLogs) {
      elements.btnClearLogs.addEventListener('click', () => {
        if (elements.consoleLogs) elements.consoleLogs.innerHTML = '';
        log('Console cleared.', 'info');
      });
    }

    // Open Downloads link
    if (elements.linkOpenDownloads) {
      elements.linkOpenDownloads.addEventListener('click', () => {
        chrome.downloads.showDefaultFolder();
      });
    }

    if (elements.linkMurekaSite) {
      elements.linkMurekaSite.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://www.mureka.ai/create' });
      });
    }
  }

  // ==========================================================================
  // OTA Over-The-Air Update Engine
  // ==========================================================================

  let latestOtaData = null;

  function checkOtaSilently() {
    chrome.runtime.sendMessage({ action: 'OTA_CHECK' }, (res) => {
      if (res && res.success && res.data) {
        latestOtaData = res.data;
        if (res.data.update_available) {
          if (elements.otaPulseDot) elements.otaPulseDot.style.display = 'block';
          if (elements.btnOtaLabel) elements.btnOtaLabel.textContent = `Update (v${res.data.latest_version})`;
          log(`⚡ New OTA Update available: v${res.data.latest_version}! Click "OTA Update" in header to apply.`, 'warn');
        } else {
          if (elements.otaPulseDot) elements.otaPulseDot.style.display = 'none';
          if (elements.btnOtaLabel) elements.btnOtaLabel.textContent = 'OTA Update';
        }
      }
    });
  }

  function openOtaModal(forceCheck = false) {
    if (!elements.modalOta) return;
    elements.modalOta.style.display = 'flex';
    performOtaCheck(forceCheck);
  }

  function closeOtaModal() {
    if (!elements.modalOta) return;
    elements.modalOta.style.display = 'none';
  }

  function performOtaCheck(forceCheck = false) {
    if (elements.otaModalVersionTag) elements.otaModalVersionTag.textContent = 'Checking...';
    if (elements.otaStatusTitle) {
      elements.otaStatusTitle.textContent = 'Checking for updates on GitHub...';
      elements.otaStatusTitle.style.color = '#38bdf8';
    }
    if (elements.otaStatusDesc) elements.otaStatusDesc.textContent = 'Connecting to GitHub repository and companion bridge...';
    if (elements.otaChangelogBox) elements.otaChangelogBox.style.display = 'none';
    if (elements.otaProgressBox) elements.otaProgressBox.style.display = 'none';
    if (elements.btnOtaApplyNow) elements.btnOtaApplyNow.style.display = 'none';
    if (elements.btnOtaCheckAgain) elements.btnOtaCheckAgain.disabled = true;

    chrome.runtime.sendMessage({ action: 'OTA_CHECK' }, (res) => {
      if (elements.btnOtaCheckAgain) elements.btnOtaCheckAgain.disabled = false;

      if (!res || !res.success || !res.data) {
        if (elements.otaStatusTitle) {
          elements.otaStatusTitle.textContent = 'Unable to check for updates';
          elements.otaStatusTitle.style.color = '#ef4444';
        }
        if (elements.otaStatusDesc) {
          elements.otaStatusDesc.textContent = res?.error || 'Could not connect to GitHub repository or Companion Bridge. Please check your internet connection.';
        }
        return;
      }

      const d = res.data;
      latestOtaData = d;

      if (elements.otaModalVersionTag) {
        elements.otaModalVersionTag.textContent = `v${d.current_version}`;
      }

      if (elements.otaStatusDate && d.release_date) {
        elements.otaStatusDate.textContent = `Released: ${d.release_date}`;
      }

      if (d.update_available) {
        if (elements.otaPulseDot) elements.otaPulseDot.style.display = 'block';
        if (elements.btnOtaLabel) elements.btnOtaLabel.textContent = `Update (v${d.latest_version})`;

        if (elements.otaModalVersionTag) {
          elements.otaModalVersionTag.textContent = `New: v${d.latest_version}`;
        }
        if (elements.otaStatusTitle) {
          elements.otaStatusTitle.textContent = `🚀 Update Available: v${d.latest_version}`;
          elements.otaStatusTitle.style.color = '#10b981';
        }
        if (elements.otaStatusDesc) {
          elements.otaStatusDesc.textContent = `A fresh release is available on GitHub! Click "Update Now" to apply all changes instantly into this Chrome extension folder without removing or reinstalling.`;
        }

        // Render changelog
        if (d.changelog && d.changelog.length > 0 && elements.otaChangelogList && elements.otaChangelogBox) {
          elements.otaChangelogList.innerHTML = d.changelog.map(item => `<li>${item}</li>`).join('');
          elements.otaChangelogBox.style.display = 'block';
        }

        if (elements.btnOtaApplyNow) {
          elements.btnOtaApplyNow.style.display = 'inline-flex';
          elements.btnOtaApplyNow.disabled = false;
        }
      } else {
        if (elements.otaPulseDot) elements.otaPulseDot.style.display = 'none';
        if (elements.btnOtaLabel) elements.btnOtaLabel.textContent = 'OTA Update';

        if (elements.otaStatusTitle) {
          elements.otaStatusTitle.textContent = `✅ Extension is Up-To-Date (v${d.current_version})`;
          elements.otaStatusTitle.style.color = '#38bdf8';
        }
        if (elements.otaStatusDesc) {
          elements.otaStatusDesc.textContent = `You have the latest version of Mureka Song Downloader installed. All workspaces, scripts, and download engines are synced.`;
        }

        if (d.changelog && d.changelog.length > 0 && elements.otaChangelogList && elements.otaChangelogBox) {
          elements.otaChangelogList.innerHTML = d.changelog.map(item => `<li>${item}</li>`).join('');
          elements.otaChangelogBox.style.display = 'block';
        }
      }
    });
  }

  function performOtaApply() {
    if (!elements.btnOtaApplyNow) return;

    elements.btnOtaApplyNow.disabled = true;
    if (elements.btnOtaCheckAgain) elements.btnOtaCheckAgain.disabled = true;

    if (elements.otaProgressBox) elements.otaProgressBox.style.display = 'flex';
    if (elements.otaProgressFill) elements.otaProgressFill.style.width = '30%';
    if (elements.otaProgressMsg) {
      elements.otaProgressMsg.textContent = 'Connecting to Companion Bridge and downloading updates from GitHub...';
      elements.otaProgressMsg.style.color = '#38bdf8';
    }

    log('Starting OTA Update process via Companion Bridge...', 'cyan');

    chrome.runtime.sendMessage({ action: 'OTA_APPLY' }, (res) => {
      if (!res || !res.success) {
        if (elements.btnOtaApplyNow) elements.btnOtaApplyNow.disabled = false;
        if (elements.btnOtaCheckAgain) elements.btnOtaCheckAgain.disabled = false;

        const errMsg = res?.error || 'Local Companion Bridge is offline.';
        if (elements.otaProgressFill) elements.otaProgressFill.style.width = '0%';
        if (elements.otaProgressMsg) {
          elements.otaProgressMsg.textContent = `❌ ${errMsg} (Make sure start_bridge.bat is running, or double-click update.bat!)`;
          elements.otaProgressMsg.style.color = '#ef4444';
        }
        log(`OTA update failed: ${errMsg}`, 'error');
        return;
      }

      if (elements.otaProgressFill) elements.otaProgressFill.style.width = '85%';
      if (elements.otaProgressMsg) {
        elements.otaProgressMsg.textContent = `Files updated (${res.data?.updated_files_count || 'all'} files). Reloading extension...`;
        elements.otaProgressMsg.style.color = '#10b981';
      }

      log(`✅ OTA update successfully applied! Reloading unpacked extension...`, 'success');

      setTimeout(() => {
        if (elements.otaProgressFill) elements.otaProgressFill.style.width = '100%';
        if (elements.otaProgressMsg) elements.otaProgressMsg.textContent = '🚀 Extension reloaded! Refreshing view...';
        chrome.runtime.sendMessage({ action: 'OTA_RELOAD' });
        setTimeout(() => {
          window.location.reload();
        }, 800);
      }, 700);
    });
  }

  // Check Local Python Companion Bridge Status
  function checkBridgeStatus() {
    chrome.runtime.sendMessage({ action: 'CHECK_LOCAL_BRIDGE' }, (res) => {
      if (res && res.online) {
        state.bridgeOnline = true;
        if (elements.bridgeDot) elements.bridgeDot.classList.add('active');
        if (elements.bridgeLabel) elements.bridgeLabel.textContent = 'Bridge: Active (Port 59966)';
        if (elements.bridgePill) elements.bridgePill.title = 'Local Python Bridge is online and ready for high-speed downloads!';
      } else {
        state.bridgeOnline = false;
        if (elements.bridgeDot) elements.bridgeDot.classList.remove('active');
        if (elements.bridgeLabel) elements.bridgeLabel.textContent = 'Bridge: Standalone Mode';
        if (elements.bridgePill) elements.bridgePill.title = 'Double-click start_bridge.bat to activate high-speed local Python saving.';
      }
    });
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

  // Fetch User Profile
  async function fetchUserProfile() {
    try {
      // 1. Get cookies & token from background
      const cookieRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_COOKIES' }, resolve);
      });

      if (cookieRes && cookieRes.userInfo) {
        const u = cookieRes.userInfo;
        state.user = u;
        if (elements.uiUsername) elements.uiUsername.textContent = u.stage_name || u.email || 'Mureka User';
        if (elements.uiTier) elements.uiTier.textContent = (u.vip_name || (u.is_vip ? 'PREMIER' : 'FREE')).toUpperCase();
        if (elements.uiAvatar) elements.uiAvatar.textContent = (u.stage_name || u.email || 'M')[0].toUpperCase();
      }

      // 2. Query profile API
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'FETCH_API',
          endpoint: '/api/pgc/profile'
        }, resolve);
      });

      if (res && res.data && (res.data.code === 200 || res.data.code === 0) && res.data.data) {
        const data = res.data.data;
        const u = data.user || data;
        state.user = u;
        if (elements.uiUsername) elements.uiUsername.textContent = u.stage_name || u.username || u.name || elements.uiUsername.textContent;
        if (elements.uiTier) elements.uiTier.textContent = (u.vip_name || (u.is_vip ? 'PREMIER' : 'FREE')).toUpperCase();
        if (elements.uiGold) elements.uiGold.textContent = `🪙 ${data.credits || u.credits || 0} Gold`;
        if (elements.uiAvatar) elements.uiAvatar.textContent = (elements.uiUsername.textContent || 'M')[0].toUpperCase();
        log(`Logged in as: ${elements.uiUsername.textContent} (${elements.uiTier.textContent}, ${data.credits || u.credits || 0} Gold)`, 'success');
      } else {
        // Fallback: check open tab
        const tabs = await chrome.tabs.query({ url: '*://*.mureka.ai/*' });
        if (tabs && tabs.length > 0) {
          try {
            const domProfile = await chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              func: () => {
                const uElem = document.querySelector('[class*="username"], [class*="user-name"], .user-info');
                const goldElem = document.querySelector('[class*="gold"], [class*="credit"]');
                return {
                  username: uElem ? uElem.innerText.trim() : null,
                  gold: goldElem ? goldElem.innerText.trim() : null
                };
              }
            });
            if (domProfile && domProfile[0] && domProfile[0].result) {
              const dp = domProfile[0].result;
              if (dp.username && elements.uiUsername) elements.uiUsername.textContent = dp.username;
              if (dp.gold && elements.uiGold) elements.uiGold.textContent = `🪙 ${dp.gold}`;
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('Profile fetch error:', err);
    }
  }

  // Fetch Workspaces from Mureka API with multi-tier fallback
  async function fetchWorkspaces() {
    if (elements.workspaceList) {
      elements.workspaceList.innerHTML = `
        <div style="text-align: center; padding: 25px; color: #94a3b8; font-size: 12px;">
          Querying Mureka workspaces...
        </div>
      `;
    }

    try {
      let list = [];

      // Ensure session cookies & Bearer access token are refreshed
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_COOKIES' }, resolve);
      });

      // Tier 1: Query API directly via background service worker with Bearer token & pagination
      try {
        let lastId = 0;
        let hasMore = true;
        while (hasMore) {
          const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'FETCH_API',
              endpoint: `/api/pgc/folder/list?last_id=${lastId}&size=50&require_trash=true`
            }, resolve);
          });

          if (res && res.data && (res.data.code === 0 || res.data.code === 200) && res.data.data) {
            const pageList = res.data.data.list || [];
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
            hasMore = Boolean(res.data.data.more) && Boolean(res.data.data.last_id) && pageList.length > 0;
            lastId = res.data.data.last_id || 0;
          } else {
            hasMore = false;
          }
        }
        if (list.length > 0) {
          log(`Retrieved ${list.length} workspaces directly via Mureka API.`, 'success');
        }
      } catch (tier1Err) {
        console.warn('Tier 1 API query failed:', tier1Err);
      }

      // Tier 2: Delegate to active Mureka tab if open
      if (list.length === 0) {
        const tabs = await chrome.tabs.query({ url: '*://*.mureka.ai/*' });
        const murekaTab = tabs && tabs.length > 0 ? (tabs.find(t => t.active) || tabs[0]) : null;
        if (murekaTab) {
          try {
            const tabRes = await new Promise((resolve) => {
              chrome.tabs.sendMessage(murekaTab.id, { action: 'PAGE_GET_WORKSPACES' }, resolve);
            });
            if (tabRes && tabRes.success && Array.isArray(tabRes.list) && tabRes.list.length > 0) {
              list = tabRes.list;
              log(`Retrieved ${list.length} workspaces from active Mureka page.`, 'success');
            }
          } catch (_) {}
        }
      }

      // Tier 3: In-page executeScript fallback
      if (list.length === 0) {
        const tabs = await chrome.tabs.query({ url: '*://*.mureka.ai/*' });
        const murekaTab = tabs && tabs.length > 0 ? (tabs.find(t => t.active) || tabs[0]) : null;
        if (murekaTab) {
          try {
            const execRes = await chrome.scripting.executeScript({
              target: { tabId: murekaTab.id },
              func: async () => {
                try {
                  let allFolders = [];
                  let lastId = 0;
                  let hasMore = true;
                  while (hasMore) {
                    const res = await fetch(`/api/pgc/folder/list?last_id=${lastId}&size=50&require_trash=true`, {
                      credentials: 'include'
                    });
                    const json = await res.json();
                    if (json && (json.code === 200 || json.code === 0) && json.data) {
                      const pList = json.data.list || [];
                      pList.forEach(item => {
                        if (!allFolders.some(x => Number(x.id) === Number(item.id))) {
                          allFolders.push({
                            id: Number(item.id),
                            name: item.name || 'Workspace',
                            song_count: Number(item.song_count) || 0,
                            type: Number(item.type) || 1
                          });
                        }
                      });
                      hasMore = Boolean(json.data.more) && Boolean(json.data.last_id) && pList.length > 0;
                      lastId = json.data.last_id || 0;
                    } else {
                      hasMore = false;
                    }
                  }
                  if (allFolders.length > 0) return allFolders;
                } catch (e) {}

                // Try window.__INITIAL_STATE__
                try {
                  if (window.__INITIAL_STATE__?.libraryFolder?.folders?.length > 0) {
                    return window.__INITIAL_STATE__.libraryFolder.folders.map(f => ({
                      id: Number(f.id),
                      name: f.name || 'Workspace',
                      song_count: Number(f.song_count) || 0,
                      type: Number(f.type) || 1
                    }));
                  }
                } catch (e) {}

                // Fallback: Scrape DOM elements
                try {
                  const domItems = [];
                  const all = document.querySelectorAll('*');
                  all.forEach(el => {
                    const t = (el.innerText || '').trim();
                    if (!t || t.length > 80 || t.includes('\n')) return;
                    const m = t.match(/^([a-zA-Z0-9\s\-_&'’]+?)\s+(\d+)$/);
                    if (m) {
                      const name = m[1].trim();
                      const count = parseInt(m[2], 10);
                      if (!['WORKSPACE', 'Create Music', 'Create Video', 'Studio', 'Tools', 'Library'].includes(name)) {
                        if (!domItems.some(x => x.name.toLowerCase() === name.toLowerCase())) {
                          domItems.push({
                            id: domItems.length + 1,
                            name: name,
                            song_count: count,
                            type: name.toLowerCase() === 'trash' ? 2 : (name.toLowerCase().includes('my workspace') ? 3 : 1)
                          });
                        }
                      }
                    }
                  });
                  if (domItems.length > 0) return domItems;
                } catch (e) {}

                return [];
              }
            });

            if (execRes && execRes[0] && Array.isArray(execRes[0].result) && execRes[0].result.length > 0) {
              list = execRes[0].result;
              log(`Extracted ${list.length} workspaces from page context.`, 'success');
            }
          } catch (execErr) {
            console.warn('In-page script execution error:', execErr);
          }
        }
      }

      // Fallback if completely empty
      if (list.length === 0) {
        list = [{ id: 0, name: 'My workspace', type: 3, song_count: 0 }];
      }

      state.workspaces = list;
      state.selectedWorkspaceIds = new Set(list.map(w => w.id));

      const totalSongs = list.reduce((sum, w) => sum + (Number(w.song_count) || 0), 0);
      if (elements.statTotalWs) elements.statTotalWs.textContent = String(list.length);
      if (elements.statTotalSongs) elements.statTotalSongs.textContent = String(totalSongs);

      log(`Found ${list.length} workspaces (${totalSongs} total songs) in account.`, 'success');

      renderWorkspaceList();
      updateSelectionStats();
    } catch (err) {
      console.error('Failed to fetch workspaces:', err);
      log(`Failed to fetch workspaces: ${err.message}`, 'error');
    }
  }

  // Render Workspace List
  function renderWorkspaceList() {
    if (!elements.workspaceList) return;

    const query = (elements.inputSearchWs?.value || '').trim().toLowerCase();
    const filtered = state.workspaces.filter(ws => {
      if (!query) return true;
      return ws.name.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      elements.workspaceList.innerHTML = `
        <div style="text-align: center; padding: 25px; color: #94a3b8; font-size: 12px;">
          No matching workspaces found.
        </div>
      `;
      return;
    }

    elements.workspaceList.innerHTML = filtered.map(ws => {
      const isSelected = state.selectedWorkspaceIds.has(ws.id);
      const isTrash = ws.type === 2 || ws.name.toLowerCase() === 'trash';
      const icon = isTrash ? '🗑️' : '📁';

      return `
        <div class="ws-item-row ${isSelected ? 'selected' : ''}" data-id="${ws.id}">
          <div class="ws-item-left">
            <input type="checkbox" ${isSelected ? 'checked' : ''} class="ws-chk" data-id="${ws.id}">
            <span>${icon}</span>
            <span class="ws-item-title" title="${ws.name}">${ws.name}</span>
          </div>
          <span class="ws-item-count">${ws.song_count || 0} songs</span>
        </div>
      `;
    }).join('');

    // Attach row click listeners
    elements.workspaceList.querySelectorAll('.ws-item-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const idVal = row.getAttribute('data-id');
        const id = Number(idVal) || idVal;
        const chk = row.querySelector('.ws-chk');

        if (e.target !== chk) {
          chk.checked = !chk.checked;
        }

        if (chk.checked) {
          state.selectedWorkspaceIds.add(id);
          row.classList.add('selected');
        } else {
          state.selectedWorkspaceIds.delete(id);
          row.classList.remove('selected');
        }

        updateSelectionStats();
      });
    });
  }

  // Update Summary Counts & Button Text
  function updateSelectionStats() {
    const selectedCount = state.selectedWorkspaceIds.size;
    const selectedSongs = state.workspaces
      .filter(w => state.selectedWorkspaceIds.has(w.id))
      .reduce((sum, w) => sum + (Number(w.song_count) || 0), 0);

    if (elements.statSelectedWs) elements.statSelectedWs.textContent = String(selectedCount);
    if (elements.statSelectedSongs) elements.statSelectedSongs.textContent = String(selectedSongs);
    if (elements.chkSelectAll) {
      elements.chkSelectAll.checked = selectedCount === state.workspaces.length && state.workspaces.length > 0;
    }

    updateButtonText(selectedSongs, selectedCount);
  }

  function updateButtonText(songs = 0, ws = 0) {
    if (!elements.btnStartText) return;

    if (songs === 0 && ws === 0) {
      const selectedWorkspaces = state.workspaces.filter(w => state.selectedWorkspaceIds.has(w.id));
      ws = selectedWorkspaces.length;
      songs = selectedWorkspaces.reduce((sum, w) => sum + (Number(w.song_count) || 0), 0);
    }

    if (state.selectedEngine === 'zip') {
      elements.btnStartText.textContent = `Export ZIP (${songs} Songs / ${ws} Workspaces)`;
      if (elements.btnStartIcon) elements.btnStartIcon.textContent = '📦';
    } else if (state.selectedEngine === 'bridge') {
      elements.btnStartText.textContent = `Download via Python Bridge (${songs} Songs)`;
      if (elements.btnStartIcon) elements.btnStartIcon.textContent = '⚡';
    } else {
      elements.btnStartText.textContent = `Download All Selected (${songs} Songs)`;
      if (elements.btnStartIcon) elements.btnStartIcon.textContent = '🚀';
    }
  }

  // Fetch all songs for a workspace with pagination cursor
  async function fetchWorkspaceSongs(folderId, wsName) {
    const allSongs = [];
    const tabs = await chrome.tabs.query({ url: '*://*.mureka.ai/*' });
    const murekaTab = tabs && tabs.length > 0 ? (tabs.find(t => t.active) || tabs[0]) : null;

    // Strategy 1: Delegate to Mureka content script
    if (murekaTab) {
      try {
        const tabRes = await new Promise((resolve) => {
          chrome.tabs.sendMessage(murekaTab.id, { action: 'PAGE_FETCH_SONGS', folderId }, resolve);
        });
        if (tabRes && tabRes.success && Array.isArray(tabRes.songs) && tabRes.songs.length > 0) {
          return tabRes.songs.map(s => ({
            ...s,
            workspace_name: wsName,
            folder_id: folderId
          }));
        }
      } catch (_) {}
    }

    // Strategy 2: Direct or background fetch with pagination
    let lastId = '';
    let hasMore = true;

    while (hasMore) {
      if (state.isCancelled) break;
      const endpoint = `/api/pgc/feed/list?size=30${Number(folderId) > 0 ? `&folder_id=${folderId}` : ''}${lastId ? `&last_id=${lastId}` : ''}`;
      
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'FETCH_API',
          endpoint: endpoint
        }, resolve);
      });

      if (res && res.data && (res.data.code === 200 || res.data.code === 0) && res.data.data) {
        const feedList = res.data.data.list || [];
        feedList.forEach(feed => {
          if (Array.isArray(feed.songs)) {
            feed.songs.forEach(song => {
              if (song.song_id && (song.mp3_url || song.url || song.audio_url)) {
                allSongs.push({
                  ...song,
                  folder_id: folderId,
                  workspace_name: wsName,
                  feed_title: feed.title || '',
                  mp3_url: resolveAudioUrl(song.mp3_url || song.url || song.audio_url)
                });
              }
            });
          }
        });

        hasMore = Boolean(res.data.data.more) && Boolean(res.data.data.last_id) && feedList.length > 0;
        lastId = res.data.data.last_id || '';
      } else {
        hasMore = false;
      }
    }

    return allSongs;
  }

  // Request actual download URL from Mureka (for WAV/FLAC or authenticated key)
  async function getDownloadUrl(songId, format = 'mp3') {
    const t = format === 'wav' ? 9 : 1; // 9 = FLAC/lossless, 1 = MP3
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'FETCH_API',
          endpoint: '/api/pgc/song/download',
          options: {
            method: 'POST',
            body: { song_id: songId, t: t }
          }
        }, resolve);
      });

      if (res && res.data && (res.data.code === 0 || res.data.code === 200) && res.data.data?.oss_key) {
        return resolveAudioUrl(res.data.data.oss_key);
      }
    } catch (_) {}
    return null;
  }

  // Start Batch Download
  async function startBatchDownload(engine = 'chrome') {
    if (state.selectedWorkspaceIds.size === 0) {
      alert('Please select at least one workspace to download.');
      return;
    }

    state.isDownloading = true;
    state.isPaused = false;
    state.isCancelled = false;
    state.completedCount = 0;
    state.startTime = Date.now();

    const format = elements.selectAudioFormat?.value || 'mp3';
    const sortFolders = elements.chkSortFolders?.checked ?? true;
    const saveLyrics = elements.chkSaveLyrics?.checked ?? true;

    if (elements.progressCard) elements.progressCard.style.display = 'flex';
    if (elements.btnStartDownload) elements.btnStartDownload.disabled = true;

    try {
      const targetWorkspaces = state.workspaces.filter(w => state.selectedWorkspaceIds.has(w.id));
      log(`Starting scan across ${targetWorkspaces.length} workspaces...`, 'cyan');

      // Phase 1: Collect songs
      const queue = [];
      for (let i = 0; i < targetWorkspaces.length; i++) {
        if (state.isCancelled) break;
        const ws = targetWorkspaces[i];
        if (elements.progCurrentStatus) {
          elements.progCurrentStatus.textContent = `Scanning [${ws.name}] (${i + 1}/${targetWorkspaces.length})...`;
        }

        const songs = await fetchWorkspaceSongs(ws.id, ws.name);
        log(`Workspace [${ws.name}]: fetched ${songs.length} downloadable songs.`, 'info');
        songs.forEach(song => queue.push(song));
      }

      state.downloadQueue = queue;
      state.totalCount = queue.length;

      if (queue.length === 0) {
        alert('No downloadable songs found in the selected workspaces.');
        return;
      }

      log(`Total songs queued for download: ${queue.length}`, 'success');

      // Check if Python Bridge engine was chosen
      if (engine === 'bridge') {
        await executeBridgeDownload(queue, format, sortFolders, saveLyrics);
        return;
      }

      // Check if ZIP engine was chosen
      if (engine === 'zip') {
        await executeZipDownload(queue, format, sortFolders, saveLyrics);
        return;
      }

      // Default: Chrome Native Downloads
      await executeChromeNativeDownload(queue, format, sortFolders, saveLyrics);

    } catch (err) {
      console.error('Batch download failed:', err);
      log(`Error during download: ${err.message}`, 'error');
    } finally {
      state.isDownloading = false;
      if (elements.btnStartDownload) elements.btnStartDownload.disabled = false;
    }
  }

  // Execute Chrome Native Downloads
  async function executeChromeNativeDownload(queue, format, sortFolders, saveLyrics) {
    for (let i = 0; i < queue.length; i++) {
      if (state.isCancelled) {
        log('Download queue stopped by user.', 'error');
        break;
      }

      while (state.isPaused) {
        await new Promise(r => setTimeout(r, 500));
        if (state.isCancelled) break;
      }

      const song = queue[i];
      const title = sanitizeName(song.title || song.song_name || `Song_${song.song_id}`);
      const wsName = sanitizeName(song.workspace_name);

      const pct = Math.round(((i + 1) / queue.length) * 100);
      if (elements.progOverallFill) elements.progOverallFill.style.width = `${pct}%`;
      if (elements.progOverallPct) elements.progOverallPct.textContent = `${pct}%`;
      if (elements.progCountDetail) elements.progCountDetail.textContent = `${i + 1} / ${queue.length} songs`;
      if (elements.progCurrentStatus) elements.progCurrentStatus.textContent = `Downloading: [${wsName}] ${title}`;

      // Formats to download
      const formatsToGet = format === 'both' ? ['mp3', 'wav'] : [format];

      for (const fmt of formatsToGet) {
        let downloadUrl = null;
        if (fmt === 'wav') {
          downloadUrl = await getDownloadUrl(song.song_id, 'wav');
        }
        if (!downloadUrl) {
          downloadUrl = resolveAudioUrl(song.mp3_url || song.url || song.audio_url);
        }

        if (!downloadUrl) {
          log(`Skipping missing audio stream for: ${title}`, 'warn');
          continue;
        }

        const ext = fmt === 'wav' ? 'wav' : 'mp3';
        const filename = `${title}.${ext}`;
        const targetPath = sortFolders ? `Mureka/${wsName}/${filename}` : `Mureka/${filename}`;

        await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'DOWNLOAD_SONG',
            url: downloadUrl,
            filename: targetPath
          }, (res) => {
            if (res && res.success) {
              log(`Downloaded (${ext.toUpperCase()}): ${wsName}/${filename}`, 'success');
            } else {
              log(`Download warning for ${filename}: ${res?.error || 'Unknown error'}`, 'warn');
            }
            resolve();
          });
        });
      }

      // Download Lyrics (.lrc)
      if (saveLyrics && song.lyrics) {
        const lyricsBlob = new Blob([song.lyrics], { type: 'text/plain;charset=utf-8' });
        const lyricsUrl = URL.createObjectURL(lyricsBlob);
        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_SONG',
          url: lyricsUrl,
          filename: sortFolders ? `Mureka/${wsName}/${title}.lrc` : `Mureka/${title}.lrc`
        });
      }

      state.completedCount++;
      // Controlled throttle to prevent Chrome browser hang
      await new Promise(r => setTimeout(r, 200));
    }

    if (elements.progCurrentStatus) {
      elements.progCurrentStatus.textContent = state.isCancelled 
        ? 'Download cancelled.' 
        : `🎉 Complete! All ${state.completedCount} songs downloaded into your Downloads folder.`;
    }
    log(`Download run finished: ${state.completedCount} songs processed.`, 'success');
  }

  // Execute In-Browser ZIP Packaging
  async function executeZipDownload(queue, format, sortFolders, saveLyrics) {
    if (!window.JSZip) {
      alert('JSZip library is missing. Falling back to Chrome Native engine.');
      return executeChromeNativeDownload(queue, format, sortFolders, saveLyrics);
    }

    const zip = new window.JSZip();
    log(`Initializing ZIP packaging for ${queue.length} songs...`, 'cyan');

    for (let i = 0; i < queue.length; i++) {
      if (state.isCancelled) break;
      while (state.isPaused) {
        await new Promise(r => setTimeout(r, 500));
        if (state.isCancelled) break;
      }

      const song = queue[i];
      const title = sanitizeName(song.title || song.song_name || `Song_${song.song_id}`);
      const wsName = sanitizeName(song.workspace_name);

      const pct = Math.round(((i + 1) / queue.length) * 100);
      if (elements.progOverallFill) elements.progOverallFill.style.width = `${pct}%`;
      if (elements.progOverallPct) elements.progOverallPct.textContent = `${pct}%`;
      if (elements.progCountDetail) elements.progCountDetail.textContent = `${i + 1} / ${queue.length} songs`;
      if (elements.progCurrentStatus) elements.progCurrentStatus.textContent = `Packaging [${wsName}]: ${title}`;

      let downloadUrl = null;
      if (format === 'wav') {
        downloadUrl = await getDownloadUrl(song.song_id, 'wav');
      }
      if (!downloadUrl) {
        downloadUrl = resolveAudioUrl(song.mp3_url || song.url || song.audio_url);
      }

      if (!downloadUrl) continue;

      try {
        const res = await fetch(downloadUrl);
        const blob = await res.blob();
        const ext = format === 'wav' ? 'wav' : 'mp3';
        const filename = `${title}.${ext}`;

        const folder = sortFolders ? zip.folder(wsName) : zip;
        folder.file(filename, blob);

        if (saveLyrics && song.lyrics) {
          folder.file(`${title}.lrc`, song.lyrics);
        }

        log(`Added to ZIP: ${wsName}/${filename}`, 'info');
        state.completedCount++;
      } catch (err) {
        log(`Failed fetching ${title} for ZIP: ${err.message}`, 'warn');
      }
    }

    if (elements.progCurrentStatus) {
      elements.progCurrentStatus.textContent = 'Compressing and exporting ZIP file...';
    }
    log('Generating final ZIP archive...', 'cyan');

    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      if (elements.progOverallPct) elements.progOverallPct.textContent = `${Math.round(metadata.percent)}%`;
      if (elements.progOverallFill) elements.progOverallFill.style.width = `${Math.round(metadata.percent)}%`;
    });

    const zipUrl = URL.createObjectURL(zipBlob);
    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_SONG',
      url: zipUrl,
      filename: `Mureka_All_Workspaces_${Date.now()}.zip`
    });

    if (elements.progCurrentStatus) {
      elements.progCurrentStatus.textContent = `🎉 Complete! Exported ZIP archive with ${state.completedCount} songs.`;
    }
    log(`ZIP generation successful: ${state.completedCount} songs archived.`, 'success');
  }

  // Execute Download via Local Companion Bridge
  async function executeBridgeDownload(queue, format, sortFolders, saveLyrics) {
    if (!state.bridgeOnline) {
      alert('Local Python Companion Bridge is not running on http://127.0.0.1:59966.\n\nPlease double-click start_bridge.bat first or select "Chrome Native" engine.');
      return;
    }

    log(`Dispatching batch of ${queue.length} songs to Python Companion Bridge...`, 'cyan');

    const payload = {
      format: format,
      sort_folders: sortFolders,
      save_lyrics: saveLyrics,
      songs: queue.map(s => ({
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
    }, (res) => {
      if (res && res.success) {
        log('Batch transferred to Python Bridge! Local high-speed worker started.', 'success');
        monitorBridgeProgress();
      } else {
        log(`Bridge error: ${res?.error || 'Unknown error'}`, 'error');
      }
    });
  }

  // Poll Bridge Progress
  function monitorBridgeProgress() {
    const timer = setInterval(() => {
      chrome.runtime.sendMessage({ action: 'BRIDGE_PROGRESS' }, (res) => {
        if (!res || !res.data) return;
        const d = res.data;

        if (elements.progOverallFill) elements.progOverallFill.style.width = `${d.percent}%`;
        if (elements.progOverallPct) elements.progOverallPct.textContent = `${d.percent}%`;
        if (elements.progCountDetail) elements.progCountDetail.textContent = `${d.completed} / ${d.total} songs`;
        if (elements.progCurrentStatus) elements.progCurrentStatus.textContent = d.status_text || 'Downloading...';

        if (d.status === 'finished' || d.status === 'idle') {
          clearInterval(timer);
          log('Python Bridge download completed successfully!', 'success');
        }
      });
    }, 1000);
  }

  // Sync Python Session: Export cookies to companion bridge or download mureka_session.json
  async function syncPythonSession() {
    log('Exporting Mureka session cookies for Python standalone tool...', 'cyan');

    const cRes = await new Promise(r => chrome.runtime.sendMessage({ action: 'GET_COOKIES' }, r));
    if (!cRes || !cRes.cookieHeader) {
      alert('No Mureka cookies found in Chrome. Please make sure you are logged in at https://www.mureka.ai/create.');
      return;
    }

    const sessionData = {
      cookies: cRes.cookieHeader,
      access_token: cRes.accessToken || '',
      cookie_list: cRes.cookies,
      timestamp: Date.now(),
      mureka_url: 'https://www.mureka.ai',
      user: state.user || cRes.userInfo || null
    };

    // 1. Try syncing to bridge if bridge is online
    if (state.bridgeOnline) {
      chrome.runtime.sendMessage({ action: 'BRIDGE_SYNC_SESSION' }, (res) => {
        if (res && res.success) {
          log('✅ Successfully synced active session directly into Python Companion Bridge!', 'success');
          alert('Session synced to Local Companion Bridge!\nYou can now run start_downloader.bat or mureka_downloader.py with 100% active login.');
        }
      });
    }

    // 2. Also download mureka_session.json so standalone script can read it anywhere
    const sessionBlob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
    const sessionUrl = URL.createObjectURL(sessionBlob);

    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_SONG',
      url: sessionUrl,
      filename: 'Mureka/mureka_session.json'
    }, () => {
      log('Saved mureka_session.json to Downloads/Mureka/ folder.', 'info');
      alert('Mureka session exported!\n\n1. "mureka_session.json" has been saved to your Downloads/Mureka/ folder.\n2. You can also run start_downloader.bat directly on your computer to download all workspaces.');
    });
  }

  // Run init on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
