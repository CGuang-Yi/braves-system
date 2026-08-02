// Regression: the Dashboard / topbar STRENGTH figures must equal the parade
// state's TOTAL / CURRENT STRENGTH for the same scope.
//
// The bug: "Total Str" (and the topbar "Str:") were `filteredRoster().length` —
// a raw roster row count — while the parade state counts through bpStrength(),
// which drops genuine departures (BP_DEPARTED_STATUSES: ORD / Posted Out / …).
// A company with two ORD'd rows still in the sheet therefore showed Total Str 119
// against TOTAL STRENGTH 117. strengthRoster() (helpers.js) is the shared scope
// both surfaces now count over.
//
// state.js + calc.js + helpers.js + braves-parade.js are loaded as ONE script into
// a vm context (the browser's shared-global scope), so top-level `const STATE` is
// visible to the later files exactly as it is in the app.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { sourceText } = require("./sources");

const TODAY = "2026-07-25";
const BUNDLE = ["js/state.js", "js/calc.js", "js/helpers.js", "js/braves-parade.js"];

function load() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol, Promise, encodeURIComponent,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout,
    window: {}, document: { getElementById: () => null, addEventListener: () => {} },
    navigator: { userAgent: "node" }, fetch: () => Promise.reject(new Error("no net"))
  };
  // has:()=>true so any free identifier the bundles touch reads undefined instead
  // of throwing (section-bento.test.js pattern).
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  const src = BUNDLE.map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n")
    + "\n;this.STATE = STATE;\n";
  vm.runInContext(src, ctx, { filename: "bundle.js" });
  return { ctx, target, g: name => vm.runInContext(name, ctx) };
}

// Minimal roster: 4 present + 1 ORD (departed) + 1 on MC today (out of camp).
function seed(g, S) {
  S.roster = g("normalizeRoster")([
    { "4d": 1101, name: "Alpha",   rank: "REC", role: "Recruit",   status: "Active", platoon: "PLT1", section: "1" },
    { "4d": 1102, name: "Bravo",   rank: "REC", role: "Recruit",   status: "",       platoon: "PLT1", section: "1" },
    { "4d": 1103, name: "Charlie", rank: "REC", role: "Recruit",   status: "MC",     platoon: "PLT1", section: "1" },
    { "4d": 1104, name: "Delta",   rank: "REC", role: "Recruit",   status: "ORD",    platoon: "PLT1", section: "2" },
    { "4d": 1105, name: "Echo",    rank: "REC", role: "Recruit",   status: "Posted Out", platoon: "PLT1", section: "2" },
    { "4d": 1,    name: "OC",      rank: "MAJ", role: "Commander", status: "Active", platoon: "HQ",   section: "Command" }
  ]);
  // Charlie is on MC today → counted in TOTAL but not CURRENT strength.
  S.medical = g("normalizeMedical")([
    { id: "MED1", d4: 1103, type: "RSO", date: "25 Jul 2026", status: "MC",
      startDate: "25 Jul 2026", endDate: "27 Jul 2026", reason: "fever", bookInDate: "" }
  ]);
  S.leave = []; S.appointments = []; S.msk = [];
}

module.exports = async function run() {
  suite("dashboard strength: reconciles with the parade state");

  await test("strengthRoster() drops departures, filteredRoster() keeps them", () => {
    const { g, target } = load();
    seed(g, target.STATE);
    eq(g("filteredRoster")().length, 6, "roster list view must still see every row");
    const ids = g("strengthRoster")().map(r => r.id).sort();
    eq(ids.join(","), "0001,1101,1102,1103", "ORD / Posted Out rows must not be strength");
  });

  await test("Total Str === parade TOTAL STRENGTH, In Camp === CURRENT STRENGTH", () => {
    const { g, target } = load();
    seed(g, target.STATE);
    // What the parade state prints for the company.
    const parade = g("bpStrength")(target.STATE.roster, TODAY);
    // What the Dashboard tiles / topbar now compute.
    const scoped = g("strengthRoster")();
    const dash = g("bpStrength")(scoped, TODAY);
    eq(scoped.length, parade.total, "Total Str must equal TOTAL STRENGTH");
    eq(dash.total, parade.total);
    eq(dash.current, parade.current, "In Camp must equal CURRENT STRENGTH");
    eq(parade.total, 4, "4 non-departed personnel");
    eq(parade.current, 3, "Charlie is on MC → out of camp");
  });

  await test("a departed person's live medical row is not Non-Active on the dashboard", () => {
    const { g, target } = load();
    seed(g, target.STATE);
    // Give the ORD'd person an active MC — the dashboard must ignore it entirely.
    target.STATE.medical = g("normalizeMedical")([
      ...target.STATE.medical,
      { id: "MED2", d4: 1104, type: "RSO", date: "25 Jul 2026", status: "MC",
        startDate: "25 Jul 2026", endDate: "27 Jul 2026", reason: "flu", bookInDate: "" }
    ]);
    const scoped = g("strengthRoster")();
    const scopedIds = new Set(scoped.map(r => r.id));
    const effectiveAll = g("currentMedicalEffectiveAll")(TODAY).filter(e => scopedIds.has(e.d4));
    ok(!effectiveAll.some(e => e.d4 === "1104"), "departed 4D leaked into the medical tables");
    const byD4 = Object.fromEntries(effectiveAll.map(e => [e.d4, e]));
    const liveRows = scoped.filter(r => byD4[r.id] && byD4[r.id].statuses[0].ghostDay === 0);
    // The Dashboard's Active/Non-Active pair must add up to Total Str.
    eq(scoped.length - liveRows.length + liveRows.length, g("bpStrength")(scoped, TODAY).total);
    eq(liveRows.length, 1, "only Charlie is non-active");
  });

  suite("dashboard strength: wiring");

  const render = sourceText("render");
  const helpers = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");

  await test("render.js counts strength over strengthRoster(), not filteredRoster()", () => {
    ok(helpers.includes("function strengthRoster"), "strengthRoster missing from helpers.js");
    ok(render.includes("const scoped = strengthRoster();"),
      "renderDashboard no longer scopes with strengthRoster()");
    ok(!render.includes("Total Str</label><div class=\"val\">${scoped.length}"),
      "the Total Str tile is back to a raw row count");
    ok(render.includes("`Str: ${str.total} | Active: ${str.current}"),
      "the topbar counter no longer reads both numbers off bpStrength");
  });
};
