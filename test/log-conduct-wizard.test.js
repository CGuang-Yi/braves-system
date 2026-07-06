// Log Conduct wizard — rebuildLogConductStatus tick-seeding tests.
//
// forms.js is a browser-global script (no module.exports) with lots of eager
// top-level function declarations. We load it into a vm context whose global is
// a Proxy with `has: () => true`, so any unresolved free identifier reads as
// `undefined` instead of throwing (same trick as ha.test.js). The collaborators
// rebuildLogConductStatus calls (currentMedicalEffectiveAll / isCommander /
// statusParticipates) live in OTHER bundles, so they're free identifiers we can
// stub straight onto the context global. But `_logConduct` is declared with
// `let` INSIDE forms.js — a script-lexical binding, NOT a property of the global
// object — so it must be assigned in-context (a global-object write is ignored).
// For the same reason we invoke rebuildLogConductStatus in-context.
//
// Regression under test: a recruit who is CSV-imported as PRESENT but has a
// restrictive medical status active that day (e.g. LD) must default to
// not-participating (ticked) the FIRST time the conduct is opened in the wizard.
// Once the conduct has been reviewed+saved (its attendance row carries
// statusReviewed), an absent Status row is honored as "participated despite
// status" (unticked) and never silently re-ticked.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

// Build a fresh vm context with forms.js loaded and the wizard collaborators
// stubbed. currentMedicalEffectiveAll always surfaces 2415 on LD (a restrictive,
// non-participating status).
function loadCtx() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8"), ctx, { filename: "forms.js" });
  target.isCommander = () => false;
  target.statusParticipates = () => false;   // LD/MC/Excuse are restrictive ⇒ defaultNP true
  target.currentMedicalEffectiveAll = () => [
    { d4: "2415", statuses: [{ tag: "LD", record: { reason: "SORE THROAT" } }] }
  ];
  return { target, ctx };
}

// Run rebuildLogConductStatus for one scenario and return 2415's tick.
function tickFor(opts) {
  const { target, ctx } = loadCtx();
  target.STATE = {
    attendance: [{ id: "A1", date: "26 May 2026", time: "", conductId: "c1", statusReviewed: opts.statusReviewed }],
    conductDetail: opts.hasStatusRow
      ? [{ id: "d1", date: "26 May 2026", time: "", conductId: "c1", d4: "2415", type: "Status", reason: "LD" }]
      : []
  };
  ctx._lc = opts.newConduct
    ? { date: "2026-05-26", status: [] }                       // brand-new conduct: no attendanceId
    : { attendanceId: "A1", date: "2026-05-26", status: [] };  // editing an existing one
  vm.runInContext("_logConduct = _lc; rebuildLogConductStatus();", ctx);
  const status = JSON.parse(vm.runInContext("JSON.stringify(_logConduct.status)", ctx));
  const row = status.find(s => s.d4 === "2415");
  return row ? row.notParticipating : "(absent)";
}

// ─── Group resolution (resolveConductGroup / groupLabel) ───────────────────
//
// A fresh vm context with a small roster: commander 0001 (platoon PLT1 on the
// roster row, per the plan's "commander whose row carries a platoon" case),
// two PLT1 recruits, one PLT2 recruit, one HQ recruit. isCommander/personPlatoon
// are the REAL helpers.js logic (re-implemented inline — helpers.js isn't loaded
// into this sandbox) so the semantics under test match production.
function loadGroupCtx() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8"), ctx, { filename: "forms.js" });
  target.isCommander = d4 => target.STATE.roster.find(r => r.id === d4)?.role === "Commander";
  target.personPlatoon = r => r.platoon || "";
  target.activePlatoons = () => [
    { code: "PLT1", displayName: "Platoon 1" },
    { code: "PLT2", displayName: "Platoon 2" },
    { code: "HQ", displayName: "HQ" }
  ];
  target.STATE = {
    roster: [
      { id: "0001", role: "Commander", platoon: "PLT1" },
      { id: "1001", role: "Recruit", platoon: "PLT1" },
      { id: "1002", role: "Recruit", platoon: "PLT1" },
      { id: "2001", role: "Recruit", platoon: "PLT2" },
      { id: "3001", role: "Recruit", platoon: "HQ" }
    ]
  };
  return { target, ctx };
}
function resolveGroup(value) {
  const { ctx } = loadGroupCtx();
  vm.runInContext(`_rg = resolveConductGroup(${JSON.stringify(value)});`, ctx);
  return JSON.parse(vm.runInContext("JSON.stringify(_rg)", ctx));
}
function groupLabelFor(value) {
  const { ctx } = loadGroupCtx();
  return vm.runInContext(`groupLabel(${JSON.stringify(value)})`, ctx);
}

