/*
 * COUGAR COMPANY DATA SYSTEM — Google Apps Script Backend
 * ═══════════════════════════════════════════════════════
 * 
 * SETUP:
 * 1. Open your Google Sheet
 * 2. Go to Extensions → Apps Script
 * 3. Delete any existing code, paste this entire file
 * 4. Click Deploy → New deployment
 * 5. Type: Web app
 * 6. Execute as: Me
 * 7. Who has access: Anyone
 * 8. Click Deploy → copy the Web App URL
 * 9. Paste that URL into the frontend app's Settings
 *
 * SHEET TABS REQUIRED (create these with headers in Row 1):
 *   Roster:     id | name | plt | sect | status | conditions | notes
 *   Medical:    id | d4 | date | type | reason | status | duration | excuses | conductMissed
 *   Attendance: id | date | conduct | category | total | participating | px | rsi | fallout | cmdTotal | cmdParticipating | by
 *   IPPT:       id | d4 | attempt | date | pushups | situps | runTime | score
 *   RouteMarch: id | d4 | rmNum | date | time | avgHr | maxHr | pass
 *   SOC:        id | d4 | socNum | date | time | avgHr | pass
 *   PolarFlow:  id | d4 | conduct | date | avgHr | maxHr | minHr | z1 | z2 | z3 | z4 | z5 | calories | trainingLoad | recovery | duration | distance
 */

// ─── CORS + ROUTING ────────────────────────────────────

function doGet(e) {
  var output;
  try {
    var action = e.parameter.action || "readAll";
    var tab = e.parameter.tab || "";
    
    if (action === "readAll") {
      output = readAllTabs();
    } else if (action === "read" && tab) {
      output = readTab(tab);
    } else if (action === "ping") {
      output = { ok: true, sheets: getTabNames(), timestamp: new Date().toISOString() };
    } else {
      output = { error: "Unknown action. Use: readAll, read&tab=TabName, or ping" };
    }
  } catch (err) {
    output = { error: err.message };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var output;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || "write";
    var tab = body.tab || "";
    
    if (action === "write" && tab && body.data) {
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
      output = { error: "Invalid request. Need action + tab + data/row/rows" };
    }
  } catch (err) {
    output = { error: err.message };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── READ OPERATIONS ───────────────────────────────────

function getTabNames() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().map(function(s) { return s.getName(); });
}

function readTab(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { error: "Tab '" + tabName + "' not found", available: getTabNames() };
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return []; // Only headers or empty
  
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var rows = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = {};
    var hasData = false;
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        var val = data[i][j];
        // Convert dates to strings
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
    "PolarFlow": "polar"
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
  
  // Create tab if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  
  // Get headers from the first data object
  var headers = Object.keys(data[0]);
  
  // Clear existing content
  sheet.clear();
  
  // Write headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // Bold + freeze headers
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  
  // Write data rows
  var rows = data.map(function(obj) {
    return headers.map(function(h) {
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
  var newRow = headers.map(function(h) {
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
  var newRows = rows.map(function(rowData) {
    return headers.map(function(h) {
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
  var sheetRow = rowIndex + 2; // +1 for header, +1 for 1-indexed
  
  if (sheetRow > sheet.getLastRow()) {
    return { error: "Row index " + rowIndex + " out of range" };
  }
  
  var updatedRow = headers.map(function(h) {
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

// ─── UTILITY: Test from the script editor ──────────────

function testReadAll() {
  var result = readAllTabs();
  Logger.log(JSON.stringify(result, null, 2));
}

function testPing() {
  Logger.log(JSON.stringify({ tabs: getTabNames() }));
}