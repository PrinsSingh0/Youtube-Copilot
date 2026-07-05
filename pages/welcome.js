// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — WELCOME / ONBOARDING SCRIPT (pages/welcome.js)
//  Handles: Google OAuth, platform key collection, local storage write
// ==============================================================================

const STEPS = ['step-0', 'step-1', 'step-2', 'step-3'];
let currentStep = 0;
let selectedPlatforms = [];
let userJWT = null;

// ─── Dev Skip Bypass ──────────────────────────────────────────────────────────
document.getElementById('dev-skip-btn')?.addEventListener('click', () => {
  const mockPayload = btoa(JSON.stringify({ 
    sub: '23331303-1918-41b3-9db4-482668fc695d',
    email: 'prisingh751@gmail.com'
  })).replace(/=/g, '');
  const mockJWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${mockPayload}.mocksignature`;

  chrome.storage.local.set({
    copilot_dev_mode: true,
    copilot_tier: 'TRIAL',
    copilot_user_name: 'Prins Singh',
    copilot_user_email: 'prisingh751@gmail.com',
    copilot_jwt: mockJWT,
  }, () => {
    goToStep(3); // Jump straight to success screen
  });
});

// Hover effect for dashed button
const skipBtn = document.getElementById('dev-skip-btn');
if (skipBtn) {
  skipBtn.addEventListener('mouseenter', () => {
    skipBtn.style.borderColor = 'var(--accent)';
    skipBtn.style.color = 'var(--text)';
  });
  skipBtn.addEventListener('mouseleave', () => {
    skipBtn.style.borderColor = 'var(--border)';
    skipBtn.style.color = 'var(--muted)';
  });
}


// ─── Step Navigation ──────────────────────────────────────────────────────────
function goToStep(index) {
  STEPS.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', i === index);
  });
  document.querySelectorAll('.dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });
  currentStep = index;
}

function parseSupabaseJWT(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Failed to parse JWT:', e);
    return null;
  }
}

// ─── Google OAuth via chrome.identity & Supabase ─────────────────────────────
document.getElementById('google-sign-in-btn')?.addEventListener('click', () => {
  const statusEl = document.getElementById('step-status');
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = '⏳ Opening Google sign-in...';

  const redirectUrl = chrome.identity.getRedirectURL();
  const supabaseUrl = 'https://iytbibkcohjukhytcfxo.supabase.co';
  const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;

  chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  }, (responseUrl) => {
    if (chrome.runtime.lastError) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `❌ ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!responseUrl) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '❌ Sign-in cancelled or failed.';
      return;
    }

    try {
      const parsedUrl = new URL(responseUrl);
      const hashParams = new URLSearchParams(parsedUrl.hash.replace('#', '?'));
      const token = hashParams.get('access_token');

      if (!token) {
        const error = hashParams.get('error_description') || hashParams.get('error') || 'No access token found in response.';
        throw new Error(error);
      }

      userJWT = token;
      localStorage.setItem('copilot_jwt', token);
      chrome.storage.local.set({ copilot_jwt: token });

      // Decode the JWT to read user profile metadata
      const profile = parseSupabaseJWT(token);
      if (!profile) {
        throw new Error('Failed to parse authentication token details.');
      }

      const userMetadata = profile.user_metadata || {};
      const avatar = document.getElementById('user-avatar');
      const name = document.getElementById('user-name');
      const email = document.getElementById('user-email');
      const box = document.getElementById('user-info-box');
      const signBtn = document.getElementById('google-sign-in-btn');
      const nextBtn = document.getElementById('step-0-next');

      if (avatar) avatar.src = userMetadata.avatar_url || userMetadata.picture || '';
      if (name) name.textContent = userMetadata.full_name || userMetadata.name || 'Supabase User';
      if (email) email.textContent = profile.email || userMetadata.email || '';
      if (box) box.style.display = 'flex';
      if (signBtn) signBtn.style.display = 'none';
      if (nextBtn) nextBtn.disabled = false;

      statusEl.style.color = 'var(--success)';
      statusEl.textContent = '✅ Authenticated successfully with Supabase!';

      // Sync integrations status from database
      chrome.runtime.sendMessage({ action: 'SYNC_OAUTH_STATUS', jwt: token });

      // Store profile details
      chrome.storage.local.set({
        copilot_user_email: profile.email || userMetadata.email || '',
        copilot_user_name: userMetadata.full_name || userMetadata.name || 'Supabase User',
        copilot_tier: 'TRIAL'
      });

    } catch (err) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `❌ Authentication error: ${err.message}`;

      const helperText = document.createElement('div');
      helperText.style.marginTop = '10px';
      helperText.style.fontSize = '11.5px';
      helperText.style.color = 'var(--muted)';
      helperText.style.lineHeight = '1.4';
      helperText.innerHTML = `Ensure this Redirect URI is added in Supabase dashboard:<br/><strong style="color:var(--accent); word-break: break-all;">${redirectUrl}</strong>`;
      statusEl.appendChild(helperText);
    }
  });
});

