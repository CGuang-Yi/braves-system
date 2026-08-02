// The sick-history xlsx import, plus the remaining record forms: conduct detail, appointments, MSK, commander, leave.
//
// Split out of the original monolithic forms.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// ════════════════════════════════════════════════════════════════════════════
// SICK-HISTORY xlsx IMPORT (Item 5, admin-only) — colour-coded REC sheet → Medical
// ════════════════════════════════════════════════════════════════════════════
// Drives the parser in sick-history-import.js (shParseWorkbook/shEpisodesToRows):
// reads the workbook with ExcelJS (loaded from CDN), previews the decoded episodes,
// and on confirm appends Medical rows (+ AL/OIL → Leave), deduped against existing
// rows so a re-import doesn't double up. Status is encoded by cell fill colour; the
// colour→status legend is read from the sheet's own legend block.
let _sickHistoryPending = null;

async function importSickHistoryXLSX(input) {
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  if (typeof ExcelJS === "undefined") {
    alert("The ExcelJS library hasn't loaded (it comes from a CDN). Check your connection and reload.");
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) { alert("No worksheet found in that file."); return; }

    const parsed = shParseWorkbook(ws);
    if (!parsed.persons.length) {
      alert("No personnel rows with coloured status cells were found.\nIs this the RSI/RSO REC sheet (S/N · FULL NAME · 4D · day columns)?");
      return;
    }
    // Resolve each sheet 4D against the roster (same matching as the CSV import).
    const ctx = {
      resolveD4: raw => { const d = padD4(raw); const r = STATE.roster.find(p => p.id === d || padD4(p.fourD) === d); return r ? r.id : null; },
      makeMedId: () => nextId(),
      makeLeaveId: () => nextId(),
      toDisplay: iso => isoToDisplayDate(iso)
    };
    _sickHistoryPending = { parsed, rows: shEpisodesToRows(parsed.persons, ctx) };
    openSickHistoryModal();
  } catch (e) {
    alert("Failed to read the xlsx: " + e.message);
  }
}

function cancelSickHistoryImport() { _sickHistoryPending = null; closeModal(); }

