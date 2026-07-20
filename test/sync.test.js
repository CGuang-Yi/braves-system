// End-to-end concurrency scenarios: REAL frontend (state/api/sync.js) talking to
// the REAL Apps Script backend through the mock fetch. Each test spins up one or
// more "tabs" (clients) sharing a single backend — true multi-client behavior.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient } = require("./harness");

const MED_HEADERS = ["id", "d4", "date", "reason", "location", "status", "startDate", "endDate"];
const med = (id, reason, extra) => Object.assign({ id, d4: "11" + id, date: "", reason, location: "", status: "", startDate: "", endDate: "" }, extra || {});

module.exports = async function run() {
  suite("sync: concurrency (real frontend ↔ real backend)");

  // 1) Two devices editing DIFFERENT recruits in the same tab → both save with
  // NO conflict (row-scoped upsert), and each converges via auto-refresh. This
  // is the exact field scenario that was wrongly conflicting before.
  await test("two devices edit different rows → both save, no conflict", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "old", "", "", "", ""]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    await B.sb.autoSync("Medical", { type: "upsert", row: med(2, "B-new") });          // recruit 2 (rev↑)
    A.sb.STATE.medical[0].reason = "A-edited";
    await A.sb.autoSync("Medical", { type: "upsert", row: med(1, "A-edited") });        // recruit 1, stale rev — still fine

    const rows = backend.db.rowsOf("Medical");
    eq(rows.map(r => String(r.id)).sort(), ["1", "2"], "both rows on the sheet");
    eq(rows.find(r => String(r.id) === "1").reason, "A-edited", "A's edit landed");
    eq(rows.find(r => String(r.id) === "2").reason, "B-new", "B's edit landed");
    eq(A.sb.STATE.dirty.size, 0, "no conflict, A not dirty");
    eq(B.sb.STATE.dirty.size, 0, "no conflict, B not dirty");

    // A's own write advanced its rev to current, so it won't auto-pull until the
    // tab rev moves again. After any further change, A converges to B's row.
    await B.sb.autoSync("Medical", { type: "upsert", row: med(2, "B-new2") });
    await A.sb.autoRefreshTick("interval");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "2"), "A converges to B's row once the rev advances");
  });

  // 2) Stale full replace is rejected — never clobbers.
  await test("stale full replace rejected; B's row survives", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "A", "", "", "", ""]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    await B.sb.autoSync("Medical", { type: "upsert", row: med(2, "B-new") });          // server rev → 2
    await A.sb.autoSync("Medical", { type: "replace", data: [med(1, "A-bulk")] });     // stale replace (omits row 2)

    const rows = backend.db.rowsOf("Medical");
    ok(rows.find(r => String(r.id) === "2"), "B's row still on the sheet (replace did not wipe it)");
    eq(rows.find(r => String(r.id) === "1").reason, "A", "row 1 unchanged (stale replace rejected)");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "2"), "A refreshed and now sees B's row");
  });

  // 3) Append never conflicts.
  await test("append applies even when far behind", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ["id", "name"], []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();
    await B.sb.autoSync("Roster", { type: "upsert", row: { id: 1, name: "B" } });      // server rev → 2
    await A.sb.autoSync("Roster", { type: "append", row: { id: 2, name: "A" } });      // baseRev stale, but append
    eq(backend.db.rowsOf("Roster").length, 2, "append applied despite stale rev");
    eq(A.sb.STATE.dirty.size, 0, "not dirty");
  });

  // 1b) Many interleaved writes to DIFFERENT rows from two devices must all land
  // and leave nobody dirty — no false-conflict storm.
  await test("interleaved different-row writes from two devices never go dirty", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    await Promise.all([
      A.sb.autoSync("Medical", { type: "upsert", row: med(1, "a1") }),
      B.sb.autoSync("Medical", { type: "upsert", row: med(2, "b1") }),
      A.sb.autoSync("Medical", { type: "upsert", row: med(3, "a2") }),
      B.sb.autoSync("Medical", { type: "upsert", row: med(4, "b2") })
    ]);

    eq(A.sb.STATE.dirty.size, 0, "A clean (no false conflict)");
    eq(B.sb.STATE.dirty.size, 0, "B clean (no false conflict)");
    eq(backend.db.rowsOf("Medical").length, 4, "all four distinct rows saved");
  });

  suite("sync: auto-refresh");

  // 4) Auto-refresh pulls ONLY the changed tab (not readAll).
  await test("autoRefreshTick pulls only the changed tab", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(5, "B-fresh") });        // server Medical rev↑

    A.fetchSpy.length = 0;
    await A.sb.autoRefreshTick("interval");
    const actions = A.fetchSpy.map(r => r.action);
    ok(actions.includes("revCheck"), "polled revCheck");
    ok(A.fetchSpy.some(r => r.action === "read" && r.tab === "Medical"), "partial-pulled Medical");
    ok(!actions.includes("readAll"), "did NOT do a full readAll");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "5"), "A now has B's row");
  });

  // 5) A dirty tab is NEVER overwritten by auto-refresh.
  await test("dirty tab protected from auto-refresh overwrite", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "orig", "", "", "", ""]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    // A has an unsynced local edit (simulate a prior failed push).
    A.sb.STATE.medical[0].reason = "my-unsynced-edit";
    A.sb.STATE.dirty = new Set(["Medical"]);
    const revBefore = A.sb.STATE.rev.Medical;

    await B.sb.autoSync("Medical", { type: "upsert", row: med(1, "B-changed") });       // server Medical rev↑

    A.fetchSpy.length = 0;
    await A.sb.autoRefreshTick("interval");
    eq(A.sb.STATE.medical[0].reason, "my-unsynced-edit", "local dirty edit NOT overwritten");
    eq(A.sb.STATE.rev.Medical, revBefore, "dirty tab's rev not advanced");
    ok(!A.fetchSpy.some(r => r.action === "read" && r.tab === "Medical"), "did not pull the dirty tab");
  });

  suite("sync: propagation of non-app writes");

  // 6) Manual sheet edit → onEdit trigger bumps rev → other tab auto-refreshes.
  await test("hand edit + onEditBumpRev propagates to other tabs", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "a", "", "", "", ""]]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    // Human types a row directly into the sheet (bypassing the app)…
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "a", "", "", "", ""], ["99", "1199", "", "hand-typed", "", "", "", ""]]);
    // …and the installable trigger fires:
    backend.onEditBumpRev({ range: { getSheet: () => ({ getName: () => "Medical" }) } });

    A.fetchSpy.length = 0;
    await A.sb.autoRefreshTick("interval");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "99"), "manual sheet edit propagated to the open tab");
  });

  // 7) Bot write bumps rev (regression for the leak that shipped).
  await test("bot Medical append + bumpRev propagates", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    // Mirrors tgCompleteMC after the fix: append + bumpRev("Medical").
    backend.appendRow("Medical", { id: 77, d4: "1177", reason: "bot sick", status: "" });
    backend.bumpRev("Medical");
    A.fetchSpy.length = 0;
    await A.sb.autoRefreshTick("interval");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "77"), "bot-added row propagated");
  });

  // 7b) Documents the leak class: an append WITHOUT a bump is silently missed.
  await test("append WITHOUT bump is missed (documents why the bump is required)", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    backend.appendRow("Medical", { id: 78, reason: "unbumped" });   // NO bumpRev
    A.fetchSpy.length = 0;
    await A.sb.autoRefreshTick("interval");
    ok(!A.sb.STATE.medical.find(r => String(r.id) === "78"), "unbumped write is NOT seen by revCheck");
  });

  suite("sync: recovery from a stuck 'unsaved' state");

  // A post-reload stuck device (dirty marker, stale rev, no in-memory stashed
  // ops) must self-clear on retry — not stay permanently in the error state.
  await test("retryAllDirty self-clears a stale dirty tab", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "srv", "", "", "", ""]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(2, "B") });  // server moves ahead
    A.sb.STATE.dirty = new Set(["Medical"]);   // simulate leftover dirty marker
    A.sb.STATE.medical[0].reason = "A-local";
    await A.sb.retryAllDirty();
    eq(A.sb.STATE.dirty.size, 0, "dirty cleared after retry (replace→conflict→pull→clear)");
  });

  // The escape hatch: discard local unsynced changes and reload from the sheet.
  await test("forceResync discards dirty + reloads authoritative state", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "server-row", "", "", "", ""]]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    A.sb.STATE.dirty = new Set(["Medical", "Roster"]);
    A.sb.STATE.medical = [{ id: 1, reason: "local-unsynced" }];   // never reached the server
    await A.sb.forceResync();   // mock confirm() returns true
    eq(A.sb.STATE.dirty.size, 0, "dirty cleared");
    eq(A.sb.STATE.medical.find(r => String(r.id) === "1").reason, "server-row", "reloaded authoritative data");
  });

  suite("sync: queue + launch");

  // 8) Per-tab queue serializes rapid edits.
  await test("two rapid upserts both land (queue serialization)", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    const before = A.sb.STATE.rev.Medical;
    const p1 = A.sb.autoSync("Medical", { type: "upsert", row: med(1, "first") });
    const p2 = A.sb.autoSync("Medical", { type: "upsert", row: med(2, "second") });
    await Promise.all([p1, p2]);
    eq(backend.db.rowsOf("Medical").length, 2, "both upserts landed");
    eq(A.sb.STATE.rev.Medical, before + 2, "rev bumped twice, no lost op");
  });

  // 9) Launch is incremental when a baseline exists; full pull when not.
  await test("launch does revCheck + partial pull (no readAll) when baselined", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();   // A now has a rev baseline
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(3, "x") });
    A.fetchSpy.length = 0;
    await A.sb.autoSyncOnLaunch();
    const actions = A.fetchSpy.map(r => r.action);
    ok(actions.includes("revCheck"), "used revCheck");
    ok(!actions.includes("readAll"), "no full readAll on incremental launch");
    ok(A.fetchSpy.some(r => r.action === "read" && r.tab === "Medical"), "partial-pulled the changed tab");
  });

  await test("launch falls back to full readAll with no baseline", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const C = makeClient(backend);
    C.sb.STATE.rev = {};        // no baseline (first-ever launch / old cache)
    C.fetchSpy.length = 0;
    await C.sb.autoSyncOnLaunch();
    ok(C.fetchSpy.map(r => r.action).includes("readAll"), "full pull when no rev baseline");
  });

  suite("sync: launch incremental — dirty guard / modal guard / many-tabs threshold (P1-1 items 5-7)");

  // Item 5 (MANDATORY): the dead code autoSyncOnLaunch() originally lacked
  // the dirty-tab guard autoRefreshTick already has. Wiring it up as-is would
  // reintroduce the PR #67 clobber class on the launch path: a tab with
  // unsynced local edits that ALSO changed on the server must never be pulled
  // over by the launch partial pull, or the edit is silently lost once
  // _dirtyOps is empty after a reload.
  await test("dirty-clobber regression: launch does NOT pull over a dirty tab whose server rev is ahead", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "orig", "", "", "", ""]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    // A has an unsynced local edit from a prior session (simulates a failed
    // push that left the tab dirty and persisted).
    A.sb.STATE.medical[0].reason = "my-unsynced-edit";
    A.sb.STATE.dirty = new Set(["Medical"]);
    const revBefore = A.sb.STATE.rev.Medical;

    // Another device advances the server's Medical rev meanwhile.
    await B.sb.autoSync("Medical", { type: "upsert", row: med(2, "B-changed") });

    A.fetchSpy.length = 0;
    await A.sb.autoSyncOnLaunch();

    ok(A.fetchSpy.map(r => r.action).includes("revCheck"), "still polled revCheck");
    ok(!A.fetchSpy.some(r => r.action === "read" && r.tab === "Medical"), "did NOT pull the dirty tab over");
    eq(A.sb.STATE.medical[0].reason, "my-unsynced-edit", "local dirty edit survives the launch sync");
    eq(A.sb.STATE.rev.Medical, revBefore, "dirty tab's rev stays at the stale baseline (so a later replay still OCC-merges)");
    ok(A.sb.STATE.dirty.has("Medical"), "still marked dirty — maybeRestoreDirty / the conflict banner owns it now");
  });

  // A non-dirty tab in the SAME launch must still refresh normally — the
  // guard is per-tab, not "any dirty tab anywhere blocks everything".
  await test("dirty-clobber regression: a DIFFERENT non-dirty tab still gets pulled in the same launch", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "orig", "", "", "", ""]]);
    backend.db.seed("Roster", ["id", "d4", "name"], [["1", "1101", "Orig Name"]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    A.sb.STATE.medical[0].reason = "my-unsynced-edit";
    A.sb.STATE.dirty = new Set(["Medical"]);   // Medical dirty, Roster clean

    await B.sb.autoSync("Medical", { type: "upsert", row: med(2, "B-changed") });
    await B.sb.autoSync("Roster", { type: "upsert", row: { id: 1, d4: "1101", name: "Renamed" } });

    A.fetchSpy.length = 0;
    await A.sb.autoSyncOnLaunch();

    ok(!A.fetchSpy.some(r => r.action === "read" && r.tab === "Medical"), "dirty Medical not pulled");
    ok(A.fetchSpy.some(r => r.action === "read" && r.tab === "Roster"), "clean Roster still pulled");
    eq(A.sb.STATE.medical[0].reason, "my-unsynced-edit", "dirty edit preserved");
    ok(A.sb.STATE.roster.find(r => r.name === "Renamed"), "clean tab refreshed to the latest server row");
  });

  // Item 6 (MANDATORY): a person card can already be open within a second or
  // two of first paint (warm-cache launch renders instantly, then this
  // revCheck resolves) — never re-render (chart teardown + #content scroll
  // reset) out from under it. Mirrors autoRefreshTick's isModalOpen() guard.
  await test("isModalOpen guard: launch does not pull/re-render over an open modal", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "orig", "", "", "", ""]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(1, "B-changed") });   // server Medical rev↑

    A.ctl.modalOpen = true;   // a person card is open on A right now
    A.fetchSpy.length = 0;
    await A.sb.autoSyncOnLaunch();

    ok(A.fetchSpy.map(r => r.action).includes("revCheck"), "still polled revCheck (cheap, always safe)");
    ok(!A.fetchSpy.some(r => r.action === "read"), "did NOT partial-pull while a modal is open");
    eq(A.sb.STATE.medical[0].reason, "orig", "STATE not overwritten under the open modal");
  });

  // Item 7 (MANDATORY): pullTabs fires one GET per changed tab. With MOST/ALL
  // tabs changed at once (e.g. a device reopened after days away), N parallel
  // GAS round trips can cost more than one readAll — fall back past a
  // threshold instead of firing a burst of per-tab GETs.
  await test("many-tabs-changed threshold: >4 changed tabs → one full pullAll, no per-tab GETs", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();   // A's rev baseline for all tracked tabs

    // Bump 5 different tabs' revs directly (simulates other devices/bots
    // changing them while A was away) — no need to actually write rows, only
    // the rev delta matters for autoSyncOnLaunch's decision.
    ["Roster", "Medical", "Attendance", "IPPT", "RouteMarch"].forEach(t => backend.bumpRev(t));

    A.fetchSpy.length = 0;
    await A.sb.autoSyncOnLaunch();

    const actions = A.fetchSpy.map(r => r.action);
    ok(actions.includes("revCheck"), "polled revCheck first");
    ok(actions.includes("readAll"), "fell back to one full pullAll");
    ok(!actions.includes("read"), "did NOT fire per-tab GETs for the 5 changed tabs");
  });

  // At exactly the threshold, the incremental (non-full-pullAll) path is still
  // used — the fallback is a "more than N" breaker, not "N or more". With the
  // batched readTabs action (P2-1) now the harness's default GET path, the
  // partial pull for those ≤4 tabs is a single readTabs request rather than
  // one `read` per tab — this asserts the batched shape, not per-tab GETs.
  await test("many-tabs-changed threshold: exactly 4 changed tabs still uses a partial (non-readAll) pull", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    ["Roster", "Medical", "Attendance", "IPPT"].forEach(t => backend.bumpRev(t));

    A.fetchSpy.length = 0;
    await A.sb.autoSyncOnLaunch();

    const actions = A.fetchSpy.map(r => r.action);
    ok(!actions.includes("readAll"), "still under the threshold — no full pullAll fallback");
    ok(!actions.includes("read"), "no per-tab GETs — batched into one readTabs request instead");
    const batches = A.fetchSpy.filter(r => r.action === "readTabs");
    eq(batches.length, 1, "exactly one batched readTabs request for the partial pull");
    eq(batches[0].tabs.split(",").sort(), ["Attendance", "IPPT", "Medical", "Roster"], "all 4 changed tabs requested in the single batch");
  });

  suite("sync: launch pull preserves unsynced (dirty) tabs");

  // Regression for the ConductDetail-vanishes-on-reload bug: the launch full
  // pull (pullAndRender → API.pullAll) used to overwrite EVERY tab, including
  // one carrying an unsynced local edit (dirty). That permanently destroyed the
  // cached-but-not-yet-pushed rows before the user could retry. autoRefreshTick
  // already protects dirty tabs — pullAll must too.
  await test("pullAll does NOT clobber a dirty tab; preserves its rev", async () => {
    const CD_HEADERS = ["id", "date", "time", "conductId", "d4", "type", "reason"];
    const backend = loadBackend();
    backend.db.seed("ConductDetail", CD_HEADERS, [["1", "26 May 2026", "", "c1", "1101", "Status", "LD"]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    // A has an unsynced local ConductDetail row (a push that failed → dirty).
    A.sb.STATE.conductDetail.push({ id: "2", date: "26 May 2026", time: "", conductId: "c1", d4: "1102", type: "Fallout", reason: "tummy" });
    A.sb.STATE.dirty = new Set(["ConductDetail"]);
    const revBefore = A.sb.STATE.rev.ConductDetail;

    // Another device advances the ConductDetail server rev meanwhile.
    await B.sb.autoSync("ConductDetail", { type: "upsert", row: { id: "9", date: "27 May 2026", time: "", conductId: "c2", d4: "1109", type: "Status", reason: "MC" } });

    // A relaunches → full pull. The dirty tab must be left untouched.
    await A.sb.API.pullAll();
    ok(A.sb.STATE.conductDetail.find(r => String(r.id) === "2"), "A's unsynced row survived the launch pull");
    eq(A.sb.STATE.rev.ConductDetail, revBefore, "dirty tab's rev preserved (not advanced past the unsynced edit)");
  });

  await test("pullAll still refreshes NON-dirty tabs normally", async () => {
    const CD_HEADERS = ["id", "date", "time", "conductId", "d4", "type", "reason"];
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "orig", "", "", "", ""]]);
    backend.db.seed("ConductDetail", CD_HEADERS, [["1", "26 May 2026", "", "c1", "1101", "Status", "LD"]]);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    A.sb.STATE.dirty = new Set(["Medical"]);          // Medical dirty, ConductDetail clean
    A.sb.STATE.medical[0].reason = "A-local";
    await B.sb.autoSync("ConductDetail", { type: "upsert", row: { id: "2", date: "27 May 2026", time: "", conductId: "c2", d4: "1102", type: "Fallout", reason: "new" } });

    await A.sb.API.pullAll();
    eq(A.sb.STATE.medical[0].reason, "A-local", "dirty Medical preserved");
    ok(A.sb.STATE.conductDetail.find(r => String(r.id) === "2"), "clean ConductDetail refreshed to server");
  });

  // VocFit/Platoons are in TAB_TO_STATE (they round-trip via the normal sync
  // primitives), so they CAN be marked dirty — but pullAll assigned them below the
  // PULL_ASSIGN dirty-guard, unconditionally, so a launch pull still clobbered a
  // failed-but-cached reference-tab edit. Same invariant as the data tabs: never
  // pull over a dirty tab.
  await test("pullAll does NOT clobber dirty VocFit / Platoons reference tabs", async () => {
    const backend = loadBackend();
    backend.db.seed("Platoons", ["code", "displayName", "active", "createdAt"], [["PLT1", "Platoon 1", "TRUE", "2026-01-01"]]);
    backend.db.seed("VocFit", ["personId", "completionDate", "certifyingUnit"], [["1101", "2026-01-01", "HQ"]]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    // A has unsynced local edits to both reference tabs (a push that failed → dirty).
    A.sb.STATE.platoons.push({ code: "PLT2", displayName: "Platoon 2", active: true, createdAt: "" });
    A.sb.STATE.vocfit.push({ personId: "1199", completionDate: "2026-02-02", certifyingUnit: "X" });
    A.sb.STATE.dirty = new Set(["Platoons", "VocFit"]);

    // Relaunch → full pull. The server has only the original rows; the dirty
    // reference tabs must be left untouched so the pending retry can still push.
    await A.sb.API.pullAll();
    ok(A.sb.STATE.platoons.find(p => p.code === "PLT2"), "A's unsynced Platoons edit survived the launch pull");
    ok(A.sb.STATE.vocfit.find(v => v.personId === "1199"), "A's unsynced VocFit edit survived the launch pull");
  });

  suite("sync: atomic per-conduct ConductDetail rewrite (replaceConduct)");

  // Fix #1: the wizard save now rewrites a conduct's detail rows with a SINGLE
  // atomic op instead of delete-every-old-id + appendMany (which could partially
  // fail and leave the sheet half-written). replaceConduct removes the matching
  // (date,time,conductId) non-RSI rows and appends the new set under one lock.
  const CD_HEADERS = ["id", "date", "time", "conductId", "d4", "type", "reason"];

  await test("replaceConduct swaps only matching non-RSI rows; keeps RSI + other conduct/date", async () => {
    const backend = loadBackend();
    backend.db.seed("ConductDetail", CD_HEADERS, [
      ["1", "26 May 2026", "", "c1", "1101", "Status", "LD"],
      ["2", "26 May 2026", "", "c1", "1102", "Fallout", "tummy"],
      ["3", "26 May 2026", "", "c1", "1103", "RSI", "legacy"],   // RSI preserved
      ["4", "26 May 2026", "", "c2", "1104", "Status", "MC"],    // other conduct preserved
      ["5", "27 May 2026", "", "c1", "1105", "Status", "LD"]     // other DATE preserved
    ]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    const revBefore = A.sb.STATE.rev.ConductDetail;

    const newRows = [
      { id: "10", date: "26 May 2026", time: "", conductId: "c1", d4: "1101", type: "Status", reason: "LD-updated" },
      { id: "11", date: "26 May 2026", time: "", conductId: "c1", d4: "1199", type: "Fallout", reason: "new" }
    ];
    await A.sb.autoSync("ConductDetail", { type: "replaceConduct", match: { date: "26 May 2026", time: "", conductId: "c1" }, rows: newRows });

    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id)).sort();
    eq(ids, ["10", "11", "3", "4", "5"].sort(), "c1/26-May non-RSI rows swapped; RSI + other conduct/date untouched");
    eq(A.sb.STATE.rev.ConductDetail, revBefore + 1, "single rev bump (one atomic op)");
    eq(A.sb.STATE.dirty.size, 0, "not dirty");
  });

  await test("replaceConduct with empty rows clears the conduct's non-RSI detail", async () => {
    const backend = loadBackend();
    backend.db.seed("ConductDetail", CD_HEADERS, [
      ["1", "26 May 2026", "", "c1", "1101", "Status", "LD"],
      ["2", "26 May 2026", "", "c1", "1103", "RSI", "legacy"]
    ]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    await A.sb.autoSync("ConductDetail", { type: "replaceConduct", match: { date: "26 May 2026", time: "", conductId: "c1" }, rows: [] });
    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id));
    eq(ids, ["2"], "non-RSI rows cleared, RSI kept");
  });

  await test("replaceConduct is idempotent — safe to replay after a reload", async () => {
    const backend = loadBackend();
    backend.db.seed("ConductDetail", CD_HEADERS, [["1", "26 May 2026", "", "c1", "1101", "Status", "LD"]]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    const mode = { type: "replaceConduct", match: { date: "26 May 2026", time: "", conductId: "c1" },
      rows: [{ id: "10", date: "26 May 2026", time: "", conductId: "c1", d4: "1101", type: "Status", reason: "x" }] };
    await A.sb.autoSync("ConductDetail", mode);
    await A.sb.autoSync("ConductDetail", mode);   // replay (what a post-reload retry would do)
    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id));
    eq(ids, ["10"], "replay yields the same single row — no duplicate, no loss");
  });

  // Regression for a bug the string-only mock originally hid (caught on the live
  // sandbox): ConductDetail date/time columns are NOT text-forced, so Sheets
  // stores "01 Jan 2026" as a Date object. readTab reformats it to "dd MMM yyyy"
  // for the client, so the client's match.date is a clean string — but the
  // delete phase reads RAW getValues() (a Date), and String(Date) never equals
  // "01 Jan 2026". Without normalizing the compared cell the same way readTab
  // does, the delete no-ops and every save DUPLICATES rows. The mock seeds a
  // real Date cell + stubs Utilities.formatDate→"01 Jan 2026" to reproduce it.
  await test("replaceConduct matches Date-coerced date cells (Sheets coercion trap)", async () => {
    const backend = loadBackend();
    backend.db.seed("ConductDetail", CD_HEADERS, [
      ["1", new Date(2026, 0, 1), "", "c1", "1101", "Status", "old"]   // date cell is a Date object
    ]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    const mode = { type: "replaceConduct", match: { date: "01 Jan 2026", time: "", conductId: "c1" },
      rows: [{ id: "10", date: "01 Jan 2026", time: "", conductId: "c1", d4: "1101", type: "Status", reason: "new" }] };
    await A.sb.autoSync("ConductDetail", mode);
    await A.sb.autoSync("ConductDetail", mode);   // replay
    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id)).sort();
    eq(ids, ["10"], "Date-coerced original removed; replay idempotent (no dup, no loss)");
  });

  // Same coercion trap, TIME column: a leading-zero clock time ("0730") logged
  // before the WRITE_TEXT_COLS "@"-forcing landed was stored as the NUMBER 730
  // (Sheets ate the zero). The delete phase reads RAW getValues() → 730, and
  // String(730) ("730") never equals the client's pad4Time key "0730", so the
  // delete no-ops and every re-save of a morning conduct DUPLICATES its rows. The
  // normTime reversal left-pads the numeric cell back to "0730" so it clears. The
  // mock seeds a real Number cell to reproduce the coerced state.
  await test("replaceConduct matches numeric-coerced time cells (leading-zero trap)", async () => {
    const backend = loadBackend();
    backend.db.seed("ConductDetail", CD_HEADERS, [
      ["1", "26 May 2026", 730, "c1", "1101", "Status", "old"]   // time cell is the NUMBER 730
    ]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    const mode = { type: "replaceConduct", match: { date: "26 May 2026", time: "0730", conductId: "c1" },
      rows: [{ id: "10", date: "26 May 2026", time: "0730", conductId: "c1", d4: "1101", type: "Status", reason: "new" }] };
    await A.sb.autoSync("ConductDetail", mode);
    await A.sb.autoSync("ConductDetail", mode);   // replay (post-reload retry)
    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id)).sort();
    eq(ids, ["10"], "numeric-coerced original removed; replay idempotent (no dup, no loss)");
  });

  // Post-fix path: a leading-zero time stored as a plain string round-trips and
  // delete-matches cleanly (String(v) === "0730"), so re-saving a morning conduct
  // swaps its rows in place rather than accumulating duplicates.
  await test("replaceConduct matches string leading-zero time cells", async () => {
    const backend = loadBackend();
    backend.db.seed("ConductDetail", CD_HEADERS, [
      ["1", "26 May 2026", "0730", "c1", "1101", "Status", "old"]
    ]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    await A.sb.autoSync("ConductDetail", { type: "replaceConduct", match: { date: "26 May 2026", time: "0730", conductId: "c1" },
      rows: [{ id: "10", date: "26 May 2026", time: "0730", conductId: "c1", d4: "1101", type: "Status", reason: "new" }] });
    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id)).sort();
    eq(ids, ["10"], "string-time original swapped in place — no duplicate");
  });

  // P3-1: the delete phase now collects matching row indices, groups them into
  // contiguous runs, and issues ONE sheet.deleteRows(start,count) per run
  // (bottom-up) instead of one deleteRow() per matching row. These three tests
  // exercise the grouping logic directly against the mock's deleteRow/deleteRows
  // spy counters (test/mocks/google.js), on top of the existing correctness
  // coverage above (which stays untouched — match normalization is unchanged).

  await test("replaceConduct batched delete: non-contiguous matches use multiple deleteRows runs", async () => {
    const backend = loadBackend();
    backend.db.seed("ConductDetail", CD_HEADERS, [
      ["1", "26 May 2026", "", "c1", "1101", "Status", "match-A"],    // matches (run 1)
      ["2", "26 May 2026", "", "c1", "1103", "RSI", "legacy"],        // RSI — preserved, breaks the run
      ["3", "26 May 2026", "", "c1", "1102", "Fallout", "match-B"],   // matches (run 2)
      ["4", "26 May 2026", "", "c2", "1104", "Status", "other-cnd"],  // other conduct — preserved, breaks the run
      ["5", "26 May 2026", "", "c1", "1105", "Status", "match-C"]     // matches (run 3)
    ]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    const newRows = [
      { id: "10", date: "26 May 2026", time: "", conductId: "c1", d4: "1101", type: "Status", reason: "new" },
      { id: "11", date: "26 May 2026", time: "", conductId: "c1", d4: "1199", type: "Fallout", reason: "new" }
    ];
    await A.sb.autoSync("ConductDetail", { type: "replaceConduct", match: { date: "26 May 2026", time: "", conductId: "c1" }, rows: newRows });

    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id)).sort();
    eq(ids, ["10", "11", "2", "4"], "only the 3 matching rows removed; RSI + other-conduct rows survive, new rows appended");
    eq(backend.db.spy.deleteRows, 3, "3 separate contiguous runs → 3 deleteRows calls (one per isolated match)");
    eq(backend.db.spy.deleteRow, 0, "no per-row deleteRow calls — mechanics fully switched to deleteRows");
  });

  await test("replaceConduct batched delete: 30 contiguous matches collapse to ONE deleteRows call", async () => {
    const backend = loadBackend();
    const rows = [["0", "26 May 2026", "", "c1", "1199", "RSI", "legacy"]]; // preceding non-match, preserved
    for (let n = 1; n <= 30; n++) {
      rows.push([String(n), "26 May 2026", "", "c1", "11" + (100 + n), "Status", "match-" + n]);
    }
    rows.push(["31", "26 May 2026", "", "c2", "1150", "Status", "other-cnd"]); // trailing non-match, preserved
    backend.db.seed("ConductDetail", CD_HEADERS, rows);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    await A.sb.autoSync("ConductDetail", {
      type: "replaceConduct", match: { date: "26 May 2026", time: "", conductId: "c1" },
      rows: [{ id: "100", date: "26 May 2026", time: "", conductId: "c1", d4: "1101", type: "Status", reason: "swapped" }]
    });

    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id)).sort();
    eq(ids, ["0", "100", "31"], "the 30-row contiguous block swapped for the single replacement row; bookend rows survive");
    eq(backend.db.spy.deleteRows, 1, "one contiguous block of 30 matches → exactly ONE deleteRows call");
    eq(backend.db.spy.deleteRow, 0, "no per-row deleteRow calls");
  });

  await test("replaceConduct batched delete: idempotent replay of a multi-row batch — no duplicates", async () => {
    const backend = loadBackend();
    const seedRows = [];
    for (let n = 1; n <= 5; n++) {
      seedRows.push([String(n), "26 May 2026", "", "c1", "11" + (100 + n), "Status", "orig-" + n]);
    }
    backend.db.seed("ConductDetail", CD_HEADERS, seedRows);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    const payload = {
      type: "replaceConduct", match: { date: "26 May 2026", time: "", conductId: "c1" },
      rows: [
        { id: "50", date: "26 May 2026", time: "", conductId: "c1", d4: "1101", type: "Status", reason: "a" },
        { id: "51", date: "26 May 2026", time: "", conductId: "c1", d4: "1102", type: "Status", reason: "b" },
        { id: "52", date: "26 May 2026", time: "", conductId: "c1", d4: "1103", type: "Status", reason: "c" }
      ]
    };
    await A.sb.autoSync("ConductDetail", payload);
    await A.sb.autoSync("ConductDetail", payload);   // replay — same batched-delete path a second time

    const ids = backend.db.rowsOf("ConductDetail").map(r => String(r.id)).sort();
    eq(ids, ["50", "51", "52"], "replay of the same batch is idempotent — stable row count, no duplicates");
  });
};
