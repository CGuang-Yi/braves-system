# Five Backlog Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five unrelated defects — coercion-prone duty date columns, a stale
lookahead pill highlight, an index-assigned status chart palette, Excuse
statuses that wrongly block conduct participation, and a Pending medical
appointment misrouting to REPORTING SICK.

**Architecture:** No new modules and no new abstractions. Each task edits an
existing file in place, follows the pattern already established next to it, and
carries its own test. The five tasks are independent — they share no code and no
data — so they may be implemented in any order, but Task 6 (cache-bust) must run
last because it depends on every file edit being final.

**Tech Stack:** Vanilla JS, no build step, no bundler. Google Apps Script
backend (`apps-script-Code.gs`). Zero-dependency TAP test harness under `test/`
(`node test/run.js`, auto-discovers `*.test.js`). ESLint in script mode,
`tsc --noEmit` over a short opt-in file list.

**Spec:** `docs/superpowers/specs/2026-08-10-backlog-five-fixes-design.md`

## Global Constraints

- **Branch:** `fix/backlog-coercion-pills-colours-status`, off `master` @ `bc5ff5c`.
- **No build step.** Files are loaded as plain `<script>` tags sharing one global
  scope. Never add `import`/`export`/`require` to anything under `js/`.
- **Load order is load-bearing.** `state → api → ippt-scoring → calc →
  appointment-4d → helpers → sick-history-import → render* → forms* →
  braves-parade → actions → parade-tab → sync → main`. Do not reorder
  `index.html` script tags.
- **`js/braves-parade.js` is hand-ported into `apps-script-Code.gs`** inside the
  `BRAVES-ARCHIVE-PORT` markers. Any behavioural change to the classifier must
  be mirrored by hand or `test/parade-port-parity.test.js` fails.
- **Cache-bust `?v=` bumps happen AFTER the last edit to a file**, never before.
  Bumping early served stale JS for a stretch of the 2026-08-03 session.
- **Commit convention:** see `COMMIT_CONVENTIONS.md`. **No `Co-Authored-By`
  trailer** — see the `no-coauthor-trailer.md` memory.
- **Do not run `npm run map`.** The codebase map is regenerated only on explicit
  request; `test/map-freshness.test.js` warns by design and never fails.
- **Verification commands:** `npm test` (expect **1069 passing / 0 failed** at
  baseline, rising as tasks add tests), `npm run lint:errors`, `npm run typecheck`.

---

## File Structure

| File | Task | Responsibility after the change |
|---|---|---|
| `apps-script-Code.gs` | 1, 5 | `WRITE_TEXT_COLS_BY_TAB` gains three `date` entries; the ported `isRS` guard gains the MA exclusion |
| `test/duty-date-coercion.test.js` | 1 | **new** — asserts the three date columns are forced to `"@"` |
| `js/parade-tab.js` | 2 | `paintLookaheadPills()` extracted; toolbar gets an id |
| `js/render-dashboard.js` | 3 | `STATUS_TREND_COLORS` map, index palette kept as fallback |
| `js/helpers.js` | 4 | `Excuse Boots` in `MED_STATUS_GROUPS`; `BUILTIN_STATUS_PARTICIPATES` |
| `js/forms.js` | 4 | `Excuse Boots` in `statusOrder` and the timeline `statusColor` |
| `test/status-enum.test.js` | 4 | `Excuse Boots` added to the required list |
| `test/status-participates.test.js` | 4 | **new** — participation defaults and override precedence |
| `js/braves-parade.js` | 5 | `isRS` guard excludes type `MA` |
| `test/parade-ma-not-rs.test.js` | 5 | **new** — a Pending MA lands in OTHERS, not REPORTING SICK |
| `index.html` | 6 | five `?v=` bumps |

---

## Task 1: Protect duty ISO date columns from Sheets coercion

**Files:**
- Modify: `apps-script-Code.gs:2581`
- Test: `test/duty-date-coercion.test.js` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on.

**Background you need.** `writeTab` and the row-level writers call
`bravesForceTextCols_` / `forceTextColsForRange_`, which look up the tab in
`WRITE_TEXT_COLS_BY_TAB` and call `setNumberFormat("@")` on those columns
*before* writing. Any column not listed is left in Sheets' General format, where
the string `"2026-09-01"` is parsed into a real Date. `readTab` then re-serves
any Date at or after 1900 as `"dd MMM yyyy"` (`apps-script-Code.gs:2389`), so the
value comes back as `"01 Sep 2026"` — a different string from the one written.

The test harness's fake spreadsheet does **not** simulate coercion, so asserting
`row.date === "2026-09-01"` would pass even without the fix and prove nothing.
The load-bearing assertion is `b.db.numberFormat(tab, col)`, which records the
format actually applied. Column indices are **1-based**.

- [ ] **Step 1: Write the failing test**

Create `test/duty-date-coercion.test.js`:

