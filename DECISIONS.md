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

## Session 2026-06-21 (overnight #2) — branch `Step-3-Onwards`, Step 3 integration

Bash/node/git all work this session, so the byte-validation blocked last time is done. Decisions
made while integrating + validating the parade-state generator (per the standing autonomous brief).

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 35 | **#32 RESOLVED — AL/OIL leave-type split is Config-driven.** `configGet("alOilLeaveTypes")` supplies the AL/OIL type list (comma-separated string or array); `BP_ALOIL_TYPES_DEFAULT` in `braves-parade.js` is the fallback. `DEFAULT_CONFIG.alOilLeaveTypes` documents the default set (Leave, Off-in-Lieu, OIL, AL, Annual Leave, Weekend, Night's Out, Compassionate). Any type NOT in the set → OTHERS, sub-typed in/out of camp by the §8 reason-keyword rule. | The data model can't distinguish "48HR BO" (AL/OIL) from "BOOKED OUT FOR FAMILY MATTERS" (OTHERS) structurally; a tunable type list is the cleanest knob. `state.js` DEFAULT_CONFIG; `braves-parade.js` bpAlOilTypeSet/bpIsAlOilType. |
| 36 | **3 draft bugs fixed on integration** (found by running the generator): (a) leave entry text was `type — reason` → now `reason \|\| type` (sample shows a single clean label); (b) **no "OTHERS (IN CAMP)" path** — the appointment loop read a non-existent `othersInCamp` and only emitted not-in-camp → now classifies by the real `outOfCamp` field and emits BOTH in/out labels; (c) fragile `.replace(/\s+\(/,…)` on the OTHERS line → clean conditional build. | `braves-parade.js` bpClassifyPerson. Validated by Node harness (structural match + 8/8 literal helper assertions vs `Message Formats.md`). |
| 51 | **Archive FP/LP slot typing + report-sick limited to morning/midday.** The cron tagged parade snapshots FP/LP by a hard noon cutoff (`bravesSlotType_`), so a **midday** parade was mislabelled **LP**, and report-sick archived at any `archiveSickTimes` slot. Per the user's model (FP at morning+midday, LP only at the night/last parade; report-sick morning+midday only): added `bravesParseParadeSlots_` → typed slots, where each `HHMM` may carry an explicit `:FP`/`:LP` tag and untagged entries default to **latest time = LP, all earlier = FP** (midday stays FP). `archivePoll` now uses these types; report-sick slots = `archiveSickTimes` if set, **else the FP (morning+midday) parade slots** (`bravesSickSlots_`), structurally excluding the night/LP slot. Manual `bravesArchiveNow` looks up the configured slot's type (falls back to the noon heuristic for an off-schedule ad-hoc time). Recommended Config: `archiveParadeTimes=0730:FP,1300:FP,2130:LP`, `archiveSickTimes` blank. | `apps-script-Code.gs` `bravesParseParadeSlots_`/`bravesSickSlots_`/`archivePoll`/`bravesArchiveNow`; `render.js` Archive help text; `?v=111`. Verified 7/7 via a node test extracting the slot helpers from the committed `.gs`; cross-check still 5/5 (generators unchanged). **GAS change needs redeploy.** |
| 50 | **Config reader accepts BOTH tab shapes (key/value rows AND columns-as-keys single row).** The live Sheet's `Config` tab is owned by the Telegram bot in a **columns-as-keys, single-row** layout (`botGroupChatId \| nextBookInDate \| outOfCamp \| …`, read by `tgReadConfig()` = `readTab("Config")[0]`), NOT the spec §4 `key \| value` layout. So `normalizeConfig`/`bravesNormalizeConfig_` were returning `{}` (the app ran entirely on `DEFAULT_CONFIG`), which meant Item 1's `archiveParadeTimes`/`archiveSickTimes` could never be read. Fix: both normalizers now detect the shape per row — a `key` column → key/value; otherwise every column is a setting — so the bot's columns and Braves settings **coexist on one tab**. Admin adds `archiveParadeTimes`/`archiveSickTimes` as new **columns** to the existing Config row. No regression (bot keys land in `STATE.config` but no Braves reader collides; missing Braves keys still fall back to `DEFAULT_CONFIG`). | `state.js normalizeConfig`, `apps-script-Code.gs bravesNormalizeConfig_`; `?v=110`. Verified both shapes via a node test. **GAS change needs redeploy** to take effect. |
| 49 | **Parade/sick archiving (Item 1) — server-side GAS cron + admin-only viewer.** New `ParadeArchive`/`SickArchive` tabs (`timestamp\|date\|slot\|type\|scope\|message` / `…\|format\|message`). The client-side parade/sick generators are **ported into `apps-script-Code.gs` by concatenating the real source** (helpers subset + `braves-parade.js`) between `BRAVES-ARCHIVE-PORT BEGIN/END` markers, run against a `STATE` built from the sheet tabs (GAS `readTab` already returns dates as "dd MMM yyyy", the display format the code expects) — so server output can't drift from the app. `archivePoll()` (5-min time-driven trigger via `setupBravesArchive()`) archives any `archiveParadeTimes`/`archiveSickTimes` slot (Config, comma-sep HHMM; FP<1200≤LP) whose time has passed and isn't already recorded — **idempotent per (date, slot)**. `archiveNow` doPost action (commander/admin, audited) shares the same generators for the manual button. Archive tabs are returned/readable **only to admins** (mirrors the AuditLog gate). Client: `STATE.paradeArchive/sickArchive` (admin pulls only), admin-only 🗄 Archive nav + `renderArchive` (hard `isAdminRole()` guard, parade/sick tabs, filter, copy, "Archive now"). **apps-script NOT live-tested**; redeploy + `setupBravesArchive()` trigger creation reserved for the user. | `apps-script-Code.gs` (ported block + orchestration + readAllTabs/doGet/routeAuthedPost gating), `api.js` (pull + `archiveNow`), `state.js` (init), `render.js` (`renderArchive`/`doArchiveNow`), `index.html` (nav, `?v=109`), `styles.css` (admin nav-btn flex). Verified: GAS syntax (`node --check`) + **cross-check 5/5 byte-identical** (`/tmp/xcheck.js` extracts the ported block from the committed `.gs` and diffs vs client output on the seed: company/PLT1/PLT2 parade + RS + RSI). |
| 48 | **Sick-history xlsx importer (Item 5) — colour = status, derived legend, ExcelJS.** New DOM-free pure parser `js/sick-history-import.js` (`shParseWorkbook`/`shEpisodesToRows`) reads the RSI/RSO REC sheet: A=S/N B=NAME C=4D, D… = one column per day (Excel-serial OR DDMMYY-number headers — magnitude disambiguates: 40000–80000 = serial, else DDMMYY). Status = **cell fill colour**; reason = cell text; same-colour adjacent cells **coalesce** into one episode (white/structural ends a run); explicit `"nD STATUS (range)"` text emits its own episode. The colour→status legend is **derived from the sheet's own legend block at run time** (filled col-A swatch + col-B label + empty col-C) with `SH_DEFAULT_LEGEND` (red=MC, yellow=LD, green=EX, cyan=RS-no-status, purple=SENT_OUT, magenta=AL/OIL) as fallback. Maps to Medical rows (RS→RSI/Pending, SENT_OUT→RSO, MC/LD/Excuse) + AL/OIL→Leave. **ExcelJS** added via CDN (CSV/PapaParse can't carry fills, SheetJS community reads them unreliably). Admin-only `.admin-only` button on the Medical toolbar → preview-before-commit modal → append with dedup by (d4·startDate·type·status) so re-import is safe; unmatched 4Ds listed not dropped. The sample xlsx is gitignored (`*.xlsx`, like the sample CSVs). | `js/sick-history-import.js` (new), `forms.js` import/preview/commit, `render.js` button, `index.html` (ExcelJS CDN + module, `?v=108`). Verified 18/18 via `/tmp/xlsx-harness/run.js` against the real `Sanitised Braves RSI_RSO REC Sheet.xlsx` (legend, serial+DDMMYY dates, 3-day LD coalesce, explicit-text episodes, AL/OIL→leave). Browser file-upload not auto-driven (admin session + native picker). |
| 47 | **HA-stats CSV export (Item 3, folded in with Item 2).** `buildHAStats`/`exportHAStats` in `helpers.js`: one row per person in the topbar scope from `computeHA(d4)` — overall status, Single periods (/10) + Expanded periods (/14), Double eligibility/status/periods (/13), rolling-14-day currency lapse + deadline, active-day count, last activity. Admin-only button beside the sick-stats one. Built now (not deferred) because the second button shares the same admin card and the helper is trivial. | `helpers.js` buildHAStats/exportHAStats; `sync.js` admin "Statistics" card. Verified via `/tmp/check-stats.js` vs the seed (1101/1103/1110 Single Complete, 1102 Lapsed, 1105 5/10, 2102 Double Complete 13/13). |
| 46 | **Admin-only statistics CSV exports (Item 2): report-sick stats, one row per person, scope-aware, same-day-deduped.** `buildSickStats`/`exportSickStats` in `helpers.js` reuse the leaderboard's unique-(d4,date) collapse + `classifyURTI`: columns 4D/Name/Platoon/Section/TotalRSDays/RSI/RSO/MR/URTI/NonURTI/MCDays/LDDays/LastRS, optional inclusive date range. Respects the topbar scope (`visibleD4Set`/`passesFilter`) so "what you see is what you export". Gated by `.admin-only` (CSS hides for non-admins) on a new Sync-panel "Statistics" card; reuses the existing `exportCSV`/PapaParse path (no new dependency, per the CSV-only decision). | `helpers.js` buildSickStats/exportSickStats; `sync.js` Statistics card. Verified via `/tmp/check-stats.js` vs the seed (8 RS people; 1101 RSI1/RSO1/URTI1/NonURTI1; 1105 LD+Excuse same day → 1 day). |
| 45 | **Sick messages single-space the field lines within an entry (supersedes the double-spacing call in #38).** `Message Formats.md` was updated to drop the blank lines between the six field lines (`S/N`/`R/N`/`DATE`/`LOCATION`/`PURPOSE`/`FOLLOW UP STATUS FROM MO`); they're now consecutive. `bpSickUrtiBlocks` emits each entry as ONE chunk (`bpSickEntryLines(...).join("\n")`); the `generateRSFormat`/`generateRSIPersonnel` outer `.join("\n\n")` is unchanged, so blank lines fall only between entries and around the `URTI:`/`NON-URTI:` count headers (and per-platoon labels in RSIP). The sample is internally inconsistent about the blank between `PLATOON n: PAX` and `URTI:` (PLT1 omits it, PLT2–4 keep it) — the chunk-join keeps it, matching the majority. | User correction (updated `Message Formats.md`). `braves-parade.js` bpSickUrtiBlocks + section header comment. Verified: RS Format + RSI Personnel re-printed against the seed — fields single-spaced, blanks only between chunks. |
| 44 | **STATUS multi-status for one person collapses onto a single numbered entry.** A recruit carrying several restricted statuses from one visit (e.g. `LD` + `Excuse RMJ`) previously rendered as separate numbered list items. `bpClassifyPerson` is per-person, so all `out.status` lines belong to the same recruit — they're folded into one `RN - desc1, desc2` line (descriptors `bpStripRN`-stripped and comma-joined, RN shown once), and the section count drops accordingly (`STATUS: 01`). **STATUS only:** other sections carry per-entry `(OTHERS (…))`-style suffixes that don't read sensibly comma-joined, and a person rarely has >1 there. Strength/`notInCamp` (a separate boolean) and the status-board helpers (`[0]`/`.length`) are unaffected. | User correction ("multi status for one person should be on the same line"). `braves-parade.js` bpClassifyPerson. Verified: seed's 1105 → `Jason Goh B1105 - 3D LD (…), Excuse RMJ (…)`, `STATUS: 01`. |
| 43 | **Status Board (A3/A4/A7) reuses the §8 classifier; two minor simplifications.** A7.3 "today's category" = the §8 single-label chain (`bpPrimaryForDay`); A4.2 grid fill uses its own priority (Leave>MC>LD>RSI/RSO>MR) with a secondary RSI/RSO corner-marker (`bpGridCell`). **Simplified vs the addendum (logged, low-impact):** (a) A7.4 "infinite scroll in batches of 30" → a scrollable max-height container + name/4D search (full render; fine at these scope sizes); (b) A4.3 "page by calendar month" → 5-week Mon-anchored windows shifted 5 weeks per nav click (≈month, not exact calendar months). Grid is O(scope×35×records) so a company-scope warning suggests narrowing to a platoon. | `render.js` renderStatusBoard/renderSB*; `braves-parade.js` bpPrimaryForDay/bpGridCell/bpStripRN. Helpers trace-tested (RSI/MC+MR/Leave fixtures + sbWeeks shape); renderers are DOM (node --check only). |
| 42 | **§20.7 RESOLVED — the "Not Available (in camp)" dashboard tile = MR + REPORTING SICK only; STATUS (LD/Excuse) NOT included.** §16 defines the tile explicitly as MR + REPORTING SICK (present but not available for normal activities); STATUS personnel are restricted-but-present and excluded. Computed via the §8 classifier (`bpClassifyPerson`). The ghost-tags "Recovering" widget already existed (`recoveringRows`); the §16 strength block is added as an [OFFICER]/[WOSPEC]/[ENLISTEE] card via `bpStrength`, replacing Cougar's platoon-by-platoon split. | `render.js` renderDashboard. |
| 41 | **HA currency uses the HA.md pairing model, not the spec §12.5 ">14 days" shorthand.** `HA.md` is authoritative over the main spec (CLAUDE.md precedence), so `computeHACurrency` implements the rolling-14-day pairing/reset/Day-14-lapse rule (DECISIONS #3,#4): each post-qualification activity pairs with the most recent prior one; a ≤7-day pair resets Day 1 to the day after the later activity (deadline = later+14); an activity OR today past the Day-14 deadline with no intervening reset ⇒ Lapsed (deadline check precedes the reset, per HA.md Example 1). **Double-HA rank gate** = `rankGroupOf(r) !== "Enlistee"` (WOSPEC/Officer ⇒ ≥3SG/≥2LT ⇒ Foundation/Service Term done) OR `hasVocFit`. Single/Expanded run day-based (1 period/day); **Double sums B5 time-periods** per active day (state-machine `mode:"time"`). HA participation source = CSV imports only (`source==="csv"` + `participants` includes the person). | `helpers.js` haDayMap/runHAStateMachine/computeHACurrency/computeHA; validated 18/18 via `/tmp/ha-test.js` (state machine + HA.md Example 1 + worked example + double eligibility + IPPT exclusion). Tz-safe local date keys (the old code's `toISOString().slice(0,10)` would shift dates under +ve UTC offset). |
| 40 | **HA participation stored on the Attendance row, not per-person ConductDetail.** The CSV import writes the Present roll as a de-duped comma-joined `participants` 4D list on the attendance row (+ `periods` from B5, `currencyTags`, `source:"csv"`), keeping ConductDetail "absentees only" (PX/Fallout) so the Detail view + totals semantics are untouched. `normalizeAttendance` defaults the 4 new fields on every row (writeTab column-strip guard). Not-found rows are skipped + surfaced (never dropped). Full data shape + how Step 7 reads it → `HA_DATA_SHAPE.md`. | `forms.js` importConductCSV/confirmConductImport; `state.js` normalizeAttendance; `api.js`; `render.js` Attendance toolbar button; `apps-script-Code.gs` schema header. Validated 13/13 via `/tmp/csv-test.js` against the real sample CSV. |
| 39 | **Scope migrated to the existing global filter; per-view override deferred.** Step 5 reused the Cougar global scope system (`filteredRoster`/`STATE.filterPlt|Sect|Role`/topbar selects) and migrated it from numeric `getPlt`/`getSect` to the explicit-column accessors `personPlatoon`/`personSection`/`activePlatoons`/`sectionsInPlatoon` (codes incl HQ + "Command"); added `inScope(personId)` (§11.3). Per-view override (§11.2, explicitly optional) NOT built — the global selector satisfies the core requirement. Legacy bare-numeric persisted `filterPlt` is discarded on load (migration guard). | `helpers.js`, `main.js`, `state.js`. Verified via a node harness evaluating real helpers.js. |
| 38 | **Sick messages include both RSI and RSO rows; messages are double-spaced.** The RSI Personnel message (§10.2) and RS Format (§10.1) source from Medical rows with `type` ∈ {RSI, RSO} reported on the date — §10.2's bullet says "≥1 RSI/RSO entry", so RSO is included despite the "RSI PERSONNEL" title. Every field line is followed by a blank line (the `Message Formats.md` sample is double-spaced for WhatsApp; the §10 prose omits the blanks but "match the sample exactly" wins). "FOLLOW UP STATUS FROM MO" derives from `status` (#34): Pending/blank → blank; MC/LD → "<n>D MC\|LD"; else the status text. | `braves-parade.js` generateRSFormat/generateRSIPersonnel + helpers; validated 14/14 via `/tmp/sick-test.js`. |
| 37 | **Live presence-tick + borderline-returnee checklists DROPPED from the Braves parade modal.** The Cougar FP/LP modal had a "borderline MC returnee → ATT C" checklist and an appointment in/out-of-camp tick; the Braves §8 classifier derives every category from stored data, so these controls no longer affect output. Appointments are classified by the stored `outOfCamp` bit. | Spec §8 defines categories from stored data; a borderline returnee (MC ended yesterday) is not active MC → not ATT C (spec-compliant). The spec §6 "presence-tick design idea" is a **deferred enhancement** (generalise `_apptCampOverrides`/`_paradeOverrides` into the Braves classifier), logged in SESSION_LOG. The legacy checklist + builder functions are now dead code, removed in a follow-up commit. |

### Still open

| Ref | Question | Resolve at |
|-----|----------|-----------|
| enh | Generalise the appointment/borderline **live presence-tick** into the Braves classifier (spec §6 design idea) — deferred, not a §8 requirement | Post-Step-8 polish (flag for user) |

## Session 2026-06-24 — feature batch (branch `feature/feature-batch-import-grid`)

Implemented a batch of operator-requested features. All verified in a local static-server
preview (screenshots) except the apps-script backend (needs redeploy). `?v=114`.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 52 | **PX redefinition (was: absent-due-to-status).** User clarified PX = a set of stretches done by non-participants (during/outside a conduct) — present, NOT absent. The old ConductDetail `type:"PX"` actually meant pre-existing-status absence, so it is **renamed to "Status"** (read-time migration in `normalizeConductDetail`), freeing "PX" to mean the genuine non-absent stretch activity. Every absent/missed/fall-out tally now **excludes** `type:"PX"`; "Status" still counts. New PX selectable in the conduct-detail form; shown teal. | `state.js normalizeConductDetail`; `forms.js` (import/wizard/person-card/parade-chat); `render.js` (conduct-detail/parade-state/MSK); `apps-script` schema comment. |
| 53 | **Status priority split LD > Excuse (else current order).** Grid cell colour priority is now LV > MC > **LD > Excuse** > RSO/RSI > MR (was LD/Excuse merged). `bpGridCell` splits the §8 `status` section by structured type (LD vs Excuse-*); new `EX` palette entry (brown) + legend. | `braves-parade.js bpGridCell`; `render.js SB_CELL`/legend. |
| 54 | **Status grid → GitHub-activity styling + mobile fix + perf.** Each day = a square showing the day-of-month, coloured by status (secondary RSI/RSO corner triangle kept; no colour blending). Identity split into two columns: 4D frozen on all screens, Name un-freezes < 760px so the grid isn't buried on mobile. Cell clicks use one delegated table listener (`sbGridClick`) + CSS `contain` instead of per-cell inline handlers — addresses the iOS-Chrome lag. | `render.js renderSBGrid`; `styles.css .sb-*`. |
| 55 | **Mass conduct import = many CSVs at once.** `importConductCSV` accepts multiple files (`<input multiple>`), parses each via `parseConductCSV_`, shows one combined review, commits all together (ids auto-created; identical names within a batch coalesce; one `replace` per tab). | `forms.js` parseConductCSV_/openConductImportModal/confirmConductImport; `render.js` import button + `showConductImportSchema`. |
| 56 | **Auto Pending report-sick backfill on import + Medical `origin`.** New Medical field `origin ∈ {manual, conductLog}` (default manual; preserved on edit). MC-status CSV rows with no existing Medical record for that date auto-create a Pending report-sick record (origin conductLog), surfaced as a "from conduct log" badge. Those already logged are untouched. | `state.js normalizeMedical`; `forms.js confirmConductImport`/`submitMedical`/wizard; `render.js` Medical badge; `apps-script` schema comment. |
| 57 | **Commander mass-deletion guard (server-side).** Commanders capped at N single-row deletes/rolling hour (Config `commanderDeleteCap`, default **30** — 20 judged slightly low for legit post-conduct cleanup); admins exempt; only `deleteRowById`/`deleteRow` counted (full-tab `replace`/append/upsert exempt, so CSV import never trips it). 429 on breach. | `apps-script-Code.gs` bravesCheckDeleteRate_/bravesDeleteCap_ + delete gate. **Needs redeploy.** |
| 58 | **Archive delete + CSV export (admin).** Admin-only delete of archived parade/sick messages (matched by timestamp, audit-logged via new `deleteArchive` action) and CSV export of either archive (respects the search filter, reuses `exportCSV`). | `apps-script-Code.gs bravesDeleteArchive`; `api.js deleteArchive`; `render.js` archive delete/export buttons. **Needs redeploy.** |
| 59 | **SOC time = duration; HR optional.** SOC completion time captured as minutes+seconds (stored canonical `mm:ss`, `socDurationParts`/`socDurationDisplay`), not a clock. Avg HR optional on SOC; both Avg+Max HR optional on Route March (blank stored as `""` not NaN; max≥avg check only when both present). | `forms.js` openSOCForm/submitSOC/openRMForm/submitRM; `helpers.js`; `render.js` SOC/RM tables. |
| 60 | **List search/sort + IPPT views/summary + card edit.** Reusable name/4D search + clickable column sort (`listCtl`/`listSearchInput`/`sortTh`/`listApplySort`) on Medical/IPPT/Conduct-detail/HA. IPPT gains a view selector (all / by attempt / by date), a mean+median score-over-time line chart, and a static-vs-run strength split (push-up+sit-up vs 2.4km station scores, latest attempt). Person card gets inline edit/delete on each IPPT/RM/SOC/Medical record (delete re-opens the card). | `helpers.js` list helpers; `render.js` renderIPPT/Medical/HA/ConductDetail + buildIPPTTrendChart; `forms.js` openPerson/pcDelete. |

## Session 2026-06-25 — `/code-review` (branch `feature/feature-batch-import-grid`, commit `5250222`)

`/code-review` (high) returned 10 findings. The two data-correctness bugs and three of the
security findings were fixed in `5250222` (PX→Status round-trip → new `PXP` token; batch-import
merge instead of clobber; vendored Chart.js/PapaParse/ExcelJS off the CDN; complete `escapeHTML`
+ ~90 DOM-XSS escaping wraps across render/forms/sync/main). **Security Finding 3 (clear-text
storage of sensitive information) needed a judgement call, not a code change** — recorded below.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 61 | **Security Finding 3 (clear-text storage of sensitive info) — 2 sites dismissed as false positives, 1 genuine item accepted-as-designed; NO code change.** (A, FP) `passwordHash`/`salt` (Accounts tab) — these *are* the protection: `SHA-256(salt+password)` per-account UUID salt, verified server-side, never returned to client. (B, FP) `ANTHROPIC_API_KEY` in ScriptProperties — the correct server-side GAS secret store, never shipped to the browser. (C, genuine) the device auth token + email/role/personId in browser `localStorage` — inherent to a buildless `file://`-capable SPA + token-gated Apps-Script web app (no server session / HttpOnly cookie available); single-purpose, server-revocable, 30-day-expiring. Residual XSS-exfiltration risk is the very risk the same commit's ~90 escaping wraps closed. Optional future defence-in-depth (not blocking): shorter token TTL + silent refresh; server-side device-fingerprint binding. | False positives: `apps-script-Code.gs:641` (hashPassword), `:646` (verifyPassword), `:873` ("never return passwordHash/salt"), `:317`/`:330` (ANTHROPIC_API_KEY in ScriptProperties). Genuine: `js/state.js:485` (AUTH_KEY), `:497-500` (email/role/personId), `:164-170` (read-back on launch). |

### Finding 3 — risk memo (full)

GitHub-code-scanning-style "Clear-text storage of sensitive information" flagged three sites.

- **❌ False positive A — `passwordHash` / `salt` (Accounts tab).** These columns are the
  defence, not a leak: passwords stored as `SHA-256(salt + plaintext)` with a per-account UUID
  salt (`apps-script-Code.gs:641`), verified server-side (`:646`), and explicitly never returned
  to the client (`:873`). The only (unrelated) footnote: fast SHA-256 vs. bcrypt/scrypt is
  brute-forceable *if the Sheet itself is breached* — but Apps Script has no native bcrypt and
  this was an accepted spec-A1 constraint. **Dismiss.**
- **❌ False positive B — `ANTHROPIC_API_KEY` (ScriptProperties).** `PropertiesService.getScriptProperties()`
  (`apps-script-Code.gs:317`/`:330`) is the recommended server-side secret store: not in source,
  never sent to the browser. The opposite of clear-text-in-code. **Dismiss.**
- **⚠️ Genuine — auth token + email/role/personId in `localStorage`.** `setSession()` persists the
  bearer token (`js/state.js:485`) and email/role/personId (`:497-500`) in clear text; read back
  into `STATE` on every launch (`:164-170`). **Inherent, not a bug:** a buildless `file://`-capable
  SPA against a token-gated Apps Script web app has no server session and no HttpOnly-cookie
  mechanism, and must survive reloads without re-login (spec A1: 30-day session). The token is
  single-purpose (gates one Sheet), server-revocable (admin-panel Revoke), and 30-day-expiring.
  **Residual risk:** XSS in the operator's origin could exfiltrate the token — exactly the risk the
  same commit's ~90 escaping wraps just shut down; remaining vectors (shared device, malicious
  extension) are outside the app's control. **Recommendation: accept as designed, no change.**
  Optional defence-in-depth later: (1) shorter token TTL + silent refresh; (2) server-side
  device-fingerprint binding so a stolen token is useless elsewhere. Both enhancements, not fixes.

---

## Session 2026-06-27 → 2026-07-02 — post-v1.1.0 fixes (PRs #5–#30)

Individually-reviewed PRs merged straight to `master` (no long-lived feature branch this round). Only
genuine judgment calls are logged here — see `CHANGELOG.md`'s `[Unreleased]` section for the full list
of shipped fixes/features.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 62 | **HA eligibility source default flipped to `currencyTag`.** The name-based guess (`isHAExcluded`: only IPPT/Sports & Games/Swim excluded) wrongly credited every other untagged conduct — e.g. Combat PT earned HA days. The CSV import already carries an authoritative per-conduct signal (row-2 `Currency Tags: HA`), so the default now reads that instead. **Needs a live-sheet follow-up:** an explicit `BravesConfig` row still overrides the default — must be set to `currencyTag` (or cleared) on the live sheet for the change to take effect. | `state.js`/`apps-script-Code.gs` `haEligibilitySource`; PR #23 (`c77c432`). |
| 63 | **isInCamp override composes additively across leave types and rows.** A commander's manual "physically present despite leave type" override (e.g. Guard Duty) applies uniformly across AL/OIL and OTHERS buckets and additively across multiple same-day leave rows, without touching medical/appointment exclusions — so it only ever pulls someone *into* camp, never suppresses an independent medical/appointment reason for being out. | `js/braves-parade.js`/`apps-script-Code.gs` `bpClassifyPerson`; PR #13 (`be1fb07`). |
| 64 | **`nextId()` collision fix widens the keyspace rather than adding a uniqueness check.** A ~9,000-value random range with no collision check let two independent sessions/devices generate the same row id, and `upsertRow`'s "first row matching this id" semantics meant a later edit silently overwrote an unrelated, older row. Chose to widen the random range to ~9×10¹¹ (statistically collision-resistant) instead of adding a check against existing ids (would need a read-before-write round trip on every id mint, which multi-device OCC can't afford). **If `nextId()`/`_idCounter` is touched again, do not shrink the range back down.** | `js/helpers.js:209`; `test/id-generation.test.js`; PR #28 (`29ec24d`). |
| 65 | **Log Conduct wizard CSV-field preservation via a merge helper, not by widening the wizard form.** `saveLogConductWizard` only ever collected wizard-owned fields (id/date/time/conductId/total/participating/lms/px/fallout/remarks); rather than surface the CSV-only fields (`participants`/`periods`/`currencyTags`/`source`) in the wizard UI where they'd invite accidental editing, `mergeAttendanceEdit(existing, entry)` spreads the existing row first so only the wizard's own keys move — new values win, CSV-only fields survive untouched. | `js/state.js` `mergeAttendanceEdit`; `js/forms.js` `saveLogConductWizard`; PR #24 (`1d4664b`)/#25 (`9af565b`). |
| 66 | **Wizard tick-seeding distinguishes "never reviewed" from "reviewed, deliberately overridden."** A `statusReviewed` flag on the attendance row: while unreviewed, a restrictive-status CSV participant's not-participating tick seeds from the medical default (so it ticks correctly on first open); once the wizard has been saved once, an absent Status row is honoured as a deliberate "participates despite status" call and is never silently re-ticked on a later edit. | `js/forms.js` `rebuildLogConductStatus`/`saveLogConductWizard`; `js/state.js` `normalizeAttendance`; PR #26 (`6882731`). |
| 67 | **Report Sick "End date" relaxed from a hard block to a dismissible reminder.** Previously blocked saving unless the status was Pending/NIL/MR and an end date was entered; now a blank end date just warns, matching how Pending/NIL already behaved for every other status. | `js/forms.js` `submitMedical`; PR #29 (`985cf50`). |
| 68 | **Warded gets its own OTHERS-subtype tag (`WD`) rather than reusing generic OTHERS — pattern for future OTHERS-section distinctions.** `bpClassifyPerson` always correctly set `notInCamp=true` for Warded, but the Status Board grid/list never branched on the `others` section at all, so Warded rendered identically to a blank/in-camp cell. Fixed by giving Warded its own `type:"WD"` on the `others`-section push, a dedicated colour, and a distinct badge label. **Deliberately not extended** to other not-in-camp OTHERS cases (out-of-camp appointments, generic "OTHERS (NOT IN CAMP)") since the user only flagged Warded — same fix pattern applies if asked to extend it. | `js/braves-parade.js`/`js/render.js`; PR #30 (`e30c74f`); memory `braves-status-board-grid-others-blind`. |
| 69 | **Conduct deletion changed from block-if-used to cascade-delete, per explicit user choice.** `deleteConduct` previously refused to delete a conduct with any Attendance/Polar/ConductDetail rows still referencing it. The user wanted deleting a conduct to also remove its historical records, so the guard was replaced with a "this will permanently delete N records, cannot be undone" confirm, then a filter+`replace` cascade across the three child tabs. Investigating the triggering bug (user's registry deletes reported success but the live Sheet's `Conducts` tab never actually lost the rows) also surfaced that the **deployed Apps Script was running an older version** than the editor — confirmed by manually re-running `deleteRowById` in the Apps Script editor against the live sheet, which worked correctly. That's an operational fix (redeploy), not a code bug, and is **unverified against the live Sheet** until the user redeploys. While implementing the cascade, `writeTab`'s empty-array rejection was also fixed (clears data rows, keeps the header) since a cascade can legitimately zero out a tab. | `js/forms.js` `deleteConduct`/`countConductUsage`; `apps-script-Code.gs` `writeTab`; PR #31 (`29660f5`). **Needs redeploy** — see `SESSION_CONTEXT.md`. |
| 70 | **Log Conduct wizard's group picker resolves membership from the roster's explicit `platoon` column at add-time, never from a hardcoded list or the 4D digits.** The user flagged that platoon numbering is about to change (1–4 → 4–6) and membership may not carry over (a new "Platoon 4" may hold different people than the old one). Rather than special-case the transition, `resolveConductGroup`/`groupLabel` read `activePlatoons()` (Platoons tab) for the option list and `personPlatoon(r)` for membership — both already roster/config-driven — so the renumbering is purely a Sheet edit, zero code change. Group values are snapshotted into the Attendance row's `participants` at add-time specifically so a later roster reorg doesn't retroactively rewrite historical attendance. | `js/forms.js` `resolveConductGroup`/`groupLabel`/`wizAddGroup`; `js/helpers.js` `activePlatoons`/`personPlatoon`; PR #32. |
| 71 | **"Entire company" now means everyone including commanders; a separate "Non-Commanders" option covers what "company" used to mean.** Commanders were blanket-excluded from every wizard participant/count calculation before this change. Once the group picker needed a "commanders only" scope anyway, keeping "Entire company" as recruits-only would have made it indistinguishable from "Non-Commanders" — the user confirmed Entire company should mean literally everyone, with Non-Commanders as the explicit recruits-only choice. Platoon-group options still exclude commanders (a commander is reached only via Entire company / Commanders only), since a commander's roster row carrying a platoon code doesn't make them a de-facto member of that conduct's platoon roll. | `js/forms.js` `resolveConductGroup`; PR #32. |
| 72 | **A wizard conduct's "Counts toward HA" checkbox deliberately ignores the `haEligibilitySource` config, unlike CSV rows.** HA gating moved from a raw `source==="csv"` check into `haCountsRow(a)`: CSV rows still follow whichever eligibility signal Config selects (name-guess or currencyTag), but a wizard row counts *only* if its own checkbox stamped the `HA` token onto `currencyTags` — the legacy name-based config is never consulted for wizard rows. Rationale: the checkbox is explicit, per-conduct operator intent entered at log time; falling back to a name-guess for wizard rows would let an innocuous-sounding but unticked conduct leak into HA, or vice versa, silently contradicting what the operator just chose. The checkbox and the pre-existing per-conduct HA toggle (`toggleConductHA`) both read/write the same `currencyTags` field, so they can never disagree. | `js/helpers.js` `haCountsRow`/`haDayMap`/`haExcludedDayMap`; `js/forms.js` wizard save path; PR #32; `HA_DATA_SHAPE.md` 2026-07-06 update. |
| 73 | **Attendance `participants` coercion fix widens the existing `bravesForceTextCols_` pattern rather than changing the stored format.** Sheets' number auto-coercion was silently destroying the comma-joined 4D roll (reads commas as thousands separators, then IEEE-754 zero-fills past ~15 significant figures) — corrupting the string on every `writeTab` push and giving affected conducts zero HA credit with no visible error. Rather than switch `participants` to a non-numeric-looking format (e.g. prefixing each id, or storing as a JSON array string) — a wider, more disruptive schema change touching every reader — the fix forces the column to plain-text (`@` number format) via the same `bravesForceTextCols_` mechanism already used for the archive tabs, applied in `writeTab` before `setValues` (setting format after a coercing write can't undo the damage). Row-level writers (`appendMany`/`upsertRow`) don't clear formatting, so they inherit the fix automatically. | `apps-script-Code.gs` `writeTab`/`WRITE_TEXT_COLS_BY_TAB`; PR #33 (`16cdcd7`). **Needs redeploy** — same outstanding GAS redeploy queue as PR #31/#69. |

