# Decision Log — Braves Adaptation

A running changelog of clarifications and decisions made while planning the Braves adaptation.
**This file is a record, not an authority.** Each entry has been folded into the authoritative
docs (`HA.md`, `BRAVES_ADAPTATION_SPEC_ADDENDUM.md`, `BRAVES_ADAPTATION_SPEC.md`, `CLAUDE.md`);
the "Recorded in" column points to where the binding wording lives. If this log and a spec
ever disagree, the spec wins — update this log to match.

For the doc precedence order, see the "doc hierarchy" section of `CLAUDE.md`.

---

## Session 2026-06-20

### HA programme & currency

| # | Decision | Recorded in |
|---|----------|-------------|
| 1 | **Period counting — Single/Expanded:** 1 period per **calendar day** (capped at 1/day; 2 activities same day still = 1 period). A day with no activity is a break day. The spec's day-iterating state machine (§12.4) is correct for these two programmes. *(Corrected the old HA.md line that said 2/day = 2 periods.)* | `HA.md` — Period Counting + Clarifications |
| 2 | **Period counting — Double:** periods = sum of **1-hour time periods**, read from attendance CSV cell **B5** (`Periods`). One activity can contribute 2+ periods. Window/breaks stay day-based; target 13 periods. | `HA.md`; spec §14.1 |
| 3 | **Currency model:** rolling 14-day window. Each HA activity pairs with the most-recent prior activity; if **≤7 days apart** that pair triggers a **reset** (Day 1 = day after the later activity, moving the deadline forward). **Lapse occurs at Day 14 with no reset.** ≤7 is inclusive and only governs resets — it never directly lapses. | `HA.md` — Clarifications |
| 4 | **Lone activity (>7-day gap):** becomes a new "first" activity but does **not** open a fresh window — it must find a partner inside the *existing* 14-day window or the window lapses at Day 14. | `HA.md` — Clarifications |
| 5 | **Lapse recovery:** re-qualify by completing **any** programme again (Single / Expanded / Double-if-VocFit). No shortcut path. | `HA.md` — Clarifications |
| 6 | **One scheme for all:** HA status is not differentiated by how it was earned. However qualified/re-qualified, the person is "HA-ed" and maintains/lapses currency identically. | `HA.md` — Clarifications |
| 7 | **Retain `Lapsed`** as a status; its definition is the currency model above (supersedes the old "14 days idle" heuristic). | spec §20.6; `HA.md` |

### Parade state & strength

| # | Decision | Recorded in |
|---|----------|-------------|
| 8 | **Multi-section listing:** a person may be listed under **multiple** parade-state sections at once (e.g. STATUS + MR). The earlier "mutually exclusive / one category per person" framing is superseded. | spec §8 |
| 9 | **CURRENT STRENGTH is binary, counted once:** NOT IN CAMP iff the person holds **any** of `AL/OIL`, `MC`, or `OTHERS (NOT IN CAMP)` today (Warded ⊂ OTHERS-not-in-camp). Count **distinct** not-in-camp persons. Everyone else (RSI/RSO, STATUS, MR, OTHERS-in-camp, ghost) is in camp. | spec §8 |
| 10 | **Priority chain** (`REPORTING SICK > ATT C > AL/OIL > STATUS > OTHERS`) is used **only** for single-label contexts (e.g. the A7.3 "Today's category" badge) — not for listing, not for counting. | spec §8 |
| 11 | **§20.1 resolved:** ATT C + MR same day → NOT IN CAMP (MC tag wins for presence); still listed in both ATT C and MR sections. | spec §20.1, §8 |

### Status Board

| # | Decision | Recorded in |
|---|----------|-------------|
| 12 | **Grid primary-status order:** `Leave > MC > LD/Excuse > RSI/RSO > MR`. | addendum A4.2 |
| 13 | **Grid cells are not strictly single-status (option A):** primary fill by the order above **plus a small secondary marker** whenever an RSI/RSO co-occurs but isn't primary — so RSI patterns (A4.5) stay visible even when a higher-priority status owns the fill. Full status list on tap (A4.4). | addendum A4.2 |

### CSV conduct import

