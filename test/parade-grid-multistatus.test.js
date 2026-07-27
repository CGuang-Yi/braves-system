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

// Feature 30.1's two helpers, copied verbatim from js/helpers.js. They live in
// helpers.js, which cannot be loaded here — its real displayDateToISO parses only
// "DD MMM YYYY" and would return "" for this suite's ISO fixtures, making every
// record inert and every assertion vacuous. Copied rather than faked to nothing,
// because paradeClassifyPlatoon's suffix placement is asserted below.
const VISIT_SUFFIX_TYPES = ["RSI", "RSO", "MR", "MA"];
function visitSuffix(rec) {
  if (!rec || !rec.type || VISIT_SUFFIX_TYPES.indexOf(rec.type) < 0) return "";
  const t = String(rec.time || "").trim();
  return t ? `${rec.type} ${t}` : rec.type;
}

const PERSON = { id: "1201", d4: "1201", fourD: "1201", name: "Test Rec", rank: "REC", role: "Recruit" };

function codesFor(medical, leave) {
  const STATE = { roster: [PERSON], medical: medical || [], leave: leave || [], appointments: [] };
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat,
    STATE, configGet: k => (k === "companyPrefix" ? "B" : ""), displayDateToISO, medStatusActive,
    visitSuffix,
    visitForDay: (d4, dateIso) => STATE.medical.find(m =>
      m.d4 === d4 && displayDateToISO(m.date) === dateIso && visitSuffix(m)) || null
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

  suite("parade grid: visit-type suffix lands on the pill the person actually has (Feature 30.1)");

  await test("an RSI resolved to LD hangs its time on the STATUS pill, not an RS pill", () => {
    // The headline case. The classifier gates REPORTING SICK on the MO outcome
    // still being pending, so issuing LD drops the person off REPORTING SICK
    // entirely — there is no RS pill left to carry "RSI 0830".
    const codes = codesFor([{ id: 1, d4: "1201", type: "RSI", time: "0830", status: "LD",
      date: TODAY, startDate: TODAY, endDate: "2026-07-03" }], []);
    ok(!codeOf(codes, "RS"), "an assigned status must drop the person off RS: " + JSON.stringify(codes));
    eq(codes[0].code, "STATUS");
    eq(codes[0].suffix, " + RSI 0830");
  });

  await test("a still-pending RSI appends only the time — 'RS + RSI' reads redundantly", () => {
    const codes = codesFor([{ id: 1, d4: "1201", type: "RSI", time: "0830", status: "Pending",
      date: TODAY, startDate: TODAY }], []);
    eq(codes[0].code, "RS");
    eq(codes[0].suffix, " 0830");
  });

  await test("with an upcoming pill ranked first, the suffix falls to the first CURRENT pill", () => {
    // Caught in the browser, not by the plan: an upcoming MC outranks the LD the
    // person is actually on today, so an "only codes[0]" rule silently dropped
    // the visit instead of moving it one row down.
    const STATE = { roster: [PERSON], appointments: [], leave: [],
      medical: [{ id: 1, d4: "1201", type: "RSI", time: "0830", status: "LD",
                  date: TODAY, startDate: TODAY, endDate: "2026-07-03" },
                { id: 2, d4: "1201", type: "RSI", status: "MC", date: "2026-07-02",
                  startDate: "2026-07-02", endDate: "2026-07-05" }] };
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
      isNaN, parseInt, parseFloat,
      STATE, configGet: k => (k === "companyPrefix" ? "B" : ""), displayDateToISO, medStatusActive,
      visitSuffix,
      visitForDay: (d4, dateIso) => STATE.medical.find(m =>
        m.d4 === d4 && displayDateToISO(m.date) === dateIso && visitSuffix(m)) || null
    };
    const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8"), ctx, { filename: "braves-parade.js" });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "parade-tab.js"), "utf8"), ctx, { filename: "parade-tab.js" });
    vm.runInContext("_paradeLookahead = 7;", ctx);
    vm.runInContext(`_r = paradeClassifyPlatoon(STATE.roster, ${JSON.stringify(TODAY)});`, ctx);
    const codes = JSON.parse(vm.runInContext("JSON.stringify(_r[0].codes)", ctx));
    eq(codes[0].code, "MC");
    eq(codes[0].upcoming, true);
    eq(codes[0].suffix, undefined, "the upcoming pill must not carry it");
    eq(codes[1].code, "STATUS");
    eq(codes[1].suffix, " + RSI 0830", "the visit belongs on the status they are actually on today");
  });

  await test("the suffix goes on the FIRST pill only, never on the others", () => {
    const codes = codesFor(
      [{ id: 1, d4: "1201", type: "RSI", time: "0830", status: "MC", date: TODAY, startDate: TODAY, endDate: "2026-07-01" }],
      [{ id: 10, d4: "1201", type: "Course", startDate: TODAY, endDate: "2026-06-30", isInCamp: false }]
    );
    eq(codes[0].code, "MC");
    eq(codes[0].suffix, " + RSI 0830");
    codes.slice(1).forEach(c => eq(c.suffix, undefined, "only the first pill carries the visit: " + c.code));
  });

  await test("a blank time yields the bare type with no dangling separator", () => {
    const codes = codesFor([{ id: 1, d4: "1201", type: "RSI", time: "", status: "LD",
      date: TODAY, startDate: TODAY, endDate: "2026-07-03" }], []);
    eq(codes[0].suffix, " + RSI");
  });

  await test("yesterday's visit does not stamp today's pill", () => {
    const codes = codesFor([{ id: 1, d4: "1201", type: "RSI", time: "0830", status: "LD",
      date: "2026-06-28", startDate: "2026-06-28", endDate: "2026-07-03" }], []);
    eq(codes[0].code, "STATUS");
    eq(codes[0].suffix, undefined, "the RSI was yesterday — its time is not today's news");
  });

  await test("an upcoming pill never carries today's visit suffix", () => {
    // The pill describes a window that has not started; the visit is today's.
    // Pinning them together would read as "the LD starting Thursday began at 0830".
    const STATE = { roster: [PERSON], appointments: [], leave: [],
      medical: [{ id: 1, d4: "1201", type: "MA", time: "1400", status: "", date: TODAY, outOfCamp: false },
                { id: 2, d4: "1201", type: "RSI", status: "MC", date: "2026-07-02",
                  startDate: "2026-07-02", endDate: "2026-07-05" }] };
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
      isNaN, parseInt, parseFloat,
      STATE, configGet: k => (k === "companyPrefix" ? "B" : ""), displayDateToISO, medStatusActive,
      visitSuffix,
      visitForDay: (d4, dateIso) => STATE.medical.find(m =>
        m.d4 === d4 && displayDateToISO(m.date) === dateIso && visitSuffix(m)) || null
    };
    const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8"), ctx, { filename: "braves-parade.js" });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "parade-tab.js"), "utf8"), ctx, { filename: "parade-tab.js" });
    // Assigned directly rather than through setParadeLookahead: the setter calls
    // refreshParade(), which needs a document this headless context has no use for.
    vm.runInContext("_paradeLookahead = 7;", ctx);
    vm.runInContext(`_r = paradeClassifyPlatoon(STATE.roster, ${JSON.stringify(TODAY)});`, ctx);
    const codes = JSON.parse(vm.runInContext("JSON.stringify(_r[0].codes)", ctx));
    const upcoming = codes.find(c => c.upcoming);
    ok(upcoming, "the fixture must produce an upcoming pill: " + JSON.stringify(codes));
    // MC (upcoming) outranks OTHERS in PARADE_CODE_ORDER, so it is codes[0] —
    // which is exactly the case the !codes[0].upcoming guard exists for.
    eq(codes[0].upcoming, true);
    eq(codes[0].suffix, undefined, "today's MA time must not be pinned to next week's MC");
  });
};
