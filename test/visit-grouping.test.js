// Multi-status visit grouping (Feature 29). DISPLAY ONLY — submitMedical already
// writes sibling rows sharing a visitId, so this groups what storage already
// relates. The interesting cases are the ones that must NOT group: legacy rows
// with no visitId, and two different people who happen to share a date.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

function loadCtx() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8"),
    ctx, { filename: "helpers.js" });
  return ctx;
}
const g = (ctx, rows) => vm.runInContext(`groupByVisit(${JSON.stringify(rows)})`, ctx);

module.exports = async function run() {
  suite("medical: visit grouping");
  const c = loadCtx();

  await test("siblings sharing a visitId collapse into one group", () => {
    const out = g(c, [
      { id: "1", d4: "0123", visitId: "V1", status: "LD", startDate: "01 Jan 2026", endDate: "02 Jan 2026" },
      { id: "2", d4: "0123", visitId: "V1", status: "Excuse RMJ", startDate: "01 Jan 2026", endDate: "04 Jan 2026" }
    ]);
    eq(out.length, 1, "one visit, one row");
    eq(out[0].rows.length, 2, "both statuses retained for stacked rendering");
    eq(out[0].first.id, "1", "first sibling drives Edit");
  });

  await test("legacy rows with no visitId stay standalone", () => {
    const out = g(c, [
      { id: "1", d4: "0123", status: "LD", startDate: "01 Jan 2026" },
      { id: "2", d4: "0123", status: "Excuse RMJ", startDate: "01 Jan 2026" }
    ]);
    eq(out.length, 2, "no visitId means no relationship to infer");
  });

  await test("a blank-string visitId is treated as absent, not as a shared key", () => {
    const out = g(c, [
      { id: "1", d4: "0123", visitId: "", status: "LD" },
      { id: "2", d4: "0124", visitId: "", status: "MC" }
    ]);
    eq(out.length, 2, "two different people must never merge on an empty key");
  });

  await test("the same visitId across different 4Ds does not merge", () => {
    const out = g(c, [
      { id: "1", d4: "0123", visitId: "V1", status: "LD" },
      { id: "2", d4: "0124", visitId: "V1", status: "MC" }
    ]);
    eq(out.length, 2, "grouping is keyed on d4 + visitId, defending against id reuse");
  });

  await test("input order is preserved by first-seen", () => {
    const out = g(c, [
      { id: "9", d4: "0999", visitId: "V9", status: "MC" },
      { id: "1", d4: "0123", visitId: "V1", status: "LD" },
      { id: "2", d4: "0123", visitId: "V1", status: "Excuse RMJ" }
    ]);
    eq(out[0].first.id, "9");
    eq(out[1].first.id, "1");
  });

  // ── Cases the plan did not name, but the callers depend on ──────────────

  await test("non-adjacent siblings still merge, and the group keeps its FIRST position", () => {
    // The medical table sorts by date, so an interleaved third party is normal.
    // A naive "collapse only consecutive duplicates" implementation passes every
    // test above and silently splits this into three rows.
    const out = g(c, [
      { id: "1", d4: "0123", visitId: "V1", status: "LD" },
      { id: "5", d4: "0555", visitId: "V5", status: "MC" },
      { id: "2", d4: "0123", visitId: "V1", status: "Excuse RMJ" }
    ]);
    eq(out.length, 2, "the split sibling must rejoin its group");
    eq(out[0].first.id, "1", "the group holds the position of its first sibling");
    eq(out[0].rows.length, 2);
    eq(out[1].first.id, "5");
  });

  await test("every group exposes a unique key, so a DOM keyed on it cannot collide", () => {
    const out = g(c, [
      { id: "1", d4: "0123", visitId: "V1", status: "LD" },
      { id: "2", d4: "0123", visitId: "V1", status: "Excuse RMJ" },
      { id: "3", d4: "0123", status: "MC" },
      { id: "4", d4: "0123", status: "Excuse RMJ" }
    ]);
    eq(out.length, 3);
    eq([...new Set(out.map(x => x.key))].length, 3, "solo groups must not share a key");
  });

  await test("a numeric visitId matches its string form — sheets coerce types on the way back", () => {
    // Medical.visitId is not in WRITE_TEXT_COLS_BY_TAB, so a numeric-looking id
    // comes back from the sheet as a Number while the in-memory sibling written
    // this session is still a String. Keying on the raw value would split a
    // visit in half the first time the page reloads.
    const out = g(c, [
      { id: "1", d4: "0123", visitId: 1753600000000, status: "LD" },
      { id: "2", d4: "0123", visitId: "1753600000000", status: "Excuse RMJ" }
    ]);
    eq(out.length, 1, "the same visit must survive a round trip through the sheet");
    eq(out[0].rows.length, 2);
  });

  await test("an empty or absent record list yields no groups", () => {
    eq(g(c, []).length, 0);
    eq(vm.runInContext("groupByVisit(null).length", c), 0);
    eq(vm.runInContext("groupByVisit(undefined).length", c), 0);
  });

  await test("rows are held by reference, not copied", () => {
    // Callers render per-row delete buttons off grp.rows[i].id and compare
    // identity against STATE.medical; a defensive clone would break that.
    const out = vm.runInContext(`(() => {
      const a = { id: "1", d4: "0123", visitId: "V1", status: "LD" };
      const out = groupByVisit([a]);
      return out[0].rows[0] === a && out[0].first === a;
    })()`, c);
    ok(out, "groups must reference the caller's own record objects");
  });
};
