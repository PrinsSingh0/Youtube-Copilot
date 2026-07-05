// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — CONTENT SCRIPT ENGINE (content.js)
//  Fixed: MutationObserver debounce, SPA nav detection, injection guard
// ==============================================================================

const BACKEND_URL = 'http://localhost:3000';
const COPILOT_TOKEN = 'MakeUpASuperLongPassword123!';

console.log('[YT-Copilot] Content script loaded ✅');
const IS_IFRAME = window.self !== window.top;

// ─── State ────────────────────────────────────────────────────────────────────
let currentTier = 'TRIAL'; // default TRIAL so UI is fully functional
let recognition = null;
let isRecording = false;
let heartbeatInterval = null;
let aiDebounceTimer = null;
let activeFetchController = null;
let activeSuggestion = '';
let historicalTranscriptBuffer = [];
let injectionDebounceTimer = null; // CRITICAL: debounce MutationObserver

// ─── Transcript Buffer & Active Captions Loader ─────────────────────────────────
let cachedTranscriptEvents = [];
let cachedVideoId = '';
let isExtensionUsedForCurrentVideo = false;
let videoTelemetryObserver = null;

function getYouTubeCaptionTracks() {
  return new Promise((resolve) => {
    const listener = (event) => {
      if (event.source !== window || !event.data || event.data.type !== 'YOUTUBE_COPILOT_PLAYER_RESPONSE') return;
      window.removeEventListener('message', listener);
      resolve(event.data.playerResponse);
    };
    window.addEventListener('message', listener);

    const script = document.createElement('script');
    script.id = 'yt-copilot-player-response-injector';
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  });
}

async function loadTranscriptEvents() {
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');
  if (!videoId) return;
  if (videoId === cachedVideoId && cachedTranscriptEvents.length > 0) {
    return cachedTranscriptEvents;
  }

  cachedVideoId = videoId;
  cachedTranscriptEvents = [];

  try {
    const playerResponse = await getYouTubeCaptionTracks();
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) return;

    const track = captionTracks.find(t => t.languageCode === 'en') || captionTracks[0];
    if (!track || !track.baseUrl) return;

    const res = await fetch(track.baseUrl + '&fmt=json3');
    if (!res.ok) {
      console.warn('[YT-Copilot] Caption track fetch failed with status:', res.status);
      return;
    }
    const data = await res.json();
    if (data && data.events) {
      cachedTranscriptEvents = data.events.map(event => {
        const text = (event.segs || []).map(s => s.utf8).join('').trim();
        return {
          start: (event.tStartMs || 0) / 1000,
          duration: (event.dDurationMs || 0) / 1000,
          text
        };
      }).filter(e => e.text);
    }
  } catch (err) {
    console.error('[YT-Copilot] Failed to load transcript:', err);
  }
}

setInterval(() => {
  document.querySelectorAll('.ytp-caption-segment').forEach(el => {
    const text = el.textContent?.trim();
    if (text && !historicalTranscriptBuffer.includes(text)) {
      historicalTranscriptBuffer.push(text);
      if (historicalTranscriptBuffer.length > 50) historicalTranscriptBuffer.shift();
    }
  });
}, 400);

function getTranscriptContext() {
  if (historicalTranscriptBuffer.length === 0) {
    return Array.from(document.querySelectorAll('.ytp-caption-segment'))
      .map(el => el.textContent?.trim()).join(' ') || 'No captions detected.';
  }
  return historicalTranscriptBuffer.join(' ');
}

function getTranscriptContextAtTime(time, beforeSeconds = 60, afterSeconds = 60) {
  if (cachedTranscriptEvents.length === 0) {
    return getTranscriptContext();
  }

  const startLimit = time - beforeSeconds;
  const endLimit = time + afterSeconds;

  const segments = cachedTranscriptEvents.filter(event => {
    return event.start >= startLimit && event.start <= endLimit;
  });

  if (segments.length === 0) {
    return getTranscriptContext();
  }

  return segments.map(s => s.text).join(' ');
}

// ─── JWT Helper & Stored Keys ──────────────────────────────────────────────────
let storedKeys = {};
const keysLoadedPromise = new Promise((resolve) => {
  chrome.storage.local.get([
    'copilot_key_notion', 'copilot_key_gdocs_id',
    'copilot_linked_notion', 'copilot_linked_google_docs',
    'copilot_linked_coda', 'copilot_jwt'
  ], (res) => {
    storedKeys = res || {};
    resolve();
  });
});

chrome.storage.onChanged.addListener((changes) => {
  for (let [key, { newValue }] of Object.entries(changes)) {
    if (key.startsWith('copilot_key_') || key.startsWith('copilot_linked_') || key === 'copilot_jwt') {
      storedKeys[key] = newValue;
    }
  }
});

function getUserIdFromJWT(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub; // Supabase user ID is in 'sub'
  } catch (e) {
    console.error('Failed to decode JWT:', e);
    return null;
  }
}

function getStoredJWT() {
  return storedKeys.copilot_jwt || '';
}

function syncOAuthStatus() {
  const jwt = getStoredJWT();
  if (!jwt) return;
  chrome.runtime.sendMessage({ action: 'SYNC_OAUTH_STATUS', jwt }, (res) => {
    if (res?.success) {
      loadDropdownOptions();
    }
  });
}

function buildAuthHeaders(extra = {}) {
  const platformSelect = document.getElementById('pkm-destination-selector');
  const rawPlatform = platformSelect ? platformSelect.value : 'notion';
  const platform = rawPlatform === 'google_docs' ? 'googledocs' : rawPlatform;

  const headers = {
    'Content-Type': 'application/json',
    'x-copilot-token': COPILOT_TOKEN,
    'x-target-platform': platform,
    'Authorization': `Bearer ${getStoredJWT()}`,
    ...extra,
  };

  // Tokens are managed dynamically by the backend using OAuth
  return headers;
}

// ─── Secure API Fetch ─────────────────────────────────────────────────────────
async function secureFetch(url, options, fallbackPayload = null) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Server error ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (fallbackPayload) await cacheFailedNote(fallbackPayload);
    throw err;
  }
}

// ─── Find Video Element ──────────────────────────────────────────────────────
function findVideoElement() {
  const videos = [];

  // YouTube specific main video element has priority
  const ytVideo = document.querySelector('video.html5-main-video');
  if (ytVideo) return ytVideo;

  // Query standard document video elements
  document.querySelectorAll('video').forEach(v => videos.push(v));

  // Search inside open shadow roots recursively
  function searchInShadow(node) {
    if (!node) return;
    if (node.shadowRoot) {
      node.shadowRoot.querySelectorAll('video').forEach(v => videos.push(v));
      searchInShadow(node.shadowRoot);
    }
    const children = node.children;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        searchInShadow(children[i]);
      }
    }
  }
  searchInShadow(document.body);

  if (videos.length === 0) return null;
  if (videos.length === 1) return videos[0];

  // Heuristic scoring to find the main explanation/slides video
  let bestVideo = videos[0];
  let maxScore = -9999999;

  for (const v of videos) {
    const rect = v.getBoundingClientRect();
    const displayArea = rect.width * rect.height;
    const resolutionArea = v.videoWidth * v.videoHeight;
    
    // Base score is the display area
    let score = displayArea || (v.offsetWidth * v.offsetHeight) || 0;
    
    // If resolution is loaded, give it heavy weight
    if (resolutionArea > 0) {
      score += resolutionArea * 2;
    }

    // Inspect classes and IDs of the video and its parent elements (up to 5 levels)
    let isWebcam = false;
    let isMain = false;
    
    let current = v;
    let depth = 0;
    const webcamKeywords = ['camera', 'webcam', 'face', 'instructor', 'teacher', 'avatar', 'presenter', 'educator', 'small', 'pip', 'thumbnail', 'uacdn'];
    const mainKeywords = ['main', 'content', 'board', 'screen', 'presentation', 'slide', 'player', 'lecture', 'workspace', 'explanation'];

    while (current && depth < 5) {
      const classList = Array.from(current.classList || []).join(' ').toLowerCase();
      const id = (current.id || '').toLowerCase();
      const testString = `${classList} ${id}`;

      if (webcamKeywords.some(kw => testString.includes(kw))) {
        isWebcam = true;
      }
      if (mainKeywords.some(kw => testString.includes(kw))) {
        isMain = true;
      }
      current = current.parentElement;
      depth++;
    }

    // Apply penalties/bonuses
    if (isWebcam) {
      score -= 5000000; // Heavy penalty for webcam indicators
    }
    if (isMain) {
      score += 1000000; // Bonus for main screen indicators
    }

    if (score > maxScore) {
      maxScore = score;
      bestVideo = v;
    }
  }

  return bestVideo;
}

