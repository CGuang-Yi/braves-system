# Braves Data System — Adaptation Spec
### For Claude Code: adapt the existing Cougar codebase to 40 SAR Braves Company

This is the authoritative reference for adapting the existing `braves-system` codebase
(originally built for Cougar Company) to Braves' formats, structure, and requirements.
**Read this document fully before editing any file.**

The codebase is a single-page web app (vanilla JS SPA) backed by a Google Apps Script
web app that reads/writes a Google Sheet. Architecture, sync engine, and most feature
modules are reused as-is; this spec defines what changes.

---

## Contents

1. Guiding principles
2. Org model (Company / Platoon / Section)
3. Auth & access (email + passcode, role + roster linkage)
4. Config tab (transferability)
5. Roster schema changes
6. Medical tab schema changes (incl. MR, RSI/RSO)
7. R/N formatting
8. Category model (parade state)
9. Parade state message formats (company + platoon)
10. Sick message formats (RS + RSI Personnel)
11. Multi-level scoping (cross-cutting, all views)
12. HA programme rewrite (Single / Expanded / Double)
13. HA views
14. CSV conduct import
15. Polar Flow (retained — clarified role)
16. Dashboard changes
17. Files to change
18. What NOT to change
19. Build order
20. Open assumptions to confirm

---

## 1. Guiding Principles

- **Access**: commanders only (~10–15 people). The original invite/token system is overkill
  and is replaced with a simpler email + passcode + role model (Section 3).
- **Transferability**: every company-specific value (prefix, names, unit code) lives in a
  `Config` tab, not hardcoded. The system should adapt to another company by editing that
  tab, not the code.
- **Reuse first**: IPPT, RouteMarch, SOC, MSK, Polar Flow OCR, Conducts Registry, and the
  sync engine are reused. Primary new work is: auth, org model + scoping, parade state &
  sick message generators, MR handling, the three-programme HA rewrite, and CSV conduct import.
- **Inherit the visual language** of the existing Cougar UI (same components, classes, badge
  styles). Add or extend colours where needed to encode new information (e.g. the three HA
  tracks), rather than forcing everything into the existing palette.

---

## 2. Org Model (Company / Platoon / Section)

Braves is structured as:

```
40 SAR BRAVES COMPANY
├── HQ            (peer of platoons; OC, 2IC, CSM, clerks)
├── PLATOON 1
│   ├── Command   (pseudo-section: PC + PS, tagged to platoon not a numbered section)
│   ├── Section 1 (section commander + men)
│   ├── Section 2
│   ├── Section 3
│   └── Section 4 (section count MAY vary per platoon — do NOT hardcode 4)
├── PLATOON 2
├── PLATOON 3
└── PLATOON 4
```

Rules:
- **HQ is a peer of the platoons.** Company = PLT1–4 + HQ. HQ is selectable like a platoon
  in the scope selector.
- **Section count per platoon is variable.** Derive the available sections for a platoon from
  the distinct `section` values present in the roster for that platoon — never hardcode 1–4.
- **Platoon PC/PS** are tagged to the platoon, not a numbered section. They belong to a
  `Command` pseudo-section, which is selectable as its own section within the platoon.
- **Section commanders** are personnel like anyone else (a roster row with a `section`), who
  *also* have a login (a Commanders-tab entry linked to their roster PersonID — Section 3).

---

## 3. Auth & Access

Replace the entire invite/token system with email + passcode → role-tagged session token,
with the login linked to the user's roster row.

### 3.1 Remove entirely

All of the following functions and their call sites / `doPost` actions:
`generateInvite`, `generateBulkInvite`, `redeemInvite`, `bulkInviteStatus`, `listInvites`,
`listAuthTokens`, `revokeAuthToken`, `revokeInvite`, `revokeAllAuthTokens`, and all
`invite:*` PropertiesService keys.

### 3.2 Commanders tab (new) — linked to Roster

| Column | Type | Notes |
|--------|------|-------|
| `email` | text | Login identity (Google email or any agreed email) |
| `personId` | text | **References a Roster PersonID.** Name, platoon, section, rank all derive from the linked roster row — no duplication. |
| `role` | text | `admin` / `commander` / `viewer` |
| `addedBy` | text | email of the admin who added them (audit) |
| `addedAt` | ISO date | audit |

Because the login links to a roster row, a logged-in user is known to be e.g.
"PLT1 Section 2 commander". This is used for the "logged in as…" display and is the hook
for optional future scope-restriction (Section 11) without rework.

### 3.3 Roles

| Action | admin | commander | viewer |
|--------|:---:|:---:|:---:|
| View all data, generate parade state / sick messages, use all views | ✓ | ✓ | ✓ |
| Log medical / leave / conduct / IPPT / etc. data | ✓ | ✓ | ✗ |
| Edit roster | ✓ | ✗ | ✗ |
| Add / remove commanders | ✓ | ✗ | ✗ |
| Revoke tokens, change passcode, edit Config | ✓ | ✗ | ✗ |

### 3.4 Passcode + token (backend, `Code.gs`)

```javascript
// Run once from the editor to set the company passcode.
function setPasscode(plaintext) {
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plaintext)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  PropertiesService.getScriptProperties().setProperty('passcode_hash', hash);
  Logger.log('Passcode set.');
}

function checkPasscode(plaintext) {
  const stored = PropertiesService.getScriptProperties().getProperty('passcode_hash');
  if (!stored) return false;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plaintext)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  return hash === stored;
}

// Token validation replaces isValidAuth's invite-token check.
function isValidAuth(token) {
  if (!token) return false;
  return PropertiesService.getScriptProperties().getProperty('auth:' + token) !== null;
}

function getAuthContext(token) {
  const raw = PropertiesService.getScriptProperties().getProperty('auth:' + token);
  return raw ? JSON.parse(raw) : null; // { email, personId, role, issuedAt }
}
```

`doPost` gains a `verifyPasscode` action. On correct passcode it looks up the email in the
Commanders tab, resolves the linked roster row, and issues a token:

