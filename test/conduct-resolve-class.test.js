// resolveConductClasses (js/calc.js): a makeup conduct adopts the class + sequence
// number of the conduct it makes up for, so it slots into the same position in the
// class series. Follows makeupFor transitively, guards cycles + dangling targets.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadCalc() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, Object, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "calc.js"), "utf8"), sandbox, { filename: "calc.js" });
  return sandbox;
}

module.exports = async function run() {
  suite("calc: resolveConductClasses");
  const c = loadCalc();

  await test("makeup inherits target class + seq", () => {
    const r = c.resolveConductClasses([
      { id: "c1", name: "Endurance Run", className: "Endurance Run", classSeq: 3 },
      { id: "c2", name: "ER Makeup", className: "", classSeq: 0, makeupFor: "c1" }
    ]);
    eq(r.keyById.c1, "Endurance Run");
    eq(r.seqById.c1, 3);
    eq(r.keyById.c2, "Endurance Run"); // adopted from c1
    eq(r.seqById.c2, 3);               // same slot as c1
  });

  await test("non-makeup conducts keep their own key/seq", () => {
    const r = c.resolveConductClasses([
      { id: "c1", name: "Endurance Run 5" },
      { id: "c2", name: "5BX PT" }
    ]);
    eq(r.seqById.c1, 5);
    eq(r.keyById.c2, "5BX PT");
    eq(r.seqById.c2, 1);
  });

  await test("dangling makeup target falls back to own key/seq", () => {
    const r = c.resolveConductClasses([
      { id: "c2", name: "Lone Makeup 4", makeupFor: "missing" }
    ]);
    eq(r.keyById.c2, "Lone Makeup");
    eq(r.seqById.c2, 4);
  });

  await test("makeupFor cycle does not loop", () => {
    const r = c.resolveConductClasses([
      { id: "a", name: "A 1", makeupFor: "b" },
      { id: "b", name: "B 2", makeupFor: "a" }
    ]);
    // Guard must terminate; both keep a defined key/seq (own, since neither has a
    // non-makeup terminal target).
    eq(typeof r.keyById.a, "string");
    eq(typeof r.seqById.b, "number");
  });
};
