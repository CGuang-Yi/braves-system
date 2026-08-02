// The per-tab record views: Roster, Attendance, Conduct Detail, Medical, IPPT, SOC.
//
// Split out of the original monolithic render.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

function renderRoster(el) {
  const rsiCount = {};
  STATE.medical.forEach(m => { rsiCount[m.d4] = (rsiCount[m.d4] || 0) + 1; });
  const scoped = filteredRoster();
  // Push/Export operate on the FULL roster — scoping is a view concern; we
  // don't want the user to silently overwrite the sheet with only their slice.
  const titleSuffix = isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.roster.length}]</span>` : ` (${STATE.roster.length})`;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">Master Roster${titleSuffix}</h2>
      <div style="display:flex;gap:8px" class="write-only">
        <button class="btn" onclick="exportCSV(STATE.roster,exportFileName('Roster','csv'))">Export CSV</button>
        <button class="btn btn-success" onclick="pushTab('Roster',STATE.roster)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
      </div>
    </div>
    ${scoped.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th style="text-align:left">Name</th><th>Plt · Sect</th><th>Role</th><th>Status</th><th>BMI</th><th>RSIs</th></tr></thead><tbody>
    ${(() => {
      // Build the effective-medical map ONCE for the whole list so each row's
      // status badge (rosterDisplayStatus) is an O(1) lookup instead of rebuilding
      // the full medical layer per row (O(roster × medical) — see helpers.js).
      const effByD4 = {};
      currentMedicalEffectiveAll(todayISO()).forEach(e => { effByD4[e.d4] = e; });
      return scoped.map(r => {
      const bmi = calcBMI(r);
      const isCmd = r.role === "Commander";
      const nameCell = isCmd ? `${escapeHTML(r.rank ? r.rank + " " : "")}${escapeHTML(r.name)}` : escapeHTML(r.name);
      const idCell = isCmd ? "" : r.id;
      const roleCell = isCmd ? `<span class="badge badge-purple">Commander</span>` : `<span style="color:var(--muted);font-size:11px">Recruit</span>`;
      // Braves org columns (spec §5). Show the explicit platoon/section when
      // present; em-dash when the roster row hasn't been populated yet.
      const plt = personPlatoon(r);
      const sect = personSection(r);
      const orgCell = (plt || sect) ? `${plt || "—"}${sect ? " · " + sect : ""}` : "—";
      return `<tr onclick="openPerson('${r.id}')" style="cursor:pointer"><td class="mono" style="font-weight:700;color:var(--accent)">${idCell}</td><td style="text-align:left">${nameCell}</td><td style="font-size:11px;color:var(--muted)">${orgCell}</td><td>${roleCell}</td><td>${rosterDisplayStatus(r, effByD4)}</td><td style="font-weight:700;color:${bmiColor(bmi)}">${isCmd ? '—' : (bmi ?? '—')}</td><td style="color:${(rsiCount[r.id] || 0) > 1 ? 'var(--red)' : 'var(--muted)'}">${rsiCount[r.id] || 0}</td></tr>`;
      }).join("");
    })()}
    </tbody></table></div>` : `<div class="empty-state">${STATE.roster.length ? `No personnel in ${filterLabel()}.` : (STATE.authToken ? "Loading roster from sheet…" : "Not signed in — log in to sync.")}</div>`}`;
}

function renderAttendance(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700">Conducts</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="refreshLmsFromPolar()" title="Recount LMS participants for every conduct from STATE.polar (the Polar class summary photo is the LMS roster) and write into the attendance rows">🔄 Recompute LMS</button>
        <button class="btn btn-success" onclick="pushTab('Attendance',STATE.attendance)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <label class="btn admin-only" title="Admin: import one or many attendance CSV exports at once (Activity metadata + User/Unit/Status/Remarks). Each file = one conduct; ids auto-created. Present rows feed HA participation.">📥 Import CSV(s)
          <input type="file" accept=".csv" multiple onchange="importConductCSV(this)" style="display:none">
        </label>
        <button class="btn" onclick="showConductImportSchema()" title="Show the expected CSV / import format">ⓘ Format</button>
        <button class="btn btn-primary" onclick="openLogConductWizard()" title="One-shot wizard: date + time + conduct + Status Personnel checklist + bulk Report Sick / Fallout / RSI rows + auto totals + chat-format copy">+ Log Conduct</button>
      </div>
    </div>
    ${STATE.attendance.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Conduct</th><th title="Counts toward Heat Acclimatisation (click a cell to toggle)">HA</th><th>Total</th><th>Part.</th><th>LMS</th><th>Status</th><th>Fallout</th><th>Rate</th><th>LMS Rate</th><th style="text-align:left">Remarks</th><th></th></tr></thead><tbody>
    ${[...STATE.attendance].sort((a, b) => {
      // Newest first by date, then time (later in the day on top within a date).
      const ai = displayDateToISO(a.date) || a.date || "";
      const bi = displayDateToISO(b.date) || b.date || "";
      if (ai !== bi) return ai < bi ? 1 : -1;
      return (a.time || "") < (b.time || "") ? 1 : -1;
    }).map(a => {
      const r = pct(a.participating, a.total);
      const lms = +a.lms || 0;
      const lmsRate = pct(lms, a.participating);
      const rateColor = r >= 95 ? 'var(--green)' : r >= 70 ? 'var(--orange)' : 'var(--red)';
      const lmsRateColor = a.participating ? (lmsRate >= 95 ? 'var(--green)' : lmsRate >= 70 ? 'var(--orange)' : 'var(--red)') : 'var(--muted)';
      const time = fmtHrs(a.time) || '—';
      // HA-eligibility cell (§14.3). The verdict shown must mirror what computeHA
      // (haCountsRow) actually does, or the column lies. For WIZARD rows that is
      // ALWAYS the currencyTags HA token — the per-conduct "Counts toward HA"
      // checkbox stamped it, independent of haEligibilitySource — so the toggle
      // stays live even under the legacy isHAExcluded name-config. CSV rows follow
      // the configured source: a live toggle under 'currencyTag', else a read-only
      // name-logic verdict. Legacy wizard rows (source "") predate participant
      // tracking and are never HA-eligible.
      const tagSrc = configGet("haEligibilitySource") === "currencyTag";
      const isWizard = a.source === "wizard";
      const haOn = isWizard ? haCountsRow(a) : conductHAEligible(a);
      const toggleable = isWizard || tagSrc;   // the currencyTags token is the live signal
      const haCell = (a.source !== "csv" && a.source !== "wizard")
        ? `<span style="color:var(--dim)" title="Legacy wizard conduct — re-save it in the wizard with 'Counts toward HA' to include it">—</span>`
        : toggleable
          ? `<button class="btn btn-icon" onclick="toggleConductHA(${a.id})" style="color:${haOn ? 'var(--green)' : 'var(--dim)'};font-weight:700" title="${haOn ? 'Counts toward HA — click to exclude' : 'Not an HA conduct — click to count it toward HA'}">${haOn ? 'HA ✓' : 'HA ✕'}</button>`
          : `<span style="color:${haOn ? 'var(--green)' : 'var(--dim)'}" title="Eligibility comes from the conduct name (Config haEligibilitySource = 'isHAExcluded'); set it to 'currencyTag' to toggle per conduct">${haOn ? 'HA' : '—'}</span>`;
      return `<tr><td>${a.date}</td><td class="mono" style="color:${a.time ? 'var(--text)' : 'var(--dim)'}">${time}</td><td style="text-align:left">${escapeHTML(conductName(a.conductId))}</td><td>${haCell}</td><td>${a.total}</td><td>${a.participating}</td><td style="color:${lms > 0 ? 'var(--accent)' : 'var(--muted)'}">${lms}</td><td style="color:${a.px > 0 ? 'var(--orange)' : 'var(--muted)'}">${a.px}</td><td style="color:${a.fallout > 0 ? 'var(--red)' : 'var(--muted)'}">${a.fallout}</td><td style="font-weight:700;color:${rateColor}">${r}%</td><td style="font-weight:700;color:${lmsRateColor}">${a.participating ? lmsRate + '%' : '—'}</td><td style="text-align:left;color:${a.remarks ? 'var(--yellow)' : 'var(--muted)'};max-width:200px;white-space:normal;font-size:11px">${escapeHTML(a.remarks || '')}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="copyConductChatFormat(${a.id})" title="Copy WhatsApp-format parade state message">📋</button> <button class="btn btn-icon" onclick="openLogConductWizard(${a.id})" title="Edit conduct (wizard)">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('attendance', ${a.id}, 'attendance entry')" title="Delete">✕</button></td></tr>`;
    }).join("")}
    </tbody></table></div>` : `<div class="empty-state">No attendance records yet.</div>`}`;
}

