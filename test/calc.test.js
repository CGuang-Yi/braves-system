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

  suite("calc: conduct dashboard buildup");

  await test("cumulative buildup accumulates misses per group across dates", () => {
    const rows = [
      { dateIso: "2026-01-01", group: "Sec 1", type: "Fallout" },
      { dateIso: "2026-01-01", group: "Sec 2", type: "RSI" },
      { dateIso: "2026-01-03", group: "Sec 1", type: "Status" },
      { dateIso: "2026-01-03", group: "Sec 1", type: "RSI" }
    ];
    const r = c.conductBuildup(rows);
    eq(r.dates, ["2026-01-01", "2026-01-03"]);
    eq(r.groups, ["Sec 1", "Sec 2"]);
    eq(r.cumulative["Sec 1"], [1, 3]); // 1 on day1, +2 on day3
    eq(r.cumulative["Sec 2"], [1, 1]); // 1 on day1, none day3 (carried)
    eq(r.totalMisses, 4);
  });

  await test("PXP is shown in the stack/byType but is NOT a miss", () => {
    const rows = [
      { dateIso: "2026-01-01", group: "Sec 1", type: "PXP" },
      { dateIso: "2026-01-01", group: "Sec 1", type: "Fallout" }
    ];
    const r = c.conductBuildup(rows);
    eq(r.totalMisses, 1, "only Fallout counts");
    eq(r.cumulative["Sec 1"], [1], "PXP excluded from buildup");
    eq(r.byType.PXP, 1, "PXP still tallied for the stacked bar");
    eq(r.stacks.PXP, [1]);
    // misses ordered first, PXP (extra) last
    eq(r.types[r.types.length - 1], "PXP");
  });

  await test("worstType picks the highest-count miss type; null when no misses", () => {
    const r = c.conductBuildup([
      { dateIso: "2026-01-01", group: "A", type: "RSI" },
      { dateIso: "2026-01-02", group: "A", type: "RSI" },
      { dateIso: "2026-01-02", group: "A", type: "Fallout" }
    ]);
    eq(r.worstType, "RSI");
    eq(c.conductBuildup([{ dateIso: "2026-01-01", group: "A", type: "PXP" }]).worstType, null);
  });

  suite("calc: per-conduct participation");

  await test("company-wide (null scope) → stored rate per conduct", () => {
    const att = [
      { dateIso: "2026-01-01", conductId: "C1", participating: 2, total: 4 },
      { dateIso: "2026-01-02", conductId: "C2", participating: 3, total: 3 }
    ];
    const r = c.perConductParticipation(att, [], null);
    eq(r.map(x => x.pct), [50, 100]);
  });

  await test("scoped → present∩scope over (present + out-in-scope) per conduct", () => {
    const att = [{ source: "csv", dateIso: "2026-01-01", date: "01 Jan 2026", conductId: "C1", participants: "0001,0002,0050", participating: 3, total: 10 }];
    const cd = [{ conductId: "C1", date: "01 Jan 2026", d4: "0003", type: "RSI" }];
    const r = c.perConductParticipation(att, cd, new Set(["0001", "0002", "0003"]));
    eq(r.length, 1);
    eq(r[0].pct, 67); // present 0001,0002 (2) over involved 3
  });
};
