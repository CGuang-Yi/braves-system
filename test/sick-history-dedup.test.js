// Dedup identity of a sick-history episode (confirmSickHistoryImport,
// js/forms-records.js).
//
// The bug these guard against: the dedup key was `d4|startDate|type|status`,
// with NO end date. Two episodes for the same person that start on the same day
// with the same type and status but END on different days are the same key, so
// the second one was silently discarded — and reported to the user as a
// "duplicate skipped", which is exactly why it read as working. When the row
// that survived had already elapsed, the person showed no status at all in the
// parade state.
//
// The end date is part of an episode's identity: a 2-day MC and an 8-day MC
// starting the same morning are different episodes, and a re-import that
// corrects a duration must be able to land.
//
// forms.js is a browser-global bundle split across several files, so it loads
// into a Proxy-global vm context (same trick as csv-importers.test.js).
// `_sickHistoryPending` is a top-level `let`, which lives in the context's
// lexical scope rather than on the global object — so the fixture is injected by
// running a second script in the SAME context, not by assigning a property.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");
const { expandFiles } = require("./sources");

const med = (id, status, startDate, endDate, reason) => ({
  id, d4: "0001", date: startDate, type: "RSI", status, reason,
  startDate, endDate, urtiType: "", mrTiming: "", visitId: ""
});

// forms.js declares its own closeModal, so a stub on the sandbox object is
// shadowed by the real one — which touches the DOM. Give it just enough document
// to run: the real closeModal is on the path under test and should not be faked.
const stubDocument = () => ({
  getElementById: () => ({ classList: { add() {}, remove() {} }, innerHTML: "", value: "" }),
  querySelector: () => ({ classList: { add() {}, remove() {} } }),
  querySelectorAll: () => [],
  addEventListener() {}
});

// Load the bundle and run confirmSickHistoryImport over a fixture, returning the
// resulting STATE plus what was pushed to the sheet.
function runImport(existingMedical, incomingMedical) {
  const synced = [];
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol,
    STATE: { medical: existingMedical.slice(), leave: [], apiUrl: "" },
    document: stubDocument(),
      saveLocal: () => {}, render: () => {},
    alert: () => {}, autoSync: (tab, op) => synced.push({ tab, op })
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  expandFiles(["js/forms.js"]).forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f }));

  // `_sickHistoryPending` is a lexical binding in this context — assign to it by
  // running code inside the context rather than through `target`.
  vm.runInContext(
    `_sickHistoryPending = { parsed: {}, rows: ${JSON.stringify({ medical: incomingMedical, leave: [], unmatched: [] })} };`
    + `confirmSickHistoryImport();`, ctx, { filename: "fixture" });

  return { medical: target.STATE.medical, synced };
}

module.exports = async function run() {
  suite("sick-history import: episode identity includes the end date");

  await test("same start/type/status but a LONGER end date is a different episode", () => {
    const { medical } = runImport(
      [med(1, "MC", "25 Jun 2026", "26 Jun 2026", "manual")],
      [med(9, "MC", "25 Jun 2026", "02 Jul 2026", "imported")]
    );
    eq(medical.length, 2, "the corrected 8-day MC must land, not be skipped as a duplicate");
    eq(medical.filter(m => m.endDate === "02 Jul 2026").length, 1, "the imported row is the longer one");
  });

  await test("same start/type/status but a SHORTER end date is also a different episode", () => {
    const { medical } = runImport(
      [med(1, "LD", "20 Jun 2026", "02 Jul 2026", "manual")],
      [med(9, "LD", "20 Jun 2026", "22 Jun 2026", "imported")]
    );
    eq(medical.length, 2, "a shortened episode is still a distinct row");
  });

  await test("a genuinely identical episode is still skipped (re-import stays idempotent)", () => {
    const { medical, synced } = runImport(
      [med(1, "MC", "25 Jun 2026", "02 Jul 2026", "manual")],
      [med(9, "MC", "25 Jun 2026", "02 Jul 2026", "imported")]
    );
    eq(medical.length, 1, "re-importing the same sheet must not double up");
    eq(synced.length, 0, "and nothing is pushed to the sheet");
  });

  await test("a distinct episode is pushed to the sheet, not just held locally", () => {
    const synced = [];
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, Symbol,
      STATE: { medical: [med(1, "MC", "25 Jun 2026", "26 Jun 2026", "manual")], leave: [], apiUrl: "https://example" },
      document: stubDocument(),
      saveLocal: () => {}, render: () => {},
      alert: () => {}, autoSync: (tab, op) => synced.push({ tab, op })
    };
    const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
    expandFiles(["js/forms.js"]).forEach(f =>
      vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f }));
    vm.runInContext(
      `_sickHistoryPending = { parsed: {}, rows: ${JSON.stringify({ medical: [med(9, "MC", "25 Jun 2026", "02 Jul 2026", "imported")], leave: [], unmatched: [] })} };`
      + `confirmSickHistoryImport();`, ctx, { filename: "fixture" });
    eq(synced.length, 1, "the newly-landed row syncs");
    eq(synced[0].tab, "Medical");
  });

  // The AL/OIL side of the same function carried the identical defect: its key
  // was (d4 | startDate | type), with neither an end date nor anything else to
  // separate two leave spells that begin on the same day.
  await test("AL/OIL leave with the same start but a different end also lands", () => {
    const lv = (id, startDate, endDate) => ({
      id, d4: "0001", type: "AL/OIL", startDate, endDate, days: "",
      reason: "AL/OIL", isInCamp: false, isInCampReviewed: false
    });
    const synced = [];
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, Symbol,
      STATE: { medical: [], leave: [lv(1, "25 Jun 2026", "26 Jun 2026")], apiUrl: "" },
      document: stubDocument(),
      saveLocal: () => {}, render: () => {},
      alert: () => {}, autoSync: (tab, op) => synced.push({ tab, op })
    };
    const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
    expandFiles(["js/forms.js"]).forEach(f =>
      vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f }));
    vm.runInContext(
      `_sickHistoryPending = { parsed: {}, rows: ${JSON.stringify({ medical: [], leave: [lv(9, "25 Jun 2026", "02 Jul 2026")], unmatched: [] })} };`
      + `confirmSickHistoryImport();`, ctx, { filename: "fixture" });
    eq(target.STATE.leave.length, 2, "a leave spell with a different end date is a distinct row");
  });

  await test("an identical AL/OIL leave row is still skipped", () => {
    const lv = (id) => ({
      id, d4: "0001", type: "AL/OIL", startDate: "25 Jun 2026", endDate: "02 Jul 2026",
      days: "", reason: "AL/OIL", isInCamp: false, isInCampReviewed: false
    });
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, Symbol,
      STATE: { medical: [], leave: [lv(1)], apiUrl: "" },
      document: stubDocument(),
      saveLocal: () => {}, render: () => {}, alert: () => {}, autoSync: () => {}
    };
    const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
    expandFiles(["js/forms.js"]).forEach(f =>
      vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f }));
    vm.runInContext(
      `_sickHistoryPending = { parsed: {}, rows: ${JSON.stringify({ medical: [], leave: [lv(9)], unmatched: [] })} };`
      + `confirmSickHistoryImport();`, ctx, { filename: "fixture" });
    eq(target.STATE.leave.length, 1, "re-importing the same leave spell must not double up");
  });
};