```js
// The duty tabs store ISO YYYY-MM-DD dates. Without a WRITE_TEXT_COLS_BY_TAB
// entry Sheets parses "2026-09-01" into a real Date, and readTab re-serves it as
// "01 Sep 2026" — a different string from the one written, against which the
// duty grid's lexicographic comparisons match nothing. Same trap as the
// Attendance-participants (#33) and conduct-time (#69) corruption bugs.
//
// The fake spreadsheet does not coerce, so asserting the value round-trips would
// pass without the fix. numberFormat is what proves the "@" was applied.
const { suite, test, eq } = require("./_tap");
const { loadBackend } = require("./harness");

module.exports = async function run() {
  suite("duty tabs: ISO date columns are forced to plain text");

  await test("Duty.date is forced to '@'", () => {
    const b = loadBackend();
    b.db.seed("Duty", ["id", "date", "dutyType", "platoon", "d4", "assignedBy", "assignedAt", "source"], []);
    const r = b.writeTab("Duty", [{
      id: 1, date: "2026-09-01", dutyType: "Guard", platoon: "PLT3",
      d4: "0042", assignedBy: "0001", assignedAt: "2026-08-10T00:00:00Z", source: "manual"
    }]);
    eq(r.ok, true, "write ok");
    eq(b.db.numberFormat("Duty", 2), "@", "date is the 2nd header and must be plain text");
    eq(b.db.numberFormat("Duty", 5), "@", "d4 stays protected — this must not regress");
  });

  await test("DutyCorrection.date is forced to '@'", () => {
    const b = loadBackend();
    b.db.seed("DutyCorrection", ["id", "date", "d4", "reason", "delta", "note", "enteredBy", "enteredAt"], []);
    b.writeTab("DutyCorrection", [{
      id: 1, date: "2026-09-01", d4: "0042", reason: "Swap", delta: -1,
      note: "", enteredBy: "0001", enteredAt: "2026-08-10T00:00:00Z"
    }]);
    eq(b.db.numberFormat("DutyCorrection", 2), "@", "date is the 2nd header");
    eq(b.db.numberFormat("DutyCorrection", 3), "@", "d4 stays protected");
  });

  await test("Holidays.date is forced to '@'", () => {
    const b = loadBackend();
    b.db.seed("Holidays", ["date", "name", "tentative"], []);
    b.writeTab("Holidays", [{ date: "2026-09-01", name: "Test Day", tentative: "" }]);
    eq(b.db.numberFormat("Holidays", 1), "@", "date is the 1st header");
  });

  await test("a tab with no coercion-prone columns is still left alone", () => {
    // Negative control: proves the fix added entries rather than blanket-forcing
    // every column on every tab.
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    b.writeTab("Medical", [{ id: 1, reason: "fever" }]);
    eq(b.db.numberFormat("Medical", 1), null, "Medical is not needlessly forced");
  });
};
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test 2>&1 | grep -A4 "duty tabs: ISO date"
```

Expected: the first three tests FAIL with `numberFormat` returning `null`
instead of `"@"`. The fourth (negative control) PASSES already.

- [ ] **Step 3: Add the three entries**

In `apps-script-Code.gs:2581`, change the `Duty`, `DutyCorrection` and
`Holidays` entries. The line is long; edit only these three keys, leaving every
other key byte-identical.

Before:
```js
Duty: ["d4"], DutyCorrection: ["d4"], DutyUnavailable: ["d4", "from", "to"], DutyChangeRequest: ["fromD4", "toD4", "date", "swapDate"] };
```

After (note `Holidays` is **new** — it has no entry today, so add the key):
```js
Duty: ["d4", "date"], DutyCorrection: ["d4", "date"], Holidays: ["date"], DutyUnavailable: ["d4", "from", "to"], DutyChangeRequest: ["fromD4", "toD4", "date", "swapDate"] };
```

Then update the comment above the const so it names the ISO-date reason
alongside the leading-zero one. Add, above the line:

```js
// Duty/DutyCorrection/Holidays `date` is ISO YYYY-MM-DD, not the "01 Jan 2026"
// form older tabs use. Left in General format Sheets parses it into a real Date
// and readTab re-serves it as "01 Sep 2026", so the grid's lexicographic date
// comparisons stop matching. Same class of bug as the leading-zero 4Ds beside it.
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm test 2>&1 | tail -5
```

Expected: 4 new tests passing, total up 4 from baseline, **0 failed**.

- [ ] **Step 5: Commit**

```bash
git add apps-script-Code.gs test/duty-date-coercion.test.js
git commit -m "fix(backend): stop Sheets coercing the duty tabs' ISO dates"
```

---

## Task 2: Repaint the lookahead pills on click

**Files:**
- Modify: `js/parade-tab.js:98` (the setter), `js/parade-tab.js:197-204` (the toolbar markup)
- Test: none — see the note at the end of this task

**Interfaces:**
- Consumes: nothing.
- Produces: `paintLookaheadPills()` — no arguments, returns nothing. Reads
  module-level `_paradeLookahead`. Safe to call when the toolbar is absent.

**Background you need.** `renderParade` builds a toolbar and then a
`<div id="parade-body">`, and `refreshParade()` re-renders **only** that body.
The lookahead pills live in the toolbar, outside it, so clicking one changes the
horizon (the message below updates correctly) but never repaints the `.active`
class. Every other toolbar control is a `<select>` or `<input>` that holds its
own visual state, which is why only the pills show the bug.

Do **not** fix this by calling `render()`. That is what the dashboard twin does
(`js/render-dashboard.js:1024`), and here it would re-enter `paradeAutoTypeInit()`
and `paradeStartLpFlipTimer()` on every click; the flip timer's idempotency has
not been established and a duplicated one-minute interval is an invisible leak.

- [ ] **Step 1: Add the id and the shared options list**

In `js/parade-tab.js`, just above `function setParadeLookahead` (line 98), add:

