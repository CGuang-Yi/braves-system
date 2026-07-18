// Guards the dashboard scoped-participation wiring (render.js <-> calc.js).
// Regression: the scoped AVG PART. tile once called a non-existent helper
// `filterVisibleSet` guarded by `typeof ... === "function"`, which silently
// evaluated to null so the tile never actually scoped while its label claimed
// it did. The real helper is `visibleD4Set()` (helpers.js). This test fails if
// render.js references the wrong name or stops wiring scopedParticipation.
const fs = require("fs");
const path = require("path");
const { suite, test, ok } = require("./_tap");

module.exports = async function run() {
  suite("render wiring: scoped participation");
  const render = fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8");
  const helpers = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const parade = fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8");

  await test("render.js does not reference the non-existent filterVisibleSet", () => {
    ok(!render.includes("filterVisibleSet"), "render.js still references undefined filterVisibleSet");
  });

  await test("the Not Available tile delegates to bpIsNotAvailable (Bug 2)", () => {
    ok(render.includes("bpIsNotAvailable("), "render.js no longer uses the bpIsNotAvailable helper");
    ok(parade.includes("function bpIsNotAvailable"), "bpIsNotAvailable is not defined in braves-parade.js");
    // It must NOT fall back to the old over-broad predicate that counted RSO.
    ok(!render.includes("c.sections.mr.length > 0 || c.sections.reportingSick.length > 0"),
      "render.js still uses the old Not-Available predicate (counts RSO)");
  });

  await test("the scope-set helper render.js relies on is actually defined", () => {
    ok(render.includes("visibleD4Set("), "render.js no longer calls visibleD4Set()");
    ok(helpers.includes("function visibleD4Set"), "visibleD4Set is not defined in helpers.js");
  });

  await test("the AVG PART tile wires scopedParticipation with the visible set", () => {
    ok(render.includes("scopedParticipation(STATE.attendance, STATE.conductDetail, visible)"),
      "render.js no longer passes the visible set into scopedParticipation");
  });

  suite("render wiring: conduct dashboard + lazy-load (Phase 2)");

  await test("Conduct Dashboard view is wired end to end", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    const calc = fs.readFileSync(path.join(__dirname, "..", "js", "calc.js"), "utf8");
    ok(html.includes('data-nav="conductdash"'), "no Conduct Dashboard nav button in index.html");
    ok(render.includes('case "conductdash": renderConductDashboard'), "render() does not route conductdash");
    ok(render.includes("function renderConductDashboard"), "renderConductDashboard missing");
    ok(render.includes("conductBuildup(") && render.includes("perConductParticipation("),
      "render.js does not use the calc.js conduct aggregators");
    ok(calc.includes("function conductBuildup") && calc.includes("function perConductParticipation"),
      "calc.js conduct aggregators missing");
  });

  await test("lazy-load gate is wired for both heavy views", () => {
    const state = fs.readFileSync(path.join(__dirname, "..", "js", "state.js"), "utf8");
    const sync = fs.readFileSync(path.join(__dirname, "..", "js", "sync.js"), "utf8");
    ok(state.includes("function shouldDeferCharts"), "shouldDeferCharts missing in state.js");
    ok(render.includes("shouldDeferCharts()"), "render.js never consults shouldDeferCharts");
    ok(render.includes("loadDashboardCharts") && render.includes("loadConductDashCharts"),
      "chart loaders for the two heavy views are not both wired");
    ok(sync.includes("setChartPref(") && sync.includes("Display / Performance"),
      "Settings page is missing the lazy-load control");
  });

  await test("conduct class scoping + progression list are wired", () => {
    const calc = fs.readFileSync(path.join(__dirname, "..", "js", "calc.js"), "utf8");
    ok(calc.includes("function parseConductSeries") && calc.includes("function conductProgress"),
      "calc.js series/progression helpers missing");
    ok(render.includes("parseConductSeries(") && render.includes("conductProgress("),
      "render.js does not use the series/progression helpers");
    ok(render.includes("function setConductSeries"), "no conduct-class selector handler");
    ok(render.includes("Class Progression"), "progression list not rendered");
  });

  await test("status grid is lazy-loaded behind the shared chart pref", () => {
    ok(render.includes("function loadStatusGrid"), "no status-grid loader");
    ok(render.includes("function renderSBGrid") && render.includes("_sbGridShown"),
      "renderSBGrid does not gate on the _sbGridShown flag");
    // The grid defer decision must reuse shouldDeferCharts so one pref governs all
    // heavy views; sbGridNav must keep the grid shown once loaded.
    ok(/renderSBGrid[\s\S]{0,400}shouldDeferCharts\(\)/.test(render),
      "renderSBGrid never consults shouldDeferCharts");
    ok(/function sbGridNav[\s\S]{0,120}_sbGridShown = true/.test(render),
      "sbGridNav re-defers the grid instead of keeping it shown");
  });

  suite("parade-tab wiring: Mark Present books in via bookInDate, never truncates (item 4c)");
  const paradeTab = fs.readFileSync(path.join(__dirname, "..", "js", "parade-tab.js"), "utf8");

  await test("paradeEndActiveContributors sets bookInDate and no longer truncates active records to yesterday", () => {
    ok(/m\.bookInDate\s*=\s*isoToDisplayDate\(iso\)/.test(paradeTab), "active Medical is not booked in via bookInDate");
    ok(/l\.bookInDate\s*=\s*isoToDisplayDate\(iso\)/.test(paradeTab), "active Leave is not booked in via bookInDate");
    ok(!/l\.endDate\s*=\s*yest/.test(paradeTab), "active Leave is still truncated to yesterday");
    ok(!/else\s+m\.endDate\s*=\s*yest/.test(paradeTab), "active Medical is still truncated to yesterday");
  });

  await test("paradeClearPerson books in a grace-window ended MC", () => {
    ok(/graceMc[\s\S]{0,200}bookInDate\s*=\s*isoToDisplayDate\(iso\)/.test(paradeTab),
      "the grace-window ended MC is not booked in on Mark Present");
  });

  suite("parade grid wiring: only MC / AL·OIL / OTHERS rows are editable (item 5)");

  await test("renderParadePlatoon gates the <select> behind the editable-code set", () => {
    ok(/const PARADE_EDITABLE_CODES\s*=\s*\["MC",\s*"AL\/OIL",\s*"OTHERS"\]/.test(paradeTab),
      "no PARADE_EDITABLE_CODES gate defined");
    ok(/PARADE_EDITABLE_CODES\.includes\(x\.code\)/.test(paradeTab),
      "renderParadePlatoon does not gate the code cell on PARADE_EDITABLE_CODES");
    // The editable branch offers exactly the current code + Present, not the full list.
    ok(/<option value="Present">Present<\/option>/.test(paradeTab),
      "the editable select no longer offers a Present option");
    ok(!/PARADE_CODES\.map\(c =>[\s\S]{0,120}onParadeCodeChange/.test(paradeTab),
      "the grid still renders the full PARADE_CODES <select> for every row");
  });

  suite("render wiring: roster status badge derives from the medical layer (item 4b)");

  await test("the Roster list badges rosterDisplayStatus, not the raw stored status", () => {
    ok(render.includes("rosterDisplayStatus(r)"), "render.js Roster list no longer calls rosterDisplayStatus(r)");
    ok(helpers.includes("function rosterDisplayStatus"), "rosterDisplayStatus is not defined in helpers.js");
    ok(!/<td>\$\{statusBadge\(r\.status\)\}<\/td>/.test(render), "render.js still badges the raw stored r.status in the Roster row");
  });
};
