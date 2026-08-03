const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

// NOTE: unlike test/calc.test.js this sandbox DOES include Array, so the module
// under test may use Array.isArray / Array.from freely.
function loadDutyPoints() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, Array, Object, JSON, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "duty-points.js"), "utf8"),
    sandbox, { filename: "duty-points.js" }
  );
  return sandbox;
}

const CFG = {
  dutyTypes: [
    { name: "CDO", scope: "company", pointWeight: null },
    { name: "CDS", scope: "company", pointWeight: null },
    { name: "COS", scope: "company", pointWeight: 1 },
    { name: "PDS", scope: "platoon", pointWeight: null }
  ],
  dutyDayWeights: { sun: 3, mon: 1, tue: 1, wed: 1, thu: 1, fri: 3, sat: 5, holiday: 5 }
};

module.exports = async function run() {
  const d = loadDutyPoints();

  suite("duty-points: day weights");

  await test("weekday weights follow the spec table", () => {
    // 2026-08-03 is a Monday; the week runs Mon..Sun.
    eq(d.dutyDayWeight("2026-08-03", CFG, {}), 1); // Mon
    eq(d.dutyDayWeight("2026-08-04", CFG, {}), 1); // Tue
    eq(d.dutyDayWeight("2026-08-05", CFG, {}), 1); // Wed
    eq(d.dutyDayWeight("2026-08-06", CFG, {}), 1); // Thu
    eq(d.dutyDayWeight("2026-08-07", CFG, {}), 3); // Fri  — book out
    eq(d.dutyDayWeight("2026-08-08", CFG, {}), 5); // Sat  — full day
    eq(d.dutyDayWeight("2026-08-09", CFG, {}), 3); // Sun  — book in
  });

  await test("a public holiday overrides its weekday", () => {
    const hol = d.indexHolidays([{ date: "2026-08-05", name: "Test PH", tentative: "" }]);
    eq(d.dutyDayWeight("2026-08-05", CFG, hol), 5); // Wed would be 1
    eq(d.dutyDayWeight("2026-08-06", CFG, hol), 1); // neighbour unaffected
  });

  await test("a tentative holiday still scores, so it can be reported not hidden", () => {
    const hol = d.indexHolidays([{ date: "2026-08-05", name: "Maybe", tentative: "yes" }]);
    eq(d.dutyDayWeight("2026-08-05", CFG, hol), 5);
    eq(hol["2026-08-05"].tentative, true);
  });

  await test("date parsing is timezone-safe", () => {
    // Naive `new Date("2026-08-08")` is UTC midnight and can slip a day in a
    // negative-offset zone, turning Saturday(5) into Friday(3).
    eq(d.dutyDayWeight("2026-08-08", CFG, {}), 5);
    eq(d.dutyDayWeight("2026-01-01", CFG, {}), 1); // Thu
    eq(d.dutyDayWeight("2026-12-31", CFG, {}), 1); // Thu
  });

  await test("a malformed date scores zero rather than throwing", () => {
    eq(d.dutyDayWeight("", CFG, {}), 0);
    eq(d.dutyDayWeight("not-a-date", CFG, {}), 0);
    eq(d.dutyDayWeight(null, CFG, {}), 0);
  });

  suite("duty-points: per-row points");

  await test("COS scores the day weight", () => {
    eq(d.dutyPointsFor({ date: "2026-08-08", dutyType: "COS", d4: "0012" }, CFG, {}), 5);
    eq(d.dutyPointsFor({ date: "2026-08-03", dutyType: "COS", d4: "0012" }, CFG, {}), 1);
  });

  await test("a null pointWeight type scores zero on every day", () => {
    eq(d.dutyPointsFor({ date: "2026-08-08", dutyType: "PDS", platoon: "PLT1", d4: "0012" }, CFG, {}), 0);
    eq(d.dutyPointsFor({ date: "2026-08-08", dutyType: "CDO", d4: "0012" }, CFG, {}), 0);
  });

  await test("an unknown duty type scores zero rather than throwing", () => {
    eq(d.dutyPointsFor({ date: "2026-08-08", dutyType: "NOPE", d4: "0012" }, CFG, {}), 0);
  });

  await test("a pointWeight multiplier scales the day weight", () => {
    const cfg2 = { dutyTypes: [{ name: "COS", scope: "company", pointWeight: 2 }], dutyDayWeights: CFG.dutyDayWeights };
    eq(d.dutyPointsFor({ date: "2026-08-08", dutyType: "COS", d4: "0012" }, cfg2, {}), 10);
  });

  suite("duty-points: range aggregation");

  const HOL = d.indexHolidays([{ date: "2026-08-05", name: "PH", tentative: "" }]);
  const ROWS = [
    { date: "2026-08-03", dutyType: "COS", platoon: "",     d4: "0012" }, // Mon  1
    { date: "2026-08-08", dutyType: "COS", platoon: "",     d4: "0012" }, // Sat  5
    { date: "2026-08-05", dutyType: "COS", platoon: "",     d4: "0013" }, // PH   5
    { date: "2026-08-04", dutyType: "PDS", platoon: "PLT1", d4: "0013" }, // Tue  0 (unscored)
    { date: "2026-09-01", dutyType: "COS", platoon: "",     d4: "0012" }  // next month
  ];

  await test("totals sum base points inside the range and exclude outside it", () => {
    const r = d.dutyTotals(ROWS, [], CFG, HOL, { from: "2026-08-01", to: "2026-08-31" });
    eq(r.byPerson["0012"].basePoints, 6);  // 1 + 5, September excluded
    eq(r.byPerson["0013"].basePoints, 5);  // PH only; PDS is unscored
  });

  await test("counts tally every type including unscored ones", () => {
    const r = d.dutyTotals(ROWS, [], CFG, HOL, { from: "2026-08-01", to: "2026-08-31" });
    eq(r.byPerson["0013"].counts.COS, 1);
    eq(r.byPerson["0013"].counts.PDS, 1);   // counted despite scoring zero
    eq(r.byPerson["0013"].basePoints, 5);
  });

  await test("weekend and holiday points are tracked separately", () => {
    const r = d.dutyTotals(ROWS, [], CFG, HOL, { from: "2026-08-01", to: "2026-08-31" });
    eq(r.byPerson["0012"].weekendPoints, 5); // the Saturday
    eq(r.byPerson["0013"].weekendPoints, 5); // the public holiday, though a Wednesday
  });

  await test("corrections apply and land in the total", () => {
    const corr = [{ date: "2026-08-08", d4: "0012", reason: "Outfield skip", delta: -2 }];
    const r = d.dutyTotals(ROWS, corr, CFG, HOL, { from: "2026-08-01", to: "2026-08-31" });
    eq(r.byPerson["0012"].corrections, -2);
    eq(r.byPerson["0012"].total, 4); // 6 - 2
  });

  await test("corrections outside the range are excluded", () => {
    const corr = [{ date: "2026-09-02", d4: "0012", reason: "Outfield skip", delta: -2 }];
    const r = d.dutyTotals(ROWS, corr, CFG, HOL, { from: "2026-08-01", to: "2026-08-31" });
    eq(r.byPerson["0012"].corrections, 0);
    eq(r.byPerson["0012"].total, 6);
  });

  await test("an Extras correction records without moving the score", () => {
    const corr = [{ date: "2026-08-08", d4: "0012", reason: "Extras", delta: 0 }];
    const r = d.dutyTotals(ROWS, corr, CFG, HOL, { from: "2026-08-01", to: "2026-08-31" });
    eq(r.byPerson["0012"].corrections, 0);
    eq(r.byPerson["0012"].total, 6);
  });

  await test("a correction for someone with no duties still produces a row", () => {
    const corr = [{ date: "2026-08-08", d4: "0099", reason: "Extras", delta: -2 }];
    const r = d.dutyTotals(ROWS, corr, CFG, HOL, { from: "2026-08-01", to: "2026-08-31" });
    eq(r.byPerson["0099"].total, -2);
    eq(r.byPerson["0099"].basePoints, 0);
  });

  suite("duty-points: regressions against the source spreadsheet's bugs");

  await test("spec bug #2 — the 31st of a month is counted, not dropped", () => {
    // The sheet's column R summed A2:A31 (30 rows) while its sibling counts used
    // A2:A32 (31), silently excluding the last day of any 31-day month.
    const rows = [{ date: "2026-08-31", dutyType: "COS", platoon: "", d4: "0012" }]; // Mon
    const r = d.dutyTotals(rows, [], CFG, {}, { from: "2026-08-01", to: "2026-08-31" });
    eq(r.byPerson["0012"].basePoints, 1);
    eq(r.byPerson["0012"].counts.COS, 1);
  });

  await test("spec bug #3 — a multi-month total sums rows directly, not subtotals", () => {
    // Overall duties drifted because it added per-month cells that were themselves
    // column-offset or missing. Summing rows over the wider range makes that
    // class of bug structurally impossible.
    const r = d.dutyTotals(ROWS, [], CFG, HOL, { from: "2026-08-01", to: "2026-09-30" });
    eq(r.byPerson["0012"].basePoints, 7); // Mon 1 + Sat 5 + Tue 1 (2026-09-01 is a Tuesday)
  });

  suite("duty-points: ranges");

  await test("month range spans the whole calendar month", () => {
    const r = d.dutyRangeFor("month", "2026-08-15", CFG);
    eq(r.from, "2026-08-01");
    eq(r.to, "2026-08-31");
  });

  await test("month range handles February and 30-day months", () => {
    eq(d.dutyRangeFor("month", "2026-02-10", CFG).to, "2026-02-28");
    eq(d.dutyRangeFor("month", "2026-09-10", CFG).to, "2026-09-30");
    eq(d.dutyRangeFor("month", "2028-02-10", CFG).to, "2028-02-29"); // leap year
  });

  await test("cycle range runs dutyCycleMonths from dutyCycleStart and rolls", () => {
    const cfg = { dutyCycleStart: "2026-04-01", dutyCycleMonths: 6, dutyDayWeights: CFG.dutyDayWeights, dutyTypes: CFG.dutyTypes };
    const r = d.dutyRangeFor("cycle", "2026-08-15", cfg);
    eq(r.from, "2026-04-01");
    eq(r.to, "2026-09-30");
    const next = d.dutyRangeFor("cycle", "2026-11-15", cfg);
    eq(next.from, "2026-10-01");
    eq(next.to, "2027-03-31");
  });

  await test("a date before the cycle start still resolves to a whole cycle", () => {
    const cfg = { dutyCycleStart: "2026-04-01", dutyCycleMonths: 6, dutyDayWeights: CFG.dutyDayWeights, dutyTypes: CFG.dutyTypes };
    const r = d.dutyRangeFor("cycle", "2026-01-15", cfg);
    eq(r.from, "2025-10-01");
    eq(r.to, "2026-03-31");
  });

  await test("all-time range is unbounded", () => {
    const r = d.dutyRangeFor("all", "2026-08-15", CFG);
    eq(r.from, "");
    eq(r.to, "");
    const t = d.dutyTotals(ROWS, [], CFG, HOL, r);
    eq(t.byPerson["0012"].counts.COS, 3); // September included
  });
};
