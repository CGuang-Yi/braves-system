// End-to-end regression suite for the Log Conduct wizard SAVE path
// (saveLogConductWizard, js/forms.js ~4735-4907) — the code that turned a
// UNIT-tested union (rebuildLogConductStatus, PR #65) into an untested
// integration: building the Attendance + ConductDetail (+ auto-Medical) rows
// and dispatching them through the REAL sync engine to a REAL (mocked-Sheets)
// backend. log-conduct-wizard.test.js already covers rebuildLogConductStatus
// and the entry-shaping of saveLogConductWizard in isolation (forms.js loaded
// alone, autoSync/mergeAttendanceEdit hand-stubbed); this file closes the gap
// by driving the SAME saveLogConductWizard through a full state→api→sync
// stack talking to the real apps-script-Code.gs, so a regression that only
// shows up once the write actually leaves the browser (e.g. a bad
// replaceConduct match, a dropped union row that never gets pushed) fails
// here even though the pure-logic unit tests stay green.
//
// Approach: makeWizardClient() below is a sibling of test/harness.js's
// makeClient() that bundles SIX real frontend files instead of three
// (state+api+calc+helpers+forms+sync, concatenated into ONE vm script so they
// share one lexical scope — exactly the trick harness.js already uses for its
// 3-file bundle). That gives saveLogConductWizard/rebuildLogConductStatus/
// openLogConductWizard their REAL collaborators (currentMedicalEffectiveAll,
// statusParticipates, nextId, toggleHATag, mergeAttendanceEdit, autoSync, …)
// instead of hand-written stand-ins — so this suite exercises the actual
// shipped save path, not a reimplementation of it. Only genuinely DOM-bound
// edges (renderLogConductWizard's HTML build, closeModal, alert, the
// clipboard copy) are stubbed, same as log-conduct-wizard.test.js already
// does for those same edges.
//
// `_logConduct` is a script-lexical `let` inside forms.js (not a global
// object property), so — same as log-conduct-wizard.test.js — every read/
// write of it goes through vm.runInContext() string execution, bridging
// plain data in via a throwaway global property. STATE itself IS exposed as
// a real global property (the harness's `this.STATE = STATE;` epilogue), so
// it can be read/mutated directly from Node like sync.test.js already does.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, VALID_TOKEN, baseline } = require("./harness");
const { makeBrowser } = require("./mocks/browser");

const ROOT = path.resolve(__dirname, "..");
// Real load order (index.html): calc/helpers land before forms; sync lands
// after forms in the real page too — preserved here so nothing shadows
// anything the browser wouldn't.
const WIZARD_FILES = ["js/state.js", "js/api.js", "js/calc.js", "js/helpers.js", "js/forms.js", "js/sync.js"];

function parseQuery(url) {
  const u = new URL(url);
  return { action: u.searchParams.get("action") || "", tab: u.searchParams.get("tab") || "", auth: u.searchParams.get("auth") || "" };
}

function makeWizardClient(backend, opts) {
  opts = opts || {};
  const browser = makeBrowser();
  const fetchSpy = [];

  async function fetchImpl(url, init) {
    const method = (init && init.method ? init.method : "GET").toUpperCase();
    let out, rec;
    if (method === "GET") {
      const q = parseQuery(url);
      rec = { method: "GET", action: q.action, tab: q.tab };
      out = backend.doGet({ parameter: { action: q.action, tab: q.tab, auth: q.auth } });
    } else {
      const body = JSON.parse(init.body);
      rec = { method: "POST", action: body.action, tab: body.tab };
      out = backend.doPost({ parameter: {}, postData: { contents: init.body } });
    }
    fetchSpy.push(rec);
    const text = out.getContent();
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  }

  const quietConsole = { log() {}, info() {}, warn() {}, table() {}, error: console.error.bind(console) };

  const sandbox = Object.assign({
    console: quietConsole, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp, Promise,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL,
    fetch: fetchImpl,
    // DOM/UX edges genuinely out of scope for a save-path suite (HTML build,
    // modal chrome, clipboard) — no-op stubs, same convention as
    // log-conduct-wizard.test.js's loadSaveCtx.
    render: () => {},
    renderLogConductWizard: () => {},
    closeModal: () => {},
    alert: () => {},
    copyConductChatFormat: async () => {},
    navigator: { clipboard: null },
  }, browser.globals);
  vm.createContext(sandbox);

  const src = WIZARD_FILES.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n")
    + "\n;this.STATE = STATE; this.API = API; this.TAB_TO_STATE = TAB_TO_STATE;\n";
  vm.runInContext(src, sandbox, { filename: "wizard-e2e-bundle.js" });

  sandbox.STATE.authToken = opts.authToken || VALID_TOKEN;
  sandbox.STATE.apiUrl = "https://mock.local/exec";
  sandbox.STATE.role = opts.role || "admin";

  return { sb: sandbox, fetchSpy, ctl: browser.ctl, db: backend.db };
}

