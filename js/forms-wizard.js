// The log-conduct attendance wizard, including Feature 30 paste-a-list-of-4Ds.
//
// Split out of the original monolithic forms.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// ─── LOG CONDUCT WIZARD ───────────────────────────────
// Single-modal wizard that captures one conduct's full attendance + every
// non-participating row in one shot. Replaces the two-form input flow
// (openAttendanceForm + openConductDetailForm) as the primary entry point —
// the legacy forms still open for single-row edits via the table actions.
//
// State shape:
//   _logConduct = {
//     attendanceId,            // null for new, attendance row id for edit
//     date,                    // ISO "2026-05-29"
//     time,                    // "0730" — empty until conduct picked
//     conductId,               // c001 etc.
//     totalOverride,           // null = derive from participants, else explicit number
//     remarks,                 // free text
//     status: [                // pre-existing-status checklist, filtered to participants
//       { d4, statusTag, reason, notParticipating }
//     ],
//     statusBuiltFor,          // the date `status` was derived for — lets a rebuild
//                              // tell a participant change (keep the user's ticks)
//                              // from a date change (re-derive from that day)
//     rsi:        [{ d4, reason }],   // reported sick at FP (no participation)
//     fallout:    [{ d4, reason, eventTime }],   // dropped out mid-conduct, didn't go to MO
//     reportSick: [{ d4, reason, eventTime }],   // dropped out mid-conduct AND went to MO
//                                 // eventTime: "HHMM", when THEY dropped out —
//                                 // autofilled from the clock on + Add, editable
//                                 // after, and blank on rows predating the field.
//                                 // Distinct from `time` above, which is the
//                                 // CONDUCT's time and is a stored-row join key.
//     participants:   [],      // gross accumulated 4D snapshot (source of truth
//                               // for totals + checklist; NET is computed at save)
//     addedGroups:    [],      // [{label, value}] display-only chips
//     importedBaseline: [],    // seed from an edited row; survives group recomputes
//     haCounts:  false,        // "Counts toward Heat Acclimatisation" checkbox
//     haPeriods: 1             // Single (1) / Double (2) period selector
//   }
let _logConduct = null;

// Medical visit types whose VISIT DATE (Medical.date, not the status window) puts
// the person away from that day's training: they were at the MO, the review, or
// the appointment. Used by rebuildLogConductStatus to list them on the Status
// Personnel checklist even when no status is active on the date. Same set the §8
// parade classifier keys off the visit date (js/braves-parade.js).
const MED_VISIT_TYPES = ["RSI", "RSO", "MR", "MA"];

// The wizard sections whose rows carry a drop-out time. Both are "dropped out
// mid-conduct" events — a Report Sick is a fallout that went on to the MO — so
// the time means the same thing on each. RSI is absent because the wizard no
// longer manages RSI rows at all (see openLogConductWizard).
//
// Declared up here rather than beside wizAddRow because sectionList (~line 348)
// reads it too, and a const is in the TDZ until its declaration runs.
const WIZ_TIMED_SECTIONS = ["fallout", "reportSick"];

// ── Unsaved-work diff ────────────────────────────────────────────────────────
//
// The wizard holds a whole conduct's attendance in memory and persists NOTHING
// until saveLogConductWizard() runs, so closing it discards everything. The
// guard below (wizardCloseGuard) warns first — but only when something actually
// changed.
//
// Why a diff and not "are there rows present": edit mode pre-loads every
// matching conductDetail row into fallout/reportSick BEFORE the user touches
// anything, so a presence test fires on opening an existing conduct and closing
// it unchanged. A warning that fires when nothing changed is one users learn to
// click through, which costs the real cases.
//
// A WHITELIST, not a blacklist: a field added to _logConduct later is absent
// from the diff until someone adds it here deliberately. That fails quiet
// (a missed warning) rather than loud (a warning on every close), which is the
// right way round for a confirmation prompt.
//
// Excluded on purpose:
//   showExclCommanders — display-only, reset every open, never persisted.
//     Toggling a view is not unsaved work.
//   originalDetailIds / importedBaseline / attendanceId / statusBuiltFor —
//     bookkeeping set at open (or by rebuildLogConductStatus), never edited.
const WIZ_SNAPSHOT_FIELDS = [
  "date", "time", "conductId", "totalOverride", "remarks",
  "status", "rsi", "fallout", "reportSick", "participants", "addedGroups",
  "haCounts", "haPeriods"
];

// Builds the object literal in WIZ_SNAPSHOT_FIELDS order, so JSON.stringify is
// stable regardless of the key order _logConduct itself happens to carry.
function wizSnapshot(lc) {
  if (!lc) return null;
  const out = {};
  WIZ_SNAPSHOT_FIELDS.forEach(k => { out[k] = lc[k]; });
  return out;
}

// The baseline taken at open. Null means "no wizard, or registration never
// ran" — wizIsDirty answers false in that case rather than guessing, so a
// missed registration can never turn into a prompt on every modal close.
let _logConductBaseline = null;

function wizIsDirty() {
  if (!_logConduct || _logConductBaseline == null) return false;
  return JSON.stringify(wizSnapshot(_logConduct)) !== _logConductBaseline;
}

// Enter-to-save for the conduct wizard. The wizard is a plain <div> (not a
// <form>), so Enter does nothing by default. We bind ONE keydown listener on the
// shared #modal-overlay and self-gate it: it acts only while _logConduct is open
// and the overlay is visible. Note _logConduct is only cleared on a SUCCESSFUL
// save, not on Cancel or generic closeModal(), so those two checks alone can't
// tell a stale wizard state from a live one once a different modal (which
// shares #modal-overlay) is opened afterward. The decisive guard is confirming
// the wizard's own DOM (#wiz-remarks) is actually the modal on screen — that's
// what makes this inert for every other modal. Enter in the Remarks textarea
// stays a newline; Enter in a person-search box is already handled (and
// stopped) by personSearchEnter, so the id-ending guard here is
// belt-and-suspenders.
let _wizEnterBound = false;
function bindWizardEnterToSave() {
  if (_wizEnterBound) return;
  _wizEnterBound = true;
  document.getElementById("modal-overlay").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (!_logConduct) return;
    if (document.getElementById("modal-overlay").classList.contains("hidden")) return;
    if (!document.getElementById("wiz-remarks")) return; // the wizard's own modal isn't the one on screen
    if (e.target.tagName === "TEXTAREA") return;
    if (e.target.id && e.target.id.endsWith("-input")) return;
    e.preventDefault();
    saveLogConductWizard();
  });
}

// Open the wizard. Pass an attendance row id to load it in edit mode.
function openLogConductWizard(attendanceId) {
  bindWizardEnterToSave();
  const a = attendanceId ? STATE.attendance.find(x => x.id === attendanceId) : null;
  _logConduct = {
    attendanceId: a?.id || null,
    date: a ? displayDateToISO(a.date) || todayISO() : todayISO(),
    time: a?.time || "",
    conductId: a?.conductId || "",
    totalOverride: a ? a.total : null,
    remarks: a?.remarks || "",
    status: [],
    rsi: [],
    fallout: [],
    reportSick: [],
    participants: [],
    addedGroups: [],
    importedBaseline: [],
    haCounts: false,
    haPeriods: 1,
    // Display-only "without commanders" view toggle. Ephemeral — reset every
    // open, never persisted to the sheet.
    showExclCommanders: false,
    // Non-RSI conductDetail row ids loaded into the wizard on edit — used only
    // for the "was N rows" figure in the save confirmation now. The sheet sync
    // no longer diffs against this: saveLogConductWizard replaces this conduct's
    // detail rows atomically (a single replaceConduct op keyed on
    // date/time/conductId), so there are no obsolete ids to delete individually.
    originalDetailIds: []
  };
  // Edit mode: pre-load every conductDetail row matching this attendance's
  // (date, time, conductId). Status personnel auto-rebuild already handles
  // marking PX rows correctly via the existing-PX lookup.
  if (a) {
    const matchDetails = STATE.conductDetail.filter(d =>
      d.date === a.date && (d.time || "") === (a.time || "") && d.conductId === a.conductId
    );
    matchDetails.forEach(d => {
      // RSI is intentionally skipped — the wizard doesn't manage RSI anymore.
      // Legacy RSI rows pass through untouched on save (see saveLogConductWizard).
      if (d.type !== "RSI") _logConduct.originalDetailIds.push(d.id);
      // eventTime falls back to "" rather than to the conduct's `time` or to the
      // clock: rows written before the column existed genuinely have no
      // drop-out time, and inventing one would assert something false about
      // when that person fell out.
      if (d.type === "Fallout") _logConduct.fallout.push({ d4: d.d4, reason: d.reason || "", eventTime: d.eventTime || "" });
      else if (d.type === "ReportSick") _logConduct.reportSick.push({ d4: d.d4, reason: d.reason || "", eventTime: d.eventTime || "" });
    });
    // Gross reconstruction of the participant snapshot: the stored field is
    // NET (Present list, absentees excluded per CSV convention — see the
    // design doc), so re-add this conduct's non-RSI ConductDetail d4s to get
    // back the gross set the Attendees card should show. addedGroups stays
    // empty — a snapshot can't be reverse-engineered into the groups that
    // built it; the UI renders a non-removable "Existing (N)" chip instead.
    const detailD4s = matchDetails.filter(d => d.type !== "RSI").map(d => d.d4);
    const seed = [...new Set([...parseParticipantIds(a.participants || ""), ...detailD4s])];
    _logConduct.participants = seed;
    _logConduct.importedBaseline = seed;
    _logConduct.haCounts = /\bha\b/i.test(a.currencyTags || "");
    _logConduct.haPeriods = Number(a.periods) || 1;
  }
  rebuildLogConductStatus();
  renderLogConductWizard();
}

