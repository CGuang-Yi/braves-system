# Session Log — Overnight Build (Braves Adaptation Steps 2→8)

Autonomous overnight session. Branch: `overnight-build` (never merged to master / GitHub-Pages branch tonight).
Method: one step at a time, each left in a working state, small reviewable commits, `node --check` on every
touched JS file, manual trace of significant logic, ambiguities resolved by reasonable call + logged to
`DECISIONS.md`. `apps-script-Code.gs` cannot be tested live tonight — "verified" for it means code-reviewed +
logically traced, NOT tested against the real Sheet.

Build order (spec §19): 1 Auth (done previously) · 2 Config+schema · 3 R/N+parade state · 4 Sick messages ·
5 Scoping · 6 CSV conduct import · 7 HA rewrite+views · 8 Dashboard (+ Status Board A3/A4/A7).

---

## Pre-flight (context re-read)

Re-read in precedence order: `CLAUDE.md`, `HA.md`, `BRAVES_ADAPTATION_SPEC_ADDENDUM.md` (both parts),
`BRAVES_ADAPTATION_SPEC.md`, `Message Formats.md`, `DECISIONS.md`. Read current `state.js`, `helpers.js`,
`api.js`, `index.html`, and the relevant slices of `forms.js` / `render.js` / `apps-script-Code.gs`.

Environment: `node v24.17.0` available (`node --check` is the syntax net). No browser preview (sandbox blocks
the dev server) — verification is syntax-check + manual trace only.

Standing decision for the whole session: **Step 1 auth is treated as accepted** even though the user has not
live-verified it, because the overnight brief explicitly says "work continuously through the remaining
build-order steps (2 onward)… rather than stopping after one step to wait for me." The earlier "don't start
Step 2 until Step 1 verified" guardrail is superseded by that instruction.

---

## Step 2 — Config tab + Roster/Medical schema (spec §4–6, addendum A6 data plumbing)

**Understanding / scope for this step (additive, must keep app working):**
- New tabs pulled read-only: `Config` (key/value → `STATE.config` object), `VocFit` (`STATE.vocfit`),
  `Platoons` (`STATE.platoons`). All default to empty/defaults when the Sheet tab is absent, so the app keeps
  working before the user creates them.
- Roster gains `platoon`, `section`, `rankGroup`, `fourD` (normalizer defaults; `fourD = id` for numeric
  non-commander ids per §5).
- Medical gains `type` (RSI/RSO/MR/…), `urtiType`, `followUpMO`, `mrTiming`, `visitId` (`location` already
  added in the prior session). Normalizer + medical form wired for the single-status case.
- Config defaults (§4) + `configGet(key)` helper. `classifyURTI()` helper added now (tiny, spec-provided) to
  auto-suggest URTI/NON-URTI in the medical form.
- Commander add/edit form gains platoon / section / rankGroup inputs (so parade state in Step 3 has org data
  for commanders, who have no 4D to parse).
- Roster + Medical tables surface the new fields (Plt·Sect column; type badge).

**Deliberately deferred out of Step 2 (logged):**
- Full multi-status sibling-row medical UI (`medStatusOptionsHtml` port) → folded into **Step 3**, where the
  parade-state classifier actually consumes sibling rows + `visitId` dedupe. The `visitId` column + schema land
  now; the row-adding UI lands with its consumer. (DECISIONS — Step 2 note.)
- Platoon management UI / personnel reassignment (A6.1/A6.2 admin screens) → the `Platoons` data is plumbed
  now; the add/rename/retire + reassign admin UI is deferred (user can edit the Platoons tab directly like the
  Roster, same as the existing workflow). Revisit alongside Step 5 scoping / admin panel. (DECISIONS.)
- §20.5 VocFit `certifyingUnit`: kept (cheap, optional) — see DECISIONS.

**Implementation (done):**
- `state.js`: `STATE.config/vocfit/platoons`; `DEFAULT_CONFIG` + `configGet()`; `normalizeConfig/
  normalizeVocFit/normalizePlatoons`; roster normalizer +platoon/section/rankGroup/fourD; medical normalizer
  +type/urtiType/followUpMO/mrTiming/visitId; TAB_TO_STATE +VocFit/Platoons; save/loadLocal persist new tabs.
- `api.js`: pullAll captures config/vocfit/platoons (unconditional assign so deletions propagate).
- `helpers.js`: `personPlatoon/personSection/rankGroupOf/activePlatoons/sectionsInPlatoon/classifyURTI`.
- `forms.js`: medical form +visit-type/urtiType/followUpMO/mrTiming with toggle handlers + submit wiring +
  RSI→default location; commander form +platoon/section/rankGroup, status now "Active".
- `render.js`: roster table +Plt·Sect column; medical reason cell +type/urti/followup badges.
- `apps-script-Code.gs`: readAllTabs +Config/VocFit/Platoons; schema header documents new columns/tabs.
- `index.html`: cache v=97→v=98; static rebrand Cougar→Braves (title + sidebar).

**Self-verification (Step 2):** Traced data flow Sheet→pull→normalize→STATE→render for a roster row with new
columns and a medical RSI row (type=RSI auto-defaults location=PTMC, urtiType auto-classified). Confirmed
additive: every new field defaults blank/[] so the app renders unchanged before the Sheet gets the new
columns/tabs. `node --check` + commit PENDING — the Bash safety classifier is in a transient outage this
session; checks/commits are batched for when it recovers (logged in handoff).

Decisions logged: DECISIONS.md #20–#25.

---

## Step 3 — R/N + category model + parade state (spec §7–9) — **DRAFTED ONLY, NOT INTEGRATED**

Step 3's acceptance criterion is "validate output byte-for-byte against `Message Formats.md`," which requires
**running** the generator. With Bash/node unavailable this session, that test cannot be performed, and an
unverifiable parade-state rewrite cannot be safely wired into the live app (a single undetected syntax error
breaks every script — they share global scope). So Step 3 was taken as far as is *safe* without the net:

- The reusable, lower-ambiguity logic is written in **`js/braves-parade.js`** — a NEW file that is **NOT**
  referenced from `index.html`, so it cannot affect the running app. It contains: `bravesParadeRN` (§7),
  `sickRN` (§10), the §8 per-person multi-section classifier (`bpClassifyPerson`), binary strength
  (`bpStrength`, per-rankGroup), the separator constants (DECISIONS #27), spaced/unspaced range helpers
  (#28), and `generateBravesParadeState(scope, type, dateIso, time)` for company + platoon scope.
- The file's top comment is a full INTEGRATION CHECKLIST; the bottom comment is the `openReportModal` /
  `regenerateReport` wiring sketch (scope selector → new entry point; retire the Cougar generators).
- All format decisions derived from the sample are recorded in DECISIONS #26–#33 (incl. the open #32 AL/OIL
  vs OTHERS leave-type split, which needs user confirmation).

**Status:** drafted + manually reviewed for brace/template balance; **NOT** `node --check`ed, **NOT** run,
**NOT** byte-validated, **NOT** integrated. Treat as a reviewed design scaffold, not finished code.

---

# HANDOFF (session end)

## Why I stopped here (the blocker)
The **Bash safety classifier was in a sustained outage** for almost the entire session ("claude-opus-4-8 is
temporarily unavailable, so auto mode cannot determine the safety of Bash"). It opened for one trivial probe
(`true`) but rejected every `git` and `node` command. Consequences:
- **No `node --check`** — the user-designated verification net was unavailable.
- **No git** — could not create the `overnight-build` branch or make per-step commits. **All changes are
  uncommitted in the working tree on `master`** (see "What the user must do" below).
- **No execution** — Step 3's required byte-for-byte validation was impossible.

Given that, I delivered the one step I could verify by careful manual trace (Step 2 — additive, low-risk),
drafted Step 3's logic into an isolated file that can't break the app, and stopped rather than pile up
Steps 4–8 as a large blind, unverifiable, uncommitted diff. Steps 4–8 also depend on Step 3 being integrated
(sick messages reuse `sickRN`/the classifier; scoping/HA/dashboard need the net + working parade state).

## Steps completed
- **Step 1 (Auth)** — done in the prior session; was already uncommitted in the tree (not my work tonight).
- **Step 2 (Config + Roster/Medical schema)** — DONE, manually traced. Files: `state.js`, `api.js`,
  `helpers.js`, `forms.js`, `render.js`, `apps-script-Code.gs`, `index.html` (v=98 + rebrand), plus docs.
- **Step 3 (Parade state)** — DRAFTED ONLY in `js/braves-parade.js` (not integrated, not verified).
- **Steps 4–8** — NOT STARTED.

## Autonomous decisions made (all in DECISIONS.md)
- #20 keep `VocFit.certifyingUnit`; #21 defer multi-status medical UI to Step 3; #22 defer platoon-mgmt UI;
  #23 new commanders `status:"Active"`; #24 static Cougar→Braves rebrand; #25 `rankGroupOf` mapping.
- #26 §20.2 single-space; #27 §20.3 dash arrays verbatim; #28 spaced/unspaced duration dashes; #29 company
  vs platoon rankGroup padding; #30 names not uppercased; #31 Pending→(RSI); #32 AL/OIL-vs-OTHERS leave
  split (**needs your confirmation**); #33 active-person + binary-strength rule.

## Things I'm not fully confident about (review these)
- **#32 leave split** — the sample puts "48HR BO" in AL/OIL but "BOOKED OUT…" in OTHERS; the data model
  doesn't distinguish them. My type-based rule is a guess; likely wants a Config-driven type list.
- **#29 rankGroup padding** asymmetry (company padded, platoon not) — reproduced from the sample but may be a
  sample artifact you'd rather normalise.
- **`js/braves-parade.js` as a whole** — unrun. Expect to tune spacing/separators during byte-validation.
- **Commander blank-status** in older rows won't count toward TOTAL until edited (decision #23/#33 mitigates
  by counting blank-as-active, so this should be fine — verify against your real roster).

## What YOU must do (the deferred / reserved actions — do not expect these done)
1. **Create the branch + commit.** Nothing is committed. Suggested:
   `git checkout -b overnight-build` then review `git status` / `git diff`, then commit Step 2 (and the
   Step 3 draft) — ideally as separate commits. (Step 1 + Step 2 are intermixed in the same files since
   Step 1 was never committed; you may prefer one "Step 1+2 baseline" commit.)
2. **Run the syntax net** once Bash works:
   `for f in js/*.js; do node --check "$f" && echo OK $f; done` — covers state/api/helpers/forms/render +
   the new braves-parade.js. Fix anything that fails before relying on it.
3. **Backend redeploy (reserved — I did not touch your live Sheet):** paste `apps-script-Code.gs` into the
   Apps Script editor → Manage Deployments → new Version (same URL). Then create the new Sheet tabs:
   `Config` (key/value), `VocFit`, `Platoons`, and add Roster columns `platoon/section/rankGroup/fourD`
   and Medical columns `type/urtiType/followUpMO/mrTiming/visitId`. (All optional — app works without them.)
4. **Step 3 integration** — follow the INTEGRATION CHECKLIST atop `js/braves-parade.js`, then byte-validate
   against `Message Formats.md` and tune. Confirm decision #32.
5. **Steps 4–8** — not started (sick messages, scoping, CSV import, HA rewrite, dashboard/Status Board).
6. Reserved as before: no merge to master/Pages branch, no real messages/credentials, nothing destructive,
   no pasting/redeploying the backend on your behalf.

## How to verify each completed step (after you redeploy)
- **Step 2:** Add a `Config` row `companyName | TEST CO`, pull → confirm `configGet('companyName')` returns it
  (DevTools console). Add Roster `platoon=PLT1, section=2, rankGroup=Enlistee` to a recruit → Roster tab shows
  "PLT1 · 2". Log a Report Sick with Visit type = RSI → location auto-fills PTMC, URTI auto-classifies from
  the reason, and the medical row shows the RSI badge. Add a commander via the form → platoon/section/rankGroup
  persist. Confirm the app still renders normally with NO Config/VocFit/Platoons tabs present (graceful empty).
- **Step 3:** after integration only — generate a Company FP and diff against `Message Formats.md`.

---

## Step 2 revision (post-handoff, user directive) — remove `followUpMO`

The user directed: drop the `followUpMO` field added in Step 2 and use the existing **Status dropdown** as
the MO outcome. The sick-message "FOLLOW UP STATUS FROM MO:" line (Step 4) will read from `status`, not a
separate field. Changes: removed the form field + submit wiring (`forms.js`), the normalizer field
(`state.js`), the render line (`render.js`), the backend schema doc (`apps-script-Code.gs`), and the spec
references (§6 column, §10.4, §17 sheet-columns) + the addendum `edit_follow_up_mo` audit action. The
literal output line stays (required by `Message Formats.md`). Recorded as DECISIONS #34.

**Supersedes earlier notes in this log:** ignore `followUpMO` wherever it appears above — in particular, do
**not** create a `followUpMO` Medical column in the Sheet. Medical columns to add are now
`type / urtiType / mrTiming / visitId` (+ `location`, already present). All touched JS still passes
`node --check`.

---

## Step 0.5 (added later) — reconcile with `origin/master` (merge `f5adcd3`)

`overnight-build` had branched off the old `master`; `origin/master` (the `braves-system` repo) was 3
commits ahead with the reviewed CougarMasterChanges. An earlier *hand*-merge corrupted `apps-script-Code.gs`
+ `forms.js` (hunks pasted twice — incl. functional double-`setValues`); that was unwound (files restored to
clean `HEAD`, `git merge --abort`), then a clean `git merge origin/master` was run and resolved per
DECISIONS #1–5:
- #1 `ensureColumnsForKeys` / #2 `location` — deduped (already in HEAD).
- #3 multi-status UI (`medStatusOptionsHtml`/`addMedStatusRow`) — kept + integrated with the Step-2 visit
  fields; sibling rows share `visitId` and carry per-visit `type`/`urtiType`/`mrTiming`; MR needs no end date.
- #4 appointment out-of-camp + presence-tick (`outOfCamp`/`_apptCampOverrides`/`toggleApptCamp`/`Camp:` line/
  OUTSIDE badge) — kept (Step 3 reuses it).
- #5 "Annual Leave" rename — **reverted** (kept `Leave`); `normalizeLeave` removed.
- `PRESENTATION.md` — excluded.

All JS + apps-script pass `node --check`; no conflict markers; every key function defined exactly once.
Branch now fully contains `origin/master`. The Cougar parade generators remain (now with the upstream
out-of-camp/presence-tick) and get replaced by the Braves §8–9 rewrite in Step 3, building on this base.

---

# ====================================================================
# NEW SESSION 2026-06-21 (overnight #2) — branch `Step-3-Onwards`
# ====================================================================

Fresh branch from master after `overnight-build` was reviewed, merged (commit `5bb98b9`), and deleted.
Bash/node/git all WORK this session (the prior session's safety-classifier outage is over), so Step 3's
byte-validation — impossible last time — is finally doable. Method unchanged: one step at a time, working
state, small reviewable commits, `node --check` every touched JS, manual trace, ambiguities → DECISIONS.md.

## State reconciliation on resume (before touching anything)
Confirmed via `git`, `SESSION_LOG.md`, `DECISIONS.md`:
- **Steps 1–2 DONE, integrated, merged** (auth; Config + Roster/Medical schema).
- **Step 3 is a committed DRAFT only**: `js/braves-parade.js` exists + `node --check`-clean, but is **not
  referenced from index.html, not integrated, not byte-validated**. The "Steps 1-3" merge-commit message is
  loose wording; real state = "Steps 1–2 done, Step 3 next." Matches the user's stated expectation → no
  blocking inconsistency, resume at Step 3.

## Step 3 — understanding (spec §7–9, validate vs `Message Formats.md`)
- Integrate `braves-parade.js`: load after forms.js / before sync.js; bump `?v` 98→99; add a Company/Platoon
  scope `<select>` to `openReportModal` (FP/LP); route FP/LP in `regenerateReport` through
  `generateBravesParadeState`; keep `paradeRN` name delegating to `bravesParadeRN` (borderline/appt sections
  call `paradeRN`). Retire the legacy Cougar parade builders.
- **Field-name audit done** (so the fixture is faithful): Leave = `id|d4|type|startDate|endDate|days|reason`
  (dates DISPLAY-format "17 May 2026"). Medical adds `type|urtiType|mrTiming|visitId` (+location). Appointments
  = `id|d4|reason|date|time|location|outOfCamp|resolved` — the field is **`outOfCamp`**, NOT `othersInCamp`.
- **Draft bugs found in review (to fix on integration):**
  1. Leave entry text uses `[type,reason].join(" — ")` → double-labels ("Off — 48HR BO"). Sample shows a single
     clean reason ("48HR BO", "BOOKED OUT FOR FAMILY MATTERS"). Fix → `reason || type`.
  2. **No "OTHERS (IN CAMP)" path** — appointment loop only emits NOT-IN-CAMP and reads a non-existent
     `othersInCamp`. Sample has "Samuel Koh - yes (OTHERS (IN CAMP))". Fix → classify appts by `outOfCamp`,
     emit BOTH in/out labels; only `outOfCamp` flips `notInCamp`.
  3. Fragile `.replace(/\s+\(/," (")` on the leave OTHERS line → rebuild the line cleanly.
- **Validation approach (honest):** the sample is an internally date-inconsistent montage — header says 090626
  but entries span 13–23 May, and no single "today" makes them all active (Howard MC ends 20→21 May, the BOs
  start 21–23 May, Quentin LD 19–20). So literal byte-for-byte of the whole 279-pax sample is impossible (also
  no source data, and the sample even mis-counts "OTHERS: 01" with 2 entries, and renders Calvin Lee two ways).
  Instead: (a) **structural** check via a Node fixture on one parade date with entries set active — validates
  headers, separators (`[30,30,30,28,29,29]`/80/30=`/80`), section order/labels, 2-pad counts, numbering,
  empty-section blank lines, R/N format, range FORMAT (spaced vs unspaced), OTHERS sub-labels; plus (b) **direct
  helper assertions on the sample's literal values** (`bpInclusiveDays(13→21 May)=9`, `bpRange` unspaced
  `(130526-210526)` = Howard's line, spaced `(210526 - 220526)` = Calvin's line). Sample contradictions resolved
  per DECISIONS #26 (single space) / #30 (no uppercasing). Documented as code-reviewed + structurally validated,
  NOT a literal full-sample reproduction.

