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
const { suite, test, eq } = require("./_tap");

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
};