function openSickHistoryModal() {
  const p = _sickHistoryPending;
  if (!p) return;
  const { parsed, rows } = p;

  // Date range across the parsed day columns.
  const isos = Object.values(parsed.dateMap).sort();
  const rangeStr = isos.length ? `${isoToDisplayDate(isos[0])} → ${isoToDisplayDate(isos[isos.length - 1])}` : "—";
  const episodeCount = parsed.persons.reduce((s, x) => s + x.episodes.length, 0);

  // Derived legend swatches (colour → human status).
  const SWATCH = { "FF0000": "#FF0000", "FFFF00": "#FFFF00", "00FF00": "#00FF00", "00FFFF": "#00FFFF", "9900FF": "#9900FF", "FF00FF": "#FF00FF" };
  const legendHtml = Object.entries(parsed.legend).map(([hex, tok]) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px">
       <span style="width:12px;height:12px;border:1px solid var(--border);border-radius:2px;background:${SWATCH[hex] || ("#" + hex)}"></span>
       ${escapeAttr(SH_TOKEN_LABEL[tok] || tok)}</span>`).join("");

  // Per-person episode breakdown (scrollable).
  const personHtml = parsed.persons.map(person => {
    const d4 = person.fourD;
    const matched = rows.unmatched.indexOf(person) < 0;
    const eps = person.episodes.map(e =>
      `<div style="font-size:10px;color:var(--muted);padding-left:10px">• ${escapeAttr(SH_TOKEN_LABEL[e.status] || e.status)} ${isoToDisplayDate(e.startDate)}${e.endDate !== e.startDate ? "–" + isoToDisplayDate(e.endDate) : ""}${e.reason ? " — " + escapeAttr(e.reason) : ""}${e.source === "text" ? ' <span style="color:var(--dim)">(text)</span>' : ""}</div>`).join("");
    return `<div style="padding:4px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:11px"><span class="mono" style="color:${matched ? "var(--accent)" : "var(--orange)"};font-weight:700">${escapeAttr(d4)}</span> ${escapeAttr(person.name)} ${matched ? "" : '<span style="color:var(--orange)">⚠ not in roster — skipped</span>'} <span style="color:var(--dim)">(${person.episodes.length})</span></div>
      ${eps}</div>`;
  }).join("");

  openModal("Import Sick History (xlsx)", `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:12px">
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
        <div><strong>Date range:</strong> ${rangeStr} &nbsp;·&nbsp; <strong>People:</strong> ${parsed.persons.length} &nbsp;·&nbsp; <strong>Episodes:</strong> ${episodeCount}</div>
        <div style="margin-top:6px"><strong>Legend (from sheet):</strong> ${legendHtml || "<span style='color:var(--muted)'>defaults</span>"}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
        Will create <strong style="color:var(--green)">${rows.medical.length}</strong> Medical rows
        ${rows.leave.length ? `+ <strong style="color:var(--accent)">${rows.leave.length}</strong> AL/OIL Leave rows` : ""}
        ${rows.unmatched.length ? ` &nbsp;·&nbsp; <span style="color:var(--orange)">${rows.unmatched.length} people not in roster (skipped)</span>` : ""}.
        <div style="color:var(--muted);margin-top:4px">Re-importing is safe — rows already present (same person · start date · status) are skipped.</div>
      </div>
      <div style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:6px 10px">${personHtml}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid var(--border)">
        <button class="btn" onclick="cancelSickHistoryImport()">Cancel</button>
        <button class="btn btn-success" onclick="confirmSickHistoryImport()">Import ${rows.medical.length + rows.leave.length} rows</button>
      </div>
    </div>
  `);
}

function confirmSickHistoryImport() {
  const p = _sickHistoryPending;
  if (!p) return;
  const { medical, leave } = p.rows;

  // Dedup against what's already stored so a re-import doesn't double up. Key by
  // (d4 | startDate | type | status) — the natural identity of an episode.
  const medKey = m => `${m.d4}|${m.startDate}|${m.type}|${m.status}`;
  const lvKey = l => `${l.d4}|${l.startDate}|${l.type}`;
  const existingMed = new Set(STATE.medical.map(medKey));
  const existingLv = new Set((STATE.leave || []).map(lvKey));

  const newMed = medical.filter(m => !existingMed.has(medKey(m)));
  const newLv = leave.filter(l => !existingLv.has(lvKey(l)));
  const skipped = (medical.length - newMed.length) + (leave.length - newLv.length);

  newMed.forEach(m => STATE.medical.push(m));
  if (newLv.length) STATE.leave = (STATE.leave || []).concat(newLv);

  saveLocal();
  _sickHistoryPending = null;
  closeModal();
  render();

  if (STATE.apiUrl) {
    newMed.forEach(m => autoSync("Medical", { type: "upsert", row: m }));
    newLv.forEach(l => autoSync("Leave", { type: "upsert", row: l }));
  }
  alert(`Imported sick history:\n  • ${newMed.length} Medical rows${newLv.length ? `, ${newLv.length} AL/OIL Leave rows` : ""}\n  • ${skipped} duplicate(s) skipped\n  • ${p.rows.unmatched.length} unmatched person(s) skipped${STATE.apiUrl ? "\nSyncing to sheet — check the sidebar indicator." : ""}`);
}

function openConductDetailForm(id) {
  const e = id ? STATE.conductDetail.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  openModal(e ? "Edit Conduct Detail" : "Log Conduct Detail", `
    <form onsubmit="event.preventDefault(); submitConductDetail(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        ${formField("f-time", "Time (optional)", "text", "0730", `maxlength="10" value="${escapeAttr(e?.time)}"`)}
        <div class="form-group">
          <label>Conduct</label>
          ${conductPicker({ inputId: "f-conductId", selectedId: e?.conductId || "" })}
        </div>
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formSelect("f-type", "Type", [["Status", "Status (pre-existing medical status — absent)"], ["PXP", "PX (present, not participating — doing stretches, not absent)"], ["Fallout", "Fallout (dropped out, no MO visit)"], ["RSI", "RSI (reported sick at first parade)"], ["ReportSick", "Report Sick (fallout → went to MO)"]], true, e?.type || "")}
        ${formField("f-reason", "Reason", "text", "Sprained ankle / Fever / Shin splint...", `required maxlength="200" value="${escapeAttr(e?.reason)}"`)}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitConductDetail() {
  const editId = +gv("f-entry-id");
  const conductId = gv("f-conductId");
  if (!conductId) { alert("Pick a conduct (or create a new one from the dropdown)."); return; }
  const entry = {
    id: editId || nextId(),
    date: isoToDisplayDate(gv("f-date")),
    time: pad4Time(gv("f-time")),
    conductId,
    d4: gv("f-d4"),
    type: gv("f-type"),
    reason: gv("f-reason")
  };
  if (editId) {
    const idx = STATE.conductDetail.findIndex(d => d.id === editId);
    if (idx >= 0) STATE.conductDetail[idx] = entry;
  } else {
    STATE.conductDetail.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("ConductDetail", { type: "upsert", row: entry });
}

function openAppointmentForm(id, prefill) {
  // `prefill` is only honored when not editing — used by the MSK widget's
  // Book button to pre-populate d4/reason/location without typing.
  const isEdit = !!id;
  const e = isEdit ? STATE.appointments.find(x => x.id === id) : (prefill || null);
  const dateVal = e?.date ? (displayDateToISO(e.date) || todayISO()) : todayISO();
  openModal(isEdit ? "Edit Appointment" : "Book Appointment", `
    <form onsubmit="event.preventDefault(); submitAppointment(); return false">
      <input type="hidden" id="f-entry-id" value="${isEdit ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${isEdit ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${personSearchBox({
          boxId: "f-appt-d4",
          valueId: "f-d4",              // hidden input submitAppointment reads via gv("f-d4")
          selected: e?.d4 || "",         // pre-fills the picker in edit mode
          placeholder: "Search name / 4D…"
        })}</div>
        ${formField("f-reason", "Reason", "text", "Knee specialist review / IPPT retake / Board…", `required maxlength="200" value="${escapeAttr(e?.reason)}"`)}
        <div class="form-row">
          ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
          ${formField("f-time", "Time", "text", "0930", `required maxlength="10" value="${escapeAttr(e?.time)}"`)}
        </div>
        ${formField("f-location", "Location", "text", "MO Office / SAFTI MC / Camp HQ…", `required maxlength="100" value="${escapeAttr(e?.location)}"`)}
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);cursor:pointer">
          <input id="f-appt-ooc" type="checkbox" ${e?.outOfCamp ? "checked" : ""} style="width:16px;height:16px;cursor:pointer">
          Out of camp (recruit leaves camp for this appointment)
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);cursor:pointer">
          <input id="f-resolved" type="checkbox" ${e?.resolved ? "checked" : ""} style="width:16px;height:16px;cursor:pointer">
          Mark as resolved (hides from dashboard + parade state)
        </label>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save" : "Book"}</button>
      </div>
    </form>`);
}
function submitAppointment() {
  const editId = +gv("f-entry-id");
  // Recruit is picked via the search box (hidden input), which can't be HTML-
  // `required` and is cleared on every keystroke until a suggestion is picked —
  // so guard here, or a typed-but-unpicked name saves an appointment with no
  // recruit (same guard submitMedical / submitLeave carry for their pickers).
  const d4 = gv("f-d4");
  if (!d4) { alert("Pick a recruit (search by name / 4D)."); return; }
  const entry = {
    id: editId || nextId(),
    d4,
    reason: gv("f-reason"),
    date: isoToDisplayDate(gv("f-date")),
    time: gv("f-time"),
    location: gv("f-location"),
    outOfCamp: document.getElementById("f-appt-ooc")?.checked || false,
    resolved: document.getElementById("f-resolved")?.checked || false
  };
  entry.time = pad4Time(entry.time);
  if (editId) {
    const idx = STATE.appointments.findIndex(a => a.id === editId);
    if (idx >= 0) STATE.appointments[idx] = entry;
  } else {
    STATE.appointments.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("Appointments", { type: "upsert", row: entry });
}

// Toggle clearance on every MSK row for a recruit. Acts as case-level
// clear: if ANY row is still un-cleared we mark them all cleared; if
// they're all already cleared we flip back to active (un-clear). Lets
// sergeants reverse mistakes without going to the sheet.
function toggleMSKCleared(d4) {
  const rows = STATE.msk.filter(m => m.d4 === d4);
  if (!rows.length) return;
  const allCleared = rows.every(m => m.cleared);
  rows.forEach(m => { m.cleared = !allCleared; });
  saveLocal(); render();
}

// Module-scope toggle for the MSK widget's "Show cleared" reveal. Kept
// here so it survives re-renders of the dashboard.
let _mskShowCleared = false;
function toggleMSKShowCleared() {
  _mskShowCleared = !_mskShowCleared;
  render();
}

// Persist a manual body-region tag list on the recruit's latest Report
// Injury row. Reading the regions back uses getMSKRegionsForRecruit which
// prefers manualRegions over the auto-classifier when set.
function setMSKRegions(d4, regions) {
  const reports = STATE.msk
    .filter(m => m.d4 === d4 && (m.type || "").toLowerCase().includes("report"))
    .sort((a, b) => (a.timestamp || "") < (b.timestamp || "") ? 1 : -1);
  if (!reports.length) {
    alert("No injury report on file for this recruit — can't tag regions.");
    return;
  }
  reports[0].manualRegions = regions.join(", ");
  saveLocal(); render();
}

// Modal for editing a recruit's body region tags. Pre-checks current
// regions; on Save, persists via setMSKRegions and re-renders.
function openMSKRegionMenu(d4) {
  const current = getMSKRegionsForRecruit(d4);
  const currentSet = new Set(current);
  const options = MSK_REGION_LIST.map(r => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;background:${currentSet.has(r) ? MSK_REGION_COLORS[r] + "22" : "var(--surface2)"}">
      <input type="checkbox" data-region="${escapeAttr(r)}" ${currentSet.has(r) ? "checked" : ""} style="width:14px;height:14px;cursor:pointer">
      <span style="width:10px;height:10px;border-radius:50%;background:${MSK_REGION_COLORS[r]}"></span>
      <span style="font-size:12px">${r}</span>
    </label>`).join("");

  openModal("Tag injury regions — " + displayPersonLabel(d4), `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;line-height:1.55">
        Pick the body regions this recruit's injury affects. Overrides the auto-classifier. Push to Sheet to persist.
      </div>
      <div id="msk-region-list" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:4px">${options}</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" style="flex:1" onclick="saveMSKRegionMenu('${d4}')">Save tags</button>
      </div>
    </div>`);
}

function saveMSKRegionMenu(d4) {
  const checked = [...document.querySelectorAll("#msk-region-list input[type=checkbox]:checked")]
    .map(el => el.dataset.region);
  if (!checked.length) {
    alert("Pick at least one region (or use 'Other' for unclassified).");
    return;
  }
  setMSKRegions(d4, checked);
  closeModal();
}

// Inline tick from the dashboard widget — flips the resolved bit. The
// appointment disappears from dashboard/parade state immediately. To un-
// resolve, edit the entry via the pencil icon (visible while it's still
// in the list) or correct via the sheet.
function toggleAppointmentResolved(id) {
  const a = STATE.appointments.find(x => x.id === id);
  if (!a) return;
  a.resolved = !a.resolved;
  saveLocal(); render();
}

// Lightweight roster-add form scoped to commanders. Recruits are added via
// the Google Sheet directly (their data is sourced from pre-enlistment
// nominal rolls); commanders are added ad-hoc in-app so the user doesn't
// need to touch the sheet just to track their own team.
function openCommanderForm(id) {
  const e = id ? STATE.roster.find(r => r.id === id && r.role === "Commander") : null;
  openModal(e ? "Edit Commander" : "+ Add Commander", `
    <form onsubmit="event.preventDefault(); submitCommander(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px">Commander IDs use the <strong>00xx</strong> range (0001–0099). The ID is administrative — the app only ever shows rank + name.</div>
        <div class="form-row">
          ${formField("f-id", "4D (00xx)", "text", "0001", `required maxlength="4" pattern="00[0-9]{2}" value="${escapeAttr(e?.id)}"${e ? " readonly" : ""}`)}
          ${formField("f-rank", "Rank", "text", "3SG / 2LT / CPT…", `required maxlength="10" value="${escapeAttr(e?.rank)}"`)}
        </div>
        ${formField("f-name", "Name", "text", "Nicholas Eng", `required maxlength="100" value="${escapeAttr(e?.name)}"`)}
        <div class="form-row">
          ${formField("f-platoon", "Platoon", "text", "HQ / PLT1", `maxlength="10" list="platoon-codes" value="${escapeAttr(e?.platoon)}"`)}
          ${formField("f-section", "Section", "text", "Command / 1", `maxlength="12" value="${escapeAttr(e?.section)}"`)}
        </div>
        <datalist id="platoon-codes">${activePlatoons().map(p => `<option value="${escapeAttr(p.code)}">`).join("")}</datalist>
        <div class="form-group">
          <label>Rank group</label>
          <select id="f-rankgroup">
            ${["", "Officer", "WOSPEC", "Enlistee"].map(g => `<option value="${g}" ${g === (e?.rankGroup || "") ? "selected" : ""}>${g || "Auto from rank"}</option>`).join("")}
          </select>
        </div>
        ${formField("f-quota", "Off-in-Lieu Quota (days)", "number", "14", `min="0" max="365" step="1" value="${e?.leaveQuota ?? 14}"`)}
        ${formField("f-phone", "Phone (optional)", "text", "9123 4567", `maxlength="20" value="${escapeAttr(e?.phone)}"`)}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Add Commander"}</button>
      </div>
    </form>`);
}
function submitCommander() {
  const editId = gv("f-entry-id");
  const id = gv("f-id").trim();
  if (!/^00\d{2}$/.test(id)) { alert("Commander ID must be 4 digits in the 00xx range (e.g. 0001)."); return; }
  if (!editId && STATE.roster.some(r => r.id === id)) { alert(`ID ${id} is already taken.`); return; }
  const entry = {
    id,
    name: gv("f-name"),
    rank: gv("f-rank"),
    role: "Commander",
    leaveQuota: +gv("f-quota") || 0,
    phone: gv("f-phone") || "",
    status: "Active",
    // Braves org model (spec §5). Commanders have no 4D to parse, so these
    // explicit fields are what places them in a platoon/section for parade state.
    platoon: gv("f-platoon").trim(),
    section: gv("f-section").trim(),
    rankGroup: gv("f-rankgroup"),
    fourD: "",
    // Legacy parse-fallback fields kept blank (the old topbar filter still reads
    // these until the Step-5 scope rewrite switches to platoon/section).
    plt: "",
    sect: ""
  };
  let row = entry;
  if (editId) {
    const idx = STATE.roster.findIndex(r => r.id === editId);
    if (idx >= 0) { STATE.roster[idx] = { ...STATE.roster[idx], ...entry }; row = STATE.roster[idx]; }
  } else {
    STATE.roster.push(entry);
  }
  saveLocal(); closeModal(); render();
  // Push the MERGED row, not the bare `entry` this form collects. upsertRow
  // rewrites every sheet column from the row it is given (`trimmed.map(h =>
  // rowData[h] ?? "")`), so pushing `entry` on an edit blanked every roster
  // column this form has no input for — notes (now editable in-app via
  // personNotesSave), age, email, ration, allergies, msk, height, weight,
  // education and licence. Same reasoning as the comment in personNotesSave.
  if (STATE.apiUrl) autoSync("Roster", { type: "upsert", row });
}

// Mirrors the legacy §8 heuristic (bpIsAlOilType / bpOthersNotInCamp in
// braves-parade.js) purely to suggest a starting value for the In Camp
// select — the classifier itself no longer guesses; every saved record
// carries an explicit isInCamp.
function leaveInCampGuess(type, reason) {
  return bpIsAlOilType(type) ? false : !bpOthersNotInCamp(reason);
}
// Recomputes the In Camp select from the current Type/Reason, but only
// until the commander manually picks a value themselves. Setting .value
// here doesn't fire "change", so it never trips markLeaveInCampTouched below.
function updateLeaveInCampDefault() {
  const el = document.getElementById("f-in-camp");
  if (!el || el.dataset.touched === "1") return;
  el.value = String(leaveInCampGuess(gv("f-type"), gv("f-reason")));
}
function markLeaveInCampTouched() {
  const el = document.getElementById("f-in-camp");
  if (el) el.dataset.touched = "1";
}
// Add-mode scratch state for the Leave/Out "Selected people…" scope. It is
// reset whenever the modal opens and is never persisted independently; only
// the final per-person Leave rows enter STATE and sync.
let _leaveSelectedD4s = [];

function renderLeaveSelectedPeople() {
  const list = document.getElementById("f-leave-selected-list");
  const count = document.getElementById("f-leave-selected-count");
  if (count) count.textContent = `${_leaveSelectedD4s.length} selected`;
  if (!list) return;
  if (!_leaveSelectedD4s.length) {
    list.innerHTML = `<div style="font-size:11px;color:var(--muted)">No people selected yet.</div>`;
    return;
  }
  list.innerHTML = _leaveSelectedD4s.map(d4 => {
    const label = displayPersonLabel(d4);
    return `<span class="badge" style="display:inline-flex;align-items:center;gap:5px">
      ${escapeHTML(label)}
      <button type="button" onclick="leaveRemoveSelectedPerson('${escapeAttr(d4)}')"
        aria-label="Remove ${escapeAttr(label)}" style="border:0;background:none;color:inherit;cursor:pointer;padding:0">×</button>
    </span>`;
  }).join(" ");
}

function leavePickSelectedPerson(d4) {
  if (!d4) return;
  if (!_leaveSelectedD4s.includes(d4)) _leaveSelectedD4s.push(d4);
  const hidden = document.getElementById("leave-selected-person-value");
  const input = document.getElementById("leave-selected-person-input");
  if (hidden) hidden.value = "";
  if (input) { input.value = ""; input.focus(); }
  renderLeaveSelectedPeople();
}

function leaveRemoveSelectedPerson(d4) {
  _leaveSelectedD4s = _leaveSelectedD4s.filter(id => id !== d4);
  renderLeaveSelectedPeople();
}

// Feature 22 — one menu, two entry points. `d4` is optional: the Parade grid
// passes the row's person so both forms open prefilled, the Dashboard passes
// nothing and they open blank, relying on the person search box each already
// carries. That is why there is no separate person-picker step.
//
// Gated on canWrite() (commander + admin), the same gate the Archive nav uses.
// A viewer is never shown the trigger at all rather than shown a disabled one —
// but the gate is repeated HERE too, because the callers only hide the button
// and a hidden button is not a permission check.
function openQuickLogMenu(d4) {
  if (!canWrite()) return;
  const pre = d4 ? `{ d4: '${escapeAttr(d4)}' }` : "null";
  const who = d4 ? ` for ${escapeHTML(displayPersonLabel(d4))}` : "";
  openModal("Log" + who, `
    <div style="display:flex;flex-direction:column;gap:8px">
      <button type="button" class="btn" style="text-align:left;padding:10px 12px" onclick="closeModal(); openMedicalForm(null, ${pre})">🏥 Medical / Report Sick</button>
      <button type="button" class="btn" style="text-align:left;padding:10px 12px" onclick="closeModal(); openLeaveForm(null, ${pre})">📅 Leave / Out</button>
    </div>`);
}

function openLeaveForm(id, prefill) {
  _leaveSelectedD4s = [];
  // `prefill` mirrors openMedicalForm's contract exactly: honoured only when
  // CREATING, never when editing, so a stray argument can never overwrite the
  // person on a saved row. Added for the Feature 22 quick-log menu, which opens
  // this form from a parade-grid row that already knows who it is about.
  const isEdit = !!id;
  const e = id ? STATE.leave.find(x => x.id === id) : (prefill || null);
  const startVal = e ? displayDateToISO(e.startDate) || todayISO() : todayISO();
  const endVal = e ? displayDateToISO(e.endDate) || todayISO() : todayISO();
  const LEAVE_TYPES = [
    ["Off-in-Lieu", "Off-in-Lieu (counts toward quota)"], ["Leave", "Leave"],
    ["Compassionate", "Compassionate Leave"], ["Weekend", "Weekend"],
    ["Night's Out", "Night's Out (same-day, evening off-camp)"], ["Course", "Course"],
    ["Guard Duty", "Guard Duty"], ["NDP", "NDP"], ["Other", "Other"]
  ];
  // The native <select> below has no blank placeholder, so an untouched new
  // form effectively defaults to the first option (Off-in-Lieu) — matched
  // here so the In Camp smart-prefill agrees with what the browser shows.
  const initialType = e?.type || LEAVE_TYPES[0][0];
  // isEdit, not the truthiness of `e` — `e` now also holds a prefill for a NEW
  // row (same contract as openMedicalForm). Every "is this an edit" test below
  // keys off isEdit, so a prefill cannot hide the bulk scope selector, stamp a
  // junk entry id, or flip the submit button to "Save".
  const inCampDefault = isEdit ? (e.isInCamp === true) : leaveInCampGuess(initialType, e?.reason || "");
  // Bulk "Apply to" scope options (add mode only). Organisational scopes show
  // their recruit counts; "Selected people" instead accumulates any rostered
  // people, including commanders. One Log batches either kind via appendMany.
  const scopeOpts = e ? "" : (() => {
    const coy = scopeRecruits("company").length;
    const opts = [
      `<option value="person">One person…</option>`,
      `<option value="selected">Selected people…</option>`,
      `<option value="company">Whole company (${coy})</option>`
    ];
    activePlatoons().forEach(p => {
      const n = scopeRecruits("plt:" + p.code).length;
      if (!n) return;
      opts.push(`<option value="plt:${escapeAttr(p.code)}">${escapeAttr(p.displayName || p.code)} (${n})</option>`);
      sectionsInPlatoon(p.code).forEach(s => {
        const sn = scopeRecruits("sect:" + p.code + ":" + s).length;
        if (sn) opts.push(`<option value="sect:${escapeAttr(p.code)}:${escapeAttr(s)}">&nbsp;&nbsp;↳ ${escapeAttr(p.displayName || p.code)} Sect ${escapeAttr(s)} (${sn})</option>`);
      });
    });
    return opts.join("");
  })();
  openModal(e ? "Edit Leave/Out Entry" : "Log Leave / Out", `
    <form onsubmit="event.preventDefault(); submitLeave(); return false">
      <input type="hidden" id="f-entry-id" value="${isEdit ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${isEdit ? editHint : ""}
        <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;line-height:1.6">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">📋 Pick the type</div>
          <div><strong>Off-in-Lieu</strong> — counts against the commander's quota.</div>
          <div><strong>Leave / Compassionate / Course / Guard Duty / NDP / Other</strong> — tracked but doesn't decrement the off balance.</div>
        </div>
        ${isEdit ? "" : `<div class="form-group"><label>Apply to</label><select id="f-leave-scope" onchange="onLeaveScopeChange()">${scopeOpts}</select></div>`}
        <div class="form-group" id="f-leave-person-wrap"><label>Person</label>${personSearchBox({ boxId: "leave-person", valueId: "f-d4", placeholder: "Search person by name / 4D…", selected: e?.d4 || "" })}</div>
        ${isEdit ? "" : `<div class="form-group" id="f-leave-selected-wrap" style="display:none">
          <label>People <span id="f-leave-selected-count" style="color:var(--muted);font-weight:400">0 selected</span></label>
          ${personSearchBox({
            boxId: "leave-selected-person",
            onPickFn: "leavePickSelectedPerson",
            placeholder: "Search person by name / 4D…"
          })}
          <div id="f-leave-selected-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:7px">
            <div style="font-size:11px;color:var(--muted)">No people selected yet.</div>
          </div>
        </div>`}
        <div class="form-group"><label>Type</label><select id="f-type" required onchange="updateLeaveInCampDefault()">${LEAVE_TYPES.map(([val, lab]) => `<option value="${val}" ${val === initialType ? "selected" : ""}>${lab}</option>`).join("")}</select></div>
        <div class="form-row">
          ${formField("f-start", "Start date", "date", "", `required value="${startVal}" min="2020-01-01" max="2099-12-31" onchange="recalcLeaveStart()"`)}
          ${formField("f-end", "End date", "date", "", `required value="${endVal}" min="2020-01-01" max="2099-12-31" onchange="recalcLeaveDays()"`)}
        </div>
        ${formField("f-days", "Days (drives End; editable — half-days for quota)", "number", "1", `required min="0" max="365" step="0.5" value="${e?.days ?? 1}" oninput="recalcLeaveEndFromDays()"`)}
        ${formField("f-reason", "Reason / notes", "text", "APSC course / NDP rehearsal / Cleared leave balance…", `maxlength="200" value="${escapeAttr(e?.reason)}" oninput="updateLeaveInCampDefault()"`)}
        <div class="form-group"><label>In Camp?</label><select id="f-in-camp" required onchange="markLeaveInCampTouched()" ${isEdit ? 'data-touched="1"' : ""}>
          <option value="true" ${inCampDefault ? "selected" : ""}>In Camp</option>
          <option value="false" ${!inCampDefault ? "selected" : ""}>Not In Camp</option>
        </select></div>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save" : "Log"}</button>
      </div>
    </form>`);
}
// Show exactly the picker owned by the active scope. Organisational scopes
// hide both because submitLeave resolves those targets through scopeRecruits.
function onLeaveScopeChange() {
  const scope = gv("f-leave-scope") || "person";
  const personWrap = document.getElementById("f-leave-person-wrap");
  const selectedWrap = document.getElementById("f-leave-selected-wrap");
  if (personWrap) personWrap.style.display = scope === "person" ? "" : "none";
  if (selectedWrap) selectedWrap.style.display = scope === "selected" ? "" : "none";
  if (scope === "selected") renderLeaveSelectedPeople();
}
// Auto-recompute the days field from the start/end date inputs on the leave
// form. Half-day edge case: users override after this fires.
function recalcLeaveDays() {
  const s = document.getElementById("f-start"), en = document.getElementById("f-end"), d = document.getElementById("f-days");
  if (!s || !en || !d || !s.value || !en.value) return;
  const diff = Math.round((new Date(en.value) - new Date(s.value)) / 86400000) + 1;
  if (diff > 0) d.value = diff;
}
// Leave form: Days → End (inclusive day-1), the counterpart to recalcLeaveDays()
// so a commander can drive the window from either side — mirrors the medical
// wizard's medRecalcEndFromDays(). Half-days are a QUOTA concept, not a calendar
// one: a 1.5-day leave still spans 2 calendar days and has no single defensible
// End, so a FRACTIONAL Days is deliberately left to drive nothing (the user keeps
// editing End by hand, exactly as before this feature). Only a whole-number Days
// fills End.
function recalcLeaveEndFromDays() {
  const s = document.getElementById("f-start"), d = document.getElementById("f-days"), e = document.getElementById("f-end");
  if (!s || !d || !e || !s.value) return;
  const n = Number(d.value);
  if (!Number.isInteger(n) || n < 1) return;
  const end = endDateFromStartAndDays(s.value, n);
  if (end) e.value = end;
}
// Start moved: prefer re-deriving End from a whole-number Days (the medical
// wizard's rule — moving Start slides the window, preserving the duration). A
// fractional Days can't produce a clean End, so fall back to recomputing Days
// from the existing End — which is exactly what f-start did before this feature,
// so the half-day path is unchanged.
function recalcLeaveStart() {
  const d = document.getElementById("f-days");
  const n = d ? Number(d.value) : NaN;
  if (Number.isInteger(n) && n >= 1) recalcLeaveEndFromDays();
  else recalcLeaveDays();
}
// Medical form: Days → End (inclusive day-1) and End → Days, kept consistent so
// a commander can drive the window from either side. Mirrors the Leave form's
// recalc but uses the shared pure helper. Pending/NIL leave all three blank.
function medRecalcEndFromDays() {
  const s = document.getElementById("f-start"), d = document.getElementById("f-days"), e = document.getElementById("f-end");
  if (!s || !d || !e || !s.value || !d.value) return;
  const end = endDateFromStartAndDays(s.value, +d.value);
  if (end) e.value = end;
}
function medSyncDaysFromEnd() {
  const s = document.getElementById("f-start"), d = document.getElementById("f-days"), e = document.getElementById("f-end");
  if (!s || !d || !e || !s.value || !e.value) return;
  const n = daysFromStartEndInclusive(s.value, e.value);
  if (n) d.value = n;
}
// Recompute one extra-status row's End from its Start + Days (inclusive day-1).
function medExtraRecalcEnd(el) {
  const row = el.closest(".med-extra-row");
  if (!row) return;
  const s = row.querySelector(".f-extra-start"), d = row.querySelector(".f-extra-days"), e = row.querySelector(".f-extra-end");
  if (!s || !d || !e || !s.value || !d.value) return;
  const end = endDateFromStartAndDays(s.value, +d.value);
  if (end) e.value = end;
}
function submitLeave() {
  const editId = +gv("f-entry-id");
  // Bulk "Apply to" scope (add mode only): one Leave row per resolved person,
  // pushed as a SINGLE appendMany rather than N upserts. Organisational scopes
  // remain recruit-only; "selected" can include commanders. Editing an entry
  // is always single-person (no scope selector rendered).
  const scope = editId ? "person" : (gv("f-leave-scope") || "person");
  if (scope !== "person") {
    const startIso = gv("f-start"), endIso = gv("f-end");
    if (endIso < startIso) { alert("End date must be on or after start date."); return; }
    const ids = scope === "selected"
      ? [...new Set(_leaveSelectedD4s)]
      : scopeRecruits(scope);
    if (!ids.length) {
      alert(scope === "selected"
        ? "Add at least one person to the selected group."
        : "No recruits in that scope.");
      return;
    }
    const type = gv("f-type");
    const noun = scope === "selected"
      ? (ids.length === 1 ? "person" : "people")
      : `recruit${ids.length === 1 ? "" : "s"}`;
    if (!confirm(`Log "${type}" for ${ids.length} ${noun}?`)) return;
    const base = {
      type,
      startDate: isoToDisplayDate(startIso),
      endDate: isoToDisplayDate(endIso),
      days: +gv("f-days") || 0,
      reason: gv("f-reason") || "",
      isInCamp: gv("f-in-camp") === "true",
      isInCampReviewed: true
    };
    const rows = ids.map(d4 => Object.assign({ id: nextId(), d4 }, base));
    rows.forEach(r => STATE.leave.push(r));
    saveLocal(); closeModal(); render();
    if (STATE.apiUrl) autoSync("Leave", { type: "appendMany", rows });
    return;
  }
  const d4 = gv("f-d4");
  if (!d4) { alert("Pick a person (search by name / 4D)."); return; }
  const startIso = gv("f-start");
  const endIso = gv("f-end");
  if (endIso < startIso) { alert("End date must be on or after start date."); return; }
  const prev = editId ? STATE.leave.find(l => l.id === editId) : null;
  const entry = {
    id: editId || nextId(),
    d4,
    type: gv("f-type"),
    startDate: isoToDisplayDate(startIso),
    endDate: isoToDisplayDate(endIso),
    days: +gv("f-days") || 0,
    reason: gv("f-reason") || "",
    isInCamp: gv("f-in-camp") === "true",
    isInCampReviewed: true,
    // bookInDate is immutable once stamped by "Mark Present" (PR #65) — carry it
    // forward on edit, or correcting this record's reason/dates silently un-books
    // someone already Present. See the matching fix/comment in submitMedical.
    bookInDate: prev ? (prev.bookInDate || "") : ""
  };
  if (editId) {
    const idx = STATE.leave.findIndex(l => l.id === editId);
    if (idx >= 0) STATE.leave[idx] = entry;
  } else {
    STATE.leave.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("Leave", { type: "upsert", row: entry });
}
