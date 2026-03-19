# Meet Buddy -- Implementation Plan

**Generated:** 2026-03-19
**Source meetings:** `2026-03-19-untitled-meeting`, `2026-03-19-testing-v2`
**Participants:** Axit, Earth Clique
**Status:** Ready for implementation

---

## Executive Summary

Two back-to-back testing sessions surfaced a clear set of improvements for Meet Buddy. The issues fall into three categories: (1) transcript capture quality -- the scraper still produces rolling-append duplication on long continuous speech, (2) architecture gaps -- no web-based agent dashboard, no real-time transport, Claude Code sessions used as automation backbone, and (3) product direction -- open-source the base version while building premium features on a separate branch.

This plan prioritizes by impact and effort, with specific file paths and code changes for each task.

---

## Phase 1: Quick Wins (< 1 hour each)

### QW-1: Fix long-speech rolling duplication in caption scraper

**Problem:** The 4-second `STABILIZE_MS` window works well for short sentences, but when a speaker talks continuously for 30+ seconds, Google Meet keeps appending to the same caption block. The scraper emits partial versions every time the stabilization timer resets, producing paragraphs that repeat with more text appended each time.

**File:** `extension/content/meet-scraper.js`
**Lines:** 93-130 (stabilization + emission logic)

**Fix:**
- Track `lastEmittedLength` per speaker instead of just `lastEmittedPerSpeaker` text
- When the current text is a strict superset of the previously emitted text (starts with it), do NOT re-emit -- only emit the delta (new portion)
- Increase `MAX_BLOCK_AGE_MS` from 30s to 45s to give long speech blocks more time to fully stabilize before force-emit
- Add a minimum delta length threshold (e.g., 10 chars) so tiny trailing fragments are not emitted as separate lines

```js
// Key change in emission logic (line ~105):
if (prevEmitted && textToEmit.startsWith(prevEmitted)) {
  textToEmit = textToEmit.slice(prevEmitted.length).trim();
  // NEW: skip if the delta is too small (partial word)
  if (textToEmit.length < 10) continue;
}
```

**Effort:** 30 minutes
**Priority:** HIGH -- this is the most visible quality issue

---

### QW-2: Fix word count drift / latency in overlay

**Problem:** Overlay shows "31 words" when 500+ were spoken. The `totalWordsCaptured` counter only increments on emission, not on live caption scanning. Batched emission creates significant lag.

**File:** `extension/content/meet-scraper.js`
**Lines:** 325-328 (`updateOverlayStats`)

**Fix:**
- Add a separate `liveWordEstimate` counter that updates on every `scanForCaptions()` poll (every 500ms)
- Sum all current `activeCaptions` text lengths for the live estimate
- Display this estimate in the overlay while keeping the accurate `totalWordsCaptured` for the final count sent to GitHub

```js
function updateOverlayStats() {
  // Live estimate: count words in all active + emitted captions
  let liveWords = totalWordsCaptured;
  for (const [, state] of activeCaptions) {
    if (!state.emitted && state.text) {
      liveWords += state.text.split(/\s+/).filter(Boolean).length;
    }
  }
  const wordEl = document.getElementById("mb-word-count");
  if (wordEl) wordEl.textContent = `${liveWords} words`;
}
```

**Effort:** 20 minutes
**Priority:** HIGH -- directly visible to users during meetings

---

### QW-3: End active meeting session (no endTime in meta.json)

**Problem:** The meeting `2026-03-19-untitled-meeting` has no `endTime` in its `meta.json`. The transcript contains `[NOTE]: the meeting is ended` but the meta was never updated via the service worker's `endSession()`.

**File:** `mcp-server/src/index.ts`
**Lines:** 100-121 (`meeting_active` tool)

**Fix:**
- Add a new MCP tool `meeting_end` that writes `endTime` to `meta.json` for a given meeting
- This allows agents or manual Claude Code commands to properly close meetings that the extension failed to end

```ts
server.tool(
  "meeting_end",
  "Mark a meeting as ended by setting endTime in meta.json",
  {
    meeting_id: z.string().optional().describe("Meeting to end. Omit for most recent active."),
  },
  async ({ meeting_id }) => {
    // Find active meeting, update meta.json with endTime + stats
  }
);
```

**Effort:** 20 minutes
**Priority:** MEDIUM

---

### QW-4: Add meeting title to session start prompt

