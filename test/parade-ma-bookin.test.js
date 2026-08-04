// "Mark Present" must actually clear a same-day Medical Appointment (type MA).
//
// The bug: on the parade grid an out-of-camp MA renders as an editable OTHERS
// pill, but choosing "Present" did nothing — the person stayed under OTHERS
// (NOT IN CAMP) and kept subtracting from current strength.
//
// Root cause: the classifier's MA branch (braves-parade.js) is DATE-driven and
// completely status-independent — it fires for any type-MA row dated today and
// only drops off once the row carries a `bookInDate`. But book-in
// (paradeEndActiveContributors) was STATUS-driven: it bailed out on
// `status === "NIL"` and on `!medStatusActive(m, iso)` before ever reaching its
// `m.type === "MA"` stamp. A real appointment is logged with status NIL (the MO
// issued nothing) or Pending, and carries no end date — so it is never
// medStatusActive, and that MA stamp was dead code for every appointment that
// did not ALSO happen to be an active MC.
//
// These tests drive the two halves against each other: book in, then re-classify
// and assert the person actually reads present.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

const TODAY = "2026-08-03";
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

function displayDateToISO(s) {
  s = String(s == null ? "" : s).trim();
  if (!s) return "";
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}` : "";
}
function isoToDisplayDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d} ${Object.keys(MONTHS).find(k => MONTHS[k] === m)} ${y}`;
}
function medStatusActive(record, todayIso) {
  if (record.status === "NIL") return false;
  const start = displayDateToISO(record.startDate || record.date || "");
  if (!start) return false;
  if (record.status === "Pending") return todayIso === start;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return false;
  return todayIso >= start && todayIso <= end;
}

const PERSON = { id: "4308", fourD: "4308", name: "Test One", rank: "REC", role: "Recruit" };

// §8 classifier over one person's medical rows — the read side of the pair.
function classify(medical) {
  const STATE = { roster: [PERSON], medical, leave: [], appointments: [] };
  const sb = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, STATE,
    configGet: k => (k === "companyPrefix" ? "B" : ""), displayDateToISO, medStatusActive
  };
  vm.createContext(sb);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8") +
    "\n;this.bpClassifyPerson = bpClassifyPerson;\n", sb, { filename: "braves-parade.js" });
  return sb.bpClassifyPerson(PERSON, TODAY);
}

// The write side: parade-tab's book-in, stubbed exactly as in
// bookin-incamp-status.test.js (same globals, same real paradeCurrentDateISO).
function markPresent(medical) {
  const STATE = { medical, leave: [], appointments: [] };
  const sb = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, STATE,
    displayDateToISO, medStatusActive, isoToDisplayDate,
    todayISO: () => TODAY,
    registerActions: () => {}
  };
  vm.createContext(sb);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "parade-tab.js"), "utf8") +
    "\n;this.paradeEndActiveContributors = paradeEndActiveContributors;\n",
    sb, { filename: "parade-tab.js" });
  const changed = [];
  sb.paradeEndActiveContributors("4308", changed);
  return changed;
}

const ma = over => ({
  id: 1, d4: "4308", date: "03 Aug 2026", reason: "DENTAL", type: "MA",
  status: "NIL", startDate: "", endDate: "", time: "0830", outOfCamp: true,
  bookInDate: "", ...over
});

module.exports = async function run() {
  suite("Mark Present clears a same-day medical appointment (MA)");

  await test("an out-of-camp MA today puts the person out of camp to begin with", () => {
    const c = classify([ma()]);
    eq(c.sections.others.length, 1, "the appointment is listed under OTHERS");
    eq(c.notInCamp, true, "and an out-of-camp appointment subtracts from strength");
  });

  await test("Mark Present stamps bookInDate on a status-NIL MA", () => {
    const row = ma();
    const changed = markPresent([row]);
    eq(row.bookInDate, "03 Aug 2026", "the appointment is booked in as of the parade date");
    eq(changed.length, 1, "and the row is queued for the sheet");
  });

  await test("after Mark Present the person reads present", () => {
    const row = ma();
    markPresent([row]);
    const c = classify([row]);
    eq(c.sections.others.length, 0, "the OTHERS entry is gone");
    eq(c.notInCamp, false, "and they count back into current strength");
  });

  await test("an in-camp MA is booked in the same way", () => {
    const row = ma({ outOfCamp: false });
    markPresent([row]);
    eq(classify([row]).sections.others.length, 0, "in-camp appointments clear too");
  });

  // The other status a real appointment is logged with: Pending, awaiting the
  // MO's outcome. It must BOTH resolve to NIL (the pending half) and be booked
  // in (the appointment half) — resolving alone left the date-driven MA branch
  // firing, so the pill snapped straight back.
  await test("a Pending MA both resolves and books in", () => {
    const row = ma({ status: "Pending", startDate: "03 Aug 2026" });
    markPresent([row]);
    eq(row.status, "NIL", "Pending resolves");
    eq(row.bookInDate, "03 Aug 2026", "and the appointment itself is booked in");
    eq(classify([row]).sections.others.length, 0, "so the OTHERS pill is gone");
  });

  // Guard the fix's blast radius: an MA row whose visit ALSO issued a live
  // in-camp status must not have that status silently ended. The MA half clears;
  // the LD half keeps running (the classifier's STATUS branch ignores bookInDate
  // by design — see bookin-incamp-status.test.js).
  await test("an MA that issued an LD clears the appointment, keeps the LD", () => {
    const row = ma({ status: "LD", startDate: "03 Aug 2026", endDate: "30 Sep 2026" });
    markPresent([row]);
    const c = classify([row]);
    eq(c.sections.others.length, 0, "the appointment is cleared");
    eq(c.sections.status.length, 1, "the LD it issued still stands");
  });

  // A past appointment is not today's business: Mark Present is scoped to the
  // parade date, and stamping an old MA would rewrite history.
  await test("an MA on another date is left alone", () => {
    const row = ma({ date: "01 Aug 2026" });
    const changed = markPresent([row]);
    eq(row.bookInDate, "", "no stamp on an appointment from another day");
    eq(changed.length, 0);
  });
};
