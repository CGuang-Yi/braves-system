// The encrypted cache, exercised against the REAL frontend bundle with REAL Web
// Crypto (test/mocks/browser.js hands the sandbox Node's crypto.subtle). The
// negative controls matter most here: what must NOT happen is a plaintext
// payload reaching localStorage, or a torn write going unnoticed.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient, seedCache } = require("./harness");

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

  suite("cache encryption: read path and migration");

  const WARM = { roster: [{ d4: "1234", name: "TESTPERSON", rank: "REC" }], rev: { Roster: 5 } };

  // makeClient() has no cachedState option (that lives on makeLaunchClient), and
  // these cases want loadLocal() driven explicitly rather than via bootstrap —
  // so seed the two storage slots by hand.
  function warm(C, seeded) {
    C.browser.globals.localStorage.setItem(LS, seeded.envelope);
    C.browser.globals.sessionStorage.setItem("braves-cache-key", seeded.keyB64);
    return C;
  }

  await test("a warm encrypted cache decrypts into STATE", async () => {
    const seeded = await seedCache(WARM);
    const C = warm(makeClient(loadBackend()), seeded);
    await C.sb.loadLocal();
    eq(C.sb.STATE.roster.length, 1);
    eq(C.sb.STATE.roster[0].name, "TESTPERSON");
  });

  await test("a locked session leaves STATE empty rather than throwing", async () => {
    const seeded = await seedCache(WARM);
    const C = warm(makeClient(loadBackend()), seeded);
    C.sb.clearCacheKey();
    await C.sb.loadLocal();
    eq(C.sb.STATE.roster.length, 0, "nothing loaded");
    ok(C.browser.globals.localStorage.getItem(LS), "ciphertext RETAINED for the next attempt");
  });

  await test("a wrong key leaves STATE empty and retains the ciphertext", async () => {
    const seeded = await seedCache(WARM);
    const C = warm(makeClient(loadBackend()), seeded);
    await C.sb.setCacheKeyFromPassword("definitely-not-the-seeded-key");
    await C.sb.loadLocal();
    eq(C.sb.STATE.roster.length, 0);
    ok(C.browser.globals.localStorage.getItem(LS), "never wiped on a bad password");
  });

  await test("a legacy plaintext cache is wiped, not adopted", async () => {
    const C = makeClient(loadBackend());
    C.browser.globals.localStorage.setItem(LS, JSON.stringify(WARM));   // legacy plaintext
    await C.sb.loadLocal();
    eq(C.sb.STATE.roster.length, 0, "not loaded");
    eq(C.browser.globals.localStorage.getItem(LS), null, "wiped, so the next launch full-pulls");
  });

  await test("a legacy plaintext cache is HELD when the device has unpushed edits", async () => {
    // Discarding unsynced work to enforce a privacy feature is how privacy
    // features get switched off permanently — same rule enforceOfflineGrant uses.
    const C = makeClient(loadBackend());
    C.browser.globals.localStorage.setItem(LS, JSON.stringify(WARM));   // legacy plaintext
    C.sb.STATE.dirty = new Set(["Medical"]);
    await C.sb.loadLocal();
    eq(C.sb.STATE.roster.length, 1, "loaded, so the dirty rows are not stranded");
    ok(C.browser.globals.localStorage.getItem(LS), "retained until the edits drain");
  });

  suite("cache encryption: key lifecycle");

  await test("sign-out clears the key so the next account cannot inherit it", async () => {
    const C = makeClient(loadBackend());
    await C.sb.setCacheKeyFromPassword("hunter2");
    ok(C.browser.globals.sessionStorage.getItem("braves-cache-key"), "key present");
    C.sb.clearCacheKey();
    eq(C.browser.globals.sessionStorage.getItem("braves-cache-key"), null);
    eq(await C.sb.getCacheKey(), null);
  });

  await test("a re-derive from a new password produces a different key", async () => {
    const C = makeClient(loadBackend());
    await C.sb.setCacheKeyFromPassword("old-password");
    const before = C.browser.globals.sessionStorage.getItem("braves-cache-key");
    await C.sb.setCacheKeyFromPassword("new-password");
    const after = C.browser.globals.sessionStorage.getItem("braves-cache-key");
    ok(before !== after);
  });

  await test("the salt is stable across derives, so the same password re-derives the same key", async () => {
    const C = makeClient(loadBackend());
    await C.sb.setCacheKeyFromPassword("hunter2");
    const salt = C.browser.globals.localStorage.getItem("braves-cache-salt");
    const a = C.browser.globals.sessionStorage.getItem("braves-cache-key");
    C.sb.clearCacheKey();
    await C.sb.setCacheKeyFromPassword("hunter2");
    eq(C.browser.globals.localStorage.getItem("braves-cache-salt"), salt, "salt unchanged");
    eq(C.browser.globals.sessionStorage.getItem("braves-cache-key"), a, "same key");
  });
};