| # | Decision | Recorded in |
|---|----------|-------------|
| 14 | **Exact source layout:** 7-row key/value metadata block, then a blank row, then the data header (`User \| Unit \| Status \| Remarks`) at **row 8** with data from row 9. Importer must skip the metadata and start at that header. Capture row 2 (`Currency Tags`) and row 5/B5 (`Periods`). | spec §14.1 |
| 15 | **HA-eligibility source is configurable:** either `isHAExcluded()` conduct-name logic **or** the `Currency Tags: HA` metadata may govern eligibility. Build a switch (e.g. a Config flag); do not hardcode one. | spec §14.3 |

### Auth & roles

| # | Decision | Recorded in |
|---|----------|-------------|
| 16 | **Auth is per-account passwords** (addendum A1), replacing the main spec §3 shared passcode. This is Build-order Step 1. | addendum A1; spec §19.1; `CLAUDE.md` |
| 17 | **Roles:** `viewer` = read-only (held in reserve for now), `commander` = full write access, `admin` = commander rights + admin-only actions. | `HA.md` — Clarifications; `CLAUDE.md` |
| 18 | **Rank hierarchy:** 3SG = completed Foundation Term, 2LT = completed Service Term; in SAF structure 2LT and all officer ranks sort **above** 3SG, so one `order >= order('3SG')` check covers ≥2LT (Double-HA eligibility). | spec §20.4 |

### Doc structure

| # | Decision | Recorded in |
|---|----------|-------------|
| 19 | **Layered precedence** (most-specific wins): `HA.md` > `BRAVES_ADAPTATION_SPEC_ADDENDUM.md` > `BRAVES_ADAPTATION_SPEC.md` > `Message Formats.md` > legacy `system_features.md` / `user_facing_features.md`. The earlier "the main spec overrides every other .md" framing was wrong. | `CLAUDE.md` |

---

## Session 2026-06-21 — Upstream Cougar master changes review

Reviewed the 5 files in `CougarMasterChanges/` (features added to the Cougar master *after*
this repo forked) and decided how each maps onto the Braves build.

| # | Upstream change | Decision | Status / Recorded in |
|---|-----------------|----------|----------------------|
| 1 | **`ensureColumnsForKeys`** — `appendRow`/`appendMany`/`upsertRow` auto-create missing sheet columns | **Ported now** (orthogonal backend robustness; also makes new fields like `location` persist on first write) | DONE — `apps-script-Code.gs` |
| 2 | **Medical `location`** field (external clinic/hospital), editable | **Ported now** — aligns with spec §6 (which already listed `location`) and the RS message format | DONE — `state.js`, `forms.js`, `render.js`, `apps-script-Code.gs` (incl. Telegram write) |
| 3 | **Multiple statuses per report-sick visit** (sibling rows) | **Adopt at Step 2/3, reconciled:** sibling rows linked by a new **`visitId`**; `type` is **per-visit** (shared); MR is its own visit (not a sibling status); classifier **dedupes per person** (once per category, counted once) | DEFERRED → spec §6 (visitId + multi-status subsection) and §8 (dedupe rule) |
| 4 | **Appointments `outOfCamp`/`resolved` + parade integration** | **Not ported** (Braves §8–9 owns parade state); **design ideas to adopt** in the Braves parade-state build — live per-parade presence tick (bidirectional: left *and* returned), single-source roll/count reconciliation, future-shows/same-day-cutoff, `resolved` flag, explicit per-entry "Camp:" line | DEFERRED → spec §6 (MA subsection: "design ideas to adopt") |
| 5 | **"Leave" → "Annual Leave"** rename | **Rejected** — Braves keeps the `Leave` type as-is | N/A (not ported) |

Note: #1 and #2 were ported at the user's explicit direction even though #2 nominally belongs to
Step 2 — they don't touch the auth surface and are additive.

**Reconciliation update (Step 0.5, merge `f5adcd3`):** these 3 upstream commits were later actually
merged into `overnight-build` via `git merge origin/master` (they had landed on `origin/master` of the
`braves-system` repo). Resolution applied the decisions above:
- **#1/#2** deduped (already in HEAD → single copy each).
- **#3** multi-status UI **kept** and integrated into the Step-2 medical form (sibling rows now also carry
  the per-visit `type`/`urtiType`/`mrTiming` and a shared `visitId`).
