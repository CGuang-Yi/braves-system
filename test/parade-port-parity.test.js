// Drift guard for the hand-maintained GAS copy of the parade classifier.
//
// apps-script-Code.gs carries a COPY of js/braves-parade.js inside the
// BRAVES-ARCHIVE-PORT markers, because the backend archives parade snapshots on a
// timer and the two runtimes share no code at run time (no require, no modules).
// Nothing regenerates that copy — the block's "auto-generated; regenerate via
// /tmp/assemble-gas.js" header is false (the assembler was never committed), so
// the copies are kept in sync BY HAND and drift silently. The failure mode is
// nasty and invisible: archived parade states quietly disagree with live ones,
// and only a human diffing an archive against a message would ever notice.
//
// This test is the thing that notices. It feeds BOTH copies the same STATE and
// asserts the emitted message text is byte-identical, for the two entry points
// the archiver actually calls (apps-script-Code.gs:3647/3674).
//
// WHY BEHAVIOURAL EQUALITY AND NOT BYTE-IDENTICAL SOURCE (the old comment's
// claim): the frontend has legitimately diverged. 5131b1b refactored the client
// classifier (`sup` → `meta`, plus an `idx` fast-path) to feed the Status Board
// grid — UI plumbing the backend has no use for. Demanding identical source would
// force that dead weight into GAS. What must never diverge is the OUTPUT, so that
// is what's asserted. Internal refactors stay free; a changed message goes red.
//
// The frontend side loads the REAL js/state.js + js/helpers.js + js/braves-parade.js
// rather than stubbing the helpers. The port duplicates those helpers internally
// (its own displayDateToISO / medStatusActive / getPlt / rankGroupOf / …), so
// loading the real ones means this test transitively cross-checks the ported
// helper copies too. Hand-stubs would compare "port + port's helpers" against
// "client + OUR stubs" — which can both mask real drift and invent fake drift.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok } = require("./_tap");
const { loadBackend, ROOT } = require("./harness");
const { makeBrowser } = require("./mocks/browser");

// Fixed date: the classifier is date-driven, so a wall-clock TODAY would make
// this suite rot overnight. Matches parade-classifier.test.js.
const TODAY = "2026-06-29";           // a Monday
const PARADE_FILES = ["js/state.js", "js/helpers.js", "js/braves-parade.js"];

// Dates in fixtures MUST be "DD MMM YYYY": the real helpers.js displayDateToISO
// only parses that shape and returns "" for ISO input, which silently makes a
// medical/leave row inert (no section, no output) and the comparison vacuous.
// The sectionCount guard on each test below is what keeps that mistake honest.
const clone = o => JSON.parse(JSON.stringify(o));

// Four people across two platoons (platoon is parsed out of the 4D) plus a
// commander, so the strength blocks and per-platoon sections have real content.
const ROSTER = [
  { id: "1411", name: "Alpha One", fourD: "1411", rank: "REC", role: "Recruit", status: "Active" },
  { id: "1422", name: "Bravo Two", fourD: "1422", rank: "PTE", role: "Recruit", status: "Active" },
  { id: "1433", name: "Charlie Three", fourD: "1433", rank: "REC", role: "Recruit", status: "Active" },
  { id: "2411", name: "Echo Five", fourD: "2411", rank: "REC", role: "Recruit", status: "Active" },
  { id: "0001", name: "Delta Cmdr", fourD: "0001", rank: "CPT", role: "Commander", status: "Active" }
];

function fixture(over) {
  return Object.assign(
    { roster: clone(ROSTER), medical: [], leave: [], appointments: [], platoons: [], config: [] },
    over || {}
  );
}

// ── Loading the two copies ──────────────────────────────────────────────────

// The port is self-contained (defines its own configGet/displayDateToISO/…), so
// the existing Google mocks in loadBackend() are all it needs. `var STATE` at
// apps-script-Code.gs:2705 is a real sandbox global, so it's assignable directly.
function loadPort(fx) {
  const b = loadBackend();
  b.STATE = clone(fx);
  return b;
}

