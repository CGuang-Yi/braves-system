// Book-in applies to AWAY records only, never to in-camp restricted statuses.
//
// The bug these guard against: "Mark Present" (paradeEndActiveContributors)
// stamped `bookInDate` onto EVERY active Medical row for the person, and the §8
// classifier's STATUS branch honoured it. So marking a recruit Present on return
// from a 2-day MC also booked in the 84-day LD they were still on, and the LD
// went silent in the parade state for the rest of its run — the recruit read
// Present with no status while carrying a live medical restriction.
//
// `bookInDate` means "back in camp". That is only meaningful for a record that
// put the person OUT of camp (MC, Warded, AL/OIL, an out-of-camp appointment).
// LD / RIB / Excuse-* are in-camp restrictions: the recruit was never away, so
// booking them in cannot end them.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

const TODAY = "2026-08-03";
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

// Accepts both the ISO the tests write and the display format the app stores,
// because this suite asserts on real stored rows (display dates) as well.
function displayDateToISO(s) {
  s = String(s == null ? "" : s).trim();
  if (!s) return "";
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}` : "";
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

function classify(medical, leave) {
  const STATE = { roster: [PERSON], medical, leave: leave || [], appointments: [] };
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

const joined = c => Object.keys(c.sections).flatMap(k => c.sections[k]).join(" | ");

module.exports = async function run() {
  suite("book-in: in-camp statuses survive it");

  // The exact shape that produced the report: an 84-day LD stamped with a
  // bookInDate from an unrelated MC return, still 6 weeks from its end date.
  await test("an active LD carrying a bookInDate still appears under STATUS", () => {
    const c = classify([{
      id: 1, d4: "4308", date: "23 Jun 2026", reason: "PNEUMONIA", status: "LD",
      startDate: "23 Jun 2026", endDate: "14 Sep 2026", bookInDate: "28 Jul 2026", type: ""
    }]);
    eq(c.sections.status.length, 1, "the LD must not be erased by a book-in stamp");
    ok(/84D LD/.test(c.sections.status[0]), "and keeps its real duration: " + c.sections.status[0]);
  });

  await test("an Excuse status carrying a bookInDate also survives", () => {
    const c = classify([{
      id: 1, d4: "4308", date: "01 Jul 2026", reason: "ANKLE", status: "Excuse PT",
      startDate: "01 Jul 2026", endDate: "30 Sep 2026", bookInDate: "28 Jul 2026", type: "RSI"
    }]);
    eq(c.sections.status.length, 1, "Excuse PT is in-camp and unaffected by book-in");
  });

  // The other half of the guard: away records must STILL honour book-in, or
  // PR #65's whole point is lost.
  await test("a booked-in MC is still suppressed from ATT C", () => {
    const c = classify([{
      id: 1, d4: "4308", date: "01 Aug 2026", reason: "FLU", status: "MC",
      startDate: "01 Aug 2026", endDate: "10 Aug 2026", bookInDate: "02 Aug 2026", type: "RSI"
    }]);
    eq(c.sections.attC.length, 0, "book-in still ends an away status");
    eq(c.notInCamp, false, "and the person reads present");
  });

  await test("a booked-in Warded record is still suppressed from OTHERS", () => {
    const c = classify([{
      id: 1, d4: "4308", date: "01 Aug 2026", reason: "WARD 5", status: "Warded",
      startDate: "01 Aug 2026", endDate: "10 Aug 2026", bookInDate: "02 Aug 2026", type: "RSI"
    }]);
    eq(c.sections.others.length, 0, "Warded is away and still honours book-in");
  });

  await test("a booked-in AL/OIL leave row is still suppressed", () => {
    const c = classify([], [{
      id: 1, d4: "4308", type: "Leave", startDate: "01 Aug 2026", endDate: "10 Aug 2026",
      reason: "AL", isInCamp: false, bookInDate: "02 Aug 2026"
    }]);
    eq(c.sections.alOil.length, 0, "leave is away and still honours book-in");
  });

  // The combination from the real report: booked in off the MC, still on the LD.
  await test("booked in off an MC while still on an LD → MC gone, LD stays", () => {
    const c = classify([
      { id: 1, d4: "4308", date: "26 Jul 2026", reason: "COUGH", status: "MC",
        startDate: "26 Jul 2026", endDate: "10 Aug 2026", bookInDate: "28 Jul 2026", type: "RSO" },
      { id: 2, d4: "4308", date: "23 Jun 2026", reason: "PNEUMONIA", status: "LD",
        startDate: "23 Jun 2026", endDate: "14 Sep 2026", bookInDate: "28 Jul 2026", type: "" }
    ]);
    eq(c.sections.attC.length, 0, "the MC they were booked in from is gone");
    eq(c.sections.status.length, 1, "the LD they are still on remains: " + joined(c));
    eq(c.notInCamp, false, "and they count as in camp");
  });

  suite("book-in: Mark Present stamps away records only");

  // paradeEndActiveContributors lives in parade-tab.js and reaches for several
  // app globals; stub only what this function touches.
  function markPresent(medical) {
    const STATE = { medical, leave: [], appointments: [] };
    const sb = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, STATE,
      displayDateToISO, medStatusActive,
      isoToDisplayDate: iso => {
        const [y, m, d] = iso.split("-");
        return `${d} ${Object.keys(MONTHS).find(k => MONTHS[k] === m)} ${y}`;
      },
      // parade-tab declares its own paradeCurrentDateISO, so a stub here would be
      // shadowed — stub what IT reads instead, and let the real function run.
      todayISO: () => TODAY,
      // parade-tab.js is the data-action migration pilot and registers its
      // handlers at load time; the registry itself lives in actions.js.
      registerActions: () => {}
    };
    vm.createContext(sb);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "js", "parade-tab.js"), "utf8") +
      "\n;this.paradeEndActiveContributors = paradeEndActiveContributors;\n",
      sb, { filename: "parade-tab.js" });
    const changed = [];
    sb.paradeEndActiveContributors("4308", changed);
    return { medical, changed };
  }

  await test("an active LD is left untouched by Mark Present", () => {
    const ld = { id: 1, d4: "4308", status: "LD", startDate: "23 Jun 2026",
      endDate: "14 Sep 2026", bookInDate: "", type: "" };
    const { changed } = markPresent([ld]);
    eq(ld.bookInDate, "", "no stamp on an in-camp status");
    eq(changed.length, 0, "and nothing is queued for the sheet");
  });

  await test("an active MC is still stamped by Mark Present", () => {
    const mc = { id: 1, d4: "4308", status: "MC", startDate: "01 Aug 2026",
      endDate: "10 Aug 2026", bookInDate: "", type: "RSI" };
    const { changed } = markPresent([mc]);
    eq(mc.bookInDate, "03 Aug 2026", "away statuses are still booked in");
    eq(changed.length, 1);
  });

  await test("Pending still resolves to NIL", () => {
    const p = { id: 1, d4: "4308", status: "Pending", startDate: TODAY, endDate: "",
      bookInDate: "", type: "RSI" };
    const { changed } = markPresent([p]);
    eq(p.status, "NIL", "Pending has no range to keep, so it resolves");
    eq(changed.length, 1);
  });

  await test("Mark Present on an MC leaves a concurrent LD alone", () => {
    const mc = { id: 1, d4: "4308", status: "MC", startDate: "01 Aug 2026",
      endDate: "10 Aug 2026", bookInDate: "", type: "RSO" };
    const ld = { id: 2, d4: "4308", status: "LD", startDate: "23 Jun 2026",
      endDate: "14 Sep 2026", bookInDate: "", type: "" };
    const { changed } = markPresent([mc, ld]);
    eq(mc.bookInDate, "03 Aug 2026");
    eq(ld.bookInDate, "", "the LD is not collateral damage");
    eq(changed.length, 1, "only the MC is written back");
  });
};
