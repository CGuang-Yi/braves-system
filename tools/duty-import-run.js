#!/usr/bin/env node
// One-off import + reconciliation for the legacy "Braves Duty List" workbook.
// MD_Docs/DUTY_LIST_SPEC.md §7.3.
//
//   node tools/duty-import-run.js <workbook.xlsx> [--json out.json]
//
// NOT shipped to the browser and not loaded by index.html. History loads once,
// then planning moves into Braves, so a shipped importer would be maintained
// surface area with no remaining user. The PARSER (js/duty-import.js) is
// production code either way, because that is where the risk lives — this file
// is only the plumbing that feeds it and prints what it found.
//
// Why the XML is read by hand rather than with the vendored exceljs: that bundle
// is a browser build and does not load under Node. Reading the parts directly is
// also less machinery than it sounds — an .xlsx is a zip of XML, and only four
// members matter (workbook, sheets, sharedStrings, styles).

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");

// ── Load the pure modules the same way the tests do ──────────────────────────
function loadModule(rel) {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, Array, Object, JSON, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sandbox, { filename: path.basename(rel) });
  return sandbox.module.exports;
}
const DI = loadModule("js/duty-import.js");
const DP = loadModule("js/duty-points.js");

// Mirrors DEFAULT_CONFIG's duty keys in js/state.js. Kept as a literal rather
// than scraped out of state.js (which needs a browser global scope to evaluate);
// if the defaults there change, change them here too.
const CFG = {
  dutyTypes: [
    { name: "CDO", scope: "company", pointWeight: null },
    { name: "CDS", scope: "company", pointWeight: null },
    { name: "COS", scope: "company", pointWeight: 1 },
    { name: "PDS", scope: "platoon", pointWeight: null }
  ],
  dutyDayWeights: { sun: 3, mon: 1, tue: 1, wed: 1, thu: 1, fri: 3, sat: 5, holiday: 5 },
  dutyCorrectionReasons: [
    { name: "PDS after COS", delta: -2 },
    { name: "On leave while scheduled", delta: -2 },
    { name: "COS duty ends on leave day", delta: -2 },
    { name: "Doing 2 duties at once", delta: -2 },
    { name: "Ext. duties while scheduled", delta: -2 },
    { name: "Outfield skip", delta: -2 },
    { name: "Confinement", delta: -2 },
    { name: "Extras", delta: 0 }
  ],
  dutyCorrectionColours: {
    reason: {
      "FF00FF": "PDS after COS",
      "00FFFF": "On leave while scheduled",
      "FF9900": "COS duty ends on leave day",
      "9900FF": "Doing 2 duties at once",
      "373F6B": "Ext. duties while scheduled"
    },
    magnitude: { "E06666": -2, "FF9900": -4, "B6D7A8": 2, "00FF00": 4 },
    holidayRow: "EA4335",
    gridBase: "F4CCCC"
  },
  // Column B is CDO in the source workbook but its header cell is blank; without
  // this every CDO assignment is silently skipped. Always warned about when used.
  dutyHeaderFallback: { B: "CDO" }
};

// ── xlsx → the parser's neutral { name, cells, maxRow, maxCol } shape ─────────
function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function unzipTo(xlsxPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duty-xlsx-"));
  execFileSync("unzip", ["-o", "-q", xlsxPath, "-d", dir]);
  return dir;
}

