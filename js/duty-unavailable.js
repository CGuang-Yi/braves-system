// Soft "potentially unavailable" windows (design §4).
//
// PURE MODULE — no STATE, no DOM. Rows arrive as arguments, already normalized
// by normalizeDutyUnavailable (so d4 is padded and every field is a string).
//
// What this is NOT: leave, MC, or an appointment. Those are real records the
// parade classifier already resolves and js/duty-conflicts.js already treats as
// hard `away` conflicts at assignment time. This is the UNCONFIRMED case — leave
// not yet applied for, a course nomination not yet published, an exam block — and
// it is deliberately outside the classifier, because a soft planning hint must
// never move parade state.
//
// Its only consumers are two highlights (the duty month grid and the dashboard
// duty card). It does not warn at assign time and does not cost the auto
// scheduler: js/duty-schedule.js is explicit that explainability beats
// optimality, and a proposal that routes around invisible soft flags is one the
// planner cannot justify to whoever drew Saturday instead.

// Whether a flag covers a date. Bounds are INCLUSIVE, compared as ISO strings —
// yyyy-mm-dd sorts lexicographically, so no date is parsed and no timezone can
// shift a boundary by a day.
//
// A flag missing either bound matches NOTHING. The tempting alternative — read a
// blank `to` as open-ended — would highlight every duty that person ever draws,
// for ever, with nothing on screen to explain why. Inert is the recoverable
// failure; the add form is what guarantees both bounds exist.
function duCovers(flag, iso) {
  if (!flag || !flag.from || !flag.to || !iso) return false;
  return iso >= flag.from && iso <= flag.to;
}

// d4 → flags. Built once per render and passed down, rather than scanned per
// cell: the month grid is ~31 rows × one column per duty slot, so a per-cell
// scan would be a full pass over every flag in the company for each of them.
function duIndexByPerson(rows) {
  const idx = {};
  (rows || []).forEach(r => {
    if (!r || !r.d4) return;
    (idx[r.d4] = idx[r.d4] || []).push(r);
  });
  return idx;
}

// Every flag covering that person on that date. Returns ALL matches, not the
// first: two windows legitimately overlap (an exam block and a pending course
// nomination), and showing only one would state the wrong reason for the
// highlight — worse than stating no reason at all.
function duFlagsOn(idx, d4, iso) {
  return ((idx && idx[d4]) || []).filter(f => duCovers(f, iso));
}

// Expired means wholly in the past — a window is still live on its own last day.
function duIsExpired(flag, todayIso) {
  return !!flag && !!flag.to && !!todayIso && flag.to < todayIso;
}

// Start date, then end date, then person, so the panel reads as a timeline and
// two windows opening on the same day have a stable order rather than depending
// on sheet row order. Copies first: the caller passes STATE.dutyUnavailable, and
// sorting it in place would reorder the cache as a side effect of drawing.
function duSortFlags(rows) {
  return (rows || []).slice().sort((a, b) =>
    (a.from || "").localeCompare(b.from || "")
    || (a.to || "").localeCompare(b.to || "")
    || (a.d4 || "").localeCompare(b.d4 || ""));
}
