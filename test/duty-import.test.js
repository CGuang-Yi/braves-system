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

  await test("a blank header with no fallback is warned about and the column skipped", () => {
    const s = makeSheet();
    s.cells["B1"] = { value: "", fill: "" };
    const r = imp.parseDutyMonthSheet(s, CFG);   // CFG has no dutyHeaderFallback
    const w = r.warnings.filter(function (x) { return x.cell === "B1"; });
    eq(w.length, 1);
    eq(w[0].kind, "header-missing");
    eq(r.rows.filter(function (x) { return x.dutyType === "CDO"; }).length, 0);
  });

  await test("dutyHeaderFallback recovers the blank CDO column, and says so", () => {
    // Column B is CDO in the real workbook but its header cell is blank, so
    // without this every CDO assignment would be silently lost.
    const cfg = { dutyCorrectionColours: CFG.dutyCorrectionColours,
                  dutyCorrectionReasons: CFG.dutyCorrectionReasons,
                  dutyHeaderFallback: { B: "CDO" } };
    const s = makeSheet();
    s.cells["B1"] = { value: "", fill: "" };
    const r = imp.parseDutyMonthSheet(s, cfg);
    eq(r.rows.filter(function (x) { return x.dutyType === "CDO"; }).length, 2);
    const w = r.warnings.filter(function (x) { return x.cell === "B1"; });
    eq(w.length, 1);
    eq(w[0].kind, "header-fallback");   // never silent — a fallback is always reported
  });

  await test("a real header always beats the fallback", () => {
    const cfg = { dutyCorrectionColours: CFG.dutyCorrectionColours,
                  dutyCorrectionReasons: CFG.dutyCorrectionReasons,
                  dutyHeaderFallback: { B: "CDO", D: "WRONG" } };
    const r = imp.parseDutyMonthSheet(makeSheet(), cfg);
    eq(r.rows.filter(function (x) { return x.dutyType === "WRONG"; }).length, 0);
    eq(r.rows.filter(function (x) { return x.dutyType === "COS"; }).length, 2);
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

  suite("duty-import: colour-derived corrections");

  await test("the grid's base fill is not mistaken for a correction", () => {
    // #F4CCCC is every duty cell's background in every month. A naive
    // "is this cell filled?" test would flag all 1,085 of them.
    const r = imp.parseDutyMonthSheet(makeSheet(), CFG);
    eq(r.corrections.length, 0);
  });

  await test("per-platoon header colours are not mistaken for corrections", () => {
    // April colour-codes the PDS 1..4 headers; that is a platoon key, not a
    // correction key.
    const r = imp.parseDutyMonthSheet(makeSheet(), CFG);
    eq(r.corrections.length, 0);
    eq(r.warnings.filter(function (w) { return w.cell === "F1" || w.cell === "G1"; }).length, 0);
  });

  await test("modal fill is computed per column, not globally", () => {
    eq(imp.modalFillForColumn(makeSheet(), 4, 2, 3), "F4CCCC");
    eq(imp.modalFillForColumn(makeSheet(), 1, 2, 3), "");
  });

  await test("a cell deviating from its column's modal fill becomes a correction", () => {
    const r = imp.parseDutyMonthSheet(makeSheet({
      "D3": { value: "0005", fill: "00FFFF" }   // cyan = on leave while scheduled
    }), CFG);
    eq(r.corrections.length, 1);
    eq(r.corrections[0].d4, "0005");
    eq(r.corrections[0].date, "2026-07-02");
    eq(r.corrections[0].reason, "On leave while scheduled");
    eq(r.corrections[0].delta, -2);   // from the reason's config default
  });

  await test("an ARGB fill is matched against the RGB colour map", () => {
    const r = imp.parseDutyMonthSheet(makeSheet({
      "D3": { value: "0005", fill: "FF00FFFF" } // ARGB for cyan
    }), CFG);
    eq(r.corrections.length, 1);
    eq(r.corrections[0].reason, "On leave while scheduled");
  });

  await test("#FF9900 in B..H is the reason, not the -4 magnitude", () => {
    const r = imp.parseDutyMonthSheet(makeSheet({
      "D3": { value: "0005", fill: "FF9900" }
    }), CFG);
    eq(r.corrections.length, 1);
    eq(r.corrections[0].reason, "COS duty ends on leave day");
    eq(r.corrections[0].delta, -2);   // the reason's default, NOT -4
  });

  await test("magnitude fills in L..R are flagged only, never turned into a delta", () => {
    // The magnitude legend does not agree with the literals actually in the
    // workbook (spec §1.4), so these are surfaced for a human and nothing more.
    const r = imp.parseDutyMonthSheet(makeSheet({
      "R3": { value: "3", fill: "E06666" }
    }), CFG);
    eq(r.corrections.length, 0);
    const flagged = r.warnings.filter(function (w) { return w.cell === "R3"; });
    eq(flagged.length, 1);
    eq(flagged[0].kind, "magnitude-highlight");
  });

  await test("an UNFILLED cell is not a correction, even against a coloured baseline", () => {
    // The legends assign meaning to colours, not to the absence of one. Treating
    // a bare cell as a deviation produced 48 phantom corrections on the real
    // workbook, all with an empty-string "colour".
    const r = imp.parseDutyMonthSheet(makeSheet({
      "D3": { value: "0005", fill: "" }
    }), CFG);
    eq(r.corrections.length, 0);
    eq(r.warnings.filter(function (w) { return w.cell === "D3"; }).length, 0);
    eq(r.rows.filter(function (x) { return x.d4 === "0005"; }).length, 1); // still imported
  });

  await test("an unrecognised deviating fill is emitted with a warning, never dropped", () => {
    const r = imp.parseDutyMonthSheet(makeSheet({
      "D3": { value: "0005", fill: "123456" }
    }), CFG);
    eq(r.corrections.length, 1);
    eq(r.corrections[0].reason, null);
    eq(r.corrections[0].delta, 0);
    eq(r.warnings.filter(function (w) { return w.cell === "D3"; }).length, 1);
  });

  await test("a row shaded EA4335 across the grid becomes a Holidays row", () => {
    const r = imp.parseDutyMonthSheet(makeSheet({
      "B3": { value: "0002", fill: "EA4335" }, "C3": { value: "", fill: "EA4335" },
      "D3": { value: "0005", fill: "EA4335" }, "E3": { value: "", fill: "EA4335" },
      "F3": { value: "", fill: "EA4335" }, "G3": { value: "", fill: "EA4335" },
      "H3": { value: "", fill: "EA4335" }
    }), CFG);
    eq(r.holidays.length, 1);
    eq(r.holidays[0].date, "2026-07-02");
    // A public holiday must NOT also become a correction — the points engine
    // applies PH natively, so a PH correction row would double-count (spec §3.5).
    eq(r.corrections.length, 0);
    // ...but the day's duty assignments still import normally.
    eq(r.rows.filter(function (x) { return x.date === "2026-07-02"; }).length, 2);
  });

  await test("a partially shaded row is not a holiday", () => {
    const r = imp.parseDutyMonthSheet(makeSheet({
      "B3": { value: "0002", fill: "EA4335" }, "D3": { value: "0005", fill: "F4CCCC" }
    }), CFG);
    eq(r.holidays.length, 0);
  });

  suite("duty-import: import merge (spec §7.4)");

  await test("dutyMergeImport replaces a colliding Duty row rather than appending", () => {
    const existing = [
      { id: "a", date: "2026-04-01", dutyType: "COS", platoon: "", d4: "1101" },
      { id: "b", date: "2026-04-02", dutyType: "COS", platoon: "", d4: "1102" }
    ];
    const incoming = [{ id: "z", date: "2026-04-01", dutyType: "COS", platoon: "", d4: "9999" }];
    const out = imp.dutyMergeImport(existing, incoming, imp.dutyKeyOfDuty);
    eq(out.length, 2);
    eq(out.filter(function (r) { return r.date === "2026-04-01"; }).length, 1);
    eq(out.filter(function (r) { return r.date === "2026-04-01"; })[0].d4, "9999");
  });

  await test("dutyMergeImport leaves non-colliding rows alone", () => {
    const existing = [{ id: "a", date: "2026-03-15", dutyType: "CDO", platoon: "", d4: "1101" }];
    const incoming = [{ id: "z", date: "2026-04-01", dutyType: "CDO", platoon: "", d4: "9999" }];
    const out = imp.dutyMergeImport(existing, incoming, imp.dutyKeyOfDuty);
    eq(out.length, 2);
    eq(out.filter(function (r) { return r.date === "2026-03-15"; }).length, 1);
  });

  await test("platoon is part of the Duty key — PDS 1 and PDS 2 do not collide", () => {
    const existing = [
      { id: "a", date: "2026-04-01", dutyType: "PDS", platoon: "PLT1", d4: "1101" },
      { id: "b", date: "2026-04-01", dutyType: "PDS", platoon: "PLT2", d4: "2101" }
    ];
    const incoming = [{ id: "z", date: "2026-04-01", dutyType: "PDS", platoon: "PLT1", d4: "9999" }];
    const out = imp.dutyMergeImport(existing, incoming, imp.dutyKeyOfDuty);
    eq(out.length, 2);
    eq(out.filter(function (r) { return r.platoon === "PLT2"; })[0].d4, "2101");
  });

  await test("re-running the same merge is a no-op", () => {
    const existing = [{ id: "a", date: "2026-04-01", dutyType: "COS", platoon: "", d4: "1101" }];
    const incoming = [{ id: "z", date: "2026-04-01", dutyType: "COS", platoon: "", d4: "9999" }];
    const once = imp.dutyMergeImport(existing, incoming, imp.dutyKeyOfDuty);
    const twice = imp.dutyMergeImport(once, incoming, imp.dutyKeyOfDuty);
    eq(twice.length, once.length);
    eq(JSON.stringify(twice), JSON.stringify(once));
  });

  await test("correction and holiday keys use their own fields", () => {
    const corrExisting = [{ id: "a", date: "2026-04-01", d4: "1101", reason: "Extras", delta: 0 }];
    const corrIncoming = [{ id: "z", date: "2026-04-01", d4: "1101", reason: "Extras", delta: -2 }];
    const corr = imp.dutyMergeImport(corrExisting, corrIncoming, imp.dutyKeyOfCorrection);
    eq(corr.length, 1);
    eq(corr[0].delta, -2);

    const holOut = imp.dutyMergeImport(
      [{ date: "2026-05-01", name: "Labour Day", tentative: "" }],
      [{ date: "2026-05-01", name: "Labour Day", tentative: "yes" }],
      imp.dutyKeyOfHoliday
    );
    eq(holOut.length, 1);
    eq(holOut[0].tentative, "yes");
  });

  // Column R is the sheet's OWN per-person total, keyed by column K. It is the
  // only thing right of H that is read as data, and it is read for the
  // reconciliation report alone — never fed into a total. See the header note in
  // js/duty-import.js about why I..R are otherwise ignored.
  await test("claimedTotals reads the sheet's own K/R totals", () => {
    const r = imp.parseDutyMonthSheet(makeSheet({
      "K2": { value: "0001", fill: "" }, "R2": { value: 12, fill: "" },
      "K3": { value: "0002", fill: "" }, "R3": { value: 7, fill: "" }
    }), CFG);
    eq(r.claimedTotals["0001"], 12);
    eq(r.claimedTotals["0002"], 7);
  });

  await test("claimedTotals is empty when the sheet carries no K column", () => {
    const r = imp.parseDutyMonthSheet(makeSheet({}), CFG);
    eq(Object.keys(r.claimedTotals).length, 0);
  });
};