// ── Wizard-driving helpers (all go through vm.runInContext — see file header) ──
function openWizard(client, attendanceId) {
  vm.runInContext(`openLogConductWizard(${attendanceId ? JSON.stringify(attendanceId) : ""});`, client.sb);
}
// Merge plain data straight onto the in-context _logConduct (bridged via a
// throwaway global, since _logConduct itself isn't reachable as a property).
function patchWiz(client, patch) {
  client.sb.__bridge = patch;
  vm.runInContext("Object.assign(_logConduct, __bridge);", client.sb);
}
function callWiz(client, code) {
  vm.runInContext(code, client.sb);
}
function wiz(client) {
  return JSON.parse(vm.runInContext("JSON.stringify(_logConduct)", client.sb));
}
// Drives one real save AND waits for every autoSync push it fires to settle
// (attendance upsert, ConductDetail replaceConduct, optional Medical
// appendMany) before returning — autoSync's drain promise is the correct
// "write has landed on the backend" signal (js/sync.js drainTab), so this
// spies on (and restores) the real autoSync rather than guessing a flush
// count.
async function saveWiz(client) {
  const pending = [];
  const orig = client.sb.autoSync;
  client.sb.autoSync = (tab, mode) => { const p = orig(tab, mode); pending.push(p); return p; };
  try {
    await vm.runInContext("saveLogConductWizard()", client.sb);
  } finally {
    client.sb.autoSync = orig;
  }
  await Promise.all(pending);
}

// ── Seed-row builders (positional arrays matching the schema comment atop
// apps-script-Code.gs) ──────────────────────────────────────────────────────
const ATT_HEADERS = ["id", "date", "time", "conductId", "total", "participating", "lms", "px", "fallout", "remarks",
  "participants", "periods", "currencyTags", "source", "statusReviewed"];
const CD_HEADERS = ["id", "date", "time", "conductId", "d4", "type", "reason"];
const MED_HEADERS = ["id", "d4", "date", "reason", "location", "status", "startDate", "endDate"];
const ROSTER_HEADERS = ["id", "name", "role", "platoon"];

function attRow(o) {
  const d = Object.assign({ id: "A1", date: "26 May 2026", time: "", conductId: "c1", total: 0, participating: 0,
    lms: 0, px: 0, fallout: 0, remarks: "", participants: "", periods: "", currencyTags: "", source: "",
    statusReviewed: false }, o);
  return ATT_HEADERS.map(h => d[h]);
}
function cdRow(o) {
  const d = Object.assign({ id: "", date: "26 May 2026", time: "", conductId: "c1", d4: "", type: "", reason: "" }, o);
  return CD_HEADERS.map(h => d[h]);
}
function medRow(o) {
  const d = Object.assign({ id: "", d4: "", date: "", reason: "", location: "", status: "", startDate: "", endDate: "" }, o);
  return MED_HEADERS.map(h => d[h]);
}
function rosterRow(id, name, role, platoon) { return [id, name, role || "Recruit", platoon || "PLT1"]; }

const DATE_DISPLAY = "26 May 2026";
const DATE_ISO = "2026-05-26";

