// Reference classification. The direct-vs-string split is the whole point of the
// tool: a handler reachable only from an onclick= attribute inside an HTML
// template string is live code that no linter, test or editor "find references"
// can see. It must never be merged into direct calls, nor dropped into orphans.
const { suite, test, ok, eq } = require("./_tap");
const { maskSource } = require("../tools/map/mask");
const { buildRefs } = require("../tools/map/refs");

function mk(file, src, decls) {
  const m = maskSource(src);
  return { file, src, masked: m.masked, strings: m.strings, decls: decls || [] };
}

module.exports = async function () {
  suite("map/refs");

  await test("counts a direct call site in another file", () => {
    const a = mk("a.js", "function padD4(x){return x;}", [{ name: "padD4", kind: "function", line: 1 }]);
    const b = mk("b.js", "const y = padD4('1');");
    const { byName } = buildRefs([a, b]);
    eq(byName.padD4.directRefs.map(r => r.file), ["b.js"]);
    eq(byName.padD4.fanIn, 1);
  });

  await test("separates a string-literal reference from a direct call", () => {
    const a = mk("a.js", "function closeModal(){}", [{ name: "closeModal", kind: "function", line: 1 }]);
    const b = mk("b.js", "el.innerHTML = '<b onclick=\"closeModal()\">x</b>';");
    const { byName } = buildRefs([a, b]);
    eq(byName.closeModal.directRefs, [], "not a direct call");
    eq(byName.closeModal.stringRefs.map(r => r.file), ["b.js"], "recorded as a string ref");
  });

  await test("a call inside a template interpolation is direct, not a string ref", () => {
    const a = mk("a.js", "function esc(s){return s;}", [{ name: "esc", kind: "function", line: 1 }]);
    const b = mk("b.js", "const h = `<b>${esc(n)}</b>`;");
    const { byName } = buildRefs([a, b]);
    eq(byName.esc.directRefs.map(r => r.file), ["b.js"], "interpolation counts as a direct call");
    eq(byName.esc.stringRefs, [], "not a string ref");
  });

  await test("does not count the definition line as a reference", () => {
    const a = mk("a.js", "function solo(){}\nsolo();", [{ name: "solo", kind: "function", line: 1 }]);
    const { byName } = buildRefs([a]);
    eq(byName.solo.directRefs.map(r => r.line), [2], "only the call, not the definition");
  });

  await test("does not match a name that is a substring of another identifier", () => {
    const a = mk("a.js", "function pad(){}", [{ name: "pad", kind: "function", line: 1 }]);
    const b = mk("b.js", "padD4(x); padding();");
    const { byName } = buildRefs([a, b]);
    eq(byName.pad.directRefs, [], "word-boundary respected");
  });

  await test("an identifier named like an Object.prototype key does not blow up", () => {
    // js/api.js declares `constructor(message)` inside `class extends Error`.
    // On a plain-object lookup table that name resolves to
    // Object.prototype.constructor — truthy, and not a list.
    const a = mk("a.js", "function f(){}", [{ name: "f", kind: "function", line: 1 }]);
    const b = mk("b.js", "constructor(msg); toString(); valueOf();");
    const { byName } = buildRefs([a, b]);
    eq(byName.f.directRefs, [], "unrelated prototype-named calls are ignored");
  });

  await test("byFile records cross-file direction", () => {
    const a = mk("a.js", "function f(){}", [{ name: "f", kind: "function", line: 1 }]);
    const b = mk("b.js", "f();");
    const { byFile } = buildRefs([a, b]);
    eq(byFile["b.js"].callsInto, ["a.js"]);
    eq(byFile["a.js"].calledBy, ["b.js"]);
  });
};
