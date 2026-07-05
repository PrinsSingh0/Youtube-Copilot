// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — AGENT ORCHESTRATOR (src/agent/orchestrator.js)
//  ★ CORE FILE ★ — The main 5-step agentic loop.
//
//  Step 1: GET THE MISSION   — Receive and register the user's goal
//  Step 2: SCAN THE SCENE    — Gather all context before reasoning
//  Step 3: THINK IT THROUGH  — LLM plans the tool execution strategy
//  Step 4: TAKE ACTION       — Execute tools in the planned sequence
//  Step 5: OBSERVE & ITERATE — Evaluate quality, loop if needed
//
//  This orchestrator transforms a simple "save video" action into an
//  intelligent multi-step pipeline that classifies, fetches transcripts,
//  cross-references knowledge, generates category-optimized notes,
//  and self-evaluates output quality.
// ==============================================================================
import { callGroq, MODELS } from './groqClient.js';
import sysLogger from '../../config/logger.js';
import supabase from '../../config/supabaseClient.js';

import {
  createSession,
  getSession,
  updateSession,
  logToolExecution,
  clearSession,
} from './memory/sessionMemory.js';

import { buildContext, extractToolInput } from './contextBuilder.js';
import * as toolRegistry from './toolRegistry.js';

/** Maximum number of agent iterations before forcing completion */
const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS, 10) || 2;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initializes a new agent session and returns the sessionId.
 * Called by the Express route — returns immediately so HTTP response is fast.
 * This is Step 1 of the agentic loop — GET THE MISSION.
 *
 * @param {string} videoId - YouTube video ID
 * @param {string} userId - Authenticated user's UUID
 * @param {string} [userGoal] - Optional user-stated goal
 * @returns {string} sessionId
 */
export function initSession(videoId, userId, userGoal, options = {}) {
  const mission = userGoal || 'Process this YouTube video and generate structured study notes';
  const sessionId = createSession(videoId, mission);

  updateSession(sessionId, {
    userId,
    status: 'running',
    timestamp: options.timestamp !== undefined && options.timestamp !== null ? parseFloat(options.timestamp) : null,
    durationBefore: options.durationBefore !== undefined && options.durationBefore !== null ? parseInt(options.durationBefore, 10) : 60,
    durationAfter: options.durationAfter !== undefined && options.durationAfter !== null ? parseInt(options.durationAfter, 10) : 60,
  });

  sysLogger.info('Orchestrator: Session initialized', { sessionId, videoId, userId, options });
  return sessionId;
}

/**
 * Runs the full 5-step agent loop. This is the CORE FUNCTION.
 * Called asynchronously — the HTTP endpoint does NOT await this.
 *
 * @param {string} videoId - YouTube video ID
 * @param {string} userGoal - The user's stated goal
 * @param {string} userId - Authenticated user's UUID
 * @param {string} sessionId - Pre-created session ID from initSession()
 * @returns {Promise<object>} The final output object
 */
export async function runAgent(videoId, userGoal, userId, sessionId) {
  try {
    sysLogger.info('Orchestrator: ═══ AGENT RUN STARTING ═══', { sessionId, videoId });

    // ─── STEP 1: GET THE MISSION ───────────────────────────────────────────
    updateSession(sessionId, { currentStep: 1, status: 'running' });
    sysLogger.info('Orchestrator: Step 1 — GET THE MISSION', { sessionId });

    // ─── STEP 2: SCAN THE SCENE ────────────────────────────────────────────
    updateSession(sessionId, { currentStep: 2 });
    sysLogger.info('Orchestrator: Step 2 — SCAN THE SCENE', { sessionId });

    const videoMetadata = await fetchVideoMetadata(videoId);
    const userPreferences = await getUserPreferences(userId);

    updateSession(sessionId, {
      videoMetadata,
      userPreferences,
    });

    // ─── STEP 3 → 5: THINK, ACT, EVALUATE (with iteration loop) ──────────
    await executeAgentLoop(sessionId, videoId, userId);

    // ─── MISSION COMPLETE ──────────────────────────────────────────────────
    const session = getSession(sessionId);
    const finalOutput = formatFinalOutput(session);

    updateSession(sessionId, {
      finalOutput,
      status: 'complete',
      currentStep: 5,
    });

    sysLogger.info('Orchestrator: ═══ AGENT RUN COMPLETE ═══', {
      sessionId,
      videoId,
      iterations: session.iterationCount + 1,
      qualityScore: finalOutput.qualityScore,
      toolsUsed: finalOutput.toolsUsed,
    });

    // Schedule cleanup (keep result available for 5 minutes after completion)
    setTimeout(() => clearSession(sessionId), 300_000);

    return finalOutput;
  } catch (err) {
    sysLogger.error('Orchestrator: ═══ AGENT RUN FAILED ═══', {
      sessionId,
      videoId,
      error: err.message,
      stack: err.stack,
    });

    markFailed(sessionId, err);
    throw err;
  }
}

