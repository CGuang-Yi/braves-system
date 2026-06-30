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

  suite("calc: conduct series parsing");

  await test("trailing number is the instance index; first-of-kind = 1", () => {
    eq(c.parseConductSeries("Endurance Run"), { base: "Endurance Run", num: 1 });
    eq(c.parseConductSeries("Endurance Run 2"), { base: "Endurance Run", num: 2 });
    eq(c.parseConductSeries("Endurance Run 6"), { base: "Endurance Run", num: 6 });
    eq(c.parseConductSeries("Endurance Run 10"), { base: "Endurance Run", num: 10 });
  });
  await test("a leading digit is NOT an instance index", () => {
    eq(c.parseConductSeries("5BX PT"), { base: "5BX PT", num: 1 });
    eq(c.parseConductSeries("Road Run"), { base: "Road Run", num: 1 });
  });

  suite("calc: conduct progression");

  await test("position = latest attended; missed = gaps below it; behind = frontier − position", () => {
    // Class held #1..#6. Recruit 0001 attended 1,2,3,5 (skipped 4); company frontier = 6.
    const instances = [
      { conductId: "e1", num: 1 }, { conductId: "e2", num: 2 }, { conductId: "e3", num: 3 },
      { conductId: "e4", num: 4 }, { conductId: "e5", num: 5 }, { conductId: "e6", num: 6 }
    ];
    const present = {
      e1: new Set(["0001", "0002"]), e2: new Set(["0001", "0002"]), e3: new Set(["0001", "0002"]),
      e4: new Set(["0002"]),         e5: new Set(["0001", "0002"]), e6: new Set(["0002"])
    };
    const r = c.conductProgress(instances, present, ["0001", "0002"]);
    eq(r.seriesMax, 6);
    const a = r.rows.find(x => x.d4 === "0001");
    eq(a.position, 5, "latest attended");
    eq(a.missed, [4], "gap below current");
    eq(a.behind, 1, "frontier 6 − position 5");
    eq(a.completed, 4);
    const b = r.rows.find(x => x.d4 === "0002");
    eq(b.position, 6); eq(b.missed, []); eq(b.behind, 0); // on the frontier, no gaps
  });

  await test("not started → position 0, no gaps, behind = frontier", () => {
    const instances = [{ conductId: "e1", num: 1 }, { conductId: "e2", num: 2 }];
    const r = c.conductProgress(instances, { e1: new Set(["0009"]), e2: new Set(["0009"]) }, ["0001"]);
    eq(r.rows[0], { d4: "0001", position: 0, completed: 0, missed: [], behind: 2 });
  });

  suite("calc: conduct buildup group consistency");

  await test("a blank/missing group buckets to Unassigned and still counts", () => {
    const r = c.conductBuildup([
      { dateIso: "2026-01-01", group: "", type: "RSI" },
      { dateIso: "2026-01-01", group: null, type: "Fallout" },
      { dateIso: "2026-01-01", group: "Sec 1", type: "Status" }
    ]);
    eq(r.totalMisses, 3);
    eq(r.groups, ["Sec 1", "Unassigned"]);
    // Invariant: the cumulative lines' final values sum to exactly totalMisses,
    // so the buildup chart can never undershoot the Total Misses tile.
    const lastSum = r.groups.reduce((s, g) => s + r.cumulative[g][r.cumulative[g].length - 1], 0);
    eq(lastSum, r.totalMisses);
    eq(r.cumulative["Unassigned"], [2]); // the blank + null misses
    eq(r.cumulative["Sec 1"], [1]);
  });

  await test("groups list ignores PXP-only groups (no misses → no buildup line)", () => {
    const r = c.conductBuildup([
      { dateIso: "2026-01-01", group: "Sec 2", type: "PXP" },
      { dateIso: "2026-01-01", group: "Sec 1", type: "RSI" }
    ]);
    eq(r.groups, ["Sec 1"]);     // Sec 2 has only PXP (not a miss)
    eq(r.byType.PXP, 1);         // PXP still tallied for the stacked bar
  });

  suite("calc: participant parsing + shared out-index");

  await test("parseParticipantIds trims, drops blanks, coerces nullish to []", () => {
    eq(c.parseParticipantIds("0001, 0002 ,,0003"), ["0001", "0002", "0003"]);
    eq(c.parseParticipantIds(""), []);
    eq(c.parseParticipantIds(null), []);
    eq(c.parseParticipantIds(undefined), []);
  });

  await test("a precomputed outBy index yields identical scoped results", () => {
    const att = [{ source: "csv", date: "01 Jan 2026", dateIso: "2026-01-01", conductId: "C1", participants: "0001,0002,0050" }];
    const cd = [{ conductId: "C1", date: "01 Jan 2026", d4: "0003", type: "RSI" }];
    const scope = new Set(["0001", "0002", "0003"]);
    const idx = c.conductOutByIndex(cd);
    eq(c.perConductParticipation(att, cd, scope), c.perConductParticipation(att, null, scope, idx));
    eq(c.scopedParticipation(att, cd, scope), c.scopedParticipation(att, null, scope, idx));
  });
};
