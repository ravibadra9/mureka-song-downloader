/**
 * Mureka Song Downloader - Background Service Worker (Manifest V3)
 * Handles cookie extraction, bearer token extraction, declarativeNetRequest rule management,
 * tab-delegated and direct authenticated API fetches, and file downloads.
 */

const LOCAL_BRIDGE_URL = 'http://127.0.0.1:59966';
const DNR_RULE_ID = 5991;

// Set dynamic rule to inject Cookie header into requests to mureka.ai
async function updateCookieRule(cookieHeader) {
  if (!chrome.declarativeNetRequest || !cookieHeader) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [
        {
          id: DNR_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              {
                header: 'Cookie',
                operation: 'set',
                value: cookieHeader
              }
            ]
          },
          condition: {
            urlFilter: '*://*.mureka.ai/*',
            resourceTypes: ['xmlhttprequest', 'sub_frame', 'other']
          }
        }
      ]
    });
  } catch (err) {
    console.warn('Failed to update declarativeNetRequest rule:', err);
  }
}

// Extract all cookies and access token for Mureka domain
async function getMurekaCookies() {
  try {
    const domainCookies = await chrome.cookies.getAll({ domain: '.mureka.ai' });
    const rootCookies = await chrome.cookies.getAll({ url: 'https://www.mureka.ai' });

    const cookieMap = new Map();
    for (const c of [...domainCookies, ...rootCookies]) {
      cookieMap.set(c.name, c);
    }
    const cookies = Array.from(cookieMap.values());
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Extract Bearer Access Token & User Info from Mureka_ai_globaldata cookie
    let accessToken = null;
    let userInfo = null;
    let userId = null;

    for (const c of cookies) {
      if (c.name === 'Mureka_ai_globaldata') {
        try {
          const decoded = decodeURIComponent(c.value);
          const parsed = JSON.parse(decoded);
          accessToken = parsed?.session_token?.access_token || null;
          userInfo = parsed?.userInfo?.user || parsed?.userInfo || null;
          userId = parsed?.authData?.user_id || parsed?.userInfo?.user?.id || null;
        } catch (e) {
          console.warn('Error parsing Mureka_ai_globaldata:', e);
        }
      }
    }

    // Update declarativeNetRequest rule so background fetches carry cookies
    if (cookieHeader) {
      await updateCookieRule(cookieHeader);
    }

    // Store in chrome.storage.local
    await chrome.storage.local.set({
      mureka_cookies: cookies,
      mureka_cookie_header: cookieHeader,
      mureka_access_token: accessToken,
      mureka_user_info: userInfo,
      mureka_user_id: userId,
      mureka_cookie_timestamp: Date.now(),
      mureka_cookie_count: cookies.length
    });

    return {
      success: true,
      count: cookies.length,
      cookieHeader: cookieHeader,
      cookies: cookies,
      accessToken: accessToken,
      userInfo: userInfo,
      userId: userId
    };
  } catch (err) {
    console.error('Failed to get Mureka cookies:', err);
    return { success: false, error: err.message };
  }
}

