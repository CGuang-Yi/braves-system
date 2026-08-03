// Duty assignment conflicts (MD_Docs/DUTY_LIST_SPEC.md §6).
//
// PURE MODULE — no STATE, no DOM. Depends only on addDaysISO (js/calc.js), which
// loads earlier and is itself pure.
//
// Every conflict here is a WARNING and none of them block. That is not
// timidity: the source system prices "doing 2 duties at once" at −2 points in
// its own corrections list, which means it is a thing the company knowingly
// does and then compensates for — not an error to forbid. So the job of this
// module is to make the cost visible at the moment of assigning, and to hand
// the planner the matching correction reason so logging it is one click rather
// than a trip through a separate form.
//
// "Is this person away?" is deliberately NOT re-derived here. bpClassifyPerson
// already resolves leave, MC, LD, appointments and courses for any date and is
// the classifier the parade state itself runs on; a second implementation would
// drift from it. The caller passes the answer in.

// Which Config correction reason each conflict maps to. `null` means the
// conflict is worth flagging but is not a compensable event — nothing in the
// source system's legend pays out for it, and inventing a reason here would put
// points on the board that the company never agreed to.
const DUTY_CONFLICT_REASON = {
  doubleBooked: "Doing 2 duties at once",
  away: "On leave while scheduled",
  endsOnLeave: "COS duty ends on leave day",
  pdsAfterCos: "PDS after COS",
  consecutiveSameType: null
};

// The one cross-type rule the company actually named. Both are literal Config
// duty-type names, and so is the correction reason "PDS after COS" — renaming
// either type is a Config edit that would have to touch all three together.
const DUTY_PDS = "PDS";
const DUTY_COS = "COS";

// Rows for one person on one date. `excludeId` drops the row being edited, so
// re-opening an existing assignment doesn't report it as a conflict with
// itself.
function dutyRowsFor(dutyRows, d4, isoDate, excludeId) {
  const out = [];
  const list = dutyRows || [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r) continue;
    if (String(r.d4) !== String(d4)) continue;
    if (String(r.date) !== String(isoDate)) continue;
    if (excludeId && String(r.id) === String(excludeId)) continue;
    out.push(r);
  }
  return out;
}

// Is this ISO date inside any of the person's leave spans? A span with no end
// is treated as open-ended, matching how the rest of the app reads leave.
function dutyDateInSpans(isoDate, spans) {
  const list = spans || [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || !s.start) continue;
    if (isoDate < s.start) continue;
    if (s.end && isoDate > s.end) continue;
    return s;
  }
  return null;
}

/**
 * @param {{d4:string, date:string, dutyType:string, platoon?:string, id?:string}} cand
 * @param {{dutyRows?:Array, away?:{label?:string}|null, leaveSpans?:Array}} ctx
 *   `away` is bpClassifyPerson's verdict for cand.date, reduced to truthy +
 *   a label. `leaveSpans` are that person's leave rows as {start, end}.
 * @returns {Array<{kind:string, message:string, reason:(string|null)}>}
 */
function dutyConflicts(cand, ctx) {
  const out = [];
  if (!cand || !cand.d4 || !cand.date || !cand.dutyType) return out;
  const rows = (ctx && ctx.dutyRows) || [];
  const exclude = cand.id;
  const prev = addDaysISO(cand.date, -1);
  const next = addDaysISO(cand.date, 1);

  const sameDay = dutyRowsFor(rows, cand.d4, cand.date, exclude);
  if (sameDay.length) {
    out.push({
      kind: "doubleBooked",
      message: "Already holds " + sameDay.map(r => r.dutyType).join(" + ") + " on this date.",
      reason: DUTY_CONFLICT_REASON.doubleBooked
    });
  }

  if (ctx && ctx.away) {
    out.push({
      kind: "away",
      message: "Away on this date" + (ctx.away.label ? " — " + ctx.away.label : "") + ".",
      reason: DUTY_CONFLICT_REASON.away
    });
  }

  // "COS duty ends on leave day". Duties run overnight and release the next
  // morning, so a duty on the last working day before leave still eats into it.
  // Checked only when the duty date ITSELF is clear — if the person is already
  // away on the day, the `away` warning above says everything, and reporting
  // both would just be the same fact twice with two different correction
  // reasons attached.
  if (!(ctx && ctx.away) && next && dutyDateInSpans(next, ctx && ctx.leaveSpans)) {
    out.push({
      kind: "endsOnLeave",
      message: "This duty releases on " + next + ", which is a leave day.",
      reason: DUTY_CONFLICT_REASON.endsOnLeave
    });
  }

  if (cand.dutyType === DUTY_PDS && prev) {
    const cosYesterday = dutyRowsFor(rows, cand.d4, prev, exclude)
      .filter(r => r.dutyType === DUTY_COS);
    if (cosYesterday.length) {
      out.push({
        kind: "pdsAfterCos",
        message: "Held COS on " + prev + " — PDS the next day is back-to-back.",
        reason: DUTY_CONFLICT_REASON.pdsAfterCos
      });
    }
  }

  // Same duty type on consecutive days, looking both ways: the planner may be
  // filling the grid in either direction, and a run of three is worth seeing
  // from whichever end it is being built.
  const sameTypeNeighbour = [prev, next].filter(Boolean).filter(d =>
    dutyRowsFor(rows, cand.d4, d, exclude).some(r => r.dutyType === cand.dutyType));
  if (sameTypeNeighbour.length) {
    out.push({
      kind: "consecutiveSameType",
      message: "Also holds " + cand.dutyType + " on " + sameTypeNeighbour.join(" and ") + ".",
      reason: DUTY_CONFLICT_REASON.consecutiveSameType
    });
  }

  return out;
}

// Node test export (browser ignores `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DUTY_CONFLICT_REASON, dutyRowsFor, dutyDateInSpans, dutyConflicts };
}
