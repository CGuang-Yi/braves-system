// ============================================================================
// DUTY LIST TAB (js/render-duty.js) — MD_Docs/DUTY_LIST_SPEC.md §8
// ----------------------------------------------------------------------------
// Phase 1 is READ-ONLY. There is no assignment UI here and no write path: the
// only thing that puts rows in the Duty tab at this stage is the one-off
// workbook import. Editing, conflict warnings and the `duty` capability gate all
// arrive in phase 2 (js/forms-duty.js).
//
// Three views, chosen by a local tab control:
//
//   • GRID     — dates down, duty types across. Company-scoped types get one
//                column each; platoon-scoped types (PDS) get one column per LIVE
//                platoon, derived from activePlatoons(). Nothing here is
//                hardcoded to four platoons, because the number and numbering of
//                platoons can change.
//   • OVERALL  — per person: counts by type, base points, weekend/PH points,
//                corrections, total. Sortable, over month / cycle / all time.
//   • LOG      — planner-only (canPlanDuty); see renderDuty.
//
// All arithmetic is delegated to js/duty-points.js and all column derivation to
// js/duty-eligibility.js. Both are pure modules that never read STATE; this file
// is the bridge, via dutyConfig() in state.js. Keeping the maths out of the view
// is what makes it unit-testable — do not inline a points calculation here.
// ============================================================================

// ── Tab state (module-level, mirrors the _sb*/_parade* pattern) ──────────────
let _dutyView = "grid";        // "grid" | "overall" | "log"
let _dutyMonth = "";           // ISO yyyy-mm-01; lazily defaulted to this month
let _dutyRangeKind = "month";  // "month" | "cycle" | "all" — fairness/log scope
let _dutySort = "total";       // fairness sort column
let _dutySortDesc = true;

function dutyMonthAnchor() {
  if (!_dutyMonth) _dutyMonth = todayISO().slice(0, 7) + "-01";
  return _dutyMonth;
}

// Every column the grid shows, in order: company-scoped types first (in Config
// order), then one column per live platoon for each platoon-scoped type.
function dutyGridColumns(cfg) {
  const platoons = activePlatoons().map(p => p.code);
  const cols = [];
  (cfg.dutyTypes || []).forEach(t => {
    dutyPlatoonsFor(t.name, platoons, cfg).forEach(pl => {
      cols.push({ dutyType: t.name, platoon: pl, label: pl ? t.name + " " + pl.replace(/^PLT/, "") : t.name });
    });
  });
  return cols;
}

// date → dutyType|platoon → 4D, so the grid is one pass over the rows rather
// than a scan per cell.
function dutyIndexByDate(rows) {
  const idx = {};
  (rows || []).forEach(r => {
    if (!r || !r.date) return;
    if (!idx[r.date]) idx[r.date] = {};
    idx[r.date][r.dutyType + "|" + (r.platoon || "")] = r.d4;
  });
  return idx;
}

// Every date in a month, so the grid shows empty days too — an unfilled slot is
// information, not an absence of it.
function dutyDatesInMonth(anchorISO) {
  const y = Number(anchorISO.slice(0, 4)), m = Number(anchorISO.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= last; d++) {
    out.push(anchorISO.slice(0, 8) + String(d).padStart(2, "0"));
  }
  return out;
}

const DUTY_DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A person's name as a chip in their platoon/section colour.
//
// The colour is looked up from the person's CURRENT platoon and section, not
// from the duty row's stored platoon. Those differ after a transfer, and the
// current one is right here: the chip answers "who is this person" for someone
// scanning the grid today, whereas the row's stored platoon answers "which slot
// did they fill", which is what the column already says.
//
// Rendered as a background rather than as text colour because the ramps span
// #900b0a to #fff176 — as text, one end or the other is unreadable on any
// background. dutyContrastText picks black or white per chip so both ends stay
// legible. Anyone with no ramp (HQ, an unlisted platoon, a recruit) falls back
// to plain text, which is why this returns a bare label rather than an empty chip.
function dutyNameChip(d4, cfg) {
  const label = displayPersonLabel(d4);
  const r = (STATE.roster || []).find(x => x.id === d4);
  const colour = r ? dutyColourFor(personPlatoon(r), personSection(r), cfg) : "";
  if (!colour) return escapeHTML(label);
  const fg = dutyContrastText(colour);
  const title = r ? `${personPlatoon(r)}${personSection(r) ? " · " + personSection(r) : ""}` : "";
  return `<span class="duty-chip" style="background:${escapeAttr(colour)};color:${fg}" title="${escapeAttr(title)}">${escapeHTML(label)}</span>`;
}

