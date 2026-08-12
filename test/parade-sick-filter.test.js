// Guards the two filters that narrow the RS / RSI sick-report generators
// (js/braves-parade.js), per DUTY_UX_AND_RS_SELECTION_SPEC §4–§5:
//
//  • §5 — the "on status" toggle drops LESS than it used to. The old
//    bpHasCoveringStatus suppressed a report row whenever the person held ANY
//    status whose endDate had not yet passed, regardless of when it started.
//    That silently hid a genuinely new event: a recruit three days into a
//    long LD who reports sick AGAIN today never appeared on the sick parade.
//    The rule now keys on the status row's OWN report date, so only the
//    outcome of *today's* visit suppresses today's entry.
//
//  • §4 — opts.only, an allow-list of medical row IDs backing the per-person
//    checklist in the RS/RSI modals. Keyed on row id rather than 4D so that a
//    person with two report rows on one date behaves sensibly.
//
// Both are default-path-neutral by design: omit the opts and the output is
// byte-identical, which is what keeps the unattended archive cron and the
// hand-maintained GAS port (test/parade-port-parity.test.js) unaffected. The
// last suite here pins that neutrality directly — it is the property the port
// parity guard depends on, and a regression in it would surface there as a
// confusing cross-runtime diff rather than as the local change that caused it.
//
// Loaded with the REAL js/state.js + js/helpers.js (the parade-port-parity
// pattern, not the hand-stub pattern of parade-classifier.test.js): the
// predicate under test reads medical rows through displayDateToISO, and a
// stub of that helper which disagreed with the real one would make every
// assertion here vacuous while staying green.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { ROOT } = require("./harness");
const { makeBrowser } = require("./mocks/browser");

// Fixed date — the generators are date-driven, so a wall-clock TODAY would rot
// this suite overnight. Matches parade-port-parity.test.js.
const TODAY = "2026-06-29";           // a Monday
const TODAY_D = "29 Jun 2026";        // the display shape helpers.js parses

// appointment-4d.js precedes helpers.js because personPlatoon calls
// parseAppointment4D; without it every test dies on a ReferenceError.
const PARADE_FILES = ["js/state.js", "js/appointment-4d.js", "js/helpers.js", "js/braves-parade.js"];

const clone = o => JSON.parse(JSON.stringify(o));

// Platoon is parsed out of the 4D, so 14xx lands in PLT1 and 24xx in PLT2.
// Two platoons is the minimum that proves the per-platoon PAX counts follow a
// filter rather than just the company TOTAL.
const ROSTER = [
  { id: "1411", name: "Alpha One", fourD: "1411", rank: "REC", role: "Recruit", status: "Active" },
  { id: "1422", name: "Bravo Two", fourD: "1422", rank: "REC", role: "Recruit", status: "Active" },
  { id: "2411", name: "Echo Five", fourD: "2411", rank: "REC", role: "Recruit", status: "Active" }
];

// Report rows are identified in the generated message by PURPOSE (the name
// never appears), so each fixture reason is a distinct marker we can grep for.
const med = (id, d4, over) => Object.assign(
  { id, d4, date: TODAY_D, type: "RSI", reason: "REASON-" + id, location: "MO", status: "", startDate: "", endDate: "" },
  over || {}
);

function loadFrontend(medical) {
  const sb = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, Intl
  }, makeBrowser().globals);
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of PARADE_FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
  }
  // STATE is `const` in js/state.js, so it lives in the context's lexical scope
  // and is NOT reachable as sb.STATE from Node — install the fixture from
  // inside the context instead, clearing the app's defaults first.
  const fx = { roster: clone(ROSTER), medical: clone(medical), leave: [], appointments: [], platoons: [], config: [] };
  vm.runInContext(
    "Object.keys(STATE).forEach(k => { delete STATE[k]; }); Object.assign(STATE, "
      + JSON.stringify(fx) + ");",
    sb, { filename: "install-fixture.js" }
  );
  return sb;
}

// The generators aren't exported to the sandbox, so drive them by evaluating an
// expression inside the context.
const rs = (medical, opts) => vm.runInContext(
  `generateRSFormat('${TODAY}','0800',${JSON.stringify(opts || null)})`, loadFrontend(medical));
const rsi = (medical, opts) => vm.runInContext(
  `generateRSIPersonnel('${TODAY}','0800','',${JSON.stringify(opts || null)})`, loadFrontend(medical));

const has = (text, id) => text.includes("REASON-" + id);
const total = text => (text.match(/^TOTAL: (\d+) PAX$/m) || [])[1];
const pax = (text, label) => (text.match(new RegExp("^" + label + ": (\\d+) PAX$", "m")) || [])[1];

