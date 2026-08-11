/**
 * legacy-date-scan.gs — ONE-OFF DIAGNOSTIC. NOT part of the deployed backend.
 *
 * WHAT IT ANSWERS
 * ---------------
 * `readTab()` (apps-script-Code.gs) reads every range TWICE — `getValues()` and
 * `getDisplayValues()` — and the second read exists for exactly one case:
 *
 *     if (val instanceof Date) {
 *       val = val.getFullYear() < 1900
 *         ? display[i][j]                                    // <-- THE ONLY USE
 *         : Utilities.formatDate(val, tz, "dd MMM yyyy");
 *     }
 *
 * A Date on the spreadsheet epoch (1899-12-30) is a TIME-ONLY cell, and the
 * sheet's own display format is the only place its intended rendering ("07:30",
 * "mm:ss") survives. Real calendar dates do NOT need it — they go through
 * Utilities.formatDate. Nothing else in readTab touches `display`.
 *
 * So dropping the second read (SYNC_PERF_IMPROVEMENTS_SPEC.md P2-5) is safe for
 * any tab with ZERO time-only Date cells, and halves that tab's cell fetches.
 *
 * Time columns are supposed to be text already — WRITE_TEXT_COLS_BY_TAB forces
 * "0730" to stay a string on write (Attendance/Medical/Appointments/PolarFlow
 * `time`, ConductDetail `time`+`eventTime`). Two things can still leave a real
 * Date behind:
 *   1. Legacy rows written before that column joined the map.
 *   2. A human typing "07:30" into the sheet — Sheets silently converts it.
 * This scan finds both. If it reports nothing, P2-5 is safe everywhere.
 *
 * HOW TO RUN
 * ----------
 * Paste into the Sheet's Apps Script editor (Extensions -> Apps Script) as a NEW
 * file, run `scanLegacyDates`, and read the execution log (View -> Logs).
 * Do NOT paste it into apps-script-Code.gs and do NOT deploy it.
 *
 * READ-ONLY. It calls no setValue/setFormula/delete and writes no properties.
 *
 * COST: reads every scanned tab twice — i.e. roughly one `readAll`'s worth of
 * sheet work, tens of seconds on a large sheet. Well inside the 6-minute
 * editor-execution limit, but it is not instant.
 */

/**
 * The tabs readAllTabs() actually reads, so the scan covers exactly the surface
 * P2-5 would change — no more, no less. Kept as a literal rather than derived
 * from the live tabMap because this file must stand alone in the editor.
 */
var SCAN_TABS = [
  "Roster", "Medical", "Attendance", "IPPT", "RouteMarch", "SOC",
  "PolarFlow", "ConductDetail", "Appointments", "Leave", "MSK", "Conducts",
  "VocFit", "Platoons",
  "Duty", "DutyCorrection", "Holidays", "DutyUnavailable", "DutyChangeRequest",
  "Config", "BravesConfig",
  "AuditLog", "ParadeArchive", "SickArchive"
];

/** Mirrors readTabTail's cap so AuditLog findings can be reported as in- or
 *  out-of-window: only the last 500 rows are ever returned by a real readAll. */
var SCAN_AUDIT_TAIL = 500;

/** Up to this many example cells are logged per offending column. */
var SCAN_SAMPLES = 3;

