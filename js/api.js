// Thin wrapper around the Google Apps Script web app.
// Every data request carries an auth token. The token is obtained by redeeming
// a single-use invite link via API.redeemInvite() — see js/main.js bootstrap.

const AuthError = class extends Error {
  constructor(message) { super(message); this.name = "AuthError"; }
};

// STATE-array-key → normalizer that assigns fresh sheet rows into STATE. Shared
// by the full pull (pullAll) and partial pulls (pullTabs) so both paths apply
// IDENTICAL normalization. Keys match the readAll response keys (and map back to
// sheet names via TAB_TO_STATE). Covers only the 12 tracked data tabs — the
// reference/admin tabs (config/vocfit/platoons/auditLog/…) keep their own
// special handling in pullAll.
const PULL_ASSIGN = {
  roster:        d => STATE.roster = normalizeRoster(d),
  medical:       d => STATE.medical = normalizeMedical(d),
  attendance:    d => STATE.attendance = normalizeAttendance(d),
  ippt:          d => STATE.ippt = padD4OnLayer(d),
  rm:            d => STATE.rm = padD4OnLayer(d),
  soc:           d => STATE.soc = padD4OnLayer(d),
  polar:         d => STATE.polar = padD4OnLayer(d),
  conductDetail: d => STATE.conductDetail = normalizeConductDetail(d),
  appointments:  d => STATE.appointments = padD4OnLayer(d),
  leave:         d => STATE.leave = padD4OnLayer(d),
  msk:           d => STATE.msk = normalizeMSK(d),
  conducts:      d => STATE.conducts = d
};

