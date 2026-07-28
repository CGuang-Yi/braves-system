# Codebase map — for adversarial code review

A navigation aid for reviewing this repo, aimed at a reader starting with no context.
It states **facts, not verdicts**: size, coupling, coverage and known traps. It deliberately
does not rule on whether any of them is a problem — findings belong in review output, where
they can be argued with, not baked into a generated document that would anchor every future
review the same way.

Two files. **This one** is meant to be read start to finish; every line costs the reader
context, so it carries orientation, traps and outliers only. **`codebase-map.json`** carries
the full per-declaration data — callers, callees, line spans, test references — and is meant
to be queried, never read whole.

Regenerate with:

```bash
npm run map
```

<!-- GENERATED:meta:start -->
_Generated from `ac3073a` by `npm run map`. 13 source files, 1079 declarations._
<!-- GENERATED:meta:end -->

## How much to trust each part

| what | trustworthiness |
|---|---|
| line counts, size outliers | **exact** |
| `function` / `var` top-level definitions | **exact** — scanner, cross-checked against a `vm` load |
| `const` / `let` / `class` definitions and object-literal methods | **high** — scanner only. `vm.runInContext` exposes `function` and `var` as context properties but never `const`/`let`/`class`, which are lexical bindings, so these cannot be verified by that route. `js/api.js` has zero top-level `function` declarations — its whole surface is `const API = {…}` — so any vm-only approach would report it as empty. |
| direct call sites, fan-in | **high** — comment/string-aware, and `${…}` interpolations count as real code. Misses `window[name]`-style dynamic dispatch. |
| string-literal references (`onclick=` inside HTML strings) | **high** — this is the bucket no linter, test, or editor "find references" catches |
| reference counts for **object members** (`API.pullAll`) | **approximate** — matched on the bare member name, so any `pullAll(` anywhere counts. Inflates member counts, but only ever keeps things *out* of the orphan list; it cannot invent a false orphan. |
| orphan candidates | **leads, not verdicts** — dynamic dispatch and external entry points cause false positives. See `tools/map/entry-points.js` for what is exempt and why. |
| dead CSS | **leads only** — cannot follow classes built by concatenation (`"badge badge-" + kind`) |
| DOM ids queried but not in `index.html` | **mostly expected, not findings** — most ids are created at runtime into `#content` |
| test coverage mapping | **name-match heuristic** — a test naming a function is not proof it is meaningfully tested |

If the **Scanner gaps** section below is non-empty, the tool has a bug and its reference data is
incomplete. Treat that as a defect in the map, not a finding about the codebase.

## Orientation

Read `docs/ARCHITECTURE.md` for how the app works. What follows is only the part that changes
how you *review* it rather than how you *use* it.

**There is no module system.** Plain `<script>` tags, no bundler, no build step, no imports —
every function is a bare global sharing one scope. Three consequences for review:

1. The tag order in `index.html` **is** the dependency graph. It is the only thing enforcing that
   `state.js` exists before `api.js` uses it. A reordering is a real breakage with no compile error.
2. Any function can call any other. "Who calls this?" cannot be answered by reading imports —
   that is what the inventory table and `codebase-map.json`'s `callers` fields are for.
3. A rename has no compiler to catch it, and a large slice of handlers are referenced *only* from
   HTML strings, where nothing fails until a user clicks.

**Every write goes through one chokepoint.** `autoSync(tab, mode)` in `js/sync.js` is the single
entry to all persistence, queued per tab and strictly FIFO. A write that bypasses it bypasses the
optimistic-concurrency guard, the dirty-tab tracking and the retry path at once.

**Data is keyed by 4D everywhere.** `padD4()` canonicalises it (Sheets eats leading zeros), and
`js/state.js`'s normalizers are applied at *every* read boundary. A code path that reads sheet data
without normalising is reading a different key space from the rest of the app.

**The backend does not throw HTTP errors.** It returns `{error: "…"}` inside a **200** response.
Any caller that checks only `res.ok` silently treats failure as success.

**Docs are gitignored.** `.gitignore` carries a bare `*.md`, so every markdown file here is
untracked — `git log -S` will report that text in a doc "never existed". The shell's `grep` is a
`ugrep --ignore-files` wrapper honouring the same rules, so `grep -r` skips them too. Use
`command grep -r`, and never conclude from git history alone that doc text never existed.

