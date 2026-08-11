// Web Crypto primitives for the encrypted localStorage cache.
//
// PURE: no STATE, no DOM, no reference to any other global in the bundle — so
// this unit-tests in isolation (test/cache-crypto.test.js loads it into a REAL
// vm context, not a permissive Proxy, which is what enforces that) and so it can
// load FIRST in index.html without depending on anything.
//
// THREAT MODEL (docs/superpowers/specs/2026-08-10-encrypt-local-cache-design.md).
// What this defends: a cold disk image with no live browser session — a stolen,
// sold, repaired or handed-over device; a filesystem backup; another OS account
// reading the browser profile. Once the browser session ends, sessionStorage is
// gone and what remains on disk is inert ciphertext.
//
// What this does NOT defend, and must not be claimed to: XSS in the running page
// (the key is in memory and reachable — the mitigation there is still escapeHTML
// at render), or anyone at the unlocked, signed-in machine. The offline grant in
// js/state.js remains the primary control; it bounds SCOPE and LIFETIME, this
// adds a lock on what is left.
//
// Residual, documented rather than papered over: browsers may persist
// sessionStorage to disk for session restore, so a disk image captured while a
// session is suspended-but-restorable may contain the key.

// 250,000 — NOT the backend's PBKDF2_ITERATIONS = 2000. That figure exists
// because Apps Script charges a separate Utilities.* bridge call per round
// (~1.67 ms/iter, ~3.3 s per login). crypto.subtle is native, so 250k costs
// ~100-200 ms and is paid once per COLD start only (a same-session reload
// imports the already-derived key). Copying 2000 across would be a silent 125x
// weakening with no visible symptom.
const CACHE_PBKDF2_ITERATIONS = 250000;

// Bumping this invalidates every cached envelope: decryptCache returns null for
// an unknown version, and the caller treats null as "unreadable cache", which
// falls through to a full pull. That is the intended migration path.
const CACHE_ENVELOPE_VERSION = 1;

function _cacheB64(buf) {
  const a = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}

function _cacheUnb64(str) {
  const s = atob(str);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

// 16 random bytes. Salts are NOT secret — this is stored in plaintext localStorage
// on purpose. It only has to be stable per device so the same password derives
// the same key across launches.
function newCacheSalt() {
  return _cacheB64(crypto.getRandomValues(new Uint8Array(16)));
}

async function deriveCacheKey(password, saltB64) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: _cacheUnb64(saltB64), iterations: CACHE_PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    // extractable: true is REQUIRED. The key has to be exported into
    // sessionStorage so a same-session reload skips the 250k-round derive; a
    // non-extractable key would force a password prompt on every reload.
    true,
    ["encrypt", "decrypt"]
  );
}

async function exportCacheKey(key) {
  return _cacheB64(await crypto.subtle.exportKey("raw", key));
}

async function importCacheKey(b64) {
  return crypto.subtle.importKey("raw", _cacheUnb64(b64), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

async function encryptCache(key, plaintext) {
  // A fresh 12-byte IV per call. Reusing an IV under the same key is the one
  // catastrophic misuse of AES-GCM, so it is generated here and nowhere else.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return JSON.stringify({ v: CACHE_ENVELOPE_VERSION, iv: _cacheB64(iv), ct: _cacheB64(ct) });
}

// Returns null — never throws — for a wrong key, a tampered ciphertext, a
// malformed envelope or an unknown version. ONE failure mode for callers to
// handle, which matters because they are all on the launch path.
async function decryptCache(key, envelope) {
  try {
    const env = JSON.parse(envelope);
    if (!env || env.v !== CACHE_ENVELOPE_VERSION || typeof env.iv !== "string" || typeof env.ct !== "string") return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _cacheUnb64(env.iv) }, key, _cacheUnb64(env.ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// Tells an envelope from a legacy plaintext cache written before encryption
// shipped. Shape-based, not a guess at the payload: anything that is not a
// well-formed v1 envelope is treated as legacy.
function isCacheCiphertext(raw) {
  try {
    const e = JSON.parse(raw);
    return !!(e && e.v === CACHE_ENVELOPE_VERSION && typeof e.iv === "string" && typeof e.ct === "string");
  } catch {
    return false;
  }
}
