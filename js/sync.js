// Sync tab UI and all sheet-sync actions (pull / push / ping).
// Also owns the sidebar sync indicator and the launch-time auto-sync.

function renderSync(el) {
  const authed = !!STATE.authToken;
  const who = (STATE.personId && typeof displayPersonLabel === "function") ? displayPersonLabel(STATE.personId) : "";
  const whoLabel = (who && who !== STATE.personId) ? who : "";

  const authStatusHtml = authed
    ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
         <span style="color:var(--green);font-weight:600">✓ Signed in</span>
         <span style="font-size:12px;color:var(--muted)">${whoLabel ? escapeHTML(whoLabel) + " · " : ""}${escapeHTML(STATE.email || "")}</span>
         <span class="badge badge-accent">${escapeHTML(STATE.role || "?")}</span>
         <span style="margin-left:auto;display:flex;gap:8px">
           <button class="btn" onclick="openChangePasswordForm()">Change Password</button>
           <button class="btn btn-danger" onclick="signOut()">Sign Out</button>
         </span>
       </div>`
    : `<div style="background:#F8514922;border:1px solid #F8514944;border-radius:6px;padding:10px;margin-bottom:12px;color:var(--red);font-size:12px">
         <strong>Not signed in.</strong> Use the login screen to sign in with your account.
       </div>`;

  el.innerHTML = `
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Account · Sync · Import / Export</h2>
    <div class="readonly-banner">👁 Read-only access — you can view and export, but not make changes. Ask an admin if you need edit access.</div>
    <div class="sync-panel">
      <h3 style="font-size:14px;color:var(--accent);margin-bottom:12px">🔐 Account</h3>
      ${authStatusHtml}
      <h3 style="font-size:14px;color:var(--accent);margin:16px 0 12px">🔄 Sheet Sync</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-primary" onclick="doPull()" id="pull-btn" ${authed ? "" : "disabled"}>⬇ Pull from Sheet</button>
        <button class="btn btn-success write-only" onclick="doPushAll()" id="push-btn" ${authed ? "" : "disabled"}>⬆ Push All to Sheet</button>
        <button class="btn" onclick="doPing()">🏓 Test Connection</button>
      </div>
      <div id="sync-log" class="sync-log card" style="padding:10px"></div>
    </div>
    <div class="grid-2">
      <div class="card write-only">
        <h3 style="color:var(--green)">📥 Import</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="btn" style="cursor:pointer;text-align:center">Full Backup (JSON)<input type="file" accept=".json" onchange="importBackup(this)" style="display:none"></label>
        </div>
      </div>
      <div class="card write-only">
        <h3 style="color:var(--accent)">📤 Export</h3>
        <button class="btn" onclick="exportJSON({roster:STATE.roster,medical:STATE.medical,attendance:STATE.attendance,ippt:STATE.ippt,rm:STATE.rm,soc:STATE.soc,polar:STATE.polar,conductDetail:STATE.conductDetail,appointments:STATE.appointments,leave:STATE.leave,msk:STATE.msk},'cougar_backup.json')" style="margin-bottom:8px;width:100%">Full Backup (JSON)</button>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn" onclick="exportCSV(STATE.roster,'roster.csv')" style="font-size:10px">Roster</button>
          <button class="btn" onclick="exportCSV(STATE.medical,'medical.csv')" style="font-size:10px">Medical</button>
          <button class="btn" onclick="exportCSV(STATE.attendance,'attendance.csv')" style="font-size:10px">Attend.</button>
          <button class="btn" onclick="exportCSV(STATE.ippt,'ippt.csv')" style="font-size:10px">IPPT</button>
          <button class="btn" onclick="exportCSV(STATE.rm,'rm.csv')" style="font-size:10px">RM</button>
          <button class="btn" onclick="exportCSV(STATE.soc,'soc.csv')" style="font-size:10px">SOC</button>
          <button class="btn" onclick="exportCSV(STATE.polar,'polar.csv')" style="font-size:10px">Polar</button>
          <button class="btn" onclick="exportCSV(STATE.conductDetail,'conduct_detail.csv')" style="font-size:10px">Detail</button>
        </div>
      </div>
    </div>
    <div class="card write-only" style="margin-top:16px">
      <h3 style="color:var(--pink)">📊 Email Fitness Reports</h3>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 12px;line-height:1.55">
        Send each recruit a personalized HTML email with their Polar fitness trends, conduct attendance, and an encouragement note tailored to their data. Respects the topbar scope filter. Recruits never see anyone else's data.
      </p>
      <button class="btn btn-primary" onclick="openFitnessReportModal()" ${authed ? "" : "disabled"}>📨 Open Report Sender →</button>
    </div>
    <div class="card admin-only" style="margin-top:16px">
      <h3 style="color:var(--purple)">📊 Statistics (admin)</h3>
      <p style="font-size:11px;color:var(--muted);margin:6px 0 10px;line-height:1.5">
        One row per person, respecting the topbar scope. Opens in Excel / Google Sheets.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="exportSickStats()">📥 Report-Sick Stats (CSV)</button>
        <button class="btn" onclick="exportHAStats()">📥 HA Stats (CSV)</button>
      </div>
    </div>
    <div class="admin-only" id="admin-panel" style="margin-top:16px"></div>`;

  // Admin panel renders into #admin-panel and lazy-loads accounts/sessions.
  if (isAdminRole()) renderAdminPanel();
}

// ── Admin panel (accounts · sessions · audit log) ────────
// Visible only to admins (also CSS-gated via .admin-only). Account + session
// lists are fetched on demand; the audit log arrives with the admin pull.
let _adminLoaded = false;
let _auditLimit = 50;

function renderAdminPanel() {
  const host = document.getElementById("admin-panel");
  if (!host) return;

  const accountsRows = (STATE.accounts || []).map(a => `
    <tr>
      <td>${escapeHTML(a.email || "")}</td>
      <td><span class="badge badge-accent">${escapeHTML(a.role || "")}</span></td>
      <td class="mono" style="font-size:10px">${escapeHTML(a.personId || "—")}</td>
      <td style="font-size:10px;color:var(--muted)">${escapeHTML(a.addedBy || "")}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn" style="font-size:10px" onclick="openResetPasswordForm('${encodeURIComponent(a.email)}')">Reset PW</button>
        <button class="btn btn-danger" style="font-size:10px" onclick="doRemoveAccount('${encodeURIComponent(a.email)}')">Remove</button>
      </td>
    </tr>`).join("");

  const tokenRows = (STATE.tokens || []).map(t => `
    <tr>
      <td>${escapeHTML(t.email || "")}</td>
      <td><span class="badge badge-accent">${escapeHTML(t.role || "")}</span></td>
      <td class="mono" style="font-size:10px">${escapeHTML(t.tokenPrefix || "")}…</td>
      <td style="font-size:10px;color:var(--muted)">${t.issuedAt ? new Date(t.issuedAt).toLocaleString() : ""}${t.expired ? ' <span style="color:var(--red)">expired</span>' : ""}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-danger" style="font-size:10px" onclick="doRevokeToken('${t.token}','${encodeURIComponent(t.email || "")}')">Revoke</button>
      </td>
    </tr>`).join("");

  const audit = (STATE.auditLog || []).slice().reverse();   // newest first
  const auditRows = audit.slice(0, _auditLimit).map(r => `
    <tr>
      <td style="font-size:10px;color:var(--muted);white-space:nowrap">${r.timestamp ? new Date(r.timestamp).toLocaleString() : ""}</td>
      <td style="font-size:11px">${escapeHTML(r.email || "")}</td>
      <td><span class="badge" style="font-size:9px">${escapeHTML(r.role || "")}</span></td>
      <td class="mono" style="font-size:10px">${escapeHTML(r.action || "")}</td>
      <td style="font-size:11px">${escapeHTML(r.target || "")}</td>
      <td style="font-size:11px;color:var(--muted)">${escapeHTML(r.detail || "")}</td>
    </tr>`).join("");

  host.innerHTML = `
    <h3 style="font-size:14px;color:var(--purple);margin-bottom:10px">🛡 Admin</h3>

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;margin-bottom:10px">
        <h4 style="font-size:13px">Accounts (${(STATE.accounts || []).length})</h4>
        <span style="margin-left:auto;display:flex;gap:8px">
          <button class="btn" onclick="refreshAdminData()">↻ Refresh</button>
          <button class="btn btn-primary" onclick="openAddAccountForm()">+ Add Account</button>
        </span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Email</th><th>Role</th><th>PersonID</th><th>Added by</th><th></th></tr></thead>
        <tbody>${accountsRows || `<tr><td colspan="5" style="color:var(--dim)">No accounts loaded — click Refresh.</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;margin-bottom:10px">
        <h4 style="font-size:13px">Active sessions (${(STATE.tokens || []).length})</h4>
        <button class="btn btn-danger" style="margin-left:auto" onclick="doRevokeAllTokens()">Revoke ALL sessions</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Email</th><th>Role</th><th>Token</th><th>Issued</th><th></th></tr></thead>
        <tbody>${tokenRows || `<tr><td colspan="5" style="color:var(--dim)">No sessions loaded — click Refresh.</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h4 style="font-size:13px;margin-bottom:10px">Audit log (${(STATE.auditLog || []).length} entries)</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Email</th><th>Role</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>${auditRows || `<tr><td colspan="6" style="color:var(--dim)">No audit entries.</td></tr>`}</tbody>
      </table></div>
      ${audit.length > _auditLimit ? `<button class="btn" style="margin-top:8px" onclick="showMoreAudit()">Show more (${audit.length - _auditLimit} hidden)</button>` : ""}
    </div>`;

  // Lazy-load accounts + sessions the first time the admin opens this tab.
  if (!_adminLoaded) { _adminLoaded = true; refreshAdminData(); }
}

async function refreshAdminData() {
  try {
    const [acc, tok] = await Promise.all([API.listAccounts(), API.listTokens()]);
    if (acc && acc.accounts) STATE.accounts = acc.accounts;
    if (tok && tok.tokens) STATE.tokens = tok.tokens;
    renderAdminPanel();
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    syncLog(`Admin data load failed: ${e.message}`, "var(--red)");
  }
}

function showMoreAudit() { _auditLimit += 50; renderAdminPanel(); }

function syncLog(msg, color) {
  const el = document.getElementById("sync-log");
  if (!el) return;
  const t = new Date().toLocaleTimeString();
  el.innerHTML = `<div style="color:${color || 'var(--muted)'}">${t} — ${escapeHTML(msg)}</div>` + el.innerHTML;
}

function setSyncIndicator(text, color) {
  const el = document.getElementById("sync-indicator");
  if (!el) return;
  el.textContent = text;
  el.style.color = color || "";
  // Reset interactivity — refreshSyncIndicator re-applies these for the
  // dirty state. setSyncIndicator alone always renders a passive label.
  el.style.cursor = "";
  el.style.textDecoration = "";
  el.onclick = null;
  el.title = "";
}

// State-aware indicator refresh. Decides the displayed state based on the
// auth/sync/dirty status, and makes the indicator clickable when there are
// dirty tabs that need retrying. Called after every autoSync attempt.
let _lastSyncedAt = null;
function refreshSyncIndicator() {
  const el = document.getElementById("sync-indicator");
  if (!el) return;
  if (!STATE.authToken) {
    setSyncIndicator("● Not authenticated", "var(--red)");
    return;
  }
  if (_pullInFlight || _activePushCount > 0) {
    setSyncIndicator("● Syncing…", "var(--orange)");
    return;
  }
  const dirtyCount = (STATE.dirty && STATE.dirty.size) || 0;
  if (dirtyCount > 0) {
    el.textContent = `⚠ ${dirtyCount} tab${dirtyCount === 1 ? "" : "s"} need retry · Retry now`;
    el.style.color = "var(--red)";
    el.style.cursor = "pointer";
    el.style.textDecoration = "underline";
    el.title = `Unsynced changes in: ${[...STATE.dirty].join(", ")}. Click to retry all.`;
    el.onclick = retryAllDirty;
    return;
  }
  const stamp = _lastSyncedAt ? new Date(_lastSyncedAt).toLocaleTimeString() : new Date().toLocaleTimeString();
  setSyncIndicator(`● Synced ${stamp}`, "var(--green)");
}

// ── Dirty-tab tracking ────────────────────────────────────
function markDirty(tabName) {
  if (!tabName) return;
  STATE.dirty = STATE.dirty || new Set();
  STATE.dirty.add(tabName);
  saveDirty();
}
function clearDirty(tabName) {
  if (!STATE.dirty) return;
  STATE.dirty.delete(tabName);
  saveDirty();
}

// ── Read-only (viewer) write rejection ───────────────────
// Surfaced when a viewer's edit is blocked at the autoSync chokepoint. Throttled
// so a bulk action (which fires several autoSync calls) shows a single alert.
let _readOnlyNoticeAt = 0;
function notifyReadOnly() {
  syncLog("Read-only account — change not saved.", "var(--orange)");
  setSyncIndicator("● Read-only — changes not saved", "var(--orange)");
  const now = Date.now();
  if (now - _readOnlyNoticeAt > 1500) {
    _readOnlyNoticeAt = now;
    // Defer so the in-progress render/closeModal finishes before the alert.
    setTimeout(() => alert("Your account is read-only — that change was not saved."), 0);
  }
}

// Debounced re-pull that discards a viewer's optimistic local edit (the form
// mutates STATE + saveLocal() before autoSync runs). One pull covers a burst of
// blocked writes from a single submit. Safe from recursion: pullAll never calls
// autoSync.
let _viewerRevertTimer = null;
function scheduleViewerRevert() {
  if (_viewerRevertTimer) clearTimeout(_viewerRevertTimer);
  _viewerRevertTimer = setTimeout(() => {
    _viewerRevertTimer = null;
    if (typeof doPull === "function") doPull();
  }, 400);
}

// ── Pull/push mutex + per-tab in-flight queue ────────────
// _pullInFlight blocks all writes during a launch/refresh pull so we never
// push against STATE that's about to be wiped by an arriving pull.
// _inFlight maps tabName → the Promise of the push currently running for
// that tab. _coalesced[tab] = true means "another push is queued; when the
// current finishes, fire one more pushTab(latest STATE)" — coalescing
// rapid-fire edits into one follow-up push.
let _pullInFlight = false;
const _inFlight = new Map();
const _coalesced = new Map();
let _activePushCount = 0;
// Awaitable promise that resolves when the current pull finishes. enqueueWrite
// awaits this before starting so writes never operate on stale STATE.
let _pullPromise = Promise.resolve();
function setPullInFlight(promise) {
  _pullInFlight = true;
  _pullPromise = Promise.resolve(promise).finally(() => { _pullInFlight = false; refreshSyncIndicator(); });
}

async function enqueueWrite(tabName, runner) {
  // Wait for any in-flight pull to land — we never want to push stale STATE.
  if (_pullInFlight) {
    try { await _pullPromise; } catch (e) { /* pull failure handled elsewhere */ }
  }
  // Coalesce: if a push is already running for this tab, mark "needs another"
  // and piggy-back on the existing promise. At flush time we re-fire with
  // the LATEST STATE — never a captured snapshot — so the final push always
  // reflects the user's current edits.
  if (_inFlight.has(tabName)) {
    _coalesced.set(tabName, true);
    return _inFlight.get(tabName);
  }
  _activePushCount++;
  refreshSyncIndicator();
  const p = (async () => {
    try {
      await runner();
      clearDirty(tabName);
    } catch (e) {
      markDirty(tabName);
      syncLog(`Auto-push ${tabName} failed: ${e.message || e}`, "var(--red)");
    } finally {
      _inFlight.delete(tabName);
      _activePushCount = Math.max(0, _activePushCount - 1);
      _lastSyncedAt = Date.now();
      refreshSyncIndicator();
      // Flush coalesced — re-push current STATE for this tab. Uses replace
      // because we can't recover the granular ops that were coalesced;
      // pushTab guarantees the final state matches local STATE.
      if (_coalesced.get(tabName)) {
        _coalesced.delete(tabName);
        const arrKey = TAB_TO_STATE[tabName];
        if (arrKey && STATE[arrKey] != null) {
          autoSync(tabName, { type: "replace", data: STATE[arrKey] });
        }
      }
    }
  })();
  _inFlight.set(tabName, p);
  return p;
}

// Single chokepoint for every write. mode dispatches to the right primitive:
//   { type: "append",     row  } → API.appendRow
//   { type: "appendMany", rows } → API.post appendMany
//   { type: "upsert",     row  } → API.upsertRow (id-based, cross-device safe)
//   { type: "delete",     id   } → API.deleteRowById
//   { type: "replace",    data } → API.pushTab (full overwrite, bulk only)
//
// CRITICAL: the Apps Script backend returns errors as `{error: "..."}` in the
// response body — it does NOT raise an HTTP error. API.* wrappers therefore
// resolve with the error object instead of throwing. We MUST inspect the
// response here and throw on `{error}`, otherwise enqueueWrite's try/catch
// treats it as success and clears the dirty marker — silent data loss.
async function autoSync(tabName, mode) {
  // ── Read-only guard (viewers) ─────────────────────────
  // Block BEFORE enqueueWrite so no dirty marker is ever set. A dirty tab is the
  // ONLY thing that later prompts a commander to push (launch restore prompt /
  // sidebar retry) — so refusing to mark dirty is what prevents a viewer's
  // phantom edit from being accidentally approved. We also scrub any stale marker
  // for this tab and schedule a silent re-pull to discard the optimistic local
  // edit the form already applied, so phantom data doesn't linger in the UI/cache.
  if (typeof canWrite === "function" && !canWrite()) {
    clearDirty(tabName);
    notifyReadOnly();
    scheduleViewerRevert();
    return { ok: false, readOnly: true };
  }
  return enqueueWrite(tabName, async () => {
    if (!STATE.authToken) throw new Error("Not authenticated");
    let res;
    if (mode.type === "append")          res = await API.appendRow(tabName, mode.row);
    else if (mode.type === "appendMany") res = await API.post({ action: "appendMany", tab: tabName, rows: mode.rows });
    else if (mode.type === "upsert")     res = await API.upsertRow(tabName, mode.row);
    else if (mode.type === "delete")     res = await API.deleteRowById(tabName, mode.id);
    else if (mode.type === "replace")    res = await API.pushTab(tabName, mode.data);
    else throw new Error(`Unknown autoSync mode: ${mode.type}`);
    if (res && res.error) throw new Error(res.error);
    return res;
  });
}

// Retry every dirty tab via a full pushTab. Used by the sidebar warning
// click and by the launch-time dirty-restore prompt.
async function retryAllDirty() {
  if (!STATE.dirty || STATE.dirty.size === 0) return;
  const tabs = [...STATE.dirty];
  for (const tab of tabs) {
    const arrKey = TAB_TO_STATE[tab];
    if (!arrKey || !STATE[arrKey]) continue;
    await autoSync(tab, { type: "replace", data: STATE[arrKey] });
  }
}

// Pre-write staleness check used by bulk-replace operations. Returns true
// when it's safe to proceed (user confirmed or counts match); false to abort.
async function confirmStaleness(tabName, localCount) {
  try {
    const res = await API.rowCount(tabName);
    if (!res || res.error) return true;  // can't check → don't block
    const sheetCount = res.dataRows ?? 0;
    if (sheetCount <= localCount) return true;
    const diff = sheetCount - localCount;
    return confirm(
      `${tabName} sheet has ${sheetCount} rows; you have ${localCount} locally (${diff} more on the sheet).\n\n` +
      `Pushing now will overwrite the newer rows on the sheet.\n\nPull first?  Cancel = pull first.  OK = push anyway.`
    );
  } catch { return true; }
}

async function signOut() {
  if (!confirm("Sign out from this device? You'll need to log in again with your account.")) return;
  // Best-effort server-side token invalidation, then clear the local session and
  // return to the login screen regardless of the network result.
  try { await API.logout(); } catch (e) { /* clear locally anyway */ }
  _adminLoaded = false;
  clearSession();
  if (typeof applyRoleUI === "function") applyRoleUI();
  showLogin();
  setSyncIndicator("● Not authenticated", "var(--red)");
}

async function doPing() {
  try {
    syncLog("Pinging...");
    const res = await API.get("ping");
    if (res.ok) syncLog(`Connected! Tabs: ${res.sheets?.join(", ")}`, "var(--green)");
    else syncLog(`Error: ${res.error}`, "var(--red)");
  } catch (e) { syncLog(`Failed: ${e.message}`, "var(--red)"); }
}

async function doPull() {
  try {
    syncLog("Pulling all data...");
    document.getElementById("pull-btn").disabled = true;
    const pullPromise = API.pullAll();
    setPullInFlight(pullPromise);
    const data = await pullPromise;
    syncLog(`Pull complete! Sheet: ${data.sheetName}`, "var(--green)");
    _lastSyncedAt = Date.now();
    refreshSyncIndicator();
    render();
  } catch (e) {
    syncLog(`Pull failed: ${e.message}`, "var(--red)");
    if (e.name === "AuthError") setSyncIndicator("● Not authenticated", "var(--red)");
  } finally { const b = document.getElementById("pull-btn"); if (b) b.disabled = false; }
}

async function doPushAll() {
  const tabs = [
    ["Roster", STATE.roster], ["Medical", STATE.medical], ["Attendance", STATE.attendance],
    ["IPPT", STATE.ippt], ["RouteMarch", STATE.rm], ["SOC", STATE.soc], ["PolarFlow", STATE.polar],
    ["ConductDetail", STATE.conductDetail],
    ["Appointments", STATE.appointments],
    ["Leave", STATE.leave],
    ["MSK", STATE.msk]
  ];
  document.getElementById("push-btn").disabled = true;
  for (const [name, data] of tabs) {
    if (data.length) {
      try { await pushTab(name, data); } catch (e) { syncLog(`${name} failed: ${e.message}`, "var(--red)"); }
    }
  }
  const b = document.getElementById("push-btn"); if (b) b.disabled = false;
}

async function pushTab(tabName, data) {
  // Per-tab manual "Re-push all" button. Bulk-replace operations check
  // staleness first — if another device added rows since we last pulled,
  // confirm before clobbering. Routes through autoSync so the indicator,
  // dirty-tracking, and serialization queue all stay consistent with the
  // automatic write path.
  const localCount = Array.isArray(data) ? data.length : 0;
  const proceed = await confirmStaleness(tabName, localCount);
  if (!proceed) {
    syncLog(`${tabName}: push cancelled — pull first to see latest rows`, "var(--orange)");
    return;
  }
  try {
    syncLog(`Pushing ${tabName} (${localCount} rows)...`);
    await autoSync(tabName, { type: "replace", data });
    syncLog(`${tabName}: re-push complete ✓`, "var(--green)");
  } catch (e) { syncLog(`${tabName}: ${e.message}`, "var(--red)"); }
}

async function autoSyncOnLaunch() {
  if (!STATE.authToken) {
    setSyncIndicator("● Not authenticated", "var(--red)");
    return;
  }
  setSyncIndicator("● Syncing…", "var(--orange)");
  try {
    const pullPromise = API.pullAll();
    setPullInFlight(pullPromise);
    const data = await pullPromise;
    _lastSyncedAt = Date.now();
    refreshSyncIndicator();
    syncLog(`Auto-sync on launch: pulled from ${data.sheetName}`, "var(--green)");
    render();
  } catch (e) {
    if (e.name === "AuthError") {
      setSyncIndicator("● Not authenticated", "var(--red)");
      syncLog(`Auth rejected — your invite may have been revoked. Ask admin for a new link.`, "var(--red)");
    } else {
      setSyncIndicator("● Sync failed", "var(--red)");
      syncLog(`Auto-sync failed: ${e.message}`, "var(--red)");
    }
  }
}
