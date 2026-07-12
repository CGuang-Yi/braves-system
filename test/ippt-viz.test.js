// Guards the IPPT multi-attempt cohort helpers (js/helpers.js): ipptSeriesByRecruit,
// ipptPairedCohort, ipptNetDelta — the shared cohort model behind the progression /
// compare / award-mix charts. Brace-matches the pure functions (and their real deps
// isZeroRunTime/isYTT/parseRunTimeToSeconds) out of helpers.js.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

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
  const sandbox = { console, JSON, Math, String, Number, Array, Object, Boolean, Set, Map, RegExp, isNaN, parseInt, parseFloat };
  vm.createContext(sandbox);
  const helpers = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const names = ["isZeroRunTime", "isYTT", "parseRunTimeToSeconds", "ipptSeriesByRecruit", "ipptPairedCohort", "ipptNetDelta"];
  const src = names.map(n => extractFunction(helpers, n)).join("\n")
    + "\n;this.ipptSeriesByRecruit = ipptSeriesByRecruit; this.ipptPairedCohort = ipptPairedCohort; this.ipptNetDelta = ipptNetDelta;";
  vm.runInContext(src, sandbox, { filename: "helpers-slice.js" });
  return sandbox;
}

// Valid, non-YTT entry (real reps + run time). YTT = all zeros.
const ok = (d4, attempt, score) => ({ d4, attempt, score, pushups: 40, situps: 40, runTime: "12:30" });
const ytt = (d4, attempt) => ({ d4, attempt, score: 0, pushups: 0, situps: 0, runTime: "0:00" });

const ENTRIES = [
  ok("1101", 1, 68), ok("1101", 2, 74), ok("1101", 3, 81),
  ok("1102", 1, 60), ytt("1102", 2),          // attempt 2 is YTT → excluded
  ok("1103", 1, 90)                            // single attempt
];

module.exports = async function run() {
  suite("ippt viz: multi-attempt cohort helpers");

  await test("ipptSeriesByRecruit keys scores by attempt and drops YTT / zero-run entries", () => {
    const sb = load();
    const series = sb.ipptSeriesByRecruit(ENTRIES);
    eq(series.length, 3, "three recruits with at least one valid score");
    const r1101 = series.find(r => r.d4 === "1101");
    eq(JSON.stringify(r1101.byAttempt), JSON.stringify({ 1: 68, 2: 74, 3: 81 }));
    const r1102 = series.find(r => r.d4 === "1102");
    eq(JSON.stringify(r1102.byAttempt), JSON.stringify({ 1: 60 }), "the YTT attempt is excluded");
  });

  await test("ipptPairedCohort returns only recruits with a valid score in BOTH attempts", () => {
    const sb = load();
    const series = sb.ipptSeriesByRecruit(ENTRIES);
    const c13 = sb.ipptPairedCohort(series, 1, 3);
    eq(c13.length, 1, "only 1101 has both attempt 1 and 3");
    eq(JSON.stringify(c13[0]), JSON.stringify({ d4: "1101", s1: 68, s2: 81, delta: 13 }));
    const c12 = sb.ipptPairedCohort(series, 1, 2);
    eq(c12.length, 1, "1102 has no valid attempt 2, so only 1101 pairs");
  });

  await test("ipptNetDelta is latest-minus-first, and 0 for a single-attempt recruit", () => {
    const sb = load();
    eq(sb.ipptNetDelta({ byAttempt: { 1: 68, 2: 74, 3: 81 } }), 13);
    eq(sb.ipptNetDelta({ byAttempt: { 1: 90 } }), 0, "one attempt → no net movement");
    eq(sb.ipptNetDelta({ byAttempt: { 2: 70, 5: 62 } }), -8, "uses first/last by attempt number, not insertion order");
  });
};
