// ============================================================================
// DUTY LIST FORMS (js/forms-duty.js) — MD_Docs/DUTY_LIST_SPEC.md §6, §9
// ----------------------------------------------------------------------------
// The write half of the duty list: assigning a slot, logging a point
// correction, and maintaining the Holidays tab.
//
// Every entry point here is guarded by canPlanDuty(). That guard is COSMETIC —
// the real enforcement is the tab gate in routeAuthedPost, which refuses
// Duty/DutyCorrection/Holidays writes from any account without the `duty`
// capability. Both exist on purpose: the client guard means a non-planner never
// sees a button that would fail, and the server gate means it doesn't matter if
// they do.
//
// This file is the bridge between STATE and the pure modules. Eligibility comes
// from dutyEligible (duty-eligibility.js), conflicts from dutyConflicts
// (duty-conflicts.js), and neither of them reads STATE — the lookups that turn
// STATE into their arguments live here and nowhere else.
// ============================================================================

// ── STATE → pure-module bridges ──────────────────────────────────────────────

// The person's away verdict for a date, in the shape dutyConflicts wants.
//
// bpClassifyPerson is the single source of truth for "is this person away" — it
// is what the parade state itself runs on, and it already resolves leave, MC,
// LD, appointments and courses. Re-deriving any of that here would produce a
// second answer that drifts from the one on the parade state.
//
// The sections consulted are the away-from-duty ones. `mr` and `reportingSick`
// are deliberately excluded: a medical review or a morning report-sick does not
// take someone off a duty they are otherwise fit to hold, and flagging them
// would train planners to click past the warnings that matter.
const DUTY_AWAY_SECTIONS = ["alOil", "attC", "status", "others"];

function dutyAwayFor(d4, isoDate) {
  const r = (STATE.roster || []).find(x => x.id === d4);
  if (!r || typeof bpClassifyPerson !== "function") return null;
  const c = bpClassifyPerson(r, isoDate, null);
  for (let i = 0; i < DUTY_AWAY_SECTIONS.length; i++) {
    const k = DUTY_AWAY_SECTIONS[i];
    if (c.sections[k] && c.sections[k].length) {
      return { label: (c.meta[k][0] && c.meta[k][0].reason) || k };
    }
  }
  return null;
}

// Leave spans as ISO {start, end}. Leave rows store display dates, hence the
// conversion; an open-ended row keeps a blank end, which dutyDateInSpans reads
// as "still running".
function dutyLeaveSpansFor(d4) {
  return (STATE.leave || [])
    .filter(l => l && String(l.d4) === String(d4))
    .map(l => ({ start: displayDateToISO(l.startDate) || "", end: displayDateToISO(l.endDate) || "" }))
    .filter(s => !!s.start);
}

function dutyConflictsFor(cand) {
  return dutyConflicts(cand, {
    dutyRows: STATE.duty,
    away: dutyAwayFor(cand.d4, cand.date),
    leaveSpans: dutyLeaveSpansFor(cand.d4)
  });
}

// ── Assignment ───────────────────────────────────────────────────────────────

// The row currently being edited, so the conflict preview and the save path
// agree on what they are looking at without re-parsing the DOM.
let _dutyEditing = null;

function dutyRowAt(isoDate, dutyType, platoon) {
  return (STATE.duty || []).find(r =>
    r && r.date === isoDate && r.dutyType === dutyType && (r.platoon || "") === (platoon || "")) || null;
}

function openDutyAssignForm(isoDate, dutyType, platoon) {
  if (!canPlanDuty()) return;
  const cfg = dutyConfig();
  const existing = dutyRowAt(isoDate, dutyType, platoon);
  _dutyEditing = { isoDate, dutyType, platoon: platoon || "", id: existing ? existing.id : "" };

  // Grandfathering: the current holder is passed as `currentAssignee` so they
  // stay in the list even after transferring platoon or leaving. Without it,
  // re-opening a past row to change the date would silently drop whoever
  // actually did the duty (spec §5.1.3).
  const eligible = dutyEligible(dutyType, platoon || "", isoDate, STATE.roster, cfg,
    { currentAssignee: existing ? existing.d4 : "" });

  const opts = eligible
    .map(d4 => `<option value="${escapeAttr(d4)}"${existing && existing.d4 === d4 ? " selected" : ""}>${escapeHTML(displayPersonLabel(d4))}</option>`)
    .join("");

  const label = dutyType + (platoon ? " " + platoon.replace(/^PLT/, "") : "");
  openModal(`${label} — ${isoDate}`, `
    <form onsubmit="event.preventDefault(); submitDutyAssign(); return false">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${eligible.length ? "" : '<p style="color:var(--orange)">Nobody is eligible for this slot. Check the platoon\'s commanders on the Roster.</p>'}
        <div class="form-group">
          <label>Assign to</label>
          <select id="f-duty-d4" onchange="previewDutyConflicts()" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;box-sizing:border-box">
            <option value="">Unassigned</option>${opts}
          </select>
        </div>
        <div id="duty-conflict-box"></div>
        <div style="display:flex;gap:8px">
          <button type="submit" class="btn btn-primary">Save</button>
          ${existing ? '<button type="button" class="btn btn-danger" onclick="clearDutyAssignment()">Clear slot</button>' : ""}
        </div>
      </div>
    </form>`);
  previewDutyConflicts();
}

