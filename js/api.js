// Thin wrapper around the Google Apps Script web app.
// Every data request carries an auth token. The token is obtained by redeeming
// a single-use invite link via API.redeemInvite() — see js/main.js bootstrap.

const AuthError = class extends Error {
  constructor(message) { super(message); this.name = "AuthError"; }
};

const API = {
  async get(action, tab) {
    const auth = encodeURIComponent(STATE.authToken || "");
    const url = `${STATE.apiUrl}?action=${action}${tab ? "&tab=" + tab : ""}&auth=${auth}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.code === 401) throw new AuthError(data.error);
    return data;
  },
  async post(body) {
    const res = await fetch(STATE.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...body, auth: STATE.authToken })
    });
    const data = await res.json();
    if (data && data.code === 401) throw new AuthError(data.error);
    return data;
  },
  // Redeem a single-use invite token. Does not require an existing auth token.
  async redeemInvite(token) {
    const res = await fetch(STATE.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "redeemInvite", token })
    });
    return res.json();
  },
  async pullAll() {
    const data = await this.get("readAll");
    if (data.error) throw new Error(data.error);
    if (data.roster?.length) STATE.roster = normalizeRoster(data.roster);
    if (data.medical?.length) STATE.medical = normalizeMedical(data.medical);
    if (data.attendance?.length) STATE.attendance = data.attendance;
    if (data.ippt?.length) STATE.ippt = padD4OnLayer(data.ippt);
    if (data.rm?.length) STATE.rm = padD4OnLayer(data.rm);
    if (data.soc?.length) STATE.soc = padD4OnLayer(data.soc);
    if (data.polar?.length) STATE.polar = padD4OnLayer(data.polar);
    if (data.conductDetail?.length) STATE.conductDetail = padD4OnLayer(data.conductDetail);
    if (data.appointments?.length) STATE.appointments = padD4OnLayer(data.appointments);
    if (data.leave?.length) STATE.leave = normalizeLeave(data.leave);
    if (data.msk?.length) STATE.msk = normalizeMSK(data.msk);
    if (data.conducts?.length) STATE.conducts = data.conducts;
    // Re-sync LMS counts from polar after every pull. Polar entries are the
    // source of truth for "who wore the watch" = LMS participation; this
    // keeps the attendance LMS column auto-correct without manual button
    // clicks. Safe to call when conducts/polar are empty — no-ops in that case.
    if (typeof recomputeAttendanceLmsFromPolar === "function") {
      recomputeAttendanceLmsFromPolar();
    }
    saveLocal();
    return data;
  },
  async pushTab(tabName, data) {
    return this.post({ action: "write", tab: tabName, data });
  },
  async appendRow(tabName, row) {
    return this.post({ action: "append", tab: tabName, row });
  },
  // ID-based row upsert — finds by row.id, updates in place if found, else
  // appends. The cross-device-safe write path: two devices editing different
  // rows of the same tab never clobber each other (no full-table rewrite).
  async upsertRow(tabName, row) {
    return this.post({ action: "upsertRow", tab: tabName, row });
  },
  // ID-based row delete — surgical, doesn't rewrite the whole tab.
  async deleteRowById(tabName, id) {
    return this.post({ action: "deleteRowById", tab: tabName, id });
  },
  // Lightweight pre-write staleness check. Returns { dataRows } for the tab.
  async rowCount(tabName) {
    return this.post({ action: "rowCount", tab: tabName });
  },
  // Sends one HTML email through the Apps Script owner's Gmail. Returns
  // { ok, remainingQuota } on success or { error, remainingQuota? } on
  // failure (quota exhaustion, bad recipient, transient send error).
  // inlineImages: optional { "cid_name": "base64_str_without_data_prefix" }
  // map — referenced from the htmlBody as <img src="cid:cid_name">.
  async sendEmail(to, subject, htmlBody, inlineImages) {
    return this.post({ action: "sendEmail", to, subject, htmlBody, inlineImages });
  },
  // Returns sender identity + current quota without sending anything.
  // Used by the report modal to surface "who emails will come from".
  async getEmailInfo() {
    return this.post({ action: "getEmailInfo" });
  },
  // Proxies one image to Claude via Apps Script (key lives in script
  // properties, never on the client). Returns
  //   { recruits: [{d4, avgHR, maxHR, calories, duration}], notes }
  // or { error }. validD4s seeds the prompt so Claude can ignore misreads.
  async analyzePhoto(imageBase64, mediaType, validD4s) {
    return this.post({ action: "analyzePhoto", imageBase64, mediaType, validD4s });
  }
};
