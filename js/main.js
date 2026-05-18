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
  // Search respects the global scope filter so results don't show recruits the
  // user has explicitly scoped out of view.
  const matches = filteredRoster().filter(r => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)).slice(0, 5);
  res.innerHTML = matches.map(r => `<button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="openPerson('${r.id}')">${r.id}</button>`).join("");
});

// ── Global platoon/section filter ────────────────────────

function refreshFilterUI() {
  const pltSel = document.getElementById("filter-plt");
  const sectSel = document.getElementById("filter-sect");
  const clearBtn = document.getElementById("filter-clear");
  if (!pltSel || !sectSel) return;

  const platoons = [...new Set(STATE.roster.map(getPlt).filter(v => v !== ""))].sort();
  pltSel.innerHTML = `<option value="">All plts</option>` + platoons.map(p => `<option value="${p}" ${p === String(STATE.filterPlt) ? "selected" : ""}>P${p}</option>`).join("");

  // Sections depend on platoon selection — "section 2" is ambiguous across
  // platoons, so the section dropdown is disabled until a platoon is picked.
  if (STATE.filterPlt) {
    const sections = [...new Set(STATE.roster.filter(r => getPlt(r) === String(STATE.filterPlt)).map(getSect).filter(v => v !== ""))].sort();
    sectSel.disabled = false;
    sectSel.innerHTML = `<option value="">All sects</option>` + sections.map(s => `<option value="${s}" ${s === String(STATE.filterSect) ? "selected" : ""}>S${s}</option>`).join("");
  } else {
    sectSel.disabled = true;
    sectSel.innerHTML = `<option value="">All sects</option>`;
  }

  pltSel.classList.toggle("active", !!STATE.filterPlt);
  sectSel.classList.toggle("active", !!STATE.filterSect);
  if (clearBtn) clearBtn.style.display = isFilterActive() ? "" : "none";
}

function initFilterControls() {
  const pltSel = document.getElementById("filter-plt");
  const sectSel = document.getElementById("filter-sect");
  const clearBtn = document.getElementById("filter-clear");

  pltSel.addEventListener("change", () => {
    STATE.filterPlt = pltSel.value;
    // Drop section if it doesn't exist in the new platoon (or platoon cleared).
    if (!STATE.filterPlt) STATE.filterSect = "";
    else {
      const valid = STATE.roster.some(r => getPlt(r) === String(STATE.filterPlt) && getSect(r) === String(STATE.filterSect));
      if (!valid) STATE.filterSect = "";
    }
    saveFilter();
    render();
  });

  sectSel.addEventListener("change", () => {
    STATE.filterSect = sectSel.value;
    saveFilter();
    render();
  });

  clearBtn.addEventListener("click", () => {
    STATE.filterPlt = "";
    STATE.filterSect = "";
    saveFilter();
    render();
  });
}

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
  loadFilter();
  initFilterControls();
  render();
  autoSyncOnLaunch();
})();
