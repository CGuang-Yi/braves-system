/*
 * BRAVES COMPANY DATA SYSTEM — Google Apps Script Backend
 * ═══════════════════════════════════════════════════════
 *
 * AUTH MODEL  (Build-order Step 1 — addendum A1/A2)
 * ──────────
 * Per-account email + password login. State lives in the Accounts/AuditLog tabs
 * and in PropertiesService:
 *
 *   Accounts tab    →  email | personId | role | passwordHash | salt | addedBy | addedAt | caps
 *     • role ∈ {admin, commander, viewer}. Passwords are SHA-256(salt+password)
 *     • caps is a comma-separated capability list ("duty" today) that sits
 *       ALONGSIDE the role ladder rather than on it — see hasCap() below.
 *       with a per-account UUID salt. Bootstrap the first admin from the editor
 *       with seedFirstAdmin(email, password); run setupAuthTabs() once to create
 *       the Accounts + AuditLog tabs.
 *
 *   auth:<token>    →  {email, personId, role, caps, issuedAt}  (in ScriptProperties)
 *     • Issued by the `login` action, stored in the browser, sent with every
 *       request. 30-day expiry (isTokenExpired). Role gates every write: viewers
 *       are read-only; account/token management is admin-only. Revoke from the
 *       admin panel or revokeAllTokensForEmail()/handleRevokeAllTokens.
 *
 *   failed:<email>  →  {count, since, lastAttempt}
 *     • Failed-login throttle: 5 attempts → 15-minute lockout (isLockedOut).
 *
 * LEGACY (removed):
 *   The invite:<token> / redeemInvite auth model has been fully removed —
 *   per-account password login (addendum A1) replaced it. The invite-minting
 *   generators went in PR #70; the redeemInvite handler + its doPost action
 *   went in the token-cleanup pass. Any invite: keys left on the deployment
 *   are inert (nothing can redeem them). The editor-only listInvites/
 *   revokeInvite helpers remain solely to clean those stragglers up.
 *
 * SETUP (first deploy or after pulling these changes)
 * ───────────────────────────────────────────────────
 * 1. Open your Google Sheet → Extensions → Apps Script.
 * 2. Delete any existing code, paste this entire file.
 * 3. Update FRONTEND_BASE_URL below to match where your frontend is hosted.
 * 4. Deploy → Manage deployments → edit your existing deployment →
 *    pick a new Version → Deploy. (Keep the same web-app URL.)
 *    First time only: Deploy → New deployment → Web app:
 *      • Execute as: Me
 *      • Who has access: Anyone
 *      • Copy the Web App URL; paste it into js/state.js (APPS_SCRIPT_URL).
 * 5. Auth is per-account password login (seedFirstAdmin / setupAuthTabs
 *    above) — there is no editor step to mint access. The old invite-link
 *    redemption path has been removed; any pre-existing invite links no
 *    longer work.
 *
 * SHEET TABS REQUIRED (create with headers in Row 1):
 *   Roster:     4d | name | age | status | notes | phone | email |
 *               ration | allergies | msk | highest education level |
 *               motorcycle license | height | weight | role | rank |
 *               leaveQuota | platoon | section | rankGroup | fourD |
 *               appointment
 *               (the column may be named "4d" or "id" — the frontend mirrors
 *                whichever is present into r.id at pull time. height in cm,
 *                weight in kg — BMI is computed client-side. role ∈
 *                {"Recruit", "Commander"} (defaults to Recruit if blank).
 *                Commanders use 4D 0001–0099, are never displayed in the
 *                UI by id — their rank+name shows instead. rank is free
 *                text ("3SG", "2LT", "CPT", "MSG"); leaveQuota is the
 *                off-in-lieu day cap (numeric, optional for recruits).
 *                BRAVES org model (spec §5): platoon ∈ {HQ, PLT1..PLTn};
 *                section ∈ {1..N, "Command" for PC/PS, blank for HQ-flat};
 *                rankGroup ∈ {Officer, WOSPEC, Enlistee} (strength split);
 *                fourD = display 4D (e.g. 1411), blank for no-4D personnel —
 *                separate from `id`, which stays the primary key and may be a
 *                short text code (OC, PC1…) for no-4D personnel.
 *                appointment ∈ {PC, PS, SectComd, blank} — duty-list eligibility
 *                (DUTY_LIST_SPEC.md §5): CDO draws PCs, CDS draws PSs, COS and
 *                PDS draw section commanders. It exists because `section` cannot
 *                separate PC from PS — it reads "Command" for both. Blank falls
 *                back to the org model client-side, which resolves a numbered
 *                section to SectComd but leaves "Command" ambiguous, so PCs and
 *                PSs are the rows actually worth backfilling.)
 *   Medical:    id | d4 | date | reason | location | status | startDate | endDate |
 *               type | urtiType | mrTiming | visitId | origin | bookInDate
 *               (origin ∈ {manual, conductLog}: "conductLog" = auto-created as a
 *                Pending report-sick backfill by a conduct import/wizard for an
 *                absentee not already logged; "manual" = entered in the Medical
 *                tab. Legacy rows default to "manual". Surfaced as a badge.)
 *               (Each row represents a "report sick" event — `date` is the
 *                date the recruit reported sick. `location` is optional —
 *                the clinic/hospital where the recruit reported sick OUTSIDE;
 *                blank for in-camp report sick. status ∈ {MC, Warded, LD,
 *                RMJ, Excuse Heavy Load, Excuse Kneeling, Excuse Squatting,
 *                Excuse Uniform, Excuse RMJ, Excuse Swimming,
 *                Excuse Prolonged Standing, Excuse Upper Limb,
 *                Excuse Lower Limb, Pending, NIL}.
 *                NIL = MO saw the recruit and cleared them with no status.
 *                startDate/endDate are display-format dates ("16 May 2026")
 *                and BOTH ENDS ARE INCLUSIVE. Pending and NIL may have no
 *                startDate/endDate. After endDate, MC and LD get a 2-day
 *                "ghost" tag (MC+1, MC+2, LD+1, LD+2) computed client-side
 *                — not stored.
 *                BRAVES §6: `type` = visit type ∈ {RSI, RSO, MR, …} (distinct
 *                from `status`, the MO outcome); urtiType ∈ {URTI, NON-URTI}
 *                (meaningful for RSI/RSO); mrTiming = optional free-text MR
 *                timing; visitId groups sibling rows of one multi-status visit.
 *                The "follow up status from MO" in sick messages is derived
 *                from `status` (the MO outcome) — there is no separate field.)
 *   Attendance: id | date | time | conductId | total | participating | lms | px | fallout | remarks
 *               | participants | periods | currencyTags | source | statusReviewed
 *               (statusReviewed = TRUE once the Log Conduct wizard has saved this
 *                conduct's status checklist; controls whether re-opens default
 *                medically-restricted-but-present recruits to ticked. Auto-added
 *                by upsertRow's ensureColumnsForKeys — no migration needed.)
 *               (Braves §14 CSV-import columns: participants = comma-joined
 *                Present 4Ds [the HA participation source]; periods = CSV cell
 *                B5 [Double-HA time-period count]; currencyTags = CSV row 2
 *                [HA-eligibility signal, e.g. "HA"]; source = "csv" for imported
 *                rows, "" for wizard rows. See HA_DATA_SHAPE.md.)
 *               (time = "0730"/"1630" — same conduct on the same day at
 *                different times produces distinct rows. The Log Conduct
 *                wizard writes it directly; the legacy form leaves it blank.)
 *               (RSI removed from summary — morning report-sicks belong in
 *                the Medical log, not duplicated per-conduct. Legacy `rsi`
 *                column may still exist on older sheets; safe to delete.)
 *               (lms = how many of the participating recruits attended LMS for this conduct;
 *                LMS participation rate = lms / participating, computed client-side)
 *               (px = count of recruits on pre-existing medical status who
 *                did NOT participate. Renamed to "Status" in the UI but the
 *                sheet column name stays `px` for history continuity.)
 *               (remarks = free-text flags on data inconsistencies / per-recruit notes)
 *   IPPT:       id | d4 | attempt | date | pushups | situps | runTime | score
 *   RouteMarch: id | d4 | rmNum | date | time | avgHr | maxHr | pass
 *   SOC:        id | d4 | socNum | date | time | avgHr | pass
 *   PolarFlow:  id | d4 | conductId | date | avgHr | maxHr | minHr | z1 | z2 | z3 | z4 | z5 | calories | trainingLoad | recovery | duration | distance
 *               (the live sheet keys conducts by `conductId` per the registry
 *                model; the z1–z5/recovery zone columns are OCR-populated and may
 *                be absent on sheets that predate them.)
 *   ConductDetail: id | date | time | conductId | d4 | type | reason | eventTime
 *               (TWO different times, deliberately. `time` is the CONDUCT's time
 *                and is part of the (date, time, conductId) key the log-conduct
 *                wizard matches stored rows on — never write a per-person value
 *                into it. `eventTime` is when THAT PERSON dropped out, autofilled
 *                from the clock when the wizard's + Add is pressed and editable
 *                after; blank on every row type but Fallout and ReportSick, and
 *                blank on rows predating the column. Both are in
 *                WRITE_TEXT_COLS_BY_TAB — "0730" would otherwise land as 730.)
 *               (one row per non-participating recruit per conduct.
 *                type ∈ {Status, PXP, RSI, Fallout, ReportSick}:
 *                  Status     = pre-existing status absence (MC/LD/Excuse/Leave/Off).
 *                               Formerly stored as "PX"; legacy "PX" rows are
 *                               migrated to "Status" on read by the CLIENT
 *                               (js/state.js normalizeConductDetail). The Apps
 *                               Script side does NOT migrate — bravesLoadState_
 *                               reads raw values — but no .gs logic branches on
 *                               this `type`, so the un-migrated sheet value is
 *                               inert server-side. (A future one-time sheet
 *                               rewrite could converge both; not done yet.)
 *                  PXP        = present but NOT participating — doing PX (stretches).
 *                               NOT an absence: excluded from every absent/missed
 *                               tally. Displayed as "PX"; stored as "PXP" so the
 *                               legacy PX→Status read-migration never clobbers a
 *                               genuine present-not-participating row.
 *                  RSI        = reporting sick at first parade that morning;
 *                  Fallout    = dropped out during the conduct itself;
 *                  ReportSick = sent to MO mid-day after the conduct.
 *                Aggregates in the Attendance sheet should match the
 *                per-conduct totals of these rows [Status counts toward `px`].)
 *
 *   Appointments: id | d4 | reason | date | time | location | outOfCamp | resolved
 *               (Booked future events — medical specialist visits, IPPT
 *                retakes, board appearances, etc. Sheet keeps full history;
 *                dashboard only shows entries where date >= today. date is
 *                display-format ("16 May 2026"); time is free text ("0930").
 *                outOfCamp = TRUE when the recruit leaves camp for the appt
 *                (shown in the parade state's MEDICAL APPT "Camp:" line);
 *                resolved = TRUE hides it from the dashboard + parade state.)
 *
 *   Leave:      id | d4 | type | startDate | endDate | days | reason | isInCamp | isInCampReviewed | bookInDate
 *               (Personnel absences. type ∈ {Leave, Compassionate,
 *                Off-in-Lieu, Weekend, Night's Out, Course, Guard Duty,
 *                NDP, Other}. Only
 *                Off-in-Lieu decrements the per-commander leaveQuota
 *                (roster field). Night's Out = same-day evening off-camp
 *                (start = end = same date). startDate/endDate inclusive,
 *                display-format. `days` is numeric — defaults to
 *                (endDate − startDate + 1) but is editable for half-days.
 *                isInCamp = explicit TRUE/FALSE the commander picks per
 *                record — whether this leave/out counts toward CURRENT
 *                STRENGTH (e.g. Guard Duty is working, so counts as
 *                present). Every row saved through the Leave form carries
 *                an explicit value; blank (legacy/un-migrated rows) reads
 *                as FALSE (Not In Camp). See bpClassifyPerson.
 *                isInCampReviewed = FALSE flags a row the sick-history
 *                importer auto-created (isInCamp defaulted, not confirmed
 *                by a commander) so the UI can show a "confirm" badge;
 *                cleared to TRUE the moment the row is saved through the
 *                Leave form.)
 *
 *   MSK:        timestamp | d4 | type | description | physioDate | exercises | cleared | manualRegions
 *               (Recruit self-reports from a Google Form ("Cougar MSK /
 *                Physio Log") that posts directly here. type ∈
 *                {"Report Injury", "Log Exercises"}. `cleared` is NOT
 *                in the form — manually add the column header after the
 *                first form response lands, leave new rows blank. The
 *                dashboard's "Mark Cleared" action writes TRUE; runs
 *                via the standard pushTab so cleared bits round-trip on
 *                the next Push All.)
 *
 *   ── BRAVES reference tabs (optional; absent tab → [] on the frontend) ──
 *   Config:     (Archive-scheduler config — a single columns-as-keys row:
 *                archiveParadeTimes | archiveSickTimes.
 *                Read by the unattended archive cron (bravesParseParadeSlots_ /
 *                bravesSickSlots_), which is why this tab outlived the Telegram
 *                bot that originally owned it — do NOT rename or reshape it.
 *                readAllTabs merges its row into STATE.config so the frontend
 *                sees the archive-time keys alongside BravesConfig. Created by
 *                setupConfigTab_.)
 *   BravesConfig: key | value
 *               (Transferability layer, spec §4 — split out from the columns-as-keys
 *                Config tab so the two schemas never collide. Each row is one setting:
 *                companyName, companyPrefix (4D display prefix, e.g. "B"),
 *                companyCoyCode ("B COY"), unitCode ("40SAR"), hqLabel
 *                ("BRAVES HQ"), defaultSickLocation ("PTMC"),
 *                polarCompanyName, haEligibilitySource
 *                ("isHAExcluded" | "currencyTag"). Missing keys fall back to
 *                DEFAULT_CONFIG in js/state.js. Seeded by bravesMigrateSchema();
 *                admin-only to edit.)
 *   VocFit:     personId | completionDate | certifyingUnit
 *               (Vocational Fitness Training completions, spec §12.3 — gates
 *                Double-HA eligibility together with rank ≥ 3SG/2LT.
 *                certifyingUnit optional.)
 *   Platoons:   code | displayName | active | createdAt
 *               (Managed platoon list, addendum A6.1 — replaces the hardcoded
 *                HQ+PLT1–4 assumption. code ∈ {HQ, PLT1, …}; active=FALSE
 *                retires a platoon without deleting history. Scope selector +
 *                Roster platoon dropdown derive options from active rows.)
 *   Duty:       id | date | dutyType | platoon | d4 | assignedBy | assignedAt | source
 *               (Duty roster, DUTY_LIST_SPEC.md §3.1. date is ISO YYYY-MM-DD —
 *                NOT the "01 Jan 2026" form older tabs use. dutyType comes from
 *                the Config key dutyTypes. platoon is the LITERAL platoon at the
 *                time of assignment (e.g. "PLT3"), blank for company-scoped
 *                types; it is never re-resolved against the current roster, so a
 *                commander transferring platoon cannot rewrite history or move a
 *                past total. source ∈ {manual, import, auto} — "auto" marks a row
 *                that originated from the scheduler's proposal.)
 *   DutyCorrection: id | date | d4 | reason | delta | note | enteredBy | enteredAt
 *               (Manual point adjustments, §3.2. delta is a signed number,
 *                defaulting from the reason's entry in the Config key
 *                dutyCorrectionReasons and overridable per row. There is
 *                deliberately NO "Public Holiday" reason: PH is applied natively
 *                by the points engine from the Holidays tab, so a PH correction
 *                row would double-count.)
 *   Holidays:   date | name | tentative
 *               (§3.3. A holiday is the highest day weight at 5 points, so a
 *                tentative one that never materialises would silently overpay by
 *                4. tentative rows still score 5 but are flagged in the UI and in
 *                the import reconciliation report, making that visible rather
 *                than silent.)
 *   DutyUnavailable: id | d4 | from | to | note | addedBy | addedAt
 *               (Soft "probably unavailable" windows, design §4. from/to are
 *                INCLUSIVE ISO YYYY-MM-DD bounds. This is NOT leave, MC or an
 *                appointment — those are real records the parade classifier
 *                already resolves and dutyConflicts already treats as hard
 *                conflicts. This is the UNCONFIRMED case: leave not yet applied
 *                for, a course nomination not yet published, an exam block. It is
 *                deliberately outside the classifier — a soft planning hint must
 *                never influence parade state — and its only consumer is a
 *                highlight on the duty grid and the dashboard duty card.
 *                d4/from/to are in WRITE_TEXT_COLS_BY_TAB: Sheets would otherwise
 *                coerce "0042" to 42 and re-serve the dates as "01 Sep 2026".)
 *   DutyChangeRequest: id | submittedBy | submittedAt | date | dutyType | platoon |
 *                kind | fromD4 | toD4 | swapDate | swapDutyType | swapPlatoon |
 *                reason | status | decidedBy | decidedAt | decisionNote
 *               (Proposed changes to the duty roster, design §3. `kind` is one of
 *                add | remove | reassign | swap; `status` is Pending | Approved |
 *                Rejected.
 *
 *                The swap* triple is the COUNTERPARTY's slot and is blank for
 *                every other kind. It exists because a swap needs two slots and
 *                the primary date/dutyType/platoon triple only describes one:
 *                a trade between two different dates cannot be expressed
 *                otherwise, and inferring the second slot from the counterparty's
 *                other duties resolves ambiguously and silently whenever they
 *                hold more than one.
 *
 *                WRITES ARE SPLIT BY ACTION, not by tab — see dcrGuardWrite_.
 *                Any commander may `append` (submit); `status` and the decided*
 *                columns are server-owned and only ever change through the
 *                decideDutyRequest action, which needs the `duty` capability.
 *                upsertRow is refused outright: without that refusal a submitter
 *                could simply upsert their own row to Approved, which would make
 *                the whole approval gate decorative.
 *
 *                fromD4/toD4/date/swapDate are in WRITE_TEXT_COLS_BY_TAB, same
 *                coercion trap as above.)
 */

var FRONTEND_BASE_URL = "https://cguang-yi.github.io/braves-system/";

// ─── ROUTING ───────────────────────────────────────────

// GET answers exactly one action: ping.
//
// It used to answer the four read actions as well, which forced every read —
// the launch pull and the 20-second revCheck poll among them — to carry the
// 30-day session token as a query parameter, where it lands in the deployment's
// request logs and in any Referer the page emits. Those routes moved to POST
// (token in the body); this is the second half of that move, deleting the GET
// arm now that no live client uses it.
//
// The two-deploy sequencing mattered and is worth recording: a phone holding a
// cached index.html keeps talking to whatever is deployed, so the GET route had
// to outlive the frontend change by one deploy. Cutting both at once would have
// signed out every stale client with an error it could not interpret. Do not
// re-add a read here to "help" an old client — re-adding it re-opens the leak
// for everyone.
//
// ping itself is the ONE action that answers without a token, so it answers as
// little as possible: is the deployment reachable, and what time does it think
// it is. Nothing about the spreadsheet behind it. (It used to return the tab
// list, which was only ever cosmetic — the Sync log printed it, and
// readAllTabs pulls from an explicit allow-list, not from this. A liveness
// check that describes the schema to anyone holding the URL is a poor trade for
// a log line, so the list is gone rather than filtered.)
function doGet(e) {
  var output;
  try {
    var action = e.parameter.action || "";

    if (action === "ping") {
      output = { ok: true, timestamp: new Date().toISOString() };
    } else {
      output = { error: "Unknown action. GET answers only ping; reads go over POST." };
    }
  } catch (err) {
    output = { error: err.message };
  }

  return jsonResponse(output);
}

// The read routes. doPost is the only caller — see doGet above for why GET no
// longer answers reads at all.
//
// Kept as its own function rather than folded back into doPost because the
// per-tab gating below is the security-bearing part of the read path and reads
// better with the write router out of the way. `params` is the parsed request
// body, and the only field this reads off it is `tabs`.
//
// `ctx` is already resolved and unexpired — doPost does that before getting
// here, because an expired session must answer session_expired regardless of
// which action was asked for.
function routeRead(action, tab, params, ctx) {
  if (action === "readAll") {
    return readAllTabs(ctx);                // ctx → AuditLog included only for admins
  } else if (action === "revCheck") {
    // Cheap "what changed?" poll — just the per-tab revisions, no row data.
    //
    // `revs` values stay NUMBERS. Folding the report-sick scope into the
    // Medical/MSK rev as "<rev>:<key>" was considered and rejected: it breaks
    // two live call sites — js/sync.js filters changed tabs with
    // Number(a) > Number(b) (NaN, so the tab reads as never-changed) and
    // js/api.js round-trips the rev back as baseRev, which withRevLock also
    // coerces (NaN, so every whole-tab write is rejected as a conflict). The
    // scope therefore travels as its own additive field; a client that
    // ignores it behaves exactly as before.
    return { ok: true, revs: getAllRevs(), scopeKey: rsScopeKey_(rsScopeOf_(ctx)),
             timestamp: new Date().toISOString() };
  } else if (action === "read" && tab) {
    if (tab === "AuditLog" && ctx.role !== "admin") {
      return { error: "Not authorised", code: 403 };
    } else if ((tab === "ParadeArchive" || tab === "SickArchive") && !canWrite(ctx)) {
      return { error: "Not authorised", code: 403 };  // archives: commander + admin (Fix1B)
    } else if (tab === "Accounts") {
      return { error: "Not authorised", code: 403 };  // never expose hashes via raw read
    } else if (tab === "SickArchive" && !rsScopeOf_(ctx).company) {
      return { rows: [], rev: getRev(tab) };
    } else {
      // Single-tab read for partial pulls; carries the tab's current revision
      // so the client can baseline it. (Untracked tabs report rev 1.)
      return { rows: rsApplyReadScope_(tab, readTab(tab), ctx), rev: getRev(tab),
               scopeKey: rsScopeKey_(rsScopeOf_(ctx)) };
    }
  } else if (action === "readTabs" && params.tabs) {
    // Batched partial pull (SYNC_PERF_IMPROVEMENTS_SPEC.md P2-1): N tabs in ONE
    // request instead of N parallel `read` GETs. Read-only, no lock needed — same
    // as the single-tab `read` route above, just looped. Per-tab shape is
    // identical to `read`'s ({rows, rev}), keyed by tab name under `tabs`.
    //
    // Gating choice: apply the SAME per-tab gating as `read`, but per-tab —
    // a disallowed tab (AuditLog/archives for non-admins, Accounts always) gets
    // its own {error, code} entry under tabs[name] instead of failing the whole
    // batch. This composes best with the frontend fallback/normalization path,
    // which already assigns per-tab and can skip/ignore an errored entry the
    // same way it would skip a tab it never requested. Unknown tab names mirror
    // `readTab`'s own not-found shape (rows becomes {error, available}), exactly
    // as the single-tab route already does today (no extra handling needed).
    var reqTabs = params.tabs.split(",").map(function (t) { return t.trim(); }).filter(function (t) { return t; });
    var tabsOut = {};
    for (var ti = 0; ti < reqTabs.length; ti++) {
      var rt = reqTabs[ti];
      if (rt === "AuditLog" && ctx.role !== "admin") {
        tabsOut[rt] = { error: "Not authorised", code: 403 };
      } else if ((rt === "ParadeArchive" || rt === "SickArchive") && !canWrite(ctx)) {
        tabsOut[rt] = { error: "Not authorised", code: 403 };  // archives: commander + admin (Fix1B)
      } else if (rt === "Accounts") {
        tabsOut[rt] = { error: "Not authorised", code: 403 };  // never expose hashes via raw read
      } else if (rt === "SickArchive" && !rsScopeOf_(ctx).company) {
        tabsOut[rt] = { rows: [], rev: getRev(rt) };
      } else {
        tabsOut[rt] = { rows: rsApplyReadScope_(rt, readTab(rt), ctx), rev: getRev(rt) };
      }
    }
    return { ok: true, tabs: tabsOut, scopeKey: rsScopeKey_(rsScopeOf_(ctx)) };
  } else {
    return { error: "Unknown action. Use: readAll, revCheck, read + tab, or readTabs + tabs" };
  }
}

// The four actions routeRead answers. doPost consults this before falling
// through to the write router, so a read asked for over POST is not mistaken
// for an unknown write action.
function isReadAction(action) {
  return action === "readAll" || action === "revCheck"
      || action === "read" || action === "readTabs";
}

function doPost(e) {
  var output;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || "write";
    var tab = body.tab || "";
    var auth = body.auth || "";

    // Public action: log in with email + password → returns a per-device auth token.
    if (action === "login") {
      output = handleLogin(body);
    } else {
      // Everything else requires a valid, unexpired account session. Role-gating
      // (viewer read-only; admin-only management) happens inside routeAuthedPost.
      var ctx = getAuthContext(auth);
      if (!ctx) {
        output = { error: "Unauthorized — please log in", code: 401 };
      } else if (isTokenExpired(ctx)) {
        output = { error: "session_expired", code: 401 };
      } else if (isReadAction(action)) {
        // Reads over POST so the token travels in the body rather than the URL.
        // Same routeRead the GET path uses, so the per-tab gating is identical
        // by construction and there is no second copy to keep in step.
        output = routeRead(action, tab, body, ctx);
      } else {
        output = routeAuthedPost(action, tab, body, ctx);
      }
    }
  } catch (err) {
    output = { error: err.message };
  }

  return jsonResponse(output);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── AUTH ──────────────────────────────────────────────

