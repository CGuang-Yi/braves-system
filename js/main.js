// Bootstrap: handle invite redemption from ?token=…, wire up nav + search,
// load local cache, render, then auto-sync.

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    STATE.nav = btn.dataset.nav;
    render();
    // On mobile, navigating to a new tab should auto-close the slide-out menu
    // so the user isn't left staring at the sidebar overlay.
    closeMobileSidebar();
  });
});

// ── Mobile sidebar toggle ────────────────────────────────
function openMobileSidebar() {
  document.getElementById("sidebar")?.classList.add("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("hidden");
}
function closeMobileSidebar() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.add("hidden");
}
document.getElementById("mobile-nav-toggle")?.addEventListener("click", openMobileSidebar);
document.getElementById("sidebar-backdrop")?.addEventListener("click", closeMobileSidebar);

document.getElementById("search-input").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  const res = document.getElementById("search-results");
  if (!q) { res.innerHTML = ""; return; }
  // Search respects the global scope filter so results don't show recruits the
  // user has explicitly scoped out of view.
  const matches = filteredRoster().filter(r => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)).slice(0, 5);
  res.innerHTML = matches.map(r => `<button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="openPerson('${r.id}')">${r.id}</button>`).join("");
});

// Enter in the topbar search opens the current top match (same scope-filtered
// substring the input handler renders). preventDefault so Enter never submits an
// ambient form or reloads.
document.getElementById("search-input").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const q = e.target.value.toLowerCase();
  if (!q) return;
  const match = filteredRoster().find(r => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  if (match) openPerson(match.id);
});

// ── Global platoon/section filter ────────────────────────

function refreshFilterUI() {
  const pltSel = document.getElementById("filter-plt");
  const sectSel = document.getElementById("filter-sect");
  const clearBtn = document.getElementById("filter-clear");
  if (!pltSel || !sectSel) return;

  // Braves scope (§11): platoons are CODES ("PLT1"/"HQ") from activePlatoons()
  // (which reads the Platoons tab, falling back to roster-derived codes).
  const platoons = activePlatoons();
  pltSel.innerHTML = `<option value="">All plts</option>` + platoons.map(p => `<option value="${escapeHTML(p.code)}" ${p.code === String(STATE.filterPlt) ? "selected" : ""}>${escapeHTML(p.displayName || p.code)}</option>`).join("");

  // Sections depend on platoon selection — "section 2" is ambiguous across
  // platoons, so the section dropdown is disabled until a platoon is picked.
  // Sections come from sectionsInPlatoon() (variable count; "Command" first).
  if (STATE.filterPlt) {
    const sections = sectionsInPlatoon(STATE.filterPlt);
    sectSel.disabled = false;
    sectSel.innerHTML = `<option value="">All sects</option>` + sections.map(s => `<option value="${escapeHTML(s)}" ${s === String(STATE.filterSect) ? "selected" : ""}>${s === "Command" ? "Command" : "Sect " + escapeHTML(s)}</option>`).join("");
  } else {
    sectSel.disabled = true;
    sectSel.innerHTML = `<option value="">All sects</option>`;
  }

  pltSel.classList.toggle("active", !!STATE.filterPlt);
  sectSel.classList.toggle("active", !!STATE.filterSect);

  // Reflect the active role on the segmented control — restoring it on reload
  // from STATE.filterRole, which loadFilter() rehydrated.
  document.querySelectorAll("#filter-role-group .role-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.role === (STATE.filterRole || ""));
  });

  if (clearBtn) clearBtn.style.display = isFilterActive() ? "" : "none";

  // Mobile filter toggle button reflects the current scope so the user can
  // see at a glance what's active without opening the popover.
  const toggleBtn = document.getElementById("mobile-filter-toggle");
  if (toggleBtn) {
    const label = isFilterActive() ? filterLabel() : "All";
    toggleBtn.textContent = label;
    toggleBtn.classList.toggle("active", isFilterActive());
  }
}

