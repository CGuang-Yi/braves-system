// Generated messages (parade state, medical status, MSK, MR) and the fitness email reports.
//
// Split out of the original monolithic forms.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// ─── PARADE STATE + MEDICAL STATUS GENERATORS ─────────
// Compose the three battalion-format WhatsApp messages (First/Last Parade
// State + standalone Medical Status list) from live STATE. The PDS spec
// previously retyped these by hand from chats; now the dashboard generates
// an editable preview that round-trips to clipboard in one tap.

const SEP = "----------------------------------------------------------------";

// Statuses that have their own dedicated parade-state section (ATTC = MC/Warded,
// REPORT SICK = Pending) or are cleared (NIL). MEDICAL STATUS is the catch-all
// for every OTHER active restriction — LD, all Excuses, and any custom/one-off
// status (e.g. "Excuse Jumping") that isn't in the canonical MED_STATUSES list.
// Using an exclusion predicate instead of a hardcoded allowlist means a new or
// custom status can never silently fall through the cracks of the report.
const PARADE_SECTIONED_STATUSES = ["MC", "Warded", "Pending", "NIL"];
const isMedicalStatusCatchAll = s => !!s && !PARADE_SECTIONED_STATUSES.includes(s);

// "2026-05-20" → "200526" — battalion uses DDMMYY everywhere.
function toDDMMYY(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return m[3] + m[2] + m[1].slice(2);
}

// R/N formatting (spec §7). Delegates to the Braves implementation in
// braves-parade.js (loaded after this file, so the global is resolved by the
// time any UI calls paradeRN). Kept under the old name because the medical-
// status report still calls paradeRN; it gets Braves-format R/N
// ("MARTIN TAN B1411" / "LCP CALVIN LEE").
function paradeRN(d4) {
  return bravesParadeRN(d4);
}

// Duration label per chat samples ("Duration: 180526 - 010626"). Pending /
// NIL records have no end date; emit a single-day note instead.
function paradeDuration(record) {
  const s = displayDateToISO(record.startDate || record.date || "");
  const e = displayDateToISO(record.endDate || "");
  if (s && e) return `${toDDMMYY(s)} - ${toDDMMYY(e)}`;
  if (s) return toDDMMYY(s);
  return "";
}

// Day count for the status line ("Status: 5D MC"). Inclusive of both ends.
function paradeStatusLabel(record) {
  const s = displayDateToISO(record.startDate || "");
  const e = displayDateToISO(record.endDate || "");
  if (!record.status) return "";
  if (!s || !e) return record.status;
  const days = Math.round((new Date(e) - new Date(s)) / 86400000) + 1;
  return days > 0 ? `${days}D ${record.status}` : record.status;
}

// Per-person Medical Appointment dates for the MR (Medical Review) generator, keyed by
// 4D: { recent: "<iso>"|"", next: "<iso>"|"" }. Reset when the MR modal opens; a blank
// value renders as the literal NIL in the message.
let _mrDates = {};

// statusFilter is either an allowlist array (status ∈ list) or a predicate
// (status => boolean) — the latter lets MEDICAL STATUS act as a catch-all.
// Groups medical entries by d4 so a person with multiple active statuses
// appears under one S/N with stacked sub-entries.
function buildMedicalSection(label, dateIso, statusFilter) {
  const matchStatus = typeof statusFilter === "function"
    ? statusFilter
    : s => statusFilter.includes(s);
  let matches = STATE.medical.filter(m =>
    medStatusActive(m, dateIso) && matchStatus(m.status)
  );

  const byD4 = {};
  matches.forEach(m => { (byD4[m.d4] = byD4[m.d4] || []).push(m); });
  // Collapse same-status duplicates per recruit (a re-issued MC) to the most
  // recent record so it prints once, with the newest dates.
  Object.keys(byD4).forEach(d4 => { byD4[d4] = dedupeActiveRecordsByFamily(byD4[d4]); });
  const peopleIds = Object.keys(byD4);

  if (!peopleIds.length) {
    return `${label}:\n\nS/N:\nR/N:\nReason:`;
  }

  const blocks = peopleIds.map((d4, idx) => {
    const records = byD4[d4];
    const sn = String(idx + 1).padStart(2, "0");
    const rn = paradeRN(d4);
    // Use the first record's reason as the headline — multi-status entries
    // typically share an underlying cause (per BENJAMIN sample).
    const reason = records[0].reason || "";
    // Location line only renders for report-sick-outside cases (external
    // clinic/hospital). In-camp report sicks leave it blank → omitted entirely.
    const location = records.map(r => r.location).find(v => v && String(v).trim()) || "";
    const locationLine = location ? `\nLocation: ${location}` : "";

    if (records.length === 1) {
      const r = records[0];
      return `S/N: ${sn}\nR/N: ${rn}\nReason: ${reason}${locationLine}\nStatus: ${paradeStatusLabel(r)}\nDuration: ${paradeDuration(r)}`;
    }
    // Multi-status: stack numbered Status + Duration pairs under one R/N.
    const subStatuses = records.map((r, i) =>
      `${i + 1}. ${paradeStatusLabel(r)}\nDuration: ${paradeDuration(r)}`
    ).join("\n");
    return `S/N: ${sn}\nR/N: ${rn}\nReason: ${reason}${locationLine}\nStatus received:\n${subStatuses}`;
  });

  return `${label}: ${String(peopleIds.length).padStart(2, "0")}\n\n${blocks.join("\n\n")}`;
}

// Parse an appointment's time field to "minutes since midnight" so we can
// compare it against the parade time. Handles "0930", "09:30", "0700-2100"
// (uses the END of a range — appt still ongoing if range covers parade
// time). Returns Infinity for unparseable input so the row is shown by
// default (safer than hiding it silently).
function apptEndMinutes(timeStr) {
  const s = String(timeStr || "").replace(/\s/g, "");
  const range = s.match(/(\d{1,4}):?(\d{0,2})\s*[-–]\s*(\d{1,4}):?(\d{0,2})/);
  if (range) {
    const hh = String(range[3]).padStart(4, "0").slice(0, 2);
    const mm = (range[4] || String(range[3]).padStart(4, "0").slice(2, 4)).padStart(2, "0");
    return parseInt(hh, 10) * 60 + parseInt(mm, 10);
  }
  const single = s.match(/(\d{3,4})/);
  if (single) {
    const padded = single[1].padStart(4, "0");
    return parseInt(padded.slice(0, 2), 10) * 60 + parseInt(padded.slice(2, 4), 10);
  }
  return Infinity;
}

