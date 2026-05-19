/*
 * COUGAR COMPANY DATA SYSTEM — Google Apps Script Backend
 * ═══════════════════════════════════════════════════════
 *
 * AUTH MODEL
 * ──────────
 * The script enforces token-based auth for all data operations. Two token types
 * live in PropertiesService:
 *
 *   invite:<token>  →  {used, createdAt, usedAt?, issuedAuthToken?}
 *     • Single-use. You (the admin) mint these via generateInvite() from the
 *       editor and send the resulting URL to a user. They click once → the
 *       token is consumed → the user's device gets an auth token.
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
 *   Roster:     4d | name | age | status | conditions | notes | phone | email |
 *               ration | allergies | msk | highest education level |
 *               motorcycle license | height | weight
 *               (the column may be named "4d" or "id" — the frontend mirrors
 *                whichever is present into r.id at pull time. height in cm,
 *                weight in kg — BMI is computed client-side.)
 *   Medical:    id | d4 | date | reason | status | startDate | endDate
 *               (status ∈ {MC, Warded, LD, RMJ, Excuse Heavy Load,
 *                Excuse Kneeling, Excuse Squatting, Excuse Uniform,
 *                Excuse RMJ, Pending}. startDate/endDate are display-format
 *                dates ("16 May 2026") and BOTH ENDS ARE INCLUSIVE.
 *                Pending may have no endDate.
 *                After endDate, MC and LD get a 2-day "ghost" tag (MC+1,
 *                MC+2, LD+1, LD+2) computed client-side — not stored.)
 *   Attendance: id | date | conduct | total | participating | lms | px | rsi | fallout | remarks | by
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

function redeemInvite(inviteToken) {
  if (!inviteToken) return { error: "Missing invite token" };
  var props = PropertiesService.getScriptProperties();
  var key = "invite:" + inviteToken;
  var raw = props.getProperty(key);
  if (!raw) return { error: "Invalid invite link" };

  var invite = JSON.parse(raw);
  if (invite.used) return { error: "This invite has already been used" };

  var authToken = Utilities.getUuid();
  var now = new Date().toISOString();

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
    "ConductDetail": "conductDetail"
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
