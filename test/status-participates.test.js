// statusParticipates gates the conduct wizard's not-participating tick. It used
// to return true for NIL alone, so every Excuse defaulted the recruit OUT of the
// conduct — including the ones that do not restrict training at all.
//
// The precedence is the part most likely to regress silently: a commander's
// saved custom status must beat the built-in default in BOTH directions, so both
// are asserted rather than just the convenient one.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok } = require("./_tap");

// Same shape as test/status-enum.test.js: helpers.js references globals from
// other <script> tags, so the Proxy's `has: () => true` is what stops a bare
// identifier throwing at load. The returned function EVALUATES inside the
// context rather than reading the declaration off the sandbox object.
function load(customStatuses) {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat,
    STATE: { customStatuses: customStatuses || [] },
    saveLocal: () => {}
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(src, ctx, { filename: "helpers.js" });
  return s => vm.runInContext(`statusParticipates(${JSON.stringify(s)})`, ctx);
}

module.exports = async function run() {
  suite("statusParticipates: built-in defaults");

  const participates = load();

  await test("Excuse Camo participates", () => {
    ok(participates("Excuse Camo") === true);
  });

  await test("Excuse Uniform, Loud Noise and Boots participate", () => {
    for (const s of ["Excuse Uniform", "Excuse Loud Noise", "Excuse Boots"]) {
      ok(participates(s) === true, s + " should participate");
    }
  });

  await test("Excuse Sunlight and Excuse Shoes RESTRICT training", () => {
    // Both read permissive and are not. This is the assertion that catches
    // someone "tidying" the map by pattern-matching on the word Excuse.
    ok(participates("Excuse Sunlight") === false, "Sunlight must restrict");
    ok(participates("Excuse Shoes") === false, "Shoes must restrict");
  });

  await test("MC, LD and Excuse PT still restrict", () => {
    for (const s of ["MC", "Warded", "LD", "RIB (Rest in Bunk)", "Excuse PT", "Excuse Heavy Load", "Pending"]) {
      ok(participates(s) === false, s + " should restrict");
    }
  });

  await test("NIL still participates", () => {
    ok(participates("NIL") === true);
  });

  await test("a ghost suffix resolves to its base family", () => {
    ok(participates("LD+1") === false, "LD+1 resolves to LD");
    ok(participates("MC+2") === false, "MC+2 resolves to MC");
  });

  suite("statusParticipates: a custom override beats the built-in default");

  await test("a custom false beats a built-in true", () => {
    const p = load([{ name: "Excuse Camo", participates: false }]);
    ok(p("Excuse Camo") === false, "the commander's override was ignored");
  });

  await test("a custom true beats a built-in false", () => {
    const p = load([{ name: "Excuse PT", participates: true }]);
    ok(p("Excuse PT") === true, "the commander's override was ignored");
  });
};
