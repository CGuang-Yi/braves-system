// Global app state. Roster/medical/etc. start empty — real data comes from
// the Google Sheet via API.pullAll() on launch, or from localStorage on
// subsequent loads.

// The Apps Script web app URL. This is no longer a secret — auth is enforced
// server-side by per-device tokens issued via the invite flow (see Apps Script).
// PASTE YOUR DEPLOYMENT URL HERE after redeploying the updated Apps Script:
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz0moNSMsJfkFrg-u1sGCCCdd9GALNi-nkfV-C0JqGjBuusdJTDZHXeX8isP6dqFkEyeg/exec"

// Storage key is versioned so we can invalidate stale caches in users' browsers.
const STORAGE_KEY = "cougar-data-v2";
const STORAGE_KEY_LEGACY = "cougar-data"; // v1 — contained hardcoded personnel fallback
const AUTH_KEY = "cougar-auth";           // per-device auth token (now from login, not invites)
// Session metadata that rides alongside the token: the account's role + identity.
// Kept in their own keys (not in STORAGE_KEY) so a data-cache clear doesn't sign
// the user out. The token in AUTH_KEY remains the single source the API sends.
const ROLE_KEY = "braves-role";
const PERSONID_KEY = "braves-personid";
const EMAIL_KEY = "braves-email";
const FILTER_KEY = "cougar-filter";
const IPPT_AGG_KEY = "cougar-ippt-agg";
const FITNESS_SENT_KEY = "cougar-fitness-sent";
const DIRTY_KEY = "cougar-dirty-tabs";
const CUSTOM_STATUS_KEY = "cougar-custom-statuses";
const DEFER_CHARTS_KEY = "braves-defer-charts"; // chart lazy-load pref: auto|defer|eager

// Sheet-tab-name → STATE-array-key lookup. The autoSync coalesce path uses
// this when flushing a queued replace push: by the time the flush runs the
// caller's `data` snapshot is stale, so we re-read the latest STATE[arrayKey]
// from this map. Kept in state.js because it's tightly coupled to the STATE
// shape above.
const TAB_TO_STATE = {
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
  "Conducts": "conducts",
  // Braves §4/§12/A6 reference tabs. VocFit/Platoons round-trip via the normal
  // sync primitives; Config is key/value and is written through its own path
  // (it normalizes array→object on read), so it is intentionally absent here.
  "VocFit": "vocfit",
  "Platoons": "platoons"
};

// Company-specific defaults (spec §4). Every value the system used to hardcode
// lives here so the app adapts to another company by editing the BravesConfig tab,
// not the code. STATE.config overlays these; it is populated by readAllTabs from
// BOTH the bot's Config tab (parade/archive keys) and the BravesConfig tab
// (company-identity keys), merged into one object. A missing key falls back to the
// default below via configGet().
const DEFAULT_CONFIG = {
  companyName: "40 SAR BRAVES COMPANY",
  companyPrefix: "B",
  companyCoyCode: "B COY",
  unitCode: "40SAR",
  hqLabel: "BRAVES HQ",
  defaultSickLocation: "PTMC",
  polarCompanyName: "Braves Coy",
  // Which signal decides whether a conduct earns an HA period (spec §14.3):
  // "isHAExcluded" = legacy conduct-name logic; "currencyTag" = the CSV
  // "Currency Tags: HA" metadata. Switchable without code changes. Default is
  // the tag: the name logic only excludes IPPT/Sports & Games/Swim, so untagged
  // non-HA conducts (e.g. Combat PT) wrongly earned HA days under it. NOTE: an
  // explicit BravesConfig sheet value overrides this default — clear/update the
  // sheet row if it still says "isHAExcluded".
  haEligibilitySource: "currencyTag",
  // Leave types that classify as AL/OIL in parade state (spec §8, DECISIONS
  // #32/#35). Any leave type NOT in this comma-separated list falls to OTHERS,
  // sub-typed in/out of camp by reason keywords. Edit here (or override via the
  // Config tab) to retune the split without touching code.
  alOilLeaveTypes: "Leave, Off-in-Lieu, OIL, AL, Annual Leave, Weekend, Night's Out, Compassionate"
};

// Read a Config value with the company default as a fallback. Always returns a
// string-ish value; never throws on a missing Config tab.
function configGet(key) {
  const v = STATE.config && STATE.config[key];
  return (v !== undefined && v !== null && v !== "") ? v : DEFAULT_CONFIG[key];
}