// Rebuilds the Status Personnel checklist from STATE.medical for the current
// date. Preserves any user edits (notParticipating + reason) when possible:
// if a d4 was already in the previous state list, carry over the flags.
function rebuildLogConductStatus() {
  if (!_logConduct) return;
  // Carry the user's edits (ticks + typed reasons) over ONLY when the checklist
  // is being rebuilt for the SAME date it was last built for. A participant-set
  // change (wizAddGroup/wizRemoveGroup) must preserve them; a DATE change must
  // NOT — every tick and reason below is derived from one specific day's medical
  // layer, so carrying them across a date change left e.g. a recruit tagged with
  // the newly-active "MC" but sitting unticked, wearing the previous day's
  // reason. `statusBuiltFor` is the date the current rows were derived for
  // (undefined on a fresh open, where status is [] anyway).
  const prevByD4 = {};
  if (_logConduct.statusBuiltFor === _logConduct.date) {
    (_logConduct.status || []).forEach(s => { prevByD4[s.d4] = s; });
  }
  // For edit mode, also seed "notParticipating" from existing Status
  // conductDetail rows matching this attendance — so re-opening shows the
  // correct ticks. ("Status" = the pre-existing-status non-participation type,
  // formerly mislabelled "PX".)
  //
  // `statusReviewed` on the attendance row records whether the status checklist
  // has been through the wizard at least once (set on save below). It matters
  // because a CSV import lists a recruit as PRESENT even when they had a
  // restrictive status that day (their LD/MC lives in Medical, not the CSV), so
  // no Status row is created for them. Until the conduct is reviewed, "no Status
  // row" must NOT be read as "participated despite status" — it just means the
  // import never accounted for their medical status. So while unreviewed we fall
  // back to the medical default (defaultNP, same as a brand-new conduct); once
  // reviewed, an absent Status row is an explicit "participates" decision we honor.
  //
  // The review is only good for the date it was reviewed ON. Once the user moves
  // an edited conduct to a different date, "no Status row" says nothing about the
  // new date's medical layer, so we drop back to the medical default there —
  // otherwise back-dating a reviewed conduct onto someone's active MC would leave
  // them silently unticked. The saved Status rows themselves still count as
  // explicit absences (they belong to this conduct, whatever date it now carries).
  let existingPxByD4 = {};
  let statusReviewed = false;
  if (_logConduct.attendanceId) {
    const a = STATE.attendance.find(x => x.id === _logConduct.attendanceId);
    if (a) {
      statusReviewed = !!a.statusReviewed && displayDateToISO(a.date) === _logConduct.date;
      STATE.conductDetail
        .filter(d => d.date === a.date && (d.time || "") === (a.time || "") && d.conductId === a.conductId && d.type === "Status")
        .forEach(d => { existingPxByD4[d.d4] = d.reason || ""; });
    }
  }
  const dateIso = _logConduct.date;
  // Checklist is scoped to the selected participants (Attendees card), not a
  // blanket commander exclusion — a commander whose group (Commanders only /
  // Entire company) was added is a real attendee and belongs on the checklist.
  // A legacy edited row with no group added yet (empty participants) shows an
  // empty checklist — documented in the design doc; totals fallback keeps
  // counts sane in that case.
  const participantSet = new Set(_logConduct.participants || []);
  // Full active-medical layer (unfiltered) so a union-only d4 that ISN'T a
  // participant can still borrow its live tags; `effective` is the participant
  // slice used for the base rows.
  const allEffective = currentMedicalEffectiveAll(dateIso);
  const effByD4 = {};
  allEffective.forEach(e => { effByD4[e.d4] = e; });
  const effective = allEffective.filter(({ d4 }) => participantSet.has(d4));

  // Medical VISITS dated exactly on this conduct's date. An active-status window
  // is not the only way to be away from a day's training: the visit itself is,
  // and currentMedicalEffectiveAll knows nothing about visit dates — it only
  // reports statuses whose [startDate, endDate] covers the date. So these people
  // were silently missing from the checklist:
  //   • RSI/RSO on the day whose MO outcome only STARTS the next day
  //     (RSI 20 Jul → MC 21–23 Jul: nothing is active on the 20th),
  //   • an MR or MA carrying no status window at all.
  // Most visible when back-dating the wizard to reconstruct a past day, where the
  // medical record already exists in its RESOLVED form (live logging goes through
  // the Report Sick card instead). The §8 parade classifier reads the visit date
  // the same way (js/braves-parade.js: `reportedToday` for RSI/RSO/MR, and the MA
  // clause) — but it gates RSI/RSO/MR on the MO outcome still being pending, since
  // a resolved visit surfaces under ATT C / STATUS instead. We deliberately do NOT
  // gate: attendance only cares that the person left for the MO that day, whatever
  // the MO later wrote. So the wizard can list someone the parade state counts as
  // present — every tick here is a default the user overrides per conduct anyway.
  const visitByD4 = {};
  (STATE.medical || []).forEach(m => {
    if (!MED_VISIT_TYPES.includes(m.type)) return;
    if (displayDateToISO(m.date) !== dateIso) return;
    const v = (visitByD4[m.d4] = visitByD4[m.d4] || { tags: [], reason: "" });
    if (!v.tags.includes(m.type)) v.tags.push(m.type);
    if (!v.reason) v.reason = m.reason || "";
  });

  const rows = effective.map(({ d4, statuses }) => {
    // Pick the most-severe active status as the canonical tag/reason.
    const top = statuses[0];
    const prev = prevByD4[d4];
    const visit = visitByD4[d4];
    // A status can mean "still does the conduct" (e.g. a finger injury). Default
    // to participating only when EVERY active status participates; any
    // restrictive status (MC/LD/Excuse/…) defaults the recruit to not-
    // participating. A medical visit that same day is itself an absence (they
    // were at the MO / the appointment), so it forces the default even when the
    // status alone would have let them train. The user can always override.
    const defaultNP = statuses.some(s => !statusParticipates(s.tag)) || !!visit;
    return {
      d4,
      // Concatenate every active status so the user sees "MC + Excuse Heavy Load",
      // then the day's visit types ("MC + RSO") so it's clear WHY they're listed.
      statusTag: [...statuses.map(s => s.tag), ...(visit ? visit.tags : [])].join(" + "),
      reason: prev ? prev.reason : (existingPxByD4[d4] ?? top.record.reason ?? ""),
      // A recorded Status row always wins (ticked). Otherwise: an already
      // reviewed conduct treats "no row" as a deliberate participates decision
      // (unticked); a new or not-yet-reviewed conduct falls back to the medical
      // default so a restrictive status (e.g. LD) is ticked on the first pass.
      notParticipating: prev ? prev.notParticipating
        : ((d4 in existingPxByD4) || (statusReviewed ? false : defaultNP))
    };
  });

  // Participants whose ONLY reason to be on the checklist is a visit dated today
  // — no active status window on this date, so the map above never saw them.
  const visitOnly = new Set(rows.map(r => r.d4));
  Object.keys(visitByD4).forEach(d4 => {
    if (visitOnly.has(d4) || !participantSet.has(d4)) return;
    const prev = prevByD4[d4];
    const v = visitByD4[d4];
    rows.push({
      d4,
      statusTag: v.tags.join(" + "),
      reason: prev ? prev.reason : (existingPxByD4[d4] ?? v.reason ?? ""),
      // Same seeding rule as an active status whose defaultNP is true: a medical
      // visit means they were away unless this conduct was already reviewed on
      // this date and no Status row was recorded for them.
      notParticipating: prev ? prev.notParticipating
        : ((d4 in existingPxByD4) || (statusReviewed ? false : true))
    });
  });

  // UNION in everyone with a saved "Status" ConductDetail row who isn't already
  // on the list above. existingPxByD4 is empty for a brand-new conduct (edit-only
  // by construction — see :4173), so this never affects new conducts. Someone
  // counted in the attendance px total (a CSV Off/Leave, or a status no longer
  // active on this date) has a Status row but no active medical status and was
  // being dropped, making the checklist shorter than the count. Re-add them so
  // list length == px. Synthesize the tag from the live medical layer if any
  // status is active for them, else fall back to the ConductDetail reason label.
  const present = new Set(rows.map(r => r.d4));
  Object.keys(existingPxByD4).forEach(d4 => {
    if (present.has(d4)) return;
    const prev = prevByD4[d4];
    const eff = effByD4[d4];
    rows.push({
      d4,
      statusTag: eff ? eff.statuses.map(s => s.tag).join(" + ") : (existingPxByD4[d4] || "Status"),
      reason: prev ? prev.reason : (existingPxByD4[d4] || ""),
      // Recorded as a status absence at import ⇒ default ticked (not participating).
      notParticipating: prev ? prev.notParticipating : true
    });
  });

  _logConduct.status = rows.sort((a, b) => a.d4.localeCompare(b.d4));
  // Record which date these rows were derived for, so the next rebuild can tell a
  // participant change (preserve edits) from a date change (re-derive).
  _logConduct.statusBuiltFor = dateIso;
}

