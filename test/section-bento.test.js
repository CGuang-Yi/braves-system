// Unit-tests the pure sectionStrengthBreakdown(people, dateIso) grouping helper
// in render.js. render.js is a browser-global script (no module.exports) full of
// eager top-level declarations, so we load it into a vm context whose global is a
// Proxy with has:()=>true — any unresolved free identifier reads undefined instead
// of throwing (same trick as log-conduct-wizard.test.js). The four collaborators
// the helper calls (personPlatoon / personSection / activePlatoons / bpStrength)
// live in other bundles, so we stub them straight onto the context global.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadCtx() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8"), ctx, { filename: "render.js" });
  // Real-shaped stubs. personPlatoon/personSection read plain row fields; bpStrength
  // counts in-camp via a per-person `inCamp` flag so the test controls cur exactly.
  target.personPlatoon = r => r.platoon || "";
  target.personSection = r => (r.section == null ? "" : String(r.section));
  target.activePlatoons = () => [
    { code: "PLT1", displayName: "Platoon 1" },
    { code: "PLT2", displayName: "Platoon 2" }
  ];
  target.bpStrength = people => ({ total: people.length, current: people.filter(p => p.inCamp).length, groups: {} });
  // The command element (HQ / blank platoon) is broken down by rank group, so the
  // helper calls rankGroupOf — stub it off a plain field (default Enlistee).
  target.rankGroupOf = r => r.rankGroup || "Enlistee";
  return { target, ctx };
}

module.exports = async function run() {
  suite("dashboard: sectionStrengthBreakdown");

  const people = [
    { id: "1111", platoon: "PLT1", section: "1", inCamp: true },
    { id: "1112", platoon: "PLT1", section: "1", inCamp: false },
    { id: "1121", platoon: "PLT1", section: "2", inCamp: true },
    { id: "2111", platoon: "PLT2", section: "1", inCamp: true },
    { id: "0001", platoon: "",     section: "", inCamp: true, rankGroup: "Officer" }   // commander, no platoon
  ];

  await test("groups by platoon in activePlatoons order, then Command/Unassigned last", () => {
    const { ctx } = loadCtx();
    ctx._people = people;
    const out = JSON.parse(vm.runInContext("JSON.stringify(sectionStrengthBreakdown(_people, '2026-07-19'))", ctx));
    eq(out.map(g => g.code).join(","), "PLT1,PLT2,");
    eq(out[2].displayName, "Command / Unassigned");
  });

  await test("per-section cur/tot use bpStrength.current and .total", () => {
    const { ctx } = loadCtx();
    ctx._people = people;
    const out = JSON.parse(vm.runInContext("JSON.stringify(sectionStrengthBreakdown(_people, '2026-07-19'))", ctx));
    const plt1 = out.find(g => g.code === "PLT1");
    const s1 = plt1.sections.find(s => s.label === "1");
    eq(s1.tot, 2); eq(s1.cur, 1);                 // two in sect 1, one in camp
    const s2 = plt1.sections.find(s => s.label === "2");
    eq(s2.tot, 1); eq(s2.cur, 1);
  });

  await test("command element breaks down by rank group, not section", () => {
    const { ctx } = loadCtx();
    ctx._people = people;
    const out = JSON.parse(vm.runInContext("JSON.stringify(sectionStrengthBreakdown(_people, '2026-07-19'))", ctx));
    const cmd = out.find(g => g.code === "");
    eq(cmd.sections.length, 1);
    eq(cmd.sections[0].label, "Officer");         // grouping key = rank group
    eq(cmd.sections[0].displayLabel, "OFFICER");  // display-ready box label
    eq(cmd.sections[0].tot, 1);
  });

  await test("HQ platoon splits commanders into OFFICER then WOSPEC boxes", () => {
    const { ctx } = loadCtx();
    // Coy HQ holds an officer (OC) and WOSPEC section commanders — the section
    // field is "Command" for all, so only a rank-group split distinguishes them.
    const hq = [
      { id: "0001", platoon: "HQ", section: "Command", inCamp: true,  rankGroup: "Officer" },
      { id: "0011", platoon: "HQ", section: "Command", inCamp: true,  rankGroup: "WOSPEC" },
      { id: "0012", platoon: "HQ", section: "Command", inCamp: false, rankGroup: "WOSPEC" }
    ];
    ctx._people = hq;
    const out = JSON.parse(vm.runInContext("JSON.stringify(sectionStrengthBreakdown(_people, '2026-07-19'))", ctx));
    const g = out.find(x => x.code === "HQ");
    eq(g.sections.map(s => s.displayLabel).join(","), "OFFICER,WOSPEC");
    const off = g.sections.find(s => s.displayLabel === "OFFICER");
    eq(off.cur, 1); eq(off.tot, 1);
    const wo = g.sections.find(s => s.displayLabel === "WOSPEC");
    eq(wo.cur, 1); eq(wo.tot, 2);                 // two WOSPEC, one in camp
  });

  await test("extras-platoon (not in activePlatoons) appears after active codes, before blank group", () => {
    const { ctx } = loadCtx();
    const withExtra = people.concat([{ id: "9111", platoon: "PLT9", section: "1", inCamp: true }]);
    ctx._people = withExtra;
    const out = JSON.parse(vm.runInContext("JSON.stringify(sectionStrengthBreakdown(_people, '2026-07-19'))", ctx));
    eq(out.map(g => g.code).join(","), "PLT1,PLT2,PLT9,");
    const extra = out.find(g => g.code === "PLT9");
    eq(extra.displayName, "PLT9");
  });

  await test("sections sort numeric-ascending, then non-numeric alpha, then blank last", () => {
    const { ctx } = loadCtx();
    const mixed = [
      { id: "3111", platoon: "PLT1", section: "2", inCamp: true },
      { id: "3112", platoon: "PLT1", section: "1", inCamp: true },
      { id: "3113", platoon: "PLT1", section: "Command", inCamp: true },
      { id: "3114", platoon: "PLT1", section: "", inCamp: true }
    ];
    ctx._people = mixed;
    const out = JSON.parse(vm.runInContext("JSON.stringify(sectionStrengthBreakdown(_people, '2026-07-19'))", ctx));
    const plt1 = out.find(g => g.code === "PLT1");
    eq(plt1.sections.map(s => s.label).join(","), "1,2,Command,—");
  });
};
