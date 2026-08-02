// Regression: editing a Medical or Leave row that has already been booked in
// (via the parade-tab "Mark Present" flow, PR #65) must not clear its
// bookInDate. bookInDate is documented as immutable once stamped — CLAUDE.md:
// "Mark Present stamps an immutable bookInDate on the Medical/Leave row
// without rewriting the record's own dates" — and exportMCList (js/render.js)
// plus the parade classifier's bookedInBy guard (js/braves-parade.js) both key
// off `!record.bookInDate` to decide whether someone is still away. Both
// submitMedical and submitLeave used to rebuild the edited row from scratch
// with no bookInDate key at all, so any routine correction (fixing a typo in
// the reason, adjusting a date) silently un-booked an already-Present person —
// they'd reappear under ATT C in the parade state and the Status/MC exports
// the very next render, with no error and no visible cause.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");
const { ROOT } = require("./harness");
const { makeBrowser } = require("./mocks/browser");
const { expandFiles } = require("./sources");

const FILES = expandFiles(["js/state.js", "js/api.js", "js/ippt-scoring.js", "js/calc.js",
  "js/helpers.js", "js/sick-history-import.js", "js/render.js", "js/forms.js", "js/braves-parade.js"]);

function load(fx) {
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
    "Object.keys(STATE).forEach(k => { delete STATE[k]; }); Object.assign(STATE, "
      + JSON.stringify(fx) + ");"
    + "STATE.apiUrl = '';"
    + "saveLocal = () => {}; closeModal = () => {}; render = () => {};",
    sb, { filename: "install-fixture.js" });
  return sb;
}

// Sets each field id's .value via the mock's auto-vivifying getElementById,
// then calls the real submit function.
function submit(sb, fnName, fields) {
  const src = Object.entries(fields)
    .map(([id, v]) => `document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)};`)
    .join("\n") + `\n${fnName}();`;
  vm.runInContext(src, sb, { filename: "drive-submit.js" });
}

