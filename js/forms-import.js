// CSV importers: IPPT, SOC, Polar Flow, and the spec-§14 conduct attendance CSV.
//
// Split out of the original monolithic forms.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// ─── CSV IMPORTERS ─────────────────────────────────────

// Fix 16: the row-building half of the IPPT import, split out of importIPPT so it
// can be unit-tested without a file input or PapaParse. Returns the records to
// WRITE — each either a brand-new row or an existing row's id carrying fresh
// field values, keyed on 4D+attempt so re-importing an overlapping CSV updates a
// recruit's history instead of duplicating it. A blank Attempt can't serve as a
// key (colNum yields 0 for blank, and every blank would then collide with every
// other blank), so those always append.
// The key also has to hold WITHIN the batch: STATE.ippt isn't mutated until the
// caller applies the records, so two CSV lines for the same 4D+Attempt would
// otherwise both miss the lookup and append (two rows for one attempt), or both
// take the same existing id and fire two upserts for it (one line silently lost
// while the alert counts both). Later line wins, mirroring the re-import rule.
function ipptUpsertRows(rows) {
  const records = [];
  const byKey = {};          // "d4|attempt" → index in records (blank attempt never keys)
  const uncalculated = [];   // 4Ds imported with a blank score we couldn't derive
  let autoScored = 0;
  rows.forEach(row => {
    // padD4 up front so the stored id and the roster lookup canonicalize the
    // same way — a "123"/"C0123" CSV id otherwise renders blank (no roster
    // join) until the next server pull re-pads the layer.
    const d4 = padD4(col(row, "4D", "id"));
    const attempt = colNum(row, "Attempt", "#", "attempt");
    const pushupsRaw = col(row, "Push-ups", "Pushups", "PU", "push-ups");
    const situpsRaw = col(row, "Sit-ups", "Situps", "SU", "sit-ups");
    const runTime = col(row, "2.4km", "Run", "RunTime", "run time", "2.4");
    const rawScore = col(row, "Score", "Total", "Total Score", "score");
    const pushups = +pushupsRaw || 0;
    const situps = +situpsRaw || 0;
    // A CSV "0" is a real score (YTT/Fail) and is kept verbatim. A blank OR
    // non-numeric placeholder ("N/A", "-", "TBC") is treated as no-score and
    // falls through to auto-calc rather than being coerced to a bogus 0.
    const hasScore = String(rawScore).trim() !== "" && Number.isFinite(+rawScore);
    let score;
    if (hasScore) {
      score = +rawScore;
    } else {
      // Auto-calc only when the roster age AND all three stations are present.
      // A blank station coerces to 0 reps, which calculateIPPTScore happily
      // scores (lookupRepScore never returns null for low reps) — that would
      // silently understate the total instead of reporting it uncalculable.
      const stationsComplete = [pushupsRaw, situpsRaw, runTime].every(v => String(v).trim() !== "");
      const person = STATE.roster.find(x => x.id === d4);
      const result = (person?.age && stationsComplete) ? calculateIPPTScore(person.age, pushups, situps, runTime) : null;
      if (result) { score = result.total; autoScored++; }
      else { score = ""; uncalculated.push(d4); }
    }
    const key = attempt ? d4 + "|" + attempt : "";
    const dupIdx = key && key in byKey ? byKey[key] : -1;
    const existing = attempt
      ? (STATE.ippt || []).find(i => i.d4 === d4 && String(i.attempt) === String(attempt))
      : null;
    const rec = {
      // A repeat within this batch keeps the id already assigned to it, so the
      // pair collapses into ONE row rather than burning a second id.
      id: dupIdx >= 0 ? records[dupIdx].id : (existing ? existing.id : nextId()),
      d4, attempt, date: col(row, "Date", "date"), pushups, situps, runTime, score
    };
    if (dupIdx >= 0) { records[dupIdx] = rec; return; }
    if (key) byKey[key] = records.length;
    records.push(rec);
  });
  return { records, autoScored, uncalculated };
}

