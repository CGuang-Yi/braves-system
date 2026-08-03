const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadImport() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, Array, Object, JSON, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "duty-import.js"), "utf8"),
    sandbox, { filename: "duty-import.js" }
  );
  return sandbox;
}

const CFG = {
  dutyCorrectionColours: {
    reason: { "FF00FF": "PDS after COS", "00FFFF": "On leave while scheduled",
              "FF9900": "COS duty ends on leave day", "9900FF": "Doing 2 duties at once",
              "373F6B": "Ext. duties while scheduled" },
    magnitude: { "E06666": -2, "FF9900": -4, "B6D7A8": 2, "00FF00": 4 },
    holidayRow: "EA4335",
    gridBase: "F4CCCC"
  },
  dutyCorrectionReasons: [
    { name: "PDS after COS", delta: -2 },
    { name: "On leave while scheduled", delta: -2 },
    { name: "COS duty ends on leave day", delta: -2 },
    { name: "Doing 2 duties at once", delta: -2 },
    { name: "Ext. duties while scheduled", delta: -2 }
  ]
};

// A minimal two-day July sheet in the neutral intermediate shape. Mirrors the real
// workbook: base fill on every duty cell, per-platoon colours on the PDS headers.
function makeSheet(overrides) {
  const cells = {
    "B1": { value: "CDO", fill: "" }, "C1": { value: "CDS", fill: "" },
    "D1": { value: "COS", fill: "" }, "E1": { value: "PDS 1", fill: "F4CCCC" },
    "F1": { value: "PDS 2", fill: "D9EAD3" }, "G1": { value: "PDS 3", fill: "CFE2F3" },
    "H1": { value: "PDS 4", fill: "FFF2CC" },
    "A2": { value: 46204, fill: "" },
    "B2": { value: "0001", fill: "F4CCCC" }, "D2": { value: "0003", fill: "F4CCCC" },
    "E2": { value: "0004", fill: "F4CCCC" },
    "A3": { value: 46205, fill: "" },
    "B3": { value: "0002", fill: "F4CCCC" }, "D3": { value: "0005", fill: "F4CCCC" }
  };
  const o = overrides || {};
  for (const k in o) cells[k] = o[k];
  return { name: "July", cells: cells, maxRow: 3, maxCol: 18 };
}

module.exports = async function run() {
  const imp = loadImport();

  suite("duty-import: dates and grid");

  await test("excel serials convert to ISO", () => {
    eq(imp.excelSerialToISO(46204), "2026-07-01");
    eq(imp.excelSerialToISO(46234), "2026-07-31");
    eq(imp.excelSerialToISO(46174), "2026-06-01");
  });

  await test("a non-serial date value yields no ISO date", () => {
    eq(imp.excelSerialToISO(0), "");
    eq(imp.excelSerialToISO(""), "");
    eq(imp.excelSerialToISO(null), "");
  });

  await test("assignments are read with the type resolved from the header row", () => {
    const r = imp.parseDutyMonthSheet(makeSheet(), CFG);
    eq(r.rows.length, 5);
    eq(r.rows[0].date, "2026-07-01");
    eq(r.rows[0].dutyType, "CDO");
    eq(r.rows[0].d4, "0001");
    eq(r.rows[0].platoon, "");
  });

  await test("PDS columns yield the platoon-scoped type and a platoon literal", () => {
    const r = imp.parseDutyMonthSheet(makeSheet(), CFG);
    const pds = r.rows.filter(function (x) { return x.dutyType === "PDS"; });
    eq(pds.length, 1);
    eq(pds[0].platoon, "PLT1");
    eq(pds[0].d4, "0004");
  });

  await test("empty cells produce no rows", () => {
    const r = imp.parseDutyMonthSheet(makeSheet(), CFG);
    eq(r.rows.filter(function (x) { return !x.d4; }).length, 0);
  });

  await test("derived columns I..R contribute no duty rows", () => {
    // Braves recomputes those; inheriting them would inherit their bugs (spec §1.3).
    const r = imp.parseDutyMonthSheet(makeSheet({ "M2": { value: "45", fill: "" } }), CFG);
    eq(r.rows.length, 5);
  });

  await test("every imported row is marked as such", () => {
    const r = imp.parseDutyMonthSheet(makeSheet(), CFG);
    eq(r.rows.every(function (x) { return x.source === "import"; }), true);
  });

  await test("a blank duty-type header is warned about, not silently skipped", () => {
    const s = makeSheet();
    s.cells["B1"] = { value: "", fill: "" };
    const r = imp.parseDutyMonthSheet(s, CFG);
    eq(r.warnings.filter(function (w) { return w.cell === "B1"; }).length, 1);
    eq(r.rows.filter(function (x) { return x.dutyType === "CDO"; }).length, 0);
  });

  await test("the workbook parser skips the non-month reference sheets", () => {
    const wb = { sheets: [
      makeSheet(),
      { name: "Leaves", cells: { "A2": { value: 46204, fill: "" } }, maxRow: 2, maxCol: 3 },
      { name: "Ext. Duties", cells: { "A2": { value: 46204, fill: "" } }, maxRow: 2, maxCol: 3 },
      { name: "People", cells: {}, maxRow: 1, maxCol: 1 }
    ] };
    const r = imp.parseDutyWorkbook(wb, CFG);
    // Leaves and Ext. Duties are NOT imported — bpClassifyPerson already answers
    // availability from STATE.leave and is not hand-maintained (spec §6).
    eq(r.rows.length, 5);
  });
};
