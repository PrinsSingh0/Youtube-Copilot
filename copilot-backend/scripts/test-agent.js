// ==============================================================================
//  YOUTUBE COPILOT — AGENT PIPELINE TEST SCRIPT
//  Run: node scripts/test-agent.js
//  Tests the full 5-step agentic loop end-to-end against localhost:3000
// ==============================================================================

const BASE_URL = 'http://localhost:3000';

// ─── Auth Headers (uses the mock token bypass from middleware/auth.js) ────────
const APP_SECRET = process.env.GLOBAL_APP_SECRET || 'MakeUpASuperLongPassword123!';

// Build a mock JWT that the dev bypass accepts (ends with .mocksignature)
const mockPayload = Buffer.from(JSON.stringify({
  sub: '23331303-1918-41b3-9db4-482668fc695d',
  email: 'prisingh751@gmail.com',
  aud: 'authenticated',
  role: 'authenticated',
})).toString('base64');

const MOCK_JWT = `eyJhbGciOiJIUzI1NiJ9.${mockPayload}.mocksignature`;

const HEADERS = {
  'Content-Type': 'application/json',
  'x-copilot-token': APP_SECRET,
  'Authorization': `Bearer ${MOCK_JWT}`,
};

// ─── Test Configuration ──────────────────────────────────────────────────────
// Try different video types to see category-specific notes:
//   Tutorial:    'dQw4w9WgXcQ' (replace with a real tutorial ID)
//   Lecture:     'rfscVS0vtbw' (Steve Jobs Stanford speech)
//   Short video: 'jNQXAC9IVRw' (Me at the zoo - first YouTube video)

const TEST_VIDEO_ID = process.argv[2] || 'rfscVS0vtbw';  // Default: Steve Jobs speech
const TIMESTAMP_ARG = process.argv[3] ? parseFloat(process.argv[3]) : null;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;  // 2 minutes max wait

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timestamp() {
  return new Date().toLocaleTimeString();
}

function stepIcon(stepName) {
  const icons = {
    get_mission: '🎯',
    scan_scene: '🔍',
    think: '🧠',
    take_action: '⚡',
    observe_iterate: '🔬',
  };
  return icons[stepName] || '⏳';
}

// ─── Step 1: Start the Agent ─────────────────────────────────────────────────
async function startAgent(videoId) {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        YOUTUBE COPILOT — AGENT PIPELINE TEST            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`[${timestamp()}] 🚀 Starting agent for video: ${videoId}`);
  console.log(`[${timestamp()}]    URL: https://youtube.com/watch?v=${videoId}`);
  if (TIMESTAMP_ARG !== null) {
    console.log(`[${timestamp()}]    Target Timestamp: ${TIMESTAMP_ARG}s (slicing transcript ±60s around this point)\n`);
  } else {
    console.log(`[${timestamp()}]    Target: Full Video Transcript\n`);
  }

  const payload = {
    videoId,
    userGoal: TIMESTAMP_ARG !== null 
      ? `Generate comprehensive study notes specifically for the segment of the video around ${TIMESTAMP_ARG} seconds.`
      : 'Generate comprehensive structured study notes for this video',
  };

  if (TIMESTAMP_ARG !== null) {
    payload.timestamp = TIMESTAMP_ARG;
  }

  const res = await fetch(`${BASE_URL}/api/agent/start`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    console.error(`[${timestamp()}] ❌ Failed to start agent:`, data);
    process.exit(1);
  }

  console.log(`[${timestamp()}] ✅ Agent started! Session ID: ${data.sessionId}`);
  console.log(`[${timestamp()}]    Status: ${data.status}\n`);

  return data.sessionId;
}