// One-time admin: store the Anthropic API key in script properties so
// analyzePhotoHelper can read it without exposing the key to the public
// web app URL. Run from the editor:  setAnthropicKey("sk-ant-…")
// (then DELETE the literal from your editor history so it doesn't sit
// in your git history or screenshare).
function setAnthropicKey(key) {
  if (!key || String(key).indexOf("sk-ant-") !== 0) {
    Logger.log("Refusing to store — key should start with sk-ant-");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("ANTHROPIC_API_KEY", key);
  Logger.log("Key stored. Length: " + key.length);
}

// Proxies a Claude vision call to extract Polar class summary data from
// a photo. Frontend sends:
//   { imageBase64: "...", mediaType: "image/jpeg", validD4s: ["1101", ...] }
// Returns:
//   { recruits: [{d4, avgHR, maxHR, calories, duration}], notes, raw }
//   { error: "..." } on any failure (missing key, API error, parse error).
function analyzePhotoHelper(body) {
  if (!body || !body.imageBase64) return { error: "Missing imageBase64" };

  var key = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!key) {
    return { error: "Anthropic API key not set. Run setAnthropicKey('sk-ant-…') from the Apps Script editor once." };
  }

  var validD4s = Array.isArray(body.validD4s) ? body.validD4s : [];
  var mediaType = body.mediaType || "image/jpeg";

  var systemPrompt = "You analyse photos of Polar Flow class summary screens for a Singapore Army training company (Cougar Coy). " +
    "Each photo is a screenshot of the Polar Flow app's class summary, showing a table where every row is one recruit's session: " +
    "their 4D number, average heart rate (bpm), maximum heart rate (bpm), calories burned (kcal), and session duration. " +
    "Recruit 4D numbers are exactly 4 digits (e.g. 1101, 4213).\n\n" +
    "COMPLETENESS IS CRITICAL. Missing rows is the #1 failure mode. Follow this procedure:\n" +
    "1. First, look at the entire image and COUNT the total number of recruit rows visible (top to bottom). Call this N.\n" +
    "2. Extract EVERY row, one by one, top to bottom. Do not skip rows. Do not summarise.\n" +
    "3. Before responding, verify your `recruits` array has exactly N entries. If it doesn't, go back and find the missing rows.\n" +
    "4. Set `rowCount` in your response to N (your initial count) so the operator can spot truncation.\n\n" +
    "Valid recruit 4Ds in this company: " + validD4s.join(", ") + ".\n" +
    "Use this list to RESOLVE AMBIGUITY when a digit is unclear (e.g. you read '1108' but only '1109' is in the list — prefer '1109'). " +
    "DO NOT drop a row just because its 4D isn't in the list — include it and set `unverified: true` so the operator can review. " +
    "Dropping rows silently is much worse than including a slightly-wrong 4D.\n\n" +
    "Respond ONLY with a JSON object, no markdown fences, no explanation outside the JSON:\n" +
    "{\n" +
    "  \"rowCount\": 22,\n" +
    "  \"recruits\": [\n" +
    "    {\"d4\": \"1108\", \"avgHR\": 155, \"maxHR\": 185, \"calories\": 420, \"duration\": 25},\n" +
    "    {\"d4\": \"1109\", \"avgHR\": 148, \"maxHR\": 178, \"calories\": 380, \"duration\": 25, \"unverified\": true},\n" +
    "    ...\n" +
    "  ],\n" +
    "  \"notes\": \"optional one-line observation (e.g. 'rows 18-20 blurry', or empty string)\"\n" +
    "}\n\n" +
    "Numbers should be integers (no units, no 'bpm' text). If a single field for a row isn't readable, omit that key from the object but STILL include the row. " +
    "If you can't read any data at all, return { \"rowCount\": 0, \"recruits\": [], \"notes\": \"no Polar data detected\" }.";

  var payload = {
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: body.imageBase64 } },
        { type: "text", text: "Extract every recruit row from this Polar class summary. Count rows first, then extract — do not skip any." }
      ]
    }]
  };

  try {
    var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code < 200 || code >= 300) {
      // Try to surface Anthropic's error message.
      try { var errObj = JSON.parse(text); return { error: "Anthropic " + code + ": " + (errObj.error && errObj.error.message || text) }; }
      catch (e) { return { error: "Anthropic " + code + ": " + text.slice(0, 200) }; }
    }

    var resp = JSON.parse(text);
    var raw = "";
    (resp.content || []).forEach(function (block) { if (block.type === "text") raw += block.text; });
    // Strip markdown code fences Claude sometimes emits despite being told not to.
    var clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    var parsed;
    try { parsed = JSON.parse(clean); }
    catch (e) { return { error: "Could not parse Claude response as JSON", raw: clean.slice(0, 500) }; }

    if (!parsed.recruits) parsed.recruits = [];
    // Surface rowCount so the frontend can warn the user when the extracted
    // row count is less than Claude's own count of visible rows (= truncation).
    return {
      recruits: parsed.recruits,
      rowCount: parsed.rowCount != null ? +parsed.rowCount : parsed.recruits.length,
      notes: parsed.notes || ""
    };
  } catch (e) {
    return { error: "Network/UrlFetch error: " + e.message };
  }
}

// Sends a single HTML email via the script owner's Gmail. Used by the
// dashboard's Fitness Report sender — one POST per recruit. Returns the
// remaining daily quota so the frontend loop can abort cleanly when 0.
// MailApp quota: 100/day on free Gmail, 1500/day on Workspace.
function sendEmailHelper(body) {
  if (!body || !body.to) return { error: "Missing recipient" };
  var remaining = MailApp.getRemainingDailyQuota();
  if (remaining <= 0) return { error: "Daily quota exhausted", remainingQuota: 0 };

  // Convert any inline image base64 strings into Blob objects so MailApp
  // can attach + reference them via cid:. Gmail blocks data: URIs in
  // <img src>, but cid: works fine. Frontend sends:
  //   inlineImages: { "chart_0": "iVBORw0KGgo...", "chart_1": "..." }
  // and the htmlBody contains <img src="cid:chart_0">.
  var inlineImages = {};
  if (body.inlineImages && typeof body.inlineImages === "object") {
    for (var key in body.inlineImages) {
      var b64 = String(body.inlineImages[key] || "");
      if (b64.indexOf("base64,") !== -1) b64 = b64.split("base64,")[1];
      if (!b64) continue;
      inlineImages[key] = Utilities.newBlob(Utilities.base64Decode(b64), "image/jpeg", key + ".jpg");
    }
  }

  try {
    var opts = {
      to: body.to,
      subject: body.subject || "Cougar Fitness Report",
      htmlBody: body.htmlBody || "",
      name: "Cougar Coy Training"
    };
    if (Object.keys(inlineImages).length) opts.inlineImages = inlineImages;
    MailApp.sendEmail(opts);
    return { ok: true, remainingQuota: MailApp.getRemainingDailyQuota() };
  } catch (e) {
    return { error: e.message, remainingQuota: remaining };
  }
}

// ─── ADMIN FUNCTIONS — run from the Apps Script editor ─

// Editor-only invite helpers (bulkInviteStatus / listInvites / revokeInvite):
// the invite auth model was replaced by per-account password login (addendum
// A1), and the invite *generators* were deleted in PR #70, so no new invite:
// ScriptProperties can be minted. These three survive ONLY as the one-time
// cleanup path for any leftover invite: keys still sitting on the live
// deployment — run listInvites() there, revokeInvite() each straggler, then
// delete all three. See TOKEN_CLEANUP_SPEC.md.

// Print redemption count + timestamps for a bulk invite. Auth tokens are not
// printed to keep the log safe to screenshot.
function bulkInviteStatus(token) {
  var raw = PropertiesService.getScriptProperties().getProperty("invite:" + token);
  if (!raw) { Logger.log("No invite with token: " + token); return; }
  var inv = JSON.parse(raw);
  Logger.log("Invite " + token);
  Logger.log("  type:    " + (typeof inv.maxUses === "number" ? "bulk" : "single-use"));
  if (typeof inv.maxUses === "number") {
    Logger.log("  uses:    " + (inv.usedCount || 0) + " / " + inv.maxUses);
    Logger.log("  expires: " + (inv.expiresAt || "(no expiry)"));
    Logger.log("  redemptions:");
    (inv.redemptions || []).forEach(function (r, i) {
      Logger.log("    " + (i + 1) + ". " + r.at);
    });
  } else {
    Logger.log("  used:    " + !!inv.used + (inv.usedAt ? " at " + inv.usedAt : ""));
  }
}

function listInvites() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var rows = [];
  for (var key in props) {
    if (key.indexOf("invite:") === 0) {
      rows.push(key + " → " + props[key]);
    }
  }
  Logger.log("Invites (" + rows.length + "):");
  rows.forEach(function (r) { Logger.log(r); });
}

function listAuthTokens() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var rows = [];
  for (var key in props) {
    if (key.indexOf("auth:") === 0) {
      rows.push(key + " → " + props[key]);
    }
  }
  Logger.log("Auth tokens (" + rows.length + "):");
  rows.forEach(function (r) { Logger.log(r); });
}

function revokeAuthToken(token) {
  PropertiesService.getScriptProperties().deleteProperty("auth:" + token);
  Logger.log("Revoked auth token: " + token);
}

function revokeInvite(token) {
  PropertiesService.getScriptProperties().deleteProperty("invite:" + token);
  Logger.log("Revoked invite: " + token);
}

// Nuclear option: kicks every authenticated device. Each user will need to log
// in again to regain access. Only issued auth tokens are deleted.
function revokeAllAuthTokens() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var count = 0;
  for (var key in all) {
    if (key.indexOf("auth:") === 0) {
      props.deleteProperty(key);
      count++;
    }
  }
  Logger.log("Revoked " + count + " auth token(s). Every device must log in again.");
}

// ═══════════════════════════════════════════════════════
// ACCOUNT / PASSWORD AUTH  (Build-order Step 1 — addendum A1 & A2)
// ═══════════════════════════════════════════════════════
//
// The auth model: per-account email+password login (it replaced the removed
// invite-token flow).
//   Accounts tab : email | personId | role | passwordHash | salt | addedBy | addedAt | caps
//                  role ∈ {admin, commander, viewer}. personId → Roster id (4D);
//                  stored + returned but the Roster link is soft (not required to
//                  log in) — name/platoon/etc. are derived downstream (Step 2/3).
//   AuditLog tab : timestamp | email | personId | role | action | target | detail | tokenPrefix
//   auth:<token> : { email, personId, role, issuedAt } in ScriptProperties.
//                  Legacy invite tokens (no `role`) are treated as invalid so every
//                  device is forced through the new login.
//
// Password hashing: PBKDF2-HMAC-SHA256, per-account UUID salt (see hashPassword).
// This replaced a single unsalted-iteration SHA-256(salt + password) — see the
// KDF block below for why, and for the transparent upgrade path that rewrites
// legacy hashes the next time each account logs in.

// Session lifetime. Cut from 30 days to 7 (BACKEND_MIGRATION_REVIEW.md §4.6
// item 5, §4.7.7). This is not cosmetic: the bearer token, not the account row,
// is what actually bounds access, so at 30 days a departed member kept working
// access for up to a month AFTER their account was removed — which made the ORD
// deprovisioning link (§4.7.7) unenforceable and put the system outside IM8
// ac-3's "disabled within a defined window of last authorised use". Seven days
// is the trade: a week of re-logins against a month-long hole. Anything longer
// re-opens it; much shorter and people start writing the password down.
var SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7-day session expiry
var LOCKOUT_THRESHOLD = 5;                       // failed attempts before lockout
var LOCKOUT_WINDOW_MS = 15 * 60 * 1000;          // 15-minute lockout

// P2-4: every data write appends a row to AuditLog forever, so an admin's
// readAll would otherwise ship the WHOLE history on every full pull — server
// read time and payload size growing unboundedly with total system usage.
// Cap the in-response window to the most recent N rows; the Sheet itself
// stays the complete, unbounded authoritative trail (readAllTabs/readTabTail
// below). N=500 chosen as the admin-facing in-app window (spec §7 Q1).
var AUDIT_READALL_MAX_ROWS = 500;

// ── Password KDF (BACKEND_MIGRATION_REVIEW.md §4.6 item 5) ───────
//
// Was: SHA-256(salt + password), one pass. The per-account salt defeats rainbow
// tables, but SHA-256 is a *fast* hash — a leaked Accounts tab is brute-forceable
// at billions of guesses/sec on a commodity GPU, which for the 6–12 character
// human passwords this system actually holds means hours, not centuries.
//
// Now: PBKDF2-HMAC-SHA256. Apps Script has no bcrypt/scrypt/argon2 and no way to
// call one, so genuinely memory-hard is off the table here; iteration count is
// the only cost knob available. That is a weaker answer than the review asked
// for and it is worth naming: PBKDF2 raises the attacker's cost by the iteration
// factor, no more. It is still 4–5 orders of magnitude better than one SHA-256.
//
// Iteration count is a SERVER-SIDE latency budget: every login pays it, inside
// Apps Script's execution limits, on their CPU not ours — and each round is a
// separate Utilities.* bridge call, far more expensive than a native HMAC, so
// the usable ceiling here is well below the 600k+ you would pick on an ordinary
// server.
// **Run bravesBenchmarkKdf() in the Apps Script editor after deploying** and tune
// this to taste: the count is stored inside each hash, so raising or lowering it
// invalidates nothing.
//
// MEASURED on this project (2026-08-04, bravesBenchmarkKdf): ~1.67 ms per
// iteration — 10k took 16,650 ms per login. That is ~16x slower than the "about
// a second at 10k" this comment used to guess, because each round is a separate
// Utilities.* bridge call rather than a native HMAC. Do not re-derive the guess;
// re-run the benchmark if the project moves. 2000 buys ~3.3 s per login, which
// is the accepted ceiling here given how rarely people log in.
var PBKDF2_ITERATIONS = 2000;
var PBKDF2_PREFIX = "pbkdf2$sha256$";   // pbkdf2$sha256$<iters>$<hex>

// PBKDF2 with dkLen == hLen, i.e. exactly one block (T_1), which is all we need
// for a 256-bit derived key. Written out rather than pulled from a library
// because Apps Script has no crypto module beyond Utilities.
// Byte-array overloads throughout: U_1 = HMAC(P, S || INT32BE(1)) per RFC 8018
// §5.2, and that trailing 0x00000001 cannot be expressed via the string overload.
function pbkdf2Sha256_(password, salt, iterations) {
  var pwBytes = Utilities.newBlob(String(password)).getBytes();
  var saltBytes = Utilities.newBlob(String(salt)).getBytes().concat([0, 0, 0, 1]);
  var u = Utilities.computeHmacSha256Signature(saltBytes, pwBytes);
  var acc = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, pwBytes);
    for (var j = 0; j < acc.length; j++) acc[j] = acc[j] ^ u[j];
  }
  // GAS bytes are signed (-128..127); mask before hexing.
  return acc.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// Legacy scheme, kept ONLY so existing accounts can still be verified (and then
// upgraded). Never called to create a new hash.
function hashPasswordLegacySha256_(plaintext, salt) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + plaintext)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); })
    .join('');
}

function hashPassword(plaintext, salt) {
  return PBKDF2_PREFIX + PBKDF2_ITERATIONS + "$" + pbkdf2Sha256_(plaintext, salt, PBKDF2_ITERATIONS);
}

// Accepts both schemes. The stored hash names its own algorithm and iteration
// count, so an old row verifies against the old code path and a re-hash at a
// different cost still verifies — that is what makes tuning PBKDF2_ITERATIONS
// safe after the fact.
function verifyPassword(plaintext, salt, storedHash) {
  var stored = String(storedHash || "");
  if (stored.indexOf(PBKDF2_PREFIX) === 0) {
    var parts = stored.split("$");            // ["pbkdf2","sha256",iters,hex]
    var iters = parseInt(parts[2], 10);
    if (!(iters > 0)) return false;
    return pbkdf2Sha256_(plaintext, salt, iters) === parts[3];
  }
  return hashPasswordLegacySha256_(plaintext, salt) === stored;
}

// True when the stored hash is not at the current scheme/cost, i.e. it should be
// rewritten. Only ever acted on right after a SUCCESSFUL verify, which is the
// one moment the plaintext is legitimately in hand.
function passwordHashNeedsUpgrade(storedHash) {
  var stored = String(storedHash || "");
  if (stored.indexOf(PBKDF2_PREFIX) !== 0) return true;
  return parseInt(stored.split("$")[2], 10) !== PBKDF2_ITERATIONS;
}

// Run this from the Apps Script editor after deploying, to size PBKDF2_ITERATIONS
// against the live project's actual CPU. Prints the per-login cost.
function bravesBenchmarkKdf() {
  var salt = generateSalt();
  var t0 = new Date().getTime();
  pbkdf2Sha256_("benchmark-password", salt, PBKDF2_ITERATIONS);
  var ms = new Date().getTime() - t0;
  Logger.log("PBKDF2 " + PBKDF2_ITERATIONS + " iterations took " + ms + " ms per login.");
  Logger.log(ms > 5000
    ? "→ Too slow. Lower PBKDF2_ITERATIONS (existing hashes keep working; they carry their own count)."
    : "→ Acceptable. Raise it if you want more margin.");
  return ms;
}

function generateSalt() { return Utilities.getUuid(); }

// Find an Accounts row by email (case-insensitive). Returns the row object
// (incl. passwordHash + salt) or null. Reads via readTab so it benefits from
// the same Date/blank-row handling as everything else.
function findAccountByEmail(email) {
  if (!email) return null;
  var rows = readTab("Accounts");
  if (!Array.isArray(rows)) return null;
  var target = String(email).trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].email || "").trim().toLowerCase() === target) return rows[i];
  }
  return null;
}

// Resolve an auth token to its stored {email, personId, role, issuedAt} context,
// or null if the token is missing, malformed, or role-less (legacy invite token).
function getAuthContext(token) {
  if (!token) return null;
  var raw = PropertiesService.getScriptProperties().getProperty("auth:" + token);
  if (!raw) return null;
  var ctx;
  try { ctx = JSON.parse(raw); } catch (e) { return null; }
  if (!ctx || !ctx.role) return null;  // legacy/role-less token → invalid under new auth
  return ctx;
}

function isTokenExpired(context) {
  if (!context || !context.issuedAt) return true;
  return (new Date() - new Date(context.issuedAt)) > SESSION_TTL_MS;
}

function canWrite(ctx) { return !!ctx && (ctx.role === "commander" || ctx.role === "admin"); }
function isAdmin(ctx) { return !!ctx && ctx.role === "admin"; }

// Capability check (DUTY_LIST_SPEC.md §9.2). Capabilities are orthogonal to the
// role ladder: `canWrite` still has to pass first, so a viewer with caps="duty"
// gets nothing. Admins implicitly hold every capability, which keeps the "admin
// can always fix it" property the rest of the file relies on.
//
// Tokens minted before this column existed carry no `caps`, so they simply hold
// no capabilities — an old session degrades to "cannot plan duties" rather than
// to an error, and re-logging in picks the caps up.
function parseCaps(raw) {
  return String(raw == null ? "" : raw).split(",")
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return !!s; });
}
function hasCap(ctx, cap) {
  if (!ctx) return false;
  if (isAdmin(ctx)) return true;
  return parseCaps(ctx.caps).indexOf(String(cap).toLowerCase()) !== -1;
}

// ─── REPORT-SICK SCOPE (spec §1 / addendum A8) ─────────────
// Commanders see their own platoon's accumulated medical history; admins and
// granted accounts see the company. This is the ONLY enforcement — the client
// helpers in js/state.js decide which panels to draw, nothing more.
//
// A scope is {company: bool, plt: {PLT1: 1, …}}. `plt` is a plain object, NOT a
// Set: the test sandbox (test/harness.js) does not provide Set or Map to the
// backend, so a Set here would pass in Apps Script and throw in CI.
//
// Caps arrive lowercased from parseCaps ("rs:plt:plt2") while roster platoon
// codes are uppercase ("PLT2"), so every key is uppercased on the way in. Miss
// that and the grant silently matches nothing, which looks exactly like a
// commander who was never granted anything.
var RS_SCOPED_TABS = { Medical: 1, MSK: 1 };
var RS_PLT_CAP_PREFIX = "rs:plt:";
var RS_COMPANY_CAP = "rs:company";

function rsScopeOf_(ctx) {
  var scope = { company: false, plt: {} };
  if (!ctx) return scope;                       // no context → sees nothing
  if (isAdmin(ctx)) { scope.company = true; return scope; }

  var caps = parseCaps(ctx.caps);
  var granted = false;
  for (var i = 0; i < caps.length; i++) {
    if (caps[i] === RS_COMPANY_CAP) { scope.company = true; return scope; }
    if (caps[i].indexOf(RS_PLT_CAP_PREFIX) === 0) {
      var key = caps[i].slice(RS_PLT_CAP_PREFIX.length).toUpperCase();
      if (key) { scope.plt[key] = 1; granted = true; }
    }
  }
  if (granted) return scope;

  // No explicit grant → the caller's own platoon, resolved from the roster.
  // An unresolvable personId leaves the scope EMPTY rather than widening it.
  var own = rsPlatoonIndex_()[bravesPadD4_(ctx.personId)];
  if (own) scope.plt[own] = 1;
  return scope;
}

// Canonical, ordering-independent string for a scope. Used as the wire
// `scopeKey`: the client compares it for equality and re-pulls Medical/MSK when
// it changes, which is what makes a narrowed grant bite on a device holding a
// wide cache.
function rsScopeKey_(scope) {
  if (!scope) return "";
  if (scope.company) return "company";
  var keys = [];
  for (var k in scope.plt) keys.push(k);
  keys.sort();
  return keys.join("|");
}

// Padded-4D → uppercase platoon key, built from the Roster tab. personPlatoon
// already implements the explicit-column → appointment-4D → 4D-parse fallback
// chain; this only pads the key and uppercases the value so lookups are
// total-order safe against a caller passing 11, "11" or "0011".
function rsPlatoonIndex_() {
  var rows = readTab("Roster");
  var idx = {};
  if (!rows || !rows.length || rows.error) return idx;
  for (var i = 0; i < rows.length; i++) {
    var p = personPlatoon(rows[i]);
    if (p) idx[bravesPadD4_(rows[i].id)] = String(p).toUpperCase();
  }
  return idx;
}

function rsPersonInScope_(scope, d4, idx) {
  if (!scope) return false;
  if (scope.company) return true;
  var p = idx[bravesPadD4_(d4)];
  return !!p && !!scope.plt[p];
}

// The gate is a DATE CUT, not field redaction. Redacting `reason` was rejected:
// classifyURTI() derives from it, the sick-report generator prints it, the
// classifier exists in two copies (js/braves-parade.js and the hand-port below),
// and spec §1.1 makes reason company-visible anyway.
//
// A Medical row is OPERATIONAL when any of:
//   • it carries no bookInDate            — PR #65: an ended-but-unbooked MC
//                                            stays under ATT C, and such a row
//                                            can be arbitrarily old
//   • endDate is blank                    — open-ended, still running
//   • endDate >= today - RS_GHOST_TAIL_DAYS — the MC+1/MC+2, LD+1/LD+2 recovery
//                                            tags are derived at render time
//                                            from a CLOSED record
// Otherwise it is history. Parade state only ever consults operational rows, so
// nothing downstream of the classifier changes — that is the whole reason this
// is a date filter and not a person filter.
//
// The bookInDate clause is the one that silently breaks parade state if removed,
// and the failure looks like a CORRECT parade state with people missing from it.
var RS_GHOST_TAIL_DAYS = 2;

function rsRowIsOperational_(tabName, row, todayIso) {
  if (!row) return false;
  // MSK carries no endDate/bookInDate — `cleared` is its live/closed flag.
  if (tabName === "MSK") {
    var c = row.cleared;
    if (c === true) return false;
    return String(c == null ? "" : c).trim().toUpperCase() !== "TRUE";
  }
  // Checked BEFORE the date parse, so a row whose endDate is unparseable garbage
  // still resolves through the cheap, unambiguous path.
  if (!String(row.bookInDate == null ? "" : row.bookInDate).trim()) return true;
  var end = displayDateToISO(row.endDate || "");
  if (!end) return true;
  return end >= bpAddDaysISO(todayIso, -RS_GHOST_TAIL_DAYS);
}

// The single read chokepoint. Called from all three read routes so a new route
// cannot forget the gate by omission — if you add a fourth, call this from it.
//
// The archive cron is deliberately NOT routed through here: it runs unattended
// with no user context and must keep seeing everything, or the archived parade
// state and sick report would be silently truncated to one platoon.
function rsApplyReadScope_(tabName, rows, ctx) {
  if (!RS_SCOPED_TABS[tabName]) return rows;
  if (!rows || !rows.length || rows.error) return rows;
  var scope = rsScopeOf_(ctx);
  if (scope.company) return rows;

  var idx = rsPlatoonIndex_();
  // todayISO(), not bravesTodayISO_(): the latter routes through
  // Utilities.formatDate, which the test harness stubs to a fixed display date
  // ("01 Jan 2026") regardless of the format string — so the cut would compare
  // an ISO endDate against a display today and silently keep everything. This
  // one is plain JS and behaves identically in Apps Script and under test.
  var today = todayISO();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (rsPersonInScope_(scope, rows[i].d4, idx) ||
        rsRowIsOperational_(tabName, rows[i], today)) {
      out.push(rows[i]);
    }
  }
  return out;
}

// Write-side enforcement (spec §1.5). Two guards, both required:
//
//  1. Row-level writes are PERMITTED and scope-checked. Commanders keep logging,
//     editing and deleting their own platoon's report-sick records — the daily
//     workflow is untouched. On an upsert the check runs against BOTH the
//     incoming row's subject and the existing row's subject, so a scoped caller
//     cannot re-point someone else's record at their own platoon and capture it.
//
//  2. The whole-tab replace is HARD-BLOCKED below company scope. Not a filter,
//     not a merge — a refusal. writeTab derives headers from Object.keys(data[0])
//     and replaces the entire tab, so a scoped account holding a filtered Medical
//     array would delete every other platoon's rows. That is silent, total,
//     cross-platoon data loss and it is the single most dangerous consequence of
//     filtering on the wire.
function rsGuardWrite_(tabName, action, body, ctx) {
  if (!RS_SCOPED_TABS[tabName]) return null;
  var scope = rsScopeOf_(ctx);
  if (scope.company) return null;

  if (action === "write" || action === "replaceConductRows") {
    return { error: "Scoped accounts cannot replace a tab. Ask an admin, or edit rows individually.", code: 403 };
  }
  // updateRow/deleteRow address a row by SHEET INDEX, so the subject cannot be
  // resolved from the request alone without re-reading and trusting the index.
  // Refuse rather than guess — nothing in the app uses them for Medical/MSK.
  if (action === "updateRow" || action === "deleteRow") {
    return { error: "Out of scope for that platoon.", code: 403 };
  }

  var idx = rsPlatoonIndex_();
  var subjects = [];
  if (action === "append" && body.row) subjects.push(body.row.d4);
  if (action === "appendMany" && body.rows) {
    for (var i = 0; i < body.rows.length; i++) subjects.push(body.rows[i].d4);
  }
  if (action === "upsertRow" && body.row) {
    subjects.push(body.row.d4);
    var existingU = rsFindRowById_(tabName, body.row.id);
    if (existingU) subjects.push(existingU.d4);   // capture defence
  }
  if (action === "deleteRowById") {
    var existingD = rsFindRowById_(tabName, body.id);
    // A missing row is not a scope failure — let the normal delete path report it.
    if (existingD) subjects.push(existingD.d4);
  }

  for (var j = 0; j < subjects.length; j++) {
    if (!rsPersonInScope_(scope, subjects[j], idx)) {
      return { error: "Out of scope for that platoon.", code: 403 };
    }
  }
  return null;
}