// Builds the modal HTML and opens it. Re-rendering is full-replace; row-level
// mutations that wouldn't change focus or scroll position update DOM directly
// (e.g. count totals) instead of re-rendering.
function renderLogConductWizard() {
  if (!_logConduct) return;
  const w = _logConduct;
  const title = w.attendanceId ? "Edit Conduct" : "Log Conduct";
  const dateVal = w.date || todayISO();
  const totals = computeLogConductTotals();

  const editNotice = w.attendanceId
    ? `<div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;margin-bottom:4px">Editing existing conduct. Saving replaces all child rows for this (date, time, conduct) tuple.</div>`
    : "";

  // Feature 30.1: the visit TIME beside each person's status.
  //
  // Only the time, not the full "TYPE time" the other two surfaces show —
  // rebuildLogConductStatus already appends the day's visit types to statusTag
  // (see visitByD4 there, "MC + RSO"), so emitting visitSuffix() wholesale
  // printed the type twice: "Pending + RSI + RSI 0830". Appending just the time
  // gives the spec's "Pending + RSI 0830". Where the tag does NOT end in this
  // visit's type — a multi-visit day, RSI in the morning and an MA after lunch —
  // the type is named, so the time can't attach itself to the wrong visit.
  //
  // Shown once per person (the suffix describes the VISIT, not each status it
  // produced) and only for a visit on the wizard's OWN date: the wizard
  // routinely back-dates, and today's RSI time against last Tuesday's status
  // would be a lie. A blank time adds nothing at all — the type is already there.
  const wizVisitSuffix = (d4, statusTag) => {
    const v = visitForDay(d4, dateVal);
    const time = v ? String(v.time || "").trim() : "";
    if (!time) return "";
    return String(statusTag || "").endsWith(v.type) ? ` ${time}` : ` + ${visitSuffix(v)}`;
  };

  const statusRows = w.status.length ? w.status.map(s => `
    <div class="lc-wiz-status-row" style="display:grid;grid-template-columns:18px 48px minmax(0,1.4fr) minmax(80px,auto) minmax(0,1fr);gap:8px;align-items:center;padding:6px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border);box-sizing:border-box">
      <input type="checkbox" ${s.notParticipating ? "checked" : ""} onchange="wizToggleStatusNP('${s.d4}', this.checked)" style="width:16px;height:16px;cursor:pointer" title="Tick = not participating">
      <span class="mono" style="font-weight:700;color:var(--accent);font-size:12px">${displayId(s.d4)}</span>
      <span style="font-size:12px;min-width:0;line-height:1.3" title="${escapeAttr(getName(s.d4))}">${escapeAttr(getName(s.d4))}</span>
      <span style="font-size:10px;color:var(--orange);font-weight:600;line-height:1.4;background:#D2992222;border:1px solid #D2992244;border-radius:10px;padding:3px 9px;white-space:normal;justify-self:start" title="${escapeAttr(s.statusTag)}">${escapeAttr(s.statusTag)}<span style="color:var(--muted);font-weight:400">${escapeAttr(wizVisitSuffix(s.d4, s.statusTag))}</span></span>
      <input type="text" value="${escapeAttr(s.reason)}" placeholder="reason (optional)" oninput="wizUpdateStatusReason('${s.d4}', this.value)" style="min-width:0;width:100%;padding:5px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:inherit;font-size:11px;box-sizing:border-box">
    </div>
  `).join("") : `<div style="color:var(--muted);font-size:11px;padding:8px 10px;background:var(--surface);border:1px dashed var(--border);border-radius:6px;text-align:center">No recruits on medical status for this date.</div>`;

  const sectionList = (key, label, helpText, color) => {
    // Only fallout/reportSick carry a drop-out time. The grid template and the
    // cell are driven by the SAME flag — a 5-column template with a 4-column
    // row would silently push the ✕ button out of its track.
    const timed = WIZ_TIMED_SECTIONS.includes(key);
    const cols = timed
      ? "28px minmax(0,1fr) minmax(0,1fr) 64px 32px"
      : "28px minmax(0,1fr) minmax(0,1fr) 32px";
    const rows = (w[key] || []).map((row, i) => `
      <div class="lc-wiz-bulk-row" style="display:grid;grid-template-columns:${cols};gap:8px;align-items:center;padding:8px 10px;border-radius:6px;background:var(--surface);border:1px solid var(--border);box-sizing:border-box">
        <span class="mono" style="color:var(--muted);font-size:12px;font-weight:700">${String(i + 1).padStart(2, "0")}</span>
        <div style="min-width:0">${personSearchBox({ boxId: `wiz-${key}-d4-${i}`, onPickFn: "wizPickRow", roleFilter: "Recruit", selected: row.d4, placeholder: "Search name / 4D…" })}</div>
        <input type="text" value="${escapeAttr(row.reason)}" placeholder="reason" oninput="wizUpdateRowReason('${key}', ${i}, this.value)" style="min-width:0;width:100%;padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:inherit;font-size:12px;box-sizing:border-box">
        ${timed ? `<input type="text" value="${escapeAttr(row.eventTime || "")}" placeholder="HHMM" maxlength="4" inputmode="numeric"
          title="Time they dropped out — filled in when this row was added, editable"
          oninput="wizUpdateRowEventTime('${key}', ${i}, this.value)"
          style="min-width:0;width:100%;padding:7px 6px;border-radius:4px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:inherit;font-size:12px;text-align:center;box-sizing:border-box">` : ""}
        <button type="button" class="btn btn-icon btn-danger" onclick="wizRemoveRow('${key}', ${i})" title="Remove" style="padding:4px 8px">✕</button>
      </div>
    `).join("");
    return `<div class="card" style="padding:12px 14px;margin-bottom:10px;background:var(--surface2);border-radius:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <strong style="color:${color};font-size:13px">${label}</strong> <span style="color:var(--muted);font-size:11px">(${w[key].length})</span>
          <div style="font-size:10px;color:var(--dim);margin-top:2px;line-height:1.45">${helpText}</div>
        </div>
        <button type="button" class="btn" style="font-size:12px;padding:6px 12px;white-space:nowrap" onclick="wizAddRow('${key}')">+ Add</button>
      </div>
      ${rows ? `<div style="display:flex;flex-direction:column;gap:6px">${rows}</div>` : ""}
    </div>`;
  };

  const html = `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${editNotice}

      <div class="card" style="padding:10px 12px;background:var(--surface2)">
        <div class="lc-wiz-header" style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:8px">
          <div class="form-group">
            <label>Date</label>
            <input type="date" id="wiz-date" value="${dateVal}" min="2020-01-01" max="2099-12-31" required onchange="wizSetDate(this.value)" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">
          </div>
          <div class="form-group">
            <label>Time (HHMM)</label>
            <input type="text" id="wiz-time" value="${escapeAttr(w.time)}" placeholder="0730" maxlength="4" pattern="[0-9]{4}" oninput="wizSetTime(this.value)" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">
          </div>
          <div class="form-group">
            <label>Conduct</label>
            ${conductPicker({ inputId: "wiz-conductId", selectedId: w.conductId, onChange: `wizSetConductId(document.getElementById('wiz-conductId').value)` })}
          </div>
        </div>
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin:0">
            <input type="checkbox" ${w.haCounts ? "checked" : ""} onchange="wizToggleHA(this.checked)" style="width:16px;height:16px;cursor:pointer">
            Counts toward Heat Acclimatisation
          </label>
          ${w.haCounts ? `
            <select id="wiz-ha-periods" onchange="wizSetHAPeriods(this.value)" style="padding:5px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px">
              <option value="1" ${w.haPeriods === 1 ? "selected" : ""}>Single (1h)</option>
              <option value="2" ${w.haPeriods === 2 ? "selected" : ""}>Double (2h)</option>
              ${(w.haPeriods !== 1 && w.haPeriods !== 2) ? `<option value="${escapeAttr(w.haPeriods)}" selected>${escapeAttr(w.haPeriods)} (imported)</option>` : ""}
            </select>
          ` : ""}
        </div>
      </div>

      <div class="card" style="padding:12px 14px;margin-bottom:10px;background:var(--surface2);border-radius:8px">
        <div style="margin-bottom:8px">
          <strong style="color:var(--accent);font-size:13px">👥 Attendees</strong> <span style="color:var(--muted);font-size:11px">(${w.participants.length} in this conduct)</span>
          <div style="font-size:10px;color:var(--dim);margin-top:2px;line-height:1.45">Add every group attending this conduct. Groups accumulate — add a platoon today, another tomorrow.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="wiz-group-select" style="flex:1;min-width:180px;padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px">
            <option value="" selected>Select a group to add…</option>
            ${activePlatoons().map(p => `<option value="platoon:${escapeAttr(p.code)}">${escapeAttr(p.displayName)}</option>`).join("")}
            <option value="company">Entire company</option>
            <option value="noncommanders">Non-Commanders</option>
            <option value="commanders">Commanders only</option>
          </select>
          <button type="button" class="btn" style="font-size:12px;padding:6px 12px;white-space:nowrap" onclick="const sel = document.getElementById('wiz-group-select'); const v = sel.value; if (v) { wizAddGroup(v, sel.options[sel.selectedIndex].textContent); }">+ Add group</button>
        </div>
        <div style="margin-top:8px">
          <div style="font-size:10px;color:var(--dim);margin-bottom:3px">…or add one recruit by name / 4D:</div>
          ${personSearchBox({ boxId: "wiz-individual", onPickFn: "wizPickIndividual", placeholder: "Search recruit to add…", roleFilter: "Recruit" })}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
          ${(!w.participants.length && !w.addedGroups.length) ? "" :
            (!w.addedGroups.length && w.participants.length) ? `
              <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:4px 10px" title="Seeded from the saved row">Existing (${w.participants.length})</span>
            ` : w.addedGroups.map(g => `
              <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:4px 6px 4px 10px">
                ${escapeAttr(g.label)} (${resolveConductGroup(g.value).length})
                <button type="button" class="btn btn-icon btn-danger" onclick="wizRemoveGroup('${escapeAttr(g.value)}')" title="Remove group" style="padding:1px 6px;font-size:10px;line-height:1">✕</button>
              </span>
            `).join("")}
        </div>
      </div>

      <!-- Feature 30: heads the three absence sections below rather than sitting
           inside any one of them, because the destination is chosen in the modal
           and the paste can land in any of Status / Report Sick / Fallout. A
           button rather than an always-visible textarea: the common case is
           ticking a couple of names, and a permanent textarea would push the
           checklist down the modal for everyone. -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button type="button" class="btn" style="font-size:12px;padding:6px 12px;white-space:nowrap" onclick="openWizPasteModal()">📋 Paste absentees</button>
        <span style="font-size:10px;color:var(--dim)">Have the list already? Paste 4Ds straight into Fallout, Report Sick or Status.</span>
      </div>

      <div class="card" style="padding:12px 14px;margin-bottom:10px;background:var(--surface2);border-radius:8px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <strong style="color:var(--accent);font-size:13px">⚕️ Status Personnel</strong> <span style="color:var(--muted);font-size:11px">(${w.status.length} on status today)</span>
            <div style="font-size:10px;color:var(--dim);margin-top:2px;line-height:1.45">Tick to mark as not participating. Untick if a status-personnel is actually participating in this conduct.</div>
          </div>
          ${w.status.length ? `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;white-space:nowrap;margin:0">
            <input type="checkbox" id="wiz-status-all" onchange="wizToggleAllStatusNP(this.checked)" style="width:15px;height:15px;cursor:pointer"> Select all — not participating
          </label>` : ""}
        </div>
        ${(() => {
          // One bulk tick/untick button per recovery tag actually present on the
          // checklist (see recoveryTagRows). Absent tags draw no button.
          const map = recoveryTagRows(w.status);
          const tags = Object.keys(map);
          if (!tags.length) return "";
          return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
            <span style="font-size:10px;color:var(--dim);align-self:center">Recovery — tick/untick:</span>
            ${tags.map(tag => `<button type="button" class="btn" style="font-size:11px;padding:4px 10px;white-space:nowrap" onclick="wizToggleRecoveryTag('${tag}')">${escapeHTML(tag)} (${map[tag].length})</button>`).join("")}
          </div>`;
        })()}
        <div style="display:flex;flex-direction:column;gap:6px">${statusRows}</div>
      </div>

      ${sectionList("reportSick", "📋 Report Sick", "Dropped out mid-conduct AND went to MO afterward. Auto-creates a Pending Medical row — update with MC/LD/etc. once MO clears.", "var(--orange)")}
      ${sectionList("fallout", "💤 Fallout", "Dropped out mid-conduct, did NOT go to MO.", "var(--purple)")}

      <div id="wiz-overlap-warning"></div>

      <div class="card" style="padding:12px 14px;background:var(--surface2);border-radius:8px">
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;margin:0 0 8px">
          <input type="checkbox" id="wiz-excl-commanders" ${w.showExclCommanders ? "checked" : ""} onchange="wizToggleExclCommanders(this.checked)" style="width:15px;height:15px;cursor:pointer">
          Show counts without commanders <span style="color:var(--dim)">(view only — doesn't change what's saved)</span>
        </label>
        <div class="lc-wiz-stats-top" style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:end">
          <div class="form-group" style="grid-column:span 2;margin:0">
            <label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Total Str</label>
            <input type="number" id="wiz-total" min="0" max="999" step="1" value="${totals.total}" oninput="wizSetTotalOverride(this.value)" style="width:100%;padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:15px;font-weight:700;box-sizing:border-box">
          </div>
          <div class="stat" style="text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 8px"><label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Status</label><div id="wiz-stat-status" class="val" style="font-size:20px;font-weight:700;color:var(--accent);margin-top:2px">${totals.statusCount}</div></div>
          <div class="stat" style="text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 8px"><label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Rpt Sick</label><div id="wiz-stat-reportSick" class="val" style="font-size:20px;font-weight:700;color:var(--orange);margin-top:2px">${totals.reportSickCount}</div></div>
          <div class="stat" style="grid-column:span 2;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 8px"><label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Fallout</label><div id="wiz-stat-fallout" class="val" style="font-size:20px;font-weight:700;color:var(--purple);margin-top:2px">${totals.falloutCount}</div></div>
        </div>
        <div class="lc-wiz-stats-bot" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px">
          <div class="stat" style="text-align:center;background:var(--surface);border:1px solid var(--green);border-radius:6px;padding:10px"><label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Participating <span style="color:var(--dim);text-transform:none">(auto)</span></label><div id="wiz-stat-participating" class="val" style="font-size:26px;font-weight:700;color:var(--green);margin-top:2px">${totals.participating}</div></div>
          <div class="stat" style="text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px"><label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">LMS <span style="color:var(--dim);text-transform:none">(after save)</span></label><div class="val" style="font-size:26px;font-weight:700;color:var(--muted);margin-top:2px">—</div></div>
        </div>
        ${w.showExclCommanders ? `
        <div id="wiz-nc-readout" style="margin-top:8px;padding:8px 10px;background:var(--surface);border:1px dashed var(--border);border-radius:6px">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Without commanders <span style="color:var(--dim);text-transform:none">(${totals.commanders} excluded)</span></div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;text-align:center">
            <div><div style="font-size:9px;color:var(--muted)">Total</div><div id="wiz-nc-total" style="font-size:16px;font-weight:700;color:var(--text)">${totals.totalNc}</div></div>
            <div><div style="font-size:9px;color:var(--muted)">Status</div><div id="wiz-nc-status" style="font-size:16px;font-weight:700;color:var(--accent)">${totals.statusCountNc}</div></div>
            <div><div style="font-size:9px;color:var(--muted)">Rpt Sick</div><div id="wiz-nc-reportSick" style="font-size:16px;font-weight:700;color:var(--orange)">${totals.reportSickCountNc}</div></div>
            <div><div style="font-size:9px;color:var(--muted)">Fallout</div><div id="wiz-nc-fallout" style="font-size:16px;font-weight:700;color:var(--purple)">${totals.falloutCountNc}</div></div>
            <div><div style="font-size:9px;color:var(--muted)">Participating</div><div id="wiz-nc-participating" style="font-size:16px;font-weight:700;color:var(--green)">${totals.participatingNc}</div></div>
          </div>
        </div>` : ""}
        <div class="form-group" style="margin-top:12px">
          <label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Remarks <span style="color:var(--dim);text-transform:none">(optional)</span></label>
          <textarea id="wiz-remarks" rows="2" maxlength="500" placeholder="Any data inconsistencies, recruit flags…" oninput="_logConduct.remarks = this.value" style="padding:8px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;resize:vertical;width:100%;box-sizing:border-box">${escapeAttr(w.remarks)}</textarea>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-success" onclick="saveLogConductWizard()">💾 Save${w.attendanceId ? "" : " + Copy chat"}</button>
      </div>
    </div>
  `;
  openModal(title, html);
  // Wider modal — five-column status rows + bulk-add sections need the room.
  document.querySelector(".modal")?.classList.add("wide");
  // Sync the "select all — not participating" header checkbox to the aggregate row
  // state (see syncStatusAllBox for the checked/indeterminate rule).
  syncStatusAllBox();
  updateLogConductOverlapWarning();
}

// Reconcile the "select all — not participating" header checkbox with the current
// per-row flags: checked when every status row is ticked, cleared when none are,
// indeterminate when only some are. (`indeterminate` can't be expressed as an HTML
// attribute, so it must be set imperatively.) Extracted so the lightweight per-row
// toggle (wizToggleStatusNP) can keep the header in sync WITHOUT a full re-render —
// otherwise unticking one person leaves the header falsely showing "all selected".
function syncStatusAllBox() {
  if (!_logConduct) return;
  const allBox = document.getElementById("wiz-status-all");
  if (!allBox) return;
  const total = (_logConduct.status || []).length;
  if (!total) { allBox.checked = false; allBox.indeterminate = false; return; }
  const on = _logConduct.status.filter(s => s.notParticipating).length;
  allBox.checked = on === total;
  allBox.indeterminate = on > 0 && on < total;
}

// === Wizard mutation handlers ===========================================

function wizSetDate(v) {
  _logConduct.date = v;
  rebuildLogConductStatus();
  renderLogConductWizard();
}
function wizSetTime(v) {
  _logConduct.time = v;
}
function wizSetConductId(v) {
  _logConduct.conductId = v;
  if (v && !_logConduct.time) {
    const inferred = inferTimeForConduct(v);
    if (inferred) _logConduct.time = inferred;
  }
  renderLogConductWizard();
}
function wizSetTotalOverride(v) {
  const n = +v;
  _logConduct.totalOverride = Number.isFinite(n) && n >= 0 ? n : null;
  recomputeLogConductFooter();
}
function wizToggleStatusNP(d4, checked) {
  const row = _logConduct.status.find(s => s.d4 === d4);
  if (row) row.notParticipating = !!checked;
  // Keep the "select all" header box's checked/indeterminate state honest as
  // individual rows are toggled, without paying for a full re-render.
  syncStatusAllBox();
  recomputeLogConductFooter();
}
// Bulk-set every status person's not-participating flag from the section header
// checkbox. A full re-render (not recomputeLogConductFooter) is intentional here:
// it repaints every row checkbox and re-syncs the header's aggregate/indeterminate
// state. Used far less often than the per-row toggle, so the re-render cost is fine.
function wizToggleAllStatusNP(checked) {
  if (!_logConduct) return;
  _logConduct.status.forEach(s => { s.notParticipating = !!checked; });
  renderLogConductWizard();
}
// Bulk tick/untick every PURE-recovery status row carrying `tag` (one of
// RECOVERY_TAGS). Two-state toggle over its own remit: if every targeted row is
// already ticked, untick them all; otherwise tick them all. A full re-render
// repaints the row checkboxes and re-syncs the select-all header, mirroring
// wizToggleAllStatusNP — buttons hold no text-input focus, so re-render is safe.
function wizToggleRecoveryTag(tag) {
  if (!_logConduct) return;
  const targetSet = new Set(recoveryTagRows(_logConduct.status)[tag] || []);
  if (!targetSet.size) return;
  const rows = _logConduct.status.filter(s => targetSet.has(s.d4));
  const allTicked = rows.every(s => s.notParticipating);
  rows.forEach(s => { s.notParticipating = !allTicked; });
  renderLogConductWizard();
}
// Flip the display-only "without commanders" view. A full re-render is used so
// the secondary readout appears/disappears; it changes nothing that is saved.
function wizToggleExclCommanders(checked) {
  if (!_logConduct) return;
  _logConduct.showExclCommanders = !!checked;
  renderLogConductWizard();
}
function wizUpdateStatusReason(d4, v) {
  const row = _logConduct.status.find(s => s.d4 === d4);
  if (row) row.reason = v;
}
function wizAddRow(section) {
  // Stamped at ADD time, not at save time: the sergeant is normally logging
  // this live as it happens, so the clock now is the best available guess at
  // when the person actually dropped out. It is only a default — the field is
  // editable, for the case where a batch is entered after the fact.
  const eventTime = WIZ_TIMED_SECTIONS.includes(section) ? nowHHMM() : "";
  _logConduct[section].push({ d4: "", reason: "", eventTime });
  renderLogConductWizard();
}
function wizRemoveRow(section, idx) {
  _logConduct[section].splice(idx, 1);
  renderLogConductWizard();
}
function wizUpdateRowD4(section, idx, v) {
  if (!_logConduct[section][idx]) return;
  _logConduct[section][idx].d4 = v;
  updateLogConductOverlapWarning();
}
// personSearchBox pick handler for the report-sick/fallout row typeaheads.
// One handler serves every row; the section key + row index are recovered from
// the box id (`wiz-<section>-d4-<idx>`, set in sectionList above).
function wizPickRow(d4, boxId) {
  const m = /^wiz-(\w+)-d4-(\d+)$/.exec(boxId || "");
  if (!m) return;
  wizUpdateRowD4(m[1], Number(m[2]), d4);
}
function wizUpdateRowReason(section, idx, v) {
  if (!_logConduct[section][idx]) return;
  _logConduct[section][idx].reason = v;
}
// Mirrors wizUpdateRowReason, including its missing-row guard: a render/state
// race that addresses a removed index must be a no-op, not a throw that takes
// the wizard down mid-edit. Deliberately NOT pad4Time-normalized on every
// keystroke — that would rewrite "7" to "0700" while the user is still typing
// "0745". Normalization happens once, at save (see saveLogConductWizard).
function wizUpdateRowEventTime(section, idx, v) {
  if (!_logConduct[section][idx]) return;
  _logConduct[section][idx].eventTime = v;
}

// Recompute _logConduct.participants from importedBaseline + every added
// group's resolved ids. Pure recompute (never subtract) — groups can overlap
// (e.g. a platoon + Commanders only), so union is the only safe operation;
// removing a chip re-runs this same union without it (see wizRemoveGroup).
function wizRecomputeParticipants() {
  const w = _logConduct;
  w.participants = [...new Set([
    ...(w.importedBaseline || []),
    ...(w.addedGroups || []).flatMap(g => resolveConductGroup(g.value))
  ])];
}
// ── Feature 30: paste a list of 4Ds as absentees ────────────────────────────
// A commander typically arrives with the absentee list already written down —
// in a chat message, a notebook, a spreadsheet column — and ticking twenty
// names one at a time is the slow part of logging a conduct.
//
// Matching is STRICT against the roster: "123" and "C0123" are NOT normalized
// to "0123". Everywhere else in the app padD4() is applied liberally at read
// boundaries, and that is right for data arriving from the sheet — but this is
// bulk human input, where a silent helpful correction quietly lands the wrong
// person in the absent list and nobody sees it happen. A token that does not
// match exactly comes back as unmatched so the confirm panel can show it.
//
// Separators are whitespace (newlines and tabs included — a column copied out
// of a spreadsheet arrives tab-separated) and commas. Anything else stays part
// of the token, so "0123;0124" reports as one bad entry rather than being split
// into two ids the user never typed.
function parsePastedD4s(text, roster) {
  const known = new Set((roster || []).map(r => String(r.id)));
  const tokens = String(text || "").split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const matched = [], unmatched = [];
  const seen = new Set();
  tokens.forEach(t => {
    if (seen.has(t)) return;   // one entry per id, in pasted order
    seen.add(t);
    if (known.has(t)) matched.push(t); else unmatched.push(t);
  });
  return { matched, unmatched };
}

// The paste is AUTHORITATIVE: a 4D already sitting in another bucket (typically
// auto-listed under Status Personnel) is removed from it and placed in the
// pasted destination. Skipping them instead would make a deliberate correction
// look like it did nothing.
//
// "status" is the one destination that cannot create a row. The Status
// Personnel checklist is derived from who actually holds a status that day, so
// there is nothing to tick for someone who does not — and fabricating a row
// would put a person on the parade state under a status they were never given.
// They simply come out of the other two buckets.
//
// Because of that, a roster match is NOT the same as something that will
// happen. splitPastedForDest is the single source of truth for the difference,
// shared by the preview and the apply so the confirm panel cannot promise 20
// and deliver 8 — and so the 12 it cannot tick are left completely alone rather
// than being quietly released from Fallout/Report Sick into "participating".
function splitPastedForDest(dest, matched) {
  if (dest !== "status") return { applied: matched, skipped: [] };
  const onList = new Set(((_logConduct && _logConduct.status) || []).map(s => s.d4));
  return {
    applied: matched.filter(d4 => onList.has(d4)),
    skipped: matched.filter(d4 => !onList.has(d4))
  };
}

function applyPastedAbsentees(dest, matched) {
  if (!_logConduct) return;
  const { applied } = splitPastedForDest(dest, matched);
  const set = new Set(applied);
  // Release from wherever they currently sit, preserving any reason already
  // typed for someone who is staying in the same bucket (handled below by only
  // pushing when absent).
  const keep = {};
  ["fallout", "reportSick"].forEach(b => {
    (_logConduct[b] || []).forEach(x => { if (set.has(x.d4)) keep[x.d4] = x; });
    _logConduct[b] = (_logConduct[b] || []).filter(x => !set.has(x.d4));
  });
  (_logConduct.status || []).forEach(s => {
    if (set.has(s.d4)) s.notParticipating = (dest === "status");
  });
  if (dest !== "status") {
    const bucket = dest === "reportSick" ? "reportSick" : "fallout";
    _logConduct[bucket] = _logConduct[bucket] || [];
    applied.forEach(d4 => {
      if (!_logConduct[bucket].some(x => x.d4 === d4)) {
        // `keep` carries a row that already existed in fallout/reportSick, so
        // its eventTime is a real observation and survives the move — only a
        // genuinely NEW row gets stamped with now.
        _logConduct[bucket].push(keep[d4] || { d4, reason: "", eventTime: nowHHMM() });
      }
    });
  }
  renderLogConductWizard();
}

// Step 1 of the paste flow: collect the text and the destination. Nothing is
// applied here — Preview re-renders this same modal with a confirm panel, so
// the user always sees the match result before the wizard is touched.
function openWizPasteModal() {
  if (!_logConduct) return;
  openModal("Paste absentees", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-size:11px;color:var(--muted);line-height:1.5">
        One 4D per line, or comma-separated — both may be mixed. Ids must match the roster
        <strong>exactly</strong>: <code>123</code> and <code>C0123</code> are not accepted, so a typo
        shows up in the preview instead of landing on the wrong recruit.
      </div>
      <div class="form-group"><label>Destination</label>
        <select id="wiz-paste-dest">
          <option value="fallout" selected>Fallout — dropped out mid-conduct, did not go to MO</option>
          <option value="reportSick">Report Sick — dropped out mid-conduct and went to MO</option>
          <option value="status">Status Personnel — tick as not participating</option>
        </select>
      </div>
      <div class="form-group"><label>4Ds</label>
        <textarea id="wiz-paste-text" rows="8" placeholder="0123&#10;0124, 0125"
          style="padding:8px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;resize:vertical;width:100%;box-sizing:border-box"></textarea>
      </div>
      <div id="wiz-paste-preview"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="wizPastePreview()">Preview</button>
      </div>
    </div>`,
    // This modal took over the wizard's overlay — dismissing it any way at all
    // (Cancel, ✕, backdrop) must put the wizard back. Without this the ticks,
    // reasons, added groups and remarks are unreachable: _logConduct still holds
    // them but nothing re-renders it, and re-opening the wizard builds a fresh one.
    renderLogConductWizard);
}

