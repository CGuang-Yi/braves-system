// P1-1 (SYNC_PERF_IMPROVEMENTS_SPEC.md §3): bootstrap()'s warm-vs-cold launch
// decision, exercised end to end through the REAL js/main.js + js/sync.js +
// the real backend — not just autoSyncOnLaunch() in isolation (that's covered
// in test/sync.test.js's "sync: queue + launch" suites). This file guards the
// orchestration in main.js itself: does a warm cache actually render before
// any network call, does it make exactly one revCheck and nothing else when
// nothing changed, and does a cold cache still block on a full pull like
// before.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient, makeLaunchClient, flushMicrotasks } = require("./harness");

// A minimal but complete cached-STATE snapshot (the shape saveLocal() writes /
// loadLocal() reads — see js/state.js). `rev` is filled in per-test from a
// real pull so it matches the backend's actual baseline.
function emptyCache(roster, rev) {
  return {
    roster, medical: [], attendance: [], ippt: [], rm: [], soc: [], polar: [],
    conductDetail: [], appointments: [], leave: [], msk: [], conducts: [],
    config: {}, vocfit: [], platoons: [], rev
  };
}

module.exports = async function run() {
  suite("launch bootstrap: warm cache (P1-1 acceptance)");

  await test("warm cache + no server changes → renders before any network call, then exactly one revCheck and zero read/readAll", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ["id", "d4", "name"], [["1", "1101", "A Recruit"]]);

    // Prime a normal client to learn the real baseline revs and roster shape,
    // then snapshot them (deep-cloned — NOT a live reference, since nothing
    // else touches this backend before the warm client boots, but cloning is
    // the honest simulation of "what loadLocal() would have parsed off disk").
    const primer = makeClient(backend);
    await primer.sb.API.pullAll();
    const cachedState = emptyCache(
      JSON.parse(JSON.stringify(primer.sb.STATE.roster)),
      JSON.parse(JSON.stringify(primer.sb.STATE.rev))
    );

    const warm = makeLaunchClient(backend, { cachedState });
    // By the time makeLaunchClient() returns, bootstrap()'s synchronous prefix
    // (loadLocal → warm-cache check → applyRoleUI → render) has already run —
    // vm.runInContext doesn't return until that synchronous portion finishes,
    // and the first `await` inside it is INSIDE autoSyncOnLaunch, past the
    // render() call. So asserting here (before any flush) proves render fired
    // strictly before autoSyncOnLaunch's revCheck fetch was even dispatched.
    eq(warm.renderCalls[0], 0, "render() fired while fetchSpy was still empty — before any network call, not just before any response");

    await flushMicrotasks();
    const actions = warm.fetchSpy.map(r => r.action);
    eq(actions, ["revCheck"], "exactly one revCheck request and nothing else");
    ok(!actions.includes("read"), "no partial read");
    ok(!actions.includes("readAll"), "no full readAll");
  });

  await test("warm cache + one changed tab → only that tab is fetched (no readAll, no other tabs)", async () => {
    const MED_HEADERS = ["id", "d4", "date", "reason", "location", "status", "startDate", "endDate"];
    const med = (id, reason) => ({ id, d4: "11" + id, date: "", reason, location: "", status: "", startDate: "", endDate: "" });
    const backend = loadBackend();
    backend.db.seed("Roster", ["id", "d4", "name"], [["1", "1101", "A Recruit"]]);
    backend.db.seed("Medical", MED_HEADERS, []);

    const primer = makeClient(backend);
    await primer.sb.API.pullAll();
    const cachedState = emptyCache(
      JSON.parse(JSON.stringify(primer.sb.STATE.roster)),
      JSON.parse(JSON.stringify(primer.sb.STATE.rev))
    );

    // A second device changes Medical AFTER the cache snapshot was taken.
    const B = makeClient(backend);
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(9, "B-fresh") });

    const warm = makeLaunchClient(backend, { cachedState });
    eq(warm.renderCalls[0], 0, "instant render from cache still happens first");
    await flushMicrotasks();

    const actions = warm.fetchSpy.map(r => r.action);
    ok(actions.includes("revCheck"), "polled revCheck");
    ok(!actions.includes("readAll"), "did not fall back to a full readAll");
    const reads = warm.fetchSpy.filter(r => r.action === "read");
    eq(reads.length, 1, "exactly one partial read");
    eq(reads[0].tab, "Medical", "the ONE partial read was for the changed tab only");
    ok(warm.sb.STATE.medical.find(r => String(r.id) === "9"), "the changed tab's new row landed in STATE");
  });

  // Follow-up from review: autoSyncOnLaunch's catch originally only updated
  // the sync pill on an AuthError, unlike pullAndRender's catch (which calls
  // handleAuthFailure → bounces to the login screen). An expired/revoked
  // token on the warm-cache path must not just sit there showing "not
  // authenticated" over stale cached data — the user needs to be returned to
  // the login screen exactly like the cold path already does.
  await test("warm cache + backend rejects the token → bounces to the login screen (handleAuthFailure fired)", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ["id", "d4", "name"], [["1", "1101", "A Recruit"]]);

    const primer = makeClient(backend);
    await primer.sb.API.pullAll();
    const cachedState = emptyCache(
      JSON.parse(JSON.stringify(primer.sb.STATE.roster)),
      JSON.parse(JSON.stringify(primer.sb.STATE.rev))
    );

    // A token the backend has never seen (loadBackend only seeds VALID_TOKEN)
    // → revCheck's auth lookup fails → 401 → AuthError, same as a genuinely
    // expired/revoked session.
    const warm = makeLaunchClient(backend, { cachedState, authToken: "revoked-or-expired-token" });
    eq(warm.renderCalls[0], 0, "still renders the stale cache instantly before finding out the token is bad");
    await flushMicrotasks();

    ok(warm.fetchSpy.map(r => r.action).includes("revCheck"), "attempted the revCheck");
    eq(warm.sb.STATE.authToken, "", "handleAuthFailure cleared the session (clearSession → authToken reset)");
    const overlay = warm.sb.document.getElementById("login-overlay");
    ok(!overlay.classList.contains("hidden"), "login overlay is shown (showLogin ran) — bounced back to login, not left showing stale data under a 'not authenticated' pill");
  });

  suite("launch bootstrap: cold cache (P1-1 acceptance — unchanged behaviour)");

  await test("no cache at all → blocking full pull, same as before P1-1", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ["id", "d4", "name"], [["1", "1101", "A Recruit"]]);

    const cold = makeLaunchClient(backend, {});   // no cachedState → loadLocal() gets nothing
    await flushMicrotasks();

    const actions = cold.fetchSpy.map(r => r.action);
    eq(actions, ["readAll"], "cold cache does exactly the old blocking full pull — no revCheck involved");
    eq(cold.sb.STATE.roster.length, 1, "roster populated from the full pull");
    ok(cold.renderCalls.length >= 1, "render() still happens once data arrives");
  });

  await test("cache present but no rev baseline (old cache shape) → treated as cold, not warm", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ["id", "d4", "name"], [["1", "1101", "A Recruit"]]);

    // Roster rows present, but rev is empty — e.g. a cache written by an
    // older app version before STATE.rev existed. There's nothing for
    // autoSyncOnLaunch's revCheck to diff against, so this must fall through
    // to the blocking full pull exactly like a truly empty cache.
    const cachedState = emptyCache([{ id: "1", d4: "1101", name: "Stale Cached Name" }], {});

    const client = makeLaunchClient(backend, { cachedState });
    await flushMicrotasks();

    const actions = client.fetchSpy.map(r => r.action);
    eq(actions, ["readAll"], "no rev baseline → cold-path full pull, not the warm incremental path");
  });
};
