# Handoff — encrypting the localStorage cache

**Created:** 2026-08-10 (session "10 Aug Bug fix" planning session)
**Status:** brainstormed only. No spec, no plan, no code. Nothing on any branch.
**Prior art in this session:** none — this item was split out of a six-item
backlog whose other five became
`docs/superpowers/specs/2026-08-10-backlog-five-fixes-design.md`.

## Where it came from

The user's backlog listed it as: *"Encrypt localstorage with node.js encrypt
module??"* — with the question marks in the original, so the approach was never
settled, only the goal.

**The node.js framing does not work here and was ruled out immediately.** This
repo has no build step and no bundler: `index.html` loads plain `<script>` tags
and is designed to run under `file://`. An npm crypto module cannot reach the
page. The browser-native equivalent is **Web Crypto (`crypto.subtle`)**, which
is available everywhere this app runs and needs no dependency.

## What the user chose

Presented with four options, the user picked:

> **Password-derived key via Web Crypto** — derive an AES-GCM key from the login
> password with PBKDF2. Real protection against someone reading the disk.

The three rejected alternatives, for the record:

- **Obfuscation only** (key stored in localStorage beside the ciphertext) —
  stops casual DevTools browsing, provides zero protection against anyone who
  actually looks.
- **Cache less instead of encrypting** — stop caching medical reasons, MSK
  detail and names; keep the rest plain.
- **Write up the threat model first** before committing to an approach.

## ⚠️ The unresolved blocker — read this before writing any spec

**A password-derived key cannot be reconstructed after a reload, because the app
does not keep the password.** `handleLogin` issues a 30-day per-device token
(addendum A1); the password is used once and discarded. So on the next launch
there is a token but no key, and the encrypted cache is unreadable.

This collides directly with the app's launch design. `js/main.js` renders the
cached `STATE` immediately and reconciles in the background
(`autoSyncOnLaunch`); an unreadable cache turns every launch into a blocking
full pull — slower, and impossible offline. That is a real regression to the
thing the cache exists for.

Three ways out, none free, none yet chosen:

1. **Key in `sessionStorage`.** Derived at login, survives reloads within the
   tab session, gone when the browser closes. Cache is readable during a
   session and opaque at rest afterwards. Cost: after a browser restart the app
   must full-pull (or re-prompt), so the instant-launch path is lost exactly
   once per browser session.
2. **Re-prompt for the password on launch.** Full protection, kills the 30-day
   token's whole point.
3. **Wrap the key with something device-held.** Restores instant launch but
   reintroduces the "key sits beside the ciphertext" weakness the user
   explicitly rejected in the obfuscation option.

**A spec for this must state the threat model first** — what attacker, with what
access — because option 1 and option 3 protect against materially different
people, and the user's stated goal ("real protection against someone reading the
disk") is satisfied by 1 but not by 3.

## Context a new session will need

- `js/state.js` — `saveLocal()` (debounced ~400ms) / `saveLocalNow()`, and every
  localStorage key. This is the whole write boundary.
- `js/main.js` — bootstrap: load cache → token check → render → auto-pull. The
  order here is what an unreadable cache breaks.
- `js/sync.js` — `autoSyncOnLaunch()`, the warm-cache incremental path
  (`revCheck` + partial pull). Also note **dirty-tab state is persisted
  separately** so a cache clear does not lose unsynced edits; encryption must
  not strand it.
- `apps-script-Code.gs` header — the auth-model comment block (addendum A1
  per-account passwords, 30-day tokens, `SESSION_TTL_MS`).
- PBKDF2 precedent already in this repo: the **backend** hashes passwords with
  PBKDF2, and `PBKDF2_ITERATIONS` had to be tuned down to **2000** because each
  round is a separate `Utilities.*` bridge call in Apps Script (~1.67 ms/iter,
  ~3.3 s per login). **That constraint does not apply in the browser** —
  `crypto.subtle.deriveKey` is native and fast, so do not copy the 2000 figure
  across. Pick a browser-appropriate count.

## Sensitivity — why it is worth doing

The cache holds real personnel data: names, 4Ds, medical reasons, MC/LD dates,
MSK injury detail, leave records. That is the material a stolen or shared laptop
exposes today in plain text.

## Suggested next step

Brainstorm this on its own (`superpowers:brainstorming`), starting from the
threat model rather than the mechanism, and resolve the three-way choice above
before any spec is written.
