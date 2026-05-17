// Global app state. Roster/medical/etc. start empty — real data comes from
// the Google Sheet via API.pullAll() on launch, or from localStorage on
// subsequent loads.

// Storage key is versioned so we can invalidate stale caches in users' browsers.
// Bump this whenever the cached shape (or its trust assumptions) changes.
const STORAGE_KEY = "cougar-data-v2";
const STORAGE_KEY_LEGACY = "cougar-data"; // v1 — contained hardcoded personnel fallback

const STATE = {
  nav: "dashboard",
  apiUrl: localStorage.getItem("cougar-api-url") || "",
  roster: [], medical: [], attendance: [], ippt: [], rm: [], soc: [], polar: [],
  charts: {}
};

function saveLocal() {
  const d = {
    roster: STATE.roster, medical: STATE.medical, attendance: STATE.attendance,
    ippt: STATE.ippt, rm: STATE.rm, soc: STATE.soc, polar: STATE.polar
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

function loadLocal() {
  // Drop any pre-v2 cache so old hardcoded personnel data can't linger in users' browsers.
  if (localStorage.getItem(STORAGE_KEY_LEGACY)) {
    localStorage.removeItem(STORAGE_KEY_LEGACY);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    STATE.roster = d.roster || [];
    STATE.medical = d.medical || [];
    STATE.attendance = d.attendance || [];
    STATE.ippt = d.ippt || [];
    STATE.rm = d.rm || [];
    STATE.soc = d.soc || [];
    STATE.polar = d.polar || [];
  } catch { /* fall through to empty state */ }
}