// Perform authenticated API request directly or delegated to open Mureka tab
async function fetchMurekaApi(endpoint, options = {}) {
  const cookieInfo = await getMurekaCookies().catch(() => ({}));
  const token = options.token || cookieInfo.accessToken || null;

  // Build standard headers
  const authHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'X-App-Name': 'SkyMusic.Ai',
    'X-Auth-Timestamp': String(Date.now()),
    ...(options.headers || {})
  };

  if (token) {
    authHeaders['Authorization'] = `Bearer ${token}`;
  }

  // Strategy 1: Delegate fetch to an active Mureka tab if open (100% reliable same-origin session)
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.mureka.ai/*' });
    if (tabs && tabs.length > 0) {
      const activeMurekaTab = tabs.find(t => t.active) || tabs[0];
      const execResults = await chrome.scripting.executeScript({
        target: { tabId: activeMurekaTab.id },
        func: async (ep, opts, hdrs) => {
          try {
            const url = ep.startsWith('http') ? ep : `${ep.startsWith('/') ? '' : '/'}${ep}`;
            const fetchOpts = {
              method: opts.method || 'GET',
              headers: hdrs,
              credentials: 'include'
            };

            if (opts.body) {
              fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
              if (!fetchOpts.headers['Content-Type']) {
                fetchOpts.headers['Content-Type'] = 'application/json';
              }
            }

            const res = await fetch(url, fetchOpts);
            const data = await res.json().catch(() => null);
            return { success: res.ok, status: res.status, data: data };
          } catch (e) {
            return { success: false, error: e.message };
          }
        },
        args: [endpoint, options, authHeaders]
      });

      if (execResults && execResults[0] && execResults[0].result && execResults[0].result.data) {
        return execResults[0].result;
      }
    }
  } catch (tabErr) {
    console.warn('Tab delegation fetch failed, trying direct background fetch:', tabErr);
  }

  // Strategy 2: Background service worker fetch with Bearer token & Cookie header
  try {
    const url = endpoint.startsWith('http') ? endpoint : `https://www.mureka.ai${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const fetchOptions = {
      method: options.method || 'GET',
      headers: authHeaders,
      credentials: 'include'
    };

    if (options.body) {
      fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      if (!fetchOptions.headers['Content-Type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json().catch(() => null);

    return {
      success: response.ok,
      status: response.status,
      data: data
    };
  } catch (err) {
    console.error('Mureka API background fetch failed:', err);
    return { success: false, error: err.message };
  }
}

// Format audio URL with proper CDN domain
function resolveAudioUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
    return url;
  }
  const clean = url.replace(/^\/+/, '');
  return `https://cdn.mureka.ai/${clean}`;
}

// Active tracking structures for preserving exact workspace folder paths & song titles
const downloadTargetPaths = new Map();
const downloadUrlPaths = new Map();
const pendingDownloadsQueue = [];

// Intercept Chrome download filename determination to strictly enforce workspace subfolders & song names
if (chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    let customPath = null;
    const isOurExtension = item.byExtensionId === chrome.runtime.id;

    // 1. Match by downloadId
    if (downloadTargetPaths.has(item.id)) {
      customPath = downloadTargetPaths.get(item.id);
      downloadTargetPaths.delete(item.id);
    }
    // 2. Match by exact URL
    else if (downloadUrlPaths.has(item.url)) {
      customPath = downloadUrlPaths.get(item.url);
      downloadUrlPaths.delete(item.url);
    }
    // 3. Match by finalUrl if redirected
    else if (item.finalUrl && downloadUrlPaths.has(item.finalUrl)) {
      customPath = downloadUrlPaths.get(item.finalUrl);
      downloadUrlPaths.delete(item.finalUrl);
    }
    // 4. Match by pending queue for our extension
    else if (isOurExtension && pendingDownloadsQueue.length > 0) {
      // Find matching item by URL or get oldest unassigned item
      const idx = pendingDownloadsQueue.findIndex(p => p.url === item.url || (item.finalUrl && p.url === item.finalUrl));
      if (idx !== -1) {
        customPath = pendingDownloadsQueue[idx].filename;
        pendingDownloadsQueue.splice(idx, 1);
      } else {
        // Take the earliest queued download from our extension
        const pending = pendingDownloadsQueue.shift();
        if (pending) {
          customPath = pending.filename;
        }
      }
    }
    // 5. Match by partial URL / CDN key
    else {
      for (const [u, path] of downloadUrlPaths.entries()) {
        if (typeof u === 'string' && (item.url.includes(u) || u.includes(item.url) || (item.finalUrl && item.finalUrl.includes(u)))) {
          customPath = path;
          downloadUrlPaths.delete(u);
          break;
        }
      }
    }

    // 6. Check if Chrome's item.filename already contains our directory structure
    if (!customPath && item.filename && (item.filename.includes('Mureka') || item.filename.includes('/') || item.filename.includes('\\'))) {
      customPath = item.filename;
    }

    if (customPath) {
      // Normalize to forward slashes without leading slashes and strip illegal Windows characters
      const cleanPath = customPath
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/[:*?"<>|]/g, '_');

      suggest({
        filename: cleanPath,
        conflictAction: 'uniquify'
      });
      return true;
    }

    // If it's our extension and still no path, keep existing item.filename or suggest default
    if (isOurExtension && item.filename) {
      suggest({ filename: item.filename, conflictAction: 'uniquify' });
      return true;
    }

    // Default suggest fallback
    suggest({ conflictAction: 'uniquify' });
  });
}

// Download a single file using chrome.downloads with custom workspace folder & song title
function downloadSongFile({ url, filename }) {
  return new Promise((resolve) => {
    const fullUrl = resolveAudioUrl(url);
    if (!fullUrl) {
      resolve({ success: false, error: 'Empty download URL' });
      return;
    }

    const cleanFilename = filename ? filename.replace(/\\/g, '/').replace(/^\/+/, '') : '';

    if (cleanFilename) {
      downloadUrlPaths.set(fullUrl, cleanFilename);
      pendingDownloadsQueue.push({
        url: fullUrl,
        filename: cleanFilename,
        timestamp: Date.now()
      });

      // Housekeeping: remove stale pending entries after 5 minutes
      const now = Date.now();
      while (pendingDownloadsQueue.length > 0 && (now - pendingDownloadsQueue[0].timestamp > 300000)) {
        pendingDownloadsQueue.shift();
      }
      setTimeout(() => downloadUrlPaths.delete(fullUrl), 180000);
    }

    chrome.downloads.download({
      url: fullUrl,
      filename: cleanFilename,
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        downloadUrlPaths.delete(fullUrl);
        const qIdx = pendingDownloadsQueue.findIndex(p => p.url === fullUrl);
        if (qIdx !== -1) pendingDownloadsQueue.splice(qIdx, 1);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        if (downloadId && cleanFilename) {
          downloadTargetPaths.set(downloadId, cleanFilename);
          setTimeout(() => downloadTargetPaths.delete(downloadId), 180000);
        }
        resolve({ success: true, downloadId });
      }
    });
  });
}

// Open Dedicated Full Tab / Window
async function openFullStudio() {
  const url = chrome.runtime.getURL('popup.html?mode=full');
  return chrome.tabs.create({ url });
}

// Open Side Panel
async function openSidePanel(sender) {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    if (windowId) {
      return chrome.sidePanel.open({ windowId });
    }
    const currentWin = await chrome.windows.getCurrent().catch(() => null);
    if (currentWin) {
      return chrome.sidePanel.open({ windowId: currentWin.id });
    }
  }
  return openFullStudio();
}

// Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

  if (action === 'GET_COOKIES') {
    getMurekaCookies().then(sendResponse);
    return true;
  }

  if (action === 'FETCH_API') {
    fetchMurekaApi(request.endpoint, request.options).then(sendResponse);
    return true;
  }

  if (action === 'DOWNLOAD_SONG') {
    downloadSongFile(request).then(sendResponse);
    return true;
  }

  if (action === 'OPEN_STUDIO') {
    openFullStudio().then(() => sendResponse({ success: true }));
    return true;
  }

  if (action === 'OPEN_SIDEPANEL') {
    openSidePanel(sender)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === 'CHECK_LOCAL_BRIDGE') {
    fetch(`${LOCAL_BRIDGE_URL}/status`, { method: 'GET' })
      .then(res => res.json())
      .then(data => sendResponse({ online: true, data }))
      .catch(() => sendResponse({ online: false }));
    return true;
  }

  if (action === 'BRIDGE_SYNC_SESSION') {
    getMurekaCookies().then(cRes => {
      fetch(`${LOCAL_BRIDGE_URL}/sync-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies: cRes.cookieHeader || '',
          access_token: cRes.accessToken || '',
          user_info: cRes.userInfo || null,
          timestamp: Date.now()
        })
      })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (action === 'BRIDGE_DOWNLOAD') {
    fetch(`${LOCAL_BRIDGE_URL}/download-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload)
    })
    .then(r => r.json())
    .then(data => sendResponse({ success: true, data }))
    .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === 'BRIDGE_PROGRESS') {
    fetch(`${LOCAL_BRIDGE_URL}/progress`, { method: 'GET' })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === 'BRIDGE_OPEN_FOLDER') {
    fetch(`${LOCAL_BRIDGE_URL}/open-folder`, { method: 'POST' })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === 'OTA_CHECK') {
    fetch(`${LOCAL_BRIDGE_URL}/ota/check`)
      .then(r => r.json())
      .then(data => sendResponse({ success: true, bridge: true, data }))
      .catch(() => {
        // Fallback: direct check to GitHub raw
        const currentVer = chrome.runtime.getManifest().version || '1.0.0';
        fetch('https://raw.githubusercontent.com/ravibadra9/mureka-song-downloader/main/version.json', { cache: 'no-cache' })
          .then(r => r.json())
          .then(remote => {
            const latestVer = remote.version || currentVer;
            const rParts = latestVer.split('.').map(n => parseInt(n, 10) || 0);
            const lParts = currentVer.split('.').map(n => parseInt(n, 10) || 0);
            let updateAvailable = false;
            for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
              const rN = rParts[i] || 0;
              const lN = lParts[i] || 0;
              if (rN > lN) { updateAvailable = true; break; }
              if (rN < lN) { break; }
            }
            sendResponse({
              success: true,
              bridge: false,
              data: {
                update_available: updateAvailable,
                current_version: currentVer,
                latest_version: latestVer,
                changelog: remote.changelog || [],
                release_date: remote.release_date || ''
              }
            });
          })
          .catch(err => sendResponse({ success: false, error: err.message }));
      });
    return true;
  }

  if (action === 'OTA_APPLY') {
    // 1. Try local companion bridge first
    fetch(`${LOCAL_BRIDGE_URL}/ota/apply`, { method: 'POST' })
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(async () => {
        // 2. Fallback: check if local files on disk are already updated
        try {
          const diskRes = await fetch(chrome.runtime.getURL('version.json') + '?t=' + Date.now());
          const diskData = await diskRes.json();
          const runningVer = chrome.runtime.getManifest().version || '1.0.0';

          if (diskData && diskData.version && diskData.version !== runningVer) {
            sendResponse({
              success: true,
              reloaded: true,
              data: {
                message: `Local files are already at v${diskData.version}. Reloading extension...`,
                updated_files_count: 'all'
              }
            });
            setTimeout(() => {
              chrome.runtime.reload();
            }, 600);
            return;
          }
        } catch (_) {}

        // 3. Fallback: Bridge offline and files not yet patched
        sendResponse({
          success: false,
          bridgeOffline: true,
          error: 'Companion Bridge is not running.'
        });
      });
    return true;
  }

  if (action === 'OTA_RELOAD') {
    console.log('[OTA] Extension reloading via chrome.runtime.reload()...');
    sendResponse({ success: true });
    setTimeout(() => {
      chrome.runtime.reload();
    }, 600);
    return true;
  }
});

// Install listener
chrome.runtime.onInstalled.addListener(() => {
  console.log('Mureka Song Downloader installed successfully.');
  getMurekaCookies().catch(() => {});
});
