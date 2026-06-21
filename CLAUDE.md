# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page web app for tracking a military training company's personnel data — roster, medical/"report sick" status, attendance, fitness tests (IPPT/Route March/SOC), heat acclimatisation, Polar Flow heart-rate imports, leave, and MSK/physio injuries. The frontend is **vanilla JS (no framework, no build step)** backed by a **Google Apps Script web app** that reads/writes a Google Sheet (the actual database).

There is no package.json, bundler, linter, or test suite. You edit files and open `index.html`.

## Running & deploying

- **Run locally:** open `index.html` directly (it's designed to work under `file://` — that's why scripts are plain `<script>` tags, not ES modules). Hosted copy runs on GitHub Pages.
- **Cache-busting:** every `<script>`/`<link>` in `index.html` carries a `?v=NN` query param. When you change a JS or CSS file, bump the version number on that tag (and they're generally bumped together) so users don't get stale cached assets.
- **Backend deploy:** `apps-script-Code.gs` is pasted into the Google Sheet's Apps Script editor (Extensions → Apps Script), not run from this repo. After editing it, redeploy via Manage Deployments → new Version, keeping the same web-app URL. The deployment URL is hardcoded in `js/state.js` (`APPS_SCRIPT_URL`). Setup/auth details are in the header comment of `apps-script-Code.gs`.

## Architecture

### Script load order (matters — globals, not modules)
`state → api → ippt-scoring → helpers → render → forms → sync → main`. Everything shares one global `STATE` object and bare function names; later files depend on earlier ones being loaded. Preserve this order in `index.html`.

- **js/state.js** — the global `STATE` object, all localStorage keys, and the normalizers (`normalizeRoster`, `normalizeMedical`, `normalizeMSK`, `padD4OnLayer`) applied at every read boundary. Data is keyed throughout by **4D** (a 4-digit personnel id); `padD4()` canonicalizes it (strips a leading `C`, re-pads to 4 digits because Sheets eats leading zeros). Commanders use 4Ds `0001`–`0099` and are auto-detected by the `00xx` pattern.
- **js/api.js** — thin `fetch` wrapper around the Apps Script web app. Every request carries an auth token. **Critical gotcha:** the backend returns errors as `{error: "..."}` in a 200 response body, it does NOT throw HTTP errors — callers must inspect the body.
- **js/sync.js** — the sync engine. `autoSync(tab, mode)` is the single chokepoint for all writes, dispatching to append/appendMany/upsert/delete/replace primitives. `enqueueWrite` serializes per-tab pushes and coalesces rapid edits; a pull-in-flight mutex blocks writes against stale state. Failed pushes mark a tab "dirty" (persisted separately so a cache clear doesn't lose them) and surface a retry prompt.
- **js/helpers.js** — pure utilities: name/rank/scope lookups, the platoon/section/role filter (`filteredRoster`, `getPlt`, `getSect` — which fall back to parsing plt/sect out of the 4D), badge HTML, CSV column resolver (`col`), exporters.
- **js/render.js** — view layer. `render()` destroys old Chart.js instances then dispatches on `STATE.nav` to a `renderXxx(el)` function that fills `#content`. Each sidebar tab maps to one such function.
- **js/forms.js** — all modals and form submit handlers (the largest file). Forms mutate `STATE`, call `saveLocal()`, then `autoSync()` to push. Also holds CSV importers (IPPT, RM, Polar) and the conduct-attendance wizard.
- **js/ippt-scoring.js** — SAF IPPT scoring tables; derives scores from age group + reps/run-time. Scores are pre-filled but always user-editable.
- **js/main.js** — bootstrap: redeem `?token=` invite from URL, load cache, wire nav/search/filter, then auto-pull.

### Data flow
Google Sheet ⇄ Apps Script ⇄ `API` ⇄ `STATE` ⇄ localStorage cache + DOM. On launch the app renders the cached `STATE` immediately, then pulls fresh data in the background (or blocks the first render on the pull if the cache is empty). All edits are local-first: mutate `STATE` → `saveLocal()` → `autoSync()` pushes to the sheet.

### Key domain concepts
- **Conduct registry** (`STATE.conducts`): canonical `[{id, name}]` list. Attendance/Polar/ConductDetail rows reference conducts by `conductId`, not free-text names. An empty registry on load triggers a migration that promotes legacy string conduct fields to ids.
- **Medical "ghost" tags:** after an MC/LD end date, the recruit gets a client-side-computed 2-day `MC+1/MC+2/LD+1/LD+2` recovery tag — not stored, derived at render time.
- **Auth:** per-device tokens issued by redeeming single-use or bulk invite links (see the auth-model comment block atop `apps-script-Code.gs`). The Apps Script also contains a substantial Telegram-bot integration (`tg*` functions) for recruit self-registration and parade-state queries.

### Sheet schema
The authoritative column definitions for every tab (Roster, Medical, Attendance, IPPT, RouteMarch, SOC, PolarFlow, ConductDetail, Appointments, Leave, MSK) live in the big header comment at the top of `apps-script-Code.gs`. Consult it before changing any data shape — `writeTab` derives sheet headers from `Object.keys(data[0])`, so a row missing a key silently strips that column from the whole pushed sheet.

## In-progress rebrand & doc hierarchy

The code currently says "Cougar Company" but the repo is `braves-system`. This repo was copied from the Cougar data system and is being adapted to 40 SAR Braves Company.

The Braves adaptation is spec-driven, and the docs form a **layered precedence** — not a single authority. When two docs conflict, the more specific layer wins:

1. **`HA.md`** — authoritative for the HA programmes + currency. The spec defers to it (see spec §20.6). Its "Clarifications (resolved 2026-06-20)" section is the final word on period counting, the rolling-14-day-window currency, and lapse recovery.
2. **`BRAVES_ADAPTATION_SPEC_ADDENDUM.md`** — overrides the main spec for the areas it covers: auth (A1 — per-account passwords, **replacing** the main spec's §3 shared passcode), audit log (A2), Report Sick Leaderboard (A3), Status Board (A4), platoon management (A6), Roster Status List (A7), deferred scope restriction (A8). Read both addendum parts.
3. **`BRAVES_ADAPTATION_SPEC.md`** — the main spec. Authoritative for everything the two layers above don't touch (org model, Config tab, roster/medical schema, R/N, category model, parade state, sick messages, scoping, CSV import, dashboard). Overrides the current Cougar code and the legacy docs below.
4. **`Message Formats.md`** — the required output formats for generated messages (parade state, sick reports). The spec's §9–10 generators are validated *against* this file.
5. **`system_features.md` / `user_facing_features.md`** — background only: they describe the **Cougar** system this repo was copied from. They document where the code is today, not where Braves is going.

Read the relevant layers fully before any Braves-related change.

**`DECISIONS.md`** is a non-authoritative changelog of clarifications resolved during planning, each pointing to where the binding wording now lives in the layers above. Use it to catch up on *what was decided and why*; if it ever disagrees with a spec, the spec wins.

## Current Task

Adapt the Cougar codebase to 40 SAR Braves Company per **`BRAVES_ADAPTATION_SPEC.md`** (the authoritative source — read it fully first).

**Build order (spec §19).** Each step is independently testable and must leave the app working; do not start a step until the previous one verifies.
1. **Auth** (addendum **A1**, which replaces main spec §3) — **per-account passwords** (SHA-256 + per-user salt), Commanders tab linked to Roster by `personId`, roles (`admin`/`commander`/`viewer`), failed-login throttling, 30-day session expiry, audit log (A2), email+password login UI. Verify a commander can log in and a viewer is read-only.
2. **Config + Roster/Medical schema** (§4–6) — add columns/tabs; wire `STATE.config`. Everything downstream depends on `platoon`/`section`/`rankGroup`/`fourD` and the new Medical fields.
3. **R/N + category model + parade state** (§7–9) — the current blocker for live use. Validate output byte-for-byte against `Message Formats.md`.
4. **Sick messages** (§10).
5. **Scoping** (§11) — add the selector + `inScope` across views (needs roster platoon/section).
6. **CSV conduct import** (§14) — replaces manual re-keying; feeds HA.
7. **HA rewrite + views** (§12–13) — depends on CSV import for participation data. **`HA.md` is the authoritative source for the three programmes + currency**; see its "Clarifications (resolved 2026-06-20)" section for the resolved period-counting, rolling-14-day-window currency, lapse-recovery, and CSV-`Periods`-cell (B5) rules.
8. **Dashboard** (§16) — tiles/widgets last, once their data sources exist.

**Hard constraints — do NOT change (spec §18):**
- IPPT scoring & award bands (already matches Braves: Gold★ ≥90, Gold 85–89, Silver 75–84, Pass 61–74, Fail ≤60, YTT).
- RouteMarch, SOC trackers and renders — beyond adding the scope selector.
- MSK injury classifier and analytics — beyond the scope selector.
- Polar Flow OCR pipeline and `analyzePhotoHelper` — beyond the Config company-name tweak and the clarified non-HA role.
- Conducts Registry (`renderConducts`, rename/merge).
- Sync engine (`autoSync`, `pushTab`, `pullTab`, `appendMany`, `upsertRow`, etc.).
- Chart.js / PapaParse / library imports.
- `isHAExcluded()` conduct-exclusion logic.

## Conventions

- Code is heavily commented with the *why* behind non-obvious decisions (cross-device write safety, Sheets quirks, ghost tags). Match that density — explain rationale, not mechanics.
- CSV files in the repo root are sanitized sample/test data (and are gitignored by pattern). Real exports land as `cougar_backup*.json` (also gitignored).
