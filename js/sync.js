// Sync tab UI and all sheet-sync actions (pull / push / ping).
// Also owns the sidebar sync indicator and the launch-time auto-sync.

function renderSync(el) {
  const authed = !!STATE.authToken;
  const authStatusHtml = authed
    ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
         <span style="color:var(--green);font-weight:600">✓ Authenticated</span>
         <span class="mono" style="font-size:10px;color:var(--dim)">${STATE.authToken.slice(0, 8)}…</span>
         <button class="btn btn-danger" onclick="signOut()" style="margin-left:auto">Sign Out</button>
       </div>`
    : `<div style="background:#F8514922;border:1px solid #F8514944;border-radius:6px;padding:10px;margin-bottom:12px;color:var(--red);font-size:12px">
         <strong>Not authenticated.</strong> Ask your admin for an invite link, then open it on this device.
       </div>`;

  el.innerHTML = `
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Sync &amp; Import / Export</h2>
    <div class="sync-panel">
      <h3 style="font-size:14px;color:var(--accent);margin-bottom:12px">🔐 Access</h3>
      ${authStatusHtml}
      <h3 style="font-size:14px;color:var(--accent);margin:16px 0 12px">🔄 Sheet Sync</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-primary" onclick="doPull()" id="pull-btn" ${authed ? "" : "disabled"}>⬇ Pull from Sheet</button>
        <button class="btn btn-success" onclick="doPushAll()" id="push-btn" ${authed ? "" : "disabled"}>⬆ Push All to Sheet</button>
        <button class="btn" onclick="doPing()">🏓 Test Connection</button>
      </div>
      <div id="sync-log" class="sync-log card" style="padding:10px"></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3 style="color:var(--green)">📥 Import</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="btn" style="cursor:pointer;text-align:center">Full Backup (JSON)<input type="file" accept=".json" onchange="importBackup(this)" style="display:none"></label>
        </div>
      </div>
      <div class="card">
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
    <div class="card" style="margin-top:16px">
      <h3 style="color:var(--pink)">📊 Email Fitness Reports</h3>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 12px;line-height:1.55">
        Send each recruit a personalized HTML email with their Polar fitness trends, conduct attendance, and an encouragement note tailored to their data. Respects the topbar scope filter. Recruits never see anyone else's data.
      </p>
      <button class="btn btn-primary" onclick="openFitnessReportModal()" ${authed ? "" : "disabled"}>📨 Open Report Sender →</button>
    </div>`;
}

function syncLog(msg, color) {
  const el = document.getElementById("sync-log");
  if (!el) return;
  const t = new Date().toLocaleTimeString();
  el.innerHTML = `<div style="color:${color || 'var(--muted)'}">${t} — ${msg}</div>` + el.innerHTML;
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

function signOut() {
  if (!confirm("Sign out from this device? You'll need a new invite link from your admin to access the sheet again.")) return;
  setAuthToken("");
  syncLog("Signed out — auth token cleared", "var(--orange)");
  setSyncIndicator("● Not authenticated", "var(--red)");
  render();
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
