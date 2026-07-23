/*
 * BRAVES COMPANY DATA SYSTEM — Google Apps Script Backend
 * ═══════════════════════════════════════════════════════
 *
 * AUTH MODEL  (Build-order Step 1 — addendum A1/A2)
 * ──────────
 * Per-account email + password login. State lives in the Accounts/AuditLog tabs
 * and in PropertiesService:
 *
 *   Accounts tab    →  email | personId | role | passwordHash | salt | addedBy | addedAt
 *     • role ∈ {admin, commander, viewer}. Passwords are SHA-256(salt+password)
 *       with a per-account UUID salt. Bootstrap the first admin from the editor
 *       with seedFirstAdmin(email, password); run setupAuthTabs() once to create
 *       the Accounts + AuditLog tabs.
 *
 *   auth:<token>    →  {email, personId, role, issuedAt}  (in ScriptProperties)
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
 *               leaveQuota | platoon | section | rankGroup | fourD
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
 *                short text code (OC, PC1…) for no-4D personnel.)
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
 *   ConductDetail: id | date | time | conductId | d4 | type | reason
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
 *   Config:     (Telegram bot / COS parade config — a single columns-as-keys row:
 *                botGroupChatId | nextBookInDate | nextBookInTime | outOfCamp |
 *                cutoffHours | rsoFormUrl | archiveParadeTimes | archiveSickTimes.
 *                Owned by the bot and read by tgReadConfig — do NOT rename or
 *                reshape it. readAllTabs merges its row into STATE.config so the
 *                frontend sees the archive-time keys alongside BravesConfig.)
 *   BravesConfig: key | value
 *               (Transferability layer, spec §4 — split out from the bot's Config
 *                tab so the two schemas never collide. Each row is one setting:
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
 */

var FRONTEND_BASE_URL = "https://cguang-yi.github.io/braves-system/";

// ─── ROUTING ───────────────────────────────────────────

function doGet(e) {
  var output;
  try {
    var action = e.parameter.action || "readAll";
    var tab = e.parameter.tab || "";
    var auth = e.parameter.auth || "";

    // Public action: ping (used by the frontend to verify the URL is reachable).
    if (action === "ping") {
      // Filter manual/scratch tabs out of the connectivity list so they don't
      // read as data tabs in the Sync log. They are never pulled — readAllTabs
      // uses an explicit allow-list — this is purely cosmetic. "Conduct Master"
      // is a human planning sheet with a banner in row 1 (real headers in row 2),
      // so it must never be treated as a data tab regardless.
      var NON_DATA_TABS = { "notes": 1, "Conduct Master": 1 };
      output = {
        ok: true,
        sheets: getTabNames().filter(function (n) { return !NON_DATA_TABS[n]; }),
        timestamp: new Date().toISOString()
      };
    } else {
      // Every other read resolves the account context behind the token. Any valid
      // role (admin/commander/viewer) may read — read-only enforcement only bites
      // on writes (doPost). Expired sessions return session_expired so the frontend
      // can bounce the user to the login screen.
      var ctx = getAuthContext(auth);
      if (!ctx) {
        output = { error: "Unauthorized — please log in", code: 401 };
      } else if (isTokenExpired(ctx)) {
        output = { error: "session_expired", code: 401 };
      } else if (action === "readAll") {
        output = readAllTabs(ctx);              // ctx → AuditLog included only for admins
      } else if (action === "revCheck") {
        // Cheap "what changed?" poll — just the per-tab revisions, no row data.
        output = { ok: true, revs: getAllRevs(), timestamp: new Date().toISOString() };
      } else if (action === "read" && tab) {
        if (tab === "AuditLog" && ctx.role !== "admin") {
          output = { error: "Not authorised", code: 403 };
        } else if ((tab === "ParadeArchive" || tab === "SickArchive") && !canWrite(ctx)) {
          output = { error: "Not authorised", code: 403 };  // archives: commander + admin (Fix1B)
        } else if (tab === "Accounts") {
          output = { error: "Not authorised", code: 403 };  // never expose hashes via raw read
        } else {
          // Single-tab read for partial pulls; carries the tab's current revision
          // so the client can baseline it. (Untracked tabs report rev 1.)
          output = { rows: readTab(tab), rev: getRev(tab) };
        }
      } else if (action === "readTabs" && e.parameter.tabs) {
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
        var reqTabs = e.parameter.tabs.split(",").map(function (t) { return t.trim(); }).filter(function (t) { return t; });
        var tabsOut = {};
        for (var ti = 0; ti < reqTabs.length; ti++) {
          var rt = reqTabs[ti];
          if (rt === "AuditLog" && ctx.role !== "admin") {
            tabsOut[rt] = { error: "Not authorised", code: 403 };
          } else if ((rt === "ParadeArchive" || rt === "SickArchive") && !canWrite(ctx)) {
            tabsOut[rt] = { error: "Not authorised", code: 403 };  // archives: commander + admin (Fix1B)
          } else if (rt === "Accounts") {
            tabsOut[rt] = { error: "Not authorised", code: 403 };  // never expose hashes via raw read
          } else {
            tabsOut[rt] = { rows: readTab(rt), rev: getRev(rt) };
          }
        }
        output = { ok: true, tabs: tabsOut };
      } else {
        output = { error: "Unknown action. Use: readAll, revCheck, read&tab=TabName, readTabs&tabs=A,B, or ping" };
      }
    }
  } catch (err) {
    output = { error: err.message };
  }

  return jsonResponse(output);
}

function doPost(e) {
  // ── Telegram webhook branch ──────────────────────────
  // Telegram posts its update JSON here. Apps Script can't read request
  // headers, so the shared secret rides in the `tgsecret` query param that
  // setTelegramWebhook() bakes into the webhook URL. Everything else falls
  // through to the existing frontend routing untouched.
  if (e && e.parameter && e.parameter.tgsecret !== undefined) {
    return handleTelegramWebhook(e);
  }

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
//   Accounts tab : email | personId | role | passwordHash | salt | addedBy | addedAt
//                  role ∈ {admin, commander, viewer}. personId → Roster id (4D);
//                  stored + returned but the Roster link is soft (not required to
//                  log in) — name/platoon/etc. are derived downstream (Step 2/3).
//   AuditLog tab : timestamp | email | personId | role | action | target | detail | tokenPrefix
//   auth:<token> : { email, personId, role, issuedAt } in ScriptProperties.
//                  Legacy invite tokens (no `role`) are treated as invalid so every
//                  device is forced through the new login.
//
// No bcrypt in Apps Script → SHA-256(salt + password) with a per-account UUID salt.
// Adequate for a small, trusted user base behind an MFA-protected Sheet owner.

var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30-day session expiry
var LOCKOUT_THRESHOLD = 5;                       // failed attempts before lockout
var LOCKOUT_WINDOW_MS = 15 * 60 * 1000;          // 15-minute lockout

// P2-4: every data write appends a row to AuditLog forever, so an admin's
// readAll would otherwise ship the WHOLE history on every full pull — server
// read time and payload size growing unboundedly with total system usage.
// Cap the in-response window to the most recent N rows; the Sheet itself
// stays the complete, unbounded authoritative trail (readAllTabs/readTabTail
// below). N=500 chosen as the admin-facing in-app window (spec §7 Q1).
var AUDIT_READALL_MAX_ROWS = 500;

function hashPassword(plaintext, salt) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + plaintext)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); })
    .join('');
}
function verifyPassword(plaintext, salt, storedHash) {
  return hashPassword(plaintext, salt) === storedHash;
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

  var token = Utilities.getUuid();
  var ctx = {
    email: account.email,
    personId: account.personId || "",
    role: account.role || "viewer",
    issuedAt: new Date().toISOString()
  };
  PropertiesService.getScriptProperties().setProperty("auth:" + token, JSON.stringify(ctx));
  // `ctx.role` here is exactly what getAuthContext(token) would return (we just
  // wrote this same JSON to the property above) — pass it directly, no lookup.
  writeAuditLog(account.email, account.personId, "login", null, null, token, ctx.role);
  return { ok: true, authToken: token, role: ctx.role, personId: ctx.personId, email: ctx.email };
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
  "PolarFlow", "ConductDetail", "Appointments", "Leave", "MSK", "Conducts"];

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
// lock — the Telegram poller (tgPoll) and webhook deduper hold the *script* lock
// (up to 5 min while long-polling), which would otherwise block every web-app
// write until its waitLock timeout. The document lock scopes contention to
// actual sheet writers. Falls back to the script lock for a standalone script.
function getDataLock() {
  try { var l = LockService.getDocumentLock(); if (l) return l; } catch (e) {}
  return LockService.getScriptLock();
}

