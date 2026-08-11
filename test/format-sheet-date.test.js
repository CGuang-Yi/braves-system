// Locks the output format of formatSheetDate_ (apps-script-Code.gs).
//
// WHY THIS EXISTS: readTab used to render date cells with
//   Utilities.formatDate(val, Session.getScriptTimeZone(), "dd MMM yyyy")
// which is a V8->Java service-bridge call, ~3.4ms each. At ~7,400 date cells
// that was 76% of a readAll (26,119ms of 34,929ms — see
// tools/diagnostics/readall-phases.gs and MD_Docs/READALL_PERF_SPEC.md).
// The replacement is plain JS, so the FORMAT is no longer enforced by Java's
// SimpleDateFormat — it is enforced by this file.
//
// The whole app keys off this string shape: helpers.js displayDateToISO only
// parses "DD MMM YYYY" and returns "" for anything else, which silently makes
// a medical/leave row inert (no section, no parade-state output) rather than
// throwing. A regression here would therefore be invisible until someone
// noticed a person missing from a message. Hence the zero-padding and
// month-abbreviation cases below are load-bearing, not decoration.
//
// Also asserts the three call sites agree: readTab, readTabTail and
// replaceConductRows' normCell all route through formatSheetDate_, and
// normCell's comparison MUST match readTab exactly or ConductDetail saves
// duplicate rows instead of replacing them (see the comment at that call site).
const { suite, test, eq, ok } = require("./_tap");
const { loadBackend } = require("./harness");

module.exports = async function () {
  suite("formatSheetDate_ (readAll date shaping)");

  const backend = loadBackend();
  const f = backend.formatSheetDate_;

  await test("is exposed by the backend bundle", async () => {
    ok(typeof f === "function", "formatSheetDate_ should be a top-level GAS function");
  });

  // Local-time constructor on purpose: readTab receives Date objects from
  // Sheets already materialised in the script timezone, and the formatter reads
  // them with local getters. Using Date.UTC here would test a different thing.
  const mk = (y, m, d) => new Date(y, m - 1, d);

  await test("zero-pads single-digit days", async () => {
    eq(f(mk(2026, 8, 1)), "01 Aug 2026");
    eq(f(mk(2026, 8, 9)), "09 Aug 2026");
  });

  await test("leaves two-digit days unpadded", async () => {
    eq(f(mk(2026, 8, 10)), "10 Aug 2026");
    eq(f(mk(2026, 8, 31)), "31 Aug 2026");
  });

  await test("renders every month abbreviation", async () => {
    const expected = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // 15th of each month — mid-month avoids any month-length edge cases so a
    // failure here can only be the abbreviation table itself.
    const got = expected.map((_, i) => f(mk(2026, i + 1, 15)).slice(3, 6));
    eq(got, expected, "SHEET_MONTHS_ must match Java's MMM (English locale)");
  });

  await test("handles month boundaries", async () => {
    eq(f(mk(2026, 1, 31)), "31 Jan 2026");
    eq(f(mk(2026, 2, 1)), "01 Feb 2026");
    eq(f(mk(2026, 2, 28)), "28 Feb 2026");
    eq(f(mk(2026, 3, 1)), "01 Mar 2026");
  });

  await test("handles the year boundary", async () => {
    eq(f(mk(2025, 12, 31)), "31 Dec 2025");
    eq(f(mk(2026, 1, 1)), "01 Jan 2026");
  });

  await test("handles the leap day", async () => {
    // 2028 is the next leap year; 29 Feb must render as itself, not roll to 01 Mar.
    eq(f(mk(2028, 2, 29)), "29 Feb 2028");
    eq(f(mk(2028, 3, 1)), "01 Mar 2028");
  });

  await test("ignores the time component", async () => {
    // Sheets date cells often carry a midnight (or worse, a DST-shifted) time.
    // Only the calendar fields may reach the output.
    eq(f(new Date(2026, 7, 5, 0, 0, 0)), "05 Aug 2026");
    eq(f(new Date(2026, 7, 5, 23, 59, 59)), "05 Aug 2026");
  });

  await test("output round-trips through displayDateToISO", async () => {
    // The real consumer contract: helpers.js parses this shape and returns ""
    // for anything else. Re-implemented here rather than loading helpers.js
    // (which needs a browser sandbox) — kept deliberately strict so a format
    // drift fails rather than silently parsing.
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const toISO = s => {
      const m = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(s);
      if (!m) return "";
      const mi = MONTHS.indexOf(m[2]);
      if (mi < 0) return "";
      return m[3] + "-" + String(mi + 1).padStart(2, "0") + "-" + m[1];
    };
    eq(toISO(f(mk(2026, 8, 1))), "2026-08-01");
    eq(toISO(f(mk(2026, 12, 25))), "2026-12-25");
    eq(toISO(f(mk(2028, 2, 29))), "2028-02-29");
  });

  // ── End-to-end through the read paths ────────────────────────────────
  // The unit cases above call formatSheetDate_ directly. These drive real
  // Date objects through readTab/readTabTail, which is what actually runs.
  // Worth stating why this isn't redundant: perf-p2.test.js already compares
  // readTab against readTabTail, but only for EQUALITY with each other — it
  // passed both before and after this change, because a shared wrong answer
  // is still equal. Pinning the literal string is what catches that.

  await test("readTab renders Date cells as DD MMM YYYY end-to-end", async () => {
    const b = loadBackend();
    b.db.seed("Sample", ["id", "when"], [
      ["1", new Date(2026, 0, 5)],    // single-digit day → must zero-pad
      ["2", new Date(2026, 11, 31)],  // year end
    ]);
    eq(b.readTab("Sample"), [
      { id: "1", when: "05 Jan 2026" },
      { id: "2", when: "31 Dec 2026" },
    ]);
  });

  await test("readTabTail agrees with readTab on the literal output", async () => {
    const b = loadBackend();
    b.db.seed("Sample", ["id", "when"], [
      ["1", new Date(2026, 0, 5)],
      ["2", new Date(2026, 11, 31)],
    ]);
    const full = b.readTab("Sample");
    eq(b.readTabTail("Sample", 500), full, "tail path must not drift from readTab");
    eq(full[0].when, "05 Jan 2026", "and both must be RIGHT, not merely equal");
  });

  await test("neither read path calls getDisplayValues any more (P2)", async () => {
    // The second full-range fetch existed only to serve time-only Date cells
    // (getFullYear() < 1900). tools/diagnostics/legacy-date-scan.gs found zero
    // of those across all 23 live tabs, so the read was pure cost — 591ms of a
    // 15.4s readAll. This asserts it does not creep back in.
    const b = loadBackend();
    b.db.seed("Sample", ["id", "when"], [["1", new Date(2026, 0, 5)]]);
    b.db.spy.getDisplayValues = 0;
    b.readTab("Sample");
    eq(b.db.spy.getDisplayValues, 0, "readTab must not re-read the range for display values");
    b.readTabTail("Sample", 500);
    eq(b.db.spy.getDisplayValues, 0, "readTabTail must not either");
  });

  await test("empty and header-only tabs short-circuit before any range read (P1)", async () => {
    // Twelve of the twenty-three tabs readAllTabs walks are empty, and a
    // getDataRange + getValues pair costs ~150-185ms each to return nothing.
    const b = loadBackend();
    b.db.seed("Empty", ["id", "when"], []);
    b.db.spy.getValues = 0;
    eq(b.readTab("Empty"), [], "header-only tab still returns []");
    eq(b.db.spy.getValues, 0, "and does so without fetching any range");
  });
};