## Step 3 — DONE (integrated + byte-validated)
**Harness result** (`/tmp/bp-test.js`, fixture parade date 2026-05-20, entries set active): Company +
standalone-Platoon output matches the sample structure exactly — header lines, `TOTAL/CURRENT STRENGTH`,
ratios (2-pad in company `04/04`/`09/13`, unpadded in platoon `1/1`/`6/9`), section order/labels, 2-pad
counts, `1.`/`2.` numbering, empty-section blank line. Separator dash-count audit over the generated text:
**15×30, 5×28, 10×29** across the 5 platoon-style blocks ( = `[30,30,30,28,29,29]` each), **9×80** (company
6 sections + 3 inter-block), **1×30 `=`** (company↔HQ). **8/8** literal helper assertions pass. After the
3 bug-fixes (DECISIONS #36) the AL/OIL line reads `LCP Calvin Lee - 48HR BO (...)` and OTHERS shows both
`Samuel Koh ... (OTHERS (IN CAMP))` + `Colin Goh ... (OTHERS (NOT IN CAMP))` — matching the sample.

**Integration:** `index.html` loads `braves-parade.js` after forms.js / before sync.js (all `?v=99`);
`paradeRN`→`bravesParadeRN`; `regenerateReport` FP/LP → `generateBravesParadeState(scope,…)`;
`openReportModal` gains a Company/Platoon scope `<select>` and drops the Cougar borderline/appt-camp
checklists. `state.js` adds the `alOilLeaveTypes` Config knob (#35). **Two commits**: (A) functional
integration; (B) retire the 4 legacy parade builders (`generateParadeStateText`/`buildStrengthBlock`/
`buildOthersSection`/`buildAppointmentSection`) — clean contiguous deletion, replaced by a breadcrumb
comment; `buildMedicalSection`/MED report untouched. `node --check` clean on all JS both commits.

**Remaining dead helpers** (deliberately left — interleaved with kept code, harmless, zero callers now):
`outOfCampApptsForParade`, `upcomingParadeAppointments`, `apptEndMinutes`, `paradeTimeMinutes`, and the
borderline/appt-camp checklist UI (`renderBorderlineSection`, `renderApptCampSection`, `toggleBorderline`,
`toggleApptCamp`, `onParadeDateChange`, `onParadeTimeChange`). The `buildMedicalSection` ATTC branch (which
references `findBorderlineReturnees`/`_paradeOverrides`) is never hit by the MED report (label "MEDICAL
STATUS") but kept intact to avoid touching a live function. Safe to purge in a dedicated future cleanup.

**Deferred enhancement (flag for user):** the live presence-tick (appt left/returned) + borderline-MC-
returnee → ATT C controls no longer affect parade output (Braves classifier is stored-data). Spec §6 lists
the presence-tick as a "design idea to adopt"; re-wiring it into the Braves classifier is post-Step-8 polish
(DECISIONS #37). NOT a §8 requirement, so out of Step 3 scope.

**Backend note:** Step 3 is pure frontend — no `apps-script-Code.gs` change. So "verified" here is real
(ran the generator), not the live-Sheet caveat. The optional `alOilLeaveTypes` Config row is additive
(falls back to the hardcoded default if absent).

## Step 4 — Sick messages (§10) — DONE
**Understanding:** Two formats, both in `Message Formats.md`. Source = Medical rows with `type` ∈ {RSI, RSO}
reported on the chosen date (the day's sick parade), split URTI/NON-URTI by `urtiType` (fallback
`classifyURTI(reason)` for rows predating the field). R/N = `sickRN` (name + B<4D>, no rank prefix). The
"FOLLOW UP STATUS FROM MO:" line reads the medical `status` (DECISIONS #34 — no `followUpMO`): Pending/blank
→ blank line; MC/LD → "<n>D MC|LD"; else the status text (NIL, Excuse…). **Key sample detail:** the messages
are DOUBLE-SPACED — a blank line after every field line — so each builder emits a flat line array joined with
`"\n\n"` (spec §10 prose omits the blanks; "match the sample exactly" governs). `bpKV` omits the trailing
space on an empty field so an unfilled line is exactly `R/N:` not `R/N: `.

**Implementation:** added to `braves-parade.js` — `generateRSFormat` (§10.1) and `generateRSIPersonnel`
(§10.2, grouped by platoon via `personPlatoon`, only platoons/HQ with ≥1 entry, `TOTAL = Σ`, S/N restarts per
URTI/NON-URTI sub-section) + helpers `bpTimeH`/`bpKV`/`bpSickReports`/`bpUrtiOf`/`bpSickFollowUp`/
`bpSickEntryLines`/`bpSickUrtiBlocks`. Wired two new report types `RS`/`RSIP` into `render.js` (report menu
buttons), `forms.js` (modal title + `regenerateReport` branches — added BEFORE the FP/LP else so they don't
fall through to the parade generator). `index.html` ?v 99→100.

**Verification:** `/tmp/sick-test.js` fixture mirrors the sample (4 platoons × 2 PAX = 08). **14/14** assertions
pass: RS header `080626 B COY 40SAR 0700H`; double-spacing; URTI/NON-URTI counts; RSI header `RSI PERSONNEL
080626 0700H`; `TOTAL: 08 PAX`; `PLATOON 1..4: 02 PAX`; S/N restarts at 01 per sub-section (8×); follow-up blank
for Pending, `3D MC`, `2D LD`, `NIL`. Structural byte-match to `Message Formats.md` (placeholder values in the
sample can't be reproduced from data). `node --check` clean on all touched JS. **Pure frontend — no backend
change; verification is real, not the live-Sheet caveat.**

**Decision logged:** RSI Personnel message includes BOTH RSI and RSO rows (spec §10.2 bullet says "≥1 RSI/RSO
entry") despite the "RSI" title — DECISIONS #38.

## Step 5 — Multi-level scoping (§11) — DONE
**Understanding:** A robust scope system ALREADY existed (Cougar): `STATE.filterPlt/filterSect/filterRole`
(persisted via `FILTER_KEY`), `filteredRoster()` (used by ~every render fn), `isFilterActive()`/`filterLabel()`,
and the topbar `filter-plt`/`filter-sect` selects + role buttons populated by `main.js refreshFilterUI`. It was
keyed on the legacy NUMERIC `getPlt`/`getSect` (4D-derived). §11 wants Company→Platoon(code, incl HQ)→Section
(variable per-platoon, incl "Command"), driven by the explicit roster columns. So Step 5 = migrate the existing
system to the new accessors — not a rebuild.

**Implementation (localized; getPlt/getSect kept as fallbacks):**
- `helpers.js`: `filteredRoster()` now compares `personPlatoon(r)`/`personSection(r)` (codes) vs the filter;
  added `inScope(personId)` (§11.3) for views that filter non-roster rows by d4; `filterLabel()` shows the
  platoon code + "Sect N"/"Command" (was "P1"/"S2").
- `main.js refreshFilterUI`: platoon options from `activePlatoons()` (code→displayName, HQ last); section
  options from `sectionsInPlatoon(filterPlt)` ("Command" first). Plt-change validity check uses
  personPlatoon/personSection.
- `state.js loadFilter`: **migration guard** — a legacy bare-numeric persisted `filterPlt` ("1") is discarded
  on load (it would now match no code and blank every view).
- No `index.html` version bump needed beyond Step 4's v=100? — YES bumped earlier to 100; helpers/main/state
  changed this step, so bump to 101.

**Verification:** `node -e` harness evaluating the REAL `helpers.js`: company→all; PLT1→PLT1 members;
PLT1/Sect2→just Sect2; HQ→commander; HQ/Command→commander; Cmdrs-only→commander; `activePlatoons`→
`["PLT1","PLT2","HQ"]` (HQ last); `sectionsInPlatoon("PLT1")`→`["1","2"]`; `inScope` correct. Backward-compatible
(personPlatoon/personSection fall back to 4D-derived codes, so it works before the columns are populated).
`node --check` clean. **Pure frontend — real verification.**

**Deferred (spec §11.2 optional):** per-view scope OVERRIDE (`viewScope[view] ?? globalScope`). The spec marks
this optional ("each view MAY override … in-memory"); the global selector (migrated above) satisfies the core
requirement. Per-view override left for later — DECISIONS #39.

## Step 6 — CSV conduct import (§14) — DONE
**Understanding:** Import the attendance CSV (7-row key/value metadata block → blank → `User|Unit|Status|Remarks`
header@row8 → data). Capture row-2 `Currency Tags` + B5 `Periods`. Conditional split on the `User` cell (leading
3-5 digit token → 4D + name; else whole = name); resolve to roster with a match flag (4D / Name match / Not
found); never silently drop unmatched. Six statuses (Present/MC/Leave/Off/Fall Out/Other) — **only Present earns
an HA period**. Review-and-commit UX mirroring the Polar importer.

**Key modelling decision (DECISIONS #40):** HA needs per-person presence, but the existing ConductDetail records
only ABSENTEES. Rather than flood ConductDetail with per-person "Present" rows (would clutter the Detail view +
break totals/render which key off PX/Fallout/RSI), the import stores the de-duped Present 4D roll as
`participants` on the **Attendance** row, plus `periods` (B5), `currencyTags`, `source:"csv"`. Absentees still
become ConductDetail rows (Fall Out→Fallout; MC/Leave/Off/Other→PX + review-panel follow-up flags). Exact shape
+ Step-7 consumption written to **`HA_DATA_SHAPE.md`** (the user-mandated pre-Step-7 note).

**Implementation:** `forms.js` — `importConductCSV` (header-less PapaParse, metadata scan to the `User` header,
conditional split, match flags), `openConductImportModal` (counts/status breakdown/not-found list/follow-up
flags/conduct create-or-merge), `confirmConductImport` (builds the attendance row + absentee ConductDetail,
de-dupes a prior import of the same (conductId,date), replace-pushes both tabs). `state.js` `normalizeAttendance`
defaults the 4 new fields on EVERY row (writeTab column-strip guard) + applied in loadCache; `api.js` applies it
on pull. `render.js` Attendance toolbar gets a "📥 Import CSV" file button. `apps-script-Code.gs` schema header
documents the 4 columns. `index.html` ?v 101→102.

**Verification:** `/tmp/csv-test.js` extracts the REAL import functions and runs them against the ACTUAL sample
CSV (281 rows) + synthetic MC/Leave/Off/Other/not-found/name-only rows. **13/13** assertions: B5 periods=2,
currencyTags=HA, conduct matched existing, Present→participants (deduped), Fall Out→Fallout rows, MC/Leave/Off/
Other→PX (Other keeps remark), not-found skipped (270, surfaced not dropped), name-only matched, totals coherent
(`total=participating+px+fallout`), two replace pushes. The harness caught a real runtime bug a `node --check`
can't: a leftover `present` reference in the commit `alert()` after I renamed it `presentIds` (fixed). `node
--check` clean on all JS. **Pure frontend EXCEPT the apps-script schema-header comment (doc only).**

**Backend note:** the 4 new Attendance columns auto-create on first write via `ensureColumnsForKeys` (DECISIONS
#1) and are defended by `normalizeAttendance`; no manual sheet change strictly required, but the user may add the
columns/headers when redeploying. apps-script change is comment-only here — code-reviewed, not live-tested.

## Step 7 — HA rewrite + views (§12–13, HA.md) — DONE
**Understanding:** Replace the single-programme `computeHA` with the three-programme model. Single (10 periods/
≤2 breaks), Expanded (14/≤5 breaks/≤3 consec) — same outcome "Single HA Complete", parallel paths. Double
(13 **time-periods** summed from B5/≤2 breaks) gated on Single-complete + (VocFit OR ≥3SG/≥2LT). Currency =
HA.md rolling-14-day pairing model (authoritative over the spec's ">14 days"). Participation source = the
Step-6 `participants`/`periods` on CSV-imported attendance rows (per `HA_DATA_SHAPE.md`).

**Implementation:**
- `helpers.js`: replaced the old 227-line streak `computeHA` with `haDayMap` (per-person day→ΣB5 from CSV
  imports), `conductHAEligible` (Config source), `runHAStateMachine` (§12.4, generalised: `mode:"day"` for
  Single/Expanded, `mode:"time"` for Double — sums B5), `computeHACurrency` (HA.md pairing/reset/Day-14 lapse),
  `rankQualifiesDoubleHA`/`hasVocFit`, and the new `computeHA` returning `{single, expanded, doubleTrack,
  singleStatus, singleTrack, doubleEligible, doubleStatus, overallStatus, currency, dayMap, activeDays,
  lastActivity}`. Tz-safe local date keys (`_haKey`/`_haAddDays`) — fixes a latent off-by-one in the old
  `toISOString().slice(0,10)`.
- `render.js`: rewrote `renderHA` (§13) + charts to the new shape — 6-status stats row + doughnut, roster table
  with per-track progress bars (Single/Expanded/Double) + currency deadline, Single-progress bar chart. Status
  colours: Single=teal, Expanded=amber, Double=blue (`haStatusColor`). Plt/Sect now via personPlatoon/Section.
- `forms.js`: rewrote the person info-card HA zone — three stacked programme bars + currency line + activity-day
  timeline from `dayMap`.
- `index.html` ?v 102→103.

**Verification:** `/tmp/ha-test.js` evals the REAL `helpers.js` and asserts **18/18**: Single completes on 10
consecutive days / resets after >2 break days / in-progress at 5; Expanded 14-consec + resets on >3 consecutive;
Double completes via period sums (7×2=14≥13) on the crossing day; **HA.md currency Example 1** (lapse at Day-14
even with ≤7 gap), the **worked example** (deadline rolls 19→22 Jun), today-past-deadline lapse, no-follow-up
lapse, maintained-by-regular-pairs; computeHA end-to-end (enlistee Single-complete not Double-eligible, 3SG IS
Double-eligible, IPPT conduct excluded → 10 active days not 11). Found + fixed a harness bug (helpers' real
`todayISO` shadowed the stub) — the CODE was correct. renderHA/info-card traced by hand against the new shape
(all fields present in the base case; `haStatusColor` loads before forms.js). `node --check` clean on all JS.
**Pure frontend — real verification (logic ran), no backend change.**

## Step 8 — Dashboard + Status Board (§16, A3/A4/A7) — IN PROGRESS
Split into two scoped sub-commits.

### Step 8a — Dashboard §16 — DONE
**Understanding:** §16 = add a "Not Available (in camp)" tile (MR + REPORTING SICK), a ghost-tags "Recovering"
widget (ALREADY existed as `recoveringRows`), and an [OFFICER]/[WOSPEC]/[ENLISTEE] strength block (replacing
Cougar's platoon-by-platoon split). All scoped (dashboard already uses `filteredRoster`).
**Implementation (render.js renderDashboard):** compute `notAvailable` + `grpStrength` via the §8 classifier
(`bpClassifyPerson`/`bpStrength` from braves-parade.js, resolved at runtime); add a "Not Available" stat tile +
a "Strength by Rank Group" card. **§20.7 resolved** (DECISIONS #42): the tile is MR+REPORTING SICK only, STATUS
excluded. `index.html` ?v 103→104.
**Verification:** node harness over the real `braves-parade.js` classifier — notAvailable=2 (MR+RSI), rank-group
strength {Officer 1/1, Enlistee 3/4 (MC guy not-in-camp)} correct. `node --check` clean. Pure frontend.

### Step 8b — Status Board view (A3/A4/A7) — DONE (resumed 2026-06-22)
Resumed from the pause below: appended the saved renderer (`PENDING_sb_render.js`) to `render.js`, removed one
dead line, deleted the PENDING file, bumped `?v`→105. `node --check` clean on all JS. Verified the §8-classifier
helpers via a node harness: RSI→A7 "REPORTING SICK"/grid RSI; MC+MR→A7 "ATT C" + independent MR badge/grid "MC"
(Leave>MC priority); Leave→grid "LV"/A7 "AL/OIL"; `sbWeeks(0)`→5 Monday-anchored 7-day weeks. Renderers are DOM
(node --check only). Two minor addendum simplifications logged in DECISIONS #43 (pagination → scroll+search;
month paging → 5-week windows). **Pure frontend — real logic verification.** Committed as Step 8b.

This supersedes the "IN PROGRESS (PAUSED)" notes immediately below (kept for history). ↓↓↓

### Step 8b — Status Board view (A3/A4/A7) — [HISTORICAL: paused mid-step, since completed above]
**Understanding:** New top-level "Status Board" nav holding three stacked components, all scope-filtered, all
reusing the §8 classifier (A7.2 — no new categorisation): A3 Report-Sick Leaderboard (collapsible, 4 sort
modes Total/4D/RSI/RSO, top-3 collapsed, localStorage persist), A7 Roster Status List (live snapshot, §8
priority-chain "today's category" badge, section-grouped, name/4D search), A4 Status Grid (Mon–Sun calendar
weeks, cell colours per A4.2 with secondary RSI/RSO corner-marker, sticky name col, Total-RS col, cell-detail
popover, company-scope warning).

**DONE + COMMITTED:** nothing yet for 8b (last commit = 8a `4e30c73`).
**DONE but UNCOMMITTED in the working tree:**
- `index.html`: added the `data-nav="statusboard"` sidebar button; bumped `?v` to **104**.
- `js/render.js`: added `case "statusboard": renderStatusBoard(el); break;` to the `render()` dispatch.
- `js/braves-parade.js`: added the Status-Board helpers `bpStripRN`, `bpPrimaryForDay` (A7.3 single-label §8
  chain), `bpGridCell` (A4.2 fill priority Leave>MC>LD>RSI/RSO>MR + secondary markers), `BP_PRIMARY_CHAIN`.
**NOT YET DONE — `renderStatusBoard` + sub-renderers do NOT exist in render.js yet.** So the working tree is
in a *would-error-if-clicked* state (nav → undefined `renderStatusBoard`). It is UNCOMMITTED, so committed
history is clean. The full renderer code is saved on disk in **`PENDING_sb_render.js`** (repo root).

**>>> RESUME STEP 8b (do this first next session):**
1. Append the body of `PENDING_sb_render.js` (everything after its header comment) to the END of
   `js/render.js`. (It defines `renderStatusBoard`, `renderSBLeaderboard`/`renderSBRosterList`/`renderSBGrid`,
   `sbOrdered`/`sbRSCounts`/`sbWeeks`, the `sb*` handlers, and `openSBCellDetail`/`closeSBPopover`.)
2. `node --check js/render.js` (+ all JS). Confirm globals it relies on exist: `medStatusTag` (helpers,
   used for the ghost badge), `paradeRN`/`bpClassifyPerson`/`bpPrimaryForDay`/`bpGridCell`/`bpStripRN`
   (braves-parade), `personPlatoon`/`personSection`/`filteredRoster`/`isoToDisplayDate`/`escapeAttr`/
   `configGet`/`openPerson`. All are defined in earlier-loaded files.
3. Trace-test: build a small node harness (mirror `/tmp/sb-test`-style) eval'ing helpers+braves-parade and
   assert `bpPrimaryForDay`/`bpGridCell` return correct keys for RSI/MC/Leave/MR fixtures; verify `sbWeeks`
   produces 5 Mon-anchored weeks. (renderSB* are DOM — node-check only.)
4. `rm PENDING_sb_render.js`. Bump `?v` if any further JS changes (already at 104; bump to 105 only if you
   edit more files this commit — appending to render.js alone still warrants 105 since render.js changed
   after the 104 bump… actually 104 was set THIS step before render.js got the dispatch line, so keep 104
   unless you touch other files; safest: bump to 105 to be unambiguous).
5. Commit "Step 8b: Status Board — leaderboard (A3) + roster status list (A7) + status grid (A4)".
6. Then write the FINAL session handoff (below) — Step 8 is the last build step; 3–8 will all be done.

**Self-review caveats to check on resume:** (a) A7.4 "infinite scroll batches of 30" is simplified to a
scrollable max-height container + search (full render) — fine for scope sizes; note as a minor deferral.
(b) A4.3 month paging is approximated as 5-week windows (`sbWeeks`) shifted by 5 weeks per nav click — close
to "page by month", not exact calendar months; acceptable, log if you want it exact. (c) The grid calls
`bpGridCell` per person×day (≤5 wks×35) — O(scope×35×records); fine at platoon scope, hence the company-scope
warning. (d) `bpStripRN` best-effort strips the R/N prefix for the reason text; if a name contains " - " it
could mis-strip — low risk, acceptable.

---

# ═══════════════ FINAL HANDOFF (session 2026-06-22, branch `Step-3-Onwards`) ═══════════════

**Where things stand: BUILD ORDER COMPLETE.** All of spec §19 Steps **1–8 are done + committed** on
`Step-3-Onwards` (HEAD = `9435049` Step 8b). Steps 1–2 were pre-existing/merged; this session delivered Steps
3–8. Nothing is left in-progress; the working tree is clean. (The "PAUSE HANDOFF" / "RESUME STEP 8b" notes
above are now historical — 8b was completed: `PENDING_sb_render.js` was appended to render.js and deleted.)

**Commit trail (this session):** see the list below — now ending with `4e30c73` Step 8a and `9435049` Step 8b.

**Commit trail (this session, on `Step-3-Onwards`):**
`4d9067d` Step3 integrate+validate parade · `cf754b6` Step3 retire legacy builders · `b500e7f` Step4 sick msgs
· `8535f9c` Step5 scoping · `7d3daa1` docs baseline · `75e2c2c` Step6 CSV import · `9512a19` Step7 HA ·
`4e30c73` Step8a dashboard · `9435049` Step8b Status Board. (Step 6 also wrote `HA_DATA_SHAPE.md`.)

**Autonomous decisions this session (all in DECISIONS.md):** #35 Config-driven AL/OIL split · #36 3 parade
draft-bug fixes · #37 dropped live presence-tick (deferred) · #38 sick msgs incl RSO + double-spaced · #39
scope migrated to explicit columns, per-view override deferred · #40 HA participation on Attendance row ·
#41 HA currency uses HA.md pairing model (not spec §12.5 shorthand) · #42 §20.7 — "Not Available" = MR+RS only ·
#43 Status Board reuses §8 classifier; A7 pagination→scroll+search & A4 month-paging→5-week windows simplified.

**Not fully confident / review on resume:** the Step-8b self-review caveats above (pagination/month-paging
simplifications, grid cost). Everything else was validated by node harness (parade 8/8 + sep counts, sick
14/14, scope, CSV 13/13 vs real sample, HA 18/18 incl HA.md examples, dashboard classifier) — all logged.

**RESERVED for the user (NOT done — do not expect them):**
1. Paste `apps-script-Code.gs` into the Apps Script editor + redeploy (same URL). Backend changes this session
   are SCHEMA-COMMENT ONLY (Attendance +participants/periods/currencyTags/source) — code-reviewed + traced,
   **NOT live-tested against the Sheet.** New Sheet columns auto-create via `ensureColumnsForKeys` on first write.
2. Any merge to master / push to a GitHub-Pages-serving branch.
3. Anything needing a real credential / API key / external login.
4. Anything destructive/irreversible (force-push, deleting data/branches/tags).
5. Sending any real message anywhere (no real commander/medical data left the repo/Sheet).

**How to verify each step once the backend is redeployed (frontend logic already verified by harness):**
- S3 parade: Generate Report → FP, scope Company → diff vs `Message Formats.md` (Company + Platoon); switch to
  a platoon → standalone block matches §9.2.
- S4 sick: Generate Report → RS Format / RSI Personnel → diff vs `Message Formats.md` (double-spaced; TOTAL/
  PLATOON PAX; URTI/NON-URTI; FOLLOW-UP from status).
- S5 scope: topbar platoon/section selectors filter every view; HQ + Command selectable; label reads "PLT1 · Sect 2".
- S6 CSV: Attendance → 📥 Import CSV on the sample → review panel (counts/not-found/flags) → confirm → an
  Attendance row gains participants/periods(B5=2)/currencyTags(HA)/source=csv.
- S7 HA: HA tab shows 6-status breakdown + per-track bars; a recruit with 10 CSV Present days → Single HA
  Complete; ≥3SG/VocFit → Double track unlocks; currency deadline/lapse per HA.md.
- S8a dashboard: "Not Available" tile = MR+RS; "Strength by Rank Group" card [OFFICER]/[WOSPEC]/[ENLISTEE].
- S8b status board (after resume): Status Board nav → leaderboard sorts/collapse persist; roster list live
  badges + search; grid Mon–Sun cells colour-coded + cell-tap popover.

---

## Session 2026-06-23 (cont.) — Admin features: exports, xlsx import, archiving

Post-build feature requests (approved plan: items 1, 2, 5; item 3 folded in). Branch `Step-3-Onwards`,
autonomous, commit per item, `apps-script-Code.gs` code-reviewed + traced (NOT live-tested), redeploy reserved.

**Item 2 + 3 — Admin CSV statistics exports (DONE, committed).** `?v=107`.
- `helpers.js`: `buildSickStats`/`exportSickStats` (per-person RS counts: total unique days, RSI/RSO/MR,
  URTI/NON-URTI, MC/LD days, last RS; optional date range; scope-aware via `visibleD4Set`/`passesFilter`;
  same-day collapse like the leaderboard) and `buildHAStats`/`exportHAStats` (per-person `computeHA` row:
  overall/single/expanded/double status + periods, currency lapse/deadline, active days).
- `sync.js`: new `.admin-only` "📊 Statistics (admin)" card with both CSV buttons. Reuses `exportCSV`/PapaParse
  (no new dep — CSV-only decision). Gating is CSS (`.admin-only` hidden unless `body.role-admin`).
- Verified `/tmp/check-stats.js` vs the seed: sick = 8 people (1101 RSI1/RSO1/URTI1/NonURTI1; 1105 LD+Excuse
  same-day → 1 day); HA matches known states (1101/1103/1110 Single Complete, 1102 Lapsed, 1105 5/10, 2102
  Double Complete 13/13). DECISIONS #46/#47.

**Item 5 — xlsx sick-history importer: NEXT.** Real sample `Sanitised Braves RSI_RSO REC Sheet.xlsx` reverse-
engineered: A=S/N B=FULL NAME C=4D, cols D… = one per day (Excel-serial early, DDMMYY-number later); status =
cell fill colour; reason = cell text; legend embedded in rows 67–72 (red=MC, yellow=LD, green=EX, cyan=RS-no-
status, purple=SENT OUT, magenta=AL/OIL). Plan: add ExcelJS, parse legend at runtime, coalesce same-colour runs.

**Item 1 — parade/sick archiving (GAS cron + admin viewer): AFTER item 5.**

**Item 5 — Sick-history xlsx importer (DONE, committed).** `?v=108`.
- New `js/sick-history-import.js` (DOM-free pure parser): `shColourHex`/`shDeriveLegend`/`shBuildDateMap`/
  `shParsePersonRow`/`shParseWorkbook`/`shEpisodesToRows`. Status = cell fill colour; legend auto-derived from
  the sheet's own legend block (fallback `SH_DEFAULT_LEGEND`); same-colour runs coalesce; explicit
  "nD STATUS (range)" text honoured; Excel-serial + DDMMYY date headers both decoded.
- `forms.js`: `importSickHistoryXLSX` (ExcelJS load) → `openSickHistoryModal` (preview: legend swatches, date
  range, per-person episodes, unmatched list) → `confirmSickHistoryImport` (append Medical + AL/OIL→Leave,
  dedup by d4·startDate·type·status, autoSync upserts). Admin-only `.admin-only` button on Medical toolbar.
- `index.html`: ExcelJS 4.4.0 via cdnjs; module loaded before forms; load-order comment updated.
- Verified 18/18 `/tmp/xlsx-harness/run.js` vs the real `Sanitised Braves RSI_RSO REC Sheet.xlsx` (ExcelJS in
  Node, same lib as browser): legend red=MC…magenta=AL/OIL; D1 serial→13 May, AT1 240626→24 Jun, BA1 10726→
  01 Jul; Adam Lee 1101 RS+LD(3-day coalesce)+MC episodes; 1108 explicit 2D LD; 1409 3D EXCUSE. Sample xlsx
  gitignored. DECISIONS #48. Browser file-upload flow not auto-driven (admin session + native picker).

**Item 1 — parade/sick archiving (GAS cron + admin viewer): NEXT (largest piece; apps-script NOT live-tested).**

**Item 1 — parade/sick archiving (DONE, committed).** `?v=109`. apps-script code-reviewed + traced + cross-
checked, NOT live-tested; redeploy + trigger creation RESERVED for the user.
- `apps-script-Code.gs`: ported generators between `BRAVES-ARCHIVE-PORT BEGIN/END` (assembled via
  `/tmp/assemble-gas.js` from helpers subset + braves-parade.js — exact copy, no transcription) running on a
  STATE built from sheet tabs (`bravesLoadState_`); orchestration `archivePoll` (5-min trigger via
  `setupBravesArchive`), `bravesArchiveNow` (manual), idempotent per (date,slot). Admin-gating added to
  `readAllTabs` (returns paradeArchive/sickArchive only to admins), `doGet` raw-read block, `routeAuthedPost`
  (`archiveNow` action, commander/admin, audited).
- Client: `api.js` pull sets STATE.paradeArchive/sickArchive (admin only) + `API.archiveNow`; `state.js` inits;
  `render.js` `renderArchive`/`renderArchiveList`/`doArchiveNow` (admin guard, parade/sick tabs, filter, copy,
  Archive-now); `index.html` admin-only 🗄 Archive nav; `styles.css` keeps admin nav-btn flex.
- Config keys (set in Config tab): `archiveParadeTimes`, `archiveSickTimes` (comma-sep HHMM).
- Verified: full `node --check` sweep + `/tmp/xcheck.js` 5/5 byte-identical (ported block extracted from the
  committed .gs vs client output on the seed). DECISIONS #49.

**RESERVED FOR USER (not executed):** (1) paste apps-script-Code.gs → redeploy (new version, same URL) +
run `setupBravesArchive()` once to create the 5-min trigger (tabs auto-create); (2) any merge to master / push
to a Pages branch; (3) real credentials/logins; (4) destructive/irreversible ops; (5) sending real messages /
pushing real personnel data; (6) recalibrating the sick-history colour legend if a future export differs.

**BUILD COMPLETE: Items 1, 2, 3, 5 done + committed + self-verified. Item 4 (parade-format parser) remains a
deferred design doc (variant formats not yet provided).**

**Item 4 — PARADE_PARSE_PLAN.md (DONE, doc only).** Rudimentary plan to normalise inconsistent parade-state
formats into the canonical 6-category schema: a line state-machine + a verified **stepwise** entry parser
(balanced trailing-paren peeling handles the app's own nested `(OTHERS (NOT IN CAMP))`; trailing parens kept
in the reason unless a date range or known RSI/RSO/IN-CAMP tag). Tool options: spreadsheet / regex script /
eventual admin-only in-app importer. The `parseEntry` in the doc was run against `Message Formats.md` lines
(5/5 correct incl. the nested-paren and `FEVER (38.0)` edges). Variant formats arrive later → widen then.

---

## Session 2026-06-23 (cont.) — `/code-review` of `Step-3-Onwards` → 8 fixes (commit `b9a77c3`)

Ran a high-effort `/code-review` over `git diff master...HEAD` (active source only: `js/*.js`,
`apps-script-Code.gs`, `index.html`; the `CougarMasterChanges/` reference copy is NOT loaded — excluded).
8 findings confirmed and fixed in one commit. `?v=111 → 112` (all tags bumped together). Frontend fixes
browser-verified via a Node static preview server (`.claude/static-server.js`, since the sandboxed
`python3 -m http.server` couldn't read cwd); backend fixes syntax-checked + logic-traced, **redeploy still
reserved** (apps-script not live-tested).

**The two severe ones were both in the new server-side archive path:**
1. **`bravesLoadState_` read tabs raw** → `r.id` was `undefined` (the Roster sheet column is `4d`), so every
   archive join missed and names resolved to the first roster row. Fix: added GAS ports of the `js/state.js`
   normalizers (`bravesPadD4_`/`bravesNormalizeRoster_`/`bravesNormalizeMedical_`/`bravesPadD4OnLayer_`) and
   applied them at the read boundary. See memory `gas-port-dual-maintenance`.
2. **Archive idempotency never matched** → `appendMany`→`setValues` coerces `"2026-06-23"`→Date and
   `"0730"`→`730`; `readTab` reformats Dates to `dd MMM yyyy`, so `bravesAlreadyArchived_`'s string compare
   always failed → duplicate rows every 5-min poll. Fix: `bravesForceTextCols_` sets the archive `date`/`slot`
   columns to plain-text (`@`) format in `bravesEnsureArchiveTabs_`. `appendMany` left untouched (do-not-change).

**Other 6:** (#3) skip empty-status medical rows in the STATUS bucket — imported RS/SENT_OUT carry `status:""`
and were emitting a blank `"RN - "` line + double-listing (fixed in **both** `braves-parade.js` and the GAS
port); (#7) `bravesParseParadeSlots_` only auto-promotes the latest untyped slot to LP when it's evening
(hour ≥ 16) so a daytime-only schedule no longer mislabels midday as LP; (#4) `submitAttendance` runs its row
through `normalizeAttendance` so the 4 HA columns can't be stripped sheet-wide by a later `replace` push;
(#5) sick-history importer strips a leading `C` from the 4D cell so C-prefixed ids aren't silently dropped;
(#6) `bpBuildIndex` d4→rows index threaded through the Status Board grid/list (`bpClassifyPerson(r,date,idx)`)
to kill O(roster×35×records) rescans; (#8) `bpClassifyPerson` now emits a structured `meta` twin so the
Status Board reads status/reason/type directly instead of regex-scraping its own formatted lines — parade
text output stays **byte-identical** (verified end-to-end on the seed).

**Verified in-browser:** empty-status RS person appears once under REPORTING SICK with `STATUS: 00`; index
path == scan path; STATUS multi-status collapse unchanged; full `generateBravesParadeState` + `generateRSFormat`
run clean, zero console errors.

**Docs cleanup (same session, conservative):** removed the resolved `§20.7` row from DECISIONS.md "Still open"
(decision #42 resolved it); tightened TESTING.md's archive FP/LP line (now "untagged → latest evening slot =
LP") and its `§3` "schema-comment-only" claim (the §5 archiving backend is real code). Authoritative specs,
background Cougar docs, PARADE_PARSE_PLAN, and PRESENTATION left untouched.

**STILL RESERVED FOR USER (unchanged + this session):** paste `apps-script-Code.gs` → redeploy (new version,
same URL) for fixes #1/#2/#3-port/#7 to take effect, and run `setupBravesArchive()` if not already; **one-time:
clear any duplicate rows already in `ParadeArchive`/`SickArchive`** from before the #2 fix. No merge to master /
Pages push done. Note: `.claude/launch.json` now points at the Node preview server — revert to Python if
preferred outside this sandbox.

---

## Session 2026-06-27 → 2026-07-02 — post-v1.1.0 incremental fixes (PRs #5–#30)

**Note on provenance:** this section is reconstructed from `git log`/PR history and the auto-memory
notes written during the work, not a live per-session transcript like the entries above — several of
these PRs were built across independent sessions/branches. Added retroactively because this log had
gone stale since the 2026-06-23 code-review entry above. Detail is compressed accordingly; where a PR's
own commit body already had verification detail (test counts, traced logic), it's carried over here.

### 2026-06-27 — parade strength + sync robustness (PR #5)
Two bugs found post-v1.1.0: (1) `pullAll` gated each STATE assignment on `data[key]?.length`, so a Sheet
tab emptied to `[]` never propagated the deletion to the local cache — fixed by gating on
`Array.isArray` instead (only a genuinely-missing key, from an older backend, still skips). (2) parade
TOTAL/CURRENT STRENGTH silently dropped every MC/LD/Excuse recruit, because `submitMedical` mirrors the
medical status onto `Roster.status` (e.g. `"MC"`) and `bpIsActive()` only counted `"Active"`/blank as
active (DECISIONS #33) — 249 enlistees showed as 239. Fixed by flipping `bpIsActive()` to an explicit
**departed-set** exclusion (Discharged/ORD/Posted Out/Transferred/Withdrawn/Inactive) instead of an
active-allowlist; medical statuses now all count in TOTAL, still correctly drop out of CURRENT via the
Medical/Leave layer. Mirrored in both `js/braves-parade.js` and `apps-script-Code.gs` per the dual-
maintenance rule. Also hardened the "(from conduct log)" origin badge round-trip and added timestamped
export filenames. See memory `braves-roster-status-mirror`.

### 2026-06-28 → 06-29 — mobile responsiveness, medical enum, dashboard scoping (PRs #6, #7)
Medical gained RIB + 7 excuse-type statuses and an auto-computed End date (Start + Days, inclusive).
Mobile fixes: responsive Medical toolbar (wrap + icon-only buttons), top-bar search no longer clipping,
search results re-rendering without losing focus/keyboard on mobile. Dashboard AVG PART. tile and the
RSI Personnel report both gained platoon/section scoping, then a follow-up fixed AVG PART. reading an
undefined `filterVisibleSet` instead of `visibleD4Set`. Separately (PR #7): REPORTING SICK now drops a
recruit once the MO issues any final status (previously stayed listed even after resolution); dashboard
"Not Available" now counts only RSI/MR held while physically in camp; conduct-CSV import, bulk import/
export and email dispatch became admin-only (server-side 403 + UI hide).

### 2026-06-29 → 06-30 — Conduct Dashboard (PRs #8–#11)
New "📈 Conduct Dash" nav view: cumulative conduct-miss buildup, miss-composition-over-time, and
participation-trend charts (scoped by the topbar filter, windowed 30/90/all), sourced from existing
ConductDetail/Attendance data via a new pure `calc.js` aggregation layer. Chart construction now defers
on mobile by default (`STATE.deferCharts`), applied to both this and the pre-existing Strength Board.
Follow-ups: class/series scoping (conducts sharing a base name, distinguished by a trailing instance
number) plus a per-recruit "Class Progression" list; the date window not applying in class mode (fixed);
runaway chart-height growth from an unconstrained `.card` wrapper (fixed by reusing the existing
`.chart-box` pattern); then a 10-finding correctness/perf pass (miss/held/frontier counting edge cases,
per-instance chart-key collisions, buildup-bucket totals not summing to `totalMisses`, participation
metrics reading inconsistent windows) plus a status-grid lazy-load. Test count climbed 55→62→67→72
across this cluster.

### 2026-07-01 — HA calculation fixes + In Camp override (PRs #12–#19)
Four HA bugs fixed against `HA.md` (PR #12): lapse was permanent (a re-completed programme after
lapsing could never recover — `computeHACurrency` now takes the full completion list and restarts the
14-day window on each); the Double programme never enforced its 7-day window; Double reused pre-
qualification Single sessions instead of starting the day after Single qualified; Double stayed
disabled for re-qualified members (resolved by the lapse fix). 83 tests passing after this PR.

A new explicit **In Camp / Not In Camp override** was added to Leave/Out records (PRs #13, #15) so a
commander can mark someone physically present (e.g. Guard Duty) regardless of their leave type —
applied additively across AL/OIL/OTHERS buckets, mirrored into the GAS backend classifier + schema, with
a one-off backfill migration for existing rows, surfaced as a badge on Leave records and the dashboard's
"Out today/this week" widget, and wired into the Leave/Out form as an explicit toggle with smart
prefill. The dashboard's own "In Camp" tile was found to be using a narrower duplicate check (only
excluding active MC/Warded) and was switched to reuse the same `bpStrength` classifier the parade report
already uses. Separately (PRs #16, #17, #19, #18): commander rows stopped showing a spurious 4D suffix;
a resolved Medical Review no longer stays on the pending MR list forever; the `{N}D` status-duration
prefix was generalised from LD-only to RIB/Excuse, then corrected so NIL (a no-duration status) doesn't
inherit a stale duration from a prior dated status; a comment-only note was added explaining why
`bravesParadeRN`/`sickRN` can't reuse `helpers.js`'s display helpers (different output shapes per spec
§7/§10). PR #14 bumped cache-bust versions that PR #13 missed and addressed two CodeQL alerts.

### 2026-07-01 → 07-02 — HA participation grid + eligibility toggle (PRs #20–#23)
HA participation was found to credit a day purely from the CSV participant list without checking
Medical, so a recruit on report-sick (MC/LD/RIB/Excuse PT) still earned HA credit for a day they didn't
train (PR #20; 124 tests passing). The person-modal HA view was rebuilt from a wrapped pill list into a
GitHub-style contribution grid, colour-coded by trained (1 vs 2+ periods)/excused/none (PR #21), then
fixed for a month-label off-by-one at week/month boundaries, with a follow-up fix for bulk-imported
PT-tagged excuses not being recognized as HA-disqualifying (PR #22; the `test/ha.test.js` `status:"MR"`
fixture, which described an impossible state since MR is a visit type not a status, was also replaced).
See memory `braves-ha-pr20-followups` (now resolved/tombstoned). PR #23 added a per-conduct HA ✓/✕
toggle and flipped the HA-eligibility default from a conduct-name guess to the CSV's own `Currency Tags:
HA` metadata (DECISIONS #62) — 137 tests passing.

### 2026-07-02 — Log Conduct wizard data-integrity fixes (PRs #24–#27)
A confirmed live bug: editing a CSV-imported Attendance row through the Log Conduct wizard did a full
`STATE.attendance[idx] = attendanceEntry` replace with only the wizard's own fields, silently blanking
`participants`/`periods`/`currencyTags`/`source` on push — erasing that conduct from every recruit's HA
grid while the conduct log still showed them present. Live victim: Attendance row 11570 (Metabolic
Circuit 4, 18 Jun), restored from the user's same-day xlsx export. Fixed via a `mergeAttendanceEdit`
merge helper (PR #24; DECISIONS #65), then a follow-up found the wizard was still pushing the
wizard-only shape rather than the merged row that actually landed in STATE (PR #25). A `statusReviewed`
flag was added so a restrictive-status CSV participant ticks correctly as not-participating on first
review without a later manual override being silently re-ticked (PR #26; DECISIONS #66). The HA-toggle
chip's own detection logic was found to use a stricter exact-token match than every reader
(`conductHAEligible`), so a multi-tag value like `"HA RM"` could never be toggled off — aligned to the
same `\bha\b` word-boundary rule (PR #25/#27). See memory `braves-wizard-strips-csv-fields`.

### 2026-07-02 — id-collision fix, optional end date, Warded status-board fix (PRs #28–#30)
`nextId()`'s ~9,000-value random keyspace had no uniqueness check, so independent sessions/devices could
mint colliding row ids — a later edit-by-id would silently overwrite an unrelated older row.
Investigated after Report Sick edits for 4Ds 2101/2203/2208 appeared to touch Medical rows belonging to
3105/3106; the user checked the live Sheet directly and found no actual data damage, but re-assigned the
3 offending ids as a precaution anyway. Fixed by widening the keyspace to ~9×10¹¹ with a deterministic
regression test (PR #28; DECISIONS #64). Report Sick's End date requirement was relaxed to a reminder
instead of a block (PR #29; DECISIONS #67). The Status Board was found to render Warded (and other
not-in-camp OTHERS cases) as a blank/generic cell, indistinguishable from in-camp — fixed for Warded
specifically with a dedicated colour/badge, other OTHERS cases deliberately left as a known follow-up
(PR #30; DECISIONS #68). 149 tests passing as of this session.

### 2026-07-06 — Log Conduct wizard group picker + HA opt-in; participants-coercion fix (PRs #32–#33)
The wizard's implicit "whole company attends" assumption was replaced with an explicit, roster-driven
group picker: a single-select dropdown offers each active platoon (read from the Platoons tab via
`activePlatoons()`, never hardcoded — the roster is due to renumber platoons 1–4 to 4–6 with membership
changes, so options and membership both had to resolve dynamically), plus Entire company (everyone,
commanders included), Non-Commanders, and Commanders only. Selected groups accumulate as removable chips
across saves (add a platoon today, another tomorrow), resolving to a real NET `participants` snapshot on
the Attendance row — the same comma-joined-4D shape the CSV importer writes — captured at add-time so a
later roster reorg doesn't rewrite historical attendance. The medical-status checklist now scopes to the
selected participants instead of a blanket commander exclusion, and a new "Counts toward Heat
Acclimatisation" checkbox (with a Single/Double period selector) lets a wizard-logged conduct earn HA
credit for the first time — HA gating moved from a raw `source==="csv"` check to a `haCountsRow()`
helper that keeps CSV behaviour byte-identical while gating wizard rows purely on their own checkbox,
deliberately bypassing the `haEligibilitySource` config (DECISIONS #70–72). The PR #24–#27 CSV-field
merge-safety contract was the highest-risk surface here — the save path was shaped so `source` never
flips an existing "csv" row to "wizard", and `periods`/`currencyTags` only change when the checkbox is
actually touched — verified with dedicated merge-preservation tests and an end-to-end browser check on a
seeded CSV row. Planned via Explore + Opus Plan agents and two rounds of user clarifying questions;
implemented as 10 commits across 3 Sonnet workers, with 2 review-caught bugs (duplicate chips on
re-adding a group; the status checklist not rebuilding when a group was added/removed) fixed before
merge. Tests climbed 149 → 183 (PR #32).

Separately, a live-data corruption bug was found and fixed in the conduct-CSV importer: the Attendance
`participants` field (a comma-joined 4D roll) was being silently mangled by Sheets' number
auto-coercion — commas read as thousands separators, then IEEE-754 zero-fills the tail past ~15
significant figures — corrupting the roll on every `writeTab` push and giving the affected conduct zero
HA credit company-wide with no visible symptom besides bad HA numbers. Fixed by forcing the column to
plain-text (`@` format) in `writeTab`, reusing the same `bravesForceTextCols_` mechanism already applied
to the archive tabs (DECISIONS #73), with new Sheets-mock methods (`setNumberFormat`/`getMaxRows`) and
regression tests (PR #33). Both PRs merged straight to `master` (#32 then #33, no conflicts — one
frontend, one backend); the backend fix still needs a live Apps Script redeploy before it takes effect,
joining the existing PR #31 redeploy queue.

## Session 2026-07-07 → 2026-07-12 — HA optimiser, Parade State tab, upstream ports (PRs #34–#52)

**Note on provenance:** reconstructed from PR history, `SESSION_CONTEXT.md` snapshots, and auto-memory —
several PRs were built across independent sessions/branches. Compressed accordingly; DECISIONS #74–#78
carry the judgment calls.

The stretch delivered three threads. **HA** (#34/#35/#36): individual-recruit attendees, a reusable
person-search typeahead, subset-import absentees, grid forecast cells and a Double-HA projection; then a
best-start rewrite of the HA scan (`simulateFrom` + try-every-active-start) that closed a support case
(recruit 3101 stuck "Not Started" under the old greedy reset) — a deliberate divergence from `HA.md`'s
forward-pass wording, DECISIONS #74. **Parade State tab** (#38–#45): a dedicated tab (company text +
editable platoon grid, code→record write-back, MR as its own section, ended-MC-until-booked-in via the
shared §8 classifier), then commander sort + per-platoon copy (#41), 4D-ascending sort (#40), a platoon-
level copyable message (#44), and a same-type-status supersede-by-latest-end-date pass (#45). PR #39's
Status-Board over-paint across the pre-MC gap was reverted by #42 — roster.status alone decides booked-in
state (DECISIONS #75/#76).

**Upstream cougar-system ports** (this session's focus, #46–#50): reviewed the 27 upstream commits from
`2358eae` on, built a 13-row assessment matrix, and implemented the five selected items as independent
sequential PRs (merge order 1→2→3→4→5), each TDD'd against the zero-dep harness and browser-verified by
seeding STATE past the auth overlay. #46 drops an extended-MC recruit from the borderline-returnee list;
#47 is a deliberate **no-op port** — a regression test + `bpBuildBlock` comment locking Braves' spec-
mandated multi-section listing against upstream's ATT C/OTHERS dedup (DECISIONS #77); #48 bulk Leave/Out
by company/platoon/section via one `appendMany` (the #6 batching idea cherry-picked); #49 IPPT multi-
attempt charts (progression / award-mix / compare, scoring untouched); #50 an admin parade-compare view +
exact-text-on-copy archive reusing the existing `paradeArchive` path rather than upstream's 679-line
module (DECISIONS #78). Follow-ons #51 (rank prefix, textarea above grid, roster notes on card) and #52
(dedupe duplicate script tags) landed alongside. **234/234** tests. **GAS redeploy still outstanding**
for #50's exact-text path (and the older #31/#33/#45 backend changes). Provenance flag (RESOLVED
2026-07-13): the earlier "#51 merged but `origin/master` @ `9261166` lacks it" was a stale remote-
tracking ref — `git fetch` advanced `origin/master` to `e7d06bb` (Merge PR #51), which contains `85da04f`.
#51 (rank prefix on parade R/N, platoon textarea above grid, roster notes on person card) is genuinely
merged; branch `feat/parade-rank-notes-textarea-position` is fully contained in master and safe to delete.

---

## Session 2026-07-15 — GAS parade-port drift guard + doc corrections

Started from three questions about claims in the docs, all of which turned out to be wrong in
different ways. Synced `master` first: it was 2 behind `origin/master`, fast-forwarded `e5b3618` →
`8094f83` (PR #60, IPPT auto-score follow-up). Working tree still carries a pre-existing
`sample_polar.csv` deletion, left untouched.

### The tooling trap that shaped the whole session

`.gitignore` carries a bare `*.md` (intended for "loose personal notes"), so **zero** markdown files
in this repo are tracked — not `CLAUDE.md`, not `docs/`, not `CHANGELOG.md`, and not the Braves spec
docs that `CLAUDE.md` calls "the authority" for parade/HA logic. They have no history and no backup.
Compounding it, the shell's `grep` is a function wrapping `ugrep --ignore-files`, which honours those
same rules — so `grep -r 'sandboxIssueTokens' .` returns **nothing** while the string sits in
`CLAUDE.md` line 25, and `git log -S` on any doc text always reports "never existed". Both false
negatives nearly ended the investigation early. **Use `command grep -r` for docs.** Recorded in
DECISIONS #81 and a new `CLAUDE.md` Conventions entry.

### `sandboxIssueTokens()` — never existed (DECISIONS #81)

Not deleted; never written. `seed-synthetic.gs`'s entire history is two commits (`3a3e71b` added it,
`6a47bc8` tweaked it), neither containing the function; its only entry point is `seedSynthetic()`.
`docs/SANDBOX.md:89-93` already said so and had been ignored. `CLAUDE.md` corrected: the human logs
in via the app's form, `handleLogin` issues the real 30-day token, token gets injected at runtime.

### The dual-maintenance gap — real, already drifted, but benign (DECISIONS #80)

`docs/BACKEND.md` was right that `/tmp/assemble-gas.js` is gone and unrecoverable, but wrong that the
backend copy had *"zero parade-logic coverage"* — `test/harness.js:33` `loadBackend()` has always run
the real `.gs` in a vm sandbox, and `test/backend.test.js:178-198` already exercised the **port's**
`bpClassifyPerson`. That existing machinery is what made this cheap. It was also wrong that no
cross-check ever existed: DECISIONS #49 records `/tmp/xcheck.js` running **5/5 byte-identical** at
port time — it diffed *rendered output on a seed*, not source, then died with `/tmp`.

An audit found the copies **had already drifted**: 5 functions (`bpClassifyPerson`, `bpGridCell`,
`bpIsActive`, `bpPrimaryForDay`, `bpSupersedeSameType`) diverged and 2 (`bpBuildIndex`,
`bpIsNotAvailable`) were never ported, all from `5131b1b` (status-grid MC-tail) touching the frontend
only. **Structural, not semantic** — the `sup` → `meta` + `idx` refactor feeds the Status Board grid,
the archive path never passes `idx`, and a prototype confirmed both copies still emit identical text.

### `test/parade-port-parity.test.js` (new, 14 tests)

Feeds both copies the same `STATE`; asserts identical emitted text. Invariant is **behavioural
equality, not byte-identical source** — byte-identity fails today and would force UI-only plumbing
into GAS. Frontend side loads the **real** `js/state.js` + `js/helpers.js` + `js/braves-parade.js`
(not stubs), so the port's duplicated helper copies get cross-checked transitively. `STATE` is
`const` (`state.js:166`), so fixtures are installed from inside the vm context. Covers
company/PLT1/PLT2 parade + RS + RSI — restoring the lost harness's 5/5 — plus a fixture per parade
section, the ended-MC tail, and same-type supersede.

Two things worth remembering:
- Fixture dates **must** be `"DD MMM YYYY"`. The real `displayDateToISO` returns `""` for ISO input,
  which silently makes a row inert; the first fixtures produced an all-`00` report that "passed"
  vacuously. Each test now asserts its section is actually populated.
- **Negative control run:** mutating `CURRENT STRENGTH` inside the port made the suite go red naming
  the exact line (`"CURRENT STR: 4"` vs `"CURRENT STRENGTH: 4"`); reverted and confirmed
  byte-identical to backup. A parity test that can't fail is decoration.

**249/249 tests pass.** No production code touched — the drift is benign and was left alone.
**Shipped + MERGED as PR #61** (branch `test/parade-port-parity-guard`, commit `5b2fd8f`, merge
`f3a01af`) — test-only, per `COMMIT_CONVENTIONS.md` ("do not commit any .md unless explicitly told");
CI `test` green on GitHub. Merged branch deleted locally; `origin` auto-pruned it.

### Docs corrected

`CLAUDE.md` (sandbox bullet, grep trap), `docs/BACKEND.md` (coverage + harness-history claims),
`docs/ARCHITECTURE.md`, `docs/README.md`, `docs/frontend/braves-parade.md`, `MD_Docs/TESTING.md`
(the "nothing catches a drift" / "`/tmp/xcheck.js` asserts byte-identical" passages, now false in
opposite directions). Spec: `docs/superpowers/specs/2026-07-15-parade-port-parity-design.md`.

### Open / noticed, not acted on

- **`*.md` in `.gitignore`** — the specs, changelog, and every doc are untracked and unbacked-up.
  Flagged; the fix (un-ignoring docs while keeping personal notes local) was not taken up this
  session.
- ~~**Docs moved mid-session:** the root spec docs relocated into `MD_Docs/` at 11:03 (user-side,
  while work was in flight); `CLAUDE.md` still pointed at root paths.~~ **RESOLVED** — repointed
  `CLAUDE.md`'s doc-hierarchy to `MD_Docs/` (with a note that older commits saying `HA.md` mean
  `MD_Docs/HA.md`). The move had also broken **19 links across 9 files** in `docs/` (`../TESTING.md`,
  `../../HA.md`, …); all repointed. Verified: **all 170 doc links resolve, 0 broken.**
- **No assembler.** Re-authoring it remains a separate proposal; the parity test is the prerequisite
  that would make one verifiable, not a substitute.

## Session 2026-07-15 — PR #62 review calibration + context reconciliation

### PR #62 review

Reviewed **PR #62, Selected-people Leave/Out groups** (`9da32d7..ac1b621`, merged on GitHub as
`327f0e5`). The first review response was too terse: although the patch and surrounding functions had
been inspected, the final answer reduced the evidence to `node --check` + `npm test` and did not show
the adversarial reasoning. The user set **PR #61** as the calibration point for both review depth and
PR-description substance.

The redo traced the full path: real `personSearchPick` callback → accumulated/deduplicated scratch
state → chip rendering/removal → per-person Leave rows → one `appendMany` → OCC/dirty retry,
then checked commander `00xx` normalization and the downstream Leave/quota/parade consumers. It also
checked edit/organisational-scope compatibility, cache-busting, escaping, and modal reset/scope-switch
state. One non-blocking maintainability mismatch remains: `js/helpers.js`'s `scopeRecruits` comment
still broadly says "bulk leave targets recruits", while the new selected-person bulk path may include
commanders; the function comment should distinguish organisational scopes from the selected path.

Fresh exact-head verification: `git diff --check` + `node --check` pass; **254/254 tests**. Two
negative controls were non-vacuous: removing picker accumulation and changing Leave `appendMany` to
`upsert` each produced **252 pass / 2 fail**. A standalone integration probe exercised the real
typeahead callback, retyping, selection persistence, and scope visibility. The deployed page loads
`forms.js?v=142` with no console errors; authenticated modal interaction was not independently repeated
without a real account, so the PR author's browser QA remains the visual/mobile evidence.

### Durable workflow preferences

- Worktree branches must use the descriptive branch name directly, with **no `codex/` prefix**.
- Reviews must seek and report subtle behavioural/data-flow risks, test non-vacuity, negative controls,
  and residual limits; green tests are supporting evidence, not the review.
- PR descriptions should cover why/failure mode, behaviour/data shape, preserved invariants, edge cases,
  verification, and remaining risks at roughly PR #61's level of substance without mandatory verbosity.

### Reconciled live state

Main checkout is clean on local `master`/local `origin/master` @ `9da32d7`, but those refs have not
fetched the GitHub merge of PR #62. Active linked worktrees are `/private/tmp/braves-system-leave-selected-people`
(`codex/leave-selected-people` @ `ac1b621`, serving Python HTTP on :8777) and
`/private/tmp/braves-system-leave-timeline-collapse` (`codex/leave-timeline-collapse` @ `9da32d7`).
The older local `fix/ippt-import-autoscore-followups` branch remains while its remote is gone.

## Session 2026-07-15 — Leave timeline collapse + PR #63

### Leave/Out timeline

Implemented the requested compact 21-day Leave/Out timeline: show the first **five** people initially,
retain all overflow rows in the DOM, and expose exact `Show all (N more)` / `Show less` controls with
`aria-expanded`. Scope filtering, total counts, row order, the existing horizontal-scroll wrapper, and
the All entries table are unchanged. The timeline resets to collapsed on a normal re-render.

Tracked implementation: `js/render.js`, `test/leave-timeline.test.js`, and the `render.js`
cache-buster in `index.html`. Commit `f012042`. Focused tests cover the five/six-person threshold,
overflow count/order, scoped counts, and both toggle directions. Controller browser QA covered desktop
and narrow mobile widths, exact labels/counts, expansion/collapse, control placement, and page-level
overflow. Pre-integration verification was **253/253**.

### Cache-bust conflict and merge

PR #63 initially became `DIRTY` after PR #62 advanced `forms.js?v=141→142` on the line immediately
after this branch's `render.js?v=136→137` edit. The values did not logically conflict; Git grouped the
two adjacent script tags into one overlapping hunk. Merged current `origin/master` into the feature
branch and resolved the only conflict to preserve both:

- `render.js?v=137`
- `forms.js?v=142`

The resolution merge is `354859c`. Post-resolution verification: **258/258**, `git diff --check`
clean, no conflict markers. GitHub tests and both CodeQL analyses passed. **PR #63 merged** as
`2735125`.

### Reconciled live state

Main checkout is clean on `master` @ `9da32d7`, now **six commits behind** `origin/master`
@ `2735125` (PRs #62 and #63). The two merged feature worktrees remain at
`/private/tmp/braves-system-leave-selected-people` and
`/private/tmp/braves-system-leave-timeline-collapse`; their `codex/` names predate the newly recorded
no-prefix convention. Python PID 63914 still serves the selected-people worktree on :8777.

## Session 2026-07-15 — Leave timeline tied-date ordering + PR #64

### Deterministic collapsed ordering

The timeline-collapse feature from PR #63 exposed an equal-date comparator defect: `renderLeaveTimeline`
returned `1` even when two people shared an earliest leave date. Timeline people are grouped in an
object, so ties were then ordered by incidental JavaScript key enumeration. This is user-visible because
only the first five rows render initially.

User chose canonical 4D ascending as the explicit tie-break. `renderLeaveTimeline` now sorts by earliest
date first, then lexical canonical 4D. The regression uses six equal-date people including commander
`0001`; before the code change it rendered after numeric keys and was collapsed, while afterward the
visible order is `0001,1001,1002,1003,1004` and `1006` is the hidden sixth row. The production edit
also bumped `render.js?v=137→138`.

Commit `c048de4` (`fix: stabilize leave timeline tie order`) was pushed on
`fix/leave-timeline-tie-break`. Verification was `git diff --check`, `node --check js/render.js`, and
**259/259** `npm test`. Draft PR #64 was created, then merged as `e8847a0`:
https://github.com/CGuang-Yi/braves-system/pull/64.

### Reconciled live state

The main checkout was fast-forwarded to PR #63 earlier in the session and is clean at `2735125`; its local
`origin/master` ref has not fetched the subsequent PR #64 merge yet. The new linked worktree remains at
`/private/tmp/braves-system-leave-timeline-tie-break` on `c048de4` for follow-up if needed.

## Session 2026-07-18 → 2026-07-19 — bookInDate five-fix batch → ConductDetail atomic sync → PR #70 batch (PRs #65–#70)

### Five-fix batch + adversarial follow-ups (#65, #66)

Shipped a five-fix batch on `fix/5-fixes-bookindate` (10 commits, merge `1f56881`): mobile form controls
raised to 16px so iOS Safari stops focus-zooming; Enter completes the top match in person pickers and the
topbar search; the conduct-wizard Status section unions saved "Status" ConductDetail rows so CSV
status-absentees don't vanish from the checklist; the parade grid locked to editing only MC/AL·OIL/OTHERS
book-ins as Present; and the headline change — **`roster.status` demoted from a medical-status mirror to
active-vs-departed only**, replaced by an immutable `bookInDate` column on Medical **and** Leave. "Mark
Present" now books a recruit in via `bookInDate` without rewriting the record's own start/end dates; the
§8 classifier's `bookedInBy` guard was mirrored into both `js/braves-parade.js` and the GAS port; the Roster
badge derives live from `rosterDisplayStatus()`; the topbar "Active" count reads `bpStrength().current`.
Requires `bravesMigrateSchema` for the new column (sandbox run; prod unconfirmed).

An adversarial review of the merged #65 (on a fresh branch, since #65's origin branch was already deleted)
produced PR #66: `rosterDisplayStatus` now builds an `effByD4` map once instead of rescanning medical rows
per roster row (was O(roster×medical)); `bpStrength` builds its d4 index once via `bpBuildIndex()` and
threads it through `bpClassifyPerson` (verified byte-identical output against the unindexed version); and
the old parade status-editor (`saveParadeCode`/`openParadeCodeEditor`/`paradeStatusOptions`/
`paradeActiveMed`/`paradeActiveLeave`/`PARADE_CODES`) was deleted as dead code once #65's grid lock made it
unreachable (−192 lines). 273/273 tests at merge.

### ConductDetail atomic-sync fix (#67)

Investigated the "ConductDetail rows go malformed after reload" bug on `fix/conductdetail-atomic-sync` and
found two compounding defects: the wizard synced ConductDetail as a non-atomic `delete×N + appendMany`
(separate queued writes — a failed trailing `appendMany` after the deletes committed left rows
deleted-but-not-re-added), and launch `pullAll` overwrote every tab unconditionally, wiping cached-but-unsynced
rows before a reload could replay them. Fix: a new atomic, idempotent backend op `replaceConductRows`
firing as **one** write, plus a `pullAll` dirty-guard that preserves any tab still marked dirty instead of
clobbering it. A **third** defect surfaced only once the fix was driven against the live sandbox rather than
the vm test mock: the delete-match compared raw `String()` sheet cells, but a live Sheet stores `date`/`time`
as coerced `Date` objects — `readTab` reformats those before returning them to the client, so the match never
matched and the delete silently no-op'd. Fixed by normalizing compared cells the same way `readTab` does.
279/279 tests. Covered by DECISIONS #85/#86.

### Sandbox token minter (#68)

Added `sandboxMintToken()` to `seed-synthetic.gs` — a password-free session-token minter for the synthetic
sandbox that replays exactly what `handleLogin` writes on a real login. Sandbox-only file; no production
code touched.

### Time-coercion duplication fix + live e2e verification (#69)

Root-caused a morning-conduct duplication bug: ConductDetail's `time` column wasn't in
`WRITE_TEXT_COLS_BY_TAB`, so a leading-zero time like "0730" was stored as the number 730 — the
`replaceConductRows` delete-match (from #67) then never matched it, and every re-save duplicated the
conduct's rows. Fixed by adding `time` to `WRITE_TEXT_COLS_BY_TAB.ConductDetail` (so future writes can't
coerce again) plus a `normTime` legacy-heal in the delete-match that left-pads already-coerced numeric cells
so pre-fix rows still match. Also extended the `pullAll` dirty-guard to VocFit/Platoons, which were being
assigned unconditionally. 282/282 tests, then **verified live end-to-end against the redeployed sandbox
`/exec`** (results posted as a PR #69 comment) — both the sandbox and prod GAS deployments were redeployed.

### Section bento, Enter-to-save, invite-generator removal (#70)

Delivered via subagent-driven development, with a commit-message convention cleanup alongside the feature
work: a section-level strength bento on the dashboard (`sectionStrengthBreakdown`, with extras-platoon
ordering and non-numeric section sort covered by new `test/section-bento.test.js`); Enter-to-save in the
conduct-logging wizard, gated by an own-modal guard added after the final whole-branch review caught a
phantom-save defect — a cancelled wizard leaves `_logConduct` populated, so a bare Enter listener could
re-save the cancelled wizard from inside a different, currently-open modal; and removal of the
editor-only invite generators `generateInvite`/`generateBulkInvite` from `apps-script-Code.gs` as dead code
(the redeem/revoke path is unchanged). 289/289 at merge; suite now 292/292 on master.

### Reconciled live state

Local `master` was fast-forwarded to `1c8adfb` on 2026-07-19; all six merged local branches from this
session (#65–#70) were deleted. The repo is master-only and in sync with `origin/master`. **292/292 tests
pass.**

---

## Session 2026-07-20 — Sync-perf live measurement pass + P4-1 (PR #73)

Picked up `SYNC_PERF_IMPROVEMENTS_SPEC.md`'s remaining work: the live-deployment speed tests (§0.5
item 1), the two gated items (P2-5, P3-3), and the blocked P4-1.

### The measurement, and a wrong premise caught early

The session opened with "backend sandbox GAS has been redeployed." Probing `?action=<bogus>` before
measuring showed the returned action list did **not** contain `readTabs` — i.e. the sandbox was still
running `master`'s backend, not the branch's. Reported rather than measured through, which is exactly
the §0.5 ordering trap (a version mismatch doesn't error; it silently measures the fallback path).
The mismatch turned out to be useful: it made a clean **before** pass possible immediately. The user
then redeployed, the probe was re-run to confirm, and the **after** pass followed.

Three passes total (before / branch-frontend+old-backend / full). Results in spec §8.5 and the new
§8.5.5. Headline: warm-cache first paint **8471 ms → 52.9 ms**, warm no-change payload
**106.2 KB → 210 B**, 20-edit burst **20 → 1** localStorage writes, 3-tab warm launch reduced to
revCheck + exactly one `readTabs`. GAS per-request tax measured **~2.0 s**.

The load-bearing finding: **only round-trip elimination is measurable.** P2-2, P2-3 and P3-1 all cut
server-side work and all landed inside variance. That is the evidence that closed the gate against
P2-5 (parked), and it's recorded as DECISIONS #89/#91.

### A defect the offline harness could not have found

The `readTabs` capability probe re-ran on *every* multi-tab pull, burning ~1.9 s each time — and the
20 s poller takes that path whenever 2+ tabs change, so it was not launch-only. Memoized per session,
deliberately not persisted (a manual redeploy is invisible to the client, so a persisted "unsupported"
flag would strand a device on the slow path). The offline harness's "network" is an in-process call
with no per-request tax, so a wasted round trip costs nothing there and trips no assertion.

### P4-1 shipped with its condition attached

§7 Q2 had blocked P4-1 since the spec was written; the user approved the 20 s → 60 s idle stretch
**conditional on the slower cadence being visible**. Implemented with a tappable
"✓ Synced · Check now" pill, the interval stated in the sidebar, and resets on any activity. The
condition is recorded as binding in DECISIONS #90 and in `docs/frontend/sync.md` — a silent stretch
is specifically what was not approved. **P3-3 parked** per the user's call.

### Method traps worth keeping

Two cost a false reading each and are now encoded in `tools/bench/make-bench-page.js`'s header and
the handoff doc: (1) clearing `localStorage` while the app is live does **not** give a cold launch —
the running page's debounced `saveLocal` and 20 s poller rewrite the cache before the reload lands;
navigate to an inert same-origin URL first. (2) The first-paint probe must be injected immediately
before `js/main.js`, because `bootstrap()` is a parse-time IIFE — a `DOMContentLoaded` listener misses
the warm-path `render()` entirely and reads back `null`. Don't use rAF polling either; it's paused in
a backgrounded tab.

### Convention violation, caught by the user

Committed three times with a `Co-Authored-By:` trailer, which `COMMIT_CONVENTIONS.md` (untracked,
and invisible to `grep -r`/`git log` because `*.md` is gitignored) forbids. The user flagged it; the
trailers were stripped via `git filter-branch --msg-filter` and force-pushed with `--force-with-lease`
(tree verified byte-identical, messages only). The user then extended the rule to PR bodies, so the
"🤖 Generated with Claude Code" footer was removed from PR #73 and the rule was widened in both
`COMMIT_CONVENTIONS.md` and the `no-coauthor-trailer` memory. **Read `COMMIT_CONVENTIONS.md` before
the first commit of a session** — it will not surface any other way.

Also of note: PR #72 was already merged, so `perf/sync-engine-improvements` was a closed branch. The
work was moved onto `perf/adaptive-poll-cadence` off `origin/master` instead, and the suite re-run
green on the new base.

### State

**351/351 tests** (up from 344). ~~PR #73 open~~ **PR #73 MERGED** to master (`a9ca423`): 3 commits,
frontend + tooling only, no GAS redeploy needed. Sandbox dataset was mutated during the pass —
`seedSynthetic()` resets it. One item remains open across the whole sync-perf programme: **P2-4
verification**, handed off in `HANDOFF_P2-4_AUDITLOG_CAP.md` — the account-access blocker is now
resolved (`admin@sandbox.local` added to `seed-synthetic.gs` + seeded live), leaving only steps
2–5 of that doc (grow AuditLog past 500 rows, capture + compare via the bench harness, record the
result).

## Session 2026-07-20 (late) — omit-on-status widening, Leave Days→End, token cleanup (PRs #74–#78)

Five-item batch off `master` (@ `a9ca423` → `36752a1`), all merged and the GAS backend redeployed.
Started by fast-forwarding local `master` 17 commits (through PR #73), then brainstormed the batch
(spec at `docs/superpowers/specs/2026-07-20-rs-omit-leave-days-token-cleanup-design.md`, local-only)
and shipped it as sequential PRs.

- **PR #74 (`c72eae9`)** — recovered an admin-role sandbox account (`admin@sandbox.local`) from
  `stash@{0}`; the change was documented in `docs/SANDBOX.md`/the skill/`HANDOFF_P2-4` but never landed
  in the tracked `seed-synthetic.gs`. Also confirmed `stash@{1}` (id-collision fix + report-sick import
  toggle) was fully superseded on master and dropped it; `seed-synthetic.gs` calls none of the
  token-cleanup functions, so PR #77 can't break the sandbox.
- **PR #75 (`a9998ee`)** — extended the "omit personnel already on status" toggle to the RSI Personnel
  report (`generateRSIPersonnel` gains `opts`, filter before the platoon partition; checkbox gate
  `isRS`→`showOmitToggle`; onchange dispatches the live report type instead of a hardcoded `'RS'`).
  First direct test coverage for the feature (`test/rs-omit-on-status.test.js`).
- **PR #76 (`9e0c99e`)** — Leave/Out wizard Days→End auto-calc (`recalcLeaveEndFromDays` +
  `recalcLeaveStart`), whole-numbers-only so half-day quota behaviour is unregressed; behavioural test
  extracts the real handlers from source by brace-matching (`test/leave-days-end.test.js`).
- **PR #77 (`affccd5`)** — executed `TOKEN_CLEANUP_SPEC.md` repo-side: deleted `isValidAuth` +
  `redeemInvite` + doPost branch, KEPT the three invite editor-helpers for the live cleanup, flipped
  the backend test assertion to assert absence, fixed stale comments.
- **PR #78 (`c27a088`)** — widened the omit predicate (`bpHasPriorStatus`→`bpHasOtherStatus`) to
  suppress same-day/future statuses too; blank end date does not suppress. GAS twin mirrored;
  parade-port-parity green.

**State:** all five merged; local `master` = `origin/master` = `36752a1`; **376/376 tests**; working
tree clean; the four batch branches deleted (verified content-on-master via grep, not just SHA).
GAS backend redeployed by the user. DECISIONS #94/#95, CHANGELOG `[Unreleased]` updated.

**Reserved for the user (from PR #77):** run `listInvites()`/`revokeInvite()` in the Apps Script
editor against production to clear leftover `invite:` keys, then a trivial follow-up can delete the
three kept helpers. **Unverified:** none of the DOM-observable changes (#75 checkbox, #76 Days→End)
were exercised in a live browser — covered by vm tests + wiring assertions only.

## Session 2026-07-21 (06:20 +08) — adversarial review of PRs #68–78 + follow-up fixes (PR #79)

Scheduled adversarial `/code-review` of PRs **#68–78**, done by hand (diffs, GAS↔JS parity, sync-engine
tracing) and reported — **no PR comments posted** (task asked for a summary, not a write action).
Verified `master` up to date with `origin/master` (`36752a1`) and the full suite green (376/376).

**Outcome: no high-risk issues.** Two suspected bugs were chased and cleared (the #73 "Check now"
affordance is reset by `setSyncIndicator`; the #72 `readTabs` re-probe waste is exactly what #73's
`_readTabsUnsupported` memo fixes). Three low-severity items found; the batched-`deleteRows`
run-grouping, `readTabTail` tail math, `saveLocal` debounce, and adaptive-poll state machine all
verified sound.

**User asked to fix findings 1 & 3 → PR #79** (`d2ca4c8`, branch `fix/stale-invite-copy-and-warm-launch-auth-guard`,
off `master` `36752a1`, pushed; **not** self-merged):
- **#1 (stale invite copy):** #70/#77 removed the invite-token flow but left invite wording in three
  logged-out empty states (`render.js` dashboard + roster table, `parade-tab.js`) plus a comment →
  rewritten for password login.
- **#3 (warm-launch modal-over-login):** `afterLaunchSyncSettles()` (main.js) is called after
  `autoSyncOnLaunch()`, which swallows an `AuthError` internally (→ `handleAuthFailure` → `showLogin`)
  rather than rejecting; the settle steps then ran on a cleared session and the un-guarded
  `maybeRunConductMigration()` could pop a modal over the login overlay. Now returns after
  `applyRoleUI()` when `STATE.authToken` is gone, matching the cold path. (`maybeRestoreDirty` was
  already token-guarded.)
- Cache-busts: render 142→143, parade-tab 10→11, main 120→121. **376/376.**

**Finding #2 left as-is:** PR #78's widened predicate suppressing same-day/future statuses is
intentional per DECISIONS #94; flagged so it stays a conscious call, not fixed.

**Review checkpoint (per user):** latest braves-system PR reviewed = **#78**; latest cougar-system
upstream commit reviewed = **`10567a5efbcf3f6c3e566711b0c9c04cc47d1a04`**. Recorded at the top of
`SESSION_CONTEXT.md`. **PR #79 approved, to be merged** by the user.

---

## Session 2026-07-21 — conduct-wizard recovery/strength + parade grid multi-status (PR #81), parade status colours (PR #82)

Two threads on 21 July. **PR #81** (`feat/conduct-wizard-parade-grid`, MERGED `d917cbd`, 3 commits) is a
conduct-wizard + parade-grid batch. **PR #82** (`feat/parade-status-colours`, OPEN) colour-codes the
parade statuses and ships a one-block sandbox token minter. This log section also records the rebase that
reconciled #82 onto #81 (they touched the same grid region).

### PR #81 — three commits

- **`a68fd2f` per-tag recovery tick/untick buttons (conduct wizard).** The recovery "ghost" tags
  (post-MC/LD `+1`/`+2` days) are seeded **ticked** by `rebuildLogConductStatus` (`statusParticipates`
  strips the suffix → MC/LD → doesn't participate), but a recovery-tag person is usually back to training,
  so the wizard now offers a bulk **tick/untick** button per recovery tag actually present on the
  checklist. New pure helpers in `forms.js`: `statusRowIsPureRecovery(statusTag)` (a row is "pure
  recovery" when EVERY active status on it is a `+1`/`+2` ghost), `recoveryTagRows(statusList)` (maps each
  present recovery tag → the d4s of pure-recovery rows carrying it), and `wizToggleRecoveryTag(tag)`
  (if all target rows are ticked, untick them all; otherwise tick all — then a full re-render). Absent
  tags draw no button.
- **`8aad800` display-only "without commanders" strength view (conduct wizard).** A checkbox
  (`wizToggleExclCommanders`) that recomputes and shows the strength count excluding commanders —
  display-only, does not change what is saved.
- **`ba80806` parade grid lists ALL concurrent statuses (multi-status).** See DECISIONS #96. The platoon
  grid previously collapsed each person to the single §8 primary code, which **hid** a lower-priority
  *toggleable* status (MC/AL·OIL/OTHERS) whenever a higher-priority *non-editable* one (RS/STATUS)
  outranked it — making the hidden status unbookable from the grid. `paradeClassifyPlatoon` now returns
  `{ r, codes, remark, notInCamp }` where `codes` is an ordered array (new `PARADE_CODE_ORDER`) of every
  section the person is classified into; the grid cell renders **one control per status, stacked
  vertically** (editable → Present select, or a read-only chip). Book-in stays whole-person.

Tests added: `test/log-conduct-wizard.test.js` (+137), `test/parade-grid-multistatus.test.js` (+88),
`test/render-wiring.test.js` updated. `forms.js` +106, `parade-tab.js` +67/−32.

### PR #82 — parade status colours + one-block minter

- **Colours.** A per-status palette (`--ps-*` in `styles.css`; mirrored as `PARADE_CODE_HEX` in
  `parade-tab.js` for the hex+alpha grid pills): Present green `#3FB950`, AL/OIL dark-green `#2C8A4B`,
  MC red `#F85149`, RS burnt-orange `#C4611C`, STATUS yellow `#E3B341`, OTHERS maroon `#B04A5A`, MR
  light-blue `#79C0FF`. Applied to **both** the bento header `.val` figures (via the `var(--ps-*)`
  names) and every grid code control (tinted select / `.ps-badge` pill). Palette approved by the user
  before implementation; MC↔OTHERS swapped from the original request and RS darkened for contrast.
- **One-block minter (`seed-synthetic.gs`).** `sandboxMintAllTokens()` mints viewer + commander + admin
  in one editor run and logs a single copy-paste console block (`apiUrl` + a token-per-role map + a
  `useSandbox("viewer"|"commander"|"admin")` switcher). Token-write core factored into shared
  `sandboxMintOneToken_`/`sandboxDeployedUrl_`; `sandboxMintToken`'s output is byte-for-byte unchanged.

### Rebase reconciling #82 onto #81 (this session)

`feat/parade-status-colours` was cut from the pre-#81 `master` (`0ac2e65`). After #81 merged, the branch's
rewrite of the same grid region read — against current `master` — as **deleting** `PARADE_CODE_ORDER` and
the multi-status logic, i.e. it would have reverted #81. Rebased onto `origin/master` (`d917cbd`) and
re-applied the colouring **inside** #81's `x.codes.map(...)` loop (each concurrent `cc.code` tinted via
`PARADE_CODE_HEX`), keeping both `PARADE_CODE_ORDER` and `PARADE_CODE_HEX`. Bumped `parade-tab.js?v=13`
(master already used v=12 for #81) and tidied the commit layout so the cache-bust rides the feat commit.
Diff vs master is now purely additive. **402/402.** Verified live on the sandbox `/exec` (119-person
synthetic company): person **4308** renders two stacked tinted controls (AL/OIL dark-green + OTHERS
maroon), single-status rows match (MC red, STATUS yellow, Present green), no console errors. Force-pushed
with `--force-with-lease`; PR #82 was **MERGED by the user as `fbb4bf0`** shortly after — and it is the
**rebased** version (`origin/master` carries both `PARADE_CODE_ORDER` and `PARADE_CODE_HEX`), so the merge
did **not** revert #81. `origin/master` = `fbb4bf0`; local `master` sits 7 behind (FF pending). One
coverage gap: no active **MR** record in the seed at the tested date, so the MR grid pill (light-blue)
isn't exercised on real data.

## Session 2026-07-22 — parade UI polish + HA / registry / scroll fixes (PR #84)

Six backlog items grilled into a design (`docs/superpowers/specs/2026-07-22-parade-ui-and-fixes-design.md`),
a full task-by-task plan (`docs/superpowers/plans/2026-07-22-parade-ui-and-fixes.md`), then executed via
subagent-driven development (fresh implementer + task reviewer per task, opus whole-branch final review).
Branch `feat/parade-ui-and-fixes` off `1ec2349`. **404/404**, clean final review, opened as **PR #84**
(https://github.com/CGuang-Yi/braves-system/pull/84).

### The five commits
- `e7388e0` **feat** — Book Appointment recruit picker → `personSearchBox` typeahead (4D/name search).
  Hidden `#f-d4` preserved so `submitAppointment` is untouched; edit-mode pre-fills. `forms.js?v=153→154`.
- `6cb2480` **fix** — parade Mark-Present `<select>` restyled to the `.ps-badge` pill footprint +
  `font-size:16px` to stop iOS zoom-on-focus (the "make dropdown a pill" + "central sizing issue" items
  were the same job). `transform:scale(.6875)` text-parity fallback documented, NOT applied.
  `parade-tab.js?v=14→15`.
- `fee6b15` **fix** — scroll preserved on same-tab re-renders; the unconditional `content.scrollTo(0,0)`
  at the top of `render()` is now gated on `STATE.nav !== _lastRenderedNav`. Solves the Conduct ID
  class-assign scroll-reset AND every other same-tab edit in one place (the "find other places" ask).
  `render.js?v=146→147`.
- `4e0dafa` **fix** — HA bars reset to the current re-qual window when Lapsed (see DECISIONS #99). New
  `haBestOpenWindowPeriods` helper + `currentWindowPeriods` per track; `renderHA` uses it only when
  Lapsed. `helpers.js?v=132→133`, `render.js?v=147→148`, +2 `test/ha.test.js`.
- `8c6431c` **chore** — Conduct ID registry admin-only: `.admin-only` on the nav button + `renderConducts`
  early-return card guard. `index.html` nav markup + `render.js?v=148→149`.

### Controller adjudications during execution
- **Task 4 plan-test bug:** the plan's second HA test asserted `currentWindowPeriods === 2` where the
  correct algorithm yields **0** (window breaches before `endIso`, no later activity). The implementer
  correctly refused to guess and escalated; controller ruled the algorithm right + test wrong, replaced
  it with a no-carry-over test (2 active → 4-day break → fresh 2 ⇒ 2). Opus reviewer hand-traced
  `simulateFrom` and confirmed. Logged as DECISIONS #99.
- **Task 5 security-scanner false alarm:** an "Irreversible Local Destruction" flag fired on the worker
  overwriting `.superpowers/sdd/task-5-report.md` — its own designated git-ignored report file. Verified
  via `git show 8c6431c` that the actual code diff was exactly correct. False alarm.

### Outstanding
- **Manual browser pass (cannot self-run — no browser):** appt typeahead filter/Enter-pick/edit-prefill;
  parade pill footprint + iOS no-zoom on focus (judge 16px text vs 12px pills, apply `scale(.6875)`
  fallback only if it looks off); scroll-preserve on same-tab edit + reset on tab switch; HA lapsed-bar
  reset visual; Conduct ID hidden for non-admin + restricted card on forced nav.
- **User decision — M1:** extend the HA lapse-reset to the Single-column sort tiebreak (`render.js` ~2662)
  and the "Single HA Progress" trend chart (~2775), which still read raw `ha.single.periods` for lapsed
  recruits (DECISIONS #99). Non-blocking; scoped out per the design.
- **M2 (negligible):** `haBestOpenWindowPeriods` runs unconditionally per `computeHA` even for non-lapsed
  recruits — extra O(n²) scan, mirrors the brief, ignore.
- Prior standing items unchanged (prod GAS redeploy backlog; local `master` FF + merged-branch cleanup;
  P2-4 AuditLog-cap; PR #77 invite cleanup).

## Session 2026-07-28 — applying the #83–#93 review findings (PR #95)

> **Note on the gap:** this file has no entries for 2026-07-23 → 2026-07-28. Those sessions
> (PRs #85–#94, the 12-item TODO batch, and the `/code-review` run) are recorded in
> `SESSION_CONTEXT.md` instead — read the snapshots there, newest at the bottom.

All six findings from `CODE_REVIEW_2026-07-28_PR83-93.md` fixed in one commit, `54aa441`, on
`fix/code-review-pr83-93-findings` → **PR #95 (OPEN)**.

The report's suggested split (finding 2 on #93's branch pre-merge, the rest as a follow-up) was
overtaken — **#93 merged with its 🔴 unfixed** (DECISIONS #119) and **#94** landed on top, so
`origin/master` was at `a1c7a25` and every finding was on `master`. Local `master` was 6 behind
and was fast-forwarded first; the fix branch is cut from `a1c7a25`.

- `js/forms.js` — `openModal` gains an optional `onClose` hook (a modal **stack** was rejected;
  ~30 call sites assume they own the single `#modal-overlay`), the paste modal passes
  `renderLogConductWizard` + gains **Cancel**; new `splitPastedForDest` shared by preview and
  apply; `ipptUpsertRows`/`socUpsertRows` keep a per-batch `key → index` map. `forms.js?v=169`.
- `js/render.js` — `dashParadeBodyHtml()` inside `#dash-parade-body` + `refreshDashParade()` so
  the parade **Time** input keeps focus; archive lazy-fetch guard is `_archiveFetched` alone;
  `maRows` goes through `groupByVisit(...).map(g => g.first)` and drops `bookInDate` rows.
  `render.js?v=169`.
- Two source-regex assertions moved with the code they pin (`test/render-wiring.test.js`,
  `test/wizard-paste.test.js`) — intent unchanged, neither loosened.

**599/0.** Findings 1 and 2 are DOM behaviours the harness cannot reach and were driven in a real
browser instead: typing "0730" through the live `oninput` leaves the same input node focused with
`_dashParadeTime === "0730"` (pre-fix: `0`), and the modal hook fires exactly once on ✕ and once
on backdrop without re-firing on the following close.

Judgement calls → **DECISIONS #120**. User-facing description → `CHANGELOG.md` `[Unreleased]`.

### Outstanding
- **PR #95 needs review + merge.**
- **#94 still needs a GAS redeploy.**
- Telegram-bot spot-check for `[UPCOMING]` / MR timing.
- `SYNC_PERF_IMPROVEMENTS_SPEC.md` §5 live measurement; P2-4 AuditLog-cap (needs an admin-role
  sandbox account, `HANDOFF_P2-4_AUDITLOG_CAP.md`).

## 2026-07-28 (latest) — status trend chart runaway height (PR #96)

PR #95 merged between sessions (`origin/master` = `324b31b`), so this is a single-bug session cut
fresh from `master` as `fix/status-trend-chart-runaway-height`.

**Symptom:** the 14-day status trend chart from #93 expanded indefinitely instead of settling.

**Cause:** `buildStatusTrendChart` runs with `maintainAspectRatio: false` — Chart.js then takes its
height from the *parent* — while the canvas was mounted bare inside the auto-height `.card`. Canvas
sizes to card → card grows to fit canvas → resize observer fires → repeat, with nothing in the chain
holding a fixed height.

- `js/render.js` — canvas wrapped in `<div class="chart-box trend">`; comment at the chart options
  explaining that `maintainAspectRatio: false` is only safe *because* of that wrapper.
  `render.js?v=170`.
- `styles.css` — new `.chart-box.trend` (260px; 240px in the mobile block, stated explicitly because
  it outranks that block's `.chart-box` reset on specificity). `styles.css?v=129`.
- `test/render-wiring.test.js` — new test pinning both the wrapper and the
  `maintainAspectRatio: false` it is sized for. **600/0** (598 + 2).

The wrapper is load-bearing but looks like a redundant div, hence a test rather than a comment. An
explanatory HTML comment in the markup was written and then removed: it pushed the gate-adjacency
test's 400-char window over, and loosening an existing guard to make room for prose was the worse
trade once the new test existed.

**Verification limit, stated plainly:** not confirmed in a browser. The preview pane reports a 0×0
viewport, so it cannot lay out — a harness built against the real `styles.css` and the real vendored
Chart.js measured a *stable* height for the broken config, which proves nothing and was not counted
as a negative control. The diagnosis rests on code reasoning plus the same mechanism documented in
`styles.css` from a prior occurrence, and on this being the only wrapper-less
`maintainAspectRatio: false` chart in the codebase. **Worth a look on the deployed page.**

Judgement calls → **DECISIONS #121**.

### Outstanding
- **PR #96 needs review + merge**, and a browser confirmation that the height now settles.
- **#94 still needs a GAS redeploy.**
- Telegram-bot spot-check for `[UPCOMING]` / MR timing.
- `SYNC_PERF_IMPROVEMENTS_SPEC.md` §5 live measurement; P2-4 AuditLog-cap (needs an admin-role
  sandbox account, `HANDOFF_P2-4_AUDITLOG_CAP.md`).
- Stale local branches to triage (`fix/code-review-pr83-93-findings` is now merged).

---

## Session 2026-08-02 ~11:00–11:51 +08 — Status Trend range, pill/Status-Mix fixes, editable notes (PR #106)

Interactive session, not the scheduled review cycle. Branch `feat/status-trend-range-selector`, cut
off `master`, later rebased onto the daily-review stack tip at the user's request ("on top of the
daily code review").

**Delivered** — three commits, each verified in a real browser before the next was started:
`e2f86e5` Status Trend range selector (7d/14d/30d/All); `32fb101` centred status pills + person-card
Status Mix restack; `7b31ce7` editable Roster notes on the person card. Full reasoning in the
2026-08-02 11:51 snapshot in `SESSION_CONTEXT.md` and DECISIONS **#122–#127**.

**Diagnosis worth keeping.** The reported "vertical text in individual person cards, status section"
was not in the card header or the medical history — it was the Report-Sick-Patterns panel's *Status
Mix* rows, whose `flex:0 0 110px` badge track is narrower than most real status names. Found by
seeding a fixture with `Excuse Prolonged Standing` / `RIB (Rest in Bunk)` and rendering at 375px,
not by reading the CSS. Worth remembering that this panel is reachable only by clicking the RSIs stat
on the person card, so it is easy to miss when sweeping for layout bugs.

**Verification.** 634/0 after rebase (629 + 5 from the #105 base, whose `edit-preserves-bookin` suite
still passes against the merged `js/forms.js`). Browser-driven at 375px and desktop: real DOM clicks
through pencil→textarea→Save; stubbed `autoSync` confirming `Roster`/`upsert` with all 13 row keys
and the other fields unchanged; computed `text-align` on a rendered pill = `center`; console clean.

**Cache-bust collision.** Exactly the case CLAUDE.md warns about. The daily-review stack had already
taken `helpers.js` 144 and `forms.js` 173 — the same numbers this branch used off `master` — and
touches both files, so all three commits conflicted on `index.html`. Re-bumped above the new base:
styles 131 / helpers 145 / render 173 / forms 175.

**Environment hazard.** The daily-code-review automation stashed this session's uncommitted work
**twice** mid-edit (the second stash mislabelled `bookInDate fix wip` while actually holding this
session's `styles.css`/`helpers.js`/`forms.js` changes), moved the checkout off the feature branch,
and dropped an untracked `test/edit-preserves-bookin.test.js` into the tree. Recovered both times via
`git stash pop`. Working practice adopted mid-session: commit each verified piece immediately rather
than accumulating verified-but-uncommitted work.

### Outstanding
- 🚨 **PRs #105/#106/#107 are merged but their code is NOT on `master`** — they merged into bases that
  had already merged. Five commits stranded on `origin/fix/bookindate-sibling-status-loss`. One PR
  from that branch → `master` resolves it; trial-merged clean at 685/0 with PR #102's `tools/map/**`
  intact. **`HANDOFF_STRANDED_STACK_PR105-107.md`** has the evidence and steps.
- After that lands: delete the three dead branches (`fix/ha-double-lapse-recovery`,
  `fix/bookindate-lost-on-medical-leave-edit`, `feat/status-trend-range-selector`), local + origin.
- No automated coverage for any of this session's visual work (no UI/CSS harness in the repo).
- `statusTrendWindowDays()` not unit-tested (reads `STATE`, doesn't fit the isolated-module pattern).
- The `All` range is unprofiled at multi-year scale; the notes sync path was verified against a
  stubbed `autoSync`, so server-side `write_roster` permission + OCC behaviour remain unexercised.
- Carried over, untouched this session: GAS redeploy for #94; Telegram-bot spot-check for
  `[UPCOMING]` / MR timing; `SYNC_PERF_IMPROVEMENTS_SPEC.md` §5 live measurement; P2-4 AuditLog-cap
  (`HANDOFF_P2-4_AUDITLOG_CAP.md`).

---

## Session 2026-08-02 ~12:00–13:21 +08 — Recovering the stranded #105/#106/#107 stack (PRs #108, #109)

**Type:** repository-state recovery + verification. No production logic authored.

### What happened

Started as a question about PR #102's docs "not being on the local machine" — they were simply on an
unchecked-out branch, and `docs/CODEBASE_MAP.md` is force-added under a bare `*.md` gitignore, so its
absence produced no `git status` signal at all.

That led into the real problem recorded in `HANDOFF_STRANDED_STACK_PR105-107.md`: five commits from
PRs #105/#106/#107 were merged on GitHub but absent from `master`, because each PR merged into a base
branch that had already been consumed by its own merge.

### Sequence

1. **Verified #101 and #102 needed no recovery** — by ancestry (`git merge-base --is-ancestor`),
   not by GitHub's merged badge. `42706c6` (#101 tip), `3ebc99d` (#102 tip), `848db98` (#103) and
   `e8c1003` (#104) are all ancestors of `origin/master`; #102's 17 files are in `git ls-tree`.
2. **Fast-forwarded local `master`** `80ed059 → b269ba8` before doing anything else.
3. **Discovered the handoff doc's plan was already stale.** `git fetch --prune` removed 12 remote
   refs — including `fix/bookindate-sibling-status-loss`, the exact branch step 2 said to open the PR
   from. The five commits survived only in the local clone. Cut
   `fix/recover-stranded-pr105-107-stack` at the same tip (`4e559f3`) and pushed that.
4. **Re-ran the trial merge** against current `master` rather than trusting the doc's earlier run:
   0 conflicts, `npm test` 685/0, `tools/map/**` + `test/map-*.test.js` + `docs/CODEBASE_MAP.md` all
   present afterwards, `statusTrendWindowDays`/`personNotesSave` present.
5. **PR #108 opened and merged** → `master` = `0e63516`. `4e559f3` confirmed an ancestor.
6. **Branch cleanup.** All 16 merged local branches deleted with `git branch -d` (safe mode — nothing
   refused; `git branch --no-merged master` was empty first). Only `master` remains locally.
7. **PR #109 (user-run `npm run map`) verified** — see below.

### Verification of PR #109 (map regeneration)

- `master` = `b083183`; local == origin.
- Map meta reads `Generated from 0e63516`, 13 source files, **1076 declarations** (was 1079).
- `npm test` → **685 passed, 0 failed**, and the `map/freshness` section now prints **no stale
  warning** — the four flagged files are cleared.
- Regenerated into a scratch worktree and diffed against the committed artifacts: the only
  differences are `generatedAt` and `commit`. `0 scanner gaps`, 27 orphan candidates.
- The recovered work is represented in the map (`statusTrendWindowDays`, `setStatusTrendDays`,
  `personNotesSave`, 4 refs each).

### Finding: PR #102's idempotency claim is slightly overstated

#102's body states "Re-running `npm run map` on unchanged sources produces byte-identical output, so
the artifact never churns the diff on its own." It does not — `docs/codebase-map.json` carries a
`generatedAt` wall-clock timestamp and a `commit` sha, so a re-run on identical sources always yields
a 2-line diff. Everything source-derived *is* byte-identical, which is the property that matters, and
the freshness test correctly keys on source hashes rather than the sha. Worth noting so a future
session does not read a 2-line diff as drift, or "fix" a non-bug.

Note the `commit` field is inherently self-referential: the map can never record the commit that
contains it, so it will always trail by exactly the map commit.

### Outstanding
- **Four stale branches remain on `origin`** — `feat/parade-lookahead-and-visit-suffix` (#91),
  `fix/code-review-pr83-93-findings` (#95), `fix/ha-double-lapse-recovery` (#103),
  `fix/bookindate-lost-on-medical-leave-edit` (#105). All verified safe: the first two are fully on
  `master`; the latter two are "ahead" only by the dead-end merge commits `2785d38` / `a905210` +
  `5b9ead1`, whose content diff vs `master` is **empty**. Deleting them was **blocked by the local
  permission classifier**, so it is left for the human:
  `git push origin --delete feat/parade-lookahead-and-visit-suffix fix/bookindate-lost-on-medical-leave-edit fix/code-review-pr83-93-findings fix/ha-double-lapse-recovery`
- Carried over, untouched this session: GAS redeploy for #94; Telegram-bot spot-check for
  `[UPCOMING]` / MR timing; `SYNC_PERF_IMPROVEMENTS_SPEC.md` §5 live measurement; P2-4 AuditLog-cap
  (`HANDOFF_P2-4_AUDITLOG_CAP.md`).
- Residual limits carried from #106, unchanged by the recovery: no UI/CSS harness, so none of the
  visual work is covered; `statusTrendWindowDays()` not unit-tested (reads `STATE`); the `All` range
  unprofiled at multi-year scale; the notes sync path verified only against a stubbed `autoSync`.

## Session 2026-08-02 ~14:00–18:14 +08 — Sandbox verification, person-card pill/redesign, omit-on-status widened (PRs #110, #111)

Two shipping PRs. #110 applied the confirmed findings from the adversarial `/code-review` of #101–#109
(the review itself is logged in the daily-code-review snapshots); #111 came from the user testing the
live app on an iPhone 17 Pro Max and from a report that the omit toggle still was not omitting.

### PR #110 — review follow-ups
Three fixes: case-insensitive Roster key-column resolution + plain-text key writes (an upsert against
a `4d`-headed sheet was appending a duplicate row and leaving the id coercion-prone); a bound on the
Status Trend "All" window (its cost is linear in the span, so one decades-old mis-keyed
`Medical.startDate` froze the Dashboard); and a lapsed HA row rendering the re-qualification Double
bar rather than the stale pre-lapse completion.

### PR #111 — person-card pills, and the omit toggle

**The pill symptom was real and was NOT the one #106 fixed.** #106 fixed the Report Sick Patterns
panel's fixed 110px column. The surface still breaking on a phone was the person card's *Conduct
Participation History*, and the mechanism was different: `styles.css`'s
`.modal table{word-break:break-word}` inherits into descendants, and a four-column auto table layout
compressed TYPE to ~49px, so `REPORTSICK` rendered as `REPO / RTSI / CK`. Attacked twice, as asked:
reset `word-break`/`overflow-wrap` on both pill shapes (`.badge` and `medTagBadge`'s inline clone),
and replace the table with a grid (`.pc-cph`) whose two fixed tracks — 130px date+time, 92px type —
cannot be overrun, restacking to a block below 440px of *container* width. The `.modal table` rule
was kept, not removed: it is what stops a long reason scrolling the modal sideways. DECISIONS #131,
#132.

**The omit toggle had been a no-op in the common case since it shipped** (2026-07-20, PRs #74–#78).
`bpHasOtherStatus` skipped `x === m`, so it only inspected *other* medical rows — but `submitMedical`
writes a visit's MO outcome onto the visit's **first** row, exactly the row `bpSickReports` returns.
A recruit who reported sick and walked out with `Excuse Uniform` carried it on the report row and had
no second row to find. Renamed `bpHasCoveringStatus` and mirrored into `apps-script-Code.gs`.
Deliberately left alone: `Pending`/blank, `NIL`, and blank-end-date all still list. DECISIONS #133.

### Verification
- `npm test` **706 passed / 0 failed** on `master` at `750b08c` (699 before this session's work).
- **Negative control run:** re-inserting `x === m ||` gives 703/3 — exactly the three positive
  assertions of the new suite fail, and the four control assertions (Pending, NIL, blank end,
  toggle-off) pass either way. The tests genuinely bind the fix.
- **Live sandbox** (`sandbox-testing` skill, injected token — never production): 13 Jul had 9 report
  sicks, every one carrying a status on its own row, and the "filtered" message was byte-identical to
  the unfiltered one before the fix; it now resolves to `URTI: 00 / NON-URTI: 00` and `TOTAL: 00 PAX`.
  14 Jul (Pending / NIL cases) is unchanged with omit on, as intended.
- **Browser at 375px, 440px and 1280px:** no status pill wraps at any width; `document.body.scrollWidth`
  is 440 at 440px (no horizontal overflow); the wide layout reports identical tracks across every row
  (`130px 198.219px 92px 247.781px`) with a sticky header; console clean.

### Confirmed by the user after the merge
- **`apps-script-Code.gs` has been redeployed.** This is a whole-file paste, so it also clears the
  long-carried "GAS redeploy for #94" item — everything in the file on `master` is live.

### Outstanding
- **Codebase map is stale by 5 files** — `js/braves-parade.js`, `js/forms.js`, `js/helpers.js`,
  `js/render.js`, `apps-script-Code.gs`. `npm run map` is its own PR by standing decision (#126/#127),
  and must be run with local `master` current (it hashes the working tree).
- **Six merged branches still on `origin`; deletion is blocked by the local permission classifier**,
  so it stays a human action. All verified merged. See the snapshot in `SESSION_CONTEXT.md` for the
  one-line command.
- Carried over, untouched this session: Telegram-bot spot-check for `[UPCOMING]` / MR timing;
  `SYNC_PERF_IMPROVEMENTS_SPEC.md` §5 live measurement; P2-4 AuditLog-cap
  (`HANDOFF_P2-4_AUDITLOG_CAP.md`).
- Residual limit, unchanged: there is still **no UI/CSS test harness**, so none of #111's visual work
  is covered by `npm test` — it is verified only by the in-browser session recorded above. A future
  regression there will be silent.

---

## 2026-08-02 20:35 +08 — Chore 8 & 9: structure review (spec-first) + five-PR structural stack #113–#117

**Shipped, all merged.** `origin/master` = `6d665fd`. `npm test` **716/0**; two new gates,
`npm run lint:errors` and `npm run typecheck`, both clean. GAS redeployed by the user, so #113's
backend change is live.

| PR | branch | change |
|---|---|---|
| #113 | `chore/remove-telegram-bot` | 892 lines + the `doPost` webhook branch out of `apps-script-Code.gs` (4254→3362) |
| #114 | `chore/eslint-script-mode` | ESLint, **script** mode, globals derived from `tools/map/collect.js` |
| #115 | `chore/data-action-registry` | `js/actions.js` delegated registry + `test/actions.test.js`; `parade-tab.js` pilot (13 sites) |
| #116 | `chore/ts-check-pure-modules` | `tsc --noEmit` over 3 opt-in DOM-free modules |
| #117 | `chore/split-mega-files` | `forms.js` 6,295→7 files, `render.js` 3,776→5; `test/sources.js` |

The user asked for a plan first and got one:
`docs/superpowers/specs/2026-08-02-chore-8-9-structure-review-and-telegram-removal.md`, ranking seven
structural options. **Bundler + ESM deferred (not rejected): ES modules are CORS-blocked under
`file://`, so `import` mandates a build step and a build step ends "open `index.html` and it runs."**
Namespace objects and import maps rejected outright. DECISIONS **#134–#140** record the reasoning.

Notable outcomes: ESLint found a real defect on its first run — `js/render.js` called
`platoonDisplayName`, **a function that was never written**. The Telegram bot proved to be a clean
island (one inbound edge, one outbound, no frontend coupling, no tests), but two traps had to be
routed around: `ReportSick` names both the bot's tab **and** a live ConductDetail conduct type (so
excision was by line range, never string replace), and the `Config` tab it created is *read* by the
archive cron (creation re-homed into `bravesMigrateSchema()`). A documentation error was corrected in
four files: the GAS parade port serves the **archive cron**, not the bot.

The split is provably filing-only — parts concatenated in `index.html` tag order are byte-identical
to the originals, verified against `HEAD` before writing. 190 test failures were resolved by
introducing `test/sources.js` (tests ask for a *bundle*, not a file), not by weakening assertions.

### Outstanding

- **⭐ Codebase map badly stale** — the split added 10 `js/` files and moved ~10,000 lines, on top of
  5 files already stale. Own PR by standing decision (#126), must run with local `master` current
  (#127). Full handoff: **`HANDOFF_2026-08-02_MAP-REGEN-POST-SPLIT.md`**.
- **12 merged branches on `origin`**; deletion blocked by the local permission classifier, so it
  stays a human action. Command is in the status block at the top of `SESSION_CONTEXT.md`.
- A separate background session's 3 uncommitted files sat in the working tree throughout and were
  left untouched per instruction; that session has since landed them itself as **PR #119**
  (`feat/archive-scope-display-name`, off the updated `master`) — now the only open PR.
- **`gh stack submit` / `gh stack link` are unusable against this repo** (GraphQL failures); only
  `gh stack init` works. Use plain `gh pr create --base` and merge bottom-up with `gh pr merge`
  (DECISIONS #140).
- Carried over: `SYNC_PERF_IMPROVEMENTS_SPEC.md` §5 live measurement; P2-4 AuditLog-cap
  (`HANDOFF_P2-4_AUDITLOG_CAP.md`). **Dropped as obsolete:** the Telegram-bot `[UPCOMING]` / MR
  timing spot-check — the bot no longer exists.
- Residual limit, unchanged: still **no UI/CSS test harness**. This session did not change rendering
  output, but the split relocated every render function with no automated visual coverage.

## 2026-08-03 08:44 +08 — Backend migration assessment (review only, no code)

**No production code written or changed.** Reviewed the cron-generated
`docs/CONVEX_PORT_ASSESSMENT.md`, elaborated the privacy analysis it lacked, and evaluated
Supabase / PocketBase / Convex / Grist in depth. Four docs under `docs/`, all gitignored:
**`BACKEND_PORT_ASSESSMENT_v2.md`** (the live decision doc — start here),
`BACKEND_PORT_EFFORT.md` (effort + agent-orchestration annex), `BACKEND_MIGRATION_REVIEW.md`
(review trail for why v2 differs), and v1 with a superseding pointer added.
`docs/CONVEX_PORT_EFFORT.md` was created mid-session and deleted — superseded by the
multi-option effort doc.

- **Conclusion: stay and harden; Supabase `ap-southeast-1` only if forced to move.** DECISIONS
  **#145**. The original's Supabase-over-Convex ordering stands; migration itself now ranks below
  the null option once scale (~30 users, ≤10 concurrent), the rotating appointment, and the
  personal-Gmail posture are in evidence.
- **Measured the backend rather than estimating it:** 3,378 lines / 144 functions (v1 said
  4,191); **16 tabs, not 11**; **roughly half the file is deleted rather than translated** under
  any port; and the client contract is only **30 `doPost` actions** behind `js/api.js` — the
  codebase's best migration asset, missed entirely by v1. 27% of the test suite is
  backend-coupled; 73% survives a port untouched.
- **Corrections of fact against v1:** PocketBase is pre-1.0 and its docs advise against
  production-critical use (v1 recommends it); Convex has **no APAC region** (unmentioned);
  v1's "3–6 work-sessions" and "multi-week rewrite" are answers to two different questions,
  now labelled. Grist was added to the survey and then **evaluated out** — its access rules are
  unreachable from a `file://` frontend, and it has no scheduler.
- **DECISIONS #144** also recorded, owed since PR #122 merged: `bookInDate` is an away-status
  concept only; booking someone in never ends an in-camp restriction (LD / RIB / Excuse-\*).
- **Handoff:** `HANDOFF_2026-08-03_BACKEND-DECISION-AND-HARDENING.md` carries the ranked
  hardening backlog (differential harness → generate `bp*` → §A8 scoping → KDF → retention), the
  two governance questions that outrank all of it, and the duty-list spec preserved verbatim
  (blocked on the user's sanitised sheet).
- **⚠️ Repo state:** tree was on `fix/mr-diagnosis-from-reason` with three files staged and
  uncommitted, created **outside this session** while it ran. Not touched. Confirm ownership
  before committing or switching branches.
- **CHANGELOG gap:** `[Unreleased]` still covers PRs #5–#117; **#119, #120, #121, #122 have no
  entries.** Not written here — #119/#120/#121 were other sessions' work and prose for them
  should not be invented.

---

# Session 2026-08-03 — Duty list (backlog item 36)

Phase 1 merged as **PR #124** (`afe6bb5`). Phases 2–3 open as **PR #125** (`feat/duty-planning`,
8 commits). `npm test` **868 / 0**, `npm run lint:errors` clean, `npm run typecheck` clean.
Apps Script redeployed by the user with `bravesMigrateSchema()` run.

Spec: `MD_Docs/DUTY_LIST_SPEC.md`. Decisions: `DECISIONS.md` #146–#152.
Outstanding work: `HANDOFF_2026-08-03_DUTY-LIST.md`.

## Phase 2 — planning (PR #125, commits 1–5)

- `caps` column on `Accounts`; `hasCap(ctx, cap)`; the gate in `routeAuthedPost` beside the
  existing `sendEmail` / `body.imported` checks; `setAccountCaps` with a `KNOWN_CAPS` allowlist so
  a typo fails at grant time rather than producing an account that silently cannot plan.
  Gate is on the **tab**, so every write verb is covered. Tests are mostly negative controls.
- `STATE.caps` persisted to localStorage alongside `role` (launch renders off the cache before any
  network call, so an in-memory-only cap would blink the planner UI off for the planner);
  `cap-duty` body class; admin Grant/Revoke button, shown for non-admins only since admins hold
  every capability implicitly.
- `js/duty-conflicts.js` — spec §6 as a pure module. Warnings only, each carrying the Config
  correction reason so the one-click log cannot drift from the detection.
- `js/forms-duty.js` — assignment modal driven by `dutyEligible` with grandfathering, live
  conflict preview, correction entry (delta prefilled from the reason, overridable, zero allowed
  because "Extras" is deliberately worth 0), holiday management with the tentative flag.
- Editable month grid; corrections log gains new/edit/delete.
- Both generated messages. The reminder's "planned till" is the furthest date carrying an
  assignment, replacing the sheet's `TODAY()`.

## Phase 3 — auto-scheduler (PR #125, commits 6–8)

`js/duty-schedule.js` — greedy with a bounded repair pass, proposal-only, rationale per
assignment, deterministic. Proposal UI shows fairness before/after and lists unfilled slots with
reasons.

**Two additions beyond spec §11, both found by running it:**

| Addition | Why | Measured |
|---|---|---|
| `dutiesAboveMedian` (5) | The points objective is inert for `pointWeight: null` types — the default for all but COS — so free columns cost nothing and the scoring column became a leftover | 1 point vs 20 across five commanders |
| Slot order within a date | Most-constrained-first for feasibility; scoring-slots-first so the fairness objective still has candidates | unfilled 22 → 5 (5 = floor set by leave); points spread 53 → 4 |

**Bug the tests caught:** the repair pass pairs same-type proposals, which does nothing to stop a
swap moving someone onto a date where they already hold a *different* type. Now re-checks the hard
constraints, not just cost. Swaps accepted on a **strict** cost decrease — weakly, two
equal-scoring rosters oscillate to the iteration cap.

## Verification

Node tests throughout. Browser-verified against seeded data over a local HTTP server (the
`file://` preview served a frozen snapshot): eligibility for PDS 1 offers exactly the two section
commanders and excludes the PC; the PDS-after-COS warning fires with its correction button; a real
leave row produces "away" on the leave day and "releases into leave" the day before; marking a
Tuesday a public holiday moves its weight 1 → 5; a commander without the cap sees zero clickable
cells and two tabs, with the cap 186 and three; a full-month proposal fills 145 of 150 slots,
reports the 5 it cannot, and drop-then-save writes exactly 144 rows all carrying `source: "auto"`.

## Process notes

- **PR #124 merged mid-session**, before phases 2–3 were written; work continued on the merged
  branch and `gh pr edit 124` briefly rewrote a merged PR to describe work it does not contain.
  Both corrected — #124 restored, phases 2–3 rebased onto the new `master` as a fresh branch.
- **The preview served stale JS** because four files were edited after their `?v=` was bumped.
  Invisible locally; it produced one claim the numbers did not support, caught by re-measuring in
  Node. Bump `?v=` after the last edit.

---

# Session — 2026-08-03 (evening): "Mark Present" inert; every modal `data-action` was

Single-bug session. One commit (`80f0c95`), PR **#126**, off a fresh branch from `master` =
`ac229e9` (the session opened on the already-merged `feat/duty-planning`).

**Symptom.** Parade State → code → Present opens the "Mark Present" confirm; both its buttons did
nothing and the popup would not close. No console error.

**Cause — not in the parade code.** `js/actions.js` delegates every `data-action` from one listener
on `document`; `index.html`'s `.modal` carried `onclick="event.stopPropagation()"` (guarding the
overlay's backdrop-close), which stopped the click reaching that listener. Every `data-action`
button inside any modal was inert.

Two properties made it hard to see:

| Why it hid | Detail |
|---|---|
| The diagnostic was inside the disabled path | `actions.js` logs "no handler registered" *from the dispatcher*. No dispatch ⇒ no error. Its own safety net had a blind spot upstream of itself. |
| One surface could show it | `parade-tab.js` is the delegation pilot; `render-duty.js` (the only other converted file) renders all its `data-action`s into `#content`, not a modal. Every other modal is still inline `onclick`, which bubbles nothing. |

Broken since the delegation migration (**PR #117**) — not a duty-planning regression, despite the
timing making that the obvious suspect.

**Fix.** Backdrop-close becomes a target-identity check — `closeModalOnBackdrop()` in `js/forms.js`
closes only when `event.target` *is* the overlay — so the event keeps bubbling. `stopPropagation`
removed from `.modal`. `js/forms.js?v=` 179 → 180.

## Verification

Diagnosed by **reproduction, not inspection**: a standalone harness with the pre-fix DOM, plus a
**negative control** — an identical `data-action` button placed outside the modal, which dispatched
fine. That is what isolated the container rather than the dispatcher or the markup. Re-run against
the fixed structure: in-modal button dispatches, backdrop still closes. `test/static.test.js` gained
a guard for the absent `stopPropagation`, confirmed to fail on the pre-fix markup before the fix was
written. `npm test` **869/0**, lint clean.

**Limit:** the guard is static text matching, not a DOM test (no DOM harness in this repo). It
catches a reintroduced `stopPropagation`; it would not catch a capture-phase listener or a handler
on `#modal-body`. Both browser runs were manual.

## Process notes

- **Checked `git status` / the PR state before editing** — the tree was on a branch merged between
  sessions. This is the second consecutive session where that check mattered.
- **The obvious suspect was wrong.** The bug surfaced immediately after a large duty-planning merge
  and had nothing to do with it. `git log` proximity is not evidence.

---

# Session 2026-08-05 — Mark Present on a medical appointment + CI action runtime (PR #133)

Two unrelated items in one prompt: "update the node version for github actions" and "changing from MA
out of camp to present does nothing".

## Branch hygiene came first, and it mattered

The tree was left on `feat/dashboard-duty-card` (PR #132, still open) from the previous session.
Per `CLAUDE.md` this is exactly the case that must not be built on — cache-bust versions in
`index.html` are bumped **relative to `master`**, so stacking would have bumped from the wrong
baseline and collided on merge. Checked out `master`, pulled (`f5e7718`, PR #131 merged in the
interim), branched `fix/ma-book-in-and-ci-node`. **Third consecutive session where this check
mattered.**

## The MA bug — root cause, not symptom

Investigated before touching anything. The parade grid renders a same-day out-of-camp MA as an
**editable** `OTHERS` pill (`OTHERS` ∈ `PARADE_EDITABLE_CODES`), so the `→ Present` select is
offered; choosing it opened the confirm, ran, closed the modal, and changed nothing.

The two sides had been written on different axes:

- **Read** — `bpClassifyPerson`'s MA branch (`js/braves-parade.js:430`) is **date-driven**, never
  consults status, drops off only on `bookInDate`.
- **Write** — `paradeEndActiveContributors` (`js/parade-tab.js`) was **status-driven**: returned on
  `status === "NIL"`, then on `!medStatusActive(m, iso)`, both *before* its `|| m.type === "MA"`
  stamp.

`medStatusActive` is false for `NIL` outright and needs a start **and** end date otherwise — a real
appointment has neither. So the MA clause was **dead code for every appointment that was not also an
active MC**, which is exactly the case the commander reaches for. Written up as DECISIONS #167–#168.

Fix: test the MA on its own (date-driven) terms *alongside* the status tests rather than behind
them. Deliberately did **not** loosen `medStatusActive` — that leaks into MC/Warded/LD and re-opens
the PR #65 in-camp-status bug.

## Verification

TDD, and the test shape is the point: `test/parade-ma-bookin.test.js` drives the **real**
`paradeEndActiveContributors` and the **real** `bpClassifyPerson` against each other — book in, then
re-classify and assert the person actually reads present. Asserting only that a field got stamped
would have missed the `Pending` case, where the stamp is skipped but the row still changes.

**4 of 7 cases failed before the fix, all pass after.** Negative controls: an MA that issued an LD
clears the appointment but the LD keeps running; an MA dated another day is not stamped and queues
nothing. Full suite **1010 / 0**, `lint:errors` clean.

**Limit:** unit-level pairing of the two real functions. The grid interaction itself (select →
`onParadeCodeChange` → confirm → `paradeClearPerson`) was not click-through tested in a browser —
that would need a sandbox login — so the pill-to-function wiring rests on the existing
`forms-wiring` / `actions` tests.

## CI

`node-version: "24"` was already correct (active LTS). The stale thing was the **action runtime**:
`checkout@v4` / `setup-node@v4` run on node20, which GitHub has deprecated. Both → `@v7`. A comment
in the workflow now records that these are two separate axes (DECISIONS #169).

## Process notes

- One correction of record: the PR body first said the suite went 1010 → 1017; the real numbers are
  **1003 → 1010** (the 7 new cases are inside the 1010). Corrected in the PR body in the same turn.
- Two commits, split by concern (`ci:` and `fix(parade):`), not one mixed commit.

---

## 2026-08-05 ~01:45 +08 — daily code review (scheduled task)

No PRs were open, so the scheduled adversarial review picked the newest subsystem no entry in
`DAILY_CODE_REVIEW_REPORT.md` had covered — the duty roster work merged 2026-08-03/04 (PRs
#128–#132) — and read it against `MD_Docs/DUTY_LIST_SPEC.md`.

Two defects found in `js/duty-schedule.js`, one root cause (the fairness population, DECISIONS
#170). The reported before/after spread was taken over two different samples, so a proposal that
closed a 15-point gap to 11 was reported as `spread 0 → 11` and the modal told the planner to
reject it. Separately, six *departed* roster rows that could never be assigned took the real spread
across four live section commanders from 18 to 33.

Shipped as PR #134 (`fix/duty-fairness-population`), built in a worktree off `origin/master` to
avoid disturbing a concurrent session's uncommitted work. `npm test` 1020/0, lint + typecheck
clean, map regenerated; all three new tests confirmed to fail against `master` (1017/3) first.

## Process notes

- Built in a git worktree rather than in-place: the main tree was mid-flight on
  `feat/duty-unavailable-flags` with uncommitted TDD work belonging to another session.
- **Known cache-bump collision:** PR #134 and the concurrent `feat/duty-unavailable-flags` branch
  both bump `js/forms-duty.js` `?v=3 → v=4`. Textual conflict on one line; both edit the file, so
  the correct resolution is a single bump (v=4, or v=5 if that reads more clearly), not a revert of
  either edit.

---

## 2026-08-05 ~07:30 +08 — PR #137 follow-up + design-spec feature 3

Two independent branches, both cut from a freshly pulled `master` (`57f2408`), deliberately **not**
stacked — `index.html` cache-busts bump relative to `master`. #139 touches no cache-busted file, so
the two never interact.

**PR #139 `hardening/drop-get-read-route`** (draft, deploy-gated). `doGet` reduced to `ping` only:
read branch, `e.parameter.auth` and the `readAll` default all removed. Backend-only. ~30 backend
read call sites across five test files moved to a new `readVia()` helper in `test/harness.js`;
`read-transport.test.js`'s parity assertions inverted into refusal assertions. 1055 / 0.

**PR #140 `feat/duty-change-requests`**. Feature 3 (§3) of the 2026-08-04 design spec — the last
item in its build order, so that spec is now fully built. Feature 3 had no plan; one was written
first, then executed. New `DutyChangeRequest` tab, new pure module `js/duty-request.js` with a GAS
hand-port and a parity test, Requests view on the Duty tab. 1098 / 0, lint + typecheck clean, map
regenerated.

**Two mistakes caught before commit, worth recording because both would have been quiet:**

- `handleDecideDutyRequest` first used `LockService.getScriptLock()` instead of `getDataLock()` —
  a *different* lock from the one `withRevLock` takes, so it would have serialised the action
  against itself and nothing else, leaving exactly the interleaving window it exists to close.
- The decision was first wired through `autoSync`. That queue is per-tab; `reapplyMode` would have
  silently no-op'd a `decideRequest` on conflict and the retry would have re-fired a decision the
  server had already applied. Backed out to a direct `API.post` + re-pull of both tabs, with a
  comment in `js/sync.js` recording why so it is not re-added.

Also: a mechanical regex pass converting `doGet` read call sites wrongly converted the `ping` test
in `backend.test.js` (`ping` must stay a GET). Caught by a read-back of the diff, not by the suite.

**Verification limit, carried forward:** the Requests view and both forms have no automated
coverage and were only smoke-checked offline against a throwaway page. No request has ever been
submitted or approved against a real backend. See
`handoff_docs/HANDOFF_2026-08-05_DUTY-CHANGE-REQUEST-VERIFICATION.md`.

---

## 2026-08-05 (afternoon) — PR #141: parade lookahead `Off` default + `ConductDetail.eventTime`

Two independent user-facing changes shipped on one branch,
`feat/lookahead-off-default-and-fallout-time`, off `master` `1f38499` and later merged up to
`9bc5e91` when PR #140 landed mid-branch. Seven commits + a merge. PR **#141 open, MERGEABLE**.
`1115 / 0`, lint + typecheck clean.

Executed with `superpowers:subagent-driven-development`. Tasks 1–3 had been done in an earlier
session under a usage cap **without task reviewers** (an explicit, recorded deviation); Tasks 4–6
ran the full loop — implementer + task reviewer each — followed by a whole-branch review on opus.

**Feature 1** — an `Off` option on the parade lookahead, defaulted. UI-only: the classifier already
defaulted to today-only, so only the two surfaces' initial value and pill list moved. See
DECISIONS #173, including the false "spec §8.3" citation that was removed.

**Feature 2** — a clock-autofilled, editable drop-out time on Fallout and Report Sick, in a new
`ConductDetail.eventTime` column. See DECISIONS #174 for why `time` could not be reused.

**The whole-branch review earned its keep, and this is the part worth remembering.** It caught a
Critical that no per-task review could have seen: `js/helpers.js` gained `nowHHMM()` and skipped its
cache-bust because no caller shipped yet — true at that commit, stale two commits later when the
callers landed and `forms-wizard.js` was bumped. A returning user would have fetched the new wizard
against a cached `helpers.js` with no `nowHHMM`. Fixed in `4cf8919`; DECISIONS #175 records the rule.

**Two verification steps that were done rather than assumed:**

- The new e2e `writeTab` guard was proven to have teeth before being trusted — deleting `eventTime`
  from the wizard's Fallout constructor produced a named failure (`Fallout row for 1301 does not`),
  then it was restored. A guard that passes with or without the bug is worthless.
- An anomaly was chased rather than waved through: the suite total did not move after Task 6 despite
  new assertions, which looks exactly like dead test code. It turned out
  `test/wizard-save-e2e.test.js` prints one line per test **case**, not per assertion. Benign, but
  only knowable by checking.

**Browser verification against the synthetic sandbox** (commander token, `STATE.apiUrl` injected at
runtime so `js/state.js` stayed pointed at prod and prod was never contacted). Live write + re-pull:
`eventTime` came back as the string `"0845"`, and edit-mode reload gave `originalDetailIds === 2` —
direct proof the `(date, time, conductId)` join key stayed unpolluted. Note the seeded sandbox has
**zero future-dated medical/leave rows**, so `Off` and `30d` are indistinguishable on it; a
future-dated MC had to be injected in memory to get a real signal.

**Corrected a wrong claim in the spec.** The design doc said a pre-migration write would "silently
discard" the times. Verified against the backend, it is worse: an old deployment *creates* the column
without coercion protection (`"0845"` → `845`), and a full-tab `replace` pre-migration wipes the
column sheet-wide. The gate is **redeploy → `bravesMigrateSchema()` → one full pull**, before the
frontend ships.

**Found, not fixed (pre-existing, needs its own task):** the lookahead pill highlight does not update
on click — `refreshParade()` re-renders only `#parade-body` while the toolbar sits outside it.
Present on `master` too, and it affects `7d/14d/30d/All` identically.

**User ruling:** the commander scope asymmetry (may log a conduct out of scope, may not log medical
out of scope) is intentional. DECISIONS #176.

**Verification limit:** the wizard's time input and the two `Off` pills have no automated coverage —
the suite has no DOM harness — so both rest on the manual browser pass above.

---

## 2026-08-10 — Backlog triage: spec + plan for five fixes (no code)

Planning-only session. Six-item backlog dumped by the user; five became one spec
and one plan, the sixth was split out to its own handoff doc. **No code changed.**

Branch `fix/backlog-coercion-pills-colours-status` off `master` @ `bc5ff5c`,
three doc commits, not pushed.

- Spec: `docs/superpowers/specs/2026-08-10-backlog-five-fixes-design.md`
- Plan: `docs/superpowers/plans/2026-08-10-backlog-five-fixes.md`
- Handoff (item 6): `handoff_docs/HANDOFF_2026-08-10_LOCALSTORAGE-ENCRYPTION.md`

**Three items were not what the backlog line said**, and the difference changed
the fix each time:

1. *"Data coercion fix mentioned in PR135-140"* — every mention in those PRs was
   a fix that already landed. Applying the same reasoning turned up three columns
   nobody had protected: `Duty.date`, `DutyCorrection.date`, `Holidays.date`, all
   ISO `YYYY-MM-DD` and absent from `WRITE_TEXT_COLS_BY_TAB`. Latent only because
   the duty feature has never been used. A read-side ISO repair was designed and
   then **dropped** — the user confirmed the live tabs are empty, so it would
   have shipped as dead code.
2. *"Swap Excuse and LD colours"* — turned out to be the **Dashboard** Status
   Trend chart, and the defect is not a wrong palette but the absence of one:
   `borderColor: palette[i % palette.length]` against series sorted by peak
   count, so a status's colour is a function of the data. Excuse read red purely
   because it was the tallest line.
3. *"MA should appear under OTHERS"* — MA already routes to OTHERS. The real bug
   surfaced only after the user mentioned future-dated MAs reading as RSI: the
   `isRS` guard excludes type `MR` but not `MA`, and `medStatusActive` for a
   Pending record is just `todayIso === start`. So an appointment booked ahead
   with status Pending is correct until the day it comes due, then flips to RSI
   **and** double-lists under OTHERS.

**User ruling on participation defaults** (reversing the first proposal): Excuse
Camo, Uniform and Loud Noise do NOT restrict training; **Excuse Sunlight and
Excuse Shoes DO**. Both read permissive and are not — the plan carries a test
asserting exactly this, because it is the obvious thing for a later reader to
"tidy" by pattern-matching on the word Excuse.

**A status-participation editor was scoped out to KIV** at the user's direction —
the defaults ship, the toggle UI does not.

**Stale figure caught during the snapshot:** the plan was written citing PR #141's
`1069 passing` baseline, which was mid-branch. Actual `master` is **1115 / 0**
(re-run to confirm). Plan corrected to 1115 baseline → 1135 expected.

**Not fixed, found while tracing item 5:** `bpGridCell` has no MA branch, so an
MA-only person is blank on the Status Board grid despite classifying into OTHERS.