// Step 2: show what WOULD happen. Apply is only reachable from here, and only
// when at least one id matched — so a paste that is entirely typos cannot be
// confirmed into a no-op the user reads as success.
function wizPastePreview() {
  const text = document.getElementById("wiz-paste-text")?.value || "";
  const dest = document.getElementById("wiz-paste-dest")?.value || "fallout";
  const host = document.getElementById("wiz-paste-preview");
  if (!host) return;
  const { matched, unmatched } = parsePastedD4s(text, STATE.roster);
  // On the roster is not enough for "status" — see splitPastedForDest.
  const { applied, skipped } = splitPastedForDest(dest, matched);
  const destLabel = { fallout: "Fallout", reportSick: "Report Sick", status: "Status Personnel" }[dest];
  // Named individually, not just counted: "3 unmatched" tells the user something
  // is wrong but not which line to fix.
  const warn = unmatched.length ? `
    <div style="margin-top:8px;padding:8px 10px;border-radius:6px;border:1px solid var(--yellow);font-size:11px;color:var(--muted)">
      ⚠️ <strong>${unmatched.length}</strong> not on the roster and will be skipped:
      <div class="mono" style="margin-top:4px;color:var(--text)">${unmatched.map(escapeHTML).join(", ")}</div>
    </div>` : "";
  // Named individually for the same reason: "12 hold no status" doesn't tell the
  // commander WHO to chase up (or re-paste into Fallout instead).
  const noStatusWarn = skipped.length ? `
    <div style="margin-top:8px;padding:8px 10px;border-radius:6px;border:1px solid var(--yellow);font-size:11px;color:var(--muted)">
      ⚠️ <strong>${skipped.length}</strong> hold no status on this date, so there is nothing to tick —
      they will be skipped (use Fallout or Report Sick for them):
      <div class="mono" style="margin-top:4px;color:var(--text)">${skipped.map(escapeHTML).join(", ")}</div>
    </div>` : "";
  const names = applied.map(d4 =>
    `<div style="padding:1px 0"><span class="mono" style="color:var(--accent);font-weight:700">${escapeHTML(d4)}</span> ${escapeHTML(displayPersonLabel(d4))}</div>`).join("");
  host.innerHTML = `
    <div class="card" style="padding:10px 12px;background:var(--surface2);border-radius:6px">
      <div style="font-size:12px"><strong>${applied.length}</strong> matched → <strong>${escapeHTML(destLabel)}</strong></div>
      ${applied.length ? `<div style="margin-top:6px;max-height:180px;overflow-y:auto;font-size:11px">${names}</div>` : ""}
      ${warn}
      ${noStatusWarn}
      ${applied.length
        ? `<button type="button" class="btn btn-primary" style="margin-top:10px" onclick="wizPasteApply('${escapeAttr(dest)}')">Apply to ${escapeHTML(destLabel)}</button>`
        : `<div style="margin-top:10px;font-size:11px;color:var(--muted)">Nothing to apply.</div>`}
    </div>`;
}

