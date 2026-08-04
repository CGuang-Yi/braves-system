// The Status Board: leaderboard, roster list, list exports, and the weekly grid.
//
// Split out of the original monolithic render.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// ════════════════════════════════════════════════════════════════════════════
// STATUS BOARD (addendum A3 Leaderboard + A7 Roster Status List + A4 Status Grid)
// ════════════════════════════════════════════════════════════════════════════
let _sbSort = (() => { try { return localStorage.getItem("braves-sb-sort") || "Total"; } catch { return "Total"; } })();
let _sbCollapsed = (() => { try { return localStorage.getItem("braves-sb-collapsed") === "1"; } catch { return false; } })();
let _sbShowAll = false;
let _sbWeekOffset = 0;     // grid paging, in 5-week windows (0 = current)
let _sbSearch = "";
let _sbGridShown = false;  // lazy-load: false → show the "Load grid" gate (mobile)

// Grid cell palette (A4.2).
const SB_CELL = {
  RSI: { bg: "#EF9F27", fg: "#633806" }, RSO: { bg: "#378ADD", fg: "#042C53" },
  MC:  { bg: "#E24B4A", fg: "#501313" }, MR:  { bg: "#7F77DD", fg: "#26215C" },
  LD:  { bg: "#B4B2A9", fg: "#2C2C2A" }, LV:  { bg: "#1D9E75", fg: "#04342C" },
  EX:  { bg: "#B08D57", fg: "#241B0E" },  // Excuse-* — distinct from LD's grey
  WD:  { bg: "#9F1239", fg: "#3F0518" }   // Warded — away/not-in-camp, distinct from MC's red
};
function _sbKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

// Section-grouped ordering (A4.3/A7.4): platoon (HQ last), section (Command first,
// then numeric), then name.
function sbOrdered(rows) {
  const plRank = c => c === "HQ" ? 9999 : (parseInt(String(c).replace(/\D/g, ""), 10) || 9000);
  const secRank = s => s === "Command" ? -1 : (parseInt(s, 10) || 9000);
  return [...rows].sort((a, b) => {
    const pa = plRank(personPlatoon(a)), pb = plRank(personPlatoon(b));
    if (pa !== pb) return pa - pb;
    const sa = secRank(personSection(a)), sb = secRank(personSection(b));
    if (sa !== sb) return sa - sb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }).map(r => ({ r, group: `${personPlatoon(r) || "—"}${personSection(r) ? " · " + (personSection(r) === "Command" ? "Command" : "Sect " + personSection(r)) : ""}` }));
}

// RSI/RSO counts per person from the Medical tab (A3.1 / A4.6).
function sbRSCounts() {
  const map = {};
  (STATE.medical || []).forEach(m => {
    if (m.type !== "RSI" && m.type !== "RSO") return;
    const e = map[m.d4] = map[m.d4] || { rsi: 0, rso: 0 };
    if (m.type === "RSI") e.rsi++; else e.rso++;
  });
  return map;
}

function renderStatusBoard(el) {
  const scopeLabel = isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}]</span>` : "";
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <h2 style="font-size:18px;font-weight:700">🗓️ Status Board${scopeLabel}</h2>
    </div>
    <div id="sb-leaderboard" class="card" style="padding:14px;margin-bottom:14px"></div>
    <div id="sb-rosterlist" class="card" style="padding:14px;margin-bottom:14px"></div>
    <div id="sb-grid" class="card" style="padding:14px"></div>
    <div id="sb-popover"></div>
  `;
  _sbGridShown = false;   // re-defer the heavy calendar grid each time the board opens
  renderSBLeaderboard();
  renderSBRosterList();
  renderSBGrid();
}

