// Window matching for the soft unavailability flags (design §4).
//
// PURE MODULE — loaded on its own with no STATE and no DOM, which is the point:
// the matching rule is a string comparison on inclusive ISO bounds, and nothing
// about it should need a browser to verify.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

function load() {
  const ctx = { console, JSON, Math, Date, String, Number, Object, Boolean };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js/duty-unavailable.js"), "utf8"), ctx);
  return name => vm.runInContext(name, ctx);
}

const FLAG = { id: "u1", d4: "0042", from: "2026-09-01", to: "2026-09-05", note: "exam period" };

module.exports = async function run() {
  suite("duty unavailability: window matching");

  await test("both bounds are inclusive", () => {
    const g = load();
    ok(g("duCovers")(FLAG, "2026-09-01"), "the first day of the window did not match");
    ok(g("duCovers")(FLAG, "2026-09-05"), "the last day of the window did not match");
    ok(g("duCovers")(FLAG, "2026-09-03"), "a day inside the window did not match");
  });

  await test("days outside the window do not match", () => {
    const g = load();
    ok(!g("duCovers")(FLAG, "2026-08-31"), "the day before the window matched");
    ok(!g("duCovers")(FLAG, "2026-09-06"), "the day after the window matched");
  });

  await test("a single-day window matches exactly one day", () => {
    const g = load();
    const one = { ...FLAG, from: "2026-09-03", to: "2026-09-03" };
    ok(g("duCovers")(one, "2026-09-03"), "a one-day window did not match its own day");
    ok(!g("duCovers")(one, "2026-09-04"), "a one-day window matched the next day");
  });

  await test("a malformed flag matches nothing rather than everything", () => {
    const g = load();
    // The failure mode that matters. A missing bound read as open-ended would
    // highlight every duty that person ever draws, for ever, with nothing on
    // screen to explain why. Inert is the recoverable reading; the add form is
    // what guarantees both bounds exist.
    ok(!g("duCovers")({ d4: "0042", from: "2026-09-01", to: "" }, "2026-09-03"), "a missing `to` matched");
    ok(!g("duCovers")({ d4: "0042", from: "", to: "2026-09-05" }, "2026-09-03"), "a missing `from` matched");
    ok(!g("duCovers")(null, "2026-09-03"), "a null flag matched");
    ok(!g("duCovers")(FLAG, ""), "an empty date matched");
  });

  await test("the index groups by person and finds the day's flags", () => {
    const g = load();
    const idx = g("duIndexByPerson")([
      FLAG,
      { id: "u2", d4: "0042", from: "2026-10-01", to: "2026-10-02", note: "course" },
      { id: "u3", d4: "0099", from: "2026-09-01", to: "2026-09-05", note: "reservist" }
    ]);
    eq(g("duFlagsOn")(idx, "0042", "2026-09-03").length, 1, "the wrong number of flags on the day");
    eq(g("duFlagsOn")(idx, "0042", "2026-09-03")[0].note, "exam period", "the wrong flag came back");
    eq(g("duFlagsOn")(idx, "0042", "2026-10-01").length, 1, "the second window did not match");
    eq(g("duFlagsOn")(idx, "0099", "2026-10-01").length, 0, "another person's window matched");
    eq(g("duFlagsOn")(idx, "0007", "2026-09-03").length, 0, "an unflagged person got flags");
  });

  await test("overlapping windows both come back", () => {
    const g = load();
    // Two flags can legitimately overlap — an exam block and a pending course
    // nomination — and whatever is shown must not silently be only one of them.
    const idx = g("duIndexByPerson")([
      FLAG,
      { id: "u2", d4: "0042", from: "2026-09-04", to: "2026-09-10", note: "course" }
    ]);
    eq(g("duFlagsOn")(idx, "0042", "2026-09-04").length, 2, "an overlapping window was lost");
  });

  suite("duty unavailability: expiry and ordering");

  await test("a window is expired only once it is wholly in the past", () => {
    const g = load();
    ok(!g("duIsExpired")(FLAG, "2026-09-05"), "a window expired on its own last day");
    ok(g("duIsExpired")(FLAG, "2026-09-06"), "a finished window was not expired");
    ok(!g("duIsExpired")(FLAG, "2026-08-01"), "a future window was reported expired");
  });

  await test("flags sort by start date, then end date", () => {
    const g = load();
    const sorted = g("duSortFlags")([
      { id: "b", d4: "0042", from: "2026-10-01", to: "2026-10-02" },
      { id: "a", d4: "0042", from: "2026-09-01", to: "2026-09-05" },
      { id: "c", d4: "0011", from: "2026-09-01", to: "2026-09-02" }
    ]);
    eq(sorted.map(f => f.id).join(""), "cab", "flags did not sort by start date then end date");
  });

  await test("sorting does not mutate the caller's array", () => {
    const g = load();
    // STATE.dutyUnavailable is the live array; a sort in place would reorder the
    // cache as a side effect of drawing a panel.
    const rows = [{ id: "b", from: "2026-10-01", to: "2026-10-02" }, { id: "a", from: "2026-09-01", to: "2026-09-05" }];
    g("duSortFlags")(rows);
    eq(rows[0].id, "b", "duSortFlags sorted the caller's array in place");
  });
};
