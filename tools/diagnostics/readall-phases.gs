/**
 * readall-phases.gs — ONE-OFF DIAGNOSTIC. NOT part of the deployed backend.
 *
 * WHAT IT ANSWERS
 * ---------------
 * An instrumented CLONE of readAllTabs() that splits every tab into four phases —
 * getDataRange / getValues / getDisplayValues / row-shaping — then times
 * getAllRevs and JSON.stringify. One run attributes the whole request.
 *
 * ORIGINALLY (2026-08-11, pre-fix) it found the bottleneck: row shaping was
 * 26,119ms of a 34,929ms readAll (76%), essentially all of it the
 * Utilities.formatDate + Session.getScriptTimeZone pair inside the loop — two
 * V8->Java service-bridge calls at ~3.4ms each, once per date cell, ~7,400 cells.
 * The tell was that cost tracked DATE cells, not total cells: Roster shaped 6,394
 * cells in 1ms (zero dates), Leave shaped 1,430 in 1,532ms (298 dates).
 *
 * NOW (post-fix) its job is VERIFICATION, and the expected reading is:
 *   - shaping        collapses to double-digit ms
 *   - getDisplayValues column reads 0 (the call is gone)
 *   - empty tabs     cost one getLastRow probe, not a full range read
 *   - sheet I/O      becomes the dominant remaining cost, and is irreducible
 *                    without fewer tabs or a different backend
 * It is also the tool that decides when the Supabase question reopens:
 * READALL_PERF_SPEC.md 5 sets that trigger at sheet I/O above ~10s.
 *
 * BEWARE RUN-TO-RUN VARIANCE. Two pre-fix runs of this file totalled 34,929ms and
 * 15,410ms — a 2.3x spread on identical code and data. Take a median of 3-5 runs
 * and compare against a same-session baseline; never read a single run as truth.
 * Treat the per-phase SHARES as the robust signal, not the absolute ms.
 *
 * WHY A CLONE AND NOT A WRAPPER: readTab() shapes and returns in one pass, so
 * there is no seam to time from outside. The loop below is copied VERBATIM from
 * readTab (apps-script-Code.gs) — if that function changes, this drifts and the
 * numbers stop describing production. Re-copy before trusting a later run.
 * Last synced against readTab on 2026-08-11, after the P0/P1/P2 fixes landed.
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
  out.push("  " + phaseDriftCheck_(ss, rowsOut));
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
  out.push("--- Post-fix verification (expected readings in brackets) ---");
  out.push("  Row-shaping loop              " + phasePad_(sum.shape + "ms", 10) +
           phasePct_(sum.shape, phaseTotal) + " [expect double-digit ms]");
  out.push("  getDisplayValues              " + phasePad_(sum.display + "ms", 10) +
           phasePct_(sum.display, phaseTotal) + " [expect 0 — the call is gone]");
  out.push("  Empty-tab probes              " + phasePad_(sum.empty + "ms", 10) +
           phasePct_(sum.empty, phaseTotal) + " [one getLastRow each, no range read]");
  out.push("  Sheet I/O floor               " + phasePad_((sum.range + sum.values) + "ms", 10) +
           phasePct_(sum.range + sum.values, phaseTotal) + " [now the dominant cost]");
  out.push("");
  out.push("  If shaping is still seconds, the deploy did not take — check that");
  out.push("  Manage Deployments points at a NEW version. SYNC_PERF 8.5 records a");
  out.push("  full measurement pass wasted on an un-redeployed backend.");
  out.push("");
  out.push("  VARIANCE: two pre-fix runs of this file totalled 34,929ms and");
  out.push("  15,410ms on identical code. Median 3-5 runs; trust shares over ms.");
  out.push("");
  out.push("  Sheet I/O above ~10s is the trigger to reopen the backend-migration");
  out.push("  question (READALL_PERF_SPEC.md 5). Currently expected 12-18 months out.");

  var report = out.join("\n");
  Logger.log(report);
  return report;
}

/**
 * DRIFT CHECK — the thing that makes every number above trustworthy.
 *
 * This file measures a CLONE of readTab, so its numbers describe production only
 * for as long as the clone matches. Drift is silent and the report looks just as
 * confident when it is wrong, so check rather than assume: re-run the REAL
 * readTab (pasted alongside, from the deployed backend) over the largest tab this
 * run touched and compare the shaped output.
 *
 * Costs one extra tab read. Worth it — a wrong phase split sends someone
 * optimising the wrong thing for a day, which is exactly what happened before
 * this file existed.
 */
