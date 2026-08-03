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
_Generated from `d6da8f5` by `npm run map`. 28 source files, 1098 declarations._
<!-- GENERATED:meta:end -->

## How much to trust each part

| what | trustworthiness |
|---|---|
| line counts, size outliers | **exact** |
| `function` / `var` top-level definitions | **exact** — scanner, cross-checked against a `vm` load |
| `const` / `let` / `class` definitions and object-literal methods | **high** — scanner only. `vm.runInContext` exposes `function` and `var` as context properties but never `const`/`let`/`class`, which are lexical bindings, so these cannot be verified by that route. `js/api.js` has zero top-level `function` declarations — its whole surface is `const API = {…}` — so any vm-only approach would report it as empty. |
| direct call sites, fan-in | **high** — comment/string-aware, and `${…}` interpolations count as real code. Misses `window[name]`-style dynamic dispatch. |
| string-literal references (`onclick=` inside HTML strings) | **high** — this is the bucket the linter, the tests, and editor "find references" all miss. ESLint's `no-undef` covers plain-code call sites only; these are the remainder |
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

**There is no module system.** Plain `<script>` tags, no bundler, no build step, no imports (ESLint runs in script mode over the derived global surface, which covers plain-code references but not HTML-string ones) —
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
  classifier exist because the unattended archive cron runs server-side, where the frontend copy is
  unreachable. A change to one is a bug unless mirrored into the other.
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
| `js/actions.js` | 107 | 5 | — | `js/parade-tab.js` `js/render-duty.js` | 4 |
| `js/api.js` | 317 | 48 | `apps-script-Code.gs` `js/forms-conducts.js` `js/state.js` `js/sync.js` | `apps-script-Code.gs` `js/forms-admin.js` `js/forms-conducts.js` `js/forms-import.js` `js/forms-records.js` `js/forms-reports.js` `js/helpers.js` `js/main.js` `js/parade-tab.js` `js/render-conducts.js` `js/render-dashboard.js` `js/render-records.js` `js/render.js` `js/sync.js` | 56 |
| `js/braves-parade.js` | 922 | 47 | `js/helpers.js` `js/state.js` | `apps-script-Code.gs` `js/forms-records.js` `js/forms-reports.js` `js/parade-tab.js` `js/render-dashboard.js` `js/render-statusboard.js` `js/render.js` | 37 |
| `js/calc.js` | 375 | 18 | — | `js/forms-records.js` `js/forms-reports.js` `js/forms-wizard.js` `js/forms.js` `js/helpers.js` `js/render-conducts.js` `js/render-dashboard.js` | 8 |
| `js/duty-eligibility.js` | 96 | 5 | — | `js/render-duty.js` | 1 |
| `js/duty-import.js` | 255 | 15 | — | — | 1 |
| `js/duty-points.js` | 186 | 12 | — | `js/render-duty.js` | 1 |
| `js/forms-admin.js` | 422 | 21 | `js/api.js` `js/forms-conducts.js` `js/forms.js` `js/helpers.js` `js/main.js` `js/render.js` `js/state.js` `js/sync.js` | `js/render-conducts.js` `js/sync.js` | 0 |
| `js/forms-conducts.js` | 622 | 32 | `js/api.js` `js/forms.js` `js/helpers.js` `js/render.js` `js/state.js` `js/sync.js` | `js/api.js` `js/forms-admin.js` `js/forms-import.js` `js/forms-records.js` `js/forms-wizard.js` `js/forms.js` `js/main.js` `js/render-conducts.js` `js/render-records.js` | 3 |
| `js/forms-import.js` | 654 | 22 | `js/api.js` `js/forms-conducts.js` `js/forms.js` `js/helpers.js` `js/ippt-scoring.js` `js/render.js` `js/state.js` `js/sync.js` | `js/render-conducts.js` `js/render-records.js` | 1 |
| `js/forms-records.js` | 709 | 35 | `js/api.js` `js/braves-parade.js` `js/calc.js` `js/forms-conducts.js` `js/forms-wizard.js` `js/forms.js` `js/helpers.js` `js/render-statusboard.js` `js/render.js` `js/sick-history-import.js` `js/state.js` `js/sync.js` | `js/forms.js` `js/parade-tab.js` `js/render-dashboard.js` `js/render-records.js` | 6 |
| `js/forms-reports.js` | 1175 | 38 | `js/api.js` `js/braves-parade.js` `js/calc.js` `js/forms-wizard.js` `js/forms.js` `js/helpers.js` `js/ippt-scoring.js` `js/state.js` | `js/forms-wizard.js` `js/render-dashboard.js` `js/render-statusboard.js` `js/sync.js` | 2 |
| `js/forms-wizard.js` | 1348 | 50 | `js/calc.js` `js/forms-conducts.js` `js/forms-reports.js` `js/forms.js` `js/helpers.js` `js/render.js` `js/state.js` `js/sync.js` | `js/forms-records.js` `js/forms-reports.js` `js/forms.js` `js/render-records.js` | 6 |
| `js/forms.js` | 1453 | 31 | `apps-script-Code.gs` `js/calc.js` `js/forms-conducts.js` `js/forms-records.js` `js/forms-wizard.js` `js/helpers.js` `js/ippt-scoring.js` `js/render-conducts.js` `js/render.js` `js/state.js` `js/sync.js` | `js/forms-admin.js` `js/forms-conducts.js` `js/forms-import.js` `js/forms-records.js` `js/forms-reports.js` `js/forms-wizard.js` `js/main.js` `js/parade-tab.js` `js/render-conducts.js` `js/render-dashboard.js` `js/render-records.js` `js/render-statusboard.js` | 16 |
| `js/helpers.js` | 1977 | 157 | `js/api.js` `js/calc.js` `js/ippt-scoring.js` `js/render.js` `js/state.js` `js/sync.js` | `apps-script-Code.gs` `js/braves-parade.js` `js/forms-admin.js` `js/forms-conducts.js` `js/forms-import.js` `js/forms-records.js` `js/forms-reports.js` `js/forms-wizard.js` `js/forms.js` `js/main.js` `js/parade-tab.js` `js/render-conducts.js` `js/render-dashboard.js` `js/render-duty.js` `js/render-records.js` `js/render-statusboard.js` `js/render.js` `js/sync.js` | 49 |
| `js/ippt-scoring.js` | 168 | 11 | — | `js/forms-import.js` `js/forms-reports.js` `js/forms.js` `js/helpers.js` `js/render-records.js` | 1 |
| `js/main.js` | 363 | 15 | `js/api.js` `js/forms-conducts.js` `js/forms.js` `js/helpers.js` `js/render.js` `js/state.js` `js/sync.js` | `js/forms-admin.js` `js/render-dashboard.js` `js/render.js` `js/sync.js` | 2 |
| `js/parade-tab.js` | 664 | 40 | `js/actions.js` `js/api.js` `js/braves-parade.js` `js/forms-records.js` `js/forms.js` `js/helpers.js` `js/state.js` `js/sync.js` | `js/render-dashboard.js` `js/render.js` | 5 |
| `js/render-conducts.js` | 689 | 20 | `js/api.js` `js/calc.js` `js/forms-admin.js` `js/forms-conducts.js` `js/forms-import.js` `js/forms.js` `js/helpers.js` `js/render-dashboard.js` `js/render.js` `js/state.js` `js/sync.js` | `js/forms.js` `js/render.js` | 2 |
| `js/render-dashboard.js` | 1373 | 43 | `js/api.js` `js/braves-parade.js` `js/calc.js` `js/forms-records.js` `js/forms-reports.js` `js/forms.js` `js/helpers.js` `js/main.js` `js/parade-tab.js` `js/render-statusboard.js` `js/render.js` `js/state.js` `js/sync.js` | `js/render-conducts.js` `js/render-statusboard.js` `js/render.js` `js/sync.js` | 5 |
| `js/render-duty.js` | 244 | 19 | `js/actions.js` `js/duty-eligibility.js` `js/duty-points.js` `js/helpers.js` `js/render.js` `js/state.js` | `js/render.js` | 0 |
| `js/render-records.js` | 898 | 36 | `js/api.js` `js/forms-conducts.js` `js/forms-import.js` `js/forms-records.js` `js/forms-wizard.js` `js/forms.js` `js/helpers.js` `js/ippt-scoring.js` `js/render-statusboard.js` `js/render.js` `js/state.js` `js/sync.js` | `js/render.js` | 0 |
| `js/render-statusboard.js` | 446 | 36 | `js/braves-parade.js` `js/forms-reports.js` `js/forms.js` `js/helpers.js` `js/render-dashboard.js` `js/state.js` | `js/forms-records.js` `js/render-dashboard.js` `js/render-records.js` `js/render.js` | 26 |
| `js/render.js` | 425 | 26 | `apps-script-Code.gs` `js/api.js` `js/braves-parade.js` `js/helpers.js` `js/main.js` `js/parade-tab.js` `js/render-conducts.js` `js/render-dashboard.js` `js/render-duty.js` `js/render-records.js` `js/render-statusboard.js` `js/state.js` `js/sync.js` | `js/forms-admin.js` `js/forms-conducts.js` `js/forms-import.js` `js/forms-records.js` `js/forms-wizard.js` `js/forms.js` `js/helpers.js` `js/main.js` `js/render-conducts.js` `js/render-dashboard.js` `js/render-duty.js` `js/render-records.js` `js/sync.js` | 27 |
| `js/sick-history-import.js` | 275 | 26 | — | `js/forms-records.js` | 25 |
| `js/state.js` | 876 | 108 | — | `apps-script-Code.gs` `js/api.js` `js/braves-parade.js` `js/forms-admin.js` `js/forms-conducts.js` `js/forms-import.js` `js/forms-records.js` `js/forms-reports.js` `js/forms-wizard.js` `js/forms.js` `js/helpers.js` `js/main.js` `js/parade-tab.js` `js/render-conducts.js` `js/render-dashboard.js` `js/render-duty.js` `js/render-records.js` `js/render-statusboard.js` `js/render.js` `js/sync.js` | 47 |
| `js/sync.js` | 1066 | 72 | `apps-script-Code.gs` `js/api.js` `js/forms-admin.js` `js/forms-reports.js` `js/helpers.js` `js/main.js` `js/render-dashboard.js` `js/render.js` `js/state.js` | `js/api.js` `js/forms-admin.js` `js/forms-conducts.js` `js/forms-import.js` `js/forms-records.js` `js/forms-wizard.js` `js/forms.js` `js/helpers.js` `js/main.js` `js/parade-tab.js` `js/render-conducts.js` `js/render-dashboard.js` `js/render-records.js` `js/render.js` | 15 |
| `apps-script-Code.gs` | 3413 | 180 | `js/api.js` `js/braves-parade.js` `js/helpers.js` `js/state.js` | `js/api.js` `js/forms.js` `js/render.js` `js/sync.js` | 48 |
<!-- GENERATED:inventory:end -->

