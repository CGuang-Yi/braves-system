/*
 * COUGAR COMPANY DATA SYSTEM — Google Apps Script Backend
 * ═══════════════════════════════════════════════════════
 *
 * AUTH MODEL
 * ──────────
 * The script enforces token-based auth for all data operations. Two token types
 * live in PropertiesService:
 *
 *   invite:<token>  →  Two shapes:
 *     SINGLE-USE: {used, createdAt, usedAt?, issuedAuthToken?}
 *       • Mint via generateInvite(). Consumed on first click.
 *     BULK (multi-use): {maxUses, usedCount, redemptions[], createdAt, expiresAt?}
 *       • Mint via generateBulkInvite(maxUses, expiresInDays). Share ONE link
 *         with a whole team — each click issues a separate per-device auth
 *         token. Self-disables when cap or expiry is hit. Audit with
 *         bulkInviteStatus(token); kill with revokeInvite(token).
 *
 *   auth:<token>    →  {issuedAt, fromInvite}
 *     • Long-lived. Stored in the user's browser localStorage. Sent with every
 *       data request. Revoke with revokeAuthToken().
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
 *               leaveQuota
 *               (the column may be named "4d" or "id" — the frontend mirrors
 *                whichever is present into r.id at pull time. height in cm,
 *                weight in kg — BMI is computed client-side. role ∈
 *                {"Recruit", "Commander"} (defaults to Recruit if blank).
 *                Commanders use 4D 0001–0099, are never displayed in the
 *                UI by id — their rank+name shows instead. rank is free
 *                text ("3SG", "2LT", "CPT", "MSG"); leaveQuota is the
 *                off-in-lieu day cap (numeric, optional for recruits).)
 *   Medical:    id | d4 | date | reason | status | startDate | endDate
 *               (Each row represents a "report sick" event — `date` is the
 *                date the recruit reported sick. status ∈ {MC, Warded, LD,
 *                RMJ, Excuse Heavy Load, Excuse Kneeling, Excuse Squatting,
 *                Excuse Uniform, Excuse RMJ, Excuse Swimming,
 *                Excuse Prolonged Standing, Excuse Upper Limb,
 *                Excuse Lower Limb, Pending, NIL}.
 *                NIL = MO saw the recruit and cleared them with no status.
 *                startDate/endDate are display-format dates ("16 May 2026")
 *                and BOTH ENDS ARE INCLUSIVE. Pending and NIL may have no
 *                startDate/endDate. After endDate, MC and LD get a 2-day
 *                "ghost" tag (MC+1, MC+2, LD+1, LD+2) computed client-side
 *                — not stored.)
 *   Attendance: id | date | conduct | total | participating | lms | px | fallout | remarks
 *               (RSI removed from summary — morning report-sicks belong in
 *                the Medical log, not duplicated per-conduct. Legacy `rsi`
 *                column may still exist on older sheets; safe to delete.)
 *               (lms = how many of the participating recruits attended LMS for this conduct;
 *                LMS participation rate = lms / participating, computed client-side)
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
 *   Appointments: id | d4 | reason | date | time | location
 *               (Booked future events — medical specialist visits, IPPT
 *                retakes, board appearances, etc. Sheet keeps full history;
 *                dashboard only shows entries where date >= today. date is
 *                display-format ("16 May 2026"); time is free text ("0930").)
 *
 *   Leave:      id | d4 | type | startDate | endDate | days | reason
 *               (Personnel absences. type ∈ {Leave, Off-in-Lieu, Weekend,
 *                Night's Out, Course, Guard Duty, NDP, Other}. Only
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
    } else if (!isValidAuth(auth)) {
      output = { error: "Unauthorized — invite required", code: 401 };
    } else if (action === "readAll") {
      output = readAllTabs();
    } else if (action === "read" && tab) {
      output = readTab(tab);
    } else {
      output = { error: "Unknown action. Use: readAll, read&tab=TabName, or ping" };
    }
  } catch (err) {
    output = { error: err.message };
  }

  return jsonResponse(output);
}

function doPost(e) {
  var output;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || "write";
    var tab = body.tab || "";
    var auth = body.auth || "";

    // Public action: redeem a single-use invite token in exchange for an auth token.
    if (action === "redeemInvite") {
      output = redeemInvite(body.token);
    } else if (!isValidAuth(auth)) {
      output = { error: "Unauthorized — invite required", code: 401 };
    } else if (action === "write" && tab && body.data) {
      output = writeTab(tab, body.data);
    } else if (action === "append" && tab && body.row) {
      output = appendRow(tab, body.row);
    } else if (action === "appendMany" && tab && body.rows) {
      output = appendMany(tab, body.rows);
    } else if (action === "deleteRow" && tab && body.rowIndex !== undefined) {
      output = deleteRow(tab, body.rowIndex);
    } else if (action === "updateRow" && tab && body.rowIndex !== undefined && body.row) {
      output = updateRow(tab, body.rowIndex, body.row);
    } else if (action === "sendEmail") {
      output = sendEmailHelper(body);
    } else if (action === "getEmailInfo") {
      // All three Apps Script calls below require OAuth scopes that aren't
      // granted by default. Wrap each so the missing-scope case shows a
      // clear, actionable message instead of crashing the whole modal.
      var senderEmail = "";
      try { senderEmail = Session.getEffectiveUser().getEmail(); } catch (e) { /* no userinfo.email scope */ }
      if (!senderEmail) {
        try { senderEmail = Session.getActiveUser().getEmail(); } catch (e) { /* no userinfo.email scope */ }
      }
      var remainingQuota = null, quotaError = null;
      try {
        remainingQuota = MailApp.getRemainingDailyQuota();
      } catch (e) {
        quotaError = "Email scope not granted yet — grant the script.send_mail permission to enable sending.";
      }
      output = {
        senderEmail: senderEmail || "",
        remainingQuota: remainingQuota,
        quotaError: quotaError
      };
    } else if (action === "analyzePhoto") {
      output = analyzePhotoHelper(body);
    } else {
      output = { error: "Invalid request" };
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
    "Recruit 4D numbers are exactly 4 digits (e.g. 1101, 4213). Valid recruit 4Ds in this company: " + validD4s.join(", ") + ". " +
    "If you see a 4D that's NOT in this list, ignore it (it's a misread).\n\n" +
    "Respond ONLY with a JSON object, no markdown fences, no explanation outside the JSON:\n" +
    "{\n" +
    "  \"recruits\": [\n" +
    "    {\"d4\": \"1108\", \"avgHR\": 155, \"maxHR\": 185, \"calories\": 420, \"duration\": 25},\n" +
    "    ...\n" +
    "  ],\n" +
    "  \"notes\": \"optional one-line observation (e.g. 'image blurry on bottom 3 rows', or empty string)\"\n" +
    "}\n\n" +
    "Numbers should be integers (no units, no 'bpm' text). If a field isn't visible for a row, omit that key from that row's object. " +
    "If you can't read any data at all, return { \"recruits\": [], \"notes\": \"no Polar data detected\" }.";

  var payload = {
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: body.imageBase64 } },
        { type: "text", text: "Extract every recruit row from this Polar class summary." }
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
    return { recruits: parsed.recruits, notes: parsed.notes || "" };
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

// ─── READ OPERATIONS ───────────────────────────────────

function getTabNames() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().map(function (s) { return s.getName(); });
}

function readTab(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found", available: getTabNames() };

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0].map(function (h) { return String(h).trim(); });
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    var hasData = false;
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        var val = data[i][j];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), "dd MMM yyyy");
        }
        row[headers[j]] = val;
        if (val !== "" && val !== null && val !== undefined) hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }

  return rows;
}

function readAllTabs() {
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
    "Conducts": "conducts"
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

function appendRow(tabName, rowData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found" };

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var newRow = headers.map(function (h) {
    var val = rowData[String(h).trim()];
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

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var newRows = rows.map(function (rowData) {
    return headers.map(function (h) {
      var val = rowData[String(h).trim()];
      return val !== undefined && val !== null ? val : "";
    });
  });

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);

  return {
    ok: true,
    tab: tabName,
    rowsAppended: newRows.length,
    timestamp: new Date().toISOString()
  };
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