// Conflicts are shown live as the planner picks, and are ALWAYS advisory —
// there is no state in which this disables the Save button. The company
// knowingly double-books and pays a -2 for it; the job here is to make that
// cost visible at the moment of choosing, and to make logging the matching
// correction one click rather than a separate errand.
function previewDutyConflicts() {
  const box = document.getElementById("duty-conflict-box");
  if (!box || !_dutyEditing) return;
  const d4 = gv("f-duty-d4");
  if (!d4) { box.innerHTML = ""; return; }
  const list = dutyConflictsFor({
    d4, date: _dutyEditing.isoDate, dutyType: _dutyEditing.dutyType,
    platoon: _dutyEditing.platoon, id: _dutyEditing.id
  });
  if (!list.length) { box.innerHTML = '<p style="color:var(--muted);font-size:12px">No conflicts.</p>'; return; }
  box.innerHTML = list.map(c => `
    <div style="border:1px solid var(--border);border-left:3px solid var(--orange);border-radius:6px;padding:8px;margin-bottom:6px">
      <div style="font-size:12px">${escapeHTML(c.message)}</div>
      ${c.reason ? `<button type="button" class="btn" style="font-size:11px;margin-top:6px"
          onclick="openDutyCorrectionForm('${escapeAttr(d4)}','${escapeAttr(_dutyEditing.isoDate)}','${escapeAttr(c.reason)}')">Log "${escapeHTML(c.reason)}"</button>`
        : '<div style="font-size:11px;color:var(--muted);margin-top:4px">No correction applies — nothing in the point legend pays out for this.</div>'}
    </div>`).join("");
}

function submitDutyAssign() {
  if (!canPlanDuty() || !_dutyEditing) return;
  const d4 = gv("f-duty-d4");
  const { isoDate, dutyType, platoon, id } = _dutyEditing;
  // An empty pick on an existing row means "clear it" — the same operation the
  // Clear button performs, reached the other way round.
  if (!d4) { clearDutyAssignment(); return; }

  const existing = id ? (STATE.duty || []).find(r => String(r.id) === String(id)) : null;
  const row = {
    id: existing ? existing.id : nextId(),
    date: isoDate,
    dutyType,
    // The literal platoon at assignment time, never re-resolved from the
    // roster. This is what keeps a later transfer from moving a past total
    // (spec §5.1.1).
    platoon: platoon || "",
    d4,
    assignedBy: STATE.email || "",
    assignedAt: new Date().toISOString(),
    source: existing && existing.source === "import" ? "import" : "manual"
  };
  if (existing) Object.assign(existing, row);
  else (STATE.duty = STATE.duty || []).push(row);

  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("Duty", { type: "upsert", row });
}

function clearDutyAssignment() {
  if (!canPlanDuty() || !_dutyEditing || !_dutyEditing.id) { closeModal(); return; }
  const id = _dutyEditing.id;
  STATE.duty = (STATE.duty || []).filter(r => String(r.id) !== String(id));
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("Duty", { type: "delete", id });
}

// ── Auto-scheduler (spec §11) ────────────────────────────────────────────────
//
// The proposal is held here, uncommitted, until the planner presses Save. That
// is the whole design: the scheduler proposes and the planner decides. Nothing
// reaches the Duty tab without a deliberate click, and what does carries
// source: "auto" so an auto-generated assignment stays identifiable later.

let _dutyProposal = null;

