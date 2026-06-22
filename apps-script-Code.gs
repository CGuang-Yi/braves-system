/*
 * COUGAR COMPANY DATA SYSTEM — Google Apps Script Backend
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
 * LEGACY (dormant, removed after Step 1 is verified):
 *   invite:<token> / the redeemInvite flow / generate(Bulk)Invite. Tokens these
 *   issue carry no `role`, so getAuthContext() rejects them — they can neither
 *   read nor write under the new model.
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
 * 5. Run generateInvite() from the editor → check the Execution log →
 *    open the printed URL on the device that needs access.
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
 *               type | urtiType | mrTiming | visitId
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
 *               | participants | periods | currencyTags | source
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
 *   PolarFlow:  id | d4 | conduct | date | avgHr | maxHr | minHr | z1 | z2 | z3 | z4 | z5 | calories | trainingLoad | recovery | duration | distance
 *   ConductDetail: id | date | time | conduct | d4 | type | reason
 *               (one row per non-participating recruit per conduct.
 *                type ∈ {PX, RSI, Fallout, ReportSick}:
 *                  PX         = pre-existing status before the conduct (MC/LD/RMJ);
 *                  RSI        = reporting sick at first parade that morning;
 *                  Fallout    = dropped out during the conduct itself;
 *                  ReportSick = sent to MO mid-day after the conduct.
 *                Aggregates in the Attendance sheet should match the
 *                per-conduct totals of these rows.)
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
 *   Leave:      id | d4 | type | startDate | endDate | days | reason
 *               (Personnel absences. type ∈ {Leave, Compassionate,
 *                Off-in-Lieu, Weekend, Night's Out, Course, Guard Duty,
 *                NDP, Other}. Only
 *                Off-in-Lieu decrements the per-commander leaveQuota
 *                (roster field). Night's Out = same-day evening off-camp
 *                (start = end = same date). startDate/endDate inclusive,
 *                display-format. `days` is numeric — defaults to
 *                (endDate − startDate + 1) but is editable for half-days.)
 *
 *   MSK:        timestamp | type | d4 | description | physioDate | cleared
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
 *   Config:     key | value
 *               (Transferability layer, spec §4. Each row is one setting:
 *                companyName, companyPrefix (4D display prefix, e.g. "B"),
 *                companyCoyCode ("B COY"), unitCode ("40SAR"), hqLabel
 *                ("BRAVES HQ"), defaultSickLocation ("PTMC"),
 *                polarCompanyName, haEligibilitySource
 *                ("isHAExcluded" | "currencyTag"). Missing keys fall back to
 *                DEFAULT_CONFIG in js/state.js. Admin-only to edit.)
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

var FRONTEND_BASE_URL = "https://coon-hound.github.io/cougar-system/";

// ─── ROUTING ───────────────────────────────────────────

function doGet(e) {
  var output;
  try {
    var action = e.parameter.action || "readAll";
    var tab = e.parameter.tab || "";
    var auth = e.parameter.auth || "";

    // Public action: ping (used by the frontend to verify the URL is reachable).
    if (action === "ping") {
      output = { ok: true, sheets: getTabNames(), timestamp: new Date().toISOString() };
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
      } else if (action === "read" && tab) {
        if ((tab === "AuditLog" || tab === "ParadeArchive" || tab === "SickArchive") && ctx.role !== "admin") {
          output = { error: "Not authorised", code: 403 };
        } else if (tab === "Accounts") {
          output = { error: "Not authorised", code: 403 };  // never expose hashes via raw read
        } else {
          output = readTab(tab);
        }
      } else {
        output = { error: "Unknown action. Use: readAll, read&tab=TabName, or ping" };
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
    } else if (action === "redeemInvite") {
      // DORMANT — legacy invite flow. Tokens it issues carry no role, so they
      // fail getAuthContext() and can't read or write. Retained only until the
      // new auth is verified, then deleted (see CLAUDE.md Step 1 / DECISIONS C).
      output = redeemInvite(body.token);
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

// ─── AUTH / INVITE FLOW ────────────────────────────────

function isValidAuth(token) {
  if (!token) return false;
  return PropertiesService.getScriptProperties().getProperty("auth:" + token) !== null;
}

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

function redeemInvite(inviteToken) {
  if (!inviteToken) return { error: "Missing invite token" };
  var props = PropertiesService.getScriptProperties();
  var key = "invite:" + inviteToken;
  var raw = props.getProperty(key);
  if (!raw) return { error: "Invalid invite link" };

  var invite = JSON.parse(raw);
  var now = new Date().toISOString();
  var nowMs = Date.now();

  // Multi-use invite: tracked via maxUses + usedCount. The same link can be
  // shared with a whole team; each device gets its own auth token, and the
  // link self-expires once the cap or expiry date is hit. Single-use invites
  // (no maxUses field) keep the legacy behavior below.
  if (typeof invite.maxUses === "number") {
    if (invite.expiresAt && nowMs > Date.parse(invite.expiresAt)) return { error: "This invite link has expired" };
    if ((invite.usedCount || 0) >= invite.maxUses) return { error: "This invite link is full — ask your admin for a new one" };

    var authTokenM = Utilities.getUuid();
    invite.usedCount = (invite.usedCount || 0) + 1;
    invite.redemptions = invite.redemptions || [];
    invite.redemptions.push({ at: now, authToken: authTokenM });
    props.setProperty(key, JSON.stringify(invite));
    props.setProperty("auth:" + authTokenM, JSON.stringify({ issuedAt: now, fromInvite: inviteToken }));
    return { ok: true, authToken: authTokenM };
  }

  if (invite.used) return { error: "This invite has already been used" };

  var authToken = Utilities.getUuid();

  invite.used = true;
  invite.usedAt = now;
  invite.issuedAuthToken = authToken;
  props.setProperty(key, JSON.stringify(invite));
  props.setProperty("auth:" + authToken, JSON.stringify({ issuedAt: now, fromInvite: inviteToken }));

  return { ok: true, authToken: authToken };
}

// ─── ADMIN FUNCTIONS — run from the Apps Script editor ─

function generateInvite() {
  var token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    "invite:" + token,
    JSON.stringify({ used: false, createdAt: new Date().toISOString() })
  );
  var link = FRONTEND_BASE_URL + "?token=" + token;
  Logger.log("───────────────────────────────────────────");
  Logger.log("NEW INVITE LINK (single-use):");
  Logger.log(link);
  Logger.log("───────────────────────────────────────────");
  return link;
}

// Multi-use invite for bulk onboarding (e.g. dropping one link in a WhatsApp
// group of 30 PCs). Each click issues a separate per-device auth token, so
// revoking one user later does not affect the rest. The link self-disables
// once `maxUses` is hit or `expiresInDays` passes.
//
// Usage from the editor: generateBulkInvite(30, 7)
//   maxUses        — cap on redemptions (default 30)
//   expiresInDays  — link auto-expires after N days (default 7; pass 0 to disable)
function generateBulkInvite(maxUses, expiresInDays) {
  var max = (typeof maxUses === "number" && maxUses > 0) ? Math.floor(maxUses) : 30;
  var days = (typeof expiresInDays === "number" && expiresInDays >= 0) ? expiresInDays : 7;
  var token = Utilities.getUuid();
  var now = new Date();
  var record = {
    maxUses: max,
    usedCount: 0,
    redemptions: [],
    createdAt: now.toISOString()
  };
  if (days > 0) record.expiresAt = new Date(now.getTime() + days * 86400000).toISOString();

  PropertiesService.getScriptProperties().setProperty("invite:" + token, JSON.stringify(record));
  var link = FRONTEND_BASE_URL + "?token=" + token;
  Logger.log("═══════════════════════════════════════════");
  Logger.log("NEW BULK INVITE LINK");
  Logger.log("  uses: 0 / " + max + (days > 0 ? "    expires: " + record.expiresAt : "    (no expiry)"));
  Logger.log("  share this ONE link with your group:");
  Logger.log("  " + link);
  Logger.log("═══════════════════════════════════════════");
  Logger.log("To audit redemptions later:  bulkInviteStatus(\"" + token + "\")");
  Logger.log("To kill the link:            revokeInvite(\"" + token + "\")");
  return link;
}

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

// Nuclear option: kicks every authenticated device. Each user will need a
// fresh invite link from you to regain access. Invites themselves are NOT
// touched — only issued auth tokens.
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
  Logger.log("Revoked " + count + " auth token(s). Every device must redeem a new invite.");
}

// ═══════════════════════════════════════════════════════
// ACCOUNT / PASSWORD AUTH  (Build-order Step 1 — addendum A1 & A2)
// ═══════════════════════════════════════════════════════
//
// Replaces the invite-token model above with per-account email+password login.
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
  writeAuditLog(account.email, account.personId, "login", null, null, token);
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
  writeAuditLog(email, null, "login_failed", null, reason, null);
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

  var res;
  if (action === "write" && tab && body.data)                    res = writeTab(tab, body.data);
  else if (action === "append" && tab && body.row)               res = appendRow(tab, body.row);
  else if (action === "appendMany" && tab && body.rows)          res = appendMany(tab, body.rows);
  else if (action === "upsertRow" && tab && body.row)            res = upsertRow(tab, body.row);
  else if (action === "deleteRowById" && tab && body.id !== undefined) res = deleteRowById(tab, body.id);
  else if (action === "deleteRow" && tab && body.rowIndex !== undefined) res = deleteRow(tab, body.rowIndex);
  else if (action === "updateRow" && tab && body.rowIndex !== undefined && body.row) res = updateRow(tab, body.rowIndex, body.row);
  else if (action === "sendEmail")                               res = sendEmailHelper(body);
  else if (action === "getEmailInfo")                            res = getEmailInfoHelper();
  else if (action === "analyzePhoto")                            res = analyzePhotoHelper(body);
  else if (action === "archiveNow")                              res = bravesArchiveNow(body, ctx);
  else return { error: "Invalid request" };

  // Audit manual archive snapshots (A2.3-style).
  if (action === "archiveNow" && res && !res.error) {
    writeAuditLog(ctx.email, ctx.personId, "archive_now", "Archive", (body && body.kind) || "both", body.auth);
  }

  // Best-effort audit of data writes to the tabs called out in A2.3.
  if (res && !res.error && tab &&
      ["write", "append", "appendMany", "upsertRow", "updateRow", "deleteRowById", "deleteRow"].indexOf(action) >= 0) {
    writeAuditLog(ctx.email, ctx.personId, auditActionForTab(tab), tab, action, body.auth);
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
  writeAuditLog(ctx.email, ctx.personId, "change_password", ctx.email, null, body.auth);
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
  writeAuditLog(ctx.email, ctx.personId, "admin_reset_password", body.targetEmail, null, body.auth);
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
  writeAuditLog(ctx.email, ctx.personId, "add_account", email, role, body.auth);
  return { ok: true, warning: warning };
}

function handleRemoveAccount(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  var email = body.targetEmail ? String(body.targetEmail).trim() : "";
  if (!email) return { error: "targetEmail required." };
  if (email.toLowerCase() === String(ctx.email).toLowerCase()) return { error: "You cannot remove your own account." };
  var removed = removeAccountRow(email);
  var revoked = revokeAllTokensForEmail(email);  // also kick any live sessions
  writeAuditLog(ctx.email, ctx.personId, "remove_account", email, revoked + " token(s) revoked", body.auth);
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
  writeAuditLog(ctx.email, ctx.personId, "revoke_token", body.targetEmail || "", "specific token", body.auth);
  return { ok: true };
}

function handleRevokeAllForEmail(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  if (!body.targetEmail) return { error: "targetEmail required." };
  var n = revokeAllTokensForEmail(body.targetEmail);
  writeAuditLog(ctx.email, ctx.personId, "revoke_all_for_email", body.targetEmail, n + " token(s)", body.auth);
  return { ok: true, revoked: n };
}

function handleRevokeAllTokens(body, ctx) {
  if (!isAdmin(ctx)) return { error: "Not authorised", code: 403 };
  var props = PropertiesService.getScriptProperties();
  var n = 0;
  props.getKeys().forEach(function (k) { if (k.indexOf("auth:") === 0) { props.deleteProperty(k); n++; } });
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

function writeAuditLog(email, personId, action, target, detail, token) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("AuditLog");
    if (!sheet) return;  // tab not created yet — never let logging break the action
    var ctx = token ? getAuthContext(token) : null;
    sheet.appendRow([
      new Date().toISOString(),
      email || "", personId || "",
      ctx ? ctx.role : "",
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
    // Braves reference tabs (spec §4/§12/A6). Config is key/value — the frontend
    // collapses it to an object. All three are optional: a missing tab yields []
    // and the frontend falls back to defaults/derivation.
    "Config": "config",
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

  // Admin-only: include the audit log in the pull (A2.5). The Accounts tab is
  // never included here — it carries password hashes and is reached only via the
  // dedicated, hash-stripping listAccounts action.
  if (ctx && ctx.role === "admin") {
    result.auditLog = ss.getSheetByName("AuditLog") ? readTab("AuditLog") : [];
    // Archived parade-state / report-sick messages (Item 1) — admin-only, same as
    // the audit log. Empty arrays when the tabs don't exist yet.
    result.paradeArchive = ss.getSheetByName("ParadeArchive") ? readTab("ParadeArchive") : [];
    result.sickArchive = ss.getSheetByName("SickArchive") ? readTab("SickArchive") : [];
  }

  result.timestamp = new Date().toISOString();
  result.sheetName = ss.getName();
  return result;
}

// ─── WRITE OPERATIONS ──────────────────────────────────

function writeTab(tabName, data) {
  if (!Array.isArray(data) || data.length === 0) {
    return { error: "Data must be a non-empty array of objects" };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }

  var headers = Object.keys(data[0]);

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

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

function appendRow(tabName, rowData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };

  var trimmed = ensureColumnsForKeys(sheet, Object.keys(rowData));
  var newRow = trimmed.map(function (h) {
    var val = rowData[h];
    return val !== undefined && val !== null ? val : "";
  });

  sheet.appendRow(newRow);

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
  sheet.getRange(startRow, 1, newRows.length, trimmed.length).setValues(newRows);

  return {
    ok: true,
    tab: tabName,
    rowsAppended: newRows.length,
    timestamp: new Date().toISOString()
  };
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
  // Not found — append a new row.
  var newRow = trimmed.map(function (h) {
    var val = rowData[h];
    return val !== undefined && val !== null ? val : "";
  });
  sheet.appendRow(newRow);
  return {
    ok: true,
    tab: tabName,
    action: "appended",
    rowIndex: sheet.getLastRow(),
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
  // "isHAExcluded" = existing conduct-name logic; "currencyTag" = the CSV
  // "Currency Tags: HA" metadata. Switchable without code changes.
  haEligibilitySource: "isHAExcluded",
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
// Config is absent. Everything NOT in the set falls to OTHERS, sub-typed in/out
// of camp by the reason-keyword derivation (bpOthersNotInCamp), per spec §8.
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
// 4D personnel: "MARTIN TAN B1411" (name + prefix + 4D). No-4D personnel:
// "LCP CALVIN LEE" (rank + name) or just "TREVOR LEE". Names rendered as stored
// (not force-uppercased) per the sample.
function bravesParadeRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = r.name || "";
  const prefix = configGet("companyPrefix") || "B";
  if (r.fourD && String(r.fourD).trim() !== "") {
    return `${name} ${prefix}${String(r.fourD).trim()}`.trim();
  }
  return [r.rank, name].filter(Boolean).join(" ").trim();
}

// Sick-message R/N (spec §10): name (+ B<4D>) with NO rank prefix.
function sickRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = r.name || "";
  const prefix = configGet("companyPrefix") || "B";
  if (r.fourD && String(r.fourD).trim() !== "") {
    return `${name} ${prefix}${String(r.fourD).trim()}`.trim();
  }
  return name.trim();
}

// ── OTHERS sub-type (spec §8) ───────────────────────────────────────────────
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
function bpClassifyPerson(r, dateIso) {
  const rn = bravesParadeRN(r.id);
  const out = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  let notInCamp = false;

  // Leave → AL/OIL (in the AL/OIL type set) or OTHERS (not in camp).
  STATE.leave.forEach(l => {
    if (l.d4 !== r.id) return;
    const s = displayDateToISO(l.startDate), e = displayDateToISO(l.endDate);
    if (!s || !e || !(s <= dateIso && dateIso <= e)) return;
    // The entry text is the free-text reason ("48HR BO"), falling back to the
    // leave type when no reason was recorded. (NOT "type — reason" — the sample
    // shows a single clean label.)
    const reason = l.reason || l.type || "";
    if (bpIsAlOilType(l.type)) {
      out.alOil.push(`${rn} - ${reason} ${bpRange(l, true)}`.trim());
      notInCamp = true;  // AL/OIL is always not in camp
    } else {
      // Non-AL/OIL leave → OTHERS; in/out of camp via the §8 reason-keyword
      // default ("book out"/"out of camp"/MA → NOT IN CAMP; else IN CAMP).
      const nic = bpOthersNotInCamp(reason);
      const label = nic ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
      const rng = bpRange(l, false);
      out.others.push(`${rn} - ${reason}${rng ? " " + rng : ""} (${label})`.trim());
      if (nic) notInCamp = true;
    }
  });

  // Medical rows for this person.
  STATE.medical.forEach(m => {
    if (m.d4 !== r.id) return;
    const reportedToday = displayDateToISO(m.date) === dateIso;

    // MR — own section, independent of everything else (spec §6/§8).
    if (m.type === "MR" && reportedToday) {
      const timing = m.mrTiming ? ` (${m.mrTiming})` : "";
      out.mr.push(`${rn} - ${m.reason || ""}${timing}`.trim());
    }

    // REPORTING SICK — RSI/RSO reported today, or a Pending status active today.
    const isRS = ((m.type === "RSI" || m.type === "RSO") && reportedToday)
      || (m.status === "Pending" && medStatusActive(m, dateIso));
    if (isRS) {
      const label = m.type === "RSO" ? "RSO" : "RSI"; // Pending→RSI (DECISIONS #31)
      out.reportingSick.push(`${rn} - ${m.reason || ""} (${label})`.trim());
    }

    // ATT C — active MC (not-in-camp). Warded handled as OTHERS below.
    if (m.status === "MC" && medStatusActive(m, dateIso)) {
      const days = bpInclusiveDays(m);
      const label = days ? `${days}D MC` : "MC";
      out.attC.push(`${rn} - ${label} ${bpRange(m, false)}`.trim());
      notInCamp = true;
    }

    // STATUS — active LD or any Excuse-* (in camp, restricted).
    if (medStatusActive(m, dateIso) && m.status !== "MC" && m.status !== "Warded"
        && m.status !== "Pending" && m.status !== "NIL") {
      if (m.status === "LD") {
        const days = bpInclusiveDays(m);
        const label = days ? `${days}D LD` : "LD";
        out.status.push(`${rn} - ${label} ${bpRange(m, true)}`.trim());
      } else {
        // Excuse-* / custom: show the status text + range when dated.
        const range = bpRange(m, true);
        out.status.push(`${rn} - ${m.status}${range ? " " + range : ""}`.trim());
      }
    }

    // Warded → OTHERS (NOT IN CAMP).
    if (m.status === "Warded" && medStatusActive(m, dateIso)) {
      out.others.push(`${rn} - ${m.reason || "Warded"} (OTHERS (NOT IN CAMP))`.trim());
      notInCamp = true;
    }
  });

  // Medical appointments (MA) dated today → OTHERS. The stored `outOfCamp` bit
  // (set when booking, toggled live by the parade presence-tick) drives the
  // sub-type: out of camp → NOT IN CAMP (and subtracts from current strength);
  // in camp → OTHERS (IN CAMP), still present. Resolved appointments drop out.
  (STATE.appointments || []).forEach(a => {
    if (a.d4 !== r.id || a.resolved) return;
    if (displayDateToISO(a.date) !== dateIso) return;
    const outOfCamp = !!a.outOfCamp;
    const label = outOfCamp ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
    out.others.push(`${rn} - ${a.reason || "Appointment"} (${label})`.trim());
    if (outOfCamp) notInCamp = true;
  });

  // Dedupe each section by exact line first.
  BP_SECTIONS.forEach(k => { out[k] = [...new Set(out[k])]; });
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
function bpIsActive(r) {
  return r.status === "Active" || !r.status; // DECISIONS #33
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

  // Collect entries per section across all people.
  const buckets = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  people.forEach(r => {
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
  if (m.status === "MC" || m.status === "LD") {
    const days = bpInclusiveDays(m);
    return days ? `${days}D ${m.status}` : m.status;
  }
  return m.status;
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
function generateRSFormat(dateIso, time) {
  const reports = bpSickReports(dateIso);
  const lines = [`${bpDDMMYY(dateIso)} ${configGet("companyCoyCode")} ${configGet("unitCode")} ${bpTimeH(time)}`];
  lines.push(...bpSickUrtiBlocks(reports));
  return lines.join("\n\n");
}

// §10.2 — company-wide RSI personnel, broken by platoon. Only platoons (and HQ)
// with ≥1 report-sick entry are shown; TOTAL = sum across them.
function generateRSIPersonnel(dateIso, time) {
  const reports = bpSickReports(dateIso);
  const platoonOf = d4 => {
    const r = STATE.roster.find(x => x.id == d4);
    return r ? personPlatoon(r) : "";
  };
  // Group by platoon code.
  const byPlt = {};
  reports.forEach(m => { (byPlt[platoonOf(m.d4)] = byPlt[platoonOf(m.d4)] || []).push(m); });

  const lines = [`RSI PERSONNEL ${bpDDMMYY(dateIso)} ${bpTimeH(time)}`, `TOTAL: ${bp2(reports.length)} PAX`];
  // Natural order: platoons numeric, HQ last (activePlatoons order); only those
  // with entries. Any code not in activePlatoons (e.g. blank) appended at the end.
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

// Config tab (key/value rows) → object, mirroring the frontend normalizeConfig.
function bravesNormalizeConfig_(rows) {
  var out = {};
  (rows || []).forEach(function (r) {
    if (!r) return;
    var k = String(r.key || r.Key || "").trim();
    if (!k) return;
    var v = (r.value !== undefined ? r.value : (r.Value !== undefined ? r.Value : ""));
    out[k] = (typeof v === "string") ? v.trim() : v;
  });
  return out;
}

// Build the global STATE the ported generators read, from the live sheet tabs.
function bravesLoadState_() {
  STATE = {
    roster: bravesArr_(readTab("Roster")),
    medical: bravesArr_(readTab("Medical")),
    leave: bravesArr_(readTab("Leave")),
    appointments: bravesArr_(readTab("Appointments")),
    platoons: bravesArr_(readTab("Platoons")),
    config: bravesNormalizeConfig_(bravesArr_(readTab("Config")))
  };
}

function bravesTodayISO_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"); }
function bravesNowHHMM_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HHmm"); }
// Slot before noon → First Parade, else Last Parade.
function bravesSlotType_(slot) { var n = parseInt(String(slot).slice(0, 2), 10) || 0; return n < 12 ? "FP" : "LP"; }
// "0730,1730" → ["0730","1730"] (4-digit, zero-padded).
function bravesParseSlots_(cfg) {
  if (!cfg) return [];
  return String(cfg).split(",").map(function (s) {
    var d = String(s).replace(/[^\d]/g, "");
    while (d.length < 4) d = "0" + d;
    return d.slice(0, 4);
  }).filter(function (s) { return s.length === 4; });
}

function bravesEnsureArchiveTabs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabWithHeaders_(ss, BRAVES_PARADE_ARCHIVE_TAB, ["timestamp", "date", "slot", "type", "scope", "message"]);
  ensureTabWithHeaders_(ss, BRAVES_SICK_ARCHIVE_TAB, ["timestamp", "date", "slot", "format", "message"]);
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
function bravesArchiveSick_(dateIso, slot) {
  if (bravesAlreadyArchived_(BRAVES_SICK_ARCHIVE_TAB, dateIso, slot)) return null;
  bravesLoadState_();
  var msg = generateRSFormat(dateIso, slot);
  var row = { timestamp: new Date().toISOString(), date: dateIso, slot: String(slot), format: "RS", message: msg };
  appendMany(BRAVES_SICK_ARCHIVE_TAB, [row]);
  return row;
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
  if (kind === "parade" || kind === "both") out.parade = bravesArchiveParade_(dateIso, slot, body.type || bravesSlotType_(slot));
  if (kind === "sick" || kind === "both") out.sick = bravesArchiveSick_(dateIso, slot);
  return { ok: true, archived: out, date: dateIso, slot: slot };
}

// Time-driven poll (install via setupBravesArchive → 5-min trigger). Archives any
// configured slot whose time-of-day has passed today and isn't already recorded.
function archivePoll() {
  bravesEnsureArchiveTabs_();
  var now = bravesNowHHMM_(), dateIso = bravesTodayISO_();
  bravesParseSlots_(bravesNormalizeConfig_(bravesArr_(readTab("Config")))["archiveParadeTimes"]).forEach(function (slot) {
    if (slot <= now) bravesArchiveParade_(dateIso, slot, bravesSlotType_(slot));
  });
  bravesParseSlots_(bravesNormalizeConfig_(bravesArr_(readTab("Config")))["archiveSickTimes"]).forEach(function (slot) {
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
