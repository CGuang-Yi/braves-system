// Parade lookahead (Fix 18). Future-dated absences are LISTED and COUNTED in
// their section but must NEVER move CURRENT STRENGTH — a person present today is
// present today, whatever is booked for next week. The lookahead is opt-in
// because the same classifier drives the Status Board grid and the Dashboard
// tables, which must stay strictly today-only; the default-off assertions below
// are what protect those surfaces.
//
// Fixed date: the classifier is date-driven, so a wall-clock TODAY would rot this
// suite overnight. Matches parade-classifier.test.js / parade-port-parity.test.js.
//
// Loaded in a vm sandbox on the parade-classifier.test.js pattern, but with the
// REAL "DD MMM YYYY" displayDateToISO copied from helpers.js rather than that
// file's ISO-echo stub: the whole feature is date-predicate arithmetic, so
// fixtures have to be in the shape production actually stores.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

const TODAY = "2026-06-29";        // a Monday

// Verbatim from js/helpers.js:1149 — the classifier's real date parser.
function displayDateToISO(s) {
  if (!s) return "";
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const m = String(s).match(/^(\d{1,2})\s+(\w{3})(?:\s+(\d{4}))?/);
  if (!m) return "";
  const mon = months[m[2]];
  if (!mon) return "";
  const day = m[1].padStart(2, "0");
  const year = m[3] || String(new Date().getFullYear());
  return `${year}-${mon}-${day}`;
}
// Verbatim from js/helpers.js medStatusActive, so the classifier behaves exactly
// as it does in the app.
function medStatusActive(record, todayIso) {
  if (record.status === "NIL") return false;
  const start = displayDateToISO(record.startDate || record.date || "");
  if (!start) return false;
  if (record.status === "Pending") return todayIso === start;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return false;
  return todayIso >= start && todayIso <= end;
}

const ROSTER = [
  { id: "0101", name: "Alpha One", fourD: "0101", rank: "REC", role: "Recruit", status: "Active" },
  { id: "0202", name: "Bravo Two", fourD: "0202", rank: "REC", role: "Recruit", status: "Active" }
];
const clone = o => JSON.parse(JSON.stringify(o));

function ctxWith(over) {
  const STATE = Object.assign(
    { roster: clone(ROSTER), leave: [], medical: [], appointments: [] }, over || {});
  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat,
    STATE,
    configGet: key => (key === "companyPrefix" ? "B" : ""),
    displayDateToISO,
    medStatusActive,
    rankGroupOf: () => "Enlistee"
  };
  vm.createContext(sandbox);
  // The REAL appointment-4d.js rather than a fourDSortKey stub: it is a pure
  // dependency-free leaf, so loading it costs nothing and a stub could only
  // diverge from what braves-parade actually sorts with in the browser.
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "appointment-4d.js"), "utf8")
    + "\n"
    + fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8")
    + "\n;this.bpClassifyPerson = bpClassifyPerson; this.bpStrength = bpStrength;"
    + " this.bpBuildBlock = bpBuildBlock; this.bpGridCell = bpGridCell;\n";
  vm.runInContext(src, sandbox, { filename: "braves-parade.js" });
  return sandbox;
}
const alpha = sb => sb.STATE.roster[0];
const bravo = sb => sb.STATE.roster[1];

// A 48HR book-out for Bravo, parameterised by date so each test states its own
// horizon case rather than sharing a mutable fixture.
const leaveRow = (start, end, reason) => ({
  id: 1, d4: "0202", type: "AL", reason: reason || "48HR BO",
  startDate: start, endDate: end, isInCamp: false
});