function scanLegacyDates() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lines = [];
  var totalCells = 0;
  var totalMs = 0;
  var offenders = [];
  var volume = [];

  for (var t = 0; t < SCAN_TABS.length; t++) {
    var tabName = SCAN_TABS[t];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) { lines.push("  (absent) " + tabName); continue; }

    var t0 = new Date().getTime();
    var range = sheet.getDataRange();
    var data = range.getValues();
    var display = range.getDisplayValues();
    var ms = new Date().getTime() - t0;

    if (data.length < 2) {
      lines.push("  (empty)  " + tabName);
      totalMs += ms;
      continue;
    }

    // readTab only reads columns under a NON-EMPTY header — a Date sitting
    // under a blank header never reaches the frontend, so it is not a finding.
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var rows = data.length - 1;
    var cells = rows * headers.length;
    totalCells += cells;
    totalMs += ms;
    volume.push({ tab: tabName, rows: rows, cols: headers.length, cells: cells, ms: ms });

    // AuditLog is served by readTabTail (last SCAN_AUDIT_TAIL rows only), so a
    // finding above this 1-based cut-off is real but currently unreachable.
    // 0 for every other tab, where readTab reads the whole sheet.
    var windowStart = (tabName === "AuditLog") ? (data.length - SCAN_AUDIT_TAIL + 1) : 0;

    // col index -> {count, inWindow, minRow, maxRow, samples[]}
    var hits = {};
    for (var i = 1; i < data.length; i++) {
      for (var j = 0; j < headers.length; j++) {
        if (!headers[j]) continue;
        var val = data[i][j];
        // The exact predicate readTab uses to reach for `display`.
        if (val instanceof Date && val.getFullYear() < 1900) {
          var h = hits[j] || (hits[j] = { count: 0, inWindow: 0, minRow: i + 1, maxRow: i + 1, samples: [] });
          h.count++;
          h.maxRow = i + 1;   // 1-based sheet row (data[0] is row 1)
          // Counted per cell, not inferred from maxRow: a column with hits on
          // BOTH sides of the cut-off must not be reported by its newest one.
          if (i + 1 >= windowStart) h.inWindow++;
          if (h.samples.length < SCAN_SAMPLES) {
            h.samples.push("row " + (i + 1) + ' displays as "' + display[i][j] + '"');
          }
        }
      }
    }

    var cols = Object.keys(hits);
    if (!cols.length) {
      lines.push("  CLEAN    " + pad_(tabName, 20) + rows + " rows x " + headers.length + " cols, " + ms + "ms");
      continue;
    }

    lines.push("  NEEDS 2  " + pad_(tabName, 20) + rows + " rows x " + headers.length + " cols, " + ms + "ms");
    for (var c = 0; c < cols.length; c++) {
      var idx = Number(cols[c]);
      var hit = hits[idx];
      var note = "";
      if (windowStart) {
        note = hit.inWindow === 0
          ? "  [all outside the last-" + SCAN_AUDIT_TAIL + "-row read window - not currently served]"
          : "  [" + hit.inWindow + " of " + hit.count + " inside the last-" + SCAN_AUDIT_TAIL + "-row read window]";
      }
      lines.push("             - column \"" + headers[idx] + "\": " + hit.count +
                 " time-only cell(s), rows " + hit.minRow + "-" + hit.maxRow + note);
      for (var s = 0; s < hit.samples.length; s++) lines.push("               " + hit.samples[s]);
      // Only cells the app can actually serve keep the second read alive. An
      // AuditLog hit entirely outside the tail window is a sheet-hygiene note,
      // not a blocker for P2-5.
      if (!windowStart || hit.inWindow > 0) {
        offenders.push(tabName + "." + headers[idx] + " (" + (windowStart ? hit.inWindow : hit.count) + ")");
      }
    }
  }

  volume.sort(function (a, b) { return b.cells - a.cells; });

  var out = [];
  out.push("=== LEGACY TIME-ONLY DATE SCAN ===");
  out.push("");
  out.push("Per-tab result (CLEAN = safe to drop the getDisplayValues read):");
  out.push.apply(out, lines);
  out.push("");
  out.push("=== VOLUME (drives readAll cost - every cell is fetched TWICE today) ===");
  for (var v = 0; v < volume.length; v++) {
    var e = volume[v];
    var pct = totalCells ? Math.round(e.cells * 1000 / totalCells) / 10 : 0;
    out.push("  " + pad_(e.tab, 20) + pad_(String(e.cells), 8) + "cells  " + pad_(pct + "%", 7) + e.ms + "ms");
  }
  out.push("  " + pad_("TOTAL", 20) + pad_(String(totalCells), 8) + "cells          " + totalMs + "ms");
  out.push("");
  out.push("=== VERDICT ===");
  if (!offenders.length) {
    out.push("  No time-only Date cells anywhere. P2-5 is safe on every tab:");
    out.push("  drop the getDisplayValues() call in readTab/readTabTail and the");
    out.push("  `val instanceof Date && year < 1900` branch collapses to unreachable.");
    out.push("  Expected saving: ~half the per-tab sheet-read cost above.");
  } else {
    out.push("  " + offenders.length + " column(s) still hold time-only Dates:");
    out.push("    " + offenders.join(", "));
    out.push("");
    out.push("  These are the ONLY thing keeping the second read. Options:");
    out.push("    (a) One-time rewrite of those cells to text (setValue of the");
    out.push("        DISPLAYED string), then re-run this scan - it should come");
    out.push("        back clean and P2-5 applies everywhere.");
    out.push("    (b) Keep both reads for just these tabs, drop it for the rest.");
    out.push("  Check the sample rows above before rewriting - confirm the");
    out.push("  displayed string is what the app should have been storing.");
  }

  var report = out.join("\n");
  Logger.log(report);
  return report;   // also visible as the return value in the editor
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += " ";
  return s;
}
