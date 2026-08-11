// Pure crypto primitives for the encrypted localStorage cache. Loaded in
// isolation the way test/calc.test.js loads js/calc.js — this file must not
// reference any other global in the bundle, and this test is what enforces that.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "cache-crypto.js"), "utf8");
  // A REAL context, not a permissive Proxy: an accidental reference to STATE or
  // document must blow up here rather than silently working in the browser.
  // The typed-array/encoder constructors are the OUTER realm's on purpose, so
  // the buffers handed to Node's crypto.subtle are ones it recognises.
  const ctx = vm.createContext({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Promise, Error, TypeError,
    Uint8Array, ArrayBuffer,
    crypto: globalThis.crypto,          // Node 18+ exposes crypto.subtle
    TextEncoder, TextDecoder, btoa, atob
  });
  vm.runInContext(src, ctx, { filename: "cache-crypto.js" });
  return expr => vm.runInContext(expr, ctx);
}

module.exports = async function run() {
  suite("cache-crypto");

  // One shared salt + exported key. Every case re-loads the module into a fresh
  // context and re-imports this key, which is also a cheap check that nothing is
  // being smuggled through module-level state.
  const boot = load();
  const SALT = boot(`newCacheSalt()`);
  const keyB64 = await boot(
    `(async () => exportCacheKey(await deriveCacheKey("hunter2", ${JSON.stringify(SALT)})))()`
  );

  // Evaluate an expression with `k` bound to the key we already hold.
  const withKey = expr => {
    const r = load();
    return r(`(async () => { const k = await importCacheKey(${JSON.stringify(keyB64)}); return ${expr}; })()`);
  };

  await test("round-trips a payload", async () => {
    const env = await withKey(`encryptCache(k, '{"roster":[1,2,3]}')`);
    const out = await withKey(`decryptCache(k, ${JSON.stringify(env)})`);
    eq(out, '{"roster":[1,2,3]}');
  });

  await test("the envelope is {v,iv,ct} JSON", async () => {
    const env = await withKey(`encryptCache(k, "hello")`);
    const parsed = JSON.parse(env);
    eq(parsed.v, 1);
    ok(typeof parsed.iv === "string" && parsed.iv.length > 0);
    ok(typeof parsed.ct === "string" && parsed.ct.length > 0);
    ok(!/hello/.test(env), "plaintext must not survive in the envelope");
  });

  await test("a fresh IV per call — same plaintext encrypts differently", async () => {
    const a = await withKey(`encryptCache(k, "same")`);
    const b = await withKey(`encryptCache(k, "same")`);
    ok(a !== b);
  });

  await test("a wrong key yields null, not a throw", async () => {
    const env = await withKey(`encryptCache(k, "secret")`);
    const other = load();
    const wrong = await other(`(async () => {
      const s = newCacheSalt();
      const k2 = await deriveCacheKey("wrong-password", s);
      return decryptCache(k2, ${JSON.stringify(env)});
    })()`);
    eq(wrong, null);
  });

  await test("a tampered ciphertext yields null (AES-GCM auth tag)", async () => {
    const env = await withKey(`encryptCache(k, "secret")`);
    const parsed = JSON.parse(env);
    // Flip one base64 character in the ciphertext.
    const c = parsed.ct[5] === "A" ? "B" : "A";
    parsed.ct = parsed.ct.slice(0, 5) + c + parsed.ct.slice(6);
    const out = await withKey(`decryptCache(k, ${JSON.stringify(JSON.stringify(parsed))})`);
    eq(out, null);
  });

  await test("malformed and unknown-version envelopes yield null", async () => {
    for (const bad of ["not json", "{}", '{"v":2,"iv":"AA","ct":"AA"}', '{"v":1,"iv":"AA"}', ""]) {
      const out = await withKey(`decryptCache(k, ${JSON.stringify(bad)})`);
      eq(out, null, `"${bad}" should decrypt to null`);
    }
  });

  await test("deriveCacheKey is deterministic per (password, salt) and differs across salts", async () => {
    const r = load();
    const s1 = r(`newCacheSalt()`), s2 = r(`newCacheSalt()`);
    ok(s1 !== s2, "salts are random");
    const a = await r(`(async () => exportCacheKey(await deriveCacheKey("pw", ${JSON.stringify(s1)})))()`);
    const b = await r(`(async () => exportCacheKey(await deriveCacheKey("pw", ${JSON.stringify(s1)})))()`);
    const c = await r(`(async () => exportCacheKey(await deriveCacheKey("pw", ${JSON.stringify(s2)})))()`);
    eq(a, b, "same password + same salt → same key");
    ok(a !== c, "different salt → different key");
  });

  await test("isCacheCiphertext distinguishes an envelope from legacy plaintext", async () => {
    const env = await withKey(`encryptCache(k, "x")`);
    const r = load();
    ok(r(`isCacheCiphertext(${JSON.stringify(env)})`) === true);
    ok(r(`isCacheCiphertext('{"roster":[],"medical":[]}')`) === false);
    ok(r(`isCacheCiphertext("")`) === false);
    ok(r(`isCacheCiphertext("not json at all")`) === false);
  });

  await test("iterations are 250000, not the backend's 2000", () => {
    const r = load();
    eq(r(`CACHE_PBKDF2_ITERATIONS`), 250000);
  });
};
