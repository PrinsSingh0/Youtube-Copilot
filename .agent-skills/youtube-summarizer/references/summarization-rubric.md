# Technical Summarization Rubric & Edge-Case Models

This reference sheet defines core concepts, acronyms, and operational rules for processing technical YouTube video transcripts.

---

## Technical Acronym Definitions

- **MCP (Model Context Protocol)**: Open standard protocol that enables agents to access data sources and tools uniformly over JSON-RPC 2.0 stdio channels.
- **A2A (Agent-to-Agent)**: The protocol and message schema defining how distributed micro-agents negotiate control handoffs and exchange execution payloads.
- **A2UI (Agent-to-User Interface)**: Declarative, safe UI protocol (v0.9) that outputs layouts as flat adjacency lists to prevent execution of arbitrary code on the client.
- **PKM (Personal Knowledge Management)**: The backend system mapping study notes, summaries, and annotations to persistent workspaces (e.g. Notion or local databases).
- **ADK (Agent Development Kit)**: Suite of testing, verification, and evaluation utilities supporting validation metrics (e.g. $pass^k$).

---

## Edge-Case Classification Models

### 1. Extremely Long Video (> 2 Hours)
- **Problem**: Transcript token payload exceeds context limits or degrades LLM reasoning quality.
- **Classification & Handling**:
  - Automatically chunk the transcript into 20-minute segments.
  - Run the `extract-metrics.js` parser per segment.
  - Summarize each segment individually, then run a synthesis pass to compile the final bento grid layout.

### 2. Multi-Lingual Transcripts
- **Problem**: Transcript mixes languages, causing layout or translation mismatches.
- **Classification & Handling**:
  - The agent checks the `language` metadata field.
  - Uses standard translation fallback tools prior to extracting key concepts.

### 3. Code Block Heavy Transcripts
- **Problem**: Raw code blocks get truncated or corrupted during summarization.
- **Classification & Handling**:
  - `extract-metrics.js` extracts code blocks deterministically.
  - Safe-placeholders are inserted into the LLM prompt.
  - Code is re-injected post-summarization to guarantee exact character matching.

### 4. Missing / Empty Transcripts
- **Problem**: The video contains no subtitles or automated transcript files.
- **Classification & Handling**:
  - Trigger `youtube-transcript-server/clarify_summarization_goal`.
  - Fall back to fetching title, description, and tags to create a high-level summary skeleton.