function importIPPT(input) {
  Papa.parse(input.files[0], { header: true, skipEmptyLines: true, complete: r => {
    // Score is optional: when the cell is blank we derive it from the reps/run
    // time + roster age via the same calculateIPPTScore() the manual form uses.
    const missing = checkCols(r.meta.fields, ["4D"]);
    if (missing.length) { alert("CSV missing required column: " + missing.join(", ") + "\n\nExpected: 4D, Attempt, Date, Push-ups, Sit-ups, 2.4km, Score\n(Score is optional — auto-calculated from stations + roster age when blank.)"); return; }
    const { records, autoScored, uncalculated } = ipptUpsertRows(r.data);
    // Apply locally: overwrite the row an upsert matched, append the rest.
    records.forEach(rec => {
      const idx = STATE.ippt.findIndex(i => i.id === rec.id);
      if (idx >= 0) STATE.ippt[idx] = rec; else STATE.ippt.push(rec);
    });
    saveLocal(); render();
    // Fix 16: THIS is what was missing. Without it the imported rows lived only
    // in localStorage and were wiped by the next full pull — the import looked
    // like it had worked because render() showed them. autoSync is the single
    // write chokepoint; it queues per tab, strictly FIFO, so a large import
    // lands as an ordered series of OCC-guarded upserts rather than one racy
    // batch that could interleave with another device's write.
    if (STATE.apiUrl) records.forEach(rec => autoSync("IPPT", { type: "upsert", row: rec }));
    let msg = `Imported ${records.length} IPPT rows`;
    if (autoScored) msg += ` (${autoScored} auto-scored)`;
    msg += ".";
    if (uncalculated.length) msg += `\n\n${uncalculated.length} row(s) had no score and couldn't be auto-calculated (age missing from roster or incomplete stations):\n${uncalculated.join(", ")}`;
    msg += "\n\nSyncing to sheet — check the sync indicator.";
    alert(msg);
  } }); input.value = "";
}

// Feature 23: SOC import, mirroring the IPPT pair above. `time` is a DURATION in
// MM:SS (not a clock time) — the sheet schema and socDurationParts both treat it
// that way, so it is stored verbatim and rendered through the same
// socDurationDisplay the manual form uses. Upsert key is 4D+socNum; a blank
// socNum always appends. Unknown 4Ds are imported but collected and reported, so
// a mistyped id is visible instead of silently joining to nobody.
// Same in-batch collapse as ipptUpsertRows — see the note there.
function socUpsertRows(rows) {
  const records = [];
  const byKey = {};          // "d4|socNum" → index in records (blank socNum never keys)
  const unmatched = [];
  rows.forEach(row => {
    const d4 = padD4(col(row, "4D", "id"));
    if (!(STATE.roster || []).some(x => x.id === d4)) unmatched.push(d4);
    const socNum = colNum(row, "SOC", "SOC #", "SOC#", "socNum", "soc");
    const key = socNum ? d4 + "|" + socNum : "";
    const dupIdx = key && key in byKey ? byKey[key] : -1;
    const existing = socNum
      ? (STATE.soc || []).find(s => s.d4 === d4 && String(s.socNum) === String(socNum))
      : null;
    const rec = {
      id: dupIdx >= 0 ? records[dupIdx].id : (existing ? existing.id : nextId()),
      d4, socNum,
      date: col(row, "Date", "date"),
      time: String(col(row, "Time", "time", "Duration", "Completion Time") || "").trim(),
      avgHr: colNum(row, "Avg HR", "AvgHR", "avg_hr", "Average HR", "Heart Rate"),
      pass: col(row, "Pass", "pass", "Result", "Status") || "Y"
    };
    if (dupIdx >= 0) { records[dupIdx] = rec; return; }
    if (key) byKey[key] = records.length;
    records.push(rec);
  });
  return { records, unmatched };
}

function importSOC(input) {
  Papa.parse(input.files[0], { header: true, skipEmptyLines: true, complete: r => {
    const missing = checkCols(r.meta.fields, ["4D"]);
    if (missing.length) { alert("CSV missing required column: 4D\n\nExpected: 4D, SOC, Date, Time, Avg HR, Pass\n(Time is a duration in MM:SS, not a clock time.)"); return; }
    const { records, unmatched } = socUpsertRows(r.data);
    records.forEach(rec => {
      const idx = STATE.soc.findIndex(s => s.id === rec.id);
      if (idx >= 0) STATE.soc[idx] = rec; else STATE.soc.push(rec);
    });
    saveLocal(); render();
    if (STATE.apiUrl) records.forEach(rec => autoSync("SOC", { type: "upsert", row: rec }));
    let msg = `Imported ${records.length} SOC rows.`;
    // [...new Set()] rather than Array.from — the isolated test sandbox these
    // importers load into does not expose the Array global.
    if (unmatched.length) msg += `\n\n${unmatched.length} row(s) reference a 4D not in the roster (imported anyway, but they won't join to a person):\n${[...new Set(unmatched)].join(", ")}`;
    msg += "\n\nSyncing to sheet — check the sync indicator.";
    alert(msg);
  } }); input.value = "";
}
// Normalize a free-text date string to the app's display format ("17 May 2026")
// so CSV-imported rows match form-entered rows on the date half of any
// (date, conductId) join. Round-trips through displayDateToISO + isoToDisplayDate
// — if the input is unparseable, falls back to the raw string.
function normalizeDateToDisplay(raw) {
  if (!raw) return "";
  const iso = displayDateToISO(raw);
  if (iso) return isoToDisplayDate(iso);
  // Try direct Date parsing (e.g. ISO "2026-05-17" not caught by displayDateToISO).
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const displayed = isoToDisplayDate(`${yyyy}-${mm}-${dd}`);
    if (displayed) return displayed;
  }
  return raw;
}

