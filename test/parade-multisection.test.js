// Regression lock for the parade classifier's SECTION MEMBERSHIP rules
// (js/braves-parade.js bpClassifyPerson), and the deliberate decision NOT to
// port upstream cougar-system's "a person is never listed in both ATTC and
// OTHERS" dedup (their PR, our assessment item #5).
//
// Braves spec is explicit (BRAVES_ADAPTATION_SPEC.md §"Listing is multi-section"):
//   • A person MAY be listed under multiple sections at once — multi-section
//     listing is THE RULE (the old "one category per person" framing is
//     superseded). e.g. ATT C (active MC) + OTHERS (a non-AL/OIL leave).
//   • The ONLY dedup is "never twice WITHIN the same section" (sibling medical
//     rows collapse to one entry — spec §"Dedupe multi-status visits").
//
// Upstream's cross-section ATTC/OTHERS dedup would VIOLATE the first rule, so it
// is intentionally not ported. These tests fail if anyone adds cross-section
// suppression, or breaks within-section dedup.
//
// Sandbox mirrors test/parade-classifier.test.js: load braves-parade.js with the
// three real deps stubbed (STATE, configGet, displayDateToISO, medStatusActive).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

const TODAY = "2026-06-29";

function displayDateToISO(s) {
  const m = String(s == null ? "" : s).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
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

function load(medical, leave) {
  const STATE = {
    roster: [{ id: "1201", d4: "1201", fourD: "1201", name: "Test Rec", rank: "REC", role: "Recruit" }],
    medical: medical || [],
    leave: leave || [],
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
    + "\n;this.bpClassifyPerson = bpClassifyPerson;\n";
  vm.runInContext(src, sandbox, { filename: "braves-parade.js" });
  return sandbox;
}

const person = sb => sb.STATE.roster[0];

module.exports = async function run() {
  suite("parade classifier: multi-section listing is intended (do NOT port upstream ATTC/OTHERS dedup)");

  await test("active MC + a non-AL/OIL leave lists the person in BOTH ATT C and OTHERS", () => {
    const sb = load(
      [{ id: 1, d4: "1201", status: "MC", startDate: "2026-06-27", endDate: "2026-07-01" }],
      [{ id: 10, d4: "1201", type: "Course", startDate: TODAY, endDate: "2026-06-30", isInCamp: false }]
    );
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    ok(c.sections.attC.length >= 1, "active MC must list under ATT C");
    ok(c.sections.others.length >= 1, "the non-AL/OIL leave must ALSO list under OTHERS (multi-section is the rule)");
  });

  await test("sibling MC rows collapse to ONE entry within ATT C (within-section dedup)", () => {
    const sb = load([
      { id: 1, d4: "1201", status: "MC", startDate: "2026-06-25", endDate: "2026-06-30" },
      { id: 2, d4: "1201", status: "MC", startDate: "2026-06-27", endDate: "2026-07-02" }
    ], []);
    const c = sb.bpClassifyPerson(person(sb), TODAY);
    eq(c.sections.attC.length, 1, "two active MC rows must not double-list within ATT C");
  });
};
