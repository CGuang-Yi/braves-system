// Feature 35 — CSV export of the Status, Out/Leave and MC lists.
//
// The MC list is the one with teeth. "Currently on MC" is not simply "the MC
// window covers today": since PR #65 an away status ends only when a commander
// explicitly books the person in, so an MC that has ENDED but was never booked
// in is still listed under ATT C in the parade state. An MC-list export that
// dropped those would contradict the parade state sent the same morning — and
// the failure is silent, because the file looks perfectly plausible either way.
// The boundary cases below are what pin that, in both directions.
//
// The exporters are driven for real (not source-matched) with Papa and the
// download step stubbed, so what these assert is the actual CSV text.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { ROOT } = require("./harness");
const { makeBrowser } = require("./mocks/browser");
const { expandFiles } = require("./sources");

const FILES = expandFiles(["js/state.js", "js/helpers.js", "js/render.js", "js/braves-parade.js"]);
const TODAY = "2026-07-28";

// Offset from TODAY as a "DD MMM YYYY" display date — the only shape
// displayDateToISO parses. An ISO string here silently makes a row inert.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayOffset(n) {
  const d = new Date(TODAY + "T00:00:00");
  d.setDate(d.getDate() + n);
  return String(d.getDate()).padStart(2, "0") + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

const ROSTER = [
  { id: "1411", name: "Alpha One",  fourD: "1411", rank: "REC", role: "Recruit",   status: "Active", platoon: "PLT1", section: "1" },
  { id: "1422", name: "Bravo Two",  fourD: "1422", rank: "",    role: "Recruit",   status: "Active", platoon: "PLT1", section: "2" },
  { id: "2411", name: "Echo Five",  fourD: "2411", rank: "PTE", role: "Recruit",   status: "Active", platoon: "PLT2", section: "1" },
  { id: "0001", name: "Delta Cmdr", fourD: "0001", rank: "CPT", role: "Commander", status: "Active", platoon: "HQ",   section: "Command" }
];

function load(fx) {
  const browser = makeBrowser();
  const sb = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, Intl
  }, browser.globals);
  sb.globalThis = sb;
  // Minimal PapaParse: the real one is vendored for the browser and not
  // require-able here. unparse is the only call the exporters make, and header
  // order comes from the FIRST row's keys — which is exactly what the assertions
  // below care about, so a faithful stub is enough.
  sb.Papa = {
    unparse(rows) {
      const cols = Object.keys(rows[0]);
      const cell = v => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      return [cols.join(",")].concat(rows.map(r => cols.map(c => cell(r[c])).join(","))).join("\n");
    }
  };
  vm.createContext(sb);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
  }
  vm.runInContext(
    "Object.keys(STATE).forEach(k => { delete STATE[k]; }); Object.assign(STATE, "
      + JSON.stringify(fx) + ");"
    + "todayISO = () => " + JSON.stringify(TODAY) + ";"
    // Capture the export instead of letting it reach the DOM download path.
    + "var __out = null; downloadCSVText = (csv, filename) => { __out = { csv, filename }; };"
    + "var __alerts = []; alert = m => { __alerts.push(m); };",
    sb, { filename: "install-fixture.js" });
  return sb;
}

function runExport(fx, call) {
  const sb = load(fx);
  vm.runInContext(call + "; null;", sb);
  return {
    out: vm.runInContext("__out", sb),
    alerts: vm.runInContext("JSON.stringify(__alerts)", sb)
  };
}

// CSV text → array of {col: value}, so assertions name columns rather than
// counting commas.
function parse(csv) {
  const lines = String(csv).split("\n");
  const cols = lines[0].split(",");
  return lines.slice(1).filter(Boolean).map(line => {
    // The stub only quotes cells containing , " or newline; none of the
    // fixtures below produce an embedded newline, so a single-line split is safe.
    const cells = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    const o = {};
    cols.forEach((c, i) => { o[c] = cells[i]; });
    return o;
  });
}

const fixture = over => Object.assign({
  roster: JSON.parse(JSON.stringify(ROSTER)),
  medical: [], leave: [], appointments: [], platoons: [], config: [], msk: [],
  filterPlt: "", filterSect: "", filterRole: ""
}, over || {});

// One MC per interesting boundary. Every field matters — drop bookInDate from
// the third and the test stops distinguishing "booked in" from "not".
const MC_FIXTURE = () => fixture({
  medical: [
    { id: 1, d4: "1411", type: "RSI", status: "MC", date: dayOffset(-1),
      startDate: dayOffset(-1), endDate: dayOffset(2), reason: "URTI" },
    { id: 2, d4: "1422", type: "RSI", status: "MC", date: dayOffset(-6),
      startDate: dayOffset(-6), endDate: dayOffset(-2), reason: "fever" },
    { id: 3, d4: "2411", type: "RSI", status: "MC", date: dayOffset(-9),
      startDate: dayOffset(-9), endDate: dayOffset(-5), reason: "old mc",
      bookInDate: dayOffset(-4) },
    { id: 4, d4: "0001", type: "RSI", status: "Warded", date: dayOffset(-1),
      startDate: dayOffset(-1), endDate: dayOffset(3), reason: "dengue" },
    { id: 5, d4: "2411", type: "RSI", status: "MC", date: dayOffset(4),
      startDate: dayOffset(4), endDate: dayOffset(6), reason: "future" }
  ]
});

