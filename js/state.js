// Global app state. Roster/medical/etc. start empty — real data comes from
// the Google Sheet via API.pullAll() on launch, or from localStorage on
// subsequent loads.

// The Apps Script web app URL. This is no longer a secret — auth is enforced
// server-side by per-device tokens issued on login (see Apps Script).
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
const CAPS_KEY = "braves-caps";
// The report-sick scope key the server last reported (js/sync.js, rsApplyScopeKey).
// Cached alongside the session keys so a narrowing grant — or a different account
// signing in on a shared device — reads as a changed Medical/MSK tab and re-pulls
// rather than reusing a wider cache.
const SCOPE_KEY_KEY = "braves-rs-scope-key";

// Capabilities travel as a comma-separated string (that is the Accounts column's
// shape) and are held as a lowercased array. Mirrors parseCaps() in
// apps-script-Code.gs — the two must agree on normalisation or a cap granted as
// "Duty" would hide the UI from someone the server happily lets write.
function parseCapsCSV(raw) {
  return String(raw == null ? "" : raw).split(",")
    .map(s => s.trim().toLowerCase())
    .filter(s => !!s);
}
const FILTER_KEY = "cougar-filter";
const IPPT_AGG_KEY = "cougar-ippt-agg";
const FITNESS_SENT_KEY = "cougar-fitness-sent";
const DIRTY_KEY = "cougar-dirty-tabs";
const CUSTOM_STATUS_KEY = "cougar-custom-statuses";
const DEFER_CHARTS_KEY = "braves-defer-charts"; // chart lazy-load pref: auto|defer|eager

// ── Offline data grant (BACKEND_MIGRATION_REVIEW.md §4.6 item 3 / §4.7.5a) ──
//
// The single largest privacy exposure in this system is not which cloud holds
// the sheet — it is that ~30 devices, many of them personal phones, each held a
// complete plaintext mirror of the company's medical data FOREVER, invisibly,
// with no way to bound it. The offline grant converts that permanent, universal
// condition into a bounded, visible, expiring one.
//
// The model:
//   • Caching to localStorage is OPT-IN per device and per account.
//   • The grant carries a hard expiry stamped into the client. That expiry is
//     the real enforcement, because it needs NO network contact — which is
//     exactly the lost-phone / ORD'd-member case. Server-side revocation only
//     lands when the device next checks in, i.e. when it is least dangerous.
//   • Switching it off (or letting it lapse) wipes the cached copy.
//
// Deliberately NOT attempted: defending against a determined holder of the
// device. Someone who wants to keep the data can copy it out at any point while
// the grant is on, and clock-tampering is a non-threat for the same reason
// (§4.7.5a). The threat model here is the cooperative case — handover, loss,
// departure — which is the one that actually occurs.
const OFFLINE_GRANT_KEY = "braves-offline-grant";   // {deviceId,email,grantedAt,expiresAt,auto?}
const DEVICE_ID_KEY = "braves-device-id";           // opaque per-device id (see below)
// Selectable grant lengths, in days. Kept short deliberately: expiry, not
// revocation, is the primary control, so the ceiling is what actually bounds
// the exposure window. 30 would re-create the status quo under a nicer name.
const OFFLINE_GRANT_DAY_OPTIONS = [1, 7, 14];
const OFFLINE_GRANT_MAX_DAYS = 14;
const OFFLINE_GRANT_DEFAULT_DAYS = 7;

// An OPAQUE id, not a device name (§4.7.5a: the admin-review list is itself new
// personal data and should be minimised). Nothing derives it from hardware; it
// is a random value minted on first use and it dies with the browser profile.
function offlineDeviceId() {
  let id = "";
  try { id = localStorage.getItem(DEVICE_ID_KEY) || ""; } catch { /* storage blocked */ }
  if (!id) {
    id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(DEVICE_ID_KEY, id); } catch { /* storage blocked */ }
  }
  return id;
}

function loadOfflineGrant() {
  try {
    const raw = localStorage.getItem(OFFLINE_GRANT_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw);
    if (!g || !g.expiresAt) return null;
    return g;
  } catch { return null; }
}

// Pure so it is unit-testable without localStorage: given a grant object and a
// clock, say what it is worth. `email` is the account currently signed in — a
// grant issued to a different account on this device is treated as absent,
// which is what makes a handover between two people on one phone safe.
function offlineGrantStatus(grant, nowMs, email) {
  if (!grant || !grant.expiresAt) return { state: "off", daysLeft: 0 };
  if (grant.revoked) return { state: "revoked", daysLeft: 0, expiresAt: grant.expiresAt };
  if (email && grant.email && String(grant.email).toLowerCase() !== String(email).toLowerCase()) {
    return { state: "off", daysLeft: 0 };
  }
  const exp = new Date(grant.expiresAt).getTime();
  if (!Number.isFinite(exp)) return { state: "off", daysLeft: 0 };
  if (exp <= nowMs) return { state: "expired", daysLeft: 0, expiresAt: grant.expiresAt };
  return {
    state: "active",
    expiresAt: grant.expiresAt,
    daysLeft: Math.ceil((exp - nowMs) / 86400000)
  };
}

