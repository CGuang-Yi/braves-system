// nowHHMM — the injectable clock behind the conduct wizard's fallout-time
// autofill. Loaded into a vm with a fixed fake Date so the assertion is exact
// rather than a format regex: the zero-padding on BOTH halves is the whole
// point of the helper, and a regex like /^\d{4}$/ passes on "7:5" mangled into
// four characters by some other route.
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { suite, test, eq } = require("./_tap");

const SRC = fs.readFileSync(path.resolve(__dirname, "..", "js", "helpers.js"), "utf8");

// helpers.js is a browser-global script full of eager top-level declarations
// referring to collaborators in other bundles. Same trick the other unit
// suites use: a Proxy global with `has: () => true` makes every unresolved
// free identifier read as undefined instead of throwing at load.
function loadWithClock(hours, minutes) {
  const target = {
    console, JSON, Math, String, Number, Object, Boolean, Set, Map, RegExp,
    Array, isNaN, parseInt, parseFloat, Symbol,
    Date: function FakeDate() {
      this.getHours = () => hours;
      this.getMinutes = () => minutes;
    }
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: "helpers.js" });
  return vm.runInContext("nowHHMM()", ctx);
}

module.exports = async function () {
  suite("nowHHMM: 4-digit HHMM, zero-padded on both halves");

  await test("a single-digit hour AND minute are both padded", () => {
    eq(loadWithClock(7, 5), "0705");
  });

  await test("midnight is 0000, not an empty string or '00'", () => {
    eq(loadWithClock(0, 0), "0000");
  });

  await test("a two-digit hour and minute pass through unpadded", () => {
    eq(loadWithClock(17, 45), "1745");
  });

  await test("the last minute of the day is 2359", () => {
    eq(loadWithClock(23, 59), "2359");
  });
};
