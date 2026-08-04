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
    { name: "CDO", scope: "company", pointWeight: null, appointments: ["PC"] },
    { name: "CDS", scope: "company", pointWeight: null, appointments: ["PS"] },
    { name: "COS", scope: "company", pointWeight: 1, appointments: ["SectComd"] },
    { name: "PDS", scope: "platoon", pointWeight: null, appointments: ["SectComd"] },
    // Unrestricted type — no `appointments` key. Guards the "an ad-hoc duty type
    // added later needs no config migration" property.
    { name: "ANY", scope: "company", pointWeight: null }
  ],
  dutyExtraEligible: []
};

// Mirrors the real org model (spec §5, BRAVES_ADAPTATION_SPEC §5): section is
// "Command" for PC/PS, a number for a section commander, blank for HQ-flat, and
// `appointment` is what separates the PC from the PS inside "Command".
const ROSTER = [
  { id: "0001", role: "Commander", platoon: "PLT1", section: "Command", appointment: "PC",       status: "Active" }, // PC1
  { id: "0002", role: "Commander", platoon: "PLT1", section: "Command", appointment: "PS",       status: "Active" }, // PS1
  { id: "0003", role: "Commander", platoon: "PLT1", section: "1",       appointment: "SectComd", status: "Active" }, // P1SC1
  { id: "0004", role: "Commander", platoon: "PLT1", section: "2",       appointment: "SectComd", status: "Active" }, // P1SC2
  { id: "0005", role: "Commander", platoon: "PLT2", section: "1",       appointment: "SectComd", status: "Active" }, // P2SC1
  { id: "0006", role: "Commander", platoon: "HQ",   section: "",        appointment: "",         status: "Active" }, // HQ (OC/CSM)
  { id: "0007", role: "Commander", platoon: "PLT1", section: "3",       appointment: "SectComd", status: "Departed" },
  { id: "1411", role: "Recruit",   platoon: "PLT1", section: "1",       appointment: "SectComd", status: "Active" }
];

