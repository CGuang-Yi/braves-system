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
  // rebuildLogConductStatus now filters the checklist to _logConduct.participants
  // (Task 3) — 2415 must be a participant for these seeding-behavior tests to
  // still exercise the tick logic under test, not just an empty-checklist no-op.
  ctx._lc = opts.newConduct
    ? { date: "2026-05-26", status: [], participants: ["2415"], importedBaseline: ["2415"] }                       // brand-new conduct: no attendanceId
    : { attendanceId: "A1", date: "2026-05-26", status: [], participants: ["2415"], importedBaseline: ["2415"] };  // editing an existing one
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
  target.displayId = d4 => d4;
  target.getName = d4 => "Name" + d4;
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
// Drive the real wizRecomputeParticipants union: seed importedBaseline (CSV
// snapshot) + addedGroups, run the recompute, read back the NET participant set.
function recomputeParticipants({ importedBaseline = [], addedGroups = [] }) {
  const { ctx } = loadGroupCtx();
  ctx._lc = { importedBaseline, addedGroups, participants: [] };
  vm.runInContext("_logConduct = _lc; wizRecomputeParticipants();", ctx);
  return JSON.parse(vm.runInContext("JSON.stringify(_logConduct.participants)", ctx)).sort();
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

  await test("individual:<d4> resolves to just that recruit (and only when on roster)", () => {
    eq(resolveGroup("individual:2001"), ["2001"], "one specific recruit");
    eq(resolveGroup("individual:9999"), [], "unknown 4D resolves to nobody");
  });

  await test("groupLabel labels an individual with its id + name", () => {
    eq(groupLabelFor("individual:1001"), "1001 Name1001");
  });

  await test("wizRecomputeParticipants unions baseline + overlapping groups without double-counting", () => {
    // CSV baseline of 3001, then user adds individual:1001 AND platoon:PLT1
    // (which already contains 1001). The union must keep 1001 exactly once and
    // preserve the imported baseline — the guarantee wizPickIndividual documents.
    eq(recomputeParticipants({
      importedBaseline: ["3001"],
      addedGroups: [{ value: "individual:1001" }, { value: "platoon:PLT1" }]
    }), ["1001", "1002", "3001"], "overlap deduped, baseline preserved");
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

  suite("Log Conduct wizard: rebuildLogConductStatus filtered to participants");

  // currentMedicalEffectiveAll surfaces two on-status people: recruit 2415 (LD)
  // and commander 0001 (Excuse Heavy Load) — statusParticipates(false) for both
  // so the OLD code's blanket !isCommander(d4) filter would have dropped 0001
  // regardless of participants; the new filter is the only thing gating it.
  function loadStatusFilterCtx() {
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, Symbol
    };
    const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8"), ctx, { filename: "forms.js" });
    target.isCommander = d4 => d4 === "0001";
    target.statusParticipates = () => false;
    target.currentMedicalEffectiveAll = () => [
      { d4: "2415", statuses: [{ tag: "LD", record: { reason: "SORE THROAT" } }] },
      { d4: "0001", statuses: [{ tag: "Excuse Heavy Load", record: { reason: "" } }] }
    ];
    target.STATE = { attendance: [], conductDetail: [] };
    return { target, ctx };
  }
  function statusD4sFor(participants) {
    const { ctx } = loadStatusFilterCtx();
    ctx._lc = { date: "2026-05-26", status: [], participants };
    vm.runInContext("_logConduct = _lc; rebuildLogConductStatus();", ctx);
    const status = JSON.parse(vm.runInContext("JSON.stringify(_logConduct.status)", ctx));
    return status.map(s => s.d4).sort();
  }

  await test("non-participants are excluded from the checklist", () => {
    eq(statusD4sFor(["2415"]), ["2415"], "0001 not in participants ⇒ absent from checklist");
  });

  await test("a commander included in participants appears on the checklist", () => {
    eq(statusD4sFor(["2415", "0001"]), ["0001", "2415"],
      "commander is no longer blanket-excluded — only the participant filter governs");
  });

  await test("empty participants ⇒ empty checklist", () => {
    eq(statusD4sFor([]), [], "no participants ⇒ nothing to show");
  });

  suite("Log Conduct wizard: _logConduct state fields + edit seeding");

  // openLogConductWizard needs isCommander/personPlatoon/activePlatoons (for
  // resolveConductGroup/groupLabel, unused directly here but loaded alongside)
  // plus rebuildLogConductStatus's own collaborators. currentMedicalEffectiveAll
  // returns nothing so the checklist itself isn't under test here.
  function loadOpenCtx() {
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, Symbol
    };
    const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8"), ctx, { filename: "forms.js" });
    target.isCommander = () => false;
    target.statusParticipates = () => true;
    target.currentMedicalEffectiveAll = () => [];
    target.displayDateToISO = iso => iso; // dates already stored as "2026-05-26" in this fixture
    target.todayISO = () => "2026-05-26";
    target.renderLogConductWizard = () => {}; // no-op — DOM rendering isn't under test here
    // Real calc.js parser (single canonical definition — see js/calc.js).
    target.parseParticipantIds = participants =>
      String(participants == null ? "" : participants).split(",").map(s => s.trim()).filter(Boolean);
    return { target, ctx };
  }

  await test("edit-seeding: gross reconstruction from NET participants + non-RSI ConductDetail d4s, plus haCounts/haPeriods from currencyTags/periods", () => {
    const { target, ctx } = loadOpenCtx();
    target.STATE = {
      roster: [],
      attendance: [{ id: "A1", date: "2026-05-26", time: "", conductId: "c1", total: 2, remarks: "",
        participants: "1234", currencyTags: "HA RM", periods: 2 }],
      conductDetail: [
        { id: "d1", date: "2026-05-26", time: "", conductId: "c1", d4: "1235", type: "Fallout", reason: "" },
        { id: "d2", date: "2026-05-26", time: "", conductId: "c1", d4: "9999", type: "RSI", reason: "" }
      ],
      medical: []
    };
    vm.runInContext("openLogConductWizard('A1');", ctx);
    const w = JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", ctx));
    eq(w.participants.sort(), ["1234", "1235"], "NET participant 1234 + Fallout detail 1235, RSI 9999 excluded");
    eq(w.importedBaseline.sort(), ["1234", "1235"], "importedBaseline mirrors the gross seed");
    eq(w.haCounts, true, "currencyTags 'HA RM' matches /\\bha\\b/i");
    eq(w.haPeriods, 2, "periods column carried over");
    eq(w.addedGroups, [], "addedGroups stays empty on edit — can't reverse-engineer groups from a snapshot");
  });

  await test("edit-seeding: haCounts false when currencyTags has no HA token; haPeriods defaults to 1", () => {
    const { target, ctx } = loadOpenCtx();
    target.STATE = {
      roster: [],
      attendance: [{ id: "A1", date: "2026-05-26", time: "", conductId: "c1", total: 1, remarks: "",
        participants: "1234", currencyTags: "RM", periods: "" }],
      conductDetail: [], medical: []
    };
    vm.runInContext("openLogConductWizard('A1');", ctx);
    const w = JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", ctx));
    eq(w.haCounts, false, "'RM' has no HA token");
    eq(w.haPeriods, 1, "blank periods ⇒ default 1");
  });

  await test("new-conduct seeding: empty participants/addedGroups/importedBaseline, haCounts false, haPeriods 1", () => {
    const { target, ctx } = loadOpenCtx();
    target.STATE = { roster: [], attendance: [], conductDetail: [], medical: [] };
    vm.runInContext("openLogConductWizard();", ctx);
    const w = JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", ctx));
    eq(w.participants, []);
    eq(w.addedGroups, []);
    eq(w.importedBaseline, []);
    eq(w.haCounts, false);
    eq(w.haPeriods, 1);
  });

  suite("Log Conduct wizard: wizAddGroup / wizRemoveGroup / wizToggleHA / wizSetHAPeriods");

  function loadHandlerCtx() {
    const { target, ctx } = loadGroupCtx(); // 5-person roster fixture from the group-resolution suite
    target.renderLogConductWizard = () => {}; // handlers call this; no-op for unit tests
    // wizAddGroup/wizRemoveGroup also call rebuildLogConductStatus (checklist
    // must stay in sync with the participant set) — give it harmless defaults;
    // tests that care about the checklist itself override these.
    target.STATE.medical = [];
    target.currentMedicalEffectiveAll = () => [];
    target.statusParticipates = () => true;
    return { target, ctx };
  }

  await test("wizAddGroup unions the group's resolved ids into participants and records the chip", () => {
    const { ctx } = loadHandlerCtx();
    ctx._lc = { participants: [], addedGroups: [], importedBaseline: [] };
    vm.runInContext("_logConduct = _lc; wizAddGroup('platoon:PLT1', 'Platoon 1');", ctx);
    const w = JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", ctx));
    eq(w.participants.sort(), ["1001", "1002"]);
    eq(w.addedGroups, [{ label: "Platoon 1", value: "platoon:PLT1" }]);
  });

  await test("wizAddGroup recomputes from importedBaseline + ALL addedGroups (never subtracts, groups overlap)", () => {
    const { ctx } = loadHandlerCtx();
    ctx._lc = { participants: ["9001"], addedGroups: [], importedBaseline: ["9001"] };
    vm.runInContext("_logConduct = _lc;", ctx);
    vm.runInContext("wizAddGroup('platoon:PLT1', 'Platoon 1');", ctx);
    vm.runInContext("wizAddGroup('commanders', 'Commanders only');", ctx);
    const w = JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", ctx));
    eq(w.participants.sort(), ["0001", "1001", "1002", "9001"], "baseline + both groups union");
    eq(w.addedGroups.length, 2);
  });

  await test("wizAddGroup ignores re-adding an already-added group (no duplicate chip)", () => {
    const { ctx } = loadHandlerCtx();
    ctx._lc = { participants: [], addedGroups: [], importedBaseline: [] };
    vm.runInContext("_logConduct = _lc;", ctx);
    vm.runInContext("wizAddGroup('platoon:PLT1', 'Platoon 1');", ctx);
    vm.runInContext("wizAddGroup('platoon:PLT1', 'Platoon 1');", ctx);
    const w = JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", ctx));
    eq(w.addedGroups.length, 1, "second add of the same value is a no-op, not a duplicate chip");
    eq(w.participants.sort(), ["1001", "1002"], "participants unchanged");
  });

  await test("wizRemoveGroup drops the chip and recomputes without it", () => {
    const { ctx } = loadHandlerCtx();
    ctx._lc = { participants: [], addedGroups: [], importedBaseline: [] };
    vm.runInContext("_logConduct = _lc;", ctx);
    vm.runInContext("wizAddGroup('platoon:PLT1', 'Platoon 1');", ctx);
    vm.runInContext("wizAddGroup('platoon:PLT2', 'Platoon 2');", ctx);
    vm.runInContext("wizRemoveGroup('platoon:PLT1');", ctx);
    const w = JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", ctx));
    eq(w.participants.sort(), ["2001"], "PLT1 members dropped, PLT2 remains");
    eq(w.addedGroups, [{ label: "Platoon 2", value: "platoon:PLT2" }]);
  });

  await test("wizToggleHA sets haCounts", () => {
    const { ctx } = loadHandlerCtx();
    ctx._lc = { participants: [], addedGroups: [], importedBaseline: [], haCounts: false, haPeriods: 1 };
    vm.runInContext("_logConduct = _lc; wizToggleHA(true);", ctx);
    eq(vm.runInContext("_logConduct.haCounts", ctx), true);
  });

  // Regression: wizAddGroup/wizRemoveGroup must rebuild the status checklist,
  // not just recompute participants — otherwise a newly added group's
  // on-status recruits never appear until an unrelated rebuild (e.g. a date
  // change) happens to run. currentMedicalEffectiveAll here is a faithful
  // mini-implementation of the real helpers.js function (active-LD-only,
  // reading real STATE.medical DISPLAY-format dates via the real
  // displayDateToISO) rather than a canned fixture, so the test actually
  // exercises "seed a medical LD, add the group, see it show up."
  await test("wizAddGroup rebuilds the status checklist; wizRemoveGroup clears it back out", () => {
    const { target, ctx } = loadHandlerCtx();
    // Real displayDateToISO (js/helpers.js) — needed because STATE.medical
    // stores DISPLAY-format dates ("1 Jul 2026"), not ISO.
    target.displayDateToISO = s => {
      if (!s) return "";
      const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
      const m = String(s).match(/^(\d{1,2})\s+(\w{3})(?:\s+(\d{4}))?/);
      if (!m) return "";
      const mon = months[m[2]];
      if (!mon) return "";
      const day = m[1].padStart(2, "0");
      const year = m[3] || String(new Date().getFullYear());
      return `${year}-${mon}-${day}`;
    };
    target.statusParticipates = () => false; // LD is restrictive ⇒ defaultNP true
    // 1001 (PLT1 recruit, from the 5-person loadGroupCtx fixture) has an
    // active LD spanning the wizard's date.
    target.STATE.medical = [
      { d4: "1001", status: "LD", startDate: "1 Jul 2026", endDate: "5 Jul 2026" }
    ];
    target.currentMedicalEffectiveAll = todayIso => {
      const active = target.STATE.medical.filter(m => {
        const start = target.displayDateToISO(m.startDate);
        const end = target.displayDateToISO(m.endDate);
        return start && end && todayIso >= start && todayIso <= end;
      });
      return active.map(m => ({ d4: m.d4, statuses: [{ tag: m.status, record: m }] }));
    };
    ctx._lc = { date: "2026-07-02", status: [], participants: [], addedGroups: [], importedBaseline: [] };
    vm.runInContext("_logConduct = _lc;", ctx);

    vm.runInContext("wizAddGroup('platoon:PLT1', 'Platoon 1');", ctx);
    let status = JSON.parse(vm.runInContext("JSON.stringify(_logConduct.status)", ctx));
    ok(status.some(s => s.d4 === "1001"), "adding PLT1 must rebuild the checklist to include 1001's active LD");

    vm.runInContext("wizRemoveGroup('platoon:PLT1');", ctx);
    status = JSON.parse(vm.runInContext("JSON.stringify(_logConduct.status)", ctx));
    ok(!status.some(s => s.d4 === "1001"), "removing PLT1 must rebuild the checklist back out (1001 no longer a participant)");
  });

  await test("wizSetHAPeriods sets haPeriods, defaulting non-numeric input to 1", () => {
    const { ctx } = loadHandlerCtx();
    ctx._lc = { participants: [], addedGroups: [], importedBaseline: [], haCounts: true, haPeriods: 1 };
    vm.runInContext("_logConduct = _lc; wizSetHAPeriods('2');", ctx);
    eq(vm.runInContext("_logConduct.haPeriods", ctx), 2);
    vm.runInContext("wizSetHAPeriods('bogus');", ctx);
    eq(vm.runInContext("_logConduct.haPeriods", ctx), 1);
  });

  // ─── Save-path entry shaping (saveLogConductWizard) ───────────────────────
  //
  // Runs the REAL saveLogConductWizard end-to-end and inspects the resulting
  // STATE.attendance row. DOM-touching collaborators (openModal/closeModal/
  // render/document) and network (autoSync) are no-op stubs; nextId is a
  // counter so ids are deterministic. mergeAttendanceEdit and toggleHATag are
  // the REAL implementations (loaded from state.js/helpers.js source) since
  // the merge-safety invariant is exactly what's under test here.
  function loadSaveCtx() {
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, Symbol
    };
    const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8"), ctx, { filename: "forms.js" });
    let idCounter = 0;
    target.nextId = () => `id${++idCounter}`;
    target.isoToDisplayDate = iso => iso;
    target.pad4Time = t => t || "";
    target.closeModal = () => {};
    target.render = () => {};
    target.alert = () => {};
    target.document = { getElementById: () => null, querySelector: () => null };
    target.copyConductChatFormat = async () => {};
    target.autoSync = () => {};
    target.saveLocal = () => {};
    target.conductJoinKey = () => "";      // used by recomputeAttendanceLmsFromPolar
    target.dateJoinKey = () => "";
    target.padD4 = d4 => d4;
    target.navigator = { clipboard: null };
    // Real collaborators — loaded from source so behavior can't drift from
    // the shipped merge/HA-tag logic.
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8")
        .match(/function toggleHATag[\s\S]*?\n}\n/)[0],
      ctx
    );
    target.mergeAttendanceEdit = (existing, entry) => existing ? { ...existing, ...entry } : entry;
    return { target, ctx };
  }

  // Drives one save and returns the resulting STATE.attendance row (post-save).
  async function saveFor({ existingAttendance, conductDetail, wiz }) {
    const { target, ctx } = loadSaveCtx();
    target.STATE = {
      roster: [], attendance: existingAttendance ? [existingAttendance] : [],
      conductDetail: conductDetail || [], medical: [], polar: [], apiUrl: ""
    };
    ctx._lc = {
      conductId: "c1", date: "2026-05-26", time: "0730", totalOverride: null, remarks: "",
      status: [], rsi: [], fallout: [], reportSick: [],
      participants: [], addedGroups: [], importedBaseline: [], haCounts: false, haPeriods: 1,
      originalDetailIds: [],
      attendanceId: existingAttendance ? existingAttendance.id : null,
      ...wiz
    };
    vm.runInContext("_logConduct = _lc;", ctx);
    await vm.runInContext("saveLogConductWizard()", ctx);
    const attendance = JSON.parse(vm.runInContext("JSON.stringify(STATE.attendance)", ctx));
    return attendance[0];
  }

  suite("Log Conduct wizard: saveLogConductWizard entry shaping");

  await test("edit CSV row, untouched tick (HA stays ticked): source unchanged, tags identical, periods absent from the pushed entry (but present via merge)", async () => {
    const row = await saveFor({
      existingAttendance: { id: "A1", date: "2026-05-26", time: "0730", conductId: "c1", total: 2,
        participants: "1234,1235", currencyTags: "HA", periods: 2, source: "csv" },
      wiz: { participants: ["1234", "1235"], importedBaseline: ["1234", "1235"], haCounts: true, haPeriods: 2 }
    });
    eq(row.source, "csv", "source must never flip csv → wizard");
    eq(row.currencyTags, "HA", "tick state unchanged ⇒ identical tags string");
    eq(row.periods, 2, "CSV B5 periods metadata survives (via merge, since entry omits the key when unticked-state unchanged... here ticked+unchanged still writes periods per the plan's 'periods only if ticked' rule)");
  });

  await test("edit CSV row, untick HA: only the HA token is stripped, sibling tokens survive, periods preserved via merge", async () => {
    const row = await saveFor({
      existingAttendance: { id: "A1", date: "2026-05-26", time: "0730", conductId: "c1", total: 2,
        participants: "1234,1235", currencyTags: "HA, RM", periods: 2, source: "csv" },
      wiz: { participants: ["1234", "1235"], importedBaseline: ["1234", "1235"], haCounts: false, haPeriods: 2 }
    });
    eq(row.source, "csv", "source untouched");
    eq(row.currencyTags, "RM", "HA token stripped, RM survives");
    eq(row.periods, 2, "unticked entry omits periods key ⇒ merge preserves the CSV's stored periods");
  });

  await test("edit legacy '' row, tick HA: source upgraded to wizard, tags become HA, periods written", async () => {
    const row = await saveFor({
      existingAttendance: { id: "A1", date: "2026-05-26", time: "0730", conductId: "c1", total: 1,
        participants: "1234", currencyTags: "", periods: "", source: "" },
      wiz: { participants: ["1234"], importedBaseline: ["1234"], haCounts: true, haPeriods: 1 }
    });
    eq(row.source, "wizard", "legacy '' upgraded to wizard");
    eq(row.currencyTags, "HA", "ticked ⇒ HA token added");
    eq(row.periods, 1, "ticked ⇒ periods written");
  });

  await test("new conduct, unticked: source wizard, tags empty string, no periods key on the pushed entry", async () => {
    const row = await saveFor({
      existingAttendance: null,
      wiz: { participants: ["1234"], importedBaseline: ["1234"], haCounts: false, haPeriods: 1 }
    });
    eq(row.source, "wizard");
    eq(row.currencyTags, "", "no existing tags, unticked ⇒ empty string");
    ok(!("periods" in row) || row.periods === "" || row.periods == null,
      "brand-new row: periods key omitted from attendanceEntry ⇒ normalizeAttendance would default it, but here nothing overwrites it into a truthy value");
  });

  await test("NET participants: gross 3, fallout+NP 2 excluded ⇒ stored participants is the remaining 1", async () => {
    const row = await saveFor({
      existingAttendance: null,
      wiz: {
        participants: ["1234", "1235", "1236"], importedBaseline: ["1234", "1235", "1236"],
        status: [{ d4: "1235", statusTag: "LD", reason: "", notParticipating: true }],
        fallout: [{ d4: "1236", reason: "twisted ankle" }]
      }
    });
    eq(row.participants, "1234", "1235 (status NP) and 1236 (fallout) excluded from stored participants");
  });

  await test("Report Sick exclusion also nets out of stored participants", async () => {
    const row = await saveFor({
      existingAttendance: null,
      wiz: {
        participants: ["1234", "1235"], importedBaseline: ["1234", "1235"],
        reportSick: [{ d4: "1235", reason: "fever" }]
      }
    });
    eq(row.participants, "1234", "reportSick recruit excluded from NET participants");
  });

  await test("new conduct with zero participants is blocked with an alert (guard)", async () => {
    let alerted = "";
    const { target, ctx } = loadSaveCtx();
    target.alert = msg => { alerted = msg; };
    target.STATE = { roster: [], attendance: [], conductDetail: [], medical: [], polar: [], apiUrl: "" };
    ctx._lc = {
      conductId: "c1", date: "2026-05-26", time: "0730", totalOverride: null, remarks: "",
      status: [], rsi: [], fallout: [], reportSick: [],
      participants: [], addedGroups: [], importedBaseline: [], haCounts: false, haPeriods: 1,
      originalDetailIds: [], attendanceId: null
    };
    vm.runInContext("_logConduct = _lc;", ctx);
    await vm.runInContext("saveLogConductWizard()", ctx);
    ok(/add at least one group/i.test(alerted), "zero-participant NEW conduct must be blocked with a guiding alert");
    eq(JSON.parse(vm.runInContext("JSON.stringify(STATE.attendance)", ctx)).length, 0, "nothing saved");
  });

  await test("legacy-row edit with zero participants is NOT blocked (guard only applies to new conducts)", async () => {
    const row = await saveFor({
      existingAttendance: { id: "A1", date: "2026-05-26", time: "0730", conductId: "c1", total: 5,
        participants: "", currencyTags: "", periods: "", source: "" },
      wiz: { participants: [], importedBaseline: [] }
    });
    eq(row.id, "A1", "legacy-row edit with no group added yet still saves");
  });
};
