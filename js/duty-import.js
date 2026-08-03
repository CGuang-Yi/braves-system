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

// Sheets/Excel hand fills back as either RGB ("F4CCCC") or ARGB ("FFF4CCCC").
// Strip a leading fully-opaque alpha so both match the same colour-map key.
function dutyNormFill(f) {
  return String(f || "").replace(/^FF(?=[0-9A-Fa-f]{6}$)/i, "").toUpperCase();
}

// Each column's own baseline, so detection is RELATIVE rather than absolute.
//
// An absolute "is this cell filled?" test is useless on this workbook: #F4CCCC is
// the background of every duty cell in every month, and April additionally colours
// the PDS headers per platoon. Both would be false positives, and between them
// they cover essentially the whole grid. Deriving the baseline per column also
// survives the palette drifting between months, which it does.
function modalFillForColumn(sheet, col, fromRow, toRow) {
  const counts = {};
  let best = "", bestN = -1;
  for (let r = fromRow; r <= toRow; r++) {
    const c = dutyCell(sheet, col, r);
    const f = dutyNormFill(c && c.fill);
    counts[f] = (counts[f] || 0) + 1;
    if (counts[f] > bestN) { bestN = counts[f]; best = f; }
  }
  return best;
}

function dutyReasonDelta(cfg, reason) {
  const list = (cfg && cfg.dutyCorrectionReasons) || [];
  for (let i = 0; i < list.length; i++) if (list[i].name === reason) return Number(list[i].delta) || 0;
  return 0;
}

// True when EVERY duty column on the row carries the public-holiday shade. The
// source workbook marks a PH by shading the whole row, which is what separates it
// from a single-cell correction; requiring the full span keeps a lone red cell
// from being promoted to a holiday.
function dutyRowIsHoliday(sheet, row, holidayFill) {
  if (!holidayFill) return false;
  for (let c = DUTY_FIRST_COL; c <= DUTY_LAST_COL; c++) {
    const cell = dutyCell(sheet, c, row);
    if (dutyNormFill(cell && cell.fill) !== holidayFill) return false;
  }
  return true;
}

