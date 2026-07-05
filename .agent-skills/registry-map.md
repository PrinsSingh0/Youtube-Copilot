# Internal A2A Registry Map & Agent Cards

This registry map provides machine-readable identities (Agent Cards), execution boundaries, and routing logic for the Universal AI Learning Copilot's distributed micro-agent subsystem.

---

## Agent Cards Catalog

### 1. YouTube Analyst Agent (`youtube_analyst_agent`)

| Attribute | Details |
| :--- | :--- |
| **Agent ID** | `youtube_analyst_agent` |
| **Domain Scope** | Scanning video transcripts, fetching metadata, extracting semantic chapters, and executing multi-turn clarification loops. |
| **Execution Boundary** | Watch actions only; cannot modify external state, write to databases, or trigger PKM synching. |
| **Associated MCP Server** | `youtube-transcript-server` |
| **Assigned LLM Model** | `llama3-70b-8192` (via Groq Client - High Capacity) |

#### Capabilities & JSON-RPC 2.0 Tools Schema
```json
{
  "tools": [
    {
      "name": "get_youtube_transcript",
      "description": "Extracts clean text segments from a video timeline with timestamps.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "videoId": { "type": "string" },
          "language": { "type": "string", "default": "en" }
        },
        "required": ["videoId"]
      }
    },
    {
      "name": "clarify_summarization_goal",
      "description": "Engages in multi-turn clarification if user requirements are ambiguous or key concepts are missing.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "prompt": { "type": "string" },
          "missingContext": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["prompt"]
      }
    }
  ]
}
```

---

### 2. Notion PKM Agent (`notion_pkm_agent`)

| Attribute | Details |
| :--- | :--- |
| **Agent ID** | `notion_pkm_agent` |
| **Domain Scope** | Syncing notes, organizing content into clusters/notebooks, constructing database schemas/tables, and executing deduplication algorithms. |
| **Execution Boundary** | Read/write Notion database operations only; cannot query video APIs, run transcript fetchers, or interpret video visual content. |
| **Associated MCP Server** | `notion-pkm-sync-server` |
| **Assigned LLM Model** | `llama3-8b-8192` (via Groq Client - Fast / Structure-optimized) |

#### Capabilities & JSON-RPC 2.0 Tools Schema
```json
{
  "tools": [
    {
      "name": "sync_notes_to_notion",
      "description": "Sends a structured layout to a Notion page or database block.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "pageId": { "type": "string" },
          "contentBlocks": {
            "type": "array",
            "items": { "type": "object" }
          }
        },
        "required": ["pageId", "contentBlocks"]
      }
    },
    {
      "name": "deduplicate_notes",
      "description": "Runs text similarity calculations on recent notes to consolidate duplicates.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "notes": {
            "type": "array",
            "items": { "type": "string" }
          }
        },
        "required": ["notes"]
      }
    }
  ]
}
```

---

## Agent-to-Agent (A2A) Interaction Schema & Routing Profile

To avoid prompt context overload, agents are run as separate execution threads. Conversational state is routed through the **Primary Groq Orchestrator** using structured messages.

### Message Routing Flow (A2A Protocol v0.9)

```mermaid
sequenceDiagram
    autonumber
    actor User as Human / Client UI
    participant Prim as Primary Groq Orchestrator
    participant YT as YouTube Analyst Agent
    participant Notion as Notion PKM Agent
    database DB as Supabase Session State

    User->>Prim: "Summarize video & save to Notion"
    Note over Prim: Inspects goals & maps routing path
    
    Prim->>YT: Handoff Control [Fetch & Analyze Transcript]
    Note over YT: Scans transcript segments & creates notes
    YT-->>Prim: Return Note Packets (State ID: x45a)
    
    Prim->>DB: Persist note packets in Session Memory
    
    Prim->>Notion: Handoff Control [Sync structured table]
    Note over Notion: Formats layout, dedups notes, and syncs
    Notion-->>Prim: Sync Confirmation & Layout Data
    
    Prim->>User: Emits Bento Grid Hybrid UI response
```

### Conversational State Preservation JSON Payload Schema

Agents transmit control flows using a unified `A2AEnvelope` schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "A2AEnvelope",
  "type": "object",
  "properties": {
    "sessionId": { "type": "string", "format": "uuid" },
    "fromAgentId": { "type": "string" },
    "toAgentId": { "type": "string" },
    "routingPath": {
      "type": "array",
      "items": { "type": "string" }
    },
    "conversationalState": {
      "type": "object",
      "properties": {
        "messageHistory": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "role": { "type": "string", "enum": ["user", "assistant", "system"] },
              "content": { "type": "string" }
            },
            "required": ["role", "content"]
          }
        },
        "videoMetadata": { "type": "object" },
        "accumulatedPayloads": { "type": "object" }
      },
      "required": ["messageHistory"]
    },
    "currentPayload": { "type": "object" }
  },
  "required": ["sessionId", "fromAgentId", "toAgentId", "conversationalState"]
}
```
