// bravesMigrateMrTiming() — the one-shot Medical.mrTiming -> Medical.time move.
//
// This migration is LOSSY BY DECISION: MR used to accept free text ("PM") where
// an HHMM column cannot hold it, and Feature 30.1 needs one time source across
// all four visit types. The thing that makes lossiness acceptable is the REPORT
// — every dropped value logged with its 4D and date so it can be re-entered — so
// the report is asserted here as carefully as the moves are.
//
// It runs by hand in the Apps Script editor against a live sheet, which is
// exactly why it is pinned against the mocked sheet: there is no CI path that
// would ever execute it, and a mistake is discovered on production data.
const { suite, test, eq, ok } = require("./_tap");
const { loadBackend } = require("./harness");

const HEAD = ["id", "d4", "date", "type", "status", "reason", "mrTiming", "time"];
const row = (id, d4, date, type, mrTiming, time) =>
  [id, d4, date, type, "", "review", mrTiming, time];

function seeded(rows) {
  const b = loadBackend();
  b.db.seed("Medical", HEAD, rows);
  b.db.clearLogs();
  return b;
}
const summary = b => (b.db.logs().find(l => l.indexOf("mrTiming migration:") === 0) || "");
const timesOf = b => b.db.rowsOf("Medical").map(r => String(r.time));

module.exports = async function run() {
  suite("mrTiming migration: what moves");

  await test("a parseable timing is copied to time and zero-padded to HHMM", () => {
    const b = seeded([
      row(1, "1411", "29 Jun 2026", "MR", "1400", ""),
      row(2, "1422", "29 Jun 2026", "MR", "930", ""),
      row(3, "1433", "29 Jun 2026", "MR", "14:00", "")
    ]);
    b.bravesMigrateMrTiming();
    eq(timesOf(b), ["1400", "0930", "1400"]);
    ok(/3 moved/.test(summary(b)), summary(b));
  });

  await test("the original mrTiming values are left in place, not blanked", () => {
    // They are the audit trail for the dropped ones and the fallback the visit
    // badge still reads; the migration must not destroy what it is reporting on.
    const b = seeded([row(1, "1411", "29 Jun 2026", "MR", "1400", "")]);
    b.bravesMigrateMrTiming();
    eq(b.db.rowsOf("Medical")[0].mrTiming, "1400");
  });

  await test("only MR rows are touched — an RSI's mrTiming is left alone", () => {
    const b = seeded([
      row(1, "1411", "29 Jun 2026", "RSI", "1400", ""),
      row(2, "1422", "29 Jun 2026", "MR", "1500", "")
    ]);
    b.bravesMigrateMrTiming();
    eq(timesOf(b), ["", "1500"], "the RSI row must not gain a time from mrTiming");
  });

  suite("mrTiming migration: what is dropped, and reported");

  await test("a non-numeric timing is dropped and named with its 4D and date", () => {
    const b = seeded([
      row(1, "1411", "29 Jun 2026", "MR", "PM", ""),
      row(2, "1422", "30 Jun 2026", "MR", "after lunch", "")
    ]);
    b.bravesMigrateMrTiming();
    eq(timesOf(b), ["", ""], "nothing unparseable may be guessed into the time column");
    ok(/0 moved/.test(summary(b)) && /2 dropped/.test(summary(b)), summary(b));
    const log = b.db.logs().join("\n");
    ok(/1411.*29 Jun 2026.*"PM"/.test(log), "the dropped value is not identifiable:\n" + log);
    ok(/1422.*30 Jun 2026.*"after lunch"/.test(log), "the dropped value is not identifiable:\n" + log);
  });

  await test("an out-of-range time is rejected rather than silently mangled", () => {
    const b = seeded([
      row(1, "1411", "29 Jun 2026", "MR", "2500", ""),
      row(2, "1422", "29 Jun 2026", "MR", "1099", "")
    ]);
    b.bravesMigrateMrTiming();
    eq(timesOf(b), ["", ""]);
    ok(/2 dropped/.test(summary(b)), summary(b));
  });

  await test("nothing is logged as dropped when nothing was", () => {
    const b = seeded([row(1, "1411", "29 Jun 2026", "MR", "1400", "")]);
    b.bravesMigrateMrTiming();
    ok(!b.db.logs().some(l => /DROPPED/.test(l)), "a clean run must not print a dropped-value header");
  });

  suite("mrTiming migration: idempotence and no-ops");

  await test("a second run is a no-op — rows that already have a time are skipped", () => {
    const b = seeded([
      row(1, "1411", "29 Jun 2026", "MR", "1400", ""),
      row(2, "1422", "29 Jun 2026", "MR", "PM", "")
    ]);
    b.bravesMigrateMrTiming();
    b.db.clearLogs();
    b.bravesMigrateMrTiming();
    eq(timesOf(b), ["1400", ""], "the second run must not change anything");
    ok(/0 moved/.test(summary(b)) && /1 already had a time/.test(summary(b)), summary(b));
  });

  await test("an existing time is never overwritten by an mrTiming that disagrees", () => {
    const b = seeded([row(1, "1411", "29 Jun 2026", "MR", "1400", "0900")]);
    b.bravesMigrateMrTiming();
    eq(timesOf(b), ["0900"], "the time column wins — it is the new source of truth");
  });

  await test("a blank mrTiming is neither moved nor counted as dropped", () => {
    const b = seeded([row(1, "1411", "29 Jun 2026", "MR", "", "")]);
    b.bravesMigrateMrTiming();
    ok(/0 moved/.test(summary(b)) && /0 dropped/.test(summary(b)), summary(b));
  });

  suite("mrTiming migration: refuses to run against the wrong sheet shape");

  await test("a missing column aborts with a pointer to bravesMigrateSchema", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "d4", "date", "type", "status", "reason"], [
      [1, "1411", "29 Jun 2026", "MR", "", "review"]
    ]);
    b.db.clearLogs();
    b.bravesMigrateMrTiming();
    ok(b.db.logs().some(l => /bravesMigrateSchema/.test(l)),
      "an unmigrated sheet must be named, not silently skipped: " + b.db.logs().join(" | "));
  });

  await test("a header-only Medical tab is a clean no-op", () => {
    const b = seeded([]);
    b.bravesMigrateMrTiming();
    ok(b.db.logs().some(l => /empty/.test(l)), b.db.logs().join(" | "));
  });
};
