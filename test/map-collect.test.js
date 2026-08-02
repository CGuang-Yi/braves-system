// Declaration extraction. The api.js cases are the important ones: that file has
// ZERO top-level `function` declarations, so any approach relying on a vm context
// diff reports it as defining nothing. See tools/map/collect.js's header.
const path = require("path");
const { suite, test, ok, eq } = require("./_tap");
const { collectFile, lineAt } = require("../tools/map/collect");

const ROOT = path.resolve(__dirname, "..");

module.exports = async function () {
  suite("map/collect");

  await test("lineAt is 1-indexed", () => {
    eq(lineAt("a\nb\nc", 0), 1);
    eq(lineAt("a\nb\nc", 2), 2);
  });

  await test("finds const/let/class that vm cannot see", () => {
    const r = collectFile(path.join(ROOT, "js/api.js"));
    const names = r.decls.map(d => d.name);
    ok(names.includes("API"), "const API found");
    ok(names.includes("PULL_ASSIGN"), "const PULL_ASSIGN found");
    ok(names.includes("AuthError"), "const AuthError found");
  });

  await test("api.js object-literal methods are recorded", () => {
    const r = collectFile(path.join(ROOT, "js/api.js"));
    const methods = r.decls.filter(d => d.kind === "method").map(d => d.name);
    ok(methods.some(n => n.indexOf("API.") === 0), "API members captured as methods");
  });

  await test("finds top-level function declarations", () => {
    const r = collectFile(path.join(ROOT, "js/calc.js"));
    ok(r.decls.some(d => d.kind === "function"), "function decls found");
  });

  await test("ignores declarations nested inside a function body", () => {
    // Only brace-depth 0 counts; an inner helper is not part of the file's surface.
    const r = collectFile(path.join(ROOT, "js/calc.js"));
    const dupes = r.decls.filter((d, i, a) => a.findIndex(x => x.name === d.name) !== i);
    eq(dupes, [], "no duplicate names from nested scopes");
  });

  await test("vm cross-check reports no missing function/var globals", () => {
    const r = collectFile(path.join(ROOT, "js/calc.js"));
    ok(r.vmCheck.ran, "vm load succeeded for calc.js");
    eq(r.vmCheck.missing, [], "scanner found every global vm produced");
  });
};
