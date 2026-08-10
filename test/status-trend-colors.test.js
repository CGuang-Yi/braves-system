// The Dashboard status trend chart used to colour series by INDEX, and
// statusTrendSeries sorts by peak count — so a status's colour changed whenever
// the data did. These tests pin the label→colour map and, just as importantly,
// pin that unmapped labels still fall back to the index palette (custom statuses
// and the synthesised "Other" bucket have no entry and still need a colour).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

// The Proxy's `has: () => true` is what lets render-dashboard.js load at all in
// a bare context: it references plenty of globals from other <script> tags, and
// without it a bare identifier throws ReferenceError at load. Values are read by
// EVALUATING inside the context rather than off the sandbox object — the pattern
// test/status-enum.test.js uses, and the reliable one.
function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "render-dashboard.js"), "utf8");
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(src, ctx, { filename: "render-dashboard.js" });
  return {
    color: (label, i) => vm.runInContext(`statusTrendColor(${JSON.stringify(label)}, ${i})`, ctx),
    paletteAt: i => vm.runInContext(`STATUS_TREND_PALETTE[${i}]`, ctx),
    hasKey: k => vm.runInContext(`Object.prototype.hasOwnProperty.call(STATUS_TREND_COLORS, ${JSON.stringify(k)})`, ctx)
  };
}

module.exports = async function run() {
  suite("status trend chart: colours are keyed by status, not by series index");

  const sb = load();

  await test("each named status gets its assigned colour", () => {
    const want = {
      "MC": "#F85149", "Warded": "#F85149", "LD": "#E3B341", "Excuse": "#58A6FF",
      "RMJ": "#D29922", "RIB (Rest in Bunk)": "#3FB950", "Pending": "#BC8CFF", "NIL": "#43C59E"
    };
    for (const label of Object.keys(want)) {
      eq(sb.color(label, 0), want[label], "wrong colour for " + label);
    }
  });

  await test("a mapped colour does not move when the series index moves", () => {
    // This is the actual defect: a status's colour was a function of its rank by
    // peak count, so it changed whenever the data did.
    eq(sb.color("LD", 0), sb.color("LD", 5), "LD moved with its index");
  });

  await test("an unmapped label still falls back to the index palette", () => {
    // Custom statuses and the "Other" bucket have no entry and must still draw.
    ok(sb.color("EXCUSE BOOTS", 0), "custom status got no colour");
    eq(sb.color("Other", 1), sb.paletteAt(1), "fallback is not the index palette");
  });

  await test("the collapsed Excuse series is keyed singular", () => {
    // statusTrendSeries folds every "Excuse *" into one line labelled "Excuse".
    // A map keyed on the individual excuses would never be hit.
    ok(sb.hasKey("Excuse"), "no 'Excuse' key");
    ok(!sb.hasKey("Excuse Camo"), "keyed on an individual excuse");
  });
};
