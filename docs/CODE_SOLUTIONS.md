# Code Solutions Report -- Meet Buddy Dogfooding Session

**Generated:** 2026-03-19
**Source:** Meeting analysis from 2026-03-19 dogfooding session (Axit + Earth Clique)
**Agent:** Code Reviewer (maps meeting pain points to codebase solutions)

---

## Summary

This report maps each pain point and action item identified during the meeting to specific existing code, identifies gaps where new code is needed, and provides precise file locations for fixes. The meet-buddy codebase consists of 9 source files across 3 subsystems: Chrome Extension (7 files), MCP Server (1 TypeScript file + config), and Swarm Config (2 files).

---

## Pain Point 1: Tool needs fixes before broader use

**Severity:** HIGH
**Meeting context:** Axit explicitly stated "yah chijen fix kar" (fix these things) before expanding functionality.

### Existing Code

**File:** `extension/content/meet-scraper.js`

The scraper has a three-layer deduplication system that already addresses most caption quality issues:

1. **Stabilization window** (line 13): `STABILIZE_MS = 4_000` -- waits 4 seconds of no text changes before emitting a caption, preventing partial sentence emissions.

2. **Prefix deduplication** (lines 104-110): When new text starts with previously emitted text, only the delta (new portion) is emitted. This handles the common case where Google Meet appends to an existing caption block.

3. **Exact deduplication** (lines 113-120): The `emittedTexts` Set stores `speaker:text` keys and skips any already-emitted combination. Capped at 500 entries with pruning to 200 (lines 155-160).

4. **Force-emit timeout** (line 14): `MAX_BLOCK_AGE_MS = 30_000` -- forces emission of a caption block that has been growing for 30+ seconds, even if it has not stabilized.

### Gap

The stabilization logic fails during **long continuous speech** (30+ seconds of uninterrupted talking). Google Meet keeps appending to the same caption block, which resets `lastChanged` on every poll cycle. The result: the block eventually force-emits via `MAX_BLOCK_AGE_MS`, then the next text change starts a new tracking cycle that re-emits the entire growing block minus only the exact prefix match.

### Fix Location

`extension/content/meet-scraper.js`, lines 108-113

Add a minimum delta length threshold. Currently any non-empty delta is emitted:

```js
// CURRENT (line 112):
if (textToEmit && textToEmit.length > 1) {

// FIX: increase minimum delta to 10 characters to avoid tiny trailing fragments
if (textToEmit && textToEmit.length >= 10) {
```

Also increase `MAX_BLOCK_AGE_MS` from 30000 to 45000 (line 14) to give long speech blocks more time to fully stabilize before force-emit.

---

## Pain Point 2: Agent coordination complexity

**Severity:** MEDIUM
**Meeting context:** Running multiple agents simultaneously requires careful management; no visibility into agent status during a live meeting.

### Existing Code

**File:** `swarm/meeting-swarm.json`

A 6-agent hierarchical swarm is already defined:

| Agent | Type | Role | Depends On |
|-------|------|------|------------|
| coordinator | task-orchestrator | Watches transcript, delegates work | (root) |
| analyst | researcher | Extracts pain points, priorities, emotions | coordinator |
| solution-mapper | coder | Searches codebase for relevant solutions | analyst |
| tasker | planner | Creates prioritized implementation plan | solution-mapper |
| researcher | researcher | Researches mentioned tools/technologies | coordinator |
| summarizer | reviewer | Compiles executive summary | analyst, solution-mapper, tasker, researcher |

The swarm uses `raft` consensus and `specialized` strategy with a max of 6 agents.

**File:** `swarm/run-meeting-swarm.sh`

A bash runner that clones/pulls the meeting repo via sparse checkout, watches for new transcript lines, and syncs data to the local MCP directory. Runs on a 30-second poll interval.

### Gap

1. **No web-based monitoring UI** -- During a meeting, there is no way to see which agents are running/dead without switching to a terminal. This was the top feature request.

2. **No agent restart capability** -- If an agent dies mid-meeting, there is no mechanism to detect and restart it from a browser interface.