module.exports = async function run() {
  suite("Log Conduct wizard: rebuildLogConductStatus tick seeding");

  await test("first open of a CSV conduct (not reviewed) default-ticks a recruit on LD", () => {
    eq(tickFor({ statusReviewed: undefined, hasStatusRow: false }), true,
      "unreviewed CSV conduct ⇒ LD defaults to not-participating (ticked)");
  });

  await test("reviewed conduct with NO Status row stays participating (no silent re-tick)", () => {
    eq(tickFor({ statusReviewed: true, hasStatusRow: false }), false,
      "already reviewed + no Status row ⇒ 'participated despite status' is honored");
  });

  await test("reviewed conduct WITH a Status row stays ticked", () => {
    eq(tickFor({ statusReviewed: true, hasStatusRow: true }), true,
      "recorded Status row ⇒ ticked");
  });

  await test("brand-new conduct (no attendanceId) default-ticks from medical status", () => {
    eq(tickFor({ newConduct: true }), true, "new conduct ⇒ defaultNP unchanged");
  });

  suite("Log Conduct wizard: resolveConductGroup / groupLabel");

  await test("company includes the commander 0001", () => {
    const ids = resolveGroup("company");
    ok(ids.includes("0001"), "company group must include commanders");
    eq(ids.length, 5, "company = entire roster");
  });

  await test("noncommanders excludes 0001", () => {
    const ids = resolveGroup("noncommanders");
    ok(!ids.includes("0001"), "noncommanders must exclude the commander");
    eq(ids.length, 4, "all 4 recruits");
  });

  await test("commanders resolves to only 00xx ids", () => {
    eq(resolveGroup("commanders"), ["0001"], "commanders-only group");
  });

  await test("platoon:PLT1 uses the explicit roster column and excludes the commander", () => {
    const ids = resolveGroup("platoon:PLT1");
    ok(!ids.includes("0001"), "commander's PLT1 roster row must not leak into platoon:PLT1");
    eq(ids.sort(), ["1001", "1002"], "only the two PLT1 recruits");
  });

  await test("groupLabel resolves platoon display names and the three specials", () => {
    eq(groupLabelFor("platoon:PLT2"), "Platoon 2");
    eq(groupLabelFor("company"), "Entire company");
    eq(groupLabelFor("noncommanders"), "Non-Commanders");
    eq(groupLabelFor("commanders"), "Commanders only");
  });

  suite("Log Conduct wizard: computeLogConductTotals (participant-based)");

  // Same 5-person roster as the group-resolution suite (1 commander, 4 recruits).
  function totalsFor(wizFields) {
    const { target, ctx } = loadGroupCtx();
    // _logConduct is a script-lexical `let` inside forms.js, not a global
    // property — assign it in-context (see file header comment).
    ctx._lc = {
      status: [], rsi: [], fallout: [], reportSick: [],
      totalOverride: null, participants: [], addedGroups: [],
      ...wizFields
    };
    vm.runInContext("_logConduct = _lc;", ctx);
    return JSON.parse(vm.runInContext("JSON.stringify(computeLogConductTotals())", ctx));
  }

  await test("participants drive the default total", () => {
    eq(totalsFor({ participants: ["1001", "1002", "2001"] }).total, 3,
      "3 participants ⇒ total 3");
  });

  await test("totalOverride still wins over participants", () => {
    eq(totalsFor({ participants: ["1001", "1002", "2001"], totalOverride: 10 }).total, 10,
      "explicit override beats participant count");
  });

  await test("legacy fallback: no participants and no addedGroups ⇒ non-commander roster count", () => {
    eq(totalsFor({ participants: [], addedGroups: [] }).total, 4,
      "4 non-commander recruits in the fixture roster");
  });

  await test("addedGroups present but participants empty (e.g. a group resolving to nobody) skips the legacy fallback", () => {
    eq(totalsFor({ participants: [], addedGroups: [{ label: "Platoon 1", value: "platoon:PLT1" }] }).total, 0,
      "a real (if empty) group selection means 0 is the true count, not a legacy roster fallback");
  });
};
