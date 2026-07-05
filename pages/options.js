// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — OPTIONS SCRIPT (pages/options.js)
// ==============================================================================

// ─── Sidebar Navigation ───────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.section;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`section-${target}`)?.classList.add('active');
  });
});

// ─── Toast helper ─────────────────────────────────────────────────────────────
function showToast(msg = '✅ Saved!', color = 'var(--success)') {
  const toast = document.getElementById('save-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.color = color;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── JWT Parsing Helper ───────────────────────────────────────────────────────
function parseSupabaseJWT(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Failed to parse JWT:', e);
    return null;
  }
}

// ─── OAuth Status Update UI Helpers ──────────────────────────────────────────
function updatePlatformUI(platform, isLinked) {
  let domPlatform = platform;
  if (platform === 'google_docs') domPlatform = 'gdocs';

  const statusEl = document.getElementById(`opt-${domPlatform}-status`);
  const connectBtn = document.getElementById(`btn-opt-connect-${domPlatform}`);
  const disconnectBtn = document.getElementById(`btn-opt-disconnect-${domPlatform}`);

  if (!statusEl) return;

  if (isLinked) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status-badge connected';
    if (connectBtn) connectBtn.style.display = 'none';
    if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
  } else {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status-badge disconnected';
    if (connectBtn) connectBtn.style.display = 'inline-block';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
  }
}

function triggerOAuthFlow(platform) {
  chrome.storage.local.get(['copilot_jwt'], (data) => {
    const jwt = data.copilot_jwt;
    if (!jwt) {
      alert('Please authenticate with Google first on the Account page.');
      return;
    }
    const payload = parseSupabaseJWT(jwt);
    const userId = payload ? payload.sub : null;
    if (!userId) {
      alert('Invalid authentication token. Please re-authenticate on the Account page.');
      return;
    }

    let messagePlatform = platform;
    if (platform === 'google_docs') messagePlatform = 'googledocs';

    const connectBtn = document.getElementById(`btn-opt-connect-${platform === 'google_docs' ? 'gdocs' : platform}`);
    


    const isTokenPlatform = ['coda'].includes(platform);
    if (isTokenPlatform) {
      const displayLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
      const tokenInput = prompt(`Enter your ${displayLabel} Personal API Token (or leave blank to use mock one-tap integration):`);
      if (tokenInput === null) {
        if (connectBtn) connectBtn.disabled = false;
        return;
      }
      
      if (tokenInput.trim() !== '') {
        const cleanToken = tokenInput.trim();
        if (connectBtn) connectBtn.disabled = true;
        
        chrome.storage.local.get(['copilot_backend_url', 'copilot_app_token'], (settings) => {
          const backendUrl = settings.copilot_backend_url || 'http://localhost:3000';
          const appToken = settings.copilot_app_token || 'MakeUpASuperLongPassword123!';
          
          fetch(`${backendUrl}/api/auth/store-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${jwt}`,
              'x-copilot-token': appToken
            },
            body: JSON.stringify({ platform, token: cleanToken })
          })
          .then(res => res.json())
          .then(resData => {
            if (connectBtn) connectBtn.disabled = false;
            if (resData.success) {
              chrome.storage.local.set({ [`copilot_linked_${platform}`]: true }, () => {
                showToast(`✅ Connected to ${displayLabel} successfully via API Token!`);
                updatePlatformUI(platform, true);
              });
            } else {
              alert(`Failed to save token: ${resData.error}`);
            }
          })
          .catch(err => {
            if (connectBtn) connectBtn.disabled = false;
            alert(`Network error: ${err.message}`);
          });
        });
        return;
      }
    }

    if (connectBtn) connectBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'START_OAUTH', platform: messagePlatform, userId }, (res) => {
      if (connectBtn) connectBtn.disabled = false;
      if (res?.success) {
        showToast('✅ Connected successfully!');
        updatePlatformUI(platform, true);
      } else {
        showToast(`❌ Connection failed: ${res?.error || 'Auth cancelled'}`, 'var(--danger)');
      }
    });
  });
}

