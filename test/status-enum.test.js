// Guards the medical status enum: new excuses + RIB present in helpers.js.
const fs = require("fs");
const path = require("path");
const { suite, test, ok } = require("./_tap");

module.exports = async function run() {
  suite("status enum: new excuses + RIB");
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const required = [
    "Excuse FLEGS", "Excuse Sunlight", "Excuse Stay In", "Excuse PT",
    "Excuse Shoes", "Excuse Camo", "Excuse Loud Noise", "RIB (Rest in Bunk)"
  ];
  await test("MED_STATUS_GROUPS contains every new status", () => {
    for (const s of required) ok(src.includes(s), "missing: " + s);
  });

  // Feature 27 — Pending leads the dropdown. Loaded for real rather than
  // regex-matched, so this asserts the ORDER the form will actually render
  // rather than the order the source happens to be written in.
  suite("status enum: Pending leads the dropdown, and only the dropdown");
  const vm = require("vm");
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(src, ctx, { filename: "helpers.js" });

  await test("Pending is the first selectable status in the form dropdown", () => {
    ok(vm.runInContext("MED_STATUS_GROUPS[0].options[0]", ctx) === "Pending",
      "Pending is no longer the first option of the first group");
  });

  await test("the move did not drop or duplicate a status", () => {
    const all = vm.runInContext("JSON.stringify(MED_STATUSES)", ctx);
    const list = JSON.parse(all);
    ok(list.length === [...new Set(list)].length, "reordering duplicated a status");
    for (const s of [...required, "Pending", "NIL", "MC", "Warded", "LD"]) {
      ok(list.includes(s), "reordering dropped: " + s);
    }
  });

  await test("medSeverityRank is untouched — Pending must NOT outrank a real status", () => {
    // The whole point of scoping Feature 27 to the dropdown. medSeverityRank
    // decides statuses[0], which splits the Dashboard's Non-Active from
    // Recovering and orders every badge stack; if Pending ever ranked above MC
    // or LD, people would silently move between those views.
    const rank = t => vm.runInContext(`medSeverityRank(${JSON.stringify(t)})`, ctx);
    ok(rank("MC") > rank("Pending"), "Pending now outranks MC in severity");
    ok(rank("LD") > rank("Pending"), "Pending now outranks LD in severity");
    ok(rank("Warded") > rank("Pending"), "Pending now outranks Warded in severity");
  });
};
