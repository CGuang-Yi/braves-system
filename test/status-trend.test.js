// 14-day status trend (Feature 26). Every rule here is an explicit decision, and
// most are EXCLUSIONS — Active omitted (it would flatten everything), ghost
// recovery tags omitted entirely, all Excuse* collapsed to one series, and a
// top-8 cap because statuses are user-extensible.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");
const { expandFiles } = require("./sources");

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
// effectiveByDay: [{ iso, entries: [{ d4, statuses: [{tag, ghostDay}] }] }]
const run1 = (ctx, byDay, cap) => vm.runInContext(
  `statusTrendSeries(${JSON.stringify(byDay)}, ${byDay.length}, ${cap == null ? 8 : cap})`, ctx);

const day = (iso, tags) => ({ iso, entries: tags.map((t, i) => ({ d4: "01" + i, statuses: [t] })) });
const tag = (t, ghostDay) => ({ tag: t, ghostDay: ghostDay || 0 });

module.exports = async function run() {
  suite("dashboard: 14-day status trend");
  const c = loadCtx();

  await test("every Excuse variant collapses into ONE Excuse series", () => {
    const r = run1(c, [day("2026-07-01", [tag("Excuse RMJ"), tag("Excuse Swimming"), tag("Excuse PT")])]);
    const names = r.series.map(s => s.label);
    eq(names.filter(n => n.indexOf("Excuse") === 0).length, 1, "exactly one Excuse line: " + names.join(","));
    eq(r.series.find(s => s.label === "Excuse").data[0], 3, "all three counted into it");
  });

  await test("Active is omitted", () => {
    const r = run1(c, [day("2026-07-01", [tag("Active"), tag("MC")])]);
    ok(!r.series.some(s => s.label === "Active"), "Active would dwarf every other line");
  });

  await test("ghost recovery tags are omitted entirely — not folded into MC/LD", () => {
    const r = run1(c, [day("2026-07-01", [tag("MC+1", 1), tag("LD+2", 2), tag("MC")])]);
    const mc = r.series.find(s => s.label === "MC");
    eq(mc.data[0], 1, "only the live MC counted");
    ok(!r.series.some(s => s.label === "MC+1" || s.label === "LD+2"), "no ghost series");
  });

  await test("a custom non-Excuse status gets its own series", () => {
    const r = run1(c, [day("2026-07-01", [tag("Light Duty Bunk")])]);
    ok(r.series.some(s => s.label === "Light Duty Bunk"));
  });

  await test("beyond the cap, the tail folds into Other", () => {
    const tags = ["MC", "LD", "RIB", "RMJ", "Warded", "Pending", "NIL", "AAA", "BBB", "CCC"].map(t => tag(t));
    const r = run1(c, [day("2026-07-01", tags)], 8);
    eq(r.series.length, 9, "8 capped series plus Other");
    ok(r.series.some(s => s.label === "Other"));
  });

  await test("labels track the input days and every series is the same length", () => {
    const r = run1(c, [day("2026-07-01", [tag("MC")]), day("2026-07-02", [tag("MC"), tag("LD")])]);
    eq(r.labels.length, 2);
    r.series.forEach(s => eq(s.data.length, 2, s.label + " is padded to the full window"));
  });

  // The cap ranks by PEAK, not total, so a status that spiked once still earns a
  // line instead of being averaged into invisibility across the window.
  await test("the cap ranks by peak, not by total across the window", () => {
    const spike = { iso: "2026-07-01", entries: [] };
    const steady = { iso: "2026-07-02", entries: [] };
    for (let i = 0; i < 9; i++) spike.entries.push({ d4: "S" + i, statuses: [tag("SPIKE")] });
    for (let d = 0; d < 2; d++) for (let i = 0; i < 5; i++)
      (d ? steady : spike).entries.push({ d4: "T" + i, statuses: [tag("STEADY")] });
    const r = run1(c, [spike, steady], 1);
    eq(r.series[0].label, "SPIKE", "the one-day spike (peak 9) outranks the steady 5+5 total of 10");
  });

  // A person carrying MC AND Excuse RMJ on the same day is two data points, not
  // one — the chart counts STATUSES, matching the old doughnut's slice tallies.
  await test("one person with stacked statuses counts into each series", () => {
    const r = run1(c, [{ iso: "2026-07-01", entries: [{ d4: "0101", statuses: [tag("MC"), tag("Excuse RMJ")] }] }]);
    eq(r.series.find(s => s.label === "MC").data[0], 1);
    eq(r.series.find(s => s.label === "Excuse").data[0], 1);
  });

  // A status absent on a given day must read 0 there, not go missing — otherwise
  // Chart.js would draw the line straight through the gap and imply continuity.
  await test("a status absent on a day is an explicit zero, not a hole", () => {
    const r = run1(c, [day("2026-07-01", [tag("MC")]), day("2026-07-02", [tag("LD")])]);
    eq(r.series.find(s => s.label === "MC").data[1], 0, "MC reads zero on the day it is absent");
    eq(r.series.find(s => s.label === "LD").data[0], 0, "LD reads zero on the day it is absent");
  });

  await test("an empty window yields labels and no series rather than throwing", () => {
    const r = run1(c, []);
    eq(r.labels.length, 0);
    eq(r.series.length, 0);
  });

  // Guard the exact exclusion pair together: a day of nothing BUT excluded tags
  // must produce no series at all, not an empty-data "Active"/ghost line.
  await test("a day of only Active and ghost tags produces no series", () => {
    const r = run1(c, [day("2026-07-01", [tag("Active"), tag("MC+1", 1), tag("LD+1", 1)])]);
    eq(r.series.length, 0, "got: " + r.series.map(s => s.label).join(","));
  });

  // ── the range selector's window resolution (render.js) ─────────────────────
  // buildStatusTrendChart recomputes the WHOLE effective medical layer once per
  // day in the window, synchronously, straight out of the pill's onclick. The
  // 7/14/30 pills are bounded by construction; "All" is derived from the data
  // and so needs an explicit ceiling or a long-running sheet freezes the tab.
  suite("dashboard: status trend range selector");

  function loadRender(medical, todayIso) {
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, Symbol
    };
    const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    vm.createContext(ctx);
    for (const f of expandFiles(["helpers.js", "render.js"])) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f });
    }
    target.STATE = { medical, roster: [], charts: {} };
    target.todayISO = () => todayIso;
    // No canvas ⇒ buildStatusTrendChart early-returns, so setStatusTrendDays
    // exercises the window/label logic without needing Chart.js. strengthRoster
    // is stubbed for the same reason — the scope derivation is covered by
    // dashboard-strength.test.js and is not what these assertions are about.
    target.document = { getElementById: () => null };
    target.strengthRoster = () => [];
    return target;
  }
  // startDate is what statusTrendWindowDays scans; display format, as stored.
  const med = display => ({ id: 1, d4: "0101", status: "MC", startDate: display, endDate: display });

  await test('"All" is capped, and the label says so instead of overclaiming', () => {
    const R = loadRender([med("01 Jan 2024")], "2026-08-02");
    R.setStatusTrendDays("all");
    ok(R.statusTrendFullSpanDays() > 900, "fixture should span years: " + R.statusTrendFullSpanDays());
    eq(R.statusTrendWindowDays(), 400, "the uncapped span would be computed per-day over every medical row");
    ok(/^latest 400 days of \d+$/.test(R.statusTrendRangeLabel()),
      'a capped window must not read as "all time": ' + R.statusTrendRangeLabel());
  });

  await test('"All" within the cap still reports the true full span', () => {
    const R = loadRender([med("01 Jul 2026")], "2026-08-02");
    R.setStatusTrendDays("all");
    eq(R.statusTrendWindowDays(), 33, "01 Jul -> 02 Aug inclusive");
    eq(R.statusTrendRangeLabel(), "all time · 33 days");
  });

  await test("the fixed pills are unaffected by the cap", () => {
    const R = loadRender([med("01 Jan 2024")], "2026-08-02");
    R.setStatusTrendDays("30");
    eq(R.statusTrendWindowDays(), 30);
    eq(R.statusTrendRangeLabel(), "30 days");
  });

  await test("an empty medical layer floors at 14 days rather than collapsing", () => {
    const R = loadRender([], "2026-08-02");
    R.setStatusTrendDays("all");
    eq(R.statusTrendWindowDays(), 14);
  });
};