module.exports = async function run() {
  suite("parade lookahead: default is today-only");

  await test("with no opts, a leave starting next week is NOT listed", () => {
    const sb = ctxWith({ leave: [leaveRow("02 Jul 2026", "03 Jul 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY);
    eq(c.sections.alOil.length, 0, "today-only by default — the Status Board depends on this");
  });

  await test("an explicit lookaheadDays of 0 is also today-only", () => {
    const sb = ctxWith({ leave: [leaveRow("02 Jul 2026", "03 Jul 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 0 });
    eq(c.sections.alOil.length, 0);
  });

  await test("bpGridCell stays today-only — it never passes the option", () => {
    // The Status Board paints one cell per person per day; a future status
    // bleeding into today's cell is the regression this guards.
    const sb = ctxWith({ leave: [leaveRow("02 Jul 2026", "03 Jul 2026")] });
    eq(sb.bpGridCell(bravo(sb), TODAY).primary, null);
  });

  suite("parade lookahead: opt-in");

  await test("lookaheadDays 7 lists a leave starting in 3 days, suffixed [UPCOMING]", () => {
    const sb = ctxWith({ leave: [leaveRow("02 Jul 2026", "03 Jul 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.alOil.length, 1);
    ok(c.sections.alOil[0].endsWith(" [UPCOMING]"), "suffix present: " + c.sections.alOil[0]);
    eq(c.meta.alOil[0].upcoming, true, "meta flags it for the UI banner");
  });

  await test("the horizon boundary is inclusive — a leave starting exactly 7 days out is listed", () => {
    const sb = ctxWith({ leave: [leaveRow("06 Jul 2026", "07 Jul 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.alOil.length, 1, "29 Jun + 7d = 06 Jul, which is in range");
  });

  await test("one day past the horizon is excluded", () => {
    const sb = ctxWith({ leave: [leaveRow("07 Jul 2026", "08 Jul 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.alOil.length, 0);
  });

  await test("lookaheadDays Infinity lists any future record", () => {
    const sb = ctxWith({ leave: [leaveRow("15 Aug 2026", "16 Aug 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: Infinity });
    eq(c.sections.alOil.length, 1);
  });

  await test("a CURRENT record is listed WITHOUT the suffix", () => {
    const sb = ctxWith({ leave: [leaveRow("29 Jun 2026", "30 Jun 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.alOil.length, 1);
    ok(!c.sections.alOil[0].includes("[UPCOMING]"), "current entries are unmarked");
  });

  await test("an ALREADY-ENDED record stays excluded — this looks forward only", () => {
    const sb = ctxWith({ leave: [leaveRow("20 Jun 2026", "21 Jun 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: Infinity });
    eq(c.sections.alOil.length, 0);
  });

  suite("parade lookahead: every away section honours it");

  await test("a future MC lands under ATT C", () => {
    const sb = ctxWith({ medical: [{ id: 1, d4: "0202", type: "RSI", status: "MC",
      date: "02 Jul 2026", startDate: "02 Jul 2026", endDate: "04 Jul 2026", reason: "flu" }] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.attC.length, 1);
  });

  await test("a future LD lands under STATUS", () => {
    const sb = ctxWith({ medical: [{ id: 1, d4: "0202", type: "RSI", status: "LD",
      date: "02 Jul 2026", startDate: "02 Jul 2026", endDate: "04 Jul 2026", reason: "ankle" }] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.status.length, 1);
  });

  await test("a future MA lands under OTHERS", () => {
    const sb = ctxWith({ medical: [{ id: 1, d4: "0202", type: "MA", status: "",
      date: "02 Jul 2026", reason: "dental", outOfCamp: true }] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.others.length, 1);
  });

  await test("an open-ended future status is still inert, exactly as today-only records are", () => {
    // medStatusActive treats a blank end date as inactive everywhere in this
    // codebase; the lookahead must not become a back door for those rows.
    const sb = ctxWith({ medical: [{ id: 1, d4: "0202", type: "RSI", status: "LD",
      date: "02 Jul 2026", startDate: "02 Jul 2026", endDate: "", reason: "ankle" }] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: Infinity });
    eq(c.sections.status.length, 0);
  });

  await test("a future record that is already booked in is still excluded", () => {
    const sb = ctxWith({ leave: [Object.assign(leaveRow("02 Jul 2026", "03 Jul 2026"),
      { bookInDate: "02 Jul 2026" })] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.alOil.length, 0, "bookInDate wins over the lookahead");
  });

  await test("REPORTING SICK and MR are point-in-time and never look ahead", () => {
    const sb = ctxWith({ medical: [
      { id: 1, d4: "0202", type: "RSI", status: "Pending", date: "02 Jul 2026", startDate: "02 Jul 2026", reason: "fever" },
      { id: 2, d4: "0202", type: "MR", status: "", date: "02 Jul 2026", reason: "knee review" }
    ] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: Infinity });
    eq(c.sections.reportingSick.length, 0, "you cannot have reported sick tomorrow");
    eq(c.sections.mr.length, 0);
  });

  suite("parade lookahead: strength must not move");

  await test("a future MC does NOT set notInCamp", () => {
    const sb = ctxWith({ medical: [{ id: 1, d4: "0202", type: "RSI", status: "MC",
      date: "02 Jul 2026", startDate: "02 Jul 2026", endDate: "04 Jul 2026", reason: "flu" }] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.attC.length, 1, "listed under ATT C");
    eq(c.notInCamp, false, "but NOT counted out of camp — CURRENT STRENGTH is untouched");
  });

  await test("a future not-in-camp leave does NOT set notInCamp", () => {
    const sb = ctxWith({ leave: [leaveRow("02 Jul 2026", "03 Jul 2026")] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.notInCamp, false);
  });

  await test("bpStrength.current is identical with and without the lookahead", () => {
    const sb = ctxWith({ medical: [{ id: 1, d4: "0202", type: "RSI", status: "MC",
      date: "02 Jul 2026", startDate: "02 Jul 2026", endDate: "04 Jul 2026", reason: "flu" }] });
    const without = sb.bpStrength(sb.STATE.roster, TODAY);
    const with7 = sb.bpStrength(sb.STATE.roster, TODAY, { lookaheadDays: 7 });
    eq(with7.current, without.current, "strength is deliberately lookahead-blind");
    eq(with7.total, without.total);
    eq(without.current, 2, "both present today — the fixture would prove nothing otherwise");
  });

  suite("parade lookahead: interaction with the collapse/supersede passes");

  await test("a future MC does not supersede the CURRENT MC it overlaps", () => {
    // bpSupersedeSameType keeps the later-ending entry among same-label rows. A
    // future MC always ends later, so without an upcoming-aware supersede key it
    // would silently delete the MC the person is actually on today.
    const sb = ctxWith({ medical: [
      { id: 1, d4: "0202", type: "RSI", status: "MC", date: "28 Jun 2026",
        startDate: "28 Jun 2026", endDate: "30 Jun 2026", reason: "URTI" },
      { id: 2, d4: "0202", type: "RSI", status: "MC", date: "02 Jul 2026",
        startDate: "02 Jul 2026", endDate: "06 Jul 2026", reason: "review" }
    ] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.attC.length, 2, "both survive: " + JSON.stringify(c.sections.attC));
    ok(c.notInCamp, "today's MC still takes them out of camp");
  });

  await test("an upcoming MC does not suppress the ended-MC recovery tail", () => {
    // The MC+1/MC+2 tail fires only when there is no active MC today. That guard
    // must key off CURRENT entries, or booking a future MC would erase the tail.
    const sb = ctxWith({ medical: [
      { id: 1, d4: "0202", type: "RSI", status: "MC", date: "24 Jun 2026",
        startDate: "24 Jun 2026", endDate: "28 Jun 2026", reason: "URTI" },
      { id: 2, d4: "0202", type: "RSI", status: "MC", date: "02 Jul 2026",
        startDate: "02 Jul 2026", endDate: "06 Jul 2026", reason: "review" }
    ] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.attC.length, 2, "the tail AND the upcoming MC: " + JSON.stringify(c.sections.attC));
    ok(c.notInCamp, "the un-booked recovery tail still counts them out of camp");
  });

  await test("a mixed current+upcoming STATUS collapse keeps the upcoming flag", () => {
    // Multi-status collapse folds every STATUS line into one; the banner counts
    // meta.upcoming, so the flag has to survive the fold or the count goes wrong.
    const sb = ctxWith({ medical: [
      { id: 1, d4: "0202", type: "RSI", status: "LD", date: "27 Jun 2026",
        startDate: "27 Jun 2026", endDate: "30 Jun 2026", reason: "ankle" },
      { id: 2, d4: "0202", type: "RSI", status: "Excuse RMJ", date: "02 Jul 2026",
        startDate: "02 Jul 2026", endDate: "06 Jul 2026", reason: "knee" }
    ] });
    const c = sb.bpClassifyPerson(bravo(sb), TODAY, null, { lookaheadDays: 7 });
    eq(c.sections.status.length, 1, "collapsed to one line");
    eq(c.meta.status[0].upcoming, true, "the fold must not lose the marker");
    ok(/\[UPCOMING\]/.test(c.sections.status[0]), c.sections.status[0]);
  });

  suite("parade lookahead: message rendering");

  await test("the section COUNT includes future entries", () => {
    const sb = ctxWith({ leave: [
      { id: 1, d4: "0101", type: "AL", reason: "48HR BO", startDate: "29 Jun 2026", endDate: "30 Jun 2026", isInCamp: false },
      { id: 2, d4: "0202", type: "AL", reason: "48HR BO", startDate: "02 Jul 2026", endDate: "03 Jul 2026", isInCamp: false }
    ] });
    const txt = sb.bpBuildBlock(sb.STATE.roster, TODAY, "FP", { lookaheadDays: 7 });
    ok(/AL\/OIL: 02/.test(txt), "count equals the number of lines, not just the current ones:\n" + txt);
  });

  await test("CURRENT STRENGTH in the rendered block ignores the future entry", () => {
    const sb = ctxWith({ leave: [
      { id: 1, d4: "0202", type: "AL", reason: "48HR BO", startDate: "02 Jul 2026", endDate: "03 Jul 2026", isInCamp: false }
    ] });
    const txt = sb.bpBuildBlock(sb.STATE.roster, TODAY, "FP", { lookaheadDays: 7 });
    ok(/AL\/OIL: 01/.test(txt), "listed:\n" + txt);
    ok(/CURRENT STRENGTH: 2/.test(txt), "but both are still present today:\n" + txt);
  });

  await test("future entries interleave in 4D order, not appended at the end", () => {
    const sb = ctxWith({ leave: [
      { id: 1, d4: "0101", type: "AL", reason: "FUTURE-LOW-4D", startDate: "02 Jul 2026", endDate: "03 Jul 2026", isInCamp: false },
      { id: 2, d4: "0202", type: "AL", reason: "CURRENT-HIGH-4D", startDate: "29 Jun 2026", endDate: "30 Jun 2026", isInCamp: false }
    ] });
    const txt = sb.bpBuildBlock(sb.STATE.roster, TODAY, "FP", { lookaheadDays: 7 });
    ok(txt.indexOf("FUTURE-LOW-4D") < txt.indexOf("CURRENT-HIGH-4D"),
      "4D 0101's future entry sorts before 4D 0202's current one:\n" + txt);
  });

  await test("bpBuildBlock with no opts renders exactly as before", () => {
    const rows = { leave: [{ id: 1, d4: "0202", type: "AL", reason: "48HR BO",
      startDate: "02 Jul 2026", endDate: "03 Jul 2026", isInCamp: false }] };
    const before = ctxWith(rows).bpBuildBlock(ctxWith(rows).STATE.roster, TODAY, "FP", {});
    ok(/AL\/OIL: 00/.test(before), "the default path is untouched:\n" + before);
    ok(!/UPCOMING/.test(before));
  });
};
