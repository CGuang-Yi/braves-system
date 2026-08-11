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
};