function openDutySchedulerForm(anchorISO) {
  if (!canPlanDuty()) return;
  const cfg = dutyConfig();
  const range = dutyRangeFor("month", anchorISO || dutyMonthAnchor(), cfg);
  openModal("Auto-plan duties", `
    <form onsubmit="event.preventDefault(); runDutyScheduler(); return false">
      <div style="display:flex;flex-direction:column;gap:10px">
        <p style="font-size:12px;color:var(--muted);margin:0">
          Plans <strong>${escapeHTML(range.from)} → ${escapeHTML(range.to)}</strong>.
          This only proposes — nothing is saved until you review it and press Save.
        </p>
        <label class="form-label" style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" id="f-sched-regen"> Re-plan slots that are already filled
        </label>
        <p style="font-size:11px;color:var(--muted);margin:-4px 0 0">
          Off by default: anything you placed by hand is usually placed for a reason
          the scheduler cannot see.
        </p>
        <button type="submit" class="btn btn-primary">Generate proposal</button>
      </div>
    </form>`);
}

function runDutyScheduler() {
  if (!canPlanDuty()) return;
  const cfg = dutyConfig();
  const range = dutyRangeFor("month", dutyMonthAnchor(), cfg);
  const regenerate = !!document.getElementById("f-sched-regen")?.checked;

  const result = proposeDutySchedule(
    range, STATE.duty, STATE.roster, activePlatoons().map(p => p.code),
    cfg, indexHolidays(STATE.holidays),
    {
      // The two impure lookups the pure module deliberately does not do itself.
      isAway: (d4, iso) => !!dutyAwayFor(d4, iso),
      leaveSpansFor: dutyLeaveSpansFor,
      corrections: STATE.dutyCorrection,
      regenerate
    }
  );
  _dutyProposal = result;
  showDutyProposal();
}