// MSK has no `id` column (schema: timestamp | d4 | …), so an id lookup there
// simply finds nothing and the incoming row's own d4 is the only subject — which
// is correct, because the frontend addresses MSK rows by timestamp, not id.
function rsFindRowById_(tabName, id) {
  var rows = readTab(tabName);
  if (!rows || !rows.length || rows.error) return null;
  var target = String(id == null ? "" : id).trim();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id == null ? "" : rows[i].id).trim() === target) return rows[i];
  }
  return null;
}

// ─── DUTY CHANGE REQUESTS (design §3) ──────────────────────
//
// Write-side enforcement for the DutyChangeRequest tab. This tab is deliberately
// NOT in the duty-capability tab gate below: design §3.2 says any commander may
// submit, and adding it there would make submission planner-only, which is the
// one thing the feature must not be.
//
// So the split is by ACTION, not by tab:
//
//   append           — any canWrite caller. The server owns `status` and the
//                      decided* columns regardless of what the body carried.
//   deleteRowById    — the submitter's own row (withdraw), or a duty planner.
//   decideDutyRequest— duty capability only; the ONLY path that sets a status.
//   everything else  — refused. There is no legitimate caller.
//
// That last line is the load-bearing one. If upsertRow were permitted here, a
// commander could submit a request and then upsert their own row to
// status:"Approved" — the approval gate would still exist and would still be
// enforced on decideDutyRequest, and would still be completely pointless,
// because the roster reads status off the row. Refusing the generic mutations
// is what makes "status only ever changes through decideDutyRequest" a fact
// rather than an intention.
function dcrGuardWrite_(tabName, action, body, ctx) {
  if (tabName !== "DutyChangeRequest") return null;

  if (action === "append") {
    if (!body || !body.row) return { error: "Nothing to submit.", code: 400 };
    // Design §3.2: the reason is the entire point of the feature, and a
    // client-side `required` attribute is a suggestion — this is the only place
    // the rule is actually enforced. Whitespace does not count as a reason.
    var reason = String(body.row.reason == null ? "" : body.row.reason).trim();
    if (!reason) return { error: "A reason is required.", code: 400 };
    if (DCR_KINDS.indexOf(String(body.row.kind || "")) === -1) {
      return { error: "Unknown change kind.", code: 400 };
    }
    // Server-owned columns, overwritten whatever the client sent. submittedBy
    // comes off the token rather than the body so a request cannot be filed
    // under someone else's name.
    body.row.reason      = reason;
    body.row.submittedBy = (ctx && ctx.personId) || "";
    body.row.status      = "Pending";
    body.row.decidedBy   = "";
    body.row.decidedAt   = "";
    body.row.decisionNote = "";
    return null;
  }

  if (action === "deleteRowById") {
    if (hasCap(ctx, "duty")) return null;
    var existing = rsFindRowById_("DutyChangeRequest", body && body.id);
    // A missing row is not a permission failure — let the normal delete path
    // report it as not-found rather than as a refusal, which would be a
    // confusing thing to tell someone withdrawing an already-gone request.
    if (!existing) return null;
    if (String(existing.submittedBy || "") !== String((ctx && ctx.personId) || "")) {
      return { error: "You can only withdraw your own request.", code: 403 };
    }
    if (String(existing.status || "Pending") !== "Pending") {
      return { error: "That request has already been decided.", code: 400 };
    }
    return null;
  }

  return { error: "Duty change requests are submitted and decided, not edited.", code: 403 };
}

var DCR_KINDS = ["add", "remove", "reassign", "swap"];

// ── Hand-port of js/duty-request.js's dcrSlotRow + dcrDutyMutations ──────────
//
// The archive cron and this approval path run in Apps Script, which cannot load
// a frontend file, so the rules live in two places — the same arrangement
// js/braves-parade.js has with its port here. EVERY CHANGE TO
// js/duty-request.js MUST BE MIRRORED HERE; test/duty-request-port-parity.test.js
// runs both copies over the same cases and fails on any behavioural difference.
//
// Written in the ES5 style the rest of this file uses (var, no arrows) rather
// than copied verbatim from the frontend.
function dcrSlotRow(dutyRows, date, dutyType, platoon) {
  var rows = dutyRows || [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r && r.date === date && r.dutyType === dutyType
        && (r.platoon || "") === (platoon || "")) return r;
  }
  return null;
}

function dcrDutyMutations(req, dutyRows) {
  var out = { upserts: [], deletes: [] };
  if (!req) return out;

  var kind = String(req.kind || "");
  var primary = dcrSlotRow(dutyRows, req.date, req.dutyType, req.platoon);

  function stamp(row, d4, date, dutyType, platoon) {
    return {
      id: row ? row.id : "",          // "" means the caller mints one
      date: date,
      dutyType: dutyType,
      platoon: platoon || "",
      d4: d4,
      assignedBy: req.decidedBy || req.submittedBy || "",
      assignedAt: req.decidedAt || "",
      source: "request"
    };
  }

  if (kind === "add" || kind === "reassign") {
    if (req.toD4) out.upserts.push(stamp(primary, req.toD4, req.date, req.dutyType, req.platoon));
  } else if (kind === "remove") {
    if (primary) out.deletes.push(primary.id);
  } else if (kind === "swap") {
    var other = dcrSlotRow(dutyRows, req.swapDate, req.swapDutyType, req.swapPlatoon);
    var primaryHolder = primary ? primary.d4 : req.fromD4;
    var otherHolder = other ? other.d4 : req.toD4;
    if (otherHolder) {
      out.upserts.push(stamp(primary, otherHolder, req.date, req.dutyType, req.platoon));
    }
    if (primaryHolder) {
      out.upserts.push(stamp(other, primaryHolder, req.swapDate, req.swapDutyType, req.swapPlatoon));
    }
  }
  return out;
}

// Approve or reject a request. Approving APPLIES it — the Duty row(s) and the
// request's status change in this one call, under one lock.
//
// Two calls would be simpler and are wrong (design §3.3): between them the
// request would read Approved while the roster still disagreed, and the roster
// is what people turn up for. The window is small and the consequence of losing
// the race is somebody standing a duty nobody recorded.
function handleDecideDutyRequest(body, ctx) {
  if (!hasCap(ctx, "duty")) return { error: "Duty capability required.", code: 403 };

  var decision = String(body.decision || "");
  if (decision !== "approve" && decision !== "reject") {
    return { error: "Decision must be approve or reject.", code: 400 };
  }

  // getDataLock() — the SAME lock withRevLock takes, not a fresh script lock.
  // A different lock would serialise this action against itself and nothing
  // else, so an ordinary Duty upsert could interleave between the mutations and
  // the status flip, which is precisely the window this exists to close.
  var lock = getDataLock();
  try { lock.waitLock(15000); }
  catch (e) { return { error: "Server busy, please retry", code: 503 }; }
  try {
    // Re-read INSIDE the lock. The copy the deciding client is looking at may be
    // seconds old, and two planners deciding the same request from two devices
    // is exactly the case this has to survive.
    var req = rsFindRowById_("DutyChangeRequest", body.id);
    if (!req) return { error: "That request no longer exists.", code: 404 };
    if (String(req.status || "Pending") !== "Pending") {
      return { error: "That request has already been decided.", code: 409 };
    }

    var dutyRes = null;
    if (decision === "approve") {
      // ONE definition of what each kind means, mirrored from
      // js/duty-request.js and guarded against drift by
      // test/duty-request-port-parity.test.js. The submitter's preview and this
      // must agree exactly; if they drift, the visible symptom is a roster that
      // does not match what was approved.
      var mutations = dcrDutyMutations(req, readTab("Duty"));
      for (var i = 0; i < mutations.deletes.length; i++) {
        deleteRowById("Duty", mutations.deletes[i]);
      }
      for (var j = 0; j < mutations.upserts.length; j++) {
        var row = mutations.upserts[j];
        // dcrDutyMutations leaves id "" when the slot was empty — it does not
        // know how ids are minted. upsertRow refuses a blank id outright, so
        // filling it here is required, not tidiness. Same shape as the
        // frontend's nextId(): a timestamp-seeded value wide enough that two
        // approvals in the same second do not collide.
        if (!row.id) row.id = "dcr" + new Date().getTime() + "-" + j;
        row.assignedAt = row.assignedAt || new Date().toISOString();
        upsertRow("Duty", row);
      }
      if (mutations.deletes.length || mutations.upserts.length) {
        dutyRes = { rev: bumpRev("Duty") };
      }
    }
    // A rejection writes NOTHING to Duty and does not bump its revision — every
    // other client would otherwise re-pull an unchanged tab.

    req.status       = decision === "approve" ? "Approved" : "Rejected";
    req.decidedBy    = (ctx && ctx.personId) || "";
    req.decidedAt    = new Date().toISOString();
    req.decisionNote = String(body.decisionNote == null ? "" : body.decisionNote).trim();
    upsertRow("DutyChangeRequest", req);

    return { ok: true, request: req, rev: bumpRev("DutyChangeRequest"), duty: dutyRes };
  } finally {
    lock.releaseLock();
  }
}

// ── Login + failed-attempt throttling ────────────────────

function handleLogin(body) {
  var email = body && body.email ? String(body.email).trim() : "";
  var password = body && body.password ? String(body.password) : "";
  if (!email || !password) return { error: "Email and password required." };

  if (isLockedOut(email)) {
    return { error: "Account locked — too many failed attempts. Try again in 15 minutes." };
  }
  var account = findAccountByEmail(email);
  if (!account) return logFailedAttempt(email, "Email not found");
  if (!verifyPassword(password, account.salt, account.passwordHash)) {
    return logFailedAttempt(email, "Wrong password");
  }
  clearFailedAttempts(email);

  // Transparent KDF upgrade. A successful verify is the only moment the
  // plaintext is legitimately in hand, so it is the only moment the stored hash
  // can be re-derived under the current scheme. Every account migrates off the
  // legacy fast SHA-256 the first time its owner signs in — no reset, no admin
  // action, nothing for the user to notice. Wrapped because a write failure here
  // must not cost a valid login: the next sign-in simply tries again.
  if (passwordHashNeedsUpgrade(account.passwordHash)) {
    try {
      var upgradedSalt = generateSalt();   // new scheme, new salt
      updateAccountPassword(account.email, hashPassword(password, upgradedSalt), upgradedSalt);
    } catch (e) { /* keep the login; retry on the next one */ }
  }

  var token = Utilities.getUuid();
  var ctx = {
    email: account.email,
    personId: account.personId || "",
    role: account.role || "viewer",
    // Snapshotted onto the token, like `role` already is. An account whose caps
    // change mid-session keeps the old set until it re-logs in or an admin
    // revokes its tokens — the same trade-off the role column already makes.
    caps: parseCaps(account.caps).join(","),
    issuedAt: new Date().toISOString()
  };
  PropertiesService.getScriptProperties().setProperty("auth:" + token, JSON.stringify(ctx));
  // `ctx.role` here is exactly what getAuthContext(token) would return (we just
  // wrote this same JSON to the property above) — pass it directly, no lookup.
  writeAuditLog(account.email, account.personId, "login", null, null, token, ctx.role);
  return { ok: true, authToken: token, role: ctx.role, personId: ctx.personId,
           email: ctx.email, caps: parseCaps(ctx.caps) };
}

function logFailedAttempt(email, reason) {
  var key = "failed:" + String(email).toLowerCase();
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(key);
  var record = raw ? JSON.parse(raw) : { count: 0, since: new Date().toISOString() };
  record.count++;
  record.lastAttempt = new Date().toISOString();
  props.setProperty(key, JSON.stringify(record));
  // No auth token exists for a failed login — role is always "" here (matches
  // today's behaviour, where the null token short-circuited the old lookup).
  writeAuditLog(email, null, "login_failed", null, reason, null, "");
  // Deliberately generic so we don't reveal whether the email exists.
  return { error: "Wrong email or password." };
}

function isLockedOut(email) {
  var raw = PropertiesService.getScriptProperties().getProperty("failed:" + String(email).toLowerCase());
  if (!raw) return false;
  var record = JSON.parse(raw);
  if (record.count < LOCKOUT_THRESHOLD) return false;
  return (new Date() - new Date(record.lastAttempt)) < LOCKOUT_WINDOW_MS;
}

function clearFailedAttempts(email) {
  PropertiesService.getScriptProperties().deleteProperty("failed:" + String(email).toLowerCase());
}

// ── Authenticated POST dispatch (role-gated) ─────────────

// ─── REVISION TRACKING / OPTIMISTIC CONCURRENCY ─────────
// Each data tab carries a monotonic revision counter in ScriptProperties
// (key "rev:<TabName>"), bumped on every successful write. Clients send the
// revision they last saw as `baseRev`; a full-tab write whose baseRev no longer
// matches the server is REJECTED (conflict) instead of being allowed to clobber
// newer data. A single (document) lock makes the check → write → bump sequence
// atomic, since Apps Script web apps do NOT serialize concurrent requests.
var REV_TABS = ["Roster", "Medical", "Attendance", "IPPT", "RouteMarch", "SOC",
  "PolarFlow", "ConductDetail", "Appointments", "Leave", "MSK", "Conducts",
  "Duty", "DutyCorrection", "Holidays", "DutyUnavailable", "DutyChangeRequest"];

function getRev(tabName) {
  var p = PropertiesService.getScriptProperties();
  var v = p.getProperty("rev:" + tabName);
  if (v === null) { p.setProperty("rev:" + tabName, "1"); return 1; }  // lazily seed
  return Number(v) || 1;
}

function bumpRev(tabName) {
  var p = PropertiesService.getScriptProperties();
  var next = (Number(p.getProperty("rev:" + tabName)) || 1) + 1;
  p.setProperty("rev:" + tabName, String(next));
  return next;
}

// P2-2: this runs on every revCheck poll (the hottest endpoint — every open
// client, every 20s) and every readAll, so it's worth one bulk Properties read
// instead of REV_TABS.length individual getProperty round trips.
// SECURITY: getProperties() returns ALL script properties, not just "rev:*" —
// including auth tokens and failed-login records. `all` MUST stay local to
// this function; only the filtered rev:<tab> values (via `out`) may leave it,
// never the raw `all` object or any of its other keys.
function getAllRevs() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var out = {};
  for (var i = 0; i < REV_TABS.length; i++) {
    var v = all["rev:" + REV_TABS[i]];
    out[REV_TABS[i]] = v === undefined || v === null ? 1 : (Number(v) || 1);
  }
  return out;
}

// Optional one-time editor run; getRev also seeds lazily so this isn't required.
function initAllRevs() {
  for (var i = 0; i < REV_TABS.length; i++) getRev(REV_TABS[i]);
  return getAllRevs();
}

// Lock used for DATA writes. Deliberately the DOCUMENT lock, NOT the script
// lock — time-driven triggers (the archive poller) hold the *script* lock for
// the whole of their run, which would otherwise block every web-app write until
// its waitLock timeout. The document lock scopes contention to actual sheet
// writers. Falls back to the script lock for a standalone script.
function getDataLock() {
  try { var l = LockService.getDocumentLock(); if (l) return l; } catch (e) {}
  return LockService.getScriptLock();
}

// Atomic write wrapper. `enforce` true → reject when the client's `baseRev` no
// longer matches the server (lost-update prevention). Runs fn() (the actual
// sheet mutation) under the data lock, then bumps the tab's revision on success
// and returns it as `result.rev` so the client can advance its baseline.
// Backward-compat: a missing baseRev (old cached client, or a server-side
// trigger call routed here) skips the check but still bumps, so newer clients
// see it. Untracked tabs (the archives) just run fn() — no rev to bump.
function withRevLock(tabName, baseRev, enforce, fn) {
  if (REV_TABS.indexOf(tabName) === -1) return fn();   // not a tracked data tab
  var lock = getDataLock();
  try { lock.waitLock(15000); }
  catch (e) { return { error: "Server busy, please retry", code: 503 }; }
  try {
    var serverRev = getRev(tabName);
    if (enforce && baseRev !== undefined && baseRev !== null && baseRev !== "" &&
        Number(baseRev) !== serverRev) {
      return { conflict: true, tab: tabName, serverRev: serverRev };
    }
    var result = fn();
    if (result && result.error) return result;          // don't bump on failure
    if (!result) result = { ok: true };
    result.rev = bumpRev(tabName);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ── Manual-edit propagation (installable onEdit trigger) ─────
// App/bot writes bump the revision through withRevLock, but typing directly into
// the Google Sheet bypasses all of that — so dashboards' revCheck poll would
// never notice a hand edit. This trigger bumps the edited tab's revision on any
// human edit in the Sheets UI, so manual edits auto-refresh into open tabs too.
// NOTE: programmatic writes (the web app's setValues) do NOT fire onEdit, so
// this never double-counts app writes. Run installEditTrigger() ONCE from the
// editor to enable it (an installable trigger is required — simple onEdit can't
// reliably use ScriptProperties/LockService).
function onEditBumpRev(e) {
  try {
    var sheet = e && e.range && e.range.getSheet();
    if (!sheet) return;
    var name = sheet.getName();
    if (REV_TABS.indexOf(name) === -1) return;   // only tracked data tabs
    var lock = getDataLock();
    try { lock.waitLock(10000); } catch (le) { bumpRev(name); return; }  // best-effort
    try { bumpRev(name); } finally { lock.releaseLock(); }
  } catch (err) {
    try { Logger.log("onEditBumpRev error: " + err); } catch (e2) {}  // fail quietly
  }
}

// One-time setup: run this ONCE from the Apps Script editor (it asks for the
// ScriptApp authorization). Idempotent — removes any prior copy first.
function installEditTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "onEditBumpRev") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("onEditBumpRev")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  return "Installed onEdit rev-bump trigger for: " + REV_TABS.join(", ");
}

function routeAuthedPost(action, tab, body, ctx) {
  // Available to any signed-in role:
  if (action === "logout")          return handleLogout(body, ctx);
  if (action === "changePassword")  return handleChangePassword(body, ctx);
  if (action === "rowCount" && tab) return rowCount(tab);  // read-only staleness probe
  // Offline data grants (§4.7.5a). Register/check are per-device and available
  // to every role INCLUDING viewers — a viewer's device caches the same data, so
  // gating these behind canWrite would leave exactly those devices unbounded and
  // invisible. revoke self-authorises (own device) or requires admin, inside the
  // handler; the list is admin-only.
  if (action === "registerOfflineGrant") return handleRegisterOfflineGrant(body, ctx);
  if (action === "checkOfflineGrant")    return handleCheckOfflineGrant(body, ctx);
  if (action === "revokeOfflineGrant")   return handleRevokeOfflineGrant(body, ctx);
  if (action === "listOfflineGrants")    return handleListOfflineGrants(body, ctx);

  // Admin-only account & token management:
  if (action === "listAccounts")      return handleListAccounts(body, ctx);
  if (action === "addAccount")        return handleAddAccount(body, ctx);
  if (action === "removeAccount")     return handleRemoveAccount(body, ctx);
  if (action === "adminResetPassword")return handleAdminResetPassword(body, ctx);
  if (action === "setAccountCaps")    return handleSetAccountCaps(body, ctx);
  if (action === "listTokens")        return handleListTokens(body, ctx);
  if (action === "revokeToken")       return handleRevokeToken(body, ctx);
  if (action === "revokeAllForEmail") return handleRevokeAllForEmail(body, ctx);
  if (action === "revokeAllTokens")   return handleRevokeAllTokens(body, ctx);

  // Everything below mutates data or spends quota → commander/admin only.
  // This single gate is the authoritative "viewer is read-only" enforcement.
  if (!canWrite(ctx)) return { error: "Read-only access — your account cannot make changes.", code: 403 };

  // Admin-only capabilities (RBAC). Email dispatch is a distinct action so it
  // gates cleanly; bulk imports (conduct CSV / full-backup restore) carry an
  // explicit `imported` flag from the client so they can be blocked for non-
  // admins WITHOUT affecting a commander's normal single-row edits (which share
  // the generic write path but never set the flag).
  if (action === "sendEmail" && !isAdmin(ctx)) {
    return { error: "Admin only — email dispatch is restricted to admin accounts.", code: 403 };
  }
  if (body && body.imported && !isAdmin(ctx)) {
    return { error: "Admin only — data import is restricted to admin accounts.", code: 403 };
  }

  // Duty planning (DUTY_LIST_SPEC.md §9.2). The third narrow gate in the same
  // style as the two above: `canWrite` has already passed, and this restricts a
  // subset of tabs further. READS are deliberately untouched — everyone can see
  // who is on duty and how the points fall; only planning is restricted, which
  // is exactly how the spreadsheet it replaces worked.
  //
  // This is the enforcement point. `canPlanDuty()` on the client only hides UI;
  // a hand-rolled POST has to come through here.
  if (tab === "Duty" || tab === "DutyCorrection" || tab === "Holidays"
      || tab === "DutyUnavailable") {
    if (!hasCap(ctx, "duty")) {
      return { error: "Duty planning is restricted to duty planners.", code: 403 };
    }
  }

  // Report-sick platoon scope (spec §1.5). Sits with the duty gate above for the
  // same reason: canWrite has already passed, and this restricts a subset of tabs
  // further. Reads are gated separately, in doGet/readAllTabs.
  var rsGuard = rsGuardWrite_(tab, action, body, ctx);
  if (rsGuard) return rsGuard;

  // Duty change requests (design §3.2/§3.3). Same placement and the same reason
  // as the two gates above: canWrite has passed, and this restricts one tab
  // further — but by ACTION rather than wholesale, because submitting is open
  // to every commander while deciding is not. See dcrGuardWrite_.
  //
  // It also MUTATES body.row on an append, forcing the server-owned columns, so
  // it must run before the write dispatch below rather than alongside it.
  var dcrGuard = dcrGuardWrite_(tab, action, body, ctx);
  if (dcrGuard) return dcrGuard;

  // Mass-deletion safety net (Misc B1): commanders are capped at N single-row
  // deletes per rolling hour (default 30, Config key `commanderDeleteCap`).
  // Admins are exempt. Only single-row deletes count — full-tab `write`/replace,
  // append, appendMany and upsert are NOT throttled, so the conduct CSV import
  // (which re-writes whole tabs) never trips this. 30/hr ≈ one every 2 min:
  // ample for legitimate data correction, while a runaway loop blows past it
  // instantly. Server-side so it can't be bypassed from the client.
  if ((action === "deleteRowById" || action === "deleteRow") && ctx.role === "commander") {
    var rate = bravesCheckDeleteRate_(ctx);
    if (!rate.ok) return { error: "Deletion limit reached (" + rate.cap + " deletions/hour for commanders). Wait a bit, or ask an admin to make bulk changes.", code: 429 };
  }

  // Data writes run under withRevLock for optimistic-concurrency safety. A full
  // `write` (whole-tab replace — the lost-update catastrophe vector) ENFORCES the
  // client's baseRev: a stale tab is rejected with {conflict} rather than allowed
  // to clobber newer rows. Row-scoped ops (append/appendMany/upsert/delete) never
  // touch other rows, so they don't enforce (that caused false-conflict retry
  // storms) — they just apply and bump the rev. withRevLock returns the new rev
  // on the result so the client can advance its baseline; baseRev rides in body.
  var res;
  if (action === "write" && tab && body.data)                    res = withRevLock(tab, body.baseRev, true,  function () { return writeTab(tab, body.data); });
  else if (action === "append" && tab && body.row)               res = withRevLock(tab, body.baseRev, false, function () { return appendRow(tab, body.row); });
  else if (action === "appendMany" && tab && body.rows)          res = withRevLock(tab, body.baseRev, false, function () { return appendMany(tab, body.rows); });
  else if (action === "replaceConductRows" && tab && body.match)  res = withRevLock(tab, body.baseRev, false, function () { return replaceConductRows(tab, body.match, body.rows || []); });
  else if (action === "upsertRow" && tab && body.row)            res = withRevLock(tab, body.baseRev, false, function () { return upsertRow(tab, body.row); });
  else if (action === "deleteRowById" && tab && body.id !== undefined) res = withRevLock(tab, body.baseRev, false, function () { return deleteRowById(tab, body.id); });
  else if (action === "deleteRow" && tab && body.rowIndex !== undefined) res = withRevLock(tab, body.baseRev, false, function () { return deleteRow(tab, body.rowIndex); });
  else if (action === "updateRow" && tab && body.rowIndex !== undefined && body.row) res = withRevLock(tab, body.baseRev, false, function () { return updateRow(tab, body.rowIndex, body.row); });
  else if (action === "sendEmail")                               res = sendEmailHelper(body);
  else if (action === "getEmailInfo")                            res = getEmailInfoHelper();
  else if (action === "analyzePhoto")                            res = analyzePhotoHelper(body);
  else if (action === "decideDutyRequest" && body.id !== undefined) res = handleDecideDutyRequest(body, ctx);
  else if (action === "archiveNow")                              res = bravesArchiveNow(body, ctx);
  else if (action === "deleteArchive")                           res = bravesDeleteArchive(body, ctx);
  else return { error: "Invalid request" };

  // Audit manual archive snapshots (A2.3-style). ctx.role is still valid here —
  // archiving never touches auth tokens — so pass it straight through (P2-3).
  if (action === "archiveNow" && res && !res.error) {
    writeAuditLog(ctx.email, ctx.personId, "archive_now", "Archive", (body && body.kind) || "both", body.auth, ctx.role);
  }
  // Audit archive deletions (admin-only; A2.3 tamper-trail). Same: ctx.role safe.
  if (action === "deleteArchive" && res && !res.error) {
    writeAuditLog(ctx.email, ctx.personId, "delete_archive", (body && body.kind) === "sick" ? "SickArchive" : "ParadeArchive", (body && body.timestamp) || "", body.auth, ctx.role);
  }

  // Best-effort audit of data writes to the tabs called out in A2.3. ctx.role
  // is still valid here (a data write never revokes the caller's own token).
  if (res && !res.error && tab &&
      ["write", "append", "appendMany", "replaceConductRows", "upsertRow", "updateRow", "deleteRowById", "deleteRow"].indexOf(action) >= 0) {
    writeAuditLog(ctx.email, ctx.personId, auditActionForTab(tab), tab, action, body.auth, ctx.role);
  }
  return res;
}

