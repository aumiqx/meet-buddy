# How We Built Meet Buddy: A Real-Time Meeting Co-Pilot That Eats Its Own Tail

**By [aumiqx](https://aumiqx.com)** | MIT Licensed | [GitHub](https://github.com/aumiqx/meet-buddy)

---

Every developer has been in that meeting. The one where the client rattles off requirements faster than you can type, shares their screen for 3 seconds to show "the thing that's broken", and casually drops a competitor name you've never heard of — all while you're nodding and pretending your brain is a tape recorder.

We got tired of pretending.

Meet Buddy is a real-time meeting intelligence tool. It scrapes live captions from Google Meet, captures screenshots, pushes everything to a GitHub repo, and feeds the data into Claude Code through an MCP server — where an agent swarm analyzes the entire conversation before you've even hung up.

No cloud services. No subscriptions. No audio recording. Just text, screenshots, and a GitHub repo you own.

We built the entire thing in a single session. Then we used it to test itself. Then it started fixing itself. Here's how that happened.

---

## The Idea That Started on a Client Call

The starting point was simple: **every client call generates work, but the bridge between "what was said" and "what gets built" is lossy.**

You finish a 45-minute call, open your editor, and realize you forgot half the details. You check your notes — three bullet points and a doodle. The client mentioned a competitor tool? Gone. That edge case they described? Vague memory. The screenshot they shared for 2 seconds? Definitely gone.

We wanted a tool that:

1. **Captures everything** — captions, screenshots, timestamps — without recording audio (privacy matters)
2. **Syncs to a place developers already live** — GitHub, not some random SaaS dashboard
3. **Feeds directly into AI agents** — so Claude Code can analyze the transcript, search your codebase for solutions, and generate a task list while the meeting is still warm
4. **Runs entirely on your infrastructure** — no servers, no third-party APIs beyond GitHub

The architecture fell out of those constraints naturally.

---

## Architecture: One-Way Data Flow

```
┌─────────────────────────────────────────────────────┐
│  GOOGLE MEET (live call with captions enabled)      │
│                                                     │
│  Content script polls DOM every 500ms               │
│  4s stabilization window before emitting            │
│  UI junk filter removes toolbar text                │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  CHROME EXTENSION (Manifest V3)                     │
│                                                     │
│  content/meet-scraper.js → Caption dedup + filter   │
│  background/service-worker.js → GitHub push queue   │
│  popup/ → Recording UI, repo selector, live stats   │
│  options/ → Push interval, JPEG quality, OAuth      │
└──────────────┬──────────────────────────────────────┘
               │ GitHub Contents API (PUT)
               │ Transcript appended every 15s
               │ Screenshots as JPEG (65% quality)
               ▼
┌─────────────────────────────────────────────────────┐
│  GITHUB REPO (your project repo)                    │
│                                                     │
│  meetings/2026-03-19-client-call/                   │
│    ├── meta.json           (title, times, stats)    │
│    ├── transcript.md       (timestamped captions)   │
│    └── screenshots/        (annotated JPEGs)        │
│        ├── 001-architecture.jpg                     │
│        └── 002-error-screen.jpg                     │
└──────────────┬──────────────────────────────────────┘
               │ git sparse-checkout
               ▼
┌─────────────────────────────────────────────────────┐
│  MCP SERVER (TypeScript, stdio transport)           │
│                                                     │
│  7 tools: meeting_list, meeting_active,             │
│  meeting_transcript, meeting_screenshots,           │
│  meeting_meta, meeting_notes, meeting_sync          │
└──────────────┬──────────────────────────────────────┘
               │ Model Context Protocol
               ▼
┌─────────────────────────────────────────────────────┐
│  CLAUDE CODE + AGENT SWARM                          │
│                                                     │
│  5 agents via claude-flow:                          │
│  Watcher → Analyst → Code Reviewer                  │
│                    → Brainstormer → Planner          │
│                                                     │
│  Shared state via claude-flow memory (HNSW + SQL)   │
└─────────────────────────────────────────────────────┘
```

The data flows one direction: Meet call → Chrome Extension → GitHub → MCP Server → Claude Code → Agent Swarm. No bidirectional complexity. No websockets. No real-time sync nightmares.

GitHub is the single source of truth. The extension pushes to it, the MCP server reads from it. If something breaks, the data is still sitting in a repo as plain markdown and JPEG files. You can `cat` your meeting transcript. Try doing that with Otter.ai.

---

## What Was Built (In One Sitting)

### The Chrome Extension

Four moving parts: a content script that lives inside Google Meet, a service worker for GitHub auth and data pushing, a popup UI for controlling sessions, and an options page for settings.

**The Caption Scraper**

This is where the hard problem lives. Google Meet doesn't have a "captions API." The captions are rendered in the DOM as obfuscated `div` elements with class names like `nMcdL`, `bj4p3b`, `ygicle`, and `VbkSUe` — names generated by Closure Compiler that Google can change with any deploy.

We found the exact DOM structure by inspecting a live Meet call:

```html
<div class="nMcdL bj4p3b">
  <div class="adE6rb">
    <img class="Z6byG r6DyN" src="avatar.jpg" />
    <div class="KcIKyf jxFHg">
      <span class="NWpY1d">Earth Clique</span>
    </div>
  </div>
  <div class="ygicle VbkSUe">
    "Apni poochh, khud hi khaega kyon?"
  </div>
</div>
```

Speaker name in `span.NWpY1d`. Caption text in `div.ygicle`. Avatar in `img.Z6byG`. The scraper uses these as primary selectors, with a structural fallback that looks for any `div` in the bottom 40% of the viewport containing an `img` + `span` + text:

```javascript
let captionBlocks = document.querySelectorAll("div.nMcdL");
if (captionBlocks.length === 0) captionBlocks = document.querySelectorAll("div.bj4p3b");
if (captionBlocks.length === 0) captionBlocks = findCaptionBlocksByStructure();
```

The structural fallback is brute force — it walks every `div` on the page. But it works when Google renames their CSS classes, which they do roughly every few weeks.

**Caption Deduplication: The Hardest Problem**

Google Meet captions are live — they update in place as the speaker talks. "I think" becomes "I think we should" becomes "I think we should focus on the API." If you capture every 500ms poll, you get massive duplication.

Our v1 captured every change. The transcript looked like this:

```
[22:41:33] You: the count is in
[22:41:34] You: increasing now
[22:41:35] You: increasing now I can see the
[22:41:37] You: increasing now I can see the word
[22:41:38] You: increasing now I can see the word count
[22:41:39] You: increasing now I can see the word count is working now
```

Seven entries for one sentence. Unusable.

The fix is a **stabilization window**. Each caption is tracked per speaker in an `activeCaptions` Map. Only when the text hasn't changed for 4 full seconds do we consider it "final" and emit:

```javascript
const STABILIZE_MS = 4_000;

for (const [speaker, state] of activeCaptions) {
  const isStabilized = now - state.lastChanged >= STABILIZE_MS;
  const isAgedOut = state.firstSeen && (now - state.firstSeen >= MAX_BLOCK_AGE_MS);

  if (!state.emitted && state.text && (isStabilized || isAgedOut)) {
    // Only emit the NEW portion (prefix dedup)
    const prevEmitted = lastEmittedPerSpeaker.get(speaker) || "";
    let textToEmit = state.text;
    if (prevEmitted && textToEmit.startsWith(prevEmitted)) {
      textToEmit = textToEmit.slice(prevEmitted.length).trim();
    }
    // ...emit textToEmit
  }
}
```

There's also a 30-second `MAX_BLOCK_AGE_MS` that force-emits if someone's been talking continuously. Without it, a long monologue would never stabilize and you'd lose the entire speech.

After v3 of the scraper, the transcript looks like this:

```
[22:56:26] You: Okay, so testing version two, let's see if that's working.
[22:59:28] Earth Clique: Akshit
[22:59:35] Earth Clique: Akshit ko ek error aata hai yah wala request too large max 20 MB
[22:59:39] You: PHP mein
```

Clean. One line per thought. No duplicates.

And because Google Meet's DOM is a minefield of UI elements rendered as text, there's a junk filter that catches toolbar labels (`"frame_person"`, `"more_vert"`, `"backgrounds and effects"`) and a heuristic for camelCase identifiers.

**The Service Worker: Persistent Brain**

Manifest V3's biggest gotcha: the popup is destroyed the instant you click outside it. Any state held in popup.js variables is gone. This is why the service worker owns everything — OAuth state, session management, push queue.

The OAuth Device Flow was particularly tricky. When the user clicks "Authenticate," the popup shows a device code and opens GitHub in a new tab. The user switches to that tab → popup dies. They enter the code → come back to the extension → popup has no idea what happened.

The fix: the service worker runs the entire polling loop. The popup just asks "what's the auth status?" every time it opens:

```javascript
// popup.js — ephemeral, holds nothing
async function init() {
  const response = await chrome.runtime.sendMessage({ type: "AUTH_STATUS" });
  if (response?.authState?.isAuthenticated) showMain();
  else if (response?.authState?.status === "polling") showDeviceCode(/*...*/);
  // ...
}
```

We originally tried a GitHub App for auth, but discovered that GitHub Apps need to be installed on each org separately. A client with repos in 5 orgs would need 5 installations. We switched to an OAuth App with Device Flow — one auth, all repos.

**Push Queue: Don't Spam GitHub**

The extension doesn't push every 500ms poll. That would burn through GitHub's rate limits in minutes. Instead, transcript chunks accumulate in a buffer and flush every 15 seconds. Each push does a read-modify-write: fetch the existing `transcript.md`, append new lines, push back with the updated SHA.

Screenshots are captured via `chrome.tabs.captureVisibleTab()`, compressed to JPEG at 65% quality (~60-80KB instead of 300-500KB PNG), and pushed individually.

### The MCP Server

Seven tools. TypeScript. stdio transport. Reads from `~/.meet-buddy/meetings/` on disk.

The most interesting tool is `meeting_sync` — it sparse-clones just the `meetings/` folder from any GitHub repo so it doesn't download your entire codebase:

```typescript
execSync(
  `git clone --depth 1 --filter=blob:none --sparse https://github.com/${repo}.git "${tempDir}"`,
  { stdio: "pipe" }
);
execSync("git sparse-checkout set meetings", { cwd: tempDir, stdio: "pipe" });
```

The `meeting_screenshots` tool returns actual image data as base64, so Claude Code can view screenshots directly in the conversation. During our test, Claude described a screenshot showing "Earth Clique's avatar, captions at the bottom, Meet Buddy overlay showing Recording + 62 words" — it was reading the JPEG we'd just captured.

### The Agent Swarm

Five agents coordinated via claude-flow's shared memory system (HNSW-indexed SQL.js backend):

| Agent | Role | Checks every |
|-------|------|-------------|
| **Watcher** | Syncs repo, stores transcript in shared memory | 30s |
| **Analyst** | Extracts pain points, action items, emotions | 60s |
| **Code Reviewer** | Maps problems to codebase solutions | 90s |
| **Brainstormer** | Generates feature ideas | 2m |
| **Planner** | Creates prioritized implementation plan | 2m |

All agents read from and write to the same claude-flow memory namespace (`meetings`). The Watcher stores the transcript. The Analyst reads it and stores its analysis. The Code Reviewer reads the analysis and searches the codebase. The Planner reads everything and creates the implementation plan.

When the Watcher detects `endTime` in `meta.json`, it sets `meeting-ended: true` in shared memory. Every other agent checks for this flag and writes their final report when they see it.

---

## The Live Test: When the Tool Ate Its Own Tail

This is where it gets meta.

We built Meet Buddy in a single Claude Code session. Then, still in the same session, we jumped on a Google Meet call with a friend (Earth Clique) to test it. The tool we'd just built was now recording our conversation about the tool we'd just built.

**First attempt:** The extension loaded but showed 0 words. The caption scraper wasn't finding Google Meet's caption container. We inspected the DOM live on the call, found the exact selectors (`div.nMcdL`, `span.NWpY1d`, `div.ygicle`), updated the scraper, reloaded the extension — and suddenly captions started flowing.

**The word-by-word fiasco:** Our v1 scraper captured every intermediate caption state. One sentence generated 15+ transcript lines. Earth Clique said "Hello" and we got "H", "He", "Hel", "Hell", "Hello", "Hello." — six entries. We rewrote the dedup logic three times during the call.

**The GitHub App detour:** We started with a GitHub App for auth. It worked — until we realized it only showed repos where the app was installed. Our aumiqx repos? Missing. Yoginii repos? Missing. We switched to an OAuth App mid-call and all repos appeared.

**704 words captured:** After reloading the scraper v3, the word count started climbing. 90 words. 210 words. 500 words. 704 words and 1 screenshot by the 5-minute mark. The data was flowing to GitHub, the MCP server could read it, Claude Code could analyze it.

And then Earth Clique dropped the line that became our tagline:

> **"Apni poochh, khud hi khaega kyon?"**

Translation: "Will it eat its own tail?" — referring to the fact that we were using Meet Buddy to test Meet Buddy, which was recording our conversation about testing Meet Buddy, which Claude Code was analyzing to generate fixes for Meet Buddy.

Yes. Yes it will.

**What Claude saw during the call:**

We asked Claude Code to read the transcript mid-call. It reported:

> "Earth Clique is talking about a PHP error — request too large, max 20 MB. The scraper is picking up both speakers clearly now."

It was right. Earth Clique had mentioned a PHP upload limit issue on another project. Claude caught it from the live transcript while we were still on the call.

**The feedback loop:** During the meeting, we read Claude's analysis back to Earth Clique on the call. Google Meet transcribed us reading Claude's analysis. That transcription got pushed to GitHub. Claude then analyzed its own analysis being discussed. The recursion was real.

Claude's own summary of this moment: *"You're reading my analysis out loud on the call and it's getting transcribed back!"*

---

## The Honest Architecture Problems

After the live test, we had a brutally honest conversation (with Claude, in the same session) about what didn't work:

**"Claude sessions are for humans, not for automations, but we are doing it just for the jugaad purposes."**

("Jugaad" is a Hindi word meaning a clever hack or workaround.)

The core issue: Claude Code sessions are designed for interactive human use. We were trying to make them run autonomous agents that watch files, poll APIs, and coordinate in the background. It works — barely — but it's fundamentally the wrong architecture for real-time automation.

The cron job synced every 2 minutes. The agents ran as background tasks that completed and stopped instead of looping for 30 minutes. The word count in the popup had seconds of latency while Google Meet's own captions updated in milliseconds.

**What we actually need (and will build):**

1. **WebSocket/SSE transport** instead of git polling — for sub-second transcript delivery
2. **A web dashboard** to monitor agents — because you can't switch to a terminal during a meeting to check if an agent is alive
3. **Event-driven agent spawning** — trigger analysis when new data arrives, not on a timer
4. **Proper agent orchestration** — agents that can run for 30+ minutes, communicate in real-time, and restart themselves if they crash

But here's the thing: the "jugaad" version works. It captured 1,415 words across two sessions, took 2 screenshots, generated a 466-line implementation plan, a 161-line meeting analysis, and a 530-line blog post (this one). All from a tool that didn't exist 3 hours earlier.

Sometimes the hack is the product. You ship the hack, then you build the infrastructure.

---

## The Numbers from Our Test

| Metric | Session 1 (testing-v2) | Session 2 (untitled) |
|--------|----------------------|---------------------|
| Duration | 24 minutes | 8 minutes |
| Words captured | 1,415 | 906 |
| Screenshots | 2 | 0 |
| Speakers | 2 (You, Earth Clique) | 2 |
| Transcript lines | 36 | 35 |
| GitHub pushes | ~15 | ~8 |

Agent outputs:
- Meeting Analysis: 161 lines — pain points, action items, notable quotes
- Implementation Plan: 466 lines — 14 tasks across 3 priority tiers
- Code Solutions: Full codebase mapping of every pain point to specific files and line numbers
- Blog Post: You're reading it

---

## Setup Guide

### Prerequisites

- Chrome 120+ (Manifest V3 support)
- Node.js 20+
- A GitHub account
- Claude Code with MCP support (for the AI analysis part)

### Step 1: Clone and Load the Extension

```bash
git clone https://github.com/aumiqx/meet-buddy.git
cd meet-buddy/extension/icons && bash generate-icons.sh
```

Open Chrome → `chrome://extensions` → Developer mode → Load unpacked → select `extension/`.