```js
// The pill toolbar is rendered OUTSIDE #parade-body, so refreshParade() — which
// only re-renders that div — cannot repaint it. Both the initial render and the
// setter go through this one function so the ".active" pill and _paradeLookahead
// cannot disagree. Deliberately not a render(): a full re-render would re-enter
// paradeAutoTypeInit() and paradeStartLpFlipTimer() on every click.
const PARADE_LOOKAHEAD_OPTS = [["0", "Off"], ["7", "7d"], ["14", "14d"], ["30", "30d"], ["all", "All"]];
const paradeLookaheadOn = v => (v === "all") ? _paradeLookahead === Infinity : Number(v) === _paradeLookahead;
function paintLookaheadPills() {
  const host = document.getElementById("parade-lookahead");
  if (!host) return;
  host.querySelectorAll("button[data-value]").forEach(b => {
    b.classList.toggle("active", paradeLookaheadOn(b.dataset.value));
  });
}
```

- [ ] **Step 2: Call it from the setter**

Change `js/parade-tab.js:98` from:

```js
function setParadeLookahead(v) { _paradeLookahead = (v === "all") ? Infinity : Number(v) || 0; refreshParade(); }
```

to:

```js
function setParadeLookahead(v) { _paradeLookahead = (v === "all") ? Infinity : Number(v) || 0; paintLookaheadPills(); refreshParade(); }
```

- [ ] **Step 3: Rewrite the toolbar markup to use the shared list**

Replace `js/parade-tab.js:199-203` (the `<div class="filter-role-group">` block
inside the Lookahead form-group). Before:

```js
          <div class="filter-role-group">
            ${[["0", "Off"], ["7", "7d"], ["14", "14d"], ["30", "30d"], ["all", "All"]].map(([v, l]) => {
              const on = (v === "all") ? _paradeLookahead === Infinity : Number(v) === _paradeLookahead;
              return `<button type="button" class="role-btn${on ? " active" : ""}" data-action="paradeLookahead" data-value="${v}">${l}</button>`;
            }).join("")}
          </div>
```

After:

```js
          <div class="filter-role-group" id="parade-lookahead">
            ${PARADE_LOOKAHEAD_OPTS.map(([v, l]) =>
              `<button type="button" class="role-btn${paradeLookaheadOn(v) ? " active" : ""}" data-action="paradeLookahead" data-value="${v}">${l}</button>`
            ).join("")}
          </div>
```

- [ ] **Step 4: Verify lint and the suite still pass**

```bash
npm run lint:errors && npm test 2>&1 | tail -3
```

Expected: lint clean (this is the only check that `paintLookaheadPills` and
`paradeLookaheadOn` resolve — there is no compiler here). Test count unchanged
from Task 1, **0 failed**.

- [ ] **Step 5: Verify in a browser**

The suite has **no DOM harness**, so this control has no automated coverage —
the same limit PR #141 recorded. Open `index.html`, go to the Parade State tab,
and click each of `Off / 7d / 14d / 30d / All` in turn. Confirm the clicked pill
takes the `.active` highlight and the previous one loses it, and that the
message body below still changes with the horizon. Check the console is clean.

- [ ] **Step 6: Commit**

```bash
git add js/parade-tab.js
git commit -m "fix(parade): repaint the lookahead pills, which sit outside the refreshed body"
```

---

## Task 3: Give the Dashboard status trend chart a real palette

**Files:**
- Modify: `js/render-dashboard.js:953` and the `datasets:` map at `js/render-dashboard.js:968-973`
- Test: `test/status-trend-colors.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `STATUS_TREND_COLORS` — a plain object, series label → hex string.
  `statusTrendColor(label, i)` — returns the mapped colour, or
  `STATUS_TREND_PALETTE[i % length]` when the label is unmapped.

**Background you need.** `buildStatusTrendChart` currently colours each dataset
by its **index**: `borderColor: palette[i % palette.length]`. `statusTrendSeries`
(`js/helpers.js:980`) sorts series by peak count descending, so the index — and
therefore the colour — is a function of the data. Excuse reads red today only
because it is the tallest line; when MC overtakes it they swap. The index
palette must survive as a fallback: custom statuses and the synthesised
`"Other"` bucket still need colours, and there is no fixed set of them.

The collapsed Excuse series is labelled **`"Excuse"`, singular** — every status
whose name begins `Excuse` folds into one line (`js/helpers.js:975`). So the map
needs one entry, not twenty.

- [ ] **Step 1: Write the failing test**

Create `test/status-trend-colors.test.js`:

```js
// The Dashboard status trend chart used to colour series by INDEX, and
// statusTrendSeries sorts by peak count — so a status's colour changed whenever
// the data did. These tests pin the label→colour map and, just as importantly,
// pin that unmapped labels still fall back to the index palette (custom statuses
// and the synthesised "Other" bucket have no entry and still need a colour).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

// The Proxy's `has: () => true` is what lets render-dashboard.js load at all in
// a bare context: it references plenty of globals from other <script> tags, and
// without it a bare identifier throws ReferenceError at load. Values are read by
// EVALUATING inside the context rather than off the sandbox object — the pattern
// test/status-enum.test.js uses, and the reliable one.
function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "render-dashboard.js"), "utf8");
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(src, ctx, { filename: "render-dashboard.js" });
  return {
    color: (label, i) => vm.runInContext(`statusTrendColor(${JSON.stringify(label)}, ${i})`, ctx),
    paletteAt: i => vm.runInContext(`STATUS_TREND_PALETTE[${i}]`, ctx),
    hasKey: k => vm.runInContext(`Object.prototype.hasOwnProperty.call(STATUS_TREND_COLORS, ${JSON.stringify(k)})`, ctx)
  };
}