function auditActionForTab(tab) {
  var map = {
    Medical: "write_medical", Leave: "write_leave", IPPT: "write_ippt",
    Roster: "write_roster", Config: "write_config", ConductDetail: "write_conduct_import"
  };
  return map[tab] || ("write_" + String(tab).toLowerCase());
}

function handleLogout(body, ctx) {
  PropertiesService.getScriptProperties().deleteProperty("auth:" + body.auth);
  // `role` intentionally omitted (see writeAuditLog's P2-3 comment): the token
  // is already deleted above, and this call has always passed a null token
  // (not body.auth) — reproducing that null-token lookup keeps this row's role
  // column exactly what it's always been ("").
  writeAuditLog(ctx.email, ctx.personId, "logout", null, null, null);
  return { ok: true };
}

// ── Password management ──────────────────────────────────

function handleChangePassword(body, ctx) {
  var account = findAccountByEmail(ctx.email);
  if (!account) return { error: "Account not found." };
  if (!verifyPassword(body.currentPassword || "", account.salt, account.passwordHash)) {
    return { error: "Current password is wrong." };
  }
  if (!body.newPassword || String(body.newPassword).length < 6) {
    return { error: "New password must be at least 6 characters." };
  }
  var newSalt = generateSalt();
  updateAccountPassword(ctx.email, hashPassword(body.newPassword, newSalt), newSalt);
  // Own token untouched by a password change — ctx.role safe to pass through.
  writeAuditLog(ctx.email, ctx.personId, "change_password", ctx.email, null, body.auth, ctx.role);
  return { ok: true };
}

function handleAdminResetPassword(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  if (!findAccountByEmail(body.targetEmail)) return { error: "Target account not found." };
  if (!body.tempPassword || String(body.tempPassword).length < 6) {
    return { error: "Temporary password must be at least 6 characters." };
  }
  var newSalt = generateSalt();
  updateAccountPassword(body.targetEmail, hashPassword(body.tempPassword, newSalt), newSalt);
  // Resets a TARGET account's password, not the caller's session — ctx.role safe.
  writeAuditLog(ctx.email, ctx.personId, "admin_reset_password", body.targetEmail, null, body.auth, ctx.role);
  return { ok: true };
}

// Grant or revoke a capability on a target account (DUTY_LIST_SPEC.md §9.2).
// Admin-only, like every other Accounts mutation.
//
// Live tokens are NOT rewritten — caps are snapshotted onto the token at login,
// same as role. Revoking therefore takes effect on the target's next login, so
// revokeAllForEmail is the way to make it immediate. Said plainly in the
// response rather than left for an admin to discover.
function handleSetAccountCaps(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  var email = body.targetEmail ? String(body.targetEmail).trim() : "";
  if (!email) return { error: "targetEmail required." };
  if (!findAccountByEmail(email)) return { error: "Target account not found." };

  var caps = parseCaps(body.caps);
  for (var i = 0; i < caps.length; i++) {
    if (!rsCapIsKnown_(caps[i])) return { error: "Unknown capability '" + caps[i] + "'." };
  }
  var written = writeAccountCaps(email, caps.join(","));
  if (written && written.error) return written;
  // Mutates a TARGET account, never the caller's own token — ctx.role safe.
  writeAuditLog(ctx.email, ctx.personId, "set_account_caps", email, caps.join(",") || "(none)", body.auth, ctx.role);
  return { ok: true, caps: caps,
           note: "Takes effect on that account's next login; revoke its tokens to apply immediately." };
}

// The allowlist exists so a typo ("dutty") fails loudly at the point of granting
// rather than silently producing an account that can never plan anything. The
// same reasoning is why `rs:plt:` validates its KEY as well as its prefix: an
// empty key would be accepted, stored, and match no platoon forever.
var KNOWN_CAPS = ["duty", "rs:company"];

function rsCapIsKnown_(cap) {
  var c = String(cap == null ? "" : cap).trim().toLowerCase();
  if (KNOWN_CAPS.indexOf(c) !== -1) return true;
  if (c.indexOf(RS_PLT_CAP_PREFIX) !== 0) return false;
  return c.slice(RS_PLT_CAP_PREFIX.length).length > 0;
}

function writeAccountCaps(email, capsCsv) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Accounts");
  if (!sheet) return { error: "Accounts tab not found" };
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var emailCol = headers.indexOf("email"), capsCol = headers.indexOf("caps");
  if (emailCol < 0) return { error: "Accounts tab missing columns" };
  if (capsCol < 0) return { error: "Accounts tab has no `caps` column — run bravesMigrateSchema() first." };
  var target = String(email).trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][emailCol]).trim().toLowerCase() === target) {
      sheet.getRange(i + 1, capsCol + 1).setValues([[capsCsv]]);
      return { ok: true };
    }
  }
  return { error: "Account row not found" };
}

// Surgically rewrite one account's passwordHash + salt cells in place.
function updateAccountPassword(email, newHash, newSalt) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Accounts");
  if (!sheet) return { error: "Accounts tab not found" };
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var emailCol = headers.indexOf("email"), hashCol = headers.indexOf("passwordHash"), saltCol = headers.indexOf("salt");
  if (emailCol < 0 || hashCol < 0 || saltCol < 0) return { error: "Accounts tab missing columns" };
  var target = String(email).trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][emailCol]).trim().toLowerCase() === target) {
      sheet.getRange(i + 1, hashCol + 1).setValue(newHash);
      sheet.getRange(i + 1, saltCol + 1).setValue(newSalt);
      return { ok: true };
    }
  }
  return { error: "Account row not found" };
}

// ── Account management (admin) ───────────────────────────

function handleListAccounts(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  var rows = readTab("Accounts");
  if (!Array.isArray(rows)) rows = [];
  // Never return passwordHash / salt to the client.
  var accounts = rows.map(function (r) {
    return { email: r.email || "", personId: r.personId || "", role: r.role || "",
             caps: parseCaps(r.caps), addedBy: r.addedBy || "", addedAt: r.addedAt || "" };
  });
  return { ok: true, accounts: accounts };
}

function handleAddAccount(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  var email = body.newEmail ? String(body.newEmail).trim() : "";
  var role = body.newRole || "viewer";
  var personId = body.newPersonId ? String(body.newPersonId).trim() : "";
  var password = body.newPassword || "";
  if (!email || !password) return { error: "Email and password required." };
  if (String(password).length < 6) return { error: "Password must be at least 6 characters." };
  if (["admin", "commander", "viewer"].indexOf(role) < 0) return { error: "Invalid role." };
  if (findAccountByEmail(email)) return { error: "An account with that email already exists." };

  var salt = generateSalt();
  // Soft validation (b): warn if personId isn't in the Roster, but still create.
  var warning = (personId && !rosterHasId(personId))
    ? "personId '" + personId + "' not found in Roster — account created anyway." : "";
  appendRow("Accounts", {
    email: email, personId: personId, role: role,
    passwordHash: hashPassword(password, salt), salt: salt,
    addedBy: ctx.email, addedAt: new Date().toISOString(),
    caps: parseCaps(body.newCaps).join(",")
  });
  // Adding a new account never touches the caller's own token — ctx.role safe.
  writeAuditLog(ctx.email, ctx.personId, "add_account", email, role, body.auth, ctx.role);
  return { ok: true, warning: warning };
}

function handleRemoveAccount(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  var email = body.targetEmail ? String(body.targetEmail).trim() : "";
  if (!email) return { error: "targetEmail required." };
  if (email.toLowerCase() === String(ctx.email).toLowerCase()) return { error: "You cannot remove your own account." };
  var removed = removeAccountRow(email);
  var revoked = revokeAllTokensForEmail(email);  // also kick any live sessions
  // Guarded above ("You cannot remove your own account") so `email` !== ctx.email —
  // revokeAllTokensForEmail can never delete the caller's own token; ctx.role safe.
  writeAuditLog(ctx.email, ctx.personId, "remove_account", email, revoked + " token(s) revoked", body.auth, ctx.role);
  return { ok: true, removed: removed, revoked: revoked };
}

function removeAccountRow(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Accounts");
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  var emailCol = data[0].map(function (h) { return String(h).trim(); }).indexOf("email");
  if (emailCol < 0) return false;
  var target = String(email).trim().toLowerCase();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][emailCol]).trim().toLowerCase() === target) { sheet.deleteRow(i + 1); return true; }
  }
  return false;
}

// Loose Roster membership check for the soft account-creation warning. Compares
// trimmed strings and a leading-C-stripped form so a "0001"/"C0001" mismatch
// (Sheets quirks) doesn't trigger a false warning.
function rosterHasId(personId) {
  var rows = readTab("Roster");
  if (!Array.isArray(rows)) return false;
  var t = String(personId).trim().replace(/^C/i, "");
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i].id || rows[i]["4d"] || rows[i]["4D"] || "").trim().replace(/^C/i, "");
    if (id === t || (+id && +id === +t)) return true;
  }
  return false;
}

// ── Token / session management (admin) ───────────────────

function handleListTokens(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  var props = PropertiesService.getScriptProperties();
  var tokens = [];
  props.getKeys().forEach(function (k) {
    if (k.indexOf("auth:") !== 0) return;
    try {
      var c = JSON.parse(props.getProperty(k));
      if (c && c.role) {
        tokens.push({
          token: k.slice(5), tokenPrefix: k.slice(5, 13),
          email: c.email || "", role: c.role || "",
          issuedAt: c.issuedAt || "", expired: isTokenExpired(c)
        });
      }
    } catch (e) { /* skip malformed */ }
  });
  return { ok: true, tokens: tokens };
}

function handleRevokeToken(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  if (!body.targetToken) return { error: "targetToken required." };
  PropertiesService.getScriptProperties().deleteProperty("auth:" + body.targetToken);
  // `role` intentionally omitted: if an admin revokes their OWN current session
  // token (targetToken === body.auth), the token is already gone by the time we
  // get here — this needs the fallback lookup (which will correctly resolve to
  // "" in that edge case, exactly as today) rather than ctx.role, which was
  // captured before the deletion and would silently disagree with it.
  writeAuditLog(ctx.email, ctx.personId, "revoke_token", body.targetEmail || "", "specific token", body.auth);
  return { ok: true };
}

function handleRevokeAllForEmail(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  if (!body.targetEmail) return { error: "targetEmail required." };
  var n = revokeAllTokensForEmail(body.targetEmail);
  // `role` intentionally omitted: unlike remove_account, there's no guard here
  // against body.targetEmail === ctx.email — an admin revoking their own
  // account's tokens deletes their own live session first, so the fallback
  // lookup (not ctx.role) is needed to reproduce today's exact ("" in that
  // case) logged role.
  writeAuditLog(ctx.email, ctx.personId, "revoke_all_for_email", body.targetEmail, n + " token(s)", body.auth);
  return { ok: true, revoked: n };
}

function handleRevokeAllTokens(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  var props = PropertiesService.getScriptProperties();
  var n = 0;
  props.getKeys().forEach(function (k) { if (k.indexOf("auth:") === 0) { props.deleteProperty(k); n++; } });
  // `role` intentionally omitted: this ALWAYS revokes the caller's own token too
  // (see the "revoked" comment below) before we get here, so a fresh lookup of
  // body.auth reliably (and correctly, matching today) resolves to "" — using
  // the fallback keeps that guarantee without hardcoding the assumption here.
  writeAuditLog(ctx.email, ctx.personId, "revoke_all_tokens", null, n + " token(s)", body.auth);
  return { ok: true, revoked: n };  // note: this also revokes the caller's own token
}

function revokeAllTokensForEmail(email) {
  var props = PropertiesService.getScriptProperties();
  var target = String(email).trim().toLowerCase();
  var count = 0;
  props.getKeys().forEach(function (k) {
    if (k.indexOf("auth:") !== 0) return;
    try {
      var stored = JSON.parse(props.getProperty(k));
      if (stored && String(stored.email || "").toLowerCase() === target) { props.deleteProperty(k); count++; }
    } catch (e) { /* skip */ }
  });
  return count;
}

// ── Offline data grants (BACKEND_MIGRATION_REVIEW.md §4.7.5a) ────
//
// A device may keep a local copy of the company's data only while it holds an
// unexpired grant. **The enforcement is client-side**, because it has to be: a
// device that never comes back online cannot be reached, so a client-stamped
// expiry is the only control that works in the case that actually matters (lost
// phone, ORD'd member who stopped coming in). What lives here is the other two
// thirds of the feature:
//
//   • **Visibility** — an admin can see which devices hold a copy and until when.
//     Turns an invisible exposure into an auditable one.
//   • **Revoke-on-next-contact** — an admin marks a grant revoked; the device
//     learns it the next time it talks to this endpoint and wipes. This is NOT a
//     remote wipe and the UI must never call it one (§4.7.5a).
//
// Stored in ScriptProperties rather than a sheet tab: it is small, per-device,
// self-expiring operational state, and keeping it out of the sheet avoids a
// schema migration and keeps it out of every backup export.
//
// The device id is OPAQUE — a random value minted in the browser, never a device
// name — because this list is itself new personal data and should be minimal.
var OFFLINE_GRANT_MAX_MS = 14 * 24 * 60 * 60 * 1000;   // mirrors OFFLINE_GRANT_MAX_DAYS in js/state.js

function offlineGrantKey_(deviceId) { return "ogrant:" + String(deviceId || "").slice(0, 80); }

// Any signed-in role. The caller is registering a grant for ITS OWN session —
// the email is taken from the token context, never from the request body, so a
// device cannot register a grant in someone else's name.
function handleRegisterOfflineGrant(body, ctx) {
  var deviceId = body && body.deviceId ? String(body.deviceId).slice(0, 80) : "";
  if (!deviceId) return { error: "deviceId required" };
  var now = new Date().getTime();
  var requested = body && body.expiresAt ? new Date(body.expiresAt).getTime() : NaN;
  // Clamp server-side as well as in the client. The client-side expiry is what
  // enforces, so this cannot stop a modified client from keeping data longer —
  // it stops the ADMIN LIST from displaying a reassuring lie about how long a
  // cooperative device intends to hold it.
  if (!isFinite(requested) || requested <= now) requested = now + OFFLINE_GRANT_MAX_MS;
  var expiresAt = new Date(Math.min(requested, now + OFFLINE_GRANT_MAX_MS)).toISOString();

  PropertiesService.getScriptProperties().setProperty(offlineGrantKey_(deviceId), JSON.stringify({
    deviceId: deviceId,
    email: ctx.email,
    personId: ctx.personId || "",
    registeredAt: new Date(now).toISOString(),
    expiresAt: expiresAt
  }));
  writeAuditLog(ctx.email, ctx.personId, "offlineGrant", deviceId, "expires " + expiresAt, null, ctx.role);
  return { ok: true, expiresAt: expiresAt };
}

// The device's own check-in. Returns revoked:true once an admin has pulled the
// grant (or when the server has no record of it at all and it has lapsed).
function handleCheckOfflineGrant(body, ctx) {
  var deviceId = body && body.deviceId ? String(body.deviceId) : "";
  if (!deviceId) return { error: "deviceId required" };
  var raw = PropertiesService.getScriptProperties().getProperty(offlineGrantKey_(deviceId));
  // No server record is NOT treated as revoked: registration is best-effort (it
  // can fail while the local grant succeeds), and inferring revocation from a
  // missing row would wipe a device because of a dropped request.
  if (!raw) return { ok: true, revoked: false, known: false };
  var g;
  try { g = JSON.parse(raw); } catch (e) { return { ok: true, revoked: false, known: false }; }
  return { ok: true, known: true, revoked: !!g.revoked, expiresAt: g.expiresAt || "" };
}

// Admins revoke any device; anyone may revoke their own (that is the "turn it
// off here" button clearing its own server record).
function handleRevokeOfflineGrant(body, ctx) {
  var deviceId = body && body.deviceId ? String(body.deviceId) : "";
  if (!deviceId) return { error: "deviceId required" };
  var props = PropertiesService.getScriptProperties();
  var key = offlineGrantKey_(deviceId);
  var raw = props.getProperty(key);
  if (!raw) return { ok: true, revoked: 0 };
  var g;
  try { g = JSON.parse(raw); } catch (e) { props.deleteProperty(key); return { ok: true, revoked: 1 }; }
  var mine = String(g.email || "").toLowerCase() === String(ctx.email || "").toLowerCase();
  if (!mine && !isAdmin(ctx)) return { error: "Admin only.", code: 403 };
  if (mine) {
    // The device is telling us it has already wiped — nothing left to signal.
    props.deleteProperty(key);
  } else {
    g.revoked = true;
    g.revokedAt = new Date().toISOString();
    g.revokedBy = ctx.email;
    props.setProperty(key, JSON.stringify(g));
  }
  writeAuditLog(ctx.email, ctx.personId, "offlineGrantRevoke", deviceId, g.email || "", null, ctx.role);
  return { ok: true, revoked: 1 };
}

// Admin review list. `state` is deliberately three-valued and the middle one is
// the honest one: a revoked grant is "pending device check-in", NOT "wiped".
// Displaying it as wiped would let an admin believe data was destroyed when it
// is still sitting on a phone that has not been online since (§4.7.5a).
function handleListOfflineGrants(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Admin only.", code: 403 };
  var props = PropertiesService.getScriptProperties();
  var now = new Date().getTime();
  var out = [];
  props.getKeys().forEach(function (k) {
    if (k.indexOf("ogrant:") !== 0) return;
    var g;
    try { g = JSON.parse(props.getProperty(k)); } catch (e) { return; }
    if (!g) return;
    var expired = !g.expiresAt || new Date(g.expiresAt).getTime() <= now;
    // Housekeeping: an expired grant has done its job (the device wiped itself
    // on schedule, with or without contact) so the record stops being useful.
    if (expired && !g.revoked) { props.deleteProperty(k); return; }
    out.push({
      deviceId: g.deviceId, email: g.email, personId: g.personId || "",
      registeredAt: g.registeredAt || "", expiresAt: g.expiresAt || "",
      state: g.revoked ? (expired ? "expired" : "revoked") : "active",
      revokedAt: g.revokedAt || "", revokedBy: g.revokedBy || ""
    });
  });
  out.sort(function (a, b) { return String(a.expiresAt).localeCompare(String(b.expiresAt)); });
  return { ok: true, grants: out };
}

// ── Audit log (A2) ───────────────────────────────────────

// P2-3: `role` is resolved ONCE by the caller (routeAuthedPost/handleLogin
// already hold `ctx` from the request's own getAuthContext(token) call) and
// passed straight through here, instead of writeAuditLog re-resolving it via
// a second ScriptProperties read on every single audited write.
//
// `role` is OPTIONAL (undefined when omitted) on purpose: a few call sites
// (logout, revokeToken, revokeAllForEmail, revokeAllTokens) can invalidate
// the very auth token being logged as a *side effect of the action itself*
// (deleting the caller's own session before we get here) — for those the
// caller's already-resolved ctx.role may no longer match what a fresh lookup
// of `token` would return post-deletion. Rather than guess, those call sites
// omit `role` and this function falls back to the original token lookup,
// reproducing today's exact (possibly now-empty) logged role byte-for-byte.
function writeAuditLog(email, personId, action, target, detail, token, role) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("AuditLog");
    if (!sheet) return;  // tab not created yet — never let logging break the action
    var resolvedRole = role;
    if (resolvedRole === undefined) {
      var ctx = token ? getAuthContext(token) : null;
      resolvedRole = ctx ? ctx.role : "";
    }
    sheet.appendRow([
      new Date().toISOString(),
      email || "", personId || "",
      resolvedRole || "",
      action || "", target || "", detail || "",
      token ? String(token).slice(0, 8) : ""
    ]);
  } catch (e) {
    Logger.log("AuditLog write failed: " + e.message);
  }
}

// Extracted so routeAuthedPost can reuse the email-info probe (same logic that
// used to live inline in doPost).
function getEmailInfoHelper() {
  var senderEmail = "";
  try { senderEmail = Session.getEffectiveUser().getEmail(); } catch (e) { /* no userinfo.email scope */ }
  if (!senderEmail) { try { senderEmail = Session.getActiveUser().getEmail(); } catch (e) { /* idem */ } }
  var remainingQuota = null, quotaError = null;
  try { remainingQuota = MailApp.getRemainingDailyQuota(); }
  catch (e) { quotaError = "Email scope not granted yet — grant the script.send_mail permission to enable sending."; }
  return { senderEmail: senderEmail || "", remainingQuota: remainingQuota, quotaError: quotaError };
}

// ── Editor-run setup (run these once from the Apps Script editor) ──

// Creates the Accounts + AuditLog tabs with the right headers, or repairs the
// headers non-destructively if the tabs already exist. Safe to re-run.
function setupAuthTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabWithHeaders_(ss, "Accounts", ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt", "caps"]);
  ensureTabWithHeaders_(ss, "AuditLog", ["timestamp", "email", "personId", "role", "action", "target", "detail", "tokenPrefix"]);
  Logger.log("Accounts and AuditLog tabs are ready.");
}

function ensureTabWithHeaders_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return;
  }
  // Append any missing headers to the end of row 1 (leaves existing data intact).
  var lastCol = sheet.getLastColumn() || 0;
  var existing = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var have = {};
  existing.forEach(function (h) { if (h) have[String(h).trim()] = true; });
  var missing = headers.filter(function (h) { return !have[h]; });
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  }
  sheet.setFrozenRows(1);
}

/**
 * One-shot data migration: Medical.mrTiming -> Medical.time (MR rows only).
 * Run ONCE from the Apps Script editor, BEFORE deploying the matching frontend.
 *
 * MR used to carry a free-text timing column because spec §6 allows "PM" where an
 * HHMM column cannot hold it. Feature 30.1 needs ONE time source across all four
 * visit types, so MR moved onto Medical.time. Values that parse as a time are
 * copied across; anything else ("PM", "AM", free text) CANNOT be represented and
 * is dropped — by decision, not by accident, which is why every dropped value is
 * logged with its 4D and date so it can be re-entered by hand.
 *
 * The mrTiming COLUMN is deliberately left in place, values and all. It is the
 * only surviving record of the dropped timings, the app still surfaces an
 * unmigrated value on the visit-type badge ("MR PM"), and removing a column that
 * writeTab derives its headers from is a far larger operation than this needs.
 * Nothing writes to it again — submitMedical emits it blank.
 *
 * Idempotent: a row that already has a time is skipped, so re-running is a no-op.
 * Ordering matters — run this BEFORE the frontend ships, or existing MR rows
 * render with no timing in the parade state.
 */
function bravesMigrateMrTiming() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Medical");
  if (!sh) { Logger.log("No Medical tab — nothing to do."); return; }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) { Logger.log("Medical is empty — nothing to do."); return; }
  var head = values[0];
  var cType = head.indexOf("type"), cTiming = head.indexOf("mrTiming");
  var cTime = head.indexOf("time"), cD4 = head.indexOf("d4"), cDate = head.indexOf("date");
  if (cType < 0 || cTiming < 0 || cTime < 0) {
    Logger.log("Missing a required column (type/mrTiming/time) — run bravesMigrateSchema() first.");
    return;
  }
  var moved = 0, skipped = 0, dropped = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (String(row[cType]).trim() !== "MR") continue;
    var raw = String(row[cTiming] == null ? "" : row[cTiming]).trim();
    if (!raw) continue;
    if (String(row[cTime] == null ? "" : row[cTime]).trim()) { skipped++; continue; }  // idempotent
    // Accept "1400", "930", "14:00" -> "1400"; reject anything else.
    var m = /^(\d{1,2}):?(\d{2})$/.exec(raw);
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) {
      // setValue on a WRITE_TEXT_COLS_BY_TAB column: Medical.time is already
      // forced to plain-text format, so "0930" survives instead of becoming 930.
      sh.getRange(i + 1, cTime + 1).setValues([[("0" + m[1]).slice(-2) + m[2]]]);
      moved++;
    } else {
      dropped.push(String(row[cD4]) + " / " + String(row[cDate]) + " / \"" + raw + "\"");
    }
  }
  Logger.log("mrTiming migration: " + moved + " moved, " + skipped
    + " already had a time, " + dropped.length + " dropped.");
  if (dropped.length) {
    Logger.log("DROPPED — these could not be represented as HHMM. The mrTiming column still");
    Logger.log("holds them and the app shows them on the visit badge; re-enter any that matter:");
    for (var j = 0; j < dropped.length; j++) Logger.log("  " + dropped[j]);
  }
}