function renderDuty(el) {
  const cfg = dutyConfig();

  // The corrections log is planner-only. It is an audit trail of manual point
  // adjustments — who was docked what and why — which is administrative detail
  // rather than something everyone needs, while the duties and totals it feeds
  // stay visible to all (spec §9.3).
  //
  // This is presentation only. The rows are in STATE either way, so treat it as
  // tidying the UI for people who cannot act on it, NOT as access control; the
  // server gate in phase 2 is what actually enforces anything.
  const showLog = canPlanDuty();
  if (_dutyView === "log" && !showLog) _dutyView = "grid";

  const tabDefs = [["grid", "Month grid"], ["overall", "Overall duties"]];
  if (showLog) tabDefs.push(["log", "Corrections log"]);
  const tabs = tabDefs
    .map(([k, label]) =>
      `<button type="button" class="role-btn${_dutyView === k ? " active" : ""}" data-action="dutyView" data-value="${k}">${label}</button>`)
    .join("");

  let body = "";
  if (_dutyView === "grid") body = dutyGridHTML(cfg);
  else if (_dutyView === "overall") body = dutyOverallHTML(cfg);
  else body = dutyLogHTML(cfg);

  el.innerHTML = `
    <div class="card">
      <h2>Duty List</h2>
      <p style="color:var(--muted);margin:4px 0 10px">
        Read-only. Duty planning arrives in a later release — until then this reflects
        what has been imported from the duty sheet.
      </p>
      <div id="duty-tabs" class="filter-role-group" style="margin-bottom:12px">${tabs}</div>
      ${body}
    </div>`;
}

