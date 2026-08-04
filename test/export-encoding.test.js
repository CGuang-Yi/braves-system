// Export encoding — the file that proves a CSV opens correctly in Excel and a
// JSON backup still round-trips through importBackup.
//
// These drive the REAL downloadCSVText/exportJSON (not a stub) with Blob and
// URL captured, because the whole bug lives in the two arguments handed to
// Blob() — a test that stubbed downloadCSVText, as test/list-exports.test.js
// does, cannot see it at all.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { makeBrowser } = require("./mocks/browser");

const ROOT = path.resolve(__dirname, "..");

// Loads state.js + helpers.js into one context (reproducing the browser's
// shared global scope) and captures whatever reaches Blob().
function load() {
  const browser = makeBrowser();
  const sb = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl
  }, browser.globals);
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ["js/state.js", "js/appointment-4d.js", "js/helpers.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
  }
  const cap = {};
  sb.Blob = function (parts, opts) { cap.text = parts.join(""); cap.type = opts && opts.type; };
  sb.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  return { sb, cap };
}

module.exports = async function run() {
  suite("export encoding: UTF-8 CSV + BOM-free JSON");

  await test("CSV export leads with a BOM and declares charset=utf-8", () => {
    const { sb, cap } = load();
    vm.runInContext('downloadCSVText("4D,Name\\n1411,Gold\\u2605", "x.csv")', sb);
    ok(cap.text.charCodeAt(0) === 0xFEFF, "expected a leading BOM, got " + JSON.stringify(cap.text.slice(0, 4)));
    eq(cap.type, "text/csv;charset=utf-8");
  });

  await test("CSV body is unchanged apart from the BOM", () => {
    const { sb, cap } = load();
    vm.runInContext('downloadCSVText("4D,Name\\n1411,x", "x.csv")', sb);
    eq(cap.text.slice(1), "4D,Name\n1411,x");
  });

  // PapaParse strips a leading BOM on string input
  // (`if (65279 === e.charCodeAt(0)) return e.slice(1)`), so re-importing our
  // own export must not yield a header field named "﻿4D". Asserted here
  // against the same rule rather than the vendored minified bundle.
  await test("a BOM-stripping parser sees a clean first header", () => {
    const { sb, cap } = load();
    vm.runInContext('downloadCSVText("4D,Name\\n1411,x", "x.csv")', sb);
    const stripped = cap.text.charCodeAt(0) === 0xFEFF ? cap.text.slice(1) : cap.text;
    eq(stripped.split("\n")[0].split(",")[0], "4D");
  });

  // The regression guard that matters most: a BOM here breaks importBackup's
  // JSON.parse (js/forms-admin.js:265) — turning a cosmetic display bug into a
  // backup the app can write but never restore.
  await test("JSON export has NO BOM and still parses", () => {
    const { sb, cap } = load();
    vm.runInContext('exportJSON({ roster: [{ id: "1411" }] }, "x.json")', sb);
    ok(cap.text.charCodeAt(0) !== 0xFEFF, "JSON export must not carry a BOM");
    eq(JSON.parse(cap.text).roster[0].id, "1411");
  });

  await test("JSON export declares charset=utf-8", () => {
    const { sb, cap } = load();
    vm.runInContext('exportJSON({ a: 1 }, "x.json")', sb);
    eq(cap.type, "application/json;charset=utf-8");
  });
};