- **#4** appointment out-of-camp + per-parade presence-tick **kept** (Step 3 reuses it for §6).
- **#5 reverted out of `origin/master`** — the rename had been pulled in by the full coon-hound merge;
  `normalizeLeave` removed, all sites back to `Leave`/`padD4OnLayer` (user-confirmed).
- `PRESENTATION.md` excluded.
`overnight-build` now fully contains `origin/master` and can fast-forward into `braves-system` master.

---

## Session 2026-06-21 (overnight) — autonomous build, Steps 2→8

Decisions made without user input during the overnight session (per the user's standing instruction to
make the most reasonable call, log it here, and proceed). Branch: `overnight-build`.

### Step 2 — Config + Roster/Medical schema

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 20 | **§20.5 RESOLVED — keep `VocFit.certifyingUnit`.** | It's a zero-cost optional column; carrying it now avoids a schema change if it's later wanted for audit. Normalizer reads it; nothing depends on it. `state.js` normalizeVocFit; backend schema header. |
| 21 | **Multi-status sibling-row medical UI deferred from Step 2 to Step 3.** The `visitId` column + form/normalizer wiring land in Step 2; the add/remove-status-row UI (`medStatusOptionsHtml` port) lands in Step 3 alongside the classifier that consumes sibling rows + dedupe. | Spec §6 lists both at "Step 2/3"; the UI's only consumer is the §8 classifier (Step 3), so building it earlier would be dead code. App stays working (single-status form unchanged in behaviour). |
| 22 | **Platoon-management + reassignment admin UI (A6.1/A6.2) deferred.** The `Platoons` tab is plumbed (pull + `STATE.platoons` + `activePlatoons()`); the add/rename/retire + reassign screens are not built yet. | User can edit the Platoons tab directly in the Sheet (same workflow as Roster). The deletion-guard + reassign-audit UI is revisited with the Step-5 scope work / admin panel. No downstream step is blocked (scope selector derives from `activePlatoons()`, which falls back to roster-derived codes). |
| 23 | **New/edited commanders get `status: "Active"`** (was `""`). | Spec §8 TOTAL STRENGTH = roster rows with `status = Active`; commanders must count. Pre-existing blank-status commanders are handled defensively in the Step-3 strength calc (blank treated as active unless an explicit inactive marker). |
| 24 | **Static rebrand Cougar→Braves** in `index.html` (title + sidebar logo). | Repo is `braves-system`; the parade-state/company strings already come from Config. Cosmetic, low-risk. The in-app company name still flows from `configGet('companyName')` where it matters. |
| 34 | **`followUpMO` field/column REMOVED** (user directive). The sick-message "FOLLOW UP STATUS FROM MO:" line is sourced from the existing `status` dropdown (the MO outcome: `MC`/`LD`/`NIL`…), not a separate field. `Pending` status → blank line; commander edits Status after the MO visit. Removed from form, normalizer, render, backend schema, spec §6/§10.4/§17, and the addendum's `edit_follow_up_mo` audit action. The literal output line stays (required by `Message Formats.md`). | Avoids a redundant field — the MO follow-up *is* the status. Supersedes the earlier §6/§10.4 `followUpMO` design. |
| 25 | **`rankGroupOf` rank→group mapping** chosen as: Officer = {2LT,LTA,CPT,MAJ,LTC,SLTC,COL,BG,MG,LG}; WOSPEC = {3SG..MSG, WO ranks}; everything else = Enlistee. Explicit `rankGroup` column overrides. | Spec §8 needs OFFICER/WOSPEC/ENLISTEE but no canonical rank list was given (§20.4 only fixed the 3SG/2LT ordering for HA). This is the standard SAF grouping; the explicit column is the escape hatch if a rank is mis-bucketed. Revisit if the real roster shows ranks not in these lists (they fall to Enlistee). |

### Step 3 — parade-state format decisions (derived from `Message Formats.md`)

Captured while drafting the parade-state generator (`js/braves-parade.js`). These are my reasoned reads of
the sample; they need byte-for-byte confirmation once the generator can actually be run (blocked tonight by
the Bash/classifier outage — see SESSION_LOG handoff).

