/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — RUNTIME SECOPS GATEWAY (middleware/secops-gateway.js)
 *  ★ CORE SECURITY HARNESS ★ — Governing tool loops, JIT tokens, and intent drift.
 * ==============================================================================
 */

import { execSync } from 'child_process';
import sysLogger from '../config/logger.js';

// --- AgBOM Dictionary state ---
export const agBOM = {
  activeModels: [],
  filePointers: [],
  toolLatencies: [],
  lastUpdated: null
};

/**
 * AgBOM tracking functions
 */
export function trackModelUse(modelName, tokensIn = 0, tokensOut = 0) {
  const modelIndex = agBOM.activeModels.findIndex(m => m.name === modelName);
  if (modelIndex > -1) {
    agBOM.activeModels[modelIndex].calls += 1;
    agBOM.activeModels[modelIndex].tokensIn += tokensIn;
    agBOM.activeModels[modelIndex].tokensOut += tokensOut;
  } else {
    agBOM.activeModels.push({
      name: modelName,
      calls: 1,
      tokensIn,
      tokensOut
    });
  }
  agBOM.lastUpdated = new Date().toISOString();
}

export function trackFileAccess(filePath, operation) {
  agBOM.filePointers.push({
    filePath,
    operation,
    timestamp: new Date().toISOString()
  });
  agBOM.lastUpdated = new Date().toISOString();
}

export function trackToolLatency(toolName, durationMs) {
  agBOM.toolLatencies.push({
    toolName,
    durationMs,
    timestamp: new Date().toISOString()
  });
  agBOM.lastUpdated = new Date().toISOString();
}

// --- Just-In-Time Authorization ---
const jitTokens = new Map();

/**
 * Generates a task-restricted JIT token that auto-expires.
 * @param {string} taskId
 * @param {string} originalCredential
 * @param {number} [lifespanMs=1000] Default lifespan is very short
 * @returns {string} Short-lived temporary token
 */
export function createJITToken(taskId, originalCredential, lifespanMs = 1000) {
  const jitToken = `jit_token_${taskId}_${Date.now()}`;
  
  jitTokens.set(jitToken, {
    credential: originalCredential,
    expiresAt: Date.now() + lifespanMs
  });

  // Schedule automatic cleanup / revocation
  setTimeout(() => {
    jitTokens.delete(jitToken);
  }, lifespanMs);

  return jitToken;
}

/**
 * Validates and retrieves the original credential for a JIT token.
 */
export function validateJITToken(jitToken) {
  const entry = jitTokens.get(jitToken);
  if (!entry) {
    throw new Error('JIT Security Violation: Token does not exist or has expired.');
  }
  if (Date.now() > entry.expiresAt) {
    jitTokens.delete(jitToken);
    throw new Error('JIT Security Violation: Token has expired.');
  }
  return entry.credential;
}

/**
 * Revokes a JIT token immediately.
 */
export function revokeJITToken(jitToken) {
  return jitTokens.delete(jitToken);
}

// --- Intent Drift & Circuit Breaker ---
/**
 * Asserts agent score alignment to session goals and executes hard filesystem rollbacks on failure.
 * @param {string} sessionId
 * @param {string} originalGoal
 * @param {Array} traces
 * @param {number} alignmentScore
 */
export function checkIntentDrift(sessionId, originalGoal, traces, alignmentScore) {
  const DRIFT_LIMIT = 0.6;

  if (alignmentScore < DRIFT_LIMIT) {
    sysLogger.error({
      message: 'CRITICAL SECURITY BREACH: Intent drift detected! Circuit breaker triggered.',
      sessionId,
      originalGoal,
      alignmentScore,
      driftLimit: DRIFT_LIMIT,
      traceCount: traces.length
    });

    try {
      // Rollback filesystem modifications using git snapshot checkpoint
      sysLogger.warn('[SecOps Circuit Breaker] Freezing execution and executing Git filesystem rollback...');
      execSync('git reset --hard HEAD', { stdio: 'pipe' });
      execSync('git clean -df', { stdio: 'pipe' });
      sysLogger.info('[SecOps Circuit Breaker] Hard filesystem restore complete.');
    } catch (gitErr) {
      sysLogger.error(`[SecOps Circuit Breaker] Git rollback execution failed: ${gitErr.message}`);
    }

    throw new Error(`[SecOps Circuit Breaker] Transaction aborted due to intent drift. Score: ${alignmentScore}`);
  }
}

/**
 * Express middleware wrapper for SecOps headers check
 */
export function secopsGatewayMiddleware(req, res, next) {
  const secopsSignature = req.headers['x-secops-signature'];
  if (!secopsSignature && process.env.NODE_ENV === 'production') {
    sysLogger.warn('SecOps Gateway Block: Missing x-secops-signature header');
    return res.status(403).json({ error: 'Forbidden: Request lacks valid SecOps signature.' });
  }
  next();
}