function readWorkbook(xlsxPath) {
  const dir = unzipTo(xlsxPath);
  const read = rel => fs.readFileSync(path.join(dir, rel), "utf8");

  const shared = [];
  try {
    for (const m of read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let t = "";
      for (const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += decodeXml(tm[1]);
      shared.push(t);
    }
  } catch { /* a workbook with no shared strings is legal */ }

  // styles: cellXfs index → fillId → foreground rgb
  const styles = read("xl/styles.xml");
  const fills = [];
  const fillsBlock = (styles.match(/<fills[^>]*>([\s\S]*?)<\/fills>/) || [])[1] || "";
  for (const m of fillsBlock.matchAll(/<fill>([\s\S]*?)<\/fill>/g)) {
    const patt = (m[1].match(/patternType="([^"]*)"/) || [])[1] || "none";
    const rgb = (m[1].match(/<fgColor[^>]*rgb="([^"]*)"/) || [])[1] || "";
    fills.push(patt === "none" ? "" : rgb);
  }
  const xfs = [];
  const xfsBlock = (styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || "";
  for (const m of xfsBlock.matchAll(/<xf\b([^>]*)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    xfs.push(Number((m[1].match(/fillId="(\d+)"/) || [])[1] || 0));
  }

  const rels = {};
  for (const m of read("xl/_rels/workbook.xml.rels").matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    rels[m[1]] = m[2];
  }

  const sheets = [];
  for (const m of read("xl/workbook.xml").matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
    const name = decodeXml(m[1]);
    const target = rels[m[2]];
    if (!target) continue;
    const xml = read("xl/" + target.replace(/^\/?xl\//, ""));
    const cells = {};
    let maxRow = 0, maxCol = 0;
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const rn = Number(rm[1]);
      if (rn > maxRow) maxRow = rn;
      for (const cm of rm[2].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cm[1], bodyXml = cm[2];
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
        if (!ref) continue;
        const t = (attrs.match(/t="(\w+)"/) || [])[1];
        const sIdx = Number((attrs.match(/s="(\d+)"/) || [])[1] || 0);
        let v = (bodyXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (t === "s" && v !== undefined) v = shared[Number(v)];
        else if (t === "inlineStr") {
          v = "";
          for (const tm of bodyXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) v += decodeXml(tm[1]);
        } else if (v !== undefined) v = decodeXml(v);
        const cn = DI.dutyColNum(ref);
        if (cn > maxCol) maxCol = cn;
        cells[ref] = { value: v, fill: fills[xfs[sIdx]] || "" };
      }
    }
    sheets.push({ name, cells, maxRow, maxCol });
  }

  fs.rmSync(dir, { recursive: true, force: true });
  return { sheets };
}

// ── Reconciliation ───────────────────────────────────────────────────────────
// The source sheet's own per-person total sits in column R of each month sheet,
// keyed by the person in column K. Read it so the report can put the two totals
// side by side. Expect them to differ — spec §1.3 lists three defects the engine
// deliberately fixes, and the point of this report is that every difference is
// attributable, not that the numbers match.
function sheetOwnTotals(sheet) {
  const out = {};
  for (let r = 2; r <= sheet.maxRow; r++) {
    const who = sheet.cells["K" + r], val = sheet.cells["R" + r];
    if (!who || !who.value) continue;
    out[String(who.value).trim()] = Number(val && val.value) || 0;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const xlsxPath = args[0];
  if (!xlsxPath) {
    console.error("usage: node tools/duty-import-run.js <workbook.xlsx> [--json out.json]");
    process.exit(2);
  }
  const jsonIdx = args.indexOf("--json");
  const jsonOut = jsonIdx !== -1 ? args[jsonIdx + 1] : null;

  const wb = readWorkbook(xlsxPath);
  const parsed = DI.parseDutyWorkbook(wb, CFG);
  const holidays = DP.indexHolidays(parsed.holidays);
  const totals = DP.dutyTotals(parsed.rows, parsed.corrections, CFG, holidays, { from: "", to: "" });

  console.log("=== PARSED ===");
  console.log("sheets read      : " + wb.sheets.filter(s => !DI.DUTY_SKIP_SHEETS[s.name]).map(s => s.name).join(", "));
  console.log("duty rows        : " + parsed.rows.length);
  console.log("corrections      : " + parsed.corrections.length);
  console.log("holidays         : " + parsed.holidays.length);
  console.log("warnings         : " + parsed.warnings.length);

  const byKind = {};
  parsed.warnings.forEach(w => { const k = w.kind || "other"; byKind[k] = (byKind[k] || 0) + 1; });
  Object.keys(byKind).forEach(k => console.log("  · " + k + ": " + byKind[k]));

  // Everything a human has to look at before trusting the import. None of it
  // blocks: the magnitude legend is known not to agree with the literals in the
  // workbook, so those are surfaced and nothing more (spec §7.2/§14 item 2).
  console.log("\n=== FLAGGED FOR REVIEW (does not block) ===");
  const unknown = parsed.warnings.filter(w => w.kind === "unknown-fill");
  const magnitude = parsed.warnings.filter(w => w.kind === "magnitude-highlight");
  const noReason = parsed.corrections.filter(c => c.reason === null);
  const tentative = parsed.holidays.filter(h => h.tentative);
  console.log("unrecognised fills      : " + unknown.length);
  unknown.slice(0, 20).forEach(w => console.log("    " + w.sheet + "!" + w.cell + " — " + w.message));
  console.log("magnitude highlights    : " + magnitude.length + "  (flagged only, never applied to a total)");
  magnitude.slice(0, 20).forEach(w => console.log("    " + w.sheet + "!" + w.cell + " — " + w.message));
  console.log("corrections w/o reason  : " + noReason.length);
  console.log("tentative holidays      : " + tentative.length);
  tentative.forEach(h => console.log("    " + h.date + " — scores 5; confirm before trusting the total"));

  console.log("\n=== RECONCILIATION (Braves vs the sheet's own column R) ===");
  console.log("Differences are EXPECTED. The engine fixes three defects in the source");
  console.log("formula (spec §1.3): public holidays are applied, the 31st is no longer");
  console.log("dropped, and roll-ups cannot drift. Each difference should trace to one");
  console.log("of those, or to a correction re-derived from cell colour.\n");

  const sheetTotals = {};
  wb.sheets.filter(s => !DI.DUTY_SKIP_SHEETS[s.name]).forEach(s => {
    const own = sheetOwnTotals(s);
    Object.keys(own).forEach(p => { sheetTotals[p] = (sheetTotals[p] || 0) + own[p]; });
  });

  const people = [...new Set([...Object.keys(totals.byPerson), ...Object.keys(sheetTotals)])].sort();
  if (!people.length) {
    console.log("  (nothing to reconcile — no assignments and no sheet totals found)");
  }
  console.log("  person        braves   sheet    diff");
  people.forEach(p => {
    const b = totals.byPerson[p] ? totals.byPerson[p].total : 0;
    const s = sheetTotals[p] || 0;
    const d = b - s;
    console.log("  " + p.padEnd(14) + String(b).padStart(6) + String(s).padStart(8) +
                String(d === 0 ? "-" : (d > 0 ? "+" + d : d)).padStart(8));
  });

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({
      duty: parsed.rows, dutyCorrection: parsed.corrections,
      holidays: parsed.holidays, warnings: parsed.warnings
    }, null, 2));
    console.log("\nwrote " + jsonOut);
  }
}

main();