function loadFrontend(fx) {
  const sb = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, Intl
  }, makeBrowser().globals);
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of PARADE_FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
  }
  // STATE is `const` (js/state.js:166) → it lives in the context's lexical scope
  // and is NOT reachable as sb.STATE from Node. Install the fixture from inside
  // the context instead, clearing the app's defaults first so this side starts
  // from exactly the same object the port gets — equal inputs, or the comparison
  // proves nothing.
  vm.runInContext(
    "Object.keys(STATE).forEach(k => { delete STATE[k]; }); Object.assign(STATE, "
      + JSON.stringify(fx) + ");",
    sb, { filename: "install-fixture.js" }
  );
  return sb;
}

// Run the same call against both copies. The frontend is driven by evaluating an
// expression inside its context (its functions aren't exported to the sandbox).
function both(fx, gasCall, feExpr) {
  return { gas: gasCall(loadPort(fx)), fe: vm.runInContext(feExpr, loadFrontend(fx)) };
}

const paradeOf = (fx, type) => both(
  fx,
  b => b.generateBravesParadeState({ level: "company" }, type, TODAY, "0800"),
  `generateBravesParadeState({level:'company'},'${type}','${TODAY}','0800')`
);
// Fix 18: the same call with the lookahead switched on. The archiver never
// passes it, so nothing in production exercises the ported branches — which is
// exactly why they need pinning here, or the port would drift the moment anyone
// wires the option into a backend caller.
const paradeLookaheadOf = (fx, days) => both(
  fx,
  b => b.generateBravesParadeState({ level: "company" }, "first", TODAY, "0800", { lookaheadDays: days }),
  `generateBravesParadeState({level:'company'},'first','${TODAY}','0800',{lookaheadDays:${days}})`
);
const rsOf = fx => both(fx, b => b.generateRSFormat(TODAY, "0800"), `generateRSFormat('${TODAY}','0800')`);

// ── Assertions ──────────────────────────────────────────────────────────────

// Plain string equality would dump two ~40-line blobs on failure and leave the
// reader to spot the difference. Report the first divergent line instead, so the
// failure names the drift.
function assertIdentical(label, gas, fe) {
  if (gas === fe) return;
  const g = String(gas).split("\n"), f = String(fe).split("\n");
  for (let i = 0; i < Math.max(g.length, f.length); i++) {
    if (g[i] !== f[i]) {
      throw new Error(
        label + " diverged at line " + (i + 1) + " — the GAS port and js/braves-parade.js "
        + "no longer agree; port the change into apps-script-Code.gs (or vice versa)."
        + "\n           GAS port : " + JSON.stringify(g[i])
        + "\n           frontend : " + JSON.stringify(f[i])
      );
    }
  }
  throw new Error(label + " diverged: " + g.length + " lines vs " + f.length);
}