function initFilterControls() {
  const pltSel = document.getElementById("filter-plt");
  const sectSel = document.getElementById("filter-sect");
  const clearBtn = document.getElementById("filter-clear");
  const panel = document.getElementById("topbar-filters");
  const toggleBtn = document.getElementById("mobile-filter-toggle");

  pltSel.addEventListener("change", () => {
    STATE.filterPlt = pltSel.value;
    // Drop section if it doesn't exist in the new platoon (or platoon cleared).
    if (!STATE.filterPlt) STATE.filterSect = "";
    else {
      const valid = STATE.roster.some(r => personPlatoon(r) === String(STATE.filterPlt) && personSection(r) === String(STATE.filterSect));
      if (!valid) STATE.filterSect = "";
    }
    saveFilter();
    render();
  });

  sectSel.addEventListener("change", () => {
    STATE.filterSect = sectSel.value;
    saveFilter();
    render();
    // On mobile, close the popover after picking a section — the user is
    // done choosing scope.
    panel?.classList.remove("open");
  });

  clearBtn.addEventListener("click", () => {
    STATE.filterPlt = "";
    STATE.filterSect = "";
    STATE.filterRole = "";
    saveFilter();
    render();
    panel?.classList.remove("open");
  });

  // Role segmented control — All / Cmdrs / Recs. Persists alongside the
  // platoon/section filter so a user can hop between recruit-only and
  // commander-only views without losing their platoon scope.
  document.querySelectorAll("#filter-role-group .role-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.filterRole = btn.dataset.role || "";
      saveFilter();
      render();
    });
  });

  // Mobile: toggle the scope popover. Outside-tap also closes it.
  toggleBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    panel?.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!panel?.classList.contains("open")) return;
    if (panel.contains(e.target) || toggleBtn?.contains(e.target)) return;
    panel.classList.remove("open");
  });
}

// ── Dashboard "Generate Report" dropdown ─────────────────
// The menu is re-rendered every dashboard repaint, so we attach the global
// outside-click listener once at module load. toggle/close fns just flip
// the `.hidden` class on the menu div.
function toggleReportMenu(e) {
  e?.stopPropagation();
  document.getElementById("report-menu")?.classList.toggle("hidden");
}
function closeReportMenu() {
  document.getElementById("report-menu")?.classList.add("hidden");
}
document.addEventListener("click", (e) => {
  const menu = document.getElementById("report-menu");
  if (!menu || menu.classList.contains("hidden")) return;
  // Close on outside tap; the wrapper contains both the toggle button and
  // the menu, so checking the wrapper covers both.
  const wrapper = menu.closest(".dropdown-wrapper");
  if (wrapper && !wrapper.contains(e.target)) menu.classList.add("hidden");
});

// ── Login screen + session control ───────────────────────

function showLogin() { document.getElementById("login-overlay")?.classList.remove("hidden"); }
function showApp() { document.getElementById("login-overlay")?.classList.add("hidden"); }

// Reflect the signed-in account on the chrome: a body class drives the soft
// read-only styling for viewers / admin-only visibility, and the sidebar footer
// shows who's logged in (name when the personId links to a Roster row).
function applyRoleUI() {
  document.body.classList.toggle("role-viewer", STATE.role === "viewer");
  document.body.classList.toggle("role-admin", STATE.role === "admin");
  // A viewer can never legitimately have unsynced edits. Scrub any stale dirty
  // markers (e.g. left by a write attempt before this guard existed, or by a
  // commander who previously used this device) so the launch "push now?" prompt
  // never offers a viewer's phantom edit for approval.
  if (STATE.role === "viewer" && STATE.dirty && STATE.dirty.size) {
    STATE.dirty.clear();
    if (typeof saveDirty === "function") saveDirty();
  }
  const el = document.getElementById("account-identity");
  if (el) {
    const who = (STATE.personId && typeof displayPersonLabel === "function") ? displayPersonLabel(STATE.personId) : "";
    const name = (who && who !== STATE.personId) ? who + " · " : "";
    el.textContent = STATE.email ? `${name}${STATE.email} (${STATE.role})` : "";
  }
}

