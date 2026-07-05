/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — SESSION INTENT EVALUATOR (tests/engine/intent-evaluator.js)
 *  ★ CORE EVAL ENGINE ★ — Translating goals, scoring ADK trajectories, and reporting.
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

// IN_ORDER validation model function
function scoreTrajectoryInOrder(expectedSequence, actualSequence) {
  let expectedIndex = 0;
  
  for (const toolCall of actualSequence) {
    if (toolCall === expectedSequence[expectedIndex]) {
      expectedIndex++;
    }
    if (expectedIndex === expectedSequence.length) {
      break;
    }
  }

  const matches = expectedIndex;
  const total = expectedSequence.length;
  const score = total > 0 ? matches / total : 1.0;

  return {
    score,
    passed: matches === total,
    matchedCount: matches,
    expectedCount: total
  };
}

/**
 * Extracts the first two user statements to generate 3 explicit functional criteria.
 * @param {Array} messageHistory 
 * @returns {Array} List of 3 acceptance criteria objects
 */
function extractDynamicRubric(messageHistory) {
  const userMessages = messageHistory
    .filter(msg => msg.role === 'user')
    .slice(0, 2)
    .map(msg => msg.content);

  const mergedQueries = userMessages.join(' ').toLowerCase();

  // Generate 3 criteria dynamically based on keywords in the statements
  const criteria = [];

  // Criteria 1: Video/Transcript Extraction
  if (mergedQueries.includes('video') || mergedQueries.includes('transcript') || mergedQueries.includes('summarize')) {
    criteria.push({
      metric: 'VideoTranscriptAccess',
      assertion: 'Must execute get_youtube_transcript tool to retrieve video packets.'
    });
  } else {
    criteria.push({
      metric: 'InputReadingValidation',
      assertion: 'Must successfully validate the query parameters of the active workspace.'
    });
  }

  // Criteria 2: Sync / Storage connection
  if (mergedQueries.includes('notion') || mergedQueries.includes('pkm') || mergedQueries.includes('save') || mergedQueries.includes('sync')) {
    criteria.push({
      metric: 'NotionPKMSync',
      assertion: 'Must authorize and initiate the notion-pkm-sync-server write stream.'
    });
  } else {
    criteria.push({
      metric: 'WorkspaceStateSync',
      assertion: 'Must save the processed outputs to the active database container.'
    });
  }

  // Criteria 3: Interface output structure
  if (mergedQueries.includes('markdown') || mergedQueries.includes('deep-dive') || mergedQueries.includes('summary') || mergedQueries.includes('layout')) {
    criteria.push({
      metric: 'A2UIDeclarativeLayout',
      assertion: 'Must parse output into safe <a2ui-json> component layout adjacency list blocks.'
    });
  } else {
    criteria.push({
      metric: 'OutputFormatValidation',
      assertion: 'Must output well-formed JSON object satisfying all key properties.'
    });
  }

  // If we don't have enough criteria, fill with defaults
  while (criteria.length < 3) {
    criteria.push({
      metric: 'GeneralExecutionSafety',
      assertion: 'Must execute without triggering SecOps Gateway drift circuit breakers.'
    });
  }

  return criteria.slice(0, 3);
}

/**
 * Aggregates trace parameters to evaluate execution metrics and status.
 */
function generateConvergenceReport(traceParams) {
  const { iterations, tokensUsed, qualityHistory, maxIterations } = traceParams;

  // Approximate tokens pricing (input: $1.5e-6 per token, output: $2.0e-6 per token)
  const inputCost = (tokensUsed.input || 0) * 1.5e-6;
  const outputCost = (tokensUsed.output || 0) * 2.0e-6;
  const totalCost = parseFloat((inputCost + outputCost).toFixed(5));

  // Determine convergence status
  const finalQuality = qualityHistory[qualityHistory.length - 1] || 0;
  const converged = finalQuality >= 7.0 && iterations <= maxIterations;
  
  return {
    iterations,
    totalTokens: (tokensUsed.input || 0) + (tokensUsed.output || 0),
    totalCostUsd: totalCost,
    finalQualityScore: finalQuality,
    status: converged ? 'converged' : 'abandoned'
  };
}

// --- Main Self-Test Runner ---
function runSelfTest() {
  console.log('==================================================');
  console.log('STARTING SESSION INTENT EVALUATOR SELF-TEST ENGINE');
  console.log('==================================================');

  // Mock message history trace
  const mockChatHistory = [
    { role: 'user', content: 'Extract the transcript for video ID dQw4w9WgXcQ.' },
    { role: 'user', content: 'Generate a summary and sync it to my Notion PKM notebook.' },
    { role: 'assistant', content: 'Initializing youtube-summarizer skill loop...' }
  ];

  console.log('\n1. Testing Dynamic Rubric Extraction...');
  const rubric = extractDynamicRubric(mockChatHistory);
  console.log('Generated Rubric Criteria Metrics:');
  console.log(JSON.stringify(rubric, null, 2));

  if (rubric.length !== 3) {
    console.error('❌ Failed: Rubric must contain exactly 3 criteria.');
    process.exit(1);
  }
  console.log('✔ Dynamic Rubric Extraction passed!');

  console.log('\n2. Testing Trajectory Mode Scoring (IN_ORDER)...');
  const expectedTools = [
    'youtube-transcript-server/get_youtube_transcript',
    'notion-pkm-sync-server/sync_notes_to_notion'
  ];

  const mockActualTrace = [
    'youtube-transcript-server/get_youtube_transcript',
    'youtube-transcript-server/clarify_summarization_goal', // extra tool, allowed in IN_ORDER
    'notion-pkm-sync-server/sync_notes_to_notion'
  ];

  const trajectoryResult = scoreTrajectoryInOrder(expectedTools, mockActualTrace);
  console.log('Trajectory Result:', trajectoryResult);

  if (!trajectoryResult.passed || trajectoryResult.score !== 1.0) {
    console.error('❌ Failed: Trajectory score must match expected IN_ORDER sequence.');
    process.exit(1);
  }
  console.log('✔ Trajectory Mode Scoring passed!');

  console.log('\n3. Testing Convergence Reporting...');
  const mockTraceParams = {
    iterations: 2,
    tokensUsed: { input: 125000, output: 35000 },
    qualityHistory: [6.2, 8.5],
    maxIterations: 3
  };

  const report = generateConvergenceReport(mockTraceParams);
  console.log('Convergence Report:', report);

  if (report.status !== 'converged' || report.totalCostUsd <= 0) {
    console.error('❌ Failed: Convergence report metrics are incorrect.');
    process.exit(1);
  }
  console.log('✔ Convergence Reporting passed!');

  console.log('\n==================================================');
  console.log('🏆 SUCCESS: All intent-evaluator unit checks passed!');
  console.log('==================================================');
  process.exit(0);
}

runSelfTest();
