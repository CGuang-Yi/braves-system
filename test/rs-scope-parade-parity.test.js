// THE load-bearing check on the report-sick gate (spec §1.2).
//
// The gate withholds accumulated medical HISTORY but must return every
// OPERATIONAL row, because parade state is ungated (§1.1) and is generated on
// the client from STATE.medical. If the row cut is even slightly too aggressive,
// a scoped commander's company parade state quietly loses people — and the
// failure mode is the dangerous kind: the message still looks completely
// correct, just with someone missing from ATT C.
//
// So this drives the REAL backend read path for two accounts with different
// scopes, feeds each result to the REAL parade generator, and demands the two
// messages be byte-identical. The fixtures below are chosen to be exactly the
// rows a naive cut would drop.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, readVia, ROOT } = require("./harness");
const { makeBrowser } = require("./mocks/browser");
const { expandFiles } = require("./sources");

const FILES = expandFiles(["js/state.js", "js/appointment-4d.js", "js/helpers.js", "js/braves-parade.js"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const disp = iso => {
  const [y, m, d] = iso.split("-");
  return d + " " + MONTHS[parseInt(m, 10) - 1] + " " + y;
};
const isoOffset = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const dayOffset = n => disp(isoOffset(n));

const ROSTER_HEADERS = ["id", "name", "rank", "role", "status", "platoon", "section", "fourD"];
const ROSTER_ROWS = [
  ["0011", "PC ONE", "LTA", "Commander", "Active", "PLT1", "Command", "PC1"],
  ["0021", "PC TWO", "LTA", "Commander", "Active", "PLT2", "Command", "PC2"],
  ["1101", "REC ALPHA", "REC", "Recruit", "Active", "PLT1", "1", "1101"],
  ["1102", "REC BETA", "REC", "Recruit", "Active", "PLT1", "1", "1102"],
  ["2101", "REC BRAVO", "REC", "Recruit", "Active", "PLT2", "1", "2101"],
  ["2102", "REC CHARLIE", "REC", "Recruit", "Active", "PLT2", "1", "2102"],
  ["2103", "REC DELTA", "REC", "Recruit", "Active", "PLT2", "1", "2103"]
];
const MED_HEADERS = ["id", "d4", "type", "date", "reason", "status", "startDate", "endDate", "bookInDate"];

// Every row here is a boundary the cut has to get right for a PLT1 commander
// reading PLT2's people.
const MED_ROWS = [
  // 1. CURRENT MC, other platoon — window covers today. Must survive: they are
  //    away right now and belong under ATT C in everyone's parade state.
  ["m1", "2101", "RSI", dayOffset(-1), "URTI", "MC", dayOffset(-1), dayOffset(2), ""],
  // 2. ENDED but NEVER BOOKED IN, months old, other platoon. Must survive —
  //    PR #65's bookedInBy guard keeps them under ATT C indefinitely. This is
  //    the row a date-only cut silently drops.
  ["m2", "2102", "RSI", dayOffset(-200), "ankle", "MC", dayOffset(-200), dayOffset(-195), ""],
  // 3. Inside the 2-day ghost tail, other platoon. Must survive — MC+1/MC+2 are
  //    derived at render time from this CLOSED record.
  ["m3", "0021", "RSI", dayOffset(-3), "fever", "MC", dayOffset(-3), dayOffset(-1), dayOffset(-1)],
  // 3b. Recently ENDED and NOT booked in, other platoon. The classifier's
  //     bookedInBy guard keeps this one under ATT C, so it is the row that
  //     proves the cut actually feeds a person INTO the message (see the
  //     "actually IN that message" case below).
  ["m5", "2103", "RSI", dayOffset(-4), "sprain", "MC", dayOffset(-4), dayOffset(-1), ""],
  // 4. Closed, booked in, long past, other platoon. HISTORY — withheld, and it
  //    must make no difference to the message.
  ["m4", "2101", "RSI", dayOffset(-90), "old cough", "MC", dayOffset(-90), dayOffset(-85), dayOffset(-84)],
  // 5. Same, own platoon. Kept for the scoped commander, so the two accounts
  //    genuinely differ in what they hold — otherwise this test proves nothing.
  ["m6", "1101", "RSI", dayOffset(-60), "own history", "MC", dayOffset(-60), dayOffset(-55), dayOffset(-54)],
  // 6. Live LD, own platoon.
  ["m7", "1102", "RSI", dayOffset(-1), "knee", "LD", dayOffset(-1), dayOffset(3), ""]
];

function tokenFor(b, name, personId, role, caps) {
  b.db.setProp("auth:" + name, JSON.stringify({
    email: name + "@example.com", personId: personId, role: role,
    caps: caps || "", issuedAt: new Date().toISOString()
  }));
  return name;
}

// Load the parade generator over a given readAll payload and produce the
// company parade state exactly as the app would.
function paradeStateFrom(payload) {
  const browser = makeBrowser();
  const sb = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, Intl
  }, browser.globals);
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
  }
  vm.runInContext(
    "Object.keys(STATE).forEach(k => { delete STATE[k]; }); Object.assign(STATE, " + JSON.stringify({
      roster: payload.roster || [], medical: payload.medical || [], leave: payload.leave || [],
      appointments: payload.appointments || [], msk: payload.msk || [], platoons: payload.platoons || [],
      config: {}, conductDetail: [], attendance: [],
      filterPlt: "", filterSect: "", filterRole: ""
    }) + ");", sb, { filename: "install-payload.js" });
  return vm.runInContext(
    "generateBravesParadeState({level:'company'}, 'FP', " + JSON.stringify(isoOffset(0)) + ", '0730')",
    sb);
}

