/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — POLICY & CONTEXT EVAL TESTER (tests/engine/policy-context.eval.mjs)
 *  Verification suite for YAML parsing, structural gates, and context hygiene resolution.
 * ==============================================================================
 */

import dotenv from '../../copilot-backend/node_modules/dotenv/lib/main.js';
dotenv.config({ path: 'c:/Ai Copilot 4.0 - Copy/copilot-backend/.env' });
import { checkStructuralPolicy, checkSemanticPolicy, parseYaml } from '../../copilot-backend/middleware/policy-engine.js';
import { resolveContext, resolvePayload } from '../../copilot-backend/utils/context-resolver.js';

console.log('==================================================');
console.log('STARTING POLICY & CONTEXT HYGIENE INTEGRATION TEST');
console.log('==================================================');

// 1. Verify policy-engine structural gating check
try {
  console.log('\nTesting structural policy check...');
  
  // Dev role allowed tools
  const check1 = checkStructuralPolicy('get_youtube_transcript', 'user');
  console.log('✔ Structural Check: Tool "get_youtube_transcript" for role "user" allowed.', check1);

  // High-risk blocked tool
  try {
    checkStructuralPolicy('send_email', 'admin');
    console.error('❌ Failed: "send_email" should have been blocked in development.');
    process.exit(1);
  } catch (err) {
    console.log('✔ Structural Check: Blocked high-risk tool "send_email" in dev environment successfully! Error:', err.message);
  }

  // Unauthorized role tool
  try {
    checkStructuralPolicy('sync_notes_to_notion', 'user');
    console.error('❌ Failed: role "user" should not be allowed to execute "sync_notes_to_notion".');
    process.exit(1);
  } catch (err) {
    console.log('✔ Structural Check: Blocked unauthorized role "user" from executing "sync_notes_to_notion" successfully! Error:', err.message);
  }
} catch (error) {
  console.error('❌ Structural check test failed:', error);
  process.exit(1);
}

// 2. Verify context-resolver resolver utility
try {
  console.log('\nTesting context hygiene resolution...');
  
  // Setup environment variable
  process.env.TARGET_VIDEO_ID = 'dQw4w9WgXcQ';
  
  const templateStr = 'Processing video [[TARGET_VIDEO_ID]] to database [[NOTION_DATABASE_ID]]';
  const overrideState = {
    NOTION_DATABASE_ID: 'notion_pkm_db_123'
  };

  const resolved = resolveContext(templateStr, overrideState);
  console.log(`Original: "${templateStr}"`);
  console.log(`Resolved: "${resolved}"`);

  if (!resolved.includes('dQw4w9WgXcQ') || !resolved.includes('notion_pkm_db_123')) {
    console.error('❌ Failed context resolution verification!');
    process.exit(1);
  }
  console.log('✔ Context resolution successfully substituted state overrides and fell back to process.env!');

  // Test recursive resolvePayload
  const complexPayload = {
    action: 'save_video',
    params: {
      videoId: '[[TARGET_VIDEO_ID]]',
      database: '[[NOTION_DATABASE_ID]]',
      ignored: '[[UNRESOLVED_VARIABLE]]'
    }
  };

  const resolvedPayload = resolvePayload(complexPayload, overrideState);
  console.log('Resolved Payload Structure:\n', JSON.stringify(resolvedPayload, null, 2));

  if (resolvedPayload.params.videoId !== 'dQw4w9WgXcQ' || resolvedPayload.params.database !== 'notion_pkm_db_123' || resolvedPayload.params.ignored !== '[[UNRESOLVED_VARIABLE]]') {
    console.error('❌ Failed recursive resolvedPayload verification!');
    process.exit(1);
  }
  console.log('✔ Recursive resolvedPayload successfully verified: unresolved brackets left intact!');

} catch (error) {
  console.error('❌ Context resolution test failed:', error);
  process.exit(1);
}

// 3. Verify semantic check with Gemini endpoint (if API Key is active)
try {
  console.log('\nTesting semantic check with Gemini...');
  const cleanPayload = { text: 'Summarize standard architecture plans.' };
  const semanticResult = await checkSemanticPolicy('generate_structured_notes', cleanPayload);
  console.log('✔ Clean payload semantic check passed. Output:', semanticResult);

  // Leak payload containing plain text email
  const leakedPayload = { email: 'leak_target_personal@gmail.com', content: 'Secret system details.' };
  const semanticResultViolation = await checkSemanticPolicy('generate_structured_notes', leakedPayload);
  console.log('✔ Leak payload semantic check triggered policy violation successfully! Output:', semanticResultViolation);

  if (semanticResultViolation !== 'POLICY_VIOLATION: Unmasked sensitive information detected.') {
    console.error('❌ Failed: Semantic validation did not flag email leakage.');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Semantic check test failed:', error.message);
  process.exit(1);
}

console.log('\n==================================================');
console.log('🏆 SUCCESS: All integration tests passed!');
console.log('==================================================');
process.exit(0);