// One-off schema migration (sheet-audit remediation). Run once from the editor:
//   bravesMigrateSchema()
// Brings an existing live sheet up to the schema the frontend already expects.
// SAFE TO RE-RUN: ensureTabWithHeaders_ only *appends* missing header cells to the
// end of row 1 and never rewrites data rows, so existing values are untouched and
// already-present columns are skipped. It does NOT push via writeTab (which would
// re-derive headers from Object.keys(data[0]) and could strip columns). It also
// never touches ParadeArchive or SickArchive.
//
// What it does:
//   • Roster      — adds the Step-2 Braves columns (platoon, section, rankGroup, fourD)
//                   and `appointment` (duty-list eligibility, DUTY_LIST_SPEC.md §5)
//   • Medical     — adds the §6 columns (location, type, urtiType, mrTiming, visitId, origin, bookInDate)
//   • Appointments— adds outOfCamp (parade-state "Camp:" line depends on it)
//   • Leave        — adds isInCamp (the "In Camp" override; strength calc depends on it), bookInDate
//   • BravesConfig— creates the key|value company-identity tab and seeds it from
//                   DEFAULT_CONFIG (kept in sync with js/state.js)
//   • Config      — creates the columns-as-keys archive-scheduler tab
//   • Platoons / VocFit / SOC — creates the reference tabs with their headers
// It does NOT backfill values for the new Roster/Medical columns — that is manual
// data entry the user owns. rankGroup in particular cannot be derived from a 4D.
function bravesMigrateSchema() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Append-only column additions to existing tabs (no-ops if the column exists).
  ensureTabWithHeaders_(ss, "Roster",
    ["platoon", "section", "rankGroup", "fourD", "appointment"]);
  ensureTabWithHeaders_(ss, "Medical",
    ["location", "type", "urtiType", "mrTiming", "visitId", "origin", "bookInDate", "time", "outOfCamp"]);
  ensureTabWithHeaders_(ss, "Appointments",
    ["outOfCamp"]);
  ensureTabWithHeaders_(ss, "Leave",
    ["isInCamp", "isInCampReviewed", "bookInDate"]);
  ensureTabWithHeaders_(ss, "ConductDetail",
    ["eventTime"]);

  // Reference tabs (created with headers if absent; missing tab → [] on frontend).
  ensureTabWithHeaders_(ss, "Platoons",
    ["code", "displayName", "active", "createdAt"]);
  ensureTabWithHeaders_(ss, "VocFit",
    ["personId", "completionDate", "certifyingUnit"]);
  ensureTabWithHeaders_(ss, "SOC",
    ["id", "d4", "socNum", "date", "time", "avgHr", "pass"]);

  // Duty list (MD_Docs/DUTY_LIST_SPEC.md §3). `d4` on Duty and DutyCorrection is
  // registered in WRITE_TEXT_COLS_BY_TAB — without that, Sheets coerces "0042" to
  // 42 on write and every commander 4D is corrupted (the documented cause of the
  // Attendance-participants and conduct-time bugs).
  ensureTabWithHeaders_(ss, "Duty",
    ["id", "date", "dutyType", "platoon", "d4", "assignedBy", "assignedAt", "source"]);
  ensureTabWithHeaders_(ss, "DutyCorrection",
    ["id", "date", "d4", "reason", "delta", "note", "enteredBy", "enteredAt"]);
  ensureTabWithHeaders_(ss, "Holidays",
    ["date", "name", "tentative"]);
  ensureTabWithHeaders_(ss, "DutyUnavailable",
    ["id", "d4", "from", "to", "note", "addedBy", "addedAt"]);
  ensureTabWithHeaders_(ss, "DutyChangeRequest",
    ["id", "submittedBy", "submittedAt", "date", "dutyType", "platoon", "kind",
     "fromD4", "toD4", "swapDate", "swapDutyType", "swapPlatoon", "reason",
     "status", "decidedBy", "decidedAt", "decisionNote"]);

  // Duty-planning capability (DUTY_LIST_SPEC.md §9.2). A comma-separated `caps`
  // column on Accounts, NOT a fourth role: a duty planner also needs ordinary
  // commander powers, so it is a capability, not a rung on the viewer <
  // commander < admin ladder. It is here rather than in Config because Config is
  // a commander-writable tab — an allowlist there would be self-service
  // privilege escalation.
  ensureTabWithHeaders_(ss, "Accounts", ["caps"]);

  // BravesConfig (key|value) — create + seed the company-identity settings the
  // frontend's DEFAULT_CONFIG defines. Only seeds keys that aren't already present
  // so re-running never clobbers values an admin has edited.
  ensureTabWithHeaders_(ss, "BravesConfig", ["key", "value"]);
  bravesSeedConfig_(ss);

  // Config (columns-as-keys, ONE data row) — the archive scheduler's times.
  // This tab was originally created by the Telegram bot's setupBotTabs(), which
  // is why it has a different shape from BravesConfig. The bot is gone; the tab
  // is not, because bravesParseParadeSlots_/bravesSickSlots_ read their
  // schedules from it and readAllTabs merges it into STATE.config. Left empty on
  // creation: an absent/blank archiveParadeTimes means "don't archive", which is
  // the correct default for a sheet that has never configured a schedule.
  ensureTabWithHeaders_(ss, "Config", ["archiveParadeTimes", "archiveSickTimes"]);

  Logger.log("bravesMigrateSchema complete. Review the new columns/tabs, then " +
    "redeploy (Manage Deployments → new Version, same URL).");
}

// One-off backfill migration — run once from the editor after deploying the
// explicit In Camp/Not In Camp toggle:
//   bravesBackfillLeaveInCamp()
// Existing Leave rows may have a blank isInCamp cell — that used to mean
// "guess from the reason text" for non-AL/OIL types (bpOthersNotInCamp), and
// was always FALSE for AL/OIL types. The classifier no longer guesses (every
// row must carry an explicit isInCamp now), so this writes that same legacy
// guess into every still-blank cell, once, so parade-state output for
// existing records doesn't change at the moment this runs.
// SAFE TO RE-RUN — only touches rows where isInCamp isn't already an
// explicit TRUE/FALSE. Never touches isInCampReviewed (legacy rows are never
// flagged for review — only new sick-history imports are).
function bravesBackfillLeaveInCamp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Leave");
  if (!sheet) { Logger.log("No Leave tab found."); return; }
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2) { Logger.log("Leave tab has no data rows."); return; }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  headers.forEach(function (h, i) { col[String(h).trim()] = i; });
  if (col.isInCamp === undefined || col.type === undefined) {
    Logger.log("Leave tab is missing isInCamp/type columns — run bravesMigrateSchema() first.");
    return;
  }
  var range = sheet.getRange(2, 1, lastRow - 1, lastCol);
  var values = range.getValues();
  var updated = 0;
  values.forEach(function (row) {
    var cur = row[col.isInCamp];
    if (cur === true || cur === false) return; // already explicit — skip
    var type = row[col.type];
    var reason = col.reason !== undefined ? row[col.reason] : "";
    row[col.isInCamp] = bpIsAlOilType(type) ? false : !bpOthersNotInCamp(reason, undefined);
    updated++;
  });
  if (updated) range.setValues(values);
  Logger.log("bravesBackfillLeaveInCamp complete. " + updated + " row(s) given an explicit isInCamp value.");
}

// Seed BravesConfig with the spec §4 defaults. Mirrors DEFAULT_CONFIG in
// js/state.js — keep the two in sync. Skips any key already present so an admin's
// edits and re-runs are both safe.
function bravesSeedConfig_(ss) {
  var DEFAULTS = {
    companyName: "40 SAR BRAVES COMPANY",
    companyPrefix: "B",
    companyCoyCode: "B COY",
    unitCode: "40SAR",
    hqLabel: "BRAVES HQ",
    defaultSickLocation: "PTMC",
    polarCompanyName: "Braves Coy",
    haEligibilitySource: "currencyTag",
    alOilLeaveTypes: "Leave, Off-in-Lieu, OIL, AL, Annual Leave, Weekend, Night's Out, Compassionate"
  };
  var sheet = ss.getSheetByName("BravesConfig");
  var last = sheet.getLastRow();
  var have = {};
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      if (r[0]) have[String(r[0]).trim()] = true;
    });
  }
  var toAdd = [];
  Object.keys(DEFAULTS).forEach(function (k) { if (!have[k]) toAdd.push([k, DEFAULTS[k]]); });
  if (toAdd.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 2).setValues(toAdd);
  }
}

// Bootstrap the very first admin account. Run once from the editor:
//   seedFirstAdmin("you@example.com", "your-strong-password")
// Then log in via the web app and create the rest from the admin panel.
function seedFirstAdmin(email, password) {
  if (!email || !password) { Logger.log("Usage: seedFirstAdmin('you@example.com','password')"); return; }
  setupAuthTabs();
  if (findAccountByEmail(email)) { Logger.log("An account with that email already exists."); return; }
  var salt = generateSalt();
  appendRow("Accounts", {
    email: String(email).trim(), personId: "", role: "admin",
    passwordHash: hashPassword(password, salt), salt: salt,
    addedBy: "seedFirstAdmin", addedAt: new Date().toISOString()
  });
  Logger.log("Admin account created for " + email + ". Log in via the web app.");
}

// General editor helper to add any account without the UI.
//   createAccount("pc1@unit.mil", "0012", "commander", "password")
function createAccount(email, personId, role, password) {
  if (!email || !password) { Logger.log("Usage: createAccount('email','personId','role','password')"); return; }
  if (["admin", "commander", "viewer"].indexOf(role) < 0) { Logger.log("role must be admin | commander | viewer"); return; }
  setupAuthTabs();
  if (findAccountByEmail(email)) { Logger.log("Account already exists."); return; }
  var salt = generateSalt();
  appendRow("Accounts", {
    email: String(email).trim(), personId: personId || "", role: role,
    passwordHash: hashPassword(password, salt), salt: salt,
    addedBy: "createAccount(editor)", addedAt: new Date().toISOString()
  });
  Logger.log(role + " account created for " + email);
}

// ─── READ OPERATIONS ───────────────────────────────────

function getTabNames() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().map(function (s) { return s.getName(); });
}

function readTab(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found", available: getTabNames() };

  var range = sheet.getDataRange();
  var data = range.getValues();
  var display = range.getDisplayValues();
  if (data.length < 2) return [];

  var headers = data[0].map(function (h) { return String(h).trim(); });
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    var hasData = false;
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        var val = data[i][j];
        // For Date-typed cells:
        //   • Time-only values (cells on the spreadsheet epoch 1899-12-30) →
        //     use whatever the sheet *displays*, so the user's chosen format
        //     (mm:ss, hh:mm, etc.) flows through as-is to the app.
        //   • Real calendar dates → force "dd MMM yyyy" so locale-quirks in
        //     the sheet don't change what the app shows.
        if (val instanceof Date) {
          val = val.getFullYear() < 1900
            ? display[i][j]
            : Utilities.formatDate(val, Session.getScriptTimeZone(), "dd MMM yyyy");
        }
        row[headers[j]] = val;
        if (val !== "" && val !== null && val !== undefined) hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }

  return rows;
}

// P2-4: like readTab, but for a tab that can grow without bound (AuditLog) —
// reads only the header row plus the LAST `maxRows` data rows, via
// getLastRow() + a tail getRange(), instead of readTab's getDataRange() over
// the whole sheet. Row shaping (Date/display-value handling, the hasData
// filter) is copy-identical to readTab so the response shape matches exactly;
// only the ROW COUNT differs. Order is preserved top-to-bottom (oldest-of-
// the-tail first), same as a full readTab — the frontend already reverses the
// list for newest-first display, so this doesn't change that contract.
function readTabTail(tabName, maxRows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found", available: getTabNames() };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];  // header-only or empty sheet — nothing to read
  var lastCol = sheet.getLastColumn();

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });

  var totalDataRows = lastRow - 1;
  var startRow = totalDataRows > maxRows ? (lastRow - maxRows + 1) : 2;  // 1-based, first data row is row 2
  var nRows = lastRow - startRow + 1;

  var range = sheet.getRange(startRow, 1, nRows, lastCol);
  var data = range.getValues();
  var display = range.getDisplayValues();

  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var row = {};
    var hasData = false;
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        var val = data[i][j];
        if (val instanceof Date) {
          val = val.getFullYear() < 1900
            ? display[i][j]
            : Utilities.formatDate(val, Session.getScriptTimeZone(), "dd MMM yyyy");
        }
        row[headers[j]] = val;
        if (val !== "" && val !== null && val !== undefined) hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }

  return rows;
}

function readAllTabs(ctx) {
  var tabMap = {
    "Roster": "roster",
    "Medical": "medical",
    "Attendance": "attendance",
    "IPPT": "ippt",
    "RouteMarch": "rm",
    "SOC": "soc",
    "PolarFlow": "polar",
    "ConductDetail": "conductDetail",
    "Appointments": "appointments",
    "Leave": "leave",
    "MSK": "msk",
    "Conducts": "conducts",
    // Braves reference tabs (spec §4/§12/A6). Optional: a missing tab yields []
    // and the frontend falls back to defaults/derivation. Config is handled
    // separately below (it is merged from two tabs).
    "VocFit": "vocfit",
    "Platoons": "platoons",
    // Duty list (DUTY_LIST_SPEC.md §3) plus the unavailability flags (design §4).
    // These were absent here while being present in REV_TABS, which is worse than
    // either alone would have been: a full pull returned no duty key at all
    // (pullAll gates each assignment on Array.isArray, so it skipped them in
    // silence) yet still advanced the client's rev baseline from data.revs, so
    // the incremental launch path then saw nothing changed and never asked. A
    // device with a cold cache never loaded the duty roster.
    "Duty": "duty",
    "DutyCorrection": "dutyCorrection",
    "Holidays": "holidays",
    "DutyUnavailable": "dutyUnavailable",
    "DutyChangeRequest": "dutyChangeRequest"
  };

  var result = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  for (var tabName in tabMap) {
    var sheet = ss.getSheetByName(tabName);
    if (sheet) {
      result[tabMap[tabName]] = readTab(tabName);
    } else {
      result[tabMap[tabName]] = [];
    }
  }

  // Config is split across two tabs by design (sheet-audit remediation, §4):
  //   • "Config"       — archive-scheduler config (columns-as-keys row)
  //   • "BravesConfig" — Braves company-identity settings (key|value rows)
  // Read both and concat the rows. The frontend's normalizeConfig collapses the
  // combined list into one object, so scheduler keys (archiveParadeTimes, …) and
  // Braves keys (companyName, …) live side by side without colliding. readTab
  // returns [] for an empty/absent tab, so concat is always safe.
  var cfgRows = [];
  if (ss.getSheetByName("Config"))       cfgRows = cfgRows.concat(readTab("Config"));
  if (ss.getSheetByName("BravesConfig")) cfgRows = cfgRows.concat(readTab("BravesConfig"));
  result.config = cfgRows;

  // Admin-only: include the audit log in the pull (A2.5). The Accounts tab is
  // never included here — it carries password hashes and is reached only via the
  // dedicated, hash-stripping listAccounts action.
  if (ctx && ctx.role === "admin") {
    // P2-4: AuditLog grows on every data write, forever — bound the readAll
    // payload to the most recent AUDIT_READALL_MAX_ROWS rows (readTabTail)
    // instead of shipping the entire sheet on every admin full pull. The Sheet
    // itself remains the complete trail; this only bounds what rides in the
    // response. ParadeArchive/SickArchive are NOT capped — they grow ~2/day
    // (a handful of snapshots), so their full-sheet cost is not material the
    // way AuditLog's per-write growth is; re-evaluate if that changes.
    result.auditLog = ss.getSheetByName("AuditLog") ? readTabTail("AuditLog", AUDIT_READALL_MAX_ROWS) : [];
  }
  // Archived parade-state / report-sick messages (Item 1) — readable by commanders
  // AND admins (Fix1B): parade state is archived when either role copies it, and
  // both need to review/compare. Empty arrays when the tabs don't exist yet.
  if (canWrite(ctx)) {
    result.paradeArchive = ss.getSheetByName("ParadeArchive") ? readTab("ParadeArchive") : [];
    // Sick-archive rows are whole-company generated message text — there is no
    // per-person row to filter and no way to redact one platoon out of a
    // rendered message. Withheld entirely below company scope.
    result.sickArchive = (rsScopeOf_(ctx).company && ss.getSheetByName("SickArchive"))
      ? readTab("SickArchive") : [];
  }

  // Report-sick scope (spec §1). Applied here rather than inside readTab so the
  // archive cron and other internal readTab callers stay unfiltered.
  result.medical = rsApplyReadScope_("Medical", result.medical, ctx);
  result.msk = rsApplyReadScope_("MSK", result.msk, ctx);

  result.timestamp = new Date().toISOString();
  result.sheetName = ss.getName();
  result.revs = getAllRevs();   // per-tab revisions so the client can baseline
  result.scopeKey = rsScopeKey_(rsScopeOf_(ctx));
  return result;
}

// ─── WRITE OPERATIONS ──────────────────────────────────

// Columns whose value is a string that merely LOOKS numeric to Sheets and must be
// stored as plain text ("@") so setValues' input auto-coercion can't mangle it.
// The Attendance `participants` field is a comma-joined 4D roll (e.g.
// "0110,0111,0023"). In the default General format, Sheets reads those commas as
// thousands separators, coerces the whole cell into ONE number, and — past ~15
// significant figures — zero-fills the tail (IEEE-754 precision loss). That both
// shifts the commas into 3-digit grouping AND turns the trailing 4Ds into 0000s,
// so parseParticipantIds() then matches nobody and the conduct silently gives zero
// HA credit. Forcing the column to "@" first makes the string round-trip verbatim.
// (Same class of fix as bravesForceTextCols_ for the archive tabs.) Keyed by tab.
// ConductDetail.time is the SAME trap: a leading-zero clock time ("0730") gets
// coerced to the number 730, so it no longer round-trips as a string. That breaks
// replaceConductRows' (date,time,conductId) delete-match — the delete no-ops and
// every re-save of a morning conduct DUPLICATES its rows — and the client-side
// dedup/preload (which compare against pad4Time keys). Forcing "@" keeps "0730"
// verbatim, exactly like participants.
// Attendance.time / Appointments.time / PolarFlow.time are the SAME clock-time
// shape (js/helpers.js pad4Time — "0730", not the ConductDetail-style HHMM-only
// exception granted to RouteMarch/SOC's MM:SS duration `time`, which already
// survives because it contains a colon). Attendance.time in particular is
// compared for string equality against the now-protected ConductDetail.time in
// several forms.js call sites (findConductDetailMatch-style (date,time,conductId)
// lookups) — losing its leading zero on the very next pull silently breaks those
// matches the same way #69 did, so it needs the same "@" protection.
// Roster's KEY column is the same trap with the worst consequence. Every other
// tab keys rows on the numeric nextId() counter (no leading zeros, so coercion
// is harmless), but Roster keys on the 4D — and commanders are 0001–0099 while
// recruits include ids like "0110"/"0023". Coerced to 7/110/23, the row-match in
// upsertRow/deleteRowById can never equal the client's padded "0007", so an
// update silently APPENDS a duplicate person instead. Both header spellings are
// listed because the sheet may name the column "4d" or "id" (see SHEET TABS at
// the top of this file); forceTextColsForRange_ skips the ones that don't exist.
var WRITE_TEXT_COLS_BY_TAB = { Attendance: ["participants", "time"], Appointments: ["time"], ConductDetail: ["time", "eventTime"], Conducts: ["className", "makeupFor"], Medical: ["time"], PolarFlow: ["time"], Roster: ["id", "4d", "4D"], Duty: ["d4"], DutyCorrection: ["d4"], DutyUnavailable: ["d4", "from", "to"], DutyChangeRequest: ["fromD4", "toD4", "date", "swapDate"] };

// Which sheet column holds a tab's row key, in preference order. Default is the
// literal "id" column that nextId()-keyed tabs use. Roster is the exception: the
// live sheet's header for the 4D is "4d" (see readTab's normalizer comment —
// "the Roster id column (named 4d on the sheet)"), so looking only for "id" made
// ensureColumnsForKeys mint a brand-new EMPTY "id" column, match nothing, and
// append a duplicate roster row on every single write.
var KEY_ALIASES_BY_TAB = { Roster: ["id", "4d", "4D"] };

// Resolves a tab's key column against the headers ALREADY on the sheet — this
// must run BEFORE ensureColumnsForKeys, or the column it is looking for gets
// created empty and the lookup succeeds on a column no existing row has filled.
// Returns null when the sheet has none of the aliases (caller falls back to the
// historical "id" behaviour).
function resolveKeyCol_(tabName, trimmedHeaders) {
  var aliases = KEY_ALIASES_BY_TAB[tabName] || ["id"];
  for (var i = 0; i < aliases.length; i++) {
    if (trimmedHeaders.indexOf(aliases[i]) !== -1) return aliases[i];
  }
  return null;
}

// How to compare a stored key cell against the client's row id. Roster keys are
// 4Ds that Sheets may have stored numerically, so they compare padded; every
// other tab compares verbatim. bravesPadD4_ is the same normalizer the read
// boundary uses, so both sides agree on what "0007" means.
function keyMatches_(tabName, cellValue, rowId) {
  if (tabName === "Roster") return bravesPadD4_(cellValue) === bravesPadD4_(rowId);
  return String(cellValue) === String(rowId);
}

function writeTab(tabName, data) {
  if (!Array.isArray(data)) {
    return { error: "Data must be an array of objects" };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);

  // A replace that legitimately zeroes out a tab (e.g. cascade-deleting a
  // conduct's last remaining records) can't derive headers from data[0] since
  // there isn't one — just clear the existing data rows and keep the header.
  if (data.length === 0) {
    if (!sheet) return { ok: true, tab: tabName, rowsWritten: 0 };
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
    return { ok: true, tab: tabName, rowsWritten: 0, timestamp: new Date().toISOString() };
  }

  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }

  var headers = Object.keys(data[0]);

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  // sheet.clear() above wipes number formats, so re-apply the plain-text format to
  // any coercion-prone column BEFORE writing data (setting it after setValues can't
  // un-coerce an already-mangled number). The row-level writers no longer depend on
  // this — they force "@" on their own target range via forceTextColsForRange_ — but
  // formatting the whole column here keeps the sheet visually consistent after a
  // full rewrite.
  if (WRITE_TEXT_COLS_BY_TAB[tabName]) bravesForceTextCols_(ss, tabName, WRITE_TEXT_COLS_BY_TAB[tabName]);

  var rows = data.map(function (obj) {
    return headers.map(function (h) {
      var val = obj[h];
      return val !== undefined && val !== null ? val : "";
    });
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return {
    ok: true,
    tab: tabName,
    rowsWritten: rows.length,
    timestamp: new Date().toISOString()
  };
}

// Ensures the sheet has a column for every key in `keys`. Any missing header is
// appended to row 1 (bold) so NEW fields persist on first write instead of being
// silently dropped — the row-level writers only map to existing columns, which
// otherwise loses a field until someone does a full re-push. Returns the
// up-to-date trimmed header list.
function ensureColumnsForKeys(sheet, keys) {
  var lastCol = sheet.getLastColumn();
  var headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var trimmed = headers.map(function (h) { return String(h).trim(); });
  var missing = [];
  keys.forEach(function (k) {
    if (k && trimmed.indexOf(k) === -1 && missing.indexOf(k) === -1) missing.push(k);
  });
  if (missing.length) {
    var rng = sheet.getRange(1, trimmed.length + 1, 1, missing.length);
    rng.setValues([missing]);
    rng.setFontWeight("bold");
    trimmed = trimmed.concat(missing);
  }
  return trimmed;
}

// Force plain-text ("@") number format on any WRITE_TEXT_COLS_BY_TAB column of
// `tabName` within the row range [startRow, startRow+numRows), BEFORE setValues
// writes it. writeTab formats the whole column (it owns the clear+rewrite), but
// the row-level writers (appendRow/appendMany/upsertRow) don't — so a participants
// roll appended past the last full writeTab, or written into a participants column
// that ensureColumnsForKeys just created with the default format, would be coerced
// (commas read as thousands separators, leading 4D zeros dropped) and silently zero
// out that conduct's HA credit. Forcing "@" on just the target cells first makes the
// string round-trip verbatim on EVERY write path. Setting format after setValues
// can't un-coerce an already-mangled number, so every caller sets it beforehand.
// `headers` is the up-to-date (post-ensureColumnsForKeys) trimmed header list.
function forceTextColsForRange_(sheet, tabName, headers, startRow, numRows) {
  var cols = WRITE_TEXT_COLS_BY_TAB[tabName];
  if (!cols || numRows < 1) return;
  cols.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx >= 0) sheet.getRange(startRow, idx + 1, numRows, 1).setNumberFormat("@");
  });
}

function appendRow(tabName, rowData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };

  var trimmed = ensureColumnsForKeys(sheet, Object.keys(rowData));
  var newRow = trimmed.map(function (h) {
    var val = rowData[h];
    return val !== undefined && val !== null ? val : "";
  });

  // Explicit range write (not sheet.appendRow) so the coercion-prone columns can be
  // forced to "@" before the value lands — appendRow would coerce on insert.
  var targetRow = sheet.getLastRow() + 1;
  forceTextColsForRange_(sheet, tabName, trimmed, targetRow, 1);
  sheet.getRange(targetRow, 1, 1, trimmed.length).setValues([newRow]);

  return {
    ok: true,
    tab: tabName,
    newRowIndex: sheet.getLastRow() - 1,
    timestamp: new Date().toISOString()
  };
}

function appendMany(tabName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "Rows must be a non-empty array" };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };

  var keySet = {};
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { keySet[k] = true; }); });
  var trimmed = ensureColumnsForKeys(sheet, Object.keys(keySet));
  var newRows = rows.map(function (rowData) {
    return trimmed.map(function (h) {
      var val = rowData[h];
      return val !== undefined && val !== null ? val : "";
    });
  });

  var startRow = sheet.getLastRow() + 1;
  forceTextColsForRange_(sheet, tabName, trimmed, startRow, newRows.length);
  sheet.getRange(startRow, 1, newRows.length, trimmed.length).setValues(newRows);

  return {
    ok: true,
    tab: tabName,
    rowsAppended: newRows.length,
    timestamp: new Date().toISOString()
  };
}

