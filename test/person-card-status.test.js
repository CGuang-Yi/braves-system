// Feature 33 — the person card shows the LIVE status, and shows all of them.
//
// The bug this pins: PR #65 removed the medical→roster status mirror, so
// roster.status holds only active-vs-departed. The person-card header read it
// directly (statusBadge(p.status)) and therefore said "Active" for someone on
// MC, while the roster row right behind the card — which already went through
// rosterDisplayStatus — said "MC". Two surfaces, same person, different answer.
//
// rosterDisplayStatusAll is the card's variant: same derivation, but every
// concurrent status rather than only the top-ranked one, because the parade grid
// and the Dashboard Non-Active table both list all of them and a card naming one
// would contradict the parade state that goes out.
//
// Loaded as the REAL js/state.js + js/helpers.js + js/braves-parade.js (helpers
// needs BP_DEPARTED_STATUSES from the last of those, and currentMedicalEffectiveAll
// from itself) rather than stubbed — a stub of the derivation would let this pass
// while the card and the roster row disagree, which is the whole failure mode.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");
const { ROOT } = require("./harness");
const { makeBrowser } = require("./mocks/browser");
const { sourceText } = require("./sources");

const FILES = ["js/state.js", "js/helpers.js", "js/braves-parade.js"];

// Fixed "today" so the suite can't rot overnight: every window below is chosen
// relative to this date. Dates must be "DD MMM YYYY" — displayDateToISO returns
// "" for anything else, which would silently make a medical row inert and the
// assertions vacuous.
const TODAY = "2026-07-28";

function load(fx) {
  const sb = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, Intl
  }, makeBrowser().globals);
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
  }
  // STATE is a `const` in state.js → it lives in the context's lexical scope and
  // is not reachable as sb.STATE. Install the fixture from inside the context.
  vm.runInContext(
    "Object.keys(STATE).forEach(k => { delete STATE[k]; }); Object.assign(STATE, "
      + JSON.stringify(fx) + ");"
    // Pin "today" so the effective-status window is deterministic.
    + "todayISO = () => " + JSON.stringify(TODAY) + ";",
    sb, { filename: "install-fixture.js" }
  );
  return sb;
}

// Badge HTML → the plain status texts, so assertions read as statuses not markup.
// Whitespace-only pieces are dropped: the badges are joined with a space, which
// would otherwise show up as a third "status".
const tags = html => String(html).replace(/<[^>]*>/g, "|").split("|")
  .map(s => s.trim()).filter(Boolean);

function run1(fx, expr) {
  return vm.runInContext(expr, load(fx));
}

const ROSTER = [
  { id: "1411", name: "Alpha One", fourD: "1411", rank: "REC", role: "Recruit", status: "Active" },
  { id: "1412", name: "Bravo Two", fourD: "1412", rank: "REC", role: "Recruit", status: "Active" },
  { id: "1413", name: "Gone Away", fourD: "1413", rank: "REC", role: "Recruit", status: "ORD" }
];
const fixture = medical => ({
  roster: JSON.parse(JSON.stringify(ROSTER)), medical: medical || [],
  leave: [], appointments: [], platoons: [], config: [], msk: []
});

module.exports = async function run() {
  suite("person card: current status is derived live, not read off roster.status");

  await test("someone on MC reads MC even though roster.status still says Active", () => {
    const fx = fixture([{ id: 1, d4: "1411", type: "RSI", date: "27 Jul 2026", status: "MC",
                          startDate: "27 Jul 2026", endDate: "30 Jul 2026", reason: "URTI" }]);
    // The premise: the stored value really is "Active". If this ever fails, the
    // mirror is back and the rest of the test proves nothing.
    eq(fx.roster[0].status, "Active");
    eq(tags(run1(fx, "rosterDisplayStatusAll(STATE.roster[0])")), ["MC"]);
  });

  await test("all concurrent statuses are listed, not just the top-ranked one", () => {
    const fx = fixture([
      { id: 1, d4: "1411", type: "RSI", date: "20 Jul 2026", status: "LD",
        startDate: "20 Jul 2026", endDate: "05 Aug 2026", reason: "ankle" },
      { id: 2, d4: "1411", type: "RSI", date: "21 Jul 2026", status: "Excuse RMJ",
        startDate: "21 Jul 2026", endDate: "10 Aug 2026", reason: "knee" }
    ]);
    const all = tags(run1(fx, "rosterDisplayStatusAll(STATE.roster[0])"));
    ok(all.length === 2, "expected both concurrent statuses, got " + JSON.stringify(all));
    ok(all.indexOf("LD") !== -1 && all.indexOf("Excuse RMJ") !== -1,
      "expected LD + Excuse RMJ, got " + JSON.stringify(all));
    // The single-badge variant must be unchanged for its existing callers — the
    // roster list renders one badge per row and must keep doing so.
    eq(tags(run1(fx, "rosterDisplayStatus(STATE.roster[0])")).length, 1);
  });

  await test("a departed person renders the stored status, never a medical one", () => {
    // BP_DEPARTED_STATUSES short-circuits before the medical layer is consulted:
    // someone who has ORD'd must not be shown as "MC" because of a stale row.
    const fx = fixture([{ id: 1, d4: "1413", type: "RSI", date: "27 Jul 2026", status: "MC",
                          startDate: "27 Jul 2026", endDate: "30 Jul 2026", reason: "URTI" }]);
    eq(tags(run1(fx, "rosterDisplayStatusAll(STATE.roster[2])")), ["ORD"]);
  });

  await test("no active medical falls back to the stored roster value", () => {
    eq(tags(run1(fixture([]), "rosterDisplayStatusAll(STATE.roster[1])")), ["Active"]);
  });

  await test("the ghost recovery tag after an MC ends shows on the card too", () => {
    // MC ended yesterday → the client-side MC+1 tag (derived, never stored).
    const fx = fixture([{ id: 1, d4: "1411", type: "RSI", date: "24 Jul 2026", status: "MC",
                          startDate: "24 Jul 2026", endDate: "27 Jul 2026", reason: "URTI" }]);
    eq(tags(run1(fx, "rosterDisplayStatusAll(STATE.roster[0])")), ["MC+1"]);
  });

  await test("rendering the card does not write anything back to the roster", () => {
    // Feature 33 is display-only: the Roster sheet must be untouched, or a card
    // view would start queueing sync writes.
    const fx = fixture([{ id: 1, d4: "1411", type: "RSI", date: "27 Jul 2026", status: "MC",
                          startDate: "27 Jul 2026", endDate: "30 Jul 2026", reason: "URTI" }]);
    const after = run1(fx,
      "rosterDisplayStatusAll(STATE.roster[0]); JSON.stringify(STATE.roster.map(r => r.status))");
    eq(JSON.parse(after), ["Active", "Active", "ORD"]);
  });

  suite("person card wiring: the header uses the live helper, not p.status");

  const forms = sourceText("forms");

  await test("openPerson's header badges rosterDisplayStatusAll and no longer badges p.status", () => {
    // Comment lines are stripped before matching: the code carries a comment
    // NAMING the old statusBadge(p.status) call as what it replaced, and a naive
    // regex would match that and report the fix as missing forever.
    const body = forms.slice(forms.indexOf("function openPerson"),
                             forms.indexOf("function openPerson") + 3000)
      .split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    ok(/rosterDisplayStatusAll\(p\)/.test(body),
      "the person card header no longer derives its status live");
    ok(!/statusBadge\(p\.status\)/.test(body),
      "the person card still badges the raw roster.status — it reads Active for someone on MC");
  });
};