3. **No 'fixer' agent in the swarm** -- The `solution-mapper` identifies code gaps but cannot make changes. There is no agent that applies fixes after review.

### Fix Locations

- **New files needed:** `dashboard/index.html`, `dashboard/app.js`, `dashboard/styles.css` -- A lightweight HTML page that polls claude-flow for agent status (addressed in IMPLEMENTATION_PLAN.md as MT-1/LF-1).

- **Swarm config update:** Add a `coder` agent to `swarm/meeting-swarm.json` with `dependsOn: ["solution-mapper", "tasker"]` and `awaitApproval: true` to enable self-fixing after human review.

---

## Pain Point 3: Transcript capture produces incremental/duplicate lines

**Severity:** LOW
**Meeting context:** Raw transcript shows word-by-word buildup as speech recognition processes incrementally (visible in 22:50:06 through 22:50:14 entries).

### Existing Code

**File:** `extension/content/meet-scraper.js`

The entire dedup pipeline (lines 22-160) is specifically designed to handle this. The combination of:

- `activeCaptions` Map (line 24) -- tracks per-speaker caption state
- `STABILIZE_MS` = 4000 (line 13) -- 4-second stabilization window
- Prefix dedup via `lastEmittedPerSpeaker` Map (line 26)
- `emittedTexts` Set (line 25) -- exact-match prevention

This was already upgraded from v1 (no dedup) to v2 (basic dedup) to v3 (stabilized dedup + UI filter), as noted in the initialization log: `"[Meet Buddy] v3 initialized -- stabilized dedup + UI filter"` (line 378).

### Gap

The v3 scraper (`STABILIZE_MS = 4_000`) is a significant improvement but the meeting transcript still showed some duplication. Two contributing factors:

1. **The content script BUFFER_INTERVAL_MS (line 11) is 15 seconds** but the service worker flushes are also batched, meaning the same data can be pushed to GitHub multiple times if the `pushQueue` in `service-worker.js` (line 13) has not cleared before a new flush arrives.

2. **The service worker's `getOrCreateFile` function** (service-worker.js, lines 67-74) reads the existing transcript from GitHub before appending. If two pushes happen in quick succession, they both read the same base content and the second push overwrites the first's additions.

### Fix Location

`extension/background/service-worker.js`, line 364 (`processPushQueue`)

The push queue serialization via `isPushing` flag (line 365) should work, but the `setTimeout(processPushQueue, 1000)` retry (line 407) can create a race if GitHub's API latency exceeds 1 second. Increase the retry delay to 3000ms and add an explicit check that the previous push's response has been received.

---

## Action Item: Create feedback form for agent tool improvement

### Existing Code

**File:** `extension/options/options.js`

The options page demonstrates form handling patterns (loading from `chrome.storage.sync`, saving on button click with a "saved" toast message). However, this is for extension settings, not user feedback.

### Gap

No feedback mechanism exists anywhere in the codebase. No GitHub Issue templates are defined.

### Recommendation

Create `.github/ISSUE_TEMPLATE/agent-feedback.yml`:

```yaml
name: Agent Improvement Feedback
description: Suggest improvements for Meet Buddy's AI agents
labels: ["enhancement", "agents"]
body:
  - type: dropdown
    id: agent
    attributes:
      label: Which agent?
      options: [coordinator, analyst, solution-mapper, tasker, researcher, summarizer]
  - type: textarea
    id: problem
    attributes:
      label: What went wrong or could be better?
  - type: textarea
    id: suggestion
    attributes:
      label: What should happen instead?
```

This leverages GitHub Issues as the feedback mechanism, keeping everything in the same repo where meeting data lives.

---

## Action Item: Run agents to analyze and fix the tool (dogfooding)

### Existing Code

| File | What it provides |
|------|-----------------|
| `swarm/meeting-swarm.json` | 6-agent swarm with analyst, solution-mapper, tasker |
| `swarm/run-meeting-swarm.sh` | CLI runner that syncs and watches meeting data |
| `mcp-server/src/index.ts` | 7 MCP tools for reading meetings, transcripts, screenshots, notes |
| `extension/content/meet-scraper.js` | Live caption scraping with dedup |

