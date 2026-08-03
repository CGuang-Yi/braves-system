// Privacy hardening from docs/BACKEND_MIGRATION_REVIEW.md §4.6 — the "reduce
// the risk without migrating anywhere" items:
//
//   item 3 — the offline data grant (§4.7.5a): caching is opt-in, expiring and
//            wiped, so a device stops holding everything forever
//   item 4 — ORD deprovisioning (§4.7.7): the missing LINK from a departed
//            roster status to the account-removal mechanism that already existed
//   item 5 — a real KDF instead of one round of SHA-256, and a 7-day session
//   item 6 — a retention policy for departed personnel (§4.5)
//
// The offline-grant expiry is the piece worth testing hardest: it is enforced
// entirely client-side, with no server contact, because the device that matters
// most (lost, or belonging to someone who has left) is exactly the one that
// never comes back online.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend } = require("./harness");

// state.js in isolation, with a localStorage that actually stores (state.test.js
// stubs a null one; the grant logic is all reads-after-writes so it needs real
// storage). No DOM: state.js typeof-guards its window/document listeners.
function loadState(seed) {
  const store = new Map(Object.entries(seed || {}));
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    }
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "state.js"), "utf8"), ctx, { filename: "state.js" });
  target.evalIn = expr => vm.runInContext(expr, ctx);
  target.store = store;
  return target;
}

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();