module.exports = async function run() {

  // ── §5: the toggle keys on the status row's own report date ───────────────

  suite("§5 on-status toggle: only TODAY's resolved outcome suppresses today's entry");

  await test("a same-day report row carrying a resolved status drops", async () => {
    // The MC is the outcome OF this row, so listing the row double-counts one event.
    const out = rs([med("M1", "1411", { status: "MC", startDate: TODAY_D, endDate: "01 Jul 2026" })],
      { omitOnStatus: true });
    ok(!has(out, "M1"), "resolved same-day status should be omitted");
  });

  await test("a same-day report row still Pending stays", async () => {
    const out = rs([med("M2", "1422", { status: "Pending" })], { omitOnStatus: true });
    ok(has(out, "M2"), "Pending is not an outcome — the case is still open");
  });

  await test("a same-day report row resolved as NIL stays", async () => {
    // NIL is explicitly not a resolved status: the MO saw them and issued nothing.
    const out = rs([med("M3", "2411", { status: "NIL" })], { omitOnStatus: true });
    ok(has(out, "M3"), "NIL is not a resolved status");
  });

  await test("a pre-existing unexpired status no longer drops a NEW same-day report", async () => {
    // THE §5 REGRESSION. Bravo Two is mid-LD (20 Jun → 10 Jul) and reports sick
    // again today. The old endDate>=today rule hid this row entirely; the new
    // rule keeps it, because the LD's own report date is not today.
    const out = rs([
      med("M0", "1422", { date: "20 Jun 2026", status: "LD", startDate: "20 Jun 2026", endDate: "10 Jul 2026" }),
      med("M4", "1422", { status: "Pending" })
    ], { omitOnStatus: true });
    ok(has(out, "M4"), "a new report during a running LD is a genuinely new event");
    ok(!has(out, "M0"), "the LD row itself is not a report for today and never was listed");
  });

  await test("the toggle off lists everyone regardless of status", async () => {
    const out = rs([
      med("M1", "1411", { status: "MC", startDate: TODAY_D, endDate: "01 Jul 2026" }),
      med("M2", "1422", { status: "Pending" })
    ]);
    ok(has(out, "M1") && has(out, "M2"), "no opts → no suppression");
  });

  // ── §4: opts.only, the per-person checklist ───────────────────────────────

  suite("§4 opts.only: an allow-list of medical row ids");

  const THREE = [med("M1", "1411"), med("M2", "1422"), med("M3", "2411")];

  await test("only the named rows survive", async () => {
    const out = rs(THREE, { only: ["M2"] });
    ok(has(out, "M2"), "the selected row is listed");
    ok(!has(out, "M1") && !has(out, "M3"), "unselected rows are dropped");
  });

  await test("TOTAL follows the selection", async () => {
    eq(total(rsi(THREE)), "03", "unfiltered baseline");
    eq(total(rsi(THREE, { only: ["M1", "M3"] })), "02", "TOTAL counts the selected set");
  });

  await test("per-platoon PAX follows the selection", async () => {
    // M1+M2 are PLT1, M3 is PLT2 — selecting one from each proves the filter is
    // applied BEFORE the platoon partition rather than after it.
    const out = rsi(THREE, { only: ["M1", "M3"] });
    eq(pax(out, "PLATOON 1"), "01", "PLT1 drops the unselected M2");
    eq(pax(out, "PLATOON 2"), "01", "PLT2 keeps M3");
  });

  await test("a platoon with nothing selected disappears entirely", async () => {
    const out = rsi(THREE, { only: ["M3"] });
    ok(!/PLATOON 1:/.test(out), "an empty platoon is not emitted as a 00 PAX section");
    eq(total(out), "01");
  });

  await test("two rows for one person on one date are selectable independently", async () => {
    // The reason opts.only is keyed on row id and not 4D.
    const out = rs([med("M5", "1411"), med("M6", "1411")], { only: ["M6"] });
    ok(has(out, "M6") && !has(out, "M5"), "same 4D, only the chosen row listed");
  });

  await test("an empty only array selects nothing", async () => {
    // Distinct from an absent only — unticking everyone must not fall back to all.
    eq(total(rsi(THREE, { only: [] })), "00", "empty selection is a real selection");
  });

  await test("only is applied AFTER omitOnStatus", async () => {
    // Selecting a row the toggle has already dropped must not resurrect it.
    const out = rs([
      med("M1", "1411", { status: "MC", startDate: TODAY_D, endDate: "01 Jul 2026" }),
      med("M2", "1422", { status: "Pending" })
    ], { omitOnStatus: true, only: ["M1", "M2"] });
    ok(!has(out, "M1"), "the toggle wins over an explicit selection");
    ok(has(out, "M2"));
  });

  // ── Default-path neutrality (what the GAS port parity guard rests on) ─────

  suite("§4/§6 default path stays byte-identical");

  await test("omitting only leaves RS and RSI output unchanged", async () => {
    eq(rs(THREE, {}), rs(THREE), "RS: an opts object without only matches no opts at all");
    eq(rsi(THREE, {}), rsi(THREE), "RSI: likewise");
  });
};
