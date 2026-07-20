#!/usr/bin/env node
// SYNC_PERF_IMPROVEMENTS_SPEC.md §5 measurement harness — everything §2's cost
// model says is measurable WITHOUT a live Apps Script deployment: backend
// REQUEST COUNT and PAYLOAD BYTES (the two dominant costs per §2), plus a
// labeled-as-weak wall-clock number (the "network" here is a function call
// into the real apps-script-Code.gs running in a vm sandbox, so it has none of
// the real deployment's 300-1500ms routing/V8-spinup tax — see §2's own
// caveat). What this harness CANNOT measure — real GAS round-trip latency —
// is exactly what tools/bench/browser-bench.md hands off to a human running
// against a live/sandbox deployment.
//
// Usage:
//   node tools/bench/sync-bench.js [--tree <path>] [--json]
//   node tools/bench/sync-bench.js --before <old-tree> --after <new-tree> [--json]
//
// --tree defaults to this repo's root — the code-under-test (js/*.js,
// apps-script-Code.gs) loads from --tree, but the measurement instrumentation
// (test/harness.js, test/mocks/*) ALWAYS loads from the current repo root
// (this file requires it by relative path, which only ever resolves inside
// THIS checkout, never inside a --tree pointed at another worktree) — so an
// old tree is measured with the SAME ruler as this branch, not its own
// (possibly absent) mocks/harness.
"use strict";
const path = require("path");
const { loadBackend, makeClient, makeLaunchClient, flushMicrotasks } = require("../../test/harness.js");
const { buildFixture, seedBackend, buildWizardConductRows, PEOPLE } = require("./fixture.js");

const REPO_ROOT = path.resolve(__dirname, "../..");

// ── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { tree: REPO_ROOT, json: false, before: null, after: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tree") out.tree = path.resolve(argv[++i]);
    else if (a === "--before") out.before = path.resolve(argv[++i]);
    else if (a === "--after") out.after = path.resolve(argv[++i]);
    else if (a === "--json") out.json = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

// ── Backend request/byte instrumentation ────────────────────────────────
// Wraps backend.doGet/doPost (the vm-sandbox equivalent of the fetch
// boundary) so every scenario below counts EXACTLY the requests it fires,
// with no reliance on fetchSpy bookkeeping that varies between harness call
// sites. Installed AFTER scenario setup (seeding, priming a baseline pull) so
// setup cost never pollutes the measured numbers — every scenario below is
// careful to instrument only right before the thing it's actually measuring.
//
// Byte counts: response bytes are exact (out.getContent() is the literal
// JSON string ContentService would ship). Request bytes are exact for POST
// (e.postData.contents is the literal wire body) but APPROXIMATE for GET —
// doGet only receives the already-parsed {parameter:{...}} object, not the
// raw querystring, so we reconstruct an approximate `k=v&k=v` string from it.
// This under/overcounts URL-encoding overhead by a few bytes per request,
// immaterial next to response payload sizes (KB-hundreds-of-KB scale) but
// worth flagging rather than passing off as exact.
function instrumentBackend(backend) {
  const stats = { requests: 0, bytesReq: 0, bytesRes: 0, byAction: {} };
  const origGet = backend.doGet;
  const origPost = backend.doPost;
  backend.doGet = function (e) {
    stats.requests++;
    const params = (e && e.parameter) || {};
    const action = params.action || "?";
    const qs = Object.keys(params)
      .map(k => `${k}=${encodeURIComponent(params[k] == null ? "" : params[k])}`)
      .join("&");
    stats.bytesReq += Buffer.byteLength(qs, "utf8");
    const out = origGet.call(backend, e);
    stats.bytesRes += Buffer.byteLength(out.getContent(), "utf8");
    stats.byAction[action] = (stats.byAction[action] || 0) + 1;
    return out;
  };
  backend.doPost = function (e) {
    stats.requests++;
    const body = (e && e.postData && e.postData.contents) || "";
    let action = "?";
    try { action = JSON.parse(body).action || "?"; } catch (_) { /* malformed body — leave "?" */ }
    stats.bytesReq += Buffer.byteLength(body, "utf8");
    const out = origPost.call(backend, e);
    stats.bytesRes += Buffer.byteLength(out.getContent(), "utf8");
    stats.byAction[action] = (stats.byAction[action] || 0) + 1;
    return out;
  };
  return stats;
}

