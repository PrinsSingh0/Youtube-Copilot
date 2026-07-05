/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — CONTEXT HYGIENE RESOLVER (utils/context-resolver.js)
 *  ★ CORE UTILITY ★ — Sterilizes variable assets and translates double brackets.
 * ==============================================================================
 */

/**
 * Resolves a template string by replacing [[VARIABLE_NAME]] occurrences.
 * Prioritizes keys in overrideState, falls back to process.env.
 * Leaves unresolved blocks intact to prevent silent pipeline updates.
 *
 * @param {string} templateString - String containing brackets
 * @param {Object} [overrideState={}] - Runtime state overrides
 * @returns {string} Fully resolved string
 */
export function resolveContext(templateString, overrideState = {}) {
  if (typeof templateString !== 'string') return templateString;

  const bracketRegex = /\[\[([^\]]+)\]\]/g;

  return templateString.replace(bracketRegex, (match, varName) => {
    const trimmedVar = varName.trim();

    // 1. Prioritize overrideState
    if (overrideState && trimmedVar in overrideState) {
      return String(overrideState[trimmedVar]);
    }

    // 2. Fallback to process.env
    if (process.env && trimmedVar in process.env) {
      return String(process.env[trimmedVar]);
    }

    // 3. Fallback to leaving the original block intact
    return match;
  });
}

/**
 * Recursively resolves all strings inside a nested object/array/payload structure.
 *
 * @param {*} payload - Tool arguments or configuration payload
 * @param {Object} [overrideState={}] - Runtime state overrides
 * @returns {*} Sanitized and resolved payload structure
 */
export function resolvePayload(payload, overrideState = {}) {
  if (typeof payload === 'string') {
    return resolveContext(payload, overrideState);
  }
  
  if (Array.isArray(payload)) {
    return payload.map(item => resolvePayload(item, overrideState));
  }
  
  if (payload !== null && typeof payload === 'object') {
    const resolved = {};
    for (const [key, value] of Object.entries(payload)) {
      resolved[key] = resolvePayload(value, overrideState);
    }
    return resolved;
  }
  
  return payload;
}
