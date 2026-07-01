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
    + "\n;this.bpClassifyPerson = bpClassifyPerson; this.bpIsNotAvailable = bpIsNotAvailable; this.bpSickFollowUp = bpSickFollowUp;\n";
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

  suite("parade classifier: Bug 3 — MR drops off parade state once resolved");

  await test("MR reported today + blank status → still on the MR list", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "MR", date: TODAY, status: "", startDate: TODAY }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.mr.length, 1, "unresolved MR should be on the MR list");
  });

  await test("MR reported today + Pending → still on the MR list", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "MR", date: TODAY, status: "Pending", startDate: TODAY }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.mr.length, 1, "Pending MR should still be on the MR list");
  });

  await test("MR given MC today → OFF the MR list, now under ATT C", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "MR", date: TODAY, status: "MC", startDate: TODAY, endDate: "2026-07-03" }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.mr.length, 0, "resolved MR (MC) must drop off the MR list");
    eq(c.sections.attC.length, 1, "MC should surface under ATT C instead");
  });

  await test("MR given LD today → OFF the MR list, now under STATUS", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "MR", date: TODAY, status: "LD", startDate: TODAY, endDate: "2026-07-03" }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.mr.length, 0, "resolved MR (LD) must drop off the MR list");
    eq(c.sections.status.length, 1, "LD should surface under STATUS instead");
  });

  await test("MR cleared (NIL) today → OFF the MR list entirely", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "MR", date: TODAY, status: "NIL", startDate: TODAY }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.mr.length, 0, "cleared (NIL) MR must drop off the MR list");
  });

  await test("resolved MR (LD, still in camp) no longer counts toward bpIsNotAvailable", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "MR", date: TODAY, status: "LD", startDate: TODAY, endDate: "2026-07-03" }]);
    ok(sb.bpIsNotAvailable(person(sb), TODAY) === false, "resolved MR must not inflate Not Available");
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

  suite("parade classifier: explicit isInCamp (In Camp / Not In Camp toggle)");

  await test("AL/OIL type (Leave) with isInCamp:true → counts as in camp", () => {
    const sb = loadParade();
    sb.STATE.leave = [{ id: 1, d4: "0001", type: "Leave", startDate: TODAY, endDate: TODAY, isInCamp: true }];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.alOil.length, 1, "still shows under AL/OIL");
    ok(c.notInCamp === false, "override forces in-camp despite AL/OIL type");
  });

  await test("AL/OIL type (Weekend) without isInCamp → still not-in-camp (regression)", () => {
    const sb = loadParade();
    sb.STATE.leave = [{ id: 1, d4: "0001", type: "Weekend", startDate: TODAY, endDate: TODAY }];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    ok(c.notInCamp === true, "unchecked AL/OIL leave remains not-in-camp");
  });

  await test("OTHERS type (Guard Duty) with a book-out reason + isInCamp:true → override wins", () => {
    const sb = loadParade();
    sb.STATE.leave = [{ id: 1, d4: "0001", type: "Guard Duty", startDate: TODAY, endDate: TODAY, reason: "book out for stores run", isInCamp: true }];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.others.length, 1);
    ok(c.notInCamp === false, "isInCamp overrides the negative reason-keyword guess");
  });

  await test("OTHERS type (Guard Duty) with isInCamp missing → NOT in camp (no more reason-keyword guessing)", () => {
    const sb = loadParade();
    sb.STATE.leave = [{ id: 1, d4: "0001", type: "Guard Duty", startDate: TODAY, endDate: TODAY, reason: "gate duty" }];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    ok(c.notInCamp === true, "missing isInCamp now defaults to Not In Camp instead of being guessed from the reason text");
  });

  await test("OTHERS type (Course) explicitly isInCamp:false with no book-out keyword → NOT in camp (the reported bug, fixed)", () => {
    const sb = loadParade();
    sb.STATE.leave = [{ id: 1, d4: "0001", type: "Course", startDate: TODAY, endDate: TODAY, reason: "APSC course", isInCamp: false }];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    ok(c.meta.others[0].line.includes("NOT IN CAMP"), "label must read NOT IN CAMP");
    ok(c.notInCamp === true, "explicit isInCamp:false must win even though the reason text has no book-out keyword");
  });

  await test("AL/OIL type (Leave) explicitly isInCamp:false → still not in camp", () => {
    const sb = loadParade();
    sb.STATE.leave = [{ id: 1, d4: "0001", type: "Leave", startDate: TODAY, endDate: TODAY, isInCamp: false }];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    ok(c.notInCamp === true, "explicit isInCamp:false on an AL/OIL type stays not-in-camp");
  });

  await test("two active leave rows same day, only one isInCamp:true → still counts as in camp (additive)", () => {
    const sb = loadParade();
    sb.STATE.leave = [
      { id: 1, d4: "0001", type: "Leave", startDate: TODAY, endDate: TODAY },
      { id: 2, d4: "0001", type: "Course", startDate: TODAY, endDate: TODAY, reason: "book out for range", isInCamp: true }
    ];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    ok(c.notInCamp === false, "any overridden row pulls the person in, regardless of other un-overridden rows");
  });

  await test("isInCamp:true leave row + active MC same day → still NOT in camp (override doesn't reach medical)", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "MC", startDate: TODAY, endDate: "2026-07-03" }]);
    sb.STATE.leave = [{ id: 1, d4: "0001", type: "Guard Duty", startDate: TODAY, endDate: TODAY, isInCamp: true }];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    ok(c.notInCamp === true, "MC still excludes the person even though their leave row is overridden");
  });

  suite("parade classifier: STATUS section shows duration for every status, not just LD");

  await test("RIB with a date range → duration prefix, same as LD", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "RIB (Rest in Bunk)", startDate: TODAY, endDate: "2026-07-03" }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.status.length, 1, "RIB should surface under STATUS");
    ok(c.sections.status[0].includes("5D RIB (Rest in Bunk)"), `expected a 5D prefix, got: ${c.sections.status[0]}`);
  });

  await test("Excuse-* with a date range → duration prefix, same as LD", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "RSI", date: TODAY, status: "Excuse RMJ", startDate: TODAY, endDate: "2026-07-03" }]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.status.length, 1, "Excuse-* should surface under STATUS");
    ok(c.sections.status[0].includes("5D Excuse RMJ"), `expected a 5D prefix, got: ${c.sections.status[0]}`);
  });

  suite("bpSickFollowUp: FOLLOW UP STATUS FROM MO shows duration for every status, not just MC/LD");

  await test("MC → duration prefix (unchanged)", () => {
    const sb = loadParade();
    eq(sb.bpSickFollowUp({ status: "MC", startDate: TODAY, endDate: "2026-07-03" }), "5D MC");
  });

  await test("LD → duration prefix (unchanged)", () => {
    const sb = loadParade();
    eq(sb.bpSickFollowUp({ status: "LD", startDate: TODAY, endDate: "2026-07-03" }), "5D LD");
  });

  await test("RIB → now gets a duration prefix too", () => {
    const sb = loadParade();
    eq(sb.bpSickFollowUp({ status: "RIB (Rest in Bunk)", startDate: TODAY, endDate: "2026-07-03" }), "5D RIB (Rest in Bunk)");
  });

  await test("Excuse-* → now gets a duration prefix too", () => {
    const sb = loadParade();
    eq(sb.bpSickFollowUp({ status: "Excuse RMJ", startDate: TODAY, endDate: "2026-07-03" }), "5D Excuse RMJ");
  });

  await test("Warded → still no duration (kept as plain status text)", () => {
    const sb = loadParade();
    eq(sb.bpSickFollowUp({ status: "Warded", startDate: TODAY, endDate: "2026-07-03" }), "Warded");
  });

  await test("NIL with leftover start/end dates → still no duration prefix", () => {
    const sb = loadParade();
    eq(sb.bpSickFollowUp({ status: "NIL", startDate: "2026-06-29", endDate: "2026-07-01" }), "NIL");
  });

  await test("Pending → still blank", () => {
    const sb = loadParade();
    eq(sb.bpSickFollowUp({ status: "Pending", startDate: TODAY }), "");
  });
};
