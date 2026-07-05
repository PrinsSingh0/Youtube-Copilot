// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — CONTEXT BUILDER (src/agent/contextBuilder.js)
//  Agentic Loop: Context engineering module that curates exactly what
//  information the LLM sees at each step. THE GOLDEN RULE: never dump
//  everything into context — select only what the LM needs for THIS step.
// ==============================================================================
import * as toolRegistry from './toolRegistry.js';

/**
 * The Agent's Constitution — base system prompt that establishes identity
 * and behavioral guardrails for all agent reasoning steps.
 */
const AGENT_CONSTITUTION = `You are the YouTube Copilot AI Agent — an intelligent video processing assistant that generates high-quality, structured study notes from YouTube videos.

CORE PRINCIPLES:
1. You PLAN before you act — analyze the video type before choosing a note-taking strategy
2. You use TOOLS methodically — each tool serves a specific purpose in your pipeline
3. You EVALUATE your own output — if quality is insufficient, you iterate and improve
4. You are CONCISE in reasoning — make decisions quickly and explain them briefly
5. You NEVER fabricate content — only use information from the actual transcript

BEHAVIORAL RULES:
- Always classify the video FIRST to choose the right note format
- If transcript is unavailable, work with whatever metadata you have
- Related videos from the knowledge base are optional enrichment, not required
- Quality evaluation is the final gate — notes must score ≥ 7/10 average
- Maximum 2 iterations total — after that, deliver the best result you have`;

/**
 * Builds a curated context object for the LLM at a specific agent step.
 * Each step gets ONLY the information relevant to its task — no more.
 *
 * @param {object} session - The current session state from sessionMemory
 * @param {number} step - The agent step number (2, 3, 4, or 5)
 * @returns {object} Context object with: systemPrompt, userMessage, availableTools, memoryContext, maxTokenBudget
 */
export function buildContext(session, step) {
  switch (step) {
    case 2:
      return buildScanContext(session);
    case 3:
      return buildThinkContext(session);
    case 4:
      return buildActContext(session);
    case 5:
      return buildEvaluateContext(session);
    default:
      throw new Error(`buildContext called with invalid step: ${step}`);
  }
}

/**
 * Step 2 — SCAN THE SCENE
 * Context: Video metadata + available tool list ONLY.
 * Purpose: Give the LLM awareness of what it's working with and what tools exist.
 */
function buildScanContext(session) {
  const toolSchemas = toolRegistry.getSchemas();

  return {
    systemPrompt: AGENT_CONSTITUTION,
    userMessage: `You are scanning the scene for a new video processing mission.

MISSION: ${session.mission}
VIDEO ID: ${session.videoId}
${session.videoMetadata ? formatVideoMetadata(session.videoMetadata) : 'Video metadata not yet loaded.'}

AVAILABLE TOOLS:
${toolSchemas.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Acknowledge the mission and available resources. No action needed yet.`,
    availableTools: toolSchemas,
    memoryContext: '',
    maxTokenBudget: 500,
  };
}

/**
 * Step 3 — THINK IT THROUGH
 * Context: Scan results + tool schemas + mission.
 * Purpose: LLM plans which tools to call and in what order.
 * This is where the agent's intelligence shows — it DECIDES the strategy.
 */
function buildThinkContext(session) {
  const toolSchemas = toolRegistry.getSchemas();
  const toolNames = toolRegistry.getToolNames();

  // Include quality issues from previous iteration if this is a re-plan
  const qualityFeedback = session.qualityIssues?.length > 0
    ? `\n\n⚠️ PREVIOUS ITERATION FEEDBACK (address these issues):\n${session.qualityIssues.map(i => `- ${i}`).join('\n')}`
    : '';

  // Include results from previous iteration if available
  const previousResults = session.iterationCount > 0 && session.toolResults
    ? `\n\nPREVIOUS TOOL RESULTS AVAILABLE:\n${Object.keys(session.toolResults).map(k => `- ${k}: completed`).join('\n')}`
    : '';

  return {
    systemPrompt: `${AGENT_CONSTITUTION}

You are now in the PLANNING phase. Your job is to decide which tools to run and in what order.

RESPOND WITH ONLY A VALID JSON OBJECT — no markdown, no explanation, no code blocks.
The JSON must have this exact structure:
{"toolSequence": ["tool_name_1", "tool_name_2", ...], "reasoning": "brief explanation"}

IMPORTANT RULES:
- Valid tool names are: ${JSON.stringify(toolNames)}
- You SHOULD include "get_youtube_transcript" to get the actual video content
- You SHOULD include "classify_video" to determine the note-taking strategy  
- You MUST include "generate_structured_notes" — this is the primary output tool
- Do NOT include "evaluate_quality" — that runs automatically after your plan executes
- "search_knowledge_base" is optional — include it for cross-referencing with user's saved videos
- Order matters: get transcript → classify → (optional: search) → generate notes`,
    userMessage: `Plan the tool execution sequence for this mission.

MISSION: ${session.mission}
VIDEO ID: ${session.videoId}
${session.videoMetadata ? formatVideoMetadata(session.videoMetadata) : ''}
ITERATION: ${session.iterationCount + 1}${qualityFeedback}${previousResults}

Respond with the JSON tool sequence.`,
    availableTools: toolSchemas,
    memoryContext: formatMemoryContext(session),
    maxTokenBudget: 300,
  };
}