## Risk markers

<!-- GENERATED:markers:start -->
**Longest functions** (over 100 lines, longest first)

- `openPerson` — 411 lines, `js/forms.js:215`
- `bpClassifyPerson` — 326 lines, `js/braves-parade.js:210`
- `renderMSKAnalytics` — 286 lines, `js/render-dashboard.js:556`
- `API` — 267 lines, `js/api.js:50`
- `renderConductDashboard` — 266 lines, `js/render-conducts.js:157`
- `bpClassifyPerson` — 265 lines, `apps-script-Code.gs:2498`
- `renderDashboard` — 251 lines, `js/render-dashboard.js:82`
- `buildFitnessReportHTML` — 250 lines, `js/forms-reports.js:630`
- `renderIPPT` — 224 lines, `js/render-records.js:453`
- `renderLogConductWizard` — 218 lines, `js/forms-wizard.js:306`
- `saveLogConductWizard` — 173 lines, `js/forms-wizard.js:1101`
- `rebuildLogConductStatus` — 161 lines, `js/forms-wizard.js:141`
- `submitMedical` — 159 lines, `js/forms.js:1072`
- `toggleReportSickPatterns` — 153 lines, `js/forms.js:631`
- `confirmConductImport` — 139 lines, `js/forms-import.js:515`