module.exports = async function run() {
  suite("rs-scope: the scoped parade state is byte-identical to the admin's");

  const setup = () => {
    const b = loadBackend();
    b.db.seed("Roster", ROSTER_HEADERS, ROSTER_ROWS);
    b.db.seed("Medical", MED_HEADERS, MED_ROWS);
    return b;
  };
  const readAllAs = (b, tok) =>
    readVia(b, { action: "readAll", auth: tok });

  await test("the two accounts really do receive different data", () => {
    // Negative control. Without this, an identical parade state below could
    // simply mean the gate never engaged and the test proves nothing.
    const b = setup();
    const admin = readAllAs(b, tokenFor(b, "adm", "0011", "admin"));
    const scoped = readAllAs(b, tokenFor(b, "pc1", "0011", "commander"));
    eq(admin.scopeKey, "company", "admin holds company scope");
    eq(scoped.scopeKey, "PLT1", "the commander is scoped to PLT1");
    ok(scoped.medical.length < admin.medical.length,
      `the gate withheld nothing: ${scoped.medical.length} vs ${admin.medical.length}`);
    // Specifically: the other platoon's closed, booked-in history.
    ok(admin.medical.some(m => m.id === "m4"), "admin sees PLT2's old history");
    ok(!scoped.medical.some(m => m.id === "m4"), "PLT2's old history reached a PLT1 commander");
    // And the commander keeps their OWN platoon's history.
    ok(scoped.medical.some(m => m.id === "m6"), "the commander lost their own platoon's history");
  });

  await test("the company parade state is byte-identical for both", () => {
    const b = setup();
    const admin = paradeStateFrom(readAllAs(b, tokenFor(b, "adm", "0011", "admin")));
    const scoped = paradeStateFrom(readAllAs(b, tokenFor(b, "pc1", "0011", "commander")));
    ok(admin.length > 100, "the fixture produced no parade state to compare");
    eq(scoped, admin, "the scoped commander's company parade state differs from the admin's");
  });

  await test("the out-of-scope away people are actually IN that message", () => {
    // Guards the guard: if these people were missing from BOTH messages the two
    // would still match, and the byte-identity test above would pass while the
    // cut was quietly wrong.
    const b = setup();
    const msg = paradeStateFrom(readAllAs(b, tokenFor(b, "pc1", "0011", "commander")));
    ok(/BRAVO/.test(msg), "the other platoon's OPEN MC is absent from the parade state entirely");
    ok(/DELTA/.test(msg), "the other platoon's ended-but-unbooked MC is absent — the cut dropped an ATT C person");
  });

  // Worth recording because it looks like a discrepancy and is not. The cut
  // deliberately returns an ended-but-unbooked row of ANY age (PR #65's guard
  // has no time limit), but the classifier stops listing one once it is far
  // past the MC+1/MC+2 window. So the gate hands the client more than the
  // message needs — which is the safe direction. Under-returning would break
  // parade state; over-returning costs nothing and survives a classifier change.
  await test("a very old ended-unbooked row is returned by the gate, though the classifier hides it", () => {
    const b = setup();
    const admin = readAllAs(b, tokenFor(b, "adm", "0011", "admin"));
    const scoped = readAllAs(b, tokenFor(b, "pc1", "0011", "commander"));
    ok(admin.medical.some(m => m.id === "m2"), "admin lost the 200-day-old unbooked row");
    ok(scoped.medical.some(m => m.id === "m2"),
      "the cut dropped a 200-day-old ended-but-unbooked row — PR #65's guard has no time limit");
  });

  await test("an rs:plt-granted account matches too, and HQ is its own scope", () => {
    const b = setup();
    const admin = paradeStateFrom(readAllAs(b, tokenFor(b, "adm", "0011", "admin")));
    const plt2 = paradeStateFrom(readAllAs(b, tokenFor(b, "grant", "9999", "commander", "rs:plt:plt2")));
    eq(plt2, admin, "an explicitly-granted account's parade state differs from the admin's");
  });

  await test("even an EMPTY scope produces the same parade state", () => {
    // The harshest case: an account whose platoon cannot be resolved sees no
    // history at all. Today's operational picture must still be complete, or a
    // roster data problem would silently corrupt a parade state.
    const b = setup();
    const admin = paradeStateFrom(readAllAs(b, tokenFor(b, "adm", "0011", "admin")));
    const none = readAllAs(b, tokenFor(b, "orphan", "8888", "commander"));
    eq(none.scopeKey, "", "expected an empty scope");
    eq(paradeStateFrom(none), admin, "an empty-scope account's parade state differs from the admin's");
  });
};