---

## Session 2026-07-07 → 2026-07-12 — HA optimiser, Parade State tab, upstream ports (PRs #34–#52)

Individually-reviewed PRs merged to `master`. Only genuine judgment calls logged here — see
`CHANGELOG.md`'s `[Unreleased]` section for the full shipped list.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 74 | **HA scan is a deliberate best-start optimiser, not a greedy forward pass.** The 15:20 2026-07-07 support investigation (recruit 3101 stuck "Not Started" despite a green grid) traced to the old greedy `runHAStateMachine` resetting on cumulative `breaksUsed > 2` just short of the 10-day target, with no backtracking to a better window start. With user sign-off the scan was rewritten to try every active start date (`simulateFrom` primitive + wrapper) and keep the best window; return shape unchanged (drop-in). **This intentionally diverges from `HA.md`'s forward-pass wording — do not "fix" it back.** | `js/helpers.js` `runHAStateMachine`/`simulateFrom`; PR #36; memory `braves-ha-start-date-optimizer`. |
| 75 | **Ended MC persists in ATT C keyed solely on `roster.status`, not on the existence of a later MC.** The Parade State tab (#38) made ended-MC-until-booked-in persist via the shared §8 classifier. PR #39 then over-painted the Status Board across the gap before a *later* MC; #42 reverted that — the roster.status mirror alone decides booked-in state, and a later MC's existence must not retroactively fill the gap. | `js/braves-parade.js`/`apps-script-Code.gs` §8 classifier; PRs #38/#39/#42; memory `braves-ended-mc-persistence-source-of-truth`. |
| 76 | **Overlapping same-type statuses collapse to the one that ends *last*, not the longest-duration one.** User corrected the initial "longest duration" framing. Applies only to same-exact-label overlaps across duration-bearing sections (STATUS / ATT C / AL-OIL / OTHERS); appointments are point events and excluded. Blank end date treated as ends-last (defensive/unreachable — `medStatusActive` requires an end date). Implemented as `{supKey,supEnd}` push-time tags + a `bpSupersedeSameType` pass after exact-line dedup, before the STATUS comma-collapse; GAS twin patched identically. | `js/braves-parade.js` `bpSupersedeSameType`; PR #45. |
| 77 | **Multi-section parade listing is spec-mandated — upstream's ATT C/OTHERS cross-section dedup is deliberately NOT ported.** Assessment of cougar-system upstream flagged a "never listed in both ATT C and OTHERS" dedup; the Braves spec is explicit that a person may be listed under multiple sections at once (only within-section dedup is required). Delivered as a regression test + a `bpBuildBlock` comment locking the intended behaviour — a legitimate no-op port outcome. | `BRAVES_ADAPTATION_SPEC.md` §"Listing is multi-section"; `test/parade-multisection.test.js`; PR #47. |
| 78 | **Parade-state compare reuses the existing `paradeArchive`/`archiveNow` path instead of porting upstream's 679-line module + new sheet tab.** Upstream cougar-system added a standalone compare subsystem; Braves already had an admin-only archive, so the compare view diffs `STATE.paradeArchive` (inheriting its admin gate) and Copy archives the **exact textarea text** (incl. hand edits) — a past parade state can't be faithfully regenerated because manual overrides are session-only. New `bravesArchiveParadeText_` stores the text verbatim, deduped by date+slot+type+text. **Needs GAS redeploy** for the exact-text path; the compare view works without it. | `js/helpers.js` `diffLines`/`paradeSnapshotDup`; `js/parade-tab.js` `archiveParadeSnapshot`; `apps-script-Code.gs` `bravesArchiveNow`; PR #50. |
| 79 | **Ended-MC persistence is now BOUNDED to the MC+1/MC+2 ghost window, then auto-hides (bounds #75).** A real-data audit found ~20 recruits shown "on MC" on the Status Board whose MC had ended weeks/months earlier — a stale `roster.status="MC"` mirror nobody cleared, persisted forever by #75/#38. With user sign-off (chose "auto-hide after ghost window" over a bulk book-in tool), the §8 classifier now only persists an ended MC while it is within `sinceEnd ≤ 2` days of its end date (the same MC+1/MC+2 grace `medStatusTag` ghost-tags); past that the row drops out of ATT C and the recruit reads present. **CURRENT strength only — `roster.status="MC"` still counts toward TOTAL strength via `bpIsActive`, so #42's protection is untouched.** This narrows #75 (mirror is still the source of truth *within the window*); it does NOT reintroduce #39 (a later MC still doesn't imply book-in). GAS twin patched identically. | `js/braves-parade.js`/`apps-script-Code.gs` §8 classifier; `test/parade-classifier.test.js`; memory `braves-ended-mc-persistence-source-of-truth`. |
| 80 | **The GAS parade-port cross-check is rebuilt and committed, and asserts BEHAVIOURAL equality — not byte-identical source.** The `BRAVES-ARCHIVE-PORT` block's header advertises an assembler (`/tmp/assemble-gas.js`) and a cross-check harness. Per #49 both were real, but both lived in `/tmp`, were never committed, and are gone — so the block was verified the day it landed and never again. An audit found the copies had **already drifted**: 5 functions (`bpClassifyPerson`, `bpGridCell`, `bpIsActive`, `bpPrimaryForDay`, `bpSupersedeSameType`) plus 2 never-ported (`bpBuildIndex`, `bpIsNotAvailable`), introduced by `5131b1b` (status-grid MC-tail work) touching the frontend only. **The drift is structural, not semantic** — the refactor (`sup` → `meta`, an `idx` fast-path) feeds the Status Board grid, the archive path never passes `idx`, and both copies still emit identical text. Hence the invariant chosen: *same `STATE` in → same message out*. **Byte-identity was rejected**: it fails today, and satisfying it would force UI-only plumbing into GAS where nothing consumes it. Output is what must never diverge; internal refactors stay free. Note #49's `xcheck.js` compared *rendered output on a seed*, not source — so "byte-identical" in the header always meant the messages. The new test restores its company/PLT1/PLT2 + RS + RSI coverage and adds a per-section fixture set; a negative control (mutating the port) confirms it fails loudly. **Still no assembler** — hand-port both copies; the test only tells you when you got it wrong. Corollary: `docs/BACKEND.md`'s "zero parade-logic coverage" claim was false — `loadBackend()` + `backend.test.js:178-198` already exercised the port. **Shipped + MERGED as PR #61** (`5b2fd8f`, merge `f3a01af`, 2026-07-15) — test-only, no production code touched. | `test/parade-port-parity.test.js`; `docs/superpowers/specs/2026-07-15-parade-port-parity-design.md`; `docs/BACKEND.md` § dual-maintenance; `docs/ARCHITECTURE.md`; `docs/README.md`; `docs/frontend/braves-parade.md`; `MD_Docs/TESTING.md`; memory `gas-port-dual-maintenance`. |
| 81 | **`sandboxIssueTokens()` never existed; `CLAUDE.md`'s sandbox instructions were fiction.** `CLAUDE.md` told you to run `sandboxIssueTokens()` to mint a 30-day token password-free. No such function is in `seed-synthetic.gs` (whose entire history is two commits, `3a3e71b` + `6a47bc8`, neither containing it) or `apps-script-Code.gs`, and a pickaxe across all branches finds the identifier nowhere — it was an ad-hoc helper that never shipped. `docs/SANDBOX.md:89-93` already documented this correctly and was ignored. The sanctioned path is unchanged: the **human** logs in via the app's own form (passwords at the top of `seed-synthetic.gs`), `handleLogin` issues a real 30-day token, and that token is injected at runtime — Claude never handles the password. **Why this went unnoticed for so long:** `.gitignore` carries a bare `*.md`, so every doc is untracked; `git log -S` on doc text always returns empty, and the shell's `grep` (a `ugrep --ignore-files` wrapper) silently skips ignored files, so `grep -r` over the repo cannot see `CLAUDE.md` at all. Use `command grep -r`. | `CLAUDE.md` (sandbox bullet + a new Conventions entry on the grep trap); `docs/SANDBOX.md`; memory `braves-synthetic-sandbox`. |

---

## Session 2026-07-17 → 2026-07-18 — book-in refactor + adversarial-review follow-ups (PRs #62–#66)

Individually-reviewed PRs merged to `master`. #62–#64 were one Leave/Out timeline arc (selected-people scope, first-5 collapse, deterministic tie order) — mechanical enough to leave to `CHANGELOG.md`. The two genuine judgment calls this session both come out of the five-fix batch (#65) and its review (#66), and #82 is a **source-of-truth reversal** that supersedes #75/#79.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 82 | **The Roster medical-status mirror is REMOVED — `roster.status` now means only active-vs-departed; book-in is tracked by an immutable `bookInDate` on Medical AND Leave. SUPERSEDES #75/#79 (and retires #42's mirror-as-source-of-truth).** #38/#75 made "ended MC persists in ATT C until booked in" hinge on the `roster.status="MC"` mirror that `submitMedical` stamped; #79 then had to *bound* that mirror to the MC+1/MC+2 window because nobody ever cleared it, and real data still showed weeks-stale "on MC" rows. The whole mirror was the wrong primitive: it conflated "what medical status is live" (derivable from the Medical layer) with "has this person been booked back into camp" (a distinct operator action). PR #65 deletes the mirror — `submitMedical` no longer writes `roster.status`; `normalizeRoster` treats `status` as active-vs-departed only; the Roster badge derives **live** from the medical layer via `rosterDisplayStatus(r, effByD4)` (departed statuses win, else the current effective med tag, else "Active"). Book-in becomes explicit and immutable: "Mark Present" stamps `bookInDate` (display-date format) onto the Medical/Leave record **without rewriting its start/end dates** (so a 16–20 AL marked present on the 18th keeps its 16–20 range), and the §8 classifier's `bookedInBy(rec, dateIso)` guard — mirrored into both `braves-parade.js` and the GAS port — decides in-camp state from `bookInDate`, not from a mutated end date and not from the mirror. Because `roster.status` no longer carries MC, the topbar "Active" counter can no longer read `r.status === "Active"`; it now derives from the canonical `bpStrength(scoped, todayISO()).current`. **Requires `bravesMigrateSchema` after deploy** (adds the `bookInDate` column to Medical + Leave); user confirms sandbox GAS redeployed + migrated. | `js/state.js` `normalizeRoster`/`normalizeMedical`/`normalizeLeave`; `js/forms.js` `submitMedical` (mirror write removed); `js/helpers.js` `rosterDisplayStatus`/`bookedInBy`; `js/braves-parade.js` + `apps-script-Code.gs` §8 classifier (`bookedInBy` guard) + `bravesMigrateSchema`; `js/render.js` roster badge + Active counter; PR #65; memory `braves-bookindate-book-in` (supersedes `braves-roster-status-mirror` + `braves-ended-mc-persistence-source-of-truth`). |
| 83 | **The Parade State grid is edit-locked to booking MC / AL·OIL / OTHERS in as Present — it can only ever *book someone in*, never invent an arbitrary status transition.** The old grid rendered a full `PARADE_CODES` `<select>` on every row, inviting operators to hand-set any code and drift the grid away from the underlying records. PR #65 gates the code cell behind `PARADE_EDITABLE_CODES = ["MC","AL/OIL","OTHERS"]`: only those rows get a `<select>`, and it offers exactly the current code + `Present` (choosing Present routes through `openParadeClearConfirm`); every other row is read-only text. This keeps the grid a book-in surface consistent with #82's model rather than a free-form status editor. | `js/parade-tab.js` `renderParadePlatoon`/`onParadeCodeChange`; `test/render-wiring.test.js`; PR #65. |
| 84 | **Adversarial review of #65 → follow-ups shipped as a NEW PR #66 (not a reopen of the merged #65); one finding withdrawn as intended behaviour, two perf fixes are output-identical, dead code removed.** #65 was already merged/closed with its origin branch deleted, so the follow-ups went on a fresh branch off `origin/master`. (a) **Withdrawn, no change:** the review flagged "an ended MC that also gains an LD" as possibly wrong; the user confirmed it is *intended* — an ended MC persists as not-in-camp/MC until explicitly Marked Present even when an LD is added, and **both** the MC and the LD list on the parade state (multi-section listing, cf. #77). (b) **Perf, byte-identical output:** `rosterDisplayStatus` was rebuilding the entire medical-effective layer once per roster row (O(roster×medical)); the render now builds an `effByD4` map once and passes it in (O(1)/row). `bpStrength` was calling `bpClassifyPerson` with no index, re-scanning all medical rows per person (O(people×records)); it now builds the d4→rows index once via the existing `bpBuildIndex()` and threads it through — verified **behaviour-preserving** with an in-browser negative control (with-idx == no-idx classification). (c) **Dead code:** #83's edit-lock made the old status-editor unreachable, so `saveParadeCode`/`openParadeCodeEditor`/`paradeStatusOptions`/`paradeActiveMed`/`paradeActiveLeave`/`PARADE_CODES` and the vestigial `exceptId` param on `paradeEndActiveContributors` were removed (−192 lines net). 273/273 tests, `node --check` clean; cache-busts helpers 132 / render 140 / braves-parade 129 / parade-tab 10. | `js/helpers.js` `rosterDisplayStatus`; `js/render.js` `renderRoster` (`effByD4` once); `js/braves-parade.js` `bpStrength` (indexed); `js/parade-tab.js` (editor removed); PR #66 (`a0068b9`, merge `94f1c0c`). |

---

## Session 2026-07-19 — ConductDetail atomic sync fix (PR #67, merged 2026-07-18)

Investigation of the "ConductDetail rows go malformed after reload" bug → two compounding defects
fixed on branch `fix/conductdetail-atomic-sync`. A third defect (#86) was caught only by driving the
fix against the live sandbox — the string-only vm mock structurally couldn't see it.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 85 | **The conduct-wizard's ConductDetail save is now a SINGLE atomic `replaceConduct` op, and the launch `pullAll` no longer clobbers dirty tabs — replacing the non-atomic delete+append that could half-write the sheet.** Root cause of the reported bug: (1) `saveLogConductWizard` synced ConductDetail as `delete×N (every old id, since ids regenerate each save) + appendMany` — *separate* queued writes; if the deletes committed but the trailing `appendMany` failed (OCC conflict exhaustion when a second account writes in the delete→append window, or a `waitLock(15000)` 503 under contention), that conduct's Status+Fallout rows were left deleted-but-not-re-added (Attendance stayed correct because it's a separate idempotent `upsert`); (2) launch `pullAndRender → API.pullAll()` overwrote every tab unconditionally — unlike `autoRefreshTick`, which splits dirty/safe — so a reload wiped the cached-but-unsynced rows before `maybeRestoreDirty` could replay them (`_dirtyOps` is in-memory only, lost on reload). Fix: new backend op `replaceConductRows(tab, match, rows)` deletes the `(date,time,conductId)` non-RSI rows and appends the rebuilt set under **one** `withRevLock` (non-enforcing, row-scoped) — never observed half-written, and idempotent so a retry can't duplicate; the wizard fires one `replaceConduct` instead of delete+appendMany (side benefit: stops big edits tripping the commander 30-deletes/hr cap). `pullAll` now skips `PULL_ASSIGN` + preserves `STATE.rev` for any tab in `STATE.dirty` (new `STATE_KEY_TO_TAB` reverse map); `forceResync` clears dirty first so it still gets an authoritative pull. `autoSyncOnLaunch()` in sync.js is confirmed **dead code** (never called) — the real launch is `pullAndRender`. **Needs GAS redeploy** for the new action. | `apps-script-Code.gs` `replaceConductRows` + routing/audit; `js/sync.js` `dispatchWrite`; `js/forms.js` `saveLogConductWizard`; `js/api.js` `pullAll`/`STATE_KEY_TO_TAB`; `test/sync.test.js`; PR #67 (`223227a`); memory `braves-conductdetail-atomic-sync`. |
| 86 | **`replaceConductRows`'s delete-match must normalize sheet cells the SAME way `readTab` does — a Sheets date-coercion trap the string-only vm mock could not catch (found by live sandbox testing).** The first cut compared `String(getValues() cell)` against the client's match values and passed all 278 vm tests, but on the live sandbox every save **duplicated** rows. Cause: ConductDetail's `date`/`time` columns aren't in `WRITE_TEXT_COLS_BY_TAB`, so Sheets stores "01 Jan 2099" as a real **Date object**; `readTab` reformats Date cells to "dd MMM yyyy" (or the display string for time-only cells) before returning them, so the client's `match.date` is a clean string — but the raw `getValues()` in the delete phase yields a `Date`, and `String(Date)` ("Mon Jan 01 2099…") never equals "01 Jan 2099", so the delete silently no-op'd. Fix: normalize each compared cell (conductId/date/time/type) exactly as `readTab` does, using `getValues` + `getDisplayValues`. **Lesson (recorded in memory + test comment): the vm mock stores plain strings and never coerces types, so date-keyed sheet writes need live-sandbox verification.** Regression test seeds a real `Date` cell + stubs `Utilities.formatDate` (verified: fails on the old raw-`String` compare, passes with the fix). 279/279. | `apps-script-Code.gs` `replaceConductRows` delete phase; `test/sync.test.js` "Date-coerced" case; PR #67 (`667a599`); memory `braves-conductdetail-atomic-sync`. |

---

## Session 2026-07-19 — time-coercion fix, sandbox minter, PR #70 batch (PRs #68–#70, merged)

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 87 | **PR #69's time-duplication fix lives at the write-format layer (`WRITE_TEXT_COLS_BY_TAB.ConductDetail=["time"]`), not only at compare time.** The morning-conduct duplication bug traced to ConductDetail's `time` column being absent from `WRITE_TEXT_COLS_BY_TAB`, so a leading-zero time ("0730") was stored as the coerced number 730 — `replaceConductRows`'s delete-match (#86) then never matched it, and every re-save duplicated the rows. Rather than patch only `normCell`/the compare step (which would leave the sheet permanently storing lossy numbers and require every future reader to keep compensating), the fix forces `time` to text at write time so post-fix writes can never coerce again, **plus** a `normTime` legacy-heal in the delete-match that left-pads an already-coerced numeric cell (e.g. `730` → `"0730"`) so pre-fix rows already sitting in the sheet still delete-match. | `apps-script-Code.gs` `replaceConductRows`/`WRITE_TEXT_COLS_BY_TAB`; `test/sync.test.js`; PR #69 (`92a0050`). |
| 88 | **PR #70's wizard Enter-to-save is gated by an own-modal guard, added only after the final whole-branch review caught a phantom-save defect.** A bare Enter listener bound to "save the conduct wizard" is unsafe on its own: cancelling the wizard leaves `_logConduct` populated (never cleared), so pressing Enter while a *different* modal happened to be open could silently re-save the already-cancelled wizard. The handler was changed to first verify the conduct-wizard modal is actually the one on screen before saving, closing that phantom-save path. Same session also removed `generateInvite`/`generateBulkInvite` as dead editor-only helpers — the server-side redeem/revoke path is unaffected and remains the only invite mechanism. | `js/forms.js` (Enter-to-save handler + wizard modal guard); `test/log-conduct-wizard.test.js`; `apps-script-Code.gs` (invite-generator removal); PR #70 (`0bc5535`/`b660bac`/`728fd34`). |

---

## Session 2026-07-20 — Sync-perf live measurement, P4-1, and two parks (PR #73)

Closes out `SYNC_PERF_IMPROVEMENTS_SPEC.md`. The live-deployment measurement that P2-5 and the
remaining items were gated on now exists (§8.5 / §8.5.5), and it changed two decisions.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 89 | **P2-5 (`readTab`'s double full-range read) is PARKED, on evidence, not deferred for lack of it.** The spec made P2-5 depend on a *live* measurement (§4 step 7), and that measurement now argues against the change on two independent grounds. (a) **The fixed per-request tax swamps the sheet-read cost**: `revCheck` performs *zero* sheet reads and still costs a median ~2.0 s, while a single-tab `read` — which does the two full-range reads P2-5 targets — costs 2055–2601 ms across tabs of 1.6 KB / 4.9 KB / 8.7 KB. The entire per-tab sheet-read cost is therefore ~0–500 ms atop a ~2.0 s floor, and P2-5 removes at most half of *that* — unmeasurable against normal GAS variance (a 9438 ms outlier was observed on a plain `revCheck`). (b) **Its only meaningful target is a path P1-1 just removed**: the bulk read cost lives in `readAll`, which after P1-1 no longer runs on a warm launch at all — only on cold launch, login, and Force Resync. Spending a change the spec itself rates "medium — correctness trap" on a now-rare path fails the spec's own gate. Not a statement that the double read is fine; a statement that it can't be justified on performance grounds. | `SYNC_PERF_IMPROVEMENTS_SPEC.md` §0.5 item 2, §8.5.5; `apps-script-Code.gs:1380` (unchanged). |
| 90 | **P4-1's cadence stretch ships ONLY because it is user-visible — the visibility condition is binding, not advisory.** §7 Q2 had blocked P4-1 since the spec was written: relaxing the 20 s poll to 60 s trades freshness for round trips, and 20 s was the user's own choice, so the spec forbade defaulting the answer. The user approved the stretch **conditional on the slower cadence being apparent**, i.e. "make it apparent to the user that they may need to initiate a sync as the intervals are longer." Implementation: after 6 consecutive no-change polls the interval relaxes to 60 s and the sync pill becomes a tappable **"✓ Synced · Check now"**, the sidebar states the current interval, and a tap forces an immediate `revCheck` and resets the cadence; any activity (changed tab, local write, focus, visibilitychange, online) also resets it. **A silent stretch is specifically what was not approved** — if the cadence logic is ever changed, the affordance must move with it. | `js/sync.js` (`AUTO_REFRESH_IDLE_MS`/`AUTO_REFRESH_IDLE_AFTER`, `pollCadenceInfo`/`resetPollCadence`, `refreshSyncIndicator`); `test/poll-cadence.test.js` (5 tests); `docs/frontend/sync.md`; PR #73 (`1597ccf`). |
| 91 | **Only round-trip elimination is measurable against Apps Script — server-work optimisation is not, and shouldn't consume new risk budget.** The live pass measured the GAS per-request tax at **~2.0 s**, the top of the spec's 300–1500 ms estimate. Every item that removed a *round trip* produced a visible win (P1-1: warm first paint 8471 → 52.9 ms, warm no-change payload 106.2 KB → 210 B; P2-1: a 3-tab warm launch is now revCheck + exactly one `readTabs`). Every item that reduced *server-side work* vanished into the tax (P2-2 revCheck median 2100 → 1790 ms, inside variance; P2-3 single-row edit 3536 → 3535 ms; P3-1 wizard save ranges overlapping). This is direct empirical support for §4's ordering (round-trip elimination > server work > payload > main thread) and is the general form of #89's argument. **Not** grounds to revert P2-2/P2-3/P3-1 — they are shipped, low-risk, and still cut real GAS quota and execution time; grounds to stop spending review/regression risk on further server-work tuning. | `SYNC_PERF_IMPROVEMENTS_SPEC.md` §8.5 / §8.5.5; `tools/bench/make-bench-page.js`. |
| 92 | **The `readTabs` capability probe is memoized per session but deliberately NOT persisted — and it was only findable by live measurement.** P2-1's fallback (per-tab `read` when the backend predates the batched action) worked, but re-probed on *every* multi-tab pull, spending a full ~1.9 s round trip each time to re-learn the same answer. Not launch-only: the 20 s poller takes the batched path whenever 2+ tabs change, so against a not-yet-redeployed backend the waste recurred for the life of the session. Memoized in a module-scoped flag. **Not** persisted to localStorage, because the backend gains support via a manual redeploy the client cannot observe — a persisted "unsupported" verdict would strand a device on the slow path indefinitely after the redeploy landed, and a session is short enough that re-learning once per load is the cheaper error. **The offline harness structurally cannot catch this class of defect**: its "network" is an in-process function call with none of the per-request tax, so a wasted round trip costs nothing there and shows up as no failing assertion (same lesson as #86, different mechanism). | `js/api.js` (`_readTabsUnsupported`, `pullTabs`/`_pullTabsBatched`); `test/readtabs-batch.test.js` (2 tests); `docs/frontend/api.md`; PR #73 (`fde4c4f`); `SYNC_PERF_IMPROVEMENTS_SPEC.md` §8.5.3. |
| 93 | **P2-4 is implemented but UNVERIFIED, for a credentials reason — and the spec's earlier guess at why was wrong.** §8.5.4 predicted the AuditLog cap would be unmeasurable because "this sandbox's AuditLog is young, so the cap may not bite until it grows." The real reason is access: `readAll` includes `AuditLog` **only when `ctx.role === "admin"`** (`GAS:250`/`:255`), and the sandbox account is `commander@sandbox.local` — its `readAll` omits the key entirely and a direct `read&tab=AuditLog` returns `{"error":"Not authorised","code":403}`. The measured cold-launch movement (106.2 KB → 104.0 KB) is therefore ordinary dataset drift and says nothing about the cap. Recorded so nobody re-runs the pass expecting log growth to fix it. Closing it needs an **admin-role** sandbox account plus >500 AuditLog rows; procedure in the handoff doc. | `SYNC_PERF_IMPROVEMENTS_SPEC.md` §8.5.5 + §0 status table; `HANDOFF_P2-4_AUDITLOG_CAP.md`; `apps-script-Code.gs:250`/`:255`. |

## Session 2026-07-20 (late) — omit-on-status widening, Leave Days→End, token cleanup (PRs #74–#78, all merged)

Four PRs plus a recovered stash. The two decision-worthy items are the deliberate reversal of a
documented parade-state rule and the partial execution of the token-cleanup spec.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 94 | **The "omit personnel already on status" toggle now suppresses a report-sick entry when the person carries ANY unexpired OTHER status — including one starting that day or in the future — reversing the original `bpHasPriorStatus` rule that required `start < dateIso`.** The old predicate (PR #71) deliberately let a same-day/future status through, on the reasoning that "an MC handed out as the outcome of this very report-sick does NOT count as prior." The user reversed that: someone already accounted for by an unexpired status is noise on the day's sick parade regardless of when it starts. Renamed `bpHasPriorStatus`→`bpHasOtherStatus`; predicate is now "some OTHER medical row, real status (not blank/Pending/NIL), `end >= dateIso`". **Resolved edge case: a BLANK end date does NOT suppress** — `medStatusActive` treats end-less records as inactive everywhere else, so requiring a real end date keeps the two functions consistent and avoids silently hiding people. Applied to both `generateRSFormat` and `generateRSIPersonnel`, and mirrored into the GAS twin (parade-port-parity guards it). **Test-fixture trap recorded:** an "other status" record must carry a BLANK visit type — giving it `type:"RSI"/"RSO"` makes `bpSickReports` miscount it as a second report-sick entry (self-inflicted a double-count in a first draft; caught before commit). | `js/braves-parade.js` `bpHasOtherStatus` + both generators; `apps-script-Code.gs` twin; `test/rs-omit-on-status.test.js`; PRs #75 (`a9998ee`, second call site) + #78 (`c27a088`, widening). |
| 95 | **`TOKEN_CLEANUP_SPEC.md` executed PARTIALLY on purpose: `isValidAuth` + `redeemInvite` + its doPost branch deleted, but `listInvites`/`bulkInviteStatus`/`revokeInvite` KEPT.** Deleting the three editor-only invite helpers first would remove the very tools needed to clean up any leftover `invite:` ScriptProperties on the live deployment. They are inert (no new invites can be minted since PR #70 removed the generators), so keeping them costs nothing; they go in a trivial follow-up once the user runs `listInvites()`/`revokeInvite()` against production. The `test/backend.test.js` assertion that previously required `redeemInvite` to EXIST was deliberately flipped to assert ABSENCE (a decision, not a mechanical edit). Also fixed stale invite-flow comments in `api.js`/`main.js`/`state.js` and the `revokeAllAuthTokens` log string. | `apps-script-Code.gs` (deletions + kept-helpers comment); `test/backend.test.js` (flipped assertions); `js/{api,main,state}.js` comments; PR #77 (`affccd5`); `TOKEN_CLEANUP_SPEC.md`. |

## Session 2026-07-21 — conduct-wizard/parade-grid (PR #81) + parade status colours (PR #82)

The judgment call this session is #81's reversal of the single-primary grid model. #82's colours are
cosmetic (no decision), but the palette-sync invariant they introduce is recorded so it isn't silently
broken.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 96 | **The Parade State platoon grid lists EVERY concurrent status a person holds, not just the single §8 primary — reversing the one-code-per-row model.** The grid previously mapped each person to one code via `bpPrimaryForDay` (the §8 priority chain REPORTING SICK > ATT C > AL/OIL > STATUS > OTHERS). That collapsing dropped a lower-priority **toggleable** status (MC/AL·OIL/OTHERS — the only book-in-able ones per DECISIONS #83) whenever a higher-priority **non-editable** status (RS/STATUS) outranked it, so the masked status could never be booked in from the grid, and the grid disagreed with the bento section counts (which already tally people across multiple sections). `paradeClassifyPlatoon` now returns `codes[]` (ordered by new `PARADE_CODE_ORDER` = the §8 chain with MR last — deliberately distinct from `BP_SECTIONS`, whose order is tuned for message assembly), built from `bpClassifyPerson().sections`; the cell renders one control per status, stacked. Book-in stays **whole-person** (`onParadeCodeChange`→`paradeClearPerson` resolves ALL the person's records at once), so each editable code simply offers → Present. A section-less person still gets a single non-editable Present cell. | `js/parade-tab.js` `paradeClassifyPlatoon`/`renderParadePlatoon` + `PARADE_CODE_ORDER`; `test/parade-grid-multistatus.test.js`; PR #81 (`ba80806`). |
| 98 | **A single MR record no longer double-counts as a report-sick: `type==="MR"` is excluded from the `isRS` predicate, so a pending MR lists under MR ONLY — but the fix is scoped to ONE record, NOT the whole person.** An MR visit carries `status:"Pending"` with start=today while awaiting the MO; `medStatusActive` returns `today===start` for Pending, so the same row satisfied the second `isRS` clause and the person appeared under both MR and REPORTING SICK (RSI). The guard stops that one record from being counted twice. **Deliberately NOT extended to the stronger "any MR suppresses the person from every other section" rule** — spec §8 lists a person under every section their SEPARATE records place them in, so a genuine distinct RSI *and* a distinct MR on the same person still correctly list in both; only the single-record double-count was a bug. A *resolved* MR (status→MC/LD/…) is untouched: its own ATT C / STATUS clauses don't exclude `type MR`, so the ended-but-unbooked transition still works. Mirrored into the GAS twin (parade-port-parity). User was offered the stronger whole-person rule and has not requested it. | `js/braves-parade.js` `isRS`; `apps-script-Code.gs` twin; `test/parade-classifier.test.js`; PR #83 (`3fc78e7`). |
| 97 | **Parade status colours are defined ONCE per surface and MUST stay mirrored: `--ps-*` CSS vars (`:root` in `styles.css`) for the bento `.val` figures, and a literal-hex `PARADE_CODE_HEX` twin (`parade-tab.js`) for the grid pills.** The grid pills compose translucent fill/border by suffixing hex+alpha (`#RRGGBBaa`, matching the `.badge-*` convention), which `var()` names can't do inline — hence the deliberate duplication rather than a single source. The two must be kept in lockstep by hand (same rule as the `braves-parade.js` ↔ GAS port, but with no automated parity guard here). Palette: Present `#3FB950`, AL/OIL `#2C8A4B`, MC `#F85149`, RS `#C4611C`, STATUS `#E3B341`, OTHERS `#B04A5A`, MR `#79C0FF` — user-approved before build; MC↔OTHERS swapped from the first request and RS darkened for contrast against STATUS yellow. Colours applied to both the bento header and every grid control. | `styles.css` `:root --ps-*` + `.ps-badge`; `js/parade-tab.js` `PARADE_CODE_HEX` + `renderParadeBento`/`renderParadePlatoon`; PR #82 (`feat/parade-status-colours`, MERGED `fbb4bf0`). |

## Session 2026-07-22 — parade UI polish + HA / registry / scroll fixes (PR #84)

Five independent changes; the one decision-worthy call is the *scope* of the HA lapse-reset (which
surfaces + which stays raw) and the adjudication that a plan-authored unit test asserted the wrong value.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 100 | **Adversarial-review follow-ups on #84 + the latent PR #80 finding, fixed together in `04a8037`.** (a) **Empty-recruit appointment guard:** #84's new `personSearchBox` recruit picker replaced an always-valid dropdown with a hidden input that clears on every keystroke and can't be HTML-`required`, so a typed-but-unpicked name saved an appointment with no recruit — `submitAppointment` now guards `if (!d4)`, matching `submitMedical`/`submitLeave`. (b) **HA lazy re-qual scan:** `currentWindowPeriods` (two O(active-days²) scans) was computed for every recruit though only Lapsed rows read it — moved into the Lapsed branch; `renderHA`'s duplicated bar ternary folded into one `barVal` helper. (c) **PR #80 conduct-seq collision (the low-severity latent bug flagged on #80):** the write side was chosen over the read side — a manually-classed conduct can no longer persist `classSeq 0` (blank/`<1` snaps to the next free ordinal via the new `_nextClassSeq` helper whenever a className is set), so `conductClassSeq` never falls back to the possibly-duplicated `parseConductSeries(name).num` for classed conducts; unclassed conducts still store 0 (name-parse mode) unchanged. This keeps `conductProgress`'s `num`-keyed attended/missed distinct so a real miss is no longer silently merged out of the Class Progression list. | `js/forms.js` (`submitAppointment`, `setConductClassSeq`, `_nextClassSeq`); `js/helpers.js` (`computeHA`); `js/render.js` (`renderHA` `barVal`); `test/conduct-class-seq.test.js` (4 cases); 408 passed. PR #84 `04a8037`; PR #80 comment issuecomment-5035078659. |
| 99 | **HA bars reset to the current re-qualification window ONLY when `overallStatus === "Lapsed"`, and only on the roster progress bars — the Single-column sort tiebreak and the "Single HA Progress" trend chart deliberately still read raw `ha.single.periods`.** `runHAStateMachine` returns `periods = firstCompletionPeriods` (the target) once a track has ever Completed, because completion is a historical fact; after a lapse that left the bar pinned full. `computeHA` now also exposes a presentational `currentWindowPeriods` per track — the best still-open window as of today (`haBestOpenWindowPeriods` scans every active start with `simulateFrom`, taking the max `outcome==="open"` window), which naturally resets to 0 after a break longer than the track's `maxBreak`. `renderHA` feeds the bars `currentWindowPeriods` when Lapsed, `.periods` otherwise. **Scope was held to the bars per the spec** (design doc §5); extending the reset to the sort key and the trend chart is logged as follow-up **M1**, not done — so on a lapsed row the reset bar is currently inconsistent with that view's sort order + chart. Currency/lapse *logic* (`computeHACurrency`, `overallStatus`) is untouched — this is presentational. **Plan-test correction:** the plan's original second unit test asserted `currentWindowPeriods === 2` for a "2 active days then a 3-day break, no later activity" scenario; the correct algorithm yields **0** (the window breaches before `endIso` with nothing later to open a fresh one). Controller adjudicated the algorithm correct and the test wrong, and replaced it with a no-carry-over test (2 active → 4-day break → fresh 2 active ⇒ expected **2**, proving the post-break window does not inherit the pre-break count); the reviewer independently hand-traced `simulateFrom` and confirmed. | `js/helpers.js` `haBestOpenWindowPeriods` + `computeHA`; `js/render.js` `renderHA`; `test/ha.test.js` (2 tests); design `docs/superpowers/specs/2026-07-22-parade-ui-and-fixes-design.md` §5; PR #84 (`4e0dafa`). |

## Session 2026-07-23 — Medical Appointment type, unscoped search, 1700 flip, archive scope/RBAC/display (PR #86, merged)

Four independent items requested together. The decision-worthy calls were the MA data-model placement,
the archive-scope labelling model, and relaxing the archive RBAC boundary to commanders.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 101 | **Medical Appointment (MA) is a Medical-tab row (`type:"MA"`), not a new tab or a reuse of the legacy `Appointments` tab.** MA needs the same status/range fields as a report-sick entry and shares the form; storing it as a Medical row lets the §8 classifier reach it in the same `medRows` loop and lets one person legitimately hold both a status code *and* the appointment code on a day (the grid already supports multiple codes). In/out-of-camp is carried by the **existing** `outOfCamp` checkbox (unchecked → `OTHERS (IN CAMP)`, checked → `OTHERS (NOT IN CAMP)`), matching the user's "retain the Out-of-camp checkbox" instruction, so no new UI concept. Date + time became **two separate fields in one row** (per the user), and `time` doubles as the optional RSI/RSO report-sick time with lazy current-HHMM autofill that never clobbers a typed value. Two new Medical columns (`time`, `outOfCamp`); `time` added to `WRITE_TEXT_COLS_BY_TAB.Medical` (Sheets would coerce `"0930"→930`); every row carries both keys via `normalizeMedical` so `writeTab`'s `Object.keys(data[0])` header derivation can't strip them; classifier mirrored into the GAS port (parity-guarded); `bravesMigrateSchema()` adds the columns. Legacy `Appointments` rows still classify + render, and the Dashboard widget merges both sources. | `js/forms.js`, `js/braves-parade.js` + `apps-script-Code.gs` port, `js/state.js`, `js/render.js`; `test/parade-classifier.test.js` (+4), `test/parade-port-parity.test.js` (+1). PR #86. |
| 102 | **Parade-state archives are commander-visible + commander-writable; only archive *delete* stays admin-only.** The user asked that copying a platoon parade state archive for commanders too, and that platoon copies archive with their real scope. Backend read gates for `ParadeArchive`/`SickArchive` relaxed from admin to `canWrite` (AuditLog stays admin-only); frontend guards moved `isAdminRole()`→`canWrite()` via a new `.commander-plus` class + `role-commander` body class; delete button gated + backend re-checks admin. Snapshot now records the real `_paradeScope` (`company`/`platoon:<CODE>`) instead of the hardcoded `scope:"company"` that caused the "saves PLT 3 only" mislabelling, surfaced by a new Archive scope-filter dropdown + per-row chip. Warm-cache display gap (incremental `autoSyncOnLaunch` never pulls the privileged archive tabs) fixed by a one-shot lazy `readTabs` fetch on first Archive-tab open when nothing is cached. | `apps-script-Code.gs` (read gates), `js/api.js` (`fetchArchives`, pull-gate), `js/render.js`, `js/parade-tab.js`, `styles.css`, `index.html`. PR #86. |

## Session 2026-07-27/28 — the 12-item TODO batch across five stacked branches (PRs #89–#93) + the GAS read-boundary fix (#94), all merged

Twelve externally-supplied TODO items (Fixes 14–18, Features 20–30, Chore 7) planned as five stacked
branches and executed inline. The decision-worthy calls were mostly about *what not to change*: which
subsystems the batch deliberately left alone, which corrections it refused to make silently, and which
divergences between two numbers on screen are features rather than bugs. The last entry records a bug
the batch shipped and the verification pass caught.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 103 | **The parade book-in `<select>` is shrunk with `transform: scale()`, never `zoom`.** The control must stay visually the size of the `.ps-badge` pills beside it while keeping `font-size:16px`, because a focusable control under 16px makes iOS auto-zoom the whole page on tap. `zoom` was rejected outright: it shrinks the **computed** font-size, which is precisely the value iOS reads, so it would silently reintroduce the bug the 16px exists to prevent. Two consequences were measured rather than assumed — padding and border scale too (horizontal padding is therefore expressed in `em` of the select's own 16px font at `badgePx/11`, landing at literally 9px the far side of the scale), and `transform` does **not** change layout (the element still reserves its untransformed box, so a negative `margin-bottom` reclaims exactly the 31.25% the scale removed, stated in `em` of the select rather than the wrapper — an earlier version under-reclaimed for exactly that reason). Height is **pinned**, not derived from line-height + border, because Chrome snaps sub-pixel border widths to whole pixels and a derived height lands ~1px short and drifts per browser. | `styles.css`, `js/parade-tab.js`. PR #89 (`f2040ae`). |
| 104 | **The Route March tab is removed from the UI while its DATA layer is left completely intact.** `STATE.rm` still loads, normalizes, syncs and full-pushes; the `RouteMarch` sheet tab is unchanged; the Settings backup still exports it as JSON and CSV. Re-adding the tab later is therefore a pure frontend change with **no migration** — the reason for keeping the plumbing rather than doing a clean removal. Two consequences handled: the person card loses its Route March block and "RMs" count (so nothing in the UI reads `STATE.rm` any more), and because `STATE.nav` is cached in localStorage, anyone whose last-viewed tab was Route March would return to a nav value the render switch no longer handles — hitting `default:` and painting an empty pane with no tab highlighted — so `render()` redirects that one stale value to the dashboard. `importRM` carried the same missing-`autoSync` bug as `importIPPT` (see #105) and was **deleted rather than fixed**, since the tab it fed no longer exists. | `js/render.js`, `js/forms.js`, `index.html`. PR #90 (`17e59b4`). |
| 105 | **The IPPT CSV import gains an upsert key of `4D + Attempt`; a blank Attempt always appends.** The underlying bug was that `importIPPT` pushed rows into `STATE` and called `saveLocal()` but never `autoSync` — imported rows lived only in localStorage, **rendered** (which is exactly why the import read as working), and were then silently destroyed by the next full pull, since `API.pullAll` replaces `STATE.ippt` with the sheet's contents. Every imported row now goes through `autoSync`, the single write chokepoint, as its own OCC-guarded upsert in the per-tab FIFO queue. A blank Attempt **cannot** serve as a key because `colNum` yields `0` for blank, so every blank would collide with every other blank — those append instead. The row-builders were split out as `ipptUpsertRows`/`socUpsertRows` so they can be tested without a file input or PapaParse, and the tests load the **real** `helpers.js` rather than stubbing `col`/`colNum`, because `colNum`'s `+(col(...)) \|\| 0` is load-bearing for the blank-Attempt case — a hand-written stub returning `""` would have tested behaviour production does not have. | `js/forms.js`; `test/csv-importers.test.js`. PR #90 (`990ed1c`). |
| 106 | **SOC's imported `time` is a DURATION in `MM:SS`, not a clock time**, matching the sheet schema and `socDurationParts` so imported and hand-entered SOCs render identically. A 4D not on the roster is still imported but is **named** in the completion alert (not counted), so a typo is visible rather than silently joining to nobody. Both the IPPT and SOC tabs also gained the schema card the Polar tab already had, documenting the two things a user cannot guess: Score is optional and auto-derived from the stations plus roster age, and SOC Time is `MM:SS`. The accepted column set was previously discoverable **only** by triggering the missing-column alert. | `js/forms.js`, `js/render.js`. PR #90 (`990ed1c`, `e7362a4`). |
| 107 | **The parade lookahead LISTS and COUNTS future-dated absences but must never move `CURRENT STRENGTH` — and the resulting divergence is the feature, not a bug to reconcile.** `notInCamp` feeds `bpStrength`, and a person present today is present today whatever is booked for next week, so every branch guards its `notInCamp` assignment on `!upcoming`. The consequence is that the away sections visibly stop reconciling with `total − current`; rather than hide that, a **banner** says so, because a commander who finds the arithmetic broken quietly stops trusting the number. The banner renders only when the current horizon actually surfaced something, and **only into the host element, never into the textarea**, so it cannot reach an archived snapshot. The classifier option is **OFF by default and that default is load-bearing**: the same `bpClassifyPerson` drives the Status Board grid and the Dashboard tables, which must stay strictly today-only — only the parade state passes it. Horizon state is module-level and session-scoped like `_paradeDate`/`_paradeType`, deliberately **not persisted**, so a commander who widened it once to plan the month does not silently keep a month-wide parade state the next morning. Four interactions needed handling beyond the date predicates: upcoming rows get their own **supersede pool** (a future MC always ends after today's, so a shared pool would delete the MC the person is actually on); the MC+1/MC+2 recovery tail keys off a separate `hasCurrentAttC` flag (since `out.attC` can now hold a future entry); the multi-status STATUS collapse carries the upcoming flag through the fold, or the banner undercounts; and book-in for an upcoming record is judged at the record's **own** start date. Legacy `Appointments`-tab rows look ahead too, though the plan enumerated only the Medical-form branches — both stores are still written, so honouring one and not the other would surface next week's appointment depending purely on which form booked it. | `js/braves-parade.js` + the `apps-script-Code.gs` port; `js/parade-tab.js`; `test/parade-lookahead.test.js`, `test/parade-port-parity.test.js`. PR #91 (`2411a01`, `68906cb`). |
| 108 | **MR timing is a HARD replacement of `mrTiming` by the shared HHMM `time` field — not a read-time fallback — but the `mrTiming` COLUMN stays, and newly-written rows still emit it as `""`.** MR carried its own free-text column because spec §6 allows "PM", which an HHMM column cannot hold; Feature 30.1 needs **one** time source across all four visit types so the status suffix can read a single field without knowing which kind of visit produced it. The blank-key emission is not cosmetic: `writeTab` derives the sheet's headers from `Object.keys(data[0])`, so dropping the key from newly-written rows would silently strip the column from the whole pushed Medical sheet and take every historical value with it — **including the ones the migration deliberately could not carry across**. `medTypeBadge` now renders `visitSuffix()` output so the type pill and the status suffix cannot disagree, keeping exactly one legacy path: an MR with no `time` but an unparsed `mrTiming` still shows it (`MR PM`), that string being the only surviving record of when the review was. The **parade message deliberately does not** — it needs one canonical source, and a half-migrated row reads better with no timing than with a `(PM)` no other surface agrees with. | `js/forms.js`, `js/helpers.js`, `js/braves-parade.js` + GAS port; `test/mr-format.test.js`, `test/parade-port-parity.test.js`. PR #91 (`b1c1547`). |
| 109 | **`bravesMigrateMrTiming()` is deliberately LOSSY, and the per-value drop report is what makes that acceptable — so the report is not optional.** Values that parse as a time (`1400`, `930`, `14:00`) are copied and zero-padded; anything else (`PM`, `after lunch`) cannot be represented as HHMM and is dropped, with **every dropped value logged with its 4D and date**. Idempotent by construction: a row already carrying a `time` is skipped, and an existing `time` is never overwritten by a disagreeing `mrTiming`, so a second run is a no-op. A sheet missing any of `type`/`mrTiming`/`time` **aborts** with a pointer to `bravesMigrateSchema()` rather than half-migrating. Two departures from the plan's draft, both so it is genuinely testable rather than only inspectable: `getActiveSpreadsheet()` instead of `getActive()` (matching every other function in the file) and `setValues([[v]])` instead of `setValue()`; the Logger mock records instead of discarding, so the tests can assert the report contents. It runs by hand against a live sheet with no CI path that would ever execute it — a mistake would otherwise be found on real data. **Run 2026-07-28 against both the live deployment and the sandbox: no dropped values, no issues.** | `apps-script-Code.gs` (`bravesMigrateMrTiming`); `test/mr-timing-migration.test.js`. PR #91 (`04d5d29`). |
| 110 | **The visit-type suffix attaches to whatever pill the person ACTUALLY holds, not to a fixed pill** — and the wizard gets only the bare time. The classifier gates `REPORTING SICK` on the MO outcome still being pending, so the moment the MO issues LD the person drops off `REPORTING SICK` entirely and holds only a STATUS pill; there is no RS pill left to hang `RSI 0830` on, which is exactly the headline case the feature exists for. Three things the plan's uniform rule got wrong, all caught in the browser: the **wizard** needed only the TIME (`rebuildLogConductStatus` already folds the day's visit types into `statusTag`, so emitting the full TYPE+time printed it twice — `Pending + RSI + RSI 0830`), so it appends the bare time when the tag already ends with that type and names the type otherwise, so a multi-visit day cannot attach a time to the wrong visit; the **parade grid** must target the first CURRENT pill, not `codes[0]`, because an upcoming MC outranks the LD the person is really on today; and an **upcoming pill never carries it**, since today's visit time on a window that has not started reads as "the MC starting Thursday began at 0830". One shared builder (`visitSuffix`/`visitForDay`) feeds all three surfaces precisely so they cannot drift on which visits qualify or how a blank time renders. | `js/helpers.js`; `js/render.js`, `js/parade-tab.js`, `js/forms.js`; `test/visit-suffix.test.js`, `test/render-wiring.test.js`. PR #91 (`99d9ad2`). |
| 111 | **Visit grouping is DISPLAY-ONLY — no schema, classifier or GAS change — but Edit acts on the visit while Delete acts on the single status.** The sibling rows of one multi-status visit already shared a `visitId` (since spec §6); only the views failed to relate them, so one consultation read as two or three separate report-sicks. `groupByVisit()` is keyed on **`d4 + visitId`**, not `visitId` alone, because id generators are reused across devices and two people must never merge; `visitId` is stringified because it is not in `WRITE_TEXT_COLS_BY_TAB`, so a numeric-looking id returns from the sheet as a `Number` while its in-memory sibling is still a `String`. The **Status Board is deliberately excluded** — it is a per-person-per-day grid where the individual statuses are the point — and the Dashboard Non-Active table needed nothing, since it already rendered one row per PERSON with statuses stacked (leaving it alone also keeps the Feature 30.1 visit suffix where it was put). The Edit/Delete split required more than wiring buttons: `openMedicalForm` only ever loaded one record, so a grouped row's single Edit opened one status and stranded the rest — and since date/reason/location/type are per-visit and written to every sibling, saving moved the date on the primary while the sibling silently kept the old one, leaving two rows in one group disagreeing about the day they happened. The form now loads every sibling as a pre-filled extra status, and `submitMedical` deletes the siblings its new rows replace so a re-save cannot duplicate them. Stacked cells force one line per status **only inside genuinely multi-status groups**: the four stacked columns size independently, so a wrapped `EXCUSE RMJ` in one column drifted every line below it out of register and paired the wrong status with the wrong end date — but applying it to every row cost ~120px of table width and pushed the action column behind the horizontal scroll for no benefit to a group of one. | `js/helpers.js` (`groupByVisit`), `js/render.js`, `js/forms.js`; `test/visit-grouping.test.js`. PR #92 (`db08cdf`). |
| 112 | **The absentee paste matches STRICTLY against the roster — `123` and `C0123` are NOT normalized to `0123` — and the paste is authoritative over auto-listed entries.** `padD4()` is applied liberally everywhere else and that is right for data arriving from the sheet, but this is **bulk human input**, where a silently helpful correction quietly lands the wrong person in the absent list and nobody sees it happen. Unmatched tokens are listed **individually** in the confirm panel ("3 unmatched" says something is wrong but not which line to fix) and skipped rather than blocking the rest. Separators are whitespace (tabs included, since a spreadsheet column arrives tab-separated) and commas; anything else stays part of the token, so `0123;0124` reports as one bad entry rather than being split into two ids the user never typed. A 4D already sitting in another bucket — in practice auto-listed under Status Personnel — is **released and moved**, because skipping it would make a deliberate correction look like it did nothing; but **Status Personnel is the one destination that cannot create a row**, since that checklist is derived from who actually holds a status that day and fabricating an entry would put someone on the parade state under a status they were never given. Nothing is applied without Preview: Apply lives inside the confirm panel and renders only when at least one id matched, so a paste that is entirely typos cannot be confirmed into a no-op the user reads as success, and it **re-parses the textarea** rather than trusting the preview, so an edit made after previewing cannot apply a stale match list. | `js/forms.js`; `test/wizard-paste.test.js`. PR #92 (`50c915a`). |
| 113 | **`Pending` leads the medical status dropdown by moving the whole "Awaiting MO" GROUP to the front, and the change is display-only — `medSeverityRank` is deliberately untouched.** Pending is what a commander picks most often (the recruit has reported sick and the MO has not ruled yet) but sat fourth, below every outcome the commander is not yet in a position to know. The group moves whole rather than hoisting Pending into "Severe (away from camp)" under a heading that would contradict it. Scoped to `MED_STATUS_GROUPS` alone: `MED_STATUSES` derives from that array but is used only as a membership `Set`, so the reorder cannot leak. `medSeverityRank` decides `statuses[0]`, which splits the Dashboard's Non-Active from Recovering and orders every badge stack — promoting Pending there would silently reclassify people across several views; `forms.js`'s `statusOrder` (the report-sick analytics bars) is likewise unchanged. The tests load `helpers.js` for real so they assert the order the form will **render**, not the order the source is written in, and pin `medSeverityRank` so a future edit cannot quietly promote Pending there either. | `js/helpers.js`; `test/status-enum.test.js`. PR #92 (`962d56b`). |
| 114 | **The quick-log trigger gets its OWN narrow column in the parade grid — never a second control inside the Attendance Code cell.** That cell's Mark-Present select is its sole action by design, so an incidental tap while swipe-scrolling the grid on a phone cannot fire something else; a second control there would give that up. The Dashboard has no row context, so it gets a single header button and both forms open blank — each already carries a person search box, which is why there is no separate person-picker step. Gated on `canWrite()`, with viewers seeing **no trigger at all** rather than a disabled one, and the `<th>` and the empty-state colspan gated on the same call so the column count moves as one (gating only the `<td>` would leave a stray header and misalign every row). `openQuickLogMenu` **re-checks `canWrite()` itself** — the callers only hide the button, and a hidden button is not a permission check. Enabling a prefill on `openLeaveForm` meant introducing an explicit `isEdit`, because seven "is this an edit" tests inside it keyed off the truthiness of `e`; with a prefill now flowing into `e`, a brand-new leave row would otherwise have lost its bulk scope selector and multi-person picker, shown the edit hint, stamped a junk entry id and labelled its submit button "Save". | `js/render.js`, `js/parade-tab.js`, `js/forms.js`; `test/render-wiring.test.js`. PR #92 (`aa75cc5`). |
| 115 | **The Dashboard reorder is a PURE re-order, and the `#dash-charts` div and its `chartGateMarkup(...)` gate must travel together.** A duty commander opens the page to find out who is missing, not to read a chart, so Non-Active, Recovering and Out-today move directly under Appointments with the charts and reference cards below. No card's contents, columns or behaviour changed. The gate is the button that un-hides the div, so separating them would leave a reveal control that reveals nothing — hence a test asserting they stay adjacent, alongside one asserting the three out-tables stay above the charts. | `js/render.js`; `test/render-wiring.test.js`. PR #93 (`494bbf5`). |
| 116 | **The status doughnut is replaced by a 14-day trend, and its four exclusions are decisions with tests, not omissions.** The doughnut answered "what does today look like?", which the Non-Active table directly above it now answers better and by name. **`Active` is omitted** — ~100 against single digits would flatten every other line into the axis. **Ghost recovery tags (`MC+1`/`MC+2`/`LD+1`/`LD+2`) are omitted entirely, NOT folded into MC/LD** — they are a recovery signal rather than a status, and counting them double-counts one episode. **All `Excuse *` collapse into one `Excuse` series** — there are twenty-odd and individually they are noise. **The top-8 cap ranks by PEAK, not total**, remainder folded into `Other`, so a one-day spike still earns its line; a cap exists at all because statuses are user-extensible via "＋ New custom status…". Registered on the same `STATE.charts.status` key the doughnut used, so `render()`'s destroy-before-dispatch sweep is unchanged and the instance cannot leak. The 14× recomputation of `currentMedicalEffectiveAll` was the batch's one real performance risk and was measured rather than assumed: 0.57 ms at 21 medical rows, 2.1 / 6.9 / 12.8 ms at 200 / 1 000 / 3 000 — roster-bounded, so sub-linear. It stays inside `#dash-charts` and inherits the defer gate regardless, as cheap insurance. | `js/render.js`, `js/helpers.js` (`statusTrendSeries`); `test/status-trend.test.js` (11 cases). PR #93 (`be21956`). |
| 117 | **The Dashboard parade card is a second VIEW onto the Parade tab's machinery, not a second implementation — which required making two shared helpers genuinely reusable.** Same `generateBravesParadeState`, same `paradeCopyString`, same `archiveParadeSnapshot` including its `paradeSnapshotDup` double-archive guard, and it carries the `[UPCOMING]` banner. Scope **follows the topbar platoon filter** and has no dropdown of its own (a section or role filter alone still means the company block, because the §8 message has no narrower unit than a platoon); its own controls are Date, FP/LP, Time and Lookahead. Not role-gated — a viewer can read and copy, and only the archive side effect is commander+admin, which `archiveParadeSnapshot` already enforces itself. Neither helper fix was in the plan: **`archiveParadeSnapshot` read parade-tab module state directly**, so a second caller with its own date and time would have written rows stamped with whatever the **Parade tab** happened to be showing — wrong date/slot, and it defeats `paradeSnapshotDup`, which keys on date+slot+type+message — so it now takes an optional `meta` defaulting to the tab's own state, leaving every pre-existing caller unchanged; and **`paradeCopyString`'s clipboard-blocked fallback was hardcoded to `getElementById("parade-text")`**, which does not exist on the Dashboard, so it would have alerted "text is selected" having selected nothing. | `js/render.js`, `js/parade-tab.js`; `test/render-wiring.test.js`. PR #93 (`0618ea1`). |
| 118 | **`bravesNormalizeMedical_` is a WHITELIST, and the fix's real guard is structural key-set parity between the two normalizers rather than another behavioural case.** The ported classifier reads the row that function returns, never the raw sheet row, so a column missing from the whitelist is invisible to the server-side parade state no matter how correctly the classifier handles it. `time` (#91) and `outOfCamp` (#86) were both added to the classifier in **both** copies but never to this normalizer, so both features were dead **on the server side only**: MR lines lost their timing (`knee review (1400)` on the client, plain `knee review` from the Telegram bot and the cron archiver), and every MA classified as `OTHERS (IN CAMP)` regardless of `outOfCamp`, so an out-of-camp appointment never left `CURRENT STRENGTH`. Running `bravesMigrateMrTiming()` does **not** help — the values reach the sheet correctly and are then discarded one layer above the code that wants them. The `outOfCamp` half is the worse of the two: a parade state counting someone present who is at a clinic is more dangerous than one that omits them, because nobody goes looking for the person the message says is there. Legacy standalone-`Appointments` rows were never affected (`bravesPadD4OnLayer_` copies every key); only the Medical-form MA path. **`parade-port-parity.test.js` could not catch this** — it feeds fixtures straight into `bpClassifyPerson` on both sides, comparing two classifiers that genuinely agree while never exercising either read boundary; the drift was in the layer *feeding* the port. Hence the key-set assertion, which catches the next dropped column in either direction without depending on anyone remembering the file exists. Proven live on the deployed sandbox **before** fixing (probe MR + out-of-camp MA → `archiveNow` with no client text → `knee review`, `(OTHERS (IN CAMP))`, `119/119`), then the fixed port matched the client on all three lines; probe rows deleted afterwards. **Requires a GAS REDEPLOY to take effect** — pasting into the editor is not enough, the web app and triggers serve the deployed version. | `apps-script-Code.gs` (`bravesNormalizeMedical_`); `test/gas-medical-normalizer.test.js` (9 cases; suite 573 → 582). PR #94 (`868d538`). |
| 119 | **PR #93 merged with a known 🔴 review finding unfixed — recorded here so it is not rediscovered as a mystery.** The adversarial `/code-review` over #83–#93 (report: `CODE_REVIEW_2026-07-28_PR83-93.md`, repo root, gitignored) produced **6 CONFIRMED findings** and recommended #93 not merge before finding 2 was fixed; #93 merged at 2026-07-27T22:23Z regardless, so that defect is now in `master`: the Dashboard parade **Time** input's `oninput` triggers a full `render()`, rebuilding `#content` and killing focus on every keystroke, making the field impossible to type into (the Parade tab escapes this only because its toolbar sits outside `#parade-body`). **All 6 findings remain open** — 🔴 the paste-absentees modal destroys the in-progress conduct wizard on dismiss (one shared `#modal-overlay`, no stack, no Cancel); 🔴 the Time input above; 🟠 Fix1C's archive lazy-fetch is suppressed by `archiveParadeSnapshot`'s own optimistic row (the guard wants BOTH archives empty), so copy-then-open-Archive hides every server-side snapshot for the session; 🟠 the paste preview overstates the match count for the Status Personnel destination; 🟠 a multi-status MA visit duplicates in Upcoming Appointments and a booked-in MA never clears; 🟡 the IPPT/SOC CSV upsert key is not applied **within** a single import batch. The parade lookahead (#91) — the batch's largest logic change — was checked and found clean, as were `apps-script-Code.gs`, `calc.js`, `state.js` and `styles.css`. | `CODE_REVIEW_2026-07-28_PR83-93.md`; `SESSION_CONTEXT.md` checkpoint line. PRs #92, #93. |

| 120 | **All six #83–#93 review findings fixed in ONE branch, because #93 and #94 merged first and put every one of them on `master`.** The review's own plan was "fix finding 2 on #93's branch before it merges, the rest as a follow-up" — overtaken by events, so the split lost its point. Four calls worth recording. **(a) The single-overlay problem is solved with an `onClose` HOOK on `openModal`, not a modal stack.** A stack is the textbook answer and was rejected: `index.html` has one `#modal-overlay` and one `#modal-body`, every one of the ~30 `openModal` call sites assumes it owns them, and `closeModal` is called from dozens of submit handlers that mean "I am done" rather than "pop one level" — a stack would change what all of them do. The hook changes behaviour only for the one modal that installs it. It is read-and-cleared **before** it runs, since the hook re-opens a modal and one still installed at that moment would fire again on the next close, and it is reset on **every** `openModal`, so a modal opened normally can never inherit a stale hook. **(b) Only `setDashParadeTime` moved off `render()`.** The other three Dashboard parade setters fire on commit (change/click) and re-render their own control state — notably the Lookahead pill highlight — which a body-only refresh would leave stale; `oninput` is the only binding where a full rebuild lands mid-typing. This restores the toolbar/`#parade-body` separation the Parade tab has had all along (DECISIONS #117 ported the generator but not that split), which is why the tab never had the bug. **(c) The archive lazy-fetch guard is now `_archiveFetched` ALONE.** Requiring both archives empty was never a valid stand-in for "already fetched": neither array is in `saveLocal`'s payload, so they are empty on every warm launch regardless, while `archiveParadeSnapshot`'s optimistic prepend makes `paradeArchive` non-empty the moment anyone copies a parade state — the exact action a commander takes just before opening the Archive. Accepted residual: the fetch replaces `STATE.paradeArchive` wholesale, so a snapshot copied seconds earlier can briefly vanish if its queued append has not landed; that is pre-existing behaviour on any full pull and self-corrects, and merging local rows into the fetched set was out of scope. **(d) The paste's untickable 4Ds are now left STRICTLY alone.** DECISIONS #112 established that the paste is authoritative and that Status Personnel cannot create a row; what it did not settle is what happens to a pasted 4D holding no status that day. Releasing them from Fallout/Report Sick and recording them as participating was the worst of both — the confirm panel had already promised the user otherwise. `splitPastedForDest` is now the single source of truth for match-vs-will-happen, shared by preview and apply precisely so the panel cannot promise 20 and deliver 8; the ones it cannot tick are **named**, for the same reason unmatched tokens are (so they can be re-pasted into Fallout). | `js/forms.js`, `js/render.js`; `test/render-wiring.test.js`, `test/wizard-paste.test.js`. PR #95 (`54aa441`). |
| 121 | **The status trend's runaway height is fixed with a fixed-height `.chart-box` WRAPPER, not by dropping `maintainAspectRatio: false` — and the wrapper is guarded by a test because it reads as a redundant div.** Both fixes stop the loop, so the choice needed a reason: `styles.css` already carries a comment from the last time this exact mechanism bit (the same recompute was breaking the modal's `overflow:auto` scroll), and the remedy established then was an explicit wrapper height. Every other `maintainAspectRatio: false` chart in the codebase already sits in a `.chart-box`; this one was the **only** exception, so wrapping it restores the existing convention rather than introducing a second way of doing it. Dropping the option instead would have made height a function of width, which on a wide screen produces a very tall chart and makes the two `grid-2` cards disagree. **`.chart-box.trend` is a new size rather than a reuse of `.tall`** (14 x-points plus a right-hand legend of up to 8 series, filling a full grid cell rather than sitting in a modal), and its **mobile override is stated explicitly rather than left to inherit**: `.chart-box.trend` (0,2,0) outranks the `.chart-box { height: 180px }` reset inside that media block (0,1,0), so omitting it would silently carry the desktop 260px to mobile as an inherited value rather than a chosen one. The **test guards both halves of the contract** — the wrapper, and that `buildStatusTrendChart` still sets `maintainAspectRatio: false` — because the fixed height is chosen *on the assumption* that Chart.js is filling it, so removing the option would make 260px the wrong number. A comment would not have survived an "unwrap the redundant div" cleanup. Adding it cost one existing assertion: the gate-adjacency test allows 400 chars between `id="dash-charts"` and `chartGateMarkup(...)`, and an explanatory HTML comment pushed the markup past it — the comment was dropped rather than the bound widened, since loosening a guard to fit a comment trades real coverage for prose that the new test already replaces. **Verification limit:** not reproduced in a browser — the preview pane in that environment reports a 0×0 viewport, so it cannot lay out and a harness built against the real `styles.css` and vendored Chart.js measured a stable height for the *broken* config purely because nothing was being laid out; that was **not** treated as a negative control. The diagnosis rests on code reasoning plus the prior documented occurrence. | `js/render.js`, `styles.css`; `test/render-wiring.test.js`. PR #96 (`ae2d335`). |

## Session 2026-07-28 (late) — rank prefixes on generated messages

Requirements were gathered first (`docs/superpowers/specs/2026-07-28-rank-fix-and-features-32-35-design.md`);
this entry records the build of the fix half. The one-line request — "message formats do not prepend
ranks" — turned out to describe one of three generators, and the one it described was behaving *as
specified*, so the change is a spec override rather than a bug fix.

| # | Decision | Rationale / Recorded in |
|---|----------|-------------------------|
| 122 | **The sick message's rank-less R/N is overridden, and `sickRN` now DELEGATES to `bravesParadeRN` rather than carrying a second copy.** Investigation found two of the three generators already prepended ranks — `bravesParadeRN` (§9) and `mrRankName` (MR) — and that `sickRN`'s omission was **specified behaviour**, not a defect: `BRAVES_ADAPTATION_SPEC.md` §10 said "**no rank prefix** — use a dedicated `sickRN()` helper", with a cross-reference in §7. Both were amended in the same commit, because leaving the code and the spec disagreeing guarantees a future session "fixes" it back. The user's reason for the override is that the two messages go out minutes apart and named the same person differently. **Once the rank is added the two helpers are behaviourally identical**, so keeping two bodies would have created a drift surface for no benefit — the name is retained (both this file and the GAS port call it, and §9/§10 are separate spec surfaces that have diverged before) but the body is one line. **A blank roster rank defaults to `REC`, for non-commanders only.** The rank column is left blank for most recruits, so the blank case — not the populated one — is what production actually renders; commanders are deliberately excluded, since a blank rank there means the row is incomplete and calling a sergeant `REC` is wrong rather than merely terse. The default lives in one shared `bpDisplayRank(r)` and is used by **all three** generators, `mrRankName` included, so the same person cannot read as `REC` in one message and bare in another — this is the one place the three deliberately-separate name builders were made to agree. Casing is untouched (`REC Martin Tan B1411`, not uppercased) so archived snapshots differ from new ones in rank only. **Test-loading consequence, recorded because it looks like scope creep:** `test/mr-format.test.js` loads `js/forms.js` alone against hand-written stubs, so sharing the helper broke it. It now loads the **real** `js/braves-parade.js` alongside — stubbing `bpDisplayRank` there would let the MR message drift from the other two, which is the exact failure sharing the helper exists to prevent. `test/parade-port-parity.test.js` gained a blank-rank fixture: every pre-existing fixture carries a rank, so none of them would have noticed if only one of the two copies grew the default. **A GAS redeploy is required** before the Telegram bot and the cron archiver emit ranks — the file edit alone changes nothing in production. | `js/braves-parade.js`, `apps-script-Code.gs`, `js/forms.js`, `MD_Docs/BRAVES_ADAPTATION_SPEC.md`; `test/parade-rn.test.js`, `test/parade-port-parity.test.js`, `test/mr-format.test.js`. |

| 123 | **Enter-to-save on the medical form goes through `requestSubmit()`, and the person card's status is a SIBLING helper rather than a widened `rosterDisplayStatus`.** Two small features, three calls worth keeping. **(a) The medical form was already a real `<form>` with a submit button, so Enter from inside a field already saved it** — the reported gap was Enter with focus on `<body>` (the user clicked away, or picked a recruit from the search box and the field blurred), where a `<form>` ignores Enter entirely. So the fix is one overlay-level listener for the nothing-focused case, not a rewrite; the existing implicit submission is left to the browser, and the handler explicitly bails when focus is already inside the form so it cannot double-fire or step on `personSearchEnter`'s pick-the-top-match. **(b) `requestSubmit()`, not `submitMedical()`.** The conduct wizard calls its saver directly, which looks like the precedent to copy — but it is a plain `<div>` with no `required` attributes to honour, whereas this form has several (`f-date`, `f-reason`, `f-status`); calling the saver directly would skip validation and half-save. Verified in a browser: an unfilled form refuses to submit and reports `checkValidity() === false`, a filled one saves on Enter from `<body>`. **(c) The card lists EVERY concurrent status via a new `rosterDisplayStatusAll`, leaving `rosterDisplayStatus`'s single-badge contract untouched** for the roster list, which renders one badge per row. Both delegate to one shared body, so the departed short-circuit, the `effByD4` map and the stored-value fallback cannot drift apart — a card and that person's roster row disagreeing is the exact bug being fixed (`roster.status` has held only active-vs-departed since PR #65, so the card said "Active" for someone on MC). Showing only the top status was rejected because the parade grid and the Dashboard Non-Active table both list all of them, so a card naming one would contradict the parade state. The card passes no `effByD4` — that is the documented lone-caller fallback and fine for one person, but it rebuilds the whole medical layer and must not be copied into a list render. **Strictly display-only**, pinned by a test that asserts `roster.status` is byte-identical after rendering. | `js/forms.js`, `js/helpers.js`; `test/person-card-status.test.js`, `test/forms-wiring.test.js`. |

| 124 | **The archive drawer pushes the list aside by shrinking `#main`, and the dimming backdrop is deleted on desktop rather than made click-through.** The request was "the sidebar should not overlay, it should move out from the side allowing one to press the different list entries" — so the requirement is **clickability**, and the thing actually blocking clicks was never the drawer (it is docked right of the list) but the `inset:0` backdrop over everything. **(a) Shrink `#main`, not `#content`.** Both stop the overlap; `#main` also keeps the topbar's scope filter reachable, which matters precisely when the list you are browsing is filtered. Rejected: translating the whole page left (content slides off the left edge, and the sidebar goes with it) and restructuring the tab into a two-column grid (much the largest change to `renderArchive` for the same result). **(b) The backdrop is removed on desktop, not made `pointer-events:none`.** Click-through would have worked, but dimming a list the user is being *invited* to click reads as disabled — the visual would contradict the interaction. Implemented by moving the `.arc-drawer-backdrop.open{display:block}` rule inside the existing `max-width:768px` block, so desktop needs no `!important` and mobile is untouched. **(c) Mobile (≤768px) deliberately keeps the old full-width overlay sheet, backdrop and tap-to-close.** Pushing a 560px panel onto a 375px viewport leaves the list unusable, which defeats the purpose. The `<body>` class only records *"a drawer is open"*; whether that pushes or overlays is decided in CSS by width, so there is one breakpoint rather than a JS copy that can disagree after a resize. **(d) Escape is added because removing the backdrop removed the only keyboard-free exit** — it defers to an open `#modal-overlay`, since a modal opened from the drawer owns Escape first, and is bound once on `document` because `renderArchiveList` re-runs on every auto-refresh poll. **(e) The body class is cleared at the top of `render()` AND at the top of `renderArchiveList`.** The drawer element lives inside `#content`, which every tab overwrites — without the `render()` reset, navigating away with the drawer open leaves the *next* tab rendered into a 530px column with nothing beside it; without the list reset, the re-render path that declines to re-open a filtered-out row would leave the shift behind. Both are re-applied in the same synchronous pass when a drawer genuinely reopens. **Verified in a browser at 1280px and 650px**, including the negative control: at 650px the mobile branch really does still overlay (backdrop `display:block`, hit-test at a second row blocked), and at 1280px the same hit-test lands **inside a row**, list right edge 699 vs drawer left edge 720, no horizontal page scroll. | `styles.css`, `js/render.js`; `test/archive-list.test.js`. |

| 125 | **The "MC list" export includes an MC that has ENDED but was never booked in, flagged with a Note — and the three exports name their scope in the filename.** The stated rule was "currently-active MC only, Warded excluded", which reads as "the window covers today". Taken literally that drops the book-in tail, and since PR #65 an away status ends only when a commander explicitly books the person in — the parade state still lists those people under **ATT C**. An MC list that omitted them would contradict the parade state sent the same morning, and the failure is silent: the file looks perfectly plausible either way. They are therefore included, with a `Note` column reading "MC ended DDMMYY — not booked in", so the anomaly is legible in the file instead of being folded in with everyone else. **Warded stays out of the MC list** (spec §8 keeps it out of ATT C) and lands in the **Status** export instead — that was flagged to the user as an assumption and is now pinned by a test in both directions. **Scope in the filename** (`MC list PLT1 …csv`, `MC list Company …csv` when unfiltered) because a filtered file and a whole-company one are otherwise indistinguishable on disk, and mistaking one platoon's list for the company's is a reporting error. Reused `exportFileName`'s label rather than extending the helper. **Three separate buttons on the three tabs that already render those lists** — a combined menu was rejected because it hands you lists you are not looking at, and the Dashboard because its tables are today-only summaries rather than the full lists. **Sheets' leading-zero trap is deliberately NOT handled:** 4Ds go out as plain text exactly as the existing Roster and Conduct exports emit them, so Sheets shows "0123" as 123 on open; an `="0123"` wrapper would fix the display and break every other consumer, and matching the existing exports is the lesser evil. This is recorded because it looks like an oversight and is not. **Ranks go through `bpDisplayRank`** (DECISIONS #122) so a blank-rank recruit reads `REC` in the spreadsheet exactly as in the message — a CSV that names someone differently from the parade state is the same failure in a different medium. | `js/render.js`; `test/list-exports.test.js`. |

> **Not fixed, deliberately:** `MD_Docs/Message Formats.md`'s parade sample is internally
> inconsistent about ranks (`LCP Calvin Lee` at line 153 vs `Martin Tan B1411` at line 160).
> Nobody asked for it to be corrected and it is a sample, not a rule; left as-is.

> **Where the batch's narrative lives:** `CHANGELOG.md` `[Unreleased]` carries the user-facing
> description of all six PRs plus the `bravesMigrateMrTiming()` operator note; `SESSION_CONTEXT.md`
> carries the working state (cache-bust chain, host blockers, sandbox probes). This log carries only
> the *why*. Per the header above, if any of it disagrees with a spec, the spec wins.

## Session 2026-08-02 — Status Trend range, pill/Status-Mix fixes, editable notes (PR #106, merged but stranded)

**#122 — `setStatusTrendDays` rebuilds one chart instead of calling `render()`.** The Status Trend card
can sit behind the mobile defer gate (`shouldDeferCharts()`), and a full `render()` re-arms that gate —
hiding the chart the user just asked to re-scale. So the setter destroys/rebuilds only
`STATE.charts.status` and repaints its own title and pills. Follows the precedent already set by
`setDashParadeTime`/`refreshDashParade` (refresh the block, not the page). Consequence: any future
dashboard-wide state that the trend card depends on must be recomputed inside the setter, not assumed
fresh from the last render.

**#123 — the rebuild recomputes `scopedIds` rather than stashing it.** Stashing the set from the last
`renderDashboard()` would be cheaper but goes silently stale the moment the topbar scope filter
changes, producing a chart that disagrees with every other tile on the page. `strengthRoster()` is the
same derivation `renderDashboard` uses, so recomputing cannot drift. Correctness over a negligible
saving.

**#124 — "All" is resolved from the Medical layer, floored at 14, and stated in the title.** Medical is
the only layer the trend reads, so a window wider than the earliest `Medical.startDate` can only
prepend zero-columns — there is nothing to gain from going further back. Floored at 14 so an empty or
single-day sheet draws a line rather than a point, and guarded against a future-dated record (a
pre-booked MC) yielding a negative span. The title shows the resolved count
(`Status Trend (all time · 183 days)`) rather than a bare "All", because the cost is linear in the
window and the user should be able to see what they just asked for.

**#125 — Status Mix rows restack instead of widening the fixed track.** The vertical-text bug came from
`flex:0 0 110px` on the badge column. Widening it to fit `Excuse Prolonged Standing` would only move
the threshold — statuses are user-extensible via "＋ New custom status…", so name length has no
bound. Stacking (badge+count above a full-width bar) removes the constraint entirely and, as a
side-effect, makes the bars *more* comparable: they all start at x=0, where before a variable-height
label sat beside them.

**#126 — `notes` is the one roster column editable in-app, and its save pushes the WHOLE row.** Every
other roster field comes off the pre-enlistment nominal roll and stays Sheet-maintained (the split
`openCommanderForm` already documents), but a remark like "wears specs, spare pair in bunk" is written
mid-day by whoever noticed and has to be capturable where it is read. The row-level point is the
dangerous one: the backend's `upsertRow` rewrites **every** sheet column from the row it is handed
(`trimmed.map(h => rowData[h] ?? "")`), so a `{id, notes}` patch would blank name/age/phone/allergies
while the UI reported success. Any future in-app roster edit must push the full row for the same
reason. (Note: `submitCommander` pushes a freshly-built `entry` object rather than the merged STATE
row — same class of hazard, not touched here.)

**#127 — stacked PRs must merge top-down; assert ancestry before calling work shipped.** PRs #105/#106/
#107 all merged into base branches that had already merged to `master`, stranding five commits with no
signal from GitHub. GitHub auto-retargets a PR only when its base branch is *deleted*; these bases were
kept, so no retarget fired. The daily-code-review routine should assert
`git merge-base --is-ancestor <head> origin/master` after any stacked merge. See
`HANDOFF_STRANDED_STACK_PR105-107.md`.

## Session 2026-08-02 (later) — recovering the stranded #105/#106/#107 stack (PRs #108, #109)

**#124 — Recover the original commits rather than re-implement or squash.** The five stranded commits
were already reviewed and test-passing; cherry-picking them unchanged keeps the authored history and
the reviewed diffs intact, and reduces the review burden of the recovery PR to *merge behaviour* only.
A squash would have destroyed the #105/#106/#107 attribution for no gain.
→ Binding record: PR #108 body; post-mortem in `HANDOFF_STRANDED_STACK_PR105-107.md`.

**#125 — New branch name instead of re-pushing the deleted `fix/bookindate-sibling-status-loss`.**
GitHub's auto-delete-on-merge had removed the stack tip from origin, so the branch had to be recreated
either way. Chose `fix/recover-stranded-pr105-107-stack`: reusing a slug already bound to a closed PR
(#107) invites confusion in the PR list, and `COMMIT_CONVENTIONS.md` asks for descriptive names based
on what the work actually is.

**#126 — `npm run map` deliberately excluded from the recovery PR (#108), run separately as #109.**
Regenerating the map adds a ~43k-line `docs/codebase-map.json` churn. #108's entire value was being
*provably nothing but the five recovered commits* — a reviewer can confirm that by reading a 7-file
three-dot diff, which a bundled map regeneration would have buried. Sequencing also matters: the
generator stamps the generating commit and hashes the working-tree sources, so running it before the
recovery landed would have recorded a tree that was about to change.

**#127 — Local `master` must be current *before* `npm run map`, not after.** Asked directly this
session. The generator is a function of the working tree: it writes `commit` and per-file sha256s into
`docs/codebase-map.json`, and `test/map-freshness.test.js` compares those hashes to current sources. A
run on a stale checkout records a stale sha and hashes the wrong sources, so the freshness warning
survives regeneration — the staleness moves rather than clears.

**#128 — GitHub's auto-delete-on-merge fires on a merged PR's *head*, never its *base*.** This is the
mechanism behind both the stranding and a wrong claim made mid-session (that origin had already pruned
the dead branches — it had not). Branches that only ever served as bases survive every prune, which is
exactly why `fix/ha-double-lapse-recovery` and `fix/bookindate-lost-on-medical-leave-edit` were still
on origin after everything else was cleaned up.

**#129 — Prevention rule adopted: assert ancestry, don't trust the merged badge.** After merging any
stacked PR, run `git merge-base --is-ancestor <head> origin/master` before calling the work shipped.
Stacked PRs must merge top-down, or each base must be re-targeted to `master` as the one below merges.
Applied retroactively this session to #94, #95, #101–#107 — all confirmed by sha.
→ Suggested for the daily-code-review routine; recorded in `HANDOFF_STRANDED_STACK_PR105-107.md`.

**#130 — PR #102's "byte-identical" idempotency claim is overstated; left as-is, documented.** A
re-run of `npm run map` on unchanged sources always produces a 2-line diff (`generatedAt`, `commit`),
so the artifact *can* churn a diff on its own. Everything source-derived is byte-identical, which is
the property the tool needs, and the freshness test correctly keys on source hashes rather than the
sha. Not "fixed": a wall-clock stamp is genuinely useful in the artifact, and the `commit` field is
inherently self-referential (the map can never record the commit that contains it). Recorded so a
future session does not misread the 2-line diff as drift.

**#131 — The mobile pill-wrap fix is applied in two independent places on purpose.** Asked directly
("investigate and implement *different ways* to prevent this"). One fix resets `word-break` on the
pill itself; the other redesigns the surface so a pill never lands in a 49px column. Either alone
would have cleared the reported symptom, but the inherited `word-break:break-word` on `.modal table`
is load-bearing — it is what stops a long free-text reason scrolling the modal sideways — so it was
**kept and neutralised at the pill level** rather than removed. A future card that puts a pill inside
a modal table is protected without having to rediscover this.

**#132 — Container query, not media query, for the person card's conduct list.** The card's modal
holds a fixed width until the viewport drops under ~560px, so a `@media (max-width:440px)` rule would
fire on tablets where the wide four-column layout still fits comfortably, and would *not* fire in any
future narrower embedding of the same list. `container-type:inline-size` on `.pc-cph` makes the
breakpoint a property of the space the list actually has.

**#133 — `bpHasCoveringStatus` counts the report-sick row's own status; Pending / NIL / blank-end
still list.** The old `bpHasOtherStatus` skipped `x === m`, which made the "omit personnel already on
status" toggle a no-op in the common case (`submitMedical` writes the MO outcome onto the visit's
first row — the same row `bpSickReports` returns). Widened to include that row. Deliberately *not*
widened further: a `Pending` or blank status is the open case the sick parade exists to list; `NIL`
means the MO issued no status; and a blank end date does not suppress, because `medStatusActive`
treats an end-less record as inactive everywhere else in this codebase and "unexpired forever" here
would silently hide people. Toggle-off output is byte-identical, so the archiver and the GAS port are
unaffected on the default path.

**#134 — Bundler + ESM is DEFERRED, not rejected, and the blocker is `file://`.** Part A of the
2026-08-02 structure review (`docs/superpowers/specs/2026-08-02-chore-8-9-structure-review-and-
telegram-removal.md`) ranked seven options. ES modules are CORS-blocked under `file://`, so `import`
is not a drop-in — it requires a build step, and a build step ends "open `index.html` and it runs",
which is how this app is actually deployed and demoed. The four items implemented (ESLint,
`data-action`, `@ts-check`, file splits) were chosen because each buys a slice of what modules would
buy *without* taking on the build. Revisit only if the `file://` requirement is dropped.

**#135 — Namespace objects (`const Render = {...}`) and import maps were rejected outright.**
Namespacing is a rename of ~700 call sites that changes nothing about resolution — the same
unchecked global lookup, one property access deeper. Import maps do not solve the `file://` block
either. Both are motion without payoff.

**#136 — Mega-file splits are done opportunistically, never as a standalone shuffle PR — with one
exception, taken here.** A pure-move PR is unreviewable in the normal way, so the rule is to split
while already editing. `forms.js`/`render.js` were the exception because they had grown past any
plausible "while you're in there" and the move is *mechanically provable*: byte-identity of the
concatenation against `HEAD` in tag order. That proof is the only thing that makes a shuffle PR
reviewable, and it is the precondition for repeating this.

**#137 — ESLint's derived global surface is the design, not a convenience.** Hand-listing globals in
`eslint.config.js` would rot on the first rename and would make `no-undef` report the config's staleness
instead of the code's. Deriving from `tools/map/collect.js` at config-load time means a deleted
function invalidates its callers the same run. The cost is that `eslint.config.js` now depends on
`tools/map/` — do not "simplify" that dependency away.

**#138 — `npm test` stays zero-dependency; lint and typecheck are devDependencies.** The test harness
loads real sources into a `vm` sandbox with no packages, and that property is worth keeping — it is
why the suite runs on a clean clone with no install. ESLint and tsc are separate commands; a
contributor with no `node_modules` still gets the 716 tests.

**#139 — The GAS parade port serves the archive cron, not the Telegram bot.** Four files said
otherwise and were corrected during the bot removal. This matters because it is the reason
`BRAVES-ARCHIVE-PORT` and `test/parade-port-parity.test.js` survived a removal that deleted
everything else the bot touched. Do not "clean up" the port on the assumption it was bot
infrastructure.

**#140 — `gh stack submit` / `gh stack link` do not work against this repo; only `gh stack init`
does.** Both fail at the GraphQL layer — `submit` with "Head ref must be a branch" on all five
branches (twice, after confirming the refs were pushed, so not a race), `link` with "Could not
resolve to a PullRequest with the number of 113" on a PR `gh pr view 113` reads fine. The signature
points at the repo lacking GitHub's Stacked PRs feature. Use plain `gh pr create` with explicit
`--base`, which chains correctly and additionally allows writing `COMMIT_CONVENTIONS`-shaped bodies
that `submit --auto` has no flag for. Merge such a chain with `gh pr merge` bottom-up — `gh stack
merge` does not apply to PRs that are not a real GitHub stack.

**#141 — The archive scope column now shows the platoon display name; that was a behaviour change,
not a regression fix.** `renderArchiveList`'s `scopeLabel` used to read
`typeof platoonDisplayName === "function" ? platoonDisplayName(code) : code`. **No such function was
ever written**, so the guard always fell through and the archive has always rendered the raw code.
PR #117 removed the dead branch under ESLint `no-undef` and deliberately left behaviour alone; PR
#119 answered the deferred question — every other scope-bearing surface (parade-tab selector,
fitness-report picker, wizard, dashboard `nameFor`, platoon filter) resolves `displayName`, and
`PLT1` beside "1st Platoon" reads as a different platoon. **Resolved against `STATE.platoons`, not
`activePlatoons()`, on purpose:** archive rows are historical, so a platoon deactivated since the
snapshot must still render by name; with an empty Platoons tab `activePlatoons()` derives
`displayName === code` anyway, so the code fallback is exactly equivalent. Do not "simplify" it to
`activePlatoons()`.

**#142 — Stub a collaborator function in a test only if that function exists.**
`test/archive-list.test.js` stubbed a `platoonDisplayName` global that exists nowhere in the app, so
the test passed against its own stub while production took the other branch — the dead code above
survived precisely because its test was green. The harness now injects platoons as **data on
`STATE`** and asserts both the positive (display name present) and the negative (`>PLT1<` absent).
General rule: prefer injecting data over stubbing a resolver, and when a stub is unavoidable, verify
the real symbol exists.

**#143 — The post-split map-regeneration handoff's premise was wrong; the map was never stale by ten
files.** `HANDOFF_2026-08-02_MAP-REGEN-POST-SPLIT.md` predicted a ~43k-line churn from ten unseen
`render-*`/`forms-*` paths and 60 disappearing Telegram declarations. The committed map at `a8f437e`
**already had all ten paths and zero Telegram declarations** — #117 ran the generator with the split
in the working tree, and only the self-referential `commit` stamp lagged (#130). Diffing the
artefact's per-file `hashes` old-vs-new showed **exactly one genuinely drifted source: `js/render.js`**.
That hash diff, not the file list, is the reliable staleness signal — read it before believing a
staleness claim written from the commit stamp alone. Regenerated as PR #120.

**#144 — `bookInDate` is an AWAY-status concept only; booking someone in never ends an in-camp
restriction.** DECISIONS #82 defined `bookInDate` ("Mark Present" stamps an immutable date on the
Medical/Leave row without rewriting its own dates) but never drew the line this entry adds.
`paradeEndActiveContributors` was stamping it on **every** active Medical row and the §8
classifier's STATUS branch honoured it, so marking a recruit Present on return from a 2-day MC
also booked in the 84-day LD they were still on — the LD went silent in the parade state for six
weeks and the recruit read Present with a live medical restriction. The rule: `bookInDate` means
"back in camp", which is only meaningful for a record that put the person **out** of camp — MC,
Warded, AL/OIL, and an out-of-camp appointment (type `MA`, a discrete event whose own branch
still honours it). **LD / RIB / Excuse-\* are in-camp restrictions: the recruit was never away, so
booking them in cannot end them.** Fixed on both sides — the write side stamps away records only,
and the classifier's STATUS branch carries no `bookedInFor` guard, which is why existing data
heals with no migration. Mirrored into the GAS hand-port. PR #122.

**#145 — Backend migration: stay on Sheets + Apps Script and harden; Supabase `ap-southeast-1` if
forced to move.** `docs/CONVEX_PORT_ASSESSMENT.md` (cron-generated, 2026-07-30) recommended
Supabase over Convex on data-shape grounds. That ordering stands, but migration itself is now
ranked **below the null option**, because three decision inputs the original never collected all
point the same way: **~30 users / ≤10 concurrent** (so reactivity — the original's headline
argument — is a nicety, not a driver), **a maintainer in a rotating appointment** (so self-hosting
is disfavoured regardless of technical merit), and **a personal `@gmail.com` account** (so the
status quo is the *weakest* option on governance, not the safe default). Privacy is promoted to a
first-class axis: PDPA likely doesn't govern this — public agencies are excluded, the PSGA and
Official Secrets Act apply — so no vendor SOC 2 report is responsive to the authorisation
question, and **data residency**, omitted entirely from the original, is decisive (Supabase offers
Singapore; **Convex has no APAC region**). Ruled out with reasons: **PocketBase** (pre-1.0; its own
docs advise against production-critical use — the original recommends it as a "dark horse"),
**Grist** (best access-control model surveyed, but rules bind to an authenticated Grist user and an
API key carries full account access, so a `file://` frontend can't reach them; also no time-based
scheduler and a per-document concurrency cap of 10). Live document:
`docs/BACKEND_PORT_ASSESSMENT_v2.md`; effort model `docs/BACKEND_PORT_EFFORT.md`; review trail
`docs/BACKEND_MIGRATION_REVIEW.md`.

---

## Session 2026-08-03 (duty list — backlog item 36)

**#146 — Duty planning is a CAPABILITY (`caps` column on `Accounts`), not a fourth role and not a
Config allowlist.** The account model is a linear ladder (`viewer < commander < admin`) and a duty
planner also needs ordinary commander powers, so a fourth rung would be a capability wearing a
role's clothes. A Config allowlist was the other candidate and is strictly worse: `Config` is an
ordinary commander-writable tab, so anyone could add themselves — self-service privilege
escalation. Gated in `routeAuthedPost` beside the two existing narrow gates (`sendEmail`,
`body.imported`). The gate is on the **tab**, not on one action, so `append`/`appendMany`/`upsert`/
`delete`/`write` are all covered. Reads are deliberately untouched — everyone sees who is on duty
and how the points fall, which is how the spreadsheet worked. Caps are snapshotted onto the token
at login exactly as `role` is, so a revocation bites on next login (the admin UI says so rather
than leaving it to be discovered). Recorded in `MD_Docs/DUTY_LIST_SPEC.md` §9.

**#147 — Braves duty totals will NOT match the old sheet, and that is the point.** Three defects
in the source workbook are fixed: public holidays were never applied (the formula read only
`WEEKDAY`; a `Holidays` sheet existed but nothing referenced it, so PH was hand-patched per cell —
and a PH is the highest day weight at 5); an off-by-one summed 30 rows for points while sibling
counts summed 31, silently excluding the 31st of any month from points but not counts; and the
`Overall duties` roll-up drifted by a column offset and omitted August. Bugs 2 and 3 have
regression tests. **Only-COS-scores is preserved** — that is intentional in the source system, not
a bug — but is now per-type configurable via `pointWeight` (`null` = counted but never scored).
Recorded in spec §1.3.

**#148 — Eligibility is evaluated at assignment time ONLY, never on read.** `dutyEligible` has no
parameter through which stored `Duty` rows could arrive, so it is *structurally* incapable of
retroactively invalidating one. A stored row is a historical fact: `Duty.platoon` holds the literal
platoon at assignment time and is never re-resolved, so a commander transferring PLT4 → PLT2 keeps
their old PDS 4 rows and **no past total moves**. Grandfathering: the current holder is always
offered in their own row's candidate list even if now ineligible, so reopening a past row to edit
an unrelated field cannot silently drop whoever actually did the duty. Do not add a roster-wide
re-validation pass — that would be the whole bug. Spec §5.1.

**#149 — Conflicts WARN, never block.** The source system prices "doing 2 duties at once" at −2 in
its own corrections list, which means it is something the company knowingly does and then
compensates for, not an error to forbid. Each warning carries the exact Config correction reason
and offers one-click logging, so detection and record cannot drift apart. Two sub-calls: the leave
check follows the source legend's "COS Duty ends on leave day" rather than the spec table's looser
"first or last day of a leave span", because duties release the next morning and the case worth
catching is the one `away` cannot see — a duty on a *clear* day that releases into leave; and it is
suppressed when the person is already away, so one event never produces two warnings under two
reasons (which would tempt logging −4). `consecutiveSameType` carries **no** reason: nothing in the
legend pays out for it, and inventing one would put points on the board nobody agreed to. Spec §6.

**#150 — Magnitude highlights in the imported workbook are FLAGGED, never applied.** The ±2/±4
legend disagrees with the `+3`/`+1`/`−1` literals in the export, so deltas always come from the
reason's Config default and magnitude-coloured cells are reported and otherwise ignored. No pairing
between a reason cell in `B`–`H` and a magnitude cell in `L`–`R` is assumed. Also: there is
deliberately **no "Public Holiday" correction reason** — PH is applied natively by the points
engine, so such a row would double-count. Spec §7.2, §14 item 2.

**#151 — Auto-scheduler: greedy + repair, and it PROPOSES ONLY.** Chosen over local search
(fairer but nondeterministic without a seeded PRNG, and cannot explain a choice) and constraint
solving (needs a dependency and a bundler, neither of which exists here). Explainability is worth
more than optimality: a roster the planner cannot justify to whoever drew Saturday COS is worse
than a slightly uneven one they can — hence a rationale on every assignment and byte-identical
output for identical input. Nothing is written until the planner presses Save, and saved rows carry
`source: "auto"`. **Two additions beyond spec §11, each found by running it rather than reading
it:** (a) a duty-COUNT fairness term, because the points objective is inert for `pointWeight: null`
types — the default for everything but COS — so the free columns cost nothing, the tie-break's
favourite took them daily, was then hard-blocked from COS as already-on-duty, and the scoring
column landed on whoever sorted last (measured 1 point vs 20 across five commanders); and (b) slot
ordering within a date — most-constrained-first (platoon before company) took unfilled slots on a
saturated month from 22 to 5, which is the floor set by leave, and scoring-slots-first then took
the points spread from 53 (median 0) to 4. Both are pinned by tests, since neither is visible from
reading the code. Spec §11.1.

**#152 — OPEN: weekend burden is measured in POINTS, so count-only duties are invisible to it.**
`weekendPoints` sums points earned on Saturdays/Sundays/PHs; since only COS scores by default, a
Saturday CDO or PDS contributes nothing. A scheduled test month showed a weekend spread of 0–13
while total points sat at a tight 10–16 — the person on 0 was working weekends, just not on the
scoring duty. Faithful to the source system, and the Overall duties view has always had the
property, but it is a **modelling question, not a bug**: does a Saturday CDO count as weekend
burden? If yes, the fix mirrors `dutiesAboveMedian` at the weekend level. Deliberately **not
decided unilaterally** — it changes what the fairness numbers mean. Spec §14 item 5.

**#153 — Backdrop-close is a target-identity check, not `stopPropagation` on the modal.**
`js/actions.js` dispatches every `data-action` from one delegated listener on `document`, so any
handler that stops a click before it reaches `document` silently disables every action inside that
subtree — which is precisely what the modal's `onclick="event.stopPropagation()"` did to the parade
"Mark Present" confirm (PR #126). Two other fixes were available and were rejected. *Attaching a
second dispatcher to `#modal-body`* would work, but it makes "does my button fire?" depend on which
container it happens to render into — the exact class of invisible edge the delegation migration
exists to remove. *Moving the document listener to the capture phase* would outrun any
`stopPropagation`, but it inverts the ordering guarantee for every handler in the app to fix one
container, and it would leave the real trap (a modal that swallows events) in place for anything
still using the bubble phase. Comparing `event.target` to the overlay element instead keeps the
close behaviour, leaves the event untouched for everyone downstream, and needs no knowledge of the
dispatcher at the call site. The general rule this encodes: **in an app with delegated dispatch,
never stop an event to express "this click was not for you" — test what it was for instead.**

## Session 2026-08-04 — privacy hardening (`BACKEND_MIGRATION_REVIEW.md` §4.6, PR #128)

**#154 — `localStorage` is deliberately NOT encrypted; the copy is bounded instead.**
CodeQL alert #20 has flagged the plaintext cache for months and the reflex fix is to encrypt it.
Both available shapes were rejected on the merits. A **client-derivable key** (from the token, the
device id, anything the page can recompute unattended) protects nothing — whoever reads the
`localStorage` value can read the key next to it, so it is obfuscation with a security-sounding
name. A **password-wrapped key** is real, but it makes the cache unreadable until the user has
typed a password, which destroys cold-start offline tolerance — a hard requirement in §4.7.5, and
the entire reason a local cache exists here. So the mitigation is to shrink what the copy contains
and how long it lives: caching is off until explicitly granted, capped at 14 days, and wiped on
expiry, on toggle-off and on sign-out. The comment at the alert-#20 site in `js/state.js` records
this so the next reader does not "fix" it back.

**#155 — The offline grant's CLIENT-SIDE expiry is the enforcement; server revocation is
revoke-on-next-contact and the UI says exactly that.** The threat that motivates the whole item is
a device that is lost, stolen, or belongs to someone who has left — i.e. a device that may never
contact the server again. Any control that requires a round trip is unreachable in precisely that
case. So expiry is evaluated locally, before the first render, with no network dependency, and the
admin's revoke button is honestly labelled `revoked — pending device check-in` rather than implying
a remote wipe. Admins still get the device list because knowing *where the copies are* is worth
having independently of being able to reach them.

**#156 — A lapsed grant never discards unpushed edits; the wipe defers and explains itself.**
`enforceOfflineGrant()` returns `held` when `STATE.dirty` is non-empty. A privacy control that
destroys a commander's unsynced medical entries would be uninstalled by the second week, and the
data it destroys is the same data it is protecting. Devices that already hold a cache also
auto-issue themselves a 7-day grant on upgrade, so the deploy empties nobody mid-deployment — the
grant model starts applying at the *next* renewal, not retroactively at the moment of the push.

**#157 — Retention's clock runs from LAST ACTIVITY, because the schema has no departure date.**
Nothing on the Roster records *when* someone left — only that they have. The purge therefore ages
each person's Medical/MSK/Appointments/Leave rows from their own latest date field, which can only
ever err **late** (someone who left in March but had a January MC is purged from January + 90 days,
never earlier than their real departure). A proxy that fails safe was preferred to adding a column,
which would need a `bravesMigrateSchema()` run and a backfill nobody has the source data for. The
purge is manual and requires typing `PURGE`; it is not on a timer.

**#158 — Each duty draws from ONE appointment, and that needed a new Roster column because
`section` cannot express it.** `section` reads `"Command"` for the PC *and* the PS — exactly the
pair CDO and CDS must separate — so no combination of existing fields distinguishes them. The
alternative considered was deriving PC/PS from `rankGroupOf()` (Officer → PC, WOSPEC → PS) with no
schema change; the user chose the explicit `appointment` column (`PC` / `PS` / `SectComd`) because
the appointment is a fact about the org chart, not something to infer from rank. Which appointment
each duty draws from lives in the `dutyTypes` **config**, not in code, matching every other duty
rule; a type with no `appointments` key stays unrestricted so an ad-hoc type needs no config
migration. Recorded in `MD_Docs/DUTY_LIST_SPEC.md` §3.5/§5.

**#159 — COS asks what appointment you hold, not which platoon you hold it in.** The appointment
rule carries no platoon test of its own, so an HQ WOSPEC holding a section-commander appointment is
offered for COS (company-scoped) while the platoon scope still excludes them from every PDS column.
This was the user's explicit answer when asked how HQ should be treated. Consequence worth naming: a
plain HQ OC/CSM, holding no appointment, now draws **no duty at all** — previously they were in
every company-scoped pool. `dutyExtraEligible` **bypasses** the appointment rule (an unprompted
call, flagged on PR #129): it is the escape hatch for someone outside the org model entirely, so
matching it against an appointment it was never going to have would make the key grant nothing.

**#160 — The PDS `section !== "Command"` clause is a property of platoon SCOPE, not of the
appointment list.** When the appointment rule first replaced it, a config omitting `appointments`
let a PC draw a PDS — caught by an existing scheduler test, whose *cause* was fixed rather than its
assertion. A platoon duty belongs to that platoon's sections, independently of how the appointment
list happens to be configured, so the clause stays. With the default config it is redundant; that
redundancy is the point. HQ is likewise now rejected explicitly in platoon scope rather than relied
on to be unreachable via `dutyPlatoonsFor()`.

**#161 — An un-backfilled `appointment` resolves to `""` for the Command element rather than
guessing.** `dutyAppointmentOf()` falls back to the org model (the same "explicit column wins, else
derive" shape as `personPlatoon`/`personSection`/`rankGroupOf`): a numbered section → `SectComd`,
which preserves the COS/PDS pools *exactly* on deploy day. `"Command"` splits on the explicit
`rankGroup` column, and with that blank too it returns `""` — so CDO/CDS go **empty** rather than
listing both. An empty dropdown is visible and gets fixed; silently offering the PS for the PC's
duty is the failure nobody catches. This is why PCs and PSs are the only rows actually worth
backfilling.

**#162 — The appointment lives in the `fourD` column and is derived on read, never written.**
Commanders carry `SC21`/`PS2`/`PC2` in `fourD`; `id` still holds `00xx`. `parseAppointment4D()` is
consulted as a middle tier — explicit column → fourD code → org model — in `personPlatoon`,
`personSection` and `dutyAppointmentOf`. Nothing is stamped onto the roster row, because `writeTab`
derives sheet headers from `Object.keys(data[0])` and a derived value would round-trip into the
Sheet on the next push, silently backfilling a column the user never typed. Same shape as `padD4` /
`canonicalPlatoonCode`. This supersedes the practical force of **#161**: an un-backfilled
`appointment` no longer resolves to `""` for anyone whose 4D carries a code, so CDO/CDS fill without
data entry. #161's reasoning still governs rows *outside* the convention, where guessing is still
refused.

**#163 — The parser is its own leaf module, not a function in `helpers.js` or `duty-eligibility.js`.**
Both call it, and each of those two is loaded ALONE into a vm sandbox by an existing test
(`duty-eligibility.test.js`, `parade-port-parity.test.js`), so either placement is a `ReferenceError`
in the other harness. A leaf below both loads cleanly into either and earns a `tsconfig` opt-in slot
and an isolated unit test, like `js/calc.js` and `js/duty-points.js`. The test harnesses, not taste,
decided the file layout here.

**#164 — Commanders belong to their derived platoon everywhere, including parade-state grouping.**
`getPlt`/`getSect` deliberately blank commanders out as coy-level, which is right for an OC and
wrong for a PC. Full derivation was chosen over an appointment-only variant, accepting that
per-platoon strength figures move and the next archived parade state will not reconcile against the
previous one. The alternative — a platoon for scoping but not for strength — was rejected because
two different answers to "which platoon" is a trap that surfaces later.

**#165 — The 4D sort key tests for *numeric*, not *truthy*.** Call sites read `r.fourD || r.id`,
which fell through to the id while commanders had a blank `fourD`. An appointment code is truthy but
not numeric, so the fallthrough stopped and `parseInt("SC21")` → `NaN` → `Infinity` sorted every
commander last. `fourDSortKey` now backs all three sites (`render-statusboard`, `braves-parade`,
`parade-tab`), which previously disagreed with each other — `parade-tab` stripped non-digits and got
`21` where the others got `NaN`.

**#166 — A parity fixture that does not exercise the code path is worse than no fixture.**
`parade-port-parity.test.js` had one commander with `fourD: "0001"`, so all 19 tests passed against a
completely unmirrored GAS port. The fixture now carries `PC2` and `SC21` commanders, and the suite
was confirmed to go red on real drift (`PLT2 TOTAL STRENGTH: 1` GAS vs `3` frontend) *before* the
port was written. Treat a green parity run as meaningful only if a fixture actually reaches the
changed branch.

## Session 2026-08-05 — MA book-in on the parade grid + CI action runtime (PR #133)

**#167 — Book-in tests a Medical Appointment on its VISIT DATE, not on status activity, because
that is the only thing its classifier branch reads.** The §8 MA branch is deliberately
status-independent (an appointment can co-exist with a status the same visit issued, DECISIONS Q2),
so it fires on `type === "MA"` + visit date == parade date and drops off only once the row carries a
`bookInDate`. `paradeEndActiveContributors` had been written the other way round — status-first,
with `m.type === "MA"` bolted onto an `else if` behind a `medStatusActive` guard. A real appointment
is logged `NIL` (the MO issued nothing) or `Pending` with no end date, and `medStatusActive` is
false for both, so that clause was **dead code for every appointment that was not also an active
MC** — precisely the case a commander reaches for. The fix is not to loosen `medStatusActive` (which
would leak into MC/Warded/LD handling and re-open the PR #65 in-camp bug) but to give the MA its own
date-driven test alongside the status tests, mirroring the read side one-for-one. **The rule of
record: when a classifier branch ignores status, its book-in counterpart must ignore status too.**

**#168 — A `Pending` MA takes BOTH paths — it resolves to NIL *and* books in.** Resolving alone is
what the status arm already did, and it is not enough: the MA branch never consulted status, so the
row kept being listed and the pill snapped straight back after the commander clicked Present. This
is the same failure shape as the same-day pending-MR case `paradeClearPerson` already handles
explicitly, and the two are now consistent. The arms are therefore additive (two `if`s), not
mutually exclusive (`if/else if`) — a shape worth preserving if this function is touched again.

**#169 — `node-version` and the action runtime are separate axes, and only the runtime was
stale.** `.github/workflows/test.yml` pinned `node-version: "24"` (the Node the suite executes
under, correctly on the active LTS line) while running `actions/checkout@v4` / `setup-node@v4`,
which execute on the **node20 action runtime** GitHub has deprecated. Bumped both actions to `@v7`
(node24 runtime) and left the input alone; a comment in the workflow records the distinction so the
next reader does not bump the wrong one and call it done.

**#170 — duty-scheduler fairness is measured over the people a slot could actually go to, not over
whoever holds a row and not over `dutyBasePool()`.** Two call sites had drifted onto two different
wrong populations. `dutyFairnessOf` sampled `Object.keys(totals.byPerson)`, and `dutyTotals` only
creates an entry for someone who *holds* a row — so everyone on zero, the under-loaded end the
spread exists to measure, was absent, and `fairnessBefore`/`fairnessAfter` were taken over different
samples under a modal that says "if the spread got worse, reject this". Separately the medians
driving `pointsAboveMedian` were sampled over `dutyBasePool()`, which applies neither `dutyIsActive`
nor the appointment rule while `dutyEligible` applies both, so departed commanders sat at zero
forever and pinned the median to 0, flattening the penalty into a constant and handing the choice to
the greedy tie-break. Both now take the union of the per-slot eligible lists. The binding rule: a
fairness statistic must be computed over the population the resource is being *shared between* —
holding a row is not membership, and being on the roster is not either. People outside it are
excluded even when they hold rows in range; their history stays real in `dutyTotals`, it just does
not enter the spread. See PR #134.

**#171 — A duty swap needs TWO slots stored, not one inferred.** The design spec's §3.1 column table
for `DutyChangeRequest` carries a single `date`/`dutyType`/`platoon` triple, while §3.2 requires all
four kinds — including `swap` — be expressible. A swap between two people on the *same* slot is just
`reassign`; the case swap exists for is "I have 5 Sep COS, you have 12 Sep COS, let's trade", which
needs a second slot. Resolving it by inference (look up the counterparty's other duty) was rejected:
a counterparty holding two upcoming duties makes the request ambiguous, and the ambiguity would be
resolved **silently, at approval time, by whichever row sorted first** — the submitter would never
see which trade they actually asked for. Three columns are therefore stored — `swapDate`,
`swapDutyType`, `swapPlatoon` — blank for every kind but `swap`. The binding rule: when a request
form cannot express a target unambiguously, add the field; do not let approval-time inference pick.
See PR #140.

**#172 — Writes to `DutyChangeRequest` split by ACTION, not by tab, because "anyone may submit" and
"only a planner may approve" do not both survive an open tab.** The duty capability gate is
per-tab and all-or-nothing: adding `DutyChangeRequest` to it makes submission planner-only (killing
the feature), and leaving it out lets any commander `upsertRow` their own row to
`status: "Approved"`. The approval gate on `decideDutyRequest` would still be enforced and still be
completely pointless, because the roster reads status off the row. So `dcrGuardWrite_` permits
`append` (server forcing `status`, the decided* columns, and taking `submittedBy` off the **token**
rather than the body), permits `deleteRowById` for the submitter's own pending row or a planner's,
routes all status changes through `decideDutyRequest`, and **refuses `upsertRow` / `write` /
`appendMany` / `updateRow` outright**. That refusal is not defence in depth — it is the thing that
makes "status only ever changes through `decideDutyRequest`" true rather than intended. The binding
rule: a server-owned column is only server-owned if every generic write path that could set it is
closed. See PR #140.

**#173 — The parade lookahead defaults to OFF, and the "spec §8.3" citation that justified 7 days
was false.** `bpClassifyPerson` has always defaulted `lookaheadDays` to `0`, and every non-parade
consumer — Status Board, dashboard tables, sick-report generators, the archiver — gets today-only
semantics for free by not passing the option. Only the two parade surfaces overrode it, to `7`, and
because their pill list started at `7d` **the classifier's own default was not reachable from the UI
at all**: a commander could not ask "who is away right now", and the parade state they copied counted
people present today but booked away later that week. The in-code comment attributed the 7-day
default to "spec §8.3"; the string `lookahead` appears **nowhere** in `MD_Docs/`, so nothing in the
spec layers constrains it. The binding rule: a citation to a spec section is a claim that must be
checkable — grep the spec before preserving a default on its authority. The horizon stays
session-scoped and unpersisted for the reason the original comment gave (widening it once to plan a
month must not silently produce a month-wide parade state the next morning), and `bpStrength()`
still deliberately takes no lookahead, so counts and message sections now agree by default. See PR #141.

**#174 — The per-person drop-out time is a NEW `eventTime` column, because `ConductDetail.time` is a
join key rather than free space.** `time` holds the *conduct's* time and is one third of the
`(date, time, conductId)` tuple the wizard matches stored detail rows on when re-opening a conduct.
Writing a per-person timestamp into it would make a re-opened conduct fail to find its own rows, so
`originalDetailIds` comes back empty and the atomic `replaceConduct` save orphans the old rows and
duplicates them — a silent data-integrity failure with no error anywhere. The column is named for the
event rather than `falloutTime` because it carries Report Sick rows too (a Report Sick is a fallout
that went on to the MO). The binding rule: before reusing an existing column for a new meaning,
establish whether anything *matches* on it — a field that participates in a lookup key is not spare
capacity. Registered in `WRITE_TEXT_COLS_BY_TAB` in the same change, without which Sheets coerces
`"0730"` to `730` (the documented root cause of #33 and #69). See PR #141.

**#175 — A "skip the cache-bust, no caller ships yet" decision must be re-checked by the task that
adds the caller.** `js/helpers.js` gained `nowHHMM()` and its `?v=` was deliberately not bumped,
which was correct at that commit — nothing called it. Two commits later the callers landed and
`js/forms-wizard.js` WAS bumped, and nothing revisited the earlier decision. The result would have
shipped: a returning user revalidates the wizard, gets the new code, and is served the cached old
`helpers.js` with no `nowHHMM`, so `+ Add` on Fallout/Report Sick throws. No per-task review could
catch it — the omission and the caller were in different tasks, each individually correct. The
binding rule: cache-bust decisions are only valid relative to the whole branch, so a whole-branch
check that every modified JS file is bumped exactly once belongs in the final review, not the
per-task one. See PR #141 and commit `4cf8919`.

**#176 — A commander MAY log a conduct for an out-of-scope recruit but MAY NOT log medical for one
(user ruling, 2026-08-05).** Observed live in the sandbox: as a PLT4-scoped commander, the
`ConductDetail` write for PLT1 recruits succeeded while the auto-created Pending `Medical` row was
refused with `{"error":"Out of scope for that platoon.","code":403}`, leaving a half-written state.
This looked like a scope inconsistency and was raised as one. The user ruled it **intentional**: a
conduct legitimately spans platoons, so logging one is not a scope violation, whereas medical is
per-person data that stays behind the platoon boundary. Not a bug — do not "fix" it and do not
re-raise it in future reviews. See PR #141's verification notes.

**#177 — Excuse Sunlight and Excuse Shoes RESTRICT training; Excuse Camo,
Uniform, Loud Noise and Boots do not (user ruling, 2026-08-10).** The first
proposal grouped Sunlight and Shoes with the permissive excuses on the reasoning
that neither stops a recruit marching. The user reversed both: they restrict.
Recorded because the grouping is counter-intuitive — every one of these reads
permissive from its name — and the obvious "tidy-up" is to pattern-match on the
word "Excuse" and flip them back. `test/status-participates.test.js` asserts
Sunlight and Shoes are `false` for exactly this reason. Binding wording lives in
`docs/superpowers/specs/2026-08-10-backlog-five-fixes-design.md` §4.

**#178 — No read-side repair for the duty ISO date columns (2026-08-10).**
`Duty.date` / `DutyCorrection.date` / `Holidays.date` were missing from
`WRITE_TEXT_COLS_BY_TAB`, so Sheets coerces them to Dates and `readTab` re-serves
them as "01 Sep 2026". A defensive ISO conversion in the three normalizers was
designed and then dropped: the user confirmed the duty feature has never been
used and all three tabs are empty on the live sheet, so it would have shipped as
dead code guarding a state that has never existed. Revisit only if a sheet is
ever found carrying "01 Sep 2026" in one of these columns.

**#179 — A status-participation editor is deferred, not rejected (2026-08-10).**
`statusParticipates` gains built-in defaults, but there is still no screen
listing statuses with their `participates` flag — the only way to set one is a
checkbox inside the medical form, reachable only while saving a record, with no
way to see or revise an existing flag. The user chose defaults-only and KIV'd
the editor. So the new defaults are not adjustable without a code change; that
is a known limit, not an oversight.