function median(nums) {
  const a = nums.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

// Runs `fn` (one full scenario execution, self-contained: builds its own
// backend/client(s) so reps never share mutated state) `reps` times, timing
// each with process.hrtime.bigint(). Requests/bytes/extras are deterministic
// (fixed-seed fixture, no real network jitter) so we keep the LAST rep's
// values; only wall-clock needs the spread.
async function timeReps(fn, reps) {
  const times = [];
  let last;
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    last = await fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  return Object.assign({ wallMs: median(times) }, last);
}

// ── Scenario setup helpers ──────────────────────────────────────────────

// The exact key set _saveLocalFlush() persists (js/state.js) — used to build
// a faithful cachedState snapshot for the launch-bootstrap scenarios. Both
// trees persist the same shape (P3-2 changed WHEN this fires, not what it
// contains), so one constant list serves both.
const CACHE_KEYS = ["roster", "medical", "attendance", "ippt", "rm", "soc", "polar",
  "conductDetail", "appointments", "leave", "msk", "conducts", "config", "vocfit", "platoons"];

function snapshotCache(state) {
  const snap = {};
  for (const k of CACHE_KEYS) snap[k] = state[k];
  snap.rev = state.rev;
  return JSON.parse(JSON.stringify(snap));   // deep clone — never share live refs with the primer client
}

// Mutates `tabs` (sheet names) on `backend` via a SECOND client's real
// autoSync writes, so their server revision advances past whatever
// `cachedState` snapshotted — the same "another device changed this between
// your last pull and now" setup test/launch-bootstrap.test.js uses.
async function advanceTabs(backend, tree, tabs, d4s) {
  const mutator = makeClient(backend, { root: tree });
  await mutator.sb.API.pullAll();
  const rows = {
    Medical: { id: "9999", d4: d4s[0], date: "", reason: "bench-edit", location: "", status: "MC", startDate: "", endDate: "", type: "RSI", urtiType: "", mrTiming: "", visitId: "", origin: "manual", bookInDate: "" },
    Attendance: { id: "9999", date: "01 Mar 2026", time: "0800", conductId: "bench-c", total: PEOPLE, participating: PEOPLE, lms: 0, px: 0, fallout: 0, remarks: "bench", participants: "", periods: 1, currencyTags: "HA", source: "wizard", statusReviewed: "TRUE" },
    IPPT: { id: "9999", d4: d4s[0], attempt: 3, date: "01 Mar 2026", pushups: 40, situps: 40, runTime: "9:30", score: 80 }
  };
  for (const tab of tabs) await mutator.sb.autoSync(tab, { type: "upsert", row: rows[tab] });
}

// ── Scenarios (§5 items 1-3 + the wizard/idle-poll additions) ───────────
// Each returns a thunk suitable for timeReps(): fully self-contained, builds
// its own backend fresh every call so reps never leak state into each other.

function scenarioColdLaunch(tree, fixture) {
  return async () => {
    const backend = loadBackend({ root: tree });
    seedBackend(backend, fixture);
    const stats = instrumentBackend(backend);
    makeLaunchClient(backend, { root: tree });   // no cachedState => cold path on BOTH trees
    await flushMicrotasks();
    return { requests: stats.requests, bytesReq: stats.bytesReq, bytesRes: stats.bytesRes, byAction: stats.byAction };
  };
}

function scenarioWarmLaunch(tree, fixture, changedTabs) {
  return async () => {
    const backend = loadBackend({ root: tree });
    seedBackend(backend, fixture);
    const primer = makeClient(backend, { root: tree });
    await primer.sb.API.pullAll();
    const cachedState = snapshotCache(primer.sb.STATE);
    if (changedTabs.length) await advanceTabs(backend, tree, changedTabs, fixture.d4s);

    const stats = instrumentBackend(backend);
    makeLaunchClient(backend, { root: tree, cachedState });
    await flushMicrotasks();
    return { requests: stats.requests, bytesReq: stats.bytesReq, bytesRes: stats.bytesRes, byAction: stats.byAction };
  };
}

function scenarioSingleRowEdit(tree, fixture) {
  return async () => {
    const backend = loadBackend({ root: tree });
    seedBackend(backend, fixture);
    const client = makeClient(backend, { root: tree });
    await client.sb.API.pullAll();
    const stats = instrumentBackend(backend);
    const row = Object.assign({}, client.sb.STATE.roster[0], { name: "Bench Edited Name" });
    await client.sb.autoSync("Roster", { type: "upsert", row });
    return { requests: stats.requests, bytesReq: stats.bytesReq, bytesRes: stats.bytesRes };
  };
}

// Re-saves an already-logged 30-row conduct through the wizard's atomic
// replaceConduct path — the P3-1 target (batched contiguous deletes).
function scenarioWizardConductSave(tree, fixture) {
  return async () => {
    const backend = loadBackend({ root: tree });
    seedBackend(backend, fixture);
    // Seed one extra 30-row contiguous block for THIS conduct so the save is
    // a genuine re-save (delete 30 + append 30), not a first-time append.
    const conductId = "wizC", date = "01 Mar 2026";
    const existing = [];
    for (let i = 1; i <= 30; i++) {
      existing.push([String(9000 + i), date, "0730", conductId, "11" + String(i).padStart(2, "0"), "Status", "MC"]);
    }
    backend.db.seed("ConductDetail", fixture.conductDetail.headers, fixture.conductDetail.rows.concat(existing));

    const client = makeClient(backend, { root: tree });
    await client.sb.API.pullAll();
    const stats = instrumentBackend(backend);
    const beforeDeleteRows = backend.db.spy.deleteRows, beforeDeleteRow = backend.db.spy.deleteRow;
    const newRows = buildWizardConductRows(30, conductId, date);
    await client.sb.autoSync("ConductDetail", { type: "replaceConduct", match: { date, time: "0730", conductId }, rows: newRows });
    return {
      requests: stats.requests, bytesReq: stats.bytesReq, bytesRes: stats.bytesRes,
      deleteRowsCalls: backend.db.spy.deleteRows - beforeDeleteRows,
      deleteRowCalls: backend.db.spy.deleteRow - beforeDeleteRow
    };
  };
}

// 5 simulated minutes of idle polling at the fixed 20s cadence
// (AUTO_REFRESH_MS, js/sync.js) — driven directly (no real setInterval/sleep,
// per the task brief) since nothing under test needs a real timer, only
// autoRefreshTick's own logic run N times in a row.
const AUTO_REFRESH_MS = 20000;
function scenarioIdlePolling(tree, fixture) {
  return async () => {
    const backend = loadBackend({ root: tree });
    seedBackend(backend, fixture);
    const client = makeClient(backend, { root: tree });
    await client.sb.API.pullAll();
    const stats = instrumentBackend(backend);
    const beforeGetProperty = backend.db.spy.getProperty, beforeGetProperties = backend.db.spy.getProperties;
    const ticks = Math.floor((5 * 60 * 1000) / AUTO_REFRESH_MS);   // 15
    for (let i = 0; i < ticks; i++) await client.sb.autoRefreshTick("interval");
    return {
      requests: stats.requests, bytesReq: stats.bytesReq, bytesRes: stats.bytesRes,
      ticks,
      // P2-2's target: getAllRevs() should collapse from REV_TABS.length
      // individual getProperty() calls to ONE getProperties() call per poll.
      getPropertyPerPoll: +((backend.db.spy.getProperty - beforeGetProperty) / ticks).toFixed(2),
      getPropertiesPerPoll: +((backend.db.spy.getProperties - beforeGetProperties) / ticks).toFixed(2)
    };
  };
}

// §5 item 4 / P3-2: saveLocal()'s synchronous-flush cost + how many actual
// localStorage writes a burst of 20 edits produces. Not a request/byte
// scenario (no backend involved) — reported separately.
async function scenarioSaveLocal(tree, fixture) {
  const backend = loadBackend({ root: tree });
  seedBackend(backend, fixture);
  const client = makeClient(backend, { root: tree });
  await client.sb.API.pullAll();   // full fixture-sized STATE, like a real launch

  const hasDebounce = typeof client.sb._saveLocalFlush === "function";
  // Use saveLocalNow() (new tree), not _saveLocalFlush() directly, for the
  // timing loop below: _saveLocalFlush() resets the internal timer-handle
  // variable to null WITHOUT calling clearTimeout on the mock's timer queue,
  // so a pending debounce timer (e.g. armed by the pullAll() above, which
  // calls saveLocal()) would sit orphaned in the mock and double-fire the
  // next time something calls flushTimers() — an artifact of driving the
  // internals directly, not a real product behavior. saveLocalNow() is the
  // real escape hatch and does the clearTimeout correctly; old tree has no
  // debounce at all, so plain saveLocal() is already synchronous there.
  const flush = hasDebounce ? client.sb.saveLocalNow : client.sb.saveLocal;

  const REPS = 25;
  const times = [];
  for (let i = 0; i < REPS; i++) {
    const t0 = process.hrtime.bigint();
    flush();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }

  let burstWrites = 0;
  const origSetItem = client.sb.localStorage.setItem;
  client.sb.localStorage.setItem = (...args) => { burstWrites++; origSetItem.apply(client.sb.localStorage, args); };
  for (let i = 0; i < 20; i++) {
    client.sb.STATE.roster[0].name = "Burst edit " + i;
    client.sb.saveLocal();
  }
  if (hasDebounce) client.ctl.flushTimers();

  return { flushMedianMs: +median(times).toFixed(3), burstWrites, debounced: hasDebounce };
}

// ── Runner ───────────────────────────────────────────────────────────────
const REPS = 9;

async function runAll(tree) {
  const fixture = buildFixture();
  const out = {};
  out.coldLaunch = await timeReps(scenarioColdLaunch(tree, fixture), REPS);
  out.warmLaunchNoChange = await timeReps(scenarioWarmLaunch(tree, fixture, []), REPS);
  out.warmLaunch1Tab = await timeReps(scenarioWarmLaunch(tree, fixture, ["Medical"]), REPS);
  out.warmLaunch3Tabs = await timeReps(scenarioWarmLaunch(tree, fixture, ["Medical", "Attendance", "IPPT"]), REPS);
  out.singleRowEdit = await timeReps(scenarioSingleRowEdit(tree, fixture), REPS);
  out.wizardConductSave = await timeReps(scenarioWizardConductSave(tree, fixture), REPS);
  out.idlePolling5min = await timeReps(scenarioIdlePolling(tree, fixture), REPS);
  out.saveLocal = await scenarioSaveLocal(tree, fixture);
  return out;
}

// ── Reporting ────────────────────────────────────────────────────────────
const ROWS = [
  ["coldLaunch", "Cold launch (empty cache → full pull)"],
  ["warmLaunchNoChange", "Warm launch, nothing changed"],
  ["warmLaunch1Tab", "Warm launch, 1 tab changed"],
  ["warmLaunch3Tabs", "Warm launch, 3 tabs changed"],
  ["singleRowEdit", "Single-row edit (Roster upsert)"],
  ["wizardConductSave", "Wizard conduct save, 30 rows (replaceConduct)"],
  ["idlePolling5min", "Idle polling, 5 min simulated (15 revCheck ticks)"]
];

function fmtBytes(n) { return n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B"; }

function singleTreeTable(res) {
  const lines = [];
  lines.push("| Scenario | Requests | Payload (req+res) | Wall-clock (median, weak signal) |");
  lines.push("|---|---|---|---|");
  for (const [key, label] of ROWS) {
    const r = res[key];
    let extra = "";
    if (key === "wizardConductSave") extra = ` (deleteRows×${r.deleteRowsCalls}, deleteRow×${r.deleteRowCalls})`;
    if (key === "idlePolling5min") extra = ` (getProperty≈${r.getPropertyPerPoll}/poll, getProperties≈${r.getPropertiesPerPoll}/poll)`;
    lines.push(`| ${label}${extra} | ${r.requests} | ${fmtBytes(r.bytesReq + r.bytesRes)} | ${r.wallMs.toFixed(1)} ms |`);
  }
  lines.push("");
  lines.push("| §5 item 4 | \\_saveLocalFlush median (25 reps) | localStorage writes / 20-edit burst |");
  lines.push("|---|---|---|");
  lines.push(`| saveLocal() | ${res.saveLocal.flushMedianMs} ms | ${res.saveLocal.burstWrites} (debounced: ${res.saveLocal.debounced}) |`);
  return lines.join("\n");
}

function compareTable(before, after) {
  const lines = [];
  lines.push("| Scenario | Requests (before → after) | Payload (before → after) | Wall-clock, weak signal (before → after) |");
  lines.push("|---|---|---|---|");
  for (const [key, label] of ROWS) {
    const b = before[key], a = after[key];
    let extra = "";
    if (key === "wizardConductSave") {
      extra = ` (deleteRows×${b.deleteRowsCalls}/deleteRow×${b.deleteRowCalls} → deleteRows×${a.deleteRowsCalls}/deleteRow×${a.deleteRowCalls})`;
    }
    if (key === "idlePolling5min") {
      extra = ` (getProperty/poll ${b.getPropertyPerPoll} → ${a.getPropertyPerPoll}; getProperties/poll ${b.getPropertiesPerPoll} → ${a.getPropertiesPerPoll})`;
    }
    const reqB = b.requests, reqA = a.requests;
    const byB = b.bytesReq + b.bytesRes, byA = a.bytesReq + a.bytesRes;
    lines.push(`| ${label}${extra} | ${reqB} → ${reqA} | ${fmtBytes(byB)} → ${fmtBytes(byA)} | ${b.wallMs.toFixed(1)} → ${a.wallMs.toFixed(1)} ms |`);
  }
  lines.push("");
  lines.push("| §5 item 4 | flush median (before → after) | burst writes / 20 edits (before → after) |");
  lines.push("|---|---|---|");
  lines.push(`| saveLocal() | ${before.saveLocal.flushMedianMs} → ${after.saveLocal.flushMedianMs} ms | ${before.saveLocal.burstWrites} (debounced:${before.saveLocal.debounced}) → ${after.saveLocal.burstWrites} (debounced:${after.saveLocal.debounced}) |`);
  return lines.join("\n");
}

const CAVEATS = `
**Caveats (read before citing these numbers):**
- Wall-clock is a *weak signal* here — the "network" is a synchronous function call into the real \`apps-script-Code.gs\` running in a Node vm sandbox, not a real GAS deployment (which costs ~300-1500ms/request per §2 BEFORE any sheet work). The request-count and payload-byte columns are the numbers this harness can actually vouch for; wall-clock differences under a few ms are noise, not signal.
- The old tree (pre-\`perf/sync-engine-improvements\`) has **no \`readTabs\` batching, no \`autoSyncOnLaunch\` wiring, no debounced \`saveLocal\`, no bulk \`getAllRevs\`, no batched \`replaceConductRows\` deletes**. Its \`bootstrap()\` unconditionally does a blocking full \`readAll\` on EVERY launch — so "warm launch, nothing changed" / "1 tab changed" / "3 tabs changed" all collapse to the SAME old-tree number (one full \`readAll\`, same payload as cold launch) because there is no code path on that tree that distinguishes them. That collapse is the honest old-tree behavior, not a bug in this harness.
- GET request bytes are an *approximate* reconstruction of the querystring from the parsed \`{parameter:{...}}\` object the mock backend receives (doGet never sees the raw URL) — POST bytes are exact (the literal wire body). Response bytes are always exact.
- Fixture: ${PEOPLE} people, proportional Medical/Attendance/ConductDetail/IPPT (fixed seed — see tools/bench/fixture.js).
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.before && args.after) {
    const before = await runAll(args.before);
    const after = await runAll(args.after);
    if (args.json) { console.log(JSON.stringify({ before, after }, null, 2)); return; }
    console.log(`## Sync-perf bench: before (${args.before}) vs after (${args.after})\n`);
    console.log(compareTable(before, after));
    console.log(CAVEATS);
    return;
  }
  const res = await runAll(args.tree);
  if (args.json) { console.log(JSON.stringify(res, null, 2)); return; }
  console.log(`## Sync-perf bench: ${args.tree}\n`);
  console.log(singleTreeTable(res));
  console.log(CAVEATS);
}

main().catch(e => { console.error(e); process.exit(1); });
