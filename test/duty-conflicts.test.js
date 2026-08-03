// Assignment conflicts (MD_Docs/DUTY_LIST_SPEC.md §6).
//
// Two properties matter more than the individual detections. First, NOTHING
// blocks — every case here must still return a plain warning list, because the
// company knowingly double-books and then pays a −2 correction for it. Second,
// each conflict must carry the correction reason the planner would log, so the
// one-click "log a correction" action cannot drift from the detection that
// offered it.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

// duty-conflicts.js calls addDaysISO from js/calc.js — load both into one
// sandbox, exactly as index.html loads them into one global scope.
function loadConflicts() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, Array, Object, JSON, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
  vm.runInContext(read("calc.js"), sandbox, { filename: "calc.js" });
  sandbox.module.exports = {};
  sandbox.exports = sandbox.module.exports;
  vm.runInContext(read("duty-conflicts.js"), sandbox, { filename: "duty-conflicts.js" });
  return sandbox.module.exports;
}

const row = (id, d4, date, dutyType, platoon) => ({ id, d4, date, dutyType, platoon: platoon || "" });

module.exports = async function run() {
  const C = loadConflicts();

  suite("duty-conflicts: double booking");

  await test("a second duty on the same date is flagged, with the -2 reason attached", () => {
    const rows = [row("a", "0042", "2026-09-10", "COS")];
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "CDO" }, { dutyRows: rows });
    eq(c.length, 1, "one conflict");
    eq(c[0].kind, "doubleBooked");
    eq(c[0].reason, "Doing 2 duties at once", "carries the Config correction reason verbatim");
  });

  // The whole point of the design: warnings, never a veto.
  await test("a conflicting assignment is still returned as a warning, not a rejection", () => {
    const rows = [row("a", "0042", "2026-09-10", "COS")];
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "CDO" }, { dutyRows: rows });
    ok(Array.isArray(c), "returns a list");
    ok(!("blocked" in c[0]) && !("fatal" in c[0]), "nothing marks it as blocking");
  });

  // Re-opening an existing assignment to change an unrelated field must not
  // report the row as conflicting with itself.
  await test("the row being edited never conflicts with itself", () => {
    const rows = [row("a", "0042", "2026-09-10", "COS")];
    const c = C.dutyConflicts({ id: "a", d4: "0042", date: "2026-09-10", dutyType: "COS" }, { dutyRows: rows });
    eq(c.length, 0, "no self-conflict");
  });

  await test("another person's duty on that date is not this person's conflict", () => {
    const rows = [row("a", "0099", "2026-09-10", "COS")];
    eq(C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "CDO" }, { dutyRows: rows }).length, 0);
  });

  suite("duty-conflicts: leave and away status");

  await test("an away verdict from the classifier is surfaced with its label", () => {
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "COS" },
      { dutyRows: [], away: { label: "MC 9 Sep – 11 Sep" } });
    eq(c.length, 1);
    eq(c[0].kind, "away");
    eq(c[0].reason, "On leave while scheduled");
    ok(/MC 9 Sep/.test(c[0].message), "the classifier's label reaches the planner: " + c[0].message);
  });

  // Duties run overnight, so a duty on the last clear day before leave still
  // eats into the leave. This is the case `away` cannot see.
  await test("a duty releasing into the first day of a leave span is flagged", () => {
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "COS" },
      { dutyRows: [], away: null, leaveSpans: [{ start: "2026-09-11", end: "2026-09-15" }] });
    eq(c.length, 1);
    eq(c[0].kind, "endsOnLeave");
    eq(c[0].reason, "COS duty ends on leave day");
  });

  // Reporting the same fact twice under two different correction reasons would
  // invite logging both and paying -4 for one event.
  await test("an already-away person is NOT also flagged for releasing into leave", () => {
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "COS" },
      { dutyRows: [], away: { label: "AL 10 Sep – 15 Sep" }, leaveSpans: [{ start: "2026-09-10", end: "2026-09-15" }] });
    eq(c.length, 1, "one warning, not two");
    eq(c[0].kind, "away");
  });

  await test("leave starting two days later is not a conflict", () => {
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "COS" },
      { dutyRows: [], leaveSpans: [{ start: "2026-09-12", end: "2026-09-15" }] });
    eq(c.length, 0);
  });

  await test("an open-ended leave span (no end) still matches", () => {
    ok(!!C.dutyDateInSpans("2027-01-01", [{ start: "2026-09-11" }]), "open-ended span covers later dates");
    ok(!C.dutyDateInSpans("2026-09-01", [{ start: "2026-09-11" }]), "but not earlier ones");
  });

  suite("duty-conflicts: PDS after COS");

  await test("PDS the day after a COS is flagged", () => {
    const rows = [row("a", "0042", "2026-09-09", "COS")];
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "PDS", platoon: "PLT1" }, { dutyRows: rows });
    eq(c.length, 1);
    eq(c[0].kind, "pdsAfterCos");
    eq(c[0].reason, "PDS after COS");
  });

  // Direction matters — the named rule is PDS AFTER COS, not the reverse.
  await test("COS the day after a PDS is not the named conflict", () => {
    const rows = [row("a", "0042", "2026-09-09", "PDS", "PLT1")];
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "COS" }, { dutyRows: rows });
    eq(c.filter(x => x.kind === "pdsAfterCos").length, 0, "not flagged as pdsAfterCos");
  });

  await test("a two-day gap between the COS and the PDS is clear", () => {
    const rows = [row("a", "0042", "2026-09-08", "COS")];
    eq(C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "PDS", platoon: "PLT1" }, { dutyRows: rows }).length, 0);
  });

  suite("duty-conflicts: same type on consecutive days");

  await test("the same duty type the day before is flagged", () => {
    const rows = [row("a", "0042", "2026-09-09", "CDO")];
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "CDO" }, { dutyRows: rows });
    eq(c.length, 1);
    eq(c[0].kind, "consecutiveSameType");
  });

  // The planner may fill the grid downwards or upwards; a run of three should
  // be visible from whichever end it is being built.
  await test("the same duty type the day AFTER is flagged too", () => {
    const rows = [row("a", "0042", "2026-09-11", "CDO")];
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "CDO" }, { dutyRows: rows });
    eq(c.length, 1);
    eq(c[0].kind, "consecutiveSameType");
  });

  // Nothing in the source system's legend pays out for this, so inventing a
  // reason would put points on the board the company never agreed to.
  await test("it carries NO correction reason — it is a fairness smell, not a compensable event", () => {
    const rows = [row("a", "0042", "2026-09-09", "CDO")];
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "CDO" }, { dutyRows: rows });
    eq(c[0].reason, null);
  });

  await test("a DIFFERENT duty type on an adjacent day is not flagged", () => {
    const rows = [row("a", "0042", "2026-09-09", "CDS")];
    eq(C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "CDO" }, { dutyRows: rows }).length, 0);
  });

  suite("duty-conflicts: composition and degradation");

  await test("independent conflicts all report, they do not shadow each other", () => {
    const rows = [row("a", "0042", "2026-09-09", "COS"), row("b", "0042", "2026-09-10", "CDS")];
    const c = C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "PDS", platoon: "PLT1" }, { dutyRows: rows });
    const kinds = c.map(x => x.kind).sort().join(",");
    eq(kinds, "doubleBooked,pdsAfterCos", "both surfaced");
  });

  await test("a clean assignment produces nothing", () => {
    eq(C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "COS" },
      { dutyRows: [row("a", "0042", "2026-08-01", "COS")], away: null, leaveSpans: [] }).length, 0);
  });

  // Called on every cell render, so it must tolerate a half-built candidate and
  // a missing context rather than throwing the whole grid away.
  await test("missing context and an incomplete candidate degrade to no conflicts", () => {
    eq(C.dutyConflicts({ d4: "0042", date: "2026-09-10", dutyType: "COS" }, undefined).length, 0);
    eq(C.dutyConflicts({ d4: "", date: "2026-09-10", dutyType: "COS" }, { dutyRows: [] }).length, 0);
    eq(C.dutyConflicts(null, { dutyRows: [] }).length, 0);
  });

  // 4Ds arrive from Sheets as either "0042" or 42 depending on the column; the
  // comparison must not care.
  await test("a numeric 4D on a stored row still matches the string candidate", () => {
    const rows = [{ id: "a", d4: 42, date: "2026-09-10", dutyType: "COS" }];
    eq(C.dutyConflicts({ d4: 42, date: "2026-09-10", dutyType: "CDO" }, { dutyRows: rows })[0].kind, "doubleBooked");
  });
};