module.exports = async function run() {
  suite("wizard save e2e: Status personnel logged (PR #65 regression, full save)");

  // The original bug: recruits on an active medical status were silently
  // never logged as absent through the wizard. rebuildLogConductStatus's
  // union fixed the CHECKLIST-BUILDING half; this drives the checklist all
  // the way through a real saveLogConductWizard() + real sync push and
  // confirms the resulting Status ConductDetail row actually lands on both
  // STATE and the backend sheet.
  await test("a participant on an active MC gets ticked and produces a real Status row on save", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [rosterRow("1235", "Recruit A", "Recruit", "PLT1")]);
    backend.db.seed("Medical", MED_HEADERS, [
      medRow({ id: "m1", d4: "1235", date: "20 May 2026", reason: "flu", status: "MC", startDate: "20 May 2026", endDate: "30 May 2026" })
    ]);
    // Real Sheets tabs are pre-provisioned (CLAUDE.md's "SHEET TABS REQUIRED"
    // setup step) — upsertRow/replaceConductRows both hard-error with "Tab not
    // found" against a sheet that was never created, same as the live sheet
    // would if a tab were deleted. Seed the (empty) tabs this save writes to.
    backend.db.seed("Attendance", ATT_HEADERS, []);
    backend.db.seed("ConductDetail", CD_HEADERS, []);
    const client = makeWizardClient(backend);
    await baseline(client);

    openWizard(client);   // new conduct
    patchWiz(client, { conductId: "c1", date: DATE_ISO, time: "0730" });
    callWiz(client, "wizAddGroup('individual:1235', 'Recruit A');");
    const before = wiz(client);
    eq(before.status.map(s => s.d4), ["1235"], "sanity: rebuildLogConductStatus ticks the active-MC participant");
    eq(before.status[0].notParticipating, true, "MC is restrictive ⇒ defaults ticked");

    await saveWiz(client);

    const stateRows = client.sb.STATE.conductDetail.filter(d => d.conductId === "c1" && d.type === "Status");
    eq(stateRows.length, 1, "exactly one Status row in STATE");
    eq(stateRows[0].d4, "1235");

    const backendRows = client.db.rowsOf("ConductDetail").filter(r => String(r.conductId) === "c1" && r.type === "Status");
    eq(backendRows.length, 1, "the replaceConduct push actually landed the Status row on the backend sheet");
    eq(backendRows[0].d4, "1235");
  });

  suite("wizard save e2e: CSV-absentee union survives a full save round-trip");

  // A recruit booked "Off"/"Leave" at CSV import time has a saved Status row
  // but no active Medical record — rebuildLogConductStatus's union (the
  // regression this whole file guards) is the only thing keeping them on the
  // checklist. Re-saving that edit through the real wizard must not drop OR
  // duplicate their row.
  await test("a CSV-Off Status row (no active medical) survives an unmodified wizard re-save exactly once", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [
      rosterRow("1234", "Recruit A", "Recruit", "PLT1"),
      rosterRow("5555", "Recruit Off", "Recruit", "PLT1")
    ]);
    backend.db.seed("Attendance", ATT_HEADERS, [
      attRow({ id: "A1", total: 2, participating: 1, px: 1, participants: "1234", source: "csv", statusReviewed: true })
    ]);
    backend.db.seed("ConductDetail", CD_HEADERS, [
      cdRow({ id: "d1", d4: "5555", type: "Status", reason: "Off" })
    ]);
    const client = makeWizardClient(backend);
    await baseline(client);

    openWizard(client, "A1");
    const opened = wiz(client);
    eq(opened.participants.sort(), ["1234", "5555"], "gross reconstruction re-adds the CSV-Off d4 to participants");
    eq(opened.status.map(s => s.d4), ["5555"], "union keeps the CSV-Off Status row on the checklist");
    eq(opened.status[0].notParticipating, true);

    await saveWiz(client);   // re-save unmodified

    const stateRows = client.sb.STATE.conductDetail.filter(d => d.conductId === "c1" && d.d4 === "5555");
    eq(stateRows.length, 1, "not dropped, not duplicated in STATE");
    eq(stateRows[0].type, "Status");

    const backendRows = client.db.rowsOf("ConductDetail").filter(r => r.d4 === "5555");
    eq(backendRows.length, 1, "not dropped, not duplicated on the backend sheet");
  });

  suite("wizard save e2e: Fallout + ReportSick rows, and ReportSick auto-Medical gating");

  await test("Fallout/ReportSick ConductDetail rows are built, and a Pending Medical row is auto-created only when none exists yet", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [
      rosterRow("1301", "Fallout Guy", "Recruit", "PLT1"),
      rosterRow("1302", "Sick Guy New", "Recruit", "PLT1"),
      rosterRow("1303", "Sick Guy Existing", "Recruit", "PLT1")
    ]);
    // 1303 already has a Medical row dated the SAME day the conduct is being
    // logged — the auto-create must skip them (no duplicate/overwritten
    // Pending row); 1302 has nothing, so a Pending row must be created. The
    // MC's start/endDate are LONG past (not covering the conduct date, and
    // outside the +1/+2 ghost window) so it's inert on the Status checklist —
    // isolates the auto-Medical gate (which matches on the report `date`
    // field only) from rebuildLogConductStatus's separate active-status union.
    backend.db.seed("Medical", MED_HEADERS, [
      medRow({ id: "m1", d4: "1303", date: DATE_DISPLAY, reason: "existing", status: "MC", startDate: "1 May 2026", endDate: "3 May 2026" })
    ]);
    backend.db.seed("Attendance", ATT_HEADERS, []);
    backend.db.seed("ConductDetail", CD_HEADERS, []);
    const client = makeWizardClient(backend);
    await baseline(client);

    openWizard(client);
    patchWiz(client, { conductId: "c1", date: DATE_ISO, time: "0730" });
    callWiz(client, "wizAddGroup('individual:1301', 'A'); wizAddGroup('individual:1302', 'B'); wizAddGroup('individual:1303', 'C');");
    patchWiz(client, {
      fallout: [{ d4: "1301", reason: "twisted ankle" }],
      reportSick: [{ d4: "1302", reason: "fever" }, { d4: "1303", reason: "cough" }]
    });

    await saveWiz(client);

    const detail = client.sb.STATE.conductDetail.filter(d => d.conductId === "c1");
    const fallout = detail.find(d => d.type === "Fallout");
    ok(fallout && fallout.d4 === "1301" && fallout.reason === "twisted ankle", "Fallout row built with the right d4/reason");
    const rs1302 = detail.find(d => d.type === "ReportSick" && d.d4 === "1302");
    ok(rs1302 && rs1302.reason === "fever", "ReportSick row built for the new-sick recruit");
    const rs1303 = detail.find(d => d.type === "ReportSick" && d.d4 === "1303");
    ok(rs1303 && rs1303.reason === "cough", "ReportSick row built for the already-has-medical recruit too");

    const med1302 = client.sb.STATE.medical.filter(m => m.d4 === "1302");
    eq(med1302.length, 1, "exactly one auto-created Medical row for the recruit with no prior medical entry");
    eq(med1302[0].status, "Pending");
    eq(med1302[0].origin, "conductLog");

    const med1303 = client.sb.STATE.medical.filter(m => m.d4 === "1303");
    eq(med1303.length, 1, "no duplicate/overwriting Pending row for the recruit who already had a medical entry that day");
    eq(med1303[0].status, "MC", "the pre-existing MC status is untouched, not reverted to Pending");

    // And the same shape actually landed on the backend via appendMany.
    const backendMed = client.db.rowsOf("Medical");
    eq(backendMed.filter(r => r.d4 === "1302").length, 1, "Pending row pushed to the backend");
    eq(backendMed.filter(r => r.d4 === "1303").length, 1, "existing 1303 row not duplicated on the backend");
    const backendDetail = client.db.rowsOf("ConductDetail").filter(r => String(r.conductId) === "c1");
    eq(backendDetail.map(r => r.type).sort(), ["Fallout", "ReportSick", "ReportSick"], "Fallout + both ReportSick rows landed on the backend");
  });

  suite("wizard save e2e: RSI rows survive a wizard re-save");

  // The wizard hasn't managed RSI since the chat workflow moved away from it
  // (js/forms.js ~4156) — saveLogConductWizard's ConductDetail replace
  // explicitly excludes `type !== "RSI"` (~4862) so historical RSI rows must
  // pass through a save completely untouched.
  await test("a legacy RSI row for this conduct is untouched by an unrelated wizard save", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [rosterRow("1234", "Recruit A", "Recruit", "PLT1")]);
    backend.db.seed("Attendance", ATT_HEADERS, [
      attRow({ id: "A1", total: 1, participating: 1, participants: "1234", source: "wizard", statusReviewed: true })
    ]);
    backend.db.seed("ConductDetail", CD_HEADERS, [
      cdRow({ id: "r1", d4: "9999", type: "RSI", reason: "legacy" })
    ]);
    const client = makeWizardClient(backend);
    await baseline(client);

    openWizard(client, "A1");
    await saveWiz(client);   // re-save unmodified

    const rsiState = client.sb.STATE.conductDetail.filter(d => d.type === "RSI");
    eq(rsiState.length, 1, "RSI row still present in STATE");
    eq(rsiState[0].id, "r1", "same row, not replaced");
    eq(rsiState[0].d4, "9999");
    eq(rsiState[0].reason, "legacy");

    const rsiBackend = client.db.rowsOf("ConductDetail").filter(r => r.type === "RSI");
    eq(rsiBackend.length, 1, "RSI row still present on the backend sheet");
    eq(String(rsiBackend[0].id), "r1", "backend RSI row untouched by the replaceConduct push");
  });

  suite("wizard save e2e: idempotent re-save clears a legacy numeric-time ConductDetail row (pre-PR #69 shape)");

  // Before PR #69, ConductDetail's time column wasn't text-forced, so a
  // leading-zero clock time like "0730" round-tripped through Sheets as the
  // NUMBER 730 (see apps-script-Code.gs ~1570 / sync.test.js's own coverage
  // of replaceConductRows' normTime reversal). This drives that SAME scenario
  // through the actual wizard save path (not a raw autoSync call) twice, to
  // prove the full forms.js → sync.js → backend pipeline converges to one
  // stable row instead of accumulating duplicates on every re-save.
  await test("logging + re-logging the same conduct via the wizard converges on one row despite a legacy numeric-time stray", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [rosterRow("1401", "Recruit A", "Recruit", "PLT1")]);
    // Orphan legacy row: time cell is the raw NUMBER 730, not the string "0730".
    backend.db.seed("ConductDetail", CD_HEADERS, [
      ["1", DATE_DISPLAY, 730, "c1", "1401", "Status", "old"]
    ]);
    backend.db.seed("Attendance", ATT_HEADERS, []);
    const client = makeWizardClient(backend);
    await baseline(client);

    // First save: brand-new conduct. Status is hand-set here rather than
    // derived from a seeded Medical row — deliberate simplification, since
    // this test is about SAVE-PATH idempotency, not status derivation (that's
    // covered by log-conduct-wizard.test.js and the first suite above).
    openWizard(client);
    patchWiz(client, {
      conductId: "c1", date: DATE_ISO, time: "0730",
      participants: ["1401"], importedBaseline: ["1401"],
      status: [{ d4: "1401", statusTag: "LD", reason: "LD", notParticipating: true }]
    });
    await saveWiz(client);

    let rows = client.db.rowsOf("ConductDetail").filter(r => String(r.conductId) === "c1");
    eq(rows.length, 1, "legacy numeric-730 stray removed, new row appended — no duplicate after save #1");

    const savedId = client.sb.STATE.attendance.find(a => a.conductId === "c1").id;

    // Second save: re-open the SAME conduct through the wizard and save again
    // unmodified — openLogConductWizard's own rebuildLogConductStatus
    // re-derives the tick from the Status row we just saved (no manual patch
    // needed this time).
    openWizard(client, savedId);
    await saveWiz(client);

    rows = client.db.rowsOf("ConductDetail").filter(r => String(r.conductId) === "c1");
    eq(rows.length, 1, "still exactly one row after re-save — idempotent, no accumulation");
    eq(rows[0].d4, "1401");
    eq(rows[0].type, "Status");
  });

  suite("wizard save e2e: a reviewed participant with no Status row stays unlogged by design");

  // Documents the intentional flip side of the union: once a conduct's
  // status checklist has been reviewed (statusReviewed=true) and a recruit on
  // an active status was explicitly left UNTICKED ("participated despite
  // status"), re-saving must NOT invent a Status row for them. If a future
  // change breaks this (e.g. by re-defaulting reviewed rows to ticked), this
  // test fails loudly instead of silently reintroducing false absences.
  await test("statusReviewed + no saved Status row ⇒ no Status row is created on re-save", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [
      rosterRow("1234", "Recruit A", "Recruit", "PLT1"),
      rosterRow("1501", "Recruit On LD", "Recruit", "PLT1")
    ]);
    backend.db.seed("Attendance", ATT_HEADERS, [
      attRow({ id: "A1", total: 2, participating: 2, participants: "1234,1501", source: "wizard", statusReviewed: true })
    ]);
    // 1501 has an active LD spanning the conduct date, but was reviewed and
    // kept participating — no Status row exists for them.
    backend.db.seed("Medical", MED_HEADERS, [
      medRow({ id: "m1", d4: "1501", date: "24 May 2026", reason: "sprain", status: "LD", startDate: "24 May 2026", endDate: "28 May 2026" })
    ]);
    const client = makeWizardClient(backend);
    await baseline(client);

    openWizard(client, "A1");
    const opened = wiz(client);
    const row1501 = opened.status.find(s => s.d4 === "1501");
    ok(row1501, "1501 still appears on the checklist (active LD)");
    eq(row1501.notParticipating, false, "reviewed + no saved Status row ⇒ honored as participating, not re-ticked");

    await saveWiz(client);   // re-save unmodified

    const stateStatus1501 = client.sb.STATE.conductDetail.filter(d => d.conductId === "c1" && d.d4 === "1501" && d.type === "Status");
    eq(stateStatus1501.length, 0, "no Status row created for the reviewed-as-participating recruit, in STATE");

    const backendStatus1501 = client.db.rowsOf("ConductDetail").filter(r => r.d4 === "1501" && r.type === "Status");
    eq(backendStatus1501.length, 0, "…and none pushed to the backend either");
  });
};
