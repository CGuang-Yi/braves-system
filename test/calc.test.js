const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadCalc() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "calc.js"), "utf8"), sandbox, { filename: "calc.js" });
  return sandbox;
}

module.exports = async function run() {
  suite("calc: inclusive date math");
  const c = loadCalc();

  await test("addDaysISO adds days, tz-safe", () => {
    eq(c.addDaysISO("2026-01-05", 3), "2026-01-08");
    eq(c.addDaysISO("2026-01-31", 1), "2026-02-01");
    eq(c.addDaysISO("2026-01-05", 0), "2026-01-05");
  });

  await test("endDateFromStartAndDays is inclusive (day-1)", () => {
    eq(c.endDateFromStartAndDays("2026-01-05", 1), "2026-01-05"); // 1 day = same day
    eq(c.endDateFromStartAndDays("2026-01-05", 3), "2026-01-07"); // Mon..Wed
    eq(c.endDateFromStartAndDays("2026-01-05", 0), "");           // invalid
    eq(c.endDateFromStartAndDays("", 3), "");
  });

  await test("daysFromStartEndInclusive inverts it", () => {
    eq(c.daysFromStartEndInclusive("2026-01-05", "2026-01-07"), 3);
    eq(c.daysFromStartEndInclusive("2026-01-05", "2026-01-05"), 1);
    eq(c.daysFromStartEndInclusive("2026-01-07", "2026-01-05"), 0); // end before start
  });
};
