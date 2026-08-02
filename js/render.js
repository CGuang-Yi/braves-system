// The render() dispatcher and the Archive tab (list, drawer, compare, CSV export).
//
// Split out of the original monolithic render.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// View layer. render() dispatches to a per-tab function which fills #content.
// Each tab function may also (re)create charts; old chart instances are
// destroyed at the top of render() to avoid Chart.js canvas reuse errors.

function render() {
  Object.values(STATE.charts).forEach(c => c.destroy());
  STATE.charts = {};
  // Drop any deferred-build closures from the previous view so an un-tapped
  // builder can't pin its captured scope or fire against now-stale DOM.
  _deferredBuilders = {};
  // Feature 34: the archive drawer shrinks #main via a <body> class, and the
  // drawer element lives inside #content — which every tab is about to
  // overwrite. Navigating away would otherwise leave the next tab rendered into
  // a narrow column with nothing beside it. renderArchiveList re-applies this
  // in the same synchronous pass if a drawer is genuinely re-opened.
  setArchiveDrawerOpen(false);

  // Chore 7: "rm" was a nav target until the Route March tab was retired. STATE.nav
  // is cached in localStorage, so anyone whose last-viewed tab was Route March comes
  // back after the upgrade with a nav value nothing handles — it would fall to the
  // switch's `default:` and paint an empty content pane with no tab highlighted,
  // which reads as a broken app. Redirect once, before anything renders.
  if (STATE.nav === "rm") STATE.nav = "dashboard";

  // Reset scroll only on an actual tab switch so a long previous tab doesn't
  // leave the next one looking pre-scrolled (and on mobile hiding the topbar).
  // Same-tab re-renders keep scroll position so in-place edits don't bounce the view.
  if (STATE.nav !== _lastRenderedNav) {
    document.getElementById("content")?.scrollTo(0, 0);
    _lastRenderedNav = STATE.nav;
  }

  // Keep filter dropdown options in sync with the current roster — cheap to
  // rebuild a few <option>s and means we don't have to remember to call this
  // from every site that mutates STATE.roster (pull, import, edit).
  if (typeof refreshFilterUI === "function") refreshFilterUI();

  const el = document.getElementById("content");
  // Both topbar numbers come out of ONE bpStrength() call — the same computation
  // that prints TOTAL/CURRENT STRENGTH in the parade state, so "Str" and "Active"
  // can never drift from the message the company actually sends.
  // "Active" = present in camp today. Before item 4a this was read straight off
  // roster.status, which mirrored the person's current medical status; that mirror
  // is gone (roster.status now only marks departures), so we reuse the canonical
  // current-strength count, which derives presence from the Medical / Leave /
  // Appointment layers via bpClassifyPerson (and so respects parade book-ins, the
  // leave In-Camp override and out-of-camp appointments).
  // "Str" is strength.total, NOT filteredRoster().length — the raw row count also
  // counted departures (ORD/Posted Out/…), which the parade state excludes.
  const str = bpStrength(filteredRoster(), todayISO());
  const scopeLabel = isFilterActive() ? ` [${filterLabel()}]` : "";
  document.getElementById("str-counter").textContent = `Str: ${str.total} | Active: ${str.current}${scopeLabel}`;

  switch (STATE.nav) {
    case "dashboard": renderDashboard(el); break;
    case "parade": renderParade(el); break;
    case "roster": renderRoster(el); break;
    case "attendance": renderAttendance(el); break;
    case "detail": renderConductDetail(el); break;
    case "medical": renderMedical(el); break;
    case "statusboard": renderStatusBoard(el); break;
    case "ippt": renderIPPT(el); break;
    case "soc": renderSOC(el); break;
    case "ha": renderHA(el); break;
    case "polar": renderPolar(el); break;
    case "leave": renderLeave(el); break;
    case "mskAnalytics": renderMSKAnalytics(el); break;
    case "conducts": renderConducts(el); break;
    case "conductdash": renderConductDashboard(el); break;
    case "archive": renderArchive(el); break;
    case "sync": renderSync(el); break;
    default: el.innerHTML = "";
  }
}