// Holds an in-flight CSV polar import while the user resolves any unknown
// conduct names. Each entry: { rawRows: [parsed CSV rows], unknownConducts:
// [{name, count}], rawConductByRowIdx: [conductName per row] }.
let _polarImportPending = null;

function importPolar(input) {
  Papa.parse(input.files[0], { header: true, skipEmptyLines: true, complete: r => {
    const missing = checkCols(r.meta.fields, ["4D"]);
    if (missing.length) { alert("CSV missing required column: 4D"); return; }
    // Pre-resolve each row's conduct against the registry. Group unknowns by
    // normalized key so the modal only asks the user once per distinct name.
    const rawRows = r.data;
    const rawConductByRowIdx = rawRows.map(row => col(row, "Conduct", "Activity", "conduct", "Exercise") || "");
    const unknownsByKey = new Map(); // key -> {name (canonical raw), count}
    rawConductByRowIdx.forEach(name => {
      if (!name) return;
      if (conductIdByName(name)) return;
      const key = normalizeConductKey(name);
      if (!unknownsByKey.has(key)) unknownsByKey.set(key, { name, count: 0 });
      unknownsByKey.get(key).count++;
    });
    const unknownConducts = [...unknownsByKey.values()].sort((a, b) => b.count - a.count);

    _polarImportPending = { rawRows, rawConductByRowIdx, unknownConducts };
    if (unknownConducts.length > 0) {
      openUnknownPolarConductsModal();
    } else {
      finalizePolarImport({});
    }
  } }); input.value = "";
}

// Modal: for each conduct name in the CSV that doesn't match the registry,
// ask the user to either (a) merge into an existing conduct, or (b) create
// a new conduct with this name. Maps are keyed by normalized name so the
// finalize step can look up every row's resolution in one pass.
function openUnknownPolarConductsModal() {
  const { unknownConducts } = _polarImportPending;
  const opts = getAllConducts();
  openModal(`Resolve ${unknownConducts.length} new conduct${unknownConducts.length === 1 ? "" : "s"} from CSV`, `
    <p style="font-size:12px;color:var(--muted);margin-bottom:12px">
      The CSV uses conduct names that aren't in your registry yet. For each one, pick an
      existing conduct to merge it into, or create a new conduct with this name.
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow-y:auto">
      ${unknownConducts.map((u, i) => `
        <div class="card" style="padding:8px 12px;background:var(--surface2)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px">
            <code style="font-family:var(--mono);font-size:12px;color:var(--text)">"${escapeAttr(u.name)}"</code>
            <span style="font-size:11px;color:var(--muted)">${u.count} row${u.count === 1 ? "" : "s"}</span>
          </div>
          <select id="polar-resolve-${i}" data-key="${escapeAttr(normalizeConductKey(u.name))}" style="width:100%;padding:5px 8px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px">
            <option value="__new__" selected>+ Create new conduct: "${escapeAttr(u.name)}"</option>
            ${opts.map(c => `<option value="${c.id}">→ Merge into "${escapeAttr(c.name)}"</option>`).join("")}
          </select>
        </div>
      `).join("")}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn" onclick="cancelPolarImport()">Cancel import</button>
      <button class="btn btn-success" onclick="confirmPolarConductResolutions()">Continue import</button>
    </div>
  `);
}

function cancelPolarImport() {
  _polarImportPending = null;
  closeModal();
}

function confirmPolarConductResolutions() {
  const { unknownConducts } = _polarImportPending;
  // Build keyResolutions: normalizeConductKey(unknown) → conductId
  const keyResolutions = {};
  unknownConducts.forEach((u, i) => {
    const sel = document.getElementById(`polar-resolve-${i}`);
    if (!sel) return;
    const key = sel.dataset.key;
    if (sel.value === "__new__") {
      keyResolutions[key] = createConduct(u.name);
    } else {
      keyResolutions[key] = sel.value;
    }
  });
  closeModal();
  finalizePolarImport(keyResolutions);
}

