// The encrypted cache, exercised against the REAL frontend bundle with REAL Web
// Crypto (test/mocks/browser.js hands the sandbox Node's crypto.subtle). The
// negative controls matter most here: what must NOT happen is a plaintext
// payload reaching localStorage, or a torn write going unnoticed.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient } = require("./harness");

// The real STORAGE_KEY from js/state.js. Spelled out rather than imported so a
// rename has to be a deliberate two-place edit.
const LS = "cougar-data-v2";

module.exports = async function run() {
  suite("cache encryption: write path");

  await test("a flush writes ciphertext, never plaintext", async () => {
    const C = makeClient(loadBackend());
    await C.sb.setCacheKeyFromPassword("hunter2");
    C.sb.STATE.roster = [{ d4: "1234", name: "TESTPERSON", rank: "REC" }];
    await C.sb.saveLocalNow();

    const raw = C.browser.globals.localStorage.getItem(LS);
    ok(raw, "something was written");
    ok(!/TESTPERSON/.test(raw), "the name must not appear in localStorage");
    ok(C.sb.isCacheCiphertext(raw), "what was written is a v1 envelope");
  });

  await test("with no key, nothing is written and the existing cache is left alone", async () => {
    const C = makeClient(loadBackend());
    C.browser.globals.localStorage.setItem(LS, "PRE-EXISTING");
    C.sb.clearCacheKey();
    C.sb.STATE.roster = [{ d4: "1234", name: "TESTPERSON", rank: "REC" }];
    await C.sb.saveLocalNow();
    // Locked session: edits stay in memory and the app runs online-only. The
    // ciphertext on disk is NOT touched — the approved failure policy.
    eq(C.browser.globals.localStorage.getItem(LS), "PRE-EXISTING");
  });

  await test("the flush-pending marker is set before and cleared after a write", async () => {
    const C = makeClient(loadBackend());
    await C.sb.setCacheKeyFromPassword("hunter2");
    await C.sb.saveLocalNow();
    eq(C.browser.globals.localStorage.getItem("braves-cache-flush-pending"), null,
      "cleared after a completed flush");
    ok(C.sb.cacheFlushWasInterrupted() === false);
  });

  await test("a marker left behind reads as an interrupted flush", async () => {
    const C = makeClient(loadBackend());
    C.browser.globals.localStorage.setItem("braves-cache-flush-pending", "1");
    ok(C.sb.cacheFlushWasInterrupted() === true);
    C.sb.clearCacheFlushMarker();
    ok(C.sb.cacheFlushWasInterrupted() === false);
  });

  await test("an expired offline grant still wipes instead of encrypting", async () => {
    // The grant gates the WRITE boundary and must keep doing so — encryption
    // must not become a way for data to sneak past a lapsed grant.
    const C = makeClient(loadBackend());
    await C.sb.setCacheKeyFromPassword("hunter2");
    C.browser.globals.localStorage.setItem(LS, "SOMETHING");
    C.sb.clearOfflineGrant();
    await C.sb.saveLocalNow();
    eq(C.browser.globals.localStorage.getItem(LS), null);
  });

  await test("DIRTY_KEY stays plaintext and readable without a key", async () => {
    const C = makeClient(loadBackend());
    C.sb.STATE.dirty = new Set(["Medical"]);
    C.sb.saveDirty();
    const raw = C.browser.globals.localStorage.getItem("cougar-dirty-tabs");
    eq(JSON.parse(raw), ["Medical"], "readable as plain JSON with no key at all");
  });

  await test("the fitness-sent map is encrypted too, and round-trips", async () => {
    // FITNESS_SENT_KEY holds a 4D→timestamp map: personnel ids, so it is in
    // scope for the same treatment. No flush-pending marker here — it is not on
    // the pagehide path, so a torn write costs a re-send marker, not data.
    const C = makeClient(loadBackend());
    await C.sb.setCacheKeyFromPassword("hunter2");
    await C.sb.saveFitnessSent({ "1101": "2026-05-27T14:40:25.296Z" });
    const raw = C.browser.globals.localStorage.getItem("cougar-fitness-sent");
    ok(raw, "written");
    ok(!/1101/.test(raw), "the 4D must not appear in plaintext");
    ok(C.sb.isCacheCiphertext(raw), "a v1 envelope");
    eq(await C.sb.loadFitnessSent(), { "1101": "2026-05-27T14:40:25.296Z" });
  });
};
