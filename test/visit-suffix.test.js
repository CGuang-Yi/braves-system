// Visit-type suffix (Feature 30.1). One shared builder feeds three surfaces —
// the parade grid, the Dashboard Non-Active table and the conduct wizard's
// status checklist — precisely so those surfaces cannot drift apart. This pins
// the builder; the per-surface placement rules (first pill only, first badge
// only, same-day only) are asserted as wiring in test/render-wiring.test.js.
//
// helpers.js is a browser-global bundle, so it loads into a Proxy-global vm
// context. It is loaded for REAL rather than stubbed because the point of the
// exercise is that all three surfaces call the same function.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadCtx() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8"),
    ctx, { filename: "helpers.js" });
  return ctx;
}

module.exports = async function run() {
  suite("visit suffix: builder");
  const c = loadCtx();
  const s = rec => vm.runInContext(`visitSuffix(${JSON.stringify(rec)})`, c);

  await test("each covered visit type renders TYPE + time", () => {
    eq(s({ type: "RSI", time: "0830" }), "RSI 0830");
    eq(s({ type: "RSO", time: "0900" }), "RSO 0900");
    eq(s({ type: "MA", time: "1400" }), "MA 1400");
    eq(s({ type: "MR", time: "0900" }), "MR 0900");
  });

  await test("a blank time yields the bare type — never a trailing separator", () => {
    eq(s({ type: "RSI", time: "" }), "RSI");
    eq(s({ type: "RSI" }), "RSI");
    eq(s({ type: "RSI", time: "   " }), "RSI");
  });

  await test("an uncovered or absent type yields nothing", () => {
    eq(s({ type: "", time: "0830" }), "");
    eq(s({ time: "0830" }), "");
    eq(s({}), "");
    // A status, not a visit type — the suffix describes the VISIT, and hanging
    // it off a status would double-print what the badge already says.
    eq(s({ type: "MC", time: "0830" }), "");
  });

  await test("a null or undefined record is safe", () => {
    eq(vm.runInContext("visitSuffix(null)", c), "");
    eq(vm.runInContext("visitSuffix(undefined)", c), "");
  });

  await test("the time is emitted as stored — no re-padding at display time", () => {
    // pad4Time normalises on the way IN (submitMedical). Re-padding here would
    // mask a bad stored value instead of showing it, and would mangle anything
    // non-numeric a legacy row might carry.
    eq(s({ type: "RSI", time: "830" }), "RSI 830");
  });
};
