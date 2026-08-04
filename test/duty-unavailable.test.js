// Window matching for the soft unavailability flags (design §4).
//
// PURE MODULE — loaded on its own with no STATE and no DOM, which is the point:
// the matching rule is a string comparison on inclusive ISO bounds, and nothing
// about it should need a browser to verify.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { sourceText } = require("./sources");

function load() {
  const ctx = { console, JSON, Math, Date, String, Number, Object, Boolean };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js/duty-unavailable.js"), "utf8"), ctx);
  return name => vm.runInContext(name, ctx);
}

// The view half needs the real bundles in one shared global scope. A fresh vm
// context per call, deliberately: a context cannot be re-entered from outside,
// so there is no way to add a bundle to one that already exists.
const VIEW_BUNDLE = [
  "js/state.js", "js/calc.js", "js/appointment-4d.js", "js/helpers.js",
  "js/duty-points.js", "js/duty-eligibility.js", "js/duty-unavailable.js",
  "js/render-duty.js"
];

function loadView(caps) {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol, Promise, encodeURIComponent,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout,
    window: { addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }) },
    document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
    navigator: { userAgent: "node" }, fetch: () => Promise.reject(new Error("no net")),
    // render-duty.js registers its delegated handlers at load time and
    // js/actions.js is not in this bundle. Stubbed rather than loaded: these
    // suites are about what gets drawn, not about who handles a click.
    registerActions: () => {}
  };
  const ctx = new Proxy(target, {
    has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; }
  });
  vm.createContext(ctx);
  const src = VIEW_BUNDLE.map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n")
    + "\n;\n" + sourceText("render")
    + "\n;this.STATE = STATE;\n";
  vm.runInContext(src, ctx, { filename: "bundle.js" });
  const S = vm.runInContext("STATE", ctx);
  S.role = "commander";
  S.caps = caps === undefined ? ["duty"] : caps;
  return { g: name => vm.runInContext(name, ctx), S };
}

