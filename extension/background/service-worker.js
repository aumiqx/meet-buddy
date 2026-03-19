/**
 * Meet Buddy — Service Worker (Background)
 *
 * Handles GitHub auth, transcript pushing, screenshot capture,
 * and session management. All auth state persists here.
 */

// ── State ──────────────────────────────────────────────────

let activeSession = null;
let screenshotCount = 0;
let totalWords = 0;
let pushQueue = [];
let isPushing = false;

// Auth state — persists across popup open/close
let authState = {
  status: "idle", // idle | pending | polling | complete | error
  userCode: null,
  verificationUri: null,
  deviceCode: null,
  interval: null,
  clientId: null,
  error: null,
};

// ── GitHub Config ──────────────────────────────────────────

async function getGitHubConfig() {
  const result = await chrome.storage.sync.get([
    "githubToken",
    "selectedRepo",
    "githubUser",
  ]);
  return result;
}

async function getGitHubHeaders() {
  const { githubToken } = await getGitHubConfig();
  if (!githubToken) throw new Error("GitHub not authenticated");
  return {
    Authorization: `token ${githubToken}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

// ── GitHub API ─────────────────────────────────────────────

async function githubRequest(endpoint, options = {}) {
  const headers = await getGitHubHeaders();
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `GitHub API error: ${response.status} — ${error.message || "Unknown"}`
    );
  }

  return response.json();
}

async function getOrCreateFile(repo, path) {
  try {
    const data = await githubRequest(`/repos/${repo}/contents/${path}`);
    return { sha: data.sha, content: atob(data.content) };
  } catch {
    return { sha: null, content: "" };
  }
}

async function pushFile(repo, path, content, message) {
  const existing = await getOrCreateFile(repo, path);
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    ...(existing.sha ? { sha: existing.sha } : {}),
  };

  return githubRequest(`/repos/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function pushBinaryFile(repo, path, base64Content, message) {
  const existing = await getOrCreateFile(repo, path);
  const body = {
    message,
    content: base64Content,
    ...(existing.sha ? { sha: existing.sha } : {}),
  };

  return githubRequest(`/repos/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// ── GitHub OAuth (Device Flow) — runs entirely in service worker ──

async function startDeviceFlow(clientId) {
  // Save client ID immediately so it persists
  await chrome.storage.sync.set({ githubClientId: clientId });

  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: "repo",
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  // Store auth state so popup can read it anytime
  authState = {
    status: "pending",
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    deviceCode: data.device_code,
    interval: data.interval || 5,
    clientId,
    error: null,
  };

  // Start polling in background — this survives popup close
  pollForTokenBackground();

  return data;
}

async function pollForTokenBackground() {
  if (authState.status !== "pending") return;
  authState.status = "polling";

  const { clientId, deviceCode, interval } = authState;

  const poll = async () => {
    if (authState.status === "idle") return; // cancelled

    try {
      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        }
      );

      const data = await response.json();

      if (data.access_token) {
        // Success — save token
        await chrome.storage.sync.set({ githubToken: data.access_token });

        // Get user info
        const userRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `token ${data.access_token}` },
        });
        const user = await userRes.json();
        await chrome.storage.sync.set({ githubUser: user.login });

        authState.status = "complete";
        console.log("[Meet Buddy] Auth complete:", user.login);
        return;
      }

      if (data.error === "authorization_pending") {
        setTimeout(poll, (interval + 1) * 1000);
        return;
      }

      if (data.error === "slow_down") {
        setTimeout(poll, (interval + 6) * 1000);
        return;
      }

      if (data.error === "expired_token") {
        authState.status = "error";
        authState.error = "Device code expired. Please try again.";
        return;
      }

      authState.status = "error";
      authState.error = data.error_description || data.error || "Auth failed";
    } catch (err) {
      // Network error — retry
      console.error("[Meet Buddy] Poll error, retrying:", err.message);
      setTimeout(poll, (interval + 2) * 1000);
    }
  };

  poll();
}

// ── Repo Listing ───────────────────────────────────────────

async function fetchUserRepos() {
  // Fetch all pages — owner, collaborator, and org member repos
  const allRepos = [];
  let page = 1;

  while (page <= 5) {
    const batch = await githubRequest(
      `/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&page=${page}`
    );
    allRepos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  // Deduplicate by full_name and sort by last updated
  const seen = new Set();
  return allRepos
    .filter((r) => {
      if (seen.has(r.full_name)) return false;
      seen.add(r.full_name);
      return true;
    })
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .map((r) => ({
      full_name: r.full_name,
      name: r.name,
      private: r.private,
      owner: r.owner.login,
    }));
}

// ── Session Management ─────────────────────────────────────

function generateMeetingId(title) {
  const date = new Date().toISOString().split("T")[0];
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${date}-${slug}`;
}

async function startSession(meetingTitle, repo) {
  const meetingId = generateMeetingId(meetingTitle);

  activeSession = {
    meetingId,
    meetingTitle,
    repo,
    startTime: new Date().toISOString(),
    transcriptLines: [],
    screenshots: [],
  };

  screenshotCount = 0;
  totalWords = 0;

  // Push initial meta.json
  const meta = {
    title: meetingTitle,
    startTime: activeSession.startTime,
    repo,
    meetingId,
  };

  const metaPath = `meetings/${meetingId}/meta.json`;

  try {
    await pushFile(
      repo,
      metaPath,
      JSON.stringify(meta, null, 2),
      `[meet-buddy] Start: ${meetingTitle}`
    );
  } catch (err) {
    console.error("[Meet Buddy] Failed to push meta:", err);
  }

  await chrome.storage.local.set({ activeSession });
  return activeSession;
}

async function endSession() {
  if (!activeSession) return;

  // Flush any remaining data
  await processPushQueue();

  // Update meta with end time
  const meta = {
    title: activeSession.meetingTitle,
    startTime: activeSession.startTime,
    endTime: new Date().toISOString(),
    repo: activeSession.repo,
    meetingId: activeSession.meetingId,
    totalWords,
    totalScreenshots: screenshotCount,
  };

  try {
    await pushFile(
      activeSession.repo,
      `meetings/${activeSession.meetingId}/meta.json`,
      JSON.stringify(meta, null, 2),
      `[meet-buddy] End: ${activeSession.meetingTitle}`
    );
  } catch (err) {
    console.error("[Meet Buddy] Failed to update meta:", err);
  }

  activeSession = null;
  screenshotCount = 0;
  totalWords = 0;
  await chrome.storage.local.remove("activeSession");
}

// ── Transcript Push ────────────────────────────────────────

async function pushTranscriptChunk(entries) {
  if (!activeSession) return;

  // Format entries as markdown
  const lines = entries.map((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString("en-US", {
      hour12: false,
    });
    return `**[${time}] ${e.speaker}:** ${e.text}`;
  });

  const wordCount = entries.reduce(
    (sum, e) => sum + e.text.split(/\s+/).length,
    0
  );
  totalWords += wordCount;

  pushQueue.push({
    type: "transcript",
    lines,
    timestamp: new Date().toISOString(),
  });

  await processPushQueue();
}

async function processPushQueue() {
  if (isPushing || pushQueue.length === 0 || !activeSession) return;
  isPushing = true;

  try {
    // Batch all queued transcript lines
    const transcriptItems = pushQueue.filter((q) => q.type === "transcript");
    const screenshotItems = pushQueue.filter((q) => q.type === "screenshot");
    pushQueue = [];

    if (transcriptItems.length > 0) {
      const allLines = transcriptItems.flatMap((q) => q.lines);
      const transcriptPath = `meetings/${activeSession.meetingId}/transcript.md`;

      // Get existing transcript and append
      const existing = await getOrCreateFile(activeSession.repo, transcriptPath);
      const header = existing.content
        ? ""
        : `# ${activeSession.meetingTitle}\n\n_Started: ${activeSession.startTime}_\n\n---\n\n`;
      const newContent = existing.content + header + allLines.join("\n") + "\n\n";

      await pushFile(
        activeSession.repo,
        transcriptPath,
        newContent,
        `[meet-buddy] Transcript update (${allLines.length} lines)`
      );
    }

    for (const item of screenshotItems) {
      const ssPath = `meetings/${activeSession.meetingId}/screenshots/${item.filename}`;
      await pushBinaryFile(
        activeSession.repo,
        ssPath,
        item.base64,
        `[meet-buddy] Screenshot: ${item.annotation || "capture"}`
      );
    }
  } catch (err) {
    console.error("[Meet Buddy] Push failed:", err);
  } finally {
    isPushing = false;
    if (pushQueue.length > 0) {
      setTimeout(processPushQueue, 1000);
    }
  }
}

// ── Screenshot Handling ────────────────────────────────────

async function handleScreenshotCapture(data) {
  if (!activeSession) return;

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return;

    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "jpeg",
      quality: 65,
    });

    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");

    screenshotCount++;
    const filename = `${String(screenshotCount).padStart(3, "0")}-${data.annotation?.replace(/[^a-z0-9]/gi, "-").slice(0, 30) || "capture"}.jpg`;

    pushQueue.push({
      type: "screenshot",
      filename,
      base64,
      annotation: data.annotation,
      timestamp: data.timestamp,
    });

    await processPushQueue();

    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: "SCREENSHOT_TAKEN" });
    }
  } catch (err) {
    console.error("[Meet Buddy] Screenshot failed:", err);
  }
}

