// ==============================================================================
//  🧪 YOUTUBE COPILOT — INTEGRATION SANDBOX VALIDATOR (scripts/test-integrations.js)
//  Run: node scripts/test-integrations.js [platform]
//  Platforms: googledocs | all
//
//  Prerequisites:
//   1. npm run dev (or node server.js) running in copilot-backend/
//   2. All TEST_* values filled in .env
// ==============================================================================

import 'dotenv/config';

const BACKEND_URL   = `http://localhost:${process.env.PORT || 3000}`;
const COPILOT_TOKEN = process.env.APP_SECRET_TOKEN || 'MakeUpASuperLongPassword123!';

const TEST_PAYLOAD = {
  noteText: 'Isolating integration layer frameworks to establish functional connection validation.',
  title:    'Integration Sandbox Test Run',
  meta:     { sourceUrl: 'https://www.youtube.com', timestamp: '02:15' },
};

// ─── ANSI colour helpers ──────────────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

function log(tag, msg)  { console.log(`${c.bold('[Copilot Test]')} ${tag} ${msg}`); }
function ok(platform, detail) {
  console.log(c.green(`\n  ✅ ${platform.toUpperCase()} PASSED`));
  console.log(c.cyan(`     ${detail}\n`));
}
function fail(platform, err) {
  console.log(c.red(`\n  ❌ ${platform.toUpperCase()} FAILED`));
  console.log(c.red(`     ${err}\n`));
}

// ─── Core hit function ────────────────────────────────────────────────────────
async function testPlatform(platform) {
  log(c.yellow('⏳'), `Testing ${c.bold(platform)}...`);

  try {
    const res = await fetch(`${BACKEND_URL}/api/test-export`, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-copilot-token': COPILOT_TOKEN,
      },
      body: JSON.stringify({ ...TEST_PAYLOAD, platform }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      fail(platform, data.error || `HTTP ${res.status}`);
      return false;
    }

    ok(platform, data.message || JSON.stringify(data));
    return true;
  } catch (err) {
    // Network error = server not running
    if (err.code === 'ECONNREFUSED') {
      fail(platform, `Cannot reach ${BACKEND_URL} — is the server running? (npm run dev)`);
    } else {
      fail(platform, err.message);
    }
    return false;
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────
const arg = process.argv[2]?.toLowerCase() || 'all';
const platforms = arg === 'all'
  ? ['googledocs']
  : [arg];

console.log(c.bold('\n════════════════════════════════════════════'));
console.log(c.bold('  YouTube Copilot — Integration Sandbox'));
console.log(c.bold('════════════════════════════════════════════'));
console.log(`  Backend:  ${c.cyan(BACKEND_URL)}`);
console.log(`  Targets:  ${c.cyan(platforms.join(', '))}\n`);

// Health check first
try {
  const health = await fetch(`${BACKEND_URL}/health`);
  const hData  = await health.json();
  console.log(c.green(`  🟢 Server healthy — v${hData.version}\n`));
} catch {
  console.log(c.red('  🔴 Server UNREACHABLE — start it first with: npm run dev\n'));
  process.exit(1);
}

// Run tests
let passed = 0;
for (const p of platforms) {
  const result = await testPlatform(p);
  if (result) passed++;
}

// Summary
console.log(c.bold('════════════════════════════════════════════'));
const total = platforms.length;
if (passed === total) {
  console.log(c.green(c.bold(`  🏁 All ${total}/${total} integrations PASSED ✓`)));
} else {
  console.log(c.yellow(`  🏁 ${passed}/${total} integrations passed.`));
  console.log(c.red(`     ${total - passed} integration(s) failed — check .env values above.`));
}
console.log(c.bold('════════════════════════════════════════════\n'));

process.exit(passed === total ? 0 : 1);
