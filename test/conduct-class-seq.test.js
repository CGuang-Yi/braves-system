// Guards setConductClassSeq against the "zeroed ordinal collision" (PR #80 review).
//
// A manually-classed conduct carries an explicit classSeq. conductClassSeq()
// (js/calc.js) falls back to the name's trailing number whenever a classed
// conduct's classSeq is not a finite integer >= 1. The Seq input is editable and
// blanking it used to persist 0, re-triggering that fallback. Two conducts in one
// class whose names have no distinguishing trailing number then both resolve to 1
// — conductProgress keys attended/missed purely by that number, so a recruit who
// attended one of the two and skipped the other reads as on-track (the miss is
// silently dropped). setConductClassSeq now snaps a blank/<1 seq to the next free
// ordinal whenever a className is set, so a classed conduct always keeps a
// distinct positive number. An UNclassed conduct still stores 0 (name-parse mode).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

// Loads forms.js (the writers) + calc.js's conductClassSeq (the reader) into one
// sandbox with STATE + DOM/network collaborators stubbed to no-ops.
function loadCtx(conducts) {
  const target = {
    console, JSON, Math, Number, String, Boolean, Array, Object, Set, Map, isNaN, isFinite
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8"), ctx, { filename: "forms.js" });
  // Real conductClassSeq/parseConductSeries from source, so the assertion reads
  // the SAME resolution the dashboard uses — no re-implementation drift.
  const calc = fs.readFileSync(path.join(__dirname, "..", "js", "calc.js"), "utf8");
  vm.runInContext(calc.match(/function parseConductSeries[\s\S]*?\n}\n/)[0], ctx);
  vm.runInContext(calc.match(/function conductClassSeq[\s\S]*?\n}\n/)[0], ctx);
  target.saveLocal = () => {};
  target.render = () => {};
  target.autoSync = () => {};
  target.STATE = { conducts, apiUrl: "" };
  return ctx;
}

module.exports = async function run() {
  suite("registry: setConductClassSeq ordinal guard");

  await test("classed conduct: blanking the seq (0) snaps to the next free ordinal, not 0", () => {
    const ctx = loadCtx([
      { id: "c1", name: "Warm Up PT", className: "PT", classSeq: 1 },
      { id: "c2", name: "Cool Down PT", className: "PT", classSeq: 2 }
    ]);
    vm.runInContext("setConductClassSeq('c1', 0)", ctx);   // user blanks c1's Seq field
    const c1 = JSON.parse(vm.runInContext("JSON.stringify(STATE.conducts[0])", ctx));
    ok(c1.classSeq >= 1, "a classed conduct must never persist seq 0");
    eq(c1.classSeq, 3, "snaps to (max seq in class 2) + 1");
  });

  await test("classed siblings with no distinguishing name number keep DISTINCT ordinals after both blanked", () => {
    const ctx = loadCtx([
      { id: "c1", name: "Warm Up PT", className: "PT", classSeq: 1 },
      { id: "c2", name: "Cool Down PT", className: "PT", classSeq: 2 }
    ]);
    vm.runInContext("setConductClassSeq('c1', '')", ctx);
    vm.runInContext("setConductClassSeq('c2', '')", ctx);
    // The collision would have been both resolving to 1 (parseConductSeries of a
    // name with no trailing number). Prove the two RESOLVED nums differ.
    const n1 = vm.runInContext("conductClassSeq(STATE.conducts[0])", ctx);
    const n2 = vm.runInContext("conductClassSeq(STATE.conducts[1])", ctx);
    ok(n1 !== n2, `resolved ordinals must differ, got ${n1} and ${n2}`);
  });

  await test("UNclassed conduct still stores 0 (name-parse fallback preserved)", () => {
    const ctx = loadCtx([{ id: "c1", name: "Endurance Run 5", className: "", classSeq: 4 }]);
    vm.runInContext("setConductClassSeq('c1', 0)", ctx);
    const c1 = JSON.parse(vm.runInContext("JSON.stringify(STATE.conducts[0])", ctx));
    eq(c1.classSeq, 0, "no className ⇒ 0 means 'unset', name-parse takes over");
    eq(vm.runInContext("conductClassSeq(STATE.conducts[0])", ctx), 5, "resolves via the name's trailing number");
  });

  await test("classed conduct: an explicit positive seq is stored verbatim", () => {
    const ctx = loadCtx([{ id: "c1", name: "Warm Up PT", className: "PT", classSeq: 1 }]);
    vm.runInContext("setConductClassSeq('c1', 6)", ctx);
    eq(JSON.parse(vm.runInContext("JSON.stringify(STATE.conducts[0])", ctx)).classSeq, 6);
  });
};