// ── Month grid ───────────────────────────────────────────────────────────────
function dutyGridHTML(cfg) {
  const anchor = dutyMonthAnchor();
  const cols = dutyGridColumns(cfg);
  const idx = dutyIndexByDate(STATE.duty);
  const holidays = indexHolidays(STATE.holidays);

  const head = cols.map(c => `<th>${escapeHTML(c.label)}</th>`).join("");
  const rows = dutyDatesInMonth(anchor).map(iso => {
    const dow = dutyDayOfWeek(iso);
    const hol = holidays[iso];
    const weight = dutyDayWeight(iso, cfg, holidays);
    // A tentative holiday is marked differently from a confirmed one on purpose:
    // it still scores the full 5, so the fact that it might not happen has to be
    // visible somewhere or it silently overpays by 4 (spec §3.3).
    const holTag = hol
      ? ` <span class="badge ${hol.tentative ? "badge-orange" : "badge-accent"}" title="${escapeAttr(hol.name || "Public holiday")}">${hol.tentative ? "PH?" : "PH"}</span>`
      : "";
    const cells = cols.map(c => {
      const d4 = idx[iso] && idx[iso][c.dutyType + "|" + c.platoon];
      return `<td>${d4 ? dutyNameChip(d4, cfg) : "<span style=\"color:var(--muted)\">—</span>"}</td>`;
    }).join("");
    const wknd = (dow === 0 || dow === 6 || hol) ? ' class="duty-weekend"' : "";
    return `<tr${wknd}><td class="duty-date">${iso.slice(8)} ${DUTY_DOW_LABELS[dow] || ""}${holTag}
      <span style="color:var(--muted)" title="Day weight">·${weight}</span></td>${cells}</tr>`;
  }).join("");

  return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <button type="button" class="btn" data-action="dutyMonthStep" data-value="-1">‹ Prev</button>
      <strong>${escapeHTML(anchor.slice(0, 7))}</strong>
      <button type="button" class="btn" data-action="dutyMonthStep" data-value="1">Next ›</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// ── Overall duties ───────────────────────────────────────────────────────────
function dutyOverallHTML(cfg) {
  const range = dutyRangeFor(_dutyRangeKind, dutyMonthAnchor(), cfg);
  const holidays = indexHolidays(STATE.holidays);
  const totals = dutyTotals(STATE.duty, STATE.dutyCorrection, cfg, holidays, range);
  const types = (cfg.dutyTypes || []).map(t => t.name);

  const people = Object.keys(totals.byPerson).map(d4 => {
    const p = totals.byPerson[d4];
    return {
      d4, label: displayPersonLabel(d4), chip: dutyNameChip(d4, cfg),
      counts: p.counts, basePoints: p.basePoints, weekendPoints: p.weekendPoints,
      corrections: p.corrections, total: p.total,
      duties: types.reduce((n, t) => n + (p.counts[t] || 0), 0)
    };
  });

  const key = _dutySort;
  people.sort((a, b) => {
    const va = key === "name" ? a.label : (key === "duties" ? a.duties : a[key]);
    const vb = key === "name" ? b.label : (key === "duties" ? b.duties : b[key]);
    const cmp = typeof va === "string" ? String(va).localeCompare(String(vb)) : (va - vb);
    return _dutySortDesc ? -cmp : cmp;
  });

  const sortable = (k, label) =>
    `<th><button type="button" class="btn" style="padding:2px 8px;font-size:11px" data-action="dutySort" data-value="${k}">${label}${_dutySort === k ? (_dutySortDesc ? " ▾" : " ▴") : ""}</button></th>`;

  const head = sortable("name", "Person") + types.map(t => `<th>${escapeHTML(t)}</th>`).join("") +
    sortable("duties", "Duties") + sortable("basePoints", "Points") +
    sortable("weekendPoints", "Wknd/PH") + sortable("corrections", "Corr.") + sortable("total", "Total");

  const body = people.map(p =>
    `<tr><td>${p.chip}</td>` +
    types.map(t => `<td>${p.counts[t] || 0}</td>`).join("") +
    `<td>${p.duties}</td><td>${p.basePoints}</td><td>${p.weekendPoints}</td>` +
    `<td>${p.corrections === 0 ? "—" : (p.corrections > 0 ? "+" : "") + p.corrections}</td>` +
    `<td><strong>${p.total}</strong></td></tr>`
  ).join("");

  return dutyRangePicker(range) + (people.length
    ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
    : `<p style="color:var(--muted)">No duties recorded in this period.</p>`);
}

// ── Corrections log ──────────────────────────────────────────────────────────
function dutyLogHTML(cfg) {
  const range = dutyRangeFor(_dutyRangeKind, dutyMonthAnchor(), cfg);
  const rows = (STATE.dutyCorrection || [])
    .filter(c => dutyInRange(c.date, range))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const body = rows.map(c =>
    `<tr><td>${escapeHTML(c.date)}</td><td>${dutyNameChip(c.d4, cfg)}</td>` +
    `<td>${c.reason ? escapeHTML(c.reason) : '<span class="badge badge-orange">no reason</span>'}</td>` +
    `<td>${c.delta > 0 ? "+" : ""}${c.delta}</td><td>${escapeHTML(c.note || "")}</td>` +
    `<td style="color:var(--muted)">${escapeHTML(c.enteredBy || "")}</td></tr>`
  ).join("");

  return dutyRangePicker(range) + (rows.length
    ? `<div class="table-wrap"><table>
         <thead><tr><th>Date</th><th>Person</th><th>Reason</th><th>Delta</th><th>Note</th><th>By</th></tr></thead>
         <tbody>${body}</tbody></table></div>`
    : `<p style="color:var(--muted)">No corrections recorded in this period.</p>`);
}

function dutyRangePicker(range) {
  const opts = [["month", "Month"], ["cycle", "Cycle"], ["all", "All time"]]
    .map(([k, label]) =>
      `<button type="button" class="role-btn${_dutyRangeKind === k ? " active" : ""}" data-action="dutyRange" data-value="${k}">${label}</button>`)
    .join("");
  const label = range.from ? `${range.from} → ${range.to}` : "everything on record";
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
    <div class="filter-role-group">${opts}</div>
    <span style="color:var(--muted)">${escapeHTML(label)}</span></div>`;
}

// ── Actions ──────────────────────────────────────────────────────────────────
// Registered by name rather than wired with inline onclick: a real identifier is
// something no-undef and "find references" can both see, which markup built
// inside a template literal is not (js/actions.js).
function setDutyView(v) { _dutyView = v; render(); }
function setDutyRange(v) { _dutyRangeKind = v; render(); }

function setDutySort(k) {
  if (_dutySort === k) _dutySortDesc = !_dutySortDesc;
  else { _dutySort = k; _dutySortDesc = k !== "name"; }
  render();
}

function stepDutyMonth(delta) {
  const anchor = dutyMonthAnchor();
  const y = Number(anchor.slice(0, 4)), m = Number(anchor.slice(5, 7));
  const abs = y * 12 + (m - 1) + Number(delta);
  _dutyMonth = Math.floor(abs / 12) + "-" + String((abs % 12) + 1).padStart(2, "0") + "-01";
  render();
}

registerActions({
  dutyView: el => setDutyView(el.dataset.value),
  dutyRange: el => setDutyRange(el.dataset.value),
  dutySort: el => setDutySort(el.dataset.value),
  dutyMonthStep: el => stepDutyMonth(el.dataset.value)
});