function showDutyProposal() {
  const r = _dutyProposal;
  if (!r) return;
  const cfg = dutyConfig();

  const rows = r.proposals.map((p, i) => `
    <tr>
      <td class="duty-date">${escapeHTML(p.date)}</td>
      <td>${escapeHTML(p.dutyType + (p.platoon ? " " + p.platoon.replace(/^PLT/, "") : ""))}</td>
      <td>${dutyNameChip(p.d4, cfg)}</td>
      <td style="font-size:11px;color:var(--muted)">${escapeHTML(p.rationale)}</td>
      <td><button type="button" class="btn btn-danger" style="font-size:10px"
        onclick="dropDutyProposal(${i})">Drop</button></td>
    </tr>`).join("");

  // Unfilled slots are shown, not hidden. A gap the planner cannot see is a gap
  // that reaches the duty board on the day.
  const gaps = r.unfilled.length
    ? `<p style="color:var(--orange);font-size:12px;margin:10px 0 4px">
         ${r.unfilled.length} slot(s) could not be filled:</p>
       <ul style="font-size:11px;color:var(--muted);margin:0;padding-left:18px">
         ${r.unfilled.slice(0, 12).map(u =>
           `<li>${escapeHTML(u.date)} ${escapeHTML(u.dutyType + (u.platoon ? " " + u.platoon.replace(/^PLT/, "") : ""))} — ${escapeHTML(u.reason)}</li>`).join("")}
         ${r.unfilled.length > 12 ? `<li>…and ${r.unfilled.length - 12} more</li>` : ""}
       </ul>`
    : "";

  const f = (x) => `spread ${x.spread} (${x.min}–${x.max}, median ${x.median}, ${x.n} eligible)`;
  // "If the spread got worse, reject this" is only advice worth following when
  // there was something to compare against. On an unplanned period everyone sits
  // on zero, so the baseline spread is 0 and ANY roster — including the fairest
  // one obtainable — reads as having made it worse. Telling the planner to reject
  // on that basis is telling them to reject every first proposal of every month,
  // so say plainly that there is no comparison to make instead.
  const noBaseline = !r.fairnessBefore.max && !r.fairnessBefore.min;
  const advice = noBaseline
    ? `Nothing was on the books for this period, so there is no before/after to compare —
       everyone starts on zero and any roster at all widens the spread. Judge the figures
       on their own.`
    : `If the spread got worse, reject this.`;
  openModal("Proposed duties", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <p style="font-size:12px;margin:0">
        Fairness before: ${escapeHTML(f(r.fairnessBefore))}<br>
        Fairness after: <strong>${escapeHTML(f(r.fairnessAfter))}</strong>
      </p>
      <p style="font-size:11px;color:var(--muted);margin:0">
        ${advice} Drop anything you disagree with, then Save
        the rest — dropped rows are simply not written.
      </p>
      ${gaps}
      ${r.proposals.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Duty</th><th>Assignee</th><th>Why</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : `<p style="color:var(--muted)">Nothing could be proposed.</p>`}
      <div style="display:flex;gap:8px">
        <button type="button" class="btn btn-primary" onclick="commitDutyProposal()"
          ${r.proposals.length ? "" : "disabled"}>Save ${r.proposals.length} assignment(s)</button>
        <button type="button" class="btn" onclick="closeModal()">Discard</button>
      </div>
    </div>`);
}

function dropDutyProposal(i) {
  if (!_dutyProposal) return;
  _dutyProposal.proposals.splice(i, 1);
  showDutyProposal();
}

function commitDutyProposal() {
  if (!canPlanDuty() || !_dutyProposal) return;
  const list = _dutyProposal.proposals;
  if (!list.length) { closeModal(); return; }

  const rows = list.map(p => ({
    id: nextId(), date: p.date, dutyType: p.dutyType, platoon: p.platoon, d4: p.d4,
    assignedBy: STATE.email || "", assignedAt: new Date().toISOString(),
    // Provenance survives the save — six months on, "did a human pick this?"
    // is answerable from the sheet.
    source: "auto"
  }));
  STATE.duty = (STATE.duty || []).concat(rows);
  _dutyProposal = null;

  saveLocal(); closeModal(); render();
  // appendMany rather than N upserts: these are all brand-new rows, and one
  // request is one OCC-guarded write instead of N racing through the queue.
  if (STATE.apiUrl) autoSync("Duty", { type: "appendMany", rows });
}

// ── Corrections ──────────────────────────────────────────────────────────────

function openDutyCorrectionForm(d4, isoDate, presetReason, editId) {
  if (!canPlanDuty()) return;
  const cfg = dutyConfig();
  const reasons = cfg.dutyCorrectionReasons || [];
  const existing = editId ? (STATE.dutyCorrection || []).find(c => String(c.id) === String(editId)) : null;
  const reason = existing ? existing.reason : (presetReason || (reasons[0] && reasons[0].name) || "");

  const opts = reasons
    .map(r => `<option value="${escapeAttr(r.name)}" data-delta="${r.delta}"${r.name === reason ? " selected" : ""}>${escapeHTML(r.name)} (${r.delta > 0 ? "+" : ""}${r.delta})</option>`)
    .join("");

  // Reached two ways. From a conflict warning or a grid row, the person and
  // date are already known and are shown as fixed context — re-asking would
  // only create the chance of logging the correction against the wrong person.
  // From the log's own "Log correction" button nothing is known yet, so both
  // become inputs.
  const person = existing ? existing.d4 : d4;
  const when = existing ? existing.date : isoDate;
  const pool = dutyBasePool(STATE.roster, cfg)
    .map(r => `<option value="${escapeAttr(r.id)}"${r.id === person ? " selected" : ""}>${escapeHTML(displayPersonLabel(r.id))}</option>`)
    .join("");

  const whoField = person
    ? `<p style="font-size:12px;color:var(--muted);margin:0">${escapeHTML(displayPersonLabel(person))}</p>
       <input type="hidden" id="f-corr-d4" value="${escapeAttr(person)}">`
    : `<div class="form-group"><label>Person</label>
         <select id="f-corr-d4" required style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;box-sizing:border-box">
           <option value="">Select…</option>${pool}
         </select></div>`;

  openModal(existing ? "Edit Correction" : "Log Correction", `
    <form onsubmit="event.preventDefault(); submitDutyCorrection(); return false">
      <input type="hidden" id="f-corr-id" value="${existing ? escapeAttr(existing.id) : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${whoField}
        ${formField("f-corr-date", "Date", "date", "", `required value="${escapeAttr(when || todayISO())}" min="2020-01-01" max="2099-12-31"`)}
        <div class="form-group">
          <label>Reason</label>
          <select id="f-corr-reason" onchange="syncDutyCorrectionDelta()" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;box-sizing:border-box">${opts}</select>
        </div>
        ${formField("f-corr-delta", "Points", "number", "", `required step="1" value="${existing ? existing.delta : dutyReasonDelta(cfg, reason)}"`)}
        <p style="font-size:11px;color:var(--muted);margin:-4px 0 0">
          Pre-filled from the reason. Override it only when this instance genuinely
          differs — the reason's own value is what keeps totals comparable.
        </p>
        ${formField("f-corr-note", "Note (optional)", "text", "", `maxlength="200" value="${escapeAttr(existing ? existing.note : "")}"`)}
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);
}

