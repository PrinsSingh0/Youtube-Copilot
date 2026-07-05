// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — TOOL: SEARCH KNOWLEDGE BASE (RAG)
//  Agentic Loop Step 4: Vector similarity search via Supabase pgvector.
//  Finds related videos the user has previously saved for cross-referencing.
//  Gracefully degrades if the embeddings table doesn't exist yet.
// ==============================================================================
import { GoogleGenAI } from '@google/genai';
import supabase from '../../../config/supabaseClient.js';
import sysLogger from '../../../config/logger.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** Embedding model — Gemini's embedding model (768 dimensions) */
const EMBEDDING_MODEL = 'gemini-embedding-2';

/** Table and column names for the embeddings store */
const EMBEDDINGS_TABLE = 'video_note_embeddings';
const MATCH_FUNCTION = 'match_video_notes'; // Supabase RPC function for cosine similarity

/**
 * Searches the user's existing saved videos using vector similarity.
 * Enables cross-referencing: "You saved a related video about X last week."
 *
 * @param {object} params
 * @param {string} params.query - Natural language search query (e.g., video title or topic)
 * @param {number} [params.limit=5] - Max number of related results to return
 * @param {string} [params.userId] - Optional user ID to scope search
 * @returns {Promise<object>} { results: array, searched: boolean, resultCount: number }
 */
export async function execute({ query, limit = 5, userId = null }) {
  if (!query) {
    return { results: [], searched: false, resultCount: 0, reason: 'No query provided' };
  }

  try {
    // Step 1: Generate embedding for the search query
    sysLogger.info('Tool[search_knowledge_base]: Generating query embedding', { queryLength: query.length });

    const embedding = await generateEmbedding(query);
    if (!embedding) {
      return { results: [], searched: false, resultCount: 0, reason: 'Embedding generation failed' };
    }

    // Step 2: Run pgvector similarity search via Supabase RPC
    sysLogger.info('Tool[search_knowledge_base]: Running vector similarity search', { limit });

    const rpcParams = {
      query_embedding: embedding,
      match_threshold: 0.5,   // Minimum cosine similarity
      match_count: limit,
    };

    // Scope to user if provided
    if (userId) {
      rpcParams.filter_user_id = userId;
    }

    const { data, error } = await supabase.rpc(MATCH_FUNCTION, rpcParams);

    if (error) {
      // Check if the error is because the table/function doesn't exist
      if (
        error.message?.includes('does not exist') ||
        error.message?.includes('could not find') ||
        error.code === '42883' || // undefined_function
        error.code === '42P01'    // undefined_table
      ) {
        sysLogger.info('Tool[search_knowledge_base]: Embeddings table/function not set up yet — skipping RAG', {
          errorCode: error.code,
        });
        return {
          results: [],
          searched: false,
          resultCount: 0,
          reason: 'Knowledge base not configured — embeddings table does not exist yet',
        };
      }
      throw error;
    }

    const results = (data || []).map(row => ({
      videoId: row.video_id,
      title: row.title,
      category: row.category,
      similarity: parseFloat(row.similarity?.toFixed(3) || 0),
      noteSnippet: row.note_snippet || '',
      savedAt: row.created_at,
    }));

    sysLogger.info('Tool[search_knowledge_base]: Search complete', { resultCount: results.length });

    return {
      results,
      searched: true,
      resultCount: results.length,
    };
  } catch (err) {
    sysLogger.error('Tool[search_knowledge_base]: Search failed', { error: err.message });

    // Graceful degradation — RAG failure should never block note generation
    return {
      results: [],
      searched: false,
      resultCount: 0,
      reason: `Search failed: ${err.message}`,
    };
  }
}

/**
 * Generates a text embedding using Gemini's text-embedding-004 model.
 *
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} Embedding vector or null on failure
 */
async function generateEmbedding(text) {
  try {
    // Truncate to avoid token limit issues (embedding models handle ~2048 tokens well)
    const truncated = text.substring(0, 4000);

    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: truncated,
    });

    return response?.embedding?.values || null;
  } catch (err) {
    sysLogger.error('Tool[search_knowledge_base]: Embedding generation failed', { error: err.message });
    return null;
  }
}

/** Tool schema for LLM reasoning */
export const schema = {
  name: 'search_knowledge_base',
  description:
    'Searches the user\'s existing saved videos in Supabase using vector similarity. Use this to find related content the user has already saved, enabling cross-referencing in notes. Returns empty results gracefully if the knowledge base is not yet configured.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query — typically the video title or main topic',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of related results to return (default: 5)',
      },
    },
    required: ['query'],
  },
};
