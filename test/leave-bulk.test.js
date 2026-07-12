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
};