The full pipeline for dogfooding already works: the extension captures the meeting, the MCP server exposes the data, and the swarm config defines agents that can analyze it.

### Gap

The swarm's `solution-mapper` agent is read-only -- it identifies code gaps but cannot make changes. To complete the dogfooding loop, a `coder` agent is needed that:
1. Receives the tasker's prioritized implementation plan
2. Makes specific code changes
3. Awaits human approval before committing

### Fix Location

`swarm/meeting-swarm.json` -- Add after the `tasker` entry:

```json
{
  "id": "coder",
  "type": "coder",
  "role": "Implement approved changes from the task plan",
  "instructions": "Using the tasker's implementation plan, make specific code changes to the meet-buddy codebase. For each change: 1) Read the target file, 2) Make the minimal change needed, 3) Verify it does not break existing functionality. NEVER commit without human approval.",
  "dependsOn": ["tasker"],
  "awaitApproval": true
}
```

---

## Action Item: Use session as blog post content

### Existing Code

**File:** `docs/BUILD_STORY.md`

A comprehensive 500+ line technical blog post already exists, covering:
- Architecture decisions and trade-offs
- The caption scraping evolution (v1 -> v2 -> v3)
- GitHub sync pipeline details
- MCP server design
- Agent swarm configuration
- Future roadmap

### Gap

The BUILD_STORY.md covers the initial build, not this specific dogfooding session. The meeting analysis at `docs/MEETING_ANALYSIS.md` captures the session but is structured as an internal analysis document, not a blog post.

### Recommendation

Combine the materials into a blog draft:
- `docs/BUILD_STORY.md` (existing technical narrative)
- `docs/MEETING_ANALYSIS.md` (session details, translations, emotional signals)
- `docs/IMPLEMENTATION_PLAN.md` (what was identified and planned)
- `docs/CODE_SOLUTIONS.md` (this document -- code-level mapping)

Output: `docs/BLOG_DOGFOODING.md` -- a narrative blog post about using Meet Buddy to improve itself.

---

## Action Item: Make the app live during this call

### Existing Code

The app is already functional. All core systems work:

| System | Status | Key File |
|--------|--------|----------|
| Caption scraping | Working (v3) | `extension/content/meet-scraper.js` |
| GitHub sync | Working | `extension/background/service-worker.js` |
| Popup UI | Working | `extension/popup/popup.js` |
| MCP Server | Working | `mcp-server/src/index.ts` |
| Agent Swarm | Configured | `swarm/meeting-swarm.json` |
| GitHub Action | Configured | `.github/workflows/meeting-processor.yml` |

### Gap -- Quick Wins to apply

The IMPLEMENTATION_PLAN.md identified 4 quick wins (~85 minutes total):

1. **QW-1: Fix rolling duplication** -- `meet-scraper.js` lines 108-113, add `>= 10` char minimum delta, increase `MAX_BLOCK_AGE_MS` to 45s
2. **QW-2: Fix word count drift** -- `meet-scraper.js` lines 325-328, add `liveWordEstimate` counter using active caption text
3. **QW-3: Add meeting_end MCP tool** -- `mcp-server/src/index.ts`, new tool to write `endTime` to `meta.json`
4. **QW-4: Auto-detect meeting title** -- `popup.js` lines 232-258, read tab title before falling back to `prompt()`

---

## Action Item: Continue scraper/version stabilization

### Existing Code

**File:** `extension/content/meet-scraper.js`

The scraper has evolved through three versions:
- **v1:** Raw caption capture, no dedup
- **v2:** Basic dedup with emittedTexts Set
- **v3 (current):** Stabilized dedup with 4s window + prefix dedup + UI junk filter + max block age

Key timing constants that control behavior:
| Constant | Value | Location |
|----------|-------|----------|
| `BUFFER_INTERVAL_MS` | 15,000 | Line 11 |
| `POLL_INTERVAL_MS` | 500 | Line 12 |
| `STABILIZE_MS` | 4,000 | Line 13 |
| `MAX_BLOCK_AGE_MS` | 30,000 | Line 14 |