```javascript
} else if (action === 'verifyPasscode') {
  if (!checkPasscode(body.passcode)) { output = { error: 'Wrong passcode' }; }
  else {
    const commander = findCommanderByEmail(body.email); // reads Commanders tab
    if (!commander) { output = { error: 'Email not authorised' }; }
    else {
      const token = Utilities.getUuid();
      PropertiesService.getScriptProperties().setProperty('auth:' + token, JSON.stringify({
        email: commander.email, personId: commander.personId,
        role: commander.role, issuedAt: new Date().toISOString()
      }));
      output = { ok: true, authToken: token, role: commander.role,
                 personId: commander.personId };
    }
  }
}
```

Every existing `doPost` action that writes data must additionally check the caller's role
via `getAuthContext(token).role` and reject if `viewer` (or if `commander` attempts an
admin-only write). Reads remain open to any valid token.

### 3.5 Revocation

- **Per token**: delete the `auth:<uuid>` key (kicks one session).
- **Per email**: scan `auth:*` keys, delete those whose stored `email` matches (kicks all of
  a person's sessions — the "remove access" action). Pair with deleting their Commanders row.
- **Everyone**: delete all `auth:*` keys (admin "reset all sessions").
- Changing the passcode does not auto-revoke existing tokens; the full reset is
  `revoke-all` + `setPasscode`.

Expose per-email revoke and "remove commander" in an admin-only UI panel.

### 3.6 Frontend

- On load, if `localStorage.authToken` is absent or `isValidAuth` fails, show a login form:
  **email + passcode**. POST `verifyPasscode`. On success store `authToken`, `role`,
  `personId` in `localStorage`.
- Gate edit/admin UI affordances on the stored `role` (server still enforces — client gating
  is UX only).
- Show "logged in as {name} · {platoon} {section}" derived from the linked roster row.

> **Why not Google OAuth (`getActiveUser`)?** For ~10–15 users it would mean every commander
> clears Google's unverified-app consent screen and the Sheet must be shared with all of them.
> The passcode + Commanders-tab model keeps `Execute as: Me` deployment (Sheet stays private,
> no consent screens) while still giving per-person identity and revocation. Acceptable
> trade-off at this scale.

---

## 4. Config Tab (Transferability)

New `Config` tab — two columns, `key` and `value`. Loaded on startup into `STATE.config`
(object keyed by `key`). Every place that currently hardcodes a Cougar/Braves string reads
from here instead.

| key | default value | used in |
|-----|--------------|---------|
| `companyName` | `40 SAR BRAVES COMPANY` | parade state header |
| `companyPrefix` | `B` | 4D display prefix (e.g. B1411) |
| `companyCoyCode` | `B COY` | RS sick message header |
| `unitCode` | `40SAR` | RS sick message header |
| `hqLabel` | `BRAVES HQ` | HQ block label in company parade state |
| `defaultSickLocation` | `PTMC` | default LOCATION in sick message entries |
| `polarCompanyName` | `Braves Coy` | Polar OCR system-prompt company reference |

Add `Config` to the `readAllTabs` map in `Code.gs` and to the initial pull list in
`state.js`.

---

## 5. Roster Schema Changes

### New columns

| Column | Type | Notes |
|--------|------|-------|
| `platoon` | text | `HQ`, `PLT1`, `PLT2`, `PLT3`, `PLT4` |
| `section` | text | `1`–`N` (variable per platoon), or `Command` for PC/PS, or blank for HQ-flat personnel |
| `rankGroup` | text | `Officer`, `WOSPEC`, `Enlistee` — drives the strength breakdown |
| `fourD` | text | Display 4D (e.g. `1411`). **Blank** for personnel without a 4D. Separate from `id`. |

### `id` (primary key) behaviour — unchanged mechanism, broadened content

- Personnel **with** a 4D: `id` = numeric 4D (as today). `fourD` = same value.
- Personnel **without** a 4D (commanders, attached pers, etc.): `id` = a short unique code
  (e.g. `OC`, `PC1`, `CSM`, or any unique string). `fourD` = blank.

Existing numeric-id records need no migration: set `fourD = id` for current rows, leave
`fourD` blank only for new no-4D rows. Mixed numeric/text ids are safe for exact-match
lookups (the only kind used) — a text code can never collide with a numeric 4D.

> **MR is NOT a roster field** (corrected from an earlier draft). MR is a dated Medical-tab
> entry — see Section 6.

---

## 6. Medical Tab Schema Changes

### New / changed columns

| Column | Type | Notes |
|--------|------|-------|
| `type` | text | `RSI` (Report Sick In-camp), `RSO` (Report Sick Out-of-camp), `MR` (Medical Review), plus existing values (`MC`, `LD`, `Excuse-*`, `Warded`, `Pending`, `NIL`) |
| `urtiType` | text | `URTI` / `NON-URTI`. Auto-suggested from PURPOSE keywords (Section 10.3), commander-overridable. Only meaningful for RSI/RSO. |
| `location` | text | Clinic/hospital. Defaults to `STATE.config.defaultSickLocation` (`PTMC`). |
| `mrTiming` | text | **Optional** free-text timing for MR entries (e.g. `PM`, `1400`). Blank otherwise. |
| `visitId` | text | Groups the sibling rows of one multi-status visit (see below). Blank for single-status rows. |

### Multiple statuses per visit (RESOLVED — port from Cougar master, reconciled)

One MO visit can yield several statuses (e.g. `2D LD` **+** `4D Excuse RMJ`). Model this exactly
as the Cougar master feature does — **one sibling Medical row per status**, each with its own
`startDate`/`endDate` — with these Braves-specific reconciliations:

- **Siblings share a `visitId`** (and the same `d4`/`date`/`reason`/`location`/`type`). Generate
  one id per visit; single-status entries may leave `visitId` blank. This is the explicit
  grouping key so two separate same-day visits don't merge.
- **`type` is per-visit, not per-status** — all siblings of a visit carry the same
  `type` (RSI/RSO/MR…). The "add another status" UI sets status+duration per row only.
- **MR is not just another duration row** — an MR is its own visit/row (it routes to the MR
  section, outside the chain, per §8), never a sibling status under an RSI/RSO visit.
- The reusable `medStatusOptionsHtml()` helper and the add/remove-status-row UI port from the
  Cougar master `forms.js` largely as-is; the data-model changes above are the new part.
- **Build at Step 2** (schema: add `visitId`; wire `type`/`visitId` into the form + normalizer),
  with the classifier dedupe in **Step 3** (see §8).

### RSI vs RSO

- **RSI** = Report Sick In-camp (in-camp medical centre).
- **RSO** = Report Sick Out-of-camp (external clinic/hospital).
- Logged via a toggle when creating the sick report. Determines the `(RSI)` / `(RSO)` label
  in the parade state REPORTING SICK section, and whether `location` defaults to `PTMC` (RSI)
  or is left for manual entry (RSO).

### MR (Medical Review)

- In-camp review by an MO, usually **same-day, single date**.
- Stored as a Medical-tab row with `type = MR`, a **free-text reason** (e.g. `HEART`, `KNEE`,
  `FOLLOW UP`), and optional `mrTiming`.
- Person is **physically in camp** → counts toward CURRENT STRENGTH.
- MR is **evaluated independently of the parade-state priority chain** — a person can appear
  in BOTH the MR section and (say) REPORTING SICK the same day (Section 8).
- MR has **no interaction with HA** — it is not a conduct and not an HA participation source.
  A day's HA period depends solely on CSV-import `Present` status (Section 12/14); if someone
  attends the morning HA conduct and goes to MR in the afternoon, the period is earned from
  the attendance record and the MR is irrelevant to HA. Do not cross-reference them.

### MA (out-of-camp medical appointment)

- Not its own category. Classified under **OTHERS (NOT IN CAMP)** with details filled in
  later (Section 8).

#### Parade-state appointment handling — design ideas to adopt (from Cougar master)

The Cougar master's appointment/parade integration is not ported verbatim (Braves §8–9 owns
parade state), but **the Braves parade-state build must incorporate these ideas** (RESOLVED):

