// The wizard's unsaved-work diff. The test that matters most is the EDIT-MODE
// one: openLogConductWizard pre-loads existing fallout/reportSick rows, so a
// naive "are there rows present" check fires on opening an existing conduct and
// closing it unchanged. A warning that cries wolf gets clicked through, which
// costs the real cases — hence a diff, and hence this test.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok } = require("./_tap");

// Same shape as test/status-participates.test.js: forms-wizard.js references
// globals from other <script> tags, so the Proxy's `has: () => true` is what
// stops a bare identifier throwing at load. Nothing at this file's top level
// calls anything, so loading it is safe.
function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "forms-wizard.js"), "utf8");
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat,
    STATE: { medical: [], attendance: [], conductDetail: [], conducts: [], roster: [] },
    document: { getElementById: () => null, addEventListener: () => {} }
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(src, ctx, { filename: "forms-wizard.js" });
  return expr => vm.runInContext(expr, ctx);
}

// A representative _logConduct, shaped like the one openLogConductWizard builds
// in EDIT mode: fallout/reportSick already populated from existing rows.
const BASE = {
  attendanceId: "att-1",
  date: "2026-08-10", time: "0800", conductId: "c-1", totalOverride: null,
  remarks: "", status: [{ d4: "1234", notParticipating: true, reason: "MC" }],
  rsi: [], fallout: [{ d4: "5678", reason: "ankle", eventTime: "0930" }],
  reportSick: [], participants: ["1234", "5678"], addedGroups: [],
  haCounts: false, haPeriods: 1,
  showExclCommanders: false, originalDetailIds: ["d-1"],
  importedBaseline: ["1234", "5678"], statusBuiltFor: "2026-08-10"
};

module.exports = async function run() {
  suite("wizard unsaved-work diff");

  const setup = extra => {
    const run = load();
    run(`_logConduct = ${JSON.stringify({ ...BASE, ...(extra || {}) })};`);
    run(`_logConductBaseline = JSON.stringify(wizSnapshot(_logConduct));`);
    return run;
  };

  await test("an unchanged edit-mode open reads clean", () => {
    const run = setup();
    ok(run("wizIsDirty()") === false);
  });

  await test("a pre-loaded fallout row alone does not read dirty", () => {
    const run = setup();
    // The whole point: BASE already carries a fallout row from the edit-mode
    // pre-load, and the wizard has not been touched.
    ok(run("_logConduct.fallout.length === 1") === true);
    ok(run("wizIsDirty()") === false);
  });

  await test("every whitelisted field flips it dirty", () => {
    const edits = {
      date: `"2026-08-11"`, time: `"0900"`, conductId: `"c-2"`, totalOverride: `99`,
      remarks: `"typed"`, status: `[]`, rsi: `[{d4:"1111"}]`,
      fallout: `[]`, reportSick: `[{d4:"2222",reason:"",eventTime:""}]`,
      participants: `["1234"]`, addedGroups: `[{id:"g1"}]`,
      haCounts: `true`, haPeriods: `2`
    };
    for (const [field, value] of Object.entries(edits)) {
      const run = setup();
      run(`_logConduct.${field} = ${value};`);
      ok(run("wizIsDirty()") === true, `${field} should read dirty`);
    }
  });

  await test("showExclCommanders is display-only and does not read dirty", () => {
    const run = setup();
    run(`_logConduct.showExclCommanders = true;`);
    ok(run("wizIsDirty()") === false);
  });

  await test("bookkeeping fields do not read dirty", () => {
    for (const field of ["originalDetailIds", "importedBaseline", "statusBuiltFor"]) {
      const run = setup();
      run(`_logConduct.${field} = ["mutated"];`);
      ok(run("wizIsDirty()") === false, `${field} should not read dirty`);
    }
  });

  await test("no wizard open reads clean", () => {
    const run = load();
    run(`_logConduct = null; _logConductBaseline = null;`);
    ok(run("wizIsDirty()") === false);
  });

  await test("a baseline that was never taken reads clean", () => {
    // Defensive: if registration ever gets skipped, the guard must not start
    // prompting on every close.
    const run = load();
    run(`_logConduct = ${JSON.stringify(BASE)}; _logConductBaseline = null;`);
    ok(run("wizIsDirty()") === false);
  });

  suite("wizardCloseGuard");

  // The guard reads the DOM, so this loader gives it a controllable one.
  function loadWithDom(hasWizRemarks) {
    const src = fs.readFileSync(path.join(__dirname, "..", "js", "forms-wizard.js"), "utf8");
    const confirms = [];
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat,
      STATE: { medical: [], attendance: [], conductDetail: [], conducts: [], roster: [] },
      document: {
        getElementById: id => (id === "wiz-remarks" && hasWizRemarks ? {} : null),
        addEventListener: () => {}
      },
      confirm: msg => { confirms.push(msg); return target.__confirmAnswer; },
      clearModalCloseGuard: () => { target.__cleared = true; },
      __confirmAnswer: true,
      __cleared: false
    };
    const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
    vm.runInContext(src, ctx, { filename: "forms-wizard.js" });
    return { run: expr => vm.runInContext(expr, ctx), confirms, target };
  }

  await test("a clean wizard closes with no prompt", () => {
    const { run, confirms } = loadWithDom(true);
    run(`_logConduct = ${JSON.stringify(BASE)};`);
    run(`_logConductBaseline = JSON.stringify(wizSnapshot(_logConduct));`);
    ok(run("wizardCloseGuard()") === true);
    ok(confirms.length === 0);
  });

  await test("a dirty wizard prompts and vetoes when the user cancels", () => {
    const { run, confirms, target } = loadWithDom(true);
    run(`_logConduct = ${JSON.stringify(BASE)};`);
    run(`_logConductBaseline = JSON.stringify(wizSnapshot(_logConduct));`);
    run(`_logConduct.remarks = "typed something";`);
    target.__confirmAnswer = false;
    ok(run("wizardCloseGuard()") === false);
    ok(confirms.length === 1);
    ok(/unsaved changes/i.test(confirms[0]));
    ok(target.__cleared === false);
  });

  await test("a dirty wizard closes and clears the guard when the user confirms", () => {
    const { run, target } = loadWithDom(true);
    run(`_logConduct = ${JSON.stringify(BASE)};`);
    run(`_logConductBaseline = JSON.stringify(wizSnapshot(_logConduct));`);
    run(`_logConduct.remarks = "typed something";`);
    target.__confirmAnswer = true;
    ok(run("wizardCloseGuard()") === true);
    ok(target.__cleared === true);
  });

  await test("the guard is inert while a sub-modal has replaced the wizard", () => {
    // The person-match modal takes over the shared overlay, so #wiz-remarks is
    // gone. Its Cancel/✕/backdrop must keep working — restoring the wizard via
    // the onClose hook — even though _logConduct is still set and dirty.
    const { run, confirms } = loadWithDom(false);
    run(`_logConduct = ${JSON.stringify(BASE)};`);
    run(`_logConductBaseline = JSON.stringify(wizSnapshot(_logConduct));`);
    run(`_logConduct.remarks = "typed something";`);
    ok(run("wizardCloseGuard()") === true);
    ok(confirms.length === 0);
  });

  await test("the guard is inert after a successful save cleared _logConduct", () => {
    const { run, confirms } = loadWithDom(true);
    run(`_logConduct = null;`);
    ok(run("wizardCloseGuard()") === true);
    ok(confirms.length === 0);
  });
};