// Walks the staged rows and pushes them onto STATE.polar with resolved
// conductIds + normalized dates. keyResolutions covers the unknowns;
// the rest resolve directly via the registry.
function finalizePolarImport(keyResolutions) {
  const { rawRows, rawConductByRowIdx } = _polarImportPending;
  const insertedRows = [];
  rawRows.forEach((row, idx) => {
    const rawConduct = rawConductByRowIdx[idx];
    const conductId = conductIdByName(rawConduct) || keyResolutions[normalizeConductKey(rawConduct)] || "";
    const entry = {
      id: nextId(),
      d4: col(row, "4D", "id"),
      conductId,
      date: normalizeDateToDisplay(col(row, "Date", "date")),
      avgHr: colNum(row, "Avg HR", "AvgHR", "avg_hr", "Average HR"),
      maxHr: colNum(row, "Max HR", "MaxHR", "max_hr"),
      minHr: colNum(row, "Min HR", "MinHR", "min_hr"),
      calories: colNum(row, "Calories", "Cal", "calories", "Energy"),
      trainingLoad: colNum(row, "Training Load", "TrainingLoad", "training_load", "Load"),
      duration: colNum(row, "Duration", "duration", "Time", "Dur"),
      distance: colNum(row, "Distance", "distance", "Dist")
    };
    STATE.polar.push(entry);
    insertedRows.push(entry);
  });
  _polarImportPending = null;
  const lmsChanged = recomputeAttendanceLmsFromPolar();
  saveLocal(); render();
  // Auto-push the new rows. Previously the user had to navigate to PolarFlow
  // tab and click Push to Sheet manually — exactly the kind of tab-switching
  // this redesign eliminates.
  if (STATE.apiUrl && insertedRows.length) {
    autoSync("PolarFlow", { type: "appendMany", rows: insertedRows });
    // If LMS counts on attendance changed, push ONLY those rows via id-based
    // upsert. A full-tab replace here would clobber any concurrent attendance
    // edits made on another device since our last pull; per-row upsert is
    // OCC-safe (each carries its baseRev and only touches its own row).
    lmsChanged.forEach(row => autoSync("Attendance", { type: "upsert", row }));
  }
  alert(`Imported ${insertedRows.length} Polar rows${lmsChanged.length ? `\nUpdated LMS on ${lmsChanged.length} attendance row${lmsChanged.length === 1 ? "" : "s"}.` : ""}\n\nSyncing to sheet — check the sidebar indicator for status.`);
}
// ════════════════════════════════════════════════════════════════════════════
// CSV CONDUCT IMPORT (spec §14)
// ════════════════════════════════════════════════════════════════════════════
// Imports the attendance CSV (the "Attendance_-_Endurance_Run_5" format) into
// the conduct log and feeds HA participation. The Present roll is stored as a
// comma-joined `participants` 4D list on the ATTENDANCE row (the §12 HA source),
// not as per-person ConductDetail rows — that keeps ConductDetail's "absentees
// only" semantics intact and the Detail view uncluttered. Non-present statuses
// become ConductDetail rows (PX / Fallout) + review-panel follow-up flags.
// Holds { conducts:[...], errors:[...] } — supports importing MANY files at once.
let _conductImportPending = null;

// Map the six CSV status values (§14.1) to canonical labels. Unknown → "Other".
function normConductStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "present") return "Present";
  if (s === "fall out" || s === "fallout") return "Fall Out";
  if (s === "mc") return "MC";
  if (s === "leave") return "Leave";
  if (s === "off") return "Off";
  return "Other";
}
// Loose name match for the conditional split (§14.2): case/space-insensitive.
function _normName(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }

// Parse ONE file's rows into a pending-conduct object, or {error} if the file
// isn't a recognisable attendance CSV. Pure (no STATE writes, no DOM).
function parseConductCSV_(rows, fileName) {
  const meta = {};
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const c0 = String((rows[i] && rows[i][0]) || "").trim();
    if (/^user$/i.test(c0)) { headerIdx = i; break; }
    if (c0) meta[c0.toLowerCase()] = String((rows[i][1] || "")).trim();
  }
  if (headerIdx < 0) return { fileName, error: `${fileName}: no 'User | Unit | Status | Remarks' header row — not an attendance CSV.` };
  const header = rows[headerIdx].map(h => String(h || "").trim().toLowerCase());
  const iUser = header.indexOf("user") < 0 ? 0 : header.indexOf("user");
  const iStatus = header.indexOf("status") < 0 ? 2 : header.indexOf("status");
  const iRemarks = header.indexOf("remarks") < 0 ? 3 : header.indexOf("remarks");
  const activityName = meta["activity name"] || "";
  const currencyTags = meta["currency tags"] || "";
  const dateDisplay = normalizeDateToDisplay(meta["date"] || "");
  const periods = parseInt(meta["periods"], 10) || 0;
  const parsed = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const userCell = String(row[iUser] || "").trim();
    if (!userCell) continue; // trailing blank rows
    const statusRaw = String(row[iStatus] || "").trim();
    const remarks = String(row[iRemarks] || "").trim();
    // Conditional split: a leading 3-5 digit token → 4D + name; else all name.
    const m = userCell.match(/^(\d{3,5})\s+(.*)$/);
    let resolved = null, matchType = "Not found", fourD = "", name = userCell;
    if (m) {
      fourD = padD4(m[1]); name = m[2].trim();
      resolved = STATE.roster.find(p => p.id === fourD || padD4(p.fourD) === fourD) || null;
      if (resolved) matchType = "4D";
    } else {
      resolved = STATE.roster.find(p => _normName(p.name) === _normName(name)) || null;
      if (resolved) matchType = "Name match";
    }
    parsed.push({ userCell, fourD, name, statusRaw, status: normConductStatus(statusRaw), remarks, resolvedId: resolved ? resolved.id : "", matchType });
  }
  return { fileName, activityName, currencyTags, dateDisplay, periods, parsed, knownConductId: conductIdByName(activityName) };
}