**Problem:** The current meeting was saved as "untitled-meeting" because no title was provided. The `prompt("Meeting name:")` in the popup is easy to dismiss.

**File:** `extension/popup/popup.js`
**Lines:** 232-258 (btn-start click handler)

**Fix:**
- Auto-detect the meeting title from the Google Meet tab title before falling back to prompt
- Use `chrome.tabs.query` to get the Meet tab's title, strip " - Google Meet" suffix
- Only show the prompt if auto-detection fails

```js
// Get title from active tab first
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let meetingTitle = "";
if (tab?.title) {
  meetingTitle = tab.title.replace(/ - Google Meet$/, "").trim();
}
if (!meetingTitle || meetingTitle === "Google Meet") {
  meetingTitle = prompt("Meeting name:") || "untitled-meeting";
}
```

**Effort:** 15 minutes
**Priority:** LOW

---

## Phase 2: Medium Tasks (1-4 hours each)

### MT-1: Build web-based agent monitoring dashboard

**Problem:** During a meeting, there is no way to see which agents are running, dead, or producing results. Switching to the terminal is impractical mid-call. Axit explicitly stated: "we need a web-based UI so we can monitor all these agents and we can also click a button."

**Approach:** Create a lightweight standalone HTML page (no build step, no framework) that polls the claude-flow MCP server for agent status and displays it.

**Files to create:**
- `extension/dashboard/dashboard.html`
- `extension/dashboard/dashboard.js`
- `extension/dashboard/dashboard.css`

**Or alternatively:** A standalone page at `meet-buddy/dashboard/index.html` that runs independently of the extension.

**Features:**
1. Agent status cards (name, type, status: running/idle/dead, last activity)
2. Restart button per agent (sends `agent_spawn` or `agent_terminate` + respawn)
3. Custom command input that feeds into claude-flow
4. Live transcript preview (last 10 lines)
5. Meeting stats (words, screenshots, duration)

**Technical approach:**
- Poll claude-flow REST endpoints or use `npx @claude-flow/cli@latest agent list` via a local proxy
- Since the MCP server uses stdio (not HTTP), the dashboard needs a lightweight HTTP bridge
- Option A: Add an Express endpoint to the MCP server that exposes agent status
- Option B: Create a separate tiny HTTP server that shells out to claude-flow CLI

**Effort:** 3-4 hours
**Priority:** HIGH -- the top feature request from both meetings

---

### MT-2: Reduce transcript sync latency (2-min to near-real-time)

**Problem:** The 2-minute sync cycle built into Claude Code's session scheduler creates unacceptable delay for real-time analysis. The extension pushes to GitHub every 15-30s, but the MCP server only reads from disk.

**File:** `mcp-server/src/index.ts`

**Fix -- Option A (filesystem watcher):**
- Use `chokidar` (already mentioned in BUILD_STORY.md as a future plan) to watch `MEETINGS_DIR` for changes
- When `transcript.md` changes, immediately emit an MCP notification/resource update
- This eliminates the need for the 2-minute poll -- the MCP server pushes updates as they arrive

```ts
import chokidar from "chokidar";

const watcher = chokidar.watch(MEETINGS_DIR, {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  depth: 2,
});

watcher.on("change", (filePath) => {
  if (filePath.endsWith("transcript.md")) {
    // Notify connected clients of new transcript data
    server.notification({ method: "notifications/resources/updated" });
  }
});
```

**Fix -- Option B (direct local push from extension):**
- The extension currently only pushes to GitHub. Add an option to also write to the local `MEETINGS_DIR` directly via a local HTTP endpoint
- This would bypass the GitHub round-trip entirely for local analysis

**Effort:** 2-3 hours
**Priority:** HIGH

---

### MT-3: Fix extension first-launch reliability

**Problem:** In the testing-v2 session, the extension needed a manual reload before transcript capture worked correctly. The content script should be robust on first injection.

**File:** `extension/content/meet-scraper.js`
**Lines:** 376-391 (`init()` function)

**Root causes to investigate:**
1. Content script may inject before Google Meet's caption DOM is ready
2. The `document.readyState === "complete"` check may fire before Meet's SPA has rendered
3. `activeSession` in chrome.storage may be stale from a previous session

**Fix:**
- Add a retry mechanism to `init()` -- if no caption container is found, retry every 2 seconds for up to 30 seconds
- Add a `MutationObserver` on the document body to detect when caption elements first appear
- Clear stale `activeSession` from storage if the session's `startTime` is more than 24 hours old