// Atomic write wrapper. `enforce` true → reject when the client's `baseRev` no
// longer matches the server (lost-update prevention). Runs fn() (the actual
// sheet mutation) under the data lock, then bumps the tab's revision on success
// and returns it as `result.rev` so the client can advance its baseline.
// Backward-compat: a missing baseRev (old cached client, or a server-side bot
// call routed here) skips the check but still bumps, so newer clients see it.
// Untracked tabs (ReportSick, TgUsers, archives) just run fn() — no rev to bump.
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

  // Admin-only account & token management:
  if (action === "listAccounts")      return handleListAccounts(body, ctx);
  if (action === "addAccount")        return handleAddAccount(body, ctx);
  if (action === "removeAccount")     return handleRemoveAccount(body, ctx);
  if (action === "adminResetPassword")return handleAdminResetPassword(body, ctx);
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
             addedBy: r.addedBy || "", addedAt: r.addedAt || "" };
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
    addedBy: ctx.email, addedAt: new Date().toISOString()
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
  ensureTabWithHeaders_(ss, "Accounts", ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt"]);
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

// One-off schema migration (sheet-audit remediation). Run once from the editor:
//   bravesMigrateSchema()
// Brings an existing live sheet up to the schema the frontend already expects.
// SAFE TO RE-RUN: ensureTabWithHeaders_ only *appends* missing header cells to the
// end of row 1 and never rewrites data rows, so existing values are untouched and
// already-present columns are skipped. It does NOT push via writeTab (which would
// re-derive headers from Object.keys(data[0]) and could strip columns). It also
// never touches the bot's Config tab, ParadeArchive, or SickArchive.
//
// What it does:
//   • Roster      — adds the Step-2 Braves columns (platoon, section, rankGroup, fourD)
//   • Medical     — adds the §6 columns (location, type, urtiType, mrTiming, visitId, origin, bookInDate)
//   • Appointments— adds outOfCamp (parade-state "Camp:" line depends on it)
//   • Leave        — adds isInCamp (the "In Camp" override; strength calc depends on it), bookInDate
//   • BravesConfig— creates the key|value company-identity tab and seeds it from
//                   DEFAULT_CONFIG (kept in sync with js/state.js)
//   • Platoons / VocFit / SOC — creates the reference tabs with their headers
// It does NOT backfill values for the new Roster/Medical columns — that is manual
// data entry the user owns. rankGroup in particular cannot be derived from a 4D.
function bravesMigrateSchema() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Append-only column additions to existing tabs (no-ops if the column exists).
  ensureTabWithHeaders_(ss, "Roster",
    ["platoon", "section", "rankGroup", "fourD"]);
  ensureTabWithHeaders_(ss, "Medical",
    ["location", "type", "urtiType", "mrTiming", "visitId", "origin", "bookInDate", "time", "outOfCamp"]);
  ensureTabWithHeaders_(ss, "Appointments",
    ["outOfCamp"]);
  ensureTabWithHeaders_(ss, "Leave",
    ["isInCamp", "isInCampReviewed", "bookInDate"]);

  // Reference tabs (created with headers if absent; missing tab → [] on frontend).
  ensureTabWithHeaders_(ss, "Platoons",
    ["code", "displayName", "active", "createdAt"]);
  ensureTabWithHeaders_(ss, "VocFit",
    ["personId", "completionDate", "certifyingUnit"]);
  ensureTabWithHeaders_(ss, "SOC",
    ["id", "d4", "socNum", "date", "time", "avgHr", "pass"]);

  // BravesConfig (key|value) — create + seed the company-identity settings the
  // frontend's DEFAULT_CONFIG defines. Only seeds keys that aren't already present
  // so re-running never clobbers values an admin has edited.
  ensureTabWithHeaders_(ss, "BravesConfig", ["key", "value"]);
  bravesSeedConfig_(ss);

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
    "Platoons": "platoons"
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
  //   • "Config"       — Telegram bot / COS parade config (columns-as-keys row)
  //   • "BravesConfig" — Braves company-identity settings (key|value rows)
  // Read both and concat the rows. The frontend's normalizeConfig collapses the
  // combined list into one object, so bot keys (archiveParadeTimes, …) and Braves
  // keys (companyName, …) live side by side without colliding. readTab returns []
  // for an empty/absent tab, so concat is always safe.
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
    result.sickArchive = ss.getSheetByName("SickArchive") ? readTab("SickArchive") : [];
  }

  result.timestamp = new Date().toISOString();
  result.sheetName = ss.getName();
  result.revs = getAllRevs();   // per-tab revisions so the client can baseline
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
var WRITE_TEXT_COLS_BY_TAB = { Attendance: ["participants"], ConductDetail: ["time"], Conducts: ["className", "makeupFor"], Medical: ["time"] };

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

// ID-based upsert. Finds the row whose `id` column matches `rowData.id`,
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
  if (!sheet.getLastColumn()) return { error: "Tab '" + tabName + "' has no header row" };
  // Auto-create columns for any new fields so they persist instead of dropping.
  var trimmed = ensureColumnsForKeys(sheet, Object.keys(rowData));
  var idCol = trimmed.indexOf("id");
  if (idCol === -1) return { error: "No 'id' column in tab " + tabName };

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var idCells = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
    var target = String(rowData.id);
    for (var i = 0; i < idCells.length; i++) {
      if (String(idCells[i][0]) === target) {
        var sheetRow = i + 2;
        var updatedRow = trimmed.map(function (h) {
          var val = rowData[h];
          return val !== undefined && val !== null ? val : "";
        });
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
  var newRow = trimmed.map(function (h) {
    var val = rowData[h];
    return val !== undefined && val !== null ? val : "";
  });
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
  var idCol = trimmed.indexOf("id");
  if (idCol === -1) return { error: "No 'id' column in tab " + tabName };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, action: "noop", note: "tab empty" };
  var idCells = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  var target = String(rowId);
  for (var i = 0; i < idCells.length; i++) {
    if (String(idCells[i][0]) === target) {
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

/* ════════════════════════════════════════════════════════════════════
 * TELEGRAM REPORT-SICK (RSO) BOT
 * ════════════════════════════════════════════════════════════════════
 *
 * A serverless Telegram bot that guides a recruit through reporting sick
 * the right way and logs it straight into the existing Sheet (Medical /
 * ReportSick) so it shows up in the dashboard + parade states, then pings
 * the section commander in a commanders' group.
 *
 * ONE-TIME SETUP (run from the Apps Script editor, in order):
 *   1. setupBotTabs()                       — creates TgUsers / ReportSick / Config tabs
 *   2. setTelegramSecrets("<bot-token>", "<any-random-secret>")
 *   3. Deploy the web app (same deployment / new version)
 *   4. setTelegramWebhook()                 — registers the webhook
 *   5. getTelegramWebhookInfo()             — confirm "ok":true, no last_error
 *   6. Add the bot to the commanders' group, type /here in that group,
 *      copy the printed chat id into Config!botGroupChatId.
 *
 * Config tab (single data row, edited by the duty COS):
 *   botGroupChatId | nextBookInDate | nextBookInTime | outOfCamp | cutoffHours | rsoFormUrl
 *   e.g.  -1002345 | 12 Jul 2026    | 2200           | TRUE      | 4           | https://form.gov.sg/...
 */

var TG_PROCEDURE =
  "📋 Report-Sick (RSO) Procedure\n\n" +
  "BEFORE seeing a doctor:\n" +
  "• Inform your Section Commander.\n" +
  "• Tell me the reason + which clinic (this bot logs it + pings your SC).\n\n" +
  "OUT OF CAMP: your status/MC must be SUBMITTED by the cut-off = 4 hours before book-in. " +
  "That means you must report sick, see the doctor, AND send your status here before that time — " +
  "so start early; don't wait. While on MC: rest at home the whole duration, no overseas/strenuous activity, " +
  "only leave home for food/meds/doctor.\n\n" +
  "IN CAMP: inform your duty commander + sign the Report-Sick book at the COS office, then use this bot.\n\n" +
  "AFTER the doctor: come back and tap “Submit MC”, choose your status + days, and upload a photo of the MC slip. " +
  "This must be in by the cut-off (4h before book-in).";

// ─── Telegram transport ────────────────────────────────

function tgProp(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function tgApi(method, payload) {
  var token = tgProp("TG_BOT_TOKEN");
  if (!token) { Logger.log("Telegram: TG_BOT_TOKEN not set"); return null; }
  try {
    var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/" + method, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log("Telegram api " + method + " error: " + e);
    return null;
  }
}

function tgSend(chatId, text, markup, entities) {
  var p = { chat_id: chatId, text: text, disable_web_page_preview: true };
  if (markup) p.reply_markup = markup;
  if (entities && entities.length) p.entities = entities;
  return tgApi("sendMessage", p);
}

function tgAnswer(callbackId, text) {
  tgApi("answerCallbackQuery", { callback_query_id: callbackId, text: text || "" });
}

function kb(rows) { return { inline_keyboard: rows }; }
function btn(text, data) { return { text: text, callback_data: data }; }

// Removes the inline keyboard from a message once a button has been used, so
// it can't be tapped again (defence against double-taps during slow processing).
function tgStripKeyboard(cb) {
  if (cb && cb.message) {
    tgApi("editMessageReplyMarkup", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [] }
    });
  }
}

// Downloads a Telegram photo and saves it to a Drive folder; returns the file URL.
function tgSavePhoto(fileId, name) {
  var token = tgProp("TG_BOT_TOKEN");
  var info = tgApi("getFile", { file_id: fileId });
  if (!info || !info.ok) return "";
  try {
    var path = info.result.file_path;
    var blob = UrlFetchApp.fetch("https://api.telegram.org/file/bot" + token + "/" + path,
      { muteHttpExceptions: true }).getBlob();
    blob.setName(name || "MC.jpg");
    var folder = tgMcFolder();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) {
    Logger.log("tgSavePhoto error: " + e);
    return "";
  }
}

function tgMcFolder() {
  var id = tgProp("TG_MC_FOLDER_ID");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ } }
  var folder = DriveApp.createFolder("Cougar MC Submissions");
  PropertiesService.getScriptProperties().setProperty("TG_MC_FOLDER_ID", folder.getId());
  return folder;
}