1. **Per-parade presence is live, not stored.** A stored flag says "this is an out-of-camp
   appt"; a per-parade **tick** says "has the recruit actually left yet." Only the tick removes
   them from CURRENT STRENGTH — so an early appt still shows at the next parade to confirm
   they've returned (presence is **bidirectional**: left *and* came back). Overrides are scoped
   to one report-modal session (cleared on open / date change).
2. **One source feeds both the roll and the count.** Compute the out-of-camp set once and use it
   for *both* the OTHERS listing and the strength subtraction, so the count always reconciles
   with the names (consistent with the binary strength rule in §8).
3. **Future-dated items show; only same-day respects the time cutoff.** Future appts always
   appear; a same-day appt already past the parade time is dropped.
4. **A `resolved` flag retires items** from the dashboard + parade state without deleting
   history.
5. **An explicit per-entry presence line** ("In camp" / "Out of camp (left)" / "In camp (not
   left / returned)") reads more clearly than a bare list.

---

## 7. R/N Formatting

Replace `paradeRN()` entirely:

```javascript
function paradeRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = (r.name || '').toUpperCase();
  const prefix = (STATE.config && STATE.config.companyPrefix) || 'B';

  if (r.fourD && String(r.fourD).trim() !== '') {
    return name + ' ' + prefix + String(r.fourD).trim();   // "MARTIN TAN B1411"
  }
  return [r.rank, name].filter(Boolean).join(' ');          // "LCP CALVIN LEE" / "TREVOR LEE"
}
```

Handles: NSFs with 4Ds (`MARTIN TAN B1411`), personnel without 4Ds (`LCP CALVIN LEE`, or
just `TREVOR LEE` if no rank), configurable prefix.

> Note: in the **sick** messages the R/N line uses name (+4D) without rank prefix — see
> Section 10. Keep a separate `sickRN(personId)` helper for that to avoid overloading
> `paradeRN`.

---

## 8. Category Model (Parade State)

Replaces Cougar's `[ATTC, REPORT SICK, MEDICAL STATUS]` model entirely.

### Categories and sources

| Category | Source | Entry format |
|----------|--------|--------------|
| **AL/OIL** | Leave tab — active leave covering today | `<R/N> - <reason> (<startDDMMYY> - <endDDMMYY>)` |
| **MR** | Medical tab — `type=MR`, dated today | `<R/N> - <reason>` (+ timing if present) |
| **REPORTING SICK** | Medical tab — `type=RSI` or `RSO` dated today, or `status=Pending` | `<R/N> - <reason> (RSI)` or `(RSO)` |
| **ATT C** | Medical tab — `type=MC`, active today | `<R/N> - <XD MC> (<startDDMMYY>-<endDDMMYY>)` |
| **STATUS** | Medical tab — active `LD` or any `Excuse-*` today | `<R/N> - <XD LD>` or `<excuse text>` |
| **OTHERS** | Anything else not in camp / not covered — Warded, booked-out, MA, etc. | `<R/N> - <reason> (OTHERS (IN CAMP))` or `(OTHERS (NOT IN CAMP))` |

### Listing is multi-section; the priority chain is for single-label contexts only

```
REPORTING SICK > ATT C > AL/OIL > STATUS > OTHERS
```

