const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadCalc() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, console };
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

  suite("calc: scoped participation");
  await test("company-wide uses stored participating/total", () => {
    const att = [
      { source: "csv", conductId: "C1", date: "01 Jan 2026", participants: "0001,0002", participating: 2, total: 4 },
      { source: "csv", conductId: "C2", date: "02 Jan 2026", participants: "0001", participating: 1, total: 4 }
    ];
    const r = c.scopedParticipation(att, [], null);
    eq(r.pct, Math.round(((2/4)+(1/4))/2*100)); // 38
  });
  await test("scoped uses present ∩ scope over (present+out) in scope", () => {
    const att = [
      { source: "csv", conductId: "C1", date: "01 Jan 2026", participants: "0001,0002,0050", participating: 3, total: 10 }
    ];
    const cd = [{ conductId: "C1", date: "01 Jan 2026", d4: "0003", type: "RSI" }]; // 0003 in scope, was out
    const scope = new Set(["0001", "0002", "0003"]); // 0050 out of scope
    const r = c.scopedParticipation(att, cd, scope);
    // scopedPresent=2 (0001,0002), scopedOut=1 (0003) => 2/3 = 67%
    eq(r.pct, 67);
    eq(r.conducts, 1);
  });
  await test("scoped skips conducts with nobody in scope", () => {
    const att = [{ source: "csv", conductId: "C1", date: "01 Jan 2026", participants: "0050", participating: 1, total: 5 }];
    const r = c.scopedParticipation(att, [], new Set(["0001"]));
    eq(r.conducts, 0);
    eq(r.pct, 0);
  });
};