// Accepts ONE OR MANY attendance CSVs. Each file = one conduct; ids are
// auto-created on commit. Papa.parse is async (callback per file), so we count
// down and open the combined review only once every file has parsed.
function importConductCSV(input) {
  // Admin-only (RBAC): conduct CSV import. The UI control is .admin-only, this
  // guard covers any programmatic call, and the backend re-checks via the
  // `imported` flag on the bulk write.
  if (!isAdminRole()) { input.value = ""; alert("Admin only — conduct CSV import is restricted to admin accounts."); return; }
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const results = new Array(files.length);
  let remaining = files.length;
  const finish = () => {
    input.value = "";
    const conducts = results.filter(r => r && !r.error);
    const errors = results.filter(r => r && r.error);
    if (!conducts.length) { alert("No valid conduct CSVs found:\n" + errors.map(e => e.error).join("\n")); return; }
    _conductImportPending = { conducts, errors };
    openConductImportModal();
  };
  files.forEach((file, fi) => {
    Papa.parse(file, { header: false, skipEmptyLines: false,
      complete: r => { results[fi] = parseConductCSV_(r.data || [], file.name); if (--remaining === 0) finish(); },
      error: () => { results[fi] = { fileName: file.name, error: `${file.name}: parse failed.` }; if (--remaining === 0) finish(); }
    });
  });
}