The `UI_JUNK` filter array (lines 29-36) catches Google Meet UI strings that leak into caption scraping.

The `findCaptionBlocksByStructure()` fallback (lines 181-195) handles cases where Google Meet's DOM class names change, using positional heuristics instead.

### Gap

- **No automated tests** for the scraper logic. All 3 versions were manually tested.
- **No DOM snapshot fixtures** to verify the scraper against known Meet HTML structures.
- **The options page `pushInterval` setting (options.js, line 10) is saved but never read** by the content script or service worker -- the hardcoded `BUFFER_INTERVAL_MS = 15_000` in `meet-scraper.js` and the GitHub push logic in `service-worker.js` do not reference `chrome.storage.sync`.

### Fix Location

1. Connect the `pushInterval` option to actual behavior:
   - `extension/content/meet-scraper.js` line 11: replace hardcoded `15_000` with value from `chrome.storage.sync.get("pushInterval")`
   - `extension/background/service-worker.js`: read `pushInterval` when starting a session

2. Add a test file at the project level for scraper logic extraction and unit testing.

---

## Codebase Architecture Summary

```
meet-buddy/
|
|-- extension/                      # Chrome Extension (Manifest V3)
|   |-- manifest.json               # Permissions: activeTab, storage, tabs, offscreen
|   |-- content/
|   |   |-- meet-scraper.js         # 391 lines -- caption scraping, dedup, overlay
|   |   |-- meet-overlay.css        # 115 lines -- in-meeting floating UI
|   |-- background/
|   |   |-- service-worker.js       # 557 lines -- GitHub auth, sync, session mgmt
|   |-- popup/
|   |   |-- popup.js                # 341 lines -- ephemeral UI, state from SW
|   |   |-- popup.css               # 418 lines -- dark theme popup styles
|   |-- options/
|       |-- options.js              # 31 lines -- settings form (partially unused)
|
|-- mcp-server/                     # MCP Server (TypeScript)
|   |-- src/index.ts                # 371 lines -- 7 MCP tools for Claude Code
|   |-- package.json                # @modelcontextprotocol/sdk, zod, chokidar
|
|-- swarm/                          # Agent Swarm Config
|   |-- meeting-swarm.json          # 6-agent hierarchical config
|   |-- run-meeting-swarm.sh        # CLI runner with git sparse checkout
|
|-- .github/workflows/
|   |-- meeting-processor.yml       # Auto-summary + GitHub Issue on meeting end
|
|-- docs/
    |-- BUILD_STORY.md              # Technical blog post about the build
    |-- MEETING_ANALYSIS.md         # Analysis of the dogfooding session
    |-- IMPLEMENTATION_PLAN.md      # Prioritized task plan (QW/MT/LF)
    |-- CODE_SOLUTIONS.md           # This document
```

---

## Key Findings

1. **The dedup system is solid but has an edge case** with long continuous speech. The fix is a 1-line change (minimum delta threshold) plus a constant adjustment.

2. **The options page settings are partially disconnected** from runtime behavior. `pushInterval`, `autoStart`, and `localDir` are saved but not read by the extension's core logic.

3. **The swarm can analyze but not fix** -- adding a `coder` agent with `awaitApproval: true` closes the dogfooding loop.

4. **No automated tests exist** for any component. The scraper's DOM-dependent logic is particularly difficult to test without fixtures.

5. **The MCP server has `chokidar` as a dependency** (in package.json) but does not use it. Adding a filesystem watcher would enable near-real-time updates instead of manual polling.

6. **The GitHub Action summary is basic** -- it only outputs the first 50 lines of transcript. The full action-item extraction pipeline described in IMPLEMENTATION_PLAN.md (MT-4) would make it significantly more useful.

---

_Generated by Meet Buddy Code Reviewer Agent_
_Codebase: 9 source files, 7 MCP tools, 6 swarm agents_
_Analysis source: Meeting 2026-03-19 final analysis from claude-flow memory_
