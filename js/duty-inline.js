// Inline duty assignment — §2 of MD_Docs/DUTY_UX_AND_RS_SELECTION_SPEC.md.
//
// Replaces the per-cell modal. The modal cost four interactions and a full
// render() per cell; a planned month is roughly 31 × 7 of them, and assignment
// is the only thing this screen exists for.
//
// Loads after render-duty.js on purpose: it owns the dutyAssign action for the
// cells that file draws. render-duty.js no longer registers dutyAssign at all —
// registerActions THROWS on a duplicate name (js/actions.js), which is the
// design, so an action has exactly one owner. It also needs forms-duty.js for
// the correction form. See the load-order comment in index.html.

// The cell currently being edited: { td, isoDate, dutyType, platoon, prevD4 }.
let _dutyCellEdit = null;

// Build and apply one assignment to STATE. Extracted from the retired
// submitDutyAssign so the inline editor and any future caller share one
// definition of what an assignment IS — the platoon is stored literally at
// assignment time and never re-resolved from the roster, which is what keeps a
// later transfer from moving a past total (duty spec §5.1.1).
//
// Returns the row that was written, or null when the slot was cleared.
function applyDutyAssignment(spec) {
  const { isoDate, dutyType, platoon, id, d4 } = spec;
  if (!d4) {
    if (!id) return null;
    STATE.duty = (STATE.duty || []).filter(r => String(r.id) !== String(id));
    return null;
  }
  const existing = id ? (STATE.duty || []).find(r => String(r.id) === String(id)) : null;
  const row = {
    id: existing ? existing.id : nextId(),
    date: isoDate,
    dutyType,
    platoon: platoon || "",
    d4,
    assignedBy: STATE.email || "",
    assignedAt: new Date().toISOString(),
    // An imported row edited by hand stays flagged as imported, exactly as the
    // modal did — provenance is about where the row came from, not who last
    // touched it.
    source: existing && existing.source === "import" ? "import" : "manual"
  };
  if (existing) Object.assign(existing, row);
  else (STATE.duty = STATE.duty || []).push(row);
  return row;
}

// Repaint ONE cell. The whole point of the inline editor: render() rebuilds
// every view on the page, and nothing outside this <td> has changed.
function patchDutyCell(td, d4) {
  const cfg = dutyConfig();
  const unavail = duIndexByPerson(STATE.dutyUnavailable);
  const iso = td.dataset.date;
  const mark = d4 ? dutyUnavailMark(unavail, d4, iso) : "";
  td.innerHTML = d4
    ? dutyNameChip(d4, cfg) + mark
    : '<span style="color:var(--muted)">—</span>';
  td.classList.toggle("duty-unavail", !!mark);

  // Conflicts are ALWAYS advisory — there is no state in which this refuses an
  // assignment. The company knowingly double-books and pays the -2; the job is
  // to make that cost visible at the moment of choosing, and to make logging the
  // matching correction one click rather than a separate errand.
  td.classList.remove("duty-conflict");
  td.removeAttribute("title");
  if (!d4) return;
  const row = dutyRowAt(iso, td.dataset.type, td.dataset.platoon || "");
  const list = dutyConflictsFor({
    d4, date: iso, dutyType: td.dataset.type,
    platoon: td.dataset.platoon || "", id: row ? row.id : ""
  });
  if (!list.length) return;
  td.classList.add("duty-conflict");
  td.title = list.map(c => c.message).join("\n");
  const withReason = list.find(c => c.reason);
  if (withReason) {
    td.insertAdjacentHTML("beforeend",
      ` <span class="duty-conflict-flag" style="cursor:pointer" title="Log &quot;${escapeAttr(withReason.reason)}&quot;"
        data-action="dutyCorrectionFromCell" data-d4="${escapeAttr(d4)}"
        data-date="${escapeAttr(iso)}" data-reason="${escapeAttr(withReason.reason)}">⚠</span>`);
  }
}

