// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — TOOL: GENERATE STRUCTURED NOTES
//  Agentic Loop Step 4: Generates category-optimized notes from transcript.
//  This is the primary value-delivery tool — it produces the user's final output.
//  Always call classify_video BEFORE this tool to get the optimal template.
//  LLM: Groq (llama-3.3-70b-versatile) — best quality model for primary output.
// ==============================================================================
import { callGroq, MODELS } from '../groqClient.js';
import sysLogger from '../../../config/logger.js';

/**
 * Category-specific system prompts that shape the LLM's note-taking strategy.
 * Each template is designed for maximum utility per video type.
 */
const CATEGORY_PROMPTS = {
  step_by_step: `You are an expert technical writer creating step-by-step notes from a tutorial video.

FORMAT REQUIREMENTS:
- Start with a brief "Overview" section (2-3 sentences summarizing what the tutorial covers)
- Number each step clearly (Step 1, Step 2, etc.)
- For each step, include:
  - A clear action heading
  - The specific commands, code, or actions to take (in code blocks if applicable)
  - Any important warnings or gotchas (prefix with ⚠️)
- End with a "Key Takeaways" section (3-5 bullet points)
- Use markdown formatting throughout
- If code is involved, specify the language in code blocks`,

  concept_hierarchy: `You are a university-level note-taker creating structured concept notes from a lecture.

FORMAT REQUIREMENTS:
- Start with the "Core Thesis" (1-2 sentences on the main argument/topic)
- Organize into major concept sections using ## headings
- Under each concept:
  - Definition (clear, concise)
  - Key details and sub-concepts (bullet points)
  - Examples mentioned by the speaker
  - Connections to other concepts (if any)
- End with:
  - "Summary" (5-7 bullet points of the most important ideas)
  - "Questions to Explore" (2-3 thought-provoking follow-ups)
- Use markdown formatting throughout`,

  key_insights: `You are a professional conference note-taker capturing key insights from a talk or presentation.

FORMAT REQUIREMENTS:
- Start with "Speaker's Core Message" (1-2 sentences)
- List "Key Insights" as numbered items (aim for 5-8)
  - Each insight should be a clear, standalone takeaway
  - Include supporting evidence or examples the speaker used
- "Memorable Quotes" section (exact or paraphrased notable lines, in blockquotes)
- "Actionable Takeaways" (what the viewer can do with this information)
- Use markdown formatting throughout`,

  qa_format: `You are a skilled journalist creating structured notes from an interview or conversation.

FORMAT REQUIREMENTS:
- Start with "Context" (who is being interviewed, about what, 2-3 sentences)
- Structure as Q&A pairs:
  - **Q:** [Topic or question discussed]
  - **A:** [Key points from the response]
- Highlight "Notable Quotes" in blockquotes
- End with "Key Revelations" (3-5 most important things learned)
- Use markdown formatting throughout`,

  narrative_summary: `You are a documentary analyst creating comprehensive notes from a documentary or explainer video.

FORMAT REQUIREMENTS:
- Start with "Subject Overview" (what the documentary covers, 2-3 sentences)
- "Timeline of Events" or "Key Facts" (chronological or logical order)
- "Main Arguments / Findings" (what the documentary concludes)
- "Supporting Evidence" (data, expert opinions, or case studies mentioned)
- "Critical Perspective" (any biases or alternative viewpoints to consider)
- Use markdown formatting throughout`,

  general_summary: `You are an intelligent note-taker creating a comprehensive summary of a video.

FORMAT REQUIREMENTS:
- Start with a brief "Summary" (3-4 sentences on what the video covers)
- "Main Points" (5-8 bullet points of the most important content)
- "Details & Examples" (supporting details organized by topic)
- "Key Takeaways" (3-5 actionable or memorable points)
- Use markdown formatting throughout`,
};

/**
 * Generates structured notes optimized for the video's category.
 * This is the heaviest LLM call — uses the full transcript context.
 *
 * @param {object} params
 * @param {string} params.transcript - Full video transcript
 * @param {string} params.category - Video category from classify_video
 * @param {array} [params.related_videos] - Related videos from RAG search
 * @param {object} [params.user_preferences] - User's note preferences (future use)
 * @param {string} [params.recommended_structure] - Structure key from classification
 * @param {array} [params.quality_issues] - Issues from previous iteration (if re-generating)
 * @returns {Promise<object>} { notes: string, structure_used: string, char_count: number }
 */