function phaseDriftCheck_(ss, rowsOut) {
  if (typeof readTab !== "function") {
    return "DRIFT CHECK: SKIPPED — readTab not in scope. Paste apps-script-Code.gs " +
           "into this project to enable it; numbers below are UNVERIFIED.";
  }
  // Largest non-empty, non-tail entry: most rows = most chances to disagree.
  var target = null;
  for (var i = 0; i < rowsOut.length; i++) {
    var e = rowsOut[i];
    if (e.isEmpty || e.tab.indexOf("(tail") >= 0) continue;
    if (!target || e.rowCount > target.rowCount) target = e;
  }
  if (!target) return "DRIFT CHECK: SKIPPED — no non-empty tab in this run.";

  var real;
  try { real = readTab(target.tab); }
  catch (err) { return "DRIFT CHECK: ERRORED on " + target.tab + " — " + err; }
  if (!real || real.error) return "DRIFT CHECK: SKIPPED — readTab('" + target.tab + "') errored.";

  var a = JSON.stringify(real), b = JSON.stringify(target.rows);
  if (a === b) {
    return "DRIFT CHECK: PASS — clone output identical to readTab('" + target.tab +
           "', " + target.rowCount + " rows).";
  }
  // Locate the first divergence so the failure is actionable, not just "differs".
  var at = 0;
  while (at < a.length && at < b.length && a.charAt(at) === b.charAt(at)) at++;
  return "DRIFT CHECK: *** FAIL *** on " + target.tab + " — clone has diverged from " +
         "readTab. EVERY NUMBER BELOW IS MEANINGLESS. First difference at char " + at +
         ": real=" + JSON.stringify(a.substr(at, 40)) + " clone=" + JSON.stringify(b.substr(at, 40)) +
         ". Re-copy readTab's shaping loop into phaseReadTab_.";
}

/**
 * Local copy of formatSheetDate_ (apps-script-Code.gs). Deliberately a COPY and
 * not a call: this file is pasted in alongside the deployed backend, and calling
 * the real one would mean a run silently measures whichever version happens to be
 * pasted rather than the one this clone was written against.
 */
var PHASE_MONTHS_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function phaseFormatSheetDate_(d) {
  var day = d.getDate();
  return (day < 10 ? "0" + day : String(day)) + " " +
         PHASE_MONTHS_[d.getMonth()] + " " + d.getFullYear();
}

/** Instrumented clone of readTab(). Shaping loop copied verbatim. */
function phaseReadTab_(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return null;

  var t0 = new Date().getTime();
  // P1 guard, mirroring readTab: an empty tab must cost one metadata call here
  // too, or this tool reports a saving the real code no longer pays for.
  if (sheet.getLastRow() < 2) {
    var tEmpty = new Date().getTime();
    return { tab: tabName, rows: [], rowCount: 0, isEmpty: true,
             rangeMs: tEmpty - t0, valuesMs: 0, displayMs: 0, shapeMs: 0,
             totalMs: tEmpty - t0 };
  }
  var range = sheet.getDataRange();
  var t1 = new Date().getTime();
  var data = range.getValues();
  var t2 = new Date().getTime();
  // getDisplayValues is GONE from readTab (P2). The phase slot stays so the
  // column still lines up against pre-2026-08-11 runs — it should now read 0.
  var t3 = t2;

  var rows = [];
  if (data.length >= 2) {
    var headers = data[0].map(function (h) { return String(h).trim(); });
    for (var i = 1; i < data.length; i++) {
      var row = {};
      var hasData = false;
      for (var j = 0; j < headers.length; j++) {
        if (headers[j]) {
          var val = data[i][j];
          if (val instanceof Date) val = phaseFormatSheetDate_(val);
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
  var t3 = t2;   // getDisplayValues gone from readTabTail too (P2)

  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var row = {};
    var hasData = false;
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        var val = data[i][j];
        if (val instanceof Date) val = phaseFormatSheetDate_(val);
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
