// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — TOOL: CLASSIFY VIDEO
//  Agentic Loop Step 4: Classifies video type to determine optimal note strategy.
//  This tool should run FIRST in the tool sequence — its output shapes everything else.
//  LLM: Groq (llama-3.1-8b-instant) — fast model for simple classification.
// ==============================================================================
import { callGroq, MODELS } from '../groqClient.js';
import sysLogger from '../../../config/logger.js';

/**
 * Classifies a YouTube video into a category using a focused Groq call.
 * The classification determines which note-taking template is used downstream.
 *
 * Categories: TUTORIAL, LECTURE, TALK, INTERVIEW, DOCUMENTARY, OTHER
 *
 * @param {object} params
 * @param {string} params.title - Video title
 * @param {string} [params.description] - Video description (optional)
 * @param {string} [params.transcript_snippet] - First ~500 chars of transcript
 * @returns {Promise<object>} { category, confidence, recommended_structure }
 */
export async function execute({ title, description = '', transcript_snippet = '' }) {
  if (!title) {
    throw new Error('title is required for video classification');
  }

  const systemPrompt = `You are a precise video content classifier. Your ONLY job is to classify videos into exactly one category. Respond with ONLY a valid JSON object — no markdown, no explanation, no code blocks.

CATEGORIES:
- TUTORIAL: Step-by-step how-to, coding walkthrough, tool demo, DIY guide
- LECTURE: Academic lesson, course content, educational deep-dive with structured teaching
- TALK: Conference talk, TED talk, keynote, motivational speech, panel discussion
- INTERVIEW: Q&A format, podcast-style conversation, guest interview
- DOCUMENTARY: Historical, investigative, narrative non-fiction, explainer doc
- OTHER: Music, entertainment, vlog, review, unboxable, or anything that doesn't fit above

RECOMMENDED NOTE STRUCTURES:
- TUTORIAL → "step_by_step" (numbered steps with code blocks and key commands)
- LECTURE → "concept_hierarchy" (main concepts → sub-concepts → definitions → examples)  
- TALK → "key_insights" (speaker's main arguments, memorable quotes, takeaways)
- INTERVIEW → "qa_format" (question-answer pairs with key quotes)
- DOCUMENTARY → "narrative_summary" (timeline, key facts, conclusions)
- OTHER → "general_summary" (bullet-point summary with timestamps)`;

  const userMessage = `Classify this video:

TITLE: ${title}
${description ? `DESCRIPTION: ${description.substring(0, 300)}` : ''}
${transcript_snippet ? `TRANSCRIPT EXCERPT: ${transcript_snippet.substring(0, 400)}` : ''}

Respond with JSON: {"category": "...", "confidence": 0.0-1.0, "recommended_structure": "..."}`;

  try {
    sysLogger.info('Tool[classify_video]: Classifying video', { title });

    const rawText = await callGroq({
      model: MODELS.FAST,
      systemPrompt,
      userMessage,
      temperature: 0.1,
      maxTokens: 150,
      jsonMode: true,
    });

    const result = JSON.parse(rawText);

    // Validate and normalize
    const validCategories = ['TUTORIAL', 'LECTURE', 'TALK', 'INTERVIEW', 'DOCUMENTARY', 'OTHER'];
    const category = validCategories.includes(result.category?.toUpperCase())
      ? result.category.toUpperCase()
      : 'OTHER';

    const structureMap = {
      TUTORIAL: 'step_by_step',
      LECTURE: 'concept_hierarchy',
      TALK: 'key_insights',
      INTERVIEW: 'qa_format',
      DOCUMENTARY: 'narrative_summary',
      OTHER: 'general_summary',
    };

    const output = {
      category,
      confidence: Math.min(1, Math.max(0, parseFloat(result.confidence) || 0.5)),
      recommended_structure: result.recommended_structure || structureMap[category],
    };

    sysLogger.info('Tool[classify_video]: Classification complete', output);
    return output;
  } catch (err) {
    sysLogger.error('Tool[classify_video]: Classification failed, defaulting to OTHER', {
      error: err.message,
      title,
    });

    // Graceful fallback — never let classification failure stop the pipeline
    return {
      category: 'OTHER',
      confidence: 0.1,
      recommended_structure: 'general_summary',
    };
  }
}

/** Tool schema for LLM reasoning */
export const schema = {
  name: 'classify_video',
  description:
    'Classifies the video into a category: TUTORIAL, LECTURE, TALK, INTERVIEW, DOCUMENTARY, or OTHER. Use this FIRST to determine the optimal note-taking strategy. The classification drives which template is used for note generation.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The YouTube video title',
      },
      description: {
        type: 'string',
        description: 'The video description text (optional, first 300 chars used)',
      },
      transcript_snippet: {
        type: 'string',
        description: 'First ~500 characters of the transcript for better classification',
      },
    },
    required: ['title'],
  },
};
