
# 🚀 YouTube Copilot (v5.0.0) — Headless Multi-Agent Knowledge & Engineering Factory

[![Track: Concierge Agents](https://img.shields.io/badge/Track-Concierge%20Agents-blueviolet?style=for-the-badge)](https://kaggle.com)
[![Framework: Google ADK](https://img.shields.io/badge/Framework-Google%20ADK-blue?style=for-the-badge)](https://github.com/google)
[![Runtime: Node.js Headless](https://img.shields.io/badge/Runtime-Node.js%20Headless-brightgreen?style=for-the-badge)](https://nodejs.org)
[![Security: Two--Tier%20Policy%20Engine](https://img.shields.io/badge/Security-Two--Tier%20Policy%20Engine-red?style=for-the-badge)](./copilot-backend/middleware/policy-engine.js)

YouTube Copilot (v5.0.0) is an enterprise-grade, completely headless personal knowledge concierge designed to solve the "Information Loss" crisis faced by technical self-learners. Built using the **Google Agent Development Kit (ADK)**, the system intercepts YouTube media tokens, runs a word-to-text ingestion engine, builds structured engineering briefs, and securely synchronizes them into a user's private Notion PKM workspace.

By stripping away heavy client dashboards and UI dependencies, the runtime operates inside a strict execution harness, utilizing progressive disclosure to optimize token windows and deploying an automated Git snapshot mechanism to neutralize malicious prompt injections.

---

## 🏗️ System Architecture & Data Flow


```

User Inbound Request (YouTube Link URL via Chrome Extension)
│
▼
┌───────────────────────────────────┐
│   Groq Core Orchestrator Loop     │ ◄── Tasks Decomposed via Factory Model
└─────────────────┬─────────────────┘
│
┌────────────────┴────────────────┐
▼ (A2A Domain Isolation Routing)   ▼
┌──────────────────────┐           ┌──────────────────────┐
│ youtube_analyst_agent│           │   notion_pkm_agent   │
│ Scoped to transcript │           │ Scoped to database   │
│ fetch and metrics    │           │ writes & formatting  │
└──────────────────────┘           └──────────────────────┘
│                                  │
└────────────────┬─────────────────┘
│
▼
┌─────────────────────────────────────────────────────────┐
│     The Harness Isolation Layer Engine Matrix           │
│ - /copilot-backend/middleware/secops-gateway.js (AgBOM) │
│ - /copilot-backend/middleware/policy-engine.js (Firewall)│
│ - /utils/context-resolver.js (Double Bracket Sanitation)│
└────────────────────────┬────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────┐
│              System Persistence Storage                 │
│       - Supabase pgvector Long-Term Memory              │
│       - Notion PKM Workspace Data Sync Nodes            │
└─────────────────────────────────────────────────────────┘

```

---

## 📋 Course Concepts Demonstrated (5 of 5 Days)

*   **Day 1 — The Harness Framework Architecture:** Implements the deterministic identity equation ($\text{Agent} = \text{Model} + \text{Harness}$). Core system properties remain statically bound inside `/.agents/AGENTS.md`, while structural validity is guaranteed via the `/bin/harness-hook.js` pre-flight parsing utility.
*   **Day 2 — Linear Model Context Protocol (MCP):** Completely decouples API overhead. The `youtube_analyst_agent` and `notion_pkm_agent` interface cleanly via `stdio` transport pipes, removing integration complexity down to a linear $O(N + M)$ scale.
*   **Day 3 — Progressive Disclosure Skills & RAG Memory:** Instructional manifests live separated within `/.agent-skills/` and open into active memory windows *only* upon keyword verification, keeping context overhead light. Long-term out-of-context storage is managed over Supabase `pgvector`.
*   **Day 4 — Continuous Effective Trust & Snapshot Rollbacks:** Every tool transaction scales a live dynamic assessment inside `secops-gateway.js`. If a prompt deviation is identified, an automated system circuit breaker activates an instant filesystem snapshot rollback to shield configurations.
*   **Day 5 — Two-Tier Policy Validation & Context Hygiene:** Incorporates a dual-layer gateway (`policy-engine.js`) providing local structural gating and semantic evaluation loops. Dynamic bracket strings are sanitized at runtime by the `context-resolver.js` utility before ingestion.

---

## 📁 Repository Directory Structure

The workspace maps perfectly across the following modular structure:


```

Ai Copilot 4.0 - Copy/
├── .agent-skills/             # Dynamic Task Instructions (Progressive Disclosure Runbooks)
├── .agents/                   # Master Configuration Matrices & Static Core Boundaries
├── assets/                    # Project Layout Icons and Branding Elements
├── bin/                       # Automation Vectors & Pre-Commit Verification Hooks
├── copilot-backend/           # Isolated Headless Node.js Core API Server Engine
│   ├── middleware/            # SecOps Gateways, Policy Engines, and Sanitizers
│   └── src/                   # Active MCP Sockets and Agent Framework Configurations
├── pages/                     # Extension Visual Layout Options Panels
├── specs/                     # Gherkin BDD Feature Specification Guidelines
├── tests/                     # Trajectory Validation Suites ($pass^k$ Metric Engines)
├── background.js              # Service Worker managing active link captures
├── content.js                 # Content script tracking YouTube DOM elements
├── inject.js                  # Isolated execution injection logic
├── manifest.json              # Chrome Extension Manifest V3 configuration profile
├── options.html               # Streamlined User Options Configuration Window
├── skills-lock.json           # Cryptographic manifest checksum locker
└── styles.css                 # Clean, minimalist frontend design styles

```

---

## 🛠️ Installation & Setup

### 1. Prerequisites
*   Node.js (v20.x or higher installed)
*   Google Chrome Browser
*   Supabase Account (with `pgvector` enabled)
*   Notion Integration Key & Database ID

### 2. Backend Environment Configuration
Navigate to the backend automation engine directory and set up your variables:
```bash
cd copilot-backend
cp .env.example .env

```

Open the newly created `.env` file and append your secure system configurations:

```env
PORT=3000
GROQ_API_KEY=gsk_your_live_secure_groq_key_here
YOUTUBE_API_KEY=AIzaSy_your_youtube_data_token
SUPABASE_URL=[https://your-project.supabase.co](https://your-project.supabase.co)
SUPABASE_ANON_KEY=eyJ_your_supabase_anon_token
NOTION_INTEGRATION_TOKEN=secret_your_notion_integration_token
NOTION_DATABASE_ID=your_target_notion_database_hash

```

*Note: The `.env` template is completely protected against public staging environments via our localized `.gitignore` definitions.*

### 3. Initialize Backend Dependencies

```bash
npm install
npm start

```

The server will boot up and spin standard `stdio` MCP communication pipes active on `http://localhost:3000`.

### 4. Mount the Chrome Extension Frontend

1. Open Google Chrome and type `chrome://extensions/` directly into the navigation search bar.
2. Toggle the **Developer mode** switch in the top-right corner to **ON**.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the root folder directory path: `Ai Copilot 4.0 - Copy/`.
5. The headless concierge widget is now securely integrated into your active browser interface.

---

## 🚀 How to Run & Verify

1. **OAuth Verification:** Click the Extension puzzle icon in your toolbar, navigate to options, and click "Authenticate Profile." Your tokens are downscoped and mounted directly onto environmental memory.
2. **Execute Synthesis Ingestion:** Open any technical development tutorial on YouTube (e.g., a tutorial detailing Transformer Mathematics).
3. **Trigger Concierge:** Click the 'Sync to PKM' icon inside your browser layout.
4. **Inspect Backend Traces:** Open your local VS Code terminal. Watch as the Word-to-Text mechanism reads the transcript via MCP, checks tool paths against `policy-engine.js`, logs the `AgBOM` footprint inside `secops-gateway.js`, and creates your file block.
5. **Review Clean Output:** Navigate to your private Notion workspace. A structured, timestamped engineering note document will be completely rendered and mapped inside your data tables automatically.

---

## 🛡️ Security & Evaluation Guarantees

* **Zero Leak Framework:** Running `git grep -i "key\|token"` across the codebase returns zero raw text instances, proving execution states pull safely from environmental configurations.
* **Trajectory Assertion:** Structural integrity is evaluated across an automated testing sweep verifying tool trajectories strictly matching expected behavioral boundaries.

---

## 🤝 Acknowledgements

Built under the rigorous guidelines of the **5-Day AI Agents Intensive Course with Google and Kaggle** (July 2026). Special thanks to the engineering instructors for establishing the blueprint guidelines for production-grade Agentic Engineering.

```

```