module.exports = async function run() {
  suite("status trend chart: colours are keyed by status, not by series index");

  const sb = load();

  await test("each named status gets its assigned colour", () => {
    const want = {
      "MC": "#F85149", "Warded": "#F85149", "LD": "#E3B341", "Excuse": "#58A6FF",
      "RMJ": "#D29922", "RIB (Rest in Bunk)": "#3FB950", "Pending": "#BC8CFF", "NIL": "#43C59E"
    };
    for (const label of Object.keys(want)) {
      eq(sb.color(label, 0), want[label], "wrong colour for " + label);
    }
  });

  await test("a mapped colour does not move when the series index moves", () => {
    // This is the actual defect: a status's colour was a function of its rank by
    // peak count, so it changed whenever the data did.
    eq(sb.color("LD", 0), sb.color("LD", 5), "LD moved with its index");
  });

  await test("an unmapped label still falls back to the index palette", () => {
    // Custom statuses and the "Other" bucket have no entry and must still draw.
    ok(sb.color("EXCUSE BOOTS", 0), "custom status got no colour");
    eq(sb.color("Other", 1), sb.paletteAt(1), "fallback is not the index palette");
  });

  await test("the collapsed Excuse series is keyed singular", () => {
    // statusTrendSeries folds every "Excuse *" into one line labelled "Excuse".
    // A map keyed on the individual excuses would never be hit.
    ok(sb.hasKey("Excuse"), "no 'Excuse' key");
    ok(!sb.hasKey("Excuse Camo"), "keyed on an individual excuse");
  });
};
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test 2>&1 | grep -A4 "status trend chart:"
```

Expected: FAIL with `statusTrendColor is not a function`.

- [ ] **Step 3: Add the map and the resolver**

In `js/render-dashboard.js`, replace line 953:

```js
  const palette = ["#F85149", "#D29922", "#58A6FF", "#3FB950", "#BC8CFF", "#E3B341", "#43C59E", "#8B949E", "#484F58"];
```

with nothing — the palette moves to module scope. Add, immediately **above**
`function buildStatusTrendChart` (line 937):

```js
// Series colours are keyed by STATUS, not by series index. They used to be
// palette[i], and statusTrendSeries sorts by peak count — so a status's colour
// changed whenever the data did (Excuse read red purely because it was the
// tallest line, and would have swapped with MC the day MC overtook it).
//
// The index palette survives as the FALLBACK, not as the scheme: statuses are
// user-extensible via "＋ New custom status…", and statusTrendSeries also
// synthesises an "Other" bucket, so there is no fixed label set to enumerate.
//
// The Excuse key is SINGULAR — statusTrendSeries collapses every "Excuse *" into
// one line labelled "Excuse" (helpers.js), so a map keyed on the individual
// excuses would never be hit.
const STATUS_TREND_PALETTE = ["#F85149", "#D29922", "#58A6FF", "#3FB950", "#BC8CFF", "#E3B341", "#43C59E", "#8B949E", "#484F58"];
const STATUS_TREND_COLORS = {
  "MC": "#F85149", "Warded": "#F85149",
  "LD": "#E3B341",
  "Excuse": "#58A6FF",
  "RMJ": "#D29922",
  "RIB (Rest in Bunk)": "#3FB950",
  "Pending": "#BC8CFF",
  "NIL": "#43C59E"
};
function statusTrendColor(label, i) {
  return STATUS_TREND_COLORS[label] || STATUS_TREND_PALETTE[i % STATUS_TREND_PALETTE.length];
}
```

- [ ] **Step 4: Consume it in the dataset map**

Change `js/render-dashboard.js:968-973` from:

```js
      datasets: series.map((s, i) => ({
        label: s.label, data: s.data,
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length] + "22",
        tension: 0.3, pointRadius: dense ? 0 : 2, pointHoverRadius: 5, fill: false
      }))
```

to:

```js
      datasets: series.map((s, i) => ({
        label: s.label, data: s.data,
        borderColor: statusTrendColor(s.label, i),
        backgroundColor: statusTrendColor(s.label, i) + "22",
        tension: 0.3, pointRadius: dense ? 0 : 2, pointHoverRadius: 5, fill: false
      }))
```

- [ ] **Step 5: Run the test and lint**

```bash
npm run lint:errors && npm test 2>&1 | tail -3
```

Expected: lint clean, 4 more tests passing, **0 failed**. If lint reports
`palette` as unused or undefined, the old `const palette` line was not removed
in Step 3.

- [ ] **Step 6: Verify in a browser**

Open `index.html`, go to the Dashboard, and confirm the Status Trend chart reads
MC red, LD yellow, Excuse blue, RIB green, Pending purple. Click through the
`7d / 14d / 30d / All` range pills and confirm each status keeps its colour as
the line ordering changes — that is the actual defect, and it is only visible
across a re-scale.

- [ ] **Step 7: Commit**

```bash
git add js/render-dashboard.js test/status-trend-colors.test.js
git commit -m "fix(dashboard): key the status trend colours to the status, not the series index"
```

---

## Task 4: Excuse participation defaults, and a new Excuse Boots status

**Files:**
- Modify: `js/helpers.js:458` (`MED_STATUS_GROUPS`), `js/helpers.js:483` (`statusParticipates`)
- Modify: `js/forms.js:696` (`statusOrder`), `js/forms.js:726-730` (`statusColor`)
- Modify: `test/status-enum.test.js:10-13`
- Test: `test/status-participates.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `BUILTIN_STATUS_PARTICIPATES` — a plain object, status name → boolean.
  `statusParticipates(status)` keeps its existing signature: takes a status
  string (possibly with a `+N` ghost suffix), returns a boolean.

**Background you need.** `statusParticipates` gates the conduct wizard's
not-participating tick (`js/forms-wizard.js:254`). Today it returns `true` for
exactly one built-in, `NIL`, so every Excuse defaults the recruit *out* of the
conduct. Several excuses do not restrict training at all.

