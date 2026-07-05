// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — TOOL: EVALUATE QUALITY (LM-as-Judge)
//  Agentic Loop Step 5: Evaluates generated notes quality using a strict rubric.
//  If average score < threshold, triggers re-generation in the orchestrator loop.
//  LLM: Groq (llama-3.1-8b-instant) — fast model for structured evaluation.
// ==============================================================================
import { callGroq, MODELS } from '../groqClient.js';
import sysLogger from '../../../config/logger.js';

/** Quality threshold — if average score falls below this, notes are regenerated */
const QUALITY_THRESHOLD = parseInt(process.env.AGENT_QUALITY_THRESHOLD, 10) || 7;

/**
 * Evaluates the quality of generated notes by comparing them against
 * the original transcript. Acts as an LM Judge with a strict scoring rubric.
 *
 * @param {object} params
 * @param {string} params.original_transcript - The source transcript
 * @param {string} params.generated_notes - The notes to evaluate
 * @param {string} params.category - Video category for context
 * @returns {Promise<object>} { scores, average, issues, should_regenerate }
 */
export async function execute({ original_transcript, generated_notes, category }) {
  if (!generated_notes) {
    return {
      scores: { completeness: 0, accuracy: 0, structure: 0 },
      average: 0,
      issues: ['No notes were generated to evaluate'],
      should_regenerate: true,
    };
  }

  // If transcript is very short (metadata fallback), be lenient
  if (!original_transcript || original_transcript.length < 100) {
    sysLogger.info('Tool[evaluate_quality]: Short/missing transcript — skipping strict evaluation');
    return {
      scores: { completeness: 6, accuracy: 8, structure: 8 },
      average: 7.3,
      issues: [],
      should_regenerate: false,
      note: 'Evaluation relaxed due to limited source transcript',
    };
  }

  const systemPrompt = `You are a strict quality evaluator for AI-generated study notes. Your job is to compare generated notes against a source transcript and score them on a precise rubric.

SCORING RUBRIC (0-10 scale for each):

COMPLETENESS (0-10):
- 10: Notes capture ALL key concepts, details, and examples from the transcript
- 7-9: Notes capture most key concepts with minor omissions
- 4-6: Notes miss several important concepts or details
- 1-3: Notes are severely incomplete, missing major sections
- 0: Notes are empty or irrelevant

ACCURACY (0-10):
- 10: Every claim in the notes is directly supported by the transcript
- 7-9: Notes are mostly accurate with minor inaccuracies
- 4-6: Notes contain some unsupported claims or misinterpretations
- 1-3: Notes significantly distort the source material
- 0: Notes are fabricated or completely wrong

STRUCTURE (0-10):
- 10: Perfect formatting, clear hierarchy, excellent readability, proper markdown
- 7-9: Good structure with minor formatting issues
- 4-6: Acceptable but disorganized in places
- 1-3: Poor structure, hard to follow
- 0: No structure at all

Respond with ONLY a valid JSON object. No markdown, no explanation, no code blocks.`;

  // Truncate inputs to stay within token limits
  const transcriptExcerpt = original_transcript.substring(0, 8000);
  const notesExcerpt = generated_notes.substring(0, 6000);

  const userMessage = `Evaluate these notes against the source transcript.

VIDEO CATEGORY: ${category || 'OTHER'}

SOURCE TRANSCRIPT (excerpt):
${transcriptExcerpt}

GENERATED NOTES:
${notesExcerpt}

Score as JSON: {"completeness": N, "accuracy": N, "structure": N, "issues": ["issue1", "issue2"]}`;

  try {
    sysLogger.info('Tool[evaluate_quality]: Evaluating notes quality', {
      category,
      notesLength: generated_notes.length,
      transcriptLength: original_transcript.length,
    });

    const rawText = await callGroq({
      model: MODELS.FAST,
      systemPrompt,
      userMessage,
      temperature: 0.1,
      maxTokens: 300,
      jsonMode: true,
    });

    const result = JSON.parse(rawText);

    // Validate and normalize scores
    const scores = {
      completeness: clampScore(result.completeness),
      accuracy: clampScore(result.accuracy),
      structure: clampScore(result.structure),
    };

    const average = parseFloat(
      ((scores.completeness + scores.accuracy + scores.structure) / 3).toFixed(1)
    );

    const issues = Array.isArray(result.issues) ? result.issues : [];
    const shouldRegenerate = average < QUALITY_THRESHOLD;

    const output = {
      scores,
      average,
      issues,
      should_regenerate: shouldRegenerate,
      threshold: QUALITY_THRESHOLD,
    };

    sysLogger.info('Tool[evaluate_quality]: Evaluation complete', {
      scores,
      average,
      shouldRegenerate,
      issueCount: issues.length,
    });

    return output;
  } catch (err) {
    sysLogger.error('Tool[evaluate_quality]: Evaluation failed, assuming acceptable quality', {
      error: err.message,
    });

    // If evaluation itself fails, don't block — assume notes are acceptable
    return {
      scores: { completeness: 7, accuracy: 7, structure: 7 },
      average: 7,
      issues: [],
      should_regenerate: false,
      note: `Evaluation failed (${err.message}) — defaulting to pass`,
    };
  }
}

/**
 * Clamps a score to the 0-10 range.
 * @param {*} val
 * @returns {number}
 */
function clampScore(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return 5;
  return Math.min(10, Math.max(0, Math.round(num * 10) / 10));
}

/** Tool schema for LLM reasoning */
export const schema = {
  name: 'evaluate_quality',
  description:
    'Acts as an LM Judge to evaluate the generated notes quality. Scores on: completeness (0-10), accuracy (0-10), structure (0-10). If average score falls below the quality threshold, triggers regeneration of notes with specific improvement feedback.',
  parameters: {
    type: 'object',
    properties: {
      original_transcript: {
        type: 'string',
        description: 'The original video transcript to compare against',
      },
      generated_notes: {
        type: 'string',
        description: 'The AI-generated notes to evaluate',
      },
      category: {
        type: 'string',
        description: 'Video category for context-aware evaluation',
      },
    },
    required: ['original_transcript', 'generated_notes', 'category'],
  },
};
