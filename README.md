# Meet Buddy

Real-time meeting intelligence that syncs with your dev workflow.

**Chrome Extension + MCP Server + Agent Swarm** — capture meeting transcripts and screenshots from Google Meet, sync to GitHub, and let AI agents analyze everything before you're even off the call.

## How it works

```
Google Meet (live call)
  │
  ├─ Chrome Extension scrapes live captions
  ├─ Screenshots captured with one click
  │
  ▼
GitHub Repo (meetings/ folder)
  │
  ├─ transcript.md (appended every 30s)
  ├─ screenshots/ (compressed JPEG)
  ├─ meta.json (title, time, stats)
  │
  ▼
MCP Server → Claude Code
  │
  ├─ meeting_transcript — read the full transcript
  ├─ meeting_screenshots — view captured screenshots
  ├─ meeting_list — list all meetings
  ├─ meeting_sync — pull from GitHub
  │
  ▼
Agent Swarm (optional)
  │
  ├─ Analyst — extracts pain points
  ├─ Solution Mapper — searches your codebase
  ├─ Tasker — creates implementation plan
  ├─ Researcher — researches mentioned tools
  └─ Summarizer — executive summary
```

## Quick Start

### 1. Install the Chrome Extension

```bash
# Clone this repo
git clone https://github.com/aumiqx/meet-buddy.git

# Open Chrome → chrome://extensions
# Enable "Developer mode"
# Click "Load unpacked" → select the extension/ folder
```

### 2. Create a GitHub App

1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new)
2. Set the following:
   - **Name:** Meet Buddy
   - **Homepage URL:** `https://github.com/aumiqx/meet-buddy`
   - **Device flow:** Enable ✓
   - **Repository permissions:** Contents → Read and write
3. Copy the **Client ID**
4. Open the extension → Settings → paste the Client ID
5. Click "Authenticate with GitHub" and follow the device flow

### 3. Install the MCP Server

```bash
cd mcp-server
npm install
npm run build
```

Add to your Claude Code MCP config (`.mcp.json` or settings):

```json
{
  "mcpServers": {
    "meet-buddy": {
      "command": "node",
      "args": ["/path/to/meet-buddy/mcp-server/dist/index.js"],
      "env": {
        "MEET_BUDDY_DIR": "~/.meet-buddy/meetings"
      }
    }
  }
}
```

### 4. Use It

1. Join a Google Meet call
2. Click the Meet Buddy extension icon
3. Select your project repo
4. Click "Start Meeting Session"
5. Enable captions in Google Meet (CC button)
6. The extension captures everything automatically
7. After the call, in Claude Code:

```
"Read the latest meeting and analyze it"
```

Claude Code uses the MCP tools to read the transcript, screenshots, and metadata — then gives you a full analysis.

## Extension Features

- **Live caption scraping** from Google Meet's DOM
- **One-click screenshots** with optional annotations
- **Manual notes** during the meeting
- **Auto-sync** to GitHub every 30 seconds
- **Repo selector** — choose which project repo to sync to
- **Session timer** with word/screenshot counts
- **Dark UI** that matches aumiqx's aesthetic

## MCP Tools

| Tool | Description |
|------|-------------|
| `meeting_list` | List all recorded meetings |
| `meeting_active` | Check if a meeting is currently in progress |
| `meeting_transcript` | Get full transcript or last N lines |
| `meeting_screenshots` | List or view specific screenshots |
| `meeting_meta` | Get meeting metadata and stats |
| `meeting_notes` | Read/write agent analysis notes |
| `meeting_sync` | Pull latest data from GitHub repo |

## Agent Swarm

The `swarm/meeting-swarm.json` config defines a 6-agent analysis swarm:

```bash
# After a meeting, run the swarm
npx @claude-flow/cli@latest swarm init --config swarm/meeting-swarm.json
```

Or just tell Claude Code: "Analyze the latest meeting using the meeting swarm"

## GitHub Actions

When a meeting ends, the GitHub Action automatically:
1. Generates a meeting summary
2. Creates a GitHub issue with action items
3. Labels it for tracking

## Project Structure

```
meet-buddy/
├── extension/              # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── popup/              # Extension popup UI
│   ├── content/            # Google Meet content script
│   ├── background/         # Service worker
│   ├── lib/                # Shared utilities
│   └── options/            # Settings page
├── mcp-server/             # MCP Server (TypeScript)
│   ├── src/
│   │   └── index.ts        # Main server with all tools
│   └── package.json
├── swarm/                  # Agent swarm configuration
│   └── meeting-swarm.json
├── .github/workflows/      # GitHub Actions
│   └── meeting-processor.yml
└── docs/                   # Documentation
```

## Requirements

- Chrome 120+ (for Manifest V3)
- Node.js 20+
- A GitHub account
- Google Meet with captions enabled
- Claude Code with MCP support

## Privacy

- All transcript data stays in **your** GitHub repo (private recommended)
- No external servers — the extension talks directly to GitHub's API
- Screenshots are compressed JPEG (65% quality) to save space
- No audio is recorded — only text captions from Google Meet

## Built by

**[aumiqx](https://aumiqx.com)** — we don't build software. we grow intelligence.

## License

MIT
