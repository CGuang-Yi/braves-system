// Guards the pure helpers behind the parade-state Compare feature (js/helpers.js):
//   • diffLines(a, b)        — line-level LCS diff → [{type:"same"|"add"|"del", text}]
//   • paradeSnapshotDup(...) — is an identical snapshot already archived?
// Brace-matched out of helpers.js and run in a sandbox (Array/Math provided).
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

function load() {
  const sandbox = { console, JSON, Math, String, Number, Array, Object, Boolean, Set, Map, RegExp };
  vm.createContext(sandbox);
  const helpers = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const src = ["diffLines", "paradeSnapshotDup"].map(n => extractFunction(helpers, n)).join("\n")
    + "\n;this.diffLines = diffLines; this.paradeSnapshotDup = paradeSnapshotDup;";
  vm.runInContext(src, sandbox, { filename: "helpers-slice.js" });
  return sandbox;
}

const texts = arr => arr.map(d => d.text);

module.exports = async function run() {
  suite("parade compare: diffLines classifies added / removed / unchanged lines");

  await test("changed and identical lines are classified correctly", () => {
    const sb = load();
    const a = "TOTAL: 10\nATT C: 02\n1. A\n2. B";
    const b = "TOTAL: 09\nATT C: 02\n1. A\n2. C";
    const diff = sb.diffLines(a, b);
    const add = texts(diff.filter(d => d.type === "add"));
    const del = texts(diff.filter(d => d.type === "del"));
    const same = texts(diff.filter(d => d.type === "same"));
    eq(add.length, 2); eq(del.length, 2); eq(same.length, 2);
    ok(add.includes("TOTAL: 09") && add.includes("2. C"), "new lines are additions");
    ok(del.includes("TOTAL: 10") && del.includes("2. B"), "old lines are deletions");
    ok(same.includes("ATT C: 02") && same.includes("1. A"), "unchanged lines are same");
  });

  await test("identical text yields only 'same' lines", () => {
    const sb = load();
    const diff = sb.diffLines("X\nY\nZ", "X\nY\nZ");
    ok(diff.every(d => d.type === "same"), "no add/del for identical input");
    eq(diff.length, 3);
  });

  await test("a pure insertion is all adds against an empty base's content", () => {
    const sb = load();
    const diff = sb.diffLines("A\nB", "A\nB\nC");
    eq(texts(diff.filter(d => d.type === "add")).join(","), "C");
    eq(diff.filter(d => d.type === "del").length, 0);
  });

  suite("parade compare: paradeSnapshotDup detects an already-archived snapshot");

  await test("identical date+slot+type+message is a dup; a changed message is not", () => {
    const sb = load();
    const archive = [{ date: "010726", slot: "0730", type: "FP", message: "TOTAL: 10\nA" }];
    ok(sb.paradeSnapshotDup(archive, { date: "010726", slot: "0730", type: "FP", message: "TOTAL: 10\nA" }), "exact match is a dup");
    ok(!sb.paradeSnapshotDup(archive, { date: "010726", slot: "0730", type: "FP", message: "TOTAL: 09\nA" }), "different text is NOT a dup");
    ok(!sb.paradeSnapshotDup(archive, { date: "020726", slot: "0730", type: "FP", message: "TOTAL: 10\nA" }), "different date is NOT a dup");
    ok(!sb.paradeSnapshotDup([], { date: "010726", slot: "0730", type: "FP", message: "x" }), "empty archive → never a dup");
  });
};
