// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — TOOL: GET YOUTUBE TRANSCRIPT
//  Agentic Loop Step 4: Fetches the full spoken transcript of a YouTube video.
//  Primary method: youtube-transcript npm package (no API key needed).
//  Fallback: Returns video metadata (title + description) if captions unavailable.
// ==============================================================================
import { YoutubeTranscript } from 'youtube-transcript';
import sysLogger from '../../../config/logger.js';

/**
 * Fetches the full transcript of a YouTube video using auto-generated captions.
 * This is the most critical data-gathering tool — accurate notes require
 * actual spoken content rather than just the video title.
 *
 * @param {object} params
 * @param {string} params.videoId - YouTube video ID (e.g., 'dQw4w9WgXcQ')
 * @returns {Promise<object>} { transcript: string, source: 'captions'|'metadata_fallback', segments: array }
 */
export async function execute({ videoId, timestamp = null, durationBefore = 60, durationAfter = 60 }) {
  if (!videoId) {
    throw new Error('videoId is required to fetch transcript');
  }

  try {
    sysLogger.info('Tool[get_youtube_transcript]: Fetching captions', { videoId, timestamp });

    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });

    if (!segments || segments.length === 0) {
      sysLogger.warn('Tool[get_youtube_transcript]: No caption segments returned', { videoId });
      return buildFallbackResponse(videoId);
    }

    // Filter segments if timestamp is provided
    let filteredSegments = segments;
    let isSegmented = false;

    if (timestamp !== null && timestamp !== undefined) {
      const startTimeMs = Math.max(0, (timestamp - durationBefore) * 1000);
      const endTimeMs = (timestamp + durationAfter) * 1000;

      filteredSegments = segments.filter(seg => {
        const segStart = seg.offset;
        const segEnd = seg.offset + seg.duration;
        return (segStart >= startTimeMs && segStart <= endTimeMs) || 
               (segEnd >= startTimeMs && segEnd <= endTimeMs) ||
               (segStart <= startTimeMs && segEnd >= endTimeMs);
      });

      isSegmented = true;
    }

    if (filteredSegments.length === 0) {
      sysLogger.warn('Tool[get_youtube_transcript]: No caption segments in window, using full', { videoId, timestamp });
      filteredSegments = segments;
      isSegmented = false;
    }

    // Combine all segments into a clean transcript
    const fullTranscript = filteredSegments
      .map(seg => seg.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Create a snippet for classification (first ~500 chars)
    const snippet = fullTranscript.substring(0, 500);

    sysLogger.info('Tool[get_youtube_transcript]: Captions fetched successfully', {
      videoId,
      segmentCount: filteredSegments.length,
      charCount: fullTranscript.length,
      isSegmented,
      timestamp,
    });

    return {
      transcript: fullTranscript,
      snippet,
      source: isSegmented ? 'captions_segment' : 'captions',
      segmentCount: filteredSegments.length,
      charCount: fullTranscript.length,
      timestamp: isSegmented ? timestamp : null,
    };
  } catch (err) {
    sysLogger.warn('Tool[get_youtube_transcript]: Caption fetch failed, using fallback', {
      videoId,
      error: err.message,
    });
    return buildFallbackResponse(videoId);
  }
}

/**
 * Fallback when captions are unavailable: fetch video metadata via YouTube oEmbed.
 * oEmbed is a public endpoint — no API key required.
 */
async function buildFallbackResponse(videoId) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl);

    if (res.ok) {
      const data = await res.json();
      const fallbackText = `Video Title: ${data.title || 'Unknown'}. Channel: ${data.author_name || 'Unknown'}.`;
      return {
        transcript: fallbackText,
        snippet: fallbackText,
        source: 'metadata_fallback',
        segmentCount: 0,
        charCount: fallbackText.length,
      };
    }
  } catch (e) {
    sysLogger.warn('Tool[get_youtube_transcript]: oEmbed fallback also failed', { error: e.message });
  }

  return {
    transcript: `Video ID: ${videoId}. Transcript unavailable.`,
    snippet: `Video ID: ${videoId}. Transcript unavailable.`,
    source: 'metadata_fallback',
    segmentCount: 0,
    charCount: 0,
  };
}

/** Tool schema for LLM reasoning */
export const schema = {
  name: 'get_youtube_transcript',
  description:
    'Fetches the full transcript of a YouTube video. Use this when you need the actual spoken content of the video to generate accurate notes. Essential for tutorials and lectures. Falls back to video metadata if captions are unavailable.',
  parameters: {
    type: 'object',
    properties: {
      videoId: {
        type: 'string',
        description: 'The YouTube video ID (11-character string from the URL)',
      },
    },
    required: ['videoId'],
  },
};