function wizPasteApply(dest) {
  const text = document.getElementById("wiz-paste-text")?.value || "";
  // Re-parsed rather than carried over from the preview, so an edit to the
  // textarea after previewing cannot apply a stale match list.
  const { matched } = parsePastedD4s(text, STATE.roster);
  if (!splitPastedForDest(dest, matched).applied.length) return;
  closeModal();   // restores the wizard via the onClose hook
  applyPastedAbsentees(dest, matched);
}

function wizAddGroup(value, label) {
  // Re-adding an already-added group is a no-op, not a duplicate chip.
  if (_logConduct.addedGroups.some(g => g.value === value)) return;
  _logConduct.addedGroups.push({ label, value });
  wizRecomputeParticipants();
  // The status checklist is scoped to participants (rebuildLogConductStatus) —
  // it must be rebuilt whenever the participant set changes, or a newly added
  // group's on-status recruits never appear until an unrelated rebuild (e.g. a
  // date change) happens to run. Ticks/reasons for d4s still on the list are
  // preserved by rebuildLogConductStatus's own prevByD4 carry-over.
  rebuildLogConductStatus();
  renderLogConductWizard();
}
function wizRemoveGroup(value) {
  _logConduct.addedGroups = _logConduct.addedGroups.filter(g => g.value !== value);
  wizRecomputeParticipants();
  rebuildLogConductStatus();
  renderLogConductWizard();
}
function wizToggleHA(checked) {
  _logConduct.haCounts = !!checked;
  renderLogConductWizard();  // reveals/hides the period selector
}
function wizSetHAPeriods(v) {
  const n = Number(v);
  _logConduct.haPeriods = Number.isFinite(n) && n > 0 ? n : 1;
}