// ── Conduct Detail tab ────────────────────────────────────
// Filters are module-scope rather than persisted — they reset on reload so a
// returning user sees the whole picture instead of yesterday's filter state.
let _detailFilterConduct = "";
let _detailFilterType = "";
let _showParticipants = false;
function setDetailFilterConduct(v) { _detailFilterConduct = v; _showParticipants = false; render(); }
function setDetailFilterType(v) { _detailFilterType = v; render(); }
function clearDetailFilters() { _detailFilterConduct = ""; _detailFilterType = ""; _showParticipants = false; render(); }
function toggleParticipants() { _showParticipants = !_showParticipants; render(); }

// When a single conduct is selected, derive who participated from
// `roster - absent` (the user's insight: detail rows enumerate absentees, so
// the inverse gives us the participants for free, no extra data needed).
function renderDetailParticipantsSummary(scopedAll) {
  if (!_detailFilterConduct) return "";
  const conductRecords = scopedAll.filter(d => `${d.date}|${d.time || ""}|${d.conductId || ""}` === _detailFilterConduct);
  // "PXP" = present doing stretches → NOT absent; exclude it from the absent set
  // so PX people aren't subtracted from "participated" or tallied as no-shows.
  const absentRecords = conductRecords.filter(d => d.type !== "PXP");
  const absentSet = new Set(absentRecords.map(d => d.d4));
  const inScope = filteredRoster();
  const participants = inScope.filter(r => !absentSet.has(r.id));
  const ct = t => conductRecords.filter(d => d.type === t).length;
  return `
    <div class="card" style="padding:10px 14px;margin-bottom:12px;background:var(--surface2)">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;flex-wrap:wrap;gap:8px">
        <div>
          <span style="color:var(--muted)">This conduct →</span>
          <strong style="color:var(--green)">Participated: ${participants.length}</strong>
          <span style="color:var(--muted)"> · </span>
          <strong style="color:var(--red)">Absent: ${absentSet.size}</strong>
          <span style="color:var(--muted)"> (Status ${ct("Status")} · RSI ${ct("RSI")} · Fallout ${ct("Fallout")} · ReportSick ${ct("ReportSick")}${ct("PXP") ? ` · PX ${ct("PXP")} present` : ""})</span>
        </div>
        <button class="btn" onclick="toggleParticipants()">${_showParticipants ? "▾ Hide" : "▸ Show"} participants (${participants.length})</button>
      </div>
      ${_showParticipants ? `<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">
        ${participants.length ? participants.map(r => `<button onclick="openPerson('${r.id}')" style="cursor:pointer;font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--accent);font-family:'JetBrains Mono',monospace;font-weight:700" title="${escapeAttr(r.name)}">${r.id}</button>`).join("") : `<span style="color:var(--muted);font-size:11px">No participants in current scope</span>`}
      </div>` : ""}
    </div>`;
}