// ── Archive (Item 1, admin-only) — view logged parade-state / report-sick msgs ──
// The archive tabs are pulled only for admins (api.js), and the backend blocks the
// raw read for non-admins; this view adds a client-side guard on top so a stale
// non-admin STATE never renders them.
let _archiveTab = "parade";   // "parade" | "sick"
let _archiveQuery = "";
let _archiveCompare = false;  // parade tab: list view vs two-snapshot diff view
let _cmpLeft = 0, _cmpRight = 1;   // indices into the (newest-first) parade archive
let _archiveScope = "";   // parade tab: "" = all scopes; else "company" | "platoon:<CODE>"
let _archiveFetched = false;  // Fix1C: one-shot per session — lazily pulled the archive tabs on first open
// Feature 21: identity of the row whose detail drawer is open, or "" for closed.
// The 20s auto-refresh poll (and every tab re-focus) re-renders the list, which
// would otherwise wipe an open drawer mid-read. Keyed by timestamp|date|slot
// rather than row index because a refresh or a filter change can move the row.
let _arcDrawerKey = "", _arcDrawerTab = "";
function setArchiveScope(v) { _archiveScope = v; renderArchiveList(); }
function setArchiveTab(t) { _archiveTab = t; _archiveCompare = false; render(); }
function setArchiveQuery(q) { _archiveQuery = q; renderArchiveList(); }
function setArchiveCompareMode(on) { _archiveCompare = on; renderArchive(document.getElementById("content")); }
function setArchiveCmp(side, val) { if (side === "left") _cmpLeft = +val; else _cmpRight = +val; renderArchiveList(); }

async function doArchiveNow(kind) {
  if (!STATE.apiUrl || !STATE.authToken) { alert("Not connected to the sheet — can't archive."); return; }
  try {
    const res = await API.archiveNow(kind);
    if (res && res.error) { alert("Archive failed: " + res.error); return; }
    await doPull();            // refresh STATE.paradeArchive / sickArchive
    render();
    const a = (res && res.archived) || {};
    const made = [a.parade ? "parade" : null, a.sick ? "sick" : null].filter(Boolean);
    alert(made.length
      ? `Archived ${made.join(" + ")} for ${res.date} ${res.slot}.`
      : `Nothing new for ${res.date} ${res.slot} — that slot is already archived.`);
  } catch (e) {
    if (e.name === "AuthError" && typeof handleAuthFailure === "function") { handleAuthFailure(); return; }
    alert("Archive error: " + e.message);
  }
}

