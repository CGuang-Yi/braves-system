// The dashboard duty card (spec §2) must show exactly the slots the month grid
// shows — same types, same platoon columns, same order. Deriving them twice is
// how the two surfaces drift, so the card calls the grid's own
// dutyGridColumns(); this pins that they agree, and that an unfilled slot comes
// back as an explicit empty d4 rather than being dropped from the list.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { sourceText } = require("./sources");

const BUNDLE = [
  "js/state.js", "js/calc.js", "js/appointment-4d.js", "js/helpers.js",
  "js/duty-points.js", "js/duty-eligibility.js", "js/render-duty.js"
];

// has:()=>true so a free identifier from a file we did not load reads undefined
// instead of throwing (the dashboard-strength.test.js pattern).
function makeCtx() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol, Promise, encodeURIComponent,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout,
    window: { addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }) },
    document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
    navigator: { userAgent: "node" }, fetch: () => Promise.reject(new Error("no net")),
    // render-duty.js registers its delegated handlers at load time (js/actions.js
    // is not in this bundle). Stubbed rather than loaded: this test is about what
    // gets drawn, not about who handles a click.
    registerActions: () => {}
  };
  const ctx = new Proxy(target, {
    has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; }
  });
  vm.createContext(ctx);
  return ctx;
}

function runBundle(ctx, extra) {
  const src = BUNDLE.map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n")
    + (extra ? "\n;\n" + extra : "")
    + "\n;this.STATE = STATE;\n";
  vm.runInContext(src, ctx, { filename: "bundle.js" });
  return { g: name => vm.runInContext(name, ctx), S: vm.runInContext("STATE", ctx) };
}

function load() {
  return runBundle(makeCtx());
}

// A fresh context with BOTH bundles in it. Deliberately not "add the render
// bundle to the context load() already made" — a vm context cannot be re-entered
// from outside, and reaching for that is the obvious wrong turn here.
// render-dashboard.js is one part of the split `render` bundle, so this loads the
// bundle rather than the file: that is the shared global scope the app runs in.
function loadCard(role) {
  const { g, S } = runBundle(makeCtx(), sourceText("render"));
  S.role = role || "admin";
  S.caps = [];
  return { g, S };
}

// Three live platoons plus HQ, to pin that PDS columns follow the platoon list
// and that HQ is excluded from them (dutyPlatoonsFor drops HQ by design).
function seed(g, S) {
  // `active: true`, not a status string — activePlatoons() filters on the
  // boolean, and a plausible-looking `status: "Active"` silently falls through
  // to the roster-derived fallback (which here would yield only PLT1 + PLT2).
  S.platoons = [
    { code: "PLT1", displayName: "PLT1", active: true },
    { code: "PLT2", displayName: "PLT2", active: true },
    { code: "PLT3", displayName: "PLT3", active: true },
    { code: "HQ", displayName: "HQ", active: true }
  ];
  S.roster = g("normalizeRoster")([
    { "4d": 11, name: "Alpha", rank: "LTA", role: "Commander", status: "Active", platoon: "PLT1", section: "Command" },
    { "4d": 21, name: "Bravo", rank: "LTA", role: "Commander", status: "Active", platoon: "PLT2", section: "Command" }
  ]);
  S.duty = [
    { id: "d1", date: "2026-08-04", dutyType: "CDO", platoon: "", d4: "0011" },
    { id: "d2", date: "2026-08-04", dutyType: "PDS", platoon: "PLT2", d4: "0021" },
    { id: "d3", date: "2026-08-05", dutyType: "CDO", platoon: "", d4: "0021" }
  ];
  S.config = S.config || {};
}

