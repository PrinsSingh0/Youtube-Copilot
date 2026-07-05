try {
  const player = document.getElementById('movie_player');
  const response = player ? player.getPlayerResponse() : (window.ytInitialPlayerResponse || null);
  window.postMessage({ type: 'YOUTUBE_COPILOT_PLAYER_RESPONSE', playerResponse: response }, '*');
} catch (e) {
  window.postMessage({ type: 'YOUTUBE_COPILOT_PLAYER_RESPONSE', playerResponse: null }, '*');
}