function renderArchive(el) {
  if (!canWrite()) {
    el.innerHTML = `<div class="card empty-state"><h2 style="font-size:18px;margin-bottom:8px">🗄️ Archive</h2>
      <p>This area is restricted to <strong>commander</strong> and <strong>admin</strong> accounts.</p></div>`;
    return;
  }
  // Fix1C: the warm-cache launch (autoSyncOnLaunch) pulls only CHANGED data tabs
  // and never the commander/admin-only archive tabs, so they can render empty even
  // though the Sheet holds rows. Lazily fetch them once per session on first open,
  // then re-render. One-shot guard reset on failure so a transient error can retry
  // on the next open.
  //
  // The guard is the _archiveFetched flag ALONE. It used to also require both
  // arrays to be empty, but archiveParadeSnapshot optimistically prepends the row
  // it just copied — so copying a parade state before opening Archive made
  // paradeArchive non-empty and suppressed the fetch for the rest of the session,
  // leaving the tab showing that one local row and hiding every server-side
  // snapshot. Neither array is persisted by saveLocal either, so "already has
  // rows" was never a reliable stand-in for "already fetched".
  if (STATE.apiUrl && STATE.authToken && !_archiveFetched) {
    _archiveFetched = true;
    API.fetchArchives().then(res => {
      if (!res) return;
      let got = false;
      if (Array.isArray(res.paradeArchive)) { STATE.paradeArchive = res.paradeArchive; got = true; }
      if (Array.isArray(res.sickArchive)) { STATE.sickArchive = res.sickArchive; got = true; }
      if (got) { saveLocal(); if (STATE.nav === "archive") renderArchive(document.getElementById("content")); }
    }).catch(() => { _archiveFetched = false; });
  }
  const pTimes = configGet("archiveParadeTimes");
  const sTimes = configGet("archiveSickTimes");
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700">🗄️ Message Archive <span style="font-size:12px;color:var(--muted);font-weight:400">(commander + admin · delete admin-only)</span></h2>
      <div style="display:flex;gap:6px">
        <button class="btn" onclick="doArchiveNow('parade')" title="Snapshot the current company parade state now">＋ Archive Parade now</button>
        <button class="btn" onclick="doArchiveNow('sick')" title="Snapshot the current report-sick message now">＋ Archive Sick now</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;font-size:12px;color:var(--muted)">
      <strong>Scheduled archiving</strong> (server-side, unattended) — set <code>archiveParadeTimes</code> in the Config tab, then run <code>setupBravesArchive()</code> once in Apps Script to install the trigger.<br>
      Each parade time is <code>HHMM</code>, optionally tagged <code>:FP</code>/<code>:LP</code> — e.g. <code>0730:FP,1300:FP,2130:LP</code>. Untagged: the latest time of the day is <strong>LP</strong> (night/last parade), all earlier ones are <strong>FP</strong> (morning + midday).<br>
      <strong>Report sick</strong> is archived at <code>archiveSickTimes</code> if set, otherwise automatically at the <strong>FP (morning + midday)</strong> parade times — never at the night/LP slot.<br>
      Parade times: <strong>${escapeAttr(pTimes || "(not set)")}</strong> &nbsp;·&nbsp; Sick times: <strong>${escapeAttr(sTimes || "(auto: FP slots)")}</strong>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:4px">
        <button class="btn ${_archiveTab === "parade" ? "btn-primary" : ""}" onclick="setArchiveTab('parade')">Parade State (${(STATE.paradeArchive || []).length})</button>
        <button class="btn ${_archiveTab === "sick" ? "btn-primary" : ""}" onclick="setArchiveTab('sick')">Report Sick (${(STATE.sickArchive || []).length})</button>
        ${_archiveTab === "parade" ? `<button class="btn ${_archiveCompare ? "btn-primary" : ""}" onclick="setArchiveCompareMode(${!_archiveCompare})" title="Compare two archived parade states line-by-line">⇄ Compare</button>` : ""}
      </div>
      ${_archiveTab === "parade" ? `<select id="archive-scope" onchange="setArchiveScope(this.value)" title="Filter archived parade states by scope"
        style="padding:6px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px">
        <option value="" ${_archiveScope === "" ? "selected" : ""}>All scopes</option>
        <option value="company" ${_archiveScope === "company" ? "selected" : ""}>Company</option>
        ${(typeof activePlatoons === "function" ? activePlatoons() : []).map(p => `<option value="platoon:${p.code}" ${_archiveScope === `platoon:${p.code}` ? "selected" : ""}>${escapeAttr(p.displayName || p.code)}</option>`).join("")}
      </select>` : ""}
      <input id="archive-search" placeholder="Filter by date / slot / text…" value="${escapeAttr(_archiveQuery)}" oninput="setArchiveQuery(this.value)"
        style="flex:1;min-width:160px;padding:6px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px">
      <button class="btn" onclick="exportArchiveCSV('${_archiveTab}')" title="Export the messages currently shown (respects the filter) to CSV">⬇ Export CSV</button>
    </div>
    <div id="archive-list"></div>`;
  renderArchiveList();
}

function renderArchiveList() {
  const host = document.getElementById("archive-list");
  if (!host) return;
  if (_archiveTab === "parade" && _archiveCompare) { renderArchiveCompare(host); return; }
  const rows = (_archiveTab === "parade" ? STATE.paradeArchive : STATE.sickArchive) || [];
  const q = _archiveQuery.trim().toLowerCase();
  // Newest first by timestamp (ISO); fall back to insertion order.
  const sorted = rows.slice().sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const textFiltered = q
    ? sorted.filter(r => `${r.date} ${r.slot} ${r.type || r.format || ""} ${r.message || ""}`.toLowerCase().includes(q))
    : sorted;
  // Fix1A: parade archives carry a scope; filter by the chosen scope (rows with
  // no stored scope are treated as company, matching the pre-scope default).
  const filtered = (_archiveTab === "parade" && _archiveScope)
    ? textFiltered.filter(r => (r.scope || "company") === _archiveScope)
    : textFiltered;

  if (!filtered.length) {
    host.innerHTML = `<div class="empty-state">${rows.length ? "No entries match the filter." : "No archived messages yet. Use “Archive … now”, or set up scheduled archiving."}</div>`;
    return;
  }
  // Feature 21: the list is now one row per snapshot; the message body lives in
  // an on-demand right-side drawer. Two archives a day made the old inline-<pre>
  // list an unreadable wall of text. Row index (not timestamp) keys the drawer
  // because `filtered` is what the user is actually looking at — the drawer must
  // open the row they clicked, under whatever search/scope filter is active.
  const isParade = _archiveTab === "parade";
  const scopeLabel = r => {
    const s = r.scope || "company";   // pre-scope rows default to company
    if (s === "company") return "Company";
    const code = String(s).replace(/^platoon:/, "");
    // Show the platoon's display name, like every other scope surface does
    // (the parade-tab scope selector, the fitness-report scope picker, the
    // dashboard's section-strength headings). Resolved against STATE.platoons
    // rather than activePlatoons() on purpose: an archive is a historical row,
    // so a platoon that has since been deactivated should still render by name.
    // When the Platoons tab is empty, activePlatoons() derives displayName ===
    // code anyway, so falling back to the raw code here matches it exactly.
    const hit = (STATE.platoons || []).find(p => p.code === code);
    return (hit && hit.displayName) || code;
  };
  const head = isParade
    ? `<tr><th>Date</th><th>Slot</th><th>FP/LP</th><th style="text-align:left">Type</th></tr>`
    : `<tr><th>Date</th><th>Slot</th><th style="text-align:left">Format</th></tr>`;
  const body = filtered.map((r, i) => {
    const cells = isParade
      ? `<td>${escapeHTML(r.date || "")}</td><td class="mono">${escapeHTML(r.slot || "")}</td>`
        + `<td>${escapeHTML(r.type || "")}</td><td style="text-align:left">${escapeHTML(scopeLabel(r))}</td>`
      : `<td>${escapeHTML(r.date || "")}</td><td class="mono">${escapeHTML(r.slot || "")}</td>`
        + `<td style="text-align:left">${escapeHTML(r.format || "RS")}</td>`;
    return `<tr class="arc-row" onclick="openArchiveDrawer('${escapeAttr(_archiveTab)}', ${i})" style="cursor:pointer">${cells}</tr>`;
  }).join("");
  host.innerHTML = `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`
    + `<div id="arc-drawer-backdrop" class="arc-drawer-backdrop" onclick="closeArchiveDrawer()"></div>`
    + `<div id="arc-drawer" class="arc-drawer"></div>`;
  // The innerHTML above destroyed the drawer element, so the body class that
  // shrinks #main for it is now describing a drawer that isn't on screen — that
  // would leave the list rendered into a narrow column with nothing beside it.
  // Clear it unconditionally; the re-open below puts it back if the row survived.
  setArchiveDrawerOpen(false);
  // Re-open a drawer that was open before this re-render (auto-refresh poll,
  // tab re-focus, or a filter keystroke). Re-resolved by key, so it follows the
  // row to its new index; if the row is now filtered out or was deleted, the
  // drawer simply stays closed rather than opening someone else's message.
  if (_arcDrawerKey && _arcDrawerTab === _archiveTab) {
    const at = filtered.findIndex(r => arcRowKey(r) === _arcDrawerKey);
    if (at >= 0) openArchiveDrawer(_archiveTab, at);
    else _arcDrawerKey = "";
  }
}

// Feature 34: records "an archive drawer is open" on <body>. Whether that pushes
// the list aside (desktop) or overlays it (<=768px) is decided in styles.css by
// width — deliberately not branched on here, so there is one breakpoint to keep
// in step rather than a JS copy of it that can disagree after a resize.
function setArchiveDrawerOpen(on) {
  document.body.classList.toggle("arc-drawer-open", !!on);
}

// Escape closes the drawer. On desktop the dimming backdrop is gone (it read as
// "this list is disabled" for a list we now want clicked), so its tap-to-close
// went with it and this is the only keyboard exit. Bound once on document —
// renderArchive re-runs on every poll, and per-render binding would stack.
let _arcEscBound = false;
function bindArchiveDrawerEsc() {
  if (_arcEscBound) return;
  _arcEscBound = true;
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!_arcDrawerKey) return;                       // no drawer open
    // A modal opened FROM the drawer (Compare, a delete confirm) owns Escape
    // first; closing the drawer out from under it would strand the modal.
    const ov = document.getElementById("modal-overlay");
    if (ov && !ov.classList.contains("hidden")) return;
    closeArchiveDrawer();
  });
}

// Stable identity for an archive row. deleteArchiveEntry already treats
// (timestamp, date, slot) as the row's key, so the drawer uses the same triple.
function arcRowKey(r) {
  return `${r.timestamp || ""}|${r.date || ""}|${r.slot || ""}`;
}

// Feature 21: the archive detail drawer. Re-derives the same filtered+sorted
// list renderArchiveList built rather than caching it, so a drawer opened after
// a filter change can never show a stale row. Copy and the admin-only Delete
// move in here with the body — they were per-card actions before.
function archiveFilteredRows(tab) {
  const rows = (tab === "parade" ? STATE.paradeArchive : STATE.sickArchive) || [];
  const q = _archiveQuery.trim().toLowerCase();
  const sorted = rows.slice().sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const textFiltered = q
    ? sorted.filter(r => `${r.date} ${r.slot} ${r.type || r.format || ""} ${r.message || ""}`.toLowerCase().includes(q))
    : sorted;
  return (tab === "parade" && _archiveScope)
    ? textFiltered.filter(r => (r.scope || "company") === _archiveScope)
    : textFiltered;
}

function openArchiveDrawer(tab, index) {
  const r = archiveFilteredRows(tab)[index];
  const el = document.getElementById("arc-drawer");
  const bd = document.getElementById("arc-drawer-backdrop");
  if (!r || !el) return;
  bindArchiveDrawerEsc();
  _arcDrawerKey = arcRowKey(r);
  _arcDrawerTab = tab;
  const label = tab === "parade"
    ? `${r.date || ""} ${r.slot || ""} ${r.type || ""}`.trim()
    : `${r.date || ""} ${r.slot || ""} ${r.format || "RS"}`.trim();
  el.innerHTML = `
    <div class="arc-drawer-head">
      <strong style="font-size:13px">${escapeHTML(label)}</strong>
      <button class="modal-close" onclick="closeArchiveDrawer()" aria-label="Close">×</button>
    </div>
    <pre id="arc-drawer-body" style="white-space:pre-wrap;word-break:break-word;font-size:11px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin:0;flex:1;overflow:auto">${escapeAttr(r.message || "")}</pre>
    <div style="display:flex;gap:6px;margin-top:10px">
      <button class="btn" onclick="(function(){const t=document.getElementById('arc-drawer-body').textContent;navigator.clipboard&&navigator.clipboard.writeText(t);})()">Copy</button>
      ${isAdminRole() ? `<button class="btn btn-danger" onclick="deleteArchiveEntry('${escapeAttr(tab)}','${escapeAttr(r.timestamp || "")}','${escapeAttr(r.date || "")}','${escapeAttr(r.slot || "")}'); closeArchiveDrawer()">Delete</button>` : ""}
    </div>`;
  el.classList.add("open");
  if (bd) bd.classList.add("open");
  setArchiveDrawerOpen(true);
}

function closeArchiveDrawer() {
  _arcDrawerKey = ""; _arcDrawerTab = "";
  const el = document.getElementById("arc-drawer");
  const bd = document.getElementById("arc-drawer-backdrop");
  if (el) { el.classList.remove("open"); el.innerHTML = ""; }
  if (bd) bd.classList.remove("open");
  setArchiveDrawerOpen(false);
}

// Compare two archived parade states line-by-line (admin only; the whole Archive
// nav is already admin-gated). Reuses diffLines (helpers.js) over the stored
// messages — including the exact hand-edited text captured at copy time.
function renderArchiveCompare(host) {
  const rows = (STATE.paradeArchive || []).slice()
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  if (rows.length < 2) {
    host.innerHTML = `<div class="empty-state">Need at least two archived parade states to compare. Copy a parade state (or use “Archive Parade now”) to capture snapshots.</div>`;
    return;
  }
  const li = Math.min(Math.max(_cmpLeft, 0), rows.length - 1);
  const ri = Math.min(Math.max(_cmpRight, 0), rows.length - 1);
  const optLabel = r => `${r.date || ""} ${r.slot || ""} ${r.type || ""}${r.timestamp ? " · " + new Date(r.timestamp).toLocaleString() : ""}`.trim();
  const opts = sel => rows.map((r, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${escapeAttr(optLabel(r))}</option>`).join("");
  const diff = diffLines(rows[li].message || "", rows[ri].message || "");
  const added = diff.filter(d => d.type === "add").length;
  const removed = diff.filter(d => d.type === "del").length;
  const diffHtml = diff.map(d => {
    const bg = d.type === "add" ? "rgba(63,185,80,.15)" : d.type === "del" ? "rgba(248,81,73,.15)" : "transparent";
    const col = d.type === "add" ? "var(--green)" : d.type === "del" ? "var(--red)" : "var(--text)";
    const mark = d.type === "add" ? "+" : d.type === "del" ? "−" : " ";
    return `<div style="background:${bg};white-space:pre-wrap;word-break:break-word"><span style="color:${col};user-select:none">${mark} </span><span style="color:${col}">${escapeAttr(d.text)}</span></div>`;
  }).join("");
  host.innerHTML = `
    <div class="card" style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <label style="font-size:12px;color:var(--muted)">Base <select class="topbar-select" onchange="setArchiveCmp('left', this.value)">${opts(li)}</select></label>
      <span style="color:var(--muted)">→</span>
      <label style="font-size:12px;color:var(--muted)">Compare <select class="topbar-select" onchange="setArchiveCmp('right', this.value)">${opts(ri)}</select></label>
      <span style="font-size:11px;color:var(--muted);margin-left:auto"><span style="color:var(--green)">+${added}</span> / <span style="color:var(--red)">−${removed}</span> lines</span>
    </div>
    ${li === ri ? `<div class="empty-state">Pick two different snapshots to see a diff.</div>` : `<div class="card" style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.5;max-height:60vh;overflow:auto">${diffHtml}</div>`}`;
}

