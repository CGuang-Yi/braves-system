// ============================================================================
// DUTY LIST TAB (js/render-duty.js) — MD_Docs/DUTY_LIST_SPEC.md §8
// ----------------------------------------------------------------------------
// The views. Everything that WRITES lives in js/forms-duty.js — this file
// decides what to draw and hands the click over. Grid cells and date cells
// become click targets only for a planner (canPlanDuty), which is presentation:
// the handlers re-check, and the server's tab gate is what enforces.
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
let _dutyShowExpired = false;  // Unavailable panel: hide finished windows by default
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

// One day's slots, for the dashboard card (spec §2).
//
// Deliberately built from dutyGridColumns() — the month grid's own column
// derivation — rather than from a second list of duty types. Two independent
// derivations are how the dashboard and the grid come to disagree about whether
// a slot exists, and the disagreement would surface as a duty nobody was told
// about. Reusing the grid's columns also means a new duty type or a new platoon
// appears on the card with no edit here.
//
// Unfilled slots are RETURNED, with an empty d4, not omitted: the gap is the
// point of the card, so the caller must be able to draw it.
function dutyDaySlots(cfg, dutyRows, iso) {
  const byKey = dutyIndexByDate(dutyRows)[iso] || {};
  return dutyGridColumns(cfg).map(c => ({
    dutyType: c.dutyType,
    platoon: c.platoon,
    label: c.label,
    d4: byKey[c.dutyType + "|" + c.platoon] || ""
  }));
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

// The soft-unavailability marker for one assignment (design §4.3).
//
// Planner-only, unlike the assignment itself: the flag is a planning signal
// nobody else can act on, and the note ("exam period", "pending course
// nomination") is the person's own business rather than the company's.
//
// Every overlapping window's note goes into the tooltip, not just the first.
// Two flags legitimately overlap, and naming one of them would state the wrong
// reason for the highlight — worse than stating no reason at all.
function dutyUnavailMark(idx, d4, iso) {
  if (!d4 || !canPlanDuty()) return "";
  const flags = duFlagsOn(idx, d4, iso);
  if (!flags.length) return "";
  const why = flags
    .map(f => (f.note || "Potentially unavailable") + " (" + f.from + " → " + f.to + ")")
    .join("\n");
  return ` <span class="duty-unavail-mark" title="${escapeAttr(why)}">⚠</span>`;
}

function renderDuty(el) {
  // The catch-all flush point for the inline editor's write buffer. Every route
  // off this screen or onto a different month ends in a re-render, so flushing
  // here covers the nav handler in js/main.js and the view/range toggles without
  // this branch having to reach into any of them. It is a no-op when the buffer
  // is empty, which is every render that is not following an edit.
  flushDutyWrites();
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

  // The pending count rides on the tab label rather than a separate banner: a
  // queue nobody is told about is a queue that quietly grows.
  const pendingCount = dcrPending(STATE.dutyChangeRequest).length;
  const tabDefs = [["grid", "Month grid"], ["overall", "Overall duties"], ["unavail", "Unavailable"],
    ["requests", "Requests" + (pendingCount ? ` (${pendingCount})` : "")]];
  if (showLog) tabDefs.push(["log", "Corrections log"]);
  const tabs = tabDefs
    .map(([k, label]) =>
      `<button type="button" class="role-btn${_dutyView === k ? " active" : ""}" data-action="dutyView" data-value="${k}">${label}</button>`)
    .join("");

  let body = "";
  if (_dutyView === "grid") body = dutyGridHTML(cfg);
  else if (_dutyView === "overall") body = dutyOverallHTML(cfg);
  else if (_dutyView === "unavail") body = dutyUnavailHTML(cfg);
  else if (_dutyView === "requests") body = dutyRequestsHTML(cfg);
  else body = dutyLogHTML(cfg);

  el.innerHTML = `
    <div class="card">
      <h2>Duty List</h2>
      <p style="color:var(--muted);margin:4px 0 10px">
        ${showLog
          ? "Click any grid cell to assign a duty, or a date to mark it a public holiday."
          : "Read-only — duty planning is restricted to duty planners."}
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
  // Built once per render, not per cell: the grid is ~31 rows × one column per
  // slot, and a per-cell lookup would be a full pass over every flag for each.
  const unavail = duIndexByPerson(STATE.dutyUnavailable);
  const canPlan = canPlanDuty();

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
      const mark = dutyUnavailMark(unavail, d4, iso);
      const inner = d4
        ? dutyNameChip(d4, cfg) + mark
        : '<span style="color:var(--muted)">—</span>';
      const cls = mark ? " duty-unavail" : "";
      // A planner gets the whole cell as a target — including the empty ones,
      // since filling a blank slot is the commonest action on this screen and
      // an empty cell is exactly where the click needs to land.
      if (!canPlan) return `<td class="${cls.trim()}">${inner}</td>`;
      return `<td class="duty-cell${cls}" data-action="dutyAssign" data-date="${escapeAttr(iso)}"
        data-type="${escapeAttr(c.dutyType)}" data-platoon="${escapeAttr(c.platoon)}"
        title="Assign ${escapeAttr(c.label)}">${inner}</td>`;
    }).join("");
    const wknd = (dow === 0 || dow === 6 || hol) ? ' class="duty-weekend"' : "";
    // The date cell doubles as the holiday control for planners. Marking a
    // public holiday is a per-date fact and this is the only place in the app
    // where dates are already laid out one per row, so it belongs here rather
    // than behind a separate screen.
    const dateAttrs = canPlan
      ? ` class="duty-date duty-cell" data-action="dutyHoliday" data-date="${escapeAttr(iso)}" title="${hol ? "Edit" : "Mark"} public holiday"`
      : ' class="duty-date"';
    return `<tr${wknd}><td${dateAttrs}>${iso.slice(8)} ${DUTY_DOW_LABELS[dow] || ""}${holTag}
      <span style="color:var(--muted)" title="Day weight">·${weight}</span></td>${cells}</tr>`;
  }).join("");

  return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <button type="button" class="btn" data-action="dutyMonthStep" data-value="-1">‹ Prev</button>
      <strong>${escapeHTML(anchor.slice(0, 7))}</strong>
      <button type="button" class="btn" data-action="dutyMonthStep" data-value="1">Next ›</button>
      ${canPlan ? `<button type="button" class="btn btn-primary" data-action="dutyAutoPlan">✨ Auto-plan month</button>` : ""}
      ${canPlan ? `<button type="button" class="btn" data-action="dutyImport">⬆ Import workbook</button>` : ""}
      ${canPlan ? `<span id="duty-pending-pill" style="font-size:11px;color:var(--muted)">✓ synced</span>` : ""}
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
    `<td style="color:var(--muted)">${escapeHTML(c.enteredBy || "")}</td>` +
    `<td style="text-align:right;white-space:nowrap">
       <button type="button" class="btn" style="font-size:10px" data-action="dutyCorrectionEdit"
         data-id="${escapeAttr(c.id)}" data-d4="${escapeAttr(c.d4)}" data-date="${escapeAttr(c.date)}">Edit</button>
       <button type="button" class="btn btn-danger" style="font-size:10px" data-action="dutyCorrectionDelete"
         data-id="${escapeAttr(c.id)}">Delete</button>
     </td></tr>`
  ).join("");

  // Only planners ever reach this view, so the New button needs no further
  // guard here — dutyLogHTML is unreachable otherwise (see renderDuty).
  const newBtn = `<button type="button" class="btn btn-primary" style="margin-bottom:10px" data-action="dutyCorrectionNew">Log a correction</button>`;

  return dutyRangePicker(range) + newBtn + (rows.length
    ? `<div class="table-wrap"><table>
         <thead><tr><th>Date</th><th>Person</th><th>Reason</th><th>Delta</th><th>Note</th><th>By</th><th></th></tr></thead>
         <tbody>${body}</tbody></table></div>`
    : `<p style="color:var(--muted)">No corrections recorded in this period.</p>`);
}

// ── Unavailable ──────────────────────────────────────────────────────────────
//
// Soft unavailability windows (design §4.4). Expired windows are hidden behind a
// toggle rather than listed: the list is meant to prune itself by being looked
// at, and a panel that only ever grows stops being read.
//
// The LIST is visible to everyone; only the add and delete controls are
// planner-gated. The grid highlight already implies these flags exist, and
// showing a highlight while hiding its explanation is the worse of the two.
function dutyUnavailHTML(cfg) {
  const canPlan = canPlanDuty();
  const today = todayISO();
  const all = duSortFlags(STATE.dutyUnavailable);
  const rows = _dutyShowExpired ? all : all.filter(f => !duIsExpired(f, today));
  const hidden = all.length - rows.length;

  const body = rows.length
    ? rows.map(f => {
      const expired = duIsExpired(f, today);
      return `<tr${expired ? ' style="opacity:.55"' : ""}>
        <td>${dutyNameChip(f.d4, cfg)}</td>
        <td style="white-space:nowrap">${escapeHTML(f.from)} → ${escapeHTML(f.to)}${expired ? ' <span class="badge">expired</span>' : ""}</td>
        <td>${escapeHTML(f.note || "")}</td>
        <td style="color:var(--muted)">${escapeHTML(f.addedBy || "")}</td>
        <td style="text-align:right">${canPlan
          ? `<button type="button" class="btn btn-danger" style="font-size:10px" data-action="dutyUnavailDelete" data-id="${escapeAttr(f.id)}">Delete</button>`
          : ""}</td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="5" style="color:var(--muted)">No ${_dutyShowExpired ? "" : "current "}unavailability flags.</td></tr>`;

  return `
    <p style="color:var(--muted);margin:0 0 10px;font-size:12px">
      Windows in which someone is <em>probably</em> unavailable — leave not yet applied for, a
      course nomination not yet published, an exam block. A planning hint only: it does not
      change parade state, does not block an assignment and does not move any points. A duty
      falling inside a window is highlighted on the month grid and on the dashboard.
    </p>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      ${canPlan ? `<button type="button" class="btn btn-primary" data-action="dutyUnavailNew">+ Flag unavailability</button>` : ""}
      <button type="button" class="btn" data-action="dutyUnavailExpired" data-value="${_dutyShowExpired ? "0" : "1"}">
        ${_dutyShowExpired ? "Hide expired" : `Show expired${hidden ? ` (${hidden})` : ""}`}
      </button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Person</th><th>Window</th><th>Reason</th><th>By</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

// ── Change requests (design §3) ──────────────────────────────────────────────
//
// Everyone sees this view; only a `duty` cap holder sees the Decide button.
// That asymmetry is deliberate — a submitter needs to see what happened to their
// request, and the queue being visible is also what keeps it from silently
// growing. Pending first and oldest first (dcrPending), so the thing that has
// been waiting longest is the thing you see.
function dutyRequestsHTML(cfg) {
  const canPlan = canPlanDuty();
  const pending = dcrPending(STATE.dutyChangeRequest);
  const decided = dcrDecided(STATE.dutyChangeRequest);
  const me = STATE.personId || "";

  const row = (r, isPending) => {
    const mine = String(r.submittedBy || "") === String(me);
    return `<tr>
      <td style="white-space:nowrap">${escapeHTML((r.submittedAt || "").slice(0, 10))}</td>
      <td>${escapeHTML(dcrLabel(r, displayPersonLabel))}</td>
      <td>${escapeHTML(r.reason || "")}</td>
      <td>${dutyNameChip(r.submittedBy, cfg)}</td>
      <td>${isPending
        ? '<span class="badge">Pending</span>'
        : `<span class="badge">${escapeHTML(r.status)}</span>${r.decisionNote ? ` <span style="font-size:11px;color:var(--muted)">${escapeHTML(r.decisionNote)}</span>` : ""}`}</td>
      <td style="text-align:right;white-space:nowrap">${isPending ? `
        ${canPlan ? `<button type="button" class="btn btn-primary" style="font-size:10px" data-action="dutyRequestDecide" data-id="${escapeAttr(r.id)}">Decide</button>` : ""}
        ${mine ? `<button type="button" class="btn btn-danger" style="font-size:10px" data-action="dutyRequestWithdraw" data-id="${escapeAttr(r.id)}">Withdraw</button>` : ""}`
        : ""}</td>
    </tr>`;
  };

  const body = (pending.map(r => row(r, true)).join("") + decided.map(r => row(r, false)).join(""))
    || `<tr><td colspan="6" style="color:var(--muted)">No change requests.</td></tr>`;

  return `
    <p style="color:var(--muted);margin:0 0 10px;font-size:12px">
      Proposed changes to the duty roster. Anyone can submit one; a duty planner approves it, and
      approving <em>applies</em> it to the roster in the same step. A reason is always required.
    </p>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <button type="button" class="btn btn-primary" data-action="dutyRequestNew">+ Request a change</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Submitted</th><th>Change</th><th>Reason</th><th>By</th><th>Status</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
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
function setDutyShowExpired(v) { _dutyShowExpired = !!v && v !== "0"; render(); }

function setDutySort(k) {
  if (_dutySort === k) _dutySortDesc = !_dutySortDesc;
  else { _dutySort = k; _dutySortDesc = k !== "name"; }
  render();
}

function stepDutyMonth(delta) {
  // The grid is about to be rebuilt for a different month, so anything still
  // buffered by the inline editor has to go out first — see flushDutyWrites.
  flushDutyWrites();
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
  dutyMonthStep: el => stepDutyMonth(el.dataset.value),
  // The write actions (js/forms-duty.js). They are only ever rendered for a
  // planner, and each handler re-checks canPlanDuty() anyway — the markup being
  // absent is a convenience, not the guard.
  //
  // `dutyAssign` is NOT here: the cells this file renders are edited in place by
  // js/duty-inline.js, which registers it. registerActions THROWS on a duplicate
  // name (js/actions.js) — deliberately, so a second definition can never quietly
  // win — so the action lives in exactly one file, the one that handles it.
  dutyHoliday: el => openDutyHolidayForm(el.dataset.date),
  dutyCorrectionNew: () => openDutyCorrectionForm("", todayISO(), ""),
  dutyCorrectionEdit: el => openDutyCorrectionForm(el.dataset.d4, el.dataset.date, "", el.dataset.id),
  dutyCorrectionDelete: el => deleteDutyCorrection(el.dataset.id),
  dutyUnavailNew: () => openDutyUnavailForm(),
  dutyUnavailDelete: el => deleteDutyUnavail(el.dataset.id),
  // Read-only view toggle, so it is NOT planner-gated: anyone reading the list
  // may want to see what has already lapsed.
  dutyUnavailExpired: el => setDutyShowExpired(el.dataset.value),
  dutyAutoPlan: () => openDutySchedulerForm(dutyMonthAnchor()),
  dutyImport: () => openDutyImportForm(),
  // Change requests (design §3). dutyRequestNew is deliberately NOT planner-
  // gated — submitting is open to every commander, and that is the whole point
  // of the feature; the handler re-checks canWrite() and the server enforces.
  dutyRequestNew: () => openDutyRequestForm("", "", ""),
  dutyRequestWithdraw: el => withdrawDutyRequest(el.dataset.id),
  dutyRequestDecide: el => openDutyDecideForm(el.dataset.id),
  dutyDecideApprove: el => decideDutyRequest(el.dataset.id, "approve"),
  dutyDecideReject: el => decideDutyRequest(el.dataset.id, "reject")
});