function renderConductDetail(el) {
  const visible = visibleD4Set();
  const scopedAll = STATE.conductDetail.filter(d => passesFilter(d.d4, visible));
  let scoped = scopedAll;
  if (_detailFilterConduct) scoped = scoped.filter(d => `${d.date}|${d.time || ""}|${d.conductId || ""}` === _detailFilterConduct);
  if (_detailFilterType) scoped = scoped.filter(d => d.type === _detailFilterType);

  // Unique conduct keys for the dropdown — newest first by parsed date.
  const conductKeys = [...new Set(scopedAll.map(d => `${d.date}|${d.time || ""}|${d.conductId || ""}`))]
    .filter(Boolean)
    .sort((a, b) => {
      const [ad, at] = a.split("|"), [bd, bt] = b.split("|");
      const ai = displayDateToISO(ad) || ad;
      const bi = displayDateToISO(bd) || bd;
      if (ai !== bi) return ai < bi ? 1 : -1;
      return (at || "") < (bt || "") ? 1 : -1;
    });

  // Sort the visible records the same way — newest-first feels right when
  // scanning for "what happened today / yesterday."
  let rows = [...scoped].sort((a, b) => {
    const ai = displayDateToISO(a.date) || a.date || "";
    const bi = displayDateToISO(b.date) || b.date || "";
    if (ai !== bi) return ai < bi ? 1 : -1;
    return (a.time || "") < (b.time || "") ? 1 : -1;
  });
  // D1: name/4D search on top of the conduct/type sub-filters.
  rows = listSearchFilter("conduct", rows);

  // ReportSick dedupes per (d4, date) — a single recruit who fell out of
  // multiple conducts on the same day only went to MO once. The other
  // types remain as row counts (each row = a distinct conduct event).
  const cnt = t => {
    const rows = scoped.filter(d => d.type === t);
    if (t === "ReportSick") return new Set(rows.map(d => `${d.d4}|${d.date}`)).size;
    return rows.length;
  };

  // "Most conducts missed" ignores the conduct/type sub-filter so the ranking
  // remains a stable view of overall absence within the platoon scope.
  const missed = {};
  scopedAll.forEach(d => {
    const k = `${d.date}|${d.time || ""}|${d.conductId || ""}`;
    (missed[d.d4] = missed[d.d4] || new Set()).add(k);
  });
  const topMissed = Object.entries(missed)
    .map(([d4, set]) => ({ d4, count: set.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const typeBadgeColor = t => t === "Status" ? "orange" : t === "PXP" ? "teal" : t === "RSI" ? "red" : t === "Fallout" ? "purple" : "yellow";
  const totalConducts = [...new Set(scopedAll.map(d => `${d.date}|${d.time || ""}|${d.conductId || ""}`))].length;
  const titleSuffix = isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scopedAll.length}/${STATE.conductDetail.length}]</span>` : ` (${STATE.conductDetail.length})`;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="font-size:18px;font-weight:700">Conduct Detail${titleSuffix}</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-success" onclick="pushTab('ConductDetail',STATE.conductDetail)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="openConductDetailForm()">+ Log</button>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><label>Status (pre-existing)</label><div class="val" style="color:var(--orange)">${cnt("Status")}</div></div>
      <div class="stat"><label>RSI (1st parade)</label><div class="val" style="color:var(--red)">${cnt("RSI")}</div></div>
      <div class="stat"><label>Fallout (mid-conduct)</label><div class="val" style="color:var(--purple)">${cnt("Fallout")}</div></div>
      <div class="stat"><label>Reported Sick (mid-day)</label><div class="val" style="color:var(--yellow)">${cnt("ReportSick")}</div></div>
      ${cnt("PXP") ? `<div class="stat"><label>PX (present, stretches)</label><div class="val" style="color:var(--teal)">${cnt("PXP")}</div></div>` : ""}
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
      <span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Filter:</span>
      <select onchange="setDetailFilterConduct(this.value)" class="topbar-select" style="min-width:260px">
        <option value="">All conducts (${totalConducts})</option>
        ${conductKeys.map(k => { const [dt, tm, cid] = k.split("|"); return `<option value="${escapeAttr(k)}" ${k === _detailFilterConduct ? "selected" : ""}>${dt}${tm ? " " + fmtHrs(tm) : ""} — ${escapeHTML(conductName(cid) || "(unknown)")}</option>`; }).join("")}
      </select>
      <select onchange="setDetailFilterType(this.value)" class="topbar-select">
        <option value="">All types</option>
        ${[["Status","Status"],["PXP","PX (present)"],["RSI","RSI"],["Fallout","Fallout"],["ReportSick","Report Sick"]].map(([val,lab]) => `<option value="${val}" ${val === _detailFilterType ? "selected" : ""}>${lab}</option>`).join("")}
      </select>
      ${listSearchInput("conduct", "Search name / 4D…")}
      ${(_detailFilterConduct || _detailFilterType) ? `<button class="btn" onclick="clearDetailFilters()">Reset</button>` : ""}
    </div>
    ${renderDetailParticipantsSummary(scopedAll)}
    <div class="grid-2" style="grid-template-columns:2fr 1fr;align-items:start">
      <div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th style="text-align:left">Conduct</th><th>4D</th><th style="text-align:left">Name</th><th>Type</th><th style="text-align:left">Reason</th><th></th></tr></thead><tbody>
        ${rows.map(d => `<tr onclick="openPerson('${d.d4}')" style="cursor:pointer"><td>${d.date || ""}</td><td class="mono">${fmtHrs(d.time) || "—"}</td><td style="text-align:left">${escapeHTML(conductName(d.conductId))}</td><td class="mono" style="font-weight:700;color:var(--accent)">${d.d4}</td><td style="text-align:left">${escapeHTML(getName(d.d4))}</td><td>${badge(d.type, typeBadgeColor(d.type))}</td><td style="text-align:left;max-width:280px;white-space:normal;font-size:11px">${escapeHTML(d.reason || "")}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="event.stopPropagation(); openConductDetailForm(${d.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('conductDetail', ${d.id}, 'conduct detail record')" title="Delete">✕</button></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty-state">${STATE.conductDetail.length ? "No records match current filter." : "No conduct detail records yet. Tap + Log to add one."}</div>`}
      </div>
      <div class="card">
        <h3>Most Conducts Missed${isFilterActive() ? ` <span style="color:var(--accent);font-weight:400;font-size:10px">in ${filterLabel()}</span>` : ""}</h3>
        ${topMissed.length ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto">
          ${topMissed.map(m => `<div onclick="openPerson('${m.d4}')" style="cursor:pointer;font-size:11px;padding:6px 8px;border-radius:4px;background:var(--surface2);display:flex;justify-content:space-between;gap:8px">
            <span><span class="mono" style="color:var(--accent);font-weight:700">${m.d4}</span> ${escapeHTML(getName(m.d4))}</span>
            <span class="mono" style="font-weight:700;color:${m.count >= 5 ? "var(--red)" : m.count >= 3 ? "var(--orange)" : "var(--muted)"}">${m.count}</span>
          </div>`).join("")}
        </div>` : `<div style="color:var(--muted);font-size:12px">No data yet</div>`}
      </div>
    </div>`;
}

// Report Sick Log date-range filter (by the REPORTED date). Both bounds
// optional; ISO strings straight from the <input type="date"> controls, which
// live in the toolbar (outside #med-results) so they survive a rows-only re-render.
let _medDateFrom = "", _medDateTo = "";
function medDatesActive() { return !!(_medDateFrom || _medDateTo); }
// Highlight the date-filter control while a bound is set. The filter state lives
// in module vars that survive tab navigation and scope changes, so without a
// visible cue a filter set earlier keeps silently hiding rows. The toolbar isn't
// re-rendered on a rows-only refresh, so we restyle the container directly here
// (mirrors main.js's pltSel.classList.toggle("active") pattern).
function medSyncDateFilterUI() {
  const box = document.getElementById("med-date-filter");
  if (!box) return;
  const on = medDatesActive();
  box.style.borderColor = on ? "var(--accent)" : "var(--border)";
  box.style.color = on ? "var(--accent)" : "var(--muted)";
}
function medSetDateFrom(v) { _medDateFrom = v; renderMedicalRows(); medSyncDateFilterUI(); }
function medSetDateTo(v) { _medDateTo = v; renderMedicalRows(); medSyncDateFilterUI(); }
function medClearDates() {
  _medDateFrom = ""; _medDateTo = "";
  const f = document.getElementById("med-date-from"); if (f) f.value = "";
  const t = document.getElementById("med-date-to"); if (t) t.value = "";
  renderMedicalRows();
  medSyncDateFilterUI();
}
// Short weekday for a display date ("15 Jun 2026" → "Mon"). Fixed array rather
// than toLocaleDateString so it's locale-stable. "" when the date can't parse.
const _DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function medDayOfWeek(displayDate) {
  const iso = displayDateToISO(displayDate) || "";
  if (!iso) return "";
  return _DOW_SHORT[new Date(iso + "T00:00:00").getDay()] || "";
}

function renderMedical(el) {
  const visible = visibleD4Set();
  const scoped = STATE.medical.filter(m => passesFilter(m.d4, visible));
  const today = todayISO();
  // Per-row "tag today" reflects whether the status is currently active, in
  // its +1/+2 ghost window, or fully cleared.
  const rowsWithTag = scoped.map(m => ({ m, tagInfo: medStatusTag(m, today) }));
  // Sort newest first by startDate (fallback to date logged).
  rowsWithTag.sort((a, b) => {
    const ai = displayDateToISO(a.m.startDate || a.m.date) || "";
    const bi = displayDateToISO(b.m.startDate || b.m.date) || "";
    return ai < bi ? 1 : ai > bi ? -1 : 0;
  });
  const activeCount = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay === 0).length;
  const ghostCount = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay > 0).length;
  const pendingCount = scoped.filter(m => m.status === "Pending").length;

  // R/C breakdown — same logic as the dashboard: only shown when "All" is
  // the active role scope, so the stat is double-clickable for "is this a
  // recruit-side problem or a commander problem?"
  const isAll = !STATE.filterRole;
  const splitC = pred => ({
    rec: scoped.filter(m => pred(m) && !isCommander(m.d4)).length,
    cmd: scoped.filter(m => pred(m) && isCommander(m.d4)).length
  });
  const activeSplit = (() => {
    const rec = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay === 0 && !isCommander(r.m.d4)).length;
    const cmd = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay === 0 && isCommander(r.m.d4)).length;
    return { rec, cmd };
  })();
  const recoveringSplit = (() => {
    const rec = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay > 0 && !isCommander(r.m.d4)).length;
    const cmd = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay > 0 && isCommander(r.m.d4)).length;
    return { rec, cmd };
  })();
  const pendingSplit = splitC(m => m.status === "Pending");
  const inlineBreakdown = ({ rec, cmd }) => isAll
    ? `<span style="font-size:55%;color:var(--muted);font-weight:400;margin-left:1px">/${rec}/${cmd}</span>`
    : "";

  // Total unique (d4, date) pairs across the whole scope — drives the
  // "Total report sicks" tile so it matches the leaderboard semantics.
  const totalReportSickDays = new Set(scoped.map(m => `${m.d4}|${m.date}`)).size;
  const totalReportSickDaysSplit = {
    rec: new Set(scoped.filter(m => !isCommander(m.d4)).map(m => `${m.d4}|${m.date}`)).size,
    cmd: new Set(scoped.filter(m => isCommander(m.d4)).map(m => `${m.d4}|${m.date}`)).size
  };

  el.innerHTML = `
    <div class="tab-toolbar">
      <h2 class="tab-title" style="font-size:18px;font-weight:700">Report Sick Log${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.medical.length}]</span>` : ""}</h2>
      <div class="tab-actions">
        <button class="btn" onclick="exportMCList()" title="Export everyone currently on MC in this scope to CSV (Warded is not MC — it appears in the Status Board export). The scope is in the filename.">⭳<span class="btn-label"> MC list CSV</span></button>
        <button class="btn btn-success" onclick="pushTab('Medical',STATE.medical)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻<span class="btn-label"> Re-push all</span></button>
        <label class="btn admin-only" style="cursor:pointer" title="Admin: import a colour-coded RSI/RSO REC sheet (xlsx). Cell fill colour = status, text = reason. Previews before committing.">📥<span class="btn-label"> Import Sick History (xlsx)</span><input type="file" accept=".xlsx" onchange="importSickHistoryXLSX(this)" style="display:none"></label>
        ${listSearchInput("medical", "Search name / 4D…")}
        <span id="med-date-filter" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:${medDatesActive() ? "var(--accent)" : "var(--muted)"};border:1px solid ${medDatesActive() ? "var(--accent)" : "var(--border)"};border-radius:6px;padding:2px 6px" title="Filter the list by reported date">
          <input type="date" id="med-date-from" value="${_medDateFrom}" onchange="medSetDateFrom(this.value)" style="padding:4px 6px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:11px">
          <span>–</span>
          <input type="date" id="med-date-to" value="${_medDateTo}" onchange="medSetDateTo(this.value)" style="padding:4px 6px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:11px">
          <button class="btn btn-icon" onclick="medClearDates()" title="Clear date filter">✕</button>
        </span>
        <button class="btn btn-primary" onclick="openMedicalForm()">+<span class="btn-label"> Log Report Sick</span></button>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><label>Total report sicks</label><div class="val" title="Unique (recruit, date) — multiple medical rows on the same day count as one event">${totalReportSickDays}${inlineBreakdown(totalReportSickDaysSplit)}</div></div>
      <div class="stat"><label>Active today</label><div class="val" style="color:var(--red)">${activeCount}${inlineBreakdown(activeSplit)}</div></div>
      <div class="stat"><label>Recovering</label><div class="val" style="color:var(--orange)">${ghostCount}${inlineBreakdown(recoveringSplit)}</div></div>
      <div class="stat"><label>Pending</label><div class="val" style="color:var(--muted)">${pendingCount}${inlineBreakdown(pendingSplit)}</div></div>
    </div>
    <div id="med-results"></div>`;
  registerListRenderer("medical", renderMedicalRows);
  renderMedicalRows();
}
// Feature 29 stacking. A grouped visit renders its Status / Start / End / Today
// cells as one line per status, and every one of those columns must use THIS
// helper so the four stay aligned row-for-row — a badge and a bare date string
// have different natural heights, so the fixed min-height is what keeps line 2
// of Status level with line 2 of End. A single-status group produces exactly one
// line, i.e. the pre-grouping appearance, so nothing shifts for the common case.
//
// Reason, location, visit type and the reported date deliberately do NOT stack:
// submitMedical writes them identically to every sibling, so stacking would just
// repeat the same text N times.
// nowrap is load-bearing here, not cosmetic: the four columns stack
// independently, so if one column's line 2 wraps to two lines ("EXCUSE RMJ",
// "27 Jul 2026") while its neighbour's does not, every line below drifts out of
// register and the row starts pairing the wrong status with the wrong end date.
//
// It is applied ONLY to genuinely multi-status groups. Forcing it on every row
// widened the table by ~120px at a 1280 viewport — enough to push the Edit /
// Delete column behind .table-wrap's horizontal scroll — and a single-status
// group has nothing to align against, so it pays that cost for no benefit.
function medStack(grp, fn) {
  const nowrap = grp.rows.length > 1 ? "white-space:nowrap;" : "";
  return grp.rows.map(r =>
    `<div style="min-height:22px;${nowrap}display:flex;align-items:center;justify-content:center">${fn(r)}</div>`).join("");
}
// Pending / NIL carry no date window, so their Start and End render an em dash
// rather than blank. Per-status, not per-visit: one sibling can be a dated LD
// while another is still Pending.
function medNoDur(r) { return r.status === "Pending" || r.status === "NIL"; }

function renderMedicalRows() {
  const host = document.getElementById("med-results");
  if (!host) return;
  const visible = visibleD4Set();
  const scoped = STATE.medical.filter(m => passesFilter(m.d4, visible));
  const today = todayISO();
  const rowsWithTag = scoped.map(m => ({ m, tagInfo: medStatusTag(m, today) }));
  rowsWithTag.sort((a, b) => {
    const ai = displayDateToISO(a.m.startDate || a.m.date) || "";
    const bi = displayDateToISO(b.m.startDate || b.m.date) || "";
    return ai < bi ? 1 : ai > bi ? -1 : 0;
  });
  const _medQ = listCtl("medical").q.trim().toLowerCase();
  let medRows = _medQ
    ? rowsWithTag.filter(({ m }) => { const nm = (getName(m.d4) || "").toLowerCase(); return nm.includes(_medQ) || String(m.d4).toLowerCase().includes(_medQ); })
    : rowsWithTag;
  // Reported-date range (list rows only — mirrors how the search box scopes the
  // list but not the stats tiles / "Most Reports Sick" panel). ISO compares work
  // directly since both the bounds and displayDateToISO output are YYYY-MM-DD.
  if (_medDateFrom || _medDateTo) {
    medRows = medRows.filter(({ m }) => {
      // Fall back to startDate when `date` (the reported date) is blank — some
      // imported/auto-created rows carry only a status window — so a record with
      // a real date range isn't silently dropped the moment a bound is set.
      // Mirrors the "reported" sort key (startDate || date). Only rows with no
      // usable date at all fall out.
      const iso = displayDateToISO(m.date) || displayDateToISO(m.startDate) || "";
      if (!iso) return false;
      if (_medDateFrom && iso < _medDateFrom) return false;
      if (_medDateTo && iso > _medDateTo) return false;
      return true;
    });
  }
  medRows = listApplySort("medical", medRows, {
    reported: x => displayDateToISO(x.m.startDate || x.m.date) || "",
    fourD: x => x.m.d4 || "",
    name: x => getName(x.m.d4) || "",
    status: x => x.m.status || ""
  });
  // Leaderboard: count UNIQUE report-sick days per recruit within the scope.
  const rsDaySets = {};
  scoped.forEach(m => { (rsDaySets[m.d4] = rsDaySets[m.d4] || new Set()).add(m.date); });
  const topReporters = Object.entries(rsDaySets)
    .map(([d4, days]) => ({ d4, count: days.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  // Feature 29: one row per VISIT, not per status. Grouped AFTER the search /
  // date filter and the sort, so a filter that matches only one sibling still
  // shows just that sibling — the list must never claim a row the filter
  // excluded. The group inherits the sort position of its first surviving
  // sibling (see groupByVisit), which keeps the date ordering stable even when
  // two statuses of one visit carry different start dates.
  const medVisitGroups = groupByVisit(medRows.map(x => x.m));
  host.innerHTML = `
    <div class="grid-2" style="grid-template-columns:2fr 1fr;align-items:start">
      <div>
        ${medVisitGroups.length ? `<div class="table-wrap"><table><thead><tr>${sortTh("medical", "reported", "Reported")}${sortTh("medical", "fourD", "4D")}${sortTh("medical", "name", "Name", "left")}<th style="text-align:left">Reason</th>${sortTh("medical", "status", "Status")}<th>Start</th><th>End</th><th>Today</th><th></th></tr></thead><tbody>
        ${medVisitGroups.map(grp => { const m = grp.first; const _dow = m.date ? medDayOfWeek(m.date) : ""; const multi = grp.rows.length > 1; return `<tr onclick="openPerson('${m.d4}')" style="cursor:pointer"><td style="white-space:nowrap">${m.date || ""}${_dow ? ` <span style="color:var(--dim);font-size:10px">${_dow}</span>` : ""}</td><td class="mono" style="font-weight:700;color:var(--accent)">${displayId(m.d4)}</td><td style="text-align:left">${escapeHTML(displayPersonLabel(m.d4))}</td><td style="text-align:left">${medTypeBadge(m)}${escapeHTML(m.reason || "")}${m.urtiType ? `<span style="font-size:9px;color:var(--dim);margin-left:5px">${escapeHTML(m.urtiType)}</span>` : ""}${m.origin === "conductLog" ? `<span class="badge badge-teal" style="font-size:8px;margin-left:5px" title="Auto-created from a conduct import/log — confirm the MO outcome">from conduct log</span>` : ""}${m.location ? `<div style="font-size:10px;color:var(--muted)">📍 ${escapeAttr(m.location)}</div>` : ""}${multi ? `<div style="font-size:10px;color:var(--muted)">${grp.rows.length} statuses from one visit</div>` : ""}</td><td>${medStack(grp, r => r.status ? medTagBadge(r.status) : '<span style="color:var(--muted)">—</span>')}</td><td>${medStack(grp, r => r.startDate || (medNoDur(r) ? '<span style="color:var(--muted)">—</span>' : ""))}</td><td>${medStack(grp, r => r.endDate || (medNoDur(r) ? '<span style="color:var(--muted)">—</span>' : ""))}</td><td>${medStack(grp, r => { const ti = medStatusTag(r, today); return ti ? medTagBadge(ti.tag) : '<span style="color:var(--dim)">cleared</span>'; })}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="event.stopPropagation(); openMedicalForm(${JSON.stringify(m.id)})" title="${multi ? "Edit this visit (all statuses)" : "Edit"}">✎</button> ${medStack(grp, r => `<button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('medical', ${JSON.stringify(r.id)}, ${multi ? "'status'" : "'medical record'"})" title="${multi ? `Delete just the ${escapeAttr(r.status || "status")} line` : "Delete"}">✕</button>`)}</td></tr>`; }).join("")}
        </tbody></table></div>` : `<div class="empty-state">${_medQ ? "No records match the search." : (STATE.medical.length ? `No report sick records in ${filterLabel()}.` : "No report sick records yet.")}</div>`}
      </div>
      <div class="card">
        <h3>Most Reports Sick${isFilterActive() ? ` <span style="color:var(--accent);font-weight:400;font-size:10px">in ${filterLabel()}</span>` : ""}</h3>
        ${topReporters.length ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto">
          ${topReporters.map(r => `<div onclick="openPerson('${r.d4}')" style="cursor:pointer;font-size:11px;padding:6px 8px;border-radius:4px;background:var(--surface2);display:flex;justify-content:space-between;gap:8px">
            <span>${displayId(r.d4) ? `<span class="mono" style="color:var(--accent);font-weight:700">${displayId(r.d4)}</span> ` : ""}${escapeHTML(displayPersonLabel(r.d4))}</span>
            <span class="mono" style="font-weight:700;color:${r.count >= 5 ? "var(--red)" : r.count >= 3 ? "var(--orange)" : "var(--muted)"}">${r.count}</span>
          </div>`).join("")}
        </div>` : `<div style="color:var(--muted);font-size:12px">No data yet</div>`}
      </div>
    </div>`;
}