/**
 * Returns the current status of an agent session (for polling endpoint).
 *
 * @param {string} sessionId
 * @returns {object} Status object for the frontend
 */
export function getAgentStatus(sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return { found: false, error: 'Session not found or expired' };
  }

  return {
    found: true,
    sessionId: session.sessionId,
    status: session.status,
    step: session.currentStep,
    stepName: session.currentStepName,
    iteration: session.iterationCount + 1,
    toolsRun: session.toolsExecuted.map(t => ({
      name: t.toolName,
      timestamp: t.timestamp,
    })),
    videoTitle: session.videoMetadata?.title || null,
    hasResult: session.finalOutput !== null,
    error: session.error || null,
  };
}

/**
 * Returns the completed result for a finished agent session.
 *
 * @param {string} sessionId
 * @returns {object} The final output or an error status
 */
export function getResult(sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return { found: false, error: 'Session not found or expired' };
  }

  if (session.status !== 'complete') {
    return {
      found: true,
      ready: false,
      status: session.status,
      step: session.currentStep,
      stepName: session.currentStepName,
    };
  }

  return {
    found: true,
    ready: true,
    ...session.finalOutput,
  };
}

/**
 * Gracefully cancels an in-progress agent run.
 *
 * @param {string} sessionId
 * @returns {boolean} true if session was found and cancelled
 */
export function cancelAgent(sessionId) {
  const session = getSession(sessionId);
  if (!session) return false;

  updateSession(sessionId, {
    status: 'cancelled',
    error: 'Agent run cancelled by user',
  });

  // Clean up after a brief delay to allow status polling to see the cancellation
  setTimeout(() => clearSession(sessionId), 30_000);
  sysLogger.info('Orchestrator: Agent cancelled', { sessionId });
  return true;
}

/**
 * Marks a session as failed with error details.
 *
 * @param {string} sessionId
 * @param {Error} err
 */
export function markFailed(sessionId, err) {
  updateSession(sessionId, {
    status: 'failed',
    error: err.message || 'Unknown error',
  });

  // Keep failed sessions available for debugging (60 seconds)
  setTimeout(() => clearSession(sessionId), 60_000);
}

// ─── Core Agent Loop (Steps 3-5 with iteration) ─────────────────────────────

/**
 * Executes the THINK → ACT → EVALUATE loop, with optional iteration.
 * This is the heart of the agentic behavior — the LLM plans, tools execute,
 * and quality is evaluated. If quality is insufficient, we loop.
 *
 * @param {string} sessionId
 * @param {string} videoId
 * @param {string} userId
 */