// ─── Canvas Frame Capture ─────────────────────────────────────────────────────
async function captureVideoFrame() {
  const video = findVideoElement();
  if (!video) return null;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;

  // Try direct canvas capture first
  try {
    const canvas = document.createElement('canvas');
    canvas.width = vw; canvas.height = vh;
    canvas.getContext('2d').drawImage(video, 0, 0, vw, vh);
    const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    if (data && data.length > 100) {
      return data;
    }
  } catch (e) {
    console.warn('[YT-Copilot] Direct canvas capture failed (likely CORS/tainted), trying tab capture fallback...', e);
  }

  // Fallback: use background tab capture and crop to the video rect
  try {
    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, (res) => {
        resolve(res);
      });
    });

    if (response && response.success && response.dataUrl) {
      const croppedBase64 = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            // Bounding rect is relative to DOM viewport.
            // Image size from captureVisibleTab is pixel dimensions (including devicePixelRatio).
            const scaleX = img.width / window.innerWidth;
            const scaleY = img.height / window.innerHeight;

            const x = rect.left * scaleX;
            const y = rect.top * scaleY;
            const w = rect.width * scaleX;
            const h = rect.height * scaleY;

            canvas.width = rect.width;
            canvas.height = rect.height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, x, y, w, h, 0, 0, rect.width, rect.height);
            resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = (err) => reject(err);
        img.src = response.dataUrl;
      });
      return croppedBase64;
    }
  } catch (err) {
    console.error('[YT-Copilot] Tab capture fallback failed:', err);
  }

  return null;
}

// ─── Voice Macro Parser ───────────────────────────────────────────────────────
function applyVoiceMacros(transcript, textareaEl) {
  const t = transcript.trim().toLowerCase();
  if (t === 'clear text' || t === 'clear all') {
    textareaEl.value = '';
    return { handled: true, serverCommand: false };
  }
  if (t === 'delete last word' || t === 'backspace') {
    const words = textareaEl.value.trim().split(/\s+/);
    words.pop();
    textareaEl.value = words.join(' ');
    return { handled: true, serverCommand: false };
  }
  const replaceMatch = t.match(/^replace (.+?) with (.+)$/i);
  if (replaceMatch) {
    const [, from, to] = replaceMatch;
    textareaEl.value = textareaEl.value.replace(new RegExp(from, 'gi'), to);
    return { handled: true, serverCommand: false };
  }
  const serverTriggers = ['make this', 'change', 'rephrase', 'summarize', 'translate'];
  const isServerCmd = serverTriggers.some(kw => t.startsWith(kw));
  if (isServerCmd) return { handled: false, serverCommand: true, command: transcript };
  return { handled: false, serverCommand: false };
}

// ─── Draft Cache ──────────────────────────────────────────────────────────────
async function cacheFailedNote(payload) {
  return new Promise(resolve => {
    chrome.storage.local.get(['draftCacheQueue'], result => {
      const queue = result.draftCacheQueue || [];
      queue.push({
        uid: `draft_${Date.now()}`,
        timestamp: new Date().toISOString(),
        destination: payload.platform || 'notion',
        destinationKey: payload.destinationKey || '',
        containerId: payload.containerId || '',
        textPayload: payload.text,
        originMetadata: {
          url: window.location.href,
          videoTime: document.querySelector('video')?.currentTime || 0,
          title: document.title,
        },
      });
      chrome.storage.local.set({ draftCacheQueue: queue }, () => {
        updateDraftDot(queue.length);
        resolve(true);
      });
    });
  });
}

function updateDraftDot(count) {
  const dot = document.getElementById('copilot-draft-dot');
  if (!dot) return;
  dot.classList.toggle('visible', count > 0);
}

async function loadDrafts() {
  return new Promise(resolve => {
    chrome.storage.local.get(['draftCacheQueue'], r => resolve(r.draftCacheQueue || []));
  });
}

async function deleteDraft(uid) {
  return new Promise(resolve => {
    chrome.storage.local.get(['draftCacheQueue'], r => {
      const queue = (r.draftCacheQueue || []).filter(d => d.uid !== uid);
      chrome.storage.local.set({ draftCacheQueue: queue }, () => {
        updateDraftDot(queue.length);
        resolve(queue);
      });
    });
  });
}

// ─── Drafts Tray ──────────────────────────────────────────────────────────────
async function renderDraftsTray() {
  const tray = document.getElementById('copilot-drafts-tray');
  const list = document.getElementById('copilot-drafts-list');
  if (!tray || !list) return;
  const drafts = await loadDrafts();
  list.innerHTML = drafts.length === 0
    ? `<div style="padding:16px 14px;font-size:11.5px;color:var(--text-muted);font-family:inherit;">No offline drafts saved.</div>`
    : drafts.map(d => `
      <div class="copilot-draft-item" data-uid="${d.uid}">
        <div class="copilot-draft-text">${d.textPayload}</div>
        <div class="copilot-draft-meta">📁 ${d.destination} · ${new Date(d.timestamp).toLocaleTimeString()}</div>
        <div class="copilot-draft-actions">
          <button class="copilot-draft-retry" data-uid="${d.uid}">↺ Retry</button>
          <button class="copilot-draft-trash" data-uid="${d.uid}">🗑 Delete</button>
        </div>
      </div>
    `).join('');

  list.querySelectorAll('.copilot-draft-retry').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      const draft = drafts.find(d => d.uid === uid);
      if (!draft) return;
      btn.textContent = '⏳';
      try {
        await secureFetch(`${BACKEND_URL}/api/append-note`, {
          method: 'POST',
          headers: buildAuthHeaders({
            'x-user-destination-key': draft.destinationKey,
            'x-target-platform': draft.destination
          }),
          body: JSON.stringify({ targetPageId: draft.containerId, noteText: draft.textPayload }),
        });
        await deleteDraft(uid);
        await renderDraftsTray();
      } catch { btn.textContent = '↺ Retry'; }
    });
  });

  list.querySelectorAll('.copilot-draft-trash').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteDraft(btn.dataset.uid);
      await renderDraftsTray();
    });
  });
}

// ─── Tier Gating ─────────────────────────────────────────────────────────────
function isPlatformLocked(platform) {
  if (currentTier === 'PREMIUM' || currentTier === 'TRIAL') return false;
  return platform !== 'clipboard';
}

async function refreshTierStatus() {
  const jwt = getStoredJWT();
  if (!jwt) return;
  chrome.runtime.sendMessage({ action: 'CHECK_TIER', jwt }, (data) => {
    if (data?.tier) currentTier = data.tier;
    if (data?.isPaywallDay) injectPaywallOverlay();
    else applyTierConstraintsToUI();
  });
}