const API = {
  async get(action, tab) {
    const auth = encodeURIComponent(STATE.authToken || "");
    const url = `${STATE.apiUrl}?action=${action}${tab ? "&tab=" + tab : ""}&auth=${auth}`;
    const res = await fetch(url);
    const data = await res.json();
    // 401 covers both "not logged in" and "session_expired" — either way the
    // caller should bounce to the login screen (handleAuthFailure in main.js).
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
  // ── Account auth (Step 1) ──────────────────────────────
  // login does not carry an existing token — it's how you get one.
  async login(email, password) {
    const res = await fetch(STATE.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "login", email, password })
    });
    return res.json();
  },
  async logout() { return this.post({ action: "logout" }); },
  async changePassword(currentPassword, newPassword) {
    return this.post({ action: "changePassword", currentPassword, newPassword });
  },
  // ── Admin: account + token management ──────────────────
  async listAccounts() { return this.post({ action: "listAccounts" }); },
  async addAccount(newEmail, newPersonId, newRole, newPassword) {
    return this.post({ action: "addAccount", newEmail, newPersonId, newRole, newPassword });
  },
  async removeAccount(targetEmail) { return this.post({ action: "removeAccount", targetEmail }); },
  async adminResetPassword(targetEmail, tempPassword) {
    return this.post({ action: "adminResetPassword", targetEmail, tempPassword });
  },
  async listTokens() { return this.post({ action: "listTokens" }); },
  async revokeToken(targetToken, targetEmail) {
    return this.post({ action: "revokeToken", targetToken, targetEmail });
  },
  async revokeAllForEmail(targetEmail) { return this.post({ action: "revokeAllForEmail", targetEmail }); },
  async revokeAllTokens() { return this.post({ action: "revokeAllTokens" }); },
  // ── Archive (Item 1): manual snapshot. kind: "parade"|"sick"|"both". ──
  async archiveNow(kind, opts) { return this.post({ action: "archiveNow", kind, ...(opts || {}) }); },
  // Delete one archived message (admin-only). Matches on the unique timestamp,
  // with date+slot as a fallback for legacy rows.
  async deleteArchive(kind, row) {
    return this.post({ action: "deleteArchive", kind, timestamp: row.timestamp || "", date: row.date || "", slot: row.slot || "" });
  },
  async pullAll() {
    const data = await this.get("readAll");
    if (data.error) throw new Error(data.error);
    // Replace a STATE array whenever the response carries that key — including an
    // EMPTY array, which means the tab was cleared/emptied on the Sheet and the
    // local copy must reflect that. readAllTabs always emits every data-tab key
    // (an absent/empty sheet yields []), so gating on presence (Array.isArray)
    // rather than length is safe: a genuinely missing key (older backend) is
    // skipped and keeps local data, but [] propagates the deletion. Without this,
    // deleting all rows of a tab in the Sheet left stale rows stuck in the cache
    // because a full pull skipped the empty payload. Mirrors the config/vocfit/
    // platoons presence-gating just below.
    for (const key in PULL_ASSIGN) {
      if (Array.isArray(data[key])) PULL_ASSIGN[key](data[key]);
    }
    if (data.revs) STATE.rev = data.revs;   // baseline per-tab revisions (sheet-keyed)
    // Braves reference tabs (spec §4/§12/A6). Assigned unconditionally (not
    // length-gated) so clearing a tab in the Sheet actually clears it here —
    // config especially must reflect deletions, not stick to a stale cache.
    if (data.config !== undefined) STATE.config = normalizeConfig(data.config);
    if (data.vocfit !== undefined) STATE.vocfit = normalizeVocFit(data.vocfit);
    if (data.platoons !== undefined) STATE.platoons = normalizePlatoons(data.platoons);
    // Admin pulls include the audit log; non-admins never receive it. Assign
    // unconditionally to the admin-provided value so it clears if absent.
    if (STATE.role === "admin") STATE.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
    // Archived parade-state / report-sick messages (Item 1) — admin-only, same as
    // the audit log. The backend only returns these to admins.
    if (STATE.role === "admin") {
      STATE.paradeArchive = Array.isArray(data.paradeArchive) ? data.paradeArchive : [];
      STATE.sickArchive = Array.isArray(data.sickArchive) ? data.sickArchive : [];
    }
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
  // Partial pull — fetch ONLY the named sheet tabs (e.g. ["Medical"]) via the
  // single-tab read route, normalize via the same PULL_ASSIGN as pullAll, and
  // advance STATE.rev for each. Big unchanged tabs aren't re-fetched. Returns
  // { changed, tabs }.
  async pullTabs(sheetNames) {
    const fetched = await Promise.all((sheetNames || []).map(async sheet => {
      const res = await this.get("read", sheet);
      if (res && res.error) throw new Error(res.error);
      // read&tab now returns { rows, rev }; tolerate a bare array too.
      const rows = Array.isArray(res) ? res : (res && res.rows) || [];
      const rev = (res && res.rev != null) ? res.rev : undefined;
      return { sheet, rows, rev };
    }));
    let changed = false;
    for (const { sheet, rows, rev } of fetched) {
      const key = TAB_TO_STATE[sheet];
      if (key && PULL_ASSIGN[key] && Array.isArray(rows)) { PULL_ASSIGN[key](rows); changed = true; }
      if (rev != null) STATE.rev[sheet] = rev;
    }
    // LMS counts derive from polar; only recompute if polar or attendance was
    // among the refreshed tabs (otherwise current LMS already reflects polar).
    if (changed && (sheetNames.includes("PolarFlow") || sheetNames.includes("Attendance"))
        && typeof recomputeAttendanceLmsFromPolar === "function") {
      recomputeAttendanceLmsFromPolar();
    }
    if (changed) saveLocal();
    return { changed, tabs: sheetNames };
  },
  // Cheap "what changed?" poll — returns { ok, revs: {Roster:N,…}, timestamp }.
  // No row data, so safe to call frequently.
  async revCheck() {
    return this.get("revCheck");
  },
  async pushTab(tabName, data, imported) {
    return this.post({ action: "write", tab: tabName, data, baseRev: STATE.rev[tabName], imported });
  },
  async appendRow(tabName, row) {
    return this.post({ action: "append", tab: tabName, row, baseRev: STATE.rev[tabName] });
  },
  // ID-based row upsert — finds by row.id, updates in place if found, else
  // appends. The cross-device-safe write path: two devices editing different
  // rows of the same tab never clobber each other (no full-table rewrite).
  async upsertRow(tabName, row) {
    return this.post({ action: "upsertRow", tab: tabName, row, baseRev: STATE.rev[tabName] });
  },
  // ID-based row delete — surgical, doesn't rewrite the whole tab.
  async deleteRowById(tabName, id) {
    return this.post({ action: "deleteRowById", tab: tabName, id, baseRev: STATE.rev[tabName] });
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
