const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadEligibility() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, Array, Object, JSON, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "duty-eligibility.js"), "utf8"),
    sandbox, { filename: "duty-eligibility.js" }
  );
  return sandbox;
}

const CFG = {
  dutyTypes: [
    { name: "COS", scope: "company", pointWeight: 1 },
    { name: "PDS", scope: "platoon", pointWeight: null }
  ],
  dutyExtraEligible: []
};

// Mirrors the real org model (spec §5, BRAVES_ADAPTATION_SPEC §5): section is
// "Command" for PC/PS, a number for a section commander, blank for HQ-flat.
const ROSTER = [
  { id: "0001", role: "Commander", platoon: "PLT1", section: "Command", status: "Active" }, // PC1
  { id: "0002", role: "Commander", platoon: "PLT1", section: "Command", status: "Active" }, // PS1
  { id: "0003", role: "Commander", platoon: "PLT1", section: "1",       status: "Active" }, // P1SC1
  { id: "0004", role: "Commander", platoon: "PLT1", section: "2",       status: "Active" }, // P1SC2
  { id: "0005", role: "Commander", platoon: "PLT2", section: "1",       status: "Active" }, // P2SC1
  { id: "0006", role: "Commander", platoon: "HQ",   section: "",        status: "Active" }, // HQ
  { id: "0007", role: "Commander", platoon: "PLT1", section: "3",       status: "Departed" },
  { id: "1411", role: "Recruit",   platoon: "PLT1", section: "1",       status: "Active" }
];

module.exports = async function run() {
  const e = loadEligibility();

  suite("duty-eligibility: pool");

  await test("company-scoped duty draws every active commander and no recruits", () => {
    const got = e.dutyEligible("COS", "", "2026-08-03", ROSTER, CFG, {});
    eq(got.join(","), "0001,0002,0003,0004,0005,0006");
  });

  await test("departed personnel are excluded", () => {
    const got = e.dutyEligible("COS", "", "2026-08-03", ROSTER, CFG, {});
    eq(got.indexOf("0007"), -1);
  });

  await test("dutyExtraEligible adds people outside the commander rule", () => {
    const cfg = { dutyTypes: CFG.dutyTypes, dutyExtraEligible: ["1411"] };
    const got = e.dutyEligible("COS", "", "2026-08-03", ROSTER, cfg, {});
    eq(got.indexOf("1411") >= 0, true);
  });

  suite("duty-eligibility: PDS platoon rule");

  await test("PDS is limited to that platoon's section commanders", () => {
    const got = e.dutyEligible("PDS", "PLT1", "2026-08-03", ROSTER, CFG, {});
    eq(got.join(","), "0003,0004"); // PC1 and PS1 excluded, PLT2 excluded
  });

  await test("PC and PS are excluded via section === 'Command'", () => {
    const got = e.dutyEligible("PDS", "PLT1", "2026-08-03", ROSTER, CFG, {});
    eq(got.indexOf("0001"), -1);
    eq(got.indexOf("0002"), -1);
  });

  await test("HQ-flat personnel never qualify for a PDS", () => {
    eq(e.dutyEligible("PDS", "HQ", "2026-08-03", ROSTER, CFG, {}).length, 0);
  });

  await test("HQ produces no PDS column at all", () => {
    const cols = e.dutyPlatoonsFor("PDS", ["HQ", "PLT1", "PLT2"], CFG);
    eq(cols.join(","), "PLT1,PLT2");
  });

  await test("PDS columns follow the live platoon list, not a hardcoded four", () => {
    eq(e.dutyPlatoonsFor("PDS", ["HQ", "PLT1", "PLT2", "PLT3", "PLT4", "PLT5"], CFG).join(","),
       "PLT1,PLT2,PLT3,PLT4,PLT5");
    eq(e.dutyPlatoonsFor("PDS", ["HQ", "PLT1"], CFG).join(","), "PLT1");
  });

  await test("platoon list entries may be objects with a name", () => {
    eq(e.dutyPlatoonsFor("PDS", [{ name: "HQ" }, { name: "PLT1" }, { name: "PLT2" }], CFG).join(","),
       "PLT1,PLT2");
  });

  await test("company-scoped types get a single unnamed column", () => {
    eq(e.dutyPlatoonsFor("COS", ["HQ", "PLT1", "PLT2"], CFG).join("|"), "");
  });

  suite("duty-eligibility: invariants (spec §5.1)");

  await test("§5.1.3 grandfathering — the current assignee is always offered", () => {
    // 0005 has since moved to PLT2 but historically held a PLT1 PDS.
    const got = e.dutyEligible("PDS", "PLT1", "2026-05-03", ROSTER, CFG, { currentAssignee: "0005" });
    eq(got.indexOf("0005") >= 0, true);
    eq(got.indexOf("0001"), -1); // grandfathering admits ONE person, it is not a bypass
  });

  await test("§5.1.3 a departed current assignee is still offered", () => {
    const got = e.dutyEligible("PDS", "PLT1", "2026-05-03", ROSTER, CFG, { currentAssignee: "0007" });
    eq(got.indexOf("0007") >= 0, true);
  });

  await test("grandfathering never duplicates an already-eligible person", () => {
    const got = e.dutyEligible("PDS", "PLT1", "2026-08-03", ROSTER, CFG, { currentAssignee: "0003" });
    eq(got.join(","), "0003,0004");
  });

  await test("§5.1.2 a platoon transfer does not change who was eligible historically", () => {
    // The same call, against a roster where 0003 has since transferred to PLT2,
    // still offers 0003 for their existing PLT1 row. Nothing about the stored row
    // is re-derived from the roster, so no historical total can move.
    const moved = ROSTER.map(function (r) {
      return r.id === "0003" ? { id: "0003", role: "Commander", platoon: "PLT2", section: "1", status: "Active" } : r;
    });
    const got = e.dutyEligible("PDS", "PLT1", "2026-05-03", moved, CFG, { currentAssignee: "0003" });
    eq(got.indexOf("0003") >= 0, true);
    // ...and 0003 now legitimately appears for PLT2 going forward.
    eq(e.dutyEligible("PDS", "PLT2", "2026-08-03", moved, CFG, {}).join(","), "0003,0005");
  });

  await test("§5.1.1 eligibility is a function of its arguments — no stored duty rows are visible", () => {
    // The proof obligation is structural: dutyEligible has no parameter through
    // which stored Duty rows could arrive, so it is incapable of invalidating one.
    // Guard the signature so a future change has to be deliberate.
    eq(e.dutyEligible.length, 6);
  });

  await test("missing or empty inputs degrade quietly", () => {
    eq(e.dutyEligible("COS", "", "2026-08-03", [], CFG, {}).length, 0);
    eq(e.dutyEligible("COS", "", "2026-08-03", null, CFG, {}).length, 0);
    eq(e.dutyPlatoonsFor("PDS", null, CFG).length, 0);
  });
};