function applyTierConstraintsToUI() {
  const platformSelect = document.getElementById('pkm-destination-selector');
  if (platformSelect) {
    Array.from(platformSelect.options).forEach(opt => {
      const platform = opt.value;
      if (isPlatformLocked(platform)) {
        opt.text = `🔒 ${opt.text.replace(/^🔒 \s*/, '')}`;
        opt.classList.add('copilot-locked-option');
      }
    });
  }
  const dropdown = document.getElementById('copilot-notebook-dropdown');
  if (dropdown) {
    Array.from(dropdown.options).forEach(opt => {
      const platform = opt.dataset.platform || 'notion';
      if (isPlatformLocked(platform)) {
        opt.text = `🔒 ${opt.text.replace(/^🔒 \s*/, '')}`;
        opt.classList.add('copilot-locked-option');
      }
    });
  }
  const usageWrap = document.getElementById('copilot-usage-bar-wrap');
  if (usageWrap && (currentTier === 'ACTIVE_FREE' || currentTier === 'EXPIRED_FREE')) {
    usageWrap.classList.add('visible');
  }
}

// ─── Paywall Overlay ─────────────────────────────────────────────────────────
function injectPaywallOverlay() {
  if (document.getElementById('copilot-paywall-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'copilot-paywall-overlay';
  overlay.innerHTML = `
    <div id="copilot-paywall-card">
      <div style="font-size:32px;margin-bottom:12px;">🚀</div>
      <h2>Your Free Trial Has Ended</h2>
      <p>Upgrade to Premium to keep syncing notes — or continue with the free plan (clipboard only, 2hr/day limit).</p>
      <button class="copilot-paywall-btn primary" id="copilot-upgrade-btn">⚡ Unlock Premium Access</button>
      <button class="copilot-paywall-btn secondary" id="copilot-free-btn">Continue with Free Plan</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('copilot-upgrade-btn')?.addEventListener('click', () => {
    window.open('https://your-stripe-checkout-url.com', '_blank');
  });
  document.getElementById('copilot-free-btn')?.addEventListener('click', () => {
    currentTier = 'ACTIVE_FREE';
    overlay.remove();
    applyTierConstraintsToUI();
  });
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────
function markExtensionUsed() {
  if (isExtensionUsedForCurrentVideo) return;
  isExtensionUsedForCurrentVideo = true;
  console.log('[YT-Copilot] Extension marked as used for current video');

  // Propagate to child frames (iframes) so they can start telemetry
  document.querySelectorAll('iframe').forEach(iframe => {
    try {
      iframe.contentWindow.postMessage({ type: 'COPILOT_MARK_USED' }, '*');
    } catch (e) {
      // Safe check
    }
  });
  
  const video = findVideoElement();
  if (video && !video.paused && !video.ended) {
    startHeartbeat();
  }
}

function attachVideoListeners(video) {
  if (video.dataset.copilotTelemetryAttached) return;
  video.dataset.copilotTelemetryAttached = 'true';
  
  console.log('[YT-Copilot] Attaching telemetry listeners to video element');
  
  video.addEventListener('play', () => {
    console.log('[YT-Copilot] Video play event');
    if (isExtensionUsedForCurrentVideo) {
      startHeartbeat();
    }
  });
  
  video.addEventListener('pause', () => {
    console.log('[YT-Copilot] Video pause event, stopping heartbeat');
    stopHeartbeat();
  });
  
  video.addEventListener('ended', () => {
    console.log('[YT-Copilot] Video ended event, stopping heartbeat');
    stopHeartbeat();
  });
  
  if (!video.paused && !video.ended) {
    console.log('[YT-Copilot] Video is already playing');
    if (isExtensionUsedForCurrentVideo) {
      startHeartbeat();
    }
  }
}

function setupVideoTelemetry() {
  console.log('[YT-Copilot] Setting up video telemetry observer...');
  const video = document.querySelector('video');
  if (video) {
    attachVideoListeners(video);
  }

  if (videoTelemetryObserver) {
    videoTelemetryObserver.disconnect();
  }
  
  videoTelemetryObserver = new MutationObserver(() => {
    const activeVideo = document.querySelector('video');
    if (activeVideo) {
      attachVideoListeners(activeVideo);
    }
  });
  
  videoTelemetryObserver.observe(document.body, { childList: true, subtree: true });
}

function startHeartbeat() {
  if (!isExtensionUsedForCurrentVideo) return;
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(async () => {
    try {
      const jwt = getStoredJWT();
      if (!jwt) return;

      const urlParams = new URLSearchParams(window.location.search);
      const videoId = urlParams.get('v') || 'unknown';
      const videoTitle = document.querySelector('ytd-watch-metadata h1.ytd-watch-metadata')?.textContent?.trim() || document.title || 'YouTube Video';
      
      let platformOrigin = 'youtube';
      const hostname = window.location.hostname;
      if (hostname.includes('udemy')) platformOrigin = 'udemy';
      else if (hostname.includes('coursera')) platformOrigin = 'coursera';
      else if (hostname.includes('edx')) platformOrigin = 'edx';
      else if (hostname.includes('linkedin')) platformOrigin = 'linkedin';
      else if (hostname.includes('unacademy')) platformOrigin = 'unacademy';
      else if (hostname.includes('scaler')) platformOrigin = 'scaler';
      else if (hostname.includes('pluralsight')) platformOrigin = 'pluralsight';
      else if (hostname.includes('frontendmasters')) platformOrigin = 'frontendmasters';
      else if (hostname.includes('udacity')) platformOrigin = 'udacity';
      else if (hostname.includes('khanacademy')) platformOrigin = 'khanacademy';

      const result = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          action: 'HEARTBEAT_TICK',
          jwt,
          videoId,
          videoTitle,
          platformOrigin,
          topicTag: 'Focus'
        }, resolve);
      });
      if (result?.status === 'blocked') { stopHeartbeat(); stopRecording(); showTimerExpiredState(); }
      else if (result?.minutesRemaining !== undefined) updateUsageBar(result.minutesRemaining, 120);
    } catch { /* silent */ }
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function updateUsageBar(minutesRemaining, maxMinutes) {
  const fill = document.getElementById('copilot-usage-bar-fill');
  const timer = document.getElementById('copilot-timer-display');
  if (!fill) return;
  const pct = Math.max(0, Math.min(100, (minutesRemaining / maxMinutes) * 100));
  fill.style.width = `${pct}%`;
  if (minutesRemaining <= 15) { fill.classList.add('critical'); timer?.classList.add('warning'); }
  if (timer) {
    const hrs = Math.floor(minutesRemaining / 60);
    const mins = minutesRemaining % 60;
    timer.textContent = hrs > 0 ? `⏳ ${hrs}h ${mins}m remaining` : `⏳ ${mins}m remaining`;
  }
}

function showTimerExpiredState() {
  const logo = document.getElementById('copilot-logo-trigger');
  const timer = document.getElementById('copilot-timer-display');
  if (logo) logo.style.opacity = '0.5';
  if (timer) { timer.textContent = '🚫 Daily limit reached'; timer.classList.add('warning'); }
}

// ─── Recording Control ────────────────────────────────────────────────────────
function stopRecording() {
  if (recognition) recognition.stop();
  isRecording = false;
  document.getElementById('copilot-mic-btn')?.classList.remove('recording');
  document.getElementById('copilot-logo-trigger')?.classList.remove('recording');
  // Only stop heartbeat if video is not actively playing
  const video = document.querySelector('video');
  const isVideoPlaying = video && !video.paused && !video.ended;
  if (!isVideoPlaying) {
    stopHeartbeat();
  }
}

// ─── AI Suggestion Engine ─────────────────────────────────────────────────────
function requestAISuggestion(currentText, imageBase64 = null) {
  clearTimeout(aiDebounceTimer);
  if (activeFetchController) { activeFetchController.abort(); activeFetchController = null; }
  const spinner = document.getElementById('copilot-ai-spinner');
  if (spinner) spinner.classList.add('active');

  aiDebounceTimer = setTimeout(async () => {
    try {
      await loadTranscriptEvents();

      const video = findVideoElement();
      const currentTime = video ? video.currentTime : 0;
      const transcriptContext = getTranscriptContextAtTime(currentTime, 60, 60);

      activeFetchController = new AbortController();
      const res = await fetch(`${BACKEND_URL}/api/generate-suggestions`, {
        method: 'POST',
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          currentText,
          transcriptContext,
          imageData: imageBase64
        }),
        signal: activeFetchController.signal,
      });
      const data = await res.json();
      if (data.success && data.suggestion) {
        activeSuggestion = data.suggestion;
        const well = document.getElementById('copilot-suggestion-well');
        if (well) well.innerHTML = `<span style="color:var(--accent-glow);font-weight:600;">💡 AI:</span> <span style="color:var(--text-primary);">${activeSuggestion}</span><div style="font-size:9.5px;color:var(--text-muted);margin-top:6px;">[Press Enter to dispatch]</div>`;
      }
      activeFetchController = null;
    } catch (err) {
      if (err.name === 'AbortError') return;
    } finally {
      if (!activeFetchController && spinner) spinner.classList.remove('active');
    }
  }, 950);
}

// ─── Main DOM Injection ───────────────────────────────────────────────────────
function injectCopilotUI() {
  if (IS_IFRAME) return;
  const existing = document.getElementById('yt-copilot-root');
  if (existing) {
    existing.style.display = 'flex';
    return;
  }
  if (!document.body) { setTimeout(injectCopilotUI, 300); return; }

  console.log('[YT-Copilot] Injecting UI 🚀');

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
  document.head.appendChild(fontLink);

  const root = document.createElement('div');
  root.id = 'yt-copilot-root';

  root.innerHTML = `
    <!-- Expanded Panel -->
    <div id="copilot-popout-panel">
      <div id="copilot-panel-header">
        <span id="copilot-panel-title">📝 YouTube Copilot</span>
        <span id="copilot-timer-display"></span>
      </div>
      <div id="copilot-suggestion-label">
        ✨ AI Suggestions
        <span id="copilot-ai-spinner">⚡ THINKING...</span>
      </div>
      <div id="copilot-suggestion-well">
        <span style="color:var(--text-muted);font-style:italic;">Suggestions appear as you type...</span>
      </div>
      <div id="copilot-input-row">
        <textarea id="copilot-textarea" placeholder="Speak or type your note... (Enter to send, Tab to accept AI recommendation)" rows="2"></textarea>
        <button class="copilot-icon-btn" id="copilot-send-btn" title="Send Note">➡️</button>
        <button class="copilot-icon-btn" id="copilot-mic-btn" title="Voice Note">🎙️</button>
        <button class="copilot-icon-btn" id="copilot-snap-btn" title="Capture Frame">📸</button>
      </div>
      <div style="padding:0 14px 10px;display:flex;align-items:center;justify-content:space-between;">
        <label id="copilot-toggle-wrap">
          <input type="checkbox" id="copilot-individual-page-toggle" />
          <span>New page for each note</span>
        </label>
        <button id="copilot-clear-btn">✕ Clear All</button>
      </div>
      <div style="padding:0 14px 6px;text-align:left;">
        <span id="copilot-status-msg" style="font-size:10.5px;color:var(--text-muted);font-family:inherit;"></span>
      </div>
      <div id="copilot-usage-bar-wrap">
        <div id="copilot-usage-bar-track">
          <div id="copilot-usage-bar-fill" style="width:100%;"></div>
        </div>
      </div>
    </div>

    <!-- Compact Badge Bar -->
    <div id="copilot-badge-bar">

      <!-- Auth Avatar — login state indicator -->
      <button id="copilot-auth-avatar" title="Sign in" aria-label="User account" class="copilot-auth-avatar--logged-out">
        <div id="copilot-auth-ring"></div>
        <img id="copilot-avatar-img" src="" alt="" />
        <svg id="copilot-avatar-anon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="8" r="4" stroke="#8DA9C4" stroke-width="1.6"/>
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#8DA9C4" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>

      <select id="pkm-destination-selector">
        <option value="notion">Notion Workspace</option>
        <option value="google_docs">Google Docs</option>
        <option value="coda">Coda Notebook</option>
      </select>
      <select id="copilot-notebook-dropdown">
        <option value="">⏳ Loading...</option>
      </select>
      <button id="copilot-new-file-btn" title="Create New Standalone Page">➕</button>



      <button id="copilot-logo-trigger" title="Open Copilot">
        <div id="copilot-draft-dot"></div>
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" stroke="#8DA9C4" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M12 2v20M3 7l9 5 9-5" stroke="#8DA9C4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <!-- Drafts Tray -->
    <div id="copilot-drafts-tray">
      <div id="copilot-drafts-header">⚠️ Offline Drafts</div>
      <div id="copilot-drafts-list"></div>
    </div>
  `;

  document.body.appendChild(root);
  console.log('[YT-Copilot] Root element appended ✅');

  wireUI();
  syncOAuthStatus();
  loadDropdownOptions();
  loadDrafts().then(drafts => updateDraftDot(drafts.length));
  refreshTierStatus();
}

// ─── Load Dropdown ────────────────────────────────────────────────────────────
async function loadDropdownOptions() {
  const dropdown = document.getElementById('copilot-notebook-dropdown');
  if (!dropdown) return;
  const platformSelect = document.getElementById('pkm-destination-selector');
  const rawPlatform = platformSelect ? platformSelect.value : 'notion';
  const platform = rawPlatform === 'google_docs' ? 'googledocs' : rawPlatform;

  chrome.storage.local.get([
    'copilot_key_notion', 'copilot_key_gdocs_id',
    'copilot_linked_notion', 'copilot_linked_google_docs',
    'copilot_linked_coda', 'copilot_jwt'
  ], async (keys) => {
    Object.assign(storedKeys, keys || {});

    const newFileBtn = document.getElementById('copilot-new-file-btn');
    if (newFileBtn) {
      newFileBtn.style.display = (platform === 'googledocs') ? 'none' : 'flex';
    }

    if (platform === 'googledocs') {
      if (storedKeys.copilot_linked_google_docs) {
        if (storedKeys.copilot_key_gdocs_id) {
          dropdown.innerHTML = `<option value="${storedKeys.copilot_key_gdocs_id}" data-platform="googledocs" data-type="doc">📄 Google Docs Document</option>`;
        } else {
          dropdown.innerHTML = `<option value="">⚠️ Set Document ID first</option>`;
        }
      } else {
        dropdown.innerHTML = `<option value="">⚠️ Connect Google Docs first</option>`;
      }
      return;
    }

    if (platform === 'coda') {
      if (!storedKeys.copilot_linked_coda) {
        dropdown.innerHTML = `<option value="">⚠️ Connect Coda first</option>`;
        return;
      }
      dropdown.innerHTML = `<option value="">⏳ Loading Coda pages...</option>`;
      try {
        const data = await secureFetch(`${BACKEND_URL}/api/coda/pages`, {
          headers: buildAuthHeaders(),
        });

        let optionsHtml = `<option value="default_coda_page" data-platform="coda" data-type="workspace">📚 My Study Log (Default Page)</option>`;
        if (data.success && data.pages?.length > 0) {
          optionsHtml += data.pages.map(p =>
            `<option value="${p.id}" data-platform="coda" data-type="page">${p.name}</option>`
          ).join('');
          dropdown.innerHTML = optionsHtml;
          const savedId = localStorage.getItem('copilot_selected_page_id');
          if (savedId && savedId !== 'auto_provisioned_coda' && (savedId === 'default_coda_page' || data.pages.some(p => p.id === savedId))) {
            dropdown.value = savedId;
          }
        } else {
          dropdown.innerHTML = optionsHtml;
        }
      } catch (err) {
        dropdown.innerHTML = `<option value="default_coda_page" data-platform="coda" data-type="workspace">📚 My Study Log (Default Page)</option>`;
      }
      return;
    }

    if (!storedKeys.copilot_linked_notion) {
      dropdown.innerHTML = `<option value="">⚠️ Connect Notion first</option>`;
      return;
    }

    dropdown.innerHTML = `<option value="">⏳ Loading Notion notebooks...</option>`;
    try {
      const data = await secureFetch(`${BACKEND_URL}/api/notion/pages`, {
        headers: buildAuthHeaders(),
      });

      let optionsHtml = `<option value="workspace_root" data-platform="notion" data-type="workspace">📁 [New Page] Workspace Root</option>`;
      if (data.success && data.pages?.length > 0) {
        optionsHtml += data.pages.map(p =>
          `<option value="${p.id}" data-platform="notion" data-type="${p.object || 'page'}">${p.title}</option>`
        ).join('');
        dropdown.innerHTML = optionsHtml;
        const savedId = localStorage.getItem('copilot_selected_page_id');
        if (savedId && savedId !== storedKeys.copilot_key_gdocs_id && (savedId === 'workspace_root' || data.pages.some(p => p.id === savedId))) {
          dropdown.value = savedId;
        }
      } else {
        dropdown.innerHTML = optionsHtml + '<option value="">⚠️ No notebooks found</option>';
      }
    } catch (err) {
      dropdown.innerHTML = '<option value="">📋 Clipboard mode</option>';
    }
  });
}

// ─── Auth Avatar State ────────────────────────────────────────────────────────
function refreshAuthAvatar() {
  chrome.storage.local.get(['copilot_jwt','copilot_user_name','copilot_user_email','copilot_avatar_url'], (data) => {
    const btn  = document.getElementById('copilot-auth-avatar');
    const img  = document.getElementById('copilot-avatar-img');
    const anon = document.getElementById('copilot-avatar-anon');
    if (!btn) return;
    const loggedIn = !!data.copilot_jwt;
    if (loggedIn) {
      btn.classList.replace('copilot-auth-avatar--logged-out','copilot-auth-avatar--logged-in');
      btn.title = (data.copilot_user_name || 'Signed in') + ' — click for options';
      if (data.copilot_avatar_url) {
        img.src = data.copilot_avatar_url; img.style.display = 'block';
        if (anon) anon.style.display = 'none';
      } else {
        img.style.display = 'none'; if (anon) anon.style.display = 'none';
        let el = btn.querySelector('#copilot-av-init');
        if (!el) { el = document.createElement('span'); el.id='copilot-av-init'; btn.appendChild(el); }
        const name = data.copilot_user_name || data.copilot_user_email || 'U';
        el.textContent = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        el.style.cssText = 'font-size:10px;font-weight:700;color:#DAEDF7;font-family:inherit;pointer-events:none;';
      }
    } else {
      btn.classList.replace('copilot-auth-avatar--logged-in','copilot-auth-avatar--logged-out');
      btn.title = 'Sign in with Google';
      img.src=''; img.style.display='none';
      if (anon) anon.style.display='block';
      const el = btn.querySelector('#copilot-av-init'); if (el) el.remove();
    }
  });
}

function showAuthTooltip(anchor, data) {
  const old = document.getElementById('copilot-auth-tooltip');
  if (old) { old.remove(); return; }
  const name = data.copilot_user_name || 'Signed In';
  const email = data.copilot_user_email || '';
  const av = data.copilot_avatar_url || '';
  const tip = document.createElement('div');
  tip.id = 'copilot-auth-tooltip';
  tip.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 14px 10px;">
      ${av ? `<img src="${av}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid #34A853;"/>` : `<div style="width:36px;height:36px;border-radius:50%;background:rgba(141,169,196,0.2);border:2px solid #34A853;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#DAEDF7;">${name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>`}
      <div style="overflow:hidden;">
        <div style="font-size:12px;font-weight:600;color:#DAEDF7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;">${name}</div>
        <div style="font-size:10px;color:rgba(141,169,196,0.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;">${email}</div>
        <div style="font-size:9.5px;color:#34A853;margin-top:2px;font-weight:600;">● Signed in</div>
      </div>
    </div>
    <div style="border-top:1px solid rgba(141,169,196,0.14);padding:8px 14px 10px;display:flex;flex-direction:column;gap:6px;">
      <button id="cpa-signout" style="background:rgba(173,52,62,0.12);border:1px solid rgba(173,52,62,0.3);border-radius:8px;color:#AD343E;font-size:11px;padding:7px 10px;cursor:pointer;font-family:inherit;font-weight:500;text-align:left;">🚪 Sign Out</button>
    </div>`;
  const rect = anchor.getBoundingClientRect();
  tip.style.cssText = `position:fixed;bottom:${window.innerHeight-rect.top+8}px;right:${window.innerWidth-rect.right}px;width:210px;background:rgba(24,34,48,0.97);border:1px solid rgba(141,169,196,0.22);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.65);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);z-index:2147483647;font-family:'Inter',system-ui,sans-serif;animation:copilot-slide-down 0.2s cubic-bezier(0.34,1.56,0.64,1) both;pointer-events:auto;`;
  document.getElementById('yt-copilot-root').appendChild(tip);
  tip.querySelector('#cpa-signout')?.addEventListener('click', () => {
    chrome.storage.local.remove(['copilot_jwt','copilot_user_name','copilot_user_email','copilot_avatar_url','copilot_tier'], () => { tip.remove(); refreshAuthAvatar(); });
  });
  const outside = (e) => { if (!tip.contains(e.target) && e.target!==anchor) { tip.remove(); document.removeEventListener('click',outside,true); } };
  setTimeout(() => document.addEventListener('click',outside,true), 100);
}

// ─── Wire UI Events ───────────────────────────────────────────────────────────
function wireUI() {
  const logo = document.getElementById('copilot-logo-trigger');
  const panel = document.getElementById('copilot-popout-panel');
  const textarea = document.getElementById('copilot-textarea');
  const micBtn = document.getElementById('copilot-mic-btn');
  const snapBtn = document.getElementById('copilot-snap-btn');
  const clearBtn = document.getElementById('copilot-clear-btn');
  const dropdown = document.getElementById('copilot-notebook-dropdown');
  const status = document.getElementById('copilot-status-msg');
  const draftsBtn = document.getElementById('copilot-draft-dot');
  const tray = document.getElementById('copilot-drafts-tray');
  const indivToggle = document.getElementById('copilot-individual-page-toggle');
  const authAvatarBtn = document.getElementById('copilot-auth-avatar');

  // Avatar init
  refreshAuthAvatar();
  chrome.storage.onChanged.addListener((changes) => {
    if ('copilot_jwt' in changes || 'copilot_avatar_url' in changes || 'copilot_user_name' in changes) refreshAuthAvatar();
  });
  authAvatarBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.storage.local.get(['copilot_jwt','copilot_user_name','copilot_user_email','copilot_avatar_url'], (data) => {
      if (data.copilot_jwt) showAuthTooltip(authAvatarBtn, data);
      else chrome.runtime.sendMessage({action:'OPEN_WELCOME_PAGE'});
    });
  });


  let panelOpen = false;

  if (indivToggle) {
    chrome.storage.local.get(['copilot_notion_individual_page'], (res) => {
      indivToggle.checked = !!res.copilot_notion_individual_page;
    });
    indivToggle.addEventListener('change', () => {
      chrome.storage.local.set({ copilot_notion_individual_page: indivToggle.checked });
    });
  }

  const platformSelect = document.getElementById('pkm-destination-selector');
  if (platformSelect) {
    const savedPlatform = localStorage.getItem('copilot_selected_platform') || 'notion';
    platformSelect.value = savedPlatform === 'googledocs' ? 'google_docs' : savedPlatform;

    async function connectPlatform(platform) {
      const jwt = getStoredJWT();
      if (!jwt) {
        alert('Please sign in to YouTube Copilot first. Opening setup page...');
        chrome.runtime.sendMessage({ action: 'OPEN_WELCOME_PAGE' });
        platformSelect.value = 'notion';
        localStorage.setItem('copilot_selected_platform', 'notion');
        await loadDropdownOptions();
        return;
      }
      const userId = getUserIdFromJWT(jwt);
      if (!userId) {
        alert('Session expired or invalid. Opening setup page to sign in again...');
        chrome.runtime.sendMessage({ action: 'OPEN_WELCOME_PAGE' });
        platformSelect.value = 'notion';
        localStorage.setItem('copilot_selected_platform', 'notion');
        await loadDropdownOptions();
        return;
      }

      // Check if platform supports Personal API Tokens
      const isTokenPlatform = ['coda'].includes(platform);
      if (isTokenPlatform) {
        const displayLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
        const tokenInput = prompt(`Enter your ${displayLabel} Personal API Token (or leave blank to use mock one-tap integration):`);
        if (tokenInput !== null && tokenInput.trim() !== '') {
          const cleanToken = tokenInput.trim();
          setStatus(`⏳ Saving ${platform} token...`, 'var(--accent-glow)');

          try {
            const res = await fetch(`${BACKEND_URL}/api/auth/store-token`, {
              method: 'POST',
              headers: buildAuthHeaders(),
              body: JSON.stringify({ platform, token: cleanToken })
            });
            const data = await res.json();
            if (data.success) {
              setStatus('✅ Connected!', 'var(--status-success)');
              setTimeout(() => setStatus(''), 2000);
              storedKeys[`copilot_linked_${platform}`] = true;
              localStorage.setItem('copilot_selected_platform', platform);
              await loadDropdownOptions();
            } else {
              throw new Error(data.error || 'Failed to save token');
            }
          } catch (err) {
            setStatus(`❌ Connection failed: ${err.message}`, 'var(--status-recording)');
            setTimeout(() => setStatus(''), 3000);
            platformSelect.value = 'notion';
            localStorage.setItem('copilot_selected_platform', 'notion');
            await loadDropdownOptions();
          }
          return;
        }
      }

      setStatus(`⏳ Connecting to ${platform}...`, 'var(--accent-glow)');
      chrome.runtime.sendMessage({
        action: 'START_OAUTH',
        platform,
        userId
      }, async (res) => {
        if (res?.success) {
          setStatus('✅ Connected!', 'var(--status-success)');
          setTimeout(() => setStatus(''), 2000);

          const key = `copilot_linked_${platform === 'googledocs' ? 'google_docs' : platform}`;
          storedKeys[key] = true;
          localStorage.setItem('copilot_selected_platform', platform);

          if (platform === 'googledocs') {
            const docIdInput = prompt('Enter your Google Document ID or paste the full Document URL:');
            if (docIdInput && docIdInput.trim()) {
              const docIdMatch = docIdInput.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
              const docId = docIdMatch ? docIdMatch[1] : docIdInput.trim();
              chrome.storage.local.set({ copilot_key_gdocs_id: docId }, async () => {
                storedKeys.copilot_key_gdocs_id = docId;
                await loadDropdownOptions();
              });
            } else {
              alert('Document ID is required for Google Docs sync.');
              platformSelect.value = 'notion';
              localStorage.setItem('copilot_selected_platform', 'notion');
              await loadDropdownOptions();
            }
          } else {
            await loadDropdownOptions();
          }
        } else {
          setStatus(`❌ Connection failed: ${res?.error || 'Cancelled'}`, 'var(--status-recording)');
          setTimeout(() => setStatus(''), 3000);
          platformSelect.value = 'notion';
          localStorage.setItem('copilot_selected_platform', 'notion');
          await loadDropdownOptions();
        }
      });
    }

    platformSelect.addEventListener('change', async () => {
      const rawPlatform = platformSelect.value;
      const platform = rawPlatform === 'google_docs' ? 'googledocs' : rawPlatform;

      if (platform === 'googledocs' && !storedKeys.copilot_linked_google_docs) {
        await connectPlatform('googledocs');
      } else if (platform === 'notion' && !storedKeys.copilot_linked_notion) {
        await connectPlatform('notion');
      } else if (platform === 'coda' && !storedKeys.copilot_linked_coda) {
        await connectPlatform('coda');
      } else {
        localStorage.setItem('copilot_selected_platform', platform);
        await loadDropdownOptions();
      }
    });
  }

  function setStatus(msg, color = 'var(--text-muted)', isHTML = false) {
    if (status) {
      if (isHTML) {
        status.innerHTML = msg;
      } else {
        status.textContent = msg;
      }
      status.style.color = color;
    }
  }

  function resetSuggestionWell() {
    activeSuggestion = '';
    const well = document.getElementById('copilot-suggestion-well');
    if (well) well.innerHTML = `<span style="color:var(--text-muted);font-style:italic;">Suggestions appear as you type...</span>`;
  }

  async function dispatchNote(noteText, isAISuggestion = false) {
    textarea.classList.add('dispatch-flash');
    setTimeout(() => textarea.classList.remove('dispatch-flash'), 350);

    const platformSelect = document.getElementById('pkm-destination-selector');
    const rawPlatform = platformSelect ? platformSelect.value : 'notion';
    const platform = rawPlatform === 'google_docs' ? 'googledocs' : rawPlatform;
    const containerId = dropdown?.value || '';
    const selectedOpt = dropdown?.options[dropdown.selectedIndex];
    const parentType = selectedOpt?.dataset.type || 'page';
    const createIndividualPage = indivToggle ? indivToggle.checked : false;
    const videoTitle = document.querySelector('ytd-watch-metadata h1.ytd-watch-metadata')?.textContent?.trim() || document.title || 'YouTube Copilot Note';

    if (isPlatformLocked(platform)) {
      await navigator.clipboard.writeText(noteText).catch(() => { });
      textarea.value = '';
      resetSuggestionWell();
      setStatus('📋 Copied to clipboard!', 'var(--accent-glow)');
      setTimeout(() => { panel?.classList.remove('open'); panelOpen = false; setStatus(''); }, 1500);
      return;
    }

    setStatus('⏳ Syncing...', 'var(--accent-glow)');

    // Removed legacy Anytype local vault daemon sync. Now routes through standard append-note secureFetch.

    textarea.value = '';
    resetSuggestionWell();

    try {
      const data = await secureFetch(
        `${BACKEND_URL}/api/append-note`,
        {
          method: 'POST',
          headers: buildAuthHeaders(),
          body: JSON.stringify({
            targetPageId: containerId,
            parentType,
            noteText,
            title: videoTitle,
            createIndividualPage
          })
        },
        { platform, containerId, text: noteText }
      );
      if (data && data.url) {
        if (platform === 'googledocs') {
          setStatus(`📄 Note appended! <a href="${data.url}" target="_blank" style="color:var(--accent-glow);text-decoration:underline;font-weight:600;margin-left:5px;">View Doc</a>`, 'var(--status-success)', true);
        } else {
          setStatus(`✅ Saved! <a href="${data.url}" target="_blank" style="color:var(--accent-glow);text-decoration:underline;font-weight:600;margin-left:5px;">View Page</a>`, 'var(--status-success)', true);
        }
        console.log(`[YT-Copilot] Created destination: ${data.url}`);
        setTimeout(() => {
          if (status && status.innerHTML.includes(data.url)) {
            setStatus('');
          }
        }, 8000);
      } else {
        setStatus(isAISuggestion ? '✨ Saved AI Note!' : '✅ Saved!', 'var(--status-success)');
        setTimeout(() => { panel?.classList.remove('open'); panelOpen = false; setStatus(''); }, 1500);
      }
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'var(--status-recording)');
    }
  }

  logo?.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panel?.classList.toggle('open', panelOpen);
    if (panelOpen) {
      setTimeout(() => textarea?.focus(), 260);
      markExtensionUsed();
    }
    tray?.classList.remove('open');
  });

  draftsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = tray?.classList.contains('open');
    if (!isOpen) renderDraftsTray();
    tray?.classList.toggle('open', !isOpen);
  });

  dropdown?.addEventListener('change', () => {
    localStorage.setItem('copilot_selected_page_id', dropdown.value);
    resetSuggestionWell();
    setStatus('📁 Destination updated', 'var(--status-success)');
    setTimeout(() => setStatus(''), 1800);
  });

  const newFileBtn = document.getElementById('copilot-new-file-btn');
  newFileBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const title = prompt('Enter a name for the new Notion page:');
    if (!title || !title.trim()) return;

    setStatus('⏳ Creating page...', 'var(--accent-glow)');
    newFileBtn.textContent = '⏳';
    newFileBtn.disabled = true;

    try {
      const parentId = dropdown?.value === 'workspace_root' ? '' : (dropdown?.value || '');
      const selectedOpt = dropdown?.options[dropdown?.selectedIndex];
      const parentType = selectedOpt?.dataset.type || 'page';

      const data = await secureFetch(`${BACKEND_URL}/api/notion/create-notebook`, {
        method: 'POST',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ title: title.trim(), parentPageId: parentId, parentType })
      });

      if (data.success && data.pageId) {
        setStatus('✅ Page created! Reloading list...', 'var(--status-success)');
        // Reload list and select the new page
        await loadDropdownOptions();
        dropdown.value = data.pageId;
        localStorage.setItem('copilot_selected_page_id', data.pageId);
        setStatus('✅ New page selected!', 'var(--status-success)');
        setTimeout(() => setStatus(''), 2000);
      } else {
        throw new Error(data.error || 'Failed to create page');
      }
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'var(--status-recording)');
    } finally {
      newFileBtn.textContent = '➕';
      newFileBtn.disabled = false;
    }
  });

  clearBtn?.addEventListener('click', () => {
    if (textarea) textarea.value = '';
    resetSuggestionWell();
    textarea?.focus();
  });

  textarea?.addEventListener('input', () => {
    markExtensionUsed();
    const text = textarea.value.trim();
    if (!text) { resetSuggestionWell(); return; }
    requestAISuggestion(text);
  });

  textarea?.addEventListener('keydown', async (e) => {
    if (e.key === 'Tab') {
      if (activeSuggestion) {
        e.preventDefault();
        await dispatchNote(activeSuggestion, true);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const noteText = textarea.value.trim();
      if (noteText) {
        await dispatchNote(noteText, false);
      }
    }
  });

  const sendBtn = document.getElementById('copilot-send-btn');
  sendBtn?.addEventListener('click', async () => {
    const noteText = textarea?.value?.trim();
    if (noteText) {
      await dispatchNote(noteText, false);
    }
  });

  micBtn?.addEventListener('click', () => {
    markExtensionUsed();
    if (isRecording) { stopRecording(); return; }
    if (currentTier === 'EXPIRED_FREE') { setStatus('🚫 Daily limit reached.', 'var(--status-amber)'); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus('⚠️ Speech API not available', 'var(--status-amber)'); return; }

    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      isRecording = true;
      micBtn.innerHTML = '🛑';
      micBtn.classList.add('recording');
      logo?.classList.add('recording');
      setStatus('🎙️ Listening...', 'var(--status-recording)');
      if (currentTier === 'ACTIVE_FREE') startHeartbeat();
    };

    recognition.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (final) {
        const macroResult = applyVoiceMacros(final, textarea);
        if (!macroResult.handled) {
          if (macroResult.serverCommand) handleServerVoiceCommand(macroResult.command, textarea);
          else { textarea.value = (textarea.value + ' ' + final).trim(); requestAISuggestion(textarea.value); }
        }
      }
      if (interim) setStatus(`"${interim}"`, 'var(--text-muted)');
    };

    recognition.onerror = () => { stopRecording(); setStatus('', ''); };
    recognition.onend = () => { stopRecording(); setStatus('', ''); };
    recognition.start();
  });

  snapBtn?.addEventListener('click', async () => {
    markExtensionUsed();
    const platformSelect = document.getElementById('pkm-destination-selector');
    const rawPlatform = platformSelect ? platformSelect.value : 'notion';
    const platform = rawPlatform === 'google_docs' ? 'googledocs' : rawPlatform;
    const containerId = dropdown?.value;
    if (!containerId) { setStatus('⚠️ Select a destination first', 'var(--status-amber)'); return; }
    const selectedOpt = dropdown?.options[dropdown.selectedIndex];
    const parentType = selectedOpt?.dataset.type || 'page';
    const createIndividualPage = indivToggle ? indivToggle.checked : false;
    const videoTitle = document.querySelector('ytd-watch-metadata h1.ytd-watch-metadata')?.textContent?.trim() || document.title || 'YouTube Copilot Frame Capture';

    const imageBase64 = await captureVideoFrameWithIframeFallback();
    if (!imageBase64) { setStatus('⚠️ Video frame not ready', 'var(--status-amber)'); return; }
    const video = findVideoElement();
    const timestamp = video?.currentTime || 0;
    snapBtn.innerHTML = '⏳';
    setStatus('📸 Uploading frame...', 'var(--accent-glow)');
    try {
      const data = await secureFetch(
        `${BACKEND_URL}/api/append-snapshot`,
        {
          method: 'POST',
          headers: buildAuthHeaders(),
          body: JSON.stringify({
            targetPageId: containerId,
            parentType,
            imageData: imageBase64,
            timestamp,
            title: videoTitle,
            createIndividualPage
          })
        },
        { platform, containerId, text: '[Snapshot]' }
      );
      requestAISuggestion('[Analyze Captured Frame Context]', imageBase64);
      if (data && data.url) {
        if (platform === 'googledocs') {
          setStatus(`📄 Snapshot appended! <a href="${data.url}" target="_blank" style="color:var(--accent-glow);text-decoration:underline;font-weight:600;margin-left:5px;">View Doc</a>`, 'var(--status-success)', true);
        } else {
          setStatus(`✅ Snapshot saved! <a href="${data.url}" target="_blank" style="color:var(--accent-glow);text-decoration:underline;font-weight:600;margin-left:5px;">View Page</a>`, 'var(--status-success)', true);
        }
        console.log(`[YT-Copilot] Created Gist/Page/Doc: ${data.url}`);
        setTimeout(() => {
          if (status && status.innerHTML.includes(data.url)) {
            setStatus('');
          }
        }, 8000);
      } else {
        setStatus('✅ Snapshot saved!', 'var(--status-success)');
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'var(--status-recording)');
    } finally {
      snapBtn.innerHTML = '📸';
    }
  });
}