function seedView(g, S) {
  // `active: true`, not a status string — activePlatoons() filters on the
  // boolean, and a plausible-looking `status: "Active"` silently falls through
  // to the roster-derived fallback.
  S.platoons = [{ code: "PLT1", displayName: "PLT1", active: true }];
  S.roster = g("normalizeRoster")([
    { "4d": 11, name: "Alpha", rank: "LTA", role: "Commander", status: "Active", platoon: "PLT1", section: "Command" }
  ]);
  S.duty = [{ id: "d1", date: "2026-09-03", dutyType: "CDO", platoon: "", d4: "0011" }];
  S.dutyUnavailable = g("normalizeDutyUnavailable")([
    { id: "u1", d4: "0011", from: "2026-09-01", to: "2026-09-05", note: "exam period" }
  ]);
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

  suite("duty unavailability: highlight");

  await test("a flagged assignment is marked, and the note is on it", () => {
    const { g, S } = loadView();
    seedView(g, S);
    const idx = g("duIndexByPerson")(S.dutyUnavailable);
    const mark = g("dutyUnavailMark")(idx, "0011", "2026-09-03");
    ok(mark, "a duty inside a flagged window was not marked");
    ok(/exam period/.test(mark), "the note is not on the marker, so the highlight is unexplained");
  });

  await test("an assignment outside every window is not marked", () => {
    const { g, S } = loadView();
    seedView(g, S);
    const idx = g("duIndexByPerson")(S.dutyUnavailable);
    eq(g("dutyUnavailMark")(idx, "0011", "2026-09-20"), "", "a duty outside the window was marked");
    eq(g("dutyUnavailMark")(idx, "", "2026-09-03"), "", "an empty slot was marked");
  });

  await test("overlapping windows both name themselves on the marker", () => {
    const { g, S } = loadView();
    seedView(g, S);
    S.dutyUnavailable = g("normalizeDutyUnavailable")([
      { id: "u1", d4: "0011", from: "2026-09-01", to: "2026-09-05", note: "exam period" },
      { id: "u2", d4: "0011", from: "2026-09-03", to: "2026-09-08", note: "course nomination" }
    ]);
    const mark = g("dutyUnavailMark")(g("duIndexByPerson")(S.dutyUnavailable), "0011", "2026-09-03");
    ok(/exam period/.test(mark) && /course nomination/.test(mark),
      "one of two overlapping reasons was silently dropped");
  });

  await test("a non-planner gets no marker", () => {
    const { g, S } = loadView([]);
    seedView(g, S);
    eq(g("dutyUnavailMark")(g("duIndexByPerson")(S.dutyUnavailable), "0011", "2026-09-03"), "",
      "a non-planner was shown a planning flag");
  });

  await test("the month grid marks the flagged cell", () => {
    const { g, S } = loadView();
    seedView(g, S);
    const today = g("todayISO")();
    S.duty = [{ id: "d1", date: today, dutyType: "CDO", platoon: "", d4: "0011" }];
    S.dutyUnavailable = g("normalizeDutyUnavailable")([
      { id: "u1", d4: "0011", from: today, to: today, note: "exam period" }
    ]);
    const html = g("dutyGridHTML")(g("dutyConfig")());
    ok(/duty-unavail/.test(html), "the grid drew no highlight for a flagged assignment");
  });

  await test("the grid leaves an unflagged month clean", () => {
    const { g, S } = loadView();
    seedView(g, S);
    const today = g("todayISO")();
    S.duty = [{ id: "d1", date: today, dutyType: "CDO", platoon: "", d4: "0011" }];
    S.dutyUnavailable = [];
    ok(!/duty-unavail/.test(g("dutyGridHTML")(g("dutyConfig")())),
      "the grid highlighted a cell with no flag behind it");
  });

  suite("duty unavailability: panel");

  await test("the panel lists live flags with person, window and note", () => {
    const { g, S } = loadView();
    seedView(g, S);
    const html = g("dutyUnavailHTML")(g("dutyConfig")());
    ok(/Alpha/.test(html), "the person is not named");
    ok(/2026-09-01/.test(html) && /2026-09-05/.test(html), "the window bounds are not shown");
    ok(/exam period/.test(html), "the note is not shown");
  });

  await test("expired flags are hidden until asked for", () => {
    const { g, S } = loadView();
    seedView(g, S);
    S.dutyUnavailable = g("normalizeDutyUnavailable")([
      { id: "u1", d4: "0011", from: "2020-01-01", to: "2020-01-05", note: "ancient history" }
    ]);
    const html = g("dutyUnavailHTML")(g("dutyConfig")());
    ok(!/ancient history/.test(html),
      "an expired flag was listed by default — the list would never prune itself");
    ok(/Show expired \(1\)/.test(html), "the toggle does not say how many are hidden");
    // The module flag is set directly rather than through setDutyShowExpired:
    // that setter ends in render(), which redraws the whole app and needs a real
    // DOM. What matters here is what the panel draws in each state; the button's
    // own data-value below is what proves the two are wired together.
    ok(/data-action="dutyUnavailExpired" data-value="1"/.test(html),
      "the toggle does not ask for the opposite state");
    g("_dutyShowExpired = true");
    const shown = g("dutyUnavailHTML")(g("dutyConfig")());
    ok(/ancient history/.test(shown), "showing expired did not reveal the lapsed window");
    ok(/expired<\/span>/.test(shown), "a lapsed window is not marked as expired in the list");
    ok(/data-value="0"/.test(shown), "the toggle does not offer to hide them again");
  });

  await test("a non-planner gets no add or delete controls", () => {
    const { g, S } = loadView([]);
    seedView(g, S);
    const html = g("dutyUnavailHTML")(g("dutyConfig")());
    ok(!/dutyUnavailNew/.test(html), "a non-planner was offered the add control");
    ok(!/dutyUnavailDelete/.test(html), "a non-planner was offered a delete control");
    // The list itself stays readable: the grid highlight already implies the
    // flags exist, and showing the highlight while hiding its explanation is
    // the worse of the two.
    ok(/exam period/.test(html), "a non-planner cannot see why a duty is highlighted");
  });

  await test("a planner gets both controls", () => {
    const { g, S } = loadView();
    seedView(g, S);
    const html = g("dutyUnavailHTML")(g("dutyConfig")());
    ok(/dutyUnavailNew/.test(html), "a planner was not offered the add control");
    ok(/dutyUnavailDelete/.test(html), "a planner was not offered a delete control");
  });
};