// Renders one review section per parsed conduct, each with its own conduct-
// resolution control (id ci-conduct-<idx>).
function conductReviewSection_(p, idx) {
  const by = s => p.parsed.filter(x => x.status === s);
  const present = by("Present"), fallout = by("Fall Out"), mc = by("MC"), leave = by("Leave"), off = by("Off"), other = by("Other");
  const matched4D = p.parsed.filter(x => x.matchType === "4D").length;
  const matchedName = p.parsed.filter(x => x.matchType === "Name match").length;
  const notFound = p.parsed.filter(x => x.matchType === "Not found");
  const haEligible = (configGet("haEligibilitySource") === "currencyTag")
    ? /\bha\b/i.test(p.currencyTags)
    : !(/(ippt|sports & games|swim)/i.test(p.activityName));
  const opts = getAllConducts();
  const conductCtl = !p.knownConductId
    ? `<select id="ci-conduct-${idx}" style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px">
         <option value="__new__" selected>+ Create new conduct: "${escapeAttr(p.activityName)}"</option>
         ${opts.map(c => `<option value="${c.id}">→ Merge into "${escapeAttr(c.name)}"</option>`).join("")}
       </select>`
    : `<div style="font-size:12px;color:var(--green)">✓ Matches existing conduct "${escapeAttr(conductName(p.knownConductId))}"</div>`;
  const flagList = (label, arr, color) => arr.length
    ? `<div style="margin-top:4px"><strong style="color:${color}">${label} (${arr.length})</strong>: <span style="font-size:11px;color:var(--muted)">${arr.map(x => escapeAttr((x.fourD ? x.fourD + " " : "") + (x.name || x.userCell || ""))).join(", ")}</span></div>`
    : "";

  // Subset import: everyone on the roster (recruits only — commanders aren't
  // tracked in conduct attendance) who is NOT in this file at all is assumed
  // absent. Display-only for review — no ConductDetail rows, no change to the
  // stored total/participants, so HA + participation math is untouched.
  const listedIds = new Set(p.parsed.map(x => x.resolvedId).filter(Boolean));
  const assumedAbsent = (STATE.roster || []).filter(r => !isCommander(r.id) && !listedIds.has(r.id));
  const absentBlock = assumedAbsent.length
    ? `<details style="margin-top:6px">
         <summary style="cursor:pointer;font-size:11px;color:var(--muted)">Assumed absent (${assumedAbsent.length}) — not in this file</summary>
         <div style="font-size:11px;color:var(--muted);margin-top:4px;line-height:1.6">${assumedAbsent.map(r => `${displayId(r.id)} ${escapeHTML(r.name || "")}`).join(" · ")}</div>
         <div style="font-size:10px;color:var(--dim);margin-top:3px">Shown for review only — not recorded, and they don't affect HA or participation totals.</div>
       </details>`
    : "";
  return `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--surface)">
    <div style="font-weight:700;font-size:13px;margin-bottom:6px">📄 ${escapeAttr(p.activityName || "(unnamed)")} <span style="font-weight:400;color:var(--dim);font-size:11px">— ${escapeAttr(p.fileName || "")}</span></div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Date: <strong>${escapeAttr(p.dateDisplay || "(none)")}</strong> · Periods (B5): <strong>${p.periods || 0}</strong> · Currency: <strong>${escapeAttr(p.currencyTags || "—")}</strong> · HA-eligible: ${haEligible ? `<span style="color:var(--green)">Yes</span>` : `<span style="color:var(--muted)">No</span>`}</div>
    <div style="margin-bottom:6px">${conductCtl}</div>
    <div style="font-size:11px">Present ${present.length} · Fall Out ${fallout.length} · MC ${mc.length} · Leave ${leave.length} · Off ${off.length} · Other ${other.length}${notFound.length ? ` · <span style="color:var(--orange)">not found ${notFound.length} (skipped)</span>` : ""}</div>
    ${mc.length ? `<div class="ci-pending-note" style="margin-top:4px;font-size:11px;color:var(--teal)">↪ ${mc.length} MC ${mc.length === 1 ? "row" : "rows"} → a <strong>Pending</strong> report-sick record is auto-created for anyone not already logged in Medical (tagged "from conduct log").</div>` : ""}
    ${flagList("Leave → Leave tab", leave, "var(--accent)")}
    ${flagList("Off (OIL) → Leave tab", off, "var(--accent)")}
    ${notFound.length ? `<div style="margin-top:4px;font-size:10px;color:var(--muted)">Unmatched: ${notFound.map(x => escapeAttr(x.userCell)).join(", ")}</div>` : ""}
    ${absentBlock}
  </div>`;
}

function openConductImportModal() {
  const pend = _conductImportPending;
  if (!pend || !pend.conducts.length) return;
  const cs = pend.conducts;
  const totalRows = cs.reduce((n, p) => n + p.parsed.filter(x => x.resolvedId).length, 0);
  openModal(`Import ${cs.length} Conduct CSV${cs.length === 1 ? "" : "s"}`, `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="color:var(--muted)">${cs.length} conduct${cs.length === 1 ? "" : "s"} parsed · ${totalRows} matched rows to import.</div>
        <button class="btn" style="font-size:11px" onclick="showConductImportSchema()">ⓘ CSV format</button>
      </div>
      ${pend.errors.length ? `<div style="background:#D2992211;border:1px solid #D2992244;border-radius:6px;padding:6px 10px;font-size:11px;color:var(--orange)">${pend.errors.length} file(s) skipped: ${pend.errors.map(e => escapeAttr(e.error)).join("; ")}</div>` : ""}
      <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);cursor:pointer">
        <input type="checkbox" id="ci-auto-medical" checked onchange="toggleCiAutoMedicalPreview(this.checked)" style="width:14px;height:14px;cursor:pointer">
        Auto-create Pending Medical rows for MC rows without an existing entry
      </label>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto">
        ${cs.map((p, i) => conductReviewSection_(p, i)).join("")}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid var(--border)">
        <button class="btn" onclick="cancelConductImport()">Cancel</button>
        <button class="btn btn-success" onclick="confirmConductImport()">Import all ${cs.length} conduct${cs.length === 1 ? "" : "s"}</button>
      </div>
    </div>
  `);
}

function cancelConductImport() { _conductImportPending = null; closeModal(); }

// Grays out the per-conduct "Pending record auto-created" preview lines when
// the auto-create checkbox is unchecked, so the modal doesn't show stale text.
function toggleCiAutoMedicalPreview(checked) {
  document.querySelectorAll(".ci-pending-note").forEach(el => el.style.display = checked ? "" : "none");
}