`addCustomStatus` (`js/helpers.js:472`) matches on name **case-insensitively**,
so a commander can already override a built-in by saving a same-named custom
status. That path must keep winning over the new defaults — the resolution order
is custom override → built-in default → `false`.

**Which excuses participate** (this list is the requirement; do not adjust it on
intuition — `Excuse Sunlight` and `Excuse Shoes` read permissive and are not):

| Participates | Restricts |
|---|---|
| `Excuse Camo`, `Excuse Uniform`, `Excuse Loud Noise`, `Excuse Boots` | `Excuse Sunlight`, `Excuse Shoes`, and every other status |

- [ ] **Step 1: Write the failing test**

Create `test/status-participates.test.js`:

```js
// statusParticipates gates the conduct wizard's not-participating tick. It used
// to return true for NIL alone, so every Excuse defaulted the recruit OUT of the
// conduct — including the ones that do not restrict training at all.
//
// The precedence is the part most likely to regress silently: a commander's
// saved custom status must beat the built-in default in BOTH directions, so both
// are asserted rather than just the convenient one.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok } = require("./_tap");

// Same shape as test/status-enum.test.js: helpers.js references globals from
// other <script> tags, so the Proxy's `has: () => true` is what stops a bare
// identifier throwing at load. The returned function EVALUATES inside the
// context rather than reading the declaration off the sandbox object.
function load(customStatuses) {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat,
    STATE: { customStatuses: customStatuses || [] },
    saveLocal: () => {}
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(src, ctx, { filename: "helpers.js" });
  return s => vm.runInContext(`statusParticipates(${JSON.stringify(s)})`, ctx);
}

module.exports = async function run() {
  suite("statusParticipates: built-in defaults");

  const participates = load();

  await test("Excuse Camo participates", () => {
    ok(participates("Excuse Camo") === true);
  });

  await test("Excuse Uniform, Loud Noise and Boots participate", () => {
    for (const s of ["Excuse Uniform", "Excuse Loud Noise", "Excuse Boots"]) {
      ok(participates(s) === true, s + " should participate");
    }
  });

  await test("Excuse Sunlight and Excuse Shoes RESTRICT training", () => {
    // Both read permissive and are not. This is the assertion that catches
    // someone "tidying" the map by pattern-matching on the word Excuse.
    ok(participates("Excuse Sunlight") === false, "Sunlight must restrict");
    ok(participates("Excuse Shoes") === false, "Shoes must restrict");
  });

  await test("MC, LD and Excuse PT still restrict", () => {
    for (const s of ["MC", "Warded", "LD", "RIB (Rest in Bunk)", "Excuse PT", "Excuse Heavy Load", "Pending"]) {
      ok(participates(s) === false, s + " should restrict");
    }
  });

  await test("NIL still participates", () => {
    ok(participates("NIL") === true);
  });

  await test("a ghost suffix resolves to its base family", () => {
    ok(participates("LD+1") === false, "LD+1 resolves to LD");
    ok(participates("MC+2") === false, "MC+2 resolves to MC");
  });

  suite("statusParticipates: a custom override beats the built-in default");

  await test("a custom false beats a built-in true", () => {
    const p = load([{ name: "Excuse Camo", participates: false }]);
    ok(p("Excuse Camo") === false, "the commander's override was ignored");
  });

  await test("a custom true beats a built-in false", () => {
    const p = load([{ name: "Excuse PT", participates: true }]);
    ok(p("Excuse PT") === true, "the commander's override was ignored");
  });
};
```

- [ ] **Step 2: Add Excuse Boots to `test/status-enum.test.js`**

In `test/status-enum.test.js`, change the `required` array (lines 10-13) from:

```js
  const required = [
    "Excuse FLEGS", "Excuse Sunlight", "Excuse Stay In", "Excuse PT",
    "Excuse Shoes", "Excuse Camo", "Excuse Loud Noise", "RIB (Rest in Bunk)"
  ];
```

to:

```js
  const required = [
    "Excuse FLEGS", "Excuse Sunlight", "Excuse Stay In", "Excuse PT",
    "Excuse Shoes", "Excuse Camo", "Excuse Loud Noise", "Excuse Boots",
    "RIB (Rest in Bunk)"
  ];
```

- [ ] **Step 3: Run both tests and verify they fail**

```bash
npm test 2>&1 | grep -A4 "statusParticipates:\|status enum:"
```

Expected: the participation tests FAIL (everything but NIL returns `false`), and
`status-enum` FAILs with `missing: Excuse Boots`.

- [ ] **Step 4: Add `Excuse Boots` to the status list**

In `js/helpers.js:458`, append it to the Excuses group's `options` array — put
it next to the other footwear/uniform items rather than at the end, so the
dropdown reads sensibly:

```js
  { label: "Excuses",                 options: ["Excuse Heavy Load", "Excuse Kneeling", "Excuse Squatting", "Excuse Uniform", "Excuse RMJ", "Excuse Swimming", "Excuse Prolonged Standing", "Excuse Upper Limb", "Excuse Lower Limb", "Excuse FLEGS", "Excuse Sunlight", "Excuse Stay In", "Excuse PT", "Excuse Shoes", "Excuse Boots", "Excuse Camo", "Excuse Loud Noise"] },
```

- [ ] **Step 5: Add the participation map**

In `js/helpers.js`, replace `statusParticipates` (lines 480-488) entirely.

