# Braves Adaptation Spec — Addendum
### Supplements BRAVES_ADAPTATION_SPEC.md — do not merge, apply alongside it

This addendum covers four areas finalised after the main spec was handed to Claude Code:
auth (revised to unique per-account passwords), audit log (new), Report Sick Leaderboard
(new), and Status Board view (new). Where this addendum conflicts with the main spec,
this addendum takes precedence.

---

## A1. Auth — Revised (replaces Section 3 of main spec)

The main spec described a shared company passcode. This is replaced with **unique
per-account passwords**, which allows clean per-person revocation without disrupting
other commanders.

### A1.1 Commanders tab schema (updated)

| Column | Type | Notes |
|--------|------|-------|
| `email` | text | Login identity |
| `personId` | text | References a Roster row — name, platoon, section, rank derive from here |
| `role` | text | `admin` / `commander` / `viewer` |
| `passwordHash` | text | SHA-256 of `salt + password` |
| `salt` | text | Per-account random salt (UUID) — generated once at account creation |
| `addedBy` | text | Email of admin who created the account |
| `addedAt` | ISO date | Audit |

Remove the shared `passcode_hash` PropertiesService key entirely.

### A1.2 Password hashing (backend, `Code.gs`)

Google Apps Script has no bcrypt. Use SHA-256 with a per-user salt — adequate for
this threat model given the small, trusted user base and MFA-protected Sheet owner account.

```javascript
function hashPassword(plaintext, salt) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + plaintext
  ).map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function verifyPassword(plaintext, salt, storedHash) {
  return hashPassword(plaintext, salt) === storedHash;
}

function generateSalt() {
  return Utilities.getUuid();
}
```

### A1.3 Login flow (doPost action: `login`)

```javascript
} else if (action === 'login') {
  const commander = findCommanderByEmail(body.email);
  if (!commander) {
    output = logFailedAttempt(body.email, 'Email not found');
  } else if (isLockedOut(body.email)) {
    output = { error: 'Account locked — too many failed attempts. Try again in 15 minutes.' };
  } else if (!verifyPassword(body.password, commander.salt, commander.passwordHash)) {
    output = logFailedAttempt(body.email, 'Wrong password');
  } else {
    clearFailedAttempts(body.email);
    const token = Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty(
      'auth:' + token,
      JSON.stringify({
        email: commander.email,
        personId: commander.personId,
        role: commander.role,
        issuedAt: new Date().toISOString()
      })
    );
    writeAuditLog(commander.email, commander.personId, 'login', null, null, token);
    output = { ok: true, authToken: token, role: commander.role, personId: commander.personId };
  }
}
```

### A1.4 Session expiry

On every authenticated request, check `issuedAt` in the stored token context:

```javascript
function isTokenExpired(context) {
  if (!context || !context.issuedAt) return true;
  const ageMs = new Date() - new Date(context.issuedAt);
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return ageMs > thirtyDaysMs;
}
```

If expired, return `{ error: 'session_expired' }` — the frontend should catch this and
redirect to the login screen, clearing the stored token from `localStorage`.

### A1.5 Failed login throttling

Prevent brute-force against individual accounts. Store per-email counters in
PropertiesService:

```javascript
function logFailedAttempt(email, reason) {
  const key = 'failed:' + email;
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  const record = raw ? JSON.parse(raw) : { count: 0, since: new Date().toISOString() };
  record.count++;
  record.lastAttempt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(record));
  writeAuditLog(email, null, 'login_failed', null, reason, null);
  return { error: 'Wrong email or password.' };
}

function isLockedOut(email) {
  const raw = PropertiesService.getScriptProperties().getProperty('failed:' + email);
  if (!raw) return false;
  const record = JSON.parse(raw);
  if (record.count < 5) return false;
  const lockedSince = new Date(record.lastAttempt);
  const fifteenMins = 15 * 60 * 1000;
  return (new Date() - lockedSince) < fifteenMins;
}

function clearFailedAttempts(email) {
  PropertiesService.getScriptProperties().deleteProperty('failed:' + email);
}
```

After 5 failed attempts for a given email, all login attempts for that email are rejected
for 15 minutes. Clears automatically on successful login.

### A1.6 Password management actions (doPost)