module.exports = async function run() {
  suite("list exports: the MC list is who is on MC now, not every MC row");

  await test("an MC covering today is exported; a future one is not", () => {
    const rows = parse(runExport(MC_FIXTURE(), "exportMCList()").out.csv);
    ok(rows.some(r => r["4D"] === "1411"), "the active MC is missing");
    ok(!rows.some(r => r["4D"] === "2411" && r.Reason === "future"),
      "an MC that has not started yet was exported");
  });

  await test("an MC that ENDED but was never booked in is still exported, and flagged", () => {
    // The parade state still lists this person under ATT C (bookInDate is what
    // ends an away status, not the end date). Dropping them here would make the
    // spreadsheet disagree with the message sent the same morning.
    const row = parse(runExport(MC_FIXTURE(), "exportMCList()").out.csv).find(r => r["4D"] === "1422");
    ok(row, "the ended-but-unbooked MC was dropped");
    ok(/not booked in/.test(row.Note),
      "it was folded in silently with no Note: " + JSON.stringify(row.Note));
  });

  await test("an MC that ended AND was booked in is gone", () => {
    const rows = parse(runExport(MC_FIXTURE(), "exportMCList()").out.csv);
    ok(!rows.some(r => r.Reason === "old mc"), "a booked-in, finished MC is still being exported");
  });

  await test("Warded is NOT in the MC list", () => {
    // spec §8 keeps Warded out of ATT C; it belongs to the Status export.
    const rows = parse(runExport(MC_FIXTURE(), "exportMCList()").out.csv);
    ok(!rows.some(r => r["4D"] === "0001"), "a Warded person was exported as MC");
  });

  await test("an empty result alerts instead of downloading an empty file", () => {
    const fx = MC_FIXTURE(); fx.filterPlt = "PLT2";
    const { out, alerts } = runExport(fx, "exportMCList()");
    eq(out, null);
    ok(/Nothing to export/.test(alerts), "no explanation was given: " + alerts);
  });

  suite("list exports: scope is honoured, and named in the filename");

  await test("the topbar filter narrows the rows", () => {
    const fx = MC_FIXTURE(); fx.filterPlt = "PLT1";
    const rows = parse(runExport(fx, "exportMCList()").out.csv);
    ok(rows.length === 2 && rows.every(r => r.Platoon === "PLT1"),
      "PLT1 scope leaked other platoons: " + JSON.stringify(rows.map(r => r.Platoon)));
  });

  await test("the filename carries the scope, so a slice can't pass for the company", () => {
    const all = runExport(MC_FIXTURE(), "exportMCList()").out.filename;
    ok(/MC list Company /.test(all), "unfiltered export is not marked Company: " + all);
    const fx = MC_FIXTURE();
    fx.filterPlt = "PLT1"; fx.filterSect = "2"; fx.filterRole = "Recruit";
    const scoped = runExport(fx, "exportMCList()").out.filename;
    ok(/MC list Recs-PLT1-Sect2 /.test(scoped), "scope is not in the filename: " + scoped);
  });

  suite("list exports: Out/Leave and Status");

  await test("Out/Leave exports every record in scope, newest first", () => {
    const fx = fixture({ leave: [
      { id: 1, d4: "2411", type: "AL", reason: "ANNUAL LEAVE",
        startDate: dayOffset(0), endDate: dayOffset(1), days: 2, isInCamp: false },
      { id: 2, d4: "1411", type: "Course", reason: "APSC",
        startDate: dayOffset(-3), endDate: dayOffset(-2), days: 2, isInCamp: true }
    ] });
    const rows = parse(runExport(fx, "exportLeaveList()").out.csv);
    eq(rows.map(r => r["4D"]), ["2411", "1411"]);
    eq(rows.map(r => r["In Camp"]), ["N", "Y"]);
  });

  await test("Status exports one row per person in scope, with their status today", () => {
    const rows = parse(runExport(MC_FIXTURE(), "exportStatusList()").out.csv);
    eq(rows.length, 4);
    const by = Object.fromEntries(rows.map(r => [r["4D"], r]));
    eq(by["1411"].Status, "ATT C");
    // Warded DOES belong here — it is the export that catches what MC does not.
    eq(by["0001"].Status, "WARDED");
    // The derived recovery tag shows, as it does everywhere else in the app.
    eq(by["1422"].Recovering, "MC+2");
  });

  await test("someone with nothing on today reads Present, not blank", () => {
    const rows = parse(runExport(fixture({}), "exportStatusList()").out.csv);
    ok(rows.length === 4 && rows.every(r => r.Status === "Present"),
      "expected everyone Present: " + JSON.stringify(rows.map(r => r.Status)));
  });

  await test("a blank roster rank exports as REC, matching the parade state", () => {
    // A spreadsheet that names someone differently from the message is the same
    // failure as the message doing it (DECISIONS #122).
    const row = parse(runExport(MC_FIXTURE(), "exportMCList()").out.csv).find(r => r["4D"] === "1422");
    eq(row.Rank, "REC");
  });
};
