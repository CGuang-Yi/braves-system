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

  suite("parade classifier: an ENDED MC persists under ATT C through the MC+1/MC+2 window, then auto-hides");

  await test("MC ended two days ago (MC+2) + roster.status still 'MC' → stays under ATT C, not in camp", () => {
    // MC 25–27 Jun, TODAY is 29 Jun (ended two days ago, so still inside the
    // MC+1/MC+2 recovery window); nobody has booked them back in, so the roster
    // mirror still reads "MC".
    const sb = loadParade([{ id: 1, d4: "0001", type: "", status: "MC", startDate: "2026-06-25", endDate: "2026-06-27" }]);
    person(sb).status = "MC";
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.attC.length, 1, "ended MC within the ghost window should persist under ATT C");
    ok(c.sections.attC[0].includes("3D MC"), `expected the real 3D MC dates, got: ${c.sections.attC[0]}`);
    ok(c.notInCamp, "a persisted MC still counts as out of camp");
  });

  await test("MC ended three days ago (past MC+2) + stale roster.status 'MC' → AUTO-HIDDEN, present", () => {
    // MC 24–26 Jun, TODAY is 29 Jun (ended three days ago → past the MC+1/MC+2
    // window). The mirror is a stale "MC" nobody cleared; it must no longer park
    // the recruit under ATT C ("shows MC but not actually on MC" fix).
    const sb = loadParade([{ id: 1, d4: "0001", type: "", status: "MC", startDate: "2026-06-24", endDate: "2026-06-26" }]);
    person(sb).status = "MC";
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.attC.length, 0, "a long-lapsed MC must auto-hide from ATT C");
    ok(!c.notInCamp, "a long-lapsed MC no longer counts as out of camp");
  });

  await test("MC ended + roster.status 'Active' (booked in) → dropped from ATT C, present", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "", status: "MC", startDate: "2026-06-25", endDate: "2026-06-27" }]);
    person(sb).status = "Active";   // manually booked back in — mirror cleared
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.attC.length, 0, "a booked-in recruit must not persist as MC");
    ok(!c.notInCamp, "a booked-in recruit is in camp");
  });

  await test("active MC + roster.status 'MC' → single ATT C entry (persistence must not double it)", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "", status: "MC", startDate: TODAY, endDate: "2026-07-03" }]);
    person(sb).status = "MC";
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.attC.length, 1, "an active MC should not be doubled by the persistence rule");
  });

  await test("roster.status 'MC' but the date is BEFORE the MC ended → no back-dated ATT C", () => {
    const sb = loadParade([{ id: 1, d4: "0001", type: "", status: "MC", startDate: "2026-06-25", endDate: "2026-06-27" }]);
    person(sb).status = "MC";
    const c = sb.bpClassifyPerson(person(sb), "2026-06-20");
    eq(c.sections.attC.length, 0, "persistence must not back-date onto pre-MC days on the Status Board");
  });

  await test("mirror 'MC' with a later MC → persist only within that MC's ghost window, auto-hide after", () => {
    // MC1 01–03 Jun, MC2 20–22 Jun. The mirror still reads "MC" (never booked in).
    // The ghost window is now bounded to MC+1/MC+2 of the MOST RECENT ended MC.
    const sb = loadParade([
      { id: 1, d4: "0001", type: "", status: "MC", startDate: "2026-06-01", endDate: "2026-06-03" },
      { id: 2, d4: "0001", type: "", status: "MC", startDate: "2026-06-20", endDate: "2026-06-22" }
    ]);
    person(sb).status = "MC";
    // 10 Jun: MC1 ended 7 days ago (past MC+2), MC2 still future → auto-hidden.
    const gap = sb.bpClassifyPerson(person(sb), "2026-06-10");
    eq(gap.sections.attC.length, 0, "a long-lapsed MC in the gap must auto-hide");
    ok(!gap.notInCamp, "auto-hidden gap MC is not out of camp");
    // 24 Jun: MC2 ended two days ago (MC+2) → still within the window, persists.
    const tail = sb.bpClassifyPerson(person(sb), "2026-06-24");
    eq(tail.sections.attC.length, 1, "the MC+2 tail after the latest ended MC persists");
    ok(tail.sections.attC[0].includes("200626-220626"), `expected MC2's dates, got: ${tail.sections.attC[0]}`);
    // 26 Jun: MC2 ended four days ago (past MC+2) → auto-hidden.
    const after = sb.bpClassifyPerson(person(sb), "2026-06-26");
    eq(after.sections.attC.length, 0, "past the window the tail auto-hides too");
  });

  suite("parade classifier: overlapping same-type statuses collapse to the one ending last");

  await test("two overlapping Excuse Running rows → only the later-ending one shows (STATUS)", () => {
    const sb = loadParade([
      { id: 1, d4: "0001", type: "", status: "Excuse Running", startDate: "2026-06-27", endDate: "2026-06-30" },
      { id: 2, d4: "0001", type: "", status: "Excuse Running", startDate: "2026-06-28", endDate: "2026-07-04" }
    ]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.status.length, 1, "same-label overlap must collapse to a single STATUS line");
    ok(c.sections.status[0].includes("040726"), `the later-ending row (04 Jul) must win, got: ${c.sections.status[0]}`);
    ok(!c.sections.status[0].includes("300626"), "the earlier-ending row (30 Jun) must be dropped");
  });

  await test("Excuse Running + Excuse RMJ (different labels) → both survive (folded, not superseded)", () => {
    const sb = loadParade([
      { id: 1, d4: "0001", type: "", status: "Excuse Running", startDate: "2026-06-27", endDate: "2026-07-04" },
      { id: 2, d4: "0001", type: "", status: "Excuse RMJ", startDate: "2026-06-28", endDate: "2026-07-02" }
    ]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    ok(c.sections.status[0].includes("Excuse Running") && c.sections.status[0].includes("Excuse RMJ"),
      `distinct labels must both remain, got: ${c.sections.status[0]}`);
  });

  await test("two overlapping AL/OIL rows of the same type → only the later-ending one shows", () => {
    const sb = loadParade();
    sb.STATE.leave = [
      { id: 1, d4: "0001", type: "Leave", startDate: "2026-06-27", endDate: "2026-06-29" },
      { id: 2, d4: "0001", type: "Leave", startDate: "2026-06-28", endDate: "2026-07-02" }
    ];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.alOil.length, 1, "same-type AL/OIL overlap must collapse to one line");
    ok(c.sections.alOil[0].includes("020726"), `the later-ending leave (02 Jul) must win, got: ${c.sections.alOil[0]}`);
    ok(!c.sections.alOil[0].includes("290626"), "the earlier-ending leave (29 Jun) must be dropped");
  });

  await test("two overlapping OTHERS rows of the same type → only the later-ending one shows", () => {
    const sb = loadParade();
    sb.STATE.leave = [
      { id: 1, d4: "0001", type: "Course", startDate: "2026-06-27", endDate: "2026-06-29", reason: "Course A", isInCamp: false },
      { id: 2, d4: "0001", type: "Course", startDate: "2026-06-28", endDate: "2026-07-02", reason: "Course B", isInCamp: false }
    ];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.others.length, 1, "same-type OTHERS overlap must collapse to one line");
    ok(c.sections.others[0].includes("Course B"), `the later-ending OTHERS row must win, got: ${c.sections.others[0]}`);
    ok(!c.sections.others[0].includes("Course A"), "the earlier-ending OTHERS row must be dropped");
  });

  await test("OTHERS rows of different types (Course + Guard Duty) → both survive", () => {
    const sb = loadParade();
    sb.STATE.leave = [
      { id: 1, d4: "0001", type: "Course", startDate: "2026-06-27", endDate: "2026-06-30", reason: "APSC", isInCamp: false },
      { id: 2, d4: "0001", type: "Guard Duty", startDate: "2026-06-28", endDate: "2026-07-02", reason: "gate", isInCamp: false }
    ];
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.others.length, 2, "distinct OTHERS types must not supersede each other");
  });

  await test("two overlapping Warded rows → only the later-ending one shows (OTHERS)", () => {
    const sb = loadParade([
      { id: 1, d4: "0001", type: "", status: "Warded", startDate: "2026-06-27", endDate: "2026-06-29", reason: "Warded A" },
      { id: 2, d4: "0001", type: "", status: "Warded", startDate: "2026-06-28", endDate: "2026-07-02", reason: "Warded B" }
    ]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.others.length, 1, "same-type Warded overlap must collapse to one line");
    ok(c.sections.others[0].includes("Warded B"), `the later-ending Warded row must win, got: ${c.sections.others[0]}`);
    ok(!c.sections.others[0].includes("Warded A"), "the earlier-ending Warded row must be dropped");
  });

  await test("two overlapping MC rows → only the later-ending one shows (ATT C)", () => {
    const sb = loadParade([
      { id: 1, d4: "0001", type: "", status: "MC", startDate: "2026-06-27", endDate: "2026-06-29" },
      { id: 2, d4: "0001", type: "", status: "MC", startDate: "2026-06-28", endDate: "2026-07-02" }
    ]);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.attC.length, 1, "same-type MC overlap must collapse to one line");
    ok(c.sections.attC[0].includes("020726"), `the later-ending MC (02 Jul) must win, got: ${c.sections.attC[0]}`);
    ok(!c.sections.attC[0].includes("290626"), "the earlier-ending MC (29 Jun) must be dropped");
  });
};