// Re-prefill the delta when the reason changes — but only the delta. A planner
// who has already typed an override and then changes their mind about the
// reason wants the new reason's value, not their stale number.
function syncDutyCorrectionDelta() {
  const sel = document.getElementById("f-corr-reason");
  const box = document.getElementById("f-corr-delta");
  if (!sel || !box) return;
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.delta !== undefined) box.value = opt.dataset.delta;
}

function submitDutyCorrection() {
  if (!canPlanDuty()) return;
  const editId = gv("f-corr-id");
  const existing = editId ? (STATE.dutyCorrection || []).find(c => String(c.id) === String(editId)) : null;
  const d4 = gv("f-corr-d4");
  if (!d4) { alert("Pick the person this correction applies to."); return; }
  const raw = gv("f-corr-delta");
  const delta = Number(raw);
  // A blank or non-numeric delta would land as NaN and poison every total that
  // includes it, so refuse rather than write it. Zero IS valid — "Extras"
  // exists precisely to record something without moving the score.
  if (raw === "" || !isFinite(delta)) { alert("Enter a whole number of points (0 is allowed)."); return; }

  const row = {
    id: existing ? existing.id : nextId(),
    date: gv("f-corr-date"),
    d4,
    reason: gv("f-corr-reason"),
    delta,
    note: gv("f-corr-note"),
    enteredBy: STATE.email || "",
    enteredAt: new Date().toISOString()
  };
  if (existing) Object.assign(existing, row);
  else (STATE.dutyCorrection = STATE.dutyCorrection || []).push(row);

  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("DutyCorrection", { type: "upsert", row });
}

function deleteDutyCorrection(id) {
  if (!canPlanDuty()) return;
  const c = (STATE.dutyCorrection || []).find(x => String(x.id) === String(id));
  if (!c) return;
  if (!confirm(`Delete the ${c.delta > 0 ? "+" : ""}${c.delta} correction for ${displayPersonLabel(c.d4)} on ${c.date}?`)) return;
  STATE.dutyCorrection = (STATE.dutyCorrection || []).filter(x => String(x.id) !== String(id));
  saveLocal(); render();
  if (STATE.apiUrl) autoSync("DutyCorrection", { type: "delete", id });
}

// ── Holidays ─────────────────────────────────────────────────────────────────
//
// A public holiday is the highest day weight there is (5 points, the same as a
// full weekend day), so this tab is worth more per row than anything else in
// the duty list. Hence the tentative flag: a provisional in-lieu date that
// never materialises otherwise overpays by 4 with nothing on screen to say so.

function openDutyHolidayForm(isoDate) {
  if (!canPlanDuty()) return;
  const existing = (STATE.holidays || []).find(h => h && h.date === isoDate);
  openModal(existing ? "Edit Public Holiday" : "Add Public Holiday", `
    <form onsubmit="event.preventDefault(); submitDutyHoliday(); return false">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${formField("f-hol-date", "Date", "date", "", `required value="${escapeAttr(isoDate || todayISO())}" min="2020-01-01" max="2099-12-31"`)}
        ${formField("f-hol-name", "Name", "text", "Deepavali / National Day…", `required maxlength="60" value="${escapeAttr(existing ? existing.name : "")}"`)}
        <label class="form-label" style="flex-direction:row;align-items:center;gap:8px">
          <input type="checkbox" id="f-hol-tentative"${existing && existing.tentative ? " checked" : ""}> Tentative
        </label>
        <p style="font-size:11px;color:var(--muted);margin:-4px 0 0">
          A tentative holiday still scores the full 5 points — it is marked PH? in the
          grid so an unconfirmed date can be spotted rather than quietly overpaying.
        </p>
        <div style="display:flex;gap:8px">
          <button type="submit" class="btn btn-primary">Save</button>
          ${existing ? `<button type="button" class="btn btn-danger" onclick="deleteDutyHoliday('${escapeAttr(isoDate)}')">Remove</button>` : ""}
        </div>
      </div>
    </form>`);
}

function submitDutyHoliday() {
  if (!canPlanDuty()) return;
  const date = gv("f-hol-date");
  const name = gv("f-hol-name");
  if (!date || !name) return;
  const tentative = !!document.getElementById("f-hol-tentative")?.checked;
  const rows = (STATE.holidays || []).filter(h => h && h.date !== date);
  rows.push({ date, name, tentative });
  STATE.holidays = rows;

  saveLocal(); closeModal(); render();
  // Holidays has no id column — date IS the key (spec §3.3), and there is at
  // most one holiday per date. There is no id for upsert or delete to match on,
  // so the whole tab is replaced. It is a handful of rows a year.
  if (STATE.apiUrl) autoSync("Holidays", { type: "replace", data: STATE.holidays });
}

