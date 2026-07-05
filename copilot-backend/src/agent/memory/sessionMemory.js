// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — AGENT SESSION MEMORY (src/agent/memory/sessionMemory.js)
//  Agentic Loop: Short-term memory store for active agent sessions.
//  Each "Save Video" action gets its own isolated session with full state tracking.
// ==============================================================================
import { v4 as uuidv4 } from 'uuid';

/**
 * Session TTL in milliseconds. Sessions are auto-purged after this duration
 * to prevent unbounded memory growth on long-running server instances.
 * Default: 10 minutes (configurable via AGENT_SESSION_TTL_MS env var).
 */
const SESSION_TTL_MS = parseInt(process.env.AGENT_SESSION_TTL_MS, 10) || 600_000;

/** @type {Map<string, object>} Active agent sessions keyed by sessionId */
const sessions = new Map();

/** @type {Map<string, NodeJS.Timeout>} TTL cleanup timers keyed by sessionId */
const timers = new Map();

// ─── Step Name Map ───────────────────────────────────────────────────────────
const STEP_NAMES = {
  1: 'get_mission',
  2: 'scan_scene',
  3: 'think',
  4: 'take_action',
  5: 'observe_iterate',
};

/**
 * Creates a new agent session for a video processing run.
 * This is Step 1 of the agentic loop — GET THE MISSION.
 *
 * @param {string} videoId - YouTube video ID to process
 * @param {string} mission - The user's stated goal (e.g., "save and process this video")
 * @returns {string} sessionId - UUID identifying this agent run
 */
export function createSession(videoId, mission) {
  const sessionId = uuidv4();
  const now = Date.now();

  const session = {
    sessionId,
    mission: mission || 'Process and generate structured notes for this video',
    videoId,
    videoMetadata: null,
    userPreferences: null,
    currentStep: 1,
    currentStepName: STEP_NAMES[1],
    toolsExecuted: [],
    currentContext: {},
    plan: null,
    toolResults: {},
    iterationCount: 0,
    qualityIssues: [],
    finalOutput: null,
    status: 'running',
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(sessionId, session);

  // Schedule auto-cleanup
  const timer = setTimeout(() => {
    clearSession(sessionId);
  }, SESSION_TTL_MS);
  timers.set(sessionId, timer);

  return sessionId;
}

/**
 * Retrieves the current state of an agent session.
 * Used by all steps of the agentic loop to read current context.
 *
 * @param {string} sessionId
 * @returns {object|null} The full session state object, or null if expired/missing
 */
export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

/**
 * Merges partial updates into an existing session's state.
 * Used between and during agent steps to persist intermediate results.
 *
 * @param {string} sessionId
 * @param {object} updates - Partial state object to merge
 * @returns {boolean} true if session existed and was updated
 */
export function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  // If step is being updated, also update the step name
  if (updates.currentStep && STEP_NAMES[updates.currentStep]) {
    updates.currentStepName = STEP_NAMES[updates.currentStep];
  }

  Object.assign(session, updates, { updatedAt: Date.now() });
  return true;
}

/**
 * Appends a tool execution record to the session's audit trail.
 * This is the Agent Ops trace — every tool call is logged with timing.
 * Called during Step 4 (TAKE ACTION) of the agentic loop.
 *
 * @param {string} sessionId
 * @param {string} toolName - snake_case name of the tool
 * @param {object} input - The input parameters passed to the tool
 * @param {object} output - The tool's return value
 */
export function logToolExecution(sessionId, toolName, input, output) {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.toolsExecuted.push({
    toolName,
    input: summarizeForLog(input),
    output: summarizeForLog(output),
    timestamp: new Date().toISOString(),
    durationMs: null, // Caller can set this if they measure timing
  });

  session.updatedAt = Date.now();
}

/**
 * Removes a session from memory and cancels its TTL timer.
 * Called after agent completes (Step 5) or on explicit cancel.
 *
 * @param {string} sessionId
 */
export function clearSession(sessionId) {
  sessions.delete(sessionId);
  const timer = timers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(sessionId);
  }
}

/**
 * Returns a count of active sessions (for health monitoring).
 * @returns {number}
 */
export function getActiveSessionCount() {
  return sessions.size;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Truncates large objects before storing in the execution log.
 * Prevents memory bloat from full transcripts in the audit trail.
 */
function summarizeForLog(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj.length > 500 ? obj.substring(0, 500) + '...[truncated]' : obj;
  }
  if (typeof obj === 'object') {
    try {
      const json = JSON.stringify(obj);
      if (json.length > 1000) {
        // Store a summary instead of the full object
        return { _summary: `Object with ${Object.keys(obj).length} keys`, _truncated: true };
      }
      return obj;
    } catch {
      return { _summary: 'Non-serializable object', _truncated: true };
    }
  }
  return obj;
}