// ─── Setup helpers (run from the editor) ───────────────

function setTelegramSecrets(token, secret) {
  var p = PropertiesService.getScriptProperties();
  if (token) p.setProperty("TG_BOT_TOKEN", token);
  if (secret) p.setProperty("TG_WEBHOOK_SECRET", secret);
  Logger.log("Stored. token length " + (token ? token.length : "unchanged") + ", secret " + (secret ? "set" : "unchanged"));
}

function setTelegramWebhook() {
  var token = tgProp("TG_BOT_TOKEN"), secret = tgProp("TG_WEBHOOK_SECRET");
  if (!token || !secret) { Logger.log("Run setTelegramSecrets(token, secret) first."); return; }
  var url = ScriptApp.getService().getUrl();
  if (!url) { Logger.log("Deploy as a web app first, then re-run."); return; }
  // getUrl() often returns the editor-only /dev endpoint, which Telegram can't
  // reach (it requires the developer to be logged in). The public webhook must
  // hit the deployed /exec URL. If you ever need to override, paste your
  // Manage-deployments /exec URL into TG_EXEC_URL via setTelegramExecUrl().
  var override = tgProp("TG_EXEC_URL");
  if (override) url = override;
  else url = url.replace(/\/dev$/, "/exec");
  var hookUrl = url + (url.indexOf("?") === -1 ? "?" : "&") + "tgsecret=" + encodeURIComponent(secret);
  var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify({ url: hookUrl, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
    muteHttpExceptions: true
  });
  Logger.log("setWebhook → " + res.getContentText());
}

// Pin the public /exec URL the webhook should use (copy from Deploy →
// Manage deployments → Web app URL — it ends in /exec). Run once, then
// re-run setTelegramWebhook().
function setTelegramExecUrl(execUrl) {
  PropertiesService.getScriptProperties().setProperty("TG_EXEC_URL", execUrl);
  Logger.log("Stored exec URL: " + execUrl);
}

function getTelegramWebhookInfo() {
  var token = tgProp("TG_BOT_TOKEN");
  if (!token) { Logger.log("No token."); return "(no token)"; }
  var txt = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/getWebhookInfo", { muteHttpExceptions: true }).getContentText();
  Logger.log(txt);
  return txt;
}

function deleteTelegramWebhook() {
  var token = tgProp("TG_BOT_TOKEN");
  if (!token) { Logger.log("No token."); return; }
  Logger.log(UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/deleteWebhook?drop_pending_updates=true", { muteHttpExceptions: true }).getContentText());
}

// ─── POLLING MODE (recommended — avoids the Apps Script 302 webhook issue) ──
//
// Apps Script web apps answer with a 302 redirect, which Telegram rejects
// ("Wrong response 302") and then retry-storms. Polling with getUpdates has
// none of that. startTelegramPolling() deletes the webhook and installs a
// 1-minute trigger that runs tgPoll(); tgPoll long-polls for up to ~5 min so
// replies are effectively real-time, and a script lock keeps only one poller
// alive at a time.

function startTelegramPolling() {
  deleteTelegramWebhook();   // getUpdates 409s if a webhook is still set
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgPoll") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tgPoll").timeBased().everyMinutes(1).create();
  Logger.log("Polling started: webhook removed + 1-min trigger installed. Now run tgPoll() once to begin immediately.");
}

function stopTelegramPolling() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgPoll") ScriptApp.deleteTrigger(t);
  });
  Logger.log("Polling stopped (tgPoll triggers removed).");
}

// Run this to see whether polling is currently ON. Check View → Logs after running.
function tgPollingStatus() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgPoll") n++;
  });
  var offset = PropertiesService.getScriptProperties().getProperty("TG_OFFSET");
  Logger.log("Polling is " + (n > 0 ? "ON ✅" : "OFF ❌") + " (" + n + " tgPoll trigger(s) installed).");
  Logger.log("TG_OFFSET (last acked update + 1): " + (offset || "(none yet)"));
  Logger.log("Webhook (the \"url\" field should be EMPTY when polling): " + getTelegramWebhookInfo());
  return n > 0;
}

function tgPoll() {
  var token = tgProp("TG_BOT_TOKEN");
  if (!token) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) return;   // another poller is already running
  try {
    var start = Date.now();
    while (Date.now() - start < 5 * 60 * 1000) {     // stay under the 6-min cap
      var offset = Number(PropertiesService.getScriptProperties().getProperty("TG_OFFSET") || 0);
      var url = "https://api.telegram.org/bot" + token + "/getUpdates?timeout=50" +
        "&allowed_updates=" + encodeURIComponent('["message","callback_query"]') +
        (offset ? "&offset=" + offset : "");
      var res, data;
      try { res = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); data = JSON.parse(res.getContentText()); }
      catch (e) { Utilities.sleep(1500); continue; }
      if (!data || !data.ok) { Utilities.sleep(1500); continue; }
      var updates = data.result || [];
      for (var i = 0; i < updates.length; i++) {
        var u = updates[i];
        try { handleTelegramUpdate(u); }
        catch (err) { Logger.log("tgPoll handle error: " + err + (err && err.stack ? "\n" + err.stack : "")); }
        // Advancing the offset past this update_id acks it server-side, so
        // Telegram never resends it — no dedupe needed, no 302.
        PropertiesService.getScriptProperties().setProperty("TG_OFFSET", String(u.update_id + 1));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// Diagnostic / reset: clears the dedupe marker + all in-progress conversation
// state. Run from the editor if the bot gets wedged. Also logs the current
// dedupe marker so you can see what it thinks the last update_id was.
function tgResetBot() {
  var props = PropertiesService.getScriptProperties();
  Logger.log("TG_LAST_UPDATE was: " + props.getProperty("TG_LAST_UPDATE"));
  props.deleteProperty("TG_LAST_UPDATE");
  var all = props.getProperties();
  var cleared = 0;
  for (var k in all) { if (k.indexOf("tg:state:") === 0) { props.deleteProperty(k); cleared++; } }
  Logger.log("Reset done. Cleared dedupe marker + " + cleared + " conversation state(s).");
}

function setupBotTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function ensure(name, headers, seed) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sh.setFrozenRows(1);
      if (seed) sh.getRange(2, 1, 1, headers.length).setValues([headers.map(function (h) {
        return seed[h] !== undefined ? seed[h] : "";
      })]);
    }
  }
  ensure("TgUsers", ["id", "chatId", "userId", "username", "d4", "name", "role", "sectionsOwned", "registeredAt"]);
  ensure("ReportSick", ["id", "d4", "name", "plt", "sect", "context", "reason", "clinic", "reportedAt", "cutoffAt", "bookInAt", "status", "startDate", "endDate", "mcUrl", "state", "notifiedSC"]);
  ensure("Config", ["botGroupChatId", "nextBookInDate", "nextBookInTime", "outOfCamp", "cutoffHours", "rsoFormUrl"], { cutoffHours: 4, outOfCamp: "FALSE" });
  Logger.log("Bot tabs ready: TgUsers, ReportSick, Config");
}

