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
    if (data.ippt?.length) STATE.ippt = data.ippt;
    if (data.rm?.length) STATE.rm = data.rm;
    if (data.soc?.length) STATE.soc = data.soc;
    if (data.polar?.length) STATE.polar = data.polar;
    if (data.conductDetail?.length) STATE.conductDetail = data.conductDetail;
    if (data.appointments?.length) STATE.appointments = data.appointments;
    saveLocal();
    return data;
  },
  async pushTab(tabName, data) {
    return this.post({ action: "write", tab: tabName, data });
  },
  async appendRow(tabName, row) {
    return this.post({ action: "append", tab: tabName, row });
  }
};
