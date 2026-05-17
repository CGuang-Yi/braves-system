// Sync tab UI and all sheet-sync actions (pull / push / ping).
// Also owns the sidebar sync indicator and the launch-time auto-sync.

function renderSync(el) {
  el.innerHTML = `
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Sync &amp; Import / Export</h2>
    <div class="sync-panel">
      <h3 style="font-size:14px;color:var(--accent);margin-bottom:12px">🔗 Google Sheets Connection</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Paste your Google Apps Script Web App URL below. See README for setup instructions.</p>
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:12px">
        <div class="form-group" style="flex:1"><label>Apps Script URL</label><input id="api-url-input" value="${STATE.apiUrl}" placeholder="https://script.google.com/macros/s/.../exec" style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;width:100%;outline:none"></div>
        <button class="btn" onclick="saveApiUrl()">Save</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-primary" onclick="doPull()" id="pull-btn">⬇ Pull from Sheet</button>
        <button class="btn btn-success" onclick="doPushAll()" id="push-btn">⬆ Push All to Sheet</button>
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
        <button class="btn" onclick="exportJSON({roster:STATE.roster,medical:STATE.medical,attendance:STATE.attendance,ippt:STATE.ippt,rm:STATE.rm,soc:STATE.soc,polar:STATE.polar},'cougar_backup.json')" style="margin-bottom:8px;width:100%">Full Backup (JSON)</button>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn" onclick="exportCSV(STATE.roster,'roster.csv')" style="font-size:10px">Roster</button>
          <button class="btn" onclick="exportCSV(STATE.medical,'medical.csv')" style="font-size:10px">Medical</button>
          <button class="btn" onclick="exportCSV(STATE.attendance,'attendance.csv')" style="font-size:10px">Attend.</button>
          <button class="btn" onclick="exportCSV(STATE.ippt,'ippt.csv')" style="font-size:10px">IPPT</button>
          <button class="btn" onclick="exportCSV(STATE.rm,'rm.csv')" style="font-size:10px">RM</button>
          <button class="btn" onclick="exportCSV(STATE.soc,'soc.csv')" style="font-size:10px">SOC</button>
          <button class="btn" onclick="exportCSV(STATE.polar,'polar.csv')" style="font-size:10px">Polar</button>
        </div>
      </div>
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
  if (el) { el.textContent = text; el.style.color = color || ""; }
}

function saveApiUrl() {
  STATE.apiUrl = document.getElementById("api-url-input").value.trim();
  localStorage.setItem("cougar-api-url", STATE.apiUrl);
  syncLog("API URL saved", "var(--green)");
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
    const data = await API.pullAll();
    syncLog(`Pull complete! Sheet: ${data.sheetName}`, "var(--green)");
    setSyncIndicator(`● Synced ${new Date().toLocaleTimeString()}`, "var(--green)");
    render();
  } catch (e) { syncLog(`Pull failed: ${e.message}`, "var(--red)"); }
  finally { const b = document.getElementById("pull-btn"); if (b) b.disabled = false; }
}

async function doPushAll() {
  const tabs = [
    ["Roster", STATE.roster], ["Medical", STATE.medical], ["Attendance", STATE.attendance],
    ["IPPT", STATE.ippt], ["RouteMarch", STATE.rm], ["SOC", STATE.soc], ["PolarFlow", STATE.polar]
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
  try {
    syncLog(`Pushing ${tabName} (${data.length} rows)...`);
    const res = await API.pushTab(tabName, data);
    if (res.ok) syncLog(`${tabName}: ${res.rowsWritten} rows written ✓`, "var(--green)");
    else syncLog(`${tabName}: ${res.error}`, "var(--red)");
  } catch (e) { syncLog(`${tabName}: ${e.message}`, "var(--red)"); }
}

async function autoSyncOnLaunch() {
  if (!STATE.apiUrl) {
    setSyncIndicator("● Not configured", "var(--dim)");
    return;
  }
  setSyncIndicator("● Syncing…", "var(--orange)");
  try {
    const data = await API.pullAll();
    setSyncIndicator(`● Synced ${new Date().toLocaleTimeString()}`, "var(--green)");
    syncLog(`Auto-sync on launch: pulled from ${data.sheetName}`, "var(--green)");
    render();
  } catch (e) {
    setSyncIndicator("● Sync failed", "var(--red)");
    syncLog(`Auto-sync failed: ${e.message}`, "var(--red)");
  }
}