// === Group resolution (Attendees card) ==================================
//
// Group semantics (user-confirmed):
//   platoon:<code> — explicit-platoon recruits ONLY (commanders deliberately
//                    excluded even if their roster row carries a platoon —
//                    reachable via Commanders only / Entire company).
//   company        — EVERYONE on the roster, commanders included.
//   noncommanders  — all recruits, no commanders.
//   commanders     — commanders only.
//   individual:<d4> — one specific recruit (added via the Attendees search box).
function resolveConductGroup(value) {
  const roster = STATE.roster || [];
  if (value === "company") return roster.map(r => r.id);
  if (value === "noncommanders") return roster.filter(r => !isCommander(r.id)).map(r => r.id);
  if (value === "commanders") return roster.filter(r => isCommander(r.id)).map(r => r.id);
  if (value.startsWith("platoon:")) {
    const code = value.slice("platoon:".length);
    return roster.filter(r => !isCommander(r.id) && personPlatoon(r) === code).map(r => r.id);
  }
  if (value.startsWith("individual:")) {
    const d4 = value.slice("individual:".length);
    return roster.some(r => r.id === d4) ? [d4] : [];
  }
  return [];
}

// Human label for a group value — dropdown option text + chip labels.
function groupLabel(value) {
  if (value === "company") return "Entire company";
  if (value === "noncommanders") return "Non-Commanders";
  if (value === "commanders") return "Commanders only";
  if (value.startsWith("platoon:")) {
    const code = value.slice("platoon:".length);
    const p = activePlatoons().find(p => p.code === code);
    return p ? p.displayName : code;
  }
  if (value.startsWith("individual:")) {
    const d4 = value.slice("individual:".length);
    return `${displayId(d4)} ${getName(d4)}`;
  }
  return value;
}

// Attendees search box → add one recruit as an individual group. Re-adding an
// already-present individual is a no-op (wizAddGroup dedupes), and the union
// recompute keeps them credited even if a platoon covering them is added too.
function wizPickIndividual(d4) {
  if (!d4) return;
  wizAddGroup("individual:" + d4, groupLabel("individual:" + d4));
}

// === Reusable person search (typeahead) =================================
//
// A search-as-you-type person picker shared by the Attendees card and the
// medical log form — mirrors the topbar search (js/main.js): case-insensitive
// substring on 4D or name, capped result list. The HTML-string architecture
// rules out closures, so callers pass the NAME of a global pick handler
// (onPickFn), invoked as onPickFn('<d4>', '<boxId>') — the boxId lets one
// shared handler serve many boxes (e.g. the report-sick/fallout row lists).
// The chosen 4D is mirrored into a
// hidden input (valueId) so plain gv()/querySelector reads keep working.
function personSearchBox({ boxId, onPickFn = "", valueId = "", placeholder = "Search name / 4D…", roleFilter = "", selected = "" }) {
  valueId = valueId || `${boxId}-value`;
  const chosen = selected ? `${displayId(selected)} ${getName(selected)}` : "";
  return `
    <div class="person-search" style="position:relative">
      <input type="hidden" id="${valueId}" value="${escapeAttr(selected)}">
      <input type="text" id="${boxId}-input" autocomplete="off" placeholder="${escapeAttr(placeholder)}"
        value="${escapeAttr(chosen)}"
        oninput="personSearchFilter('${boxId}','${onPickFn}','${valueId}',this.value,'${roleFilter}')"
        onkeydown="personSearchEnter(event,'${boxId}','${onPickFn}','${valueId}','${roleFilter}')"
        style="width:100%;padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;box-sizing:border-box">
      <div id="${boxId}-results" style="position:absolute;z-index:30;left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-top:2px;max-height:200px;overflow:auto;display:none"></div>
    </div>`;
}

// Shared match list for the person typeaheads: the dropdown (personSearchFilter)
// and the Enter key (personSearchEnter) must select from the EXACT same set, or
// "the top match" would mean two different rows. Case-insensitive substring on
// 4D or name, role-filtered, capped at 6 — identical to what the dropdown shows.
function personSearchMatches(query, roleFilter) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  let rows = STATE.roster || [];
  if (roleFilter === "Recruit") rows = rows.filter(r => !isCommander(r.id));
  return rows
    .filter(r => (r.id || "").toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q))
    .slice(0, 6);
}

// Enter in a person typeahead picks the CURRENT top match and stops the keypress
// from submitting the enclosing <form> (the medical/leave forms wrap these boxes,
// so a bare Enter would otherwise fire a half-filled submit). Nothing is picked
// when there's no match — personSearchFilter has already cleared the hidden id on
// the keystroke, and only personSearchPick re-sets it, so a stray Enter can never
// commit the wrong recruit.
function personSearchEnter(e, boxId, onPickFn, valueId, roleFilter) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  e.stopPropagation();   // keep this Enter from also reaching the wizard's save-on-Enter handler
  const input = document.getElementById(`${boxId}-input`);
  const matches = personSearchMatches(input ? input.value : "", roleFilter);
  if (matches.length) personSearchPick(boxId, onPickFn, valueId, matches[0].id);
}

function personSearchFilter(boxId, onPickFn, valueId, query, roleFilter) {
  const res = document.getElementById(`${boxId}-results`);
  if (!res) return;
  // Any manual edit to the search text invalidates a prior pick: the hidden id
  // input is only trustworthy immediately after personSearchPick. Clear it on
  // every keystroke so a stale/mismatched 4D — e.g. an edit-seeded recruit the
  // user has started retyping over — can't be silently committed when they
  // never click a suggestion (the caller's `if (!d4)` guard then fires instead
  // of saving to the wrong recruit). Re-selecting from the dropdown repopulates
  // it. personSearchPick sets input.value via JS, which does NOT fire oninput,
  // so a genuine pick survives.
  const hidden = document.getElementById(valueId);
  if (hidden) hidden.value = "";
  // Mirror the same invalidation into any external per-box state. Handlers like
  // wizPickRow copy the picked 4D into their own store (_logConduct rows) rather
  // than reading the hidden input at save time, so clearing the hidden input
  // alone would leave a stale prior pick that gets silently committed once the
  // user retypes without re-picking. Firing onPickFn('') clears that store too.
  // No-op for single-shot callers (wizPickIndividual guards with `if (!d4)`);
  // medical/leave forms pass no onPickFn and are unaffected.
  if (onPickFn && typeof window[onPickFn] === "function") window[onPickFn]("", boxId);
  const q = String(query || "").trim().toLowerCase();
  if (!q) { res.style.display = "none"; res.innerHTML = ""; return; }
  const matches = personSearchMatches(query, roleFilter);
  if (!matches.length) {
    res.style.display = "block";
    res.innerHTML = `<div style="padding:6px 10px;font-size:11px;color:var(--muted)">No match</div>`;
    return;
  }
  res.style.display = "block";
  res.innerHTML = matches.map(r =>
    `<div onclick="personSearchPick('${boxId}','${onPickFn}','${valueId}','${r.id}')" style="padding:6px 10px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border)"><span class="mono" style="color:var(--accent);font-weight:700">${displayId(r.id)}</span> ${escapeHTML(r.name || "")}</div>`
  ).join("");
}

function personSearchPick(boxId, onPickFn, valueId, d4) {
  const hidden = document.getElementById(valueId);
  const input = document.getElementById(`${boxId}-input`);
  const res = document.getElementById(`${boxId}-results`);
  if (hidden) hidden.value = d4;
  if (input) input.value = `${displayId(d4)} ${getName(d4)}`;
  if (res) { res.style.display = "none"; res.innerHTML = ""; }
  // Pass boxId as a 2nd arg so a shared handler can tell WHICH box was picked
  // (the report-sick/fallout rows all route to one wizPickRow and parse the
  // row index out of the boxId). Single-box callers like wizPickIndividual
  // just ignore the extra arg.
  if (onPickFn && typeof window[onPickFn] === "function") window[onPickFn](d4, boxId);
}

// === Totals / overlap helpers ===========================================

// The recovery "ghost" tags (post-MC/LD +1/+2 days). rebuildLogConductStatus
// seeds these rows ticked (statusParticipates strips the suffix → MC/LD → false),
// but a recovery-tag person is usually back to training — so the wizard offers a
// per-tag bulk toggle. Fixed order so the button row reads MC+1, MC+2, LD+1, LD+2.
const RECOVERY_TAGS = ["MC+1", "MC+2", "LD+1", "LD+2"];