function currentOfflineGrantStatus() {
  return offlineGrantStatus(loadOfflineGrant(), Date.now(), STATE.email);
}
function hasOfflineGrant() { return currentOfflineGrantStatus().state === "active"; }

// Issue (or renew) a grant on this device for the signed-in account. Capped at
// OFFLINE_GRANT_MAX_DAYS server-side too — this is the UI-side clamp.
function grantOffline(days, opts) {
  const d = Math.min(Math.max(+days || OFFLINE_GRANT_DEFAULT_DAYS, 1), OFFLINE_GRANT_MAX_DAYS);
  const now = Date.now();
  const grant = {
    deviceId: offlineDeviceId(),
    email: STATE.email || "",
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + d * 86400000).toISOString(),
    days: d,
    auto: !!(opts && opts.auto)
  };
  try { localStorage.setItem(OFFLINE_GRANT_KEY, JSON.stringify(grant)); } catch { /* storage blocked */ }
  return grant;
}

// Mark the local grant revoked (server said so on check-in). Kept as a record
// rather than deleted so the UI can explain why the cache vanished.
function markOfflineGrantRevoked() {
  const g = loadOfflineGrant();
  if (!g) return;
  g.revoked = true;
  try { localStorage.setItem(OFFLINE_GRANT_KEY, JSON.stringify(g)); } catch { /* storage blocked */ }
}

function clearOfflineGrant() {
  try { localStorage.removeItem(OFFLINE_GRANT_KEY); } catch { /* storage blocked */ }
}

// Every localStorage key that holds personnel data, driven from one list so a
// new cache key cannot silently escape the wipe (§4.7.5a). Session/auth keys
// are NOT here — signing out is a separate action with its own teardown — and
// neither is DIRTY_KEY, which is the crash-safe record of what still needs
// pushing and must outlive a cache wipe.
const OFFLINE_DATA_KEYS = [STORAGE_KEY, STORAGE_KEY_LEGACY, FITNESS_SENT_KEY];