// Atomic per-conduct rewrite. Within ONE lock, deletes every existing row that
// matches (date, time, conductId) and is NOT an RSI row, then appends `rows`.
// This is the conduct-wizard save primitive: it replaces the old client-side
// "delete every old id + appendMany" pair, which fired as SEPARATE writes on
// the sync queue and could partially fail (the deletes commit, the append does
// not) — leaving that conduct's Status/Fallout detail rows deleted-but-not-
// re-added on the sheet. Doing both here under a single withRevLock call means
// the sheet is never observed half-written. Legacy RSI rows are preserved (the
// wizard no longer manages RSI). Idempotent: replaying with the same rows/ids
// yields the same sheet (the just-appended rows match and are re-appended), so a
// post-reload retry is safe. Column- and coercion-safe via the shared helpers.
function replaceConductRows(tabName, match, rows) {
  if (!match || match.conductId === undefined || match.conductId === null || match.conductId === "") {
    return { error: "replaceConductRows requires a match.conductId" };
  }
  if (!Array.isArray(rows)) return { error: "rows must be an array" };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };

  // Ensure columns exist for the match fields AND every key we'll append, so a
  // brand-new field persists instead of being silently dropped.
  var keySet = { id: true, date: true, time: true, conductId: true, d4: true, type: true, reason: true };
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { keySet[k] = true; }); });
  var trimmed = ensureColumnsForKeys(sheet, Object.keys(keySet));
  var idxDate = trimmed.indexOf("date"), idxTime = trimmed.indexOf("time"),
      idxConduct = trimmed.indexOf("conductId"), idxType = trimmed.indexOf("type");

  var mDate = String(match.date == null ? "" : match.date);
  var mTime = String(match.time == null ? "" : match.time);
  var mConduct = String(match.conductId);

  // Delete the matching non-RSI rows, bottom-up so indices stay valid.
  // CRITICAL: the match values (mDate/mTime/mConduct) come from the client, and
  // the client only ever sees what readTab RETURNS — which reformats Date-typed
  // cells to "dd MMM yyyy" (real dates) or the display string (time-only cells).
  // ConductDetail's date/time columns are NOT text-forced, so Sheets happily
  // stores "01 Jan 2099" as a Date object; a raw getValues() here would then
  // yield a Date whose String() ("Mon Jan 01 2099…") never equals the client's
  // "01 Jan 2099", so the delete would silently no-op and every save would
  // DUPLICATE rows. We must normalize each compared cell EXACTLY as readTab does.
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2 && idxConduct >= 0) {
    var rng = sheet.getRange(2, 1, lastRow - 1, trimmed.length);
    var grid = rng.getValues();
    var disp = rng.getDisplayValues();
    var normCell = function (v, d) {
      if (v instanceof Date) {
        return v.getFullYear() < 1900
          ? d   // time-only cell → whatever the sheet displays (mirrors readTab)
          : Utilities.formatDate(v, Session.getScriptTimeZone(), "dd MMM yyyy");
      }
      return String(v);
    };
    // The time column newly gets WRITE_TEXT_COLS "@"-forcing, so NEW rows keep
    // "0730" verbatim and fall through normCell's String(v). But rows written
    // BEFORE that fix still hold the coerced NUMBER (730 for "0730"), which would
    // no-op the delete and duplicate on re-save. Left-pad a numeric time back to
    // 4 digits so those legacy rows match the client's pad4Time key and clear.
    var normTime = function (v, d) {
      if (typeof v === "number") { var s = String(v); return s.length >= 4 ? s : ("000" + s).slice(-4); }
      return normCell(v, d);
    };
    // Collect matching row indices first (still descending, i.e. bottom-up)
    // instead of deleting immediately. Matching rows are usually contiguous
    // (appended together by the previous save), so grouping them into runs and
    // deleting each run with ONE deleteRows(start, count) collapses the common
    // case to a single sheet mutation instead of one deleteRow call per row —
    // each of which is a separate Sheets API call inside the document lock.
    var matchIdx = [];
    for (var i = grid.length - 1; i >= 0; i--) {
      var rConduct = normCell(grid[i][idxConduct], disp[i][idxConduct]);
      var rDate = idxDate >= 0 ? normCell(grid[i][idxDate], disp[i][idxDate]) : "";
      var rTime = idxTime >= 0 ? normTime(grid[i][idxTime], disp[i][idxTime]) : "";
      var rType = idxType >= 0 ? normCell(grid[i][idxType], disp[i][idxType]) : "";
      if (rConduct === mConduct && rDate === mDate && rTime === mTime && rType !== "RSI") {
        matchIdx.push(i);
      }
    }
    // matchIdx is already sorted descending (built while walking i from high to
    // low). Group into contiguous runs (each element = previous - 1) and flush
    // each run — highest run first — with one deleteRows call. Processing runs
    // bottom-up (highest row numbers first) preserves the index-validity
    // guarantee the original per-row bottom-up delete relied on: deleting a run
    // never shifts the row numbers of any run still queued below it.
    var runStart = null, runEnd = null; // run spans grid-index runEnd..runStart (runEnd <= runStart)
    for (var j = 0; j < matchIdx.length; j++) {
      var idx = matchIdx[j];
      if (runStart === null) {
        runStart = idx;
        runEnd = idx;
      } else if (idx === runEnd - 1) {
        runEnd = idx; // extends the current run downward
      } else {
        sheet.deleteRows(runEnd + 2, runStart - runEnd + 1);
        runStart = idx;
        runEnd = idx;
      }
    }
    if (runStart !== null) {
      sheet.deleteRows(runEnd + 2, runStart - runEnd + 1);
    }
  }

  // Append the replacement rows (if any) — explicit range write with "@" forced
  // on the coercion-prone columns first, exactly like appendMany.
  if (rows.length) {
    var newRows = rows.map(function (rowData) {
      return trimmed.map(function (h) {
        var val = rowData[h];
        return val !== undefined && val !== null ? val : "";
      });
    });
    var startRow = sheet.getLastRow() + 1;
    forceTextColsForRange_(sheet, tabName, trimmed, startRow, newRows.length);
    sheet.getRange(startRow, 1, newRows.length, trimmed.length).setValues(newRows);
  }

  return { ok: true, tab: tabName, replaced: rows.length, timestamp: new Date().toISOString() };
}

// ID-based upsert. Finds the row whose KEY column matches `rowData.id` (the key
// column is "id" on every tab but Roster — see KEY_ALIASES_BY_TAB) and
// overwrites that row in place. If no such row exists, appends a new one.
// This is the cross-device-safe write primitive — two devices editing
// different rows of the same tab won't clobber each other (no full-table
// rewrite). Same-row simultaneous edits remain last-write-wins per row.
function upsertRow(tabName, rowData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };
  if (!rowData || rowData.id === undefined || rowData.id === null || rowData.id === "") {
    return { error: "upsertRow requires a non-empty id field on the row" };
  }
  var lastCol0 = sheet.getLastColumn();
  if (!lastCol0) return { error: "Tab '" + tabName + "' has no header row" };
  // Resolve the key column against the EXISTING headers first — see resolveKeyCol_.
  var existing = sheet.getRange(1, 1, 1, lastCol0).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var keyName = resolveKeyCol_(tabName, existing) || "id";
  // Auto-create columns for any new fields so they persist instead of dropping —
  // but never mint a redundant "id" beside a sheet whose key column is "4d",
  // which would leave two competing identity columns on the Roster.
  var writeKeys = Object.keys(rowData).filter(function (k) {
    return !(keyName !== "id" && k === "id");
  });
  var trimmed = ensureColumnsForKeys(sheet, writeKeys);
  var idCol = trimmed.indexOf(keyName);
  if (idCol === -1) return { error: "No '" + keyName + "' column in tab " + tabName };
  // The key cell is written from rowData.id regardless of the column's name, so a
  // Roster row keyed on "4d" gets the padded "0007" back (as text, per
  // WRITE_TEXT_COLS_BY_TAB) instead of the coerced 7 it was read as.
  var rowFor = function (headers) {
    return headers.map(function (h) {
      var val = (h === keyName) ? rowData.id : rowData[h];
      return val !== undefined && val !== null ? val : "";
    });
  };

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var idCells = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < idCells.length; i++) {
      if (keyMatches_(tabName, idCells[i][0], rowData.id)) {
        var sheetRow = i + 2;
        var updatedRow = rowFor(trimmed);
        forceTextColsForRange_(sheet, tabName, trimmed, sheetRow, 1);
        sheet.getRange(sheetRow, 1, 1, trimmed.length).setValues([updatedRow]);
        return {
          ok: true,
          tab: tabName,
          action: "updated",
          rowIndex: sheetRow,
          timestamp: new Date().toISOString()
        };
      }
    }
  }
  // Not found — append a new row. Explicit range write (not sheet.appendRow) so the
  // coercion-prone columns can be forced to "@" before the value lands.
  var newRow = rowFor(trimmed);
  var targetRow = sheet.getLastRow() + 1;
  forceTextColsForRange_(sheet, tabName, trimmed, targetRow, 1);
  sheet.getRange(targetRow, 1, 1, trimmed.length).setValues([newRow]);
  return {
    ok: true,
    tab: tabName,
    action: "appended",
    rowIndex: targetRow,
    timestamp: new Date().toISOString()
  };
}

// ID-based row delete. Finds the row whose `id` column matches and removes
// it. Returns ok:false (not an error) when the id isn't found — the
// frontend treats "row already gone" as a no-op success.
function deleteRowById(tabName, rowId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };
  var lastCol = sheet.getLastColumn();
  if (!lastCol) return { error: "Tab '" + tabName + "' has no header row" };
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var trimmed = headers.map(function (h) { return String(h).trim(); });
  // Same key resolution as upsertRow — a Roster delete keyed on a "4d"-headed
  // sheet must find the row the matching upsert would have updated, or the two
  // halves of a replace disagree about which row is which.
  var keyName = resolveKeyCol_(tabName, trimmed) || "id";
  var idCol = trimmed.indexOf(keyName);
  if (idCol === -1) return { error: "No '" + keyName + "' column in tab " + tabName };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, action: "noop", note: "tab empty" };
  var idCells = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < idCells.length; i++) {
    if (keyMatches_(tabName, idCells[i][0], rowId)) {
      sheet.deleteRow(i + 2);
      return {
        ok: true,
        tab: tabName,
        action: "deleted",
        rowIndex: i + 2,
        timestamp: new Date().toISOString()
      };
    }
  }
  return { ok: true, action: "noop", note: "id " + rowId + " not found in " + tabName };
}

// Lightweight pre-write staleness check. Returns just the data-row count
// (last row minus header) so the frontend can warn before a bulk pushTab
// when another device added rows since this device's last pull.
function rowCount(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };
  var last = sheet.getLastRow();
  return { ok: true, tab: tabName, dataRows: Math.max(0, last - 1) };
}

function updateRow(tabName, rowIndex, rowData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var sheetRow = rowIndex + 2;

  if (sheetRow > sheet.getLastRow()) {
    return { error: "Row index " + rowIndex + " out of range" };
  }

  var updatedRow = headers.map(function (h) {
    var val = rowData[String(h).trim()];
    return val !== undefined && val !== null ? val : "";
  });

  sheet.getRange(sheetRow, 1, 1, headers.length).setValues([updatedRow]);

  return {
    ok: true,
    tab: tabName,
    rowUpdated: rowIndex,
    timestamp: new Date().toISOString()
  };
}

function deleteRow(tabName, rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };

  var sheetRow = rowIndex + 2;
  if (sheetRow > sheet.getLastRow()) {
    return { error: "Row index " + rowIndex + " out of range" };
  }

  sheet.deleteRow(sheetRow);

  return {
    ok: true,
    tab: tabName,
    rowDeleted: rowIndex,
    timestamp: new Date().toISOString()
  };
}


// ════════════════════════════════════════════════════════════════════════════
// BRAVES ARCHIVE (Item 1) — scheduled logging of parade-state + report-sick msgs
// ════════════════════════════════════════════════════════════════════════════
// The parade/sick generators live client-side (js/braves-parade.js). To archive
// on an unattended schedule, the EXACT same code is ported here (assembled by
// concatenating the real source files — helpers subset + braves-parade.js — so it
// can never silently drift). A Node cross-check harness asserts this block is
// byte-identical to the client output on the seed. The block runs against a STATE
// object built from the sheet tabs (readTab already returns dates as "dd MMM yyyy",
// the same display format the client uses). NOT live-tested on the Sheet — verified
// by syntax check + the cross-check harness; deploy + trigger creation are manual.
//
// ──────────────────────── BRAVES-ARCHIVE-PORT BEGIN ────────────────────────
// (auto-generated copy — do not hand-edit; regenerate via /tmp/assemble-gas.js)
var STATE = {};  // populated per-request by bravesLoadState_()

const DEFAULT_CONFIG = {
  companyName: "40 SAR BRAVES COMPANY",
  companyPrefix: "B",
  companyCoyCode: "B COY",
  unitCode: "40SAR",
  hqLabel: "BRAVES HQ",
  defaultSickLocation: "PTMC",
  polarCompanyName: "Braves Coy",
  // Which signal decides whether a conduct earns an HA period (spec §14.3):
  // "isHAExcluded" = legacy conduct-name logic; "currencyTag" = the CSV
  // "Currency Tags: HA" metadata. Switchable without code changes. Matches the
  // frontend default in js/state.js — keep the two in sync.
  haEligibilitySource: "currencyTag",
  // Leave types that classify as AL/OIL in parade state (spec §8, DECISIONS
  // #32/#35). Any leave type NOT in this comma-separated list falls to OTHERS,
  // sub-typed in/out of camp by reason keywords. Edit here (or override via the
  // Config tab) to retune the split without touching code.
  alOilLeaveTypes: "Leave, Off-in-Lieu, OIL, AL, Annual Leave, Weekend, Night's Out, Compassionate"
};

function configGet(key) {
  const v = STATE.config && STATE.config[key];
  return (v !== undefined && v !== null && v !== "") ? v : DEFAULT_CONFIG[key];
}

function todayISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoToDisplayDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function displayDateToISO(s) {
  if (!s) return "";
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const m = String(s).match(/^(\d{1,2})\s+(\w{3})(?:\s+(\d{4}))?/);
  if (!m) return "";
  const mon = months[m[2]];
  if (!mon) return "";
  const day = m[1].padStart(2, "0");
  const year = m[3] || String(new Date().getFullYear());
  return `${year}-${mon}-${day}`;
}

function getPlt(r) {
  // Commanders are coy-level — they have no platoon by default. Forcing
  // empty here ensures the 4D parser doesn't extract "0" from a 00xx id.
  if (r.role === "Commander") return r.plt != null && r.plt !== "" ? String(r.plt) : "";
  if (r.plt !== "" && r.plt != null) return String(r.plt);
  const m = String(r.id || "").match(/(\d)/);
  return m ? m[1] : "";
}

function getSect(r) {
  if (r.role === "Commander") return r.sect != null && r.sect !== "" ? String(r.sect) : "";
  if (r.sect !== "" && r.sect != null) return String(r.sect);
  const m = String(r.id || "").match(/\d(\d)/);
  return m ? m[1] : "";
}

function medStatusActive(record, todayIso) {
  todayIso = todayIso || todayISO();
  if (record.status === "NIL") return false;
  const start = displayDateToISO(record.startDate || record.date || "");
  if (!start) return false;
  if (record.status === "Pending") return todayIso === start;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return false;
  return todayIso >= start && todayIso <= end;
}

// Hand-ported from js/appointment-4d.js — see the header there for the full
// reasoning. Commanders carry an appointment code in the Roster fourD column
// ("SC21" = section commander of platoon 2 section 1, "PS2"/"PC2" = that
// platoon's sergeant/commander), and both the platoon derivation below and the
// 4D sort key read it. Single-digit only; anything else returns null and the
// caller keeps its previous behaviour rather than acting on a guess.
function parseAppointment4D(fourD) {
  const s = String(fourD == null ? "" : fourD).trim();
  if (!s) return null;
  const sc = /^SC([1-9])([1-9])$/i.exec(s);
  if (sc) return { appointment: "SectComd", platoon: "PLT" + sc[1], section: sc[2] };
  const cmd = /^(PC|PS)([1-9])$/i.exec(s);
  if (cmd) return { appointment: cmd[1].toUpperCase(), platoon: "PLT" + cmd[2], section: "Command" };
  return null;
}

// Numeric fourD, else numeric id, else last. An appointment-coded fourD is
// truthy but not numeric, so a plain `r.fourD || r.id` stops falling through to
// the 00xx id and parseInt gives NaN — which sorted every commander last.
function fourDSortKey(r) {
  if (!r) return Infinity;
  const f = String(r.fourD == null ? "" : r.fourD).trim();
  if (/^\d+$/.test(f)) return parseInt(f, 10);
  const id = String(r.id == null ? "" : r.id).trim();
  if (/^\d+$/.test(id)) return parseInt(id, 10);
  return Infinity;
}

function personPlatoon(r) {
  if (!r) return "";
  if (r.platoon) return String(r.platoon).trim();
  // Between the explicit column and the 4D digit parse: getPlt deliberately
  // blanks commanders out as coy-level, which is right for an OC but wrong for
  // a PC, who belongs to a platoon and whose own 4D names it.
  const appt = parseAppointment4D(r.fourD);
  if (appt) return appt.platoon;
  const p = getPlt(r);
  return p ? "PLT" + p : "";
}

function personSection(r) {
  if (!r) return "";
  if (r.section != null && r.section !== "") return String(r.section).trim();
  const appt = parseAppointment4D(r.fourD);
  if (appt) return appt.section;
  return getSect(r) || "";
}

function rankGroupOf(r) {
  if (!r) return "Enlistee";
  if (r.rankGroup) {
    const g = String(r.rankGroup).trim().toLowerCase();
    if (g.startsWith("off")) return "Officer";
    if (g.startsWith("wo") || g.startsWith("spec")) return "WOSPEC";
    if (g.startsWith("enl")) return "Enlistee";
  }
  const rank = String(r.rank || "").trim().toUpperCase();
  if (!rank) return "Enlistee";
  const OFFICER = ["2LT", "LTA", "CPT", "MAJ", "LTC", "SLTC", "COL", "BG", "MG", "LG"];
  const WOSPEC = ["3SG", "2SG", "1SG", "SSG", "MSG", "SWO", "MWO", "1WO", "2WO", "3WO", "WO"];
  if (OFFICER.includes(rank)) return "Officer";
  if (WOSPEC.includes(rank)) return "WOSPEC";
  return "Enlistee";
}

function activePlatoons() {
  const fromTab = (STATE.platoons || []).filter(p => p.active);
  if (fromTab.length) return fromTab;
  const seen = new Set();
  const derived = [];
  (STATE.roster || []).forEach(r => {
    const code = personPlatoon(r);
    if (code && !seen.has(code)) { seen.add(code); derived.push({ code, displayName: code, active: true }); }
  });
  // Stable order: HQ last, platoons numerically.
  derived.sort((a, b) => {
    if (a.code === "HQ") return 1;
    if (b.code === "HQ") return -1;
    return a.code.localeCompare(b.code, undefined, { numeric: true });
  });
  return derived;
}

function classifyURTI(purpose) {
  const p = (purpose || "").toLowerCase();
  const urti = ["urti", "cough", "cold", "flu", "fever", "runny nose", "sore throat",
                "throat", "phlegm", "blocked nose", "rhinitis", "sinusitis", "sneez"];
  return urti.some(k => p.indexOf(k) !== -1) ? "URTI" : "NON-URTI";
}

// ============================================================================
// BRAVES PARADE STATE — Step 3 (spec §7–9)
// ============================================================================
// The Braves §7–9 parade-state generator. Loaded after forms.js / before sync.js
// (it leans on globals defined in earlier files). Replaces the legacy Cougar
// parade builders; `regenerateReport()` routes FP/LP here via
// generateBravesParadeState(scope, type, dateIso, time), and `paradeRN` delegates
// to bravesParadeRN (so the borderline/appointment checklist sections still work).
//
// Byte-validated 2026-06-21 against `Message Formats.md` with a Node fixture
// harness (structural match + literal helper assertions). The sample is an
// internally date-inconsistent montage and can't be reproduced verbatim end-to-
// end (no source data; it even mis-counts one section and renders one person two
// ways) — so the validation is structural + per-helper, not literal 279-pax.
// Format decisions: DECISIONS #26–33 + #35 (this session). The sample's incidental
// double-spaces are dropped (#26); names are NOT force-uppercased (#30).
//
// DEPENDENCIES (globals from earlier files; present once loaded after forms.js):
//   STATE, configGet, displayDateToISO, medStatusActive, personPlatoon,
//   personSection, rankGroupOf, activePlatoons.
// ============================================================================

// ── Separators (DECISIONS #27) ──────────────────────────────────────────────
// Reproduced verbatim from the sample. The platoon/HQ block uses a per-section
// dash count; the company aggregate block uses 80 dashes before every category.
const BP_BIG_SEP = "-".repeat(80);                 // inter-block + company-block category sep
const BP_EQ_SEP = "=".repeat(30);                  // company aggregate ↔ HQ block
// Dash counts BEFORE [AL/OIL, MR, REPORTING SICK, ATT C, STATUS, OTHERS]:
const BP_PLT_SECTION_SEPS = [30, 30, 30, 28, 29, 29];

// Section order is fixed across all blocks.
const BP_SECTIONS = ["alOil", "mr", "reportingSick", "attC", "status", "others"];
const BP_SECTION_LABELS = {
  alOil: "AL/OIL",
  mr: "MR",
  reportingSick: "REPORTING SICK",
  attC: "ATT C",
  status: "STATUS",
  others: "OTHERS"
};

// Leave types that count as AL/OIL vs OTHERS (DECISIONS #32, resolved #35 this
// session). Config-driven: configGet("alOilLeaveTypes") supplies the list
// (comma-separated string or array); the hardcoded set below is the fallback if
// Config is absent. Everything NOT in the set falls to OTHERS. In/out-of-camp
// for every leave row (AL/OIL and OTHERS alike) is the explicit isInCamp the
// commander picks in the Leave form — see bpClassifyPerson below.
// bpOthersNotInCamp is kept only to compute the form's smart-prefill
// suggestion and the one-off GAS backfill migration; the classifier itself
// never calls it.
const BP_ALOIL_TYPES_DEFAULT =
  ["leave", "off-in-lieu", "oil", "al", "annual leave", "weekend", "night's out", "nights out", "compassionate"];
function bpAlOilTypeSet() {
  const cfg = configGet("alOilLeaveTypes");
  if (cfg) {
    const arr = Array.isArray(cfg) ? cfg : String(cfg).split(",");
    const cleaned = arr.map(s => String(s).trim().toLowerCase()).filter(Boolean);
    if (cleaned.length) return new Set(cleaned);
  }
  return new Set(BP_ALOIL_TYPES_DEFAULT);
}
function bpIsAlOilType(type) {
  return bpAlOilTypeSet().has(String(type || "").trim().toLowerCase());
}

// ── Date helpers ────────────────────────────────────────────────────────────
// "2026-05-20" → "200526" (battalion DDMMYY). Local, so this file doesn't depend
// on forms.js's toDDMMYY load order.
function bpDDMMYY(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return m[3] + m[2] + m[1].slice(2);
}
function bp2(n) { return String(n).padStart(2, "0"); }

// ISO + n days, tz-safe (anchored at local midnight, never toISOString — which
// would shift the date back a day for any positive UTC offset). Mirror of the
// js/braves-parade.js twin; the lookahead horizon below is the only caller.
function bpAddDaysISO(iso, n) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + (Number(n) || 0));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-"
    + String(d.getDate()).padStart(2, "0");
}

// Inclusive day count between two display dates, e.g. 13–21 May = 9.
function bpInclusiveDays(record) {
  const s = displayDateToISO(record.startDate || record.date || "");
  const e = displayDateToISO(record.endDate || "");
  if (!s || !e) return null;
  const days = Math.round((new Date(e + "T00:00:00") - new Date(s + "T00:00:00")) / 86400000) + 1;
  return days > 0 ? days : null;
}
// Spaced "(210526 - 220526)" for AL/OIL & STATUS-LD; unspaced "(130526-210526)"
// for ATT C & OTHERS (DECISIONS #28).
function bpRange(record, spaced) {
  const s = displayDateToISO(record.startDate || record.date || "");
  const e = displayDateToISO(record.endDate || "");
  if (!s || !e) return "";
  return spaced ? `(${bpDDMMYY(s)} - ${bpDDMMYY(e)})` : `(${bpDDMMYY(s)}-${bpDDMMYY(e)})`;
}

// ── R/N formatting (spec §7, DECISIONS #30) ─────────────────────────────────
// 4D personnel: "REC MARTIN TAN B1411" (rank + name + prefix + 4D). No-4D
// personnel: "LCP CALVIN LEE" (rank + name) or just "TREVOR LEE". Names rendered
// as stored (not force-uppercased) per the sample. The rank prefix on 4D
// personnel is a Braves-requested divergence from Message Formats.md (which
// shows name + 4D only) — rank comes from the roster's rank column via
// bpDisplayRank, which falls back to REC for non-commanders.

// Rank to display on an R/N line. The roster's rank column is routinely left
// blank for recruits (nobody types "REC" 119 times), which used to emit a bare
// "Martin Tan B1411"; default those to REC so every generated message names a
// rank. Commanders are deliberately NOT defaulted — a blank rank on a commander
// means the roster row is incomplete, and calling one REC would be wrong rather
// than merely terse.
function bpDisplayRank(r) {
  const rank = String((r && r.rank) || "").trim();
  if (rank) return rank;
  return r && r.role !== "Commander" ? "REC" : "";
}

function bravesParadeRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = r.name || "";
  const prefix = configGet("companyPrefix") || "B";
  // Duplicates isCommander/displayPersonLabel (helpers.js) — can't reuse: this needs B<fourD> tagging, not plain name.
  if (r.role !== "Commander" && r.fourD && String(r.fourD).trim() !== "") {
    return [bpDisplayRank(r), `${name} ${prefix}${String(r.fourD).trim()}`].filter(Boolean).join(" ").trim();
  }
  return [bpDisplayRank(r), name].filter(Boolean).join(" ").trim();
}

// Sick-message R/N (spec §10). This USED to omit the rank prefix, which is what
// BRAVES_ADAPTATION_SPEC.md §7/§10 still described; the user overrode that on
// 2026-07-28 (DECISIONS #122) because the same person read as "REC Martin Tan
// B1411" in a parade state and "Martin Tan B1411" in the sick message sent
// minutes later. With the rank added, §10's R/N is identical to §9's — so this
// delegates rather than carrying a second copy that can drift. Kept as a named
// function because §9 and §10 are separate spec surfaces that have diverged
// before, and both this file and its GAS port call it by name.
function sickRN(personId) {
  return bravesParadeRN(personId);
}

// ── OTHERS sub-type guess (spec §8, legacy) ─────────────────────────────────
// No longer called by bpClassifyPerson (every leave row now carries an
// explicit isInCamp). Kept for bravesBackfillLeaveInCamp (the one-off
// migration below) — see js/forms.js for the frontend's other caller.
function bpOthersNotInCamp(reasonText, override) {
  if (override === true) return false;   // othersInCamp = true → in camp
  if (override === false) return true;
  const t = String(reasonText || "").toLowerCase();
  if (/book\s*out|booked out|out of camp|\bma\b|appointment/.test(t)) return true;
  return false; // default IN CAMP
}