// A status row is "pure recovery" when EVERY active status on it is a +1/+2 ghost
// tag. A row that also carries a live restrictive status (e.g. "MC+1 + Excuse
// Heavy Load") is NOT pure — the bulk buttons must never flip someone who is
// still genuinely restricted.
function statusRowIsPureRecovery(statusTag) {
  const toks = String(statusTag || "").split(" + ").map(t => t.trim()).filter(Boolean);
  return toks.length > 0 && toks.every(t => RECOVERY_TAGS.includes(t));
}

// Map each present recovery tag → the d4s of pure-recovery rows carrying it, in
// RECOVERY_TAGS order. Tags with no matching row are omitted so the render only
// draws buttons that actually apply to the current checklist.
function recoveryTagRows(statusList) {
  const out = {};
  RECOVERY_TAGS.forEach(tag => {
    const d4s = (statusList || [])
      .filter(s => statusRowIsPureRecovery(s.statusTag)
        && String(s.statusTag).split(" + ").map(t => t.trim()).includes(tag))
      .map(s => s.d4);
    if (d4s.length) out[tag] = d4s;
  });
  return out;
}

function computeLogConductTotals() {
  const w = _logConduct;
  const statusCount = w.status.filter(s => s.notParticipating).length;
  const rsiCount = w.rsi.length;
  const falloutCount = w.fallout.length;
  const reportSickCount = w.reportSick.length;
  // Default total: the accumulated participant snapshot (gross — see the
  // _logConduct shape doc). Legacy fallback to the old non-commander roster
  // count ONLY when editing a pre-change wizard row that has neither a
  // participant list nor any added group (so a group resolving to zero
  // people is still trusted as "0", not silently replaced by the fallback).
  const hasParticipantData = (w.participants && w.participants.length > 0) || (w.addedGroups && w.addedGroups.length > 0);
  const defaultTotal = hasParticipantData
    ? w.participants.length
    : STATE.roster.filter(r => r.role !== "Commander").length;
  const total = w.totalOverride != null ? w.totalOverride : defaultTotal;
  const participating = Math.max(0, total - statusCount - rsiCount - falloutCount - reportSickCount);
  // Commander-excluded ("without commanders") figures for the display-only view
  // toggle (wiz-excl-commanders). These NEVER affect the saved attendance row —
  // they are a read-only lens. Commanders are the 00xx accounts (isCommander).
  // We subtract the commander headcount among participants from the (possibly
  // overridden) total, and drop commander d4s from each away-list. If the user
  // manually overrode Total Str, totalNc still subtracts the participant-commander
  // count from that override — an acknowledged edge case (the override is a free
  // number that may not correspond to the participant set).
  const isCmdr = d4 => isCommander(d4);
  const commanders = (w.participants || []).filter(isCmdr).length;
  const statusCountNc = w.status.filter(s => s.notParticipating && !isCmdr(s.d4)).length;
  const rsiCountNc = w.rsi.filter(r => !isCmdr(r.d4)).length;
  const falloutCountNc = w.fallout.filter(r => !isCmdr(r.d4)).length;
  const reportSickCountNc = w.reportSick.filter(r => !isCmdr(r.d4)).length;
  const totalNc = Math.max(0, total - commanders);
  const participatingNc = Math.max(0, totalNc - statusCountNc - rsiCountNc - falloutCountNc - reportSickCountNc);
  return {
    total, statusCount, rsiCount, falloutCount, reportSickCount, participating,
    commanders, totalNc, statusCountNc, rsiCountNc, falloutCountNc, reportSickCountNc, participatingNc
  };
}

// Updates just the totals strip without re-rendering the entire modal —
// avoids losing focus on text inputs during typing.
function recomputeLogConductFooter() {
  const t = computeLogConductTotals();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("wiz-stat-status", t.statusCount);
  set("wiz-stat-fallout", t.falloutCount);
  set("wiz-stat-reportSick", t.reportSickCount);
  set("wiz-stat-participating", t.participating);
  set("wiz-nc-total", t.totalNc);
  set("wiz-nc-status", t.statusCountNc);
  set("wiz-nc-reportSick", t.reportSickCountNc);
  set("wiz-nc-fallout", t.falloutCountNc);
  set("wiz-nc-participating", t.participatingNc);
  const totalInput = document.getElementById("wiz-total");
  if (totalInput && _logConduct.totalOverride == null) totalInput.value = t.total;
}

