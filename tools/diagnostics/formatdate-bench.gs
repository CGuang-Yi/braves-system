/**
 * formatdate-bench.gs — ONE-OFF DIAGNOSTIC. NOT part of the deployed backend.
 *
 * WHAT IT ANSWERS
 * ---------------
 * `readTab()` shapes every cell through this branch (apps-script-Code.gs):
 *
 *     if (val instanceof Date) {
 *       val = val.getFullYear() < 1900
 *         ? display[i][j]
 *         : Utilities.formatDate(val, Session.getScriptTimeZone(), "dd MMM yyyy");
 *     }
 *
 * `Session.getScriptTimeZone()` and `Utilities.formatDate()` are SERVICE-BRIDGE
 * calls — they cross from V8 into the Apps Script Java runtime, costing ~1-3ms
 * each, against microseconds for plain JS. And getScriptTimeZone() returns a
 * constant for the whole execution, yet it is invoked once PER DATE CELL.
 *
 * Hypothesis: on a sheet with ~7,000 calendar-date cells that branch is ~17s of
 * a ~28s readAll. This measures it, and measures the two candidate fixes:
 *
 *   Stage 1 — hoist getScriptTimeZone() out of the loop. An invariant, so this
 *             cannot change behaviour. Variant B vs C isolates its cost.
 *   Stage 2 — replace Utilities.formatDate with a pure-JS formatter. Variant D.
 *             In GAS V8 the runtime timezone IS the script timezone, so the two
 *             should agree exactly — but "should" is not good enough to ship on,
 *             which is what the DIFFER below is for. It compares D against the
 *             real Utilities.formatDate over every sampled Date cell from YOUR
 *             sheet. Ship stage 2 only if the differ reports 0 mismatches.
 *
 * NOTE ON LOCALE: Utilities.formatDate's "MMM" comes from Java SimpleDateFormat
 * under the script's locale. The pure-JS formatter below hardcodes English
 * abbreviations. If your script locale is not English these WILL differ — and
 * the differ is what tells you, rather than a silent format change on 3,600
 * ConductDetail rows.
 *
 * HOW TO RUN
 * ----------
 * Paste into the Sheet's Apps Script editor as a NEW file, run `benchFormatDate`,
 * read View -> Logs. Do NOT paste into apps-script-Code.gs and do NOT deploy.
 *
 * READ-ONLY. No setValue, no property writes.
 *
 * COST: one census pass over the data tabs (~9s on a large sheet) plus the timed
 * loops (~10s). Budget ~20s. Well inside the 6-minute editor limit.
 */

/** Tabs whose cells readAllTabs actually shapes. AuditLog is included but only
 *  its last 500 rows are ever served (readTabTail), so it is censused at that
 *  cap rather than in full — otherwise the projection overstates the win. */
var BENCH_TABS = [
  "Roster", "Medical", "Attendance", "IPPT", "RouteMarch", "SOC",
  "PolarFlow", "ConductDetail", "Appointments", "Leave", "MSK", "Conducts",
  "VocFit", "Platoons",
  "Duty", "DutyCorrection", "Holidays", "DutyUnavailable", "DutyChangeRequest",
  "Config", "BravesConfig",
  "AuditLog", "ParadeArchive", "SickArchive"
];

var BENCH_AUDIT_TAIL = 500;   // mirrors AUDIT_READALL_MAX_ROWS
var BENCH_ITERATIONS = 1000;  // enough signal at ~2.5ms/call without a long run
var BENCH_MAX_SAMPLES = 500;  // real Date cells kept for the differ

var BENCH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The stage-2 candidate: "dd MMM yyyy" with no service-bridge call.
 * Uses the runtime's own timezone, which in GAS V8 is the script timezone —
 * exactly what Session.getScriptTimeZone() returns. The differ proves it.
 */
function benchFormatPureJs_(d) {
  var day = d.getDate();
  return (day < 10 ? "0" + day : String(day)) + " " +
         BENCH_MONTHS[d.getMonth()] + " " + d.getFullYear();
}