function renderIPPT(el) {
  const visible = visibleD4Set();
  const scoped = STATE.ippt.filter(i => passesFilter(i.d4, visible));

  // Aggregate one entry per recruit (latest or best) for the stats/charts/
  // leaderboard. The underlying table below still shows every row.
  const aggMode = STATE.ipptAggMode || "latest";
  const aggregated = aggregateIPPT(scoped, aggMode);
  const stats = computeIPPTStats(aggregated);

  // YTT chase: recruits in the filtered scope who either have an all-zero
  // IPPT row OR have no IPPT row at all — both are "haven't taken yet".
  const rosterInScope = filteredRoster();
  const takenD4s = new Set(scoped.filter(e => !isYTT(e)).map(e => e.d4));
  const yttRecruits = rosterInScope.filter(r => !takenD4s.has(r.id));

  // Top performers: aggregated, sorted by score desc, YTT excluded.
  const topPerformers = aggregated
    .filter(e => !isYTT(e))
    .slice()
    .sort((a, b) => (+b.score || 0) - (+a.score || 0))
    .slice(0, 10);

  // Score-distribution buckets aligned to award thresholds:
  // [YTT, Fail 0–60, Pass 61–74, Silver 75–84, Gold 85–89, Gold★ 90+]
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const e of aggregated) {
    if (isYTT(e)) { buckets[0]++; continue; }
    const s = +e.score || 0;
    if (s <= 60) buckets[1]++;
    else if (s <= 74) buckets[2]++;
    else if (s <= 84) buckets[3]++;
    else if (s <= 89) buckets[4]++;
    else buckets[5]++;
  }

  // ── D2: table view selector (All / by attempt # / by date) ────────────────
  const attemptsAvail = [...new Set(scoped.map(e => e.attempt).filter(a => a !== "" && a != null))].sort((a, b) => (+a) - (+b));

  // ── Cross-attempt cohort (progression / compare / award-mix charts) ────────
  // Shared model so all three cross-attempt charts agree on who counts.
  const ipptSeries = ipptSeriesByRecruit(scoped);
  const attemptNums = attemptsAvail.map(Number).filter(n => n > 0);
  const hasMultiAttempt = attemptNums.length >= 2;
  // Compare picker A→B: default first vs last available attempt; re-validate the
  // stored pick against the current attempt set so a stale value can't survive a
  // scope/data change.
  let cmpA = +_ipptCmpA, cmpB = +_ipptCmpB;
  if (!attemptNums.includes(cmpA)) cmpA = attemptNums[0];
  if (!attemptNums.includes(cmpB) || cmpB === cmpA) cmpB = attemptNums[attemptNums.length - 1];
  const datesAvail = [...new Set(scoped.map(e => e.date).filter(Boolean))].sort((a, b) => (displayDateToISO(b) || "").localeCompare(displayDateToISO(a) || ""));
  const ipptView = _ipptView || "all";
  let tableRows = scoped;
  if (ipptView.startsWith("att:")) tableRows = scoped.filter(e => String(e.attempt) === ipptView.slice(4));
  else if (ipptView.startsWith("date:")) tableRows = scoped.filter(e => e.date === ipptView.slice(5));
  // D1: name/4D search + sortable columns.
  tableRows = listSearchFilter("ippt", tableRows);
  tableRows = listApplySort("ippt", tableRows, {
    fourD: e => e.d4 || "", name: e => getName(e.d4) || "", attempt: e => +e.attempt || 0,
    date: e => displayDateToISO(e.date) || e.date || "", score: e => isYTT(e) ? -1 : (+e.score || 0),
    pushups: e => +e.pushups || 0, situps: e => +e.situps || 0
  });

  // ── D3: mean/median total score over time (non-YTT, grouped by date) ──────
  const byDate = {};
  scoped.filter(e => !isYTT(e)).forEach(e => { const iso = displayDateToISO(e.date) || e.date || ""; (byDate[iso] = byDate[iso] || []).push(+e.score || 0); });
  const trendDates = Object.keys(byDate).filter(Boolean).sort();
  const _median = arr => { const s = arr.slice().sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  const ipptTrend = {
    labels: trendDates.map(iso => isoToDisplayDate(iso) || iso),
    mean: trendDates.map(iso => Math.round(byDate[iso].reduce((a, b) => a + b, 0) / byDate[iso].length)),
    median: trendDates.map(iso => Math.round(_median(byDate[iso])))
  };

  // ── D3: static (push-up + sit-up) vs run (2.4km) strength on latest attempt.
  // Compares each recruit's static station score (out of 50) against their run
  // score (out of 50) from the SAF tables; a ±2-point band counts as balanced.
  const latestForStrength = aggregateIPPT(scoped, "latest");
  const strength = { static: [], run: [], balanced: [], unknown: 0 };
  latestForStrength.filter(e => !isYTT(e)).forEach(e => {
    const r = STATE.roster.find(x => x.id === e.d4);
    const age = r && r.age;
    const res = age ? calculateIPPTScore(age, e.pushups, e.situps, e.runTime) : null;
    if (!res) { strength.unknown++; return; }
    const stat = (res.pushupScore || 0) + (res.situpScore || 0), run = res.runScore || 0;
    if (stat > run + 2) strength.static.push(e.d4);
    else if (run > stat + 2) strength.run.push(e.d4);
    else strength.balanced.push(e.d4);
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 style="font-size:18px;font-weight:700">IPPT Tracker${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.ippt.length}]</span>` : ""}</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label class="btn" style="cursor:pointer">Import CSV<input type="file" accept=".csv" onchange="importIPPT(this)" style="display:none"></label>
        <button class="btn btn-success" onclick="pushTab('IPPT',STATE.ippt)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="openIPPTForm()">+ Add</button>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Stats use</span>
      <div class="filter-role-group">
        <button class="role-btn ${aggMode === "latest" ? "active" : ""}" onclick="setIpptAggMode('latest'); render()">Latest</button>
        <button class="role-btn ${aggMode === "best" ? "active" : ""}" onclick="setIpptAggMode('best'); render()">Best</button>
      </div>
      <span style="font-size:11px;color:var(--muted)">attempt per recruit</span>
    </div>

    <div class="stats-row">
      <div class="stat"><label>Taken</label><div class="val">${stats.taken}<span style="font-size:12px;color:var(--muted);font-weight:400">/${stats.total}</span></div><div class="sub">${pct(stats.taken, stats.total)}% recorded</div></div>
      <div class="stat"><label>Passed (61+)</label><div class="val" style="color:var(--green)">${stats.passed}</div><div class="sub">${pct(stats.passed, stats.taken)}% of taken</div></div>
      <div class="stat"><label>Failed</label><div class="val" style="color:var(--red)">${stats.fail}</div><div class="sub">${pct(stats.fail, stats.taken)}% of taken</div></div>
      <div class="stat"><label>YTT</label><div class="val" style="color:var(--accent)">${stats.ytt}</div><div class="sub">yet to take</div></div>
      <div class="stat"><label>Avg Score</label><div class="val" style="color:var(--accent)">${stats.avgScore || "—"}</div><div class="sub">${stats.scoreN} results</div></div>
      <div class="stat"><label>Avg 2.4km</label><div class="val" style="color:var(--accent)">${formatSeconds(stats.avgRunSec)}</div><div class="sub">${stats.runSecN} results</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Award Breakdown${isFilterActive() ? ` <span style="color:var(--accent);font-weight:400;font-size:10px">in ${filterLabel()}</span>` : ""}</h3>
        <div class="chart-box tall"><canvas id="chart-ippt-awards"></canvas></div>
      </div>
      <div class="card">
        <h3>Score Distribution</h3>
        <div class="chart-box tall"><canvas id="chart-ippt-distribution"></canvas></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>YTT Chase List <span style="color:var(--accent);font-weight:400;font-size:10px">${yttRecruits.length} to chase</span></h3>
        ${yttRecruits.length ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto">
          ${yttRecruits.map(r => `<div onclick="openPerson('${r.id}')" style="cursor:pointer;font-size:11px;padding:6px 8px;border-radius:4px;background:var(--surface2);display:flex;justify-content:space-between;gap:8px;align-items:center">
            <span>${displayId(r.id) ? `<span class="mono" style="color:var(--accent);font-weight:700">${displayId(r.id)}</span> ` : ""}${escapeHTML(displayPersonLabel(r.id))}</span>
            <span class="badge badge-accent" style="font-size:9px">YTT</span>
          </div>`).join("")}
        </div>` : `<div style="color:var(--muted);font-size:12px;padding:8px">Everyone in scope has taken IPPT 🎉</div>`}
      </div>
      <div class="card">
        <h3>Top Performers <span style="color:var(--muted);font-weight:400;font-size:10px">by ${aggMode === "best" ? "best" : "latest"} attempt</span></h3>
        ${topPerformers.length ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto">
          ${topPerformers.map((e, idx) => `<div onclick="openPerson('${e.d4}')" style="cursor:pointer;font-size:11px;padding:6px 8px;border-radius:4px;background:var(--surface2);display:flex;align-items:center;gap:8px">
            <span class="mono" style="font-weight:700;color:var(--muted);min-width:18px">#${idx + 1}</span>
            <span style="flex:1">${displayId(e.d4) ? `<span class="mono" style="color:var(--accent);font-weight:700">${displayId(e.d4)}</span> ` : ""}${escapeHTML(displayPersonLabel(e.d4))}</span>
            <span class="mono" style="font-weight:700">${e.score}</span>
            ${awardBadge(e.score)}
          </div>`).join("")}
        </div>` : `<div style="color:var(--muted);font-size:12px;padding:8px">No taken results yet.</div>`}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Score Over Time <span style="color:var(--muted);font-weight:400;font-size:10px">mean &amp; median total, by date</span></h3>
        ${trendDates.length ? `<div class="chart-box tall"><canvas id="chart-ippt-trend"></canvas></div>` : `<div style="color:var(--muted);font-size:12px;padding:8px">Need taken results on at least one date.</div>`}
      </div>
      <div class="card">
        <h3>Static vs Run Strength <span style="color:var(--muted);font-weight:400;font-size:10px">latest attempt</span></h3>
        <div style="font-size:12px;line-height:1.7">
          <div><span class="badge badge-yellow">Stronger static</span> <strong>${strength.static.length}</strong> <span style="color:var(--muted)">(push-ups + sit-ups &gt; 2.4km)</span></div>
          <div><span class="badge badge-accent">Stronger run</span> <strong>${strength.run.length}</strong> <span style="color:var(--muted)">(2.4km &gt; push-ups + sit-ups)</span></div>
          <div><span class="badge badge-green">Balanced</span> <strong>${strength.balanced.length}</strong> <span style="color:var(--muted)">(within ±2 pts)</span></div>
          ${strength.unknown ? `<div style="color:var(--dim);font-size:11px;margin-top:4px">${strength.unknown} not classified (age missing on roster — can't derive station scores)</div>` : ""}
          ${strength.static.length ? `<div style="margin-top:6px;font-size:11px;color:var(--muted)"><strong style="color:var(--yellow)">Static:</strong> ${strength.static.map(d4 => escapeAttr(getName(d4) || displayId(d4))).join(", ")}</div>` : ""}
          ${strength.run.length ? `<div style="margin-top:4px;font-size:11px;color:var(--muted)"><strong style="color:var(--accent)">Run:</strong> ${strength.run.map(d4 => escapeAttr(getName(d4) || displayId(d4))).join(", ")}</div>` : ""}
        </div>
      </div>
    </div>

    ${hasMultiAttempt ? `
    <div class="grid-2">
      <div class="card">
        <h3>Attempt Progression <span style="color:var(--muted);font-weight:400;font-size:10px">per recruit · <span style="color:var(--green)">green</span> up / <span style="color:var(--red)">red</span> down vs first · bold = company avg</span></h3>
        <div class="chart-box tall"><canvas id="chart-ippt-progress"></canvas></div>
      </div>
      <div class="card">
        <h3>Award Mix by Attempt <span style="color:var(--muted);font-weight:400;font-size:10px">% of takers per attempt</span></h3>
        <div class="chart-box tall"><canvas id="chart-ippt-awardmix"></canvas></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3 style="font-size:15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">Compare Attempts
        <select id="ippt-cmp-a" class="topbar-select" onchange="ipptComparePick()">${attemptNums.map(n => `<option value="${n}" ${n === cmpA ? "selected" : ""}>IPPT ${n}</option>`).join("")}</select>
        <span style="color:var(--muted)">→</span>
        <select id="ippt-cmp-b" class="topbar-select" onchange="ipptComparePick()">${attemptNums.map(n => `<option value="${n}" ${n === cmpB ? "selected" : ""}>IPPT ${n}</option>`).join("")}</select>
        <span id="ippt-cmp-summary" style="color:var(--muted);font-weight:400;font-size:11px"></span>
      </h3>
      <div class="chart-box tall"><canvas id="chart-ippt-compare"></canvas></div>
    </div>` : ""}

    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      ${listSearchInput("ippt", "Search name / 4D…")}
      <select onchange="setIpptView(this.value)" class="topbar-select" title="Filter the table to one attempt number or one date">
        <option value="all" ${ipptView === "all" ? "selected" : ""}>All attempts &amp; dates</option>
        <optgroup label="By attempt">${attemptsAvail.map(a => `<option value="att:${a}" ${ipptView === "att:" + a ? "selected" : ""}>Attempt ${a}</option>`).join("")}</optgroup>
        <optgroup label="By date">${datesAvail.map(d => `<option value="date:${escapeAttr(d)}" ${ipptView === "date:" + d ? "selected" : ""}>${escapeAttr(d)}</option>`).join("")}</optgroup>
      </select>
      <span style="font-size:11px;color:var(--muted)">${tableRows.length} row${tableRows.length === 1 ? "" : "s"}</span>
    </div>
    ${tableRows.length ? `<div class="table-wrap"><table><thead><tr>${sortTh("ippt", "fourD", "4D")}${sortTh("ippt", "name", "Name", "left")}${sortTh("ippt", "attempt", "#")}${sortTh("ippt", "date", "Date")}${sortTh("ippt", "pushups", "PU")}${sortTh("ippt", "situps", "SU")}<th>2.4km</th>${sortTh("ippt", "score", "Score")}<th>Award</th><th></th></tr></thead><tbody>
    ${tableRows.map(i => `<tr><td class="mono" style="font-weight:700">${displayId(i.d4)}</td><td style="text-align:left">${escapeHTML(displayPersonLabel(i.d4))}</td><td>${i.attempt}</td><td>${i.date}</td><td>${i.pushups}</td><td>${i.situps}</td><td>${i.runTime}</td><td style="font-weight:700;font-size:15px">${isYTT(i) ? '<span style="color:var(--muted)">—</span>' : i.score}</td><td>${ipptAwardBadge(i)}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="openIPPTForm(${i.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="deleteEntry('ippt', ${i.id}, 'IPPT entry')" title="Delete">✕</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">${STATE.ippt.length ? `No IPPT entries match the current scope / filter.` : "No IPPT data yet. Add results or import CSV."}</div>`}

    <!-- Feature 24: the accepted CSV shape used to be discoverable only by
         triggering the missing-column alert. Same card the Polar tab already
         carries; keep the column list in step with the aliases ipptUpsertRows
         actually resolves in js/forms.js. -->
    <div class="card" style="margin-top:16px"><h3>Expected CSV Columns</h3>
      <code class="mono" style="font-size:11px;color:var(--accent)">4D, Attempt, Date, Push-ups, Sit-ups, 2.4km, Score</code>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Only <strong>4D</strong> is required. <strong>Score</strong> is optional — it is auto-calculated from the three stations plus the recruit's roster age when left blank. Re-importing the same <strong>4D + Attempt</strong> updates that row instead of adding a duplicate.</div>
    </div>`;

  // Charts attached after DOM is in place. Old instances were already wiped
  // by the destroy loop at the top of render().
  buildIPPTAwardsChart(stats);
  buildIPPTDistributionChart(buckets);
  buildIPPTTrendChart(ipptTrend);
  if (hasMultiAttempt) {
    buildIPPTProgressChart(ipptSeries);
    buildIPPTAwardMixChart(scoped, attemptNums);
    buildIPPTCompareChart(ipptSeries, cmpA, cmpB);
  }
}
let _ipptView = "all";
function setIpptView(v) { _ipptView = v; render(); }
// Compare-picker view state (attempt A → B). View-only; re-validated in
// renderIPPT against the live attempt set.
let _ipptCmpA = "", _ipptCmpB = "";
function setIpptCompare(a, b) { _ipptCmpA = a; _ipptCmpB = b; render(); }
function ipptComparePick() {
  const a = document.getElementById("ippt-cmp-a"), b = document.getElementById("ippt-cmp-b");
  if (a && b) setIpptCompare(a.value, b.value);
}

function buildIPPTTrendChart(trend) {
  const canvas = document.getElementById("chart-ippt-trend");
  if (!canvas || !trend.labels.length) return;
  STATE.charts.ipptTrend = new Chart(canvas, {
    type: "line",
    data: {
      labels: trend.labels,
      datasets: [
        { label: "Mean", data: trend.mean, borderColor: "#58A6FF", backgroundColor: "#58A6FF22", tension: .3, pointRadius: 3 },
        { label: "Median", data: trend.median, borderColor: "#3FB950", backgroundColor: "#3FB95022", tension: .3, pointRadius: 3 }
      ]
    },
    options: {
      plugins: { legend: { labels: { color: "#8B949E", font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, suggestedMax: 100, grid: { color: "#30363D" }, ticks: { color: "#8B949E" } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 10 } } }
      }
    }
  });
}

function buildIPPTAwardsChart(stats) {
  const canvas = document.getElementById("chart-ippt-awards");
  if (!canvas) return;
  // Order high → low so the legend reads top-to-bottom intuitively.
  // Only include non-zero slices so the chart isn't cluttered with empty tiers.
  const labels = [], data = [], colors = [];
  if (stats.goldStar) { labels.push("Gold★"); data.push(stats.goldStar); colors.push("#BC8CFF"); }
  if (stats.gold)     { labels.push("Gold");   data.push(stats.gold);     colors.push("#E3B341"); }
  if (stats.silver)   { labels.push("Silver"); data.push(stats.silver);   colors.push("#58A6FF"); }
  if (stats.pass)     { labels.push("Pass");   data.push(stats.pass);     colors.push("#3FB950"); }
  if (stats.fail)     { labels.push("Fail");   data.push(stats.fail);     colors.push("#F85149"); }
  if (stats.ytt)      { labels.push("YTT");    data.push(stats.ytt);      colors.push("#484F58"); }
  if (!data.length) return;

  STATE.charts.ipptAwards = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#161B22", borderWidth: 2 }] },
    options: { plugins: { legend: { position: "right", labels: { color: "#8B949E", font: { size: 11 } } } } }
  });
}