// ─── Step 2: Poll for Progress ───────────────────────────────────────────────
async function pollUntilComplete(sessionId) {
  console.log('─── Polling Progress ─────────────────────────────────────\n');

  let lastStep = 0;
  let lastToolCount = 0;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const res = await fetch(`${BASE_URL}/api/agent/status/${sessionId}`, {
      headers: HEADERS,
    });

    const status = await res.json();

    if (!status.found) {
      console.error(`[${timestamp()}] ❌ Session not found (expired?)`);
      process.exit(1);
    }

    // Log step changes
    if (status.step !== lastStep) {
      const icon = stepIcon(status.stepName);
      console.log(`[${timestamp()}] ${icon} Step ${status.step}/5: ${status.stepName?.toUpperCase()}`);
      if (status.videoTitle && status.step === 2) {
        console.log(`[${timestamp()}]    📺 Video: "${status.videoTitle}"`);
      }
      lastStep = status.step;
    }

    // Log new tool executions
    if (status.toolsRun && status.toolsRun.length > lastToolCount) {
      const newTools = status.toolsRun.slice(lastToolCount);
      for (const tool of newTools) {
        console.log(`[${timestamp()}]    🔧 Tool executed: ${tool.name}`);
      }
      lastToolCount = status.toolsRun.length;
    }

    // Check terminal states
    if (status.status === 'complete') {
      console.log(`\n[${timestamp()}] ✅ Agent completed! (iteration ${status.iteration})`);
      return true;
    }

    if (status.status === 'failed') {
      console.error(`\n[${timestamp()}] ❌ Agent failed: ${status.error}`);
      return false;
    }

    if (status.status === 'cancelled') {
      console.error(`\n[${timestamp()}] ⚠️  Agent was cancelled`);
      return false;
    }

    // Wait before next poll
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.error(`\n[${timestamp()}] ⏰ Timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
  return false;
}

// ─── Step 3: Fetch the Result ────────────────────────────────────────────────
async function fetchResult(sessionId) {
  console.log('\n─── Fetching Result ──────────────────────────────────────\n');

  const res = await fetch(`${BASE_URL}/api/agent/result/${sessionId}`, {
    headers: HEADERS,
  });

  const result = await res.json();

  if (!result.found || !result.ready) {
    console.error('❌ Result not ready:', result);
    return;
  }

  // Display results
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    AGENT RESULTS                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`📺 Video:          ${result.videoTitle}`);
  console.log(`👤 Channel:        ${result.videoChannel}`);
  console.log(`🏷️  Category:       ${result.videoCategory}`);
  console.log(`📝 Note Structure: ${result.noteStructure}`);
  console.log(`📊 Quality Score:  ${result.qualityScore}/10`);
  if (result.qualityScores) {
    console.log(`   ├─ Completeness: ${result.qualityScores.completeness}/10`);
    console.log(`   ├─ Accuracy:     ${result.qualityScores.accuracy}/10`);
    console.log(`   └─ Structure:    ${result.qualityScores.structure}/10`);
  }
  console.log(`🔄 Iterations:     ${result.iterationsNeeded}`);
  console.log(`📜 Transcript:     ${result.transcriptSource} (${result.transcriptLength} chars)`);
  console.log(`🔧 Tools Used:     ${result.toolsUsed?.join(' → ')}`);
  console.log(`⏱️  Processing Time: ${(result.processingTime / 1000).toFixed(1)}s`);
  console.log(`📚 Related Videos: ${result.relatedVideos?.length || 0} found`);

  console.log('\n─── Generated Notes ──────────────────────────────────────\n');
  console.log(result.notes);
  console.log('\n──────────────────────────────────────────────────────────');

  return result;
}

// ─── Run ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    // Verify server is running
    try {
      await fetch(`${BASE_URL}/health`);
    } catch {
      console.error('❌ Server is not running! Start it first with: npm run dev');
      process.exit(1);
    }

    const sessionId = await startAgent(TEST_VIDEO_ID);
    const success = await pollUntilComplete(sessionId);

    if (success) {
      await fetchResult(sessionId);
    }
  } catch (err) {
    console.error('\n❌ Test failed with error:', err.message);
    process.exit(1);
  }
}

main();