// Points for the month ON SCREEN — not the Overall duties range selector, which
// is a separate control the planner is not looking at while assigning. The
// figure answers "who is light in the month I am filling".
function dutyMonthPointsByPerson() {
  const cfg = dutyConfig();
  const range = dutyRangeFor("month", dutyMonthAnchor(), cfg);
  return dutyTotals(STATE.duty || [], STATE.dutyCorrection || [], cfg,
                    indexHolidays(STATE.holidays), range).byPerson;
}

function beginDutyCellEdit(td) {
  if (!canPlanDuty() || !td) return;
  if (_dutyCellEdit) cancelDutyCellEdit();
  const isoDate = td.dataset.date;
  const dutyType = td.dataset.type;
  const platoon = td.dataset.platoon || "";
  const cfg = dutyConfig();
  const existing = dutyRowAt(isoDate, dutyType, platoon);

  // Grandfathering: the current holder is passed so they stay in the list even
  // after transferring platoon or leaving. Without it, re-opening a past row
  // would silently drop whoever actually did the duty (duty spec §5.1.3).
  const eligible = dutyEligible(dutyType, platoon, isoDate, STATE.roster, cfg,
    { currentAssignee: existing ? existing.d4 : "" });
  const totals = dutyMonthPointsByPerson();
  const options = eligible.map(d4 => ({
    d4,
    label: displayPersonLabel(d4),
    pts: (totals[d4] && totals[d4].total) || 0
  }));

  _dutyCellEdit = { td, isoDate, dutyType, platoon, id: existing ? existing.id : "",
                    prevD4: existing ? existing.d4 : "", options, filtered: options, hi: 0 };

  td.innerHTML = `<input type="text" class="duty-cell-input" autocomplete="off"
      style="width:100%;box-sizing:border-box;font:inherit;font-size:11px;padding:2px 4px;border:1px solid var(--accent);border-radius:3px;background:var(--bg);color:var(--text)">
    <div class="duty-cell-menu" style="position:absolute;z-index:50;background:var(--surface);border:1px solid var(--border);border-radius:4px;max-height:200px;overflow:auto;min-width:180px"></div>`;
  const input = td.querySelector(".duty-cell-input");
  input.addEventListener("input", () => { filterDutyCellOptions(input.value); });
  input.addEventListener("keydown", onDutyCellKey);
  // A blur that is not itself a commit (clicking elsewhere on the page) reverts:
  // an abandoned edit must not write, and the alternative — committing whatever
  // happened to be highlighted — writes things nobody chose. The timeout lets a
  // mousedown on the menu win the race, since that path commits explicitly.
  input.addEventListener("blur", () => {
    const mine = _dutyCellEdit;
    setTimeout(() => { if (_dutyCellEdit && _dutyCellEdit === mine) cancelDutyCellEdit(); }, 120);
  });
  filterDutyCellOptions("");
  input.focus();
}

function filterDutyCellOptions(q) {
  const e = _dutyCellEdit;
  if (!e) return;
  const needle = String(q || "").trim().toLowerCase();
  e.filtered = needle
    ? e.options.filter(o => o.label.toLowerCase().includes(needle) || String(o.d4).includes(needle))
    : e.options;
  e.hi = 0;
  const menu = e.td.querySelector(".duty-cell-menu");
  if (!menu) return;
  menu.innerHTML = e.filtered.length
    ? e.filtered.map((o, i) => `
        <div class="duty-cell-opt" data-i="${i}" style="padding:4px 8px;font-size:11px;cursor:pointer;${i === 0 ? "background:var(--surface2)" : ""}">
          ${escapeHTML(o.label)} <span style="color:var(--muted)">${o.pts} pts</span>
        </div>`).join("")
    : `<div style="padding:4px 8px;font-size:11px;color:var(--muted)">No eligible match</div>`;
  menu.querySelectorAll(".duty-cell-opt").forEach(el => {
    // mousedown, not click: the input's blur fires first on a click, and the
    // revert-on-blur above would have already torn the edit down.
    el.addEventListener("mousedown", ev => {
      ev.preventDefault();
      _dutyCellEdit.hi = Number(el.dataset.i);
      commitDutyCellEdit(true);
    });
  });
}

