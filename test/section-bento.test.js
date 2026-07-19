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
  return { target, ctx };
}

module.exports = async function run() {
  suite("dashboard: sectionStrengthBreakdown");

  const people = [
    { id: "1111", platoon: "PLT1", section: "1", inCamp: true },
    { id: "1112", platoon: "PLT1", section: "1", inCamp: false },
    { id: "1121", platoon: "PLT1", section: "2", inCamp: true },
    { id: "2111", platoon: "PLT2", section: "1", inCamp: true },
    { id: "0001", platoon: "",     section: "", inCamp: true }   // commander, no platoon
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

  await test("blank section collapses to a single '—' box", () => {
    const { ctx } = loadCtx();
    ctx._people = people;
    const out = JSON.parse(vm.runInContext("JSON.stringify(sectionStrengthBreakdown(_people, '2026-07-19'))", ctx));
    const cmd = out.find(g => g.code === "");
    eq(cmd.sections.length, 1);
    eq(cmd.sections[0].label, "—");
    eq(cmd.sections[0].tot, 1);
  });
};