**`changePassword`** — commander changes their own password:
```javascript
} else if (action === 'changePassword') {
  const ctx = getAuthContext(body.authToken);
  if (!ctx || isTokenExpired(ctx)) { output = { error: 'Not authenticated' }; }
  else {
    const commander = findCommanderByEmail(ctx.email);
    if (!verifyPassword(body.currentPassword, commander.salt, commander.passwordHash)) {
      output = { error: 'Current password is wrong.' };
    } else {
      const newSalt = generateSalt();
      const newHash = hashPassword(body.newPassword, newSalt);
      updateCommanderPassword(ctx.email, newHash, newSalt);
      writeAuditLog(ctx.email, ctx.personId, 'change_password', ctx.email, null, body.authToken);
      output = { ok: true };
    }
  }
}
```

**`adminResetPassword`** — admin sets a temporary password for a commander:
```javascript
} else if (action === 'adminResetPassword') {
  const ctx = getAuthContext(body.authToken);
  if (!ctx || ctx.role !== 'admin') { output = { error: 'Not authorised' }; }
  else {
    const newSalt = generateSalt();
    const newHash = hashPassword(body.tempPassword, newSalt);
    updateCommanderPassword(body.targetEmail, newHash, newSalt);
    writeAuditLog(ctx.email, ctx.personId, 'admin_reset_password', body.targetEmail, null, body.authToken);
    output = { ok: true };
  }
}
```

### A1.7 Revocation actions (doPost)

All revocation is admin-only (check `ctx.role === 'admin'` before proceeding).

**Revoke a specific token:**
```javascript
PropertiesService.getScriptProperties().deleteProperty('auth:' + targetToken);
writeAuditLog(ctx.email, ctx.personId, 'revoke_token', targetEmail, 'specific token', body.authToken);
```

**Revoke all tokens for an email** (the "remove access" action — pair with deleting their
Commanders row so future logins also fail):
```javascript
const keys = PropertiesService.getScriptProperties().getKeys();
keys.forEach(function(k) {
  if (k.indexOf('auth:') === 0) {
    const stored = JSON.parse(PropertiesService.getScriptProperties().getProperty(k));
    if (stored.email === targetEmail) {
      PropertiesService.getScriptProperties().deleteProperty(k);
    }
  }
});
writeAuditLog(ctx.email, ctx.personId, 'revoke_all_for_email', targetEmail, null, body.authToken);
```

**Revoke all tokens (full reset):**
```javascript
const keys = PropertiesService.getScriptProperties().getKeys();
keys.filter(function(k) { return k.indexOf('auth:') === 0; })
    .forEach(function(k) { PropertiesService.getScriptProperties().deleteProperty(k); });
writeAuditLog(ctx.email, ctx.personId, 'revoke_all_tokens', null, null, body.authToken);
```

### A1.8 Frontend (login UI)

Replace the existing onboarding/invite-redeem screen with a two-field login form:
email + password. On `session_expired` response from any API call, clear `localStorage`
and return to the login screen. Show a "change password" option in the commander's
profile/settings area.

Admin UI panel (admin role only) exposes: add commander, remove commander (+ revoke their
tokens), reset a commander's password, view audit log.

---

## A2. Audit Log (new)

### A2.1 Purpose

Track who accessed or changed what and when. Provides accountability for a system
holding personnel and medical-status data, and supports debugging if records are disputed.

### A2.2 Sheet tab: `AuditLog`

Append-only. The script's owning account is the only account with Sheet access, so the
log is tamper-evident from the user's perspective (no commander can edit the Sheet directly).

| Column | Field | Notes |
|--------|-------|-------|
| A | `timestamp` | ISO 8601 (`new Date().toISOString()`) |
| B | `email` | Acting commander's email (or `system` for trigger-based actions) |
| C | `personId` | Acting commander's PersonID (from token context) |
| D | `role` | Acting commander's role at time of action |
| E | `action` | Standardised action string (see A2.3) |
| F | `target` | What was affected (email, PersonID, tab name, conduct name, etc.) |
| G | `detail` | Free text — any relevant additional context |
| H | `tokenPrefix` | First 8 chars of the auth token (for correlating a session without storing the full token) |

> **Note:** Google Apps Script cannot retrieve the caller's IP address from a web app
> `doPost` request — `e.parameter` does not expose it. The token prefix is the best
> available session correlator.

### A2.3 Standardised action strings