Before:
```js
// Does this status mean the recruit normally still participates in conducts?
// Built-in: only NIL (MO cleared, back to active). Custom: per its saved flag.
// Strips any +N ghost suffix first so "MC+1" resolves to "MC".
function statusParticipates(status) {
  const base = medStatusBaseFamily(status);
  if (base === "NIL") return true;
  const c = customStatusByName(base);
  return c ? !!c.participates : false;
}
```

After:
```js
// Built-in statuses that do NOT restrict training. Everything absent from this
// map restricts — the safe default, since a status nobody has classified should
// keep the recruit off the conduct rather than silently onto it.
//
// Read the list carefully before editing: "Excuse Sunlight" and "Excuse Shoes"
// READ permissive and are not — both restrict training and are deliberately
// absent. This is not a pattern match on the word "Excuse".
const BUILTIN_STATUS_PARTICIPATES = {
  "NIL": true,                 // MO cleared, back to active
  "Excuse Camo": true,
  "Excuse Uniform": true,
  "Excuse Loud Noise": true,
  "Excuse Boots": true
};

// Does this status mean the recruit normally still participates in conducts?
// Resolution order: a commander's saved custom status wins, then the built-in
// default above, then false. The custom layer comes FIRST so a company that
// disagrees with a default can override it without a code change —
// addCustomStatus matches on name case-insensitively, so saving a custom
// "Excuse Camo" shadows the built-in of the same name.
// Strips any +N ghost suffix first so "MC+1" resolves to "MC".
function statusParticipates(status) {
  const base = medStatusBaseFamily(status);
  const c = customStatusByName(base);
  if (c) return !!c.participates;
  return !!BUILTIN_STATUS_PARTICIPATES[base];
}
```

- [ ] **Step 6: Add `Excuse Boots` to the two `js/forms.js` enumerations**

`js/forms.js:696` — insert into `statusOrder`, matching the dropdown's position:

```js
  const statusOrder = ["MC", "Warded", "LD", "RIB (Rest in Bunk)", "RMJ", "Excuse Heavy Load", "Excuse Kneeling", "Excuse Squatting", "Excuse Uniform", "Excuse RMJ", "Excuse Swimming", "Excuse Prolonged Standing", "Excuse Upper Limb", "Excuse Lower Limb", "Excuse FLEGS", "Excuse Sunlight", "Excuse Stay In", "Excuse PT", "Excuse Shoes", "Excuse Boots", "Excuse Camo", "Excuse Loud Noise", "Pending", "NIL"];
```

`js/forms.js:729` — this is the person-card timeline palette, which enumerates
every excuse individually. An omitted entry silently falls back to
`var(--accent)`. Change the line from:

```js
    "Excuse FLEGS": "#E3B341", "Excuse Sunlight": "#E3B341", "Excuse Stay In": "#E3B341", "Excuse PT": "#E3B341", "Excuse Shoes": "#E3B341", "Excuse Camo": "#E3B341", "Excuse Loud Noise": "#E3B341",
```

to:

```js
    "Excuse FLEGS": "#E3B341", "Excuse Sunlight": "#E3B341", "Excuse Stay In": "#E3B341", "Excuse PT": "#E3B341", "Excuse Shoes": "#E3B341", "Excuse Boots": "#E3B341", "Excuse Camo": "#E3B341", "Excuse Loud Noise": "#E3B341",
```

This is the **person card's** timeline, not the Dashboard chart from Task 3.
Leave its colours alone — Task 3's scope is explicitly the Dashboard only.

- [ ] **Step 7: Run the tests and verify they pass**

```bash
npm run lint:errors && npm test 2>&1 | tail -3
```

Expected: lint clean, 8 more tests passing, **0 failed**.

- [ ] **Step 8: Verify in a browser**

Open `index.html`. In a medical record form, confirm `Excuse Boots` appears in
the Excuses group of the status dropdown. Then open the conduct wizard for a
conduct whose participants include someone on `Excuse Camo` and confirm they are
**not** ticked as not-participating by default, while someone on
`Excuse Sunlight` **is**. The tick stays editable either way.

- [ ] **Step 9: Commit**

```bash
git add js/helpers.js js/forms.js test/status-enum.test.js test/status-participates.test.js
git commit -m "feat(medical): add Excuse Boots and let permissive excuses train"
```

---

## Task 5: Stop a Pending medical appointment reading as RSI

**Files:**
- Modify: `js/braves-parade.js:371`
- Modify: `apps-script-Code.gs:3557` (the hand-maintained port)
- Test: `test/parade-ma-not-rs.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — this is a behavioural change inside `bpClassifyPerson`.

**Background you need.** The `isRS` guard's second disjunct is
`m.status === "Pending" && medStatusActive(m, dateIso)`, and `medStatusActive`
for a Pending record is simply `todayIso === start` (`js/helpers.js:540`). A
Medical Appointment booked ahead with status **Pending** — the natural choice,
since the MO outcome is unknown when you book — sits quiet until its date
arrives, then satisfies both halves and is pushed into REPORTING SICK, labelled
`RSI`. It is *also* listed under OTHERS by the MA branch
(`js/braves-parade.js:430`), so the person double-lists.

This is exactly the failure the existing `!== "MR"` exclusion prevents, and the
comment above it already states the principle: a visit type with its own section
must not also satisfy the Pending clause.

Do **not** change `medStatusActive`'s Pending semantics. That would move every
Pending status on every surface to fix one misrouted visit type.

- [ ] **Step 1: Write the failing test**

Create `test/parade-ma-not-rs.test.js`. Note the fixture dates are
`"DD MMM YYYY"` — the real `displayDateToISO` returns `""` for ISO input, so an
ISO fixture would silently classify as nothing and the test would pass vacuously.

```js
// A Medical Appointment booked ahead with status "Pending" (the natural choice —
// the MO outcome is unknown when you book) used to land under REPORTING SICK,
// labelled RSI, on the day it came due.
//
// isRS's second disjunct is `status === "Pending" && medStatusActive(...)`, and
// medStatusActive for a Pending record is just `todayIso === start`. So the row
// sat quiet until its date arrived, then satisfied both halves — while the MA
// branch listed the same person under OTHERS, so they double-listed.
//
// Same failure the `!== "MR"` exclusion already prevents, for the same reason.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