```js
function init() {
  if (!window.location.pathname.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) return;

  // Wait for Meet's SPA to fully render
  const waitForMeet = () => {
    const hasCaptions = document.querySelector("div.nMcdL, div.bj4p3b");
    const hasUI = document.querySelector('[data-meeting-title]') ||
                  document.title.includes("Meet");
    if (hasUI) {
      proceedWithInit();
    } else {
      setTimeout(waitForMeet, 2000);
    }
  };
  waitForMeet();
}
```

**Effort:** 1-2 hours
**Priority:** MEDIUM

---

### MT-4: Implement auto-action-item extraction in GitHub Action

**Problem:** The GitHub Action (`meeting-processor.yml`) creates a basic summary with just the first 50 lines of transcript. It should parse the full transcript for action items.

**File:** `.github/workflows/meeting-processor.yml`
**Lines:** 52-83 (Generate meeting summary step)

**Fix:**
- Add a step that scans the transcript for action-item patterns:
  - "we should..." / "we need to..."
  - "let's..." / "I'll..." / "can you..."
  - "fix..." / "build..." / "implement..."
  - Lines containing "TODO" or "[ACTION]"
- Create individual GitHub Issues for each detected action item
- Label them with `action-item` + `meet-buddy`

**Effort:** 2-3 hours
**Priority:** MEDIUM

---

### MT-5: Add local-first sync mode to Chrome extension

**Problem:** The extension only pushes to GitHub. For the MCP server to have data, it needs to pull from GitHub (via `meeting_sync`). This creates a round-trip delay and requires internet connectivity.

**Files:**
- `extension/background/service-worker.js` (add local push logic)
- `extension/options/options.js` + `options.html` (local directory config already exists but is unused)

**Fix:**
- The options page already has a "Local meetings directory" input field, but it is never read or used
- Implement a `pushLocal()` function in the service worker that writes transcript chunks and screenshots to the configured local directory
- Use the `File System Access API` or a companion native messaging host to write files locally
- Note: Chrome extensions cannot directly write to the filesystem -- this requires either:
  - A native messaging host (small Node.js script that receives messages from the extension and writes to disk)
  - Or converting to use `chrome.downloads` API to save files

**Effort:** 3-4 hours (native messaging host approach)
**Priority:** MEDIUM

---

## Phase 3: Large Features (> 4 hours each)

### LF-1: Web-based agent dashboard (full version)

**Problem:** This extends MT-1 from a basic status page to a full real-time dashboard.

**Architecture:**
```
Chrome Extension (Meet tab)
     |
     v
Agent Dashboard (new tab, served locally)
     |
     +-- WebSocket connection to dashboard server
     |
     v
Dashboard Server (Node.js, port 3847)
     |
     +-- Spawns/monitors claude-flow agents
     +-- Reads transcript from local MEETINGS_DIR
     +-- Exposes REST + WebSocket APIs
     |
     v
Claude Flow CLI (subprocess)
```

**Files to create:**
- `dashboard/server.ts` -- Express + WebSocket server
- `dashboard/public/index.html` -- SPA dashboard
- `dashboard/public/app.js` -- Frontend logic
- `dashboard/public/styles.css` -- Dashboard styling
- `dashboard/package.json`

**Features:**
1. Real-time agent status with auto-refresh (WebSocket)
2. Agent spawn/terminate/restart controls
3. Custom command input that executes via claude-flow CLI
4. Live transcript feed (streaming as it arrives)
5. Meeting timeline with screenshots inline
6. Pain point / action item summary (from analyst agent output)
7. One-click "start analysis swarm" button

**Effort:** 8-12 hours
**Priority:** HIGH (phased -- start with MT-1 basic version)

---

### LF-2: Replace 2-minute git-poll with real-time transport

