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
    // Braves scope (§11): platoon CODE ("PLT1"/"HQ") + section value via the
    // explicit roster columns (personPlatoon/personSection fall back to the
    // 4D-derived value, so this also works before the columns are populated).
    if (STATE.filterPlt && personPlatoon(r) !== String(STATE.filterPlt)) return false;
    if (STATE.filterSect && personSection(r) !== String(STATE.filterSect)) return false;
    return true;
  });
}

// Is a person (by id/4D) within the active global scope (spec §11.3)? Used by
// views that filter non-roster records (Medical/Leave/IPPT/…) directly by d4
// rather than going through filteredRoster(). Mirrors filteredRoster's logic.
function inScope(personId) {
  if (!isFilterActive()) return true;
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return false;
  if (STATE.filterRole && r.role !== STATE.filterRole) return false;
  if (STATE.filterPlt && personPlatoon(r) !== String(STATE.filterPlt)) return false;
  if (STATE.filterSect && personSection(r) !== String(STATE.filterSect)) return false;
  return true;
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
  // filterPlt is a platoon code ("PLT1"/"HQ"); show it as-is. Section shows
  // "Command" verbatim, numbered sections as "Sect N".
  if (STATE.filterPlt) parts.push(STATE.filterPlt);
  if (STATE.filterSect) parts.push(STATE.filterSect === "Command" ? "Command" : "Sect " + STATE.filterSect);
  return parts.join(" · ");
}

// ── Braves org model helpers (spec §2/§5/§8, addendum A6) ─
// These read the new explicit roster columns (platoon/section/rankGroup) added
// in Step 2. They are the forward-looking accessors; the legacy getPlt/getSect
// above still back the current topbar filter until the Step-5 scope rewrite.

// A person's platoon code ("HQ"/"PLT1"…). Prefers the explicit column; falls
// back to "PLT" + the 4D-derived digit so parade state still groups sensibly
// before the roster is fully populated with the new column.
function personPlatoon(r) {
  if (!r) return "";
  if (r.platoon) return String(r.platoon).trim();
  const p = getPlt(r);
  return p ? "PLT" + p : "";
}

// A person's section ("1".."N", "Command", or "" for HQ-flat). Prefers the
// explicit column; falls back to the 4D-derived section digit.
function personSection(r) {
  if (!r) return "";
  if (r.section != null && r.section !== "") return String(r.section).trim();
  return getSect(r) || "";
}

// Strength-breakdown bucket for a person: "Officer" / "WOSPEC" / "Enlistee"
// (spec §8). Prefers the explicit rankGroup column; otherwise derives from the
// free-text rank. Officer = 2LT and above (the commissioned ranks); WOSPEC =
// the specialist/warrant track (3SG..MWO and 1WO/2WO etc.); everything else
// (recruits, REC/PTE/LCP/CPL/CFC) = Enlistee.
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

// Active platoons (addendum A6.1) for dropdowns / scope options. Falls back to a
// derived list from the roster's distinct platoon values when the Platoons tab
// hasn't been populated yet, so the UI is never empty.
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

// Distinct sections present in a platoon (spec §2 — section count is variable,
// never hardcoded). "Command" (PC/PS) sorts first, then numbered sections.
function sectionsInPlatoon(platoonCode) {
  const seen = new Set();
  (STATE.roster || []).forEach(r => {
    if (personPlatoon(r) !== platoonCode) return;
    const s = personSection(r);
    if (s) seen.add(s);
  });
  return [...seen].sort((a, b) => {
    if (a === "Command") return -1;
    if (b === "Command") return 1;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });
}

