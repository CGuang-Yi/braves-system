// Functional guard for findBorderlineReturnees (js/forms.js).
//
// Bug: a recruit whose MC ended YESTERDAY but who has a SECOND (extended) MC
// still covering the parade date was offered as a "borderline returnee"
// candidate — even though they never returned, they're out on the extension.
//
// forms.js is too DOM-heavy to execute whole in the vm harness, so we brace-
// match just this pure function out of the source and run it in a sandbox with
// its three real deps (STATE, displayDateToISO, medStatusActive) — the
// parade-classifier.test.js pattern, scoped to one function.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok } = require("./_tap");

const TODAY = "2026-06-29";
const YDAY = "2026-06-28";

function displayDateToISO(s) {
  const m = String(s == null ? "" : s).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}
// Faithful copy of helpers.js medStatusActive.
function medStatusActive(record, todayIso) {
  if (record.status === "NIL") return false;
  const start = displayDateToISO(record.startDate || record.date || "");
  if (!start) return false;
  if (record.status === "Pending") return todayIso === start;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return false;
  return todayIso >= start && todayIso <= end;
}

// Extract a top-level `function name(...) { ... }` block by brace-matching.
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

function load(medical) {
  const STATE = { medical: medical || [] };
  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    STATE, displayDateToISO, medStatusActive
  };
  vm.createContext(sandbox);
  const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
  const fn = extractFunction(forms, "findBorderlineReturnees");
  vm.runInContext(fn + "\n;this.findBorderlineReturnees = findBorderlineReturnees;", sandbox, { filename: "forms-slice.js" });
  return sandbox;
}

module.exports = async function run() {
  suite("parade: findBorderlineReturnees ignores extended-MC recruits");

  await test("recruit with an MC ending yesterday but a second MC covering today is NOT a candidate", () => {
    const sb = load([
      { id: 1, d4: "1101", status: "MC", startDate: "2026-06-24", endDate: YDAY },   // ended yesterday
      { id: 2, d4: "1101", status: "MC", startDate: YDAY, endDate: "2026-07-02" }     // extension covers today
    ]);
    const out = sb.findBorderlineReturnees(TODAY);
    ok(!out.some(m => m.d4 === "1101"), "still out on the extension — must not be a borderline returnee");
  });

  await test("recruit with only an MC ending yesterday IS a candidate", () => {
    const sb = load([
      { id: 3, d4: "1102", status: "MC", startDate: "2026-06-24", endDate: YDAY }
    ]);
    const out = sb.findBorderlineReturnees(TODAY);
    ok(out.some(m => m.d4 === "1102"), "genuine returnee — should still be offered for the PDS to confirm");
  });
};