module.exports = async function run() {
  suite("dashboard duty card: slot derivation");

  await test("a day's slots match the month grid's columns exactly", () => {
    const { g, S } = load();
    seed(g, S);
    const cfg = g("dutyConfig")();
    const slots = g("dutyDaySlots")(cfg, S.duty, "2026-08-04");
    const cols = g("dutyGridColumns")(cfg);
    eq(slots.length, cols.length, "the card and the grid disagree about how many slots exist");
    eq(slots.map(s => s.label).join("|"), cols.map(c => c.label).join("|"),
      "the card's slot order differs from the grid's column order");
  });

  await test("filled slots carry the assignee, unfilled ones an empty d4", () => {
    const { g, S } = load();
    seed(g, S);
    const cfg = g("dutyConfig")();
    const slots = g("dutyDaySlots")(cfg, S.duty, "2026-08-04");
    const cdo = slots.find(s => s.dutyType === "CDO");
    eq(cdo.d4, "0011", "the CDO assignment did not reach the card");
    const pds2 = slots.find(s => s.dutyType === "PDS" && s.platoon === "PLT2");
    eq(pds2.d4, "0021", "the PLT2 PDS assignment did not reach the card");
    // The important half: an unfilled slot is still a slot. Dropping it would
    // hide the gap, which is the whole reason this card exists.
    const pds1 = slots.find(s => s.dutyType === "PDS" && s.platoon === "PLT1");
    ok(pds1, "an unfilled PDS slot vanished from the list instead of showing as a gap");
    eq(pds1.d4, "", "an unfilled slot should carry an empty d4");
  });

  await test("a date with no duties at all still lists every slot", () => {
    const { g, S } = load();
    seed(g, S);
    const cfg = g("dutyConfig")();
    const slots = g("dutyDaySlots")(cfg, S.duty, "2026-08-09");
    ok(slots.length > 0, "an empty date returned no slots — the gap would be invisible");
    ok(slots.every(s => s.d4 === ""), "an empty date reported an assignee");
  });

  await test("PDS columns follow the platoon list and exclude HQ", () => {
    const { g, S } = load();
    seed(g, S);
    const cfg = g("dutyConfig")();
    const pds = g("dutyDaySlots")(cfg, S.duty, "2026-08-04").filter(s => s.dutyType === "PDS");
    // Nothing may be hardcoded to four platoons (DUTY_LIST_SPEC §1.1).
    eq(pds.length, 3, "PDS columns did not follow the three live platoons");
    ok(!pds.some(s => s.platoon === "HQ"), "HQ was given a PDS slot");
  });

  suite("dashboard duty card: markup");

  await test("the card shows both days and names the assignees", () => {
    const { g, S } = loadCard();
    seed(g, S);
    const html = g("renderDashDuty")("2026-08-04");
    ok(/Today/.test(html), "the card has no Today column");
    ok(/Tomorrow/.test(html), "the card has no Tomorrow column");
    ok(/Alpha/.test(html), "today's CDO is not named on the card");
    // d3 is tomorrow's CDO — proves the second column reads a different date
    // rather than repeating today's.
    ok(/Bravo/.test(html), "tomorrow's assignee is missing — both columns may be reading today");
  });

  await test("an unfilled slot says so explicitly", () => {
    const { g, S } = loadCard();
    seed(g, S);
    const html = g("renderDashDuty")("2026-08-04");
    // A blank cell reads as "nothing to see"; the gap has to be legible or the
    // card fails at the one job it has.
    ok(/unassigned/.test(html), "an unfilled slot rendered blank instead of flagging the gap");
  });

  await test("viewers do not get the card", () => {
    const { g, S } = loadCard("viewer");
    seed(g, S);
    eq(g("renderDashDuty")("2026-08-04"), "", "a viewer was shown the duty card");
  });

  await test("no duty types configured means no card at all", () => {
    const { g, S } = loadCard();
    seed(g, S);
    // An empty card is worse than no card: it reads as "no duties tomorrow".
    S.config = { dutyTypes: [] };
    eq(g("renderDashDuty")("2026-08-04"), "", "an unconfigured company got an empty duty card");
  });
};
