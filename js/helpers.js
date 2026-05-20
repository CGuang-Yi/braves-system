// Pure utility functions — name lookups, ID generation, CSV column resolving,
// badge HTML, file exporters, form-field builders.

const getName = d4 => STATE.roster.find(r => r.id === d4)?.name || d4;

// ── Global platoon/section scope ─────────────────────────
// Filter applies to every per-recruit view (Roster, Medical, IPPT, RM, SOC,
// Polar, Dashboard counts). Attendance is per-conduct (no recruit linkage in
// the entry shape), so it stays company-wide.

// Plt/sect can come either as explicit roster fields OR be derived from the
// 4D code (e.g. "C1114" → plt=1, sect=1, bed=14). The sheet column may not
// always exist, so we fall back to parsing the 4D so the scope filter works
// regardless of sheet schema.
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

const isFilterActive = () => !!(STATE.filterPlt || STATE.filterSect || STATE.filterRole);

function filteredRoster() {
  if (!isFilterActive()) return STATE.roster;
  return STATE.roster.filter(r => {
    if (STATE.filterRole && r.role !== STATE.filterRole) return false;
    if (STATE.filterPlt && getPlt(r) !== String(STATE.filterPlt)) return false;
    if (STATE.filterSect && getSect(r) !== String(STATE.filterSect)) return false;
    return true;
  });
}

// Returns null when no filter is active so callers can skip the Set lookup
// on the hot render path entirely. Use with passesFilter(d4, visible).
function visibleD4Set() {
  if (!isFilterActive()) return null;
  return new Set(filteredRoster().map(r => r.id));
}

const passesFilter = (d4, visible) => !visible || visible.has(d4);

function filterLabel() {
  if (!isFilterActive()) return "";
  const parts = [];
  if (STATE.filterRole === "Commander") parts.push("Cmdrs");
  else if (STATE.filterRole === "Recruit") parts.push("Recs");
  if (STATE.filterPlt) parts.push("P" + STATE.filterPlt);
  if (STATE.filterSect) parts.push("S" + STATE.filterSect);
  return parts.join(" ");
}

// ── Commander-aware display helpers ───────────────────────
// 00xx IDs are administrative only — the user never wants to see them in
// the UI. These wrappers centralize the rule so tables can keep their
// existing structure while transparently swapping to name-based display
// for commander rows.
const isCommander = d4 => STATE.roster.find(r => r.id === d4)?.role === "Commander";

function displayId(d4) {
  const r = STATE.roster.find(x => x.id === d4);
  if (!r) return d4;
  return r.role === "Commander" ? "" : d4;
}

function getRank(d4) {
  return STATE.roster.find(r => r.id === d4)?.rank || "";
}

// "3SG NICHOLAS ENG" for commanders, plain name for recruits.
function displayPersonLabel(d4) {
  const r = STATE.roster.find(x => x.id === d4);
  if (!r) return d4;
  if (r.role === "Commander") return [r.rank, r.name].filter(Boolean).join(" ");
  return r.name || d4;
}

// Off-in-lieu days used + quota + remaining for a commander. Returns null
// for recruits and unknown ids so callers can decide whether to render a
// balance card.
function commanderLeaveBalance(d4) {
  const r = STATE.roster.find(x => x.id === d4);
  if (!r || r.role !== "Commander") return null;
  const quota = +r.leaveQuota || 0;
  const used = STATE.leave
    .filter(l => l.d4 === d4 && l.type === "Off-in-Lieu")
    .reduce((s, l) => s + (+l.days || 0), 0);
  return { used, quota, remaining: quota - used };
}

// Short sequential IDs instead of timestamps
let _idCounter = Math.floor(Math.random() * 9000) + 1000;
const nextId = () => ++_idCounter;

// Smart CSV column resolver — case-insensitive, handles aliases
function col(row, ...names) {
  for (const n of names) {
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === n.toLowerCase()) return row[key];
    }
  }
  return "";
}
function colNum(row, ...names) { return +(col(row, ...names)) || 0; }

