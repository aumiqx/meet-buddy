/**
 * Meet Buddy — Google Meet Caption Scraper v3
 *
 * Captures only FINAL captions (waits for text to stabilize),
 * filters out UI junk, and deduplicates properly.
 */

(() => {
  "use strict";

  const BUFFER_INTERVAL_MS = 15_000; // push every 15s
  const POLL_INTERVAL_MS = 500;
  const STABILIZE_MS = 4_000; // wait 4s of silence before emitting — catches full sentences
  const MAX_BLOCK_AGE_MS = 30_000; // force-emit if a block has been growing for 30s+

  let captionBuffer = [];
  let lastPushed = Date.now();
  let isRecording = false;
  let meetingTitle = "";
  let pollTimer = null;
  let totalWordsCaptured = 0;

  // Track current caption state per speaker — only emit when stabilized
  const activeCaptions = new Map(); // speaker -> { text, lastChanged, emitted }
  const emittedTexts = new Set(); // prevent re-emitting same final text
  const lastEmittedPerSpeaker = new Map(); // speaker -> last emitted text (for prefix dedup)

  // Google Meet UI strings to filter out
  const UI_JUNK = [
    "reframe", "visual_effects", "backgrounds and effects",
    "more_vert", "more options", "frame_person",
    "others might still see", "devices", "stop presenting",
    "show my screen", "present now", "you are presenting",
    "meet buddy", "recording", "screenshot", "annotation",
    "share just a tab", "avoid an infinity mirror",
  ];

  // ── Caption Scanning ──────────────────────────────────────

  function scanForCaptions() {
    if (!isRecording) return;

    // Find caption blocks using known Meet selectors
    let captionBlocks = document.querySelectorAll("div.nMcdL");
    if (captionBlocks.length === 0) captionBlocks = document.querySelectorAll("div.bj4p3b");
    if (captionBlocks.length === 0) captionBlocks = findCaptionBlocksByStructure();
    if (captionBlocks.length === 0) return;

    const now = Date.now();
    const currentSpeakers = new Set();

    for (const block of captionBlocks) {
      const speakerEl = block.querySelector("span.NWpY1d") || block.querySelector("span[class]");
      const speaker = speakerEl?.textContent?.trim() || "Unknown";

      const textEl = block.querySelector("div.ygicle") || block.querySelector("div.VbkSUe");
      let captionText = "";

      if (textEl) {
        for (const node of textEl.childNodes) {
          captionText += node.textContent || "";
        }
        captionText = captionText.trim();
      } else {
        captionText = (block.textContent?.trim() || "").replace(speaker, "").trim();
      }

      if (!captionText || captionText.length < 2) continue;
      if (isUIJunk(captionText)) continue;

      currentSpeakers.add(speaker);

      const existing = activeCaptions.get(speaker);
      if (!existing) {
        // New speaker — start tracking
        activeCaptions.set(speaker, {
          text: captionText,
          lastChanged: now,
          firstSeen: now,
          emitted: false,
        });
      } else if (existing.text !== captionText) {
        // Text changed — update but keep firstSeen for max age tracking
        activeCaptions.set(speaker, {
          text: captionText,
          lastChanged: now,
          firstSeen: existing.firstSeen || now,
          emitted: false,
        });
      }
    }

    // Check for stabilized captions (unchanged for STABILIZE_MS or aged out)
    for (const [speaker, state] of activeCaptions) {
      const isStabilized = now - state.lastChanged >= STABILIZE_MS;
      const isAgedOut = state.firstSeen && (now - state.firstSeen >= MAX_BLOCK_AGE_MS);

      if (
        !state.emitted &&
        state.text &&
        (isStabilized || isAgedOut)
      ) {
        // Caption has stabilized — check if it's just an extension of previous
        const prevEmitted = lastEmittedPerSpeaker.get(speaker) || "";
        let textToEmit = state.text;

        // If new text starts with previously emitted text, only emit the new part
        if (prevEmitted && textToEmit.startsWith(prevEmitted)) {
          textToEmit = textToEmit.slice(prevEmitted.length).trim();
        }

        if (textToEmit && textToEmit.length > 1) {
          const dedupKey = `${speaker}:${textToEmit}`;
          if (!emittedTexts.has(dedupKey)) {
            captionBuffer.push({
              speaker,
              text: textToEmit,
              timestamp: new Date().toISOString(),
            });
            emittedTexts.add(dedupKey);
            totalWordsCaptured += textToEmit.split(/\s+/).filter(Boolean).length;
            updateOverlayStats();
            updateBadge(totalWordsCaptured);
            console.log(`[Meet Buddy] ${speaker}: "${textToEmit}"`);
          }
        }
        lastEmittedPerSpeaker.set(speaker, state.text);
        state.emitted = true;
      }
    }

    // Clean up speakers that are no longer showing captions
    for (const [speaker] of activeCaptions) {
      if (!currentSpeakers.has(speaker)) {
        const state = activeCaptions.get(speaker);
        if (state && !state.emitted && state.text) {
          // Speaker's caption disappeared — emit final version
          const dedupKey = `${speaker}:${state.text}`;
          if (!emittedTexts.has(dedupKey)) {
            captionBuffer.push({
              speaker,
              text: state.text,
              timestamp: new Date().toISOString(),
            });
            emittedTexts.add(dedupKey);
            totalWordsCaptured += state.text.split(/\s+/).filter(Boolean).length;
            updateOverlayStats();
            console.log(`[Meet Buddy] ${speaker}: "${state.text}" (speaker ended)`);
          }
        }
        activeCaptions.delete(speaker);
      }
    }

    // Keep emittedTexts from growing forever
    if (emittedTexts.size > 500) {
      const arr = [...emittedTexts];
      emittedTexts.clear();
      arr.slice(-200).forEach((t) => emittedTexts.add(t));
    }

    // Flush periodically
    if (Date.now() - lastPushed > BUFFER_INTERVAL_MS && captionBuffer.length > 0) {
      flushBuffer();
    }
  }

  function isUIJunk(text) {
    const lower = text.toLowerCase();
    // Filter by known UI strings
    for (const junk of UI_JUNK) {
      if (lower.includes(junk)) return true;
    }
    // Filter by structure: too many special chars or looks like UI metadata
    if (/^[a-z_]+[A-Z]/.test(text)) return true; // camelCase = UI element
    if (text.includes("frame_person")) return true;
    if (text.includes("more_vert")) return true;
    return false;
  }

  function findCaptionBlocksByStructure() {
    const results = [];
    const containers = document.querySelectorAll("div");
    for (const div of containers) {
      const rect = div.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.6) continue;
      if (rect.height === 0 || rect.width === 0) continue;
      const hasImg = div.querySelector("img");
      const hasSpan = div.querySelector("span");
      if (hasImg && hasSpan && div.textContent.trim().length > 2) {
        results.push(div);
      }
    }
    return results;
  }

  // ── Meeting Title ────────────────────────────────────────

  function detectMeetingTitle() {
    const docTitle = document.title.replace(" - Google Meet", "").trim();
    if (docTitle && docTitle !== "Google Meet") return docTitle;
    return "untitled-meeting";
  }

  // ── Buffer Flush ─────────────────────────────────────────

  function flushBuffer() {
    if (captionBuffer.length === 0) return;
    const chunk = [...captionBuffer];
    captionBuffer = [];
    lastPushed = Date.now();

    console.log(`[Meet Buddy] Flushing ${chunk.length} captions to GitHub`);

    try {
      chrome.runtime.sendMessage({
        type: "TRANSCRIPT_CHUNK",
        data: {
          meetingTitle: meetingTitle || detectMeetingTitle(),
          entries: chunk,
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      captionBuffer.push(...chunk);
    }
  }

  function updateBadge(count) {
    try {
      chrome.runtime.sendMessage({
        type: "UPDATE_BADGE",
        count: count > 99 ? "99+" : String(count),
      });
    } catch {}
  }

  // ── Start / Stop ──────────────────────────────────────────

  function startRecording() {
    if (pollTimer) return;
    isRecording = true;
    activeCaptions.clear();
    emittedTexts.clear();
    console.log("[Meet Buddy] Recording started — polling every 500ms with 2s stabilization");
    pollTimer = setInterval(scanForCaptions, POLL_INTERVAL_MS);
  }

  function stopRecording() {
    isRecording = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // Emit any remaining active captions
    for (const [speaker, state] of activeCaptions) {
      if (!state.emitted && state.text) {
        captionBuffer.push({
          speaker,
          text: state.text,
          timestamp: new Date().toISOString(),
        });
      }
    }
    activeCaptions.clear();
    flushBuffer();
    console.log("[Meet Buddy] Recording stopped");
  }

  // ── Overlay UI ─────────────────────────────────────────────

  function injectOverlay() {
    if (document.getElementById("meet-buddy-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "meet-buddy-overlay";
    overlay.innerHTML = `
      <div class="mb-status">
        <div class="mb-dot" id="mb-dot"></div>
        <span class="mb-label" id="mb-label">Meet Buddy</span>
      </div>
      <div class="mb-controls" id="mb-controls" style="display: none;">
        <button class="mb-btn mb-btn-screenshot" id="mb-screenshot" title="Capture Screenshot">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button class="mb-btn mb-btn-note" id="mb-note" title="Add Note">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <div class="mb-stats">
          <span id="mb-word-count">0 words</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("mb-dot").addEventListener("click", () => {
      const controls = document.getElementById("mb-controls");
      controls.style.display = controls.style.display === "none" ? "flex" : "none";
    });

    document.getElementById("mb-screenshot").addEventListener("click", () => {
      const annotation = prompt("Annotation (optional):");
      try {
        chrome.runtime.sendMessage({
          type: "CAPTURE_SCREENSHOT",
          data: { annotation: annotation || "", timestamp: new Date().toISOString() },
        });
      } catch {}
    });

    document.getElementById("mb-note").addEventListener("click", () => {
      const note = prompt("Add a note to the transcript:");
      if (note) {
        captionBuffer.push({ speaker: "[NOTE]", text: note, timestamp: new Date().toISOString() });
        totalWordsCaptured += note.split(/\s+/).length;
        updateOverlayStats();
      }
    });
  }

  function updateOverlayStats() {
    const wordEl = document.getElementById("mb-word-count");
    if (wordEl) wordEl.textContent = `${totalWordsCaptured} words`;
  }

  function updateOverlayState(recording) {
    const dot = document.getElementById("mb-dot");
    const label = document.getElementById("mb-label");
    const controls = document.getElementById("mb-controls");
    if (dot) dot.className = recording ? "mb-dot mb-recording" : "mb-dot";
    if (label) label.textContent = recording ? "Recording" : "Meet Buddy";
    if (controls && recording) controls.style.display = "flex";
  }

  // ── Message Handlers ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case "START_RECORDING":
        meetingTitle = msg.meetingTitle || detectMeetingTitle();
        startRecording();
        updateOverlayState(true);
        sendResponse({ success: true, title: meetingTitle });
        break;
      case "STOP_RECORDING":
        stopRecording();
        updateOverlayState(false);
        sendResponse({ success: true });
        break;
      case "GET_STATUS":
        sendResponse({
          isRecording,
          bufferSize: captionBuffer.length,
          totalWords: totalWordsCaptured,
          meetingTitle,
        });
        break;
      case "CAPTURE_SCREENSHOT":
        try {
          chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT", data: msg.data });
        } catch {}
        sendResponse({ success: true });
        break;
      case "SCREENSHOT_TAKEN":
        break;
    }
    return true;
  });

  // ── Init ─────────────────────────────────────────────────

  function init() {
    if (!window.location.pathname.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) return;
    console.log("[Meet Buddy] v3 initialized — stabilized dedup + UI filter");
    meetingTitle = detectMeetingTitle();
    injectOverlay();
    chrome.storage.local.get(["activeSession"], (result) => {
      if (result.activeSession) {
        startRecording();
        updateOverlayState(true);
      }
    });
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init);
})();