| # | Decision | Rationale |
|---|----------|-----------|
| 26 | **§20.2 RESOLVED — clean single space, drop the incidental double space.** Where a person has no 4D, R/N is emitted trimmed (`Trevor Lee - 48HR BO`, not `Trevor Lee  - …`). | The sample's double spaces are a template artifact (`name + ' ' + fourD + ' - '` with empty fourD). Spec §9.2 recommends clean output; double spaces are not semantically meaningful. |
| 27 | **§20.3 RESOLVED — reproduce the per-section dash counts verbatim** via a constant array. Platoon/HQ block separators BEFORE [AL/OIL, MR, REPORTING SICK, ATT C, STATUS, OTHERS] = **[30, 30, 30, 28, 29, 29]**. Company aggregate block uses **80** dashes before every category. Company↔HQ separator = **30 `=`**. Inter-block (HQ↔PLT, PLT↔PLT) = **80** dashes. | §9 says match the sample exactly incl. dash counts; stored as `PLT_SECTION_SEPS` so it's trivially adjustable if they want uniform. |
| 28 | **Duration dash spacing differs per section — reproduced from sample.** AL/OIL & STATUS(LD): spaced `(210526 - 220526)`. ATT C & OTHERS(not-in-camp): unspaced `(130526-210526)`. | Directly observed in the sample (Howard Koh ATT C unspaced vs Trevor Lee AL/OIL spaced). |
| 29 | **rankGroup ratio padding differs by level — reproduced from sample.** Company block pads each side to ≥2 digits (`06/06`, `20/21`); platoon/HQ blocks do NOT pad (`2/2`, `1/1`, `0/1`). Category counts (`AL/OIL: 02`) are 2-digit zero-padded **everywhere**. | Observed: company `[OFFICER]: 06/06` vs PLT1 `[OFFICER]: 2/2`. Likely a sample artifact but reproduced to satisfy "match exactly"; easy to normalise later. |
| 30 | **Names are NOT force-uppercased** (render as stored in roster). | Spec §7 `paradeRN` code uppercases, but the sample (`Calvin Lee`, `Martin Tan B1411`) is consistently mixed-case and §9 says the sample wins over the prose/code. Reversible (one `.toUpperCase()`). |
| 31 | **REPORTING SICK label for a `Pending` row with no `type` → `(RSI)`.** | The section's parenthetical is RSI/RSO; Pending (awaiting MO) is an in-camp report-sick, so RSI is the sane default. Explicit `type` always wins. |
| 32 | **AL/OIL vs OTHERS(not-in-camp) leave split.** AL/OIL = leave `type` ∈ {Leave, Off-in-Lieu, OIL, AL, Annual Leave, Weekend, Night's Out, Compassionate}. All other leave types (Course, Guard Duty, NDP, Other, …) → OTHERS (NOT IN CAMP). Warded (medical) and out-of-camp appointments (MA) → OTHERS (NOT IN CAMP). OTHERS sub-type (in/not-in camp) otherwise follows §8 reason-keyword derivation + `othersInCamp` override. | The sample puts "48HR BO" in AL/OIL but "BOOKED OUT FOR FAMILY MATTERS" in OTHERS — the data model doesn't cleanly distinguish them, so this type-based split is a best-effort rule. **Flag for user confirmation** — likely needs a Config-driven type list. |
| 33 | **CURRENT STRENGTH active-person rule:** a roster row counts in TOTAL if `status === "Active"` or `status` is blank (covers pre-existing blank-status commanders, decision #23). NOT-IN-CAMP (binary, §8) = holds active AL/OIL OR active MC OR OTHERS(not-in-camp) today; counted once. | Spec §8; blank-status tolerance avoids under-counting commanders before their rows are updated. |

### Still open

| Ref | Question | Resolve at |
|-----|----------|-----------|
| §20.7 | "Not Available" dashboard tile — include STATUS (LD/excuse) personnel or not? | Step 8 |
| #32 | AL/OIL-vs-OTHERS leave-type split — confirm the type lists / make Config-driven | Step 3 integration |
| fmt | Byte-for-byte validation of the parade-state output vs `Message Formats.md` — **requires running the generator** (blocked tonight) | Step 3 integration |
