// Bootstrap: handle invite redemption from ?token=…, wire up nav + search,
// load local cache, render, then auto-sync.

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    STATE.nav = btn.dataset.nav;
    render();
  });
});

document.getElementById("search-input").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  const res = document.getElementById("search-results");
  if (!q) { res.innerHTML = ""; return; }
  const matches = STATE.roster.filter(r => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)).slice(0, 5);
  res.innerHTML = matches.map(r => `<button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="openPerson('${r.id}')">${r.id}</button>`).join("");
});

// Redeems ?token=… from the URL if present. Returns true if an attempt was
// made (regardless of success); the URL param is scrubbed either way so a
// failed redemption can't sit in the address bar.
async function tryRedeemInviteFromURL() {
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("token");
  if (!inviteToken) return false;

  // Scrub immediately so a refresh doesn't retry a doomed redemption.
  history.replaceState({}, document.title, window.location.pathname);

  try {
    const res = await API.redeemInvite(inviteToken);
    if (res && res.ok && res.authToken) {
      setAuthToken(res.authToken);
      return true;
    }
    alert("Invite link rejected: " + (res?.error || "unknown error") + "\n\nAsk your admin for a new link.");
  } catch (e) {
    alert("Failed to redeem invite: " + e.message);
  }
  return true;
}

(async function bootstrap() {
  await tryRedeemInviteFromURL();
  loadLocal();
  render();
  autoSyncOnLaunch();
})();
