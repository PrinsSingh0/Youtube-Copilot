---
name: youtube-summarizer
description: Analyze and summarize long YouTube video transcripts, extract clean semantic chapter packets, and format structured technical summaries using standardized markdown. Do not trigger for payment processing, billing audits, database schema migrations, or Notion database table re-indexing operations. Uses local transcript tools to process video IDs safely.
triggers:
  - "Summarize video"
  - "Extract transcript"
  - "Fetch transcript"
  - "Deep-dive video content"
anti_triggers:
  - "Billing query"
  - "Notion table re-index"
  - "Database backup"
allowed_tools:
  - "youtube-transcript-server/get_youtube_transcript"
  - "youtube-transcript-server/clarify_summarization_goal"
---

# YouTube Summarizer Skill

This skill offloads long video transcript summarization to a deterministic local pipeline to prevent prompt context window dilution.

## Agent Execution Checklist

Follow these steps exactly when a YouTube video summarization goal is received:

1. **Verify Input Parameters**
   - Check if a valid YouTube `videoId` (11-character alphanumeric code) is present.
   - If missing, execute `youtube-transcript-server/clarify_summarization_goal` to request details.

2. **Retrieve Transcript**
   - Call the tool `youtube-transcript-server/get_youtube_transcript` with the video ID.
   - On error or empty response, fallback to asking for user clarification.

3. **Pre-Process and Extract Key Metrics**
   - Pipe the raw transcript text into the local helper script `scripts/extract-metrics.js` to parse code snippets, reference URLs, and timestamps without loading raw text into the primary LLM context window.

4. **Construct Layout Structure**
   - Use the reference rubric `references/summarization-rubric.md` to classify terms and resolve abbreviations.
   - Map key metrics and parsed chapters into the standard template `assets/summary-template.md`.

5. **A2UI Conversion and Response Generation**
   - Execute the backend layout converter `utils/a2ui-converter.js` to render the bento grid format.
   - Wrap the structured content in `<a2ui-json>` elements and return the hybrid database response.
