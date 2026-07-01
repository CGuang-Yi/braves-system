// ============================================================================
// SICK-HISTORY xlsx IMPORT — pure parser (Item 5)
// ============================================================================
// Parses the "Braves RSI/RSO REC Sheet" — a per-day grid where each recruit's
// medical status on a date is encoded by the CELL FILL COLOUR and the reason is
// the cell TEXT. Reverse-engineered from `Sanitised Braves RSI_RSO REC Sheet.xlsx`:
//
//   Row 1 (merged into row 2): A=S/N  B=FULL NAME  C=4D  D…=one column per day.
//     Day headers are Excel date-serials in the early columns (ExcelJS returns
//     them as JS Date) and DDMMYY *numbers* later (e.g. 240626, 10726=01 Jul 26).
//   Data rows: a coloured cell = that recruit had that status on that date; text
//     = the reason. A run of same-colour cells = a multi-day episode (text usually
//     only in the first cell, the rest blank-but-coloured). A white/empty cell
//     ends a run (white = "gap"). Some cells instead carry an explicit episode as
//     text, e.g. "2D LD (220626-230626)" / "3D EXCUSE HEAVY LOAD (170626-190626)".
//   The sheet embeds its own LEGEND near the bottom (rows 67–72 in the sample):
//     a filled swatch in col A + a label in col B (col C empty) — red=MC, yellow=LD,
//     green=EX(cuse), cyan="RS BUT NO STATUS", purple="SENT OUT", magenta="AL/OIL".
//
// This module is DOM-free and STATE-free so it can be unit-tested in Node with the
// same ExcelJS the browser loads from CDN. forms.js drives the file picker, the
// preview modal, and the commit (resolving 4Ds against STATE.roster + autoSync).
// The colour→status legend is DERIVED FROM THE SHEET at run time (robust to RGB
// drift between exports); SH_DEFAULT_LEGEND only fills gaps if no legend is found.
// ============================================================================

// Canonical status tokens used internally: MC | LD | EX | RS | SENT_OUT | ALOIL.
const SH_DEFAULT_LEGEND = {
  "FF0000": "MC",        // red
  "FFFF00": "LD",        // yellow
  "00FF00": "EX",        // green  (excuse)
  "00FFFF": "RS",        // cyan   (reported sick, no status yet)
  "9900FF": "SENT_OUT",  // purple (sent out of camp)
  "FF00FF": "ALOIL"      // magenta (AL / OIL → leave, not medical)
};
// Fills that never denote a status: cream = S/N + 4D structural columns; white =
// an intentional gap day inside/around an episode.
const SH_STRUCTURAL = new Set(["FFF2CC", "FFFFFF"]);

// Human labels for tokens (preview + legend display).
const SH_TOKEN_LABEL = {
  MC: "MC", LD: "LD", EX: "Excuse", RS: "Reported Sick (no status)",
  SENT_OUT: "Sent Out", ALOIL: "AL/OIL"
};

// argb fill → "RRGGBB" upper-hex, or null when the cell has no solid fill (theme/
// indexed colours aren't resolvable here → treated as "no status", logged upstream).
function shColourHex(cell) {
  const f = cell && cell.fill;
  if (!f || f.type !== "pattern" || f.pattern !== "solid") return null;
  const fg = f.fgColor || {};
  if (fg.argb) return String(fg.argb).slice(-6).toUpperCase();
  return null;
}

// A legend label string → canonical token (tolerant of wording).
function shLabelToToken(label) {
  const t = String(label || "").trim().toUpperCase();
  if (!t) return null;
  if (t === "MC") return "MC";
  if (t === "LD") return "LD";
  if (t.startsWith("EX")) return "EX";
  if (t === "RS" || t.indexOf("NO STATUS") !== -1) return "RS";
  if (t.indexOf("SENT") !== -1) return "SENT_OUT";
  if (t.indexOf("AL") !== -1 || t.indexOf("OIL") !== -1) return "ALOIL";
  return null;
}

// Scan for the embedded legend: rows with a coloured swatch in col A + a label in
// col B + an EMPTY col C (data rows always carry a 4D in col C, so this cleanly
// excludes them). Sheet-derived entries win over SH_DEFAULT_LEGEND.
function shDeriveLegend(ws) {
  const derived = {};
  ws.eachRow((row) => {
    const hex = shColourHex(row.getCell(1));
    const label = String(row.getCell(2).text || "").trim();
    const cText = String(row.getCell(3).text || "").trim();
    if (hex && label && !cText && !SH_STRUCTURAL.has(hex)) {
      const tok = shLabelToToken(label);
      if (tok) derived[hex] = tok;
    }
  });
  return Object.assign({}, SH_DEFAULT_LEGEND, derived);
}

