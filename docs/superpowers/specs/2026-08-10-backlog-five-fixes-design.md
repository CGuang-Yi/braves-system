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

## 3 · Dashboard Status Trend chart has no status colours

**Defect.** The Dashboard's Status Trend line chart
(`buildStatusTrendChart`, `js/render-dashboard.js:937`) assigns colours by
**series index**, not by status:

```js
const palette = ["#F85149", "#D29922", "#58A6FF", "#3FB950", "#BC8CFF", …];
borderColor: palette[i % palette.length]
```

`statusTrendSeries` sorts its series by peak count descending
(`js/helpers.js:980`), so the index — and therefore the colour — is a function
of the data. Excuse is red today only because it is the largest line; the day MC
overtakes it, the two swap. This is not a wrong palette, it is the absence of
one, and it is why the chart currently reads MC as orange and Excuse as red.

**Fix.** A `STATUS_TREND_COLORS` map from series label to colour, with the
existing index palette kept as the fallback for labels not in it — custom
statuses and the synthesised `"Other"` bucket must still get a colour.

| Series label | Colour |
|---|---|
| `MC`, `Warded` | `#F85149` red |
| `LD` | `#E3B341` yellow |
| `Excuse` (the collapsed line) | `#58A6FF` blue |
| `RMJ` | `#D29922` orange |
| `RIB (Rest in Bunk)` | `#3FB950` green |
| `Pending` | `#BC8CFF` purple |
| `NIL` | `#43C59E` teal |
| anything else | index palette, as today |

`RIB` and `Pending` keep the colours they happen to have in the current
screenshot; naming them in the map is what stops those colours moving when the
data does.

**Note — the label is `Excuse`, singular.** `statusTrendSeries` collapses every
status beginning with `Excuse` into one line (`js/helpers.js:975`), so the map
needs one entry, not twenty. The test is `indexOf("Excuse") === 0` and is
**case-sensitive**: a custom status stored as `"EXCUSE BOOTS"` escapes the
collapse and draws its own line off the fallback palette. That is existing
behaviour and is not changed here — but see item 4, which adds a correctly-cased
`Excuse Boots` built-in that *will* collapse.

**Scope.** This chart only. Three other status palettes exist and are **not**
touched:

- The person card's own status timeline (`statusColor`, `js/forms.js:725`) — LD
  orange, Excuse yellow.
- `medTagBadge` (`js/helpers.js:709`) — LD orange, Excuse purple. Drives badges
  across roster, person card, medical list.
- Status Board grid (`js/render-statusboard.js:24`) — LD grey, Excuse bronze,
  legend at `js/render-statusboard.js:397`.

All four disagree with each other on `master`. Reconciling them behind a shared
status-colour token is a larger judgement call and is out of scope.

**Verification.** Manual, in a browser, against seeded state with several
statuses live. Optionally a unit test that the map covers every label
`statusTrendSeries` can emit for the built-in status list — cheap, and it is
what would catch a new built-in status silently falling back to the index
palette.

---

## 4 · Excuse Camo blocks conduct participation

**Defect.** `statusParticipates` (`js/helpers.js:483`) returns `true` for
exactly one built-in status, `NIL`; everything else falls through to `false`.
The conduct wizard reads it to seed the not-participating tick
(`js/forms-wizard.js:254`), so every Excuse defaults the recruit *out* of the
conduct. Several excuses do not restrict training at all — Excuse Camo is the
reported one.

**Fix, part A — a new built-in status.** Add `Excuse Boots` to the Excuses
group. It must be added at **four** enumeration sites, all of which list the
excuses by hand:

- `STATUS_GROUPS` (`js/helpers.js:457`) — the dropdown's source of truth.
- `statusOrder` (`js/forms.js:696`) — the person card's status ordering.
- `statusColor` (`js/forms.js:729`) — the person-card timeline palette, which
  enumerates every Excuse individually; an omitted entry falls to a default
  colour.
- `test/status-enum.test.js:11` — the enum assertion.

Note the company's existing rows are stored as `"EXCUSE BOOTS"` in caps and will
**not** match the new built-in — they stay a custom status until re-entered.
That is a data question, not a code one, and this branch does not migrate them.

**Fix, part B — participation defaults.** Add a `BUILTIN_STATUS_PARTICIPATES`
map beside `statusParticipates`, consulted **after** the custom-status override
and **before** the `false` fallback. Resolution order becomes: custom override →
built-in default → false.

Participating by default (does **not** restrict training):

- `Excuse Camo`
- `Excuse Uniform`
- `Excuse Loud Noise`
- `Excuse Boots` (new)

Everything else in `STATUS_GROUPS` keeps `false` — including `Excuse Sunlight`
and `Excuse Shoes`, which **do** restrict training, alongside `Excuse PT`,
`Excuse Heavy Load`, `Excuse Kneeling`, `Excuse Squatting`, `Excuse Swimming`,
`Excuse Prolonged Standing`, `Excuse Upper Limb`, `Excuse Lower Limb`,
`Excuse FLEGS`, `Excuse Stay In`, `Excuse RMJ`, and `MC`, `Warded`, `LD`, `RIB`,
`RMJ`, `Pending`.

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

**Verification.** Unit tests on `statusParticipates`: a participating built-in
(`Excuse Camo`), a restrictive built-in that is easy to get backwards
(`Excuse Sunlight` — it reads permissive and is not), `NIL`, a ghost suffix
(`Excuse Camo` has none, but `medStatusBaseFamily` stripping must still be
exercised), and a custom override beating a built-in default in **both**
directions — a custom `false` over a built-in `true`, and a custom `true` over a
built-in `false`. The override precedence is the part most likely to regress
silently. `test/status-enum.test.js` covers `Excuse Boots` reaching the
dropdown.

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
(2), `js/render-dashboard.js` (3), `js/helpers.js` (4), `js/forms.js` (4),
`js/braves-parade.js` (5), `test/status-enum.test.js` (4).

**Cache-bust:** `js/parade-tab.js`, `js/render-dashboard.js`, `js/helpers.js`,
`js/forms.js` and `js/braves-parade.js` each need their `?v=` bumped in
`index.html`, **after** the last edit to each file — bumping early served stale
JS for a stretch of the 2026-08-03 session.

`js/helpers.js` is the one to watch: item 4 adds `Excuse Boots` to
`STATUS_GROUPS` there, and `js/forms.js` enumerates the same list. A returning
user who fetched a new `forms.js` against a cached `helpers.js` would get a
dropdown and an ordering that disagree. Both bumps are mandatory, not
cosmetic — this is the exact shape of the `nowHHMM` defect PR #141 had to
patch after the fact.

**Deploy:** `apps-script-Code.gs` must be redeployed for item 1 to take effect.
No migration, and no ordering constraint against the frontend: an un-redeployed
backend simply keeps coercing dates on a feature nobody is using yet.

**Codebase map:** not regenerated. Per `CLAUDE.md`, regenerate only on request;
`test/map-freshness.test.js` warns and never fails.

## Out of scope

- Encrypting the localStorage cache — its own spec.
- A status-participation editor — KIV, see item 4.
- Reconciling the four status palettes behind a shared token — see item 3.
- Migrating the existing all-caps `"EXCUSE BOOTS"` rows onto the new
  correctly-cased built-in — see item 4.
- The dashboard's Lookahead pills — see item 2.
- `bpGridCell` has no MA branch (`js/braves-parade.js:583`), so an MA-only
  person shows blank on the Status Board grid despite being classified into
  OTHERS. Found while tracing item 5, unrelated to it, left alone.