// ── Per-person classification (spec §8) ─────────────────────────────────────
// Multi-section: a person may appear under several sections. Returns the section
// → entry-line map for this one person, plus a binary notInCamp flag (counted
// once). Dedupe within a section is by exact line text.
// Collapse overlapping same-label entries in one person's section down to the one
// whose status ENDS LAST (js/braves-parade.js twin — keep both identical). `sup`
// holds {supKey, supEnd} tags parallel to out[section]; among rows sharing a
// supKey the latest supEnd wins, a blank supEnd counts as ending last, ties keep
// the first. Untagged (null) entries — appointments — are never superseded.
function bpSupersedeSameType(out, sup, section) {
  const tags = sup[section];
  if (!tags || tags.length < 2) return;
  const endVal = e => (e ? e : "9999-99-99"); // blank end date = ends last
  const winner = {}, drop = new Set();
  tags.forEach((t, i) => {
    if (!t || t.supKey == null) return; // untagged: never superseded
    const prev = winner[t.supKey];
    if (prev == null) { winner[t.supKey] = i; return; }
    if (endVal(t.supEnd) > endVal(tags[prev].supEnd)) { drop.add(prev); winner[t.supKey] = i; }
    else { drop.add(i); }
  });
  if (!drop.size) return;
  const o = [], s = [];
  out[section].forEach((line, i) => { if (!drop.has(i)) { o.push(line); s.push(tags[i]); } });
  out[section] = o; sup[section] = s;
}

function bookedInBy(rec, dateIso) {
  var b = displayDateToISO(rec && rec.bookInDate || "");
  return !!b && dateIso >= b;
}

// `opts.lookaheadDays` (Fix 18) is OFF by default. The archiver never passes it,
// so its output is unchanged; it exists here only so this port stays
// behaviourally identical to js/braves-parade.js, which is what
// test/parade-port-parity.test.js asserts.
function bpClassifyPerson(r, dateIso, opts) {
  const rn = bravesParadeRN(r.id);
  const out = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  let notInCamp = false;
  // Tracked separately from out.attC.length because the lookahead can put a
  // not-yet-started MC in that array — see the recovery tail below, whose whole
  // premise is "no MC running TODAY".
  let hasCurrentAttC = false;

  // ── Fix 18: opt-in lookahead (mirror of js/braves-parade.js) ──────────────
  // A record is "upcoming" when its window STARTS after dateIso but within the
  // horizon. It is LISTED and COUNTED in its section but must never touch
  // notInCamp — notInCamp feeds bpStrength, and a person present today is
  // present today whatever is booked for next week.
  const lookaheadDays = (opts && opts.lookaheadDays) || 0;
  const bpUpcoming = startIso => {
    if (!lookaheadDays || !startIso || startIso <= dateIso) return false;
    if (lookaheadDays === Infinity) return true;
    return startIso <= bpAddDaysISO(dateIso, lookaheadDays);
  };
  // Mirrors medStatusActive's own preconditions: a blank end date makes a record
  // inert everywhere else, and Pending/NIL put nobody away, so the lookahead
  // must not become a back door for either.
  const bpUpcomingStatus = m => {
    if (!m.status || m.status === "Pending" || m.status === "NIL") return false;
    if (!displayDateToISO(m.endDate || "")) return false;
    return bpUpcoming(displayDateToISO(m.startDate || m.date || ""));
  };
  // Upcoming rows supersede only each other: a future MC always ends after the
  // one the person is on today, so a shared pool would delete today's entry.
  const supPool = upcoming => (upcoming ? "UPCOMING:" : "");
  // Book-in for an upcoming record is judged at the record's OWN start date —
  // bookedInBy asks "is dateIso on or after the book-in?", always false for a
  // window that has not started.
  const bookedInFor = (rec, upcoming, startIso) => bookedInBy(rec, upcoming ? startIso : dateIso);

  // Supersede tags, parallel to out[] for the duration-bearing sections only
  // (js/braves-parade.js carries these on its `meta` twin — this file has no
  // meta, so track them alongside). Every push into these four sections must go
  // through pushS so the arrays stay index-aligned for bpSupersedeSameType.
  const sup = { alOil: [], attC: [], status: [], others: [] };
  const pushS = (section, line, tag, upcoming) => {
    // Fix 18: the date range already reveals futurity, but an explicit marker
    // removes all doubt when scanning a long section.
    out[section].push(line + (upcoming ? " [UPCOMING]" : ""));
    sup[section].push(tag || null);
  };

  // Leave → AL/OIL (in the AL/OIL type set) or OTHERS. Every leave row now
  // carries an explicit isInCamp — see js/braves-parade.js for the frontend
  // twin (keep both copies identical; this file has no `require`,
  // dual-maintenance is manual). The "any row this day is explicitly In
  // Camp" case is tracked separately and applied AFTER the loop so it's
  // strictly additive: a second Not-In-Camp leave row the same day can't
  // cancel it, and a later MC/Warded/out-of-camp appointment check is untouched.
  let leaveOverride = false;
  STATE.leave.forEach(l => {
    if (l.d4 !== r.id) return;
    const s = displayDateToISO(l.startDate), e = displayDateToISO(l.endDate);
    if (!s || !e) return;
    const active = s <= dateIso && dateIso <= e;
    const upcoming = !active && bpUpcoming(s);
    if (!active && !upcoming) return;
    if (bookedInFor(l, upcoming, s)) return;   // booked in ⇒ Present from bookInDate onward
    // The entry text is the free-text reason ("48HR BO"), falling back to the
    // leave type when no reason was recorded. (NOT "type — reason" — the sample
    // shows a single clean label.)
    const reason = l.reason || l.type || "";
    const inCamp = l.isInCamp === true;
    // An upcoming In-Camp leave must not clear today's notInCamp either — the
    // override is about who is in camp NOW, same as the flag it clears.
    if (inCamp && !upcoming) leaveOverride = true;
    const leaveSup = { supKey: supPool(upcoming) + String(l.type || "").trim().toUpperCase(), supEnd: displayDateToISO(l.endDate || "") };
    if (bpIsAlOilType(l.type)) {
      pushS("alOil", `${rn} - ${reason} ${bpRange(l, true)}`.trim(), leaveSup, upcoming);
      if (!upcoming) notInCamp = true;  // AL/OIL is not in camp unless overridden (below)
    } else {
      // Non-AL/OIL leave → OTHERS; the commander picks In Camp/Not In Camp
      // explicitly on every record (no more reason-keyword guessing here).
      const label = inCamp ? "OTHERS (IN CAMP)" : "OTHERS (NOT IN CAMP)";
      const rng = bpRange(l, false);
      pushS("others", `${rn} - ${reason}${rng ? " " + rng : ""} (${label})`.trim(), leaveSup, upcoming);
      if (!inCamp && !upcoming) notInCamp = true;
    }
  });
  if (leaveOverride) notInCamp = false;

  // Medical rows for this person.
  STATE.medical.forEach(m => {
    if (m.d4 !== r.id) return;
    const reportedToday = displayDateToISO(m.date) === dateIso;

    // REPORTING SICK — reported RSI/RSO today AND still awaiting the MO outcome
    // (status Pending or blank). Once the MO issues any status — MC/LD/Excuse/
    // Warded/RIB/custom, or NIL (cleared) — the person is no longer "reporting
    // sick" and drops off this list (they appear under ATT C / STATUS / OTHERS
    // instead). Fixes the double-listing of assigned/cleared personnel on the
    // active RS list. A still-active Pending status keeps them on RS regardless
    // of report date. NOTE: the daily sick-report messages (bpSickReports →
    // generateRSFormat / generateRSIPersonnel) intentionally list everyone who
    // reported that morning and are NOT affected by this guard.
    const moPending = !m.status || m.status === "Pending";

    // MR — own section, independent of everything else (spec §6/§8). Same
    // pending gate as REPORTING SICK: once the MO resolves the review with a
    // final status (MC/LD/Excuse/NIL/…), it's no longer awaiting review and
    // drops off this list (the resolved status surfaces it under ATT C /
    // STATUS / OTHERS instead) — otherwise a resolved MR double-lists.
    if (m.type === "MR" && reportedToday && moPending) {
      // Reads the shared HHMM `time` field, not the retired free-text mrTiming
      // column — mirror of js/braves-parade.js. Run bravesMigrateMrTiming() once
      // before deploying this, or MR rows render with no timing at all.
      const timing = m.time ? ` (${m.time})` : "";
      out.mr.push(`${rn} - ${m.reason || ""}${timing}`.trim());
    }
    // An MR (Medical Review) visit is NOT a report-sick and must never surface
    // here: while awaiting the MO its status is "Pending" and its start date is
    // today, which would otherwise satisfy the Pending-clause below and
    // double-list the person as MR *and* RSI. An MR going for review is only an
    // MR (its own section above). A resolved MR (status MC/LD/…) still flows to
    // ATT C / STATUS through their own clauses — those don't exclude type MR.
    const isRS = m.type !== "MR" && (
      (((m.type === "RSI" || m.type === "RSO") && reportedToday) && moPending)
      || (m.status === "Pending" && medStatusActive(m, dateIso)));
    if (isRS) {
      const label = m.type === "RSO" ? "RSO" : "RSI"; // Pending→RSI (DECISIONS #31)
      out.reportingSick.push(`${rn} - ${m.reason || ""} (${label})`.trim());
    }

    // ATT C — active MC (not-in-camp). Warded handled as OTHERS below.
    const mcUpcoming = m.status === "MC" && !medStatusActive(m, dateIso) && bpUpcomingStatus(m);
    if (m.status === "MC" && (medStatusActive(m, dateIso) || mcUpcoming)
        && !bookedInFor(m, mcUpcoming, displayDateToISO(m.startDate || m.date || ""))) {
      const days = bpInclusiveDays(m);
      const label = days ? `${days}D MC` : "MC";
      pushS("attC", `${rn} - ${label} ${bpRange(m, false)}`.trim(), { supKey: supPool(mcUpcoming) + "MC", supEnd: displayDateToISO(m.endDate || "") }, mcUpcoming);
      if (!mcUpcoming) { notInCamp = true; hasCurrentAttC = true; }
    }

    // STATUS — active LD, RIB, Excuse-*, or any other in-camp-restricted status.
    // Requires a non-empty status: an imported RS/SENT_OUT episode carries
    // status:"" with an active date range, which would otherwise emit a blank
    // "RN - " STATUS line (and double-list someone already in REPORTING SICK).
    // Every status here gets the same "{days}D {status}" duration prefix.
    //
    // NO bookedInFor GUARD HERE, unlike every branch around it. `bookInDate`
    // means "back in camp", which is only meaningful for a status that put the
    // person OUT of camp — MC, Warded, AL/OIL, an out-of-camp appointment. What
    // reaches this branch is by construction the in-camp restricted set (not MC,
    // not Warded, not Pending/NIL): LD, RIB, Excuse-*. The recruit was never
    // away, so booking them in cannot end their light duty.
    //
    // Honouring the guard here erased live restrictions: marking someone Present
    // on return from a 2-day MC stamped bookInDate on EVERY active medical row
    // (paradeEndActiveContributors), so an 84-day LD running to September went
    // silent from that day on and the recruit read Present with no status.
    const stUpcoming = !medStatusActive(m, dateIso) && bpUpcomingStatus(m);
    if (m.status && (medStatusActive(m, dateIso) || stUpcoming) && m.status !== "MC" && m.status !== "Warded"
        && m.status !== "Pending" && m.status !== "NIL") {
      const days = bpInclusiveDays(m);
      const label = days ? `${days}D ${m.status}` : m.status;
      pushS("status", `${rn} - ${label} ${bpRange(m, true)}`.trim(), { supKey: supPool(stUpcoming) + String(m.status).trim(), supEnd: displayDateToISO(m.endDate || "") }, stUpcoming);
    }

    // Warded → OTHERS (NOT IN CAMP).
    if (m.status === "Warded" && (medStatusActive(m, dateIso) || stUpcoming)
        && !bookedInFor(m, stUpcoming, displayDateToISO(m.startDate || m.date || ""))) {
      pushS("others", `${rn} - ${m.reason || "Warded"} (OTHERS (NOT IN CAMP))`.trim(), { supKey: supPool(stUpcoming) + "WD", supEnd: displayDateToISO(m.endDate || "") }, stUpcoming);
      if (!stUpcoming) notInCamp = true;
    }

    // Item 17: Medical Appointment (type MA) dated today → OTHERS. Mirrors the
    // legacy standalone-Appointments block below (booking now routes through the
    // Medical form): outOfCamp → NOT IN CAMP; in camp → OTHERS (IN CAMP). A
    // booked-in MA drops off. Independent of any status the visit carries (Q2).
    // MUST mirror js/braves-parade.js — parade-port-parity.test.js guards this.
    const maUpcoming = m.type === "MA" && bpUpcoming(displayDateToISO(m.date));
    if (m.type === "MA" && (displayDateToISO(m.date) === dateIso || maUpcoming)
        && !bookedInFor(m, maUpcoming, displayDateToISO(m.date))) {
      const outOfCamp = !!m.outOfCamp;
      const label = outOfCamp ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
      pushS("others", `${rn} - ${m.reason || "Medical Appointment"} (${label})`.trim(), null, maUpcoming); // point event, never superseded
      if (outOfCamp && !maUpcoming) notInCamp = true;
    }
  });

  // Persist an ENDED MC through the MC+1/MC+2 recovery window, then AUTO-HIDE.
  // A recruit whose MC ended in the last 1–2 days is still counted OUT of camp
  // (the MC+1/MC+2 grace the ghost tags mark, helpers.js medStatusTag) UNLESS
  // they have been booked in. Book-in is now signalled by `bookInDate` on the
  // medical record (set when a commander marks them Present on the parade grid),
  // NOT by a roster.status mirror — that mirror was removed (item 4a), so this
  // tail no longer reads r.status at all. It fires when there is no active MC
  // today (!out.attC.length) and the most-recent already-ended MC (endDate <
  // dateIso) is within the 2-day window and is NOT booked in. Once the MC ended
  // MORE than 2 days ago we STOP persisting (a long-dead MC must not park the
  // recruit under ATT C forever — the "shows MC but not actually on MC" fix).
  // Only the most recent ALREADY-ENDED MC is considered; a future/later MC does
  // not imply book-in from an earlier one.
  //
  // Strength: affects CURRENT strength (in/out of camp) only — TOTAL strength is
  // unchanged (bpIsActive keys off roster departure statuses, not this tail).
  // Fix 18: keyed off hasCurrentAttC, NOT out.attC.length — with the lookahead on
  // that array can hold a future MC, and gating on it would make booking next
  // week's MC silently erase this week's recovery tail.
  if (!hasCurrentAttC) {
    const endedMc = STATE.medical
      .filter(m => m.d4 === r.id && m.status === "MC" && !bookedInBy(m, dateIso)
        && displayDateToISO(m.endDate || "") && displayDateToISO(m.endDate) < dateIso)
      .sort((a, b) => displayDateToISO(b.endDate).localeCompare(displayDateToISO(a.endDate)))[0];
    const endIso = endedMc ? displayDateToISO(endedMc.endDate || "") : "";
    // Days since the MC ended; the ghost window is offsets 1–2 (MC+1 / MC+2).
    const sinceEnd = endIso ? Math.round((new Date(dateIso + "T00:00:00") - new Date(endIso + "T00:00:00")) / 86400000) : 99;
    if (endedMc && sinceEnd <= 2) {
      const days = bpInclusiveDays(endedMc);
      const label = days ? `${days}D MC` : "MC";
      pushS("attC", `${rn} - ${label} ${bpRange(endedMc, false)}`.trim(), { supKey: "MC", supEnd: displayDateToISO(endedMc.endDate || "") });
      notInCamp = true;
    }
  }

  // Medical appointments (MA) dated today → OTHERS. The stored `outOfCamp` bit
  // (set when booking, toggled live by the parade presence-tick) drives the
  // sub-type: out of camp → NOT IN CAMP (and subtracts from current strength);
  // in camp → OTHERS (IN CAMP), still present. Resolved appointments drop out.
  // Fix 18: these look ahead too. Appointments are still written to BOTH stores
  // (the Medical form's type-MA rows and this legacy Appointments tab), so
  // honouring the lookahead in one and not the other would surface next week's
  // dental appointment or not depending purely on which form booked it.
  (STATE.appointments || []).forEach(a => {
    if (a.d4 !== r.id || a.resolved) return;
    const apptIso = displayDateToISO(a.date);
    const upcoming = apptIso !== dateIso && bpUpcoming(apptIso);
    if (apptIso !== dateIso && !upcoming) return;
    const outOfCamp = !!a.outOfCamp;
    const label = outOfCamp ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
    pushS("others", `${rn} - ${a.reason || "Appointment"} (${label})`.trim(), null, upcoming); // appointments: point events, never superseded
    if (outOfCamp && !upcoming) notInCamp = true;
  });

  // Dedupe each section by exact line first, keeping the sup tags aligned for the
  // four superseded sections (so bpSupersedeSameType below reads the right dates).
  BP_SECTIONS.forEach(k => {
    if (!sup[k]) { out[k] = [...new Set(out[k])]; return; }
    const seen = new Set(), o = [], s = [];
    out[k].forEach((line, i) => { if (seen.has(line)) return; seen.add(line); o.push(line); s.push(sup[k][i]); });
    out[k] = o; sup[k] = s;
  });
  // Supersede overlapping same-label entries down to the one ending last (user
  // rule; see the js/braves-parade.js twin for the full rationale). Runs before
  // the STATUS collapse so surviving distinct labels still fold into one line.
  ["alOil", "attC", "status", "others"].forEach(k => bpSupersedeSameType(out, sup, k));
  // STATUS multi-status collapse (DECISIONS #44): a recruit on several restricted
  // statuses from one visit (e.g. LD + Excuse RMJ) produced one line per row, so
  // they showed up as separate numbered entries. Since this classifier is per-
  // person, every out.status line belongs to the same recruit — fold them into a
  // single "RN - desc1, desc2" entry (descriptors joined, rn shown once). Only
  // STATUS is collapsed: other sections carry per-entry "(OTHERS (…))"-style
  // suffixes that don't read sensibly comma-joined, and a person rarely has >1.
  if (out.status.length > 1) {
    const descs = out.status.map(line => bpStripRN(line, rn));
    out.status = [`${rn} - ${descs.join(", ")}`];
  }
  return { rn, sections: out, notInCamp };
}

// ── Status Board helpers (addendum A4/A7) — reuse the §8 classifier ──────────
// A7.3 "today's category": the single-label §8 priority chain
// (REPORTING SICK > ATT C > AL/OIL > STATUS > OTHERS); MR is independent.
// Returns { primary:{key,label,reason}|null, mr:reason|null, sections, rn }.
const BP_PRIMARY_CHAIN = [
  ["reportingSick", "REPORTING SICK"], ["attC", "ATT C"], ["alOil", "AL/OIL"],
  ["status", "STATUS"], ["others", "OTHERS"]
];
function bpStripRN(line, rn) {
  // "Martin Tan B1411 - FEVER (RSI)" → "FEVER (RSI)" (best-effort reason text).
  const pre = rn + " - ";
  return line.startsWith(pre) ? line.slice(pre.length) : line;
}
function bpPrimaryForDay(r, dateIso) {
  const c = bpClassifyPerson(r, dateIso);
  let primary = null;
  for (const [k, label] of BP_PRIMARY_CHAIN) {
    if (c.sections[k].length) { primary = { key: k, label, reason: bpStripRN(c.sections[k][0], c.rn) }; break; }
  }
  const mr = c.sections.mr.length ? bpStripRN(c.sections.mr[0], c.rn) : null;
  return { primary, mr, sections: c.sections, rn: c.rn, notInCamp: c.notInCamp };
}
// A4.2 grid cell: fill priority Leave > MC > LD/Excuse > RSI/RSO > MR, plus
// secondary RSI/RSO markers. Returns { primary, hasRSI, hasRSO, hasMR, any }.
function bpGridCell(r, dateIso) {
  const s = bpClassifyPerson(r, dateIso).sections;
  const hasRSO = s.reportingSick.some(x => /\(RSO\)$/.test(x));
  const hasRSI = s.reportingSick.some(x => /\(RSI\)$/.test(x));
  let primary = null;
  if (s.alOil.length) primary = "LV";
  else if (s.attC.length) primary = "MC";
  else if (s.status.length) primary = "LD";
  else if (s.reportingSick.length) primary = hasRSO ? "RSO" : "RSI";
  else if (s.mr.length) primary = "MR";
  return { primary, hasRSI, hasRSO, hasMR: s.mr.length > 0, any: !!primary };
}

// ── Strength (spec §8) ──────────────────────────────────────────────────────
// Roster statuses that mean the person has LEFT the company — only these drop a
// row from strength. The roster `status` field doubles as a live mirror of the
// recruit's current MEDICAL status (submitMedical writes MC/LD/Excuse/…/custom
// back onto the roster row), so those values must NOT exclude anyone: a recruit
// on MC is still posted to the company and counts toward TOTAL STRENGTH; their
// not-in-camp state for CURRENT STRENGTH is derived from the Medical/Leave layer
// (ATT C / OTHERS), not from this field. Only genuine departures are excluded.
var BP_DEPARTED_STATUSES = ["Discharged", "ORD", "Posted Out", "Transferred", "Withdrawn", "Inactive"];
function bpIsActive(r) {
  var s = (r && r.status != null) ? String(r.status).trim() : "";
  return BP_DEPARTED_STATUSES.indexOf(s) === -1; // DECISIONS #33 — blank/Active/medical-mirror all count
}
// people: array of in-scope roster rows. Returns totals + per-rankGroup ratios.
function bpStrength(people, dateIso) {
  const active = people.filter(bpIsActive);
  const groups = { Officer: { cur: 0, tot: 0 }, WOSPEC: { cur: 0, tot: 0 }, Enlistee: { cur: 0, tot: 0 } };
  let total = 0, current = 0;
  active.forEach(r => {
    const g = rankGroupOf(r);
    const bucket = groups[g] || groups.Enlistee;
    const inCamp = !bpClassifyPerson(r, dateIso).notInCamp;
    total++; bucket.tot++;
    if (inCamp) { current++; bucket.cur++; }
  });
  return { total, current, groups };
}

// ── Block assembly ──────────────────────────────────────────────────────────
// Build one platoon/HQ block (or the company aggregate block). `aggregate` =
// true uses 80-dash separators + 2-pad rankGroup ratios (DECISIONS #27/#29).
function bpBuildBlock(people, dateIso, type, opts) {
  opts = opts || {};
  const aggregate = !!opts.aggregate;
  const headerLabel = opts.headerLabel || "";
  const dateStr = bpDDMMYY(dateIso);

  // Collect entries per section across all people. Iterate in ascending 4D order
  // so every section's rows come out 4D-sorted (people are pushed section-by-section
  // in this loop's order, so ordering the loop orders the rows). Rows with no
  // number anywhere sort last; a commander whose fourD is an appointment code
  // falls through to the 00xx id, which is what fourDSortKey is for.
  const buckets = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  [...people].sort((a, b) => fourDSortKey(a) - fourDSortKey(b)).forEach(r => {
    if (!bpIsActive(r)) return;
    const c = bpClassifyPerson(r, dateIso, { lookaheadDays: opts.lookaheadDays });
    BP_SECTIONS.forEach(k => { c.sections[k].forEach(line => buckets[k].push(line)); });
  });

  const strength = bpStrength(people, dateIso);
  const ratio = (cur, tot) => aggregate ? `${bp2(cur)}/${bp2(tot)}` : `${cur}/${tot}`;

  // Header.
  const lines = [];
  if (aggregate) {
    lines.push(`${configGet("companyName")} PARADE STATE`);
    lines.push(`${dateStr} ${type} ${opts.time || ""}`.trim());
  } else {
    lines.push(`${dateStr} ${type}`);
    lines.push(headerLabel);
  }
  lines.push("");
  lines.push(`TOTAL STRENGTH: ${strength.total}`);
  lines.push(`CURRENT STRENGTH: ${strength.current}`);
  lines.push("");
  lines.push(`[OFFICER]: ${ratio(strength.groups.Officer.cur, strength.groups.Officer.tot)}`);
  lines.push(`[WOSPEC]: ${ratio(strength.groups.WOSPEC.cur, strength.groups.WOSPEC.tot)}`);
  lines.push(`[ENLISTEE]: ${ratio(strength.groups.Enlistee.cur, strength.groups.Enlistee.tot)}`);

  // Sections, each preceded by its separator.
  BP_SECTIONS.forEach((key, i) => {
    const sep = aggregate ? BP_BIG_SEP : "-".repeat(BP_PLT_SECTION_SEPS[i]);
    lines.push(sep);
    const entries = buckets[key];
    lines.push(`${BP_SECTION_LABELS[key]}: ${bp2(entries.length)}`);
    if (entries.length) {
      entries.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
    } else {
      lines.push(""); // empty section: header + count + one blank line (spec §9.2)
    }
  });

  return lines.join("\n");
}