module.exports = async function run() {

  // ── §4.6 item 3 / §4.7.5a — the offline grant ──────────────────

  suite("offline grant: what a stored grant is worth (pure)");

  await test("no grant, expired grant and revoked grant are all 'not active'", () => {
    const S = loadState();
    const now = Date.parse("2026-08-04T00:00:00Z");
    eq(S.offlineGrantStatus(null, now, "").state, "off", "absent");
    eq(S.offlineGrantStatus({}, now, "").state, "off", "malformed (no expiresAt)");
    eq(S.offlineGrantStatus({ expiresAt: iso(now - DAY) }, now, "").state, "expired", "lapsed yesterday");
    eq(S.offlineGrantStatus({ expiresAt: iso(now + DAY), revoked: true }, now, "").state, "revoked",
       "an admin revocation the device has already learned about");
  });

  await test("an active grant reports the days left, rounded up", () => {
    const S = loadState();
    const now = Date.parse("2026-08-04T00:00:00Z");
    const st = S.offlineGrantStatus({ expiresAt: iso(now + 3 * DAY + 1000) }, now, "");
    eq(st.state, "active", "still live");
    eq(st.daysLeft, 4, "3 days and a bit reads as 4 — never rounds a grant shorter than it is");
  });

  // The handover case: two people sharing one phone. Without this, the second
  // person inherits the first person's cached copy under their own login.
  await test("a grant issued to a different account does not carry over to this one", () => {
    const S = loadState();
    const now = Date.parse("2026-08-04T00:00:00Z");
    const g = { expiresAt: iso(now + DAY), email: "pc1@unit.mil" };
    eq(S.offlineGrantStatus(g, now, "pc1@unit.mil").state, "active", "the account it was issued to");
    eq(S.offlineGrantStatus(g, now, "pc2@unit.mil").state, "off", "anyone else");
  });

  await test("grantOffline clamps to the maximum, and expiry is stamped client-side", () => {
    const S = loadState();
    const g = S.grantOffline(999);
    eq(g.days, S.evalIn("OFFLINE_GRANT_MAX_DAYS"), "a 999-day request is capped, not honoured");
    ok(S.store.has("braves-offline-grant"), "persisted on the device, not only in memory");
    ok(new Date(g.expiresAt).getTime() > Date.now(), "carries a future expiry");
    ok(g.deviceId && g.deviceId.length > 4, "an opaque device id was minted");
  });

  await test("the device id is opaque and stable, not a device name", () => {
    const S = loadState();
    const a = S.offlineDeviceId();
    const b = S.offlineDeviceId();
    eq(a, b, "stable across calls");
    ok(!/iphone|android|mac|windows/i.test(a), "carries no identifying detail — it is just a random id");
  });

  suite("offline grant: enforcement before the first render");

  await test("no grant + a cached copy from a previous session → the copy is deleted", () => {
    // No authToken: a signed-out device holding cached data is precisely the
    // case that must not be grandfathered into a grant.
    const S = loadState({ "cougar-data-v2": JSON.stringify({ roster: [{ id: "1101" }] }) });
    eq(S.enforceOfflineGrant(), "wiped", "verdict");
    eq(S.localStorage.getItem("cougar-data-v2"), null, "gone before loadLocal() could read it");
  });

  await test("an expired grant wipes; nothing cached is a silent no-op", () => {
    const now = Date.now();
    const S = loadState({
      "cougar-data-v2": JSON.stringify({ roster: [] }),
      "braves-offline-grant": JSON.stringify({ expiresAt: iso(now - DAY), email: "" })
    });
    eq(S.enforceOfflineGrant(), "wiped", "lapsed grant → wipe, with no network involved");

    const S2 = loadState({ "braves-offline-grant": JSON.stringify({ expiresAt: iso(now - DAY) }) });
    eq(S2.enforceOfflineGrant(), "none", "nothing cached → nothing to do");
  });

  await test("a live grant leaves the cache alone", () => {
    const S = loadState({
      "cougar-data-v2": JSON.stringify({ roster: [{ id: "1101" }] }),
      "braves-offline-grant": JSON.stringify({ expiresAt: iso(Date.now() + 3 * DAY), email: "" })
    });
    eq(S.enforceOfflineGrant(), "ok", "verdict");
    ok(S.localStorage.getItem("cougar-data-v2"), "cache survives");
  });

  // The trap §4.7.5a names explicitly: a wipe that discards unpushed edits turns
  // a privacy feature into data loss, which is how such features get switched
  // off permanently.
  await test("expiry does NOT wipe while this device still has unpushed edits", () => {
    const S = loadState({
      "cougar-data-v2": JSON.stringify({ roster: [{ id: "1101" }] }),
      "cougar-dirty-tabs": JSON.stringify(["Medical"]),
      "braves-offline-grant": JSON.stringify({ expiresAt: iso(Date.now() - DAY), email: "" })
    });
    eq(S.enforceOfflineGrant(), "held", "deferred, and says so rather than silently keeping the data");
    ok(S.localStorage.getItem("cougar-data-v2"), "the unsynced work is still there to be pushed");
  });

  // Upgrade path: devices that cached under the old always-on behaviour must not
  // be emptied by a deploy, but must not stay unbounded either.
  await test("an existing cache on a signed-in device is converted into an expiring grant, not deleted", () => {
    const S = loadState({
      "cougar-data-v2": JSON.stringify({ roster: [{ id: "1101" }] }),
      "cougar-auth": "sometoken"
    });
    eq(S.enforceOfflineGrant(), "auto-granted", "verdict");
    ok(S.localStorage.getItem("cougar-data-v2"), "the commander's data is still on the device");
    const g = JSON.parse(S.localStorage.getItem("braves-offline-grant"));
    ok(g.auto, "flagged as auto-issued so the UI can say so");
    ok(new Date(g.expiresAt).getTime() > Date.now(), "and it is bounded from now on");
  });

  suite("offline grant: the server side is visibility, not enforcement");

  const grantCtx = (email, role) => ({ email: email, personId: "0001", role: role || "commander" });

  await test("registering takes the email from the token, never from the request body", () => {
    const b = loadBackend();
    const r = b.handleRegisterOfflineGrant(
      { deviceId: "dev-1", expiresAt: iso(Date.now() + 3 * DAY), email: "someone.else@unit.mil" },
      grantCtx("pc1@unit.mil"));
    ok(r.ok, "registered");
    const listed = b.handleListOfflineGrants({}, grantCtx("admin@unit.mil", "admin")).grants;
    eq(listed.length, 1, "one device");
    eq(listed[0].email, "pc1@unit.mil", "attributed to the session, not the body");
  });

  await test("a request for longer than the maximum is clamped", () => {
    const b = loadBackend();
    const r = b.handleRegisterOfflineGrant(
      { deviceId: "dev-1", expiresAt: iso(Date.now() + 400 * DAY) }, grantCtx("pc1@unit.mil"));
    ok(new Date(r.expiresAt).getTime() <= Date.now() + 15 * DAY, "clamped to the 14-day ceiling: " + r.expiresAt);
  });

  await test("an admin revocation is only learned on the device's next check-in", () => {
    const b = loadBackend();
    b.handleRegisterOfflineGrant({ deviceId: "dev-1", expiresAt: iso(Date.now() + 3 * DAY) }, grantCtx("pc1@unit.mil"));
    eq(b.handleCheckOfflineGrant({ deviceId: "dev-1" }, grantCtx("pc1@unit.mil")).revoked, false, "before");

    const admin = grantCtx("admin@unit.mil", "admin");
    ok(b.handleRevokeOfflineGrant({ deviceId: "dev-1" }, admin).ok, "admin revoked it");

    // This is the honest state: the record says revoked, the phone may still
    // hold the data, and the admin list must not call that "wiped".
    const listed = b.handleListOfflineGrants({}, admin).grants;
    eq(listed[0].state, "revoked", "shown as revoked — i.e. pending the device's check-in");
    eq(b.handleCheckOfflineGrant({ deviceId: "dev-1" }, grantCtx("pc1@unit.mil")).revoked, true,
       "the device finds out the next time it connects, and only then");
  });

  await test("a non-admin cannot revoke someone else's device, but can revoke their own", () => {
    const b = loadBackend();
    b.handleRegisterOfflineGrant({ deviceId: "dev-1", expiresAt: iso(Date.now() + DAY) }, grantCtx("pc1@unit.mil"));
    ok(b.handleRevokeOfflineGrant({ deviceId: "dev-1" }, grantCtx("pc2@unit.mil")).error, "someone else's: refused");
    ok(b.handleRevokeOfflineGrant({ deviceId: "dev-1" }, grantCtx("pc1@unit.mil")).ok, "their own: allowed");
  });

  await test("listing is admin-only, and an unknown device is not treated as revoked", () => {
    const b = loadBackend();
    ok(b.handleListOfflineGrants({}, grantCtx("pc1@unit.mil")).error, "commander refused the device list");
    // Registration is best-effort, so a missing server record means "we never
    // heard about it", not "revoke". Inferring revocation would wipe a device
    // because of one dropped request.
    eq(b.handleCheckOfflineGrant({ deviceId: "never-seen" }, grantCtx("pc1@unit.mil")).revoked, false,
       "unknown device is not revoked");
  });

  // ── §4.6 item 5 — password KDF + session lifetime ──────────────

  suite("auth: PBKDF2 replaces the single-round SHA-256");

  await test("new hashes are PBKDF2 and carry their own iteration count", () => {
    const b = loadBackend();
    const salt = b.generateSalt();
    const h = b.hashPassword("hunter22", salt);
    ok(h.indexOf("pbkdf2$sha256$") === 0, "labelled with its scheme: " + h.slice(0, 20));
    eq(h.split("$")[2], String(b.PBKDF2_ITERATIONS), "and its cost, so the cost can be changed later");
    ok(b.verifyPassword("hunter22", salt, h), "verifies");
    ok(!b.verifyPassword("hunter23", salt, h), "and rejects a wrong password");
  });

  await test("a legacy SHA-256 hash still verifies, and is flagged for upgrade", () => {
    const b = loadBackend();
    const salt = b.generateSalt();
    const legacy = b.hashPasswordLegacySha256_("hunter22", salt);
    ok(b.verifyPassword("hunter22", salt, legacy), "an existing account can still log in");
    ok(b.passwordHashNeedsUpgrade(legacy), "but is due a rewrite");
    ok(!b.passwordHashNeedsUpgrade(b.hashPassword("hunter22", salt)), "a current hash is not");
  });

  await test("logging in rewrites a legacy hash in place — no reset, nothing for the user to do", () => {
    const b = loadBackend();
    const salt = b.generateSalt();
    b.db.seed("Accounts", ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt", "caps"],
      [["pc1@unit.mil", "0002", "commander", b.hashPasswordLegacySha256_("hunter22", salt), salt, "", "", ""]]);

    ok(b.handleLogin({ email: "pc1@unit.mil", password: "hunter22" }).ok, "first login on the old hash works");
    const row = b.db.rowsOf("Accounts")[0];
    ok(row.passwordHash.indexOf("pbkdf2$sha256$") === 0, "the stored hash was upgraded during that login");
    ok(row.salt !== salt, "and re-salted");
    ok(b.handleLogin({ email: "pc1@unit.mil", password: "hunter22" }).ok, "the same password still logs in afterwards");
    ok(!b.handleLogin({ email: "pc1@unit.mil", password: "wrong" }).ok, "a wrong one still does not");
  });

  await test("sessions expire in 7 days, not 30", () => {
    const b = loadBackend();
    eq(b.SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000, "the token, not the account row, is what bounds access");
    ok(b.isTokenExpired({ issuedAt: iso(Date.now() - 8 * DAY) }), "an 8-day-old token is dead");
    ok(!b.isTokenExpired({ issuedAt: iso(Date.now() - 6 * DAY) }), "a 6-day-old one is not");
  });
};
