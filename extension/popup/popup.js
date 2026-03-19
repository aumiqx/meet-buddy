/**
 * Meet Buddy — Popup Controller
 *
 * Popup is ephemeral — all state lives in the service worker.
 * Popup just renders whatever state the service worker has.
 */

// ── Elements ───────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const screenAuth = $("screen-auth");
const screenMain = $("screen-main");
const authSetup = $("auth-setup");
const authPending = $("auth-pending");
const stateIdle = $("state-idle");
const stateRecording = $("state-recording");
const repoSelect = $("repo-select");

// ── Init — ask service worker for current state ────────────

async function init() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "AUTH_STATUS" });

    if (!response || !response.authState) {
      // Service worker not ready — check storage directly
      const { githubToken, githubClientId } = await chrome.storage.sync.get([
        "githubToken",
        "githubClientId",
      ]);
      if (githubToken) {
        showMain();
      } else {
        showAuth();
        if (githubClientId) $("client-id").value = githubClientId;
      }
      return;
    }

    const { authState } = response;

    if (authState.isAuthenticated) {
      showMain();
    } else if (authState.status === "polling" || authState.status === "pending") {
      showAuth();
      showDeviceCode(authState.userCode, authState.verificationUri);
    } else if (authState.status === "complete") {
      showMain();
    } else if (authState.status === "error") {
      showAuth();
      showAuthError(authState.error);
    } else {
      showAuth();
      if (authState.savedClientId) {
        $("client-id").value = authState.savedClientId;
      }
    }
  } catch (err) {
    // Service worker crashed or restarting — fallback to storage
    console.warn("[Meet Buddy] Init fallback:", err.message);
    const { githubToken } = await chrome.storage.sync.get(["githubToken"]);
    if (githubToken) {
      showMain();
    } else {
      showAuth();
    }
  }
}

// ── Auth UI ────────────────────────────────────────────────

function showAuth() {
  screenAuth.style.display = "flex";
  screenMain.style.display = "none";
}

function showMain() {
  screenAuth.style.display = "none";
  screenMain.style.display = "flex";
  loadRepos();
  checkSession();
}

function showDeviceCode(code, url) {
  authSetup.style.display = "none";
  authPending.style.display = "flex";
  $("device-code").textContent = code;
  $("device-url").href = url;

  // Poll for completion from popup side
  startAuthStatusPoll();
}

function showAuthError(msg) {
  authSetup.style.display = "flex";
  authPending.style.display = "none";
  $("btn-auth").disabled = false;
  $("btn-auth").textContent = "Authenticate with GitHub";
  // Flash the input red briefly
  $("client-id").style.borderColor = "#ef4444";
  setTimeout(() => ($("client-id").style.borderColor = ""), 3000);
}

// Poll service worker for auth completion (so popup updates when user comes back)
let authPollTimer = null;
function startAuthStatusPoll() {
  if (authPollTimer) clearInterval(authPollTimer);
  authPollTimer = setInterval(async () => {
    const response = await chrome.runtime.sendMessage({ type: "AUTH_STATUS" });
    const { authState } = response;

    if (authState.isAuthenticated || authState.status === "complete") {
      clearInterval(authPollTimer);
      authPollTimer = null;
      showMain();
    } else if (authState.status === "error") {
      clearInterval(authPollTimer);
      authPollTimer = null;
      showAuthError(authState.error);
    }
  }, 2000);
}

// ── Auth Button ────────────────────────────────────────────

$("btn-auth").addEventListener("click", async () => {
  const clientId = $("client-id").value.trim();
  if (!clientId) {
    $("client-id").style.borderColor = "#ef4444";
    return;
  }

  $("btn-auth").disabled = true;
  $("btn-auth").textContent = "Starting...";

  try {
    // Tell service worker to start device flow
    const response = await chrome.runtime.sendMessage({
      type: "AUTH_START",
      clientId,
    });

    if (!response.success) throw new Error(response.error);

    const { user_code, verification_uri } = response.data;

    // Show device code — service worker handles the polling
    showDeviceCode(user_code, verification_uri);

    // Open GitHub in a new tab
    chrome.tabs.create({ url: `${verification_uri}` });
  } catch (err) {
    console.error("Auth start failed:", err);
    showAuthError(err.message);
  }
});

