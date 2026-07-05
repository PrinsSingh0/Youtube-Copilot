// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — GROQ CLIENT (src/agent/groqClient.js)
//  Shared Groq SDK client for the agentic pipeline.
//  All agent LLM calls (classify, generate, evaluate, plan) go through Groq.
//  Gemini is kept only for embedding generation (Groq has no embedding API).
// ==============================================================================
import Groq from 'groq-sdk';
import sysLogger from '../../config/logger.js';

let groqInstance = null;

function getGroqInstance() {
  if (!groqInstance) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY environment variable is missing or empty. Please add it to your .env file.');
    }
    groqInstance = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqInstance;
}

/**
 * Groq model tier mapping for the agent pipeline.
 *
 * FAST: llama-3.1-8b-instant — planning, classification, evaluation (cheap + fast)
 * QUALITY: llama-3.3-70b-versatile — note generation (best quality output)
 */
export const MODELS = {
  FAST: 'llama-3.1-8b-instant',
  QUALITY: 'llama-3.3-70b-versatile',
};

/**
 * Makes a Groq chat completion call with standardized error handling.
 *
 * @param {object} options
 * @param {string} options.model - Groq model name
 * @param {string} options.systemPrompt - System message
 * @param {string} options.userMessage - User message
 * @param {number} [options.temperature=0.3] - Temperature
 * @param {number} [options.maxTokens=1024] - Max output tokens
 * @param {boolean} [options.jsonMode=false] - Whether to request JSON output
 * @returns {Promise<string>} The assistant's response text
 */
export async function callGroq({
  model,
  systemPrompt,
  userMessage,
  temperature = 0.3,
  maxTokens = 1024,
  jsonMode = false,
}) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const requestOptions = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (jsonMode) {
    requestOptions.response_format = { type: 'json_object' };
  }

  const startTime = Date.now();
  const client = getGroqInstance();
  const response = await client.chat.completions.create(requestOptions);
  const durationMs = Date.now() - startTime;

  const text = response.choices?.[0]?.message?.content?.trim() || '';

  sysLogger.info('GroqClient: Call completed', {
    model,
    durationMs,
    inputTokens: response.usage?.prompt_tokens,
    outputTokens: response.usage?.completion_tokens,
    responseLength: text.length,
  });

  return text;
}

export default {
  get instance() {
    return getGroqInstance();
  }
};
