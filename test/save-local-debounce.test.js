// SYNC_PERF_IMPROVEMENTS_SPEC.md P3-2: saveLocal() coalescing.
//
// Exercises the debounced saveLocal()/saveLocalNow() pair (js/state.js)
// through the REAL frontend sync-core (state/api/sync.js), using the
// upgraded browser mock (test/mocks/browser.js) which now actually records
// setTimeout callbacks (fired only via ctl.flushTimers()) and
// window/document event listeners (fired only via ctl.fireWindowEvent /
// ctl.fireDocumentEvent) instead of silently discarding them.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient, makeLaunchClient } = require("./harness");

// Mirrors js/state.js's internal `STORAGE_KEY` const — not exported (it's a
// top-level `const`, same reason harness.js keeps its own LS_STORAGE_KEY
// duplicate for the launch-bootstrap harness).
const STORAGE_KEY = "cougar-data-v2";

// Wrap a client's localStorage.setItem so tests can count/observe calls
// without touching the mock's shared implementation.
function spyOnSetItem(client) {
  const calls = [];
  const orig = client.sb.localStorage.setItem.bind(client.sb.localStorage);
  client.sb.localStorage.setItem = (k, v) => { calls.push(k); orig(k, v); };
  return calls;
}

module.exports = async function run() {
  suite("state: saveLocal() debounce (P3-2)");

  await test("a burst of 20 saveLocal() calls performs <=2 actual serializations (during + trailing)", () => {
    const backend = loadBackend();
    const A = makeClient(backend);
    const calls = spyOnSetItem(A);

    for (let i = 0; i < 20; i++) {
      A.sb.STATE.roster = [{ id: 1, name: `Edit ${i}` }];
      A.sb.saveLocal();
    }
    eq(calls.filter(k => k === STORAGE_KEY).length, 0,
      "nothing written synchronously — still just one pending trailing timer");

    A.ctl.flushTimers();   // fire the one scheduled trailing flush
    const stored = calls.filter(k => k === STORAGE_KEY).length;
    ok(stored <= 2, `burst of 20 saveLocal() calls performed ${stored} serializations (expected <= 2)`);
    eq(stored, 1, "exactly one trailing flush actually ran");

    const persisted = JSON.parse(A.sb.localStorage.getItem(STORAGE_KEY));
    eq(persisted.roster[0].name, "Edit 19", "the flush persisted the LATEST queued edit, not an earlier one");
  });

  await test("saveLocal() re-arms only once per window — repeated calls before the flush don't add timers", () => {
    const backend = loadBackend();
    const A = makeClient(backend);
    A.sb.STATE.roster = [{ id: 1, name: "first" }];
    A.sb.saveLocal();
    A.sb.STATE.roster = [{ id: 1, name: "second" }];
    A.sb.saveLocal();   // same window — must not schedule a second timer
    A.ctl.flushTimers();   // if a second timer had been scheduled, this only runs pending ones once
    const persisted = JSON.parse(A.sb.localStorage.getItem(STORAGE_KEY));
    eq(persisted.roster[0].name, "second", "single coalesced flush reflects the latest state");
    // A further saveLocal() after the first flush ran must schedule a FRESH
    // timer (proves the timer handle was cleared on flush, not left stale).
    A.sb.STATE.roster = [{ id: 1, name: "third" }];
    A.sb.saveLocal();
    A.ctl.flushTimers();
    eq(JSON.parse(A.sb.localStorage.getItem(STORAGE_KEY)).roster[0].name, "third",
      "saveLocal() after a flush schedules and fires a new trailing flush");
  });

  await test("pagehide mid-burst flushes synchronously; a reload picks up the persisted edit", () => {
    const backend = loadBackend();
    // Seeded so the reload's fire-and-forget background pull has something
    // harmless to resolve against instead of erroring into an unhandled
    // rejection (mirrors test/launch-bootstrap.test.js's seeding).
    backend.db.seed("Roster", ["id", "d4", "name"], [["1", "1101", "Server Name"]]);

    const A = makeClient(backend);
    A.sb.STATE.roster = [{ id: 1, name: "Original" }];
    A.sb.saveLocal();
    A.sb.STATE.roster[0].name = "Edited mid-burst";
    A.sb.saveLocal();   // still just one pending trailing timer, unflushed
    eq(A.sb.localStorage.getItem(STORAGE_KEY), null, "nothing persisted yet — the debounce window hasn't closed");

    A.ctl.fireWindowEvent("pagehide");   // simulate the tab being closed/backgrounded

    const raw = A.sb.localStorage.getItem(STORAGE_KEY);
    ok(raw, "pagehide forced a synchronous flush");
    const cachedState = JSON.parse(raw);
    eq(cachedState.roster[0].name, "Edited mid-burst", "the latest edit reached disk, not a stale one");

    // "Reload" = a fresh launch client whose localStorage starts pre-seeded
    // with exactly what the pagehide flush wrote — proves loadLocal() (run
    // synchronously at the top of bootstrap(), before any network call)
    // round-trips it correctly, not just that setItem fired.
    const reloaded = makeLaunchClient(backend, { cachedState });
    eq(reloaded.sb.STATE.roster[0].name, "Edited mid-burst",
      "reload from the pagehide-flushed cache sees the edit");
  });

  await test("visibilitychange -> hidden also flushes synchronously", () => {
    const backend = loadBackend();
    const A = makeClient(backend);
    A.sb.STATE.roster = [{ id: 1, name: "Backgrounded edit" }];
    A.sb.saveLocal();
    eq(A.sb.localStorage.getItem(STORAGE_KEY), null, "nothing persisted yet");

    A.ctl.fireDocumentEvent("visibilitychange");   // document.visibilityState still "visible" by default
    eq(A.sb.localStorage.getItem(STORAGE_KEY), null,
      "a visibilitychange while still visible must NOT force a flush");

    A.sb.document.visibilityState = "hidden";
    A.ctl.fireDocumentEvent("visibilitychange");
    const raw = A.sb.localStorage.getItem(STORAGE_KEY);
    ok(raw, "visibilitychange -> hidden forced a synchronous flush");
    eq(JSON.parse(raw).roster[0].name, "Backgrounded edit");
  });

  await test("saveLocalNow() persists immediately, no timer/flush needed", () => {
    const backend = loadBackend();
    const A = makeClient(backend);
    A.sb.STATE.roster = [{ id: 1, name: "Immediate" }];
    A.sb.saveLocalNow();
    const raw = A.sb.localStorage.getItem(STORAGE_KEY);
    ok(raw, "saveLocalNow() wrote synchronously without any flushTimers() call");
    eq(JSON.parse(raw).roster[0].name, "Immediate");
  });

  await test("saveLocalNow() cancels a pending debounced timer so it doesn't double-flush later", () => {
    const backend = loadBackend();
    const A = makeClient(backend);
    const calls = spyOnSetItem(A);
    A.sb.STATE.roster = [{ id: 1, name: "pending" }];
    A.sb.saveLocal();               // schedules a trailing timer
    A.sb.STATE.roster = [{ id: 1, name: "flushed now" }];
    A.sb.saveLocalNow();            // flush immediately, cancel the timer
    eq(calls.filter(k => k === STORAGE_KEY).length, 1, "exactly one write so far, from saveLocalNow()");
    A.ctl.flushTimers();            // the cancelled timer must not fire again
    eq(calls.filter(k => k === STORAGE_KEY).length, 1, "no extra write from the (cancelled) original timer");
  });

  await test("forceResync flushes saveLocal() synchronously before it starts discarding local state", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ["id", "d4", "name"], [["1", "1101", "Server Name"]]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    A.sb.STATE.dirty = new Set(["Roster"]);
    A.sb.STATE.roster[0].name = "Unsynced Local Edit";
    A.sb.saveLocal();   // scheduled, not yet flushed

    const events = [];
    const origSetItem = A.sb.localStorage.setItem.bind(A.sb.localStorage);
    A.sb.localStorage.setItem = (k, v) => { if (k === STORAGE_KEY) events.push("setItem"); origSetItem(k, v); };
    const origFetch = A.sb.fetch;
    A.sb.fetch = (...args) => { events.push("fetch"); return origFetch(...args); };

    await A.sb.forceResync();   // mock confirm() defaults to true

    const firstSetItem = events.indexOf("setItem");
    const firstFetch = events.indexOf("fetch");
    ok(firstSetItem !== -1, "the debounced edit was flushed to disk at some point");
    ok(firstFetch !== -1, "forceResync did perform its authoritative pull");
    ok(firstSetItem < firstFetch,
      "saveLocal() was flushed synchronously BEFORE forceResync's pull started replacing local state");
  });

  // BACKEND_MIGRATION_REVIEW.md §4.6 item 3: signOut USED to flush the debounced
  // cache to disk so the next launch on this device could pick it up. That is
  // exactly the wrong behaviour at a handover boundary — the next person to open
  // the browser would inherit a plaintext mirror of the company's medical data.
  // It now wipes instead, and drops the offline grant with it.
  await test("signOut wipes the cached data and the offline grant, rather than flushing them to disk", async () => {
    const backend = loadBackend();
    const A = makeClient(backend);
    A.sb.STATE.roster = [{ id: 1, name: "Cached Before Signout" }];
    A.sb.saveLocalNow();   // a real, persisted cache to sign out on top of
    ok(A.sb.localStorage.getItem(STORAGE_KEY), "precondition: the cache is on disk");

    await A.sb.signOut();   // mock confirm() -> true

    eq(A.sb.localStorage.getItem(STORAGE_KEY), null, "the cached data was deleted, not persisted");
    eq(A.sb.localStorage.getItem("braves-offline-grant"), null,
      "the offline grant went with it — signing back in is an explicit opt-in again");
  });

  // The other half of the same change: with no grant, ordinary edits must not
  // repopulate the cache. Otherwise the wipe is decorative — the next saveLocal()
  // would put everything straight back.
  await test("saveLocal() writes nothing while this device holds no offline grant", () => {
    const backend = loadBackend();
    const A = makeClient(backend, { noOfflineGrant: true });
    A.sb.STATE.roster = [{ id: 1, name: "Should Not Persist" }];
    A.sb.saveLocalNow();
    eq(A.sb.localStorage.getItem(STORAGE_KEY), null, "no grant → no on-disk copy");

    A.sb.grantOffline(7);
    A.sb.saveLocalNow();
    ok(A.sb.localStorage.getItem(STORAGE_KEY), "granting turns caching back on");

    // Expiry is enforced client-side with no server contact — the lost-device case.
    A.sb.localStorage.setItem("braves-offline-grant", JSON.stringify({
      deviceId: "d", email: "", grantedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z"
    }));
    A.sb.STATE.roster = [{ id: 1, name: "After Expiry" }];
    A.sb.saveLocalNow();
    eq(A.sb.localStorage.getItem(STORAGE_KEY), null,
      "a lapsed grant both blocks the write and clears what was already there");
  });
};