function updateLogConductOverlapWarning() {
  const el = document.getElementById("wiz-overlap-warning");
  if (!el) return;
  const w = _logConduct;
  const falloutSet = new Set(w.fallout.map(r => r.d4).filter(Boolean));
  const overlap = w.reportSick.map(r => r.d4).filter(d => d && falloutSet.has(d));
  if (!overlap.length) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div style="background:#D2992222;border:1px solid #D2992266;border-radius:6px;padding:10px 12px;font-size:11px;color:var(--orange);line-height:1.55">
      <strong>⚠ Overlap detected:</strong> the following recruit${overlap.length === 1 ? " is" : "s are"} in BOTH Fallout AND Report Sick:
      <div style="margin-top:4px;color:var(--text);font-weight:600">${overlap.map(d => `${displayId(d)} ${escapeHTML(getName(d))}`).join(" · ")}</div>
      <div style="margin-top:4px;color:var(--muted);font-weight:400">Per convention: Report Sick = Fallout → went to MO. They shouldn't both contain the same recruit. You can save anyway — this is just a heads-up.</div>
    </div>
  `;
}

// === Save logic =========================================================

async function saveLogConductWizard() {
  const w = _logConduct;
  if (!w.conductId) { alert("Pick a conduct first."); return; }
  if (!w.date) { alert("Pick a date first."); return; }
  // Validate every list row has a recruit selected.
  const bad = ["fallout", "reportSick"].flatMap(k =>
    w[k].map((r, i) => r.d4 ? null : `${k} row ${i + 1}`).filter(Boolean)
  );
  if (bad.length) {
    alert(`Some rows have no recruit picked:\n  • ${bad.join("\n  • ")}\nPick a recruit or remove the row.`);
    return;
  }
  // A brand-new conduct with no attendees selected is almost certainly a
  // forgotten Attendees step, not an intentional zero-strength conduct.
  // Legacy-row edits are exempt: a pre-change wizard row may never have had a
  // group added, and re-saving it (e.g. just to tweak remarks) must not be
  // newly blocked.
  if (!w.attendanceId && (!w.participants || !w.participants.length)) {
    alert("Add at least one group in the Attendees card before saving.");
    return;
  }

  // After the last validation early-return — all four fire before any work, so
  // a rejected save never flashes a busy state. Note the window is short by
  // design: the sheet pushes below go through autoSync FIRE-AND-FORGET, so what
  // this actually covers is the synchronous row build plus the awaited
  // clipboard write, not a network round trip.
  const restoreBtn = btnBusy(null, "Saving…");

  const totals = computeLogConductTotals();
  const displayDate = isoToDisplayDate(w.date);
  const time = pad4Time(w.time || "");
  const existing = w.attendanceId ? STATE.attendance.find(a => a.id === w.attendanceId) : null;

  // Build the attendance row.
  const attendanceEntry = {
    id: w.attendanceId || nextId(),
    date: displayDate,
    time,
    conductId: w.conductId,
    total: totals.total,
    participating: totals.participating,
    lms: 0,  // recomputed from polar below
    px: totals.statusCount,
    fallout: totals.falloutCount,
    remarks: w.remarks || "",
    // Mark the status checklist as reviewed so re-opens honor the recorded ticks
    // exactly (an absent Status row = "participates despite status") instead of
    // re-defaulting medically-restricted-but-present recruits back to ticked.
    // The backend upsert auto-creates this column (ensureColumnsForKeys), and
    // mergeAttendanceEdit carries it onto the CSV-imported row.
    statusReviewed: true
  };

  // participants: NET of exclusions (matches CSV semantics — stored field is
  // the HA-credited Present list; absentees live in ConductDetail).
  const excluded = new Set([
    ...w.status.filter(s => s.notParticipating).map(s => s.d4),
    ...w.fallout.map(r => r.d4),
    ...w.reportSick.map(r => r.d4)
  ]);
  attendanceEntry.participants = (w.participants || []).filter(d4 => !excluded.has(d4)).join(",");

  // source: "wizard" on new rows AND legacy-"" upgrades (haCountsRow needs it);
  // NEVER on a CSV row — flipping "csv"→"wizard" is the past corruption class.
  if (!existing || existing.source !== "csv") attendanceEntry.source = "wizard";

  // currencyTags: reconcile checkbox vs existing tags via toggleHATag so
  // sibling tokens ("HA RM") survive; unchanged tick state writes the
  // identical string.
  const baseTags = existing ? (existing.currencyTags || "") : "";
  const hasHA = /\bha\b/i.test(baseTags);
  attendanceEntry.currencyTags = (w.haCounts === hasHA) ? baseTags : toggleHATag(baseTags);

  // periods: written only while ticked. Unticked → omit key, so an edited CSV
  // row's B5 metadata survives the merge and a new row gets the "" default.
  if (w.haCounts) attendanceEntry.periods = w.haPeriods;

  // Build conductDetail rows. "Status" rows = only status entries marked
  // "notParticipating" (the rest are participating despite their status).
  // (This non-participation type was formerly mislabelled "PX"; PX now means a
  // genuine, non-absent stretch activity.)
  const detailRows = [];
  // Every ConductDetail row below carries eventTime, including the ones for
  // which it is always blank. writeTab derives the sheet's headers from
  // Object.keys(data[0]) — a single row missing the key drops the column from
  // the ENTIRE pushed sheet, not just that row.
  w.status.filter(s => s.notParticipating).forEach(s => {
    detailRows.push({ id: nextId(), date: displayDate, time, conductId: w.conductId, d4: s.d4, type: "Status", reason: s.reason || "", eventTime: "" });
  });
  // pad4Time normalizes once here rather than on every keystroke, so a
  // half-typed "7" is not rewritten to "0700" under the user's cursor.
  w.fallout.forEach(r => detailRows.push({ id: nextId(), date: displayDate, time, conductId: w.conductId, d4: r.d4, type: "Fallout", reason: r.reason || "", eventTime: pad4Time(r.eventTime || "") }));
  w.reportSick.forEach(r => detailRows.push({ id: nextId(), date: displayDate, time, conductId: w.conductId, d4: r.d4, type: "ReportSick", reason: r.reason || "", eventTime: pad4Time(r.eventTime || "") }));

  // Auto-create a "Pending" Medical row for each Report Sick that doesn't
  // already have a medical entry on this date. Pending = waiting for MO
  // outcome; sergeants update the status later when MO issues MC/LD/etc.
  // We skip when a row already exists for (d4, date) so re-saves don't
  // duplicate, and so a sergeant who already manually fixed the status
  // (e.g. "Pending" → "2D LD") isn't reverted back to Pending.
  const newMedicalRows = [];
  w.reportSick.forEach(r => {
    if (!r.d4) return;
    const existing = STATE.medical.find(m => m.d4 === r.d4 && m.date === displayDate);
    if (existing) return;
    newMedicalRows.push({
      id: nextId(),
      d4: r.d4,
      date: displayDate,
      reason: r.reason || "",
      status: "Pending",
      startDate: displayDate,
      endDate: "",
      origin: "conductLog"     // auto-created from the conduct wizard
    });
  });
  STATE.medical.push(...newMedicalRows);

  // Commit: replace the attendance row + every PX/Fallout/ReportSick
  // conductDetail row for this (date, time, conductId). Legacy RSI rows are
  // preserved untouched — the wizard no longer manages RSI (the chat workflow
  // moved away from it), but historical rows shouldn't be silently deleted.
  // `syncedRow` is the object that actually lands in STATE — and it's what we
  // push to the sheet below. On an edit it's the mergeAttendanceEdit result
  // (CSV-import-only participants/periods/currencyTags/source preserved), NOT
  // the wizard's bare `attendanceEntry`: pushing attendanceEntry would re-strip
  // those fields (the very bug the merge fixes) and carry a stale lms:0, since
  // recomputeAttendanceLmsFromPolar below mutates the STATE row in place, not
  // attendanceEntry. For a brand-new row attendanceEntry IS the STATE row.
  let syncedRow;
  if (w.attendanceId) {
    const idx = STATE.attendance.findIndex(a => a.id === w.attendanceId);
    if (idx >= 0) syncedRow = STATE.attendance[idx] = mergeAttendanceEdit(STATE.attendance[idx], attendanceEntry);
    else { STATE.attendance.push(attendanceEntry); syncedRow = attendanceEntry; }
  } else {
    STATE.attendance.push(attendanceEntry);
    syncedRow = attendanceEntry;
  }
  STATE.conductDetail = STATE.conductDetail.filter(d =>
    !(d.date === displayDate && (d.time || "") === time && d.conductId === w.conductId && d.type !== "RSI")
  );
  STATE.conductDetail.push(...detailRows);

  // LMS sync from polar.
  recomputeAttendanceLmsFromPolar();
  saveLocal();

  const savedId = attendanceEntry.id;
  const isNew = !w.attendanceId;
  const priorDetailCount = (w.originalDetailIds || []).length;
  _logConduct = null;
  closeModal();
  render();

  // Auto-push everything: attendance upsert, an ATOMIC per-conduct rewrite of the
  // detail rows, and appendMany for any new medical rows. The ConductDetail write
  // is a single replaceConduct op (delete this conduct's non-RSI rows + append the
  // rebuilt set, server-side under one lock) — NOT the old delete-every-old-id +
  // appendMany pair, which fired as separate queued writes and could partially
  // fail (deletes commit, append doesn't), leaving the conduct's rows deleted-but-
  // not-re-added on the sheet. One op = the sheet is never observed half-written.
  // Each fires through autoSync so the indicator + dirty-tracking handle failures.
  if (STATE.apiUrl) {
    autoSync("Attendance", { type: "upsert", row: syncedRow });
    autoSync("ConductDetail", { type: "replaceConduct",
      match: { date: displayDate, time, conductId: w.conductId }, rows: detailRows });
    if (newMedicalRows.length) {
      autoSync("Medical", { type: "appendMany", rows: newMedicalRows });
    }
  }

  if (isNew) {
    try { await copyConductChatFormat(savedId, /*silent*/ true); } catch (e) { /* clipboard denied */ }
    const medMsg = newMedicalRows.length
      ? `\n\n${newMedicalRows.length} Pending Medical row${newMedicalRows.length === 1 ? "" : "s"} auto-created — update the status on the Medical tab once MO clears.`
      : "";
    // Before the alert, which blocks the thread: a button still reading
    // "Saving…" and disabled behind a modal dialog looks broken for as long as
    // the dialog is up.
    restoreBtn();
    alert(`Saved & syncing. ${detailRows.length} conduct-detail row${detailRows.length === 1 ? "" : "s"} created.${medMsg}\n\nChat-format message copied to clipboard${navigator.clipboard ? "" : " (or shown in fallback prompt)"}.`);
  } else {
    const changeNote = priorDetailCount !== detailRows.length ? ` (was ${priorDetailCount}).` : "";
    const medNote = newMedicalRows.length
      ? `\n\n${newMedicalRows.length} new Pending Medical row${newMedicalRows.length === 1 ? "" : "s"} added.`
      : "";
    restoreBtn();
    alert(`Saved & syncing. ${detailRows.length} conduct-detail row${detailRows.length === 1 ? "" : "s"} total.${changeNote}${medNote}`);
  }
}

// === Chat-format generator ==============================================

// Returns the WhatsApp parade-state message for the given attendance row.
// Matches the format observed in the May 15–29 chat (Total/Participating/
// Status/Report sick/Fallout, then per-section S/N + R/N + Reason blocks).
function buildConductChatFormat(attendanceId) {
  const a = STATE.attendance.find(x => x.id === attendanceId);
  if (!a) return "";
  const date = displayDateToISO(a.date);
  const ddmmyy = toDDMMYY(date);
  const time = pad4Time(a.time || "") || "0000";
  const conductLabel = conductName(a.conductId) || "(unknown conduct)";
  const details = STATE.conductDetail.filter(d =>
    d.date === a.date && (d.time || "") === (a.time || "") && d.conductId === a.conductId
  );
  const byType = {
    Status: details.filter(d => d.type === "Status"),
    ReportSick: details.filter(d => d.type === "ReportSick"),
    Fallout: details.filter(d => d.type === "Fallout"),
    RSI: details.filter(d => d.type === "RSI")
  };

  const section = (label, rows, includeStatusBlock) => {
    if (!rows.length) return `${label}:\n`;
    const blocks = rows.map((d, i) => {
      const sn = String(i + 1).padStart(2, "0");
      const rn = paradeRN(d.d4);
      let block = `S/N: ${sn}\nR/N: ${rn}\nReason: ${d.reason || ""}`;
      if (includeStatusBlock) {
        // Pull the recruit's active medical record on this date for status +
        // duration. Collapse same-status duplicates to the most recent first.
        const med = dedupeActiveRecordsByFamily(
          STATE.medical.filter(m => m.d4 === d.d4 && medStatusActive(m, date))
        ).sort((x, y) => medSeverityRank(medStatusTag(y, date)?.tag) - medSeverityRank(medStatusTag(x, date)?.tag));
        if (med.length === 1) {
          block += `\nStatus: ${paradeStatusLabel(med[0])}\nDuration: ${paradeDuration(med[0])}`;
        } else if (med.length > 1) {
          const sub = med.map((r, j) => `${j + 1}. ${paradeStatusLabel(r)}\n    Duration: ${paradeDuration(r)}`).join("\n");
          block += `\nStatus received:\n${sub}`;
        }
      }
      return block;
    });
    return `${label}: ${String(rows.length).padStart(2, "0")}\n\n${blocks.join("\n\n")}`;
  };

  const header = `${ddmmyy} ${fmtHrs(time)} ${conductLabel}\nTotal strength: ${a.total}\nParticipating: ${a.participating}\nStatus: ${String(byType.Status.length).padStart(2, "0")}\nReport sick: ${String(byType.ReportSick.length).padStart(2, "0")}\nFallout: ${String(byType.Fallout.length).padStart(2, "0")}`;

  const parts = [header];
  parts.push(section("STATUS", byType.Status, /*includeStatusBlock*/ true));
  if (byType.ReportSick.length) parts.push(section("REPORT SICK", byType.ReportSick, false));
  if (byType.Fallout.length) parts.push(section("FALLOUT", byType.Fallout, false));
  if (byType.RSI.length) parts.push(section("RSI", byType.RSI, false));
  return parts.join("\n\n");
}

// Copies the chat-format message for the attendance row to the clipboard.
// silent=true skips the success alert (used by the post-save flow which
// already shows its own message).
async function copyConductChatFormat(attendanceId, silent) {
  const text = buildConductChatFormat(attendanceId);
  if (!text) { alert("Couldn't find that conduct."); return; }
  // silent=true is the post-save invocation (saveLogConductWizard), where the
  // user is mid-save, already gets the wizard's own alert, and has just
  // written — a pull is not the relevant risk there and a second dialog is noise.
  if (!silent && !unsyncedCopyGuard("conduct chat message")) return;
  try {
    await navigator.clipboard.writeText(text);
    if (!silent) alert("Chat-format message copied to clipboard. Paste into WhatsApp.");
  } catch (e) {
    // Fallback modal with selectable textarea — Safari / blocked clipboard.
    openModal("Chat-format message (copy manually)", `
      <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Clipboard access denied. Tap inside the box to select all, then Cmd/Ctrl+C.</p>
      <textarea readonly rows="22" style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:var(--mono);font-size:11px;line-height:1.45;white-space:pre" onclick="this.select()">${escapeAttr(text)}</textarea>
    `);
  }
}
