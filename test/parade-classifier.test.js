// Functional guards for the §8 parade classifier (js/braves-parade.js):
//  • Bug 1 — a reported-sick (RSI/RSO) recruit drops off the active REPORTING
//    SICK list once the MO issues any status (MC/LD/Excuse/NIL/…).
//  • Bug 2 — bpIsNotAvailable counts only in-camp RSI or MR (RSO / LD / excuse
//    excluded).
// Loaded in a vm sandbox (calc.test.js pattern) with minimal stubs for the
// globals braves-parade.js leans on (STATE, configGet, displayDateToISO,
// medStatusActive). Only bpClassifyPerson / bpIsNotAvailable are exercised, so
// the parade/strength helpers' other deps (personPlatoon, rankGroupOf, …) are
// never called.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

const TODAY = "2026-06-29";

// ISO-or-blank: the tests store dates already in ISO, so just validate/echo.
function displayDateToISO(s) {
  const m = String(s == null ? "" : s).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}
// Faithful copy of helpers.js medStatusActive (the real dep) so the classifier
// behaves exactly as in the app.
function medStatusActive(record, todayIso) {
  if (record.status === "NIL") return false;
  const start = displayDateToISO(record.startDate || record.date || "");
  if (!start) return false;
  if (record.status === "Pending") return todayIso === start;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return false;
  return todayIso >= start && todayIso <= end;
}

function loadParade(medical) {
  const STATE = {
    roster: [{ id: "0001", name: "Test One", fourD: "1411", rank: "REC", role: "Recruit" }],
    medical: medical || [],
    leave: [],
    appointments: []
  };
  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat,
    STATE,
    configGet: key => (key === "companyPrefix" ? "B" : ""),
    displayDateToISO,
    medStatusActive
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8")
    + "\n;this.bpClassifyPerson = bpClassifyPerson; this.bpIsNotAvailable = bpIsNotAvailable;\n";
  vm.runInContext(src, sandbox, { filename: "braves-parade.js" });
  return sandbox;
}

const person = sb => sb.STATE.roster[0];

module.exports = async function run() {
  suite("parade classifier: Bug 1 — RS drops off once MO issues a status");

  await test("RSI reported today + Pending → on the REPORTING SICK list", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "Pending", startDate: TODAY }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.reportingSick.length, 1, "RSI Pending should report sick");
    eq(c.meta.reportingSick[0].type, "RSI");
  });

  await test("RSI given MC today → OFF reporting sick, now under ATT C", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "MC", startDate: TODAY, endDate: "2026-07-03" }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.reportingSick.length, 0, "assigned MC must drop off REPORTING SICK");
    eq(c.sections.attC.length, 1, "MC should surface under ATT C");
    ok(c.notInCamp, "MC is not-in-camp");
  });

  await test("RSI given LD today → OFF reporting sick, now under STATUS", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "LD", startDate: TODAY, endDate: "2026-07-03" }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.reportingSick.length, 0, "assigned LD must drop off REPORTING SICK");
    eq(c.sections.status.length, 1, "LD should surface under STATUS");
  });

  await test("RSI cleared (NIL) today → OFF reporting sick entirely", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "NIL", startDate: TODAY }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.reportingSick.length, 0, "cleared (NIL) must drop off REPORTING SICK");
  });

  await test("RSO reported today + Pending → still on REPORTING SICK (RSO)", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSO", date: TODAY, status: "Pending", startDate: TODAY }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.reportingSick.length, 1);
    eq(c.meta.reportingSick[0].type, "RSO");
  });

  suite("parade classifier: Bug 2 — bpIsNotAvailable = in-camp RSI or MR");

  await test("in-camp RSI → not available", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "Pending", startDate: TODAY }]);
    ok(sb.bpIsNotAvailable(person(sb), TODAY) === true);
  });

  await test("MR → not available", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "MR", date: TODAY, status: "", startDate: TODAY }]);
    ok(sb.bpIsNotAvailable(person(sb), TODAY) === true);
  });

  await test("RSO (report sick OUTSIDE) → available (excluded)", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSO", date: TODAY, status: "Pending", startDate: TODAY }]);
    ok(sb.bpIsNotAvailable(person(sb), TODAY) === false);
  });

  await test("LD (in camp, restricted) → available (excluded)", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: "2026-06-28", status: "LD", startDate: "2026-06-28", endDate: "2026-07-03" }]);
    ok(sb.bpIsNotAvailable(person(sb), TODAY) === false);
  });

  await test("MC (not in camp) → available for the Not-Available bucket (excluded)", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "MC", startDate: TODAY, endDate: "2026-07-03" }]);
    ok(sb.bpIsNotAvailable(person(sb), TODAY) === false);
  });
};