// Validate CSV has required columns, return missing ones
function checkCols(headers, required) {
  const lower = headers.map(h => h.trim().toLowerCase());
  return required.filter(r => !lower.some(h => h === r.toLowerCase()));
}

const getAward = s => { if (!s || s === 0) return "N/A"; if (s >= 85) return "Gold"; if (s >= 75) return "Silver"; if (s >= 61) return "Pass"; return "Fail"; };

// Unique, sorted list of every conduct name the system has ever seen —
// pulled from both Attendance and ConductDetail so the two tabs share a
// single autocomplete list. Used to populate <datalist> in the entry forms,
// which means "the conduct name will be saved as a conduct in the list"
// happens implicitly: log a new conduct once, it shows up in future picks.
function getAllConducts() {
  const set = new Set();
  STATE.attendance.forEach(a => { if (a.conduct) set.add(a.conduct); });
  STATE.conductDetail.forEach(d => { if (d.conduct) set.add(d.conduct); });
  return [...set].sort();
}

// Generic delete: removes a row from STATE[arrayName] by id with a confirm
// prompt. Local-only — propagating the delete to the Google Sheet requires
// a Push to Sheet (writeTab rewrites the sheet from STATE).
function deleteEntry(arrayName, id, label) {
  if (!confirm(`Delete this ${label || "entry"}?\n\nThis change is local. Hit Push to Sheet on the tab to sync the deletion to the Google Sheet.`)) return;
  STATE[arrayName] = STATE[arrayName].filter(x => x.id !== id);
  saveLocal();
  render();
}

// ── Medical status enum ──────────────────────────────────
// Every medical record represents a "report sick" event. `date` captures
// when the recruit reported sick. `status` is the outcome from the MO.
// Only these statuses are official:
//   • MC / Warded — away from camp
//   • LD / RMJ / Excuse X — in camp, restricted
//   • Pending — reported sick, MO outcome not yet known
//   • NIL — MO seen, no status issued (recruit back to active)
const MED_STATUS_GROUPS = [
  { label: "Severe (away from camp)", options: ["MC", "Warded"] },
  { label: "In camp, restricted",     options: ["LD", "RMJ"] },
  { label: "Excuses",                 options: ["Excuse Heavy Load", "Excuse Kneeling", "Excuse Squatting", "Excuse Uniform", "Excuse RMJ"] },
  { label: "Awaiting MO",             options: ["Pending"] },
  { label: "Cleared by MO",           options: ["NIL"] }
];
const MED_STATUSES = MED_STATUS_GROUPS.flatMap(g => g.options);

// Days between two ISO date strings (both inclusive of the date — date math
// only, no time of day). Returns isoB − isoA in whole days.
function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Is this medical record's status active on the given ISO date?
// Active = today ∈ [startDate, endDate] inclusive on both ends. Pending is
// treated as active only on its startDate (one-day visibility). NIL is
// never active — MO cleared the recruit, they're back to normal.
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

// Returns { tag, ghostDay } for the record on the given date, or null if the
// record doesn't apply at all. ghostDay is 0 for active, 1 or 2 for the post-
// expiry tag period. Only MC and LD get ghost-tagged; everything else just
// expires cleanly.
function medStatusTag(record, todayIso) {
  todayIso = todayIso || todayISO();
  if (medStatusActive(record, todayIso)) {
    return { tag: record.status, ghostDay: 0 };
  }
  if (record.status !== "MC" && record.status !== "LD") return null;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return null;
  const offset = daysBetween(end, todayIso);
  if (offset === 1 || offset === 2) return { tag: `${record.status}+${offset}`, ghostDay: offset };
  return null;
}

// Severity rank used to pick the most-restrictive tag when a recruit has
// multiple records hitting the same day. Higher = more severe.
function medSeverityRank(tag) {
  if (tag === "MC" || tag === "Warded") return 100;
  if (tag === "LD") return 80;
  if (tag === "RMJ") return 70;
  if (typeof tag === "string" && tag.startsWith("Excuse")) return 60;
  if (tag === "MC+1") return 50;
  if (tag === "MC+2") return 40;
  if (tag === "LD+1") return 30;
  if (tag === "LD+2") return 20;
  if (tag === "Pending") return 10;
  return 0;
}