// "AL/OIL: 02" → 2, reading the FIRST occurrence (the company block, which
// precedes the per-platoon blocks). Guards against a fixture that populates
// nothing: two identical empty reports would pass while testing nothing at all.
function sectionCount(text, label) {
  const m = String(text).match(new RegExp("^" + label.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&") + ": (\\d+)", "m"));
  return m ? Number(m[1]) : -1;
}

// One per-section case: assert both copies agree AND the section actually filled.
async function parity(name, label, fx) {
  await test(name, () => {
    const { gas, fe } = paradeOf(fx, "first");
    assertIdentical("generateBravesParadeState(first)", gas, fe);
    ok(sectionCount(gas, label) >= 1,
      "fixture must populate " + label + " (got " + sectionCount(gas, label)
      + ") — otherwise the copies are only agreeing on an empty report");
  });
}

module.exports = async function run() {
  suite("parade port parity: GAS copy vs js/braves-parade.js emit identical text");

  await parity("AL/OIL — annual leave", "AL/OIL", fixture({
    leave: [{ id: 1, d4: "1411", type: "AL", reason: "ANNUAL LEAVE",
              startDate: "29 Jun 2026", endDate: "30 Jun 2026", isInCamp: false }]
  }));

  await parity("MR — awaiting review", "MR", fixture({
    medical: [{ id: 1, d4: "1411", type: "MR", date: "29 Jun 2026", status: "",
                reason: "knee review", time: "0900" }]
  }));

  // The retired column must not quietly keep working in either copy: a row
  // carrying ONLY mrTiming has to render with no timing at all. If this ever
  // goes green with "(0900)" in the text, one of the copies still reads it.
  await test("MR — the retired mrTiming column no longer produces a timing", () => {
    const { gas, fe } = paradeOf(fixture({
      medical: [{ id: 1, d4: "1411", type: "MR", date: "29 Jun 2026", status: "",
                  reason: "knee review", mrTiming: "0900" }]
    }), "first");
    assertIdentical("generateBravesParadeState(legacy mrTiming)", gas, fe);
    ok(sectionCount(gas, "MR") === 1, "the MR itself must still be listed");
    ok(!/\(0900\)/.test(gas), "mrTiming still drives the MR timing:\n" + gas);
  });

  await parity("REPORTING SICK — RSI still pending", "REPORTING SICK", fixture({
    medical: [{ id: 1, d4: "1411", type: "RSI", date: "29 Jun 2026", status: "Pending",
                startDate: "29 Jun 2026", reason: "fever" }]
  }));

  await parity("ATT C — active MC", "ATT C", fixture({
    medical: [{ id: 1, d4: "1422", type: "RSI", date: "28 Jun 2026", status: "MC",
                startDate: "28 Jun 2026", endDate: "01 Jul 2026", reason: "URTI" }]
  }));

  await parity("STATUS — active light duty", "STATUS", fixture({
    medical: [{ id: 1, d4: "2411", type: "RSI", date: "25 Jun 2026", status: "LD",
                startDate: "25 Jun 2026", endDate: "05 Jul 2026", reason: "ankle sprain" }]
  }));

  await parity("OTHERS — warded + not-in-camp course", "OTHERS", fixture({
    medical: [{ id: 1, d4: "1411", type: "RSI", date: "27 Jun 2026", status: "Warded",
                startDate: "27 Jun 2026", endDate: "02 Jul 2026", reason: "dengue" }],
    leave: [{ id: 1, d4: "1433", type: "Course", reason: "APSC course",
              startDate: "28 Jun 2026", endDate: "30 Jun 2026", isInCamp: false }]
  }));

  // Item 17: a Medical Appointment (type MA) dated today lands under OTHERS with
  // the in/out-of-camp sub-type — guards the ported MA branch against drift.
  await parity("OTHERS — medical appointment (type MA, out of camp)", "OTHERS", fixture({
    medical: [{ id: 1, d4: "1411", type: "MA", date: "29 Jun 2026", status: "",
                reason: "dental specialist", outOfCamp: true }]
  }));

  // The client-side 2-day recovery tail after an MC ends (not stored; derived).
  // Drifted between the copies at the source level (the port lacks the `persisted`
  // meta flag), so this is the case most likely to expose a real regression.
  await parity("ATT C — ended-MC persistence tail", "ATT C", fixture({
    medical: [{ id: 1, d4: "1422", type: "RSI", date: "24 Jun 2026", status: "MC",
                startDate: "24 Jun 2026", endDate: "28 Jun 2026", reason: "URTI" }],
    roster: clone(ROSTER).map(r => (r.id === "1422" ? Object.assign(r, { status: "MC" }) : r))
  }));

  // Two MCs of the same type → bpSupersedeSameType keeps the later-ending one.
  // Also a drifted function (sup → meta), so worth pinning behaviourally.
  await parity("ATT C — same-type supersede keeps the later end date", "ATT C", fixture({
    medical: [
      { id: 1, d4: "1422", type: "RSI", date: "27 Jun 2026", status: "MC",
        startDate: "27 Jun 2026", endDate: "30 Jun 2026", reason: "URTI" },
      { id: 2, d4: "1422", type: "RSI", date: "28 Jun 2026", status: "MC",
        startDate: "28 Jun 2026", endDate: "03 Jul 2026", reason: "URTI review" }
    ]
  }));

  // Everything at once, across both platoons: catches ordering/interaction drift
  // that the isolated single-section fixtures above would each miss.
  const KITCHEN_SINK = fixture({
    medical: [
      { id: 1, d4: "1411", type: "RSI", date: "29 Jun 2026", status: "Pending", startDate: "29 Jun 2026", reason: "fever" },
      { id: 2, d4: "1422", type: "RSI", date: "28 Jun 2026", status: "MC", startDate: "28 Jun 2026", endDate: "01 Jul 2026", reason: "URTI" },
      { id: 3, d4: "2411", type: "RSI", date: "25 Jun 2026", status: "LD", startDate: "25 Jun 2026", endDate: "05 Jul 2026", reason: "ankle sprain" },
      { id: 4, d4: "1433", type: "MR", date: "29 Jun 2026", status: "", reason: "knee review", time: "0900" },
      { id: 5, d4: "0001", type: "RSI", date: "27 Jun 2026", status: "Warded", startDate: "27 Jun 2026", endDate: "02 Jul 2026", reason: "dengue" }
    ],
    leave: [
      { id: 1, d4: "1411", type: "AL", reason: "ANNUAL LEAVE", startDate: "29 Jun 2026", endDate: "30 Jun 2026", isInCamp: false },
      { id: 2, d4: "1433", type: "Course", reason: "APSC course", startDate: "28 Jun 2026", endDate: "30 Jun 2026", isInCamp: false }
    ],
    appointments: [
      { id: 1, d4: "2411", d: "29 Jun 2026", date: "29 Jun 2026", reason: "Dental", resolved: false }
    ]
  });

  await test("kitchen sink — every section at once, parade text identical (first)", () => {
    const { gas, fe } = paradeOf(KITCHEN_SINK, "first");
    assertIdentical("generateBravesParadeState(first)", gas, fe);
    ["AL/OIL", "MR", "REPORTING SICK", "ATT C", "STATUS", "OTHERS"].forEach(s =>
      ok(sectionCount(gas, s) >= 1, s + " should be populated in the kitchen-sink fixture"));
  });

  // `last` parade walks the same classifier but a different header/time slot.
  await test("kitchen sink — parade text identical (last)", () => {
    const { gas, fe } = paradeOf(KITCHEN_SINK, "last");
    assertIdentical("generateBravesParadeState(last)", gas, fe);
  });

  await test("kitchen sink — generateRSFormat identical", () => {
    const { gas, fe } = rsOf(KITCHEN_SINK);
    assertIdentical("generateRSFormat", gas, fe);
    ok(/URTI/.test(gas), "RS report should mention URTI for a populated fixture");
  });

  // The cases below restore the coverage of the ORIGINAL cross-check harness.
  // DECISIONS #49 records it: /tmp/xcheck.js diffed port output against client
  // output on the seed — "5/5 byte-identical", covering company/PLT1/PLT2 parade
  // + RS + RSI. It ran once, the day the port landed, and died with /tmp. Platoon
  // scope and RSI aren't on the archivePoll path (that only calls company parade +
  // RS), but both copies export them and they share the same classifier, so
  // pinning them costs nothing and matches what was once verified.
  for (const code of ["PLT1", "PLT2"]) {
    await test(`kitchen sink — platoon scope ${code} identical`, () => {
      const { gas, fe } = both(
        KITCHEN_SINK,
        b => b.generateBravesParadeState({ level: "platoon", platoon: code }, "first", TODAY, "0800"),
        `generateBravesParadeState({level:'platoon',platoon:'${code}'},'first','${TODAY}','0800')`
      );
      assertIdentical(`generateBravesParadeState(platoon ${code})`, gas, fe);
      ok(/PLATOON/.test(gas), `${code} block should render a platoon header`);
    });
  }

  // ── Fix 18: the lookahead path ────────────────────────────────────────────
  // Future-dated rows across every section that honours the horizon, so the
  // ported predicates, the [UPCOMING] marker, the segregated supersede pool and
  // the recovery-tail guard are all compared rather than just the default path.
  const LOOKAHEAD = fixture({
    medical: [
      // 1422: an MC running TODAY plus a later one — the supersede pool must keep
      // both, and today's must not be eaten by the future one that ends later.
      { id: 1, d4: "1422", type: "RSI", date: "28 Jun 2026", status: "MC",
        startDate: "28 Jun 2026", endDate: "30 Jun 2026", reason: "URTI" },
      { id: 2, d4: "1422", type: "RSI", date: "02 Jul 2026", status: "MC",
        startDate: "02 Jul 2026", endDate: "06 Jul 2026", reason: "MC review" },
      // 2411: a future LD (STATUS) and a future MA (OTHERS).
      { id: 3, d4: "2411", type: "RSI", date: "03 Jul 2026", status: "LD",
        startDate: "03 Jul 2026", endDate: "08 Jul 2026", reason: "ankle sprain" },
      { id: 4, d4: "2411", type: "MA", date: "01 Jul 2026", status: "",
        reason: "dental specialist", outOfCamp: true },
      // 1433: an MC that ENDED yesterday (recovery tail) plus a future one — the
      // tail must survive alongside it.
      { id: 5, d4: "1433", type: "RSI", date: "24 Jun 2026", status: "MC",
        startDate: "24 Jun 2026", endDate: "28 Jun 2026", reason: "fever" },
      { id: 6, d4: "1433", type: "RSI", date: "04 Jul 2026", status: "MC",
        startDate: "04 Jul 2026", endDate: "07 Jul 2026", reason: "follow up" }
    ],
    leave: [
      { id: 1, d4: "1411", type: "AL", reason: "48HR BO",
        startDate: "02 Jul 2026", endDate: "03 Jul 2026", isInCamp: false },
      { id: 2, d4: "1411", type: "Course", reason: "APSC course",
        startDate: "05 Jul 2026", endDate: "06 Jul 2026", isInCamp: false }
    ],
    appointments: [
      { id: 1, d4: "2411", date: "02 Jul 2026", reason: "Physio", resolved: false }
    ]
  });

  await test("lookahead 7d — parade text identical, and it really did surface entries", () => {
    const { gas, fe } = paradeLookaheadOf(LOOKAHEAD, 7);
    assertIdentical("generateBravesParadeState(lookahead 7)", gas, fe);
    ok(/\[UPCOMING\]/.test(gas), "the fixture must actually produce upcoming entries");
    ["AL/OIL", "ATT C", "STATUS", "OTHERS"].forEach(s =>
      ok(sectionCount(gas, s) >= 1, s + " should be populated under the lookahead"));
  });

  await test("lookahead Infinity — parade text identical", () => {
    const { gas, fe } = paradeLookaheadOf(LOOKAHEAD, Infinity);
    assertIdentical("generateBravesParadeState(lookahead Infinity)", gas, fe);
  });

  await test("lookahead off — the SAME fixture renders no upcoming entries in either copy", () => {
    // The negative control: proves the two tests above are comparing the
    // lookahead path and not just agreeing on the default one.
    const { gas, fe } = paradeOf(LOOKAHEAD, "first");
    assertIdentical("generateBravesParadeState(lookahead off)", gas, fe);
    ok(!/\[UPCOMING\]/.test(gas), "nothing may leak into the default path:\n" + gas);
  });

  await test("kitchen sink — generateRSIPersonnel identical (company-wide and PLT1)", () => {
    ["", "PLT1"].forEach(scope => {
      const { gas, fe } = both(
        KITCHEN_SINK,
        b => b.generateRSIPersonnel(TODAY, "0800", scope),
        `generateRSIPersonnel('${TODAY}','0800','${scope}')`
      );
      assertIdentical("generateRSIPersonnel(" + (scope || "company-wide") + ")", gas, fe);
      ok(/RSI PERSONNEL/.test(gas), "RSI report should render its header");
    });
  });
};