// ─── Small utilities ───────────────────────────────────

function tgPadD4(v) {
  var s = String(v == null ? "" : v).trim().toUpperCase();
  if (s.charAt(0) === "C") s = s.slice(1);
  s = s.replace(/[^0-9]/g, "");
  while (s.length > 0 && s.length < 4) s = "0" + s;
  return s;
}

function tgTruthy(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y";
}

function tgNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim(); }

function tgNameMatches(rosterName, typed) {
  var a = tgNorm(rosterName), b = tgNorm(typed);
  if (!a || !b) return false;
  if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;
  var ta = a.split(" "), tb = b.split(" "), overlap = 0;
  ta.forEach(function (t) { if (t.length >= 3 && tb.indexOf(t) !== -1) overlap++; });
  return overlap >= 2;
}

function tgAddDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
function tgDisplayDate(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd MMM yyyy"); }
function tgHHMM(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "HHmm") + "hrs"; }
function tgDateTimeLabel(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "EEE dd MMM, HHmm") + "hrs"; }

function tgParseDisplayDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  var months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var parts = String(dateStr).trim().split(/\s+/);   // "12 Jul 2026"
  if (parts.length < 3) return null;
  var day = parseInt(parts[0], 10);
  var mon = months[parts[1].slice(0, 3).toLowerCase()];
  var year = parseInt(parts[2], 10);
  if (isNaN(day) || mon == null || isNaN(year)) return null;
  var digits = String(timeStr == null ? "0000" : timeStr).replace(/[^0-9]/g, "");
  if (digits.length === 3) digits = "0" + digits;
  if (digits.length < 4) digits = "0000";
  return new Date(year, mon, day, parseInt(digits.slice(0, 2), 10), parseInt(digits.slice(2, 4), 10), 0);
}

// ─── Config + cut-off ──────────────────────────────────

function tgReadConfig() {
  var rows = readTab("Config");
  if (rows.error || !rows.length) return {};
  return rows[0];
}

function tgComputeCutoff(cfg) {
  var bookIn = tgParseDisplayDateTime(cfg.nextBookInDate, cfg.nextBookInTime);
  var hours = parseFloat(cfg.cutoffHours) || 4;
  var out = { outOfCamp: tgTruthy(cfg.outOfCamp), bookIn: bookIn, cutoff: null, tooLate: false, hours: hours };
  if (bookIn) {
    out.cutoff = new Date(bookIn.getTime() - hours * 3600 * 1000);
    out.tooLate = new Date() > out.cutoff;
  }
  return out;
}

// ─── Identity ──────────────────────────────────────────

function tgFindUser(chatId) {
  var rows = readTab("TgUsers");
  if (rows.error) return null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(chatId) || String(rows[i].chatId) === String(chatId)) {
      var u = rows[i];
      u.d4 = tgPadD4(u.d4);
      u.plt = u.d4.charAt(0);
      u.sect = u.d4.charAt(1);
      return u;
    }
  }
  return null;
}

function tgUpsertUser(u) { return upsertRow("TgUsers", u); }

// Returns the TgUsers row that already claims this 4D on a DIFFERENT chat, else null.
// This is what stops anyone from registering as someone they aren't: a 4D can only be
// linked to one Telegram account, and a second account can't silently take it over.
function tg4dClaimedByOther(d4, chatId) {
  var rows = readTab("TgUsers");
  if (!rows || rows.error) return null;
  for (var i = 0; i < rows.length; i++) {
    if (tgPadD4(rows[i].d4) === d4 && String(rows[i].id) !== String(chatId)) return rows[i];
  }
  return null;
}

// Finalise a registration the recruit has explicitly confirmed is them.
function tgConfirmRegistration(chatId) {
  var state = tgGetState(chatId);
  var d = state && state.draft;
  if (!d || state.step !== "reg_confirm") { tgStartRegistration(chatId); return; }

  var other = tg4dClaimedByOther(d.d4, chatId);
  if (other) {
    tgClearState(chatId);
    tgSend(chatId, "⚠️ 4D " + d.d4 + " is already linked to another Telegram account" +
      (other.name ? " (" + other.name + ")" : "") + ".\n\nIf this is genuinely you, ask your COS/SC to remove the old link first — this is how we stop anyone registering as someone they're not. Then /start again.");
    return;
  }

  var u = {
    id: chatId, chatId: chatId, userId: d.userId || "", username: d.username || "",
    d4: d.d4, name: d.name, role: d.role, rank: d.rank || "",
    sectionsOwned: "", registeredAt: new Date().toISOString()
  };
  tgUpsertUser(u);
  if (d.role === "Commander") {
    tgSetState(chatId, { step: "reg_sections" });
    tgSend(chatId, "You're a commander ✅. Which section(s) do you command? e.g. P1S3 (comma-separate for multiple).");
  } else {
    tgClearState(chatId);
    tgSendMenu(chatId, "✅ Registered: REC " + d.name + " (C" + d.d4 + "), Platoon " + d.d4.charAt(0) + " Section " + d.d4.charAt(1) + ".\nWhenever you feel unwell, tap below or type /reportsick.");
  }
}

// Restart registration for this chat (frees its own link first; can't claim another's 4D).
function tgDoReRegister(chatId) {
  try { deleteRowById("TgUsers", chatId); } catch (e) {}
  tgClearState(chatId);
  tgStartRegistration(chatId);
}

function tgRosterLookup(d4) {
  var rows = readTab("Roster");
  if (rows.error) return null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rid = tgPadD4(r["4d"] != null && r["4d"] !== "" ? r["4d"] : r.id);
    if (rid === d4) {
      return {
        name: String(r.name || "").trim(),
        role: String(r.role || "Recruit").trim() || "Recruit",
        rank: String(r.rank || "").trim()
      };
    }
  }
  return null;
}

// Returns ALL commanders who own this section (a section can have more than one).
function tgFindSectionCmds(plt, sect) {
  var key = ("P" + plt + "S" + sect).toUpperCase();
  var out = [];
  var rows = readTab("TgUsers");
  if (!rows || rows.error) return out;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.role) === "Commander" && r.sectionsOwned) {
      var owned = String(r.sectionsOwned).toUpperCase().split(/[,\s]+/);
      if (owned.indexOf(key) !== -1) out.push(r);
    }
  }
  return out;
}

function tgRN(user) {
  if (user.role === "Commander") return (user.rank ? user.rank + " " : "") + user.name;
  return "REC " + user.name + " (C" + tgPadD4(user.d4) + ")";
}

// ─── Group notify (with @mention of the SC) ────────────

// Posts to the commanders' group. If photoFileId is given, the message is sent
// as that photo with the text as its caption (so the MC image shows inline
// instead of a Drive link). `scs` may be a single commander or an array — every
// one is @mentioned via a text_mention entity (a section can have multiple SCs).
function tgGroupNotify(text, scs, photoFileId) {
  var cfg = tgReadConfig();
  var gid = cfg.botGroupChatId;
  if (!gid) return;
  if (scs && !Array.isArray(scs)) scs = [scs];
  scs = (scs || []).filter(Boolean);
  var full = text + "\n", entities = [];
  if (scs.length) {
    full += "SC: ";
    for (var i = 0; i < scs.length; i++) {
      var sc = scs[i];
      if (i > 0) full += ", ";
      if (sc.userId) {
        var offset = full.length;        // UTF-16 code units — what Telegram expects
        var nm = sc.name || "SC";
        full += nm;
        entities.push({ type: "text_mention", offset: offset, length: nm.length, user: { id: Number(sc.userId) } });
      } else if (sc.username) {
        full += "@" + String(sc.username).replace(/^@/, "");
      } else {
        full += (sc.name || "SC") + " (not on bot)";
      }
    }
    full += "  ← please acknowledge";
  } else {
    full += "(section commander not registered — please acknowledge)";
  }
  if (photoFileId) {
    var p = { chat_id: gid, photo: photoFileId, caption: full };
    if (entities.length) p.caption_entities = entities;
    var r = tgApi("sendPhoto", p);
    if (r && r.ok) return;
    // Photo send failed (e.g. file_id expired) — fall back to a text message.
  }
  tgSend(gid, full, null, entities);
}