function highlightDutyCellOption(delta) {
  const e = _dutyCellEdit;
  if (!e || !e.filtered.length) return;
  e.hi = (e.hi + delta + e.filtered.length) % e.filtered.length;
  const menu = e.td.querySelector(".duty-cell-menu");
  menu.querySelectorAll(".duty-cell-opt").forEach((el, i) => {
    el.style.background = i === e.hi ? "var(--surface2)" : "";
    if (i === e.hi) el.scrollIntoView({ block: "nearest" });
  });
}

function onDutyCellKey(ev) {
  const e = _dutyCellEdit;
  if (!e) return;
  if (ev.key === "ArrowDown") { ev.preventDefault(); highlightDutyCellOption(1); return; }
  if (ev.key === "ArrowUp") { ev.preventDefault(); highlightDutyCellOption(-1); return; }
  if (ev.key === "Escape") { ev.preventDefault(); cancelDutyCellEdit(); return; }
  if (ev.key === "Enter") { ev.preventDefault(); commitDutyCellEdit(true, "down"); return; }
  if (ev.key === "Tab") { ev.preventDefault(); commitDutyCellEdit(true, ev.shiftKey ? "left" : "right"); return; }
  if ((ev.key === "Delete" || ev.key === "Backspace") && !ev.target.value) {
    ev.preventDefault();
    e.hi = -1;                       // -1 = "clear this slot"
    commitDutyCellEdit(true, "down");
  }
}

function cancelDutyCellEdit() {
  const e = _dutyCellEdit;
  if (!e) return;
  _dutyCellEdit = null;
  patchDutyCell(e.td, e.prevD4);
}

function commitDutyCellEdit(write, move) {
  const e = _dutyCellEdit;
  if (!e) return;
  _dutyCellEdit = null;
  let d4 = e.prevD4;
  if (write) {
    if (e.hi === -1) d4 = "";
    else if (e.filtered.length) d4 = e.filtered[Math.max(0, e.hi)].d4;
  }
  if (write && d4 !== e.prevD4) {
    const row = applyDutyAssignment({ isoDate: e.isoDate, dutyType: e.dutyType,
                                      platoon: e.platoon, id: e.id, d4 });
    saveLocal();
    queueDutyWrite(row, e.id, !!row && !e.id);
  }
  patchDutyCell(e.td, d4);
  if (move) focusNextDutyCell(e.td, move);
}

// Enter moves DOWN the same column — the direction a month is actually filled.
// Tab moves sideways for the case where one date's slots are being completed.
function focusNextDutyCell(td, dir) {
  const tr = td.parentElement;
  const table = tr && tr.parentElement;
  if (!table) return;
  const colIdx = [...tr.children].indexOf(td);
  let next = null;
  if (dir === "down") {
    const rows = [...table.children];
    const i = rows.indexOf(tr);
    for (let k = i + 1; k < rows.length; k++) {
      const cand = rows[k].children[colIdx];
      // dataset.type is what separates an assignable slot from the date cell,
      // which also carries .duty-cell (it is the holiday control).
      if (cand && cand.classList.contains("duty-cell") && cand.dataset.type) { next = cand; break; }
    }
  } else {
    const step = dir === "right" ? 1 : -1;
    for (let k = colIdx + step; k >= 0 && k < tr.children.length; k += step) {
      const cand = tr.children[k];
      if (cand && cand.classList.contains("duty-cell") && cand.dataset.type) { next = cand; break; }
    }
  }
  if (next) beginDutyCellEdit(next);
}