| Action string | Triggered by |
|--------------|-------------|
| `login` | Successful login |
| `login_failed` | Wrong password (email still recorded for throttle tracking) |
| `logout` | If a logout action is implemented |
| `session_expired` | Server detects expired token (if logged server-side) |
| `change_password` | Commander changes own password |
| `admin_reset_password` | Admin resets another's password |
| `revoke_token` | Admin revokes a specific token |
| `revoke_all_for_email` | Admin revokes all tokens for an email |
| `revoke_all_tokens` | Admin revokes all tokens |
| `add_commander` | Admin adds a Commanders-tab row |
| `remove_commander` | Admin removes a Commanders-tab row |
| `write_medical` | Any Medical-tab write (create or update) |
| `write_leave` | Any Leave-tab write |
| `write_conduct_import` | CSV import committed to conduct log |
| `write_ippt` | IPPT record added/edited |
| `write_roster` | Roster row added/edited (admin only) |
| `write_config` | Config tab edited (admin only) |
| `generate_parade_state` | Parade state message generated (company or platoon) |
| `generate_sick_message` | RS or RSI Personnel message generated |

Add new action strings as needed; keep them lowercase with underscores for consistency.

### A2.4 `writeAuditLog` helper (`Code.gs`)

```javascript
function writeAuditLog(email, personId, action, target, detail, token) {
  try {
    const ss = SpreadsheetApp.openById(
      PropertiesService.getScriptProperties().getProperty('SHEET_ID')
    );
    const sheet = ss.getSheetByName('AuditLog');
    if (!sheet) return;
    const ctx = token ? getAuthContext(token) : null;
    sheet.appendRow([
      new Date().toISOString(),
      email || '',
      personId || '',
      ctx ? ctx.role : '',
      action || '',
      target || '',
      detail || '',
      token ? String(token).slice(0, 8) : ''
    ]);
  } catch (e) {
    Logger.log('AuditLog write failed: ' + e.message);
  }
}
```

Wrap in try/catch so an audit log failure never breaks the primary action it's recording.

### A2.5 Audit log UI

- Accessible via the admin panel only (`role === 'admin'`).
- Displayed as a paginated table (newest first, 50 rows per page).
- Filterable by action type and by email.
- Not exportable from the UI (admin can access the Sheet directly if needed).
- Add `AuditLog` to `readAllTabs` with an admin-role gate — the tab is only pulled when
  the logged-in role is `admin`. Do not include audit log rows in the standard sync pull
  for non-admin roles.

---

## A3. Report Sick Leaderboard (new feature)

Lives in the **Status Board view** (see A4) as a collapsible card at the top.

### A3.1 Data

Derived from the Medical tab. Count per person:
- `rsiCount`: rows where `type === 'RSI'`
- `rsoCount`: rows where `type === 'RSO'`
- `totalRS`: `rsiCount + rsoCount`

Respects the active scope (company / platoon / section via `inScope()`).

### A3.2 Four sort modes

Implemented as tab buttons on the leaderboard card header:

| Tab label | Sort key | Secondary sort |
|-----------|----------|---------------|
| Total | `totalRS` descending | name ascending |
| 4D | `fourD` ascending (numeric; text codes sort after numerics) | name ascending |
| RSI | `rsiCount` descending | `totalRS` descending |
| RSO | `rsoCount` descending | `totalRS` descending |

### A3.3 Layout

- **Collapsed (default):** top 3 entries visible, sorted by current mode. A "show all
  N personnel" tap expands the full list.