// ── Date header decoding ────────────────────────────────────────────────────
// Excel 1900 date-system serial → ISO, accounting for the spreadsheet 1900-02-29
// bug (epoch is 1899-12-30).
function shSerialToISO(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.toISOString().slice(0, 10);
}
// "240626" → 2026-06-24; "10726" (leading zero eaten) → 2026-07-01.
function shDDMMYYtoISO(n) {
  const s = String(n).replace(/[^\d]/g, "").padStart(6, "0");
  if (s.length !== 6) return null;
  const dd = +s.slice(0, 2), mm = +s.slice(2, 4), yy = +s.slice(4, 6);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${2000 + yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
// A header cell → ISO. ExcelJS returns date-formatted cells as JS Date (UTC
// midnight); plain numbers are either a serial (40000–80000 ≈ 2009–2118) or a
// DDMMYY number — the ranges don't overlap, so the magnitude disambiguates.
function shCellToISO(cell) {
  const v = cell && cell.value;
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    return (v >= 20000 && v <= 80000) ? shSerialToISO(v) : shDDMMYYtoISO(v);
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[^\d.]/g, ""));
    if (!isNaN(n)) return shCellToISO({ value: n });
  }
  return null;
}

// Locate the S/N / NAME / 4D header columns (defaults A/B/C); day columns start
// right after 4D.
function shHeaderCols(ws) {
  let snCol = 1, nameCol = 2, d4Col = 3;
  const row = ws.getRow(1);
  for (let c = 1; c <= Math.min(10, ws.columnCount); c++) {
    const t = String(row.getCell(c).text || "").trim().toUpperCase();
    if (t === "S/N" || t === "SN") snCol = c;
    else if (t.indexOf("NAME") !== -1) nameCol = c;
    else if (t === "4D" || t.indexOf("4D") !== -1) d4Col = c;
  }
  return { snCol, nameCol, d4Col, firstDataCol: d4Col + 1 };
}

// colIndex → ISO map for every day column whose header resolves to a date.
function shBuildDateMap(ws, firstDataCol) {
  const map = {};
  const row = ws.getRow(1);
  for (let c = firstDataCol; c <= ws.columnCount; c++) {
    const iso = shCellToISO(row.getCell(c));
    if (iso) map[c] = iso;
  }
  return map;
}

// Explicit in-cell episode, e.g. "2D LD (220626-230626)" or
// "3D EXCUSE HEAVY LOAD (170626-190626)". Range is authoritative; status token is
// inferred from the leading keyword.
const SH_EXPLICIT_RE = /(\d+)\s*D\s+(.+?)\s*\((\d{5,6})\s*-\s*(\d{5,6})\)/i;
function shParseExplicit(text) {
  const m = String(text || "").match(SH_EXPLICIT_RE);
  if (!m) return null;
  const start = shDDMMYYtoISO(+m[3]), end = shDDMMYYtoISO(+m[4]);
  if (!start || !end) return null;
  const label = m[2].trim();
  const u = label.toUpperCase();
  let status = "LD";
  if (u.startsWith("MC")) status = "MC";
  else if (u.startsWith("LD")) status = "LD";
  else if (u.startsWith("EX")) status = "EX";
  return { status, reason: label, startDate: start, endDate: end, source: "text" };
}

// Parse one personnel row into episodes. Returns null for non-data rows (no 4D).
function shParsePersonRow(ws, rn, cols, dateMap, legend) {
  const row = ws.getRow(rn);
  // Strip the float artefact (".0") and any non-digit decoration, including a
  // leading "C" — padD4/resolveD4 downstream canonicalise the id, but the guard
  // below only accepts bare digits, so a preserved "C" (e.g. "C1411") would make
  // the whole person silently drop. Strip it here so C-prefixed 4Ds resolve.
  const fourD = String(row.getCell(cols.d4Col).text || "").trim().replace(/\.0$/, "").replace(/[^\d]/g, "");
  if (!/^\d{3,4}$/.test(fourD)) return null;
  const name = String(row.getCell(cols.nameCol).text || "").trim();
  const sn = String(row.getCell(cols.snCol).text || "").trim();
  const dateCols = Object.keys(dateMap).map(Number).sort((a, b) => a - b);

  const episodes = [];
  let run = null;
  const closeRun = () => { if (run) { episodes.push(run); run = null; } };

  for (const c of dateCols) {
    const cell = row.getCell(c);
    const iso = dateMap[c];
    const text = String(cell.text || "").trim();

    // Explicit "nD STATUS (range)" text wins — emit as its own episode and break
    // any in-progress colour run (its range is authoritative).
    const exp = text ? shParseExplicit(text) : null;
    if (exp) { closeRun(); episodes.push(exp); continue; }

    const hex = shColourHex(cell);
    const tok = (hex && !SH_STRUCTURAL.has(hex)) ? (legend[hex] || null) : null;
    if (!tok) { closeRun(); continue; }            // white/structural/uncoloured → gap

    if (run && run.status === tok) {
      run.endDate = iso;                            // extend the run
      if (!run.reason && text) run.reason = text;
    } else {
      closeRun();
      run = { status: tok, reason: text || "", startDate: iso, endDate: iso, source: "colour" };
    }
  }
  closeRun();
  return { fourD, name, sn, episodes };
}

