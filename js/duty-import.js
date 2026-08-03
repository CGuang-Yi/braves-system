// Parser for the legacy "Braves Duty List" workbook (MD_Docs/DUTY_LIST_SPEC.md §7).
//
// PURE MODULE — no DOM, no file I/O, no exceljs. The caller flattens a workbook
// into the neutral shape
//     { name, cells: { "B2": { value, fill } }, maxRow, maxCol }
// and passes it in. That keeps the risky part — colour semantics and layout drift
// — testable against a fixture without dragging a spreadsheet library into the
// test path, and lets the same parser serve both a Node import script and (later)
// a browser file-drop.
//
// Columns I..R are DELIBERATELY not read for duty rows: they are derived values
// and Braves recomputes them. Inheriting them would inherit the three defects
// catalogued in spec §1.3.

// Excel's epoch is 1899-12-30 — the two-day offset absorbs both the 1-based
// numbering and the fictitious 1900 leap day Excel believes in.
function excelSerialToISO(serial) {
  const n = Number(serial);
  if (!n || n < 1) return "";
  const ms = Date.UTC(1899, 11, 30) + n * 86400000;
  const dt = new Date(ms);
  const p2 = function (x) { return (x < 10 ? "0" : "") + x; };
  return dt.getUTCFullYear() + "-" + p2(dt.getUTCMonth() + 1) + "-" + p2(dt.getUTCDate());
}

function dutyColNum(ref) {
  const letters = String(ref).match(/^[A-Z]+/);
  if (!letters) return 0;
  let n = 0;
  const s = letters[0];
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}

function dutyColLetter(n) {
  let s = "";
  let v = n;
  while (v > 0) { const r = (v - 1) % 26; s = String.fromCharCode(65 + r) + s; v = Math.floor((v - 1) / 26); }
  return s;
}

// "PDS 3" → { dutyType: "PDS", platoon: "PLT3" }; "COS" → { dutyType: "COS", platoon: "" }.
// The platoon number rides in the header text, which is exactly why the header row
// is read rather than assuming B..H are always CDO/CDS/COS/PDS1-4 in that order.
function dutyHeaderToType(header) {
  const h = String(header || "").trim();
  if (!h) return null;
  const m = h.match(/^PDS\s*(\d+)$/i);
  if (m) return { dutyType: "PDS", platoon: "PLT" + m[1] };
  return { dutyType: h.toUpperCase(), platoon: "" };
}

const DUTY_FIRST_COL = 2;  // B
const DUTY_LAST_COL = 8;   // H — everything right of this is derived

// Reference sheets that are not month grids. Leaves and Ext. Duties are skipped on
// purpose, not for lack of time: bpClassifyPerson already resolves leave, MC, LD,
// appointments and courses for any date from STATE.leave, which is a strictly
// better PRESENTLIST()/AWAYLIST() and is not hand-maintained (spec §6).
const DUTY_SKIP_SHEETS = {
  "Ext. Duties": 1, "Leaves": 1, "Explanatory Notes": 1,
  "Overall duties": 1, "Changelog": 1, "People": 1, "Holidays": 1
};

function dutyCell(sheet, col, row) {
  return sheet.cells[dutyColLetter(col) + row] || null;
}

function dutyCellIsEmpty(cell) {
  return !cell || cell.value === undefined || cell.value === null || String(cell.value).trim() === "";
}

function parseDutyMonthSheet(sheet, cfg) {
  const rows = [], corrections = [], holidays = [], warnings = [];

  // The header row resolves each column's duty type. Column B is CDO in the source
  // workbook but its header cell is blank there, so a missing header is reported
  // rather than crashing or silently guessing.
  const types = {};
  for (let c = DUTY_FIRST_COL; c <= DUTY_LAST_COL; c++) {
    const hc = dutyCell(sheet, c, 1);
    const t = hc ? dutyHeaderToType(hc.value) : null;
    if (t) types[c] = t;
    else warnings.push({ sheet: sheet.name, cell: dutyColLetter(c) + "1", message: "blank duty-type header; column skipped" });
  }

  for (let r = 2; r <= sheet.maxRow; r++) {
    const dateCell = dutyCell(sheet, 1, r);
    if (dutyCellIsEmpty(dateCell)) continue;
    const iso = excelSerialToISO(dateCell.value);
    if (!iso) { warnings.push({ sheet: sheet.name, cell: "A" + r, message: "unparseable date" }); continue; }

    for (let c = DUTY_FIRST_COL; c <= DUTY_LAST_COL; c++) {
      const t = types[c];
      if (!t) continue;
      const cell = dutyCell(sheet, c, r);
      if (dutyCellIsEmpty(cell)) continue;
      rows.push({
        date: iso, dutyType: t.dutyType, platoon: t.platoon,
        d4: String(cell.value).trim(), source: "import"
      });
    }
  }

  return { rows: rows, corrections: corrections, holidays: holidays, warnings: warnings };
}

function parseDutyWorkbook(workbook, cfg) {
  const out = { rows: [], corrections: [], holidays: [], warnings: [] };
  const sheets = (workbook && workbook.sheets) || [];
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i];
    if (!s || DUTY_SKIP_SHEETS[s.name]) continue;
    const r = parseDutyMonthSheet(s, cfg);
    out.rows = out.rows.concat(r.rows);
    out.corrections = out.corrections.concat(r.corrections);
    out.holidays = out.holidays.concat(r.holidays);
    out.warnings = out.warnings.concat(r.warnings);
  }
  return out;
}

// Node test export (browser ignores `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { excelSerialToISO, dutyColNum, dutyColLetter, dutyHeaderToType,
                     DUTY_SKIP_SHEETS, parseDutyMonthSheet, parseDutyWorkbook };
}