// Walk the medical layer and return the most-severe effective tag per recruit
// for the given date. Output: array of { d4, record, tag, ghostDay }.
function currentMedicalEffective(todayIso) {
  todayIso = todayIso || todayISO();
  const byD4 = {};
  STATE.medical.forEach(m => {
    const t = medStatusTag(m, todayIso);
    if (!t) return;
    const existing = byD4[m.d4];
    if (!existing || medSeverityRank(t.tag) > medSeverityRank(existing.tag)) {
      byD4[m.d4] = { d4: m.d4, record: m, tag: t.tag, ghostDay: t.ghostDay };
    }
  });
  return Object.values(byD4);
}

// Like currentMedicalEffective but keeps every active status per recruit
// (sorted severity-desc) so the UI can show stacked tags. A recruit on
// MC + Excuse Heavy Load shows up here with both statuses, not just MC.
// Output: array of { d4, statuses: [{ record, tag, ghostDay }, ...] }.
function currentMedicalEffectiveAll(todayIso) {
  todayIso = todayIso || todayISO();
  const byD4 = {};
  STATE.medical.forEach(m => {
    const t = medStatusTag(m, todayIso);
    if (!t) return;
    (byD4[m.d4] = byD4[m.d4] || { d4: m.d4, statuses: [] }).statuses.push({ record: m, tag: t.tag, ghostDay: t.ghostDay });
  });
  Object.values(byD4).forEach(b => b.statuses.sort((x, y) => medSeverityRank(y.tag) - medSeverityRank(x.tag)));
  return Object.values(byD4);
}

// Inline-styled badge HTML for a medical tag. Uses theme tokens but adds
// custom shades for MC+2 / LD+2 since the existing badge classes don't cover
// the gradient between severity tiers.
function medTagBadge(tag) {
  const palettes = {
    "MC":               { bg: "#F8514922", bd: "#F8514944", fg: "var(--red)" },
    "Warded":           { bg: "#F8514922", bd: "#F8514944", fg: "var(--red)" },
    "MC+1":             { bg: "#D2992233", bd: "#D2992266", fg: "var(--orange)" },
    "MC+2":             { bg: "#E3B34122", bd: "#E3B34144", fg: "var(--yellow)" },
    "LD":               { bg: "#D2992222", bd: "#D2992244", fg: "var(--orange)" },
    "LD+1":             { bg: "#E3B34122", bd: "#E3B34144", fg: "var(--yellow)" },
    "LD+2":             { bg: "#E3B34111", bd: "#E3B34133", fg: "#8B7521" },
    "RMJ":              { bg: "#58A6FF22", bd: "#58A6FF44", fg: "var(--accent)" },
    "Pending":          { bg: "#8B949E22", bd: "#8B949E44", fg: "var(--muted)" },
    "NIL":              { bg: "#3FB95022", bd: "#3FB95044", fg: "var(--green)" }
  };
  const p = palettes[tag] || (typeof tag === "string" && tag.startsWith("Excuse")
    ? { bg: "#BC8CFF22", bd: "#BC8CFF44", fg: "var(--purple)" }
    : palettes.Pending);
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;background:${p.bg};color:${p.fg};border:1px solid ${p.bd}">${tag}</span>`;
}

// Format a record's date range as "16 May – 20 May (5D)" for display.
function medDurationLabel(record) {
  if (record.status === "Pending") return `${record.startDate || record.date || ""} · awaiting MO`;
  if (record.status === "NIL") return `${record.date || record.startDate || ""} · MO cleared, no status`;
  if (!record.startDate || !record.endDate) return record.startDate || "";
  const start = displayDateToISO(record.startDate);
  const end = displayDateToISO(record.endDate);
  const days = start && end ? daysBetween(start, end) + 1 : null;
  return `${record.startDate} – ${record.endDate}${days ? ` (${days}D)` : ""}`;
}
const badge = (text, cls) => `<span class="badge badge-${cls}">${text}</span>`;
const statusBadge = s => badge(s, s === "Active" ? "green" : s === "Warded" ? "red" : "orange");
const typeBadge = t => badge(t, t === "RSI" ? "orange" : t === "Injury" ? "red" : "yellow");
const awardBadge = s => { const a = getAward(s); const c = { Gold: "yellow", Silver: "accent", Pass: "green", Fail: "red", "N/A": "accent" }; return badge(a, c[a] || "accent"); };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