module.exports = async function run() {
  suite("edit preserves bookInDate: Medical (submitMedical)");

  const medFixture = () => ({
    roster: [{ id: "1411", name: "Alpha", fourD: "1411", status: "Active" }],
    medical: [{
      id: 1, d4: "1411", type: "RSI", status: "MC", date: "01 Jul 2026",
      startDate: "01 Jul 2026", endDate: "05 Jul 2026", reason: "fever",
      bookInDate: "03 Jul 2026", visitId: ""
    }],
    leave: [], attendance: [], appointments: [], config: [], msk: []
  });

  await test("editing a booked-in MC entry keeps its bookInDate", () => {
    const sb = load(medFixture());
    submit(sb, "submitMedical", {
      "f-entry-id": "1", "f-status": "MC", "f-type": "RSI", "f-urti": "", "f-time": "",
      "f-d4": "1411", "f-date": "2026-07-01", "f-reason": "fever, corrected spelling",
      "f-location": "PTMC", "f-start": "2026-07-01", "f-end": "2026-07-05"
    });
    const row = vm.runInContext("STATE.medical[0]", sb);
    eq(row.bookInDate, "03 Jul 2026", "bookInDate was cleared by an unrelated edit");
    eq(row.reason, "fever, corrected spelling", "the edit itself did not apply");
  });

  await test("a brand-new (never booked-in) Medical entry still saves with a blank bookInDate", () => {
    const sb = load({ roster: medFixture().roster, medical: [], leave: [], attendance: [], appointments: [], config: [], msk: [] });
    submit(sb, "submitMedical", {
      "f-entry-id": "", "f-status": "MC", "f-type": "RSI", "f-urti": "", "f-time": "",
      "f-d4": "1411", "f-date": "2026-07-01", "f-reason": "fever",
      "f-location": "PTMC", "f-start": "2026-07-01", "f-end": "2026-07-05"
    });
    const row = vm.runInContext("STATE.medical[0]", sb);
    eq(row.bookInDate, "", "a fresh entry should not fabricate a bookInDate");
  });

  // Daily code review 2026-08-02: editing a MULTI-STATUS visit (e.g. the
  // openMedicalForm doc-comment's own "2D LD + 4D Excuse RMJ" example) used to
  // rebuild every sibling row (i>0 in submitMedical's records.map) with a
  // hard-coded blank bookInDate, no matter what the OLD sibling carried — so
  // correcting a typo shared across the visit (reason/date) silently un-booked
  // a status that had been Mark-Present'd on its own, resurrecting it under
  // ATT C. This is the same immutability contract as the two tests above, just
  // on a sibling row instead of the primary one; document.querySelectorAll is
  // monkey-patched here (the shared mock always returns []) to feed
  // submitMedical's #f-extra-statuses reader one extra status row.
  await test("editing one status of a multi-status visit keeps a booked-in SIBLING status's bookInDate", () => {
    const sb = load({
      roster: medFixture().roster,
      medical: [
        { id: 1, d4: "1411", type: "RSI", status: "LD", date: "01 Jul 2026",
          startDate: "01 Jul 2026", endDate: "05 Jul 2026", reason: "fever",
          bookInDate: "", visitId: "v1" },
        { id: 2, d4: "1411", type: "RSI", status: "Excuse RMJ", date: "01 Jul 2026",
          startDate: "01 Jul 2026", endDate: "10 Jul 2026", reason: "fever",
          bookInDate: "03 Jul 2026", visitId: "v1" }
      ],
      leave: [], attendance: [], appointments: [], config: [], msk: []
    });
    vm.runInContext(`
      document.querySelectorAll = (sel) => sel === "#f-extra-statuses .med-extra-row" ? [{
        querySelector: s => ({
          ".f-extra-status": { value: "Excuse RMJ" },
          ".f-extra-start": { value: "2026-07-01" },
          ".f-extra-end": { value: "2026-07-10" }
        }[s])
      }] : [];
    `, sb, { filename: "stub-extra-status-rows.js" });
    submit(sb, "submitMedical", {
      "f-entry-id": "1", "f-status": "LD", "f-type": "RSI", "f-urti": "", "f-time": "",
      "f-d4": "1411", "f-date": "2026-07-01", "f-reason": "fever, corrected spelling",
      "f-location": "PTMC", "f-start": "2026-07-01", "f-end": "2026-07-05"
    });
    const meds = vm.runInContext("STATE.medical", sb);
    eq(meds.length, 2, "both statuses of the visit should still be present");
    const rmj = meds.find(m => m.status === "Excuse RMJ");
    eq(!!rmj, true, "the sibling status row should survive the edit");
    eq(rmj.bookInDate, "03 Jul 2026", "the sibling's bookInDate was cleared by an edit to the OTHER status");
    const ld = meds.find(m => m.status === "LD");
    eq(ld.reason, "fever, corrected spelling", "the edit itself did not apply");
  });

  suite("edit preserves bookInDate: Leave (submitLeave)");

  const leaveFixture = () => ({
    roster: [{ id: "1411", name: "Alpha", fourD: "1411", status: "Active" }],
    medical: [], attendance: [], appointments: [], config: [], msk: [],
    leave: [{ id: 2, d4: "1411", type: "AL", startDate: "01 Jul 2026", endDate: "05 Jul 2026",
      days: 5, reason: "x", isInCamp: false, bookInDate: "03 Jul 2026" }]
  });

  await test("editing a booked-in Leave entry keeps its bookInDate", () => {
    const sb = load(leaveFixture());
    submit(sb, "submitLeave", {
      "f-entry-id": "2", "f-leave-scope": "person", "f-d4": "1411", "f-type": "AL",
      "f-start": "2026-07-01", "f-end": "2026-07-05", "f-days": "5",
      "f-reason": "updated reason", "f-in-camp": "false"
    });
    const row = vm.runInContext("STATE.leave[0]", sb);
    eq(row.bookInDate, "03 Jul 2026", "bookInDate was cleared by an unrelated edit");
    eq(row.reason, "updated reason", "the edit itself did not apply");
  });

  await test("a brand-new (never booked-in) Leave entry still saves with a blank bookInDate", () => {
    const sb = load({ roster: leaveFixture().roster, medical: [], attendance: [], appointments: [], config: [], msk: [], leave: [] });
    submit(sb, "submitLeave", {
      "f-entry-id": "", "f-leave-scope": "person", "f-d4": "1411", "f-type": "AL",
      "f-start": "2026-07-01", "f-end": "2026-07-05", "f-days": "5",
      "f-reason": "x", "f-in-camp": "false"
    });
    const row = vm.runInContext("STATE.leave[0]", sb);
    eq(row.bookInDate, "", "a fresh entry should not fabricate a bookInDate");
  });
};