_8 more over the threshold; full list in `docs/codebase-map.json` → `markers.longFunctions`._

**Highest fan-in** — most referencing files, so the largest blast radius if changed

- `escapeAttr` — referenced from 14 other file(s) (defined in `js/helpers.js`)
- `escapeHTML` — referenced from 14 other file(s) (defined in `js/helpers.js`)
- `displayDateToISO` — referenced from 13 other file(s) (defined in `js/helpers.js`)
- `render` — referenced from 13 other file(s) (defined in `js/render.js`)
- `todayISO` — referenced from 13 other file(s) (defined in `js/helpers.js`)
- `isoToDisplayDate` — referenced from 11 other file(s) (defined in `js/helpers.js`)
- `saveLocal` — referenced from 11 other file(s) (defined in `js/state.js`)
- `activePlatoons` — referenced from 10 other file(s) (defined in `js/helpers.js`)
- `displayPersonLabel` — referenced from 10 other file(s) (defined in `js/helpers.js`)
- `personPlatoon` — referenced from 10 other file(s) (defined in `js/helpers.js`)
- `conductName` — referenced from 9 other file(s) (defined in `js/helpers.js`)
- `configGet` — referenced from 9 other file(s) (defined in `js/state.js`)
- `autoSync` — referenced from 8 other file(s) (defined in `js/sync.js`)
- `canWrite` — referenced from 8 other file(s) (defined in `js/state.js`)
- `openModal` — referenced from 8 other file(s) (defined in `js/forms.js`)
- `closeModal` — referenced from 7 other file(s) (defined in `js/forms.js`)
- `filterLabel` — referenced from 7 other file(s) (defined in `js/helpers.js`)
- `isFilterActive` — referenced from 7 other file(s) (defined in `js/helpers.js`)
- `fmtHrs` — referenced from 6 other file(s) (defined in `js/helpers.js`)
- `isAdminRole` — referenced from 6 other file(s) (defined in `js/state.js`)
- `openPerson` — referenced from 6 other file(s) (defined in `js/forms.js`)
- `personSection` — referenced from 6 other file(s) (defined in `js/helpers.js`)
- `API.get` — referenced from 5 other file(s) (defined in `js/api.js`)
- `API.pushTab` — referenced from 5 other file(s) (defined in `js/api.js`)
- `displayId` — referenced from 5 other file(s) (defined in `js/helpers.js`)