/**
 * Step 4 — TAKE ACTION
 * Context: Only the specific inputs needed for the current tool.
 * Purpose: The orchestrator calls this per-tool to build focused input.
 * NOTE: This returns a generic context — the orchestrator extracts tool-specific inputs.
 */
function buildActContext(session) {
  return {
    systemPrompt: AGENT_CONSTITUTION,
    userMessage: `Executing tools for mission: ${session.mission}`,
    availableTools: [],
    memoryContext: formatMemoryContext(session),
    maxTokenBudget: 0,  // No LLM call needed in this step — tools execute directly
  };
}

/**
 * Step 5 — OBSERVE & ITERATE
 * Context: Original transcript + generated notes ONLY.
 * Purpose: Quality evaluation — the LLM judges its own output.
 */
function buildEvaluateContext(session) {
  const transcriptResult = session.toolResults?.get_youtube_transcript;
  const notesResult = session.toolResults?.generate_structured_notes;

  return {
    systemPrompt: AGENT_CONSTITUTION,
    userMessage: `Evaluate the quality of the generated notes.

ORIGINAL TRANSCRIPT AVAILABLE: ${transcriptResult ? 'Yes' : 'No'}
GENERATED NOTES AVAILABLE: ${notesResult ? 'Yes' : 'No'}
VIDEO CATEGORY: ${session.toolResults?.classify_video?.category || 'UNKNOWN'}`,
    availableTools: [],
    memoryContext: '',
    maxTokenBudget: 500,
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Formats video metadata into a human-readable string for LLM context.
 */
function formatVideoMetadata(meta) {
  if (!meta) return '';
  const parts = [
    `VIDEO METADATA:`,
    meta.title ? `  Title: ${meta.title}` : null,
    meta.author_name ? `  Channel: ${meta.author_name}` : null,
    meta.provider_name ? `  Platform: ${meta.provider_name}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Formats session history into a concise memory string.
 * Only includes what's relevant — not the full session dump.
 */
function formatMemoryContext(session) {
  if (!session.toolsExecuted || session.toolsExecuted.length === 0) {
    return 'No tools executed yet.';
  }

  return `TOOLS EXECUTED SO FAR:\n${session.toolsExecuted
    .map(t => `- ${t.toolName} (${t.timestamp})`)
    .join('\n')}`;
}

/**
 * Extracts the appropriate tool input parameters from the session state.
 * Called by the orchestrator during Step 4 for each tool in the plan.
 *
 * @param {object} session - Current session state
 * @param {string} toolName - The tool to extract inputs for
 * @returns {object} The input parameters for the tool
 */
export function extractToolInput(session, toolName) {
  const meta = session.videoMetadata || {};
  const results = session.toolResults || {};

  switch (toolName) {
    case 'get_youtube_transcript':
      return {
        videoId: session.videoId,
        timestamp: session.timestamp !== undefined ? session.timestamp : null,
        durationBefore: session.durationBefore !== undefined ? session.durationBefore : 60,
        durationAfter: session.durationAfter !== undefined ? session.durationAfter : 60,
      };

    case 'classify_video':
      return {
        title: meta.title || `Video ${session.videoId}`,
        description: meta.description || '',
        transcript_snippet: results.get_youtube_transcript?.snippet || '',
      };

    case 'search_knowledge_base':
      return {
        query: meta.title || session.videoId,
        limit: 5,
        userId: session.userId || null,
      };

    case 'generate_structured_notes':
      return {
        transcript: results.get_youtube_transcript?.transcript || meta.title || '',
        category: results.classify_video?.category || 'OTHER',
        related_videos: results.search_knowledge_base?.results || [],
        user_preferences: session.userPreferences || {},
        recommended_structure: results.classify_video?.recommended_structure || null,
        quality_issues: session.qualityIssues || [],
        timestamp: session.timestamp !== undefined ? session.timestamp : null,
      };

    case 'evaluate_quality':
      return {
        original_transcript: results.get_youtube_transcript?.transcript || '',
        generated_notes: results.generate_structured_notes?.notes || '',
        category: results.classify_video?.category || 'OTHER',
      };

    default:
      return {};
  }
}