// Drop the on-disk mirror. Does NOT touch in-memory STATE: the app stays usable
// for the rest of the session (it is online, it has the data in RAM); what
// changes is that nothing survives to the next launch.
function wipeLocalDataCache() {
  OFFLINE_DATA_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
}

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
  "Platoons": "platoons",
  // Duty list (DUTY_LIST_SPEC.md §3).
  "Duty": "duty",
  "DutyCorrection": "dutyCorrection",
  "Holidays": "holidays",
  "DutyUnavailable": "dutyUnavailable",
  "DutyChangeRequest": "dutyChangeRequest"
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
  alOilLeaveTypes: "Leave, Off-in-Lieu, OIL, AL, Annual Leave, Weekend, Night's Out, Compassionate",

  // ── Duty list (DUTY_LIST_SPEC.md §3.5) ────────────────────────────────────
  // These defaults reproduce the source spreadsheet's behaviour exactly: only
  // COS scores, on the day-weight scale in its Explanatory Notes. Everything
  // else is tracked and counted but deliberately unscored.
  //
  // Unlike the string-valued keys above, these are structured. Read them with
  // configGetJSON(), which parses a JSON string from the Config sheet and falls
  // back to the object here — a sheet cell can only ever hold text.
  //
  // scope "company" = one slot company-wide per day; scope "platoon" = one slot
  // per live platoon, derived from STATE.platoons. PDS therefore needs no
  // per-platoon entry and follows platoon renumbering on its own.
  // pointWeight null = counted but never scored; a number multiplies the day weight.
  //
  // `appointments` restricts who may hold the slot to the listed appointments
  // ("PC" / "PS" / "SectComd", read from the Roster `appointment` column — see
  // dutyAppointmentOf in js/duty-eligibility.js). Each duty here belongs to one
  // appointment: CDO is the PC duty, CDS the PS duty, COS and PDS the section
  // commanders'. Omitting the key leaves a type unrestricted, so an ad-hoc duty
  // type added later needs no config migration. Note COS carries no platoon
  // scope, so an HQ section commander is offered for COS but never for a PDS.
  dutyTypes: [
    { name: "CDO", scope: "company", pointWeight: null, appointments: ["PC"] },
    { name: "CDS", scope: "company", pointWeight: null, appointments: ["PS"] },
    { name: "COS", scope: "company", pointWeight: 1, appointments: ["SectComd"] },
    { name: "PDS", scope: "platoon", pointWeight: null, appointments: ["SectComd"] }
  ],
  // Mon–Thu 1, Fri and Sun (book out / book in) 3, Sat and public holidays 5.
  dutyDayWeights: { sun: 3, mon: 1, tue: 1, wed: 1, thu: 1, fri: 3, sat: 5, holiday: 5 },
  // NOTE: there is deliberately no "Public Holiday" reason. In the source sheet
  // PH was a manual correction BECAUSE its points formula ignored holidays; here
  // the points engine applies them natively from the Holidays tab, so a PH
  // correction row would double-count. "Extras" carries delta 0 on purpose: it
  // records that something happened, visible in the log, without moving the score.
  dutyCorrectionReasons: [
    { name: "PDS after COS", delta: -2 },
    { name: "On leave while scheduled", delta: -2 },
    { name: "COS duty ends on leave day", delta: -2 },
    { name: "Doing 2 duties at once", delta: -2 },
    { name: "Ext. duties while scheduled", delta: -2 },
    { name: "Outfield skip", delta: -2 },
    { name: "Confinement", delta: -2 },
    { name: "Extras", delta: 0 }
  ],
  // Fill colours in the legacy workbook (spec §1.4), used only by the importer.
  // `gridBase` is the background of EVERY duty cell, so detection is relative to
  // each column's modal fill rather than absolute. #FF9900 appears in both the
  // reason and magnitude legends; the column block disambiguates it. Magnitude
  // colours are FLAGGED ONLY and never turned into a delta — the legend does not
  // agree with the literals actually in the workbook, so deltas always come from
  // the reason's entry above.
  dutyCorrectionColours: {
    reason: {
      "FF00FF": "PDS after COS",
      "00FFFF": "On leave while scheduled",
      "FF9900": "COS duty ends on leave day",
      "9900FF": "Doing 2 duties at once",
      "373F6B": "Ext. duties while scheduled"
    },
    magnitude: { "E06666": -2, "FF9900": -4, "B6D7A8": 2, "00FF00": 4 },
    holidayRow: "EA4335",
    gridBase: "F4CCCC"
  },
  // Duty type for a workbook column whose header cell is BLANK, keyed by column
  // letter. Column B is CDO in the source workbook but carries no header text —
  // its identity is only established by the A33 VLOOKUP, which labels offset 2
  // "CDO:". Without this the importer skips the column and every CDO assignment
  // is silently lost. It lives in Config rather than being hardcoded so it stays
  // a correctable statement about one workbook, not a guess baked into the
  // parser; the importer still emits a warning whenever it has to fall back.
  dutyHeaderFallback: { B: "CDO" },
  // Per-platoon colour ramps for commander names in the duty views.
  //
  // Position in the array IS the meaning, and it is keyed off the org model
  // rather than off a person: index 0 is the platoon's Command element (both PC
  // and PS — they deliberately share one colour, which also covers a platoon
  // carrying two PCs or two PSs), and indexes 1..n are sections 1..n in order.
  //
  // Both the platoon count and the section count can change, so nothing here is
  // fixed: a platoon with no entry simply gets no colour, and a section beyond
  // the end of its ramp clamps to the last colour rather than wrapping. Clamping
  // is chosen over wrapping because these ramps run dark→light — an extra
  // section reads as "one more of this platoon's shade" instead of colliding
  // with the Command colour, which would be actively misleading.
  //
  // Add a platoon by adding a key; re-order or extend a ramp by editing its
  // array. No code change either way.
  dutyPlatoonColours: {
    PLT1: ["#900b0a", "#ab201d", "#c6312f", "#e24240", "#ff5252"],
    PLT2: ["#168039", "#469c47", "#6eb855", "#95d563", "#bdf271"],
    PLT3: ["#1510F0", "#006fdc", "#009be5", "#51d3ed", "#acf0f2"],
    PLT4: ["#ffbe00", "#feca2a", "#fed642", "#fee662", "#fff176"]
  },
  dutyCycleStart: "2026-04-01",
  dutyCycleMonths: 6,
  // Extra 4Ds eligible for duty beyond the automatic commander rule. Safe to keep
  // in Config: eligibility is not a security boundary (appearing in a dropdown
  // grants nothing). The duty-PLANNING permission is, and deliberately does not
  // live here — Config is writable by any commander.
  dutyExtraEligible: [],
  // Auto-scheduler soft-cost weights (spec §11.1). Raising one makes the
  // scheduler avoid that situation harder; zeroing one switches the rule off.
  // dutiesAboveMedian is not in the spec's table: it exists because the points
  // objective is inert for count-only duty types, which is the default for
  // everything but COS — see the comment on it in js/duty-schedule.js.
  dutySchedulerWeights: {
    pointsAboveMedian: 10, weekendAboveMedian: 8, dutiesAboveMedian: 5,
    sameTypeConsecutive: 6, pdsAfterCos: 6, withinMinSpacing: 4,
    adjacentToLeave: 3, minSpacingDays: 3
  },
  dutyReminderBody: "Please check your duties to ensure there are no conflicts and that you are available. If you aren't, you will have to find your own replacement."
};

// Read a Config value with the company default as a fallback. Always returns a
// string-ish value; never throws on a missing Config tab.
function configGet(key) {
  const v = STATE.config && STATE.config[key];
  return (v !== undefined && v !== null && v !== "") ? v : DEFAULT_CONFIG[key];
}