module.exports = async function run() {
  const e = loadEligibility();

  suite("duty-eligibility: pool");

  await test("an unrestricted company-scoped type draws every active commander and no recruits", () => {
    const got = e.dutyEligible("ANY", "", "2026-08-03", ROSTER, CFG, {});
    eq(got.join(","), "0001,0002,0003,0004,0005,0006");
  });

  await test("departed personnel are excluded", () => {
    const got = e.dutyEligible("ANY", "", "2026-08-03", ROSTER, CFG, {});
    eq(got.indexOf("0007"), -1);
  });

  await test("dutyExtraEligible adds people outside the commander rule", () => {
    const cfg = { dutyTypes: CFG.dutyTypes, dutyExtraEligible: ["1411"] };
    const got = e.dutyEligible("ANY", "", "2026-08-03", ROSTER, cfg, {});
    eq(got.indexOf("1411") >= 0, true);
  });

  suite("duty-eligibility: appointment rule (§5)");

  await test("CDO draws PCs only", () => {
    eq(e.dutyEligible("CDO", "", "2026-08-03", ROSTER, CFG, {}).join(","), "0001");
  });

  await test("CDS draws PSs only", () => {
    eq(e.dutyEligible("CDS", "", "2026-08-03", ROSTER, CFG, {}).join(","), "0002");
  });

  await test("COS draws section commanders company-wide, across every platoon", () => {
    eq(e.dutyEligible("COS", "", "2026-08-03", ROSTER, CFG, {}).join(","), "0003,0004,0005");
  });

  await test("an HQ section commander is offered for COS but never for a PDS", () => {
    // The user's rule: COS asks what appointment you hold, not which platoon you
    // hold it in. An HQ WOSPEC carrying a section-commander appointment therefore
    // stands COS, while the platoon scope keeps them out of every PDS column.
    const roster = ROSTER.concat([
      { id: "0008", role: "Commander", platoon: "HQ", section: "", appointment: "SectComd",
        rankGroup: "WOSPEC", status: "Active" }
    ]);
    eq(e.dutyEligible("COS", "", "2026-08-03", roster, CFG, {}).join(","), "0003,0004,0005,0008");
    eq(e.dutyEligible("PDS", "PLT1", "2026-08-03", roster, CFG, {}).indexOf("0008"), -1);
    eq(e.dutyEligible("PDS", "HQ", "2026-08-03", roster, CFG, {}).length, 0);
  });

  await test("plain HQ commanders (OC/CSM, no appointment) draw no duty at all", () => {
    ["CDO", "CDS", "COS"].forEach(t => {
      eq(e.dutyEligible(t, "", "2026-08-03", ROSTER, CFG, {}).indexOf("0006"), -1);
    });
  });

  await test("dutyExtraEligible bypasses the appointment rule", () => {
    // Otherwise the Config escape hatch would grant nothing: an opt-in from
    // outside the org model has no appointment to match on.
    const cfg = { dutyTypes: CFG.dutyTypes, dutyExtraEligible: ["9999"] };
    const roster = ROSTER.concat([{ id: "9999", role: "Recruit", platoon: "PLT1", section: "", status: "Active" }]);
    eq(e.dutyEligible("CDO", "", "2026-08-03", roster, cfg, {}).join(","), "0001,9999");
  });

  await test("appointment spellings a human would actually type are accepted", () => {
    eq(e.dutyCanonAppointment("PC"), "PC");
    eq(e.dutyCanonAppointment(" platoon commander "), "PC");
    eq(e.dutyCanonAppointment("Platoon Sergeant"), "PS");
    eq(e.dutyCanonAppointment("Sect Comd"), "SectComd");
    eq(e.dutyCanonAppointment("section commander"), "SectComd");
    eq(e.dutyCanonAppointment("SC"), "SectComd");
    eq(e.dutyCanonAppointment("quartermaster"), "");
    eq(e.dutyCanonAppointment(""), "");
    eq(e.dutyCanonAppointment(null), "");
  });

  suite("duty-eligibility: appointment fallback for an un-backfilled column");

  await test("a numbered section resolves to SectComd without the column", () => {
    eq(e.dutyAppointmentOf({ section: "2" }), "SectComd");
    const bare = ROSTER.map(r => { const c = { ...r }; delete c.appointment; return c; });
    eq(e.dutyEligible("COS", "", "2026-08-03", bare, CFG, {}).join(","), "0003,0004,0005");
    eq(e.dutyEligible("PDS", "PLT1", "2026-08-03", bare, CFG, {}).join(","), "0003,0004");
  });

  await test("'Command' falls back to rankGroup — Officer is the PC, WOSPEC the PS", () => {
    eq(e.dutyAppointmentOf({ section: "Command", rankGroup: "Officer" }), "PC");
    eq(e.dutyAppointmentOf({ section: "Command", rankGroup: "WOSPEC" }), "PS");
  });

  await test("'Command' with no rankGroup resolves to nothing rather than guessing", () => {
    // An empty CDO dropdown is visible and gets fixed; silently listing the PS
    // for the PC's duty is the failure nobody catches.
    eq(e.dutyAppointmentOf({ section: "Command" }), "");
    eq(e.dutyAppointmentOf({}), "");
    eq(e.dutyAppointmentOf(null), "");
  });

  await test("the explicit column always beats the fallback", () => {
    eq(e.dutyAppointmentOf({ section: "Command", rankGroup: "Officer", appointment: "PS" }), "PS");
    eq(e.dutyAppointmentOf({ section: "3", appointment: "PC" }), "PC");
  });

  suite("duty-eligibility: PDS platoon rule");

  await test("PDS is limited to that platoon's section commanders", () => {
    const got = e.dutyEligible("PDS", "PLT1", "2026-08-03", ROSTER, CFG, {});
    eq(got.join(","), "0003,0004"); // PC1 and PS1 excluded, PLT2 excluded
  });

  await test("PC and PS are excluded from PDS by appointment", () => {
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
      return r.id === "0003"
        ? { id: "0003", role: "Commander", platoon: "PLT2", section: "1", appointment: "SectComd", status: "Active" }
        : r;
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

  suite("duty-eligibility: platoon colour ramps");

  const CCFG = {
    dutyTypes: CFG.dutyTypes,
    dutyPlatoonColours: {
      PLT1: ["#900b0a", "#ab201d", "#c6312f", "#e24240", "#ff5252"],
      PLT2: ["#168039", "#469c47", "#6eb855", "#95d563", "#bdf271"]
    }
  };

  await test("index 0 is the Command element — PC and PS share it", () => {
    eq(e.dutyColourIndexForSection("Command"), 0);
    eq(e.dutyColourFor("PLT1", "Command", CCFG), "#900b0a");
  });

  await test("sections 1..n map to indexes 1..n in order", () => {
    eq(e.dutyColourFor("PLT1", "1", CCFG), "#ab201d");
    eq(e.dutyColourFor("PLT1", "2", CCFG), "#c6312f");
    eq(e.dutyColourFor("PLT1", "3", CCFG), "#e24240");
    eq(e.dutyColourFor("PLT1", "4", CCFG), "#ff5252");
  });

  await test("each platoon uses its own ramp", () => {
    eq(e.dutyColourFor("PLT2", "Command", CCFG), "#168039");
    eq(e.dutyColourFor("PLT2", "4", CCFG), "#bdf271");
  });

  await test("a section beyond the ramp clamps to the last colour, never wraps", () => {
    // Wrapping would hand section 5 the Command colour, which reads as a lie
    // about the org chart. Clamping just says "one more of this platoon's shade".
    eq(e.dutyColourFor("PLT1", "5", CCFG), "#ff5252");
    eq(e.dutyColourFor("PLT1", "9", CCFG), "#ff5252");
  });

  await test("a platoon with no ramp gets no colour rather than a wrong one", () => {
    eq(e.dutyColourFor("PLT9", "1", CCFG), "");
    eq(e.dutyColourFor("HQ", "", CCFG), "");
    eq(e.dutyColourFor("", "", CCFG), "");
    eq(e.dutyColourFor("PLT1", "1", {}), "");
  });

  await test("contrast text flips with the background's luminance", () => {
    // The ramps span very dark (#900b0a) to very light (#fff176), so a fixed
    // foreground would be unreadable at one end or the other.
    eq(e.dutyContrastText("#900b0a"), "#ffffff");
    eq(e.dutyContrastText("#1510F0"), "#ffffff");
    eq(e.dutyContrastText("#fff176"), "#000000");
    eq(e.dutyContrastText("#bdf271"), "#000000");
    eq(e.dutyContrastText(""), "");
  });

  await test("missing or empty inputs degrade quietly", () => {
    eq(e.dutyEligible("COS", "", "2026-08-03", [], CFG, {}).length, 0);
    eq(e.dutyEligible("COS", "", "2026-08-03", null, CFG, {}).length, 0);
    eq(e.dutyPlatoonsFor("PDS", null, CFG).length, 0);
  });
};