// ─── Server Voice Command ─────────────────────────────────────────────────────
async function handleServerVoiceCommand(command, textareaEl) {
  const currentText = textareaEl.value.trim();
  if (!currentText) return;
  const status = document.getElementById('copilot-status-msg');
  if (status) { status.textContent = '🤖 Processing command...'; status.style.color = 'var(--accent-glow)'; }
  try {
    const data = await secureFetch(`${BACKEND_URL}/api/edit-intent`, {
      method: 'POST', headers: buildAuthHeaders(),
      body: JSON.stringify({ currentText, voiceCommand: command }),
    });
    if (data.success && data.updatedText) {
      textareaEl.value = data.updatedText;
      if (status) { status.textContent = '✅ Text updated'; status.style.color = 'var(--status-success)'; }
      setTimeout(() => { if (status) status.textContent = ''; }, 1800);
    }
  } catch {
    if (status) { status.textContent = '❌ Command failed'; status.style.color = 'var(--status-recording)'; }
  }
}

// ─── Tier Refresh Message Listener ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'REFRESH_TIER_STATUS') refreshTierStatus();
});

// ─── FIXED MutationObserver & SPA Event Listeners ───────────────────────────
let lastUrl = location.href;

async function handleSPATransition() {
  if (IS_IFRAME) return;
  await keysLoadedPromise;
  const hostname = window.location.hostname;
  const isOtherPlatform = hostname.includes('udemy') || 
                          hostname.includes('coursera') || 
                          hostname.includes('edx') || 
                          hostname.includes('linkedin') || 
                          hostname.includes('unacademy') || 
                          hostname.includes('scaler') || 
                          hostname.includes('pluralsight') || 
                          hostname.includes('frontendmasters') || 
                          hostname.includes('udacity') || 
                          hostname.includes('khanacademy');

  const isWatchPage = window.location.pathname.startsWith('/watch') || 
                      window.location.search.includes('v=') || 
                      isOtherPlatform;
  
  // Clear historical transcript buffer on transition
  historicalTranscriptBuffer = [];
  
  // Clear suggestions
  const well = document.getElementById('copilot-suggestion-well');
  if (well) {
    well.innerHTML = `<span style="color:var(--text-muted);font-style:italic;">Suggestions appear as you type...</span>`;
  }
  
  // Call UI injection / visibility check
  injectCopilotUI();
  
  // If we are on a watch page, refresh options
  if (isWatchPage) {
    loadDropdownOptions();
    isExtensionUsedForCurrentVideo = false;
    const panel = document.getElementById('copilot-popout-panel');
    if (panel && panel.classList.contains('open')) {
      markExtensionUsed();
    }
    setupVideoTelemetry();
  } else {
    if (videoTelemetryObserver) {
      videoTelemetryObserver.disconnect();
      videoTelemetryObserver = null;
    }
    isExtensionUsedForCurrentVideo = false;
    stopHeartbeat();
  }
}

