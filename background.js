// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — BACKGROUND SERVICE WORKER (background.js)
//  Handles: install lifecycle, tier validation alarm, message relay
// ==============================================================================

const BACKEND_URL = 'http://localhost:3000';
const COPILOT_TOKEN = 'MakeUpASuperLongPassword123!';

// Global states to support local http:// localhost OAuth redirect callbacks
const activeAuthFlows = {};
const activeAuthTabs = {};


// ─── Install Listener — Open Welcome Page ─────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html') });
  }

  // Set daily alarm to re-validate tier status at midnight
  chrome.alarms.create('tier-validation-alarm', {
    when: getNextMidnightMs(),
    periodInMinutes: 1440, // every 24 hours
  });
});

// ─── Extension Icon Click Listener ───────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html') });
});

function getNextMidnightMs() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

// ─── Alarm Handler — Tier Re-Check ───────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tier-validation-alarm') {
    // Broadcast to all YouTube tabs to refresh tier state
    chrome.tabs.query({ url: 'https://www.youtube.com/watch*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'REFRESH_TIER_STATUS' }).catch(() => {});
      });
    });
  }
});

// ─── Central Message Listener ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // PIPELINE: Google Identity Login via launchWebAuthFlow
  if (message.action === 'LOGIN_USER') {
    const extId = chrome.runtime.id;
    const authUrl = `https://iytbibkcohjukhytcfxo.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://${extId}.chromiumapp.org/`;

    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        console.error('[YT-Copilot Background] Google Login error:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (redirectUrl) {
        try {
          const hash = new URL(redirectUrl).hash;
          const params = new URLSearchParams(hash.substring(1));
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken) {
            sendResponse({ success: true, accessToken, refreshToken });
          } else {
            sendResponse({ success: false, error: 'Access token not found in redirection URL.' });
          }
        } catch (err) {
          sendResponse({ success: false, error: 'Failed to parse redirect response: ' + err.message });
        }
      } else {
        sendResponse({ success: false, error: 'Authorization flow cancelled.' });
      }
    });
    return true; // Keep async channel open
  }



  // PIPELINE: Heartbeat relay — content.js → backend
  if (message.action === 'HEARTBEAT_TICK') {
    const { jwt, videoId, videoTitle, platformOrigin, topicTag } = message;
    fetch(`${BACKEND_URL}/api/usage-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-copilot-token': COPILOT_TOKEN,
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        incrementSeconds: 30,
        videoId,
        videoTitle,
        platformOrigin,
        topicTag
      }),
    })
      .then(res => res.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true; // Keep async channel open
  }

  // PIPELINE: Tier status check
  if (message.action === 'CHECK_TIER') {
    const { jwt } = message;
    fetch(`${BACKEND_URL}/api/tier-status`, {
      headers: {
        'x-copilot-token': COPILOT_TOKEN,
        'Authorization': `Bearer ${jwt}`,
      },
    })
      .then(res => res.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  // PIPELINE: Initiate OAuth 2.0 Web Auth Flow
  if (message.action === 'START_OAUTH') {
    const { platform, userId } = message;
    let endpoint = platform;
    if (platform === 'googledocs') endpoint = 'google';

    const extId = chrome.runtime.id;
    const authUrl = `${BACKEND_URL}/auth/${endpoint}?userId=${userId}&extId=${extId}`;

    activeAuthFlows[platform] = sendResponse;

    if (BACKEND_URL.startsWith('http://')) {
      // Local development fallback — open in a browser tab
      chrome.tabs.create({ url: authUrl }, (tab) => {
        activeAuthTabs[tab.id] = platform;
      });
    } else {
      chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      }, (redirectUrl) => {
        delete activeAuthFlows[platform];
        if (chrome.runtime.lastError) {
          console.error('[YT-Copilot Background] OAuth flow error:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (redirectUrl) {
          try {
            const urlObj = new URL(redirectUrl);
            const status = urlObj.searchParams.get('status');
            const platformResult = urlObj.searchParams.get('platform');
            if (status === 'success') {
              const key = `copilot_linked_${platformResult}`;
              chrome.storage.local.set({ [key]: true }, () => {
                sendResponse({ success: true, platform: platformResult });
              });
            } else {
              sendResponse({ success: false, error: 'Authentication failed' });
            }
          } catch (err) {
            sendResponse({ success: false, error: 'Failed to parse redirect response' });
          }
        } else {
          sendResponse({ success: false, error: 'Authorization flow cancelled' });
        }
      });
    }
    return true;
  }

  // PIPELINE: Sync OAuth Connection Status Flags
  if (message.action === 'SYNC_OAUTH_STATUS') {
    const { jwt } = message;
    fetch(`${BACKEND_URL}/api/auth/status`, {
      headers: {
        'x-copilot-token': COPILOT_TOKEN,
        'Authorization': `Bearer ${jwt}`,
      },
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.integrations) {
          const updates = {};
          Object.entries(data.integrations).forEach(([platform, isLinked]) => {
            updates[`copilot_linked_${platform}`] = isLinked;
          });
          chrome.storage.local.set(updates, () => {
            sendResponse({ success: true, integrations: data.integrations });
          });
        } else {
          sendResponse({ success: false, error: data.error || 'Failed to parse integration status' });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // PIPELINE: Open Welcome Page
  if (message.action === 'OPEN_WELCOME_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html') });
    sendResponse({ success: true });
    return true;
  }

  // PIPELINE: Open Full-Screen Dashboard Tab (single-instance)
  if (message.action === 'OPEN_DASHBOARD') {
    const dashboardUrl = chrome.runtime.getURL('pages/dashboard.html');
    chrome.tabs.query({ url: dashboardUrl }, (existingTabs) => {
      if (existingTabs && existingTabs.length > 0) {
        chrome.tabs.update(existingTabs[0].id, { active: true }, () => {
          chrome.windows.update(existingTabs[0].windowId, { focused: true });
          sendResponse({ success: true, reused: true });
        });
      } else {
        chrome.tabs.create({ url: dashboardUrl }, (tab) => {
          sendResponse({ success: true, reused: false, tabId: tab.id });
        });
      }
    });
    return true;
  }

  // PIPELINE: Capture visible tab
  if (message.action === 'CAPTURE_VISIBLE_TAB') {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 85 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('[YT-Copilot Background] Capture tab error:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });
    return true;
  }
});

// Listener for local http OAuth redirects inside tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && activeAuthTabs[tabId]) {
    const url = changeInfo.url;
    if (url.includes('.chromiumapp.org/oauth2') || url.includes('status=success')) {
      const platform = activeAuthTabs[tabId];
      delete activeAuthTabs[tabId];
      
      try {
        const urlObj = new URL(url);
        const status = urlObj.searchParams.get('status');
        const platformResult = urlObj.searchParams.get('platform') || platform;
        
        if (status === 'success' || url.includes('status=success')) {
          const key = `copilot_linked_${platformResult}`;
          chrome.storage.local.set({ [key]: true }, () => {
            const sendResponse = activeAuthFlows[platformResult];
            if (sendResponse) {
              sendResponse({ success: true, platform: platformResult });
              delete activeAuthFlows[platformResult];
            }
            chrome.tabs.remove(tabId);
          });
        } else {
          const sendResponse = activeAuthFlows[platformResult];
          if (sendResponse) {
            sendResponse({ success: false, error: 'Authentication failed' });
            delete activeAuthFlows[platformResult];
          }
          chrome.tabs.remove(tabId);
        }
      } catch (err) {
        console.error('[YT-Copilot Background] Tab parsing error:', err);
        const sendResponse = activeAuthFlows[platform];
        if (sendResponse) {
          sendResponse({ success: false, error: 'Failed to parse callback' });
          delete activeAuthFlows[platform];
        }
        chrome.tabs.remove(tabId);
      }
    }
  }
});

// Listener if user manually closes the local OAuth fallback tab
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (activeAuthTabs[tabId]) {
    const platform = activeAuthTabs[tabId];
    delete activeAuthTabs[tabId];
    const sendResponse = activeAuthFlows[platform];
    if (sendResponse) {
      sendResponse({ success: false, error: 'Authorization flow window closed by user.' });
      delete activeAuthFlows[platform];
    }
  }
});
