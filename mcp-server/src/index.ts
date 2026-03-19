#!/usr/bin/env node

/**
 * Meet Buddy — MCP Server
 *
 * Exposes meeting transcripts, screenshots, and analysis
 * to Claude Code via the Model Context Protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

const MEETINGS_DIR =
  process.env.MEET_BUDDY_DIR ||
  path.join(process.env.HOME || "~", ".meet-buddy", "meetings");

// Ensure directory exists
if (!fs.existsSync(MEETINGS_DIR)) {
  fs.mkdirSync(MEETINGS_DIR, { recursive: true });
}

const server = new McpServer({
  name: "meet-buddy",
  version: "1.0.0",
});

// ── Helpers ────────────────────────────────────────────────

function listMeetings(): string[] {
  if (!fs.existsSync(MEETINGS_DIR)) return [];
  return fs
    .readdirSync(MEETINGS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort()
    .reverse();
}

function getMostRecentMeeting(): string | null {
  const meetings = listMeetings();
  return meetings.length > 0 ? meetings[0] : null;
}

function readMeetingFile(meetingId: string, filename: string): string | null {
  const filePath = path.join(MEETINGS_DIR, meetingId, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

function readMeetingMeta(meetingId: string): Record<string, unknown> | null {
  const raw = readMeetingFile(meetingId, "meta.json");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getScreenshotList(meetingId: string): string[] {
  const ssDir = path.join(MEETINGS_DIR, meetingId, "screenshots");
  if (!fs.existsSync(ssDir)) return [];
  return fs
    .readdirSync(ssDir)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
}

// ── Tools ──────────────────────────────────────────────────

server.tool(
  "meeting_list",
  "List all recorded meetings",
  {},
  async () => {
    const meetings = listMeetings();
    if (meetings.length === 0) {
      return { content: [{ type: "text", text: "No meetings found." }] };
    }

    const details = meetings.map((id) => {
      const meta = readMeetingMeta(id);
      const title = (meta?.title as string) || id;
      const start = (meta?.startTime as string) || "unknown";
      const end = (meta?.endTime as string) || "ongoing";
      const words = (meta?.totalWords as number) || 0;
      const screenshots = (meta?.totalScreenshots as number) || 0;
      return `- **${title}** (${id})\n  Started: ${start} | Ended: ${end} | ${words} words | ${screenshots} screenshots`;
    });

    return {
      content: [{ type: "text", text: `## Meetings\n\n${details.join("\n\n")}` }],
    };
  }
);

server.tool(
  "meeting_active",
  "Check if a meeting is currently active (has no endTime in meta)",
  {},
  async () => {
    const meetings = listMeetings();
    for (const id of meetings) {
      const meta = readMeetingMeta(id);
      if (meta && !meta.endTime) {
        return {
          content: [
            {
              type: "text",
              text: `Active meeting: **${meta.title || id}**\nStarted: ${meta.startTime}\nID: ${id}`,
            },
          ],
        };
      }
    }
    return { content: [{ type: "text", text: "No active meeting." }] };
  }
);

server.tool(
  "meeting_transcript",
  "Get the full transcript of a meeting, or the latest N lines",
  {
    meeting_id: z
      .string()
      .optional()
      .describe("Meeting folder ID. Omit for the most recent meeting."),
    tail: z
      .number()
      .optional()
      .describe("Return only the last N lines of the transcript."),
  },
  async ({ meeting_id, tail }) => {
    const id = meeting_id || getMostRecentMeeting();
    if (!id) {
      return { content: [{ type: "text", text: "No meetings found." }] };
    }

    const transcript = readMeetingFile(id, "transcript.md");
    if (!transcript) {
      return {
        content: [{ type: "text", text: `No transcript found for meeting: ${id}` }],
      };
    }

    if (tail) {
      const lines = transcript.split("\n");
      const sliced = lines.slice(-tail).join("\n");
      return {
        content: [
          {
            type: "text",
            text: `## Transcript (last ${tail} lines) — ${id}\n\n${sliced}`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `## Full Transcript — ${id}\n\n${transcript}` }],
    };
  }
);

server.tool(
  "meeting_screenshots",
  "List screenshots from a meeting, optionally read a specific one",
  {
    meeting_id: z.string().optional().describe("Meeting folder ID. Omit for most recent."),
    filename: z.string().optional().describe("Specific screenshot filename to read."),
  },
  async ({ meeting_id, filename }) => {
    const id = meeting_id || getMostRecentMeeting();
    if (!id) {
      return { content: [{ type: "text", text: "No meetings found." }] };
    }

    if (filename) {
      const ssPath = path.join(MEETINGS_DIR, id, "screenshots", filename);
      if (!fs.existsSync(ssPath)) {
        return { content: [{ type: "text", text: `Screenshot not found: ${filename}` }] };
      }

      const data = fs.readFileSync(ssPath);
      const ext = path.extname(filename).slice(1).toLowerCase();
      const mimeType =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : "image/webp";

      return {
        content: [
          {
            type: "image",
            data: data.toString("base64"),
            mimeType,
          },
        ],
      };
    }

    const screenshots = getScreenshotList(id);
    if (screenshots.length === 0) {
      return { content: [{ type: "text", text: `No screenshots for meeting: ${id}` }] };
    }

    const list = screenshots
      .map((s, i) => `${i + 1}. \`${s}\``)
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `## Screenshots — ${id}\n\n${list}\n\nUse the \`filename\` parameter to view a specific screenshot.`,
        },
      ],
    };
  }
);

server.tool(
  "meeting_meta",
  "Get meeting metadata (title, start/end time, stats)",
  {
    meeting_id: z.string().optional().describe("Meeting folder ID. Omit for most recent."),
  },
  async ({ meeting_id }) => {
    const id = meeting_id || getMostRecentMeeting();
    if (!id) {
      return { content: [{ type: "text", text: "No meetings found." }] };
    }

    const meta = readMeetingMeta(id);
    if (!meta) {
      return { content: [{ type: "text", text: `No metadata for meeting: ${id}` }] };
    }

    return {
      content: [
        {
          type: "text",
          text: `## Meeting: ${meta.title || id}\n\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\``,
        },
      ],
    };
  }
);

server.tool(
  "meeting_notes",
  "Read or write notes for a meeting (your analysis, action items, etc.)",
  {
    meeting_id: z.string().optional().describe("Meeting folder ID. Omit for most recent."),
    write: z.string().optional().describe("If provided, appends this text to the meeting notes file."),
  },
  async ({ meeting_id, write }) => {
    const id = meeting_id || getMostRecentMeeting();
    if (!id) {
      return { content: [{ type: "text", text: "No meetings found." }] };
    }

    const notesPath = path.join(MEETINGS_DIR, id, "notes.md");

    if (write) {
      const existing = fs.existsSync(notesPath)
        ? fs.readFileSync(notesPath, "utf-8")
        : `# Agent Notes — ${id}\n\n`;
      const timestamp = new Date().toISOString();
      const updated = existing + `\n---\n_${timestamp}_\n\n${write}\n`;
      fs.writeFileSync(notesPath, updated);
      return {
        content: [{ type: "text", text: `Notes updated for meeting: ${id}` }],
      };
    }

    if (!fs.existsSync(notesPath)) {
      return {
        content: [{ type: "text", text: `No notes yet for meeting: ${id}` }],
      };
    }

    const notes = fs.readFileSync(notesPath, "utf-8");
    return { content: [{ type: "text", text: notes }] };
  }
);

server.tool(
  "meeting_sync",
  "Pull latest meeting data from GitHub repo to local directory",
  {
    repo: z.string().describe("GitHub repo in owner/name format"),
    meeting_id: z
      .string()
      .optional()
      .describe("Specific meeting to sync. Omit for all recent."),
  },
  async ({ repo, meeting_id }) => {
    const { execSync } = await import("child_process");

    const tempDir = path.join(MEETINGS_DIR, ".git-sync");
    try {
      // Sparse checkout just the meetings/ directory
      if (!fs.existsSync(tempDir)) {
        execSync(
          `git clone --depth 1 --filter=blob:none --sparse https://github.com/${repo}.git "${tempDir}"`,
          { stdio: "pipe" }
        );
        execSync("git sparse-checkout set meetings", {
          cwd: tempDir,
          stdio: "pipe",
        });
      } else {
        execSync("git pull", { cwd: tempDir, stdio: "pipe" });
      }

      // Copy meetings to local dir
      const meetingsSource = path.join(tempDir, "meetings");
      if (fs.existsSync(meetingsSource)) {
        const meetings = meeting_id
          ? [meeting_id]
          : fs.readdirSync(meetingsSource).filter((d) =>
              fs.statSync(path.join(meetingsSource, d)).isDirectory()
            );

        for (const m of meetings) {
          const src = path.join(meetingsSource, m);
          const dest = path.join(MEETINGS_DIR, m);
          if (fs.existsSync(src)) {
            execSync(`cp -r "${src}" "${dest}"`, { stdio: "pipe" });
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Synced ${meetings.length} meeting(s) from ${repo}`,
            },
          ],
        };
      }

      return { content: [{ type: "text", text: "No meetings directory found in repo." }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

// ── Start Server ───────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Meet Buddy MCP] Server started");
}

main().catch(console.error);