function deleteDutyHoliday(isoDate) {
  if (!canPlanDuty()) return;
  const h = (STATE.holidays || []).find(x => x && x.date === isoDate);
  if (!h) return;
  if (!confirm(`Remove ${h.name || "the public holiday"} on ${isoDate}?\n\nEvery duty that day drops from 5 points to its ordinary weekday weight.`)) return;
  STATE.holidays = (STATE.holidays || []).filter(x => x && x.date !== isoDate);
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("Holidays", { type: "replace", data: STATE.holidays });
}

// ── Unavailability flags ─────────────────────────────────────────────────────
//
// One window, one reason, any number of people. The multi-select is the point:
// "all of Plt 2 during the exam block" is the case this exists for, and doing it
// one person at a time is how it stops being done at all.
//
// There is no edit — delete and re-add. A window is three short fields, and an
// edit path would need its own OCC-guarded upsert for no gain over that.

function openDutyUnavailForm() {
  if (!canPlanDuty()) return;
  const cfg = dutyConfig();
  // The same pool the other duty forms draw from, so the picker cannot offer
  // someone who could never hold a duty in the first place.
  const pool = dutyBasePool(STATE.roster, cfg)
    .map(r => `<option value="${escapeAttr(r.id)}">${escapeHTML(displayPersonLabel(r.id))}</option>`)
    .join("");

  openModal("Flag Unavailability", `
    <form onsubmit="event.preventDefault(); submitDutyUnavail(); return false">
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group">
          <label>People <span style="color:var(--muted);font-weight:400">— select as many as apply</span></label>
          <select id="f-unavail-d4" multiple size="8" required style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;box-sizing:border-box">${pool}</select>
        </div>
        ${formField("f-unavail-from", "From", "date", "", `required value="${escapeAttr(todayISO())}" min="2020-01-01" max="2099-12-31"`)}
        ${formField("f-unavail-to", "To (inclusive)", "date", "", `required value="${escapeAttr(todayISO())}" min="2020-01-01" max="2099-12-31"`)}
        ${formField("f-unavail-note", "Reason", "text", "", `required maxlength="120" placeholder="exam period, pending course nomination…"`)}
        <p style="font-size:11px;color:var(--muted);margin:-4px 0 0">
          A planning hint only. It does not change parade state, block an assignment or move any
          points — it highlights a duty that lands inside the window.
        </p>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);
}

function submitDutyUnavail() {
  if (!canPlanDuty()) return;
  const sel = document.getElementById("f-unavail-d4");
  const people = sel ? [...sel.selectedOptions].map(o => o.value).filter(Boolean) : [];
  if (!people.length) { alert("Pick at least one person."); return; }

  const from = gv("f-unavail-from"), to = gv("f-unavail-to");
  if (!from || !to) { alert("Both dates are required."); return; }
  // Refuse an inverted range rather than storing one. duCovers would match no
  // date at all, so the flag would sit in the list looking correct while doing
  // nothing — the failure nobody goes looking for.
  if (to < from) { alert("The end date is before the start date."); return; }

  const note = gv("f-unavail-note").trim();
  if (!note) { alert("Give a reason — an unexplained highlight is not actionable."); return; }

  const addedAt = new Date().toISOString();
  const rows = people.map(d4 => ({
    id: nextId(), d4, from, to, note,
    addedBy: STATE.email || "", addedAt
  }));
  (STATE.dutyUnavailable = STATE.dutyUnavailable || []).push(...rows);

  saveLocal(); closeModal(); render();
  // appendMany rather than N upserts: these are all brand-new rows, and one
  // OCC-guarded write is one chance to fail instead of N.
  if (STATE.apiUrl) autoSync("DutyUnavailable", { type: "appendMany", rows });
}

function deleteDutyUnavail(id) {
  if (!canPlanDuty()) return;
  const f = (STATE.dutyUnavailable || []).find(x => String(x.id) === String(id));
  if (!f) return;
  if (!confirm(`Remove the ${f.from} → ${f.to} flag for ${displayPersonLabel(f.d4)}?`)) return;
  STATE.dutyUnavailable = (STATE.dutyUnavailable || []).filter(x => String(x.id) !== String(id));
  saveLocal(); render();
  if (STATE.apiUrl) autoSync("DutyUnavailable", { type: "delete", id });
}
