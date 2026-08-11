/**
 * readall-phases.gs — ONE-OFF DIAGNOSTIC. NOT part of the deployed backend.
 *
 * WHAT IT ANSWERS
 * ---------------
 * A measured readAll TTFB of ~27.8s breaks down, so far, as:
 *
 *     formatDate branch   ~7.8s   (formatdate-bench.gs)
 *     sheet I/O           ~8.3s   (legacy-date-scan.gs)
 *     GAS fixed tax       ~2.0s   (SYNC_PERF_IMPROVEMENTS_SPEC.md 8.5)
 *     ------------------------
 *     unaccounted         ~9.7s
 *
 * This is an instrumented CLONE of readAllTabs() that splits every tab into four
 * phases — getDataRange / getValues / getDisplayValues / row-shaping — and then
 * times getAllRevs and JSON.stringify. One run attributes the whole request.
 *
 * It also sizes the three candidate fixes exactly, instead of by inference:
 *   - P2-5 (drop the second read)  = the getDisplayValues column total
 *   - empty-tab guard              = the cost of tabs that turn out to be empty
 *   - shaping cost                 = the row-loop column total
 *
 * WHY A CLONE AND NOT A WRAPPER: readTab() shapes and returns in one pass, so
 * there is no seam to time from outside. The loop below is copied VERBATIM from
 * readTab (apps-script-Code.gs) — if that function changes, this drifts and the
 * numbers stop describing production. Re-copy before trusting a later run.
 *
 * HOW TO RUN
 * ----------
 * Paste into the Sheet's Apps Script editor as a NEW file, set PHASE_ROLE below
 * to match the account whose pull you measured, run `readAllPhases`, read
 * View -> Logs. Do NOT paste into apps-script-Code.gs and do NOT deploy.
 *
 * READ-ONLY. No setValue, no property writes.
 *
 * COST: does the same work as one readAll — budget ~30s. Inside the 6-min limit.
 */

/**
 * "commander" omits AuditLog entirely; "admin" includes its last 500 rows via
 * the readTabTail path. readAllTabs gates this on ctx.role === "admin", so this
 * MUST match the account you measured or the total will not reconcile.
 */
var PHASE_ROLE = "commander";

/** Data + reference tabs, in readAllTabs' own tabMap order. */
var PHASE_TABS = [
  "Roster", "Medical", "Attendance", "IPPT", "RouteMarch", "SOC",
  "PolarFlow", "ConductDetail", "Appointments", "Leave", "MSK", "Conducts",
  "VocFit", "Platoons",
  "Duty", "DutyCorrection", "Holidays", "DutyUnavailable", "DutyChangeRequest"
];

/** Read after the data tabs, exactly as readAllTabs does. */
var PHASE_CONFIG_TABS = ["Config", "BravesConfig"];
var PHASE_ARCHIVE_TABS = ["ParadeArchive", "SickArchive"];
var PHASE_AUDIT_TAIL = 500;   // mirrors AUDIT_READALL_MAX_ROWS

function readAllPhases() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rowsOut = [];      // one entry per tab
  var result = {};       // built up so JSON.stringify is timed on a real payload
  var wallT0 = new Date().getTime();

  var all = PHASE_TABS.concat(PHASE_CONFIG_TABS).concat(PHASE_ARCHIVE_TABS);
  for (var t = 0; t < all.length; t++) {
    var entry = phaseReadTab_(ss, all[t]);
    if (entry) { rowsOut.push(entry); result[all[t]] = entry.rows; }
  }
  if (PHASE_ROLE === "admin") {
    var auditEntry = phaseReadTabTail_(ss, "AuditLog", PHASE_AUDIT_TAIL);
    if (auditEntry) { rowsOut.push(auditEntry); result.auditLog = auditEntry.rows; }
  }

  // getAllRevs(): one bulk Properties read, exactly as the real path does.
  var revT0 = new Date().getTime();
  var props = PropertiesService.getScriptProperties().getProperties();
  var revCount = 0;
  for (var k in props) { if (k.indexOf("rev:") === 0) revCount++; }
  var revMs = new Date().getTime() - revT0;

  // JSON.stringify of the assembled payload — what ContentService serialises.
  var strT0 = new Date().getTime();
  var json = JSON.stringify(result);
  var strMs = new Date().getTime() - strT0;
  var payloadKb = Math.round(json.length / 102.4) / 10;

  var wallMs = new Date().getTime() - wallT0;

  // ── Report ──
  var out = [];
  out.push("=== readAllTabs PHASE BREAKDOWN (role: " + PHASE_ROLE + ") ===");
  out.push("");
  out.push("  " + phasePad_("tab", 22) + phasePad_("range", 8) + phasePad_("getValues", 11) +
           phasePad_("getDisplay", 12) + phasePad_("shape", 8) + phasePad_("total", 8) + "rows");
  out.push("  " + phaseRule_(75));

  var sum = { range: 0, values: 0, display: 0, shape: 0, empty: 0, rows: 0 };
  rowsOut.sort(function (a, b) { return b.totalMs - a.totalMs; });
  for (var r = 0; r < rowsOut.length; r++) {
    var e = rowsOut[r];
    sum.range += e.rangeMs; sum.values += e.valuesMs;
    sum.display += e.displayMs; sum.shape += e.shapeMs;
    sum.rows += e.rowCount;
    if (e.isEmpty) sum.empty += e.totalMs;
    out.push("  " + phasePad_(e.tab + (e.isEmpty ? " (empty)" : ""), 22) +
             phasePad_(e.rangeMs, 8) + phasePad_(e.valuesMs, 11) +
             phasePad_(e.displayMs, 12) + phasePad_(e.shapeMs, 8) +
             phasePad_(e.totalMs, 8) + e.rowCount);
  }
  out.push("  " + phaseRule_(75));
  var phaseTotal = sum.range + sum.values + sum.display + sum.shape;
  out.push("  " + phasePad_("TOTAL", 22) + phasePad_(sum.range, 8) + phasePad_(sum.values, 11) +
           phasePad_(sum.display, 12) + phasePad_(sum.shape, 8) +
           phasePad_(phaseTotal, 8) + sum.rows);

  out.push("");
  out.push("--- Whole-request accounting ---");
  out.push("  per-tab phases        " + phasePad_(phaseTotal + "ms", 10));
  out.push("  getAllRevs            " + phasePad_(revMs + "ms", 10) + revCount + " rev keys");
  out.push("  JSON.stringify        " + phasePad_(strMs + "ms", 10) + payloadKb + " KB payload");
  out.push("  ---");
  out.push("  measured in-script    " + phasePad_(wallMs + "ms", 10));
  out.push("  (subtract from your DevTools TTFB; the remainder is GAS request");
  out.push("   overhead — routing, V8 spin-up, auth, ContentService — which no");
  out.push("   code change in readAllTabs can touch.)");

  out.push("");
  out.push("--- What each candidate fix is worth (measured, not inferred) ---");
  out.push("  P2-5, drop getDisplayValues   " + phasePad_(sum.display + "ms", 10) +
           phasePct_(sum.display, phaseTotal));
  out.push("  Empty-tab guard               " + phasePad_(sum.empty + "ms", 10) +
           phasePct_(sum.empty, phaseTotal) + " (upper bound: a getLastRow probe still costs 1 call)");
  out.push("  Row-shaping loop              " + phasePad_(sum.shape + "ms", 10) +
           phasePct_(sum.shape, phaseTotal) + " (includes the formatDate branch)");
  out.push("  Sheet I/O floor               " + phasePad_((sum.range + sum.values) + "ms", 10) +
           phasePct_(sum.range + sum.values, phaseTotal) + " (irreducible without fewer tabs)");
  out.push("");
  out.push("  NOTE: shaping and formatDate overlap — formatdate-bench.gs measured");
  out.push("  the branch at ~7.8s, so shaping-minus-7.8s is the pure loop cost.");

  var report = out.join("\n");
  Logger.log(report);
  return report;
}