async function executeAgentLoop(sessionId, videoId, userId) {
  let session = getSession(sessionId);

  for (let iteration = 0; iteration <= MAX_ITERATIONS; iteration++) {
    session = getSession(sessionId);

    // Check if cancelled
    if (session.status === 'cancelled') {
      sysLogger.info('Orchestrator: Agent was cancelled, stopping loop', { sessionId });
      return;
    }

    updateSession(sessionId, { iterationCount: iteration });

    // ─── STEP 3: THINK IT THROUGH ────────────────────────────────────────
    updateSession(sessionId, { currentStep: 3 });
    sysLogger.info(`Orchestrator: Step 3 — THINK IT THROUGH (iteration ${iteration + 1})`, { sessionId });

    const plan = await planToolSequence(sessionId);
    updateSession(sessionId, { plan });

    sysLogger.info('Orchestrator: Plan created', {
      sessionId,
      toolSequence: plan.toolSequence,
      reasoning: plan.reasoning,
    });

    // ─── STEP 4: TAKE ACTION ─────────────────────────────────────────────
    updateSession(sessionId, { currentStep: 4 });
    sysLogger.info('Orchestrator: Step 4 — TAKE ACTION', { sessionId });

    const toolResults = await executeToolSequence(sessionId, plan.toolSequence);
    updateSession(sessionId, { toolResults });

    // ─── STEP 5: OBSERVE & ITERATE ───────────────────────────────────────
    updateSession(sessionId, { currentStep: 5 });
    sysLogger.info('Orchestrator: Step 5 — OBSERVE & ITERATE', { sessionId });

    // Run quality evaluation
    const evaluationInput = extractToolInput(getSession(sessionId), 'evaluate_quality');
    const evalResult = await toolRegistry.executeTool('evaluate_quality', evaluationInput);
    const evaluation = evalResult.data || { average: 7, should_regenerate: false, issues: [] };

    logToolExecution(sessionId, 'evaluate_quality', evaluationInput, evaluation);

    sysLogger.info('Orchestrator: Quality evaluation', {
      sessionId,
      average: evaluation.average,
      shouldRegenerate: evaluation.should_regenerate,
      issues: evaluation.issues,
      iteration: iteration + 1,
    });

    // Decision: iterate or accept
    if (evaluation.should_regenerate && iteration < MAX_ITERATIONS) {
      sysLogger.info('Orchestrator: Quality below threshold — looping back to Step 3', {
        sessionId,
        average: evaluation.average,
        nextIteration: iteration + 2,
      });

      updateSession(sessionId, {
        qualityIssues: evaluation.issues,
      });

      // Continue the loop — goes back to Step 3
      continue;
    }

    // Quality is acceptable OR we've hit max iterations — store evaluation and exit
    updateSession(sessionId, {
      evaluation,
    });

    sysLogger.info('Orchestrator: Notes accepted', {
      sessionId,
      average: evaluation.average,
      totalIterations: iteration + 1,
    });

    return;
  }
}

// ─── Step 3 Implementation: Plan Tool Sequence ───────────────────────────────

/**
 * Uses Gemini to plan which tools to execute and in what order.
 * This is where the "agentic" behavior happens — the LLM DECIDES the strategy.
 *
 * @param {string} sessionId
 * @returns {Promise<{ toolSequence: string[], reasoning: string }>}
 */
async function planToolSequence(sessionId) {
  const session = getSession(sessionId);
  const context = buildContext(session, 3);

  try {
    const rawText = await callGroq({
      model: MODELS.FAST,
      systemPrompt: context.systemPrompt,
      userMessage: context.userMessage,
      temperature: 0.1,
      maxTokens: context.maxTokenBudget,
      jsonMode: true,
    });

    const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const plan = JSON.parse(jsonStr);

    // Validate tool names
    const validNames = toolRegistry.getToolNames();
    const validSequence = (plan.toolSequence || []).filter(name => validNames.includes(name));

    // Ensure generate_structured_notes is always included
    if (!validSequence.includes('generate_structured_notes')) {
      validSequence.push('generate_structured_notes');
    }

    // Remove evaluate_quality if the LLM added it (we run it separately)
    const filteredSequence = validSequence.filter(name => name !== 'evaluate_quality');

    return {
      toolSequence: filteredSequence,
      reasoning: plan.reasoning || 'LLM-planned sequence',
    };
  } catch (err) {
    sysLogger.warn('Orchestrator: Planning failed, using default sequence', { error: err.message });

    // Fallback: use a sensible default sequence
    return {
      toolSequence: [
        'get_youtube_transcript',
        'classify_video',
        'search_knowledge_base',
        'generate_structured_notes',
      ],
      reasoning: 'Default sequence (planning LLM call failed)',
    };
  }
}

// ─── Step 4 Implementation: Execute Tool Sequence ────────────────────────────

/**
 * Executes each tool in the planned sequence, passing results forward.
 * Each tool's output is stored in the session and can be used by subsequent tools.
 *
 * @param {string} sessionId
 * @param {string[]} toolSequence - Ordered array of tool names to execute
 * @returns {Promise<object>} Map of toolName → result
 */
