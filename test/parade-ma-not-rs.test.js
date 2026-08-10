// A Medical Appointment booked ahead with status "Pending" (the natural choice —
// the MO outcome is unknown when you book) used to land under REPORTING SICK,
// labelled RSI, on the day it came due.
//
// isRS's second disjunct is `status === "Pending" && medStatusActive(...)`, and
// medStatusActive for a Pending record is just `todayIso === start`. So the row
// sat quiet until its date arrived, then satisfied both halves — while the MA
// branch listed the same person under OTHERS, so they double-listed.
//
// Same failure the `!== "MR"` exclusion already prevents, for the same reason.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

const TODAY = "2026-06-29";        // a Monday, matching the other parade suites

// Verbatim from js/helpers.js — the classifier's real date parser. Fixtures must
// be "DD MMM YYYY"; this returns "" for ISO input.
function displayDateToISO(s) {
  if (!s) return "";
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const m = String(s).match(/^(\d{1,2})\s+(\w{3})(?:\s+(\d{4}))?/);
  if (!m) return "";
  const mon = months[m[2]];
  if (!mon) return "";
  return `${m[3] || String(new Date().getFullYear())}-${mon}-${m[1].padStart(2, "0")}`;
}
// Verbatim from js/helpers.js medStatusActive.
function medStatusActive(record, todayIso) {
  if (record.status === "NIL") return false;
  const start = displayDateToISO(record.startDate || record.date || "");
  if (!start) return false;
  if (record.status === "Pending") return todayIso === start;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return false;
  return todayIso >= start && todayIso <= end;
}

const ROSTER = [{ id: "0101", name: "Alpha One", fourD: "0101", rank: "REC", role: "Recruit", status: "Active" }];
const clone = o => JSON.parse(JSON.stringify(o));

function ctxWith(medical) {
  const STATE = { roster: clone(ROSTER), leave: [], medical: medical || [], appointments: [] };
  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat,
    STATE,
    configGet: key => (key === "companyPrefix" ? "B" : ""),
    displayDateToISO, medStatusActive,
    rankGroupOf: () => "Enlistee"
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "appointment-4d.js"), "utf8")
    + "\n"
    + fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8")
    + "\n;this.bpClassifyPerson = bpClassifyPerson;\n";
  vm.runInContext(src, sandbox, { filename: "braves-parade.js" });
  return sandbox;
}
const alpha = sb => sb.STATE.roster[0];

module.exports = async function run() {
  suite("parade: a Pending medical appointment is not a report-sick");

  await test("a type-MA row dated today with status Pending lands in OTHERS", () => {
    const sb = ctxWith([{ id: 1, d4: "0101", type: "MA", status: "Pending",
      date: "29 Jun 2026", reason: "Dental", outOfCamp: false }]);
    const c = sb.bpClassifyPerson(alpha(sb), TODAY);
    eq(c.sections.others.length, 1, "the MA branch should have listed them under OTHERS");
    ok(/Dental/.test(c.sections.others[0]), "OTHERS entry names the appointment");
  });

  await test("and NOT in REPORTING SICK", () => {
    const sb = ctxWith([{ id: 1, d4: "0101", type: "MA", status: "Pending",
      date: "29 Jun 2026", reason: "Dental", outOfCamp: false }]);
    const c = sb.bpClassifyPerson(alpha(sb), TODAY);
    eq(c.sections.reportingSick.length, 0, "an appointment is not a report-sick");
  });

  await test("negative control: a real Pending RSI still reaches REPORTING SICK", () => {
    // The guard must not have swallowed the case it exists to serve.
    const sb = ctxWith([{ id: 1, d4: "0101", type: "RSI", status: "Pending",
      date: "29 Jun 2026", reason: "Fever" }]);
    const c = sb.bpClassifyPerson(alpha(sb), TODAY);
    eq(c.sections.reportingSick.length, 1, "a genuine RSI must still list");
  });

  await test("negative control: an MR going for review still reaches MR", () => {
    const sb = ctxWith([{ id: 1, d4: "0101", type: "MR", status: "Pending",
      date: "29 Jun 2026", reason: "Review", time: "1400" }]);
    const c = sb.bpClassifyPerson(alpha(sb), TODAY);
    eq(c.sections.mr.length, 1, "MR must still list");
    eq(c.sections.reportingSick.length, 0, "and must not double-list");
  });
};