// 1. YouTube specific SPA event
document.addEventListener('yt-navigate-finish', () => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    clearTimeout(injectionDebounceTimer);
    injectionDebounceTimer = setTimeout(handleSPATransition, 500);
  }
});

// 2. Fallback MutationObserver
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    clearTimeout(injectionDebounceTimer);
    injectionDebounceTimer = setTimeout(handleSPATransition, 500);
  }
});

if (document.body) {
  observer.observe(document.body, { childList: true });
} else {
  window.addEventListener('DOMContentLoaded', () => {
    if (document.body) {
      observer.observe(document.body, { childList: true });
    }
  });
}

// ─── Cross-Frame Messages & Iframe Fallbacks ──────────────────────────────────
let frameCaptureResolver = null;

if (IS_IFRAME) {
  // Listen for requests inside the iframe
  window.addEventListener('message', async (event) => {
    if (!event.data) return;

    if (event.data.type === 'COPILOT_CAPTURE_REQUEST') {
      const frameData = await captureVideoFrame();
      try {
        event.source.postMessage({ type: 'COPILOT_CAPTURE_RESPONSE', data: frameData }, event.origin);
      } catch (e) {
        window.parent.postMessage({ type: 'COPILOT_CAPTURE_RESPONSE', data: frameData }, '*');
      }
    }

    if (event.data.type === 'COPILOT_MARK_USED') {
      isExtensionUsedForCurrentVideo = true;
      console.log('[YT-Copilot Iframe] Extension marked as used by parent');
      const video = findVideoElement();
      if (video && !video.paused && !video.ended) {
        startHeartbeat();
      }
    }
  });

  // Relay video state changes from inside iframe to parent page
  function forwardTelemetryEvent(eventName) {
    window.parent.postMessage({ type: 'COPILOT_TELEMETRY_EVENT', event: eventName }, '*');
  }

  function setupIframeTelemetry() {
    const video = findVideoElement();
    if (video) {
      if (video.dataset.copilotIframeTelemetryAttached) return;
      video.dataset.copilotIframeTelemetryAttached = 'true';
      console.log('[YT-Copilot Iframe] Telemetry listeners attached to iframe video');
      
      video.addEventListener('play', () => forwardTelemetryEvent('play'));
      video.addEventListener('pause', () => forwardTelemetryEvent('pause'));
      video.addEventListener('ended', () => forwardTelemetryEvent('ended'));
      
      if (!video.paused && !video.ended) {
        forwardTelemetryEvent('play');
      }
    }
  }

  setupIframeTelemetry();
  const iframeObserver = new MutationObserver(setupIframeTelemetry);
  if (document.body) {
    iframeObserver.observe(document.body, { childList: true, subtree: true });
  }
} else {
  // Listen for iframe telemetry events on the parent page
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'COPILOT_TELEMETRY_EVENT') {
      console.log('[YT-Copilot Main] Received telemetry event from iframe:', event.data.event);
      if (event.data.event === 'play') {
        if (isExtensionUsedForCurrentVideo) {
          startHeartbeat();
        }
      } else if (event.data.event === 'pause' || event.data.event === 'ended') {
        stopHeartbeat();
      }
    }

    if (event.data.type === 'COPILOT_CAPTURE_RESPONSE') {
      if (frameCaptureResolver) {
        frameCaptureResolver(event.data.data);
        frameCaptureResolver = null;
      }
    }
  });
}