// ── Message Router ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "TRANSCRIPT_CHUNK":
      pushTranscriptChunk(msg.data.entries);
      sendResponse({ success: true });
      break;

    case "CAPTURE_SCREENSHOT":
      handleScreenshotCapture(msg.data);
      sendResponse({ success: true });
      break;

    case "UPDATE_BADGE":
      chrome.action.setBadgeText({ text: String(msg.count || "") });
      chrome.action.setBadgeBackgroundColor({ color: "#DB534B" });
      break;

    case "START_SESSION":
      startSession(msg.meetingTitle, msg.repo).then((session) => {
        sendResponse({ success: true, session });
      });
      return true;

    case "END_SESSION": {
      // First tell content script to flush its buffer before ending
      chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
        const flushPromises = tabs.map(
          (tab) =>
            new Promise((resolve) => {
              try {
                chrome.tabs.sendMessage(tab.id, { type: "STOP_RECORDING" }, () => resolve());
              } catch {
                resolve();
              }
            })
        );
        // Wait for content scripts to flush, then end session
        Promise.all(flushPromises).then(() => {
          // Small delay to let transcript chunks arrive
          setTimeout(() => {
            endSession().then(() => sendResponse({ success: true }));
          }, 2000);
        });
      });
      return true;
    }

    case "GET_SESSION":
      sendResponse({ session: activeSession, screenshotCount, totalWords });
      break;

    // ── Auth messages ──

    case "AUTH_START": {
      startDeviceFlow(msg.clientId)
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case "AUTH_STATUS": {
      // Popup asks "what's the current auth state?"
      chrome.storage.sync.get(["githubToken", "githubClientId"]).then((stored) => {
        sendResponse({
          authState: {
            ...authState,
            isAuthenticated: !!stored.githubToken,
            savedClientId: stored.githubClientId || null,
          },
        });
      });
      return true;
    }

    case "AUTH_CANCEL":
      authState = { status: "idle", userCode: null, verificationUri: null, deviceCode: null, interval: null, clientId: null, error: null };
      sendResponse({ success: true });
      break;

    case "FETCH_REPOS":
      fetchUserRepos()
        .then((repos) => sendResponse({ success: true, repos }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case "LOGOUT":
      chrome.storage.sync.remove(["githubToken", "githubUser", "selectedRepo"]);
      authState = { status: "idle", userCode: null, verificationUri: null, deviceCode: null, interval: null, clientId: null, error: null };
      sendResponse({ success: true });
      break;
  }

  return false;
});

// ── Restore session on startup ─────────────────────────────

chrome.storage.local.get(["activeSession"], (result) => {
  if (result.activeSession) {
    activeSession = result.activeSession;
    console.log("[Meet Buddy] Restored session:", activeSession.meetingId);
  }
});