// ── A3. Report Sick Leaderboard ─────────────────────────────────────────────
function renderSBLeaderboard() {
  const host = document.getElementById("sb-leaderboard");
  if (!host) return;
  const counts = sbRSCounts();
  const scoped = filteredRoster();
  let rows = scoped.map(r => {
    const c = counts[r.id] || { rsi: 0, rso: 0 };
    return { r, rsi: c.rsi, rso: c.rso, total: c.rsi + c.rso };
  });
  const byName = (a, b) => String(a.r.name || "").localeCompare(String(b.r.name || ""));
  // 4D order via the shared key (js/appointment-4d.js). A commander's fourD is an
  // appointment code, not a number, so this must fall through to the id rather
  // than degrade to Infinity and dump every commander at the bottom.
  if (_sbSort === "Total") rows = rows.filter(x => x.total > 0).sort((a, b) => b.total - a.total || byName(a, b));
  else if (_sbSort === "RSI") rows = rows.filter(x => x.total > 0).sort((a, b) => b.rsi - a.rsi || b.total - a.total);
  else if (_sbSort === "RSO") rows = rows.filter(x => x.total > 0).sort((a, b) => b.rso - a.rso || b.total - a.total);
  else rows = rows.sort((a, b) => fourDSortKey(a.r) - fourDSortKey(b.r) || byName(a, b)); // 4D

  const shown = _sbCollapsed ? [] : (_sbShowAll ? rows : rows.slice(0, 3));
  const tab = m => `<button onclick="sbSetSort('${m}')" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border);background:${_sbSort === m ? "var(--accent)" : "var(--surface)"};color:${_sbSort === m ? "#fff" : "var(--text)"};font-size:11px;cursor:pointer">${m}</button>`;
  const row = (x, i) => `<div onclick="openPerson('${x.r.id}')" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px">
      <span class="mono" style="color:var(--muted);min-width:20px">${i + 1}.</span>
      <span style="flex:1">${escapeAttr(x.r.name || "")} ${x.r.role !== "Commander" && x.r.fourD ? `<span class="mono" style="color:var(--accent)">${configGet("companyPrefix")}${x.r.fourD}</span>` : ""}</span>
      <span style="background:#EF9F2722;color:#EF9F27;border:1px solid #EF9F2744;border-radius:999px;padding:1px 6px;font-size:10px">RSI ${x.rsi}</span>
      <span style="background:#378ADD22;color:#378ADD;border:1px solid #378ADD44;border-radius:999px;padding:1px 6px;font-size:10px">RSO ${x.rso}</span>
      <strong style="min-width:24px;text-align:right">${x.total}</strong>
    </div>`;
  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <h3 style="font-size:14px;font-weight:600;cursor:pointer" onclick="sbToggleCollapse()">${_sbCollapsed ? "▸" : "▾"} Report Sick Leaderboard <span style="font-weight:400;color:var(--muted);font-size:11px">(${rows.length} pax with RS)</span></h3>
      <div style="display:flex;gap:6px">${["Total", "4D", "RSI", "RSO"].map(tab).join("")}</div>
    </div>
    ${_sbCollapsed ? "" : `<div style="margin-top:8px">
      ${shown.length ? shown.map(row).join("") : `<div style="font-size:12px;color:var(--muted);padding:6px">No report-sick records in scope.</div>`}
      ${!_sbShowAll && rows.length > 3 ? `<button class="btn" style="margin-top:8px;font-size:11px" onclick="sbShowAllLeaderboard()">Show all ${rows.length} personnel</button>` : ""}
    </div>`}
  `;
}
function sbSetSort(m) { _sbSort = m; _sbShowAll = false; try { localStorage.setItem("braves-sb-sort", m); } catch {} renderSBLeaderboard(); }
function sbToggleCollapse() { _sbCollapsed = !_sbCollapsed; try { localStorage.setItem("braves-sb-collapsed", _sbCollapsed ? "1" : "0"); } catch {} renderSBLeaderboard(); }
function sbShowAllLeaderboard() { _sbShowAll = true; renderSBLeaderboard(); }

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 35 — CSV export of the Status, Out/Leave and MC lists
// ════════════════════════════════════════════════════════════════════════════
// Three buttons, each on the tab that already renders that list — a combined
// export menu was rejected because it would hand you lists you are not looking
// at, and the Dashboard was rejected because its tables are today-only summaries
// rather than the full lists.
//
// All three are TODAY'S LIVE SNAPSHOT (no date picker, no history dump) and all
// three honour the topbar platoon/section/role scope, the same rule the Conduct
// Progression export follows. The Roster export is deliberately unscoped instead
// — it exists to hand over the whole company — so "match the existing exporters"
// was ambiguous and had to be decided rather than inferred.
//
// Sheets' leading-zero trap does NOT get special handling here: 4Ds go out as
// plain text exactly as the Roster and Conduct exports already emit them, so
// Sheets will render "0123" as 123 on open. Wrapping them in ="0123" would fix
// the display and break every other consumer of these files; matching the
// existing exports is the lesser evil, and this is the only place that says so.

// Scope, rendered for a filename: "Recs-PLT1-Sect2", or "Company" when nothing
// is filtered. This is the point of the whole helper — a filtered file and a
// whole-company one are otherwise indistinguishable on disk, and mistaking one
// platoon's MC list for the company's is a reporting error, not a cosmetic one.
function exportScopeSlug() {
  const l = filterLabel();
  return l ? l.replace(/\s*·\s*/g, "-").replace(/\s+/g, "") : "Company";
}
function exportListFileName(label) {
  return exportFileName(`${label} ${exportScopeSlug()}`, "csv");
}

// Identity columns every one of the three shares. Rank goes through
// bpDisplayRank so a blank-rank recruit reads REC here exactly as they do in the
// parade state (DECISIONS #122) — a spreadsheet that disagrees with the message
// is the same failure in a different medium.
function exportPersonCols(d4) {
  const r = STATE.roster.find(x => x.id === d4) || {};
  return {
    "4D": d4,
    Name: r.name || "",
    Rank: typeof bpDisplayRank === "function" ? bpDisplayRank(r) : (r.rank || ""),
    Platoon: personPlatoon(r) || "",
    Section: personSection(r) || ""
  };
}

// STATUS — mirrors the A7 Roster Status List exactly, including its own
// name/4D search box (the Archive export sets the precedent for honouring a
// list's local filter: export what is on screen).
function exportStatusList() {
  const today = todayISO();
  let scoped = filteredRoster();
  const q = _sbSearch.trim().toLowerCase();
  if (q) scoped = scoped.filter(r => String(r.name || "").toLowerCase().includes(q)
    || String(r.id || "").toLowerCase().includes(q) || String(r.fourD || "").includes(q));
  const idx = bpBuildIndex();
  const rows = sbOrdered(scoped).map(({ r, group }) => {
    const p = bpPrimaryForDay(r, today, idx);
    // Most-severe ghost tag today — same scan the on-screen row does.
    let ghost = null;
    (idx.medical[r.id] || []).forEach(m => {
      const t = medStatusTag(m, today);
      if (t && t.ghostDay > 0 && (!ghost || t.ghostDay < ghost.ghostDay)) ghost = t;
    });
    return Object.assign(exportPersonCols(r.id), {
      Group: group,
      Status: p.primary ? (p.primary.type === "WD" ? "WARDED" : p.primary.label) : "Present",
      MR: p.mr ? "Y" : "",
      Recovering: ghost ? ghost.tag : "",
      Reason: p.primary ? (p.primary.reason || "") : (p.mr || "")
    });
  });
  if (!rows.length) { alert("Nothing to export — no personnel in scope."); return; }
  exportCSV(rows, exportListFileName("Status list"));
}

// OUT / LEAVE — every leave record in scope, newest first, as the Leave tab
// lists them. Not restricted to today: the tab shows the full log and the export
// is meant to be the same thing in a spreadsheet.
function exportLeaveList() {
  const visible = visibleD4Set();
  const rows = STATE.leave
    .filter(l => passesFilter(l.d4, visible))
    .map(l => ({ l, startIso: displayDateToISO(l.startDate) || "" }))
    .sort((a, b) => (a.startIso === b.startIso ? 0 : a.startIso < b.startIso ? 1 : -1))
    .map(({ l }) => Object.assign(exportPersonCols(l.d4), {
      Type: l.type || "",
      "In Camp": l.isInCamp ? "Y" : "N",
      Start: l.startDate || "",
      End: l.endDate || "",
      Days: l.days || "",
      Reason: l.reason || ""
    }));
  if (!rows.length) { alert("Nothing to export — no leave records in scope."); return; }
  exportCSV(rows, exportListFileName("Out-Leave list"));
}

// MC — who is on MC right now. Warded is deliberately NOT here: spec §8 keeps it
// out of ATT C, and it surfaces in the Status export instead.
//
// Two kinds of row qualify, and the second is easy to miss. An MC whose window
// covers today, obviously — but ALSO an MC that has ended which nobody has
// booked in. Since PR #65 an away status ends only when a commander explicitly
// books the person in, so the parade state still lists those under ATT C; an MC
// list that dropped them would contradict the parade state sent the same
// morning. They carry a Note, so the anomaly is legible in the file rather than
// silently folded in with everyone else.
function exportMCList() {
  const today = todayISO();
  const visible = visibleD4Set();
  const rows = STATE.medical
    .filter(m => passesFilter(m.d4, visible))
    .filter(m => String(m.status || "").trim() === "MC" && !m.bookInDate)
    .map(m => {
      const s = displayDateToISO(m.startDate || m.date) || "";
      const e = displayDateToISO(m.endDate) || "";
      if (!s || !e || s > today) return null;              // not started (or undated)
      return { m, s, e, ended: e < today };
    })
    .filter(Boolean)
    .sort((a, b) => (a.s === b.s ? 0 : a.s < b.s ? 1 : -1))
    .map(({ m, e, ended }) => Object.assign(exportPersonCols(m.d4), {
      Status: "MC",
      Start: m.startDate || m.date || "",
      End: m.endDate || "",
      Days: bpInclusiveDays(m) || "",
      Reason: m.reason || "",
      Note: ended ? `MC ended ${isoToDisplayDate(e)} — not booked in` : ""
    }));
  if (!rows.length) { alert("Nothing to export — nobody is on MC in this scope today."); return; }
  exportCSV(rows, exportListFileName("MC list"));
}

// ── A7. Roster Status List (live snapshot) ──────────────────────────────────
function renderSBRosterList() {
  const host = document.getElementById("sb-rosterlist");
  if (!host) return;
  const today = todayISO();
  let scoped = filteredRoster();
  const q = _sbSearch.trim().toLowerCase();
  if (q) scoped = scoped.filter(r => String(r.name || "").toLowerCase().includes(q) || String(r.id || "").toLowerCase().includes(q) || String(r.fourD || "").includes(q));
  const ordered = sbOrdered(scoped);
  // Index once; both bpPrimaryForDay and the per-row ghost-tag scan below would
  // otherwise re-scan STATE.medical/leave/appointments for every person.
  const idx = bpBuildIndex();

  // Warded lands in the "others" section (spec §8 keeps it out of ATT C) but is
  // still an away/not-in-camp case — colour it like MC/WD instead of the generic
  // grey OTHERS chip, which reads as an unremarkable in-camp leave entry.
  const catColor = primary => (primary?.type === "WD") ? SB_CELL.WD
    : ({ reportingSick: SB_CELL.RSI, attC: SB_CELL.MC, alOil: SB_CELL.LV, status: SB_CELL.LD, others: { bg: "#8B949E", fg: "#1c1c1c" } }[primary?.key] || { bg: "#8B949E", fg: "#1c1c1c" });
  let lastGroup = null, body = "";
  ordered.forEach(({ r, group }) => {
    if (group !== lastGroup) { body += `<tr><td colspan="4" style="background:var(--surface2);font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:4px 8px;font-weight:700">${escapeAttr(group)}</td></tr>`; lastGroup = group; }
    const p = bpPrimaryForDay(r, today, idx);
    const ghostInfo = (() => {
      // most-severe ghost tag among this person's medical rows today
      let best = null;
      (idx.medical[r.id] || []).forEach(m => {
        const t = medStatusTag(m, today);
        if (t && t.ghostDay > 0 && (!best || t.ghostDay < best.ghostDay)) best = t;
      });
      return best;
    })();
    const catBadge = p.primary
      ? `<span style="background:${catColor(p.primary).bg}33;color:${catColor(p.primary).bg};border:1px solid ${catColor(p.primary).bg}66;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:600">${p.primary.type === "WD" ? "WARDED" : p.primary.label}</span>`
      : `<span style="color:var(--green);font-size:11px">Present</span>`;
    const mrBadge = p.mr ? ` <span style="background:#7F77DD33;color:#7F77DD;border:1px solid #7F77DD66;border-radius:999px;padding:2px 6px;font-size:9px">MR</span>` : "";
    const ghostBadge = ghostInfo ? ` <span title="recovering" style="color:var(--muted);font-size:9px;border:1px solid var(--border);border-radius:999px;padding:1px 4px">${ghostInfo.tag}</span>` : "";
    const reason = p.primary ? p.primary.reason : (p.mr || "");
    body += `<tr onclick="openSBCellDetail('${r.id}','${today}')" style="cursor:pointer">
      <td style="text-align:left">${escapeAttr(paradeRN(r.id))}</td>
      <td style="font-size:11px;color:var(--muted)">${personPlatoon(r) || "—"}${personSection(r) ? " · " + personSection(r) : ""}</td>
      <td>${catBadge}${mrBadge}${ghostBadge}</td>
      <td style="text-align:left;font-size:11px;color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAttr(reason)}">${escapeAttr(reason) || "—"}</td>
    </tr>`;
  });
  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <h3 style="font-size:14px;font-weight:600">Roster Status List <span style="font-weight:400;color:var(--muted);font-size:11px">(live — ${isoToDisplayDate(today)})</span></h3>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="sb-search" placeholder="Filter name / 4D…" value="${escapeAttr(_sbSearch)}" oninput="sbSearchInput(this.value)" style="padding:5px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px">
        <button class="btn" onclick="exportStatusList()" title="Export this list, exactly as filtered, to CSV. The scope is in the filename.">⭳ CSV</button>
      </div>
    </div>
    <div class="table-wrap" style="max-height:420px;overflow:auto"><table><thead><tr>
      <th style="text-align:left">R/N</th><th>Plt · Sect</th><th>Today</th><th style="text-align:left">Reason</th>
    </tr></thead><tbody>${body || `<tr><td colspan="4" style="color:var(--muted);padding:10px">No personnel in scope${q ? " match the filter" : ""}.</td></tr>`}</tbody></table></div>
  `;
  const inp = document.getElementById("sb-search");
  if (inp && q) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}