// ─── Conversation state (per chat, in ScriptProperties) ─

function tgStateKey(chatId) { return "tg:state:" + chatId; }
function tgGetState(chatId) { var s = tgProp(tgStateKey(chatId)); if (!s) return {}; try { return JSON.parse(s); } catch (e) { return {}; } }
function tgSetState(chatId, obj) { PropertiesService.getScriptProperties().setProperty(tgStateKey(chatId), JSON.stringify(obj)); }
function tgClearState(chatId) { PropertiesService.getScriptProperties().deleteProperty(tgStateKey(chatId)); }

// ─── Webhook entry + dispatch ──────────────────────────

function handleTelegramWebhook(e) {
  try {
    var secret = tgProp("TG_WEBHOOK_SECRET");
    if (!secret || e.parameter.tgsecret !== secret) return ContentService.createTextOutput("");
    var update = JSON.parse(e.postData.contents);

    // Telegram delivers AT LEAST ONCE — because Apps Script answers via a 302
    // redirect, Telegram sometimes resends the same update, which would replay
    // the same reply (e.g. the welcome message). Dedupe by update_id under a
    // script lock so each update is processed exactly once.
    var lock = LockService.getScriptLock();
    try { lock.waitLock(20000); } catch (le) { return ContentService.createTextOutput(""); }
    try {
      var uid = update.update_id;
      var last = Number(tgProp("TG_LAST_UPDATE") || 0);
      if (uid == null || uid > last) {
        if (uid != null) PropertiesService.getScriptProperties().setProperty("TG_LAST_UPDATE", String(uid));
        handleTelegramUpdate(update);
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log("Telegram webhook error: " + err + (err && err.stack ? "\n" + err.stack : ""));
  }
  return ContentService.createTextOutput("");   // always 200 so Telegram doesn't retry-storm
}

function handleTelegramUpdate(update) {
  if (update.callback_query) { tgHandleCallback(update.callback_query); return; }
  if (update.message) { tgHandleMessage(update.message); return; }
}

function tgHandleMessage(msg) {
  var chatId = msg.chat.id;

  // Group/supergroup: only respond to /here (so the COS can grab the chat id).
  if (msg.chat.type !== "private") {
    if ((msg.text || "").indexOf("/here") === 0) {
      tgSend(chatId, "This chat's ID: " + chatId + "\nPaste it into the Config tab → botGroupChatId.");
    }
    return;
  }

  var text = (msg.text || "").trim();
  var user = tgFindUser(chatId);
  var state = tgGetState(chatId);

  // Global commands (work in any state).
  if (text === "/cancel") { tgClearState(chatId); tgSendMenu(chatId, "Cancelled. What would you like to do?"); return; }
  if (text === "/start") {
    if (user) tgSendMenu(chatId, "Welcome back, " + (user.role === "Commander" ? user.name : ("REC " + user.name)) + ".");
    else tgStartRegistration(chatId);
    return;
  }
  if (text === "/help" || text === "/procedure") { tgSend(chatId, TG_PROCEDURE); return; }
  if (text === "/whoami") {
    if (!user) { tgSend(chatId, "You're not registered yet. Send /start."); return; }
    var wd4 = tgPadD4(user.d4);
    tgSend(chatId, "You're registered as " + tgRN(user) +
      (user.role === "Commander" ? "" : " · Platoon " + wd4.charAt(0) + " Section " + wd4.charAt(1)) + ".",
      kb([[btn("🔄 Not me — re-register", "reg:again")]]));
    return;
  }
  if (text === "/register") { tgDoReRegister(chatId); return; }
  if (text === "/reportsick" || text === "/report") {
    if (!user) { tgSend(chatId, "Please /start to register first."); return; }
    tgBeginReportSick(chatId, user);
    return;
  }

  // Registration flow (user not yet linked).
  if (!user) {
    if (state.step === "reg_d4") {
      var d4 = tgPadD4(text);
      if (d4.length !== 4) { tgSend(chatId, "That doesn't look like a 4D number. Send 4 digits, e.g. 1311."); return; }
      state.d4 = d4; state.step = "reg_name"; tgSetState(chatId, state);
      tgSend(chatId, "And your full name as in the system?");
      return;
    }
    if (state.step === "reg_name") {
      var match = tgRosterLookup(state.d4);
      if (!match) { tgClearState(chatId); tgSend(chatId, "❌ 4D " + state.d4 + " isn't in the system. Check with your SC, then /start again."); return; }
      if (!tgNameMatches(match.name, text)) {
        state.tries = (state.tries || 0) + 1;
        if (state.tries >= 3) { tgClearState(chatId); tgSend(chatId, "❌ Name didn't match after 3 tries. Please check with your SC, then /start again."); }
        else { tgSetState(chatId, state); tgSend(chatId, "❌ That name doesn't match 4D " + state.d4 + ". Type your full name as in your 11B."); }
        return;
      }
      var role = match.role || "Recruit";
      // Confirm before saving, so a wrong 4D/name is caught up front.
      state.step = "reg_confirm";
      state.draft = {
        d4: state.d4, name: match.name, role: role, rank: match.rank || "",
        userId: (msg.from && msg.from.id) || "", username: (msg.from && msg.from.username) || ""
      };
      tgSetState(chatId, state);
      var who = role === "Commander"
        ? ((match.rank ? match.rank + " " : "") + match.name)
        : ("REC " + match.name + " (C" + state.d4 + ")");
      tgSend(chatId, "Please confirm — you're registering as:\n\n" + who +
        "\nPlatoon " + state.d4.charAt(0) + " Section " + state.d4.charAt(1) + "\n\nIs this you?",
        kb([[btn("✅ Yes, that's me", "reg:confirm")], [btn("🔄 No, re-enter", "reg:redo")]]));
      return;
    }
    if (state.step === "reg_confirm") { tgSend(chatId, "Please tap ✅ Yes or 🔄 No above to finish registering."); return; }
    tgSend(chatId, "Please /start to register first.");
    return;
  }

  // MC photo upload.
  if (state.step === "mc_photo") {
    if (msg.photo && msg.photo.length) { tgPhotoReceived(chatId, state, msg.photo[msg.photo.length - 1].file_id); return; }
    if (msg.document && String(msg.document.mime_type || "").indexOf("image") === 0) { tgPhotoReceived(chatId, state, msg.document.file_id); return; }
    tgSend(chatId, "Please upload a PHOTO of your MC / status slip 📷 (or /cancel).");
    return;
  }

  // Stateful free-text steps.
  switch (state.step) {
    case "reg_sections": {
      var owned = text.toUpperCase().replace(/[^0-9PS,\s]/g, "").replace(/\s+/g, "").trim();
      var cu = tgFindUser(chatId); cu.sectionsOwned = owned; tgUpsertUser(cu); tgClearState(chatId);
      tgSendMenu(chatId, "✅ Registered as commander for: " + owned + "\nYou'll be pinged in the group when your recruits report sick.");
      return;
    }
    case "rs_reason":
      if (!text) { tgSend(chatId, "✍️ Please TYPE your reason as a text message below (e.g. “Fever and sore throat”), or tap ✖️ Cancel.", kb([[btn("✖️ Cancel report sick", "rs:cancel")]])); return; }
      state.reason = text; tgSetState(chatId, state);
      if (state.context === "OutOfCamp") { state.step = "rs_clinic"; tgSetState(chatId, state); tgSend(chatId, "✍️ Which clinic / polyclinic / hospital will you go to? Type it below (e.g. “Healthway Medical, Yishun”).", kb([[btn("✖️ Cancel report sick", "rs:cancel")]])); }
      else tgAskSC(chatId, state, user);
      return;
    case "rs_clinic":
      if (!text) { tgSend(chatId, "✍️ Please TYPE the clinic / hospital name as a text message below, or tap ✖️ Cancel.", kb([[btn("✖️ Cancel report sick", "rs:cancel")]])); return; }
      state.clinic = text; tgSetState(chatId, state); tgAskSC(chatId, state, user);
      return;
    default:
      // User typed text during a button-only step — guide them back to the right
      // action instead of capturing the text into the wrong field or dumping them out.
      if (state.step === "rs_confirm")
        return void tgSend(chatId, "👆 Please tap a button above to continue, or ✖️ Cancel.", kb([[btn("✖️ Cancel report sick", "rs:cancel")]]));
      if (state.step === "rs_sc")
        return void tgSend(chatId, "👆 Don't type it here. After you've actually WhatsApp'd your SC, tap “✅ I have messaged my SC on WhatsApp” above.", kb([[btn("✖️ Cancel report sick", "rs:cancel")]]));
      if (state.step === "post_request")
        return void tgSend(chatId, "👆 When you have your status, tap “📄 Submit MC / status” above.\nEven if the doctor gave you NO status, still tap it.", kb([[btn("📄 Submit MC / status", "rs:submitmc")]]));
      if (state.step === "mc_photo")
        return void tgSend(chatId, "📷 Please UPLOAD a photo of your MC / status slip — don't type it.\nNo status? Tap the button below.", kb([[btn("🚫 No status given (nothing to upload)", "mc:nostatus")], [btn("✖️ Cancel", "rs:cancel")]]));
      if (state.step === "mc_saving")
        return void tgSend(chatId, "⏳ Still saving your last MC — hang on a moment.");
      if (state.step === "toolate")
        return void tgSend(chatId, "👆 Please tap one of the options above.");
      tgSendMenu(chatId, "Tap an option, or type /reportsick.");
      return;
  }
}

function tgHandleCallback(cb) {
  tgAnswer(cb.id);
  if (!cb.message || cb.message.chat.type !== "private") return;
  var chatId = cb.message.chat.id;
  var data = cb.data || "";
  var user = tgFindUser(chatId);
  var state = tgGetState(chatId);

  // Registration callbacks — must work before a TgUsers row exists.
  if (data === "reg:confirm") { tgStripKeyboard(cb); tgConfirmRegistration(chatId); return; }
  if (data === "reg:redo" || data === "reg:again") { tgStripKeyboard(cb); tgDoReRegister(chatId); return; }

  if (!user) { tgSend(chatId, "Please /start to register first."); return; }

  var step = state.step;

  if (data === "info") { tgSend(chatId, TG_PROCEDURE); return; }
  if (data === "rs:begin") { tgBeginReportSick(chatId, user); return; }
  if (data === "rs:cancel") { tgClearState(chatId); tgStripKeyboard(cb); tgSendMenu(chatId, "Cancelled. What would you like to do?"); return; }

  if (data === "rs:start" || data === "incamp:continue") {
    if (step !== "rs_confirm") return;                       // already past this step — ignore repeat taps
    tgStripKeyboard(cb);
    tgAskReason(chatId, state);
    return;
  }

  if (data === "toolate:tellsc") {
    if (step !== "toolate") return;                          // one-shot
    tgSetState(chatId, { step: "toolate_done" });            // claim immediately so a repeat tap is a no-op
    tgStripKeyboard(cb);
    var sc0 = tgFindSectionCmds(user.plt, user.sect);
    tgGroupNotify("⚠️ FEELING UNWELL (past report-sick cut-off) — " + tgRN(user) + " · P" + user.plt + " S" + user.sect + "\nWill report sick in camp at next book-in.", sc0);
    tgSend(chatId, "📨 Your SC has been notified. Book in as normal and report sick at first parade.");
    tgClearState(chatId);
    tgSendMenu(chatId, "What would you like to do?");
    return;
  }

  if (data === "sc:informed") {
    if (step !== "rs_sc") return;                            // already submitted — ignore repeat taps
    state.step = "rs_finalizing"; tgSetState(chatId, state); // claim immediately
    tgStripKeyboard(cb);
    tgFinalizeRequest(chatId, user, state, true);            // SC is pinged regardless
    return;
  }

  if (data === "rs:submitmc") {
    if (step !== "post_request") return;   // only valid right after a finalized request — ignore stale taps
    tgStripKeyboard(cb);
    tgAskMCPhoto(chatId, state);
    return;
  }

  if (data === "mc:nostatus") {
    if (step !== "mc_photo") return;
    tgStripKeyboard(cb);
    tgCompleteNoStatus(chatId, state);
    return;
  }

}

// ─── Flows ─────────────────────────────────────────────

function tgSendMenu(chatId, text) {
  tgSend(chatId, text || "What would you like to do?", kb([[btn("📋 Report Sick", "rs:begin")], [btn("ℹ️ RSO Procedure", "info")]]));
}

function tgStartRegistration(chatId) {
  tgSetState(chatId, { step: "reg_d4", tries: 0 });
  tgSend(chatId, "👋 Welcome to the Cougar Report-Sick bot. This helps you report sick the right way and notifies your commander automatically.\n\nFirst, let's verify who you are. What's your 4D number? (e.g. 1311)");
}

function tgBeginReportSick(chatId, user) {
  var cfg = tgReadConfig();
  var cc = tgComputeCutoff(cfg);

  if (cc.outOfCamp) {
    if (cc.bookIn && cc.tooLate) {
      tgSetState(chatId, { step: "toolate" });
      tgSend(chatId,
        "⚠️ It's now " + tgHHMM(new Date()) + ". Your status/MC had to be SUBMITTED by " + tgHHMM(cc.cutoff) +
        " (" + cc.hours + "h before book-in at " + tgHHMM(cc.bookIn) + ") — and there's no longer enough time to see a doctor and submit it before then.\n\n" +
        "❌ You can no longer report sick outside for this book-in.\n\n" +
        "What to do instead:\n" +
        "• Book in as normal.\n" +
        "• Report sick IN CAMP at first parade — inform your duty commander on arrival.\n" +
        "• Real emergency? Go to A&E now and message your SC immediately.",
        kb([[btn("📨 Tell my SC I'm unwell", "toolate:tellsc")], [btn("ℹ️ RSO Procedure", "info")]]));
      return;
    }
    var msg = "You're currently OUT OF CAMP (booked out).\n";
    if (cc.bookIn) msg += "📅 Next book-in: " + tgDateTimeLabel(cc.bookIn) + "\n⏰ Your status/MC must be SUBMITTED by " + tgHHMM(cc.cutoff) + " (" + cc.hours + "h before book-in). See the doctor and send it here before then — start now, don't wait. ✅\n\n";
    else msg += "⏰ Book-in time not set by COS yet — proceed, but confirm timings with your SC.\n\n";
    msg += "Before you see a doctor, take note (GOM rules while on MC):\n" +
      "• Rest at home for the FULL duration, including off-hours.\n" +
      "• ❌ No overseas travel, no clubbing/drinking, no strenuous activity/sports.\n" +
      "• You may leave home ONLY to buy takeaway, buy meds, or see a doctor — tell your commander.\n\n" +
      "Ready to log your report-sick request?";
    tgSetState(chatId, { step: "rs_confirm", context: "OutOfCamp" });
    tgSend(chatId, msg, kb([[btn("✅ Yes, start", "rs:start")], [btn("Cancel", "rs:cancel")]]));
  } else {
    tgSetState(chatId, { step: "rs_confirm", context: "InCamp" });
    tgSend(chatId,
      "You're IN CAMP. To report sick here:\n" +
      "1️⃣ Inform your duty commander now.\n" +
      "2️⃣ Sign the Report-Sick book at the COS office.\n" +
      "3️⃣ Complete this form so it's logged + your SC is pinged.",
      kb([[btn("✅ Done 1 & 2, continue", "incamp:continue")], [btn("Cancel", "rs:cancel")]]));
  }
}

function tgAskReason(chatId, state) {
  state.step = "rs_reason"; tgSetState(chatId, state);
  tgSend(chatId, "✍️ What's wrong? Type a short reason below (e.g. “Fever and sore throat”) — this goes to your commander.",
    kb([[btn("✖️ Cancel report sick", "rs:cancel")]]));
}

function tgAskSC(chatId, state, user) {
  state.step = "rs_sc"; tgSetState(chatId, state);
  var scs = tgFindSectionCmds(user.plt, user.sect);
  var scName = scs.length ? scs.map(function (s) { return s.name; }).join(" / ") : "your Section Commander";
  tgSend(chatId, "🛑 STOP. DO NOT report sick until you have personally messaged " + scName + " on WhatsApp.\n\n" +
    "This is NOT optional. You MUST tell " + scName + " directly that you are reporting sick — BEFORE you go anywhere.\n\n" + 
    "Only tap below AFTER you have actually sent that WhatsApp message:",
    kb([[btn("✅ I have messaged my SC on WhatsApp", "sc:informed")], [btn("✖️ Cancel report sick", "rs:cancel")]]));
}

function tgFinalizeRequest(chatId, user, state, informed) {
  var cfg = tgReadConfig();
  var cc = tgComputeCutoff(cfg);
  var now = new Date();
  var rsId = Date.now();
  var row = {
    id: rsId, d4: user.d4, name: user.name, plt: user.plt, sect: user.sect,
    context: state.context || "", reason: state.reason || "", clinic: state.clinic || "",
    reportedAt: Utilities.formatDate(now, Session.getScriptTimeZone(), "dd MMM yyyy HHmm"),
    cutoffAt: cc.cutoff ? tgHHMM(cc.cutoff) : "", bookInAt: cc.bookIn ? tgDateTimeLabel(cc.bookIn) : "",
    status: "", startDate: "", endDate: "", mcUrl: "", state: "Requested",
    notifiedSC: informed ? "informed" : "pinged"
  };
  upsertRow("ReportSick", row);

  var sc = tgFindSectionCmds(user.plt, user.sect);
  var gtext = "🤒 REPORT SICK — " + tgRN(user) + " · P" + user.plt + " S" + user.sect + "\n" +
    "Context: " + (state.context === "InCamp" ? "In camp" : "Out of camp") + "\n" +
    "Reason: " + (state.reason || "-") +
    (state.clinic ? ("\nClinic: " + state.clinic) : "") + "\n" +
    "Reported: " + row.reportedAt + (cc.cutoff ? (" · Cut-off " + tgHHMM(cc.cutoff)) : "") + "\n" +
    "(recruit confirms he has messaged his SC on WhatsApp — please acknowledge)";
  tgGroupNotify(gtext, sc);

  state.step = "post_request"; state.rsId = rsId; tgSetState(chatId, state);
  var ack = "📨 Logged" + (cfg.botGroupChatId ? " and your SC has been notified in the commanders' group." : ".") + "\n";
  ack += state.context === "InCamp"
    ? "Head to the Medical Centre. After you've seen the MO, tap “Submit MC” below."
    : ("Now go see the doctor. AFTER you've seen the MO, come back and tap “Submit MC” below" + (cc.cutoff ? (" — your status/MC must be submitted by " + tgHHMM(cc.cutoff) + " (4h before book-in). Don't leave it to the last minute.") : "."));
  ack += "\n\n⚠️ Even if the doctor gives you NO status, you must STILL tap “Submit MC” — there's a “No status given” option on the next screen.";
  tgSend(chatId, ack, kb([[btn("📄 Submit MC / status", "rs:submitmc")]]));
}

function tgAskMCPhoto(chatId, state) {
  state.step = "mc_photo"; tgSetState(chatId, state);
  tgSend(chatId, "Upload a clear PHOTO of your MC / status slip 📷\n\nYour commander will read the status and duration straight off the slip — no need to type them in.",
    kb([[btn("🚫 No status given (nothing to upload)", "mc:nostatus")], [btn("✖️ Cancel", "rs:cancel")]]));
}

function tgPhotoReceived(chatId, state, fileId) {
  // Claim the step immediately so a duplicate photo / retry can't double-process,
  // and give instant feedback before the (slower) Drive save + group post.
  state.step = "mc_saving"; tgSetState(chatId, state);
  tgSend(chatId, "📷 Got your MC — saving and notifying your commanders…");
  var url = "";
  try { url = tgSavePhoto(fileId, "MC_" + (state && state.rsId ? state.rsId : Date.now()) + ".jpg"); }
  catch (e) { Logger.log("tgPhotoReceived save error: " + e); }
  tgCompleteMC(chatId, state, url, fileId);
}

function tgGetReportSickById(id) {
  var rows = readTab("ReportSick");
  if (rows.error) return null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === String(id)) return rows[i];
  return null;
}

function tgCompleteMC(chatId, state, url, fileId) {
  var user = tgFindUser(chatId);
  if (!user) {
    tgSend(chatId, "⚠️ I couldn't find your registration to log this. Your MC image: " + (url || "(not saved)") + "\nPlease /start to re-register, or tell your SC directly.");
    tgClearState(chatId);
    return;
  }
  var today = tgDisplayDate(new Date());

  try {
    if (state.rsId) {
      var rs = tgGetReportSickById(state.rsId);
      if (rs) {
        // status/startDate/endDate left blank — the COS keys them in from the MC image.
        rs.mcUrl = url || ""; rs.state = "MC-Submitted";
        upsertRow("ReportSick", rs);
      }
    }
    // Append a Medical row so it flows into the dashboard + parade state. Status
    // and dates are left BLANK for the COS to fill in from the MC image — recruits
    // no longer self-declare their status. `location` carries the clinic/hospital
    // captured in the rs_clinic step (out-of-camp only) so report-sick-outside
    // cases show the location in the parade state. Falls back to the ReportSick
    // row's clinic in case the conversation state was trimmed.
    appendRow("Medical", {
      id: Date.now(), d4: user.d4, date: today,
      reason: state.reason || "Reported sick",
      location: state.clinic || (rs && rs.clinic) || "",
      status: "", startDate: "", endDate: ""
    });
    // This write bypasses doPost/withRevLock (it's a server-side bot action), so
    // bump the Medical revision manually — otherwise dashboards' revCheck poll
    // would never see the change and would silently miss the bot-reported sick
    // record until a manual full pull.
    bumpRev("Medical");
  } catch (e) {
    Logger.log("tgCompleteMC sheet error: " + e);
  }

  var sc = tgFindSectionCmds(user.plt, user.sect);
  // Caption (no Drive link — the photo itself is shown in the group). The
  // Drive copy is still kept in ReportSick.mcUrl for the records/dashboard.
  tgGroupNotify(
    "📄 MC SUBMITTED — " + tgRN(user) + " · P" + user.plt + " S" + user.sect + "\n" +
    "Status + duration: read from the MC image below — please record it in the system.", sc, fileId);

  tgSend(chatId, "✅ Received — your MC has been sent to your commanders.\n Get the book in timing from your Commaders, and remember to book in on time once your status ends.");
  tgClearState(chatId);
  tgSendMenu(chatId, "What would you like to do?");
}

function tgCompleteNoStatus(chatId, state) {
  var user = tgFindUser(chatId);
  if (state.rsId) {
    var rs = tgGetReportSickById(state.rsId);
    if (rs) { rs.status = "NIL"; rs.state = "NoStatus"; upsertRow("ReportSick", rs); }
  }
  var sc = tgFindSectionCmds(user.plt, user.sect);
  tgGroupNotify("ℹ️ NO STATUS — " + tgRN(user) + " · P" + user.plt + " S" + user.sect + "\nMO saw him, no status given.", sc);
  tgSend(chatId, "Noted — no status given, you're fit for normal duties. Remember to still book in on time. 💪");
  tgClearState(chatId);
  tgSendMenu(chatId, "What would you like to do?");
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

function personPlatoon(r) {
  if (!r) return "";
  if (r.platoon) return String(r.platoon).trim();
  const p = getPlt(r);
  return p ? "PLT" + p : "";
}

function personSection(r) {
  if (!r) return "";
  if (r.section != null && r.section !== "") return String(r.section).trim();
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
// shows name + 4D only) — rank comes from the roster's rank column, dropped when
// blank.
function bravesParadeRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = r.name || "";
  const prefix = configGet("companyPrefix") || "B";
  // Duplicates isCommander/displayPersonLabel (helpers.js) — can't reuse: this needs B<fourD> tagging, not plain name.
  if (r.role !== "Commander" && r.fourD && String(r.fourD).trim() !== "") {
    return [r.rank, `${name} ${prefix}${String(r.fourD).trim()}`].filter(Boolean).join(" ").trim();
  }
  return [r.rank, name].filter(Boolean).join(" ").trim();
}

// Sick-message R/N (spec §10): name (+ B<4D>) with NO rank prefix. Commanders
// never get a 4D suffix here either — they're never displayed by id.
function sickRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = r.name || "";
  const prefix = configGet("companyPrefix") || "B";
  // Duplicates isCommander/displayPersonLabel (helpers.js) — can't reuse: this needs B<fourD> tagging with no rank prefix.
  if (r.role !== "Commander" && r.fourD && String(r.fourD).trim() !== "") {
    return `${name} ${prefix}${String(r.fourD).trim()}`.trim();
  }
  return name.trim();
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

function bpClassifyPerson(r, dateIso) {
  const rn = bravesParadeRN(r.id);
  const out = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  let notInCamp = false;

  // Supersede tags, parallel to out[] for the duration-bearing sections only
  // (js/braves-parade.js carries these on its `meta` twin — this file has no
  // meta, so track them alongside). Every push into these four sections must go
  // through pushS so the arrays stay index-aligned for bpSupersedeSameType.
  const sup = { alOil: [], attC: [], status: [], others: [] };
  const pushS = (section, line, tag) => { out[section].push(line); sup[section].push(tag || null); };

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
    if (!s || !e || !(s <= dateIso && dateIso <= e)) return;
    if (bookedInBy(l, dateIso)) return;   // booked in ⇒ Present from bookInDate onward
    // The entry text is the free-text reason ("48HR BO"), falling back to the
    // leave type when no reason was recorded. (NOT "type — reason" — the sample
    // shows a single clean label.)
    const reason = l.reason || l.type || "";
    const inCamp = l.isInCamp === true;
    if (inCamp) leaveOverride = true;
    const leaveSup = { supKey: String(l.type || "").trim().toUpperCase(), supEnd: displayDateToISO(l.endDate || "") };
    if (bpIsAlOilType(l.type)) {
      pushS("alOil", `${rn} - ${reason} ${bpRange(l, true)}`.trim(), leaveSup);
      notInCamp = true;  // AL/OIL is not in camp unless overridden (below)
    } else {
      // Non-AL/OIL leave → OTHERS; the commander picks In Camp/Not In Camp
      // explicitly on every record (no more reason-keyword guessing here).
      const label = inCamp ? "OTHERS (IN CAMP)" : "OTHERS (NOT IN CAMP)";
      const rng = bpRange(l, false);
      pushS("others", `${rn} - ${reason}${rng ? " " + rng : ""} (${label})`.trim(), leaveSup);
      if (!inCamp) notInCamp = true;
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
      const timing = m.mrTiming ? ` (${m.mrTiming})` : "";
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
    if (m.status === "MC" && medStatusActive(m, dateIso) && !bookedInBy(m, dateIso)) {
      const days = bpInclusiveDays(m);
      const label = days ? `${days}D MC` : "MC";
      pushS("attC", `${rn} - ${label} ${bpRange(m, false)}`.trim(), { supKey: "MC", supEnd: displayDateToISO(m.endDate || "") });
      notInCamp = true;
    }

    // STATUS — active LD, RIB, Excuse-*, or any other in-camp-restricted status.
    // Requires a non-empty status: an imported RS/SENT_OUT episode carries
    // status:"" with an active date range, which would otherwise emit a blank
    // "RN - " STATUS line (and double-list someone already in REPORTING SICK).
    // Every status here gets the same "{days}D {status}" duration prefix.
    if (m.status && medStatusActive(m, dateIso) && m.status !== "MC" && m.status !== "Warded"
        && m.status !== "Pending" && m.status !== "NIL" && !bookedInBy(m, dateIso)) {
      const days = bpInclusiveDays(m);
      const label = days ? `${days}D ${m.status}` : m.status;
      pushS("status", `${rn} - ${label} ${bpRange(m, true)}`.trim(), { supKey: String(m.status).trim(), supEnd: displayDateToISO(m.endDate || "") });
    }

    // Warded → OTHERS (NOT IN CAMP).
    if (m.status === "Warded" && medStatusActive(m, dateIso) && !bookedInBy(m, dateIso)) {
      pushS("others", `${rn} - ${m.reason || "Warded"} (OTHERS (NOT IN CAMP))`.trim(), { supKey: "WD", supEnd: displayDateToISO(m.endDate || "") });
      notInCamp = true;
    }

    // Item 17: Medical Appointment (type MA) dated today → OTHERS. Mirrors the
    // legacy standalone-Appointments block below (booking now routes through the
    // Medical form): outOfCamp → NOT IN CAMP; in camp → OTHERS (IN CAMP). A
    // booked-in MA drops off. Independent of any status the visit carries (Q2).
    // MUST mirror js/braves-parade.js — parade-port-parity.test.js guards this.
    if (m.type === "MA" && displayDateToISO(m.date) === dateIso && !bookedInBy(m, dateIso)) {
      const outOfCamp = !!m.outOfCamp;
      const label = outOfCamp ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
      pushS("others", `${rn} - ${m.reason || "Medical Appointment"} (${label})`.trim(), null); // point event, never superseded
      if (outOfCamp) notInCamp = true;
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
  if (!out.attC.length) {
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
  (STATE.appointments || []).forEach(a => {
    if (a.d4 !== r.id || a.resolved) return;
    if (displayDateToISO(a.date) !== dateIso) return;
    const outOfCamp = !!a.outOfCamp;
    const label = outOfCamp ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
    pushS("others", `${rn} - ${a.reason || "Appointment"} (${label})`.trim(), null); // appointments: point events, never superseded
    if (outOfCamp) notInCamp = true;
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
  // in this loop's order, so ordering the loop orders the rows). Non-numeric 4Ds
  // sort last.
  const bp4DNum = r => { const n = parseInt(String(r.fourD || r.id || ""), 10); return Number.isFinite(n) ? n : Infinity; };
  const buckets = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  [...people].sort((a, b) => bp4DNum(a) - bp4DNum(b)).forEach(r => {
    if (!bpIsActive(r)) return;
    const c = bpClassifyPerson(r, dateIso);
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
function generateBravesParadeState(scope, type, dateIso, time) {
  scope = scope || { level: "company" };
  const roster = STATE.roster || [];
  const platoonPeople = code => roster.filter(r => personPlatoon(r) === code);

  if (scope.level === "platoon") {
    const code = scope.platoon;
    const label = code === "HQ" ? configGet("hqLabel") : `PLATOON ${String(code).replace(/^PLT/i, "")}`;
    return bpBuildBlock(platoonPeople(code), dateIso, type, { headerLabel: label });
  }

  // Company: aggregate block → 30 `=` → HQ block → (80 dashes) → PLT blocks.
  const parts = [];
  parts.push(bpBuildBlock(roster, dateIso, type, { aggregate: true, time }));
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
    blocks.push(bpBuildBlock(people, dateIso, type, { headerLabel: label }));
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
// between fields. R/N uses sickRN (name + B<4D>, no rank prefix — spec §10/§7 note).

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
// True when the person carries some OTHER unexpired medical status as of dateIso
// (started before that day, on it, or later) — see js/braves-parade.js:
// bpHasOtherStatus for the full rationale. A blank end date does NOT suppress.
// Mirrored here so the frontend and archiver copies stay behaviourally identical
// (test/parade-port-parity.test.js guards this).
function bpHasOtherStatus(m, dateIso) {
  return (STATE.medical || []).some(x => {
    if (x === m || x.d4 !== m.d4) return false;
    if (!x.status || x.status === "Pending" || x.status === "NIL") return false;
    const end = displayDateToISO(x.endDate || "");
    return !!end && end >= dateIso;
  });
}

function generateRSFormat(dateIso, time, opts) {
  let reports = bpSickReports(dateIso);
  if (opts && opts.omitOnStatus) reports = reports.filter(m => !bpHasOtherStatus(m, dateIso));
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
  if (opts && opts.omitOnStatus) reports = reports.filter(m => !bpHasOtherStatus(m, dateIso));
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
// key/value-rows shape (Braves spec §4) AND the columns-as-keys single row that the
// Telegram bot uses (botGroupChatId | … plus any Braves settings as extra columns).
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
      origin: r.origin || "manual"
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