function buildIPPTDistributionChart(buckets) {
  const canvas = document.getElementById("chart-ippt-distribution");
  if (!canvas) return;
  // buckets: [YTT, Fail 0–60, Pass 61–74, Silver 75–84, Gold 85–89, Gold★ 90+]
  STATE.charts.ipptDistribution = new Chart(canvas, {
    type: "bar",
    data: {
      labels: ["YTT", "Fail", "Pass", "Silver", "Gold", "Gold★"],
      datasets: [{
        data: buckets,
        backgroundColor: ["#484F58", "#F85149", "#3FB950", "#58A6FF", "#E3B341", "#BC8CFF"],
        borderWidth: 0,
        borderRadius: 4
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "#30363D" }, ticks: { color: "#8B949E", stepSize: 1 } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 10 } } }
      }
    }
  });
}

// One line per recruit across their attempts (colour = net journey direction:
// green up / red down / grey flat), plus a bold company-average overlay. Legend
// off — one line per recruit would swamp it.
function buildIPPTProgressChart(series) {
  const canvas = document.getElementById("chart-ippt-progress");
  if (!canvas || !series.length) return;
  const allAttempts = [...new Set(series.flatMap(r => Object.keys(r.byAttempt).map(Number)))].sort((a, b) => a - b);
  if (!allAttempts.length) return;
  const colorFor = d => d > 0 ? "#3FB95088" : d < 0 ? "#F8514988" : "#484F5888";
  const datasets = series.map(r => {
    const c = colorFor(ipptNetDelta(r));
    return {
      label: r.d4,
      data: allAttempts.map(n => r.byAttempt[n] != null ? r.byAttempt[n] : null),
      borderColor: c, backgroundColor: c, borderWidth: 1.5, pointRadius: 2, tension: .2, spanGaps: true
    };
  });
  const avg = allAttempts.map(n => {
    const vals = series.map(r => r.byAttempt[n]).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  });
  datasets.push({ label: "Company avg", data: avg, borderColor: "#C9D1D9", backgroundColor: "#C9D1D9", borderWidth: 3, pointRadius: 3, tension: .2, spanGaps: true });
  STATE.charts.ipptProgress = new Chart(canvas, {
    type: "line",
    data: { labels: allAttempts.map(n => "IPPT " + n), datasets },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, suggestedMax: 100, grid: { color: "#30363D" }, ticks: { color: "#8B949E" } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 10 } } }
      }
    }
  });
}