function triggerDisconnectFlow(platform) {
  let platformLabel = platform === 'google_docs' ? 'Google Docs' : platform.charAt(0).toUpperCase() + platform.slice(1);
  if (!confirm(`Are you sure you want to disconnect ${platformLabel}?`)) return;

  const disconnectBtn = document.getElementById(`btn-opt-disconnect-${platform === 'google_docs' ? 'gdocs' : platform}`);
  if (disconnectBtn) disconnectBtn.disabled = true;

  chrome.storage.local.get(['copilot_jwt', 'copilot_backend_url', 'copilot_app_token'], (data) => {
    const jwt = data.copilot_jwt;
    const backendUrl = data.copilot_backend_url || 'http://localhost:3000';
    const appToken = data.copilot_app_token || 'MakeUpASuperLongPassword123!';
    
    if (!jwt) {
      chrome.storage.local.set({ [`copilot_linked_${platform}`]: false }, () => {
        if (disconnectBtn) disconnectBtn.disabled = false;
        updatePlatformUI(platform, false);
        showToast('Disconnected locally.');
      });
      return;
    }

    fetch(`${backendUrl}/api/auth/disconnect/${platform}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
        'x-copilot-token': appToken
      }
    })
    .then(res => res.json())
    .then(resData => {
      if (disconnectBtn) disconnectBtn.disabled = false;
      if (resData.success) {
        chrome.storage.local.set({ [`copilot_linked_${platform}`]: false }, () => {
          updatePlatformUI(platform, false);
          showToast('✅ Disconnected successfully!');
        });
      } else {
        throw new Error(resData.error || 'Failed to disconnect from database.');
      }
    })
    .catch(err => {
      if (disconnectBtn) disconnectBtn.disabled = false;
      console.error('Disconnect error:', err);
      // Clear local anyway to avoid locking the UI
      chrome.storage.local.set({ [`copilot_linked_${platform}`]: false }, () => {
        updatePlatformUI(platform, false);
        showToast('Disconnected locally (sync failed).', 'var(--amber)');
      });
    });
  });
}

// Wire Event Listeners
document.getElementById('btn-opt-connect-notion')?.addEventListener('click', () => triggerOAuthFlow('notion'));
document.getElementById('btn-opt-connect-gdocs')?.addEventListener('click', () => triggerOAuthFlow('google_docs'));
document.getElementById('btn-opt-connect-coda')?.addEventListener('click', () => triggerOAuthFlow('coda'));

document.getElementById('btn-opt-disconnect-notion')?.addEventListener('click', () => triggerDisconnectFlow('notion'));
document.getElementById('btn-opt-disconnect-gdocs')?.addEventListener('click', () => triggerDisconnectFlow('google_docs'));
document.getElementById('btn-opt-disconnect-coda')?.addEventListener('click', () => triggerDisconnectFlow('coda'));

// ─── Load stored data into fields ─────────────────────────────────────────────
chrome.storage.local.get(null, (data) => {
  // Account info
  const avatar = document.getElementById('opt-avatar');
  const name   = document.getElementById('opt-name');
  const email  = document.getElementById('opt-email');
  const badge  = document.getElementById('opt-tier-badge');

  if (data.copilot_user_name && name)  name.textContent  = data.copilot_user_name;
  if (data.copilot_user_email && email) email.textContent = data.copilot_user_email;

  // Extract avatar URL from JWT if possible
  if (data.copilot_jwt) {
    const payload = parseSupabaseJWT(data.copilot_jwt);
    const userMetadata = payload?.user_metadata || {};
    const avatarUrl = userMetadata.avatar_url || userMetadata.picture;
    if (avatarUrl && avatar) {
      avatar.src = avatarUrl;
      avatar.style.display = 'block';
    }
  }

  // Tier badge
  const tier = data.copilot_tier || 'TRIAL';
  const badgeMap = {
    PREMIUM:     ['premium', '⚡ Premium'],
    TRIAL:       ['trial',   '🟢 Trial Active'],
    ACTIVE_FREE: ['free',    '🔵 Free Tier'],
    EXPIRED_FREE:['free',    '🟡 Daily Limit'],
  };
  const [cls, label] = badgeMap[tier] || ['trial', '🟢 Trial Active'];
  if (badge) badge.innerHTML = `<span class="tier-badge ${cls}">${label}</span>`;

  // Platform keys & OAuth statuses
  const fieldMap = {
    'opt-gdocs-id':    'copilot_key_gdocs_id',
  };
  Object.entries(fieldMap).forEach(([fieldId, key]) => {
    const el = document.getElementById(fieldId);
    if (el && data[key]) el.value = data[key];
  });

  updatePlatformUI('notion', !!data.copilot_linked_notion);
  updatePlatformUI('google_docs', !!data.copilot_linked_google_docs);
  updatePlatformUI('coda', !!data.copilot_linked_coda);

  const backendUrl = data.copilot_backend_url || 'http://localhost:3000';
  const appToken = data.copilot_app_token || 'MakeUpASuperLongPassword123!';

  // Sync database flags dynamically if logged in
  if (data.copilot_jwt) {
    chrome.runtime.sendMessage({ action: 'SYNC_OAUTH_STATUS', jwt: data.copilot_jwt }, (res) => {
      if (res?.success) {
        chrome.storage.local.get([
          'copilot_linked_notion', 'copilot_linked_google_docs',
          'copilot_linked_coda'
        ], (updates) => {
          updatePlatformUI('notion', !!updates.copilot_linked_notion);
          updatePlatformUI('google_docs', !!updates.copilot_linked_google_docs);
          updatePlatformUI('coda', !!updates.copilot_linked_coda);
        });
      }
    });
  }

  // Backend config
  if (data.copilot_backend_url) {
    const urlEl = document.getElementById('opt-backend-url');
    if (urlEl) urlEl.value = data.copilot_backend_url;
  }
  if (data.copilot_app_token) {
    const tokenEl = document.getElementById('opt-app-token');
    if (tokenEl) tokenEl.value = data.copilot_app_token;
  }
});



document.querySelectorAll('.btn-save[data-key]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key   = btn.dataset.key;
    const field = btn.dataset.field;
    let value = document.getElementById(field)?.value?.trim() || '';
    if (key === 'copilot_key_gdocs_id') {
      const match = value.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
      if (match) {
        value = match[1];
        const inputEl = document.getElementById(field);
        if (inputEl) inputEl.value = value;
      }
    }
    chrome.storage.local.set({ [key]: value }, () => showToast('✅ Key saved!'));
  });
});

// ─── Backend config save ──────────────────────────────────────────────────────
document.getElementById('save-backend-btn')?.addEventListener('click', () => {
  const url   = document.getElementById('opt-backend-url')?.value?.trim() || '';
  const token = document.getElementById('opt-app-token')?.value?.trim() || '';
  chrome.storage.local.set({ copilot_backend_url: url, copilot_app_token: token }, () => {
    showToast('✅ Backend config saved!');
  });
});

// ─── Clear all data ───────────────────────────────────────────────────────────
document.getElementById('clear-all-btn')?.addEventListener('click', () => {
  if (!confirm('This will erase ALL locally stored API keys and configuration. Continue?')) return;
  chrome.storage.local.clear(() => {
    showToast('🗑 All local data cleared.', 'var(--amber)');
    // Reset fields
    document.querySelectorAll('input[type="password"], input[type="text"]').forEach(el => {
      el.value = '';
    });
    // Reset connection badges
    updatePlatformUI('notion', false);
    updatePlatformUI('google_docs', false);
    updatePlatformUI('coda', false);
  });
});
