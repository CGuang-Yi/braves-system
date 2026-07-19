// In-memory mock of the Google Apps Script services the sync backend uses, with
// a faithful-enough Sheets model (a sheet = 2-D grid, row 0 = headers) so the
// REAL apps-script-Code.gs read/write/lock/rev functions run unmodified.
//
// makeGoogle() returns { services, db }:
//   services — the globals injected into the backend sandbox (SpreadsheetApp, …)
//   db       — test helpers: seed(tab,headers,rows), rowsOf(tab), props, spy

function makeGoogle() {
  const props = new Map();        // ScriptProperties
  const sheets = new Map();       // name -> { name, grid: any[][] }
  // getProperty/getProperties counters (P2-2): let tests assert getAllRevs
  // makes exactly ONE bulk getProperties() call and ZERO per-key getProperty()
  // calls, instead of the old REV_TABS.length individual reads.
  const spy = { getDisplayValues: 0, getValues: 0, getProperty: 0, getProperties: 0 };

  function makeRange(sheet, r, c, nr, nc) {
    return {
      getValues() {
        spy.getValues++;
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = sheet.grid[r - 1 + i] || [];
          const o = [];
          for (let j = 0; j < nc; j++) {
            const v = row[c - 1 + j];
            o.push(v === undefined ? "" : v);
          }
          out.push(o);
        }
        return out;
      },
      getDisplayValues() {
        spy.getDisplayValues++;
        return this.getValues().map(row => row.map(v =>
          v instanceof Date ? "DISP(" + v.getTime() + ")" : (v === "" || v == null ? "" : String(v))
        ));
      },
      setValues(vals) {
        for (let i = 0; i < vals.length; i++) {
          const ri = r - 1 + i;
          while (sheet.grid.length <= ri) sheet.grid.push([]);
          const row = sheet.grid[ri];
          for (let j = 0; j < (vals[i] ? vals[i].length : 0); j++) {
            const ci = c - 1 + j;
            while (row.length <= ci) row.push("");
            row[ci] = vals[i][j];
          }
        }
        return this;
      },
      setFontWeight() { return this; },
      // Record per-column number format so tests can assert coercion-prone columns
      // (e.g. Attendance.participants) are forced to plain text ("@"). The mock's
      // setValues stores strings verbatim and does NOT simulate Sheets' real
      // numeric coercion, so this records intent, not an emulated round-trip.
      setNumberFormat(fmt) {
        sheet.numberFormats = sheet.numberFormats || {};
        for (let j = 0; j < nc; j++) sheet.numberFormats[c + j] = fmt;
        return this;
      }
    };
  }

  function makeSheet(sheet) {
    return {
      getName() { return sheet.name; },
      getLastRow() { return sheet.grid.length; },
      getLastColumn() { return sheet.grid.reduce((m, row) => Math.max(m, row.length), 0); },
      getRange(r, c, nr, nc) {
        return makeRange(sheet, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
      },
      getDataRange() {
        return makeRange(sheet, 1, 1, Math.max(1, sheet.grid.length), Math.max(1, this.getLastColumn()));
      },
      appendRow(arr) { sheet.grid.push(arr.slice()); return this; },
      deleteRow(i) { sheet.grid.splice(i - 1, 1); return this; },
      getMaxRows() { return Math.max(1000, sheet.grid.length); },
      clear() { sheet.grid = []; sheet.numberFormats = {}; return this; },
      setFrozenRows() { return this; }
    };
  }

  const spreadsheet = {
    getName() { return "MockSheet"; },
    getSheetByName(n) { const s = sheets.get(n); return s ? makeSheet(s) : null; },
    getSheets() { return [...sheets.values()].map(makeSheet); },
    insertSheet(n) { const s = { name: n, grid: [] }; sheets.set(n, s); return makeSheet(s); }
  };

  const scriptProps = {
    getProperty: k => { spy.getProperty++; return props.has(k) ? props.get(k) : null; },
    setProperty: (k, v) => { props.set(k, String(v)); return scriptProps; },
    getProperties: () => { spy.getProperties++; const o = {}; props.forEach((v, k) => (o[k] = v)); return o; },
    deleteProperty: k => { props.delete(k); return scriptProps; },
    getKeys: () => [...props.keys()]
  };

  // One shared no-op lock object. Braves' getDataLock() prefers getDocumentLock()
  // (so data writes don't block on the Telegram poller's script lock); provide
  // both so the REAL withRevLock / onEditBumpRev run unmodified.
  const lock = { waitLock: () => true, tryLock: () => true, releaseLock: () => {} };

  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => scriptProps },
    LockService: { getScriptLock: () => lock, getDocumentLock: () => lock },
    Session: {
      getScriptTimeZone: () => "Asia/Singapore",
      getEffectiveUser: () => ({ getEmail: () => "test@example.com" }),
      getActiveUser: () => ({ getEmail: () => "test@example.com" })
    },
    Utilities: {
      formatDate: (d, tz, fmt) => (fmt === "HH:mm" ? "07:30" : "01 Jan 2026"),
      getUuid: () => "uuid-" + Math.random().toString(36).slice(2),
      newBlob: () => ({}),
      base64Decode: () => [],
      // hashPassword()/handleLogin (P2-3 tests need real login round trips) call
      // Utilities.computeDigest(SHA_256, salt+password) and mask each byte with
      // `& 0xFF` — a real (unsigned 0-255) Node sha256 digest satisfies that
      // masking identically to Apps Script's signed-byte digest, so this doesn't
      // need to match Apps Script's exact byte representation, only be internally
      // consistent (same mock hashes on both create + verify).
      computeDigest: (algorithm, input) => [...require("crypto").createHash("sha256").update(String(input)).digest()],
      DigestAlgorithm: { SHA_256: "SHA_256" }
    },
    ContentService: {
      createTextOutput: s => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }),
      MimeType: { JSON: "json" }
    },
    Logger: { log() {} },
    // Stubs for services the sync paths never invoke (present so incidental refs
    // in unrelated branches don't ReferenceError if ever reached).
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger: () => ({ forSpreadsheet: () => ({ onEdit: () => ({ create() {} }) }) })
    },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail() {} },
    UrlFetchApp: { fetch: () => ({ getContentText: () => "{}", getResponseCode: () => 200 }) }
  };

  const db = {
    seed(tab, headers, rows) {
      sheets.set(tab, { name: tab, grid: [headers.slice(), ...(rows || []).map(r => r.slice())] });
    },
    // Data rows of a tab as objects keyed by header — for assertions.
    rowsOf(tab) {
      const s = sheets.get(tab);
      if (!s || s.grid.length < 2) return [];
      const h = s.grid[0];
      return s.grid.slice(1).map(r => { const o = {}; h.forEach((k, i) => (o[k] = r[i])); return o; });
    },
    hasSheet(tab) { return sheets.has(tab); },
    // The number format string recorded for a 1-based column of a tab (or null).
    numberFormat(tab, col1Based) {
      const s = sheets.get(tab);
      return s && s.numberFormats ? (s.numberFormats[col1Based] || null) : null;
    },
    setProp(k, v) { props.set(k, String(v)); },
    getProp(k) { return props.has(k) ? props.get(k) : null; },
    spy
  };

  return { services, db };
}

module.exports = { makeGoogle };