// Copy device code on click
$("device-code")?.addEventListener("click", () => {
  const code = $("device-code").textContent;
  navigator.clipboard.writeText(code);
  $("device-code").style.color = "#10b981";
  setTimeout(() => ($("device-code").style.color = ""), 1500);
});

// ── Repo Loading ───────────────────────────────────────────

async function loadRepos() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "FETCH_REPOS" });
    if (!response.success) throw new Error(response.error);

    const { selectedRepo } = await chrome.storage.sync.get(["selectedRepo"]);

    repoSelect.innerHTML = '<option value="">select a repo</option>';
    for (const repo of response.repos) {
      const opt = document.createElement("option");
      opt.value = repo.full_name;
      opt.textContent = `${repo.full_name}${repo.private ? " (private)" : ""}`;
      if (repo.full_name === selectedRepo) opt.selected = true;
      repoSelect.appendChild(opt);
    }
  } catch (err) {
    repoSelect.innerHTML = '<option value="">failed to load repos</option>';
    console.error("Failed to load repos:", err);
  }
}

repoSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ selectedRepo: repoSelect.value });
});

// ── Session Management ─────────────────────────────────────

let timerInterval = null;

async function checkSession() {
  const response = await chrome.runtime.sendMessage({ type: "GET_SESSION" });

  if (response.session) {
    showRecordingState(response.session, response.totalWords, response.screenshotCount);
  } else {
    showIdleState();
  }
}

function showIdleState() {
  stateIdle.style.display = "flex";
  stateRecording.style.display = "none";
  if (timerInterval) clearInterval(timerInterval);
}

function showRecordingState(session, words = 0, screenshots = 0) {
  stateIdle.style.display = "none";
  stateRecording.style.display = "flex";
  $("meeting-title").textContent = session.meetingTitle;
  $("stat-words").textContent = words;
  $("stat-screenshots").textContent = screenshots;

  const startTime = new Date(session.startTime).getTime();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const h = String(Math.floor(elapsed / 3600000)).padStart(2, "0");
    const m = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0");
    $("timer").textContent = `${h}:${m}:${s}`;
  }, 1000);
}

$("btn-start").addEventListener("click", async () => {
  const repo = repoSelect.value;
  if (!repo) {
    repoSelect.style.borderColor = "#ef4444";
    setTimeout(() => (repoSelect.style.borderColor = ""), 2000);
    return;
  }

  const meetingTitle = prompt("Meeting name:") || "untitled-meeting";

  const response = await chrome.runtime.sendMessage({
    type: "START_SESSION",
    meetingTitle,
    repo,
  });

  if (response.success) {
    showRecordingState(response.session);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes("meet.google.com")) {
      chrome.tabs.sendMessage(tab.id, {
        type: "START_RECORDING",
        meetingTitle,
      });
    }
  }
});

$("btn-end").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.includes("meet.google.com")) {
    chrome.tabs.sendMessage(tab.id, { type: "STOP_RECORDING" });
  }

  await chrome.runtime.sendMessage({ type: "END_SESSION" });
  showIdleState();
});

$("btn-screenshot").addEventListener("click", async () => {
  const annotation = prompt("Annotation (optional):");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE_SCREENSHOT",
      data: {
        annotation: annotation || "",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// ── Settings & Logout ──────────────────────────────────────

$("btn-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

$("btn-logout").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "LOGOUT" });
  showAuth();
});

// ── Real-time Status Refresh (every 1s) ───────────────────
// Poll content script directly for live word count

let lastWordCount = 0;

setInterval(async () => {
  if (screenMain.style.display === "none") return;

  // Service worker stats (screenshots)
  try {
    const swResponse = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
    if (swResponse?.session) {
      $("stat-screenshots").textContent = swResponse.screenshotCount || 0;
    }
  } catch {}

  // Content script stats (live word count)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes("meet.google.com")) {
      const csResponse = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
      if (csResponse?.totalWords !== undefined) {
        const wordEl = $("stat-words");
        const newCount = csResponse.totalWords;

        if (newCount !== lastWordCount) {
          wordEl.textContent = newCount;
          wordEl.classList.add("updated");
          setTimeout(() => wordEl.classList.remove("updated"), 500);
          lastWordCount = newCount;
        }

        // Update sync status
        const syncEl = $("sync-status");
        if (syncEl) {
          syncEl.textContent = csResponse.isRecording ? "syncing live" : "paused";
        }
      }
    }
  } catch {}
}, 1000);

// ── Go ─────────────────────────────────────────────────────

init();
