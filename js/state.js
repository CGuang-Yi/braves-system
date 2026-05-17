// Global app state. Roster/medical/etc. start empty — real data comes from
// the Google Sheet via API.pullAll() on launch, or from localStorage on
// subsequent loads.

// The Apps Script web app URL. This is no longer a secret — auth is enforced
// server-side by per-device tokens issued via the invite flow (see Apps Script).
// PASTE YOUR DEPLOYMENT URL HERE after redeploying the updated Apps Script:
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzazMTu4y4XjjDXBGWN_aAE51fzP_z23zQUZnuKjWWPJ3fNNjUPbp3DbZW9T66OQysr/exec";

// Storage key is versioned so we can invalidate stale caches in users' browsers.
const STORAGE_KEY = "cougar-data-v2";
const STORAGE_KEY_LEGACY = "cougar-data"; // v1 — contained hardcoded personnel fallback
const AUTH_KEY = "cougar-auth";

const STATE = {
  nav: "dashboard",
  apiUrl: APPS_SCRIPT_URL,
  authToken: localStorage.getItem(AUTH_KEY) || "",
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

function setAuthToken(token) {
  STATE.authToken = token || "";
  if (token) localStorage.setItem(AUTH_KEY, token);
  else localStorage.removeItem(AUTH_KEY);
}
