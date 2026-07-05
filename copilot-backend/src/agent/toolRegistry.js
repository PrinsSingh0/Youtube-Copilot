// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — TOOL REGISTRY (src/agent/toolRegistry.js)
//  Agentic Loop: Central registry of all available tools with OpenAPI-style schemas.
//  The LLM uses these schemas to reason about which tools to call and in what order.
// ==============================================================================
import sysLogger from '../../config/logger.js';

import * as getYouTubeTranscript from './tools/getYouTubeTranscript.js';
import * as classifyVideo from './tools/classifyVideo.js';
import * as searchKnowledgeBase from './tools/searchKnowledgeBase.js';
import * as generateNotes from './tools/generateNotes.js';
import * as evaluateQuality from './tools/evaluateQuality.js';

/**
 * Internal tool map: name → { schema, execute }
 * @type {Map<string, { schema: object, execute: function }>}
 */
const tools = new Map();

// ─── Register All Tools ──────────────────────────────────────────────────────

function registerTool(module) {
  if (!module.schema || !module.execute) {
    throw new Error(`Tool module is missing 'schema' or 'execute' export`);
  }
  tools.set(module.schema.name, {
    schema: module.schema,
    execute: module.execute,
  });
  sysLogger.info(`ToolRegistry: Registered tool "${module.schema.name}"`);
}

registerTool(getYouTubeTranscript);
registerTool(classifyVideo);
registerTool(searchKnowledgeBase);
registerTool(generateNotes);
registerTool(evaluateQuality);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns all registered tools as an array of { schema, execute } objects.
 * Used in Step 2 (SCAN THE SCENE) to show the LLM what tools are available.
 *
 * @returns {Array<{ schema: object, execute: function }>}
 */
export function getAll() {
  return Array.from(tools.values());
}

/**
 * Returns a specific tool by name.
 * Used in Step 4 (TAKE ACTION) to execute a planned tool.
 *
 * @param {string} name - The snake_case tool name
 * @returns {{ schema: object, execute: function }|undefined}
 */
export function get(name) {
  return tools.get(name);
}

/**
 * Returns just the schemas for all tools (without execute functions).
 * Used in Step 3 (THINK IT THROUGH) — passed to the LLM so it can reason
 * about which tools to call without exposing implementation details.
 *
 * @returns {Array<object>} Array of OpenAPI-style tool schemas
 */
export function getSchemas() {
  return Array.from(tools.values()).map(t => t.schema);
}

/**
 * Returns tool names as an array of strings.
 * Used for quick validation and logging.
 *
 * @returns {string[]}
 */
export function getToolNames() {
  return Array.from(tools.keys());
}

/**
 * Checks if a tool name is valid/registered.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function has(name) {
  return tools.has(name);
}

/**
 * Executes a named tool with the given parameters, wrapped in error handling.
 * Returns a standardized result envelope.
 *
 * @param {string} name - Tool name
 * @param {object} params - Tool input parameters
 * @returns {Promise<{ success: boolean, data?: any, error?: string, durationMs: number }>}
 */
export async function executeTool(name, params) {
  const tool = tools.get(name);
  if (!tool) {
    return {
      success: false,
      error: `Tool "${name}" is not registered`,
      durationMs: 0,
    };
  }

  const startTime = Date.now();
  try {
    const result = await tool.execute(params);
    const durationMs = Date.now() - startTime;

    sysLogger.info(`ToolRegistry: "${name}" executed successfully`, { durationMs });

    return {
      success: true,
      data: result,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    sysLogger.error(`ToolRegistry: "${name}" execution failed`, {
      error: err.message,
      durationMs,
    });

    return {
      success: false,
      error: err.message,
      durationMs,
    };
  }
}