// Structured-value counterpart to configGet, for keys whose default is an object
// or array (the duty-list keys). A Config sheet cell can only hold text, so an
// override arrives as a JSON string and has to be parsed; the in-code default is
// already structured and is returned as-is. A malformed override falls back to
// the default rather than throwing — a typo in one Config cell must not take the
// whole app down, and the default is always a working value.
function configGetJSON(key) {
  const v = STATE.config && STATE.config[key];
  if (v === undefined || v === null || v === "") return DEFAULT_CONFIG[key];
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return DEFAULT_CONFIG[key]; }
}

// The duty modules are pure — they never read STATE or call configGet themselves,
// which is what keeps them unit-testable and DOM-free. This assembles the config
// object they expect, and is the single place that bridges STATE into them.
function dutyConfig() {
  return {
    dutyTypes: configGetJSON("dutyTypes"),
    dutyDayWeights: configGetJSON("dutyDayWeights"),
    dutyCorrectionReasons: configGetJSON("dutyCorrectionReasons"),
    dutyCorrectionColours: configGetJSON("dutyCorrectionColours"),
    dutyHeaderFallback: configGetJSON("dutyHeaderFallback"),
    dutyPlatoonColours: configGetJSON("dutyPlatoonColours"),
    dutyExtraEligible: configGetJSON("dutyExtraEligible"),
    dutySchedulerWeights: configGetJSON("dutySchedulerWeights"),
    dutyCycleStart: configGet("dutyCycleStart"),
    dutyCycleMonths: Number(configGet("dutyCycleMonths")) || 6,
    // Plain text, not JSON — configGet, not configGetJSON. Passing it through
    // the JSON reader would work by accident (a non-JSON string falls back to
    // the default) but would silently ignore any override an admin actually
    // typed, which is exactly the value this key exists to let them change.
    dutyReminderBody: configGet("dutyReminderBody")
  };
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
  // Per-account capabilities beyond the role ladder (DUTY_LIST_SPEC.md §9).
  // Persisted alongside `role` so a launch off the cache — which renders before
  // any network call — doesn't briefly hide the planner UI from a planner.
  // Purely cosmetic either way: the server gate is the enforcement.
  caps: parseCapsCSV(localStorage.getItem(CAPS_KEY)),
  scopeKey: localStorage.getItem(SCOPE_KEY_KEY) || "",
  personId: localStorage.getItem(PERSONID_KEY) || "",
  email: localStorage.getItem(EMAIL_KEY) || "",
  // Admin-panel data, loaded on demand from the backend (never cached to disk):
  accounts: [],   // [{email, personId, role, addedBy, addedAt}] — no secrets
  tokens: [],     // active sessions [{token, tokenPrefix, email, role, issuedAt, expired}]
  auditLog: [],   // audit rows — only populated for admin pulls
  // Devices currently holding an offline copy (§4.7.5a admin review). Admin-only,
  // fetched by refreshAdminData; never cached to disk.
  offlineGrants: [],
  paradeArchive: [], sickArchive: [], // archived parade/sick messages — admin-only pulls (Item 1)
  roster: [], medical: [], attendance: [], ippt: [], rm: [], soc: [], polar: [], conductDetail: [], appointments: [], leave: [], msk: [],
  // Braves reference data (spec §4/§12/A6). config is an object keyed by Config
  // `key`; vocfit/platoons are row arrays. All empty until pulled — every reader
  // falls back to DEFAULT_CONFIG / derivation so the app works before the Sheet
  // tabs exist.
  config: {},
  vocfit: [],
  platoons: [],
  // Duty list (DUTY_LIST_SPEC.md §3). Row arrays, empty until pulled.
  duty: [],
  dutyCorrection: [],
  holidays: [],
  // Soft unavailability windows (design §4). A planning hint only — it never
  // reaches the parade classifier.
  dutyUnavailable: [],
  // Proposed changes to the duty roster (design §3). Submitted by any commander,
  // decided by a duty planner. `status` is server-owned — the client never
  // writes it, because the backend refuses any write to this tab that is not an
  // append or the submitter withdrawing their own row.
  dutyChangeRequest: [],
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

// Canonicalize a platoon CODE. Step 5 (§11) switched the whole app from a bare
// digit ("1") to a platoon code ("PLT1"/"HQ") — see loadFilter's legacy-discard
// comment. Rosters imported/entered before that migration still store the bare
// digit in the `platoon` column, so a person read from the sheet would carry
// "1" while everything else (filter, activePlatoons codes, parade grouping,
// personPlatoon's own 4D fallback which already emits "PLT"+digit) speaks
// "PLT1". That mismatch blanks the platoon filter and prints "1 · Sect 1" group
// labels. Fold a pure-digit code up to "PLT<n>" here so both the roster and the
// Platoons tab join the canonical form; non-numeric codes ("PLT1"/"HQ"/blank)
// pass through untouched. Mirrors padD4: canonicalize on read, don't rewrite the
// sheet (an edited row round-trips the canonical value out on its next push).
function canonicalPlatoonCode(v) {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? "PLT" + s : s;
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
    //   appointment — "PC" / "PS" / "SectComd" / blank. Splits the Command
    //              element, which `section` alone cannot: it is "Command" for
    //              both PC and PS, and the duty list needs them apart (CDO is the
    //              PC duty, CDS the PS duty). Blank falls back to the org model
    //              in dutyAppointmentOf() — it is stored raw here rather than
    //              canonicalised so the sheet keeps saying whatever the user typed.
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
      platoon: canonicalPlatoonCode(rest.platoon),
      section: rest.section != null ? String(rest.section) : "",
      rankGroup: rest.rankGroup || "",
      appointment: rest.appointment != null ? String(rest.appointment).trim() : "",
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
      // Book-in marker (item 4c): the parade date (DISPLAY format) from which a
      // booked-in recruit reads Present WITHOUT truncating this record's real
      // dates. Empty = not booked in. Carried through read/write so writeTab
      // (headers = Object.keys(data[0])) can't strip the column.
      bookInDate: r.bookInDate || "",
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
      origin: r.origin || "manual",
      // Item 17: appointment/report-sick time (HHMM) — shared field. For a
      // Medical Appointment (type MA) it is the appointment time; for RSI/RSO it
      // is the (optional) report-sick time. Kept as a string; the backend force-
      // texts it (WRITE_TEXT_COLS_BY_TAB.Medical) so "0930" is not coerced to 930.
      time: r.time || "",
      // Item 17: MA only — recruit leaves camp for the appointment. Drives the
      // parade classifier's OTHERS (IN CAMP) vs (NOT IN CAMP) split. Tolerates the
      // "TRUE"/"true" string Sheets round-trips a boolean column as.
      outOfCamp: r.outOfCamp === true || r.outOfCamp === "TRUE" || r.outOfCamp === "true"
    };
  });
}

