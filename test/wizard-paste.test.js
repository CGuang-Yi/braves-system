// Conduct wizard paste-absentees (Feature 30). Parsing is strict by decision:
// only exact roster 4Ds match, so a mistyped id surfaces as unmatched rather than
// being silently "helpfully" padded into somebody else's record.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");
const { sourceText } = require("./sources");

function loadCtx() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(sourceText("forms"),
    ctx, { filename: "forms.js" });
  return ctx;
}
const ROSTER = [{ id: "0123" }, { id: "0124" }, { id: "0125" }];
const p = (ctx, text) => vm.runInContext(
  `parsePastedD4s(${JSON.stringify(text)}, ${JSON.stringify(ROSTER)})`, ctx);

module.exports = async function run() {
  suite("wizard paste: parsing");
  const c = loadCtx();

  await test("newline separated", () => {
    const r = p(c, "0123\n0124");
    eq(r.matched.length, 2);
    eq(r.unmatched.length, 0);
  });

  await test("comma separated on one line", () => {
    const r = p(c, "0123, 0124, 0125");
    eq(r.matched.length, 3);
  });

  await test("newlines and commas mixed, with blank lines and stray whitespace", () => {
    const r = p(c, "0123, 0124\n\n  0125  \n");
    eq(r.matched.length, 3);
    eq(r.unmatched.length, 0);
  });

  await test("unpadded and C-prefixed forms are NOT accepted — they report as unmatched", () => {
    const r = p(c, "123\nC0124");
    eq(r.matched.length, 0, "strict by decision");
    eq(r.unmatched.length, 2);
  });

  await test("a 4D not in the roster is reported, not dropped", () => {
    const r = p(c, "0123\n9999");
    eq(r.matched.length, 1);
    eq(r.unmatched.length, 1);
    eq(r.unmatched[0], "9999");
  });

  await test("duplicates collapse", () => {
    const r = p(c, "0123\n0123\n0123");
    eq(r.matched.length, 1);
  });

  // ── Cases the modal's confirm panel depends on ──────────────────────────

  await test("matched keeps the pasted order, so the preview reads like the input", () => {
    eq(p(c, "0125\n0123\n0124").matched, ["0125", "0123", "0124"]);
  });

  await test("a tab-separated paste works — spreadsheets are the likely source", () => {
    const r = p(c, "0123\t0124\t0125");
    eq(r.matched.length, 3, "a column copied out of Excel arrives tab-separated");
  });

  await test("an unsupported separator surfaces as one unmatched token, never a silent split", () => {
    // Semicolons are NOT a separator. The token must come back whole so the
    // warning shows the user exactly what they pasted, rather than the parser
    // quietly inventing two ids.
    const r = p(c, "0123;0124");
    eq(r.matched.length, 0);
    eq(r.unmatched, ["0123;0124"]);
  });

  await test("an empty or whitespace-only paste yields nothing at all", () => {
    eq(p(c, "").matched.length, 0);
    eq(p(c, "").unmatched.length, 0);
    eq(p(c, "   \n\n  \t ").unmatched.length, 0, "whitespace must not become a token");
  });

  await test("a duplicate that is unmatched is also reported only once", () => {
    const r = p(c, "9999\n9999");
    eq(r.unmatched, ["9999"], "the warning must not repeat the same bad id");
  });

  await test("a missing roster is safe and matches nothing", () => {
    const none = vm.runInContext(`parsePastedD4s("0123", null)`, c);
    eq(none.matched.length, 0);
    eq(none.unmatched, ["0123"], "with no roster to check against, nothing may be accepted");
  });

  await test("a commander 4D matches like any other — the paste does not filter by role", () => {
    const r = vm.runInContext(`parsePastedD4s("0012", [{id:"0012"}])`, c);
    eq(r.matched, ["0012"]);
  });

  suite("wizard paste: applying to the wizard buckets");

  // applyPastedAbsentees mutates _logConduct and calls renderLogConductWizard,
  // so the context needs both. The render is stubbed — placement in the DOM is
  // not what this asserts; which bucket each 4D lands in is.
  const withWizard = (wizard, dest, matched) => {
    const ctx = loadCtx();
    vm.runInContext("renderLogConductWizard = function(){};", ctx);
    vm.runInContext(`_logConduct = ${JSON.stringify(wizard)};`, ctx);
    vm.runInContext(`applyPastedAbsentees(${JSON.stringify(dest)}, ${JSON.stringify(matched)});`, ctx);
    return JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", ctx));
  };

  await test("pasting into Fallout adds every matched 4D", () => {
    const w = withWizard({ fallout: [], reportSick: [], status: [] }, "fallout", ["0123", "0124"]);
    eq(w.fallout.map(x => x.d4), ["0123", "0124"]);
  });

  await test("the paste is authoritative — a 4D already in another bucket MOVES", () => {
    // Silently skipping an already-listed person would make a deliberate
    // correction look like it did nothing.
    const w = withWizard(
      { fallout: [], reportSick: [{ d4: "0123", reason: "went to MO" }], status: [] },
      "fallout", ["0123"]);
    eq(w.reportSick.length, 0, "the old bucket must release it");
    eq(w.fallout.map(x => x.d4), ["0123"]);
  });

  await test("pasting into Status Personnel ticks notParticipating, and clears the others", () => {
    const w = withWizard(
      { fallout: [{ d4: "0123", reason: "" }], reportSick: [],
        status: [{ d4: "0123", statusTag: "LD", reason: "", notParticipating: false }] },
      "status", ["0123"]);
    eq(w.fallout.length, 0, "it must not be listed as Fallout as well");
    eq(w.status[0].notParticipating, true);
  });

  await test("a 4D with no Status row cannot be forced into Status Personnel", () => {
    // The checklist is derived from who actually has a status that day; there is
    // no row to tick, and inventing one would put a person on the parade state
    // with a status they do not have.
    const w = withWizard({ fallout: [], reportSick: [], status: [] }, "status", ["0123"]);
    eq(w.status.length, 0, "no Status row may be fabricated");
    eq(w.fallout.length, 0);
  });

  await test("re-pasting the same 4D into the same bucket does not duplicate it", () => {
    const w = withWizard({ fallout: [{ d4: "0123", reason: "" }], reportSick: [], status: [] },
      "fallout", ["0123"]);
    eq(w.fallout.length, 1);
  });

  await test("an existing reason is not destroyed when the person stays put", () => {
    const w = withWizard({ fallout: [{ d4: "0123", reason: "twisted ankle" }], reportSick: [], status: [] },
      "fallout", ["0123"]);
    eq(w.fallout[0].reason, "twisted ankle", "re-pasting must not blank a reason already typed");
  });

  await test("people not named in the paste are left completely alone", () => {
    const w = withWizard(
      { fallout: [{ d4: "0999", reason: "keep me" }], reportSick: [],
        status: [{ d4: "0888", statusTag: "MC", reason: "", notParticipating: true }] },
      "fallout", ["0123"]);
    eq(w.fallout.map(x => x.d4), ["0999", "0123"]);
    eq(w.status[0].notParticipating, true, "an untouched Status tick must survive");
  });

  suite("wizard paste: the confirm step is not optional");

  await test("Apply is reachable only from the preview panel, and only when something matched", () => {
    const src = sourceText("forms");
    // The whole safety of a strict parser is that the user SEES the match result
    // first. If the paste modal ever grew a direct Apply button, a paste that was
    // entirely typos would confirm into a silent no-op read as success.
    ok(/onclick="openWizPasteModal\(\)"/.test(src), "the wizard no longer offers a paste trigger");
    ok(!/wiz-paste-text[\s\S]{0,400}onclick="wizPasteApply/.test(src),
      "the paste modal exposes Apply without going through Preview");
    // Gated on `applied`, not `matched`: for the Status destination a roster
    // match that holds no status that day cannot be ticked, so counting it would
    // let a paste that changes nothing confirm as success.
    ok(/applied\.length[\s\S]{0,120}onclick="wizPasteApply/.test(src),
      "the Apply button is no longer gated on there being a match");
  });

  await test("Apply re-parses the textarea instead of trusting the preview", () => {
    const src = sourceText("forms");
    // Editing the textarea after previewing must not apply the stale match list.
    ok(/function wizPasteApply[\s\S]{0,400}parsePastedD4s\(text, STATE\.roster\)/.test(src),
      "wizPasteApply no longer re-parses — a post-preview edit would apply stale matches");
  });

  await test("applying with no wizard open is a no-op, not a crash", () => {
    const ctx = loadCtx();
    vm.runInContext("renderLogConductWizard = function(){}; _logConduct = null;", ctx);
    ok(vm.runInContext(`(() => { try { applyPastedAbsentees("fallout", ["0123"]); return true; } catch (e) { return false; } })()`, ctx),
      "applyPastedAbsentees threw with no wizard open");
  });
};