// 100%-stacked bars, one per attempt, segmented by award tier. Percent-of-takers
// (not raw counts) so a smaller later cohort still compares honestly; tooltips
// carry the raw counts. Takers = non-YTT entries with a real run time.
function buildIPPTAwardMixChart(scoped, attemptNums) {
  const canvas = document.getElementById("chart-ippt-awardmix");
  if (!canvas || !attemptNums.length) return;
  const tiers = [
    { key: "Gold★", color: "#BC8CFF" }, { key: "Gold", color: "#E3B341" },
    { key: "Silver", color: "#58A6FF" }, { key: "Pass", color: "#3FB950" }, { key: "Fail", color: "#F85149" }
  ];
  const pct = {}, counts = {};
  tiers.forEach(t => { pct[t.key] = []; counts[t.key] = []; });
  attemptNums.forEach(n => {
    const takers = scoped.filter(e => +e.attempt === n && !isYTT(e) && parseRunTimeToSeconds(e.runTime) > 0);
    const tally = {}; tiers.forEach(t => tally[t.key] = 0);
    takers.forEach(e => { const a = getAward(+e.score || 0); if (tally[a] != null) tally[a]++; });
    tiers.forEach(t => {
      counts[t.key].push(tally[t.key]);
      pct[t.key].push(takers.length ? Math.round(tally[t.key] / takers.length * 100) : 0);
    });
  });
  STATE.charts.ipptAwardMix = new Chart(canvas, {
    type: "bar",
    data: {
      labels: attemptNums.map(n => "IPPT " + n),
      datasets: tiers.map(t => ({ label: t.key, data: pct[t.key], backgroundColor: t.color, _counts: counts[t.key] }))
    },
    options: {
      plugins: {
        legend: { labels: { color: "#8B949E", font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}% (${ctx.dataset._counts[ctx.dataIndex]})` } }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: "#8B949E" } },
        y: { stacked: true, min: 0, max: 100, grid: { color: "#30363D" }, ticks: { color: "#8B949E", callback: v => v + "%" } }
      }
    }
  });
}

// Paired A→B cohort: a diverging bar of each recruit's score delta (sorted),
// green up / red down. Fills the header summary with the up/down split.
function buildIPPTCompareChart(series, a, b) {
  const canvas = document.getElementById("chart-ippt-compare");
  if (!canvas) return;
  const cohort = ipptPairedCohort(series, a, b).slice().sort((x, y) => y.delta - x.delta);
  const sumEl = document.getElementById("ippt-cmp-summary");
  if (sumEl) {
    const up = cohort.filter(c => c.delta > 0).length, down = cohort.filter(c => c.delta < 0).length;
    sumEl.innerHTML = cohort.length
      ? `${cohort.length} took both · <span style="color:var(--green)">${up} up</span> · <span style="color:var(--red)">${down} down</span>`
      : "no recruit took both attempts";
  }
  if (!cohort.length) return;
  STATE.charts.ipptCompare = new Chart(canvas, {
    type: "bar",
    data: {
      labels: cohort.map(c => displayId(c.d4) || c.d4),
      datasets: [{
        label: `IPPT ${a} → ${b} Δ`,
        data: cohort.map(c => c.delta),
        backgroundColor: cohort.map(c => c.delta >= 0 ? "#3FB950" : "#F85149"),
        borderWidth: 0, borderRadius: 3
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => { const c = cohort[ctx.dataIndex]; return `${c.s1} → ${c.s2} (${c.delta >= 0 ? "+" : ""}${c.delta})`; } } }
      },
      scales: {
        y: { grid: { color: "#30363D" }, ticks: { color: "#8B949E" }, title: { display: true, text: "Δ score", color: "#8B949E" } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 9 }, maxRotation: 90 } }
      }
    }
  });
}

// Chore 7: renderRM lived here. The Route March TAB was retired from the UI, but
// the DATA is deliberately untouched — STATE.rm still loads, syncs and pushes, the
// RouteMarch sheet tab is unchanged, and Settings still exports it. Re-adding the
// tab later is a pure-frontend change with no migration.

function renderSOC(el) {
  const visible = visibleD4Set();
  const scoped = STATE.soc.filter(s => passesFilter(s.d4, visible));
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">SOC Tracker${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.soc.length}]</span>` : ""}</h2>
      <div style="display:flex;gap:8px">
        <label class="btn" style="cursor:pointer">Import CSV<input type="file" accept=".csv" onchange="importSOC(this)" style="display:none"></label>
        <button class="btn btn-success" onclick="pushTab('SOC',STATE.soc)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="openSOCForm()">+ Add</button>
      </div>
    </div>
    ${scoped.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>SOC#</th><th>Date</th><th>Duration</th><th>Avg HR</th><th>Pass</th><th></th></tr></thead><tbody>
    ${scoped.map(s => `<tr><td class="mono">${s.d4}</td><td style="text-align:left">${escapeHTML(getName(s.d4))}</td><td>${s.socNum}</td><td>${s.date}</td><td class="mono" style="font-weight:700">${socDurationDisplay(s.time)}</td><td>${s.avgHr === "" || s.avgHr == null ? "—" : s.avgHr}</td><td>${badge(s.pass === "Y" ? "PASS" : "FAIL", s.pass === "Y" ? "green" : "red")}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="openSOCForm(${s.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="deleteEntry('soc', ${s.id}, 'SOC entry')" title="Delete">✕</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">${STATE.soc.length ? `No SOC entries in ${filterLabel()}.` : "No SOC data yet."}</div>`}

    <!-- Feature 24 — see the matching card in renderIPPT. Time is called out as a
         duration because "Time" on a tracker tab otherwise reads as clock time,
         and socUpsertRows stores it verbatim for socDurationDisplay. -->
    <div class="card" style="margin-top:16px"><h3>Expected CSV Columns</h3>
      <code class="mono" style="font-size:11px;color:var(--accent)">4D, SOC, Date, Time, Avg HR, Pass</code>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Only <strong>4D</strong> is required. <strong>Time</strong> is a duration in <strong>MM:SS</strong> (e.g. <code>12:45</code>), not a clock time. Re-importing the same <strong>4D + SOC</strong> updates that row instead of adding a duplicate.</div>
    </div>`;
}