**Problem:** The fundamental architecture mismatch: Claude Code sessions are designed for human interaction, not for automated polling. Using session schedulers as an automation backbone is "jugaad" (Axit's word).

**Proposed architecture change:**
- Replace the GitHub -> MCP Server -> Claude Code poll loop with:
  - Extension pushes to both GitHub AND a local WebSocket server
  - WebSocket server forwards transcript chunks to connected clients (dashboard, MCP server)
  - MCP server receives real-time updates instead of polling files

**This overlaps with LF-1 (dashboard server) -- they should share the same WebSocket infrastructure.**

**Effort:** 6-8 hours
**Priority:** HIGH (but depends on LF-1 dashboard server)

---

### LF-3: Open-source base + premium fork strategy

**Problem:** Axit discussed publishing an open-source version while building a monetizable premium version with more features.

**Approach:**
- Current `main` branch becomes the open-source base
- Create a `premium` branch with additional features:
  - Multi-platform support (Zoom, Teams)
  - Advanced analytics dashboard
  - Team collaboration features
  - Custom agent templates
  - Priority support / SLA
- Consider a licensing model: MIT for base, commercial license for premium
- Set up a proper release workflow with versioned tags

**Files to update:**
- `README.md` -- add "Meet Buddy Pro" section
- `LICENSE` -- keep MIT for base
- `.github/workflows/` -- add release workflow

**Effort:** 4-6 hours (initial branch setup + feature flagging)
**Priority:** LOW (product strategy, not engineering urgency)

---

### LF-4: Zoom and Teams support

**Problem:** The scraper is Meet-specific. The MCP server and swarm config are platform-agnostic.

**Approach:**
- Create platform-specific content scripts:
  - `extension/content/zoom-scraper.js` -- Zoom Web Client caption scraping
  - `extension/content/teams-scraper.js` -- Microsoft Teams caption scraping
- Update `manifest.json` to include new host permissions and content script matches
- The service worker, popup, and MCP server remain unchanged -- they are platform-agnostic

**Effort:** 8-12 hours (per platform, due to DOM reverse-engineering)
**Priority:** LOW

---

### LF-5: Browser-native screenshot annotation

**Problem:** Screenshot annotations use `prompt()` -- ugly and limited. Need a canvas-based annotation overlay.

**Files to create:**
- `extension/content/annotation-overlay.js`
- `extension/content/annotation-overlay.css`

**Features:**
- Canvas overlay on top of Meet when screenshot is triggered
- Drawing tools: arrow, rectangle, freehand, text
- Color picker (limited palette)
- "Capture" button that composites the annotation onto the screenshot
- "Cancel" to dismiss without capturing

**Effort:** 6-8 hours
**Priority:** LOW

---

## Recommended Execution Order

```
Week 1 (immediate):
  [x] QW-1: Fix rolling duplication         (30 min)
  [x] QW-2: Fix word count latency          (20 min)
  [x] QW-3: Add meeting_end MCP tool        (20 min)
  [x] QW-4: Auto-detect meeting title       (15 min)
  [x] MT-1: Basic agent dashboard (HTML)    (3-4 hrs)

Week 2:
  [ ] MT-2: Filesystem watcher for MCP      (2-3 hrs)
  [ ] MT-3: Fix first-launch reliability    (1-2 hrs)
  [ ] MT-4: Auto-action-items in GH Action  (2-3 hrs)

Week 3:
  [ ] MT-5: Local-first sync mode           (3-4 hrs)
  [ ] LF-1: Full dashboard (server + WS)    (8-12 hrs, can span 2 weeks)

Later:
  [ ] LF-2: Real-time transport             (6-8 hrs)
  [ ] LF-3: Open-source + premium strategy  (4-6 hrs)
  [ ] LF-4: Zoom/Teams support              (8-12 hrs/platform)
  [ ] LF-5: Screenshot annotation canvas    (6-8 hrs)
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Google Meet DOM class names change | Scraper breaks entirely | `findCaptionBlocksByStructure()` fallback exists; add automated regression test |
| WebSocket dashboard adds complexity | Maintenance burden | Keep it optional; MCP server works independently |
| Local file writes from extension blocked by Chrome | MT-5 impossible without native host | Fall back to `chrome.downloads` API or native messaging |
| Claude Code session limitations | Automation ceiling | Dashboard server (LF-1) provides an independent automation layer |
| Premium fork diverges from base | Merge conflicts, dual maintenance | Use feature flags instead of separate branches where possible |

---

## Success Criteria

1. No more rolling text duplication in transcripts (QW-1 verified)
2. Word count in overlay updates within 1 second of speech (QW-2 verified)
3. Agent status visible in browser during a live meeting (MT-1 delivered)
4. Transcript available to MCP server within 5 seconds of being spoken (MT-2 delivered)
5. Extension works reliably on first load without manual reload (MT-3 verified)

---

_Generated by Meet Buddy Planner Agent_
_Based on meetings: 2026-03-19-untitled-meeting, 2026-03-19-testing-v2_
_Codebase analysis: 9 source files, 7 MCP tools, 6-agent swarm config_
