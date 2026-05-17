// Thin wrapper around the Google Apps Script web app.
// All reads/writes for the sheet go through here.
const API = {
  async get(action, tab) {
    if (!STATE.apiUrl) throw new Error("No API URL configured");
    const url = `${STATE.apiUrl}?action=${action}${tab ? "&tab=" + tab : ""}`;
    const res = await fetch(url);
    return res.json();
  },
  async post(body) {
    if (!STATE.apiUrl) throw new Error("No API URL configured");
    const res = await fetch(STATE.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // Apps Script requires this to avoid preflight
      body: JSON.stringify(body)
    });
    return res.json();
  },
  async pullAll() {
    const data = await this.get("readAll");
    if (data.error) throw new Error(data.error);
    if (data.roster?.length) STATE.roster = data.roster;
    if (data.medical?.length) STATE.medical = data.medical;
    if (data.attendance?.length) STATE.attendance = data.attendance;
    if (data.ippt?.length) STATE.ippt = data.ippt;
    if (data.rm?.length) STATE.rm = data.rm;
    if (data.soc?.length) STATE.soc = data.soc;
    if (data.polar?.length) STATE.polar = data.polar;
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