// Called whenever any API call reports the session is gone (401 / session_expired):
// drop the local session and return to the login screen.
function handleAuthFailure() {
  clearSession();
  applyRoleUI();
  showLogin();
  setSyncIndicator("● Not authenticated", "var(--red)");
}

function initLoginForm() {
  document.getElementById("login-form")?.addEventListener("submit", doLogin);
}

async function doLogin(e) {
  e?.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-submit");
  errEl.textContent = "";
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const res = await API.login(email, password);
    if (res && res.ok && res.authToken) {
      setSession(res.authToken, res.role, res.personId, res.email);
      showApp();
      await pullAndRender();
    } else {
      errEl.textContent = (res && res.error) || "Login failed.";
    }
  } catch (err) {
    errEl.textContent = "Network error: " + err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Sign In";
  }
}

// Shared pull-then-render path used by both launch and post-login. Resolves the
// role UI first (so displayPersonLabel works once the roster lands) and surfaces
// auth failures to the login screen.
async function pullAndRender() {
  applyRoleUI();
  setSyncIndicator("● Loading data…", "var(--orange)");
  try {
    const pullPromise = (typeof timed === "function")
      ? timed("pull", "pull ALL (launch)", () => API.pullAll(), true)
      : API.pullAll();
    if (typeof setPullInFlight === "function") setPullInFlight(pullPromise);
    const data = await pullPromise;
    if (typeof refreshSyncIndicator === "function") refreshSyncIndicator();
    syncLog(`Auto-sync on launch: pulled from ${data.sheetName}`, "var(--green)");
    applyRoleUI();   // re-run now the roster is loaded → name resolves
    render();
    maybeRunConductMigration();
    maybeRestoreDirty();
    // Keep this tab fresh: poll the cheap revCheck endpoint (~20s while visible +
    // on focus/visibility/online) and pull only changed tabs. STATE.rev was just
    // baselined by the pull above. Guarded so login + bootstrap don't double-wire.
    if (STATE.authToken && typeof initAutoRefresh === "function") initAutoRefresh();
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); }
    else {
      setSyncIndicator("● Sync failed", "var(--red)");
      syncLog(`Auto-sync failed: ${e.message}`, "var(--red)");
      render();
    }
  }
}

(async function bootstrap() {
  loadLocal();
  loadFilter();
  initFilterControls();
  initLoginForm();

  // No token on this device → straight to login (synchronous, before any await,
  // so there's no flash of the app for an unauthenticated user).
  if (!STATE.authToken) { showLogin(); return; }

  // Have a token — try to use it. A 401/expired response bounces to login.
  showApp();
  await pullAndRender();
})();

// On launch, if previous session(s) left dirty tabs (pushes failed offline
// or the tab closed before a retry), offer to retry now. Runs after the
// initial render so the user sees their data before being asked.
function maybeRestoreDirty() {
  if (!STATE.dirty || STATE.dirty.size === 0 || !STATE.authToken) {
    if (typeof refreshSyncIndicator === "function") refreshSyncIndicator();
    return;
  }
  // Wait a moment so the modal stack from migration etc. has cleared.
  setTimeout(() => {
    const tabs = [...STATE.dirty];
    const ok = confirm(
      `${tabs.length} tab${tabs.length === 1 ? " has" : "s have"} unpushed changes from your last session:\n  • ${tabs.join("\n  • ")}\n\nPush now?`
    );
    if (ok && typeof retryAllDirty === "function") retryAllDirty();
    else if (typeof refreshSyncIndicator === "function") refreshSyncIndicator();
  }, 600);
}
