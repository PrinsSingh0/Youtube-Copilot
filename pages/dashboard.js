// ==============================================================================
//  YOUTUBE COPILOT v5.0.0 — ANALYTICS DASHBOARD SCRIPT (pages/dashboard.js)
// ==============================================================================

const BACKEND_URL = 'http://localhost:3000';
const COPILOT_TOKEN = 'MakeUpASuperLongPassword123!';

let activityChartInstance = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initDashboardFlow();
  setupNavigationAndListeners();
});

/**
 * Core initialization loop
 */
async function initDashboardFlow() {
  const greetingEl = document.getElementById('dynamic-user-greeting');
  const profileNameEl = document.getElementById('profile-display-name');
  
  try {
    // 1. Fetch JWT from chrome storage local
    const storageData = await getStorageData(['copilot_jwt', 'copilot_user_email']);
    const jwt = storageData.copilot_jwt;

    if (!jwt) {
      console.warn('Dashboard: Auth token not found in storage. Redirecting to setup.');
      window.location.href = 'welcome.html';
      return;
    }

    // 2. Fetch aggregated metrics from Express server
    const response = await fetch(`${BACKEND_URL}/api/dashboard/overview`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-copilot-token': COPILOT_TOKEN,
        'Authorization': `Bearer ${jwt}`
      }
    });

    if (response.status === 401) {
      console.warn('Dashboard: Session unauthorized. Redirecting.');
      window.location.href = 'welcome.html';
      return;
    }

    if (!response.ok) {
      throw new Error(`Overview API returned status ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch dashboard stats.');
    }

    // 3. Bind Profile Stats & Greeter
    if (greetingEl) {
      greetingEl.innerHTML = `Hallo ${data.profile.name}!! <span>👋</span>`;
    }
    if (profileNameEl) {
      profileNameEl.textContent = data.profile.name;
    }
    
    const displayHandle = document.getElementById('profile-display-handle');
    if (displayHandle) {
      displayHandle.textContent = `@${data.profile.email.split('@')[0]}`;
    }

    // 4. Ingest Metrics Row Under Avatar
    updateStatsRow(data.profile, data.metrics, data.activeSources);

    // 5. Render Chart.js Line Graph
    renderFocusTrendsChart(data.timeSeries);

    // 6. Populate Active Sources Grid
    renderActiveSources(data.activeSources);

    // 7. Populate Spaced Repetition Flashcards Queue Stack
    renderQueueStack(data.dueCardsQueue);

  } catch (err) {
    console.error('Failed to bind dashboard views:', err);
    alert('Failed to connect to backend telemetry service. Ensure the backend server is running.');
  }
}

/**
 * Promise wrapper for chrome storage local get
 */
function getStorageData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result);
    });
  });
}

/**
 * Formats relative timestamp strings
 */
function getRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Updates stats counters under user profile card
 */
function updateStatsRow(profile, metrics, activeSources) {
  const statCountClips = document.getElementById('stat-count-clips');
  const statCurrentStreak = document.getElementById('stat-current-streak');
  const statMaxStreak = document.getElementById('stat-max-streak');
  const statFocusHours = document.getElementById('stat-focus-hours');
  const statDueCards = document.getElementById('stat-due-cards');

  if (statCountClips) statCountClips.textContent = activeSources.length || '0';
  if (statCurrentStreak) statCurrentStreak.textContent = profile.currentStreak || '0';
  if (statMaxStreak) statMaxStreak.textContent = profile.maxStreak || '0';
  if (statFocusHours) statFocusHours.textContent = `${metrics.totalFocusHours || 0}h`;
  if (statDueCards) statDueCards.textContent = metrics.dueCardsCount || '0';
}

/**
 * Renders focus time series line chart using local Chart.js
 */
function renderFocusTrendsChart(timeSeries) {
  const canvas = document.getElementById('live-focus-trends-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  
  // Create a glowing cyan/blue line fill gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 220);
  gradient.addColorStop(0, 'rgba(0, 242, 254, 0.4)');
  gradient.addColorStop(1, 'rgba(0, 242, 254, 0.0)');

  if (activityChartInstance) {
    activityChartInstance.destroy();
  }

  // Set chart styles
  Chart.defaults.color = 'rgba(141, 169, 196, 0.6)';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

  activityChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: timeSeries.map(t => t.day),
      datasets: [{
        label: 'Focus Time (min)',
        data: timeSeries.map(t => t.minutes),
        borderColor: '#00f2fe',
        borderWidth: 3,
        pointBackgroundColor: '#00f2fe',
        pointBorderColor: '#161e24',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        backgroundColor: gradient,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: '#232c33',
          titleColor: '#daedf7',
          bodyColor: '#daedf7',
          borderColor: 'rgba(141, 169, 196, 0.15)',
          borderWidth: 1,
          padding: 8,
          displayColors: false
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          border: {
            display: false
          }
        },
        y: {
          grid: {
            color: 'rgba(141, 169, 196, 0.08)'
          },
          border: {
            display: false
          },
          ticks: {
            callback: function(value) {
              return value + 'm';
            }
          }
        }
      }
    }
  });
}

/**
 * Populates learning lectures grid
 */
function renderActiveSources(activeSources) {
  const grid = document.getElementById('live-sources-grid');
  if (!grid) return;

  if (!activeSources || activeSources.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-fallback">
        <div class="empty-icon">📺</div>
        <h4>Start your first learning session</h4>
        <p>Your active courses will be listed here once you clip notes from YouTube or educational platforms.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = activeSources.map(source => {
    const relTime = getRelativeTime(new Date(source.lastAccessed));
    const isYoutube = source.platformOrigin === 'youtube';
    const logoIcon = isYoutube ? '🔴' : '🎓';
    
    // Aesthetic cover cards matching course grids
    return `
      <div class="learning-source-card">
        <div class="card-cover-art" style="background: linear-gradient(135deg, rgba(0, 242, 254, 0.15) 0%, rgba(141, 169, 196, 0.05) 100%)">
          <span class="source-platform-badge">${logoIcon} ${source.platformOrigin.toUpperCase()}</span>
        </div>
        <div class="card-details-box">
          <span class="topic-tag-pill">${source.topicTag || 'General'}</span>
          <h4 class="source-lecture-title" title="${source.videoTitle}">${source.videoTitle}</h4>
          <div class="card-session-meta">
            <span class="access-time-label">Accessed: ${relTime}</span>
            <button class="resume-session-btn" data-video-id="${source.videoId}">Resume ➜</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach resume click listeners
  grid.querySelectorAll('.resume-session-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const videoId = btn.getAttribute('data-video-id');
      if (videoId) {
        chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}` });
      }
    });
  });
}

/**
 * Populates memory recall queues
 */
function renderQueueStack(dueCards) {
  const stack = document.getElementById('live-sm2-queue-stack');
  if (!stack) return;

  if (!dueCards || dueCards.length === 0) {
    stack.innerHTML = `
      <div class="empty-queue-fallback">
        <div class="celebrate-emoji">🎉</div>
        <h4>All clear!</h4>
        <p>No spaced repetition review cards are due for recall testing today.</p>
      </div>
    `;
    return;
  }

  stack.innerHTML = dueCards.map(card => {
    return `
      <div class="queue-item-wrapper">
        <div class="queue-item-head">
          <span class="queue-topic-pill">${card.topic_tag.toUpperCase()}</span>
          <span class="queue-interval-badge">SM-2: ${card.review_interval_days}d</span>
        </div>
        <p class="queue-card-question">${card.question_text}</p>
        <button class="queue-solve-quiz-btn" data-card-id="${card.id}">Review Now</button>
      </div>
    `;
  }).join('');

  // Attach solve click listeners
  stack.querySelectorAll('.queue-solve-quiz-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = 'reviews.html';
    });
  });
}

/**
 * Setup sidebar and navigation actions
 */
function setupNavigationAndListeners() {
  // Navigation sidebar targets
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (target === 'workspaces') {
        window.location.href = 'options.html';
      } else if (target === 'analytics') {
        window.location.href = 'dashboard.html';
      }
    });
  });

  // Action buttons
  document.querySelector('.banner-action-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.youtube.com' });
  });
}