**A person may be LISTED under multiple sections of the parade state at once** — e.g. carrying
a STATUS (LD/excuse) *and* being up for MR the same day, they appear in **both** sections.
Multi-section listing is the rule (REVISED — the earlier "mutually exclusive / one category per
person" framing is superseded). MR is the clearest case but not the only one.

The priority chain above is **not** used for parade-state listing, and **not** used for the
strength count (that is binary — see *Strength calculation* below). It exists only where a
**single primary label per person** is needed — e.g. the Roster Status List's "Today's
category" badge (addendum A7.3). First match wins in those contexts.

### MR is independent

MR is always evaluated **independently** and shown in its own section / as its own badge,
regardless of any other category the person matches — never the "primary label" itself, always
alongside.

### Dedupe multi-status visits (RESOLVED)

A single visit can produce several sibling Medical rows (§6, linked by `visitId`) — e.g. a
person with `2D LD` + `4D Excuse RMJ`. The classifier must **dedupe per person**: such a person
appears **once** under STATUS, not once per sibling row, and is **counted once** in the strength
math (which is binary in/out anyway — see *Strength calculation*). When the sibling statuses
would map to different sections, list the person under each applicable section once, but never
twice within the same section. Group by `d4` (and `visitId` where finer grouping is needed)
before emitting rolls. **Build at Step 3.**

### ATT C day count

`XD` = `(endDate − startDate) + 1` calendar days, inclusive. E.g. 13–21 May = 9D MC.

### OTHERS sub-type (IN CAMP / NOT IN CAMP)

- **Default derivation**: `Warded` → NOT IN CAMP. Reasons containing "book out"/"booked out"/
  "out of camp"/MA-type appointments → NOT IN CAMP. Everything else → IN CAMP.
- **Override**: a toggle in the logging UI flips it; store `othersInCamp: true/false`.

### Ghost tags are NOT a parade-state category

Recovering tags (`MC+1`, `MC+2`, `LD+1`, `LD+2`) are removed from parade state. They remain
on the person's info card and in a dashboard widget (Section 16). Ghost-tagged personnel are
physically present → counted in CURRENT STRENGTH.

### Strength calculation

- **TOTAL STRENGTH**: roster rows with `status = Active` within the scope (company / platoon /
  section).
- **CURRENT STRENGTH is binary — in camp or not in camp, each person counted once.** A person
  is **NOT IN CAMP** if they hold **any** not-in-camp tag today: **AL/OIL**, **MC** (ATT C), or
  **OTHERS (NOT IN CAMP)** (Warded is an OTHERS (NOT IN CAMP)). Count **distinct** not-in-camp
  persons — holding two not-in-camp tags still subtracts one. CURRENT STRENGTH = TOTAL − that
  distinct count.
- Everyone else is **IN CAMP**: MR, REPORTING SICK (RSI/RSO), STATUS (LD/excuse), OTHERS (IN
  CAMP), and ghost-tagged. (No priority chain is involved — it's a single in/out test.)
- **[OFFICER] / [WOSPEC] / [ENLISTEE]**: `current/total` per `rankGroup` within scope, same
  in/out logic applied per group.
- Consequence of the binary rule: someone both ATT C (MC) and MR the same day is NOT IN CAMP
  (MC tag) — resolves the old §20.1 assumption; they still appear in both the ATT C and MR
  listings.

---

## 9. Parade State Message Formats

Match the samples in `Message_Formats.md` **exactly** — including separator dash counts and
blank lines. The samples are the source of truth; where this prose and the sample differ,
follow the sample.

### 9.1 Company Parade State

One combined message: company block → `=` × 30 → HQ block → (`-` × 80 + blank) → PLT1 →
… → PLT4. Company-level header includes the **24H generation time** (the `2122` in the sample
is the time the parade state was generated — auto-fill from `now`, do not prompt).

```
40 SAR BRAVES COMPANY PARADE STATE
<DDMMYY> <FP|LP> <HHMM>

TOTAL STRENGTH: <n>
CURRENT STRENGTH: <n>

[OFFICER]: <cur>/<tot>
[WOSPEC]: <cur>/<tot>
[ENLISTEE]: <cur>/<tot>
--------------------------------------------------------------------------------   (80 dashes)
AL/OIL: <nn>
1. <R/N> - <reason> (<startDDMMYY> - <endDDMMYY>)
...
--------------------------------------------------------------------------------
MR: <nn>
1. <R/N> - <reason>
...
--------------------------------------------------------------------------------
REPORTING SICK: <nn>
1. <R/N> - <reason> (RSI|RSO)
...
--------------------------------------------------------------------------------
ATT C: <nn>
1. <R/N> - <XD MC> (<startDDMMYY>-<endDDMMYY>)
...
--------------------------------------------------------------------------------
STATUS: <nn>
1. <R/N> - <XD LD> | <excuse text>
...
--------------------------------------------------------------------------------
OTHERS: <nn>
1. <R/N> - <reason> (OTHERS (IN CAMP))
2. <R/N> - <reason> (OTHERS (NOT IN CAMP))
...

==============================                                                     (30 equals)

<HQ block — same layout as a platoon block, header = STATE.config.hqLabel>

--------------------------------------------------------------------------------   (80 dashes)
<PLATOON 1 block>

--------------------------------------------------------------------------------
<PLATOON 2 block>
...
```

### 9.2 Platoon block / Standalone Platoon Parade State

Platoon commanders can generate just their platoon. Same block used inside the company
message and standalone (standalone has no leading 80-dash separator).

```
<DDMMYY> <FP|LP>
PLATOON <n>            (or STATE.config.hqLabel for HQ)

TOTAL STRENGTH: <n>
CURRENT STRENGTH: <n>

[OFFICER]: <cur>/<tot>
[WOSPEC]: <cur>/<tot>
[ENLISTEE]: <cur>/<tot>
------------------------------   (section separators ~28–30 dashes — MIRROR SAMPLE EXACTLY)
AL/OIL: <nn>
<numbered entries, or a single blank line if 00>
------------------------------
MR: <nn>
...
------------------------------
REPORTING SICK: <nn>
...
----------------------------
ATT C: <nn>
...
-----------------------------
STATUS: <nn>
...
-----------------------------
OTHERS: <nn>
...
```

Formatting rules (from sample):
- Counts always 2-digit zero-padded (`00`, `01`, …).
- Empty section: show header + count + one blank line; never omit the header.
- Platoon entries are **numbered** (`1.`, `2.`, …); company-level entries are also numbered
  in the sample — keep numbering at both levels.
- Note the sample's separator dash counts vary slightly per section (30/30/30/28/29/29).
  **Reproduce them verbatim** rather than normalising — store them as a per-section constant
  array so they're easy to adjust.
- The sample shows occasional double spaces (e.g. `Trevor Lee  - 48HR BO`) where a missing
  4D leaves a gap. Build R/N so that a missing 4D doesn't leave a trailing double space
  unless the unit actually wants it — prefer single-space clean output; confirm if they want
  the literal sample spacing preserved (Section 20).

### 9.3 Build notes

- Rewrite `generateParadeStateText()`, the strength-block builder, and the section builder.
- A single classifier function maps each active person → `{category, reason, mrEntry?}` per
  the Section 8 rules (returning an MR entry separately so it can appear in two sections).
- Scope the generator by company / platoon / HQ. (Section view isn't needed for parade state
  output, but the generator should accept a scope arg for consistency.)

---

## 10. Sick Message Formats

Two formats, both matching `Message_Formats.md` exactly. R/N here = name (+ `B<4D>` if
present), **no rank prefix** — use a dedicated `sickRN()` helper.

### 10.1 RS Format (single report-sick message)

```
<DDMMYY> <companyCoyCode> <unitCode> <HHMM>H

URTI: <nn>

S/N: 01
R/N: <sickRN>
DATE: <DDMMYY>
LOCATION: <location>
PURPOSE: <purpose>
FOLLOW UP STATUS FROM MO: <status outcome (from the Status dropdown; blank until MO seen)>

S/N: 02
...

NON-URTI: <nn>

S/N: 01
R/N: <sickRN>
DATE: <DDMMYY>
LOCATION: <location>
PURPOSE: <purpose>
FOLLOW UP STATUS FROM MO: <status outcome (from the Status dropdown; blank until MO seen)>
```

Header uses `companyCoyCode` + `unitCode` from Config (`B COY 40SAR`). Both URTI and NON-URTI
sub-sections always shown with their counts; `FOLLOW UP STATUS FROM MO:` line always present
(blank until filled).

### 10.2 RSI Personnel Message (company-wide, broken by platoon)

```
RSI PERSONNEL <DDMMYY> <HHMM>H

TOTAL: <nn> PAX

PLATOON 1: <nn> PAX

URTI: <nn>

S/N: 01
R/N: <sickRN>
DATE: <DDMMYY>
LOCATION: <location>
PURPOSE: <purpose>
FOLLOW UP STATUS FROM MO: <status outcome (from the Status dropdown; blank until MO seen)>

NON-URTI: <nn>

S/N: 01
...

PLATOON 2: <nn> PAX
...
```

- Include each platoon (and HQ if applicable) that has ≥1 RSI/RSO entry; show its PAX count.
- Within each platoon, both URTI and NON-URTI shown with counts (entries listed under each).
- `TOTAL: <nn> PAX` = sum across platoons.
- S/N numbering restarts per URTI/NON-URTI sub-section (per the sample).

### 10.3 URTI auto-classification

On logging a sick report, pre-select URTI/NON-URTI from PURPOSE keywords; commander can
override. Store final value as `urtiType`.

```javascript
function classifyURTI(purpose) {
  const p = (purpose || '').toLowerCase();
  const urti = ['urti','cough','cold','flu','fever','runny nose','sore throat',
                'throat','phlegm','blocked nose','rhinitis','sinusitis','sneez'];
  return urti.some(k => p.indexOf(k) !== -1) ? 'URTI' : 'NON-URTI';
}
```

### 10.4 Follow-up MO

There is **no separate `followUpMO` field** (removed). The "FOLLOW UP STATUS FROM MO:" line in
the RS / RSI-Personnel messages is derived from the medical record's existing **`status`** value
(the MO outcome — e.g. `2D MC`, `LD`, `NIL`). On initial report-sick the status may be `Pending`
(MO not yet seen) → the line renders blank; after the MO visit the commander edits the medical
record's Status dropdown to the issued outcome and the line populates automatically. No dedicated
follow-up control or column is needed.

---

## 11. Multi-Level Scoping (Cross-Cutting — All Views)

A scope selector applies to **every** data view: HA, IPPT, Medical, Leave, MSK,
Conduct/attendance, Dashboard, RouteMarch, SOC, Leaderboards. (Parade state has its own
explicit company/platoon generation per Section 9.)

### 11.1 Levels

```
Company  →  Platoon (PLT1–4, HQ)  →  Section (1–N, or Command)
```

- Section is nested under Platoon; selecting a platoon populates its available sections from
  the distinct roster `section` values for that platoon (variable count).
- Each platoon has a `Command` pseudo-section (PC/PS). Selectable like a numbered section.
- HQ is selectable at platoon level; if HQ personnel have no sections, the section selector is
  empty/disabled for HQ (flat group).
- Company = all platoons + HQ aggregated.

### 11.2 Selector behaviour — global default + per-view override

- One **global** scope control sets the default; all views follow it.
- Each view may **override** locally (its own scope state), without changing the global
  default. Implement as: `viewScope[viewName] ?? globalScope`.
- Persist global scope in `localStorage`; per-view overrides can be in-memory (reset on
  reload) unless you prefer to persist them too.

### 11.3 Implementation — client-side filtering

The data pull already returns all tabs to the browser. Scoping is a filter over in-memory
data keyed off the roster:

```javascript
function inScope(personId, scope) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return false;
  if (scope.level === 'company') return true;
  if (scope.level === 'platoon') return r.platoon === scope.platoon;
  if (scope.level === 'section')
    return r.platoon === scope.platoon && r.section === scope.section;
  return true;
}
```

Every view filters its records through `inScope(row.personId/d4, activeScope)` before
rendering counts, charts, lists, leaderboards.

### 11.4 Access — all commanders see all scopes (for now)

The scope selector is **view-level filtering only**; every authenticated commander can view
every scope. This is intentional: it's a small, trusted, all-access commander group whose
existing workflow (the parade state itself) already exposes the whole company. The
non-commander boundary is handled by auth (Section 3), which is the boundary that matters.

> **Adding enforcement later (not now):** the Commanders→Roster link (Section 3.2) already
> makes each user's platoon/section derivable server-side. To enforce, add a `scope` notion
> in `getAuthContext`, and filter every tab in the data pull (`pullTab`/`readAllTabs`)
> server-side by the caller's platoon — joining non-roster tabs (Medical, Leave, IPPT, …) to
> the roster by PersonID to resolve each row's platoon. Cross-platoon features (company
> parade state, company dashboard, leaderboards) then need explicit allowances. This is real
> work (per-row joins on every sync, plus the exception cases); deferred until access expands
> beyond the trusted commander group.

---

## 12. HA Programme Rewrite

Replace the single-programme `computeHA()` with a three-programme state machine.

### 12.1 Programme rules

| Programme | Periods | Max break days (total) | Max consecutive break | Restart when |
|-----------|:---:|:---:|:---:|---|
| Single | 10 | 2 | — | total breaks > 2 |
| Expanded Single | 14 | 5 | 3 | total breaks > 5 OR consecutive > 3 |
| Double | 13 | 2 | — | total breaks > 2 |

### 12.2 Definitions

- **1 period** = 1 calendar day on which the person was `Present` at ≥1 HA-eligible conduct.
  Multiple HA conducts same day = still 1 period. HA-eligible = existing `isHAExcluded()`
  logic retained (IPPT / Sports & Games / Swim excluded).
- **Participation source = CSV conduct import ONLY** (Section 14). `Present` status earns the
  period. **Polar Flow does NOT count** — screenshots miss people / cut off names, so Polar
  is biometric-only and never establishes HA participation.
- **Break day** = a calendar day inside an active attempt window with no period earned. In
  the conduct-import data, any status other than `Present` (MC / Leave / Off / Fall Out /
  Other) is a non-period day; days with no record are also breaks once the window is open.
- **Single & Expanded → same outcome** (`Single HA Complete`). Expanded is a more lenient
  parallel path. Run both tracks over the same activity history; complete if **either** hits
  its target.
- **Double HA eligibility**: `Single HA Complete` AND (VocFit completion recorded OR rank ≥
  3SG / ≥ 2LT). Rank check via a `RankHierarchy` reference where 3SG and all officer ranks
  ≥ 2LT are treated as having completed Foundation/Service Term.

### 12.3 Reference data needed

- **VocFit tab** (new): `personId`, `completionDate`, `certifyingUnit` (optional).
- **RankHierarchy**: a rank→order map. Either a small reference tab or a constant in code.
  Order officer ranks above 3SG so a single `order >= order('3SG')` check covers ≥2LT too.
  Confirm the actual rank list against the roster (Section 20).

### 12.4 State machine (shared helper)

```javascript
function runHAStateMachine(activityDateSet, startDate, endDate, params) {
  // params: { target, maxBreak, maxConsec (undefined = no consecutive limit) }
  let periods = 0, breaksUsed = 0, consecutiveBreak = 0, windowStart = null;
  const d = new Date(startDate);

  while (d <= endDate) {
    const key = toISODate(d);            // 'yyyy-mm-dd'
    const active = !!activityDateSet[key];

    if (windowStart === null) {
      if (active) { windowStart = new Date(d); periods = 1; }
    } else if (active) {
      periods++; consecutiveBreak = 0;
    } else {
      breaksUsed++; consecutiveBreak++;
      const reset = breaksUsed > params.maxBreak ||
        (params.maxConsec !== undefined && consecutiveBreak > params.maxConsec);
      if (reset) { periods = 0; breaksUsed = 0; consecutiveBreak = 0; windowStart = null; }
    }

    if (periods >= params.target)
      return { status: 'Completed', completionDate: key, periods, breaksUsed, windowStart };

    d.setDate(d.getDate() + 1);
  }
  return { status: windowStart ? 'In Progress' : 'Not Started',
           periods, breaksUsed, consecutiveBreak, windowStart, completionDate: null };
}
```

### 12.5 computeHA(personId)

```javascript
function computeHA(personId) {
  const dateSet = buildHADateSet(personId);   // from CSV-import Present rows, HA-eligible, deduped per day
  const keys = Object.keys(dateSet).sort();
  if (!keys.length) return { singleStatus: 'Not Started', /* tracks zeroed */ };

  const start = new Date(keys[0]);
  const today = new Date();

  const single   = runHAStateMachine(dateSet, start, today, { target:10, maxBreak:2 });
  const expanded = runHAStateMachine(dateSet, start, today, { target:14, maxBreak:5, maxConsec:3 });

  const singleComplete = single.status === 'Completed' || expanded.status === 'Completed';
  let singleStatus, singleTrack, primaryProgress;
  if (singleComplete) {
    singleStatus = 'Single HA Complete';
    singleTrack = single.status === 'Completed' ? 'Single' : 'Expanded';
  } else {
    singleStatus = (single.status === 'In Progress' || expanded.status === 'In Progress')
      ? 'In Progress' : 'Not Started';
    singleTrack = null;
  }

  // Lapse: complete but no HA activity in the last 14 days (retain existing maintenance idea)
  if (singleComplete && daysSinceLastActivity(keys) > 14) singleStatus = 'Lapsed';

  // Double eligibility + track
  let doubleEligible = false, doubleStatus = null, doubleTrack = null;
  if (singleComplete) {
    const r = STATE.roster.find(x => x.id == personId);
    doubleEligible = hasVocFit(personId) || rankAtLeast(r && r.rank, '3SG');
    if (doubleEligible)
      doubleTrack = runHAStateMachine(dateSet, start, today, { target:13, maxBreak:2 });
    doubleStatus = doubleEligible
      ? (doubleTrack.status === 'Completed' ? 'Double HA Complete' : doubleTrack.status)
      : null;
  }

  return { singleStatus, singleTrack, single, expanded,
           doubleEligible, doubleStatus, doubleTrack };
}
```

### 12.6 Status values

`Not Started → In Progress → Single HA Complete → (if eligible) In Progress (Double) →
Double HA Complete`, plus `Lapsed` (was complete, no activity in 14 days).

---

## 13. HA Views

Reuse the existing `renderHA()` three-zone structure; extend it for three programmes and add
the scope selector (Section 11). Inherit Cougar's visual language; add colours to distinguish
the three tracks.

- **Zone 1 — summary charts**: existing doughnut (status breakdown) + horizontal streak bar.
  Doughnut categories expand to the new status set (Not Started / In Progress / Single HA
  Complete / In Progress Double / Double HA Complete / Lapsed). Both charts recompute for the
  active scope.
- **Zone 2 — roster list**: each row needs a **primary status badge + a secondary track
  badge** (one badge can't express "Single complete, Double 8/13"). Show "Double locked /
  eligible" hint where relevant. Sort by status priority.
- **Zone 3 — info card (on click)**: replace the single streak bar with **three stacked
  progress bars** — Single, Expanded (parallel), Double (if eligible) — each with its own
  period count and break-days-used (Expanded also shows consecutive-break usage). Keep the
  existing day-by-day activity timeline (green = period, empty = break) below.

Assign a colour per track (e.g. Single = teal, Expanded = amber, Double = blue) consistently
across the badges, progress bars, and any legend. Use additional ramps from the existing
palette rather than inventing off-palette colours.

---

## 14. CSV Conduct Import

Replaces the manual re-keying step into the external system. Imports the attendance CSV (the
`Attendance_-_Endurance_Run_5` format) directly into the existing conduct log.

### 14.1 Source format

The file opens with a **7-row key/value metadata block** (key in column A, value in column B),
then a blank row, then the data table. Exact layout (verified against the
`Sanitised Attendance - Endurance_Run_5` sample):

```
Row 1  Activity Name   | Endurance Run 5
Row 2  Currency Tags   | HA            ← marks the conduct HA-eligible (see 14.3)
Row 3  Conducting Unit | Braves
Row 4  Date            | 26 May 2026
Row 5  Periods         | 2            ← number of 1h time periods; the Double-HA period count (HA.md cell "B5")
Row 6  Description     |
Row 7  (blank)
Row 8  User | Unit | Status | Remarks  ← header; data rows follow from row 9
```

- The importer must **skip the metadata block and begin parsing the data table at the
  `User | Unit | Status | Remarks` header row** — do not assume the header is row 1.
- Capture `Currency Tags` (row 2) and `Periods` (row 5, cell B5) from the metadata: row 2
  drives HA-eligibility (14.3), row 5 is the per-activity time-period count used **only by the
  Double-HA period sum** (Single/Expanded count 1 period per day regardless — see `HA.md`).
- `User` cell = `<4D> <Name>` for personnel with 4Ds, or just `<Name>` for those without.
- Six status values: `Present`, `MC`, `Leave`, `Off`, `Fall Out`, `Other` (Other has a
  free-text comment in Remarks).

### 14.2 Matching (reuse the conditional-split logic)

For each row: if the first token is numeric → treat as 4D, match against roster `id`/`fourD`;
else match the whole cell against roster names. Produce a resolved PersonID and a match flag
(`4D` / `Name match` / `Not found`). Surface `Not found` rows for manual resolution; never
silently drop them. PapaParse (already bundled) handles parsing.

### 14.3 Status handling

| CSV status | Conduct log | HA period? | Other action |
|-----------|-------------|:---:|---|
| Present | Present | **Yes** (if conduct HA-eligible) | — |
| Fall Out | Fall Out | No (break) | — |
| MC | (recorded) | No (break) | flag for manual Medical-tab follow-up |
| Leave | (recorded) | No (break) | flag for manual Leave-tab follow-up |
| Off (= OIL) | (recorded) | No (break) | flag for manual Leave-tab follow-up |
| Other | Other + comment | No (break) | show free-text comment in review panel |

- **Only `Present` earns an HA period.** All other statuses are break days. No exemptions for
  MC/Leave/Off.
- The import writes to the **conduct log only**. It does **not** auto-create Medical/Leave
  records — MC/Leave/Off rows are flagged in a review panel for the commander to action
  manually.
- **HA-eligibility source is selectable.** Either signal may govern whether a conduct counts
  toward HA periods: (a) the `Currency Tags: HA` metadata on the imported conduct (14.1 row 2),
  or (b) the existing `isHAExcluded()` conduct-name logic. Build it so the active source can be
  **changed later** (e.g. a `Config` flag), rather than hardcoding one. Default to whichever is
  more reliable for the current data, and keep the switch cheap.

### 14.4 Flow

Drop CSV → parse → review panel (matched / name-matched / not-found counts; MC/Leave/Off
follow-up flags; Other comments) → commander confirms → append to conduct log + push. Mirror
the existing Polar review-and-commit UX so it feels native.

---

## 15. Polar Flow (Retained)

Polar Flow import is kept **functionally unchanged**: screenshot OCR (drag-drop → canvas
compression → Apps Script → Claude vision → preview with matched/unverified 4Ds → commit),
Polar CSV import, biometric display, and the Attendance Gaps tracker.

Clarified role under Braves:
- Polar is **biometric + watch-compliance only**. It does **NOT** establish HA participation
  (Section 12). The Attendance Gaps tracker (attended-but-no-HR-log) is now cross-referenced
  against the **CSV conduct import** as the authoritative attendance list.
- Only incidental changes: the OCR system prompt's company reference reads
  `STATE.config.polarCompanyName` (or is updated to Braves), and 4D matching flows through the
  same PersonID logic so no-4D personnel don't break it. The existing unverified-4D flagging
  (rows kept + flagged, never dropped) is retained as-is for cut-off/missed names.

---

## 16. Dashboard Changes

Reuse existing tiles/widgets; apply scope selector (Section 11). Changes:

- **New tile — "Not Available (in camp)"** = count of **MR + REPORTING SICK** within scope
  (both groups are physically in camp but not available for normal activities).
- **New widget — Recovering / Ghost Tags** (since ghost tags left the parade state):
  `MC+1`, `MC+2`, `LD+1`, `LD+2` grouped with names. Severity order for the info-card badge:
  `Warded > MC > MC+1 > MC+2 > LD > LD+1 > LD+2 > Excuse > Pending > NIL`.
- **Strength block** uses `[OFFICER]/[WOSPEC]/[ENLISTEE]` (per `rankGroup`) instead of
  Cougar's platoon-by-platoon breakdown.
- All other tiles (today's appointments, leave/passes, MSK active, etc.) retained, scoped.

---

## 17. Files to Change

| File | Changes |
|------|---------|
| `Code.gs` | Remove invite/token system. Add `setPasscode`, `checkPasscode`, `isValidAuth` (token), `getAuthContext`, `findCommanderByEmail`, `verifyPasscode` action, per-action role checks. Add `Config`, `Commanders`, `VocFit` to `readAllTabs`. Update Polar OCR system prompt to read company name from Config. |
| `js/state.js` | Add `STATE.config`, `STATE.commanders`, `STATE.vocfit`. Add new tabs to initial pull. Add `globalScope` + `viewScope` state. Store `role`/`personId` from login. |
| `js/forms.js` | **Largest change.** Rewrite `generateParadeStateText()` + strength/section builders for the 6-category model, company+platoon formats, MR-outside-chain, OTHERS sub-type. Add `sickRN()`, RS + RSI-Personnel generators, `classifyURTI()`. Add CSV conduct import (parse/match/review/commit). Remove Cougar category logic. |
| `js/helpers.js` | Replace `computeHA()` with three-programme version. Add `runHAStateMachine()`, `buildHADateSet()` (CSV Present only), `hasVocFit()`, `rankAtLeast()`/RankHierarchy, `classifyURTI()`. Replace `paradeRN()`; add `sickRN()`. Add `inScope()` + scope resolution. |
| `js/render.js` | Login form (email + passcode). Scope selector (global + per-view) on all data views. `renderHA()` three-track update (dual badges, three progress bars). Dashboard: "Not Available" tile, ghost-tags widget, Officer/WOSPEC/Enlistee strength block. Admin panel: manage commanders, revoke, passcode, Config. Apply `inScope` filtering across IPPT/Medical/Leave/MSK/Conduct/RM/SOC/Leaderboard renders. |
| Google Sheet | Roster: add `platoon`, `section`, `rankGroup`, `fourD`. Medical: add `type`, `urtiType`, `location`, `mrTiming`, `visitId`. New tabs: `Config`, `Commanders`, `VocFit`. |

---

## 18. What NOT to Change

- IPPT scoring & award bands (already matches Braves: Gold★ ≥90, Gold 85–89, Silver 75–84,
  Pass 61–74, Fail ≤60, YTT).
- RouteMarch, SOC trackers and renders (beyond adding the scope selector).
- MSK injury classifier and analytics (beyond scope selector).
- Polar Flow OCR pipeline and `analyzePhotoHelper` (beyond the Config company-name tweak and
  the clarified non-HA role).
- Conducts Registry (`renderConducts`, rename/merge).
- Sync engine (`autoSync`, `pushTab`, `pullTab`, `appendMany`, `upsertRow`, etc.).
- Chart.js / PapaParse / library imports.
- `isHAExcluded()` conduct-exclusion logic.

---

## 19. Build Order

1. **Auth** (addendum **A1** — supersedes Section 3) — **per-account passwords** (not the
   shared passcode), Commanders tab + roles + login UI. Small, self-contained, unblocks a clean
   redeploy. Verify a commander can log in and a viewer is read-only.
2. **Config + Roster/Medical schema** (Sections 4–6) — add columns/tabs; wire `STATE.config`.
   Everything downstream depends on `platoon`/`section`/`rankGroup`/`fourD` and the new
   Medical fields.
3. **R/N + category model + parade state** (Sections 7–9) — the current blocker for using the
   system with Braves. Validate output byte-for-byte against `Message_Formats.md`.
4. **Sick messages** (Section 10).
5. **Scoping** (Section 11) — once roster has platoon/section, add the selector + `inScope`
   across views.
6. **CSV conduct import** (Section 14) — replaces manual re-keying; feeds HA.
7. **HA rewrite + views** (Sections 12–13) — most self-contained; depends on CSV import for
   participation data.
8. **Dashboard** (Section 16) — tiles/widgets last, once their data sources exist.

Each step is independently testable and leaves the app in a working state.

---

## 20. Open Assumptions to Confirm

These were flagged during design and not finally resolved — confirm before/at implementation:

1. ~~**ATT C + MR same day** → person counted **out of camp** for CURRENT STRENGTH (MC wins for
   physical presence). They still appear in both ATT C and MR sections.~~
   **RESOLVED:** CURRENT STRENGTH is binary in/out (Section 8 *Strength calculation*); the MC
   tag makes them NOT IN CAMP regardless of MR, and they are listed in both the ATT C and MR
   sections (multi-section listing).
2. **Sample whitespace**: `Message_Formats.md` shows occasional double spaces where a 4D is
   missing (`Trevor Lee  - …`). Assumed to be incidental; spec produces clean single-spaced
   output. Confirm they don't require the literal double space.
3. **Per-section separator dash counts** in the platoon block vary (30/30/30/28/29/29 in the
   sample). Reproduced verbatim via a constant. Confirm this is intentional and not a typo —
   if it should be uniform, set one value.
4. **RankHierarchy**: ~~confirm the actual rank list in the roster and that officer ranks order
   above 3SG (so one `≥3SG` check also covers `≥2LT`) for Double HA eligibility.~~
   **RESOLVED:** 3SG = completed Foundation Term, 2LT = completed Service Term. In the SAF
   rank structure 2LT and all officer ranks sort **above** 3SG, so a single
   `order >= order('3SG')` check correctly covers ≥2LT. Order the `RankHierarchy` map
   accordingly (specialist track up to 3SG, then officer ranks 2LT and above).
5. **VocFit `certifyingUnit`** included but possibly unnecessary — drop if not needed.
6. **Lapse rule** ~~(`Single HA Complete` → `Lapsed` after 14 days no activity) carried over
   from the Cougar maintenance model. Confirm Braves wants lapse/maintenance tracking at all,
   and the 14-day figure.~~
   **RESOLVED:** Retain `Lapsed`. The simple "14 days no activity" heuristic is
   **superseded by the HA currency model in `HA.md`** (2 HA activities ≤7 days apart, over a
   rolling 14-day window that resets on the later activity). `HA.md` is the authoritative
   source for HA programme + currency rules. Reset/pairing mechanics, period counting, lapse
   recovery, and the single-scheme-for-all-programmes rule are resolved — see the
   "Clarifications (resolved 2026-06-20)" section at the bottom of `HA.md`.
7. **"Not Available" tile** = MR + REPORTING SICK. Confirm STATUS (LD/excuse) personnel should
   NOT be included (they're in camp but arguably also restricted).

---

*End of spec. Drop this file in the repo root and point Claude Code at it. Recommended first
instruction: "Read BRAVES_ADAPTATION_SPEC.md fully, then implement Section 3 (auth) first per
the Section 19 build order; do not proceed to later sections until auth is working."*
