// Regression coverage for the EX → status mapping in shEpisodesToRows
// (braves-ha-pr20-followups: the bulk sick-history importer used to always
// write the generic "Excuse" status, losing the "PT" subtype that
// haStatusDisqualifies() needs to exclude a day from HA credit).
//
// js/sick-history-import.js is a browser-global script (no module.exports),
// same load approach as test/ha.test.js: run it in a vm context with a
// permissive global so it can be exercised directly in Node.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadModule() {
  const target = { console, JSON, Math, Date, String, Number, Array, Object, RegExp, Set, Map };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "sick-history-import.js"), "utf8"), ctx, { filename: "sick-history-import.js" });
  return target;
}

function ctxFor(d4) {
  return {
    resolveD4: raw => raw === d4 ? d4 : null,
    makeMedId: (() => { let n = 0; return () => ++n; })(),
    makeLeaveId: (() => { let n = 0; return () => ++n; })(),
    toDisplay: iso => iso
  };
}

function personWithEx(reason) {
  return { fourD: "0001", name: "Test Recruit", sn: "", episodes: [
    { status: "EX", reason, startDate: "2026-05-02", endDate: "2026-05-02" }
  ] };
}

module.exports = async function run() {
  const M = loadModule();

  suite("sick-history-import: EX status → granular Excuse subtype");

  await test('EX with a "PT" reason maps to the granular "Excuse PT" status', () => {
    const { medical } = M.shEpisodesToRows([personWithEx("EX PT")], ctxFor("0001"));
    eq(medical[0].status, "Excuse PT");
  });

  await test('EX with a "PT" reason embedded in longer text still maps to "Excuse PT"', () => {
    const { medical } = M.shEpisodesToRows([personWithEx("3D EX PT (020526-020526)")], ctxFor("0001"));
    eq(medical[0].status, "Excuse PT");
  });

  await test('EX with an unrelated reason keeps the generic "Excuse" status', () => {
    const { medical } = M.shEpisodesToRows([personWithEx("Excuse Kneeling")], ctxFor("0001"));
    eq(medical[0].status, "Excuse");
  });

  await test("EX with no reason text keeps the generic \"Excuse\" status", () => {
    const { medical } = M.shEpisodesToRows([personWithEx("")], ctxFor("0001"));
    eq(medical[0].status, "Excuse");
  });
};