// URTI auto-classification from PURPOSE keywords (spec §10.3). Pre-fills the
// medical form's urtiType; always commander-overridable.
function classifyURTI(purpose) {
  const p = (purpose || "").toLowerCase();
  const urti = ["urti", "cough", "cold", "flu", "fever", "runny nose", "sore throat",
                "throat", "phlegm", "blocked nose", "rhinitis", "sinusitis", "sneez"];
  return urti.some(k => p.indexOf(k) !== -1) ? "URTI" : "NON-URTI";
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

// Award tiers: ≥90 Gold★ (NDU/Commando/Guards), ≥85 Gold, ≥75 Silver,
// ≥61 Pass, <61 Fail. The "Gold★" tier is the elite-units threshold.
// Delegates to ipptAward() in ippt-scoring.js so the tier list stays in
// one place.
const getAward = s => (typeof ipptAward === "function" ? ipptAward(s) : ((!s || s === 0) ? "N/A" : s >= 85 ? "Gold" : s >= 75 ? "Silver" : s >= 61 ? "Pass" : "Fail"));

// Canonical conducts registry, sorted by name. Source of truth for the
// conduct picker dropdowns across attendance / conductDetail / polar forms.
// Returns objects {id, name} — callers render the name but persist the id
// onto records, so a later rename in the Conducts admin tab updates every
// display site without rewriting any records.
function getAllConducts() {
  return [...(STATE.conducts || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

// Normalized comparison key for conduct names. Collapses everything that
// makes two visually-identical strings compare unequal in vanilla JS:
//   - Unicode NFKC (so "ﬁ" and "fi" match)
//   - trim outer whitespace
//   - lowercase
//   - replace all whitespace runs (incl. NBSP  ) with one space
//   - normalize smart quotes / typographic apostrophes to ASCII
//   - strip zero-width chars (ZWSP / ZWNJ / ZWJ / BOM)
// Used both at lookup (conductIdByName) and at migration (variant grouping).
function normalizeConductKey(s) {
  return String(s || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[​‌‍﻿]/g, "");
}

// Resolve a conductId → display name. Returns the name when found. For
// missing ids — usually a stale frontend cache or an Apps Script that
// wasn't redeployed with the new Conducts tab — falls back to the raw id
// in brackets (e.g. "[c003?]") so the user can see SOMETHING is wrong
// without the UI silently going blank everywhere.
function conductName(id) {
  if (!id) return "";
  const hit = STATE.conducts.find(c => c.id === id);
  if (hit && hit.name) return hit.name;
  return `[${id}?]`;
}

// Resolve a free-text conduct name → conductId via normalized lookup.
// Returns "" if no entry matches. Used by CSV import, the photo-extract
// flow, and the legacy-data migration to convert names → ids.
function conductIdByName(name) {
  const key = normalizeConductKey(name);
  if (!key) return "";
  const hit = STATE.conducts.find(c => normalizeConductKey(c.name) === key);
  return hit ? hit.id : "";
}

// Next conduct id — "c" + the shared random-seeded counter (nextId). The old
// scheme was max-of-existing + 1, which COLLIDES across devices: two commanders
// each adding a conduct before syncing both compute the same max+1 and produce
// duplicate ids (e.g. three conducts all "c048"), which then mislabels every
// record keyed to that id. nextId() is seeded from a per-session random base, so
// concurrent creators land on different ids. New ids (c1000+) never clash with
// the legacy c001–c050 range. Guarded against any local collision just in case.
function nextConductId() {
  const taken = new Set((STATE.conducts || []).map(c => c.id));
  let id;
  do { id = "c" + nextId(); } while (taken.has(id));
  return id;
}

// Best-guess time for a conduct based on existing data. Returns the most
// frequently-logged time (across conductDetail + polar) for matches of
// the given conductId. Empty string if no match — caller can fall back
// to a default like "0730".
function inferTimeForConduct(conductId) {
  if (!conductId) return "";
  const counts = {};
  const tally = (t) => { const k = pad4Time(t); if (k) counts[k] = (counts[k] || 0) + 1; };
  STATE.conductDetail.forEach(c => { if (c.conductId === conductId && c.time) tally(c.time); });
  STATE.polar.forEach(p => { if (p.conductId === conductId && p.time) tally(p.time); });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : "";
}

// Best-guess ISO date for a conduct. Looks at attendance first (the canonical
// "when did this conduct happen" log), falling back to conductDetail. Prefers
// the most recent date that DOESN'T already have polar data — that's the
// session the user is most likely about to import photos for. If every
// attendance date for the conduct already has polar coverage, returns the
// single most-recent date so the user can still overwrite manually. Empty
// string when nothing's known (caller can fall back to today).
function inferDateForConduct(conductId) {
  if (!conductId) return "";
  const polarDates = new Set(
    STATE.polar.filter(p => p.conductId === conductId).map(p => {
      const iso = displayDateToISO(p.date);
      return iso || p.date || "";
    }).filter(Boolean)
  );
  const candidateDates = [];
  STATE.attendance.forEach(a => {
    if (a.conductId !== conductId) return;
    const iso = displayDateToISO(a.date) || a.date;
    if (iso) candidateDates.push(iso);
  });
  STATE.conductDetail.forEach(c => {
    if (c.conductId !== conductId) return;
    const iso = displayDateToISO(c.date) || c.date;
    if (iso && !candidateDates.includes(iso)) candidateDates.push(iso);
  });
  if (!candidateDates.length) return "";
  candidateDates.sort();  // ascending ISO sort
  // Prefer most-recent date that doesn't yet have polar coverage.
  const uncovered = candidateDates.filter(d => !polarDates.has(d));
  const pick = uncovered.length ? uncovered[uncovered.length - 1] : candidateDates[candidateDates.length - 1];
  return pick;
}

// Generic delete: removes a row from STATE[arrayName] by id with a confirm
// prompt. Auto-syncs a surgical row delete to the Google Sheet via autoSync —
// no need for the user to navigate to the tab and click Re-push all.
const STATE_TO_TAB = {
  roster: "Roster", medical: "Medical", attendance: "Attendance",
  ippt: "IPPT", rm: "RouteMarch", soc: "SOC", polar: "PolarFlow",
  conductDetail: "ConductDetail", appointments: "Appointments",
  leave: "Leave", msk: "MSK", conducts: "Conducts"
};
function deleteEntry(arrayName, id, label) {
  if (!confirm(`Delete this ${label || "entry"}?`)) return;
  STATE[arrayName] = STATE[arrayName].filter(x => x.id !== id);
  saveLocal();
  render();
  const tabName = STATE_TO_TAB[arrayName];
  if (tabName && STATE.apiUrl && typeof autoSync === "function") {
    autoSync(tabName, { type: "delete", id });
  }
}

// ── Medical status enum ──────────────────────────────────
// Every medical record represents a "report sick" event. `date` captures
// when the recruit reported sick. `status` is the outcome from the MO.
// Only these statuses are official:
//   • MC / Warded — away from camp
//   • LD / Excuse X (incl. Excuse RMJ) — in camp, restricted
//   • Pending — reported sick, MO outcome not yet known
//   • NIL — MO seen, no status issued (recruit back to active)
const MED_STATUS_GROUPS = [
  { label: "Severe (away from camp)", options: ["MC", "Warded"] },
  { label: "In camp, restricted",     options: ["LD", "RIB (Rest in Bunk)"] },
  { label: "Excuses",                 options: ["Excuse Heavy Load", "Excuse Kneeling", "Excuse Squatting", "Excuse Uniform", "Excuse RMJ", "Excuse Swimming", "Excuse Prolonged Standing", "Excuse Upper Limb", "Excuse Lower Limb", "Excuse FLEGS", "Excuse Sunlight", "Excuse Stay In", "Excuse PT", "Excuse Shoes", "Excuse Camo", "Excuse Loud Noise"] },
  { label: "Awaiting MO",             options: ["Pending"] },
  { label: "Cleared by MO",           options: ["NIL"] }
];
const MED_STATUSES = MED_STATUS_GROUPS.flatMap(g => g.options);

// ── Custom statuses ──────────────────────────────────────
// User-defined statuses live in STATE.customStatuses (persisted via state.js).
// They behave like an in-camp restricted status (e.g. an Excuse), never get
// +1/+2 ghost tags, and carry a `participates` flag.
function customStatusByName(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  return (STATE.customStatuses || []).find(s => String(s.name).toLowerCase() === key) || null;
}
// Create or update a saved custom status. Idempotent on name (case-insensitive).
function addCustomStatus(name, participates) {
  name = String(name || "").trim();
  if (!name) return;
  const existing = customStatusByName(name);
  if (existing) { existing.participates = !!participates; }
  else { (STATE.customStatuses = STATE.customStatuses || []).push({ name, participates: !!participates }); }
  saveCustomStatuses();
}
// Does this status mean the recruit normally still participates in conducts?
// Built-in: only NIL (MO cleared, back to active). Custom: per its saved flag.
// Strips any +N ghost suffix first so "MC+1" resolves to "MC".
function statusParticipates(status) {
  const base = medStatusBaseFamily(status);
  if (base === "NIL") return true;
  const c = customStatusByName(base);
  return c ? !!c.participates : false;
}

// ── Same-status-family collapsing ────────────────────────
// A tag's base family ignores the ghost suffix: MC+1 → MC, LD+2 → LD. Used to
// collapse duplicate statuses of the same kind (a re-issued MC) down to one.
const medStatusBaseFamily = tag => String(tag).replace(/\+\d+$/, "");

// Within one status family, is record-tag pair `a` more significant than `b`?
// More severe wins; ties broken by recency (later start date), so a newly
// issued MC supersedes an older overlapping one.
function medStatusMoreSignificant(a, b) {
  const ra = medSeverityRank(a.tag), rb = medSeverityRank(b.tag);
  if (ra !== rb) return ra > rb;
  const sa = displayDateToISO(a.record.startDate || a.record.date || "") || "";
  const sb = displayDateToISO(b.record.startDate || b.record.date || "") || "";
  return sa > sb;
}

// Collapse a recruit's active medical *records* to one per status family,
// keeping the most recent (latest start date). Shared by the parade-state and
// conduct-chat builders so a re-issued MC/LD prints only once (newest dates).
function dedupeActiveRecordsByFamily(records) {
  const best = {};
  (records || []).forEach(m => {
    const k = medStatusBaseFamily(m.status);
    const rec = displayDateToISO(m.startDate || m.date || "") || "";
    const cur = best[k];
    const curRec = cur ? (displayDateToISO(cur.startDate || cur.date || "") || "") : "";
    if (!cur || rec > curRec) best[k] = m;
  });
  return Object.values(best);
}

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
  if (tag === "RIB (Rest in Bunk)") return 58;   // in-camp restricted, adjacent to Excuse, below LD
  if (tag === "MC+1") return 50;
  if (tag === "MC+2") return 40;
  if (tag === "LD+1") return 30;
  if (tag === "LD+2") return 20;
  if (tag === "Pending") return 10;
  // Custom statuses rank just below the built-in excuses (in-camp/restricted).
  if (customStatusByName(medStatusBaseFamily(tag))) return 55;
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
    const cand = { d4: m.d4, record: m, tag: t.tag, ghostDay: t.ghostDay };
    const existing = byD4[m.d4];
    // Most severe wins; ties broken by recency so a re-issued MC supersedes
    // the older one.
    if (!existing || medStatusMoreSignificant(cand, existing)) byD4[m.d4] = cand;
  });
  return Object.values(byD4);
}

// Like currentMedicalEffective but keeps every DISTINCT active status per
// recruit (sorted severity-desc) so the UI can show stacked tags. A recruit on
// MC + Excuse Heavy Load shows up here with both. Duplicates of the SAME family
// (e.g. two overlapping MCs, or MC + MC+1) collapse to the most severe + most
// recent; the collapsed-out records move to `hidden` (still viewable in the
// person's Medical History). This is what stops the dashboard table and pie
// chart from double-counting a re-issued status.
// Output: array of { d4, statuses: [{record, tag, ghostDay}, ...], hidden: [...] }.
function currentMedicalEffectiveAll(todayIso) {
  todayIso = todayIso || todayISO();
  const byD4 = {};
  STATE.medical.forEach(m => {
    const t = medStatusTag(m, todayIso);
    if (!t) return;
    (byD4[m.d4] = byD4[m.d4] || { d4: m.d4, statuses: [], hidden: [] }).statuses.push({ record: m, tag: t.tag, ghostDay: t.ghostDay });
  });
  Object.values(byD4).forEach(b => {
    const best = {};
    const hidden = [];
    b.statuses.forEach(s => {
      const fam = medStatusBaseFamily(s.tag);
      const cur = best[fam];
      if (!cur) { best[fam] = s; }
      else if (medStatusMoreSignificant(s, cur)) { hidden.push(cur); best[fam] = s; }
      else { hidden.push(s); }
    });
    b.statuses = Object.values(best).sort((x, y) => medSeverityRank(y.tag) - medSeverityRank(x.tag));
    b.hidden = hidden;
  });
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
    "RIB (Rest in Bunk)": { bg: "#BC8CFF22", bd: "#BC8CFF44", fg: "var(--purple)" },
    "Pending":          { bg: "#8B949E22", bd: "#8B949E44", fg: "var(--muted)" },
    "NIL":              { bg: "#3FB95022", bd: "#3FB95044", fg: "var(--green)" }
  };
  const p = palettes[tag] || (typeof tag === "string" && tag.startsWith("Excuse")
    ? { bg: "#BC8CFF22", bd: "#BC8CFF44", fg: "var(--purple)" }
    : customStatusByName(medStatusBaseFamily(tag))
    ? { bg: "#39D2C022", bd: "#39D2C044", fg: "#39D2C0" }
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
const awardBadge = s => { const a = getAward(s); const c = { "Gold★": "purple", Gold: "yellow", Silver: "accent", Pass: "green", Fail: "red", "N/A": "accent" }; return badge(a, c[a] || "accent"); };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

// ─── IPPT: YTT detection + aggregation + stats ─────────────
// True when runTime is empty, zero, or a Sheets-formatted zero duration.
function isZeroRunTime(rt) {
  if (!rt) return true;
  const s = String(rt).trim();
  return s === "" || s === "0:00" || s === "00:00" || s === "0:00:00" || s === "00:00:00";
}

// True when the recruit registered no result — typically because they haven't
// taken IPPT yet. Distinct from "took it and scored 0", though in practice
// those are nearly identical for our purposes.
function isYTT(entry) {
  return (+entry.pushups || 0) === 0
      && (+entry.situps  || 0) === 0
      && isZeroRunTime(entry.runTime);
}

// Wraps awardBadge so the IPPT table can render "YTT" instead of "Fail"/"N/A"
// when the row is all zeros.
function ipptAwardBadge(entry) {
  if (isYTT(entry)) return badge("YTT", "accent");
  return awardBadge(entry.score);
}

function parseRunTimeToSeconds(rt) {
  if (!rt || isZeroRunTime(rt)) return 0;
  const parts = String(rt).split(":").map(n => +n || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];                   // mm:ss
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]; // hh:mm:ss
  return 0;
}

function formatSeconds(s) {
  if (!s) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Returns one IPPT entry per recruit, picked by mode:
//   "latest" → highest attempt number (ties broken by score)
//   "best"   → highest score (YTT counted as -1 so it loses ties)
function aggregateIPPT(entries, mode) {
  const byD4 = new Map();
  for (const e of entries) {
    const cur = byD4.get(e.d4);
    if (!cur) { byD4.set(e.d4, e); continue; }
    if (mode === "best") {
      const eScore = isYTT(e)   ? -1 : (+e.score   || 0);
      const cScore = isYTT(cur) ? -1 : (+cur.score || 0);
      if (eScore > cScore) byD4.set(e.d4, e);
    } else { // latest
      if ((+e.attempt || 0) > (+cur.attempt || 0)) byD4.set(e.d4, e);
    }
  }
  return [...byD4.values()];
}

// Tallies aggregated entries by award tier. Returns ready-to-render counts
// plus avg score (excluding YTT) and avg run seconds (excluding YTT).
function computeIPPTStats(entries) {
  const stats = { total: entries.length, ytt: 0, fail: 0, pass: 0, silver: 0, gold: 0, goldStar: 0, scoreSum: 0, scoreN: 0, runSecSum: 0, runSecN: 0 };
  for (const e of entries) {
    if (isYTT(e)) { stats.ytt++; continue; }
    const a = getAward(+e.score || 0);
    if (a === "Gold★") stats.goldStar++;
    else if (a === "Gold") stats.gold++;
    else if (a === "Silver") stats.silver++;
    else if (a === "Pass") stats.pass++;
    else stats.fail++;
    stats.scoreSum += (+e.score || 0); stats.scoreN++;
    const sec = parseRunTimeToSeconds(e.runTime);
    if (sec > 0) { stats.runSecSum += sec; stats.runSecN++; }
  }
  stats.taken    = stats.total - stats.ytt;
  stats.passed   = stats.pass + stats.silver + stats.gold + stats.goldStar;
  stats.avgScore = stats.scoreN  ? Math.round(stats.scoreSum  / stats.scoreN ) : 0;
  stats.avgRunSec = stats.runSecN ? Math.round(stats.runSecSum / stats.runSecN) : 0;
  return stats;
}

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

// Build a timestamped export filename. ISO-8601 local timestamp leads (so the
// OS sorts exports chronologically), then an optional tab label, then the
// "braves-export" tag. Colons are swapped for dashes so the name is filesystem-
// safe. e.g. exportFileName("Roster", "csv") → "2026-06-27T14-30-05 Roster braves-export.csv";
// exportFileName("", "json") → "2026-06-27T14-30-05 braves-export.json".
function exportFileName(label, ext) {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${stamp} ${label ? label + " " : ""}braves-export.${ext}`;
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

// ── Reusable per-tab list search + sort (Medical / IPPT / HA / Conduct) ───────
// Each tab keeps its own {q, sort, dir} in this module-scope map (not persisted —
// resets on reload, like the existing Conduct-detail filters). The search filters
// by name + 4D on top of the topbar scope; clickable headers toggle sort. Mirrors
// the Status Board search pattern but generalised so several tabs can reuse it.
const _listCtl = {};
function listCtl(key) { return _listCtl[key] || (_listCtl[key] = { q: "", sort: "", dir: 1 }); }
const _listRenderers = {};
function registerListRenderer(key, fn) { _listRenderers[key] = fn; }
function setListSearch(key, v) {
  listCtl(key).q = v;
  const partial = _listRenderers[key];
  if (partial) {
    partial();   // rebuild ONLY the results region — the input node is preserved,
    return;      // so focus + the mobile keyboard's input mode survive.
  }
  render();      // tabs without a registered partial renderer keep the old behaviour
  const inp = document.getElementById("list-search-" + key);
  if (inp) { inp.focus(); try { inp.setSelectionRange(v.length, v.length); } catch {} }
}
function setListSort(key, col) {
  const c = listCtl(key);
  if (c.sort === col) c.dir = -c.dir; else { c.sort = col; c.dir = 1; }
  render();
}
// Search input bound to a tab key (place in the tab header).
function listSearchInput(key, placeholder) {
  const c = listCtl(key);
  return `<input id="list-search-${key}" type="search" inputmode="text" enterkeyhint="search" autocomplete="off" value="${escapeAttr(c.q)}" oninput="setListSearch('${key}', this.value)" placeholder="${escapeAttr(placeholder || "Search name / 4D…")}" style="padding:6px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px;min-width:140px;flex:1 1 140px">`;
}
// Filter rows (each carrying d4 or id) by the active query against name + 4D.
function listSearchFilter(key, rows) {
  const q = listCtl(key).q.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => {
    const d4 = r.d4 || r.id || "";
    const name = (typeof getName === "function" ? getName(d4) : "") || r.name || "";
    return String(name).toLowerCase().includes(q) || String(d4).toLowerCase().includes(q);
  });
}
// A sortable header cell. accessorKey is the column key passed to listApplySort.
function sortTh(key, col, label, align) {
  const c = listCtl(key);
  const arrow = c.sort === col ? (c.dir > 0 ? " ▲" : " ▼") : "";
  return `<th onclick="setListSort('${key}','${col}')" style="cursor:pointer;user-select:none;${align === "left" ? "text-align:left;" : ""}" title="Click to sort">${label}${arrow}</th>`;
}
// Apply the active sort using a {col: accessor} map. Strings sort case-insensitively;
// numbers numerically. Stable-ish (slice copy). Returns rows unchanged if no sort set.
function listApplySort(key, rows, accessors) {
  const c = listCtl(key);
  if (!c.sort || !accessors || !accessors[c.sort]) return rows;
  const acc = accessors[c.sort];
  return rows.slice().sort((a, b) => {
    let va = acc(a), vb = acc(b);
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va == null) va = ""; if (vb == null) vb = "";
    if (va < vb) return -1 * c.dir;
    if (va > vb) return 1 * c.dir;
    return 0;
  });
}

// ── Admin statistics exports (CSV) ──────────────────────────────────────────
// One row per person with ≥1 report-sick record in scope. Like the Report Sick
// leaderboard, multiple medical rows on the same day collapse to ONE event per
// (d4, date) — a recruit logged twice for the same illness shouldn't double-count.
// Respects the topbar scope (visibleD4Set), so "what you see is what you export".
// rangeStartIso/rangeEndIso ("YYYY-MM-DD", inclusive) are optional bounds.
function buildSickStats(rangeStartIso, rangeEndIso) {
  const visible = visibleD4Set();
  const inRange = iso => (!rangeStartIso || iso >= rangeStartIso) && (!rangeEndIso || iso <= rangeEndIso);
  const hasRange = !!(rangeStartIso || rangeEndIso);
  const per = {};
  (STATE.medical || []).forEach(m => {
    if (!passesFilter(m.d4, visible)) return;
    const iso = displayDateToISO(m.date) || "";
    if (hasRange && (!iso || !inRange(iso))) return;
    const p = per[m.d4] || (per[m.d4] = {
      days: new Set(), rsi: new Set(), rso: new Set(), mr: new Set(),
      urti: new Set(), nonUrti: new Set(), mc: new Set(), ld: new Set(), last: ""
    });
    const key = m.date || iso;        // one event per calendar day (display string)
    p.days.add(key);
    if (iso && iso > p.last) p.last = iso;
    const t = String(m.type || "").toUpperCase();
    if (t === "RSI") p.rsi.add(key);
    if (t === "RSO") p.rso.add(key);
    if (t === "MR") p.mr.add(key);
    // URTI / NON-URTI split is meaningful only for actual report-sick rows.
    if (t === "RSI" || t === "RSO") {
      (( m.urtiType || classifyURTI(m.reason || "")) === "URTI" ? p.urti : p.nonUrti).add(key);
    }
    const st = String(m.status || "").toUpperCase();
    if (st === "MC") p.mc.add(key);
    if (st === "LD") p.ld.add(key);
  });
  return Object.entries(per).map(([d4, p]) => {
    const r = STATE.roster.find(x => x.id === d4);
    return {
      "4D": displayId(d4) || d4,
      Name: r ? (r.name || "") : "",
      Platoon: r ? personPlatoon(r) : "",
      Section: r ? personSection(r) : "",
      TotalRSDays: p.days.size,
      RSI: p.rsi.size,
      RSO: p.rso.size,
      MR: p.mr.size,
      URTI: p.urti.size,
      NonURTI: p.nonUrti.size,
      MCDays: p.mc.size,
      LDDays: p.ld.size,
      LastRS: p.last ? isoToDisplayDate(p.last) : ""
    };
  }).sort((a, b) => b.TotalRSDays - a.TotalRSDays || String(a["4D"]).localeCompare(String(b["4D"])));
}

function exportSickStats(rangeStartIso, rangeEndIso) {
  const rows = buildSickStats(rangeStartIso, rangeEndIso);
  if (!rows.length) { alert("No report-sick records in the current scope/range to export."); return; }
  exportCSV(rows, `sick_stats_${todayISO()}.csv`);
}

// HA statistics — one row per person in the topbar scope, derived from
// computeHA(d4) (§12.5). Reports both Single (target 10) and Expanded (target 14)
// progress, Double eligibility/progress (target 13 time-periods), and the
// rolling-14-day currency deadline / lapse so the admin can see who is at risk.
function buildHAStats() {
  return filteredRoster().map(r => {
    const h = computeHA(r.id);
    return {
      "4D": displayId(r.id) || r.id,
      Name: r.name || "",
      Platoon: personPlatoon(r),
      Section: personSection(r),
      OverallStatus: h.overallStatus,
      SingleStatus: h.singleStatus,
      SinglePeriods: h.single ? h.single.periods : 0,    // /10
      ExpandedPeriods: h.expanded ? h.expanded.periods : 0, // /14
      DoubleEligible: h.doubleEligible ? "Yes" : "No",
      DoubleStatus: h.doubleStatus || "",
      DoublePeriods: h.doubleTrack ? h.doubleTrack.periods : "", // /13 time-periods
      CurrencyLapsed: h.currency && h.currency.lapsed ? "Yes" : "No",
      CurrencyDeadline: h.currency && h.currency.deadlineIso ? isoToDisplayDate(h.currency.deadlineIso) : "",
      ActiveDays: (h.activeDays || []).length,
      LastActivity: h.lastActivity ? isoToDisplayDate(h.lastActivity) : ""
    };
  }).sort((a, b) => String(a["4D"]).localeCompare(String(b["4D"]), undefined, { numeric: true }));
}

function exportHAStats() {
  const rows = buildHAStats();
  if (!rows.length) { alert("No personnel in the current scope to export."); return; }
  exportCSV(rows, `ha_stats_${todayISO()}.csv`);
}

// `roleFilter` is optional — pass "Commander" or "Recruit" to restrict the
// dropdown (e.g. the Leave form picks commanders only). Commander options
// render as "rank name" without the administrative 00xx prefix.
// `opts.onchange` lets callers wire an inline change handler — useful when
// the picker is one row in a list-style form (e.g. the Log Conduct wizard).
function rosterSelect(id = "form-d4", required = true, selected = "", roleFilter = "", opts = {}) {
  // Back-compat: some old callers pass {onchange: ...} as the fourth arg.
  if (roleFilter && typeof roleFilter === "object") { opts = roleFilter; roleFilter = ""; }
  const rows = roleFilter ? STATE.roster.filter(r => r.role === roleFilter) : STATE.roster;
  const optLabel = r => r.role === "Commander"
    ? [r.rank, r.name].filter(Boolean).join(" ")
    : `${r.id} ${r.name}`;
  const onchangeAttr = opts.onchange ? ` onchange="${escapeAttr(opts.onchange)}"` : "";
  return `<select id="${id}" ${required ? "required" : ""}${onchangeAttr} style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;box-sizing:border-box"><option value="">Select...</option>${rows.map(r => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${optLabel(r)}</option>`).join("")}</select>`;
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

// Canonical HTML escaper — safe for BOTH text-node and double-quoted attribute
// contexts. Escapes & < > " '. Use this everywhere untrusted text (person names,
// medical reasons, conduct remarks/names, emails, custom statuses, CSV cells,
// and error/exception messages) is interpolated into an innerHTML template
// string, to neutralise DOM-XSS (a CSV/roster field like `<img onerror=…>` must
// render as inert text, not execute in the operator's authenticated session).
function escapeHTML(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// Back-compat alias: existing call sites used escapeAttr for attribute values.
// It now points at the full escaper (previously it missed `>` and `'`), so every
// existing escapeAttr(...) call is strengthened with no call-site change.
const escapeAttr = escapeHTML;

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

// Display-only formatter: normalize a clock time and append "Hrs", e.g.
// "0530" → "0530 Hrs", "0700-2100" → "0700-2100 Hrs". Empty → "". This is
// strictly for rendering (parade states, tables) — never persist its output;
// pad4Time remains the normalizer used for storage and matching keys. Leaves
// non-time strings (already-suffixed, "TBC", durations like "12:34") untouched.
function fmtHrs(t) {
  const p = pad4Time(t);
  if (!p || /hrs/i.test(p) || !/\d/.test(p) || p.includes(":")) return p;
  return `${p} Hrs`;
}

// SOC completion time is a *duration*, not a time of day. Parse a stored value
// — new "mm:ss" or legacy "hh:mm:ss" (from the old clock input) — into total
// seconds, then split into whole minutes + seconds for the duration entry form.
function socDurationParts(t) {
  if (t == null || t === "") return { min: "", sec: "" };
  const parts = String(t).split(":").map(n => parseInt(n, 10) || 0);
  let total;
  if (parts.length === 3) total = parts[0] * 3600 + parts[1] * 60 + parts[2]; // hh:mm:ss
  else if (parts.length === 2) total = parts[0] * 60 + parts[1];               // mm:ss
  else total = parts[0] || 0;                                                  // bare seconds
  return { min: Math.floor(total / 60), sec: total % 60 };
}
// Display a stored SOC time as a clean "m:ss" duration (drops a legacy leading
// "00:" hours component so old and new rows render consistently).
function socDurationDisplay(t) {
  if (t == null || t === "") return "—";
  const { min, sec } = socDurationParts(t);
  if (min === "" ) return "—";
  return `${min}:${String(sec).padStart(2, "0")}`;
}

// ── MSK INJURY CLASSIFICATION ────────────────────────────
// Maps free-text injury descriptions ("sprained ankle", "TFCC right wrist",
// "shin splints") to body regions for analytics aggregation. Order matters
// for overlapping keywords — more specific terms (achilles, TFCC) win over
// generic (foot, wrist). Each row's `keys` are matched as substrings,
// case-insensitive, against the full text.
const MSK_REGION_MAP = [
  { keys: ["achilles", "calf", "shin", "lower leg"], region: "Shin / Lower Leg" },
  { keys: ["tfcc", "wrist"],                          region: "Hand / Wrist" },
  { keys: ["hand", "finger"],                         region: "Hand / Wrist" },
  { keys: ["ankle"],                                  region: "Ankle" },
  { keys: ["knee"],                                   region: "Knee" },
  { keys: ["tailbone", "coccyx"],                     region: "Back / Spine" },
  { keys: ["back", "spine", "lumbar"],                region: "Back / Spine" },
  { keys: ["shoulder", "rotator"],                    region: "Shoulder" },
  { keys: ["toe", "blister", "foot", "abrasion"],     region: "Foot" },
  { keys: ["thigh", "hamstring", "quad", "hip"],      region: "Upper Leg / Hip" },
  { keys: ["neck"],                                   region: "Neck" }
];

// Strong non-MSK signals — if these appear in a conductDetail.reason we
// exclude the row from MSK analytics regardless of other words. Catches
// the common "fever / cough / stomach / eczema" stuff that the CO doesn't
// want polluting injury charts.
const NON_MSK_KEYWORDS = [
  "fever", "flu", "cough", "sore throat", "stomach", "diarrh", "vomit",
  "nausea", "eczema", "rash", "skin", "lightheaded", "giddy", "headache",
  "blocked nose", "runny nose", "drowsy meds", "took meds"
];

// All known regions in display order — used by the manual-override picker
// menu and for "ensure all regions appear in the legend" type passes.
const MSK_REGION_LIST = [
  "Ankle", "Knee", "Back / Spine", "Shin / Lower Leg", "Shoulder",
  "Hand / Wrist", "Foot", "Upper Leg / Hip", "Neck", "Other"
];

const MSK_REGION_COLORS = {
  "Ankle":             "#E8573A",
  "Knee":              "#F2A93B",
  "Back / Spine":      "#5B8DEF",
  "Shin / Lower Leg":  "#43C59E",
  "Shoulder":          "#A87BDB",
  "Hand / Wrist":      "#E97BC2",
  "Foot":              "#6EC8DB",
  "Upper Leg / Hip":   "#FFD93D",
  "Neck":              "#FF6B9D",
  "Other":             "#8E99A4"
};

function classifyInjuryRegions(text) {
  const t = String(text || "").toLowerCase();
  const hits = new Set();
  MSK_REGION_MAP.forEach(({ keys, region }) => {
    if (keys.some(k => t.includes(k))) hits.add(region);
  });
  return hits.size ? [...hits] : ["Other"];
}

// Returns true if a conductDetail.reason or similar text looks like an
// MSK case (mentions a region OR uses an injury verb). Non-MSK keywords
// veto it outright.
function isMSKReason(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  if (NON_MSK_KEYWORDS.some(k => t.includes(k))) return false;
  if (MSK_REGION_MAP.some(({ keys }) => keys.some(k => t.includes(k)))) return true;
  return /sprain|strain|injury|pain|sore|fell\b|hurt|swollen|inflam|fracture|tear/i.test(t);
}

// Resolves the regions for a recruit's MSK case. Manual override (set via
// the dashboard MSK card chips) wins. Otherwise unions auto-classified
// regions from BOTH the recruit's Report Injury rows AND any MSK-filtered
// conductDetail rows — so a recruit who falls out at PT due to MSK but
// never submits a Form report still shows up in region analytics with
// their reason text auto-classified.
function getMSKRegionsForRecruit(d4) {
  const reports = STATE.msk.filter(m =>
    m.d4 === d4 && (m.type || "").toLowerCase().includes("report")
  );

  // Manual override wins (stored on the Report Injury row, so only
  // available for recruits who submitted a form).
  const manual = reports.map(r => r.manualRegions).find(v => v && String(v).trim());
  if (manual) {
    return String(manual).split(",").map(s => s.trim()).filter(Boolean);
  }

  // Else union of auto-classified regions from form descriptions AND
  // MSK-classified conduct detail reasons for this recruit.
  const regions = new Set();
  reports.forEach(r => classifyInjuryRegions(r.description).forEach(reg => regions.add(reg)));
  STATE.conductDetail
    .filter(c => c.d4 === d4 && isMSKReason(c.reason))
    .forEach(c => classifyInjuryRegions(c.reason).forEach(reg => regions.add(reg)));

  // Strip "Other" if we found anything specific — keeps the region list clean.
  const result = [...regions];
  if (result.length > 1) return result.filter(r => r !== "Other");
  return result;
}

// Check if a conduct should be excluded from Heat Acclimatisation calculation
function isHAExcluded(conductId) {
  const name = String(conductName(conductId) || "").toLowerCase();
  return name.includes("ippt") || name.includes("sports & games") || name.includes("swim");
}

// ── Heat Acclimatisation (Braves §12 + HA.md — authoritative) ───────────────
// Participation comes ONLY from CSV-imported conducts (§12.2): see
// HA_DATA_SHAPE.md. haDayMap builds {isoDay: Σ B5 periods} for HA-eligible
// conducts where the person is in the Present `participants` list.
function conductHAEligible(att) {
  if (configGet("haEligibilitySource") === "currencyTag") return /\bha\b/i.test(att.currencyTags || "");
  return !isHAExcluded(att.conductId);          // default: existing name logic
}
function haDayMap(d4) {
  const map = {};
  (STATE.attendance || []).forEach(a => {
    if (a.source !== "csv") return;             // only CSV imports establish HA
    if (!conductHAEligible(a)) return;
    const ids = parseParticipantIds(a.participants);
    if (!ids.includes(String(d4))) return;
    const iso = displayDateToISO(a.date);
    if (!iso) return;
    map[iso] = (map[iso] || 0) + (Number(a.periods) || 1);   // Σ B5 periods that day
  });
  return map;
}

// Local (tz-safe) yyyy-mm-dd key + day arithmetic. Using toISOString() here would
// shift the date under a +ve UTC offset; build the key from local fields instead.
function _haKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function _haAddDays(iso, n) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return _haKey(d); }

// §12.4 state machine. dateMap[iso] = periodSum (>0 ⇒ active day). mode "day" adds
// 1 per active day (Single/Expanded, capped 1/day); "time" adds the periodSum
// (Double — sums B5 time-periods, HA.md). Resets on break-limit breach.
//
// params.maxActiveDays (optional) caps the active-day span of one attempt: Double is
// "13 periods across 7 days, not inclusive of breaks" (HA.md §3) — the periods may be
// many per day but must land within 7 *active* days. Reaching that many active days
// without hitting the target restarts the window from the current day. Single/Expanded
// omit it (their target == active-day count, so the span is self-bounding).
//
// Unlike a single-completion return, the machine scans the full [start..end] range and
// records EVERY completion (resetting after each) in `completions`. computeHACurrency
// needs all qualification dates so a programme completed *after* a lapse can re-qualify
// the person (HA.md "Lapse recovery"). `status`/`completionDate`/`periods` keep their
// first-completion meaning for the existing display callers.
function runHAStateMachine(dateMap, startIso, endIso, params) {
  let periods = 0, breaksUsed = 0, consec = 0, activeDays = 0, windowStart = null;
  let firstCompletion = null, firstCompletionPeriods = 0;
  const completions = [];
  const d = new Date(startIso + "T00:00:00"), end = new Date(endIso + "T00:00:00");
  while (d <= end) {
    const key = _haKey(d);
    const inc = dateMap[key] || 0;
    const active = inc > 0;
    const step = params.mode === "time" ? inc : 1;
    if (windowStart === null) {
      if (active) { windowStart = key; periods = step; activeDays = 1; }
    } else if (active) {
      if (params.maxActiveDays !== undefined && activeDays >= params.maxActiveDays) {
        // Active-day span exhausted without completing — restart from this day.
        periods = step; breaksUsed = 0; consec = 0; activeDays = 1; windowStart = key;
      } else {
        periods += step; consec = 0; activeDays++;
      }
    } else {
      breaksUsed++; consec++;
      if (breaksUsed > params.maxBreak || (params.maxConsec !== undefined && consec > params.maxConsec)) {
        periods = 0; breaksUsed = 0; consec = 0; activeDays = 0; windowStart = null;
      }
    }
    if (periods >= params.target) {
      completions.push(key);
      if (firstCompletion === null) { firstCompletion = key; firstCompletionPeriods = periods; }
      // Reset so a later full programme (a re-qualification) is detected too.
      periods = 0; breaksUsed = 0; consec = 0; activeDays = 0; windowStart = null;
    }
    d.setDate(d.getDate() + 1);
  }
  const completed = firstCompletion !== null;
  return {
    status: completed ? "Completed" : (windowStart ? "In Progress" : "Not Started"),
    completionDate: firstCompletion,
    completions,
    periods: completed ? firstCompletionPeriods : periods,
    breaksUsed, consecutiveBreak: consec, windowStart
  };
}

// HA currency (HA.md "Clarifications" / DECISIONS #3,#4 — authoritative over the
// spec §12.5 ">14 days" shorthand). From qualification, each activity pairs with
// the most recent prior activity; a ≤7-day pair resets Day 1 to the day after the
// later activity (deadline = later + 14 days). An activity (or today) past the
// Day-14 deadline with no intervening reset ⇒ lapsed. The deadline check precedes
// the pairing reset so a partner that lands past Day 14 still lapses (HA.md Example 1).
//
// `qualDates` is the full sorted list of programme-completion dates (Single OR
// Expanded — one scheme for everyone, HA.md). Completing a programme (re)starts the
// window from that day, so a programme finished AFTER a lapse re-qualifies the person
// (HA.md "Lapse recovery"). A bare string is accepted for back-compat (single qual).
function computeHACurrency(dayKeys, qualDates) {
  const quals = (Array.isArray(qualDates) ? qualDates : [qualDates]).filter(Boolean).slice().sort();
  if (!quals.length) return { lapsed: false, deadlineIso: null };
  const qualSet = new Set(quals);
  const firstQual = quals[0];
  let deadline = null, prev = null, lapsed = false, lapseDateIso = null;
  for (const a of dayKeys) {
    if (a < firstQual) continue;
    if (qualSet.has(a)) {
      // (Re)qualification — restart the 14-day window, recovering from any lapse.
      deadline = _haAddDays(a, 14); prev = a; lapsed = false; lapseDateIso = null;
      continue;
    }
    if (lapsed) { prev = a; continue; }                 // stay lapsed until re-qualification
    if (a > deadline) { lapsed = true; lapseDateIso = deadline; prev = a; continue; }
    if (daysBetween(prev, a) <= 7) deadline = _haAddDays(a, 14);
    prev = a;
  }
  if (!lapsed && deadline !== null && todayISO() > deadline) { lapsed = true; lapseDateIso = deadline; }
  return lapsed ? { lapsed: true, lapseDateIso } : { lapsed: false, deadlineIso: deadline };
}

// Double-HA rank gate (HA.md: ≥3SG / ≥2LT ⇒ Foundation/Service Term done).
// rankGroupOf already buckets those as WOSPEC/Officer; Enlistee = not eligible.
function rankQualifiesDoubleHA(r) { return rankGroupOf(r) !== "Enlistee"; }
function hasVocFit(d4) {
  return (STATE.vocfit || []).some(v => String(v.personId || v.d4 || "") === String(d4) && (v.completionDate || v.completed || v.done));
}

// computeHA(personId) — §12.5. Returns both Single/Expanded tracks (same outcome,
// parallel paths) and the Double track when eligible, plus an overall single-label
// `overallStatus` for badges/charts and the raw `dayMap` for the activity timeline.
function computeHA(d4) {
  const dayMap = haDayMap(d4);
  const keys = Object.keys(dayMap).sort();
  const base = {
    dayMap, activeDays: keys, single: null, expanded: null, doubleTrack: null,
    singleStatus: "Not Started", singleTrack: null, doubleEligible: false, doubleStatus: null,
    overallStatus: "Not Started", currency: { lapsed: false, deadlineIso: null },
    lastActivity: keys.length ? keys[keys.length - 1] : null
  };
  if (!keys.length) return base;

  const start = keys[0];
  const today = todayISO();
  const endIso = today > start ? today : keys[keys.length - 1];

  const single = runHAStateMachine(dayMap, start, endIso, { target: 10, maxBreak: 2, mode: "day" });
  const expanded = runHAStateMachine(dayMap, start, endIso, { target: 14, maxBreak: 5, maxConsec: 3, mode: "day" });
  const singleComplete = single.status === "Completed" || expanded.status === "Completed";

  let singleStatus, singleTrack = null;
  if (singleComplete) {
    singleStatus = "Single HA Complete";
    singleTrack = single.status === "Completed" ? "Single" : "Expanded";
  } else {
    singleStatus = (single.status === "In Progress" || expanded.status === "In Progress") ? "In Progress" : "Not Started";
  }

  // Currency / lapse — only meaningful once qualified. Pass EVERY qualification date
  // (all Single + Expanded completions) so a programme re-completed after a lapse can
  // recover currency (HA.md lapse-recovery). firstQual gates the Double window below.
  let currency = { lapsed: false, deadlineIso: null };
  let firstQual = null;
  if (singleComplete) {
    const comps = [...new Set([...(single.completions || []), ...(expanded.completions || [])])].sort();
    firstQual = comps[0];
    currency = computeHACurrency(keys, comps);
    if (currency.lapsed) singleStatus = "Lapsed";
  }

  // Double track (gated on a live Single qualification + eligibility). Counted ONLY
  // from the day after Single qualification — Double is a distinct programme done by
  // those who have ALREADY completed Single (HA.md §3), so its 13 periods / 7-day
  // window must not reuse the sessions that earned Single.
  let doubleEligible = false, doubleStatus = null, doubleTrack = null;
  if (singleComplete && singleStatus !== "Lapsed") {
    const r = STATE.roster.find(x => x.id == d4);
    doubleEligible = hasVocFit(d4) || (r && rankQualifiesDoubleHA(r));
    if (doubleEligible) {
      const dblStart = _haAddDays(firstQual, 1);
      doubleTrack = runHAStateMachine(dayMap, dblStart, endIso, { target: 13, maxBreak: 2, maxActiveDays: 7, mode: "time" });
      doubleStatus = doubleTrack.status === "Completed" ? "Double HA Complete" : doubleTrack.status;
    }
  }

  let overallStatus;
  if (singleStatus === "Lapsed") overallStatus = "Lapsed";
  else if (doubleStatus === "Double HA Complete") overallStatus = "Double HA Complete";
  else if (singleComplete && doubleEligible && doubleStatus === "In Progress") overallStatus = "In Progress (Double)";
  else if (singleComplete) overallStatus = "Single HA Complete";
  else overallStatus = singleStatus; // "In Progress" | "Not Started"

  return {
    ...base, single, expanded, doubleTrack, singleStatus, singleTrack,
    doubleEligible, doubleStatus, overallStatus, currency, lastActivity: keys[keys.length - 1]
  };
}