function paradeTimeMinutes(timeStr) {
  const padded = String(timeStr || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  return parseInt(padded.slice(0, 2), 10) * 60 + parseInt(padded.slice(2, 4), 10);
}

// The upcoming appointments a parade state will list: the parade date plus all
// future dates. The time-of-day cutoff only applies on the parade day itself —
// a same-day appt that's already passed is dropped, but a future-dated one
// always shows regardless of its time. Sorted chronologically (date, then time).
//
// ORPHAN (2026-07-29): currently has zero callers. The comment here used to claim
// it was "shared by the report generator and the in/out-of-camp tick checklist" —
// the checklist was deleted as dead code, and the Braves §8–9 generator
// (js/braves-parade.js) does not call this. Deliberately kept rather than deleted
// with that cleanup: unlike the checklist cluster this looks like a newer helper
// that was never wired up, not leftover-from-retirement, so it needs its intended
// caller traced before it's removed. Don't add callers without checking that the
// generator doesn't already derive the same list.
function upcomingParadeAppointments(dateIso, paradeTime) {
  const paradeMins = paradeTimeMinutes(paradeTime);
  return STATE.appointments
    .filter(a => !a.resolved)
    .filter(a => {
      const iso = displayDateToISO(a.date) || "";
      if (!iso || iso < dateIso) return false;
      if (iso === dateIso) return apptEndMinutes(a.time) >= paradeMins;
      return true;
    })
    .sort((a, b) => {
      const ai = displayDateToISO(a.date) || "";
      const bi = displayDateToISO(b.date) || "";
      if (ai !== bi) return ai < bi ? -1 : 1;
      return apptEndMinutes(a.time) - apptEndMinutes(b.time);
    });
}

// NOTE: the legacy Cougar parade-state builders (buildAppointmentSection,
// buildOthersSection, buildStrengthBlock, generateParadeStateText) lived here.
// They were retired in Step 3 — FP/LP now use the Braves §7–9 generator in
// js/braves-parade.js (generateBravesParadeState, routed from regenerateReport).
// See DECISIONS #36/#37.
//
// The manual borderline/out-of-camp tick checklists that fed those builders
// (findBorderlineReturnees, outsideApptsForParade, apptCurrentlyOut,
// outOfCampApptsForParade, their _paradeOverrides/_apptCampOverrides maps, and
// the render/toggle/onchange handlers) were retired at the same time but only
// deleted on 2026-07-29 — an earlier revision of this NOTE wrongly claimed they
// "remain in use", which is how ~150 lines of unreachable code survived review.
// They are NOT to be reinstated: the §8–9 generator derives both facts from
// stored data (bookInDate/bookedInBy for returnees, the appointment records'
// own fields for out-of-camp), so a manual tick UI would reintroduce a parallel
// unsynced source of truth for exactly the state Step 3 automated away.
// The medical-status report below is unaffected and remains in use.

function generateMedicalStatusText(dateIso, time) {
  const dateStr = toDDMMYY(dateIso);
  const heading = `${dateStr}(latest version as of ${dateStr} @${fmtHrs(time)})`;
  const body = buildMedicalSection("MEDICAL STATUS", dateIso, isMedicalStatusCatchAll);
  return `${heading}\n\n${body}`;
}

// MSK snapshot — one entry per active (non-cleared) case. Reason is the
// latest injury description; Last visit is the most recent physio log
// date for that recruit (or N/A if no exercises logged yet).
// 4D rendered without the "C" prefix per the user's preferred format.
function generateMSKReportText(dateIso, time) {
  const byD4 = {};
  STATE.msk.forEach(m => { (byD4[m.d4] = byD4[m.d4] || []).push(m); });

  const tsOf = r => String(r.timestamp || "");
  const cases = Object.entries(byD4)
    .map(([d4, rows]) => ({ d4, rows, allCleared: rows.every(r => r.cleared) }))
    .filter(c => !c.allCleared);

  const dateStr = toDDMMYY(dateIso);
  const heading = `MSK: ${String(cases.length).padStart(2, "0")} (as of ${dateStr} @${fmtHrs(time)})`;

  if (!cases.length) return `${heading}\n\nNo active MSK cases.`;

  const rnNoC = d4 => {
    const r = STATE.roster.find(x => x.id === d4);
    if (!r) return d4;
    const name = (r.name || "").toUpperCase();
    if (r.role === "Commander") return [r.rank, name].filter(Boolean).join(" ");
    const bareId = String(r.id).replace(/^C/i, "");
    return `REC ${name} ${bareId}`;
  };

  const blocks = cases.map((c, idx) => {
    const sn = String(idx + 1).padStart(2, "0");
    const injuries = c.rows.filter(r => (r.type || "").toLowerCase().includes("report"));
    const exercises = c.rows.filter(r => (r.type || "").toLowerCase().includes("log") || (r.type || "").toLowerCase().includes("exercise"));
    const latestInjury = [...injuries].sort((a, b) => tsOf(a) < tsOf(b) ? 1 : -1)[0];
    const reason = latestInjury?.description || "";
    const latestExercise = [...exercises].sort((a, b) => tsOf(a) < tsOf(b) ? 1 : -1)[0];
    let lastVisit = "N/A";
    if (latestExercise) {
      const d = latestExercise.physioDate || latestExercise.timestamp || "";
      const iso = displayDateToISO(d);
      lastVisit = iso ? toDDMMYY(iso) : d;
    }
    return `S/N: ${sn}\nR/N: ${rnNoC(c.d4)}\nReason: ${reason}\nLast visit: ${lastVisit}`;
  });

  return `${heading}\n\n${blocks.join("\n\n")}`;
}

// Distinct 4Ds with a PENDING MR (Medical Review) visit dated to `dateIso`, ordered by
// platoon then name. Mirrors the §8 classifier's MR clause for an arbitrary chosen date.
function mrPeopleForDate(dateIso) {
  const seen = {};
  const out = [];
  (STATE.medical || []).forEach(m => {
    if (m.type !== "MR") return;
    if (displayDateToISO(m.date) !== dateIso) return;
    if (m.status && m.status !== "Pending") return;
    if (seen[m.d4]) return;
    seen[m.d4] = true;
    out.push(m.d4);
  });
  return out.sort((a, b) => {
    const ra = STATE.roster.find(x => x.id === a) || {};
    const rb = STATE.roster.find(x => x.id === b) || {};
    const pa = personPlatoon(ra) || "", pb = personPlatoon(rb) || "";
    if (pa !== pb) return pa < pb ? -1 : 1;
    return (ra.name || "").localeCompare(rb.name || "");
  });
}

// "RANK FULLNAME" (name uppercased) from the roster; falls back to the raw 4D.
// Rank via bpDisplayRank (braves-parade.js) so a blank-rank recruit reads "REC"
// here exactly as it does in the parade state and the sick message — the three
// generators stay separate by design, but they must not disagree about a person.
// braves-parade.js loads AFTER this file; that's fine, the call is at run time.
function mrRankName(d4) {
  const r = STATE.roster.find(x => x.id === d4);
  if (!r) return d4;
  return [bpDisplayRank(r), (r.name || "").toUpperCase()].filter(Boolean).join(" ");
}

// MR (Medical Review) message — "MR Message Format" in MD_Docs/Message Formats.md.
// Auto-lists pending MR personnel for the date; Rank+Name + Coy prefilled, NRIC never
// asked, MA dates from _mrDates (blank → NIL), everything else left blank for manual fill.
function generateMRFormat(dateIso, time) {
  const heading = `B COY *MEDICAL REVIEW* ${toDDMMYY(dateIso)}`;
  const people = mrPeopleForDate(dateIso);
  if (!people.length) return `${heading}\n\nNo personnel on medical review.`;
  const mad = iso => (iso ? toDDMMYY(iso) : "NIL");
  const blocks = people.map((d4, i) => {
    const d = (_mrDates && _mrDates[d4]) || {};
    return `${i + 1}) Rank + Full Name: ${mrRankName(d4)}\n`
      + `Coy: B\n`
      + `NRIC: \n`
      + `Diagnosis/Issue: \n`
      + `Date of most recent Medical Appointment: ${mad(d.recent)}\n`
      + `Date of next MA: ${mad(d.next)}\n`
      + `Memo (Yes/No): \n`
      + `Remarks/ Requests: `;
  });
  return `${heading}\n\n${blocks.join("\n\n")}`;
}

function openReportModal(type) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const defaultDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultTime = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const titleLabel = type === "FP" ? "First Parade State"
    : type === "LP" ? "Last Parade State"
    : type === "RS" ? "RS Format (Sick Report)"
    : type === "RSIP" ? "RSI Personnel (by Platoon)"
    : type === "MSK" ? "MSK Report"
    : type === "CONDUCT" ? "Per-Conduct Chat Format"
    : type === "MR" ? "MR (Medical Review)"
    : "Medical Status List";

  // FP/LP now use the Braves §8–9 generator (js/braves-parade.js), which derives
  // every category from stored data — so the parade modal just re-runs the
  // generator on any date/time/scope change (no live checklists to re-render).
  const isParade = type === "FP" || type === "LP";
  const isConduct = type === "CONDUCT";
  const isMR = type === "MR";
  const dateExtra = isParade
    ? `value="${defaultDate}" required onchange="regenerateReport('${type}')"`
    : isConduct
      ? `value="${defaultDate}" required onchange="renderConductPicker(); regenerateReport('CONDUCT')"`
      : isMR
        ? `value="${defaultDate}" required onchange="renderMRDateFields(); regenerateReport('MR')"`
        : `value="${defaultDate}" required`;
  const timeExtra = isConduct
    ? `value="${defaultTime}" maxlength="4" pattern="[0-9]{4}" required onchange="renderConductPicker(); regenerateReport('CONDUCT')"`
    : isParade
      ? `value="${defaultTime}" maxlength="4" pattern="[0-9]{4}" required onchange="regenerateReport('${type}')"`
      : `value="${defaultTime}" maxlength="4" pattern="[0-9]{4}" required`;

  // Company / per-platoon (incl. HQ) scope selector for the parade state.
  // Value "company" → whole-company combined message; "platoon:<code>" → just
  // that platoon's standalone block. Options derive from activePlatoons() so the
  // list tracks the org structure (spec §9.1/§9.2, addendum A6).
  const scopeOptions = isParade
    ? [`<option value="company">Company (full parade state)</option>`]
        .concat(activePlatoons().map(p =>
          `<option value="platoon:${escapeAttr(p.code)}">${escapeAttr(p.displayName || p.code)}</option>`))
        .join("")
    : "";

  // Platoon filter for the RSI Personnel report — mirrors the parade scope
  // selector pattern but defaults to "All platoons" (full company).
  const isRSIP = type === "RSIP";

  // RS Format AND RSI Personnel offer an "omit personnel already on status"
  // toggle: anyone carrying an unexpired MC/LD/Warded/Excuse is suppressed, so the
  // message lists only the cases still open. That covers a status carried in from
  // an earlier visit AND one the MO issued at this morning's report sick — see
  // bpHasCoveringStatus. (RS Format — 2026-07-20; extended to RSI Personnel —
  // PR feat/rsip-omit-on-status; widened to same-visit statuses 2026-08-02.)
  const showOmitToggle = type === "RS" || type === "RSIP";

  openModal("Generate " + titleLabel, `
    <form onsubmit="event.preventDefault(); regenerateReport('${type}'); return false">
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px">
          ${isConduct
            ? `Pick a logged conduct (filtered by date/time) → message generates from the saved attendance + conductDetail rows. Tap <strong>Copy to Clipboard</strong> when ready and paste into WhatsApp.`
            : `Adjust date/time → tap <strong>Regenerate</strong>. The textarea is editable for last-minute tweaks (e.g. "latest version as of…", manual corrections). Tap <strong>Copy to Clipboard</strong> when ready and paste into WhatsApp.`}
        </div>
        <div class="form-row">
          ${formField("rep-date", "Date", "date", "", dateExtra)}
          ${formField("rep-time", "Time (HHMM)", "text", "0700", timeExtra)}
        </div>
        ${isParade ? `<div class="form-group">
          <label>Scope</label>
          <select id="rep-scope" onchange="regenerateReport('${type}')" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;width:100%">
            ${scopeOptions}
          </select>
        </div>` : ""}
        ${isRSIP ? `<div class="form-group">
          <label>Platoon</label>
          <select id="rep-scope" onchange="regenerateReport('RSIP')" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;width:100%">
            <option value="company">All platoons</option>
            ${activePlatoons().map(p => `<option value="platoon:${escapeAttr(p.code)}">${escapeAttr(p.displayName || p.code)}</option>`).join("")}
          </select>
        </div>` : ""}
        ${showOmitToggle ? `<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);cursor:pointer;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
          <input type="checkbox" id="rep-omit-status" onchange="regenerateReport('${type}')" style="width:15px;height:15px;cursor:pointer">
          <span>Omit personnel already on status <span style="color:var(--muted)">(hide anyone on an unexpired MC/LD/status, including one issued at today's visit — leaves only the cases still awaiting an outcome)</span></span>
        </label>` : ""}
        ${isConduct ? `<div id="rep-conduct-picker"></div>` : ""}
        ${isMR ? `<div id="rep-mr-dates" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px"></div>` : ""}
        <button type="submit" class="btn">↻ Regenerate</button>
        <textarea id="rep-text" rows="20" spellcheck="false" style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.45;resize:vertical;white-space:pre"></textarea>
        <button type="button" id="rep-copy-btn" class="btn btn-success" onclick="copyReportToClipboard()">📋 Copy to Clipboard</button>
      </div>
    </form>
  `);
  // Stash the report type so regenerate from the date/time onchange knows
  // which composer to call.
  document.getElementById("rep-text").dataset.type = type;
  if (isConduct) renderConductPicker();
  if (isMR) { _mrDates = {}; renderMRDateFields(); }
  regenerateReport(type);
}

// Renders the Conduct picker dropdown inside the CONDUCT report modal.
// Lists every attendance row whose date matches (time is best-effort filter).
// Picking a conduct triggers regenerateReport('CONDUCT') so the textarea
// updates in place.
function renderConductPicker() {
  const host = document.getElementById("rep-conduct-picker");
  if (!host) return;
  const dateIso = gv("rep-date");
  const time = gv("rep-time") || "";
  const date = isoToDisplayDate(dateIso);
  // Filter by date; if time is set, prefer matches but include all on the date.
  const matches = STATE.attendance
    .filter(a => a.date === date)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const exactMatch = matches.find(a => (a.time || "") === time);
  const selectedId = exactMatch ? exactMatch.id : (matches[0]?.id || "");
  if (!matches.length) {
    host.innerHTML = `<div style="font-size:11px;color:var(--orange);background:#D2992222;border:1px solid #D2992244;border-radius:6px;padding:6px 10px">No conducts logged on ${escapeHTML(date || dateIso)}. Log one first via the Attendance tab.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="form-group">
      <label>Conduct</label>
      <select id="rep-conduct-id" onchange="regenerateReport('CONDUCT')" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;width:100%">
        ${matches.map(a => `<option value="${a.id}" ${a.id === selectedId ? "selected" : ""}>${a.time || "----"} · ${escapeAttr(conductName(a.conductId) || "(unknown)")} (${a.participating}/${a.total})</option>`).join("")}
      </select>
    </div>
  `;
}

// Renders one row per pending-MR person for the modal date, each with two optional
// Medical-Appointment date inputs (most recent / next). Blank stays blank → NIL in the
// message. Parallels renderConductPicker.
function renderMRDateFields() {
  const host = document.getElementById("rep-mr-dates");
  if (!host) return;
  const dateIso = gv("rep-date");
  const people = mrPeopleForDate(dateIso);
  if (!people.length) {
    host.innerHTML = `<div style="font-size:11px;color:var(--muted)">No pending medical reviews on this date.</div>`;
    return;
  }
  host.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Medical Appointment dates (optional — leave blank for NIL). Columns: most recent · next.</div>`
    + people.map(d4 => {
        const d = (_mrDates && _mrDates[d4]) || {};
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11px">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAttr(mrRankName(d4))}">${escapeHTML(mrRankName(d4))}</span>
          <input type="date" value="${escapeAttr(d.recent || "")}" title="Most recent MA" onchange="setMRDate('${d4}','recent',this.value)" style="font-size:11px;padding:2px 4px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:3px">
          <input type="date" value="${escapeAttr(d.next || "")}" title="Next MA" onchange="setMRDate('${d4}','next',this.value)" style="font-size:11px;padding:2px 4px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:3px">
        </div>`;
      }).join("");
}

// Stores an MR person's MA date (recent|next) and regenerates the message.
function setMRDate(d4, which, iso) {
  if (!_mrDates[d4]) _mrDates[d4] = { recent: "", next: "" };
  _mrDates[d4][which] = iso || "";
  regenerateReport("MR");
}

function regenerateReport(type) {
  const dateIso = gv("rep-date");
  const time = gv("rep-time") || "0700";
  let text;
  if (type === "MED") text = generateMedicalStatusText(dateIso, time);
  else if (type === "MSK") text = generateMSKReportText(dateIso, time);
  else if (type === "MR") text = generateMRFormat(dateIso, time);
  else if (type === "RS") text = generateRSFormat(dateIso, time, { omitOnStatus: !!document.getElementById("rep-omit-status")?.checked });
  else if (type === "RSIP") {
    const sc = document.getElementById("rep-scope")?.value || "company";
    const code = sc.startsWith("platoon:") ? sc.slice("platoon:".length) : "";
    text = generateRSIPersonnel(dateIso, time, code, { omitOnStatus: !!document.getElementById("rep-omit-status")?.checked });
  }
  else if (type === "CONDUCT") {
    const id = +gv("rep-conduct-id") || null;
    text = id ? buildConductChatFormat(id) : "Pick a conduct from the dropdown above.";
  } else {
    // FP / LP → Braves §8–9 parade state (js/braves-parade.js). The scope
    // selector picks company vs a single platoon/HQ block.
    const sv = gv("rep-scope") || "company";
    const scope = sv === "company"
      ? { level: "company" }
      : { level: "platoon", platoon: sv.split(":")[1] };
    text = generateBravesParadeState(scope, type, dateIso, time);
  }
  document.getElementById("rep-text").value = text;
}

async function copyReportToClipboard() {
  const ta = document.getElementById("rep-text");
  const btn = document.getElementById("rep-copy-btn");
  const text = ta.value;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "✓ Copied!";
      setTimeout(() => { btn.textContent = original; }, 1800);
    }
  } catch {
    // Fallback: select all in the textarea so the user can manually Cmd+C.
    ta.focus(); ta.select();
    alert("Copy blocked — text is selected, press Cmd+C / Ctrl+C to copy.");
  }
}

// ─── FITNESS REPORTS (email to recruits) ────────────────
// Builds a personalized HTML report per recruit with their Polar trends,
// conduct attendance, and an auto-picked encouragement line. Charts are
// rendered to off-screen canvases and base64-embedded so the email is
// fully self-contained (no external image hosting needed).

// Renders a Chart.js config to a base64 JPEG synchronously by disabling
// animation. JPEG (not PNG) because MailApp.sendEmail caps the htmlBody
// at 200KB and base64-encoded PNGs of these charts blow past that with
// 3+ charts. JPEG at 0.85 quality is ~5× smaller with no visible loss
// on line/bar charts.
//
// Trick: paint the white background AFTER Chart.js renders, using
// destination-over so the fill sits UNDER the existing chart pixels.
// Painting before doesn't work — Chart.js clears the canvas on draw.
function renderChartPNG(chartConfig, width = 500, height = 230) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const chart = new Chart(canvas, {
    ...chartConfig,
    options: {
      ...(chartConfig.options || {}),
      animation: false,
      responsive: false,
      maintainAspectRatio: false
    }
  });
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  chart.destroy();
  return jpeg;
}

// Compute polar-derived metrics (efficiency, workload) for a list of
// raw STATE.polar rows. Returns rows enriched + sorted ascending by date.
function computeFitnessMetrics(rows) {
  return rows.map(p => {
    const avg = +p.avgHr || 0, max = +p.maxHr || 0, cal = +p.calories || 0, dur = +p.duration || 0;
    return {
      date: p.date, conduct: conductName(p.conductId),
      iso: displayDateToISO(p.date) || "",
      avgHr: avg, maxHr: max, calories: cal, duration: dur,
      efficiency: avg ? +(cal / avg).toFixed(2) : 0,
      workload: avg * dur
    };
  }).filter(p => p.iso).sort((a, b) => a.iso < b.iso ? -1 : 1);
}

// Counts how many distinct PT conducts (date+conductId tuples) fell inside
// [startIso, endIso]. A conduct is considered "PT" when at least one recruit
// has a Polar/LMS entry for it — the Polar class summary photo is the
// authoritative signal that the session involved actual PT. Lecture-style
// or admin "conducts" (e.g. lectures, IPPT registration sessions) get
// attendance rows but no Polar data, so they're excluded from the denominator.
// This makes "Conducts attended X / Y" reflect the recruit's PT participation
// rather than every administrative gathering.
function countCompanyConductsInWindow(startIso, endIso) {
  // Set of "iso|conductId" keys that have at least one Polar entry in window.
  const ptKeys = new Set();
  STATE.polar.forEach(p => {
    if (!p.conductId) return;
    const iso = displayDateToISO(p.date);
    if (iso && iso >= startIso && iso <= endIso) ptKeys.add(`${iso}|${p.conductId}`);
  });
  // Intersect with the attendance log so we count only conducts the company
  // actually logged (avoids counting one-off polar entries that lack a real
  // attendance row).
  const tuples = new Set();
  STATE.attendance.forEach(a => {
    const iso = displayDateToISO(a.date);
    if (!iso || iso < startIso || iso > endIso || !a.conductId) return;
    const key = `${iso}|${a.conductId}`;
    if (ptKeys.has(key)) tuples.add(key);
  });
  return tuples.size;
}

// MC-days overlapping window — sum of (end - start + 1) clamped to window.
function countMCDaysInWindow(d4, startIso, endIso) {
  let days = 0;
  STATE.medical
    .filter(m => m.d4 === d4 && (m.status === "MC" || m.status === "Warded"))
    .forEach(m => {
      const s = displayDateToISO(m.startDate || "");
      const e = displayDateToISO(m.endDate || "");
      if (!s || !e) return;
      const lo = s < startIso ? startIso : s;
      const hi = e > endIso ? endIso : e;
      if (lo > hi) return;
      days += Math.round((new Date(hi) - new Date(lo)) / 86400000) + 1;
    });
  return days;
}

// Composes the full HTML email body for one recruit. Returns:
//   { htmlForEmail, htmlForPreview, inlineImages }
// htmlForEmail uses <img src="cid:..."> refs paired with `inlineImages`
// (Gmail blocks data: URIs in img src — cid: works fine).
// htmlForPreview uses inline data: URIs so it can render in an <iframe>.
// inlineImages is { cid_name: base64_string_without_prefix } passed to
// API.sendEmail along with htmlForEmail.
function buildFitnessReportHTML(d4, startIso, endIso) {
  const r = STATE.roster.find(x => x.id === d4);
  if (!r) return `<p>Recruit ${escapeHTML(d4)} not found.</p>`;

  // Pull every per-recruit data slice inside the window.
  const polar = computeFitnessMetrics(
    STATE.polar.filter(p => p.d4 === d4).filter(p => {
      const iso = displayDateToISO(p.date);
      return iso && iso >= startIso && iso <= endIso;
    })
  );
  const totalCoyConducts = countCompanyConductsInWindow(startIso, endIso);

  // Conducts in this window where this recruit was logged as not
  // participating. ReportSick is excluded — it happens mid-day, after the
  // conduct, so the recruit was present for the actual PT itself.
  const conductDetailRows = STATE.conductDetail.filter(c => {
    if (c.d4 !== d4) return false;
    const iso = displayDateToISO(c.date);
    return iso && iso >= startIso && iso <= endIso;
  });
  // PX = present doing stretches → not a miss; only Status/RSI/Fallout count.
  const skippedRows = conductDetailRows.filter(c => c.type === "Status" || c.type === "RSI" || c.type === "Fallout");
  const missedCount = skippedRows.length;
  const missedBreakdown = ["Status", "RSI", "Fallout"]
    .map(t => ({ t, n: skippedRows.filter(m => m.type === t).length }))
    .filter(x => x.n > 0)
    .map(x => `${x.n} ${x.t}`).join(" · ") || "none";

  // Conducts attended = total minus those they were absent from.
  // Polar classes joined = how many of those conducts they wore the watch for.
  // Attendance % is now the per-person "added-in" rate (present ÷ conducts the recruit
  // was in the participant list of OR logged absent for) over the window — the same
  // definition the Conduct Dashboard uses. totalCoyConducts (all company PT conducts)
  // stays below only as the Polar-tile denominator.
  const _ppAttn = STATE.attendance.filter(a => { const i = displayDateToISO(a.date); return i && i >= startIso && i <= endIso; });
  const _ppDetail = STATE.conductDetail.filter(c => { const i = displayDateToISO(c.date); return i && i >= startIso && i <= endIso; });
  const _pp = personParticipation(_ppAttn, _ppDetail, null)[d4] || { present: 0, addedIn: 0, pct: null };
  const conductsAttended = _pp.present;
  const conductsAddedIn = _pp.addedIn;
  const attendanceRate = _pp.pct == null ? 0 : _pp.pct;
  const polarJoined = polar.length;
  const polarRate = totalCoyConducts ? Math.round((polarJoined / totalCoyConducts) * 100) : 0;
  // Report Sick = days the recruit was sent to MO mid-day after a conduct
  // (ReportSick conductDetail entries). Deduped by date because a single
  // recruit can fall out of multiple conducts on the same day (e.g. MC2,
  // gym ori, SC3) and get logged in each conduct's Report Sick list — but
  // they only went to MO once that day, so it's one event.
  const reportSickCount = new Set(
    conductDetailRows.filter(c => c.type === "ReportSick").map(c => c.date)
  ).size;
  // IPPT history: ALL attempts for the recruit, not just within the window.
  // The point of IPPT in a fitness report is to show fitness trajectory —
  // limiting to the window hides whether the recruit is on an improving
  // arc or plateauing. Sort by date so the chart reads left-to-right as
  // time progresses; fall back to attempt# when dates are missing.
  const ippts = STATE.ippt.filter(i => i.d4 === d4)
    .sort((a, b) => {
      const ai = displayDateToISO(a.date) || "";
      const bi = displayDateToISO(b.date) || "";
      if (ai !== bi) return ai < bi ? -1 : 1;
      return (+a.attempt || 0) - (+b.attempt || 0);
    });

  // Auto-encouragement: pick strongest positive trend.
  let encouragement;
  if (polar.length >= 2) {
    const first = polar[0], last = polar[polar.length - 1];
    const avgHrDelta = first.avgHr ? ((last.avgHr - first.avgHr) / first.avgHr) : 0;
    const effDelta = first.efficiency ? ((last.efficiency - first.efficiency) / first.efficiency) : 0;
    if (avgHrDelta < -0.05) {
      const drop = first.avgHr - last.avgHr;
      encouragement = `Your average HR has dropped <strong>${drop} bpm</strong> since ${first.date} — that's your heart working smarter, not harder. Real fitness gains.`;
    } else if (effDelta > 0.1) {
      encouragement = `Your cardio efficiency improved by <strong>${Math.round(effDelta * 100)}%</strong> in this window — every session is paying off.`;
    } else if (attendanceRate >= 90) {
      encouragement = `You showed up to <strong>${attendanceRate}%</strong> of conducts in this window. Consistency is the #1 driver of fitness — keep it going.`;
    }
  }
  if (!encouragement) {
    encouragement = `Every session counts. Small daily gains add up — keep showing up.`;
  }

  // Charts — each gets a unique cid so the email can use <img src="cid:..">
  // while the preview iframe uses the equivalent data: URI inline.
  const labels = polar.map(p => p.date.split(" ").slice(0, 2).join(" "));
  const charts = [];
  const inlineImages = {};
  let cidCounter = 0;
  const addChart = (entry, config) => {
    const cid = `chart_${cidCounter++}`;
    const dataUrl = renderChartPNG(config);
    inlineImages[cid] = dataUrl.split("base64,")[1] || "";
    charts.push({ ...entry, cid, dataUrl });
  };

  if (polar.length) {
    addChart({
      emoji: "❤", title: "Heart Rate Trend",
      caption: "Your average and peak heart rate across each session. As you get fitter, your average HR for the same workload drops — your heart pumps more blood per beat, so it doesn't have to work as hard. A steady downward trend in the blue line over weeks is the clearest signal of improving cardio fitness."
    }, {
      type: "line",
      data: { labels, datasets: [
        { label: "Avg HR", data: polar.map(p => p.avgHr), borderColor: "#58A6FF", backgroundColor: "#58A6FF22", tension: 0.3, pointRadius: 3 },
        { label: "Max HR", data: polar.map(p => p.maxHr), borderColor: "#F85149", backgroundColor: "#F8514922", tension: 0.3, pointRadius: 3 }
      ] },
      options: { plugins: { legend: { position: "bottom" } }, scales: { y: { title: { display: true, text: "bpm" } } } }
    });
    addChart({
      emoji: "⚡", title: "Cardio Efficiency",
      caption: "Calories burned per heartbeat (kcal ÷ avg HR). The higher this number, the more useful work your body produces per beat. When this line trends upward, your cardiovascular system is becoming more efficient — that's the kind of fitness gain that translates directly to faster runs, longer endurance, and lower 2.4 km times."
    }, {
      type: "line",
      data: { labels, datasets: [{ label: "Efficiency", data: polar.map(p => p.efficiency), borderColor: "#39D2C0", backgroundColor: "#39D2C033", tension: 0.3, fill: true, pointRadius: 3 }] },
      options: { plugins: { legend: { display: false } } }
    });
    addChart({
      emoji: "💪", title: "Cardiac Workload per Session",
      caption: "Total stress on your heart per session (avg HR × duration in minutes). This is the volume of training you're putting in. The shape of the bars matters more than the height — consistent, regular bars build aerobic base. Big spikes followed by long gaps don't. Showing up matters more than going hard."
    }, {
      type: "bar",
      data: { labels, datasets: [{ data: polar.map(p => p.workload), backgroundColor: "#BC8CFF44", borderColor: "#BC8CFF", borderWidth: 1 }] },
      options: { plugins: { legend: { display: false } } }
    });
  }
  // IPPT history table — one row per attempt with per-station score breakdown.
  // Inline HTML <table> (not a chart image) so it renders as text in both
  // email and preview, and so the reader can read the reps/time/points
  // directly. Per-station points are recomputed from the scoring tables on
  // the fly using the recruit's current age — keeps historical entries
  // consistent if scoring tiers ever change.
  const awardColorMap = { "Gold★": "#BC8CFF", "Gold": "#D29922", "Silver": "#8B949E", "Pass": "#1A7F37", "Fail": "#F85149" };
  const ipptRows = ippts.map(i => {
    const calc = calculateIPPTScore(r.age, i.pushups, i.situps, i.runTime);
    const puPts = calc ? calc.pushupScore : "—";
    const suPts = calc ? calc.situpScore : "—";
    const runPts = calc ? calc.runScore : "—";
    const total = +i.score || (calc ? calc.total : 0);
    const award = ipptAward(total);
    const awardColor = awardColorMap[award] || "#6E7681";
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E1E4E8;font-size:12px;color:#6E7681;white-space:nowrap">${i.date || "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E1E4E8;font-size:12px;text-align:center">${i.attempt || "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E1E4E8;font-size:12px;text-align:center"><strong>${i.pushups ?? "—"}</strong> <span style="color:#8B949E">·</span> <span style="color:#1F6FEB;font-weight:600">${puPts}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #E1E4E8;font-size:12px;text-align:center"><strong>${i.situps ?? "—"}</strong> <span style="color:#8B949E">·</span> <span style="color:#1F6FEB;font-weight:600">${suPts}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #E1E4E8;font-size:12px;text-align:center"><strong>${i.runTime || "—"}</strong> <span style="color:#8B949E">·</span> <span style="color:#1F6FEB;font-weight:600">${runPts}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #E1E4E8;font-size:14px;text-align:center;font-weight:700;color:#161B22">${total}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E1E4E8;font-size:11px;text-align:center;font-weight:700;color:${awardColor}">${award}</td>
    </tr>`;
  }).join("");
  const ipptTableHTML = ippts.length ? `
    <h2 style="font-size:16px;color:#161B22;margin:24px 0 4px">🏃 IPPT History <span style="font-size:11px;color:#6E7681;font-weight:400">(${ippts.length} attempt${ippts.length === 1 ? "" : "s"})</span></h2>
    <p style="font-size:12px;color:#6E7681;margin:0 0 10px;line-height:1.5">Every IPPT attempt logged. IPPT is the litmus test for overall fitness — the trend across attempts tells you more than any single score. Numbers shown as <strong>reps/time</strong> · <span style="color:#1F6FEB;font-weight:600">points</span>.</p>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #E1E4E8;border-radius:6px;overflow:hidden;margin-bottom:8px">
      <thead>
        <tr style="background:#F6F8FA">
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E1E4E8">Date</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E1E4E8">#</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E1E4E8">Push-ups</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E1E4E8">Sit-ups</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E1E4E8">2.4km Run</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E1E4E8">Total</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E1E4E8">Award</th>
        </tr>
      </thead>
      <tbody>${ipptRows}</tbody>
    </table>
    <p style="font-size:10px;color:#8B949E;margin:0 0 16px;line-height:1.5">Tiers: ≥61 Pass · ≥75 Silver · ≥85 Gold · ≥90 Gold★ (NDU / Commando / Guards)</p>
  ` : "";

  const startNice = isoToDisplayDate(startIso);
  const endNice = isoToDisplayDate(endIso);
  const bareId = String(r.id).replace(/^C/i, "");
  const recHeader = `REC ${escapeHTML((r.name || "").toUpperCase())} ${bareId}`;

  // Two parallel chart blocks — same layout/captions, different image src.
  const noChartsBlock = `<p style="background:#FFF8E1;border:1px solid #FFE082;padding:12px;border-radius:6px;color:#5D4037;font-size:13px">No Polar sessions logged in this window — we'd love to see you in the next one.</p>`;
  const chartsBlockForEmail = charts.length
    ? charts.map(c => `
        <h2 style="font-size:16px;color:#161B22;margin:24px 0 4px">${c.emoji} ${c.title}</h2>
        <img src="cid:${c.cid}" alt="${c.title}" style="display:block;max-width:100%;height:auto;border-radius:6px;border:1px solid #E1E4E8" />
        <p style="font-size:13px;color:#6E7681;margin:6px 0 0;line-height:1.5">${c.caption}</p>
      `).join("")
    : noChartsBlock;
  const chartsBlockForPreview = charts.length
    ? charts.map(c => `
        <h2 style="font-size:16px;color:#161B22;margin:24px 0 4px">${c.emoji} ${c.title}</h2>
        <img src="${c.dataUrl}" alt="${c.title}" style="display:block;max-width:100%;height:auto;border-radius:6px;border:1px solid #E1E4E8" />
        <p style="font-size:13px;color:#6E7681;margin:6px 0 0;line-height:1.5">${c.caption}</p>
      `).join("")
    : noChartsBlock;

  const wrapper = (chartsBlock) => `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F6F8FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#161B22">
  <div style="max-width:640px;margin:0 auto;padding:24px;background:#FFFFFF">

    <div style="background:linear-gradient(135deg,#1F6FEB,#58A6FF);color:#fff;padding:20px;border-radius:10px;margin-bottom:20px">
      <div style="font-size:12px;letter-spacing:2px;opacity:.85">🐆 COUGAR COY</div>
      <div style="font-size:22px;font-weight:700;margin-top:2px">Fitness Report</div>
      <div style="font-size:13px;opacity:.9;margin-top:8px">${recHeader}</div>
      <div style="font-size:12px;opacity:.8">${escapeHTML(startNice)} → ${escapeHTML(endNice)}</div>
    </div>

    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:8px;margin-bottom:8px">
      <tr>
        <td style="background:#F6F8FA;border:1px solid #E1E4E8;border-radius:8px;padding:14px;text-align:center;width:25%">
          <div style="font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px">Conducts attended</div>
          <div style="font-size:24px;font-weight:700;color:#1A7F37;margin-top:4px">${conductsAttended}/${conductsAddedIn}</div>
          <div style="font-size:11px;color:#6E7681">${attendanceRate}% present</div>
        </td>
        <td style="background:#F6F8FA;border:1px solid #E1E4E8;border-radius:8px;padding:14px;text-align:center;width:25%">
          <div style="font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px">Polar classes joined</div>
          <div style="font-size:24px;font-weight:700;color:#1F6FEB;margin-top:4px">${polarJoined}/${totalCoyConducts}</div>
          <div style="font-size:11px;color:#6E7681">${polarRate}% with HR data</div>
        </td>
        <td style="background:#F6F8FA;border:1px solid #E1E4E8;border-radius:8px;padding:14px;text-align:center;width:25%">
          <div style="font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px">Conducts missed</div>
          <div style="font-size:24px;font-weight:700;color:#F85149;margin-top:4px">${missedCount}</div>
          <div style="font-size:10px;color:#6E7681;line-height:1.4">${missedBreakdown}</div>
        </td>
        <td style="background:#F6F8FA;border:1px solid #E1E4E8;border-radius:8px;padding:14px;text-align:center;width:25%">
          <div style="font-size:10px;color:#6E7681;text-transform:uppercase;letter-spacing:.5px">Report Sick</div>
          <div style="font-size:24px;font-weight:700;color:#D29922;margin-top:4px">${reportSickCount}</div>
          <div style="font-size:11px;color:#6E7681">in window</div>
        </td>
      </tr>
    </table>

    ${chartsBlock}

    ${ipptTableHTML}

    <div style="background:linear-gradient(135deg,#3FB95011,#39D2C022);border:1px solid #3FB95044;border-radius:10px;padding:18px;margin-top:24px">
      <div style="font-size:13px;font-weight:700;color:#1A7F37;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">🎯 Keep it up</div>
      <div style="font-size:14px;color:#161B22;line-height:1.55">${encouragement}</div>
      <div style="font-size:13px;color:#6E7681;margin-top:14px;font-style:italic">Stay strong. Stay healthy.<br>— Cougar Coy</div>
    </div>

    <div style="font-size:10px;color:#8B949E;text-align:center;margin-top:20px;padding-top:14px;border-top:1px solid #E1E4E8">
      This is an automated fitness report generated from your Polar HR data and conduct attendance records.
    </div>
  </div>
</body></html>`;

  return {
    htmlForEmail: wrapper(chartsBlockForEmail),
    htmlForPreview: wrapper(chartsBlockForPreview),
    inlineImages
  };
}

// Opens the report modal with date pickers, recruit picker, preview,
// test send, and bulk send. Fetches sender identity + quota on open so
// the user knows exactly which Gmail account emails will come from.
function openFitnessReportModal() {
  // Admin-only (RBAC): email dispatch. UI is .admin-only; this guards any
  // programmatic call; the backend gates the sendEmail action with a 403.
  if (!isAdminRole()) { alert("Admin only — sending emails is restricted to admin accounts."); return; }
  const today = todayISO();
  const monthAgo = new Date(today); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const monthAgoIso = monthAgo.toISOString().slice(0, 10);
  const recipients = filteredRoster().filter(r => r.role !== "Commander" && r.email);
  const skipped = filteredRoster().filter(r => r.role !== "Commander" && !r.email).length;
  const scopeNote = isFilterActive() ? ` in ${filterLabel()}` : "";

  // Recruit options for the preview/test dropdown — include any recruit
  // with non-empty email in the current scope.
  const recruitOptions = recipients.length
    ? recipients.map(r => `<option value="${r.id}">${escapeHTML(displayPersonLabel(r.id))} — ${escapeHTML(r.email)}</option>`).join("")
    : `<option value="">(no recruits with email in scope)</option>`;

  openModal("📊 Email Fitness Reports", `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;line-height:1.55">
        Sends one personalized report per recruit. Each contains their Polar trends, conduct attendance, and an auto-picked encouragement line. Recruits never see anyone else's data.
      </div>

      <div id="sender-info" style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
        🔍 Checking sender identity…
      </div>

      <div class="form-row">
        ${formField("rep-start", "Start date", "date", "", `value="${monthAgoIso}" required`)}
        ${formField("rep-end", "End date", "date", "", `value="${today}" required`)}
      </div>

      <div class="form-group">
        <label>Preview / Test recipient</label>
        <select id="rep-preview-d4" class="topbar-select" style="width:100%">${recruitOptions}</select>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="previewFitnessReport()" ${recipients.length ? "" : "disabled"}>👁 Preview</button>
        <input id="rep-test-email" type="email" placeholder="your@email.com" style="flex:1;min-width:160px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px">
        <button class="btn" onclick="sendTestReport()" ${recipients.length ? "" : "disabled"}>📨 Send test</button>
      </div>
      <div style="font-size:11px;color:var(--dim);margin-top:-4px">"Send test" sends the selected recruit's report to YOUR address (above) — no recruit gets emailed. Use this to verify the full pipeline.</div>

      <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">

      <div style="font-size:12px;color:var(--muted)" id="bulk-send-summary"></div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer">
        <input id="rep-include-sent" type="checkbox" onchange="updateBulkSendSummary()" style="margin:0">
        Include recruits who already received a report on this device (re-send)
      </label>
      <button class="btn btn-success" onclick="sendAllReports()" ${recipients.length ? "" : "disabled"}>📨 Send to filtered recipients →</button>

      <div id="fitness-report-progress" style="display:none;font-size:12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px"></div>

      <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">

      <details style="font-size:11px;color:var(--muted)">
        <summary style="cursor:pointer;font-weight:600;color:var(--text);padding:4px 0">📋 Sent log — ${Object.keys(STATE.fitnessSent).length} recruit${Object.keys(STATE.fitnessSent).length === 1 ? "" : "s"} marked as sent (per-device)</summary>
        <div style="margin-top:8px;line-height:1.6">
          The bulk send remembers who's already been emailed in this browser's localStorage. On a new device, paste the JSON from your old device below to seed it — otherwise the bulk send won't know to skip them.
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="btn" onclick="exportFitnessSentToClipboard()">📋 Copy sent log JSON</button>
          <button class="btn" onclick="openImportFitnessSentModal()">📥 Import sent log</button>
          <button class="btn btn-danger" onclick="if(confirm('Clear the sent log on THIS device? Future bulk sends won\\'t skip anyone.')) { clearFitnessSent(); openFitnessReportModal(); }">🗑 Clear sent log</button>
        </div>
      </details>
    </div>`);

  // Initial summary fill — needs STATE.fitnessSent to be loaded, which it is.
  updateBulkSendSummary();

  // Async: fetch sender identity + quota. Three possible outcomes:
  //  1. Both succeed → show sender + quota
  //  2. Sender blank (no userinfo scope) → show generic "from your owner
  //     account" line + quota
  //  3. Quota errors (no send_mail scope yet) → show clear setup steps
  //     so the user knows how to grant the email permission
  API.getEmailInfo().then(info => {
    const el = document.getElementById("sender-info");
    if (!el) return;
    if (info.error) {
      el.innerHTML = `⚠ Could not reach Apps Script (${escapeHTML(info.error)})`;
      el.style.color = "var(--red)";
      return;
    }
    if (info.quotaError) {
      el.style.background = "#F8514922";
      el.style.borderColor = "#F8514944";
      el.style.color = "var(--text)";
      el.innerHTML = `⚠ <strong style="color:var(--red)">Email permission not granted yet</strong> — Apps Script can't access Gmail.<br><br>
        <strong>One-time setup (1 min):</strong><br>
        1. Open the Apps Script editor (Extensions → Apps Script from your sheet)<br>
        2. In the function dropdown, pick <code>sendEmailHelper</code><br>
        3. Click <strong>Run</strong> (the play button) — it'll fail because no recipient, but Google will prompt you to <strong>Authorize</strong> Gmail send permission<br>
        4. Grant the permission → close the editor → reopen this modal<br><br>
        Alternative: add <code>"oauthScopes": ["https://www.googleapis.com/auth/script.send_mail"]</code> to <code>appsscript.json</code> and redeploy.`;
      return;
    }
    const fromLine = info.senderEmail
      ? `from <strong style="color:var(--accent)">${escapeHTML(info.senderEmail)}</strong>`
      : `from your Apps Script owner account (check the Apps Script editor — top right)`;
    el.innerHTML = `📧 Emails sent ${fromLine} · Display name: "Cougar Coy Training" · Daily quota: <strong>${info.remainingQuota}</strong>`;
  }).catch(e => {
    const el = document.getElementById("sender-info");
    if (el) el.innerHTML = `⚠ Sender check failed: ${escapeHTML(e.message)}`;
  });
}

// Renders the selected recruit's report in a secondary modal so the user
// can sanity-check the layout + numbers before sending. Writes HTML
// directly into the iframe document because our email HTML contains
// single quotes that can't be safely embedded in a srcdoc attribute.
function previewFitnessReport() {
  const startIso = gv("rep-start");
  const endIso = gv("rep-end");
  if (!startIso || !endIso) { alert("Pick a start and end date first."); return; }
  const d4 = gv("rep-preview-d4");
  if (!d4) { alert("Pick a recruit to preview."); return; }
  const recruit = STATE.roster.find(r => r.id === d4);
  if (!recruit) { alert("Recruit not found."); return; }
  const { htmlForPreview } = buildFitnessReportHTML(d4, startIso, endIso);

  openModal("Preview — " + displayPersonLabel(d4), `
    <iframe id="preview-iframe" style="width:100%;height:600px;border:1px solid var(--border);border-radius:6px;background:#fff"></iframe>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">Sample for ${escapeHTML(displayPersonLabel(d4))}${recruit.email ? ` (${escapeHTML(recruit.email)})` : ""}. Close this to go back.</div>
  `);
  document.querySelector(".modal")?.classList.add("wide");

  setTimeout(() => {
    const iframe = document.getElementById("preview-iframe");
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(htmlForPreview);
    doc.close();
  }, 50);
}

// Sends the SELECTED recruit's report to a custom email address — typically
// the sergeant's own inbox. No recruit actually receives anything. Use
// this to verify the rendering + email deliverability before bulk-sending.
async function sendTestReport() {
  const startIso = gv("rep-start");
  const endIso = gv("rep-end");
  if (!startIso || !endIso) { alert("Pick a start and end date first."); return; }
  const d4 = gv("rep-preview-d4");
  if (!d4) { alert("Pick a recruit to use as the sample report."); return; }
  const testEmail = (gv("rep-test-email") || "").trim();
  if (!testEmail || !/.+@.+\..+/.test(testEmail)) { alert("Enter a valid test email address."); return; }

  const subject = `[TEST] Cougar Fitness Report — ${displayPersonLabel(d4)}`;
  const { htmlForEmail, inlineImages } = buildFitnessReportHTML(d4, startIso, endIso);

  const progress = document.getElementById("fitness-report-progress");
  progress.style.display = "block";
  progress.innerHTML = `Sending test to <strong>${escapeHTML(testEmail)}</strong>…`;

  try {
    const res = await API.sendEmail(testEmail, subject, htmlForEmail, inlineImages);
    if (res.error) {
      progress.innerHTML = `<span style="color:var(--red)">⚠ Test failed: ${escapeHTML(res.error)}</span>`;
    } else {
      progress.innerHTML = `<span style="color:var(--green)">✓ Test sent to ${escapeHTML(testEmail)}.</span> Check your inbox (and spam folder). Quota left: ${res.remainingQuota}`;
    }
  } catch (e) {
    progress.innerHTML = `<span style="color:var(--red)">⚠ Test failed: ${escapeHTML(e.message)}</span>`;
  }
}

// Computes the actual send queue given current scope + the "include already
// sent" checkbox. Shared between the live summary line and the send loop so
// the count under the button always matches what the loop will do.
function computeFitnessSendQueue() {
  const includeSent = document.getElementById("rep-include-sent")?.checked;
  const all = filteredRoster().filter(r => r.role !== "Commander" && r.email);
  const sentMap = STATE.fitnessSent || {};
  const skipNoEmail = filteredRoster().filter(r => r.role !== "Commander" && !r.email).length;
  if (includeSent) return { queue: all, skipAlreadySent: 0, skipNoEmail, total: all.length };
  const queue = all.filter(r => !sentMap[r.id]);
  return { queue, skipAlreadySent: all.length - queue.length, skipNoEmail, total: all.length };
}

// Renders the "X recruits will be emailed (Y skipped...)" line under the
// bulk button. Called on open + whenever the include-sent checkbox changes.
function updateBulkSendSummary() {
  const el = document.getElementById("bulk-send-summary");
  if (!el) return;
  const { queue, skipAlreadySent, skipNoEmail, total } = computeFitnessSendQueue();
  const scopeNote = isFilterActive() ? ` in ${escapeHTML(filterLabel())}` : "";
  let msg = `Bulk send to <strong style="color:var(--accent)">${queue.length}</strong> recruit${queue.length === 1 ? '' : 's'}${scopeNote}`;
  const notes = [];
  if (skipAlreadySent) notes.push(`${skipAlreadySent} skipped (already sent on this device)`);
  if (skipNoEmail) notes.push(`${skipNoEmail} skipped (no email on file)`);
  if (notes.length) msg += ` <span style="color:var(--dim)">(${notes.join(" · ")})</span>`;
  el.innerHTML = msg + ".";
}

// Sequential send loop — fires one email at a time so we can read the
// remaining quota after each call and abort cleanly when it hits 0. Records
// each successful send in STATE.fitnessSent so a future run skips them.
async function sendAllReports() {
  const startIso = gv("rep-start");
  const endIso = gv("rep-end");
  if (!startIso || !endIso) { alert("Pick a start and end date first."); return; }
  const { queue, skipAlreadySent } = computeFitnessSendQueue();
  if (!queue.length) {
    alert(skipAlreadySent
      ? `All ${skipAlreadySent} eligible recruits already received a report on this device. Tick "Include recruits who already received a report" to re-send.`
      : "No recruits with email in current scope.");
    return;
  }
  if (!confirm(`Send fitness reports to ${queue.length} recruit${queue.length === 1 ? "" : "s"}? This cannot be undone.${skipAlreadySent ? `\n\n(${skipAlreadySent} already-sent recruits will be skipped.)` : ""}`)) return;

  const progress = document.getElementById("fitness-report-progress");
  progress.style.display = "block";
  let sent = 0, failed = 0, skippedQuota = 0, lastQuota = "?";

  const startNice = isoToDisplayDate(startIso);
  const endNice = isoToDisplayDate(endIso);
  const subject = `Your Cougar Fitness Report — ${startNice} → ${endNice}`;

  for (let i = 0; i < queue.length; i++) {
    const r = queue[i];
    progress.innerHTML = `Sending ${i + 1}/${queue.length} — currently <strong>${escapeHTML(displayPersonLabel(r.id))}</strong><br><span style="color:var(--muted)">✓ ${sent} sent · ⚠ ${failed} failed · quota left: ${lastQuota}</span>`;
    try {
      const { htmlForEmail, inlineImages } = buildFitnessReportHTML(r.id, startIso, endIso);
      const res = await API.sendEmail(r.email, subject, htmlForEmail, inlineImages);
      if (res.error) {
        failed++;
        if (res.remainingQuota === 0) {
          skippedQuota = queue.length - i - 1;
          break;
        }
      } else {
        sent++;
        markFitnessSent(r.id);  // Persist so future runs skip this recruit.
        lastQuota = res.remainingQuota ?? "?";
        if (res.remainingQuota === 0 && i < queue.length - 1) {
          skippedQuota = queue.length - i - 1;
          break;
        }
      }
    } catch (e) {
      failed++;
    }
  }

  updateBulkSendSummary();
  progress.innerHTML = `<strong style="color:var(--green)">✓ Done.</strong> ${sent} sent · ${failed} failed${skippedQuota ? ` · ${skippedQuota} not sent (daily quota hit — retry tomorrow)` : ""} · quota left: ${lastQuota}`;
}

// Copies the per-device sent map to the clipboard as pretty JSON so it can
// be pasted into another device's import modal. Used when the user switches
// laptops mid-cohort or when seeding a fresh browser cache.
async function exportFitnessSentToClipboard() {
  const json = JSON.stringify(STATE.fitnessSent, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    alert(`Copied ${Object.keys(STATE.fitnessSent).length} sent-log entries to clipboard. Paste into the import modal on the other device.`);
  } catch (e) {
    // Fallback: show in a textarea so the user can copy manually.
    openModal("Sent log JSON (copy manually)", `
      <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Clipboard access denied. Copy this JSON manually and paste into the import modal on the other device.</p>
      <textarea readonly style="width:100%;height:320px;font-family:var(--mono);font-size:11px;padding:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px" onclick="this.select()">${escapeAttr(json)}</textarea>
    `);
  }
}

function openImportFitnessSentModal() {
  openModal("Import sent log", `
    <p style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.5">
      Paste the JSON exported from your other device. Entries are merged into this device's existing log (more-recent timestamp wins per d4), so importing is non-destructive.
    </p>
    <textarea id="fitness-import-textarea" placeholder='{ "1101": "2026-05-27T14:40:25.296Z", ... }' style="width:100%;height:280px;font-family:var(--mono);font-size:11px;padding:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px"></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-success" onclick="confirmImportFitnessSent()">Merge into sent log</button>
    </div>
  `);
}

function confirmImportFitnessSent() {
  const raw = document.getElementById("fitness-import-textarea")?.value || "";
  const result = importFitnessSent(raw);
  if (!result.ok) { alert("Import failed: " + result.error); return; }
  closeModal();
  alert(`Imported. ${result.added} new entries added, ${result.updated} updated. Total now: ${result.total}.`);
  openFitnessReportModal();
}