// Standalone schema reference (also reachable from the import button), so an
// operator can see the expected CSV layout before exporting/picking a file.
function showConductImportSchema() {
  openModal("Conduct CSV / import format", `
    <div style="font-size:12px;line-height:1.6">
      <p>The PT-conduct importer reads the standard attendance CSV export. You can select <strong>several files at once</strong> — each file becomes one conduct.</p>
      <p><strong>1 · Metadata block</strong> (top of the file, key in column A, value in column B — any order, before the data header):</p>
      <ul style="margin:0 0 8px 18px">
        <li><code>Activity name</code> — the conduct name (matched to an existing conduct, or a new id is created)</li>
        <li><code>Date</code> — e.g. <code>17 May 2026</code> (any common format; normalised on import)</li>
        <li><code>Periods</code> — the B5 period count (drives Double-HA crediting)</li>
        <li><code>Currency Tags</code> — used for HA eligibility when the source is set to "currency tag"</li>
      </ul>
      <p><strong>2 · Data header row</strong>: <code>User | Unit | Status | Remarks</code> (columns located by name, so order is flexible).</p>
      <p><strong>3 · Data rows</strong>. <code>User</code> is either "<code>1234 Name</code>" (4D + name) or just a name (matched loosely to the roster). <code>Status</code> is one of:</p>
      <ul style="margin:0 0 8px 18px">
        <li><code>Present</code> → counted as participating (feeds HA)</li>
        <li><code>Fall Out</code> → recorded as a Fallout absence</li>
        <li><code>MC</code> → recorded as a Status absence; a <strong>Pending report-sick</strong> record is auto-created for anyone not already in the Medical tab</li>
        <li><code>Leave</code> / <code>Off</code> → Status absence + a follow-up flag (action in the Leave tab)</li>
        <li>anything else → <code>Other</code> (Status absence)</li>
      </ul>
      <p style="color:var(--muted)">Rows whose person can't be matched to the roster are listed and skipped (never silently dropped). Re-importing the same conduct + date replaces the earlier import rather than doubling it.</p>
      <div style="display:flex;justify-content:flex-end;padding-top:8px;border-top:1px solid var(--border)"><button class="btn" onclick="${_conductImportPending ? "openConductImportModal()" : "closeModal()"}">Close</button></div>
    </div>
  `);
}