function benchFormatDate() {
  var out = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Census: how many calendar-date cells does a real pull shape? ──
  // Only year >= 1900 counts: year < 1900 is the time-only branch, which reads
  // from `display` and never calls Utilities.formatDate.
  var samples = [];
  var perTab = [];
  var totalDateCells = 0;
  var censusT0 = new Date().getTime();

  for (var t = 0; t < BENCH_TABS.length; t++) {
    var tabName = BENCH_TABS[t];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) continue;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    var lastCol = sheet.getLastColumn();

    // Read only what readAllTabs would read: AuditLog is tail-capped.
    var startRow = 1;
    if (tabName === "AuditLog" && (lastRow - 1) > BENCH_AUDIT_TAIL) {
      startRow = lastRow - BENCH_AUDIT_TAIL + 1;
    }
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var data = sheet.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues();

    var count = 0;
    // Skip the header row only when it is actually in this slice.
    var firstDataIdx = (startRow === 1) ? 1 : 0;
    for (var i = firstDataIdx; i < data.length; i++) {
      for (var j = 0; j < headers.length; j++) {
        if (!headers[j]) continue;   // readTab ignores unheadered columns
        var val = data[i][j];
        if (val instanceof Date && val.getFullYear() >= 1900) {
          count++;
          if (samples.length < BENCH_MAX_SAMPLES) samples.push(val);
        }
      }
    }
    if (count) { perTab.push({ tab: tabName, cells: count }); totalDateCells += count; }
  }
  var censusMs = new Date().getTime() - censusT0;

  out.push("=== formatDate BENCH ===");
  out.push("");
  out.push("--- 1. Calendar-date cells shaped per readAll (census took " + censusMs + "ms) ---");
  perTab.sort(function (a, b) { return b.cells - a.cells; });
  for (var p = 0; p < perTab.length; p++) {
    out.push("  " + benchPad_(perTab[p].tab, 22) + perTab[p].cells + " date cells");
  }
  out.push("  " + benchPad_("TOTAL", 22) + totalDateCells + " date cells");

  if (!totalDateCells) {
    out.push("");
    out.push("  No calendar-date cells found. The Utilities.formatDate branch is");
    out.push("  never taken, so it is NOT your bottleneck. Hypothesis disproven —");
    out.push("  look elsewhere (row-object construction, JSON.stringify).");
    return benchEmit_(out);
  }

  // ── 2. Timed variants ──
  // A sink is accumulated and reported so nothing can be dead-code eliminated.
  var probe = samples[0];
  var n = BENCH_ITERATIONS;
  var sink = 0;
  var i2;

  var tA = new Date().getTime();
  for (i2 = 0; i2 < n; i2++) sink += Session.getScriptTimeZone().length;
  var msA = new Date().getTime() - tA;

  var tz = Session.getScriptTimeZone();
  var tB = new Date().getTime();
  for (i2 = 0; i2 < n; i2++) sink += Utilities.formatDate(probe, tz, "dd MMM yyyy").length;
  var msB = new Date().getTime() - tB;

  var tC = new Date().getTime();
  for (i2 = 0; i2 < n; i2++) {
    sink += Utilities.formatDate(probe, Session.getScriptTimeZone(), "dd MMM yyyy").length;
  }
  var msC = new Date().getTime() - tC;

  var tD = new Date().getTime();
  for (i2 = 0; i2 < n; i2++) sink += benchFormatPureJs_(probe).length;
  var msD = new Date().getTime() - tD;

  var perA = msA / n, perB = msB / n, perC = msC / n, perD = msD / n;

  out.push("");
  out.push("--- 2. Per-call cost (" + n + " iterations each) ---");
  out.push("  A  Session.getScriptTimeZone() alone        " +
           benchPad_(msA + "ms", 10) + benchRound_(perA) + "ms/call");
  out.push("  B  Utilities.formatDate, tz HOISTED         " +
           benchPad_(msB + "ms", 10) + benchRound_(perB) + "ms/call   <- stage 1");
  out.push("  C  Utilities.formatDate + getScriptTimeZone " +
           benchPad_(msC + "ms", 10) + benchRound_(perC) + "ms/call   <- CURRENT CODE");
  out.push("  D  pure-JS formatter, no bridge             " +
           benchPad_(msD + "ms", 10) + benchRound_(perD) + "ms/call   <- stage 2");
  out.push("  (sink=" + sink + ", printed only so the loops cannot be optimised away)");

  // ── 3. Differ: is the pure-JS formatter byte-identical on real data? ──
  var mismatches = [];
  for (var s = 0; s < samples.length; s++) {
    var expected = Utilities.formatDate(samples[s], tz, "dd MMM yyyy");
    var actual = benchFormatPureJs_(samples[s]);
    if (expected !== actual && mismatches.length < 5) {
      mismatches.push('    Utilities="' + expected + '"  pureJS="' + actual + '"');
    }
  }

  out.push("");
  out.push("--- 3. Equivalence differ (" + samples.length + " real Date cells from this sheet) ---");
  if (!mismatches.length) {
    out.push("  0 mismatches. The pure-JS formatter is byte-identical on your data.");
    out.push("  Stage 2 is safe to ship.");
  } else {
    out.push("  " + mismatches.length + "+ MISMATCHES — do NOT ship stage 2 as written:");
    for (var m = 0; m < mismatches.length; m++) out.push(mismatches[m]);
    out.push("  Most likely a non-English script locale changing \"MMM\".");
    out.push("  Stage 1 (hoisting) is still safe and still worth doing.");
  }

  // ── 4. Projection ──
  out.push("");
  out.push("--- 4. Projected saving on a readAll ---");
  var costNow = totalDateCells * perC;
  var costS1 = totalDateCells * perB;
  var costS2 = totalDateCells * perD;
  out.push("  Current (variant C)  " + benchPad_(benchRound_(costNow) + "ms", 12) +
           totalDateCells + " cells x " + benchRound_(perC) + "ms");
  out.push("  After stage 1 (B)    " + benchPad_(benchRound_(costS1) + "ms", 12) +
           "saves " + benchRound_(costNow - costS1) + "ms");
  out.push("  After stage 2 (D)    " + benchPad_(benchRound_(costS2) + "ms", 12) +
           "saves " + benchRound_(costNow - costS2) + "ms total");
  out.push("");
  out.push("  Compare against your measured readAll TTFB. If 'Current' is a large");
  out.push("  share of it, this branch is the bottleneck and stage 1+2 is the fix.");

  return benchEmit_(out);
}

function benchEmit_(out) {
  var report = out.join("\n");
  Logger.log(report);
  return report;
}

function benchRound_(ms) { return Math.round(ms * 100) / 100; }

function benchPad_(s, n) {
  s = String(s);
  while (s.length < n) s += " ";
  return s;
}
