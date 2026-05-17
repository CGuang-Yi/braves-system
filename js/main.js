// Bootstrap: wire up navigation + search, load local cache, render, then auto-sync.

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

loadLocal();
render();
autoSyncOnLaunch();