function confirmConductImport() {
  const pend = _conductImportPending;
  if (!pend || !pend.conducts.length) return;
  const autoCreateMedical = document.getElementById("ci-auto-medical")?.checked !== false;

  const newNameToId = {};   // batch dedupe: two new files of the same name share one id
  let totPresent = 0, totFallout = 0, totStatus = 0, totUnmatched = 0;
  const pendingMedical = [];
  const seenPending = new Set();   // (d4|date) guard within this batch

  // Two coordination maps keyed by `${conductId}|${date}|${time}`:
  //   cleanedKeys     — keys whose PRIOR-session rows have already been purged
  //                     (the "re-import replaces" rule), done ONCE per key.
  //   batchEntryByKey — the attendance row this batch is building for that key.
  // The CSV carries no time-of-day, so every file resolves to time="". Without
  // this coordination, two files for the SAME conduct on the SAME day (e.g. an
  // AM and a PM session) collide on the key: the old per-file purge ran on every
  // iteration, so file 2 deleted file 1's just-pushed rows and only the last
  // file survived (silent data loss). Now we purge a key's prior rows once, then
  // MERGE subsequent same-key files into the one entry instead of clobbering.
  const cleanedKeys = new Set();
  const batchEntryByKey = {};
  const detailByKey = {};   // de-dupes (d4|type|reason) within a merged key
  let mergedFiles = 0;

  pend.conducts.forEach((p, idx) => {
    // Resolve the conduct id: existing match → reuse; else read the per-conduct
    // select (create-new or merge). New conducts of identical name coalesce.
    let conductId = p.knownConductId;
    if (!conductId) {
      const sel = document.getElementById(`ci-conduct-${idx}`);
      const v = sel ? sel.value : "__new__";
      if (v === "__new__") {
        const key = _normName(p.activityName);
        conductId = newNameToId[key] || (newNameToId[key] = createConduct(p.activityName || "Imported Conduct"));
      } else conductId = v;
    }
    const date = p.dateDisplay;
    const time = "";   // CSV carries no time-of-day
    const key = `${conductId}|${date}|${time}`;

    const matched = p.parsed.filter(x => x.resolvedId);
    const presentIds = [...new Set(matched.filter(x => x.status === "Present").map(x => x.resolvedId))];
    const fallout = matched.filter(x => x.status === "Fall Out");
    const statusAbsent = matched.filter(x => ["MC", "Leave", "Off", "Other"].includes(x.status));
    totPresent += presentIds.length; totFallout += fallout.length; totStatus += statusAbsent.length;
    totUnmatched += p.parsed.filter(x => !x.resolvedId).length;

    const detailRows = [];
    fallout.forEach(x => detailRows.push({ id: nextId(), date, time, conductId, d4: x.resolvedId, type: "Fallout", reason: x.remarks || "" }));
    statusAbsent.forEach(x => detailRows.push({
      id: nextId(), date, time, conductId, d4: x.resolvedId, type: "Status",
      reason: x.status === "Other" ? (x.remarks || "Other") : x.status + (x.remarks ? ` — ${x.remarks}` : "")
    }));

    // C2: those who reported sick should already be logged. For each MC row
    // with NO existing Medical record on that date, create a Pending report-sick
    // record (origin "conductLog") so the gap is visible and an MO outcome can
    // be filled in later. Existing records are left untouched.
    if (autoCreateMedical) {
      matched.filter(x => x.status === "MC").forEach(x => {
        const pkey = `${x.resolvedId}|${date}`;
        if (seenPending.has(pkey)) return;
        const exists = STATE.medical.some(m => m.d4 === x.resolvedId && m.date === date);
        if (exists) return;
        seenPending.add(pkey);
        pendingMedical.push({
          id: nextId(), d4: x.resolvedId, date, reason: x.remarks || "Reported sick (from conduct log)",
          status: "Pending", startDate: date, endDate: "", origin: "conductLog"
        });
      });
    }

    // Purge any PRIOR-session rows for this key exactly once (re-import replace).
    if (!cleanedKeys.has(key)) {
      STATE.attendance = STATE.attendance.filter(a => `${a.conductId}|${a.date}|${a.time || ""}` !== key);
      STATE.conductDetail = STATE.conductDetail.filter(d => `${d.conductId}|${d.date}|${d.time || ""}` !== key);
      cleanedKeys.add(key);
    }

    // First file for this key → create the entry; later files MERGE into it.
    let entry = batchEntryByKey[key];
    if (!entry) {
      entry = {
        id: nextId(), date, time, conductId,
        total: 0, participating: 0, lms: 0, px: 0, fallout: 0,
        remarks: p.activityName || "", participants: "",
        periods: p.periods || 0, currencyTags: p.currencyTags || "", source: "csv"
      };
      batchEntryByKey[key] = entry;
      detailByKey[key] = new Set();
      STATE.attendance.push(entry);
    } else {
      mergedFiles++;
    }

    // Union participants so a person present in two merged sessions counts once.
    const partSet = new Set(entry.participants ? entry.participants.split(",").filter(Boolean) : []);
    presentIds.forEach(id => partSet.add(id));
    entry.participants = [...partSet].join(",");
    entry.participating = partSet.size;
    entry.px += statusAbsent.length;
    entry.fallout += fallout.length;
    entry.total = entry.participating + entry.px + entry.fallout;
    // Periods drive Double-HA crediting. Take the MAX across merged files: a
    // re-export of the same session carries identical periods (so max == that
    // value, no double-credit), while genuinely distinct same-day sessions only
    // under-credit by the smaller count — far safer than silently dropping a file.
    entry.periods = Math.max(entry.periods || 0, p.periods || 0);
    if (!entry.currencyTags && p.currencyTags) entry.currencyTags = p.currencyTags;

    // Push detail rows, skipping (d4|type|reason) dups from an accidental
    // double-select of the same file under one key.
    const dset = detailByKey[key];
    detailRows.forEach(r => {
      const dk = `${r.d4}|${r.type}|${r.reason}`;
      if (dset.has(dk)) return;
      dset.add(dk);
      STATE.conductDetail.push(r);
    });
  });

  if (pendingMedical.length) STATE.medical.push(...pendingMedical);

  saveLocal();
  const conductCount = pend.conducts.length;
  _conductImportPending = null;
  closeModal();
  render();

  // Full-tab replace (safe: normalizers guarantee every row carries its columns).
  // `imported: true` marks these as a bulk import so the backend admin-gates them.
  if (STATE.apiUrl) {
    autoSync("Attendance", { type: "replace", data: STATE.attendance, imported: true });
    autoSync("ConductDetail", { type: "replace", data: STATE.conductDetail, imported: true });
    if (pendingMedical.length) autoSync("Medical", { type: "replace", data: STATE.medical, imported: true });
  }
  alert(`Imported ${conductCount} conduct${conductCount === 1 ? "" : "s"}:\n  • ${totPresent} present · ${totFallout} fallout · ${totStatus} status\n  • ${pendingMedical.length} Pending report-sick record${pendingMedical.length === 1 ? "" : "s"} auto-created\n  • ${totUnmatched} unmatched rows skipped${mergedFiles ? `\n  • ${mergedFiles} file${mergedFiles === 1 ? "" : "s"} merged into a same-conduct/same-day session (participants combined)` : ""}\nSyncing to sheet — check the sidebar indicator.`);
}
