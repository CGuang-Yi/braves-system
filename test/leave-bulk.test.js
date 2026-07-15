// Guard for scopeRecruits (js/helpers.js) — resolves a bulk-leave scope selector
// to recruit ids for the Leave/Out form's "Apply to" feature.
//
// helpers.js is too large to execute whole in the vm harness, so we brace-match
// scopeRecruits and its pure deps (getPlt/getSect/personPlatoon/personSection)
// out of the source and run them together with a stub STATE.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

function extractFunction(src, name) {
  const start = src.indexOf("function " + name);
  if (start < 0) throw new Error("function not found: " + name);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces for " + name);
}

function load(roster) {
  const STATE = { roster: roster || [] };
  const sandbox = {
    console, JSON, Math, String, Number, Array, Object, Boolean, Set, RegExp,
    isNaN, parseInt, parseFloat, STATE
  };
  vm.createContext(sandbox);
  const helpers = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const names = ["getPlt", "getSect", "personPlatoon", "personSection", "scopeRecruits"];
  const src = names.map(n => extractFunction(helpers, n)).join("\n")
    + "\n;this.scopeRecruits = scopeRecruits;";
  vm.runInContext(src, sandbox, { filename: "helpers-slice.js" });
  return sandbox;
}

const ROSTER = [
  { id: "1101", role: "Recruit", platoon: "PLT1", section: "1" },
  { id: "1102", role: "Recruit", platoon: "PLT1", section: "2" },
  { id: "1201", role: "Recruit", platoon: "PLT2", section: "1" },
  { id: "0001", role: "Commander", platoon: "", section: "" }
];

// Load submitLeave (forms.js) + its real scope deps (helpers.js) into a sandbox
// with the DOM/side-effect deps stubbed, spying every autoSync call.
function loadSubmit(values, roster, selectedD4s) {
  const pushes = [], alerts = [], confirmations = [];
  let idc = 5000;
  const STATE = { roster: roster || [], leave: [], apiUrl: "https://x" };
  const sandbox = {
    console, JSON, Math, String, Number, Array, Object, Boolean, Set, RegExp,
    isNaN, parseInt, parseFloat, STATE,
    gv: id => (id in values ? values[id] : ""),
    isoToDisplayDate: s => s,                 // identity is enough for these assertions
    nextId: () => String(++idc),
    saveLocal: () => {}, closeModal: () => {}, render: () => {},
    alert: message => alerts.push(message),
    confirm: message => { confirmations.push(message); return true; },
    autoSync: (tab, mode) => pushes.push({ tab, mode })
  };
  vm.createContext(sandbox);
  const helpers = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
  const src = `let _leaveSelectedD4s = ${JSON.stringify(selectedD4s || [])};\n`
    + ["getPlt", "getSect", "personPlatoon", "personSection", "scopeRecruits"]
      .map(n => extractFunction(helpers, n)).join("\n")
    + "\n" + extractFunction(forms, "submitLeave")
    + "\n;this.submitLeave = submitLeave;";
  vm.runInContext(src, sandbox, { filename: "submit-slice.js" });
  return { sb: sandbox, pushes, alerts, confirmations, STATE };
}

module.exports = async function run() {
  suite("leave bulk: scopeRecruits resolves company / platoon / section to recruit ids");

  await test("company scope = all recruits, commanders excluded", () => {
    const sb = load(ROSTER);
    const ids = sb.scopeRecruits("company").sort();
    eq(ids.join(","), "1101,1102,1201", "company should be every recruit, no commander");
  });

  await test("platoon scope = only that platoon's recruits", () => {
    const sb = load(ROSTER);
    eq(sb.scopeRecruits("plt:PLT1").sort().join(","), "1101,1102");
    eq(sb.scopeRecruits("plt:PLT2").join(","), "1201");
  });

  await test("section scope = only that platoon+section's recruits", () => {
    const sb = load(ROSTER);
    eq(sb.scopeRecruits("sect:PLT1:1").join(","), "1101");
    eq(sb.scopeRecruits("sect:PLT1:2").join(","), "1102");
  });

  await test("unknown / empty scope = empty list", () => {
    const sb = load(ROSTER);
    eq(sb.scopeRecruits("bogus").length, 0);
    ok(Array.isArray(sb.scopeRecruits("company")), "returns an array");
  });

  suite("leave bulk: submitLeave batches a scoped entry into ONE appendMany");

  await test("platoon scope creates one Leave row per recruit and pushes a single appendMany", () => {
    const { sb, pushes, STATE } = loadSubmit({
      "f-entry-id": "", "f-leave-scope": "plt:PLT1", "f-type": "Course",
      "f-start": "2026-07-01", "f-end": "2026-07-02", "f-days": "2",
      "f-reason": "APSC", "f-in-camp": "false"
    }, ROSTER);
    sb.submitLeave();
    eq(STATE.leave.length, 2, "PLT1 has two recruits → two Leave rows");
    eq(pushes.length, 1, "exactly one network write");
    eq(pushes[0].tab, "Leave");
    eq(pushes[0].mode.type, "appendMany", "bulk uses appendMany, not N upserts");
    eq(pushes[0].mode.rows.length, 2);
    ok(STATE.leave.every(l => l.type === "Course" && l.isInCamp === false), "fields applied to every row");
  });

  await test("selected people include commanders, dedupe IDs, and use one appendMany", () => {
    const { sb, pushes, confirmations, STATE } = loadSubmit({
      "f-entry-id": "", "f-leave-scope": "selected", "f-type": "Course",
      "f-start": "2026-07-01", "f-end": "2026-07-02", "f-days": "2",
      "f-reason": "APSC", "f-in-camp": "false"
    }, ROSTER, ["1101", "0001", "1101"]);

    sb.submitLeave();

    eq(STATE.leave.length, 2, "duplicate selected IDs create only two rows");
    eq(STATE.leave.map(l => l.d4).sort().join(","), "0001,1101", "commander and recruit are both retained");
    eq(pushes.length, 1, "selected group sends exactly one network write");
    eq(pushes[0].tab, "Leave");
    eq(pushes[0].mode.type, "appendMany");
    eq(pushes[0].mode.rows.length, 2);
    ok(STATE.leave.every(l => l.type === "Course" && l.isInCamp === false), "shared fields apply to every row");
    eq(confirmations[0], 'Log "Course" for 2 people?');
  });

  await test("empty selected-people group alerts and writes nothing", () => {
    const { sb, pushes, alerts, STATE } = loadSubmit({
      "f-entry-id": "", "f-leave-scope": "selected", "f-type": "Leave",
      "f-start": "2026-07-01", "f-end": "2026-07-02", "f-days": "2",
      "f-reason": "", "f-in-camp": "false"
    }, ROSTER, []);

    sb.submitLeave();

    eq(STATE.leave.length, 0);
    eq(pushes.length, 0);
    eq(alerts[0], "Add at least one person to the selected group.");
  });

  await test("single-person add still uses a single upsert (unchanged path)", () => {
    const { sb, pushes, STATE } = loadSubmit({
      "f-entry-id": "", "f-leave-scope": "person", "f-d4": "1201", "f-type": "Weekend",
      "f-start": "2026-07-01", "f-end": "2026-07-02", "f-days": "2",
      "f-reason": "", "f-in-camp": "true"
    }, ROSTER);
    sb.submitLeave();
    eq(STATE.leave.length, 1);
    eq(pushes[0].mode.type, "upsert", "single-person path must stay an upsert");
  });
};