- **Expanded:** full sorted list. Each row: rank number · name + B\<4D\> · RSI count badge
  (amber) · RSO count badge (blue) · total count (right-aligned). Personnel with zero
  total RS are included in 4D sort, excluded from RSI/RSO/Total sorts (they'd all be 0).
- The card is collapsible — a chevron toggles it. State persists in `localStorage` so a
  commander who prefers it collapsed doesn't have to re-collapse each visit.

---

## A4. Status Board View (new top-level nav item)

A dedicated view accessible from the main navigation, alongside HA, IPPT, etc.
Contains two components stacked vertically: the Report Sick Leaderboard card (A3)
at the top, and the Status Grid below.

### A4.1 Status Grid — calendar format

The grid organises columns by **week** (Mon–Sun) rather than a flat date sequence.
This is what makes weekly patterns (e.g. "always RSOs on Monday", "RSI cluster
mid-week") immediately visible.

**Layout:**

```
                 ┌─── Week of 19 May ────┐  ┌─── Week of 26 May ────┐
Name             Mon  Tue  Wed  Thu  Fri  Sat  Sun  Mon  Tue  Wed  Thu  ...  Total RS
─────────────────────────────────────────────────────────────────────────────────────
TAN AH KOW B1411 RSI   MC   MC                       RSI                       3
LEE WEI MING     LD   LD         RSO                                            1
GOH ZI YANG                 MR        RSI                                       1
CHUA KAH HENG                              RSI                                  1
```

- **Week header row** spans the 7 day-columns for that week (Mon–Sun), labelled with
  the week's Monday date (e.g. "19 May").
- **Day sub-header row**: Mon / Tue / Wed / Thu / Fri / Sat / Sun.
- Weekend columns (Sat/Sun) are rendered slightly dimmed (`color: var(--color-text-tertiary)`)
  — they exist because training can happen on weekends, but they're visually de-emphasised.
- First column (Name + B\<4D\>) is sticky on horizontal scroll.
- `Total RS` column is the last column, always visible (sticky right if CSS supports it,
  otherwise just the rightmost column).

### A4.2 Cell content and colour coding

Each cell shows the abbreviated status of that person on that date.
If a person has multiple statuses on the same day (e.g. RSI in morning + MR in afternoon),
show the higher-priority one in the cell; the detail panel (A4.4) shows both.

| Status | Abbreviation | Cell colour |
|--------|-------------|-------------|
| RSI | RSI | Amber (`#EF9F27` fill, `#633806` text) |
| RSO | RSO | Blue (`#378ADD` fill, `#042C53` text) |
| MC / ATT C | MC | Red (`#E24B4A` fill, `#501313` text) |
| MR | MR | Purple (`#7F77DD` fill, `#26215C` text) |
| LD / Excuse-\* | LD | Gray (`#B4B2A9` fill, `#2C2C2A` text) |
| Leave / AL / OIL | LV | Teal (`#1D9E75` fill, `#04342C` text) |
| Empty | — | No cell content, no fill |

Status priority — picks the **primary** status (the cell's fill colour) when multiple apply on
the same day (highest wins):
`Leave > MC > LD/Excuse > RSI/RSO > MR`

**Cells are NOT strictly single-status (RESOLVED — option A).** Each cell renders:
- a **primary fill** chosen by the priority above (the dominant "overall situation" colour), **plus**
- a **small secondary marker** (e.g. a corner dot / thin stripe) whenever an **RSI/RSO**
  status co-occurs that day but isn't the primary.

This is deliberate: the priority ranks RSI/RSO and MR near the bottom, but surfacing RSI/RSO
patterns is the whole purpose of this view (A4.5) and the Leaderboard (A3). A strict
single-status cell would hide RSI on any day the person is also on Leave/MC/LD — so the
secondary marker keeps the amber RSI signal visible (e.g. the "Monday RSI stripe") even when
another status dominates the fill. The cell-detail panel (A4.4) always lists every status for
the day in full.

The colour legend appears above the grid, always visible (not collapsible).

### A4.3 Navigation and scope

- **Default range:** last 30 days (~4–5 week columns).
- **Navigation:** "← prev month" / "next month →" buttons page by calendar month.
  "Current month" button returns to today's month. The 30-day default is centred on the
  current date within the current month.
- **Scope selector:** the global scope selector applies. Minimum useful scope is platoon
  (company view with 300 rows is unwieldy — consider showing a warning if Company scope
  is selected and suggesting a platoon scope, but don't block it).
- **Row ordering:** section grouping within the scope (Command first, then Section 1,
  Section 2, …), alphabetical by name within each section. Section divider rows (a subtle
  labelled separator) separate the groups.

### A4.4 Cell detail panel

Tapping a non-empty cell opens a small popover or bottom sheet (not a full modal —
keep it lightweight) showing:

```
TAN AH KOW B1411 — Mon 19 May
─────────────────────────────
RSI
Reason: FEVER, COUGH
Location: PTMC
Follow-up MO: Prescribed 2 days MC
```

If multiple statuses apply that day, list them all in the panel with a divider between.
A close button / tap-outside dismisses it.

### A4.5 Pattern visibility — design intent

The calendar format is specifically chosen so these patterns surface without analysis:
- **Day-of-week clustering:** a person who consistently RSIs on Monday shows a vertical
  amber stripe on the Mon column.
- **MC runs:** consecutive red MC cells are visually obvious as a horizontal block.
- **Repeated RSO:** blue RSO cells scattered across weeks for the same person flags a
  pattern worth a follow-up conversation.
- **Platoon-wide spikes:** a full column with many filled cells on the same date indicates
  a company-wide or platoon-wide illness event.

No algorithmic pattern detection is needed — the visual layout does the work.

### A4.6 Total RS column

Counts RSI + RSO only (not MC, MR, LD, Leave — those are in the grid for context but don't
add to the RS total). This matches the leaderboard's `totalRS` definition so the numbers
are consistent between the two components.

---

## A5. Files affected by this addendum

| File | Changes |
|------|---------|
| `Code.gs` | Replace passcode auth with per-account password auth (A1). Add `writeAuditLog`, `hashPassword`, `verifyPassword`, `generateSalt`, `logFailedAttempt`, `isLockedOut`, `clearFailedAttempts`. Add `login`, `changePassword`, `adminResetPassword`, revocation actions to `doPost`. Add `AuditLog` tab to `readAllTabs` (admin-gated). |
| `js/state.js` | Add `STATE.auditLog`. Add `STATE.statusBoard` for leaderboard sort preference + grid pagination state. |
| `js/helpers.js` | Add `computeRSLeaderboard(scope)` — aggregates RSI/RSO counts per person within scope. Add `buildStatusGrid(scope, startDate, endDate)` — returns week-grouped date structure with per-person status per day. Add `getStatusForDay(personId, date)` — returns highest-priority status from Medical + Leave tabs for a given person-date. |
| `js/render.js` | Add `renderStatusBoard()` — the new top-level view. Add `renderLeaderboard()` — leaderboard card with four sort tabs and collapse. Add `renderStatusGrid()` — calendar-format grid with week headers, sticky name column, colour-coded cells, prev/next month navigation, section grouping. Add `renderCellDetail(personId, date)` — popover with full day detail. Add `renderAuditLog()` — admin-only paginated table in the admin panel. Add login form (email + password). |
| `js/forms.js` | Add `changePassword` form. Add `adminResetPassword` form. |
| Google Sheet | Add `AuditLog` tab (columns per A2.2). Commanders tab: add `passwordHash` and `salt` columns (remove any shared passcode approach). |

---

*End of addendum. Apply alongside `BRAVES_ADAPTATION_SPEC.md`. In case of conflict,
this addendum takes precedence. Recommended instruction to Claude Code: "Read
`BRAVES_ADAPTATION_SPEC.md` and `BRAVES_ADAPTATION_SPEC_ADDENDUM.md` before starting.
The addendum supersedes Section 3 of the main spec. Follow the build order in the main
spec Section 19, treating A1 (auth) as the replacement for Step 1."*

---
---

# Addendum Part 2

Added after the auth/audit-log/leaderboard/status-board work above. Continues the same
numbering scheme (A6 onward). Same precedence rule applies: this addendum overrides the
main spec where they conflict.

---

## A6. Platoon Management (Org Structure Changes)

The main spec (Section 2) assumed a fixed set: HQ + PLT1–4. In practice the company's
platoon structure can change — new platoons added, personnel reassigned between platoons
(and sections). This section makes platoons a managed list rather than a fixed set, and
specifies how reassignment works.

### A6.1 Platoons tab (new) — replaces the fixed PLT1–4/HQ assumption

| Column | Type | Notes |
|--------|------|-------|
| `code` | text | e.g. `HQ`, `PLT1`, `PLT5` |
| `displayName` | text | e.g. `Company HQ`, `Platoon 5` |
| `active` | boolean | `TRUE`/`FALSE` |
| `createdAt` | ISO date | Audit |

- Use an `active` flag, not a hard delete. A retired platoon's historical records (old
  parade states, HA history, IPPT records tied to personnel who were once in it) must
  keep displaying correctly — deleting the row would break those references.
- **Deletion guard:** block setting `active = FALSE` while any Roster row with
  `status = Active` still references that platoon code. Surface a clear message
  ("12 active personnel are still in PLT5 — reassign them first") rather than silently
  failing or silently orphaning records.
- The Roster `platoon` dropdown and the global scope selector (Section 11 of the main
  spec) both derive their option list from `Platoons` where `active = TRUE`, instead of
  a hardcoded array. This is the same "derive, don't hardcode" principle the main spec
  already applies to sections (Section 2) — extend it to platoons too.
- Admin-only to add/rename/retire (role check per Section 3 / A1).

### A6.2 Personnel reassignment

Add a reassignment action to the Roster edit UI — change a person's `platoon` and/or
`section` directly (not by re-entering their whole roster row).

**What happens automatically on reassignment:**
- Their Commanders-tab login (if they have one) reflects the new platoon/section
  immediately on next login — no separate update needed, since Commanders links to
  Roster by `personId` (main spec Section 3.2). This is one of the payoffs of that link.
- **Historical records are not rewritten.** Medical, Leave, IPPT, HA, and Conduct records
  stay tied to the `personId` regardless of platoon history — a person's HA progress and
  IPPT history must carry over across a platoon move. Only forward-looking views (parade
  state, scope-filtered lists, dashboard, Status Board) reflect the new assignment from
  the date of the change onward.
- The reassignment is written to the audit log (A2):
  `writeAuditLog(actorEmail, actorPersonId, 'reassign_personnel', targetPersonId, 'PLT1 Section 2 -> PLT3 Section 1', token)`.

**Who can reassign:** admin role only. Confirmed — platoon PCs do not get reassignment
rights; every move is routed through an admin.

### A6.3 New audit action strings (extends A2.3)

| Action string | Triggered by |
|--------------|-------------|
| `reassign_personnel` | A person's `platoon`/`section` changed |
| `manage_platoons` | A platoon added, renamed, or retired |

---

## A7. Roster Status List (new — third Status Board component)

Adds a third component to the **Status Board** view defined in A4, sitting between the
Leaderboard (A3) and the Status Grid (A4.1):

```
Status Board
├── A3. Report Sick Leaderboard      (who's been sick most — historical ranking)
├── A7. Roster Status List           (what's happening right now — live snapshot)  ← NEW
└── A4. Status Grid (calendar)       (patterns over time — historical detail)
```

This ordering is a default — top to bottom goes ranking → live snapshot → history — easy
to reorder if you'd rather see the live list first.

### A7.1 Purpose

A scrollable, scope-filtered list answering "what's the status of everyone right now,"
at company, platoon, or section level — distinct from the Leaderboard (counts over time)
and the Grid (calendar pattern). This is the closest equivalent to opening the roster and
scanning down it for today's situation.

### A7.2 Reuses the existing parade-state classifier — no new categorisation logic

This view is a different **presentation** of the same per-person classification already
built for the parade state generator (main spec Section 8: priority chain
`REPORTING SICK > ATT C > AL/OIL > STATUS > OTHERS`, with MR evaluated independently and
shown alongside). The classifier function written for Section 9's parade-state generator
is the single source of truth — call it here too rather than re-deriving category logic.

### A7.3 Default columns (the "snippet")

| Column | Source |
|--------|--------|
| R/N | `paradeRN(personId)` (main spec Section 7) |
| Platoon · Section | Roster |
| Today's category | Section 8 classifier output — colour-coded badge, **same palette as the Status Grid** (A4.2) for visual consistency across the two views |
| Reason (truncated) | Classifier's reason string, truncated with a tap-to-expand |
| MR badge (if applicable) | Shown as a small secondary badge — MR is independent of the main category, same relationship as in the parade state itself |
| Ghost tag (if any) | Small muted badge/icon — informational only, not a parade-state category (per main spec Section 8) |

Tapping a row opens the same lightweight detail popover used for Status Grid cells (A4.4)
— reuse the component rather than building a second detail UI.

### A7.4 Scope, ordering, and scroll behaviour

- Respects the global scope selector (company / platoon / section), same `inScope()`
  filtering as every other view (main spec Section 11).
- **Row ordering:** section-grouped, same convention as the Status Grid (A4.3) — Command
  pseudo-section first, then numbered sections ascending, alphabetical by name within
  each group. Section divider rows separate the groups.
- **Pagination:** infinite scroll / "load more" in batches of ~30, rather than numbered
  pages — this is meant for a quick scroll-through, not a paged report.
- **Search:** include a simple name/4D filter at the top — at company scope this list can
  run to ~280 rows, and a filter makes "find this one person's status right now" fast
  without changing scope.

---

## A8. Future Scope Restriction (Platoon-Restricted Views) — specify now, build later

The main spec (Section 11.4) flagged optional future scope restriction without defining
the rule. This section defines the rule precisely, so the architecture stays compatible
with adding it later — **without implementing enforcement now.**

### A8.1 The rule

| Commander's roster position | Visibility |
|---|---|
| Section commander — roster `section` is a numbered section (`1`, `2`, `3`, …) | **Restricted** to their own platoon (their section, sibling sections, and that platoon's `Command` pseudo-section). Cannot view other platoons or company-wide aggregates. |
| Platoon Command — roster `section` = `Command` (i.e. PC/PS) | **Unrestricted** — full company visibility, same as today. |
| HQ personnel — roster `platoon` = `HQ` | **Unrestricted** — full company visibility. |
| `admin` role | **Unrestricted**, always — overrides any positional restriction. |

This maps directly onto the org model already defined in main spec Section 2 — **no new
roster fields are needed.** The restriction is fully derivable from the existing
Commanders→Roster link (`personId` → `platoon` + `section`) established in Section 3.2.

### A8.2 Why this is addable later without a rebuild

Main spec Section 11.3 already requires every view to filter through a single `inScope()`
helper rather than each view implementing its own filtering logic. That decision is what
makes this deferrable cleanly: the restriction becomes one additional check feeding into
`inScope()`, not a change scattered across every view file.

```javascript
// SKETCH ONLY — do not implement yet. Included so the eventual change is a small,
// contained diff rather than a redesign, when/if you decide to build this.
function getEffectiveScope(authContext, requestedScope) {
  if (authContext.role === 'admin') return requestedScope;

  const r = STATE.roster.find(function(x) { return x.id == authContext.personId; });
  const isUnrestricted = !r || r.section === 'Command' || r.platoon === 'HQ';
  if (isUnrestricted) return requestedScope;

  // Section commander: clamp any requested scope to their own platoon.
  if (requestedScope.level === 'company') return { level: 'platoon', platoon: r.platoon };
  if (requestedScope.platoon && requestedScope.platoon !== r.platoon)
    return { level: 'platoon', platoon: r.platoon };
  return requestedScope;
}
```

### A8.3 What real implementation would additionally require (when you build it)

- **Move the check server-side.** Client-side-only restriction is a UX nicety, not
  security — a determined user can read raw network responses. `Code.gs`'s data-serving
  functions (`pullTab`/`readAllTabs`) would need to apply `getEffectiveScope` before
  returning rows to a restricted caller, joining non-roster tabs (Medical, Leave, IPPT,
  Conduct, etc.) back to Roster by `personId` to resolve each row's platoon.
- **Decide the cross-platoon exceptions.** Company-wide parade state generation, company
  sick messages, and Status Board/Leaderboard at company scope are inherently cross-
  platoon. Either explicitly exempt these actions from restriction, or simply don't offer
  company-scope options to restricted users (simpler — a section commander generating a
  *company* parade state was likely never a real use case).
- **Decide whether restriction also applies to writes.** E.g., can a PLT1 section
  commander log a medical record for someone in PLT3? Likely no — mirror the read
  restriction onto writes — but confirm this when you actually implement it.

### A8.4 Status: not implemented

No enforcement code ships as part of this addendum or the main spec. All commanders
retain full company visibility for now, per main spec Section 11.4. This section exists
purely so a future "add platoon restriction" task is a contained, well-defined change
rather than a redesign.

---

## A9. Files Affected — Addendum Part 2

| File | Changes |
|------|---------|
| `Code.gs` | Add `Platoons` tab to `readAllTabs`. Add `manage_platoons` and `reassign_personnel` actions (admin-gated) with audit logging. (No changes for A8 — explicitly deferred.) |
| `js/state.js` | Add `STATE.platoons` (replaces any hardcoded PLT1–4 array). Derive scope-selector and Roster-dropdown platoon options from `STATE.platoons.filter(p => p.active)`. |
| `js/helpers.js` | Add `getClassification(personId)` if not already factored out from the Section 9 parade-state generator — A7 needs to call the same function the parade state uses, not a duplicate. |
| `js/render.js` | Add `renderRosterStatusList()` as the third Status Board component (A7) — reuses the Status Grid's badge palette and cell-detail popover. Add platoon management UI (add/rename/retire) and a reassignment control on the Roster edit screen (A6) — admin-gated. |
| Google Sheet | Add `Platoons` tab (A6.1). No schema changes required for A7 (presentation only) or A8 (deferred). |

---

*End of Addendum Part 2. Apply alongside `BRAVES_ADAPTATION_SPEC.md` and Addendum Part 1
(A1–A5) above. Recommended instruction to Claude Code: implement A6 and A7 as part of the
normal build; treat A8 as documentation only — do not write any enforcement code for it
unless separately instructed.*