// BMI = kg / m². Height is stored in cm in the roster sheet.
// Categories follow the standard WHO bands. Returns null when either field
// is missing so callers can render an em-dash instead of NaN.
function calcBMI(r) {
  const h = +r.height, w = +r.weight;
  if (!h || !w) return null;
  return +(w / Math.pow(h / 100, 2)).toFixed(1);
}
function bmiColor(bmi) {
  if (bmi == null) return 'var(--muted)';
  if (bmi < 18.5) return 'var(--accent)';      // underweight
  if (bmi < 25)   return 'var(--green)';        // normal
  if (bmi < 30)   return 'var(--orange)';       // overweight
  return 'var(--red)';                          // obese
}

function exportCSV(data, filename) {
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function exportJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// `roleFilter` is optional — pass "Commander" or "Recruit" to restrict the
// dropdown (e.g. the Leave form picks commanders only). Commander options
// render as "rank name" without the administrative 00xx prefix.
function rosterSelect(id = "form-d4", required = true, selected = "", roleFilter = "") {
  const rows = roleFilter ? STATE.roster.filter(r => r.role === roleFilter) : STATE.roster;
  const optLabel = r => r.role === "Commander"
    ? [r.rank, r.name].filter(Boolean).join(" ")
    : `${r.id} ${r.name}`;
  return `<select id="${id}" ${required ? "required" : ""} style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px"><option value="">Select...</option>${rows.map(r => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${optLabel(r)}</option>`).join("")}</select>`;
}
function formField(id, label, type = "text", placeholder = "", extra = "") {
  const ph = placeholder ? ` placeholder="${placeholder}"` : "";
  return `<div class="form-group"><label>${label}</label><input id="${id}" type="${type}"${ph} ${extra}></div>`;
}
function formSelect(id, label, options, required = false, selected = "") {
  return `<div class="form-group"><label>${label}</label><select id="${id}" ${required ? "required" : ""}>${options.map(o => {
    const val = typeof o === "string" ? o : o[0];
    const lab = typeof o === "string" ? o : o[1];
    return `<option value="${val}" ${String(val) === String(selected) ? "selected" : ""}>${lab}</option>`;
  }).join("")}</select></div>`;
}
const gv = id => document.getElementById(id)?.value || "";

// Escape user-supplied text for safe interpolation into HTML attribute values.
const escapeAttr = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// Local-time today as YYYY-MM-DD (avoids toISOString's UTC shift).
function todayISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-05-17" → "17 May 2026" — matches what Apps Script formats sheet dates as.
function isoToDisplayDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// "17 May 2026" or "17 May" → "2026-05-17" — for pre-filling <input type=date>.
// If year is missing, falls back to current year (matches the old free-text shape).
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

// Normalize a time-of-day string to 4-digit HHMM. "930" → "0930", "7" →
// "0700", "0830" stays. Time ranges ("0700-2100") are normalized on both
// sides. Non-numeric / mixed strings are returned unchanged so we don't
// mangle anything unexpected (e.g. "TBC", "after lunch"). Safe to call
// on already-padded values — idempotent.
function pad4Time(t) {
  const s = String(t ?? "").trim();
  if (!s) return s;
  const range = s.match(/^(\d{1,4})\s*[-–]\s*(\d{1,4})$/);
  if (range) return pad4Time(range[1]) + "-" + pad4Time(range[2]);
  if (!/^\d{1,4}$/.test(s)) return s;
  if (s.length === 4) return s;
  if (s.length === 3) return "0" + s;          // "930" → "0930"
  if (s.length === 2) return s + "00";          // "07"  → "0700"
  return "0" + s + "00";                        // "7"   → "0700"
}