const TODAY = "2026-06-29";        // a Monday, matching the other parade suites

// Verbatim from js/helpers.js — the classifier's real date parser. Fixtures must
// be "DD MMM YYYY"; this returns "" for ISO input.
function displayDateToISO(s) {
  if (!s) return "";
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const m = String(s).match(/^(\d{1,2})\s+(\w{3})(?:\s+(\d{4}))?/);
  if (!m) return "";
  const mon = months[m[2]];
  if (!mon) return "";
  return `${m[3] || String(new Date().getFullYear())}-${mon}-${m[1].padStart(2, "0")}`;
}
// Verbatim from js/helpers.js medStatusActive.
function medStatusActive(record, todayIso) {
  if (record.status === "NIL") return false;
  const start = displayDateToISO(record.startDate || record.date || "");
  if (!start) return false;
  if (record.status === "Pending") return todayIso === start;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return false;
  return todayIso >= start && todayIso <= end;
}

const ROSTER = [{ id: "0101", name: "Alpha One", fourD: "0101", rank: "REC", role: "Recruit", status: "Active" }];
const clone = o => JSON.parse(JSON.stringify(o));

function ctxWith(medical) {
  const STATE = { roster: clone(ROSTER), leave: [], medical: medical || [], appointments: [] };
  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat,
    STATE,
    configGet: key => (key === "companyPrefix" ? "B" : ""),
    displayDateToISO, medStatusActive,
    rankGroupOf: () => "Enlistee"
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "appointment-4d.js"), "utf8")
    + "\n"
    + fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8")
    + "\n;this.bpClassifyPerson = bpClassifyPerson;\n";
  vm.runInContext(src, sandbox, { filename: "braves-parade.js" });
  return sandbox;
}
const alpha = sb => sb.STATE.roster[0];