// Full workbook → { cols, legend, dateMap, persons:[{fourD,name,sn,episodes}] }.
function shParseWorkbook(ws) {
  const cols = shHeaderCols(ws);
  const legend = shDeriveLegend(ws);
  const dateMap = shBuildDateMap(ws, cols.firstDataCol);
  const persons = [];
  ws.eachRow((row, rn) => {
    if (rn <= 2) return;                            // header (row 1 merged into row 2)
    const p = shParsePersonRow(ws, rn, cols, dateMap, legend);
    if (p && p.episodes.length) persons.push(p);
  });
  return { cols, legend, dateMap, persons };
}

// Map a status token + episode to the canonical Medical/Leave shape.
//   RS  → reported sick, in camp, outcome pending (type RSI, blank status)
//   SENT_OUT → reported sick & sent out (type RSO)
//   MC/LD → that status; EX → an "Excuse" status carrying the reason
//   ALOIL → a Leave row instead of a Medical row
const SH_STATUS_MAP = {
  MC:       { kind: "medical", type: "RSI", status: "MC" },
  LD:       { kind: "medical", type: "RSI", status: "LD" },
  EX:       { kind: "medical", type: "RSI", status: "Excuse" },
  RS:       { kind: "medical", type: "RSI", status: "" },
  SENT_OUT: { kind: "medical", type: "RSO", status: "" },
  ALOIL:    { kind: "leave",   type: "AL/OIL" }
};

// An "EX" episode only carries the generic "Excuse" bucket — the sheet's colour
// legend has no separate swatch per excuse subtype, so the subtype (if any) only
// survives in the free-text reason (e.g. "EX PT", from shParseExplicit's label).
// Promote to the granular "Excuse PT" when the reason says so, so this bulk-import
// path disqualifies PT-excuse days from HA credit the same way the manual
// submitMedical form does (haStatusDisqualifies() matches the exact string
// "Excuse PT" — see helpers.js:1122 and braves-ha-pr20-followups memory).
function shExcuseStatus(reason) {
  return /\bPT\b/i.test(reason || "") ? "Excuse PT" : "Excuse";
}

// Episodes → canonical rows. ctx supplies the environment-specific bits so this
// stays pure: { resolveD4(raw)->canonicalD4|null, makeMedId(), makeLeaveId(),
// toDisplay(iso)->displayDate }. Unmatched 4Ds are returned (never silently
// dropped) so the preview can surface them.
function shEpisodesToRows(persons, ctx) {
  const medical = [], leave = [], unmatched = [];
  persons.forEach(p => {
    const d4 = ctx.resolveD4(p.fourD);
    if (!d4) { unmatched.push(p); return; }
    p.episodes.forEach(ep => {
      const map = SH_STATUS_MAP[ep.status] || { kind: "medical", type: "RSI", status: ep.status };
      const sD = ctx.toDisplay(ep.startDate), eD = ctx.toDisplay(ep.endDate);
      if (map.kind === "leave") {
        leave.push({ id: ctx.makeLeaveId(), d4, type: "AL/OIL", startDate: sD, endDate: eD, days: "", reason: ep.reason || "AL/OIL", isInCamp: false, isInCampReviewed: false });
      } else {
        medical.push({
          id: ctx.makeMedId(), d4, date: sD, type: map.type,
          status: ep.status === "EX" ? shExcuseStatus(ep.reason) : map.status,
          reason: ep.reason || "", startDate: sD, endDate: eD,
          urtiType: "", mrTiming: "", visitId: ""
        });
      }
    });
  });
  return { medical, leave, unmatched };
}