## Known traps

Things a reviewer cannot infer from the code in front of them.

- **`js/braves-parade.js` is hand-ported into `apps-script-Code.gs`.** Two copies of the parade
  classifier exist for the Telegram bot. A change to one is a bug unless mirrored into the other.
  `test/parade-port-parity.test.js` guards the pair — if a change touches one copy and that test
  was not run, the review is incomplete.
- **Sheets coerces leading-zero strings to numbers.** Any column not listed in
  `WRITE_TEXT_COLS_BY_TAB` turns `"0730"` into `730` on write. This was the root cause of the
  Attendance-participants (#33) and conduct-time (#69) corruption bugs. A new column carrying
  leading zeros must be added to that map.
- **`writeTab` derives sheet headers from `Object.keys(data[0])`.** One row missing a key silently
  strips that column from the *entire* pushed sheet — a whole-company data loss from a single
  malformed row.
- **Adding a column needs a live migration.** New columns on an existing tab require a
  `bravesMigrateSchema()` run against the real sheet; shipping the code alone is not enough.
- **Cache-bust versions are measured against `master`.** Every `<script>`/`<link>` in `index.html`
  carries `?v=NN`, bumped when its file changes. A branch stacked on unrelated work bumps from the
  wrong baseline and collides on merge. See the drift check in the asset section below.
- **The test sandbox has no `Array` global.** Code loaded by the isolated unit tests
  (`js/calc.js`, `js/braves-parade.js`) must use `[...new Set()]`, never `Array.from`.
- **Spec docs are layered, not singular.** `MD_Docs/HA.md` beats the addendum, which beats the main
  spec, for the areas each covers. Reviewing parade/HA/scoping logic against the wrong layer
  produces confident, wrong findings.

## Inventory

`calls into` and `called by` are file-level: which other files this one references, and which
reference it. Per-declaration callers live in `codebase-map.json` → `functions.<name>.directRefs`.

<!-- GENERATED:inventory:start -->
| file | lines | decls | calls into | called by | test files |
|---|---:|---:|---|---|---:|
| `js/api.js` | 311 | 45 | `apps-script-Code.gs` `js/forms.js` `js/state.js` `js/sync.js` | `apps-script-Code.gs` `js/forms.js` `js/helpers.js` `js/main.js` `js/parade-tab.js` `js/render.js` `js/sync.js` | 49 |
| `js/braves-parade.js` | 903 | 47 | `js/helpers.js` `js/state.js` | `apps-script-Code.gs` `js/forms.js` `js/parade-tab.js` `js/render.js` | 32 |
| `js/calc.js` | 353 | 18 | — | `js/forms.js` `js/helpers.js` `js/render.js` | 8 |
| `js/forms.js` | 6284 | 237 | `apps-script-Code.gs` `js/api.js` `js/braves-parade.js` `js/calc.js` `js/helpers.js` `js/ippt-scoring.js` `js/main.js` `js/render.js` `js/sick-history-import.js` `js/state.js` `js/sync.js` | `js/api.js` `js/main.js` `js/parade-tab.js` `js/render.js` `js/sync.js` | 17 |
| `js/helpers.js` | 1937 | 157 | `js/api.js` `js/calc.js` `js/ippt-scoring.js` `js/render.js` `js/state.js` `js/sync.js` | `apps-script-Code.gs` `js/braves-parade.js` `js/forms.js` `js/main.js` `js/parade-tab.js` `js/render.js` `js/sync.js` | 43 |
| `js/ippt-scoring.js` | 163 | 11 | — | `js/forms.js` `js/helpers.js` `js/render.js` | 1 |
| `js/main.js` | 363 | 15 | `js/api.js` `js/forms.js` `js/helpers.js` `js/render.js` `js/state.js` `js/sync.js` | `js/forms.js` `js/render.js` `js/sync.js` | 2 |
| `js/parade-tab.js` | 621 | 40 | `js/api.js` `js/braves-parade.js` `js/forms.js` `js/helpers.js` `js/state.js` `js/sync.js` | `js/render.js` | 4 |
| `js/render.js` | 3690 | 153 | `apps-script-Code.gs` `js/api.js` `js/braves-parade.js` `js/calc.js` `js/forms.js` `js/helpers.js` `js/ippt-scoring.js` `js/main.js` `js/parade-tab.js` `js/state.js` `js/sync.js` | `js/forms.js` `js/helpers.js` `js/main.js` `js/sync.js` | 34 |
| `js/sick-history-import.js` | 270 | 26 | — | `js/forms.js` | 23 |
| `js/state.js` | 719 | 91 | — | `apps-script-Code.gs` `js/api.js` `js/braves-parade.js` `js/forms.js` `js/helpers.js` `js/main.js` `js/parade-tab.js` `js/render.js` `js/sync.js` | 38 |
| `js/sync.js` | 1066 | 72 | `apps-script-Code.gs` `js/api.js` `js/forms.js` `js/helpers.js` `js/main.js` `js/render.js` `js/state.js` | `js/api.js` `js/forms.js` `js/helpers.js` `js/main.js` `js/parade-tab.js` `js/render.js` | 13 |
| `apps-script-Code.gs` | 4192 | 237 | `js/api.js` `js/braves-parade.js` `js/helpers.js` `js/state.js` | `js/api.js` `js/forms.js` `js/render.js` `js/sync.js` | 44 |
<!-- GENERATED:inventory:end -->

## Risk markers

<!-- GENERATED:markers:start -->
**Longest functions** (over 100 lines, longest first)

- `openPerson` — 400 lines, `js/forms.js:130`
- `bpClassifyPerson` — 314 lines, `js/braves-parade.js:210`
- `renderMSKAnalytics` — 286 lines, `js/render.js:948`
- `API` — 267 lines, `js/api.js:44`
- `renderConductDashboard` — 266 lines, `js/render.js:2723`
- `bpClassifyPerson` — 254 lines, `apps-script-Code.gs:3291`
- `buildFitnessReportHTML` — 250 lines, `js/forms.js:3374`
- `renderDashboard` — 245 lines, `js/render.js:480`
- `renderIPPT` — 224 lines, `js/render.js:2130`
- `renderLogConductWizard` — 218 lines, `js/forms.js:4829`
- `saveLogConductWizard` — 173 lines, `js/forms.js:5624`
- `rebuildLogConductStatus` — 161 lines, `js/forms.js:4664`
- `toggleReportSickPatterns` — 144 lines, `js/forms.js:535`
- `confirmConductImport` — 139 lines, `js/forms.js:1829`
- `renderParadePlatoon` — 137 lines, `js/parade-tab.js:373`

_8 more over the threshold; full list in `docs/codebase-map.json` → `markers.longFunctions`._

**Highest fan-in** — most referencing files, so the largest blast radius if changed

- `activePlatoons` — referenced from 6 other file(s) (defined in `js/helpers.js`)
- `canWrite` — referenced from 6 other file(s) (defined in `js/state.js`)
- `configGet` — referenced from 6 other file(s) (defined in `js/state.js`)
- `personPlatoon` — referenced from 6 other file(s) (defined in `js/helpers.js`)
- `saveLocal` — referenced from 6 other file(s) (defined in `js/state.js`)
- `displayDateToISO` — referenced from 5 other file(s) (defined in `js/helpers.js`)
- `displayPersonLabel` — referenced from 5 other file(s) (defined in `js/helpers.js`)
- `escapeHTML` — referenced from 5 other file(s) (defined in `js/helpers.js`)
- `API.get` — referenced from 4 other file(s) (defined in `js/api.js`)
- `generateBravesParadeState` — referenced from 4 other file(s) (defined in `js/braves-parade.js`)
- `getName` — referenced from 4 other file(s) (defined in `js/helpers.js`)
- `isoToDisplayDate` — referenced from 4 other file(s) (defined in `js/helpers.js`)
- `medStatusActive` — referenced from 4 other file(s) (defined in `js/helpers.js`)
- `render` — referenced from 4 other file(s) (defined in `js/render.js`)
- `todayISO` — referenced from 4 other file(s) (defined in `js/helpers.js`)
- `API.pushTab` — referenced from 3 other file(s) (defined in `js/api.js`)
- `autoSync` — referenced from 3 other file(s) (defined in `js/sync.js`)
- `bpClassifyPerson` — referenced from 3 other file(s) (defined in `js/braves-parade.js`)
- `bpDisplayRank` — referenced from 3 other file(s) (defined in `js/braves-parade.js`)
- `bpStrength` — referenced from 3 other file(s) (defined in `js/braves-parade.js`)
- `classifyURTI` — referenced from 3 other file(s) (defined in `js/helpers.js`)
- `escapeAttr` — referenced from 3 other file(s) (defined in `js/helpers.js`)
- `filterLabel` — referenced from 3 other file(s) (defined in `js/helpers.js`)
- `handleAuthFailure` — referenced from 3 other file(s) (defined in `js/main.js`)
- `isAdminRole` — referenced from 3 other file(s) (defined in `js/state.js`)

**Orphan candidates** — leads, not verdicts; see the trust table

- `openAttendanceForm` (`js/forms.js`)
- `openCommanderForm` (`js/forms.js`)
- `SEP` (`js/forms.js`)
- `upcomingParadeAppointments` (`js/forms.js`)
- `outOfCampApptsForParade` (`js/forms.js`)
- `onParadeDateChange` (`js/forms.js`)
- `onParadeTimeChange` (`js/forms.js`)
- `countMCDaysInWindow` (`js/forms.js`)
- `getRank` (`js/helpers.js`)
- `commanderLeaveBalance` (`js/helpers.js`)
- `currentMedicalEffective` (`js/helpers.js`)
- `typeBadge` (`js/helpers.js`)
- `ipptAwardColor` (`js/ippt-scoring.js`)
- `upsertLocal` (`js/parade-tab.js`)
- `syncTimingSummary` (`js/sync.js`)
- `pollCadenceInfo` (`js/sync.js`)
- `FRONTEND_BASE_URL` (`apps-script-Code.gs`)
- `bulkInviteStatus` (`apps-script-Code.gs`)
- `listInvites` (`apps-script-Code.gs`)
- `listAuthTokens` (`apps-script-Code.gs`)
- `revokeAuthToken` (`apps-script-Code.gs`)
- `revokeInvite` (`apps-script-Code.gs`)
- `revokeAllAuthTokens` (`apps-script-Code.gs`)
- `initAllRevs` (`apps-script-Code.gs`)
- `installEditTrigger` (`apps-script-Code.gs`)
- `setTelegramWebhook` (`apps-script-Code.gs`)
- `setTelegramExecUrl` (`apps-script-Code.gs`)
- `startTelegramPolling` (`apps-script-Code.gs`)
- `stopTelegramPolling` (`apps-script-Code.gs`)
- `setupBotTabs` (`apps-script-Code.gs`)

**Untested surface**

_702 of 1079 declarations are named by no test file._ Full list in `docs/codebase-map.json` → `markers.untested`. Being named by a test is not proof of meaningful coverage — see the trust table.
<!-- GENERATED:markers:end -->

## Assets

`index.html` and `styles.css` have no automated test coverage of any kind, so these mechanical
checks are the only safety net they have.

<!-- GENERATED:assets:start -->
**Script load order** (`index.html`) — with no module system this order *is* the dependency graph

1. `styles.css` — `?v=130`
2. `vendor/chart.umd.min.js` — `?v=114`
3. `vendor/papaparse.min.js` — `?v=114`
4. `vendor/exceljs.min.js` — `?v=114`
5. `js/state.js` — `?v=127`
6. `js/api.js` — `?v=127`
7. `js/ippt-scoring.js` — `?v=112`
8. `js/calc.js` — `?v=7`
9. `js/helpers.js` — `?v=143`
10. `js/sick-history-import.js` — `?v=113`
11. `js/render.js` — `?v=172`
12. `js/forms.js` — `?v=171`
13. `js/braves-parade.js` — `?v=137`
14. `js/parade-tab.js` — `?v=23`
15. `js/sync.js` — `?v=126`
16. `js/main.js` — `?v=123`

**Cache-bust drift** — source committed more recently than its `?v=` was bumped

_none_

**Dead CSS candidates** — 2 of 106 classes

`.badge-orange`, `.sb-td`

**DOM ids declared in `index.html` but never queried** — 3

`#main`, `#sidebar-footer`, `#topbar`

**DOM ids queried in JS but absent from `index.html`** — 115

Expected: most ids are built at runtime into `#content`. Listed in `docs/codebase-map.json` → `assets.domIds.queriedOnly` if you need them.
<!-- GENERATED:assets:end -->