// Generic d4-padding pass for layers that don't have their own normalizer.
// Applied at every read boundary (loadLocal, pullAll) so commander 4Ds
// stay 4 digits regardless of how Sheets mangles them on round-trip.
function padD4OnLayer(records) {
  return (records || []).map(r => r && r.d4 != null ? { ...r, d4: padD4(r.d4) } : r);
}

// Leave has no rich normalizer — pad the 4D (padD4OnLayer) and default the
// bookInDate marker (item 4c) so EVERY row carries the key. writeTab derives
// sheet headers from Object.keys(data[0]); without a guaranteed bookInDate on the
// first row a full push would strip the column (same reason medical `origin` is
// defaulted at its own read boundary).
function normalizeLeave(records) {
  return padD4OnLayer(records).map(r =>
    (r && typeof r === "object") ? { ...r, bookInDate: r.bookInDate || "" } : r);
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
// Ensure every conducts-registry entry carries the class/makeup fields. Required
// because writeTab derives sheet headers from Object.keys(data[0]) — a row missing
// a key silently strips that column from the pushed sheet. Idempotent.
function normalizeConducts(records) {
  if (!Array.isArray(records)) return [];
  return records.map(function (c) {
    c = c || {};
    return {
      id: c.id,
      name: c.name,
      className: typeof c.className === "string" ? c.className : "",
      classSeq: Number.isFinite(Number(c.classSeq)) ? Number(c.classSeq) : 0,
      makeupFor: typeof c.makeupFor === "string" ? c.makeupFor : ""
    };
  });
}
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
// Accepts BOTH Config-tab shapes (the sheet can be either — readAllTabs concats
// the key/value "BravesConfig" tab with the columns-as-keys "Config" tab):
//   • key/value rows  → {key:"companyName", value:"…"}            (Braves spec §4)
//   • columns-as-keys → {companyName:"…", archiveParadeTimes:"…"}  (Config tab)
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

// ── Duty list normalizers (DUTY_LIST_SPEC.md §3) ────────────────────────────
// padD4 on every 4D is the client half of the leading-zero defence; the server
// half is the WRITE_TEXT_COLS_BY_TAB entry that stops Sheets coercing "0042" to
// 42 on write. Both are needed — a value can lose its zeros in either direction.

function normalizeDuty(rows) {
  return (rows || []).map(r => ({
    id: r.id || "",
    date: r.date || "",
    dutyType: r.dutyType || "",
    // Literal platoon at time of assignment. Never re-resolved against the
    // current roster: that is what lets a commander transfer platoon without
    // rewriting history (spec §5.1.2).
    platoon: r.platoon || "",
    d4: padD4(r.d4),
    assignedBy: r.assignedBy || "",
    assignedAt: r.assignedAt || "",
    source: r.source || "manual"
  }));
}

function normalizeDutyCorrection(rows) {
  return (rows || []).map(r => ({
    id: r.id || "",
    date: r.date || "",
    d4: padD4(r.d4),
    reason: r.reason || "",
    delta: Number(r.delta) || 0,
    note: r.note || "",
    enteredBy: r.enteredBy || "",
    enteredAt: r.enteredAt || ""
  }));
}

function normalizeHolidays(rows) {
  return (rows || []).map(r => ({
    date: r.date || "",
    name: r.name || "",
    // Sheets hands back TRUE/"TRUE"/"yes"/"" — collapse to a real boolean here so
    // no reader downstream has to re-interpret a truthy string.
    tentative: !!(r.tentative && String(r.tentative).trim() && String(r.tentative).trim().toLowerCase() !== "false")
  }));
}

// Soft "probably unavailable" windows (design §4). Deliberately NOT part of the
// medical/leave family: nothing here reaches the parade classifier, and the
// bounds are inclusive ISO dates compared as plain strings — which is why the
// sheet columns are text-formatted rather than left to Sheets' date coercion,
// since "01 Sep 2026" would compare against nothing.
function normalizeDutyUnavailable(rows) {
  return (rows || []).map(r => ({
    id: r.id || "",
    d4: padD4(r.d4),
    from: r.from || "",
    to: r.to || "",
    note: r.note || "",
    addedBy: r.addedBy || "",
    addedAt: r.addedAt || ""
  }));
}

// Duty change requests (design §3). Both 4D columns are padded at the read
// boundary like every other 4D-bearing tab — Sheets drops leading zeros on the
// way out as well as on the way in, so "0042" arrives as 42 and would join
// against nothing in the roster.
//
// `status` defaults to Pending rather than "": a row that somehow reached the
// sheet without one is an undecided request, and defaulting it to blank would
// hide it from both the pending list and the decided list at once.
function normalizeDutyChangeRequest(rows) {
  return (rows || []).map(r => ({
    id: r.id || "",
    submittedBy: padD4(r.submittedBy),
    submittedAt: r.submittedAt || "",
    date: r.date || "",
    dutyType: r.dutyType || "",
    platoon: r.platoon || "",
    kind: r.kind || "",
    fromD4: padD4(r.fromD4),
    toD4: padD4(r.toD4),
    swapDate: r.swapDate || "",
    swapDutyType: r.swapDutyType || "",
    swapPlatoon: r.swapPlatoon || "",
    reason: r.reason || "",
    status: r.status || "Pending",
    decidedBy: padD4(r.decidedBy),
    decidedAt: r.decidedAt || "",
    decisionNote: r.decisionNote || ""
  }));
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
      code: canonicalPlatoonCode(r.code || r.Code || ""),
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
// data is cached here unencrypted. Encryption is still NOT the fix, for the
// original reason — any key derivable client-side (e.g. from authToken, itself
// in localStorage — see AUTH_KEY) sits right next to the ciphertext, so it
// blocks nothing an XSS or local-device attacker couldn't already read, and a
// key that is NOT derivable client-side (one wrapped by the password at login)
// would have to be re-supplied on every cold start, which destroys the offline
// tolerance this cache exists for. Real defense is XSS prevention (escapeHTML at
// render) plus bounding the copy itself.
//
// What DID change (BACKEND_MIGRATION_REVIEW.md §4.6 item 3, §4.7.5a): the answer
// to "should we encrypt it?" was always going to be no, but the prior question —
// "should this device hold the whole company's medical data at all, forever?" —
// now has an answer. Caching is opt-in, time-limited and revocable (the offline
// grant above), the write below is gated on it, and sign-out wipes it. That is a
// bound on scope and lifetime rather than a lock, and it is the control that
// actually reduces the exposure.
// SYNC_PERF_IMPROVEMENTS_SPEC.md P3-2: saveLocal() used to JSON.stringify the
// ENTIRE dataset (16 STATE keys, MB-scale for a real company) SYNCHRONOUSLY on
// every call — 29 form-edit call sites in forms.js, every successful write ack
// (sync.js runWrite/resolveConflict), and every pull (api.js). Draining N
// queued writes meant N full serializations back-to-back on the main thread —
// measurable jank, especially on mobile.
//
// Fix: saveLocal() now just marks a pending flush and arms ONE trailing timer
// (SAVE_LOCAL_DEBOUNCE_MS); a burst of calls inside that window collapses to
// the single flush that actually fires. `saveLocalNow()` is the synchronous
// escape hatch for call sites where a persisted-right-now guarantee matters
// (see the pagehide/visibilitychange listeners below, and signOut/
// forceResync in sync.js).
//
// Trade-off: the debounce window is a CACHE-loss window only on a hard crash.
// Normal navigation/tab-close/backgrounding fires pagehide or
// visibilitychange→hidden, both wired below to flush synchronously, so that's
// covered. Even in the crash case, nothing DURABLE is at risk: `saveDirty()`
// (the unsynced-edit marker, above) is deliberately kept fully synchronous —
// it's the crash-safe record of which tabs still need pushing — and every
// acked write already lives on the server. A crash inside the window loses at
// most a few hundred ms of cache freshness, rebuilt on the next pull.
const SAVE_LOCAL_DEBOUNCE_MS = 400;
let _saveLocalTimer = null;
let _saveLocalPending = false;

function _saveLocalFlush() {
  _saveLocalTimer = null;
  _saveLocalPending = false;
  // §4.7.5a: the grant has to gate the WRITE boundary, not just the read path —
  // otherwise the cache keeps being repopulated by ordinary edits after the
  // toggle went off and the wipe becomes decorative. Belt-and-braces: also drop
  // anything a previous grant left behind, so a lapse mid-session cleans up at
  // the next save rather than waiting for the next launch.
  if (!hasOfflineGrant()) { wipeLocalDataCache(); return; }
  const d = {
    roster: STATE.roster, medical: STATE.medical, attendance: STATE.attendance,
    ippt: STATE.ippt, rm: STATE.rm, soc: STATE.soc, polar: STATE.polar,
    conductDetail: STATE.conductDetail, appointments: STATE.appointments,
    leave: STATE.leave, msk: STATE.msk, conducts: STATE.conducts,
    config: STATE.config, vocfit: STATE.vocfit, platoons: STATE.platoons,
    duty: STATE.duty, dutyCorrection: STATE.dutyCorrection, holidays: STATE.holidays,
    dutyUnavailable: STATE.dutyUnavailable,
    dutyChangeRequest: STATE.dutyChangeRequest,
    rev: STATE.rev || {}
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

// Debounced entry point — what nearly every call site should keep using.
// Marks a pending flush and (re)arms a single trailing timer if one isn't
// already scheduled; repeated calls inside the window are free (no re-arm,
// no serialization) until the timer fires.
function saveLocal() {
  _saveLocalPending = true;
  if (_saveLocalTimer != null) return;
  _saveLocalTimer = setTimeout(_saveLocalFlush, SAVE_LOCAL_DEBOUNCE_MS);
}

// Escape hatch: flush synchronously right now, cancelling any pending timer.
// Use where a synchronous persist genuinely matters (about to sign out /
// discard local state / navigate away) rather than sprinkling this in place
// of saveLocal() by default — that would defeat the coalescing above.
function saveLocalNow() {
  if (_saveLocalTimer != null) { clearTimeout(_saveLocalTimer); _saveLocalTimer = null; }
  _saveLocalFlush();
}

// Last-chance flush on page hide. pagehide fires on normal navigation/close
// (including bfcache eviction); visibilitychange→hidden also catches mobile
// backgrounding, which may never fire pagehide before the OS reclaims the
// tab. Registered once at load. typeof-guarded: the vm test harness stubs
// window/document as plain objects whose addEventListener is a no-op (no
// real event ever fires there — tests that need this exercise
// saveLocalNow()/ctl.flushTimers() explicitly instead).
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", saveLocalNow);
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveLocalNow();
  });
}

// Enforce the offline grant BEFORE any cached data reaches memory or the DOM.
// Must run ahead of loadLocal() in the bootstrap, since that is the one code
// path guaranteed to execute before the first render (§4.7.5a).
//
// Returns a short verdict the UI can explain to the user rather than silently
// emptying the app:
//   "none"            → nothing cached anyway; nothing to do
//   "ok"              → live grant, cache stands
//   "wiped"           → grant lapsed/revoked/absent; cached copy deleted
//   "held"            → grant lapsed BUT this device has unpushed edits, so the
//                       wipe is deferred. Discarding them would turn a privacy
//                       feature into data loss, which is how such features get
//                       switched off permanently (§4.7.5a).
//   "auto-granted"    → upgrade path, see below
function enforceOfflineGrant() {
  let cached = false;
  try { cached = !!localStorage.getItem(STORAGE_KEY); } catch { /* storage blocked */ }
  const st = currentOfflineGrantStatus();
  if (st.state === "active") return "ok";

  // Upgrade path. Devices cached under the old always-on behaviour would
  // otherwise be wiped by a deploy — a commander who took a phone outfield with
  // a warm cache would find an empty app and no way to refill it. So the first
  // launch after this ships converts an existing cache into an explicit,
  // expiring grant instead of deleting it, and the Settings card says it was
  // auto-issued. The exposure is bounded from that moment on, which is the
  // point; nothing is silently grandfathered forever.
  if (cached && st.state === "off" && STATE.authToken) {
    grantOffline(OFFLINE_GRANT_DEFAULT_DAYS, { auto: true });
    return "auto-granted";
  }

  if (!cached) return "none";
  if (STATE.dirty && STATE.dirty.size) return "held";
  wipeLocalDataCache();
  return "wiped";
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
    STATE.leave = normalizeLeave(d.leave);
    STATE.msk = normalizeMSK(d.msk);
    STATE.conducts = normalizeConducts(d.conducts);
    STATE.config = d.config && typeof d.config === "object" ? d.config : {};
    STATE.vocfit = normalizeVocFit(d.vocfit);
    STATE.platoons = normalizePlatoons(d.platoons);
    STATE.duty = normalizeDuty(d.duty);
    STATE.dutyCorrection = normalizeDutyCorrection(d.dutyCorrection);
    STATE.holidays = normalizeHolidays(d.holidays);
    STATE.dutyUnavailable = normalizeDutyUnavailable(d.dutyUnavailable);
    STATE.dutyChangeRequest = normalizeDutyChangeRequest(d.dutyChangeRequest);
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
function setSession(token, role, personId, email, caps) {
  setAuthToken(token);
  STATE.role = role || "";
  STATE.personId = personId || "";
  STATE.email = email || "";
  // Accepts either the array the login response returns or a raw CSV string, so
  // a caller that has one shape doesn't have to convert.
  STATE.caps = Array.isArray(caps) ? parseCapsCSV(caps.join(",")) : parseCapsCSV(caps);
  const put = (k, v) => v ? localStorage.setItem(k, v) : localStorage.removeItem(k);
  put(ROLE_KEY, STATE.role);
  put(PERSONID_KEY, STATE.personId);
  put(EMAIL_KEY, STATE.email);
  put(CAPS_KEY, STATE.caps.join(","));
  // Never inherit the previous account's report-sick scope. Cleared rather than
  // recomputed: the server stamps the real key on the next pull, and an empty
  // cached key guarantees that pull treats Medical/MSK as changed.
  STATE.scopeKey = "";
  put(SCOPE_KEY_KEY, "");
}
function clearSession() {
  setSession("", "", "", "");
  STATE.accounts = []; STATE.tokens = []; STATE.auditLog = []; STATE.offlineGrants = [];
}
// Permission helpers used by the UI. The SERVER is the authoritative gate; these
// only drive what the read-only viewer sees (soft disabling) and the admin panel.
const canWrite = () => STATE.role === "commander" || STATE.role === "admin";
const isAdminRole = () => STATE.role === "admin";

// Duty planning (DUTY_LIST_SPEC.md §9). The account model is a linear ladder
// (viewer < commander < admin) and duty planning is deliberately NOT a rung on
// it — it is a capability, because a duty planner also needs ordinary commander
// powers. `caps` is a comma-separated column on the Accounts tab.
//
// Everything here is COSMETIC. The enforcement is the tab gate in
// routeAuthedPost (apps-script-Code.gs), sitting with the sendEmail and
// bulk-import checks; these predicates only decide which buttons to draw. A
// planner whose caps went stale sees the buttons and gets a 403 — annoying, not
// a hole. The inverse (hiding the UI from a real planner) is why caps are
// cached in localStorage rather than waiting on the network.
function hasCap(cap) {
  return (STATE.caps || []).indexOf(String(cap).toLowerCase()) !== -1;
}
const canPlanDuty = () => isAdminRole() || hasCap("duty");

// Report-sick scope (spec §1 / addendum A8). EVERYTHING HERE IS COSMETIC, for
// exactly the reason the duty caps above are: the server is the gate (the
// rs*_ block in apps-script-Code.gs), and it has already withheld the rows
// before they reach STATE. These helpers only decide whether a panel draws a
// person's row or a per-platoon count line.
//
// That distinction is the point. An out-of-scope person rendered as an EMPTY row
// reads as "never reported sick" — a false statement about a real person — so
// the panels collapse them to an honest count instead.
//
// Caps arrive lowercased from parseCapsCSV ("rs:plt:plt2"); roster platoon codes
// are uppercase ("PLT2"). Normalise or the grant matches nothing.
function rsScope() {
  if (isAdminRole() || hasCap("rs:company")) return { company: true, plt: [] };
  const granted = (STATE.caps || [])
    .filter(c => c.indexOf("rs:plt:") === 0)
    .map(c => c.slice(7).toUpperCase())
    .filter(Boolean);
  if (granted.length) return { company: false, plt: [...new Set(granted)] };
  // No explicit grant → own platoon. An unresolvable personId fails CLOSED:
  // a thin log prompts someone to fix the roster, whereas failing open would
  // hand out the whole company silently.
  const me = (STATE.roster || []).find(r => padD4(r.id) === padD4(STATE.personId));
  const own = me ? String(personPlatoon(me) || "").toUpperCase() : "";
  return { company: false, plt: own ? [own] : [] };
}

// Persist the server-reported scope key. Shared by js/api.js (every pull path)
// and js/sync.js (the revCheck poll) so the localStorage round-trip lives in one
// place. A null/absent key means "this backend predates the field" — leave the
// cached value alone rather than reading it as an emptied scope.
function rsStoreScopeKey(key) {
  if (key == null) return false;
  if (key === STATE.scopeKey) return false;
  STATE.scopeKey = key;
  try { localStorage.setItem(SCOPE_KEY_KEY, key); } catch { /* private mode */ }
  return true;
}

function inRSScope(d4) {
  const s = rsScope();
  if (s.company) return true;
  const r = (STATE.roster || []).find(x => padD4(x.id) === padD4(d4));
  const p = r ? String(personPlatoon(r) || "").toUpperCase() : "";
  return !!p && s.plt.indexOf(p) !== -1;
}

// Withheld people grouped by platoon, for the count lines the gated panels draw
// in place of rows. Empty for a company-scope viewer, so a caller can branch on
// `.length` without also checking the scope.
function rsOutOfScopeCounts() {
  const s = rsScope();
  if (s.company) return [];
  const by = {};
  (STATE.roster || []).forEach(r => {
    const p = String(personPlatoon(r) || "").toUpperCase();
    if (!p || s.plt.indexOf(p) !== -1) return;
    by[p] = (by[p] || 0) + 1;
  });
  return Object.keys(by).sort().map(p => ({ platoon: p, count: by[p] }));
}

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
