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
};