function parseDutyMonthSheet(sheet, cfg) {
  const rows = [], corrections = [], holidays = [], warnings = [];

  // The header row resolves each column's duty type. Column B is CDO in the source
  // workbook but its header cell is blank there, so a missing header is reported
  // rather than crashing or silently guessing.
  const fallback = (cfg && cfg.dutyHeaderFallback) || {};
  const types = {};
  for (let c = DUTY_FIRST_COL; c <= DUTY_LAST_COL; c++) {
    const letter = dutyColLetter(c);
    const hc = dutyCell(sheet, c, 1);
    const t = hc ? dutyHeaderToType(hc.value) : null;
    if (t) { types[c] = t; continue; }

    // Column B is CDO in the source workbook but its header cell is blank — the
    // identity is only established by the A33 VLOOKUP that labels offset 2
    // "CDO:". Without a fallback the column is skipped and every CDO assignment
    // is silently lost, which is worse than either alternative. The fallback is
    // Config data rather than a hardcoded guess, and using it is always warned
    // about, so it can never be mistaken for a header the workbook actually had.
    const fb = fallback[letter] ? dutyHeaderToType(fallback[letter]) : null;
    if (fb) {
      types[c] = fb;
      warnings.push({
        sheet: sheet.name, cell: letter + "1", kind: "header-fallback",
        message: "blank duty-type header; assumed " + fb.dutyType + " from dutyHeaderFallback"
      });
    } else {
      warnings.push({
        sheet: sheet.name, cell: letter + "1", kind: "header-missing",
        message: "blank duty-type header and no dutyHeaderFallback entry; column skipped"
      });
    }
  }

  const colours = (cfg && cfg.dutyCorrectionColours) || {};
  const reasonByFill = colours.reason || {};
  const magnitudeByFill = colours.magnitude || {};
  const holidayFill = dutyNormFill(colours.holidayRow);

  // Per-column baselines, computed once over the data rows (spec §7.2).
  const baseline = {};
  for (let c = DUTY_FIRST_COL; c <= DUTY_LAST_COL; c++) {
    baseline[c] = modalFillForColumn(sheet, c, 2, sheet.maxRow);
  }

  for (let r = 2; r <= sheet.maxRow; r++) {
    const dateCell = dutyCell(sheet, 1, r);
    if (dutyCellIsEmpty(dateCell)) continue;
    const iso = excelSerialToISO(dateCell.value);
    if (!iso) { warnings.push({ sheet: sheet.name, cell: "A" + r, message: "unparseable date" }); continue; }

    const isHoliday = dutyRowIsHoliday(sheet, r, holidayFill);
    if (isHoliday) holidays.push({ date: iso, name: "", tentative: "" });

    for (let c = DUTY_FIRST_COL; c <= DUTY_LAST_COL; c++) {
      const t = types[c];
      if (!t) continue;
      const cell = dutyCell(sheet, c, r);
      if (dutyCellIsEmpty(cell)) continue;
      const d4 = String(cell.value).trim();
      rows.push({ date: iso, dutyType: t.dutyType, platoon: t.platoon, d4: d4, source: "import" });

      // A public-holiday row is shaded end to end, so every cell on it deviates
      // from its column baseline. Skipping correction detection there is not an
      // optimisation: PH is applied natively by the points engine from the
      // Holidays tab, so also recording it as a correction would double-count
      // (spec §3.5).
      if (isHoliday) continue;

      const fill = dutyNormFill(cell.fill);
      if (fill === baseline[c]) continue;
      // An ABSENT fill is not a correction marker. It deviates from a coloured
      // baseline, but the legends assign meaning to colours, not to the lack of
      // one — an uncoloured cell is at most a formatting gap. Without this the
      // sanitised workbook alone produces 48 phantom corrections whose "colour"
      // is the empty string.
      if (!fill) continue;

      // This block is B..H, so the fill is looked up in the REASON map and never
      // the magnitude map. That is what disambiguates #FF9900, which appears in
      // both legends (spec §1.4).
      const reason = reasonByFill[fill];
      if (reason) {
        corrections.push({ date: iso, d4: d4, reason: reason, delta: dutyReasonDelta(cfg, reason), note: "" });
      } else {
        // Emitted anyway, with no reason, so a colour we do not recognise shows
        // up for a human instead of vanishing.
        corrections.push({ date: iso, d4: d4, reason: null, delta: 0, note: "unrecognised fill #" + fill });
        warnings.push({
          sheet: sheet.name, cell: dutyColLetter(c) + r, kind: "unknown-fill",
          message: "unrecognised fill #" + fill + "; correction emitted with no reason"
        });
      }
    }

    // The ONLY reason the parser looks right of column H. Magnitude highlights are
    // flagged and nothing more: the ±2/±4 legend does not agree with the +3/+1/-1
    // literals actually appended to formulas in the workbook, so pairing them with
    // a reason would invent precision that is not there. Deltas always come from
    // the reason's Config default (spec §7.2, §14 item 2).
    for (let c = DUTY_LAST_COL + 1; c <= (sheet.maxCol || DUTY_LAST_COL); c++) {
      const cell = dutyCell(sheet, c, r);
      if (!cell) continue;
      const fill = dutyNormFill(cell.fill);
      if (!fill || magnitudeByFill[fill] === undefined) continue;
      warnings.push({
        sheet: sheet.name, cell: dutyColLetter(c) + r, kind: "magnitude-highlight",
        message: "magnitude highlight #" + fill + " (legend says " + magnitudeByFill[fill] +
                 ") — flagged only, not applied to any total"
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
                     dutyNormFill, modalFillForColumn, dutyReasonDelta, dutyRowIsHoliday,
                     DUTY_SKIP_SHEETS, parseDutyMonthSheet, parseDutyWorkbook };
}
