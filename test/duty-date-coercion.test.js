// The duty tabs store ISO YYYY-MM-DD dates. Without a WRITE_TEXT_COLS_BY_TAB
// entry Sheets parses "2026-09-01" into a real Date, and readTab re-serves it as
// "01 Sep 2026" — a different string from the one written, against which the
// duty grid's lexicographic comparisons match nothing. Same trap as the
// Attendance-participants (#33) and conduct-time (#69) corruption bugs.
//
// The fake spreadsheet does not coerce, so asserting the value round-trips would
// pass without the fix. numberFormat is what proves the "@" was applied.
const { suite, test, eq } = require("./_tap");
const { loadBackend } = require("./harness");

module.exports = async function run() {
  suite("duty tabs: ISO date columns are forced to plain text");

  await test("Duty.date is forced to '@'", () => {
    const b = loadBackend();
    b.db.seed("Duty", ["id", "date", "dutyType", "platoon", "d4", "assignedBy", "assignedAt", "source"], []);
    const r = b.writeTab("Duty", [{
      id: 1, date: "2026-09-01", dutyType: "Guard", platoon: "PLT3",
      d4: "0042", assignedBy: "0001", assignedAt: "2026-08-10T00:00:00Z", source: "manual"
    }]);
    eq(r.ok, true, "write ok");
    eq(b.db.numberFormat("Duty", 2), "@", "date is the 2nd header and must be plain text");
    eq(b.db.numberFormat("Duty", 5), "@", "d4 stays protected — this must not regress");
  });

  await test("DutyCorrection.date is forced to '@'", () => {
    const b = loadBackend();
    b.db.seed("DutyCorrection", ["id", "date", "d4", "reason", "delta", "note", "enteredBy", "enteredAt"], []);
    b.writeTab("DutyCorrection", [{
      id: 1, date: "2026-09-01", d4: "0042", reason: "Swap", delta: -1,
      note: "", enteredBy: "0001", enteredAt: "2026-08-10T00:00:00Z"
    }]);
    eq(b.db.numberFormat("DutyCorrection", 2), "@", "date is the 2nd header");
    eq(b.db.numberFormat("DutyCorrection", 3), "@", "d4 stays protected");
  });

  await test("Holidays.date is forced to '@'", () => {
    const b = loadBackend();
    b.db.seed("Holidays", ["date", "name", "tentative"], []);
    b.writeTab("Holidays", [{ date: "2026-09-01", name: "Test Day", tentative: "" }]);
    eq(b.db.numberFormat("Holidays", 1), "@", "date is the 1st header");
  });

  await test("a tab with no coercion-prone columns is still left alone", () => {
    // Negative control: proves the fix added entries rather than blanket-forcing
    // every column on every tab.
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    b.writeTab("Medical", [{ id: 1, reason: "fever" }]);
    eq(b.db.numberFormat("Medical", 1), null, "Medical is not needlessly forced");
  });
};