module.exports = async function run() {
  suite("parade: a Pending medical appointment is not a report-sick");

  await test("a type-MA row dated today with status Pending lands in OTHERS", () => {
    const sb = ctxWith([{ id: 1, d4: "0101", type: "MA", status: "Pending",
      date: "29 Jun 2026", reason: "Dental", outOfCamp: false }]);
    const c = sb.bpClassifyPerson(alpha(sb), TODAY);
    eq(c.sections.others.length, 1, "the MA branch should have listed them under OTHERS");
    ok(/Dental/.test(c.sections.others[0]), "OTHERS entry names the appointment");
  });

  await test("and NOT in REPORTING SICK", () => {
    const sb = ctxWith([{ id: 1, d4: "0101", type: "MA", status: "Pending",
      date: "29 Jun 2026", reason: "Dental", outOfCamp: false }]);
    const c = sb.bpClassifyPerson(alpha(sb), TODAY);
    eq(c.sections.reportingSick.length, 0, "an appointment is not a report-sick");
  });

  await test("negative control: a real Pending RSI still reaches REPORTING SICK", () => {
    // The guard must not have swallowed the case it exists to serve.
    const sb = ctxWith([{ id: 1, d4: "0101", type: "RSI", status: "Pending",
      date: "29 Jun 2026", reason: "Fever" }]);
    const c = sb.bpClassifyPerson(alpha(sb), TODAY);
    eq(c.sections.reportingSick.length, 1, "a genuine RSI must still list");
  });

  await test("negative control: an MR going for review still reaches MR", () => {
    const sb = ctxWith([{ id: 1, d4: "0101", type: "MR", status: "Pending",
      date: "29 Jun 2026", reason: "Review", time: "1400" }]);
    const c = sb.bpClassifyPerson(alpha(sb), TODAY);
    eq(c.sections.mr.length, 1, "MR must still list");
    eq(c.sections.reportingSick.length, 0, "and must not double-list");
  });
};
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test 2>&1 | grep -A4 "a Pending medical appointment"
```

Expected: the second test FAILs — `reportingSick.length` is `1`, not `0`.

- [ ] **Step 3: Fix the client classifier**

In `js/braves-parade.js`, replace the comment block and guard at lines 366-374.

Before:
```js
    // An MR (Medical Review) visit is NOT a report-sick and must never surface
    // here: while awaiting the MO its status is "Pending" and its start date is
    // today, which would otherwise satisfy the Pending-clause below and
    // double-list the person as MR *and* RSI. An MR going for review is only an
    // MR (its own section above). A resolved MR (status MC/LD/…) still flows to
    // ATT C / STATUS through their own clauses — those don't exclude type MR.
    const isRS = m.type !== "MR" && (
```

After:
```js
    // MR and MA are NOT report-sicks and must never surface here. Both are
    // booked visits with their own section, and both are naturally logged with
    // status "Pending" (the MO outcome is unknown until they are seen) on a
    // start date of the visit day — which is exactly what the Pending-clause
    // below tests, so without these exclusions each one double-lists as its own
    // section AND as RSI.
    //   • MR (Medical Review) → its own MR section above.
    //   • MA (Medical Appointment) → OTHERS, via the MA branch below. This one
    //     is a delayed trap: an appointment booked weeks ahead reads correctly
    //     until the day it comes due, then flips to RSI.
    // A resolved MR/MA (status MC/LD/…) still flows to ATT C / STATUS through
    // their own clauses — those don't exclude these types.
    const isRS = m.type !== "MR" && m.type !== "MA" && (
```

- [ ] **Step 4: Mirror the change into the Apps Script port**

`apps-script-Code.gs:3557` carries a hand-maintained copy of the classifier
inside the `BRAVES-ARCHIVE-PORT` markers, for the unattended archive cron.
Nothing regenerates it. Apply the **same** change there:

```js
    const isRS = m.type !== "MR" && m.type !== "MA" && (
```

Mirror the comment too, so the next reader of either copy sees the same
reasoning.

- [ ] **Step 5: Run the tests, including the parity guard**

```bash
npm test 2>&1 | grep -A4 "port parity" ; npm test 2>&1 | tail -3
```

Expected: `test/parade-port-parity.test.js` PASSES (it feeds both copies the
same STATE and asserts byte-identical message text — if Step 4 was skipped it
goes red), 4 more tests passing, **0 failed**.

- [ ] **Step 6: Commit**

```bash
git add js/braves-parade.js apps-script-Code.gs test/parade-ma-not-rs.test.js
git commit -m "fix(parade): stop a Pending medical appointment reading as RSI"
```

---

## Task 6: Bump the cache-bust versions

**Files:**
- Modify: `index.html:165,175,179,187,189`

**Interfaces:**
- Consumes: every preceding task's file edits being final.
- Produces: nothing.

**Background you need.** There is no bundler; `index.html` carries a `?v=NN` on
every script tag so returning users do not get stale cached assets. Bump **after**
the last edit to each file — bumping early is invisible locally (the file on disk
is correct) and served stale JS for a stretch of the 2026-08-03 session.

`js/helpers.js` and `js/forms.js` are the pair to watch: Task 4 adds
`Excuse Boots` to `MED_STATUS_GROUPS` in one and to `statusOrder` in the other.
A returning user who fetched a new `forms.js` against a cached `helpers.js` gets
a dropdown and an ordering that disagree. This is the same shape as the
`nowHHMM` defect PR #141 had to patch after the fact.

- [ ] **Step 1: Confirm every task's edits are final**

```bash
git status --short && git log --oneline master..HEAD
```

Expected: a clean tree and five commits (Tasks 1-5). If anything is
uncommitted, finish that task first — this step is the whole point of Task 6
running last.

- [ ] **Step 2: Apply the five bumps**

Edit `index.html`:

| Line | From | To |
|---|---|---|
| 165 | `js/helpers.js?v=152` | `js/helpers.js?v=153` |
| 175 | `js/render-dashboard.js?v=6` | `js/render-dashboard.js?v=7` |
| 179 | `js/forms.js?v=181` | `js/forms.js?v=182` |
| 187 | `js/braves-parade.js?v=141` | `js/braves-parade.js?v=142` |
| 189 | `js/parade-tab.js?v=30` | `js/parade-tab.js?v=31` |

If any of these numbers no longer matches what is in the file, `master` moved
under this branch — re-read the line and bump from what is actually there, never
from the table.

- [ ] **Step 3: Verify all five, and only five, moved**

```bash
git diff index.html
```

Expected: exactly five changed lines, each a `?v=` increment of one. No other
tag touched — a script whose file this branch did not edit must not be bumped.

- [ ] **Step 4: Full verification**

```bash
npm test 2>&1 | tail -3 && npm run lint:errors && npm run typecheck
```

Expected: **1089 passing / 0 failed** (1069 baseline + 4 + 4 + 8 + 4), lint
clean, typecheck clean. If the count is short, a test file was not created or
`test/run.js` did not discover it — it auto-discovers `*.test.js` under `test/`,
so check the filename suffix.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "chore: bump cache-bust versions"
```

---

## Post-implementation

**Deploy — required, and it is not frontend-only.** `apps-script-Code.gs`
changed in Tasks 1 and 5. Paste it into the Apps Script editor and redeploy
(Manage Deployments → new Version, **same** URL). **No migration** —
`bravesMigrateSchema()` does not need to run.

No ordering constraint against the frontend, unusually for this repo:

- Task 1 protects a feature nobody has used yet, so an un-redeployed backend
  simply keeps coercing dates on empty tabs.
- Task 5 changes the archive cron's classifier. Until redeployed, archived parade
  snapshots keep the old MA-as-RSI behaviour while live ones are correct. That is
  a temporary divergence between an archive and a live message, not a break.

**Not done, deliberately** — carry these into the PR body:

- **A status-participation editor** (KIV, spec §4). There is no screen listing
  statuses with their `participates` flag; the only way to set one is a checkbox
  inside the medical form. The new defaults are therefore not adjustable without
  a code change.
- **Existing `"EXCUSE BOOTS"` rows stay a custom status.** They are stored in
  caps and will not match the new correctly-cased built-in, so they keep drawing
  their own line on the Dashboard chart (the Excuse-collapse test is
  `indexOf("Excuse") === 0`, case-sensitive) until re-entered. Not migrated.
- **The four status palettes still disagree** — the Dashboard chart, the
  person-card timeline, `medTagBadge`, and the Status Board grid. Only the
  Dashboard one was given a scheme.
- **`bpGridCell` has no MA branch** (`js/braves-parade.js:583`), so an MA-only
  person is blank on the Status Board grid despite classifying into OTHERS.
  Found while tracing Task 5, unrelated to it.
- **No DOM coverage** for the lookahead pills (Task 2), the status dropdown, or
  either chart. All were checked manually in a browser.