async function captureVideoFrameWithIframeFallback() {
  // 1. Try local viewport capture
  const directData = await captureVideoFrame();
  if (directData) return directData;

  // 2. If no local video element, find and sort child iframes by visual area (largest first)
  const iframes = Array.from(document.querySelectorAll('iframe')).map(iframe => {
    const rect = iframe.getBoundingClientRect();
    return {
      element: iframe,
      area: rect.width * rect.height
    };
  }).filter(item => item.area > 0)
    .sort((a, b) => b.area - a.area);

  if (iframes.length === 0) return null;

  // Try iframes sequentially from largest to smallest to avoid webcam-container race conditions
  for (const item of iframes) {
    const iframe = item.element;
    const data = await new Promise((resolve) => {
      frameCaptureResolver = resolve;
      
      const timeout = setTimeout(() => {
        if (frameCaptureResolver === resolve) {
          console.warn('[YT-Copilot] Frame capture request to iframe timed out');
          frameCaptureResolver(null);
          frameCaptureResolver = null;
        }
      }, 1500);

      try {
        iframe.contentWindow.postMessage({ type: 'COPILOT_CAPTURE_REQUEST' }, '*');
      } catch (e) {
        clearTimeout(timeout);
        if (frameCaptureResolver === resolve) {
          frameCaptureResolver(null);
          frameCaptureResolver = null;
        }
      }
    });

    if (data && data.length > 100) {
      return data;
    }
  }

  return null;
}

// Initial check / injection
handleSPATransition();
