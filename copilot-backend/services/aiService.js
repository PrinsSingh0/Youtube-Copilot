// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — GEMINI AI SERVICE (services/aiService.js)
//  Task 3.3: Isolated Gemini 2.5 Flash intent interpreter with fallback
// ==============================================================================
import { GoogleGenAI } from '@google/genai';
import { callGroq, MODELS } from '../src/agent/groqClient.js';
import sysLogger from '../config/logger.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Helper to call ai.models.generateContent with fallback across models and retries.
 * @param {string|Array} contents
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function generateContentWithFallback(contents, options = {}) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
  let lastError = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        sysLogger.info(`Gemini API call: model=${model}, attempt=${attempt}`);
        const response = await ai.models.generateContent({
          model,
          contents,
          ...options,
        });
        if (response?.text) {
          return response;
        }
      } catch (err) {
        lastError = err;
        const isTransient = err.status === 503 || err.status === 429 || 
                            (err.message && (err.message.includes('503') || err.message.includes('429') || err.message.includes('Resource has been exhausted')));
        
        sysLogger.warn(`Gemini API call failed: model=${model}, attempt=${attempt}, error=${err.message}`);
        
        if (!isTransient) {
          // If it's a non-transient error (like 400 bad request/key), fall back to the next model immediately
          break;
        }

        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  throw lastError || new Error('Gemini API call failed all models and retries.');
}

/**
 * Polishes raw transcription text via Gemini — cleans grammar,
 * capitalization, and punctuation. Returns original text on failure.
 * @param {string} rawText
 * @returns {Promise<string>}
 */
export async function polishTranscription(rawText) {
  if (!rawText || !rawText.trim()) return rawText;

  const prompt = `Clean up the grammar, capitalization, and punctuation of this technical note recorded from a video transcript. Do not add any extra commentary or wrap it in quotes. Return ONLY the polished text:\n\n"${rawText}"`;

  try {
    const response = await callGroq({
      model: MODELS.FAST,
      systemPrompt: 'You are a precise editor. Polish the user text by correcting grammar and punctuation. Keep all technical terms exactly as they are.',
      userMessage: prompt,
      temperature: 0.1,
      maxTokens: 1024,
    });
    if (response) return response.trim();
  } catch (err) {
    sysLogger.error('Groq polish failed — returning raw text', { error: err.message });
  }
  return rawText;
}

/**
 * Generates a context-aware AI suggestion based on current text + transcript context.
 * @param {string} currentText
 * @param {string} transcriptContext
 * @param {string|null} imageBase64
 * @returns {Promise<string>}
 */
export async function generateSuggestion(currentText, transcriptContext, imageBase64 = null) {
  let instructions = `You are an elite study assistant integrated into a YouTube notebook extension.\n\n`;
  instructions += `CONTEXT FROM THE LAST 60 SECONDS OF VIDEO PLAYER TRANSCRIPT:\n"${transcriptContext || ''}"\n\n`;

  const isScreenshotMode = currentText === '[Analyze Captured Frame Context]' || imageBase64 !== null;

  if (isScreenshotMode) {
    instructions = `You are an elite study assistant integrated into a YouTube notebook extension.\n\n`;
    instructions += `TRANSCRIPT CONTEXT SURROUNDING THE SCREENSHOT (60 seconds before and 60 seconds after):\n"${transcriptContext || ''}"\n\n`;
    instructions += `USER ACTION: The user just took a screen snapshot of the video.\n\n`;
    instructions += `TASK:\n`;
    instructions += `1. Read and analyze any visible text, code, equations, or diagrams in the screenshot.\n`;
    instructions += `2. Correlate and synthesize this visual content with the provided transcript context.\n`;
    instructions += `3. Generate a premium, high-density, and detailed study note recommendation that captures the core concept. The note must be highly educational, helping a student write detailed notes.\n`;
    instructions += `4. Keep it to 2-3 detailed and complete sentences. Avoid generic intro phrases (like "This screenshot shows...", "In this video...", "Here is a note:") and start directly with the key technical takeaway.`;
  } else {
    instructions += `USER'S CURRENT TYPED THOUGHT:\n"${currentText || ''}"\n\n`;
    instructions += `TASK: Complete their thought contextually using the transcript segment. Keep output under 15 words total acting like an autocomplete block selection.`;
  }
  instructions += `\n\nCRITICAL RULE: Return ONLY the raw output. Do not wrap in quotes or code blocks.`;

  if (isScreenshotMode) {
    const contentsPayload = [instructions];
    if (imageBase64) {
      contentsPayload.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
    }

    try {
      const response = await generateContentWithFallback(contentsPayload);
      if (response?.text) return response.text.trim();
    } catch (err) {
      sysLogger.warn('Gemini vision suggestion failed, falling back to Groq text-only suggestion', { error: err.message });
      try {
        const textOnlyInstructions = instructions + "\n\n(Note: The screenshot analysis failed or was bypassed, so focus strictly on the surrounding transcript segment context to generate the detailed study note.)";
        const response = await callGroq({
          model: MODELS.FAST,
          systemPrompt: 'You are a premium study assistant generating detailed segment notes.',
          userMessage: textOnlyInstructions,
          temperature: 0.3,
          maxTokens: 150,
        });
        if (response) return response.trim();
      } catch (groqErr) {
        sysLogger.error('Groq suggestion fallback also failed', { error: groqErr.message });
        throw err;
      }
    }
  } else {
    try {
      const response = await callGroq({
        model: MODELS.FAST,
        systemPrompt: 'You are a precise study assistant autocomplete tool.',
        userMessage: instructions,
        temperature: 0.2,
        maxTokens: 50,
      });
      if (response) return response.trim();
    } catch (err) {
      sysLogger.error('Groq suggestion generation failed', { error: err.message });
      throw err;
    }
  }
  return '';
}

/**
 * Executes a voice edit intent (e.g. "change X to Y") via Gemini.
 * @param {string} currentText
 * @param {string} voiceCommand
 * @returns {Promise<string>}
 */
export async function executeEditIntent(currentText, voiceCommand) {
  const prompt = `You are a precise text editor. Apply ONLY the following edit command to the given text. Return ONLY the resulting text with no explanation or quotes.\n\nText: "${currentText}"\nCommand: "${voiceCommand}"`;

  try {
    sysLogger.info('Groq edit-intent request', { voiceCommand });
    const response = await callGroq({
      model: MODELS.FAST,
      systemPrompt: 'You are a text editing utility. Modify the text based on instructions, return only modified text.',
      userMessage: prompt,
      temperature: 0.1,
      maxTokens: 1024,
    });
    if (response) return response.trim();
  } catch (err) {
    sysLogger.error('Groq edit-intent failed', { error: err.message });
  }
  return currentText;
}