function sbSearchInput(v) { _sbSearch = v; renderSBRosterList(); }

// ── A4. Status Grid (calendar) ──────────────────────────────────────────────
function sbWeeks(offset) {
  const today = new Date(todayISO() + "T00:00:00");
  const dow = (today.getDay() + 6) % 7;            // 0 = Monday
  const monThis = new Date(today); monThis.setDate(today.getDate() - dow);
  const startMon = new Date(monThis); startMon.setDate(monThis.getDate() - 4 * 7 + offset * 5 * 7);
  const weeks = [];
  for (let w = 0; w < 5; w++) {
    const wkMon = new Date(startMon); wkMon.setDate(startMon.getDate() + w * 7);
    const days = [];
    for (let d = 0; d < 7; d++) { const dd = new Date(wkMon); dd.setDate(wkMon.getDate() + d); days.push(_sbKey(dd)); }
    weeks.push({ monIso: _sbKey(wkMon), days });
  }
  return weeks;
}
// Lazy-load: a wide grid is ~35 cells × N people of DOM — the same mobile jank
// the charts defer. Build it only when not deferred, the user has tapped "Load
// grid", or the scope is small enough to be cheap. Honours the shared chart pref
// (auto/defer/eager) so one toggle governs every heavy view.
const SB_GRID_DEFER_ROWS = 30;
function renderSBGrid() {
  const host = document.getElementById("sb-grid");
  if (!host) return;
  const scoped = filteredRoster();
  if (!_sbGridShown && shouldDeferCharts() && scoped.length > SB_GRID_DEFER_ROWS) {
    host.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="font-size:14px;font-weight:600">Status Grid <span style="font-weight:400;color:var(--muted);font-size:11px">(calendar — day = square, colour = status)</span></h3>
      </div>
      <div style="text-align:center;padding:18px">
        <button class="btn btn-primary" onclick="loadStatusGrid()">🗓️ Load status grid</button>
        <div style="font-size:11px;color:var(--muted);margin-top:8px">Deferred for a faster load on mobile (${scoped.length} rows). <a href="#" onclick="setChartPref('eager');return false" style="color:var(--accent)">Always load</a></div>
      </div>`;
    return;
  }
  const companyWide = !STATE.filterPlt;     // no platoon picked → whole company
  const weeks = sbWeeks(_sbWeekOffset);
  const todayKey = todayISO();
  const counts = sbRSCounts();
  const ordered = sbOrdered(scoped);
  // Index leave/medical/appointments by d4 once; the grid classifies every person
  // across ~35 day-cells and would otherwise re-scan all three STATE arrays per cell.
  const idx = bpBuildIndex();

  const legend = Object.entries({ RSI: "RSI", RSO: "RSO", MC: "MC/ATTC", WD: "Warded", MR: "MR", LD: "LD", EX: "Excuse", LV: "Leave" })
    .map(([k, lbl]) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:10px"><span style="width:11px;height:11px;border-radius:2px;background:${SB_CELL[k].bg};display:inline-block"></span>${lbl}</span>`).join("");

  const colspanAll = weeks.length * 7 + 3;   // 4D + Name + day cells + Total RS
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekHead = weeks.map(w => `<th colspan="7" style="border-left:2px solid var(--border);font-size:10px;color:var(--muted)">Wk of ${isoToDisplayDate(w.monIso).split(" ").slice(0, 2).join(" ")}</th>`).join("");
  const dowHead = weeks.map(() => dows.map((d, i) => `<th style="font-size:9px;${i === 0 ? "border-left:2px solid var(--border);" : ""}${i >= 5 ? "color:var(--dim);" : "color:var(--muted);"}min-width:26px">${d}</th>`).join("")).join("");

  let lastGroup = null, body = "";
  ordered.forEach(({ r, group }) => {
    if (group !== lastGroup) { body += `<tr><td colspan="${colspanAll}" class="sb-group">${escapeAttr(group)}</td></tr>`; lastGroup = group; }
    const c = counts[r.id] || { rsi: 0, rso: 0 };
    let cells = "";
    weeks.forEach(w => w.days.forEach((iso, i) => {
      const dayNum = +iso.slice(8, 10);                 // iso = YYYY-MM-DD
      const future = iso > todayKey;
      let inner;
      if (future) {
        inner = `<div class="sb-cell sb-future">${dayNum}</div>`;
      } else {
        const cell = bpGridCell(r, iso, idx);
        if (cell.any) {
          const pal = SB_CELL[cell.primary] || { bg: "#8B949E", fg: "#111" };
          // Secondary RSI/RSO not already shown as the primary colour → corner triangle.
          const sec = (cell.hasRSI && cell.primary !== "RSI") ? "#EF9F27" : (cell.hasRSO && cell.primary !== "RSO") ? "#378ADD" : "";
          inner = `<div class="sb-cell" data-d4="${r.id}" data-iso="${iso}" style="background:${pal.bg};color:${pal.fg}">${dayNum}${sec ? `<span class="sb-corner" style="border-top-color:${sec}"></span>` : ""}</div>`;
        } else {
          inner = `<div class="sb-cell sb-empty" data-d4="${r.id}" data-iso="${iso}">${dayNum}</div>`;
        }
      }
      cells += `<td class="sb-td${i === 0 ? " sb-wkstart" : ""}${i >= 5 ? " sb-weekend" : ""}">${inner}</td>`;
    }));
    body += `<tr>
      <td class="sb-id" data-person="${escapeAttr(r.id)}" style="cursor:pointer" title="Open person card">${r.role !== "Commander" && r.fourD ? `${configGet("companyPrefix")}${r.fourD}` : escapeAttr(r.id)}</td>
      <td class="sb-name" data-person="${escapeAttr(r.id)}" style="cursor:pointer" title="Open person card">${escapeAttr(r.name || "")}</td>
      ${cells}
      <td style="font-weight:700;text-align:center">${c.rsi + c.rso}</td>
    </tr>`;
  });

  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <h3 style="font-size:14px;font-weight:600">Status Grid <span style="font-weight:400;color:var(--muted);font-size:11px">(calendar — day = square, colour = status)</span></h3>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn" style="font-size:11px" onclick="sbGridNav(-1)">← earlier</button>
        <button class="btn" style="font-size:11px" onclick="sbGridNav(0)">current</button>
        <button class="btn" style="font-size:11px" onclick="sbGridNav(1)">later →</button>
      </div>
    </div>
    <div style="margin-bottom:8px">${legend}</div>
    ${companyWide ? `<div style="font-size:11px;color:var(--orange);background:#D2992211;border:1px solid #D2992244;border-radius:6px;padding:6px 10px;margin-bottom:8px">Company scope shows all ${scoped.length} rows — pick a platoon in the scope filter for a more readable grid.</div>` : ""}
    <div class="table-wrap" style="max-height:520px;overflow:auto"><table class="sb-table" style="border-collapse:collapse" onclick="sbGridClick(event)">
      <thead>
        <tr><th class="sb-id" style="text-align:left">4D</th><th class="sb-name" style="text-align:left">Name</th>${weekHead}<th rowspan="2" style="text-align:center">Total<br>RS</th></tr>
        <tr><th class="sb-id"></th><th class="sb-name"></th>${dowHead}</tr>
      </thead>
      <tbody>${body || `<tr><td style="color:var(--muted);padding:10px">No personnel in scope.</td></tr>`}</tbody>
    </table></div>
  `;
}
// Event delegation for grid cells (Misc/E3 perf): one listener on the table
// instead of an inline onclick per ~35×N cells — far less HTML + far fewer
// closures, which is what made iOS Chrome lag on the company-wide grid.
function sbGridClick(e) {
  // 4D / Name column → full person card; day cell → lightweight day-detail popover.
  const person = e.target.closest("[data-person]");
  if (person) { openPerson(person.dataset.person); return; }
  const cell = e.target.closest("[data-iso]");
  if (cell && cell.dataset.d4) openSBCellDetail(cell.dataset.d4, cell.dataset.iso);
}
function loadStatusGrid() { _sbGridShown = true; renderSBGrid(); }
function sbGridNav(delta) { _sbGridShown = true; _sbWeekOffset = delta === 0 ? 0 : _sbWeekOffset + delta; renderSBGrid(); }

// ── A4.4 lightweight cell-detail popover (reused by A7 rows) ─────────────────
function openSBCellDetail(d4, iso) {
  const host = document.getElementById("sb-popover");
  if (!host) return;
  const r = STATE.roster.find(x => x.id === d4);
  if (!r) return;
  const c = bpClassifyPerson(r, iso);
  const order = [["reportingSick", "REPORTING SICK"], ["attC", "ATT C"], ["alOil", "AL/OIL"], ["status", "STATUS"], ["mr", "MR"], ["others", "OTHERS"]];
  const lines = [];
  order.forEach(([k, label]) => c.meta[k].forEach(x => lines.push(`<div style="padding:3px 0;border-bottom:1px solid var(--border)"><strong style="font-size:10px;color:var(--muted)">${label}</strong><br>${escapeAttr(x.reason)}</div>`)));
  host.innerHTML = `
    <div onclick="closeSBPopover()" style="position:fixed;inset:0;z-index:60"></div>
    <div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:61;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;min-width:260px;max-width:90vw;box-shadow:0 8px 28px rgba(0,0,0,.5)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:13px">${escapeAttr(paradeRN(d4))} — ${isoToDisplayDate(iso)}</strong>
        <button onclick="closeSBPopover()" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer">✕</button>
      </div>
      ${lines.length ? lines.join("") : `<div style="font-size:12px;color:var(--green)">Present / no status this day.</div>`}
    </div>`;
}
function closeSBPopover() { const h = document.getElementById("sb-popover"); if (h) h.innerHTML = ""; }