export async function execute({
  transcript,
  category,
  related_videos = [],
  user_preferences = {},
  recommended_structure = null,
  quality_issues = [],
  timestamp = null,
}) {
  if (!transcript) {
    throw new Error('transcript is required to generate notes');
  }

  const structure = recommended_structure || categoryToStructure(category);
  const systemPrompt = CATEGORY_PROMPTS[structure] || CATEGORY_PROMPTS.general_summary;

  // Build the user message with all available context
  let userMessage = '';
  if (timestamp !== null && timestamp !== undefined) {
    userMessage += `Generate detailed, high-quality notes for the video segment around timestamp ${timestamp} seconds (±60s window) from the transcript snippet below.\n\n`;
  } else {
    userMessage += `Generate detailed, high-quality notes from the following video transcript.\n\n`;
  }
  userMessage += `VIDEO CATEGORY: ${category || 'OTHER'}\n\n`;

  // Add transcript (truncate if very long to stay within Groq's context window)
  // llama-3.3-70b-versatile supports 128k context, but we cap at ~25k chars for cost/speed
  const maxTranscriptChars = 25000;
  const truncatedTranscript = transcript.length > maxTranscriptChars
    ? transcript.substring(0, maxTranscriptChars) + '\n\n[...transcript truncated for length]'
    : transcript;

  userMessage += `TRANSCRIPT:\n${truncatedTranscript}\n\n`;

  // Add related videos context if available (RAG enrichment)
  if (related_videos.length > 0) {
    userMessage += `RELATED VIDEOS THE USER HAS PREVIOUSLY SAVED (use for cross-referencing):\n`;
    related_videos.forEach(v => {
      userMessage += `- "${v.title}" (similarity: ${v.similarity}) — ${v.noteSnippet || 'no snippet'}\n`;
    });
    userMessage += '\nMention connections to related saved content where relevant.\n\n';
  }

  // If re-generating after quality check, include the feedback
  if (quality_issues.length > 0) {
    userMessage += `⚠️ QUALITY FEEDBACK FROM PREVIOUS GENERATION (address these issues):\n`;
    quality_issues.forEach(issue => {
      userMessage += `- ${issue}\n`;
    });
    userMessage += '\nImprove the notes to address ALL listed issues.\n\n';
  }

  userMessage += `Generate the notes now. Use markdown formatting. Be comprehensive but concise.`;

  try {
    sysLogger.info('Tool[generate_structured_notes]: Generating notes', {
      category,
      structure,
      transcriptLength: transcript.length,
      hasRelatedVideos: related_videos.length > 0,
      isRegeneration: quality_issues.length > 0,
    });

    const notes = await callGroq({
      model: MODELS.QUALITY,
      systemPrompt,
      userMessage,
      temperature: 0.4,
      maxTokens: 4096,
    });

    if (!notes) {
      throw new Error('Groq returned empty notes');
    }

    sysLogger.info('Tool[generate_structured_notes]: Notes generated successfully', {
      notesLength: notes.length,
      structure,
    });

    return {
      notes,
      structure_used: structure,
      category,
      char_count: notes.length,
    };
  } catch (err) {
    sysLogger.error('Tool[generate_structured_notes]: Generation failed', { error: err.message });

    // Fallback: return a basic summary rather than nothing
    return {
      notes: `## Video Notes\n\n*Note generation encountered an issue. Here is the raw transcript excerpt:*\n\n${transcript.substring(0, 2000)}`,
      structure_used: 'fallback',
      category: category || 'OTHER',
      char_count: 0,
      error: err.message,
    };
  }
}

/**
 * Maps category to structure key
 */
function categoryToStructure(category) {
  const map = {
    TUTORIAL: 'step_by_step',
    LECTURE: 'concept_hierarchy',
    TALK: 'key_insights',
    INTERVIEW: 'qa_format',
    DOCUMENTARY: 'narrative_summary',
    OTHER: 'general_summary',
  };
  return map[category?.toUpperCase()] || 'general_summary';
}

/** Tool schema for LLM reasoning */
export const schema = {
  name: 'generate_structured_notes',
  description:
    'Generates notes in a format optimized for the video category. TUTORIAL gets step-by-step format. LECTURE gets concept-hierarchy format. TALK gets key-insights format. Always call classify_video before this tool to select the right template.',
  parameters: {
    type: 'object',
    properties: {
      transcript: {
        type: 'string',
        description: 'The full video transcript text',
      },
      category: {
        type: 'string',
        description: 'Video category from classify_video (TUTORIAL, LECTURE, TALK, etc.)',
      },
      related_videos: {
        type: 'array',
        description: 'Related videos from knowledge base search for cross-referencing',
      },
      user_preferences: {
        type: 'object',
        description: 'User note preferences (future use)',
      },
      quality_issues: {
        type: 'array',
        description: 'Issues from previous quality evaluation (for re-generation)',
      },
    },
    required: ['transcript', 'category'],
  },
};
