// Thin wrapper around the Google Apps Script web app.
// Every data request carries an auth token. The token is issued by the backend
// on a successful email + password login (handleLogin) and stored per-device —
// see the login handler wired up in js/main.js bootstrap.

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
  leave:         d => STATE.leave = normalizeLeave(d),
  msk:           d => STATE.msk = normalizeMSK(d),
  conducts:      d => STATE.conducts = d
};

// Reverse of TAB_TO_STATE (STATE-array-key → sheet name), used by pullAll to test
// a PULL_ASSIGN key against the sheet-keyed STATE.dirty / STATE.rev. Built from
// the single source of truth in state.js so the two never drift.
const STATE_KEY_TO_TAB = Object.keys(TAB_TO_STATE).reduce((m, sheet) => {
  m[TAB_TO_STATE[sheet]] = sheet;
  return m;
}, {});

// Session-scoped memo for the P2-1 `readTabs` capability probe — see pullTabs'
// comment below for why it exists and why it is deliberately not persisted. Reset
// happens naturally on reload; nothing else should write to it.
let _readTabsUnsupported = false;

const API = {
  async get(action, tab, extraParams) {
    const auth = encodeURIComponent(STATE.authToken || "");
    let url = `${STATE.apiUrl}?action=${action}${tab ? "&tab=" + tab : ""}&auth=${auth}`;
    if (extraParams) {
      for (const k in extraParams) url += `&${k}=${encodeURIComponent(extraParams[k])}`;
    }
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
    // Never overwrite a tab that carries unsynced local edits (dirty). The launch
    // full pull would otherwise clobber a failed-but-cached write BEFORE the user
    // can retry it — the mechanism that permanently lost conduct-detail rows after
    // a reload. autoRefreshTick already guards dirty tabs; pullAll must too. Its
    // rev is left at our stale baseline so the pending retry still OCC-merges, and
    // forceResync (which clears dirty first) still gets a clean authoritative pull.
    const dirty = (STATE.dirty && STATE.dirty.size) ? STATE.dirty : null;
    for (const key in PULL_ASSIGN) {
      if (dirty && dirty.has(STATE_KEY_TO_TAB[key])) continue;
      if (Array.isArray(data[key])) PULL_ASSIGN[key](data[key]);
    }
    if (data.revs) {
      // Merge per-tab (not wholesale) so a dirty tab keeps its stale baseline.
      for (const sheet in data.revs) {
        if (dirty && dirty.has(sheet)) continue;
        STATE.rev[sheet] = data.revs[sheet];
      }
    }
    // Braves reference tabs (spec §4/§12/A6). Assigned unconditionally (not
    // length-gated) so clearing a tab in the Sheet actually clears it here —
    // config especially must reflect deletions, not stick to a stale cache.
    if (data.config !== undefined) STATE.config = normalizeConfig(data.config);
    // VocFit/Platoons are in TAB_TO_STATE — they round-trip through the normal sync
    // primitives and so CAN be marked dirty. Apply the same guard as the PULL_ASSIGN
    // loop above: a launch pull must not clobber a failed-but-cached edit before the
    // user retries it. (Config is key/value, written through its own path, absent
    // from TAB_TO_STATE and never dirty — so it stays unconditional above.)
    if (data.vocfit !== undefined && !(dirty && dirty.has("VocFit"))) STATE.vocfit = normalizeVocFit(data.vocfit);
    if (data.platoons !== undefined && !(dirty && dirty.has("Platoons"))) STATE.platoons = normalizePlatoons(data.platoons);
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
  //
  // SYNC_PERF_IMPROVEMENTS_SPEC.md P2-1: for 2+ tabs, try ONE `readTabs` batch
  // request first (one round trip instead of N parallel `read` GETs — the
  // dominant cost on GAS is round-trip overhead, not payload size). The
  // deployed production backend may not have `readTabs` yet (manual GAS
  // redeploy required) — a not-yet-redeployed backend's doGet fallthrough
  // returns `{error: "Unknown action. ..."}` for it (same message family the
  // client already tolerates elsewhere), which we detect and silently fall
  // back to today's per-tab parallel loop. This fallback is PERMANENT, not
  // temporary scaffolding: it's what keeps this method working during the
  // window between shipping this frontend and the human doing the manual
  // redeploy, and afterwards it's simply dead-cheap dead code on the happy path.
  //
  // The probe result is memoized for the session by `_readTabsUnsupported` (declared
  // below this object): without it, EVERY multi-tab pull re-probes and eats a wasted
  // round trip — measured at ~1.9s against the live sandbox, on a path the 20s poller
  // takes whenever 2+ tabs change, not just at launch (spec §8.5.3). Deliberately NOT
  // persisted to localStorage: the flag must not outlive the page, so a backend
  // redeploy mid-session is picked up on the next reload rather than being remembered
  // as unsupported indefinitely.
  async pullTabs(sheetNames) {
    const names = sheetNames || [];
    if (names.length > 1 && !_readTabsUnsupported) {
      const batched = await this._pullTabsBatched(names);
      if (batched) return batched;
      // Fall through to the legacy per-tab loop below (older backend).
    }
    const fetched = await Promise.all(names.map(async sheet => {
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
    if (changed && (names.includes("PolarFlow") || names.includes("Attendance"))
        && typeof recomputeAttendanceLmsFromPolar === "function") {
      recomputeAttendanceLmsFromPolar();
    }
    if (changed) saveLocal();
    return { changed, tabs: names };
  },
  // One-request batched partial pull backing pullTabs above. Returns the same
  // { changed, tabs } shape as the per-tab loop on success, or `null` to signal
  // "backend doesn't support readTabs, caller should fall back to the per-tab
  // loop". Any OTHER error (auth failure, a genuine per-request exception) is
  // NOT swallowed here — it propagates like every other read failure so
  // existing error handling (e.g. AuthError → login bounce) still fires.
  async _pullTabsBatched(names) {
    const res = await this.get("readTabs", null, { tabs: names.join(",") });
    const isUnknownAction = res && typeof res.error === "string" && /unknown action/i.test(res.error);
    if (isUnknownAction) { _readTabsUnsupported = true; return null; } // older, not-yet-redeployed backend
    if (res && res.error) throw new Error(res.error);
    if (!res || !res.tabs) return null; // unrecognized shape — fall back defensively
    let changed = false;
    for (const sheet of names) {
      const entry = res.tabs[sheet];
      // A per-tab gating rejection (e.g. AuditLog for a non-admin) or an
      // entry missing from the response is skipped — same tolerance the
      // per-tab loop gives an unusable single-tab response (mirrors the
      // Array.isArray(rows) guard below).
      const rows = entry && Array.isArray(entry.rows) ? entry.rows : null;
      const rev = entry && entry.rev != null ? entry.rev : undefined;
      const key = TAB_TO_STATE[sheet];
      if (key && PULL_ASSIGN[key] && rows) { PULL_ASSIGN[key](rows); changed = true; }
      if (rev != null) STATE.rev[sheet] = rev;
    }
    if (changed && (names.includes("PolarFlow") || names.includes("Attendance"))
        && typeof recomputeAttendanceLmsFromPolar === "function") {
      recomputeAttendanceLmsFromPolar();
    }
    if (changed) saveLocal();
    return { changed, tabs: names };
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