// ─── Step 0 → 1 ──────────────────────────────────────────────────────────────
document.getElementById('step-0-next')?.addEventListener('click', () => goToStep(1));
document.getElementById('step-1-back')?.addEventListener('click', () => goToStep(0));
document.getElementById('step-2-back')?.addEventListener('click', () => goToStep(1));

// ─── Platform Card Selection (Step 1) ────────────────────────────────────────
document.querySelectorAll('.platform-card').forEach(card => {
  card.addEventListener('click', () => {
    const platform = card.dataset.platform;
    card.classList.toggle('selected');
    if (card.classList.contains('selected')) {
      if (!selectedPlatforms.includes(platform)) selectedPlatforms.push(platform);
    } else {
      selectedPlatforms = selectedPlatforms.filter(p => p !== platform);
    }
  });
});

// ─── OAuth Status Update UI Helpers ──────────────────────────────────────────
function updateOAuthStatusUI(platform, isLinked) {
  let domPlatform = platform;
  if (platform === 'google_docs') domPlatform = 'googledocs';

  const btn = document.getElementById(`btn-connect-${domPlatform}`);
  const status = document.getElementById(`status-connect-${domPlatform}`);
  if (!btn || !status) return;

  if (isLinked) {
    btn.textContent = 'Disconnect';
    btn.classList.add('connected');
    btn.style.background = 'rgba(239, 68, 68, 0.2)';
    btn.style.border = '1px solid #ef4444';
    btn.style.color = '#ef4444';
    btn.disabled = false;
    status.textContent = 'Connected';
    status.style.color = 'var(--success)';
  } else {
    let platformLabel = platform === 'google_docs' ? 'Google Docs' : platform.charAt(0).toUpperCase() + platform.slice(1);
    btn.textContent = `Connect ${platformLabel}`;
    btn.classList.remove('connected');
    btn.style.background = '';
    btn.style.border = '';
    btn.style.color = '';
    btn.disabled = false;
    status.textContent = 'Not Connected';
    status.style.color = 'var(--muted)';
  }
}

function triggerDisconnectFlow(platform) {
  let platformLabel = platform === 'google_docs' ? 'Google Docs' : platform.charAt(0).toUpperCase() + platform.slice(1);
  if (!confirm(`Are you sure you want to disconnect ${platformLabel}?`)) return;

  let domPlatform = platform;
  if (platform === 'google_docs') domPlatform = 'googledocs';
  const btn = document.getElementById(`btn-connect-${domPlatform}`);
  const statusEl = document.getElementById(`status-connect-${domPlatform}`);
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = '⏳ Disconnecting...';

  chrome.storage.local.get(['copilot_jwt', 'copilot_backend_url', 'copilot_app_token'], (data) => {
    const jwt = data.copilot_jwt;
    const backendUrl = data.copilot_backend_url || 'http://localhost:3000';
    const appToken = data.copilot_app_token || 'MakeUpASuperLongPassword123!';

    if (!jwt) {
      chrome.storage.local.set({ [`copilot_linked_${platform}`]: false }, () => {
        if (btn) btn.disabled = false;
        updateOAuthStatusUI(platform, false);
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
        if (btn) btn.disabled = false;
        if (resData.success) {
          chrome.storage.local.set({ [`copilot_linked_${platform}`]: false }, () => {
            updateOAuthStatusUI(platform, false);
          });
        } else {
          throw new Error(resData.error || 'Failed to disconnect.');
        }
      })
      .catch(err => {
        if (btn) btn.disabled = false;
        console.error('Disconnect error:', err);
        // Clear local anyway to avoid locking the UI
        chrome.storage.local.set({ [`copilot_linked_${platform}`]: false }, () => {
          updateOAuthStatusUI(platform, false);
        });
      });
  });
}

function triggerOAuthFlow(platform) {
  let domPlatform = platform;
  if (platform === 'google_docs') domPlatform = 'googledocs';

  const statusEl = document.getElementById(`status-connect-${domPlatform}`);
  const btn = document.getElementById(`btn-connect-${domPlatform}`);
  if (statusEl) {
    statusEl.style.color = 'var(--muted)';
    statusEl.textContent = '⏳ Authenticating...';
  }
  if (btn) btn.disabled = true;

  const jwt = userJWT || localStorage.getItem('copilot_jwt');
  if (!jwt) {
    if (statusEl) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '❌ Please sign in with Google first.';
    }
    if (btn) btn.disabled = false;
    return;
  }

  const payload = parseSupabaseJWT(jwt);
  const userId = payload ? payload.sub : null;
  if (!userId) {
    if (statusEl) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '❌ Invalid user identity. Re-authenticate.';
    }
    if (btn) btn.disabled = false;
    return;
  }

  let messagePlatform = platform;
  if (platform === 'google_docs') messagePlatform = 'googledocs';



  const isTokenPlatform = ['coda'].includes(platform);
  if (isTokenPlatform) {
    const displayLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
    const tokenInput = prompt(`Enter your ${displayLabel} Personal API Token (or leave blank to use mock one-tap integration):`);
    if (tokenInput !== null && tokenInput.trim() !== '') {
      const cleanToken = tokenInput.trim();

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
            if (btn) btn.disabled = false;
            if (resData.success) {
              chrome.storage.local.set({ [`copilot_linked_${platform}`]: true }, () => {
                updateOAuthStatusUI(platform, true);
              });
            } else {
              if (statusEl) {
                statusEl.style.color = 'var(--danger)';
                statusEl.textContent = `❌ ${resData.error}`;
              }
            }
          })
          .catch(err => {
            if (btn) btn.disabled = false;
            if (statusEl) {
              statusEl.style.color = 'var(--danger)';
              statusEl.textContent = `❌ ${err.message}`;
            }
          });
      });
      return;
    } else {
      if (btn) btn.disabled = false;
      if (statusEl) {
        statusEl.textContent = 'Not Connected';
      }
      return;
    }
  }

  chrome.runtime.sendMessage({ action: 'START_OAUTH', platform: messagePlatform, userId }, (res) => {
    if (res?.success) {
      updateOAuthStatusUI(platform, true);
    } else {
      if (statusEl) {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = `❌ ${res?.error || 'Auth failed'}`;
      }
      if (btn) btn.disabled = false;
    }
  });
}