async function executeToolSequence(sessionId, toolSequence) {
  const results = {};
  // Carry forward any previous results (from prior iterations)
  const session = getSession(sessionId);
  if (session.toolResults) {
    Object.assign(results, session.toolResults);
  }

  for (const toolName of toolSequence) {
    // Check if cancelled mid-execution
    const currentSession = getSession(sessionId);
    if (currentSession?.status === 'cancelled') {
      sysLogger.info('Orchestrator: Cancelled during tool execution', { sessionId, toolName });
      break;
    }

    // On re-generation iterations, skip tools we don't need to re-run
    if (session.iterationCount > 0) {
      // Only re-run generate_structured_notes on iteration loops
      if (toolName !== 'generate_structured_notes' && results[toolName]) {
        sysLogger.info(`Orchestrator: Skipping "${toolName}" — reusing previous result`, { sessionId });
        continue;
      }
    }

    sysLogger.info(`Orchestrator: Executing tool "${toolName}"`, { sessionId });

    // Build tool-specific inputs from session state
    // Update session with current results first so extractToolInput has access
    updateSession(sessionId, { toolResults: results });

    const toolInput = extractToolInput(getSession(sessionId), toolName);
    const startTime = Date.now();

    const toolResult = await toolRegistry.executeTool(toolName, toolInput);
    const durationMs = Date.now() - startTime;

    if (toolResult.success) {
      results[toolName] = toolResult.data;
    } else {
      sysLogger.warn(`Orchestrator: Tool "${toolName}" failed — continuing with fallback`, {
        sessionId,
        error: toolResult.error,
      });
      results[toolName] = { error: toolResult.error, fallback: true };
    }

    // Log the execution in the audit trail
    logToolExecution(sessionId, toolName, toolInput, toolResult.data || toolResult.error);

    // Update session with accumulated results
    updateSession(sessionId, { toolResults: results });
  }

  return results;
}

// ─── Data Fetching Helpers ───────────────────────────────────────────────────

/**
 * Fetches video metadata using YouTube's oEmbed endpoint (no API key needed).
 * This runs during Step 2 (SCAN THE SCENE).
 *
 * @param {string} videoId
 * @returns {Promise<object>} Video metadata or a minimal fallback object
 */
async function fetchVideoMetadata(videoId) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl);

    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || '',
        author_name: data.author_name || '',
        author_url: data.author_url || '',
        provider_name: data.provider_name || 'YouTube',
        thumbnail_url: data.thumbnail_url || '',
      };
    }
  } catch (err) {
    sysLogger.warn('Orchestrator: Failed to fetch video metadata', { videoId, error: err.message });
  }

  return {
    title: `YouTube Video ${videoId}`,
    author_name: 'Unknown',
    provider_name: 'YouTube',
  };
}

/**
 * Loads user preferences from Supabase (if they exist).
 * Preferences can influence note format, detail level, etc. (future feature).
 * This runs during Step 2 (SCAN THE SCENE).
 *
 * @param {string} userId
 * @returns {Promise<object>} User preferences or empty defaults
 */
async function getUserPreferences(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('stripe_subscription_status, trial_start_date')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return { tier: 'free', noteStyle: 'detailed' };
    }

    const trialStart = new Date(data.trial_start_date);
    const daysSinceTrialStart = (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24);
    const isPremium = data.stripe_subscription_status === 'active';
    const isTrialActive = daysSinceTrialStart <= 7;

    return {
      tier: isPremium ? 'premium' : isTrialActive ? 'trial' : 'free',
      noteStyle: 'detailed',
    };
  } catch (err) {
    sysLogger.warn('Orchestrator: Failed to load user preferences', { userId, error: err.message });
    return { tier: 'free', noteStyle: 'detailed' };
  }
}

// ─── Output Formatting ──────────────────────────────────────────────────────

/**
 * Formats the final output object that gets returned to the frontend.
 *
 * @param {object} session - The completed session state
 * @returns {object} Structured final output
 */
function formatFinalOutput(session) {
  const results = session.toolResults || {};
  const evaluation = session.evaluation || {};

  return {
    notes: results.generate_structured_notes?.notes || '',
    videoCategory: results.classify_video?.category || 'OTHER',
    videoTitle: session.videoMetadata?.title || '',
    videoChannel: session.videoMetadata?.author_name || '',
    qualityScore: evaluation.average || 0,
    qualityScores: evaluation.scores || {},
    relatedVideos: results.search_knowledge_base?.results || [],
    toolsUsed: session.toolsExecuted.map(t => t.toolName),
    iterationsNeeded: session.iterationCount + 1,
    transcriptSource: results.get_youtube_transcript?.source || 'unknown',
    transcriptLength: results.get_youtube_transcript?.charCount || 0,
    noteStructure: results.generate_structured_notes?.structure_used || 'unknown',
    processingTime: Date.now() - session.createdAt,
  };
}