// Persisted set of tab names with unpushed local changes. Survives reloads
// in its own localStorage key (separate from STORAGE_KEY) so a "Clear cache"
// of the data doesn't lose the dirty markers we need to know to retry.
function loadDirty() {
  try {
    const raw = localStorage.getItem(DIRTY_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function saveDirty() {
  localStorage.setItem(DIRTY_KEY, JSON.stringify([...(STATE.dirty || [])]));
}

// User-created medical statuses, persisted per-device. Shape:
//   [{ name: "Excuse Finger", participates: true }]
// `participates` = recruit normally still does the conduct despite this status
// (drives the wizard's "not participating" default). Custom statuses are
// always in-camp/restricted and never get +1/+2 ghost tags. Lives in its own
// localStorage key so a data-cache reset doesn't wipe the user's status list.
function loadCustomStatuses() {
  try {
    const arr = JSON.parse(localStorage.getItem(CUSTOM_STATUS_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter(s => s && s.name) : [];
  } catch { return []; }
}
function saveCustomStatuses() {
  localStorage.setItem(CUSTOM_STATUS_KEY, JSON.stringify(STATE.customStatuses || []));
}

// Reads the persisted "who got a fitness report and when" map.
// Shape: { "1101": "2026-05-27T14:40:25.296Z", ... }.
// Lives in localStorage so it doesn't get touched by saveLocal / pullAll,
// which means it survives `localStorage.removeItem(STORAGE_KEY)` resets.
function loadFitnessSent() {
  try {
    const raw = localStorage.getItem(FITNESS_SENT_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}
function saveFitnessSent(map) {
  localStorage.setItem(FITNESS_SENT_KEY, JSON.stringify(map || {}));
}
function markFitnessSent(d4, when) {
  if (!d4) return;
  STATE.fitnessSent[String(d4)] = when || new Date().toISOString();
  saveFitnessSent(STATE.fitnessSent);
}
function clearFitnessSent() {
  STATE.fitnessSent = {};
  saveFitnessSent(STATE.fitnessSent);
}
// Merge an external map (e.g. exported from another device) into the
// existing one. Keeps the most-recent timestamp per d4 when both sides have
// the same id, so you never accidentally "un-mark" a more-recent send by
// importing an older record.
function importFitnessSent(json) {
  let incoming;
  try { incoming = typeof json === "string" ? JSON.parse(json) : json; }
  catch (e) { return { ok: false, error: "Not valid JSON: " + e.message }; }
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return { ok: false, error: "Expected an object like { \"1101\": \"2026-05-27T…\", ... }" };
  }
  let added = 0, updated = 0;
  for (const k of Object.keys(incoming)) {
    const key = padD4(k);
    const t = String(incoming[k] || "");
    if (!t) continue;
    if (!STATE.fitnessSent[key]) { STATE.fitnessSent[key] = t; added++; }
    else if (t > STATE.fitnessSent[key]) { STATE.fitnessSent[key] = t; updated++; }
  }
  saveFitnessSent(STATE.fitnessSent);
  return { ok: true, added, updated, total: Object.keys(STATE.fitnessSent).length };
}

const STATE = {
  nav: "dashboard",
  apiUrl: APPS_SCRIPT_URL,
  authToken: localStorage.getItem(AUTH_KEY) || "",
  // Account session (set on login). `role` drives the read-only gate and the
  // admin panel; `personId`/`email` identify the signed-in account. Empty until
  // a successful login.
  role: localStorage.getItem(ROLE_KEY) || "",
  personId: localStorage.getItem(PERSONID_KEY) || "",
  email: localStorage.getItem(EMAIL_KEY) || "",
  // Admin-panel data, loaded on demand from the backend (never cached to disk):
  accounts: [],   // [{email, personId, role, addedBy, addedAt}] — no secrets
  tokens: [],     // active sessions [{token, tokenPrefix, email, role, issuedAt, expired}]
  auditLog: [],   // audit rows — only populated for admin pulls
  paradeArchive: [], sickArchive: [], // archived parade/sick messages — admin-only pulls (Item 1)
  roster: [], medical: [], attendance: [], ippt: [], rm: [], soc: [], polar: [], conductDetail: [], appointments: [], leave: [], msk: [],
  // Braves reference data (spec §4/§12/A6). config is an object keyed by Config
  // `key`; vocfit/platoons are row arrays. All empty until pulled — every reader
  // falls back to DEFAULT_CONFIG / derivation so the app works before the Sheet
  // tabs exist.
  config: {},
  vocfit: [],
  platoons: [],
  // Canonical conduct registry: [{id: "c001", name: "Orientation Run"}, ...].
  // Source of truth for the conduct dimension — records on attendance/polar/
  // conductDetail reference entries here via `conductId` instead of carrying
  // free-text conduct names. Empty array on first load triggers the migration
  // modal that promotes legacy string `conduct` fields to ids.
  conducts: [],
  // Global view scope: "" = all. Persisted across reloads so leaving the app
  // mid-task and coming back doesn't blow away the section you were focused on.
  // filterRole adds a third dimension on top of platoon/section — toggles
  // between "All", "Commander", "Recruit" (lets the user see parade-state-style
  // strength without commanders polluting recruit-only views and vice versa).
  filterRole: "",
  filterPlt: "",
  filterSect: "",
  // IPPT stats aggregation: "latest" (most recent attempt per recruit) or
  // "best" (highest-scoring attempt). Drives the IPPT tab's stats row, charts,
  // and leaderboard. Does NOT affect the underlying table — that always
  // shows every row.
  ipptAggMode: localStorage.getItem(IPPT_AGG_KEY) === "best" ? "best" : "latest",
  // Chart lazy-load preference for heavy chart views (Strength Board + Conduct
  // Dashboard). "auto" (default) defers chart construction on mobile viewports
  // and renders eagerly on desktop; "defer" always waits for a manual tap;
  // "eager" always builds on load. Chart.js canvas construction is the mobile
  // jank source — cheap tiles/tables always render immediately regardless.
  deferCharts: (function () { const v = localStorage.getItem(DEFER_CHARTS_KEY); return v === "defer" || v === "eager" ? v : "auto"; })(),
  // Per-device record of which recruits have already had a fitness report
  // emailed to them. Drives the "skip already sent" default on bulk send so
  // a session interrupted mid-batch (or a fresh device) can resume without
  // double-sending. Map of d4 → ISO timestamp of last successful send.
  fitnessSent: loadFitnessSent(),
  // Set of sheet-tab names with unpushed local changes (push failed or
  // never attempted). Drives the sidebar "X tabs need retry" warning and
  // the on-launch dirty-restore prompt.
  dirty: loadDirty(),
  // User-created medical statuses (see loadCustomStatuses). Reusable in the
  // Report Sick form's status dropdown alongside the built-in vocabulary.
  customStatuses: loadCustomStatuses(),
  // Per-tab server revision last seen by this device, keyed by SHEET name
  // ("Roster", "Medical", …). Sent as `baseRev` on every write so the server
  // can reject a stale overwrite, and compared against the lightweight revCheck
  // poll to decide which tabs to auto-refresh. Persisted WITH the data (not a
  // separate key) so a reloaded stale tab pushes with the rev it actually last
  // saw — a desynced rev would defeat the staleness check.
  rev: {},
  charts: {}
};

function setIpptAggMode(mode) {
  STATE.ipptAggMode = mode === "best" ? "best" : "latest";
  localStorage.setItem(IPPT_AGG_KEY, STATE.ipptAggMode);
}

// Chart lazy-load pref (auto|defer|eager) — persisted per device.
function setDeferCharts(mode) {
  STATE.deferCharts = (mode === "defer" || mode === "eager") ? mode : "auto";
  localStorage.setItem(DEFER_CHARTS_KEY, STATE.deferCharts);
}
// Should heavy charts wait for a manual "Load charts" tap right now? "auto"
// defers only on mobile-width viewports. Re-evaluated per render so a resize or
// device rotation is honoured.
function shouldDeferCharts() {
  if (STATE.deferCharts === "defer") return true;
  if (STATE.deferCharts === "eager") return false;
  return typeof window !== "undefined" && window.innerWidth <= 768;
}

// Sheet column is "4d" (preserved verbatim by Apps Script readTab), but the
// rest of the codebase has always used r.id. Mirror the value into r.id at
// every entry point so callers don't have to think about it. Also strip
// legacy `conditions` field so it never round-trips back to the sheet.
// Canonicalize a 4D — strip any leading "C" (some sheets store recruit IDs
// as "C1101" rather than "1101"), then re-pad 1–3 digit numeric values to
// 4 digits so commander IDs like "0001" survive Google Sheets stripping
// the leading zeros. Output is always digit-only, never C-prefixed, so all
// layers join cleanly via `d4`.
function padD4(d4) {
  const s = String(d4 ?? "").trim().replace(/^C/i, "");
  if (/^\d{1,3}$/.test(s)) return s.padStart(4, "0");
  return s;
}

function normalizeRoster(roster) {
  return (roster || []).map(r => {
    const { conditions, ...rest } = r;
    const id = padD4(rest.id || rest["4d"] || rest["4D"] || "");
    // Auto-detect commander by id pattern (00xx) when the `role` column is
    // blank — this makes adding commanders straight from the Google Sheet
    // safe even if the user forgets to fill role="Commander". Explicit role
    // values from the sheet always win.
    const isCmdrById = /^00\d{2}$/.test(id);
    const role = rest.role || (isCmdrById ? "Commander" : "Recruit");
    // Braves org model (spec §5). These are new explicit columns; they default
    // empty when the Sheet hasn't added them yet (the Step-5 scope rewrite reads
    // them, the legacy 4D-parsing filter still works in the meantime).
    //   platoon  — "HQ" / "PLT1".."PLTn"
    //   section  — "1".."N", "Command" (PC/PS), or blank for HQ-flat personnel
    //   rankGroup— "Officer" / "WOSPEC" / "Enlistee" (drives the strength split)
    //   fourD    — display 4D; equals id for numeric non-commander ids, blank
    //              for no-4D personnel (commanders show rank+name instead).
    const fourD = rest.fourD !== undefined && rest.fourD !== ""
      ? String(rest.fourD).trim()
      : (role !== "Commander" && /^\d{4}$/.test(id) ? id : "");
    return {
      ...rest,
      id,
      role,
      rank: rest.rank || "",
      platoon: rest.platoon || "",
      section: rest.section != null ? String(rest.section) : "",
      rankGroup: rest.rankGroup || "",
      fourD,
      leaveQuota: rest.leaveQuota !== undefined && rest.leaveQuota !== "" ? +rest.leaveQuota : ""
    };
  });
}

// Coerce every Medical record to the full current schema. Two reasons:
//   1) Drop legacy fields (type, conductMissed) so they don't round-trip.
//   2) Guarantee every row carries startDate/endDate keys — Apps Script's
//      writeTab generates sheet headers from Object.keys(data[0]) only, so
//      a stale first row missing the new keys would silently strip them
//      from the entire pushed sheet.
function normalizeMedical(records) {
  return (records || []).map(r => {
    // Auto-migrate any legacy "Excused X" entries to the canonical "Excuse X"
    // spelling so badge colors / parade-state filters match consistently.
    let status = r.status || "";
    if (/^Excused /.test(status)) status = status.replace(/^Excused /, "Excuse ");
    return {
      id: r.id,
      d4: padD4(r.d4 || ""),
      date: r.date || "",
      reason: r.reason || "",
      // Where the recruit reported sick — only meaningful for report-sick-
      // outside cases (external clinic/hospital). Blank for in-camp report sick.
      location: r.location || "",
      status,
      startDate: r.startDate || "",
      endDate: r.endDate || "",
      // Braves §6 fields. `type` is the visit type (RSI/RSO/MR + legacy values),
      // distinct from `status` (the MO outcome: MC/LD/Excuse…). All default
      // blank so legacy rows keep working; the parade-state classifier (Step 3)
      // reads `type` for REPORTING SICK / MR and `status` for ATT C / STATUS.
      type: r.type || "",
      urtiType: r.urtiType || "",      // "URTI" / "NON-URTI" — meaningful for RSI/RSO
      mrTiming: r.mrTiming || "",      // optional free-text timing for MR rows
      visitId: r.visitId || "",        // groups sibling rows of one multi-status visit
      // Provenance: "conductLog" = auto-created from a conduct import / wizard
      // (a Pending report-sick backfill); "manual" = entered directly in the
      // Medical tab. Legacy rows default to "manual". Surfaced as a badge so
      // operators can tell auto-backfilled rows from hand-logged ones.
      origin: r.origin || "manual"
    };
  });
}

// Generic d4-padding pass for layers that don't have their own normalizer.
// Applied at every read boundary (loadLocal, pullAll) so commander 4Ds
// stay 4 digits regardless of how Sheets mangles them on round-trip.
function padD4OnLayer(records) {
  return (records || []).map(r => r && r.d4 != null ? { ...r, d4: padD4(r.d4) } : r);
}

// ConductDetail rows. Pads the 4D like every other layer, then migrates the
// legacy `type:"PX"` → `"Status"`. Historically "PX" labelled an *absence due
// to a pre-existing status* (MC/LD/Leave/Off) — the opposite of what PX really
// means (a set of stretches done by non-participants who are still PRESENT, NOT
// an absence). So legacy "PX" rows are all absences and must become "Status".
//
// CRITICAL — why the genuine present-not-participating type is stored as "PXP",
// NOT "PX": this migration runs at every read boundary (pull AND loadLocal) and
// cannot tell a legacy absence-"PX" from a newly-authored genuine-"PX" — both
// are the literal string "PX". If genuine rows reused "PX", every reload/pull
// would silently rewrite them to "Status", reclassifying a non-absence as a
// counted absence (inflating missed/parade-state tallies). Using a distinct
// stored token ("PXP") for the new meaning makes the two unambiguous: "PX" is
// purely a legacy source that always maps to "Status", while "PXP" is the live
// genuine type and is never touched. The human-facing label stays "PX".
// (A future one-time backend rewrite of the sheet could retire this read-time
// remap, but the token split keeps the client correct with no backend coupling.)
function normalizeConductDetail(records) {
  return padD4OnLayer(records).map(r =>
    r && r.type === "PX" ? { ...r, type: "Status" } : r);
}

// MSK records arrive from a Google Form that writes verbose column headers
// ("4D (e.g. C1234)", "Injury Description", "List of Exercises Given …").
// Apps Script readTab uses those headers as object keys verbatim, so we
// translate to short, stable keys here. Also strips any leading "C" on
// the 4D (the form column prompts for "C1234"-style input) and pads to
// 4 digits in case Sheets stripped a leading zero.
function normalizeMSK(records) {
  const pick = (r, ...keys) => {
    for (const k of keys) {
      const v = r[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return "";
  };
  return (records || []).map(r => {
    // Accepts every header variant the form may have used over time —
    // current ("4D (e.g. 1101)"), legacy ("4D (e.g. C1234)"), or just "4D".
    // The defensive `^C` strip handles any recruit who still types "C1101".
    const rawD4 = String(pick(r, "4D (e.g. 1101)", "4D (e.g. C1234)", "4D", "d4")).trim().replace(/^C/i, "");
    const clearedRaw = pick(r, "Cleared", "cleared");
    // manualRegions — comma-separated body region tags set by the dashboard
    // override UI. Overrides the auto-classifier for analytics. Persists
    // via pushTab so it round-trips to the MSK sheet on next Push All.
    const manualRegions = String(pick(r, "manualRegions", "ManualRegions", "Manual Regions") || "").trim();
    return {
      timestamp: pick(r, "Timestamp", "timestamp"),
      d4: padD4(rawD4),
      type: pick(r, "Type", "type"),
      description: pick(r, "Injury Description", "description", "Description"),
      physioDate: pick(r, "Date of Physio Visit", "physioDate", "PhysioDate"),
      exercises: pick(r, "List of Exercises Given (names of exercises)", "exercises", "Exercises"),
      cleared: clearedRaw === true || String(clearedRaw).toUpperCase() === "TRUE",
      manualRegions
    };
  });
}

// Config tab arrives as key/value rows ([{key, value}, ...]); collapse to a
// plain object keyed by `key`. Tolerant of header casing (key/Key, value/Value)
// and ignores blank keys. Returns {} when there's nothing usable.
// Accepts BOTH Config-tab shapes (the sheet can be either, and the Telegram bot
// owns the same "Config" tab as a single columns-as-keys row):
//   • key/value rows  → {key:"companyName", value:"…"}            (Braves spec §4)
//   • columns-as-keys → {companyName:"…", archiveParadeTimes:"…"}  (bot/COS layout)
// A row is treated as key/value only when it actually has a `key` column; otherwise
// every column on the row is taken as a setting. Both can coexist on one tab, so the
// bot's columns (botGroupChatId, …) and Braves settings live side by side.
function normalizeConfig(rows) {
  const out = {};
  const put = (k, v) => { const kk = String(k).trim(); if (kk) out[kk] = typeof v === "string" ? v.trim() : v; };
  (rows || []).forEach(r => {
    if (!r) return;
    if (r.key !== undefined || r.Key !== undefined || r.KEY !== undefined) {
      const k = String(r.key ?? r.Key ?? r.KEY ?? "").trim();
      if (k) put(k, r.value ?? r.Value ?? r.VALUE ?? "");
    } else {
      Object.keys(r).forEach(k => put(k, r[k]));   // columns-as-keys row
    }
  });
  return out;
}

// VocFit completion rows (spec §12.3): personId | completionDate | certifyingUnit.
// d4-pad personId so it joins cleanly with the roster id space.
function normalizeVocFit(rows) {
  return (rows || []).map(r => ({
    personId: padD4(r.personId || r.PersonId || r.d4 || r.id || ""),
    completionDate: r.completionDate || r.CompletionDate || "",
    certifyingUnit: r.certifyingUnit || r.CertifyingUnit || ""
  })).filter(r => r.personId);
}

// Platoons tab (addendum A6.1): code | displayName | active | createdAt. `active`
// is coerced to a real boolean (sheets store TRUE/FALSE as strings/booleans).
function normalizePlatoons(rows) {
  return (rows || []).map(r => {
    const a = r.active;
    const active = a === true || String(a).toUpperCase() === "TRUE" || a === "" || a == null;
    return {
      code: String(r.code || r.Code || "").trim(),
      displayName: r.displayName || r.DisplayName || r.code || "",
      active,
      createdAt: r.createdAt || r.CreatedAt || ""
    };
  }).filter(r => r.code);
}

// Attendance normalizer (Braves §14 CSV import). The CSV import adds four fields
// to attendance rows — `participants` (comma-joined Present 4Ds, the HA
// participation source), `periods` (the B5 1h-period count for Double HA),
// `currencyTags` (e.g. "HA", an HA-eligibility signal), and `source` ("csv" vs
// "" for wizard rows). Defaulting them on EVERY row here is essential: writeTab
// derives sheet headers from Object.keys(data[0]), so if the first row lacked
// these keys a full-sheet push would silently strip the columns for all rows.
function normalizeAttendance(rows) {
  return (rows || []).map(r => ({
    ...r,
    participants: r.participants || "",
    periods: (r.periods === 0 || r.periods) ? r.periods : "",
    currencyTags: r.currencyTags || "",
    source: r.source || "",
    // Whether the Log Conduct wizard has reviewed this conduct's status
    // checklist (set true on save). Stamped on EVERY row — even though only
    // wizard-saved rows are true — so a full-tab replace (writeTab derives the
    // sheet header from Object.keys(data[0])) can never strip the column and
    // wipe the flag off already-reviewed conducts.
    statusReviewed: !!r.statusReviewed
  }));
}

// Editing an Attendance row through a wizard that only knows about a SUBSET of
// its fields (e.g. the Log Conduct wizard, which builds
// id/date/time/conductId/total/participating/lms/px/fallout/remarks) must not
// destroy the CSV-import fields above — a full `STATE.attendance[idx] = entry`
// replace silently blanked participants/periods/currencyTags/source on every
// CSV-imported conduct edited this way, which erased that conduct from
// everyone's HA. Spread the existing row first so only entry's own keys move;
// a brand-new row (no `existing`) has nothing to preserve.
//
// The Log Conduct wizard's save path (saveLogConductWizard, js/forms.js)
// leans on this spread-merge to keep the HA-corruption class impossible by
// construction: `source` is only ever set to "wizard" (never emitted for an
// existing "csv" row, so `source` simply doesn't appear in `entry` and the
// spread keeps "csv"); `periods` is only emitted while the wizard's "Counts
// toward HA" box is ticked, so an unticked save omits the key and the CSV's
// B5 metadata survives untouched; `currencyTags` is always reconciled against
// the existing value via toggleHATag (never blindly overwritten), so sibling
// tokens survive a tick/untick.
function mergeAttendanceEdit(existing, entry) {
  return existing ? { ...existing, ...entry } : entry;
}

// CodeQL js/clear-text-storage-of-sensitive-data (alert #20): medical/appointments
// data is cached here unencrypted. Accepted risk, not fixed — this is an offline
// mirror of the authenticated user's own data for a device they already control;
// any encryption key derivable client-side (e.g. from authToken, itself in
// localStorage — see AUTH_KEY) would sit right next to the ciphertext, so it
// blocks nothing an XSS or local-device attacker couldn't already read. Real
// defense is XSS prevention (escapeHTML at render) and treating the browser
// profile as sensitive, not encrypting data against an attacker who already
// has same-origin JS execution or disk access.
function saveLocal() {
  const d = {
    roster: STATE.roster, medical: STATE.medical, attendance: STATE.attendance,
    ippt: STATE.ippt, rm: STATE.rm, soc: STATE.soc, polar: STATE.polar,
    conductDetail: STATE.conductDetail, appointments: STATE.appointments,
    leave: STATE.leave, msk: STATE.msk, conducts: STATE.conducts,
    config: STATE.config, vocfit: STATE.vocfit, platoons: STATE.platoons,
    rev: STATE.rev || {}
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function loadLocal() {
  if (localStorage.getItem(STORAGE_KEY_LEGACY)) {
    localStorage.removeItem(STORAGE_KEY_LEGACY);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    STATE.roster = normalizeRoster(d.roster);
    STATE.medical = normalizeMedical(d.medical);
    STATE.attendance = normalizeAttendance(d.attendance);
    STATE.ippt = padD4OnLayer(d.ippt);
    STATE.rm = padD4OnLayer(d.rm);
    STATE.soc = padD4OnLayer(d.soc);
    STATE.polar = padD4OnLayer(d.polar);
    STATE.conductDetail = normalizeConductDetail(d.conductDetail);
    STATE.appointments = padD4OnLayer(d.appointments);
    STATE.leave = padD4OnLayer(d.leave);
    STATE.msk = normalizeMSK(d.msk);
    STATE.conducts = Array.isArray(d.conducts) ? d.conducts : [];
    STATE.config = d.config && typeof d.config === "object" ? d.config : {};
    STATE.vocfit = normalizeVocFit(d.vocfit);
    STATE.platoons = normalizePlatoons(d.platoons);
    STATE.rev = (d.rev && typeof d.rev === "object") ? d.rev : {};
  } catch { /* fall through to empty state */ }
}

function setAuthToken(token) {
  STATE.authToken = token || "";
  if (token) localStorage.setItem(AUTH_KEY, token);
  else localStorage.removeItem(AUTH_KEY);
}

// Persist the full account session after a successful login (or clear it on
// logout / auth failure). The token still lives in AUTH_KEY via setAuthToken so
// the API layer keeps reading from one place.
function setSession(token, role, personId, email) {
  setAuthToken(token);
  STATE.role = role || "";
  STATE.personId = personId || "";
  STATE.email = email || "";
  const put = (k, v) => v ? localStorage.setItem(k, v) : localStorage.removeItem(k);
  put(ROLE_KEY, STATE.role);
  put(PERSONID_KEY, STATE.personId);
  put(EMAIL_KEY, STATE.email);
}
function clearSession() {
  setSession("", "", "", "");
  STATE.accounts = []; STATE.tokens = []; STATE.auditLog = [];
}
// Permission helpers used by the UI. The SERVER is the authoritative gate; these
// only drive what the read-only viewer sees (soft disabling) and the admin panel.
const canWrite = () => STATE.role === "commander" || STATE.role === "admin";
const isAdminRole = () => STATE.role === "admin";

function loadFilter() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    // Step 5 (§11) switched filterPlt from a bare digit ("1") to a platoon CODE
    // ("PLT1"/"HQ"). A legacy bare-numeric persisted value would now match no
    // platoon and blank every view — so discard it (and its section) on load.
    const legacyNumericPlt = d.plt && /^\d+$/.test(String(d.plt));
    STATE.filterPlt = legacyNumericPlt ? "" : (d.plt || "");
    STATE.filterSect = legacyNumericPlt ? "" : (d.sect || "");
    STATE.filterRole = d.role || "";
  } catch { /* keep defaults */ }
}

function saveFilter() {
  localStorage.setItem(FILTER_KEY, JSON.stringify({ plt: STATE.filterPlt, sect: STATE.filterSect, role: STATE.filterRole }));
}