// ── Batched writes (§3 of the UX spec) ───────────────────────────────────────
//
// autoSync queues per tab, strictly FIFO, one OCC-guarded round trip at a time,
// with no coalescing. Cell by cell that is ~200 sequential Apps Script calls for
// a month.
//
// Keyed by row id so repeated edits to one cell collapse to a single entry —
// last write wins. A slot created and then cleared inside one window drops out
// entirely, which a naive queue would turn into two pointless round trips.
const _dutyPending = new Map();   // rowId → { op, row, id, isNew }
let _dutyFlushTimer = null;

const DUTY_FLUSH_IDLE_MS = 2000;
const DUTY_FLUSH_CAP = 100;

function dutyPendingCount() { return _dutyPending.size; }

function queueDutyWrite(row, prevId, isNew) {
  if (row) {
    const existing = _dutyPending.get(String(row.id));
    _dutyPending.set(String(row.id), {
      op: "upsert", row,
      // Once new, always new for this batch: a row created and then edited again
      // before the flush has still never reached the server, so it must go out as
      // an append, not an upsert against a row that isn't there.
      isNew: existing ? existing.isNew : !!isNew
    });
  } else if (prevId) {
    const existing = _dutyPending.get(String(prevId));
    if (existing && existing.isNew) _dutyPending.delete(String(prevId));  // never left the device
    else _dutyPending.set(String(prevId), { op: "delete", id: prevId, isNew: false });
  }

  // Marked dirty at COMMIT time, not at flush time. This is what makes the
  // deferral crash-safe without any new persistence: STATE.dirty is stored
  // separately under DIRTY_KEY, so if the tab dies mid-batch the marker
  // survives, the launch restore prompt fires, and retryAllDirty — finding no
  // stashed ops, because _dirtyOps is in-memory only — falls back to a full
  // OCC-guarded replace from STATE.duty, which localStorage already has.
  markDirty("Duty");
  updateDutyPendingPill();

  if (_dutyPending.size >= DUTY_FLUSH_CAP) { flushDutyWrites(); return; }
  if (_dutyFlushTimer) clearTimeout(_dutyFlushTimer);
  _dutyFlushTimer = setTimeout(flushDutyWrites, DUTY_FLUSH_IDLE_MS);
}

// One appendMany for everything new — the common case of filling an empty month
// is therefore a single round trip — plus one op each for rows that already
// exist on the server. All three modes are already OCC-guarded, already handled
// by reapplyMode on conflict, and already stashed in _dirtyOps on failure, so
// this adds no new failure mode.
function flushDutyWrites() {
  if (_dutyFlushTimer) { clearTimeout(_dutyFlushTimer); _dutyFlushTimer = null; }
  if (!_dutyPending.size) return;
  const entries = [..._dutyPending.values()];
  _dutyPending.clear();
  updateDutyPendingPill();
  if (!STATE.apiUrl) return;

  const fresh = entries.filter(e => e.op === "upsert" && e.isNew).map(e => e.row);
  if (fresh.length) autoSync("Duty", { type: "appendMany", rows: fresh });
  entries.filter(e => e.op === "upsert" && !e.isNew)
         .forEach(e => autoSync("Duty", { type: "upsert", row: e.row }));
  entries.filter(e => e.op === "delete")
         .forEach(e => autoSync("Duty", { type: "delete", id: e.id }));
}

// Deferring writes without showing that they are deferred would be the wrong
// trade — the planner has to be able to see the queue.
function updateDutyPendingPill() {
  const el = document.getElementById("duty-pending-pill");
  if (!el) return;
  const n = dutyPendingCount();
  el.textContent = n ? `● ${n} pending` : "✓ synced";
  el.style.color = n ? "var(--orange)" : "var(--muted)";
}

// Anything that leaves this screen, or reads STATE.duty from another surface,
// flushes first — a correction form or the scheduler reading a half-pushed month
// would be reasoning about data the server does not have.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("pagehide", flushDutyWrites);
}

registerActions({
  dutyAssign: el => beginDutyCellEdit(el),
  dutyCorrectionFromCell: el =>
    openDutyCorrectionForm(el.dataset.d4, el.dataset.date, el.dataset.reason)
});
