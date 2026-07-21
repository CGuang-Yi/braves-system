// Parade grid: paradeClassifyPlatoon must list EVERY section a person is in
// (as an ordered `codes` array), so a toggleable status (MC/AL·OIL/OTHERS) that
// is masked by a higher-priority non-editable status (RS/STATUS) still renders
// an editable → Present control instead of being dropped and becoming unbookable.
//
// Loads the real braves-parade.js (the classifier) + parade-tab.js into one vm
// context, stubbing the classifier's three deps exactly like
// test/parade-multisection.test.js (STATE, configGet, displayDateToISO,
// medStatusActive). parade-tab.js's other collaborators aren't needed by
// paradeClassifyPlatoon itself.
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

const PERSON = { id: "1201", d4: "1201", fourD: "1201", name: "Test Rec", rank: "REC", role: "Recruit" };

function codesFor(medical, leave) {
  const STATE = { roster: [PERSON], medical: medical || [], leave: leave || [], appointments: [] };
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat,
    STATE, configGet: k => (k === "companyPrefix" ? "B" : ""), displayDateToISO, medStatusActive
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8"), ctx, { filename: "braves-parade.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "parade-tab.js"), "utf8"), ctx, { filename: "parade-tab.js" });
  vm.runInContext(`_r = paradeClassifyPlatoon(STATE.roster, ${JSON.stringify(TODAY)});`, ctx);
  return JSON.parse(vm.runInContext("JSON.stringify(_r[0].codes)", ctx));
}
const codeOf = (codes, code) => codes.find(c => c.code === code);

module.exports = async function run() {
  suite("parade grid: concurrent statuses all list, toggleables stay editable");

  await test("STATUS (LD) + OTHERS (non-AL/OIL leave): both list, OTHERS is editable", () => {
    // LD → status section (non-editable STATUS); a Course (non-AL/OIL, out-of-camp)
    // leave → others section (editable OTHERS). STATUS outranks OTHERS, so the OLD
    // single-primary code would have been STATUS and dropped the bookable OTHERS.
    const codes = codesFor(
      [{ id: 1, d4: "1201", status: "LD", startDate: "2026-06-27", endDate: "2026-07-01" }],
      [{ id: 10, d4: "1201", type: "Course", startDate: TODAY, endDate: "2026-06-30", isInCamp: false }]
    );
    ok(codeOf(codes, "STATUS"), "STATUS must be listed");
    eq(codeOf(codes, "STATUS").editable, false, "STATUS is not a bookable code");
    ok(codeOf(codes, "OTHERS"), "the masked OTHERS must now be listed");
    eq(codeOf(codes, "OTHERS").editable, true, "OTHERS is bookable → Present");
    eq(codes[0].code, "STATUS", "priority order: STATUS before OTHERS");
  });

  await test("ATT C (MC) + OTHERS (non-AL/OIL leave): both editable and listed", () => {
    const codes = codesFor(
      [{ id: 1, d4: "1201", status: "MC", startDate: "2026-06-27", endDate: "2026-07-01" }],
      [{ id: 10, d4: "1201", type: "Course", startDate: TODAY, endDate: "2026-06-30", isInCamp: false }]
    );
    eq((codeOf(codes, "MC") || {}).editable, true, "MC editable");
    eq((codeOf(codes, "OTHERS") || {}).editable, true, "OTHERS editable");
  });

  await test("a single active MC yields exactly one editable MC code", () => {
    const codes = codesFor([{ id: 1, d4: "1201", status: "MC", startDate: "2026-06-27", endDate: "2026-07-01" }], []);
    eq(codes.length, 1, "single status ⇒ single code");
    eq(codes[0].code, "MC");
    eq(codes[0].editable, true);
  });

  await test("a person with no active records is a single non-editable Present", () => {
    const codes = codesFor([], []);
    eq(codes, [{ code: "Present", editable: false, reason: "" }]);
  });
};