### Step 2: Create a GitHub OAuth App

Go to [github.com/settings/developers](https://github.com/settings/developers) → OAuth Apps → New:

- **Name:** Meet Buddy
- **Homepage:** `https://aumiqx.com`
- **Callback URL:** `https://github.com` (not used, but required)
- **Enable Device Flow:** Check this

Copy the **Client ID**.

### Step 3: Authenticate

Click Meet Buddy extension icon → paste Client ID → Authenticate → enter the device code on GitHub.

### Step 4: Build the MCP Server

```bash
cd meet-buddy/mcp-server
npm install && npm run build
```

### Step 5: Connect to Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "meet-buddy": {
      "command": "node",
      "args": ["/path/to/meet-buddy/mcp-server/dist/index.js"]
    }
  }
}
```

### Step 6: Use It

1. Join Google Meet → enable captions (CC button or press `c`)
2. Click Meet Buddy → select repo → Start Session
3. Talk. Screenshot when needed.
4. End session. Ask Claude: *"Sync and analyze the latest meeting."*

---

## What's Next

**v2 — The Proper Architecture:**
- WebSocket transport replacing git polling
- Web dashboard for agent monitoring (Next.js, embedded in the extension)
- chokidar filesystem watcher for near-real-time MCP updates
- Auto-start recording when joining a Google Meet call
- Flush buffer immediately on session end (no lost data)

**v3 — The Platform:**
- Zoom and Teams support (different DOM, same MCP pipeline)
- Speaker diarization and time tracking
- Auto-action-item extraction → individual GitHub Issues
- Canvas-based screenshot annotation (draw arrows, highlight)
- Offline-first mode with background sync
- Open source core + premium features (dashboard, team analytics, integrations)

**The Dogfooding Loop:**
Meet Buddy will continue to be tested using Meet Buddy. Every improvement call gets captured by the tool, analyzed by agents, and turned into implementation tasks. The tool fixes itself through its own pipeline.

As Earth Clique put it: *"Apni poochh, khud hi khaega kyon?"*

Will it eat its own tail? That's the plan.

---

## The Philosophy

Meet Buddy exists because we believe the gap between "conversation" and "code" is one of the most expensive leaks in software development. Every meeting generates insight. Most of that insight evaporates within hours.

We're not trying to replace note-taking. We're trying to make the meeting itself a first-class input to your development workflow — as structured and queryable as a GitHub Issue, but captured automatically.

No audio recording. No cloud transcription. No vendor lock-in. Just a Chrome extension, a Git repo, and an MCP server. Your data, your infrastructure, your agents.

We built it in one session. We tested it on the same call. It recorded the conversation about itself being built. Then it analyzed that conversation and generated a plan to improve itself.

If that's not AI eating its own tail, we don't know what is.

---

**[aumiqx](https://aumiqx.com)** — we don't build software. we grow intelligence.

*Meet Buddy is MIT licensed. Star it, fork it, break it, fix it. [github.com/aumiqx/meet-buddy](https://github.com/aumiqx/meet-buddy)*
