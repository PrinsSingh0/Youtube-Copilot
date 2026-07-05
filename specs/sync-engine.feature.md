# Behavior-Driven Specification Blueprint: Sync Engine

This specification serves as the architectural source of truth for our automatic video learning synchronization and Notion PKM database integrations.

---

## Functional Boundaries

Our synchronization pipeline is divided into two distinct domain boundaries:
1. **YouTube Processing**: Controlled strictly by the `youtube_analyst_agent` to fetch metadata and clean transcript segments.
2. **Notion Synchronization**: Managed strictly by the `notion_pkm_agent` to create notebook entries and append blocks.

---

## Gherkin Specifications

### Feature: Automatic Video Learning Synchronization

  Scenario: Successful transcript capture and sync migration
    Given the user provides a valid YouTube payload ID [[TARGET_VIDEO_ID]]
    When the youtube_analyst_agent successfully extracts a clean transcript asset
    Then the notion_pkm_agent must compile a new document entry inside [[NOTION_DATABASE_ID]]

---

## Nested YAML Configuration Block

```yaml
databaseParameters:
  provider: "supabase"
  sessionMemoryTable: "agent_sessions"
  pkmSyncTable: "notion_sync_logs"
  schemaVersion: "5.0.0"

requiredLibraries:
  - name: "express"
    version: "^4.19.2"
  - name: "cors"
    version: "^2.8.5"
  - name: "dotenv"
    version: "^16.6.1"
  - name: "groq-sdk"
    version: "^1.3.0"
  - name: "@supabase/supabase-js"
    version: "^2.49.8"
  - name: "@google/genai"
    version: "^2.6.0"
  - name: "youtube-transcript"
    version: "^1.3.1"
```
