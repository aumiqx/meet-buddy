async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    "githubClientId",
    "pushInterval",
    "autoStart",
    "ssQuality",
    "localDir",
  ]);
  document.getElementById("client-id").value = settings.githubClientId || "";
  document.getElementById("push-interval").value = settings.pushInterval || 30;
  document.getElementById("auto-start").checked = settings.autoStart || false;
  document.getElementById("ss-quality").value = settings.ssQuality || 65;
  document.getElementById("local-dir").value = settings.localDir || "";
}

document.getElementById("btn-save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    githubClientId: document.getElementById("client-id").value,
    pushInterval:
      parseInt(document.getElementById("push-interval").value) || 30,
    autoStart: document.getElementById("auto-start").checked,
    ssQuality: parseInt(document.getElementById("ss-quality").value) || 65,
    localDir: document.getElementById("local-dir").value,
  });
  const msg = document.getElementById("saved-msg");
  msg.classList.add("show");
  setTimeout(() => msg.classList.remove("show"), 2000);
});

loadSettings();