/** Instrumented clone of readTab(). Shaping loop copied verbatim. */
function phaseReadTab_(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return null;

  var t0 = new Date().getTime();
  var range = sheet.getDataRange();
  var t1 = new Date().getTime();
  var data = range.getValues();
  var t2 = new Date().getTime();
  var display = range.getDisplayValues();
  var t3 = new Date().getTime();

  var rows = [];
  if (data.length >= 2) {
    var headers = data[0].map(function (h) { return String(h).trim(); });
    for (var i = 1; i < data.length; i++) {
      var row = {};
      var hasData = false;
      for (var j = 0; j < headers.length; j++) {
        if (headers[j]) {
          var val = data[i][j];
          if (val instanceof Date) {
            val = val.getFullYear() < 1900
              ? display[i][j]
              : Utilities.formatDate(val, Session.getScriptTimeZone(), "dd MMM yyyy");
          }
          row[headers[j]] = val;
          if (val !== "" && val !== null && val !== undefined) hasData = true;
        }
      }
      if (hasData) rows.push(row);
    }
  }
  var t4 = new Date().getTime();

  return {
    tab: tabName, rows: rows, rowCount: rows.length, isEmpty: data.length < 2,
    rangeMs: t1 - t0, valuesMs: t2 - t1, displayMs: t3 - t2, shapeMs: t4 - t3,
    totalMs: t4 - t0
  };
}

/** Instrumented clone of readTabTail(). */
function phaseReadTabTail_(ss, tabName, maxRows) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return null;

  var t0 = new Date().getTime();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { tab: tabName, rows: [], rowCount: 0, isEmpty: true,
             rangeMs: new Date().getTime() - t0, valuesMs: 0, displayMs: 0, shapeMs: 0,
             totalMs: new Date().getTime() - t0 };
  }
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var totalDataRows = lastRow - 1;
  var startRow = totalDataRows > maxRows ? (lastRow - maxRows + 1) : 2;
  var nRows = lastRow - startRow + 1;
  var range = sheet.getRange(startRow, 1, nRows, lastCol);
  var t1 = new Date().getTime();
  var data = range.getValues();
  var t2 = new Date().getTime();
  var display = range.getDisplayValues();
  var t3 = new Date().getTime();

  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var row = {};
    var hasData = false;
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        var val = data[i][j];
        if (val instanceof Date) {
          val = val.getFullYear() < 1900
            ? display[i][j]
            : Utilities.formatDate(val, Session.getScriptTimeZone(), "dd MMM yyyy");
        }
        row[headers[j]] = val;
        if (val !== "" && val !== null && val !== undefined) hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }
  var t4 = new Date().getTime();

  return {
    tab: tabName + " (tail " + maxRows + ")", rows: rows, rowCount: rows.length, isEmpty: false,
    rangeMs: t1 - t0, valuesMs: t2 - t1, displayMs: t3 - t2, shapeMs: t4 - t3,
    totalMs: t4 - t0
  };
}

function phasePct_(part, whole) {
  return whole ? "(" + (Math.round(part * 1000 / whole) / 10) + "% of phases)" : "";
}

function phaseRule_(n) {
  var s = "";
  while (s.length < n) s += "-";
  return s;
}

function phasePad_(s, n) {
  s = String(s);
  while (s.length < n) s += " ";
  return s;
}
