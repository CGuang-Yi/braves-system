// js/state.js pure-utility tests. state.js is a browser-global script with a
// top-level `const STATE = { authToken: localStorage.getItem(...), ... }`, so
// it needs a stubbed localStorage to load in a vm context (same approach as
// the DEFAULT_CONFIG test in ha.test.js).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

function loadState() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "state.js"), "utf8"), ctx, { filename: "state.js" });
  return target;
}

module.exports = async function run() {
  const S = loadState();

  suite("state: mergeAttendanceEdit (wizard field-strip fix)");

  await test("editing an existing row preserves CSV-only fields the wizard doesn't know about", () => {
    // Shape of a real CSV-imported row (HA_DATA_SHAPE.md): participants/periods/
    // currencyTags/source. The Log Conduct wizard's entry only carries the
    // fields it manages (id/date/time/conductId/total/participating/lms/px/
    // fallout/remarks) — editing must not blank the CSV fields.
    const existing = {
      id: 11570, date: "18 Jun 2026", time: "0800", conductId: "c11509",
      total: 253, participating: 209, lms: 0, px: 19, fallout: 33, remarks: "Metabolic Circuit 4",
      participants: "1101,1102,1103", periods: 2, currencyTags: "HA", source: "csv"
    };
    const entry = {
      id: 11570, date: "18 Jun 2026", time: "0830", conductId: "c11509",
      total: 253, participating: 205, lms: 0, px: 23, fallout: 33, remarks: "Metabolic Circuit 4 (edited)"
    };
    const merged = S.mergeAttendanceEdit(existing, entry);
    eq(merged.participants, "1101,1102,1103", "participants must survive the edit");
    eq(merged.periods, 2, "periods must survive the edit");
    eq(merged.currencyTags, "HA", "currencyTags must survive the edit");
    eq(merged.source, "csv", "source must survive the edit — this is what gates HA credit");
    // Fields the wizard DOES manage must still take the new value.
    eq(merged.time, "0830");
    eq(merged.participating, 205);
    eq(merged.remarks, "Metabolic Circuit 4 (edited)");
  });

  await test("a brand-new row (no existing) passes through unchanged", () => {
    const entry = { id: 999, date: "1 Jul 2026", time: "0800", conductId: "c1", total: 10, participating: 10, lms: 0, px: 0, fallout: 0, remarks: "" };
    const merged = S.mergeAttendanceEdit(undefined, entry);
    eq(merged, entry);
    ok(!("participants" in merged), "new wizard rows have no CSV fields to fabricate");
  });
};