// Delete one archived message (admin-only; backend re-checks the role). Matches
// on the unique timestamp, with date+slot as a fallback for legacy rows.
async function deleteArchiveEntry(kind, ts, date, slot) {
  if (!confirm("Delete this archived message? This removes it from the audit trail and cannot be undone.")) return;
  try {
    const res = await API.deleteArchive(kind, { timestamp: ts, date, slot });
    if (res && res.error) { alert("Delete failed: " + res.error); return; }
    const key = kind === "sick" ? "sickArchive" : "paradeArchive";
    STATE[key] = (STATE[key] || []).filter(r =>
      ts ? String(r.timestamp) !== String(ts) : !(r.date === date && String(r.slot) === String(slot)));
    renderArchive(document.getElementById("content"));
  } catch (e) {
    if (e.name === "AuthError" && typeof handleAuthFailure === "function") { handleAuthFailure(); return; }
    alert("Delete error: " + e.message);
  }
}

// Export the currently-shown archive tab (respecting the search filter) to CSV.
function exportArchiveCSV(kind) {
  const rows = (kind === "parade" ? STATE.paradeArchive : STATE.sickArchive) || [];
  const q = _archiveQuery.trim().toLowerCase();
  const flat = rows.slice()
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
    .filter(r => !q || `${r.date} ${r.slot} ${r.type || r.format || ""} ${r.message || ""}`.toLowerCase().includes(q))
    .map(r => ({
      timestamp: r.timestamp || "", date: r.date || "", slot: r.slot || "",
      type: r.type || r.format || "", scope: r.scope || "", message: r.message || ""
    }));
  if (!flat.length) { alert("Nothing to export."); return; }
  exportCSV(flat, `${kind === "parade" ? "parade_state" : "report_sick"}_archive.csv`);
}

// Section-level strength breakdown for the Dashboard (§16 companion to the
// rank-group card). Nested by platoon: activePlatoons() order first, then any
// stray platoon code present in `people` but not in the Platoons tab, then a
// trailing "Command / Unassigned" group for blank-platoon personnel (e.g.
// commanders with no platoon). Per box, cur/tot come from bpStrength so the
// numbers reconcile with the rank-group card. Pure — reads only its args + the
// canonical personPlatoon/personSection/rankGroupOf accessors.
//
// The COMMAND element (platoon "HQ", and the blank "Command / Unassigned" group)
// is broken down by RANK GROUP — OFFICER / WOSPEC / ENLISTEE — not by section:
// every commander shares one "Command" section, so a section split collapsed the
// whole command element into a single box (the "only listing 1" bug). The
// meaningful distinction there is officers (coy HQ) vs the WOSPEC section
// commanders, so we bucket by rankGroupOf instead. Every box carries a
// display-ready `displayLabel` (raw `label` is kept as the grouping key so the
// pure grouping stays testable).