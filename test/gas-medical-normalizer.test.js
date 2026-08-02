// The GAS read boundary for Medical rows, and why it needs its own guard.
//
// bravesNormalizeMedical_ is a WHITELIST: it builds a fresh object naming each
// key it keeps. The ported classifier (bpClassifyPerson, inside the
// BRAVES-ARCHIVE-PORT block) reads the rows that function returns — never the
// raw sheet row — so a column missing from the whitelist is invisible to the
// server-side parade state no matter how correctly the classifier handles it.
//
// That is exactly how `time` and `outOfCamp` were lost. Both columns shipped,
// both were added to the classifier in BOTH copies, and parade-port-parity.test.js
// passed — because that suite feeds its fixtures STRAIGHT into bpClassifyPerson
// on both sides, bypassing this normalizer entirely. So the client (whose
// normalizeMedical did carry them) worked, while the cron archiver silently
// dropped MR timings and treated every out-of-camp medical
// appointment as in-camp — the one failure mode nobody looks at, since it only
// shows up in a message a human reads and assumes is right.
//
// The structural test below is the real guard: it asserts the two normalizers
// emit the SAME KEY SET, which catches the next dropped column in either
// direction without anyone having to remember this file exists. The behavioural
// tests underneath pin what the two recovered fields actually do.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");
const { loadBackend, ROOT } = require("./harness");
const { makeBrowser } = require("./mocks/browser");

const TODAY = "2026-06-29";           // a Monday; matches the parity suite

// Dates in fixtures MUST be "DD MMM YYYY" — displayDateToISO parses only that
// shape and returns "" for ISO input, which would make every row below inert
// and the assertions vacuous.
const TODAY_DISPLAY = "29 Jun 2026";

// Every column the Medical sheet actually has (apps-script-Code.gs header
// comment), populated with a distinguishable value so a dropped key is visible.
const RAW = {
  id: "m1", d4: "1411", date: TODAY_DISPLAY, reason: "knee review",
  location: "Medical Centre", status: "Pending",
  startDate: TODAY_DISPLAY, endDate: "", bookInDate: "",
  type: "MR", urtiType: "", mrTiming: "PM", visitId: "v1", origin: "manual",
  time: "1400", outOfCamp: "TRUE"
};

function feNormalize(rows) {
  const sb = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, Intl
  }, makeBrowser().globals);
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/state.js"), "utf8"),
    sb, { filename: "js/state.js" });
  return vm.runInContext(`normalizeMedical(${JSON.stringify(rows)})`, sb);
}

// Classify one person through the REAL read boundary: raw sheet rows in,
// normalizer applied, port's classifier run. This is the path the bot takes.
function classifyVia(medicalRaw, opts) {
  const b = loadBackend();
  const person = { id: "1411", name: "Alpha One", fourD: "1411", rank: "REC", role: "Recruit", status: "Active" };
  b.STATE = {
    roster: [person],
    medical: b.bravesNormalizeMedical_(medicalRaw),
    leave: [], appointments: [], platoons: [], config: []
  };
  return b.bpClassifyPerson(person, TODAY, opts);
}

module.exports = async function run() {
  suite("GAS Medical normalizer: key parity with the client");

  await test("both normalizers emit the same key set", () => {
    const gas = loadBackend().bravesNormalizeMedical_([RAW])[0];
    const fe = feNormalize([RAW])[0];
    const gk = Object.keys(gas).sort();
    const fk = Object.keys(fe).sort();
    eq(gk.join(","), fk.join(","),
      "a key present on one side only is a column the other side cannot see");
  });

  await test("every field the port's classifier reads survives the normalizer", () => {
    // Named explicitly rather than derived, so adding a classifier read without
    // adding it here is a deliberate act. These are the `m.<field>` reads inside
    // bpClassifyPerson's STATE.medical loop.
    const READS = ["d4", "date", "type", "status", "startDate", "endDate",
                   "bookInDate", "reason", "time", "outOfCamp"];
    const out = loadBackend().bravesNormalizeMedical_([RAW])[0];
    READS.forEach(k => ok(k in out, `classifier reads m.${k} but the normalizer drops it`));
  });

  suite("GAS Medical normalizer: the two recovered fields");

  await test("time is carried through verbatim, leading zero intact", () => {
    const out = loadBackend().bravesNormalizeMedical_(
      [Object.assign({}, RAW, { time: "0930" })])[0];
    eq(out.time, "0930");
  });

  await test("a missing time normalizes to a blank string, never undefined", () => {
    const raw = Object.assign({}, RAW);
    delete raw.time;
    eq(loadBackend().bravesNormalizeMedical_([raw])[0].time, "");
  });

  await test("outOfCamp coerces the shapes Sheets round-trips a boolean as", () => {
    const n = v => loadBackend().bravesNormalizeMedical_(
      [Object.assign({}, RAW, { outOfCamp: v })])[0].outOfCamp;
    eq(n(true), true);
    eq(n("TRUE"), true);
    eq(n("true"), true);
    eq(n(false), false);
    eq(n("FALSE"), false);
    eq(n(""), false);
    eq(n(undefined), false);
  });

  suite("GAS Medical normalizer: end-to-end through the ported classifier");

  await test("an MR carries its timing into the server-generated parade state", () => {
    const c = classifyVia([Object.assign({}, RAW, { time: "1400" })]);
    eq(c.sections.mr.length, 1);
    ok(/\(1400\)$/.test(c.sections.mr[0]), "MR line should end in the timing: " + c.sections.mr[0]);
  });

  await test("an MR with no time renders with no dangling parentheses", () => {
    const c = classifyVia([Object.assign({}, RAW, { time: "" })]);
    eq(c.sections.mr.length, 1);
    ok(!/\(/.test(c.sections.mr[0]), "no empty parentheses: " + c.sections.mr[0]);
  });

  await test("an out-of-camp MA reads NOT IN CAMP and leaves the strength", () => {
    const c = classifyVia([{
      id: "m2", d4: "1411", date: TODAY_DISPLAY, reason: "dental",
      status: "", startDate: TODAY_DISPLAY, endDate: "", bookInDate: "",
      type: "MA", visitId: "v2", origin: "manual", time: "1400", outOfCamp: "TRUE"
    }]);
    eq(c.sections.others.length, 1);
    ok(/OTHERS \(NOT IN CAMP\)/.test(c.sections.others[0]), c.sections.others[0]);
    eq(c.notInCamp, true);
  });

  await test("an in-camp MA reads IN CAMP and stays in the strength", () => {
    const c = classifyVia([{
      id: "m3", d4: "1411", date: TODAY_DISPLAY, reason: "dental",
      status: "", startDate: TODAY_DISPLAY, endDate: "", bookInDate: "",
      type: "MA", visitId: "v3", origin: "manual", time: "1400", outOfCamp: "FALSE"
    }]);
    eq(c.sections.others.length, 1);
    ok(/OTHERS \(IN CAMP\)/.test(c.sections.others[0]), c.sections.others[0]);
    eq(c.notInCamp, false);
  });
};
