# Five backlog fixes — design

**Date:** 2026-08-10
**Branch:** `fix/backlog-coercion-pills-colours-status`
**Baseline:** `master` @ `bc5ff5c` (merge of PR #141)

Five independent defects from a user backlog dump. They share no code and no
data. They ship as one branch because each is a handful of lines and five
branches would cost five cache-bust rounds for no review benefit.

A sixth backlog item — encrypting the localStorage cache — is deliberately **not**
here. It changes the app's launch path and needs its own brainstorm and spec.

---

## 1 · Duty ISO dates are coerced by Sheets

**Defect.** `Duty.date`, `DutyCorrection.date` and `Holidays.date` hold ISO
`YYYY-MM-DD` (`apps-script-Code.gs` header, Duty schema). None of the three
appears in `WRITE_TEXT_COLS_BY_TAB` (`apps-script-Code.gs:2581`). Sheets parses
`"2026-09-01"` into a real Date on write, and `readTab`'s Date branch
(`apps-script-Code.gs:2389`) re-serves any Date at or after 1900 as
`"dd MMM yyyy"`. Every duty date therefore comes back as `"01 Sep 2026"` — a
different string from the one written, against which nothing compares.

This is the documented coercion trap that produced the Attendance-participants
(#33) and conduct-time (#69) corruption bugs, and it is the same reasoning PR
#135 applied to `DutyUnavailable.from`/`to` and PR #140 to
`DutyChangeRequest.date`/`swapDate`. Those two tabs were protected; these three
were missed.

**Why nobody has hit it.** The duty list feature has not been used at all — no
real duty data has ever been imported (`HANDOFF_2026-08-03_DUTY-LIST.md`). The
bug is latent, not dormant-after-damage.

**Fix.** Add `date` to the `WRITE_TEXT_COLS_BY_TAB` entries for `Duty`,
`DutyCorrection` and `Holidays`. Backend-only. Requires a redeploy; no
migration.

**Explicitly not doing:** a read-side ISO repair in `normalizeDuty` /
`normalizeDutyCorrection` / `normalizeHolidays` (`js/state.js:819`). It was
considered and dropped: with all three tabs empty on the live sheet there are no
mangled rows to heal, so it would ship as dead code guarding a state that has
never existed. Revisit only if a sheet is ever found carrying `"01 Sep 2026"` in
one of these columns.

**Verification.** A backend test asserting the three tabs' text-column entries,
in the same shape as the existing `DutyUnavailable` / `DutyChangeRequest`
assertions. The round-trip itself is not observable without a live sheet.

---

## 2 · Lookahead pill highlight does not update on click

**Defect.** `setParadeLookahead` calls `refreshParade()`
(`js/parade-tab.js:98`), which re-renders only `#parade-body`
(`js/parade-tab.js:215`). The pill toolbar is built at `js/parade-tab.js:196`,
*outside* that div, so its `.active` class is never repainted. The horizon
genuinely changes and the message below updates correctly; only the highlight
lies about which pill is selected.

Pre-existing on `master`, affects `Off / 7d / 14d / 30d / All` identically.
Flagged as a residual limit in PR #141 and deferred there.

**Fix.** Extract the `on` predicate (`js/parade-tab.js:200`) into a
`paintLookaheadPills()` that toggles `.active` across the toolbar's buttons, and
call it from both `renderParade` and `setParadeLookahead`. Give the
`.filter-role-group` an id so the function has something to query.

**Rejected alternative:** making `setParadeLookahead` call `render()`, the way
the dashboard twin does (`js/render-dashboard.js:1024`). That would re-enter
`paradeAutoTypeInit()` and `paradeStartLpFlipTimer()`
(`js/parade-tab.js:155-156`) on every pill click. Whether the LP flip timer is
idempotent has not been established, and a duplicated one-minute interval would
be an invisible leak that only shows up as the parade type flipping twice.
Repainting two class attributes is both cheaper and free of that question.

**Note, not fixed here:** the dashboard's own Lookahead pills do not have this
bug, because that setter re-renders everything. The two surfaces are left
structurally different.

**Verification.** Manual, in a browser. The suite has no DOM harness, so the
pill toolbar has no automated coverage — the same limit PR #141 recorded for
these controls.

---

## 3 · Status trend chart colours

**Defect.** On the person card's status trend chart, MC and Excuse read wrong.
The palette is `statusColor` at `js/forms.js:725`, consumed by the Chart.js
point colours at `js/forms.js:809`.

**Current → wanted:**

| Status | Now | Wanted |
|---|---|---|
| `MC`, `Warded` | `#F85149` red | unchanged |
| `LD` | `#D29922` orange | `#E3B341` yellow |
| every `Excuse *` (20 entries) | `#E3B341` yellow | `#58A6FF` blue |
| `RIB (Rest in Bunk)` | `#E3B341` yellow | `#BC8CFF` purple |
| `RMJ` | `#D29922` orange | unchanged |

`RIB` moves because it currently shares `#E3B341` with the Excuses, and LD is
taking that value — leaving RIB there would make LD and RIB indistinguishable.
Purple is what `medTagBadge` (`js/helpers.js:713`) already gives RIB, so this
moves the chart toward the badge palette rather than inventing a colour.

**Scope.** This chart only. Two other LD/Excuse palettes exist and are **not**
touched:

- `medTagBadge` (`js/helpers.js:709`) — LD orange, Excuse purple. Drives badges
  across roster, person card, medical list.
- Status Board grid (`js/render-statusboard.js:24`) — LD grey, Excuse bronze,
  with a legend at `js/render-statusboard.js:397`.

The three palettes already disagree with each other on `master`. Reconciling
them is a larger judgement call about a shared status-colour token and is out of
scope; this change makes the chart internally coherent, nothing more.

**Verification.** Manual, in a browser, against a person with a mixed status
history. No automated coverage — the chart is Chart.js output.

---

## 4 · Excuse Camo blocks conduct participation

**Defect.** `statusParticipates` (`js/helpers.js:483`) returns `true` for
exactly one built-in status, `NIL`; everything else falls through to `false`.
The conduct wizard reads it to seed the not-participating tick
(`js/forms-wizard.js:254`), so every Excuse defaults the recruit *out* of the
conduct. Several excuses do not restrict training at all — Excuse Camo is the
reported one.

**Fix.** Add a `BUILTIN_STATUS_PARTICIPATES` map beside `statusParticipates`,
consulted **after** the custom-status override and **before** the `false`
fallback. Resolution order becomes: custom override → built-in default → false.

Participating by default:

- `Excuse Camo`
- `Excuse Sunlight`
- `Excuse Shoes`
- `Excuse Uniform`
- `Excuse Loud Noise`

Everything else in `STATUS_GROUPS` (`js/helpers.js:457`) keeps `false`,
including the excuses that do restrict training — `Excuse PT`, `Excuse Heavy
Load`, `Excuse Kneeling`, `Excuse Squatting`, `Excuse Swimming`, `Excuse
Prolonged Standing`, `Excuse Upper Limb`, `Excuse Lower Limb`, `Excuse FLEGS`,
`Excuse Stay In`, `Excuse RMJ` — plus `MC`, `Warded`, `LD`, `RIB`, `RMJ`,
`Pending`.

The map is a default, not a rule. `addCustomStatus` (`js/helpers.js:472`)
matches on name case-insensitively, so saving a custom status named
`"Excuse Camo"` already overrides the built-in — that path exists today and
keeps working. The wizard's tick also stays editable per row, as it always was.

**KIV — deferred, not part of this branch: a status-participation editor.**
There is currently no screen listing statuses with their `participates` flag.
The only way to set one is a checkbox inside the medical form
(`js/forms.js:1124`, `js/forms.js:1160`), reachable only while saving a medical
record, and it offers no way to see or revise an existing flag. A small admin
list — every built-in and custom status, one toggle each, writing through
`addCustomStatus` — would make the defaults above adjustable without a code
change. It is most of this item's work and none of its value today, so it is
deferred to its own task.

**Verification.** Unit tests on `statusParticipates`: a participating built-in,
a restrictive built-in, `NIL`, a ghost suffix (`Excuse Camo` has none, but
`medStatusBaseFamily` stripping must still be exercised), and a custom override
beating a built-in default in **both** directions — a custom `false` over a
built-in `true`, and a custom `true` over a built-in `false`. The override
precedence is the part most likely to regress silently.

---

## 5 · Future-dated MA reads as RSI on the parade state

**Defect.** The `isRS` guard (`js/braves-parade.js:371`) excludes
`type === "MR"` but not `type === "MA"`. Its second disjunct is
`m.status === "Pending" && medStatusActive(m, dateIso)`, and `medStatusActive`
for a Pending record is simply `todayIso === start` (`js/helpers.js:540`).

So a Medical Appointment booked ahead with status **Pending** — the natural
choice, since the MO outcome is unknown when you book — sits quiet until its
date arrives, then satisfies both halves and is pushed into REPORTING SICK,
labelled `RSI` (the label is `RSO` only for `type === "RSO"`,
`js/braves-parade.js:375`). The person is then simultaneously listed under OTHERS by
the MA branch at `js/braves-parade.js:430`, so they double-list.

This is the same failure the `!== "MR"` exclusion was added to prevent, and the
comment above it already states the principle: a visit that has its own section
must not also satisfy the Pending clause.

**Fix.** Add `m.type !== "MA"` to the `isRS` guard, and extend the comment above
it to name both exclusions and why.

**Deliberately unchanged:** `medStatusActive`'s Pending semantics. Changing them
would move every Pending status on every surface, to fix one misrouted visit
type. The guard is where MR is handled and it is where MA belongs.

**Port parity.** `js/braves-parade.js` is hand-ported into
`apps-script-Code.gs` for the archive cron, and
`test/parade-port-parity.test.js` guards the two copies. This change **must** be
mirrored into the GAS copy or that test fails.

**Verification.** A unit test on `bpClassifyPerson`: a `type: "MA"`,
`status: "Pending"` record dated today must appear in `others` and **not** in
`reportingSick`. Plus a negative control — a genuine `type: "RSI"`,
`status: "Pending"` record dated today still lands in `reportingSick`, so the
guard is proven not to have swallowed the real case.

---

## Cross-cutting

**Files touched:** `apps-script-Code.gs` (items 1, 5-port), `js/parade-tab.js`
(2), `js/forms.js` (3), `js/helpers.js` (4), `js/braves-parade.js` (5).

**Cache-bust:** `js/parade-tab.js`, `js/forms.js`, `js/helpers.js` and
`js/braves-parade.js` each need their `?v=` bumped in `index.html`, **after**
the last edit to each file — bumping early served stale JS for a stretch of the
2026-08-03 session.

**Deploy:** `apps-script-Code.gs` must be redeployed for item 1 to take effect.
No migration, and no ordering constraint against the frontend: an un-redeployed
backend simply keeps coercing dates on a feature nobody is using yet.

**Codebase map:** not regenerated. Per `CLAUDE.md`, regenerate only on request;
`test/map-freshness.test.js` warns and never fails.

## Out of scope

- Encrypting the localStorage cache — its own spec.
- A status-participation editor — KIV, see item 4.
- Reconciling the three LD/Excuse palettes — see item 3.
- The dashboard's Lookahead pills — see item 2.
- `bpGridCell` has no MA branch (`js/braves-parade.js:583`), so an MA-only
  person shows blank on the Status Board grid despite being classified into
  OTHERS. Found while tracing item 5, unrelated to it, left alone.