function handlePlatformConnectionClick(platform) {
  chrome.storage.local.get([`copilot_linked_${platform}`], (data) => {
    const isLinked = !!data[`copilot_linked_${platform}`];
    if (isLinked) {
      triggerDisconnectFlow(platform);
    } else {
      triggerOAuthFlow(platform);
    }
  });
}

// Wire Connect Buttons
document.getElementById('btn-connect-notion')?.addEventListener('click', () => handlePlatformConnectionClick('notion'));
document.getElementById('btn-connect-googledocs')?.addEventListener('click', () => handlePlatformConnectionClick('google_docs'));
document.getElementById('btn-connect-coda')?.addEventListener('click', () => handlePlatformConnectionClick('coda'));

// ─── Step 1 → 2 ──────────────────────────────────────────────────────────────
document.getElementById('step-1-next')?.addEventListener('click', () => {
  // Show only the key fields for selected platforms
  document.querySelectorAll('.key-field').forEach(field => {
    const platform = field.dataset.platform;
    field.classList.toggle('visible', selectedPlatforms.includes(platform));
  });

  chrome.storage.local.get([
    'copilot_linked_notion', 'copilot_linked_google_docs',
    'copilot_linked_coda',
    'copilot_key_gdocs_id'
  ], (data) => {
    updateOAuthStatusUI('notion', !!data.copilot_linked_notion);
    updateOAuthStatusUI('google_docs', !!data.copilot_linked_google_docs);
    updateOAuthStatusUI('coda', !!data.copilot_linked_coda);

    const inputGdocs = document.getElementById('input-gdocs-id');
    if (inputGdocs && data.copilot_key_gdocs_id) {
      inputGdocs.value = data.copilot_key_gdocs_id;
    }
  });

  // If no platforms selected, skip key step
  if (selectedPlatforms.length === 0) {
    goToStep(3);
  } else {
    goToStep(2);
  }
});

// ─── Step 2 — Save Keys ───────────────────────────────────────────────────────
document.getElementById('step-2-save')?.addEventListener('click', async () => {
  const status2 = document.getElementById('step-status-2');
  const saveBtn = document.getElementById('step-2-save');

  saveBtn.disabled = true;
  status2.style.color = 'var(--muted)';
  status2.textContent = '⏳ Saving settings to local storage...';

  const keysToSave = {};
  if (selectedPlatforms.includes('googledocs')) {
    let docId = document.getElementById('input-gdocs-id')?.value?.trim() || '';
    const match = docId.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
      docId = match[1];
    }
    keysToSave.copilot_key_gdocs_id = docId;
  }



  keysToSave.copilot_selected_platforms = selectedPlatforms;

  chrome.storage.local.set(keysToSave, () => {
    if (chrome.runtime.lastError) {
      status2.style.color = 'var(--danger)';
      status2.textContent = `❌ ${chrome.runtime.lastError.message}`;
      saveBtn.disabled = false;
    } else {
      status2.style.color = 'var(--success)';
      status2.textContent = '✅ Setup completed successfully.';
      setTimeout(() => goToStep(3), 800);
    }
  });
});

// ─── Step 3 — Go to YouTube ───────────────────────────────────────────────────
document.getElementById('goto-youtube-btn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.youtube.com' });
});