// ── Public entry point ──────────────────────────────────────────────────────
// scope: { level: "company" } | { level: "platoon", platoon: "PLT1" | "HQ" }
// type: "FP" | "LP". Returns the full message text.
// opts (optional): { lookaheadDays } — Fix 18, forwarded to every block. Omitted
// by the archiver, so its output is unchanged.
function generateBravesParadeState(scope, type, dateIso, time, opts) {
  scope = scope || { level: "company" };
  const lookaheadDays = (opts && opts.lookaheadDays) || 0;
  const roster = STATE.roster || [];
  const platoonPeople = code => roster.filter(r => personPlatoon(r) === code);

  if (scope.level === "platoon") {
    const code = scope.platoon;
    const label = code === "HQ" ? configGet("hqLabel") : `PLATOON ${String(code).replace(/^PLT/i, "")}`;
    return bpBuildBlock(platoonPeople(code), dateIso, type, { headerLabel: label, lookaheadDays });
  }

  // Company: aggregate block → 30 `=` → HQ block → (80 dashes) → PLT blocks.
  const parts = [];
  parts.push(bpBuildBlock(roster, dateIso, type, { aggregate: true, time, lookaheadDays }));
  parts.push("");
  parts.push(BP_EQ_SEP);
  parts.push("");

  // Order: HQ first, then platoons in natural order.
  const plats = activePlatoons().map(p => p.code);
  const ordered = ["HQ", ...plats.filter(c => c !== "HQ")];
  const seen = new Set();
  const blocks = [];
  ordered.forEach(code => {
    if (seen.has(code)) return;
    seen.add(code);
    const people = platoonPeople(code);
    if (!people.length && code !== "HQ") return; // skip empty platoons (keep HQ)
    const label = code === "HQ" ? configGet("hqLabel") : `PLATOON ${String(code).replace(/^PLT/i, "")}`;
    blocks.push(bpBuildBlock(people, dateIso, type, { headerLabel: label, lookaheadDays }));
  });
  parts.push(blocks.join(`\n\n${BP_BIG_SEP}\n`));
  return parts.join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// SICK MESSAGES (spec §10)
// ════════════════════════════════════════════════════════════════════════════
// Two formats, both validated against `Message Formats.md`. Source = Medical rows
// with type RSI/RSO reported on the given date (the day's sick parade). URTI vs
// NON-URTI split by `urtiType`, falling back to classifyURTI(reason) for rows that
// predate the field. Layout (updated Message Formats.md, DECISIONS #45): the six
// field lines of an entry are SINGLE-spaced (joined "\n" into one chunk); builders
// then join chunks (header, count headers, per-platoon labels, entries) with
// "\n\n", so blank lines fall only between entries / around the count headers — not
// between fields. R/N uses sickRN (rank + name + B<4D>, DECISIONS #122).

// "0700" → "0700H" (battalion time suffix). Pads to 4 digits defensively.
function bpTimeH(time) {
  return String(time || "").trim().padStart(4, "0").slice(0, 4) + "H";
}
// key/value field line — omits the trailing space when the value is blank, so an
// unfilled field renders exactly "R/N:" (not "R/N: ") as in the sample.
function bpKV(key, val) {
  return val ? `${key}: ${val}` : `${key}:`;
}
// Report-sick rows for the day: type RSI/RSO reported on dateIso.
function bpSickReports(dateIso) {
  return (STATE.medical || []).filter(m =>
    (m.type === "RSI" || m.type === "RSO") && displayDateToISO(m.date) === dateIso
  );
}
// URTI / NON-URTI bucket for a report-sick row.
function bpUrtiOf(m) {
  const t = m.urtiType || classifyURTI(m.reason || "");
  return t === "URTI" ? "URTI" : "NON-URTI";
}
// "FOLLOW UP STATUS FROM MO" value = the MO outcome from the medical record's
// status (spec §10.4 — no separate field). Pending / blank → blank line (MO not
// seen yet). MC/LD render with the inclusive day count ("9D MC").
function bpSickFollowUp(m) {
  if (!m.status || m.status === "Pending") return "";
  if (m.status === "Warded" || m.status === "NIL") return m.status;
  const days = bpInclusiveDays(m);
  return days ? `${days}D ${m.status}` : m.status;
}
// The six field lines for one report-sick entry (S/N supplied by the caller,
// which restarts numbering per URTI/NON-URTI sub-section — spec §10.2).
function bpSickEntryLines(m, sn) {
  return [
    bpKV("S/N", bp2(sn)),
    bpKV("R/N", sickRN(m.d4)),
    bpKV("DATE", bpDDMMYY(displayDateToISO(m.date))),
    bpKV("LOCATION", m.location || configGet("defaultSickLocation")),
    bpKV("PURPOSE", m.reason || ""),
    bpKV("FOLLOW UP STATUS FROM MO", bpSickFollowUp(m))
  ];
}
// Emit a URTI block then a NON-URTI block (both always shown with counts), S/N
// restarting in each. Returns a line array.
function bpSickUrtiBlocks(reports) {
  const urti = reports.filter(m => bpUrtiOf(m) === "URTI");
  const nonUrti = reports.filter(m => bpUrtiOf(m) === "NON-URTI");
  // Each entry is ONE chunk (its 6 field lines single-spaced, joined by "\n").
  // The callers join chunks with "\n\n", so blank lines fall only between
  // entries and around the URTI/NON-URTI count headers — matching the updated
  // Message Formats.md (DECISIONS #45). Field lines within an entry are no
  // longer double-spaced.
  const lines = [`URTI: ${bp2(urti.length)}`];
  urti.forEach((m, i) => lines.push(bpSickEntryLines(m, i + 1).join("\n")));
  lines.push(`NON-URTI: ${bp2(nonUrti.length)}`);
  nonUrti.forEach((m, i) => lines.push(bpSickEntryLines(m, i + 1).join("\n")));
  return lines;
}

// §10.1 — single report-sick message: header → URTI block → NON-URTI block.
// True when the person carries an unexpired medical status as of dateIso (started
// before that day, on it, or later), INCLUDING the one this very report-sick row
// is carrying — see js/braves-parade.js: bpHasCoveringStatus for the full
// rationale. A blank end date does NOT suppress.
// Mirrored here so the frontend and archiver copies stay behaviourally identical
// (test/parade-port-parity.test.js guards this).
function bpHasCoveringStatus(m, dateIso) {
  return (STATE.medical || []).some(x => {
    if (x.d4 !== m.d4) return false;
    if (!x.status || x.status === "Pending" || x.status === "NIL") return false;
    const end = displayDateToISO(x.endDate || "");
    return !!end && end >= dateIso;
  });
}

function generateRSFormat(dateIso, time, opts) {
  let reports = bpSickReports(dateIso);
  if (opts && opts.omitOnStatus) reports = reports.filter(m => !bpHasCoveringStatus(m, dateIso));
  const lines = [`${bpDDMMYY(dateIso)} ${configGet("companyCoyCode")} ${configGet("unitCode")} ${bpTimeH(time)}`];
  lines.push(...bpSickUrtiBlocks(reports));
  return lines.join("\n\n");
}

// §10.2 — company-wide RSI personnel, broken by platoon. Only platoons (and HQ)
// with ≥1 report-sick entry are shown; TOTAL = sum across them.
// scopeCode: optional platoon code (e.g. "PLT1", "HQ") to restrict output to a
// single platoon; "" or omitted → full company output (backward-compatible).
// opts.omitOnStatus (optional) mirrors generateRSFormat — drops report-sick rows
// for personnel already on a prior active status, applied BEFORE the platoon
// partition so TOTAL and per-platoon PAX counts follow the filtered set. Kept in
// sync with js/braves-parade.js (guarded by test/parade-port-parity.test.js).
function generateRSIPersonnel(dateIso, time, scopeCode, opts) {
  scopeCode = scopeCode || "";
  let reports = bpSickReports(dateIso);
  if (opts && opts.omitOnStatus) reports = reports.filter(m => !bpHasCoveringStatus(m, dateIso));
  const platoonOf = d4 => {
    const r = STATE.roster.find(x => x.id == d4);
    return r ? personPlatoon(r) : "";
  };
  const scoped = scopeCode ? reports.filter(m => platoonOf(m.d4) === scopeCode) : reports;
  const byPlt = {};
  scoped.forEach(m => { (byPlt[platoonOf(m.d4)] = byPlt[platoonOf(m.d4)] || []).push(m); });

  const scopeTag = scopeCode
    ? (scopeCode === "HQ" ? (configGet("hqLabel") || "HQ") : `PLATOON ${String(scopeCode).replace(/^PLT/i, "")}`)
    : "";
  const header = scopeCode ? `RSI PERSONNEL ${bpDDMMYY(dateIso)} ${bpTimeH(time)} — ${scopeTag}` : `RSI PERSONNEL ${bpDDMMYY(dateIso)} ${bpTimeH(time)}`;
  const lines = [header, `TOTAL: ${bp2(scoped.length)} PAX`];

  const known = activePlatoons().map(p => p.code);
  const codes = Object.keys(byPlt);
  const ordered = known.filter(c => byPlt[c]).concat(codes.filter(c => !known.includes(c)));
  ordered.forEach(code => {
    const members = byPlt[code];
    if (!members || !members.length) return;
    const label = code === "HQ" ? configGet("hqLabel")
      : code ? `PLATOON ${String(code).replace(/^PLT/i, "")}` : "UNASSIGNED";
    lines.push(`${label}: ${bp2(members.length)} PAX`);
    lines.push(...bpSickUrtiBlocks(members));
  });
  return lines.join("\n\n");
}
// ───────────────────────── BRAVES-ARCHIVE-PORT END ─────────────────────────

// ── Archive orchestration (GAS-only; uses SpreadsheetApp/readTab/appendMany) ──
var BRAVES_PARADE_ARCHIVE_TAB = "ParadeArchive";
var BRAVES_SICK_ARCHIVE_TAB = "SickArchive";

function bravesArr_(x) { return Array.isArray(x) ? x : []; }

// Config tab → object, mirroring the frontend normalizeConfig: accepts BOTH the
// key/value-rows shape (Braves spec §4) AND the columns-as-keys single row of the
// Config tab (archiveParadeTimes | archiveSickTimes, plus any Braves settings as
// extra columns). Both shapes are still accepted because a live sheet may carry
// either — the columns-as-keys layout predates the key/value one.
function bravesNormalizeConfig_(rows) {
  var out = {};
  function put(k, v) { var kk = String(k).trim(); if (kk) out[kk] = (typeof v === "string") ? v.trim() : v; }
  (rows || []).forEach(function (r) {
    if (!r) return;
    if (r.key !== undefined || r.Key !== undefined) {
      var k = String(r.key || r.Key || "").trim();
      if (k) put(k, (r.value !== undefined ? r.value : (r.Value !== undefined ? r.Value : "")));
    } else {
      Object.keys(r).forEach(function (k) { put(k, r[k]); });   // columns-as-keys row
    }
  });
  return out;
}

// ── Read-boundary normalizers (server-side ports of js/state.js) ─────────────
// readTab returns rows verbatim, so the Roster id column (named "4d" on the sheet)
// arrives as r["4d"] with leading zeros eaten by Sheets — r.id is undefined. The
// ported parade/sick generators join on r.id / m.d4 / l.d4 / a.d4, so without the
// same normalization the client applies, every join misses and names resolve to
// the first roster row. These mirror padD4 / normalizeRoster / normalizeMedical /
// padD4OnLayer in js/state.js — keep them in sync if those change.
function bravesPadD4_(d4) {
  var s = String(d4 == null ? "" : d4).trim().replace(/^C/i, "");
  if (/^\d{1,3}$/.test(s)) { while (s.length < 4) s = "0" + s; return s; }
  return s;
}
function bravesNormalizeRoster_(rows) {
  return (rows || []).map(function (r) {
    var id = bravesPadD4_(r.id || r["4d"] || r["4D"] || "");
    // Auto-detect commander by id pattern (00xx) when the role column is blank;
    // an explicit role from the sheet always wins.
    var isCmdrById = /^00\d{2}$/.test(id);
    var role = r.role || (isCmdrById ? "Commander" : "Recruit");
    var fourD = (r.fourD !== undefined && r.fourD !== "")
      ? String(r.fourD).trim()
      : (role !== "Commander" && /^\d{4}$/.test(id) ? id : "");
    var out = {};
    Object.keys(r).forEach(function (k) { if (k !== "conditions") out[k] = r[k]; });
    out.id = id;
    out.role = role;
    out.rank = r.rank || "";
    out.platoon = r.platoon || "";
    out.section = r.section != null ? String(r.section) : "";
    out.rankGroup = r.rankGroup || "";
    out.fourD = fourD;
    out.leaveQuota = (r.leaveQuota !== undefined && r.leaveQuota !== "") ? +r.leaveQuota : "";
    return out;
  });
}
function bravesNormalizeMedical_(rows) {
  return (rows || []).map(function (r) {
    var status = r.status || "";
    if (/^Excused /.test(status)) status = status.replace(/^Excused /, "Excuse ");
    return {
      id: r.id,
      d4: bravesPadD4_(r.d4 || ""),
      date: r.date || "",
      reason: r.reason || "",
      location: r.location || "",
      status: status,
      startDate: r.startDate || "",
      endDate: r.endDate || "",
      bookInDate: r.bookInDate || "",
      type: r.type || "",
      urtiType: r.urtiType || "",
      mrTiming: r.mrTiming || "",
      visitId: r.visitId || "",
      // Provenance ("conductLog" = auto-backfilled from a conduct import, surfaced
      // as the "(from conduct log)" teal badge; "manual" = hand-entered). Must be
      // carried through the round-trip or the badge vanishes after push + pull.
      origin: r.origin || "manual",
      // This normalizer is a WHITELIST — a key omitted here is invisible to the
      // ported classifier below, which reads the row it returns and not the raw
      // sheet row. Both of these are read by that classifier, so leaving them out
      // silently disabled shipped features on the server side only (the cron
      // archiver), while the identical client code kept
      // working: MR lines lost their timing, and every MA classified as OTHERS
      // (IN CAMP) and never left the strength. Mirrors js/state.js normalizeMedical.
      time: r.time || "",
      // Tolerates the "TRUE"/"true" string Sheets round-trips a boolean column as.
      outOfCamp: r.outOfCamp === true || r.outOfCamp === "TRUE" || r.outOfCamp === "true"
    };
  });
}
// Generic d4-padding pass for leave/appointments (no dedicated normalizer).
function bravesPadD4OnLayer_(rows) {
  return (rows || []).map(function (r) {
    if (r && r.d4 != null) { var c = {}; Object.keys(r).forEach(function (k) { c[k] = r[k]; }); c.d4 = bravesPadD4_(r.d4); return c; }
    return r;
  });
}
// Leave read boundary: pad the 4D and default bookInDate (item 4c) so the column
// survives round-trips (writeTab derives headers from the first row).
function bravesNormalizeLeave_(rows) {
  return bravesPadD4OnLayer_(rows).map(function (r) {
    if (r && typeof r === "object") { r.bookInDate = r.bookInDate || ""; }
    return r;
  });
}

// Build the global STATE the ported generators read, from the live sheet tabs.
// Each layer is normalized at this read boundary exactly as the client does.
function bravesLoadState_() {
  STATE = {
    roster: bravesNormalizeRoster_(bravesArr_(readTab("Roster"))),
    medical: bravesNormalizeMedical_(bravesArr_(readTab("Medical"))),
    leave: bravesNormalizeLeave_(bravesArr_(readTab("Leave"))),
    appointments: bravesPadD4OnLayer_(bravesArr_(readTab("Appointments"))),
    platoons: bravesArr_(readTab("Platoons")),
    config: bravesNormalizeConfig_(bravesArr_(readTab("Config")))
  };
}

function bravesTodayISO_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"); }
function bravesNowHHMM_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HHmm"); }
// Slot before noon → First Parade, else Last Parade. Fallback heuristic for ad-hoc
// manual snapshots at an unconfigured time; the scheduled poll uses the typed
// parser below (which treats midday as FP, only the night/last slot as LP).
function bravesSlotType_(slot) { var n = parseInt(String(slot).slice(0, 2), 10) || 0; return n < 12 ? "FP" : "LP"; }
// "0730,1730" → ["0730","1730"] (4-digit, zero-padded; drops any ":FP"/":LP" tag).
function bravesParseSlots_(cfg) {
  if (!cfg) return [];
  return String(cfg).split(",").map(function (s) {
    var d = String(s).replace(/[^\d]/g, "");
    while (d.length < 4) d = "0" + d;
    return d.slice(0, 4);
  }).filter(function (s) { return s.length === 4; });
}
// Parse the parade schedule into TYPED slots → [{slot:"HHMM", type:"FP"|"LP"}].
// Each entry may carry an explicit type, "0730:FP, 1300:FP, 2130:LP" (case-
// insensitive) — explicit always wins. Untyped entries default by time-of-day:
// the latest slot becomes LP (the night / last parade) ONLY when it is actually
// evening (hour ≥ LP_HOUR); every earlier slot, and a daytime-only schedule with
// no evening slot, stays FP (morning + midday). So a midday parade is FP, not LP —
// and "0730,1300" (no night parade) does NOT mislabel 1300 as LP and drop the
// midday report-sick archive.
var BRAVES_LP_HOUR_ = 16;  // earliest hour an untyped slot is treated as Last Parade
function bravesParseParadeSlots_(cfg) {
  if (!cfg) return [];
  var parsed = String(cfg).split(",").map(function (s) {
    var raw = String(s);
    var tag = (raw.match(/(FP|LP)/i) || [])[1];
    var d = raw.replace(/[^\d]/g, "");
    while (d.length < 4) d = "0" + d;
    return { slot: d.slice(0, 4), type: tag ? tag.toUpperCase() : null };
  }).filter(function (x) { return x.slot.length === 4; });
  var latest = parsed.reduce(function (m, x) { return x.slot > m ? x.slot : m; }, "");
  var latestIsEvening = parseInt(latest.slice(0, 2), 10) >= BRAVES_LP_HOUR_;
  parsed.forEach(function (x) {
    if (!x.type) x.type = (x.slot === latest && latestIsEvening) ? "LP" : "FP";
  });
  return parsed;
}
// Report-sick archive slots: explicit archiveSickTimes if set, ELSE the FP
// (morning + midday) parade slots — so report-sick is archived only in the
// morning and midday and NEVER at the LP/night slot.
function bravesSickSlots_(cfg) {
  var explicit = bravesParseSlots_(cfg.archiveSickTimes);
  if (explicit.length) return explicit;
  return bravesParseParadeSlots_(cfg.archiveParadeTimes)
    .filter(function (x) { return x.type === "FP"; })
    .map(function (x) { return x.slot; });
}

function bravesEnsureArchiveTabs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabWithHeaders_(ss, BRAVES_PARADE_ARCHIVE_TAB, ["timestamp", "date", "slot", "type", "scope", "message"]);
  ensureTabWithHeaders_(ss, BRAVES_SICK_ARCHIVE_TAB, ["timestamp", "date", "slot", "format", "message"]);
  // Force the date/slot columns to plain-text format. appendMany writes via
  // setValues, which auto-coerces "2026-06-23"→a Date and "0730"→730; readTab then
  // reformats Dates to "dd MMM yyyy", so bravesAlreadyArchived_'s string compare
  // would never match and every poll would re-archive duplicates. Text format makes
  // the written strings round-trip verbatim. (appendMany is on the do-not-change
  // list, so we fix the storage format rather than the writer.)
  bravesForceTextCols_(ss, BRAVES_PARADE_ARCHIVE_TAB, ["date", "slot"]);
  bravesForceTextCols_(ss, BRAVES_SICK_ARCHIVE_TAB, ["date", "slot"]);
}
// Set the given header-named columns of a tab to plain-text ("@") number format,
// so string values survive Sheets' input auto-coercion on write/read.
function bravesForceTextCols_(ss, tabName, headerNames) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  if (!lastCol) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var maxRows = sheet.getMaxRows();
  headerNames.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx >= 0) sheet.getRange(1, idx + 1, maxRows, 1).setNumberFormat("@");
  });
}

// Idempotency: has this (date, slot) already been archived in tabName?
function bravesAlreadyArchived_(tabName, dateIso, slot) {
  return bravesArr_(readTab(tabName)).some(function (r) {
    return String(r.date) === dateIso && String(r.slot) === String(slot);
  });
}

function bravesArchiveParade_(dateIso, slot, type) {
  if (bravesAlreadyArchived_(BRAVES_PARADE_ARCHIVE_TAB, dateIso, slot)) return null;
  bravesLoadState_();
  var msg = generateBravesParadeState({ level: "company" }, type, dateIso, slot);
  var row = { timestamp: new Date().toISOString(), date: dateIso, slot: String(slot), type: type, scope: "company", message: msg };
  appendMany(BRAVES_PARADE_ARCHIVE_TAB, [row]);
  return row;
}

// Archive the client's EXACT parade text (Copy-to-Clipboard, incl. hand edits).
// Unlike bravesArchiveParade_ this does NOT regenerate and does NOT dedup by
// date+slot alone — the whole point is capturing what was actually sent, and a
// commander may copy several edited versions in one slot. Deduped only against
// an identical (date, slot, type, text) row so re-copying unchanged text is a
// no-op.
function bravesArchiveParadeText_(dateIso, slot, type, scope, text) {
  var existing = bravesArr_(readTab(BRAVES_PARADE_ARCHIVE_TAB));
  var dup = existing.some(function (r) {
    return String(r.date) === String(dateIso) && String(r.slot) === String(slot)
      && String(r.type || "") === String(type || "") && String(r.message || "") === String(text);
  });
  if (dup) return null;
  var row = { timestamp: new Date().toISOString(), date: dateIso, slot: String(slot), type: type || "", scope: scope || "company", message: String(text) };
  appendMany(BRAVES_PARADE_ARCHIVE_TAB, [row]);
  return row;
}
function bravesArchiveSick_(dateIso, slot) {
  if (bravesAlreadyArchived_(BRAVES_SICK_ARCHIVE_TAB, dateIso, slot)) return null;
  bravesLoadState_();
  var msg = generateRSFormat(dateIso, slot);
  var row = { timestamp: new Date().toISOString(), date: dateIso, slot: String(slot), format: "RS", message: msg };
  appendMany(BRAVES_SICK_ARCHIVE_TAB, [row]);
  return row;
}

// Commander mass-deletion throttle (Misc B1). Rolling 1-hour window of delete
// timestamps per person, stored in ScriptProperties. Cap from Config key
// `commanderDeleteCap` (default 30). Admins never reach this code path.
function bravesDeleteCap_() {
  try {
    var cfg = bravesNormalizeConfig_(bravesArr_(readTab("Config")));
    var n = parseInt(cfg.commanderDeleteCap, 10);
    return (n && n > 0) ? n : 30;
  } catch (e) { return 30; }
}
function bravesCheckDeleteRate_(ctx) {
  var cap = bravesDeleteCap_();
  var key = "delrate:" + (ctx.personId || ctx.email || "?");
  var props = PropertiesService.getScriptProperties();
  var now = Date.now(), windowMs = 3600 * 1000;
  var arr = [];
  try { arr = JSON.parse(props.getProperty(key) || "[]"); } catch (e) { arr = []; }
  arr = arr.filter(function (t) { return (now - t) < windowMs; });   // prune >1h old
  if (arr.length >= cap) { props.setProperty(key, JSON.stringify(arr)); return { ok: false, cap: cap }; }
  arr.push(now);
  props.setProperty(key, JSON.stringify(arr));
  return { ok: true, cap: cap };
}

// doPost action "deleteArchive" (admin-only, Misc B2). Deletes a single archived
// parade/sick message. Archive rows have no id column, so we match on the unique
// ISO `timestamp` (falls back to date+slot if a legacy row lacks one).
function bravesDeleteArchive(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Archive deletion is admin-only.", code: 403 };
  var tabName = (body && body.kind === "sick") ? BRAVES_SICK_ARCHIVE_TAB : BRAVES_PARADE_ARCHIVE_TAB;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) return { error: "Archive tab not found." };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: "Archive is empty." };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var tsCol = headers.indexOf("timestamp"), dCol = headers.indexOf("date"), sCol = headers.indexOf("slot");
  var ts = body && body.timestamp, d = body && body.date, slot = body && body.slot;
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var match = (ts && tsCol >= 0) ? String(row[tsCol]) === String(ts)
      : (dCol >= 0 && sCol >= 0 && String(row[dCol]) === String(d) && String(row[sCol]) === String(slot));
    if (match) { sheet.deleteRow(i + 2); return { ok: true }; }
  }
  return { error: "Archive entry not found (it may already be deleted)." };
}

// doPost action "archiveNow" (commander/admin). body: {kind?:"parade"|"sick"|"both",
// date?:ISO, slot?:HHMM, type?:"FP"|"LP"}. Shares the generators with the cron so
// manual + scheduled archives are produced by identical code.
function bravesArchiveNow(body, ctx) {
  bravesEnsureArchiveTabs_();
  var dateIso = body.date || bravesTodayISO_();
  var slot = body.slot || bravesNowHHMM_();
  var kind = body.kind || "both";
  var out = {};
  if (kind === "parade" || kind === "both") {
    var type = body.type;
    if (!type) {
      // Use the configured slot's FP/LP if this time is on the schedule; otherwise
      // fall back to the noon heuristic for a truly ad-hoc snapshot.
      var cfg = bravesNormalizeConfig_(bravesArr_(readTab("Config")));
      var match = bravesParseParadeSlots_(cfg.archiveParadeTimes).filter(function (p) { return p.slot === slot; })[0];
      type = match ? match.type : bravesSlotType_(slot);
    }
    // If the client supplied the exact copied text (the Parade State tab's
    // Copy-to-Clipboard, including hand edits), archive THAT verbatim — a past
    // parade state can't be regenerated faithfully (manual overrides are session-
    // only). Otherwise regenerate from live state (manual "Archive now" / cron).
    if (typeof body.text === "string" && body.text.replace(/\s/g, "") !== "") {
      out.parade = bravesArchiveParadeText_(dateIso, slot, type, body.scope || "company", body.text);
    } else {
      out.parade = bravesArchiveParade_(dateIso, slot, type);
    }
  }
  if (kind === "sick" || kind === "both") out.sick = bravesArchiveSick_(dateIso, slot);
  return { ok: true, archived: out, date: dateIso, slot: slot };
}

// Time-driven poll (install via setupBravesArchive → 5-min trigger). Archives any
// configured slot whose time-of-day has passed today and isn't already recorded.
function archivePoll() {
  bravesEnsureArchiveTabs_();
  var now = bravesNowHHMM_(), dateIso = bravesTodayISO_();
  var cfg = bravesNormalizeConfig_(bravesArr_(readTab("Config")));
  // Parade: each configured slot, typed FP/LP (midday = FP, night/last = LP).
  bravesParseParadeSlots_(cfg.archiveParadeTimes).forEach(function (p) {
    if (p.slot <= now) bravesArchiveParade_(dateIso, p.slot, p.type);
  });
  // Report sick: morning + midday only (the FP slots, unless overridden).
  bravesSickSlots_(cfg).forEach(function (slot) {
    if (slot <= now) bravesArchiveSick_(dateIso, slot);
  });
}

// One-time setup (run from the Apps Script editor): create the archive tabs and
// install the 5-minute archivePoll trigger.
function setupBravesArchive() {
  bravesEnsureArchiveTabs_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "archivePoll") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("archivePoll").timeBased().everyMinutes(5).create();
  Logger.log("Braves archive ready: ParadeArchive + SickArchive tabs ensured, 5-min archivePoll trigger installed.");
}