**Orphan candidates** — leads, not verdicts; see the trust table

- `openCommanderForm` (`js/forms-records.js`)
- `SEP` (`js/forms-reports.js`)
- `upcomingParadeAppointments` (`js/forms-reports.js`)
- `countMCDaysInWindow` (`js/forms-reports.js`)
- `openAttendanceForm` (`js/forms.js`)
- `getRank` (`js/helpers.js`)
- `commanderLeaveBalance` (`js/helpers.js`)
- `currentMedicalEffective` (`js/helpers.js`)
- `typeBadge` (`js/helpers.js`)
- `ipptAwardColor` (`js/ippt-scoring.js`)
- `upsertLocal` (`js/parade-tab.js`)
- `DEFAULT_CONFIG.dutyReminderBody` (`js/state.js`)
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

**Untested surface**

_687 of 1098 declarations are named by no test file._ Full list in `docs/codebase-map.json` → `markers.untested`. Being named by a test is not proof of meaningful coverage — see the trust table.
<!-- GENERATED:markers:end -->

## Assets

`index.html` and `styles.css` have no automated test coverage of any kind, so these mechanical
checks are the only safety net they have.

<!-- GENERATED:assets:start -->
**Script load order** (`index.html`) — with no module system this order *is* the dependency graph

1. `styles.css` — `?v=133`
2. `vendor/chart.umd.min.js` — `?v=114`
3. `vendor/papaparse.min.js` — `?v=114`
4. `vendor/exceljs.min.js` — `?v=114`
5. `js/state.js` — `?v=129`
6. `js/api.js` — `?v=128`
7. `js/ippt-scoring.js` — `?v=113`
8. `js/calc.js` — `?v=8`
9. `js/helpers.js` — `?v=148`
10. `js/sick-history-import.js` — `?v=114`
11. `js/duty-points.js` — `?v=1`
12. `js/duty-eligibility.js` — `?v=1`
13. `js/duty-import.js` — `?v=1`
14. `js/render.js` — `?v=178`
15. `js/render-dashboard.js` — `?v=1`
16. `js/render-records.js` — `?v=1`
17. `js/render-conducts.js` — `?v=1`
18. `js/render-statusboard.js` — `?v=1`
19. `js/forms.js` — `?v=179`
20. `js/forms-import.js` — `?v=1`
21. `js/forms-records.js` — `?v=2`
22. `js/forms-reports.js` — `?v=2`
23. `js/forms-conducts.js` — `?v=1`
24. `js/forms-wizard.js` — `?v=1`
25. `js/forms-admin.js` — `?v=1`
26. `js/braves-parade.js` — `?v=140`
27. `js/actions.js` — `?v=1`
28. `js/parade-tab.js` — `?v=26`
29. `js/render-duty.js` — `?v=1`
30. `js/sync.js` — `?v=126`
31. `js/main.js` — `?v=123`

**Cache-bust drift** — source committed more recently than its `?v=` was bumped

- `js/state.js` (`?v=129`) — source touched 2026-08-03T15:02:22+08:00, version last bumped 2026-08-03T14:59:07+08:00
- `js/duty-import.js` (`?v=1`) — source touched 2026-08-03T15:02:22+08:00, version last bumped 2026-08-03T14:59:07+08:00

**Dead CSS candidates** — 2 of 116 classes

`.sb-td`, `.pc-cph__row`

**DOM ids declared in `index.html` but never queried** — 3

`#main`, `#sidebar-footer`, `#topbar`

**DOM ids queried in JS but absent from `index.html`** — 117

Expected: most ids are built at runtime into `#content`. Listed in `docs/codebase-map.json` → `assets.domIds.queriedOnly` if you need them.
<!-- GENERATED:assets:end -->
