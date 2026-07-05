// ==============================================================================
//  YOUTUBE COPILOT v5.0.0 — RECALL REVIEWS ENGINE (pages/reviews.js)
// ==============================================================================

const BACKEND_URL = 'http://localhost:3000';
const COPILOT_TOKEN = 'MakeUpASuperLongPassword123!';

let cardsQueue = [];
let currentCardIndex = 0;
let userJWT = null;

document.addEventListener('DOMContentLoaded', () => {
  initReviews();
});

async function initReviews() {
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';

  try {
    // 1. Retrieve JWT
    const storageData = await getStorageData(['copilot_jwt']);
    userJWT = storageData.copilot_jwt;

    if (!userJWT) {
      window.location.href = 'welcome.html';
      return;
    }

    // 2. Fetch Review Queue
    const res = await fetch(`${BACKEND_URL}/api/reviews/queue`, {
      headers: {
        'Authorization': `Bearer ${userJWT}`,
        'x-copilot-token': COPILOT_TOKEN
      }
    });

    if (!res.ok) {
      throw new Error(`Queue response returned status ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch spaced repetition queue.');
    }

    cardsQueue = data.queue || [];
    currentCardIndex = 0;

    // 3. Render state
    renderCurrentState();

  } catch (err) {
    console.error('Error initializing reviews:', err);
    alert('Failed to connect to review queue service.');
  } finally {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }

  // 4. Set up UI event listeners
  setupReviewListeners();
}

/**
 * Promise-wrapped chrome storage local get helper
 */
function getStorageData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result);
    });
  });
}

/**
 * Updates UI based on queue length and active card index
 */
function renderCurrentState() {
  const quizContainer = document.getElementById('quiz-container');
  const emptyContainer = document.getElementById('empty-container');
  const progressIndicator = document.getElementById('progress-indicator');
  const titleMain = document.getElementById('title-main');

  if (cardsQueue.length === 0) {
    // Empty queue state
    quizContainer.style.display = 'none';
    emptyContainer.style.display = 'flex';
    progressIndicator.textContent = '';
    titleMain.textContent = 'Reviews Completed';
    return;
  }

  // Active quiz state
  quizContainer.style.display = 'flex';
  emptyContainer.style.display = 'none';
  
  const currentCard = cardsQueue[currentCardIndex];
  
  // Update texts
  document.getElementById('card-topic').textContent = currentCard.topic_tag || 'General';
  document.getElementById('card-question').textContent = currentCard.question_text || '';
  document.getElementById('card-solution').textContent = currentCard.solution_text || '';
  progressIndicator.textContent = `Card ${currentCardIndex + 1} of ${cardsQueue.length}`;
  titleMain.textContent = 'Active Recall Reviews';

  // Reset card layout visibility
  document.getElementById('card-solution').style.display = 'none';
  document.getElementById('card-divider').style.display = 'none';
  document.getElementById('rating-container').style.display = 'none';
  document.getElementById('btn-show-solution').style.display = 'block';
}

/**
 * Reveals answer section of flashcard
 */
function revealAnswer() {
  document.getElementById('card-solution').style.display = 'block';
  document.getElementById('card-divider').style.display = 'block';
  document.getElementById('rating-container').style.display = 'flex';
  document.getElementById('btn-show-solution').style.display = 'none';
}

/**
 * Submits review score to backend for calculation
 */
async function submitReview(score) {
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';

  const currentCard = cardsQueue[currentCardIndex];

  try {
    const res = await fetch(`${BACKEND_URL}/api/reviews/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userJWT}`,
        'x-copilot-token': COPILOT_TOKEN
      },
      body: JSON.stringify({
        cardId: currentCard.id,
        score: score
      })
    });

    if (!res.ok) {
      throw new Error(`Review submit returned status ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to submit review score.');
    }

    // Success: Advance in queue
    currentCardIndex++;
    if (currentCardIndex >= cardsQueue.length) {
      // Finished all cards in active queue
      cardsQueue = [];
    }

    renderCurrentState();

  } catch (err) {
    console.error('Error submitting review:', err);
    alert('Failed to save review evaluation score.');
  } finally {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }
}

/**
 * Set up listeners for active recall rating buttons and solution trigger
 */
function setupReviewListeners() {
  // Show solution button
  document.getElementById('btn-show-solution')?.addEventListener('click', revealAnswer);

  // Wire 0-5 rating buttons
  const ratingButtons = document.querySelectorAll('.btn-rate');
  ratingButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Find rating code
      const scoreAttr = btn.getAttribute('data-score');
      const scoreVal = parseInt(scoreAttr, 10);
      submitReview(scoreVal);
    });
  });
}
