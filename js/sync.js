// Sync tab UI and all sheet-sync actions (pull / push / ping).
// Also owns the sidebar sync indicator and the launch-time auto-sync.

function renderSync(el) {
  const authed = !!STATE.authToken;
  const who = (STATE.personId && typeof displayPersonLabel === "function") ? displayPersonLabel(STATE.personId) : "";
  const whoLabel = (who && who !== STATE.personId) ? who : "";

  const authStatusHtml = authed
    ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
         <span style="color:var(--green);font-weight:600">✓ Signed in</span>
         <span style="font-size:12px;color:var(--muted)">${whoLabel ? escapeHTML(whoLabel) + " · " : ""}${escapeHTML(STATE.email || "")}</span>
         <span class="badge badge-accent">${escapeHTML(STATE.role || "?")}</span>
         <span style="margin-left:auto;display:flex;gap:8px">
           <button class="btn" onclick="openChangePasswordForm()">Change Password</button>
           <button class="btn btn-danger" onclick="signOut()">Sign Out</button>
         </span>
       </div>`
    : `<div style="background:#F8514922;border:1px solid #F8514944;border-radius:6px;padding:10px;margin-bottom:12px;color:var(--red);font-size:12px">
         <strong>Not signed in.</strong> Use the login screen to sign in with your account.
       </div>`;

  el.innerHTML = `
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Settings</h2>
    <div class="readonly-banner">👁 Read-only access — you can view and export, but not make changes. Ask an admin if you need edit access.</div>
    <div class="sync-panel">
      <h3 style="font-size:14px;color:var(--accent);margin-bottom:12px">🔐 Account</h3>
      ${authStatusHtml}
      <h3 style="font-size:14px;color:var(--accent);margin:16px 0 12px">🔄 Sheet Sync</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-primary" onclick="doPull()" id="pull-btn" ${authed ? "" : "disabled"}>⬇ Pull from Sheet</button>
        <button class="btn btn-success write-only" onclick="doPushAll()" id="push-btn" ${authed ? "" : "disabled"}>⬆ Push All to Sheet</button>
        <button class="btn" onclick="doPing()">🏓 Test Connection</button>
        <button class="btn btn-danger" onclick="forceResync()" ${authed ? "" : "disabled"} title="Discard this device's unsynced changes and reload from the sheet. Use if stuck on 'unsaved'.">⟳ Force Resync</button>
      </div>
      <div id="sync-log" class="sync-log card" style="padding:10px"></div>
    </div>
    ${offlineGrantCardHtml()}
    <div class="card" style="margin-top:16px">
      <h3 style="color:var(--accent)">⚡ Display / Performance</h3>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 10px;line-height:1.5">
        Controls when heavy views — charts on the <strong>Strength Board</strong> and <strong>Conduct Dashboard</strong>,
        plus the <strong>Status Board</strong> calendar grid — are built. Deferring renders the tiles and tables instantly
        and waits for a “📊 Load” tap before drawing them — noticeably faster on mobile. This is a per-device setting.
      </p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${[["auto", "Auto — defer on mobile"], ["eager", "Always load charts"], ["defer", "Always defer charts"]]
          .map(([m, lab]) => `<button class="btn${STATE.deferCharts === m ? " btn-primary" : ""}" onclick="setChartPref('${m}')">${lab}</button>`).join("")}
      </div>
    </div>
    <div class="grid-2">
      <div class="card admin-only">
        <h3 style="color:var(--green)">📥 Import</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="btn" style="cursor:pointer;text-align:center">Full Backup (JSON)<input type="file" accept=".json" onchange="importBackup(this)" style="display:none"></label>
        </div>
      </div>
      <div class="card admin-only">
        <h3 style="color:var(--accent)">📤 Export</h3>
        <button class="btn" onclick="exportJSON({roster:STATE.roster,medical:STATE.medical,attendance:STATE.attendance,ippt:STATE.ippt,rm:STATE.rm,soc:STATE.soc,polar:STATE.polar,conductDetail:STATE.conductDetail,appointments:STATE.appointments,leave:STATE.leave,msk:STATE.msk},exportFileName('','json'))" style="margin-bottom:8px;width:100%">Full Backup (JSON)</button>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn" onclick="exportCSV(STATE.roster,exportFileName('Roster','csv'))" style="font-size:10px">Roster</button>
          <button class="btn" onclick="exportCSV(STATE.medical,exportFileName('Medical','csv'))" style="font-size:10px">Medical</button>
          <button class="btn" onclick="exportCSV(STATE.attendance,exportFileName('Attendance','csv'))" style="font-size:10px">Attend.</button>
          <button class="btn" onclick="exportCSV(STATE.ippt,exportFileName('IPPT','csv'))" style="font-size:10px">IPPT</button>
          <button class="btn" onclick="exportCSV(STATE.rm,exportFileName('RM','csv'))" style="font-size:10px">RM</button>
          <button class="btn" onclick="exportCSV(STATE.soc,exportFileName('SOC','csv'))" style="font-size:10px">SOC</button>
          <button class="btn" onclick="exportCSV(STATE.polar,exportFileName('Polar','csv'))" style="font-size:10px">Polar</button>
          <button class="btn" onclick="exportCSV(STATE.conductDetail,exportFileName('Conduct Detail','csv'))" style="font-size:10px">Detail</button>
        </div>
      </div>
    </div>
    <div class="card admin-only" style="margin-top:16px">
      <h3 style="color:var(--pink)">📊 Email Fitness Reports</h3>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 12px;line-height:1.55">
        Send each recruit a personalized HTML email with their Polar fitness trends, conduct attendance, and an encouragement note tailored to their data. Respects the topbar scope filter. Recruits never see anyone else's data.
      </p>
      <button class="btn btn-primary" onclick="openFitnessReportModal()" ${authed ? "" : "disabled"}>📨 Open Report Sender →</button>
    </div>
    <div class="card admin-only" style="margin-top:16px">
      <h3 style="color:var(--purple)">📊 Statistics (admin)</h3>
      <p style="font-size:11px;color:var(--muted);margin:6px 0 10px;line-height:1.5">
        One row per person, respecting the topbar scope. Opens in Excel / Google Sheets.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="exportSickStats()">📥 Report-Sick Stats (CSV)</button>
        <button class="btn" onclick="exportHAStats()">📥 HA Stats (CSV)</button>
      </div>
    </div>
    <div class="admin-only" id="admin-panel" style="margin-top:16px"></div>`;

  // Admin panel renders into #admin-panel and lazy-loads accounts/sessions.
  if (isAdminRole()) renderAdminPanel();
}

// ── Offline data grant (BACKEND_MIGRATION_REVIEW.md §4.7.5a) ─────
// Per-device, per-account, expiring permission for this browser to keep a copy
// of the company's data on disk. Off → the app still works, it just has to be
// online at launch. See the block comment above OFFLINE_GRANT_KEY in state.js
// for why this, and not encryption, is the mitigation that matters.

function offlineGrantCardHtml() {
  if (!STATE.authToken) return "";
  const st = currentOfflineGrantStatus();
  const held = (typeof _offlineGrantVerdict !== "undefined" && _offlineGrantVerdict === "held");
  const auto = st.state === "active" && (loadOfflineGrant() || {}).auto;

  let statusLine;
  if (st.state === "active") {
    const when = new Date(st.expiresAt).toLocaleString();
    statusLine = `<span style="color:var(--green);font-weight:600">✓ On</span>
      <span style="font-size:12px;color:var(--muted)">expires ${escapeHTML(when)} · ${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"} left</span>`;
  } else if (st.state === "expired") {
    statusLine = `<span style="color:var(--orange);font-weight:600">⏳ Expired</span>
      <span style="font-size:12px;color:var(--muted)">the cached copy on this device was deleted</span>`;
  } else if (st.state === "revoked") {
    statusLine = `<span style="color:var(--red);font-weight:600">⛔ Revoked by an admin</span>
      <span style="font-size:12px;color:var(--muted)">the cached copy on this device was deleted</span>`;
  } else {
    statusLine = `<span style="color:var(--muted);font-weight:600">○ Off</span>
      <span style="font-size:12px;color:var(--muted)">nothing is stored on this device</span>`;
  }

  return `
    <div class="card" style="margin-top:16px">
      <h3 style="color:var(--accent)">📴 Offline access on this device</h3>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 10px;line-height:1.55">
        With this on, the app keeps a copy of the roster, medical and conduct data in this
        browser so it opens instantly and works with no signal. That copy is real personnel
        data sitting on this device — so it is <strong>opt-in, time-limited and wiped</strong>
        when the grant ends or you sign out. With it off the app still works normally; it just
        needs a connection when you open it.
      </p>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">${statusLine}</div>
      ${auto ? `<div style="font-size:11px;color:var(--muted);background:var(--card-alt,#8882);border-radius:6px;padding:8px;margin-bottom:10px;line-height:1.5">
        This device already held a cached copy from before offline access became a choice, so a
        ${OFFLINE_GRANT_DEFAULT_DAYS}-day grant was issued automatically rather than deleting your data mid-deployment.
        Renew it below if you still need it.
      </div>` : ""}
      ${held ? `<div style="font-size:11px;color:var(--orange);background:#F5A62322;border:1px solid #F5A62344;border-radius:6px;padding:8px;margin-bottom:10px;line-height:1.5">
        <strong>Wipe deferred.</strong> The grant has ended but this device still has unpushed
        changes, so the copy was kept rather than discarding your edits. Push them
        (<em>Sheet Sync → Push All</em>, or the retry prompt at launch) and the wipe happens on the next launch.
      </div>` : ""}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${OFFLINE_GRANT_DAY_OPTIONS.map(d => `<button class="btn" onclick="doGrantOffline(${d})">${st.state === "active" ? "Renew" : "Turn on"} · ${d} day${d === 1 ? "" : "s"}</button>`).join("")}
        ${st.state === "active" ? `<button class="btn btn-danger" onclick="doRevokeOfflineHere()">Turn off &amp; wipe now</button>` : ""}
      </div>
      <p style="font-size:10px;color:var(--dim);margin-top:8px;line-height:1.5">
        Admins can see which devices hold a grant and revoke one, but a revocation only lands
        when that device is next online — the expiry above is what bounds a device nobody can reach.
      </p>
    </div>`;
}

async function doGrantOffline(days) {
  grantOffline(days);
  // Materialise the cache immediately, so "on" means on. Awaited now that the
  // flush encrypts, so the toggle does not report success before the write lands.
  await saveLocalNow();
  // Best-effort registration for the admin-review list. A failure here must not
  // block the grant: the client-side expiry is the enforcement, the server copy
  // is visibility. Say so rather than pretending the grant failed.
  try {
    await API.registerOfflineGrant(offlineDeviceId(), (loadOfflineGrant() || {}).expiresAt);
  } catch (e) {
    syncLog(`Offline grant saved on this device, but the admin list couldn't be updated: ${e.message}`, "var(--orange)");
  }
  render();
}

async function doRevokeOfflineHere() {
  if (STATE.dirty && STATE.dirty.size) {
    if (!confirm(`This device has unpushed changes in: ${[...STATE.dirty].join(", ")}.\n\nWiping now discards them. Push first (Sheet Sync → Push All), or press OK to wipe anyway.`)) return;
  }
  clearOfflineGrant();
  wipeLocalDataCache();
  try { await API.revokeOfflineGrant(offlineDeviceId()); } catch (e) { /* local wipe already done */ }
  syncLog("Offline copy deleted from this device.", "var(--green)");
  render();
}

// Launch-time check-in: the honest half of "force deletion" (§4.7.5a). An admin
// revocation cannot reach an offline device — it lands here, the next time the
// device talks to the server, and the wipe happens before anything is rendered
// from cache on the following launch. Silent no-op when there is no grant.
async function checkOfflineGrantRevocation() {
  if (!hasOfflineGrant() || !STATE.authToken) return;
  try {
    const res = await API.checkOfflineGrant(offlineDeviceId());
    if (res && res.revoked) {
      markOfflineGrantRevoked();
      if (STATE.dirty && STATE.dirty.size) {
        syncLog("An admin revoked this device's offline copy — push your unsynced changes; the copy is deleted on the next launch.", "var(--orange)");
        return;
      }
      wipeLocalDataCache();
      syncLog("An admin revoked this device's offline copy — it has been deleted.", "var(--orange)");
    }
  } catch (e) { /* offline or unsupported backend — expiry still bounds it */ }
}

// ── Admin panel (accounts · sessions · audit log) ────────
// Visible only to admins (also CSS-gated via .admin-only). Account + session
// lists are fetched on demand; the audit log arrives with the admin pull.
let _adminLoaded = false;
let _auditLimit = 50;
// P2-4: mirrors AUDIT_READALL_MAX_ROWS in apps-script-Code.gs. The backend's
// readAll truncates AuditLog to the newest N rows, so a payload landing at
// EXACTLY this length is (almost certainly — a coincidental exact-N sheet is
// possible but not worth distinguishing) truncated. Used only to decide
// whether to show the "full trail lives in the Sheet" note below.
const AUDIT_READALL_MAX_ROWS = 500;

function renderAdminPanel() {
  const host = document.getElementById("admin-panel");
  if (!host) return;

  // ORD reconciliation (§4.7.7): accounts belonging to people the roster says
  // have left. Computed at render time from data already in STATE, so it costs
  // nothing and cannot go stale relative to what the admin is looking at.
  const departed = (typeof departedAccounts === "function") ? departedAccounts() : [];
  const departedByEmail = new Map(departed.map(d => [String(d.email).toLowerCase(), d]));

  const accountsRows = (STATE.accounts || []).map(a => `
    <tr${departedByEmail.has(String(a.email || "").toLowerCase()) ? ' style="background:#F8514911"' : ""}>
      <td>${escapeHTML(a.email || "")}${(() => {
        const d = departedByEmail.get(String(a.email || "").toLowerCase());
        return d ? ` <span class="badge badge-red" title="${escapeAttr(d.name + " — roster status: " + d.status)}">${escapeHTML(d.status)}</span>` : "";
      })()}</td>
      <td><span class="badge badge-accent">${escapeHTML(a.role || "")}</span>${
        // Admins hold every capability implicitly (hasCap in the backend), so
        // showing grantable chips on an admin row would imply the editor below
        // does something for them. It doesn't.
        a.role === "admin" ? "" : (a.caps || []).map(c => {
          const cap = String(c).toLowerCase();
          if (cap === "duty") return ' <span class="badge badge-orange" title="Can plan duties">duty</span>';
          if (cap === "rs:company") return ' <span class="badge badge-orange" title="Sees company-wide report sick history">RS: company</span>';
          if (cap.indexOf("rs:plt:") === 0) return ` <span class="badge badge-orange" title="Sees this platoon's report sick history">RS: ${escapeHTML(cap.slice(7).toUpperCase())}</span>`;
          return "";
        }).join("")}</td>
      <td class="mono" style="font-size:10px">${escapeHTML(a.personId || "—")}</td>
      <td style="font-size:10px;color:var(--muted)">${escapeHTML(a.addedBy || "")}</td>
      <td style="text-align:right;white-space:nowrap">
        ${a.role === "admin" ? "" :
          `<button class="btn" style="font-size:10px" onclick="openCapsEditor('${encodeURIComponent(a.email)}')">Capabilities</button>`}
        <button class="btn" style="font-size:10px" onclick="openResetPasswordForm('${encodeURIComponent(a.email)}')">Reset PW</button>
        <button class="btn btn-danger" style="font-size:10px" onclick="doRemoveAccount('${encodeURIComponent(a.email)}')">Remove</button>
      </td>
    </tr>`).join("");

  const tokenRows = (STATE.tokens || []).map(t => `
    <tr>
      <td>${escapeHTML(t.email || "")}</td>
      <td><span class="badge badge-accent">${escapeHTML(t.role || "")}</span></td>
      <td class="mono" style="font-size:10px">${escapeHTML(t.tokenPrefix || "")}…</td>
      <td style="font-size:10px;color:var(--muted)">${t.issuedAt ? new Date(t.issuedAt).toLocaleString() : ""}${t.expired ? ' <span style="color:var(--red)">expired</span>' : ""}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-danger" style="font-size:10px" onclick="doRevokeToken('${t.token}','${encodeURIComponent(t.email || "")}')">Revoke</button>
      </td>
    </tr>`).join("");

  const audit = (STATE.auditLog || []).slice().reverse();   // newest first
  const auditRows = audit.slice(0, _auditLimit).map(r => `
    <tr>
      <td style="font-size:10px;color:var(--muted);white-space:nowrap">${r.timestamp ? new Date(r.timestamp).toLocaleString() : ""}</td>
      <td style="font-size:11px">${escapeHTML(r.email || "")}</td>
      <td><span class="badge" style="font-size:9px">${escapeHTML(r.role || "")}</span></td>
      <td class="mono" style="font-size:10px">${escapeHTML(r.action || "")}</td>
      <td style="font-size:11px">${escapeHTML(r.target || "")}</td>
      <td style="font-size:11px;color:var(--muted)">${escapeHTML(r.detail || "")}</td>
    </tr>`).join("");

  host.innerHTML = `
    <h3 style="font-size:14px;color:var(--purple);margin-bottom:10px">🛡 Admin</h3>

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;margin-bottom:10px">
        <h4 style="font-size:13px">Accounts (${(STATE.accounts || []).length})</h4>
        <span style="margin-left:auto;display:flex;gap:8px">
          <button class="btn" onclick="refreshAdminData()">↻ Refresh</button>
          <button class="btn btn-primary" onclick="openAddAccountForm()">+ Add Account</button>
        </span>
      </div>
      ${departed.length ? `<div style="background:#F8514922;border:1px solid #F8514944;border-radius:6px;padding:10px;margin-bottom:10px;font-size:12px;line-height:1.55">
        <strong style="color:var(--red)">⚠ ${departed.length} account${departed.length === 1 ? "" : "s"} belong${departed.length === 1 ? "s" : ""} to departed personnel.</strong>
        Removing an account deletes it and revokes every session it holds. Their device keeps whatever
        it already cached until that copy's offline grant expires — which is what the grant is for.
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          ${departed.map(d => `<button class="btn btn-danger" style="font-size:10px" onclick="doRemoveAccount('${encodeURIComponent(d.email)}')">Remove ${escapeHTML(d.email)} (${escapeHTML(d.status)})</button>`).join("")}
        </div>
      </div>` : ""}
      <div class="table-wrap"><table>
        <thead><tr><th>Email</th><th>Role</th><th>PersonID</th><th>Added by</th><th></th></tr></thead>
        <tbody>${accountsRows || `<tr><td colspan="5" style="color:var(--dim)">No accounts loaded — click Refresh.</td></tr>`}</tbody>
      </table></div>
    </div>

    ${offlineGrantsAdminHtml()}
    ${retentionAdminHtml()}

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;margin-bottom:10px">
        <h4 style="font-size:13px">Active sessions (${(STATE.tokens || []).length})</h4>
        <button class="btn btn-danger" style="margin-left:auto" onclick="doRevokeAllTokens()">Revoke ALL sessions</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Email</th><th>Role</th><th>Token</th><th>Issued</th><th></th></tr></thead>
        <tbody>${tokenRows || `<tr><td colspan="5" style="color:var(--dim)">No sessions loaded — click Refresh.</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h4 style="font-size:13px;margin-bottom:10px">Audit log (${(STATE.auditLog || []).length} entries)</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Email</th><th>Role</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>${auditRows || `<tr><td colspan="6" style="color:var(--dim)">No audit entries.</td></tr>`}</tbody>
      </table></div>
      ${audit.length > _auditLimit ? `<button class="btn" style="margin-top:8px" onclick="showMoreAudit()">Show more (${audit.length - _auditLimit} hidden)</button>` : ""}
      ${audit.length === AUDIT_READALL_MAX_ROWS ? `<p style="font-size:10px;color:var(--muted);margin-top:8px">Showing latest ${AUDIT_READALL_MAX_ROWS} entries; full trail lives in the Sheet.</p>` : ""}
    </div>`;

  // Lazy-load accounts + sessions the first time the admin opens this tab.
  if (!_adminLoaded) { _adminLoaded = true; refreshAdminData(); }
}

// Admin view of which devices hold an offline copy (§4.7.5a "admin review").
// The state wording here is load-bearing and deliberately unflattering: a
// revoked grant is "pending device check-in", never "wiped", because an admin
// who believes a phone has been wiped when it has not is worse off than one who
// knows it hasn't.
function offlineGrantsAdminHtml() {
  const grants = STATE.offlineGrants || [];
  const rows = grants.map(g => {
    const label = g.state === "active"
      ? `<span class="badge badge-green">active</span>`
      : g.state === "revoked"
        ? `<span class="badge badge-orange" title="The device wipes when it is next online. It has not necessarily done so yet.">revoked — pending device check-in</span>`
        : `<span class="badge">expired</span>`;
    return `<tr>
      <td>${escapeHTML(g.email || "")}</td>
      <td class="mono" style="font-size:10px">${escapeHTML(String(g.deviceId || "").slice(0, 8))}…</td>
      <td style="font-size:10px;color:var(--muted)">${g.expiresAt ? new Date(g.expiresAt).toLocaleString() : ""}</td>
      <td>${label}</td>
      <td style="text-align:right">${g.state === "active"
        ? `<button class="btn btn-danger" style="font-size:10px" onclick="doAdminRevokeOfflineGrant('${encodeURIComponent(g.deviceId)}','${encodeURIComponent(g.email || "")}')">Revoke</button>`
        : ""}</td>
    </tr>`;
  }).join("");

  return `
    <div class="card" style="margin-bottom:14px">
      <h4 style="font-size:13px;margin-bottom:6px">Offline copies on devices (${grants.length})</h4>
      <p style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.55">
        Devices currently permitted to keep company data stored locally. Revoking tells that device
        to delete its copy <strong>the next time it is online</strong> — it is not a remote wipe and
        cannot reach a phone that stays offline. The expiry column is the control that does not
        depend on contact.
      </p>
      <div class="table-wrap"><table>
        <thead><tr><th>Email</th><th>Device</th><th>Expires</th><th>State</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" style="color:var(--dim)">No devices hold an offline copy.</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

async function doAdminRevokeOfflineGrant(deviceIdEnc, emailEnc) {
  const deviceId = decodeURIComponent(deviceIdEnc);
  const email = decodeURIComponent(emailEnc || "");
  if (!confirm(`Revoke the offline copy on this device${email ? " (" + email + ")" : ""}?\n\nThe device deletes its copy the next time it connects. If it never connects again, the grant's expiry is what removes it.`)) return;
  try {
    const res = await API.revokeOfflineGrant(deviceId, email);
    if (res && res.ok) refreshAdminData();
    else alert((res && res.error) || "Could not revoke the grant.");
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    alert("Network error: " + e.message);
  }
}

// Retention review (§4.6 item 6). Read-only until the admin explicitly purges;
// see doRetentionPurge in forms-admin.js for the policy this reflects.
function retentionAdminHtml() {
  const cands = (typeof retentionCandidates === "function") ? retentionCandidates() : [];
  const overdue = cands.filter(c => c.overdue);
  const rows = cands.map(c => `
    <tr${c.overdue ? ' style="background:#F5A62311"' : ""}>
      <td class="mono" style="font-size:10px">${escapeHTML(c.id)}</td>
      <td>${escapeHTML(c.name)}</td>
      <td><span class="badge badge-red">${escapeHTML(c.status)}</span></td>
      <td style="text-align:right">${c.count}</td>
      <td style="font-size:10px;color:var(--muted)">${c.lastActivity ? escapeHTML(c.lastActivity) + ` (${c.days}d)` : "no dated record"}</td>
      <td>${c.overdue ? `<span class="badge badge-orange">past retention</span>` : `<span class="badge" style="color:var(--dim)">within window</span>`}</td>
    </tr>`).join("");

  return `
    <div class="card" style="margin-bottom:14px">
      <h4 style="font-size:13px;margin-bottom:6px">Retention — departed personnel (${cands.length})</h4>
      <p style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.55">
        Health and availability records (Medical, MSK, Appointments, Leave) still held for people the
        roster marks as departed. Policy: purge after <strong>${typeof RETENTION_DAYS === "number" ? RETENTION_DAYS : 90} days</strong>
        with no activity. Roster rows and fitness records are kept — the roster row is what lets the
        app label historical data as belonging to someone who has left. The clock runs from each
        person's most recent dated record, because the schema has no departure date; that can only
        make a purge <em>later</em> than the true departure, never earlier.
      </p>
      <div class="table-wrap"><table>
        <thead><tr><th>4D</th><th>Name</th><th>Status</th><th style="text-align:right">Records</th><th>Last activity</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="color:var(--dim)">No departed personnel hold purgeable records.</td></tr>`}</tbody>
      </table></div>
      ${overdue.length
        ? `<button class="btn btn-danger" style="margin-top:10px" onclick="doRetentionPurge()">🗑 Purge ${overdue.reduce((n, c) => n + c.count, 0)} record(s) for ${overdue.length} departed personnel</button>`
        : `<p style="font-size:11px;color:var(--dim);margin-top:8px">Nothing is past the retention window.</p>`}
    </div>`;
}

async function refreshAdminData() {
  try {
    // Offline grants are best-effort: an older backend deployment has no such
    // action, and that must degrade to an empty list rather than blanking the
    // accounts and sessions the admin actually came here for.
    const [acc, tok, grants] = await Promise.all([
      API.listAccounts(),
      API.listTokens(),
      API.listOfflineGrants().catch(() => null)
    ]);
    if (acc && acc.accounts) STATE.accounts = acc.accounts;
    if (tok && tok.tokens) STATE.tokens = tok.tokens;
    STATE.offlineGrants = (grants && grants.grants) ? grants.grants : [];
    renderAdminPanel();
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    syncLog(`Admin data load failed: ${e.message}`, "var(--red)");
  }
}

function showMoreAudit() { _auditLimit += 50; renderAdminPanel(); }

function syncLog(msg, color) {
  const el = document.getElementById("sync-log");
  if (!el) return;
  const t = new Date().toLocaleTimeString();
  el.innerHTML = `<div style="color:${color || 'var(--muted)'}">${t} — ${escapeHTML(msg)}</div>` + el.innerHTML;
}

// ── Sync timing instrumentation ──────────────────────────
// Times every network round-trip and keeps the last ~30 per category so you can
// see how long syncs actually take. Each call logs "[sync] <label>: <ms>ms" to
// the console; run syncTimingSummary() in the console for min/avg/max/last per
// category. Categories: "revCheck" (the cheap poll), "pull" (full + partial
// data fetches), "write" (each upsert/append/delete/replace round-trip).
const _now = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
const _syncTimings = { revCheck: [], pull: [], write: [] };
async function timed(category, label, fn, alsoSyncLog) {
  const t0 = _now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(_now() - t0);
    const buf = _syncTimings[category] || (_syncTimings[category] = []);
    buf.push(ms);
    if (buf.length > 30) buf.shift();
    console.log(`[sync] ${label}: ${ms}ms`);
    if (alsoSyncLog) syncLog(`${label}: ${ms}ms`, "var(--dim)");
  }
}
// Console helper: print a per-category summary of recent sync durations.
function syncTimingSummary() {
  const out = {};
  for (const cat in _syncTimings) {
    const a = _syncTimings[cat];
    if (!a.length) { out[cat] = "(no samples)"; continue; }
    const sum = a.reduce((s, x) => s + x, 0);
    out[cat] = { samples: a.length, last: a[a.length - 1] + "ms", avg: Math.round(sum / a.length) + "ms", min: Math.min(...a) + "ms", max: Math.max(...a) + "ms" };
  }
  console.table(out);
  return out;
}

// The always-visible topbar pill (#sync-status). kind ∈ ok | syncing | error.
// `onTap` makes it a tap-to-retry button (used for the unsaved/error state).
function updateSyncPill(kind, text, onTap) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.className = kind === "error" ? "s-error" : kind === "syncing" ? "s-syncing" : "s-ok";
  el.textContent = text;
  el.onclick = onTap || null;
  el.title = onTap ? "Tap to retry syncing" : "Sync status";
}

function setSyncIndicator(text, color) {
  // Mirror to the always-visible topbar pill so push status is obvious on mobile
  // (the sidebar indicator below is hidden behind ☰). Color encodes the state.
  const c = String(color || "");
  if (/red/.test(c)) updateSyncPill("error", /auth|authenticated/i.test(text) ? "⚠ Sign in" : "⚠ Sync error", retryAllDirty);
  else if (/orange/.test(c)) updateSyncPill("syncing", "⟳ Saving…");
  else updateSyncPill("ok", "✓ Saved");

  const el = document.getElementById("sync-indicator");
  if (!el) return;
  el.textContent = text;
  el.style.color = color || "";
  // Reset interactivity — refreshSyncIndicator re-applies these for the
  // dirty state. setSyncIndicator alone always renders a passive label.
  el.style.cursor = "";
  el.style.textDecoration = "";
  el.onclick = null;
  el.title = "";
}

// State-aware indicator refresh. Decides the displayed state based on the
// auth/sync/dirty status, and makes the indicator clickable when there are
// dirty tabs that need retrying. Called after every autoSync attempt.
let _lastSyncedAt = null;
let _lastCheckedAt = null;   // last time the lightweight revCheck poll ran
let _lastSyncError = null;   // last write failure message (for the pill/banner)
function refreshSyncIndicator() {
  const el = document.getElementById("sync-indicator");
  if (!el) return;
  if (!STATE.authToken) {
    setSyncIndicator("● Not authenticated", "var(--red)");
    return;
  }
  if (_pullInFlight || _activePushCount > 0) {
    setSyncIndicator("● Syncing…", "var(--orange)");
    return;
  }
  const dirtyCount = (STATE.dirty && STATE.dirty.size) || 0;
  if (dirtyCount > 0) {
    // Loud, tappable "not saved" state — both in the sidebar and the topbar pill.
    updateSyncPill("error", `⚠ ${dirtyCount} unsaved · Retry`, retryAllDirty);
    el.textContent = `⚠ ${dirtyCount} tab${dirtyCount === 1 ? "" : "s"} need retry · Retry now`;
    el.style.color = "var(--red)";
    el.style.cursor = "pointer";
    el.style.textDecoration = "underline";
    el.title = `Unsynced changes in: ${[...STATE.dirty].join(", ")}. Click to retry all.`;
    el.onclick = retryAllDirty;
    return;
  }
  const stamp = _lastSyncedAt ? new Date(_lastSyncedAt).toLocaleTimeString() : new Date().toLocaleTimeString();
  const checked = _lastCheckedAt ? ` · checked ${new Date(_lastCheckedAt).toLocaleTimeString()}` : "";
  setSyncIndicator(`● Synced ${stamp}${checked}`, "var(--green)");

  // P4-1: while the poll is relaxed to 60s, say so and offer an immediate check.
  // Runs AFTER setSyncIndicator because that call resets both the pill and the
  // sidebar line to their plain "synced" form; this layers the affordance on top.
  // The user approved the slower cadence on condition it's apparent (spec §7 Q2),
  // so this is part of the feature, not decoration.
  if (_relaxed) {
    const checkNow = () => { resetPollCadence(); autoRefreshTick("manual"); };
    updateSyncPill("ok", "✓ Synced · Check now", checkNow);
    const el2 = document.getElementById("sync-status");
    if (el2) el2.title = `Idle — checking every ${AUTO_REFRESH_IDLE_MS / 1000}s. Tap to check now.`;
    el.textContent = `● Synced ${stamp}${checked} · idle, checking every ${AUTO_REFRESH_IDLE_MS / 1000}s · Check now`;
    el.style.cursor = "pointer";
    el.style.textDecoration = "underline";
    el.title = "Polling has slowed because nothing has changed for a while. Click to check for updates immediately.";
    el.onclick = checkNow;
  }
}

// ── Dirty-tab tracking ────────────────────────────────────
// _dirtyOps stashes the exact granular ops that FAILED to push, so a later
// retry can replay them (each OCC-merges via resolveConflict) instead of a
// stale full-tab replace that would force the user to redo their edit.
const _dirtyOps = new Map();   // tabName → array of failed granular modes
function markDirty(tabName) {
  if (!tabName) return;
  STATE.dirty = STATE.dirty || new Set();
  STATE.dirty.add(tabName);
  saveDirty();
}
function clearDirty(tabName) {
  if (!STATE.dirty) return;
  STATE.dirty.delete(tabName);
  _dirtyOps.delete(tabName);
  saveDirty();
}

// ── Read-only (viewer) write rejection ───────────────────
// Surfaced when a viewer's edit is blocked at the autoSync chokepoint. Throttled
// so a bulk action (which fires several autoSync calls) shows a single alert.
let _readOnlyNoticeAt = 0;
function notifyReadOnly() {
  syncLog("Read-only account — change not saved.", "var(--orange)");
  setSyncIndicator("● Read-only — changes not saved", "var(--orange)");
  const now = Date.now();
  if (now - _readOnlyNoticeAt > 1500) {
    _readOnlyNoticeAt = now;
    // Defer so the in-progress render/closeModal finishes before the alert.
    setTimeout(() => alert("Your account is read-only — that change was not saved."), 0);
  }
}

// Debounced re-pull that discards a viewer's optimistic local edit (the form
// mutates STATE + saveLocal() before autoSync runs). One pull covers a burst of
// blocked writes from a single submit. Safe from recursion: pullAll never calls
// autoSync.
let _viewerRevertTimer = null;
function scheduleViewerRevert() {
  if (_viewerRevertTimer) clearTimeout(_viewerRevertTimer);
  _viewerRevertTimer = setTimeout(() => {
    _viewerRevertTimer = null;
    if (typeof doPull === "function") doPull();
  }, 400);
}

// ── Pull/push mutex + per-tab write queue ────────────────
// _pullInFlight blocks all writes during a launch/refresh pull so we never
// push against STATE that's about to be replaced by an arriving pull.
// Writes are queued PER TAB and dispatched one at a time as GRANULAR ops
// (upsert/append/delete) — never collapsed into a full-tab replace, so a
// burst of edits can't overwrite rows another device added meanwhile.
let _pullInFlight = false;
let _activePushCount = 0;
// Awaitable promise that resolves when the current pull finishes. The queue
// awaits this before dispatching so writes never operate on stale STATE.
let _pullPromise = Promise.resolve();
function setPullInFlight(promise) {
  _pullInFlight = true;
  _pullPromise = Promise.resolve(promise).finally(() => { _pullInFlight = false; refreshSyncIndicator(); });
}

// Copy-time staleness warning. A generated parade state / sick report gets
// pasted into WhatsApp and SENT — so a copy taken while a pull is in flight can
// be superseded seconds later, with the sender none the wiser. An Apps Script
// round trip is slow enough for that window to be real (see the ~2.1s revCheck
// median noted below).
//
// Returns true to proceed. SILENT when no pull is running, which is the
// overwhelmingly common path — a guard that fires routinely is one people learn
// to click through, which would make it worse than no guard at all.
//
// It warns rather than awaiting _pullPromise, which would be trivial. Two
// reasons: the button would sit dead for the whole round trip with no
// explanation, and the parade/report textareas are deliberately EDITABLE for
// last-minute corrections — a pull landing behind a silent wait would leave
// hand-typed edits disagreeing with the data they were generated from, and
// regenerating instead would throw those edits away. The person holding the
// phone knows whether the message has to go out now; this leaves it to them.
function unsyncedCopyGuard(label) {
  if (!_pullInFlight) return true;
  return confirm(
    `Newer data is being pulled from the sheet right now.\n\n`
    + `This ${label || "message"} was generated before that data arrived, so it may `
    + `already be out of date.\n\nCancel to re-copy once the sync settles, or OK to copy anyway.`
  );
}

const _writeQueue = new Map();    // tabName → array of pending modes
const _draining = new Map();      // tabName → promise of the active drain loop

// Single chokepoint for every write. Enqueues the op for its tab and starts a
// drain loop if one isn't already running. mode dispatches to the right
// primitive (see dispatchWrite). Returns the drain promise.
//
// Read-only guard (viewers): block BEFORE enqueueing so no dirty marker is ever
// set. A dirty tab is the ONLY thing that later prompts a commander to push
// (launch restore prompt / sidebar retry) — refusing to mark dirty is what
// prevents a viewer's phantom edit from being accidentally approved. We scrub
// any stale marker and schedule a silent re-pull to discard the optimistic
// local edit the form already applied.
function autoSync(tabName, mode) {
  if (typeof canWrite === "function" && !canWrite()) {
    clearDirty(tabName);
    notifyReadOnly();
    scheduleViewerRevert();
    return Promise.resolve({ ok: false, readOnly: true });
  }
  // P4-1: a local write means this session is active — back to the 20s cadence,
  // so a user who starts working after an idle spell isn't left on 60s polling.
  resetPollCadence();
  if (!_writeQueue.has(tabName)) _writeQueue.set(tabName, []);
  _writeQueue.get(tabName).push(mode);
  if (_draining.has(tabName)) return _draining.get(tabName);
  const p = drainTab(tabName);
  _draining.set(tabName, p);
  return p;
}

async function drainTab(tabName) {
  _activePushCount++;
  refreshSyncIndicator();
  try {
    // Never push against STATE that an in-flight pull is about to replace.
    if (_pullInFlight) { try { await _pullPromise; } catch (e) { /* handled elsewhere */ } }
    const q = _writeQueue.get(tabName);
    while (q && q.length) {
      const mode = q.shift();
      try {
        await runWrite(tabName, mode);
        clearDirty(tabName);
      } catch (e) {
        markDirty(tabName);
        _lastSyncError = (e && e.message) || String(e);   // surfaced in the pill/banner
        // Stash the failed granular op so retryAllDirty can replay it (and
        // OCC-merge) rather than a stale full replace. Replace failures aren't
        // stashed — they re-derive from STATE on retry.
        if (mode.type !== "replace") {
          if (!_dirtyOps.has(tabName)) _dirtyOps.set(tabName, []);
          _dirtyOps.get(tabName).push(mode);
        }
        syncLog(`Auto-push ${tabName} failed: ${e.message || e}`, "var(--red)");
      }
    }
  } finally {
    _draining.delete(tabName);
    _activePushCount = Math.max(0, _activePushCount - 1);
    _lastSyncedAt = Date.now();
    refreshSyncIndicator();
  }
}

// Dispatch one write to the backend. Each carries STATE.rev[tab] as baseRev
// (added inside the API.* helpers; appendMany posts directly so it's added here).
//   { type: "append",         row         } → API.appendRow
//   { type: "appendMany",     rows        } → API.post appendMany
//   { type: "replaceConduct", match, rows } → API.post replaceConductRows (atomic
//        per-conduct swap: deletes match's non-RSI rows + appends rows in one op)
//   { type: "upsert",         row         } → API.upsertRow (id-based, cross-device safe)
//   { type: "delete",         id          } → API.deleteRowById
//   { type: "replace",        data        } → API.pushTab (full overwrite, bulk only)
//
// Deliberately NOT here: the duty-change-request decision (design §3.3). It is
// atomic across TWO tabs — it writes Duty rows and flips the request's status in
// one backend call — and this queue is per-tab. Routing it through here would
// mean reapplyMode silently no-opping it on a conflict, and the retry re-firing
// a decision the server has already applied. It goes through API.post directly
// from js/forms-duty.js, followed by a pull of both tabs.
function dispatchWrite(tabName, mode) {
  if (!STATE.authToken) return Promise.reject(new Error("Not authenticated"));
  // `mode.imported` (bulk import) rides through to the POST body so the backend
  // can admin-gate imports without throttling normal commander edits.
  if (mode.type === "append")      return API.appendRow(tabName, mode.row);
  if (mode.type === "appendMany")  return API.post({ action: "appendMany", tab: tabName, rows: mode.rows, baseRev: STATE.rev[tabName], imported: mode.imported });
  if (mode.type === "replaceConduct") return API.post({ action: "replaceConductRows", tab: tabName, match: mode.match, rows: mode.rows, baseRev: STATE.rev[tabName], imported: mode.imported });
  if (mode.type === "upsert")      return API.upsertRow(tabName, mode.row);
  if (mode.type === "delete")      return API.deleteRowById(tabName, mode.id);
  if (mode.type === "replace")     return API.pushTab(tabName, mode.data, mode.imported);
  return Promise.reject(new Error(`Unknown autoSync mode: ${mode.type}`));
}

// Runs one write, handling the server's optimistic-concurrency response.
// The backend returns errors AND conflicts in the BODY (not as HTTP errors),
// so we must inspect the response here:
//   { conflict:true } → our baseRev was stale (someone else wrote) → resolve.
//   { error }         → real failure; throw so the tab is marked dirty.
//   { rev }           → success; advance our baseline for this tab.
async function runWrite(tabName, mode) {
  let res = await timed("write", `write ${tabName} (${mode.type})`, () => dispatchWrite(tabName, mode));
  // A stale write is rejected with { conflict }. Resolve by pulling fresh,
  // re-applying this edit, and retrying. Bounded loop (not a single retry) so a
  // BUSY tab whose revision keeps moving while we resolve still settles in-line
  // instead of bouncing to the dirty "needs retry" list. replace returns a
  // non-conflict result, so it never loops.
  let attempts = 0;
  while (res && res.conflict && attempts < 6) {
    attempts++;
    res = await resolveConflict(tabName, mode, res.serverRev);
  }
  if (res && res.conflict) throw new Error("Still out of date after refresh — will retry");
  if (res && res.error) throw new Error(res.error);
  if (res && res.rev != null) { STATE.rev[tabName] = res.rev; saveLocal(); }
  return res;
}

// Recover from a stale-write rejection WITHOUT clobbering newer data.
//  • Granular (upsert/append/appendMany/delete): pull the tab fresh, re-apply
//    this edit on top of the latest rows, retry the push once (baseRev now
//    matches) → the user's change lands alongside everyone else's.
//  • replace (full re-push): never auto-clobber. Pull fresh and surface a
//    banner asking the user to redo their bulk change on the refreshed data.
async function resolveConflict(tabName, mode, serverRev) {
  const arrKey = TAB_TO_STATE[tabName];
  if (mode.type === "replace") {
    try { await API.pullTabs([tabName]); } catch (e) { /* keep going */ }
    if (serverRev != null) STATE.rev[tabName] = serverRev;
    if (typeof render === "function") render();
    showSyncBanner(`"${tabName}" was changed on another device. Refreshed to the latest — please redo your bulk change, then Re-push.`);
    return { ok: true, refreshed: true };   // tab now matches server; not dirty
  }
  try { await API.pullTabs([tabName]); }
  catch (e) { return { conflict: true, serverRev }; }   // couldn't refresh → bubble up
  // Belt-and-suspenders: make baseRev reflect the server even if the partial
  // read didn't carry a rev, so the retry isn't guaranteed to re-conflict.
  if (serverRev != null && (STATE.rev[tabName] == null || Number(STATE.rev[tabName]) < Number(serverRev))) {
    STATE.rev[tabName] = serverRev;
  }
  if (arrKey && Array.isArray(STATE[arrKey])) reapplyMode(arrKey, mode);
  saveLocal();
  if (typeof render === "function") render();
  return dispatchWrite(tabName, mode);                 // retry with fresh baseRev
}

// Re-apply a granular op to a freshly-pulled local array so the UI keeps the
// user's edit (the pull just replaced STATE[arrKey] with server rows).
function reapplyMode(arrKey, mode) {
  const arr = STATE[arrKey];
  if (!Array.isArray(arr)) return;
  if (mode.type === "upsert" && mode.row) {
    const i = arr.findIndex(r => String(r.id) === String(mode.row.id));
    if (i >= 0) arr[i] = mode.row; else arr.push(mode.row);
  } else if (mode.type === "delete") {
    const i = arr.findIndex(r => String(r.id) === String(mode.id));
    if (i >= 0) arr.splice(i, 1);
  } else if (mode.type === "append" && mode.row) {
    arr.push(mode.row);
  } else if (mode.type === "appendMany" && Array.isArray(mode.rows)) {
    arr.push(...mode.rows);
  }
}

// Retry every dirty tab. Safe now: the server's OCC check rejects a stale
// replace (resolveConflict refreshes + warns) instead of clobbering. Used by
// the sidebar warning click and the launch dirty-restore prompt.
async function retryAllDirty() {
  if (!STATE.dirty || STATE.dirty.size === 0) return;
  // A retry is one Apps Script round trip per dirty tab — easily several
  // seconds — and it is reached from the sync pill, which is a small target
  // people re-tap when nothing appears to happen.
  const restoreBtn = btnBusy(null, "Retrying…");
  const tabs = [...STATE.dirty];
  for (const tab of tabs) {
    const ops = _dirtyOps.get(tab);
    if (ops && ops.length) {
      // Replay the exact failed granular ops — each OCC-merges on top of any
      // newer server rows, preserving both the user's edit and others'.
      _dirtyOps.delete(tab);
      for (const mode of ops) await autoSync(tab, mode);
    } else {
      // No stashed ops (e.g. after a reload) → full replace, OCC-guarded.
      const arrKey = TAB_TO_STATE[tab];
      if (arrKey && STATE[arrKey]) await autoSync(tab, { type: "replace", data: STATE[arrKey] });
    }
  }
  // If a tab is STILL dirty after a full retry pass, the push is genuinely
  // failing (auth expired, offline, a row the server keeps rejecting). Don't pop
  // anything up — the topbar pill already shows the red "unsaved" state, and the
  // Sync tab has a "Force Resync" button. The last error is logged for diagnosis.
  if (STATE.dirty && STATE.dirty.size > 0 && _lastSyncError) {
    syncLog(`Still unsaved (${[...STATE.dirty].join(", ")}): ${_lastSyncError}`, "var(--red)");
  }
  // Outside the `if` deliberately: that branch is the still-failing case, and
  // the button must come back whether the retry succeeded or not.
  restoreBtn();
}

// Escape hatch for a device stuck showing "unsaved" that a normal retry can't
// clear (expired session, a poison local row, or stale cached code). Discards
// this device's unsynced local changes and reloads the authoritative sheet
// state, returning the device to a clean, synced baseline.
async function forceResync() {
  if (!confirm(
    "Discard any unsynced changes on THIS device and reload everything from the sheet?\n\n" +
    "Use this if the device is stuck on \"unsaved\". Local edits that never reached the sheet will be lost."
  )) return;
  // P3-2: flush any debounced saveLocal() before we start tearing down local
  // state (rev/dirty below, then a full pullAll overwrite). Awaited now that the
  // flush encrypts — starting the teardown mid-encrypt would race the write.
  if (typeof saveLocalNow === "function") await saveLocalNow();
  STATE.dirty = new Set();
  _dirtyOps.clear();
  saveDirty();
  STATE.rev = {};                 // drop a possibly-stale baseline → full authoritative pull
  _lastSyncError = null;
  setSyncIndicator("● Syncing…", "var(--orange)");
  try {
    const p = timed("pull", "pull ALL (force resync)", () => API.pullAll(), true);
    setPullInFlight(p);
    await p;
    _lastSyncedAt = Date.now();
    refreshSyncIndicator();
    if (typeof render === "function") render();
    syncLog("Force resync complete — device is back in sync.", "var(--green)");
  } catch (e) {
    if (e.name === "AuthError") {
      setSyncIndicator("● Not authenticated", "var(--red)");
      syncLog("Force resync failed: not authorized — this device needs to sign in again.", "var(--red)");
    } else {
      setSyncIndicator("● Sync failed", "var(--red)");
      syncLog("Force resync failed: " + (e.message || e), "var(--red)");
    }
  }
}

// Pre-write heads-up for the manual "Re-push all" button. Rev-aware: compares
// our last-seen revision to the server's. Returns true to proceed, false to
// abort and pull first. (The server OCC is the real guard — even "push anyway"
// is rejected if stale — this just warns earlier.)
async function confirmStaleness(tabName) {
  try {
    const res = await API.revCheck();
    if (!res || res.error || !res.revs) return true;     // can't check → don't block
    const serverRev = res.revs[tabName];
    const localRev = STATE.rev[tabName];
    if (serverRev == null || localRev == null || Number(serverRev) === Number(localRev)) return true;
    return confirm(
      `"${tabName}" has changed on another device since you last synced.\n\n` +
      `Re-pushing now will overwrite those newer changes.\n\n` +
      `OK = push anyway.  Cancel = abort and pull first (recommended).`
    );
  } catch { return true; }
}

async function signOut() {
  if (!confirm("Sign out from this device? You'll need to log in again with your account.")) return;
  // Sign-out now wipes the cached data (below), which makes unpushed edits a
  // real loss rather than a deferred push — so ask before destroying them. The
  // dirty MARKERS survive a wipe, but the rows they refer to live in the cache.
  if (STATE.dirty && STATE.dirty.size) {
    if (!confirm(
      `You still have unpushed changes in: ${[...STATE.dirty].join(", ")}.\n\n` +
      `Signing out deletes this device's local copy, so those edits would be lost.\n\n` +
      `Cancel = stay signed in and push them first (recommended).  OK = sign out and discard.`
    )) return;
  }
  // P3-2 note: the old flush-before-sign-out (saveLocalNow) is deliberately gone
  // — the cache is about to be deleted, so writing it out first was pointless
  // work on the way to the same place.
  // Best-effort server-side token invalidation, then clear the local session and
  // return to the login screen regardless of the network result.
  try { await API.logout(); } catch (e) { /* clear locally anyway */ }
  _adminLoaded = false;
  // Sign-out is a handover boundary — the next person to open this browser must
  // not inherit a plaintext mirror of the company's medical data (§4.6 item 3).
  // The grant goes with it, so signing back in is an explicit opt-in again.
  clearOfflineGrant();
  wipeLocalDataCache();
  // The key must go too. Leaving it in sessionStorage would let the NEXT account
  // on this device silently inherit a working key — and the offline grant is
  // already per-account for exactly that reason.
  clearCacheKey();
  clearSession();
  if (typeof applyRoleUI === "function") applyRoleUI();
  showLogin();
  setSyncIndicator("● Not authenticated", "var(--red)");
}

async function doPing() {
  try {
    syncLog("Pinging...");
    const res = await API.getPublic("ping");
    // Liveness only — the backend deliberately no longer reports its tab list
    // here, so there is nothing to print but the fact that it answered.
    if (res.ok) syncLog("Connected!", "var(--green)");
    else syncLog(`Error: ${res.error}`, "var(--red)");
  } catch (e) { syncLog(`Failed: ${e.message}`, "var(--red)"); }
}

async function doPull() {
  try {
    syncLog("Pulling all data...");
    document.getElementById("pull-btn").disabled = true;
    const pullPromise = timed("pull", "pull ALL (readAll)", () => API.pullAll(), true);
    setPullInFlight(pullPromise);
    const data = await pullPromise;
    syncLog(`Pull complete! Sheet: ${data.sheetName}`, "var(--green)");
    _lastSyncedAt = Date.now();
    refreshSyncIndicator();
    render();
  } catch (e) {
    syncLog(`Pull failed: ${e.message}`, "var(--red)");
    if (e.name === "AuthError") setSyncIndicator("● Not authenticated", "var(--red)");
  } finally { const b = document.getElementById("pull-btn"); if (b) b.disabled = false; }
}

async function doPushAll() {
  const tabs = [
    ["Roster", STATE.roster], ["Medical", STATE.medical], ["Attendance", STATE.attendance],
    ["IPPT", STATE.ippt], ["RouteMarch", STATE.rm], ["SOC", STATE.soc], ["PolarFlow", STATE.polar],
    ["ConductDetail", STATE.conductDetail],
    ["Appointments", STATE.appointments],
    ["Leave", STATE.leave],
    ["MSK", STATE.msk]
  ];
  document.getElementById("push-btn").disabled = true;
  for (const [name, data] of tabs) {
    if (data.length) {
      try { await pushTab(name, data); } catch (e) { syncLog(`${name} failed: ${e.message}`, "var(--red)"); }
    }
  }
  const b = document.getElementById("push-btn"); if (b) b.disabled = false;
}

async function pushTab(tabName, data) {
  // Per-tab manual "Re-push all" button. Bulk-replace operations check
  // staleness first — if another device added rows since we last pulled,
  // confirm before clobbering. Routes through autoSync so the indicator,
  // dirty-tracking, and serialization queue all stay consistent with the
  // automatic write path.
  const localCount = Array.isArray(data) ? data.length : 0;
  const proceed = await confirmStaleness(tabName);
  if (!proceed) {
    syncLog(`${tabName}: push cancelled — pull first to see latest rows`, "var(--orange)");
    return;
  }
  try {
    syncLog(`Pushing ${tabName} (${localCount} rows)...`);
    await autoSync(tabName, { type: "replace", data });
    syncLog(`${tabName}: re-push complete ✓`, "var(--green)");
  } catch (e) { syncLog(`${tabName}: ${e.message}`, "var(--red)"); }
}

// ── Auto-refresh: poll the cheap revCheck endpoint, pull only changed tabs ──
// Keeps every open tab fresh so a stale tab can't sit on hours-old data. The
// poll is a tiny payload (per-tab revisions only); we full-fetch nothing unless
// a tab's server revision is ahead of ours, then pull ONLY those tabs.
const AUTO_REFRESH_MS = 20000;        // ~20s while visible (user-chosen cadence)
const AUTO_REFRESH_MIN_GAP_MS = 8000; // debounce: ignore checks closer than this
let _autoRefreshTimer = null;
let _autoRefreshing = false;
let _autoRefreshInited = false;       // wire the listeners/timer only once

// ── P4-1: adaptive poll cadence (SYNC_PERF_IMPROVEMENTS_SPEC.md §3 P4-1) ──────
// Every revCheck is a real Apps Script round trip — measured median ~2.1s against
// the live sandbox (§8.5.2) — so a tab left open all day at a fixed 20s fires ~180
// of them an hour, nearly all returning "nothing changed". After a run of quiet
// polls the interval relaxes to 60s; ANY sign of activity (a detected change, tab
// focus, a local write) snaps it straight back to 20s.
//
// The 20s cadence was a user-chosen default, so relaxing it is only sanctioned
// because the user explicitly approved it (spec §7 Q2, answered 2026-07-20) — and
// approved it WITH the condition that the slower cadence is made apparent, since a
// user who doesn't know freshness dropped to 60s can't make an informed choice
// about when to check. Hence _relaxed also drives a visible, tappable "Check now"
// affordance in refreshSyncIndicator() rather than degrading freshness silently.
const AUTO_REFRESH_IDLE_MS = 60000;   // relaxed cadence once nothing's been changing
const AUTO_REFRESH_IDLE_AFTER = 6;    // consecutive no-change polls before relaxing
let _noChangeStreak = 0;
let _relaxed = false;

// Current cadence, as data. Exposed as a function rather than leaving callers to
// read the module-scoped `let`s directly: it's the natural companion to
// syncTimingSummary() when eyeballing poll behaviour in the console, and it's the
// only way the vm test sandbox can observe this state at all (top-level let/const
// don't attach to the sandbox global the way function declarations do — the same
// reason test/harness.js has to re-export STATE/API explicitly).
function pollCadenceInfo() {
  return {
    relaxed: _relaxed,
    currentMs: _relaxed ? AUTO_REFRESH_IDLE_MS : AUTO_REFRESH_MS,
    noChangeStreak: _noChangeStreak,
    activeMs: AUTO_REFRESH_MS,
    idleMs: AUTO_REFRESH_IDLE_MS,
    idleAfter: AUTO_REFRESH_IDLE_AFTER
  };
}

// Back to the responsive cadence. Called on any evidence the data is live again:
// a changed tab, the user returning to the tab, or a local write being queued.
// Restarts the timer only when the cadence actually changes — a no-op call must
// not reset the current interval's progress.
function resetPollCadence() {
  _noChangeStreak = 0;
  if (!_relaxed) return;
  _relaxed = false;
  startAutoRefresh();
  refreshSyncIndicator();
}

function isModalOpen() {
  const o = document.getElementById("modal-overlay");
  return !!o && !o.classList.contains("hidden");
}

// Report-sick scope changes are not revision changes: the Medical tab's rev is
// unchanged when an admin narrows a grant or a different account signs in on a
// shared device, but WHAT THAT CALLER MAY SEE has changed completely. So the
// server reports a scope key (apps-script-Code.gs, rsScopeKey_) and a difference
// forces a re-pull of the two scoped tabs.
//
// Deliberately a SEPARATE field rather than folding the scope into the rev
// itself: the changed-tab filters below compare revs with Number(a) > Number(b),
// and js/api.js round-trips the rev back as the OCC baseRev. A non-numeric rev
// would make Medical read as never-changed AND make every whole-tab write
// conflict. Never widen `revs` to carry anything but numbers.
//
// Returns the tab names to add to the changed list. STATE.rev is deliberately
// untouched — the tabs are pulled, and the pull advances the rev normally.
const RS_SCOPED_TABS = ["Medical", "MSK"];
function rsApplyScopeKey(res) {
  // An older backend deploy omits the field entirely. Treat that as "no
  // information", not as "your scope is now empty" — otherwise every poll
  // against a stale deployment would thrash a re-pull.
  if (!res) return [];
  return rsStoreScopeKey(res.scopeKey) ? RS_SCOPED_TABS.slice() : [];
}

async function autoRefreshTick(reason) {
  if (!STATE.authToken) return;
  if (_autoRefreshing) return;
  // Never race a write or an in-flight pull.
  if (_pullInFlight || _activePushCount > 0) return;
  // Debounce focus+visibility+online firing together.
  if (_lastCheckedAt && (Date.now() - _lastCheckedAt) < AUTO_REFRESH_MIN_GAP_MS && reason !== "interval") return;
  _autoRefreshing = true;
  try {
    const res = await timed("revCheck", "revCheck", () => API.revCheck());
    if (!res || res.error || !res.revs) return;
    _lastCheckedAt = Date.now();
    refreshSyncIndicator();

    // Which sheet tabs have a server revision ahead of ours?
    const revChanged = Object.keys(res.revs).filter(sheet =>
      Number(res.revs[sheet]) > Number(STATE.rev[sheet] || 0)
    );
    // A scope change makes the scoped tabs stale without moving their revision.
    const changed = [...new Set(revChanged.concat(rsApplyScopeKey(res)))];
    if (changed.length === 0) {
      // P4-1: a quiet poll. Past the streak threshold, drop to the relaxed
      // cadence and surface it (refreshSyncIndicator renders the "Check now"
      // affordance while _relaxed).
      _noChangeStreak++;
      if (!_relaxed && _noChangeStreak >= AUTO_REFRESH_IDLE_AFTER) {
        _relaxed = true;
        startAutoRefresh();
        syncLog(`Idle — checking every ${AUTO_REFRESH_IDLE_MS / 1000}s now. Tap "Check now" to sync immediately.`, "var(--muted)");
      }
      refreshSyncIndicator();
      return;
    }
    // Something moved — back to the responsive cadence.
    resetPollCadence();

    const dirty = STATE.dirty || new Set();
    const dirtyChanged = changed.filter(t => dirty.has(t));
    const safeChanged = changed.filter(t => !dirty.has(t));

    // A tab with unsynced local edits that ALSO changed elsewhere — never pull
    // over it. Offer "Sync now" which pushes the edits; the server OCC-merges
    // them with the newer rows (no data lost on either side).
    if (dirtyChanged.length) {
      showDirtyConflictBanner(dirtyChanged);
      // Other changed tabs (no local edits) are still safe to refresh quietly,
      // as long as no form is open.
      if (safeChanged.length && !isModalOpen()) await applyAutoPull(safeChanged);
      return;
    }
    // No dirty collisions. If a form is open, don't re-render under it — banner.
    if (isModalOpen()) {
      if (safeChanged.length) showNewerDataBanner(safeChanged);
      return;
    }
    await applyAutoPull(safeChanged);
  } catch (e) {
    if (e.name === "AuthError") setSyncIndicator("● Not authenticated", "var(--red)");
  } finally {
    _autoRefreshing = false;
  }
}

// Pull the given sheet tabs, advance revs, re-render, flash a confirmation.
async function applyAutoPull(sheetNames) {
  if (!sheetNames || !sheetNames.length) return;
  const pullPromise = timed("pull", `pull ${sheetNames.join(",")}`, () => API.pullTabs(sheetNames), true);
  setPullInFlight(pullPromise);
  try { await pullPromise; } catch (e) { return; }
  _lastSyncedAt = Date.now();
  refreshSyncIndicator();
  if (typeof render === "function") render();
  flashUpdatedIndicator();
}

function flashUpdatedIndicator() {
  setSyncIndicator("● Updated just now", "var(--green)");
  setTimeout(() => refreshSyncIndicator(), 3000);
}

// ── Non-destructive "newer data available" banner ───────────
let _bannerPendingTabs = null;
function ensureBannerEl() {
  let el = document.getElementById("sync-banner");
  if (el) return el;
  el = document.createElement("div");
  el.id = "sync-banner";
  el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9999;display:none;" +
    "align-items:center;gap:12px;background:var(--surface,#1c2128);color:var(--text,#e6edf3);" +
    "border:1px solid var(--accent,#58A6FF);border-radius:8px;padding:10px 14px;font-size:13px;" +
    "box-shadow:0 6px 24px rgba(0,0,0,.4);max-width:92vw";
  document.body.appendChild(el);
  return el;
}

// Generic banner: message + optional action button + dismiss. Used for both
// "newer data — refresh" and the bulk-replace "redo your change" notice.
function showSyncBanner(message, actionLabel, onAction) {
  const el = ensureBannerEl();
  el.innerHTML = "";
  const msg = document.createElement("span");
  msg.textContent = message;
  el.appendChild(msg);
  if (actionLabel) {
    const act = document.createElement("button");
    act.className = "btn btn-primary";
    act.style.cssText = "font-size:12px;padding:4px 10px";
    act.textContent = actionLabel;
    act.onclick = () => { hideSyncBanner(); if (onAction) onAction(); };
    el.appendChild(act);
  }
  const x = document.createElement("button");
  x.className = "btn";
  x.style.cssText = "font-size:12px;padding:4px 8px";
  x.textContent = "✕";
  x.onclick = hideSyncBanner;
  el.appendChild(x);
  el.style.display = "flex";
}
function hideSyncBanner() {
  const el = document.getElementById("sync-banner");
  if (el) el.style.display = "none";
}

// "Newer data available — Refresh". Stashes the changed tabs so the manual
// Refresh click pulls exactly those (only once the modal is closed and the
// edits are no longer dirty for them).
function showNewerDataBanner(changedTabs) {
  _bannerPendingTabs = changedTabs.slice();
  showSyncBanner(`Newer data available (${changedTabs.join(", ")}).`, "Refresh", async () => {
    if (isModalOpen()) { showSyncBanner("Close the open form first, then Refresh.", "Refresh", () => showNewerDataBanner(_bannerPendingTabs || changedTabs)); return; }
    await applyAutoPull(_bannerPendingTabs || changedTabs);
    _bannerPendingTabs = null;
  });
}

// Banner for tabs with unsynced local edits that also changed elsewhere.
// "Sync now" pushes the local edits — the server OCC-merges with newer rows.
function showDirtyConflictBanner(tabs) {
  showSyncBanner(`Unsynced edits to ${tabs.join(", ")} also changed on another device.`, "Sync now", () => retryAllDirty());
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (document.visibilityState === "visible") {
    const every = _relaxed ? AUTO_REFRESH_IDLE_MS : AUTO_REFRESH_MS;   // P4-1
    _autoRefreshTimer = setInterval(() => autoRefreshTick("interval"), every);
  }
}
function stopAutoRefresh() {
  if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
}

// Wire timer + events. Backgrounded tabs make ZERO calls (timer stopped on
// hide); returning to a tab fires an immediate check so a stale tab self-heals.
// Guarded so the post-login + bootstrap paths don't double-register listeners.
function initAutoRefresh() {
  if (_autoRefreshInited) { startAutoRefresh(); return; }
  _autoRefreshInited = true;
  // P4-1: returning to the tab is the clearest "the user is here again" signal —
  // drop back to the responsive cadence before the tick, so startAutoRefresh()
  // below arms the 20s interval rather than re-arming the relaxed one.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { resetPollCadence(); autoRefreshTick("visible"); startAutoRefresh(); }
    else stopAutoRefresh();
  });
  window.addEventListener("focus", () => { resetPollCadence(); autoRefreshTick("focus"); });
  window.addEventListener("online", () => { resetPollCadence(); autoRefreshTick("online"); });
  startAutoRefresh();
}

// Threshold for the "many tabs changed" fallback below (item 7, P1-1 spec).
// Updated post-P2-1: pullTabs now batches 2+ tabs into ONE readTabs request
// instead of N parallel per-tab GETs, so this is no longer guarding against a
// burst of round trips on the happy path. Two things it still guards:
//   - With most/all ~12 tracked tabs changed at once (a device closed for
//     days, or a freshly reseeded sandbox), a single readTabs response
//     carrying that many tabs' full row data approaches the size/cost of a
//     plain readAll anyway — past this many tabs there's no longer a real win
//     over just doing the full pull, so we simplify to that instead.
//   - Against a backend that hasn't been redeployed with P2-1 yet, pullTabs
//     silently falls back to the OLD per-tab-GET loop (see api.js) — for that
//     path this threshold still caps how large a burst of parallel per-tab
//     GETs a not-yet-redeployed backend can be hit with.
// Not used anywhere else — purely a launch-path circuit breaker.
const LAUNCH_PARTIAL_PULL_MAX_TABS = 4;

// Full-pull fallback shared by every case that needs one (no rev baseline,
// revCheck unsupported/failed, or too many tabs changed). Wraps
// setPullInFlight so the write queue's never-push-against-stale-STATE
// guarantee holds on this path exactly like it does for pullAndRender's
// cold-cache full pull (main.js).
async function fullLaunchPull(reason) {
  const pullPromise = timed("pull", "pull ALL (launch)", () => API.pullAll(), true);
  setPullInFlight(pullPromise);
  const data = await pullPromise;
  _lastSyncedAt = Date.now();
  refreshSyncIndicator();
  syncLog(`Auto-sync on launch: full pull from ${data.sheetName} (${reason})`, "var(--green)");
  if (typeof render === "function") render();
}

async function autoSyncOnLaunch() {
  if (!STATE.authToken) {
    setSyncIndicator("● Not authenticated", "var(--red)");
    return;
  }
  setSyncIndicator("● Syncing…", "var(--orange)");
  try {
    // INCREMENTAL launch sync: if we have a revision baseline from the cache,
    // do a cheap revCheck and pull ONLY changed tabs (in parallel) instead of a
    // full readAll. Falls back to a full pull when there's no baseline (first
    // run / old cache), the backend lacks revCheck, or too many tabs changed
    // at once (item 7 — see LAUNCH_PARTIAL_PULL_MAX_TABS above).
    const hasBaseline = STATE.rev && Object.keys(STATE.rev).length > 0;
    if (hasBaseline) {
      const res = await timed("revCheck", "revCheck (launch)", () => API.revCheck());
      _lastCheckedAt = Date.now();
      if (res && !res.error && res.revs) {
        const revChanged = Object.keys(res.revs).filter(s => Number(res.revs[s]) > Number(STATE.rev[s] || 0));
        const changed = [...new Set(revChanged.concat(rsApplyScopeKey(res)))];

        if (changed.length === 0) {
          _lastSyncedAt = Date.now();
          refreshSyncIndicator();
          syncLog("Launch: already up to date ✓", "var(--green)");
          return;
        }

        // Item 7: many tabs changed → one full pullAll instead of N per-tab GETs.
        if (changed.length > LAUNCH_PARTIAL_PULL_MAX_TABS) {
          await fullLaunchPull(`${changed.length} tabs changed (> ${LAUNCH_PARTIAL_PULL_MAX_TABS} threshold)`);
          return;
        }

        // Item 5 (MANDATORY dirty-tab guard): a tab with unsynced local edits
        // from a prior session that ALSO changed on the server must NEVER be
        // pulled over here — this is exactly the PR #67 clobber class, now
        // reachable on the launch path too. Pulling it would replace
        // STATE[arrKey] with server rows BEFORE maybeRestoreDirty gets a
        // chance to offer a replay, and after a reload _dirtyOps is empty, so
        // the eventual retryAllDirty falls back to a full replace sourced
        // from the very array the pull just clobbered — the user's edit is
        // silently gone. Mirrors autoRefreshTick's dirtyChanged/safeChanged
        // split (sync.js ~706-719): leave the dirty tab's rev at its stale
        // baseline (so the pending replay still OCC-merges) and let the
        // dirty-conflict banner / maybeRestoreDirty prompt handle it instead.
        const dirty = STATE.dirty || new Set();
        const dirtyChanged = changed.filter(t => dirty.has(t));
        const safeChanged = changed.filter(t => !dirty.has(t));
        if (dirtyChanged.length) showDirtyConflictBanner(dirtyChanged);

        // Item 6 (MANDATORY isModalOpen guard): a person card can already be
        // open within a second or two of first paint — warm-cache launch
        // renders instantly from cache, and this revCheck resolves shortly
        // after. Never re-render (chart teardown + #content scroll reset) out
        // from under an open form; banner instead, same guard the 20s poller
        // uses (autoRefreshTick).
        if (safeChanged.length && isModalOpen()) {
          showNewerDataBanner(safeChanged);
          _lastSyncedAt = Date.now();
          refreshSyncIndicator();
          return;
        }

        if (safeChanged.length) {
          await applyAutoPull(safeChanged);   // parallel partial pulls + render + timing
          syncLog(`Launch: refreshed ${safeChanged.length} changed tab${safeChanged.length === 1 ? "" : "s"} (${safeChanged.join(", ")})`, "var(--green)");
        } else {
          // Nothing safe to pull — either everything changed was dirty-guarded
          // (banner already shown above) or there was nothing left to do.
          _lastSyncedAt = Date.now();
          refreshSyncIndicator();
        }
        return;
      }
      // else: revCheck unsupported/failed → fall through to a full pull, but
      // say so accurately (there WAS a baseline — revCheck itself is what
      // came back empty/erroring) rather than reusing the "no rev baseline"
      // message, which would be misleading in the sync log.
      await fullLaunchPull("revCheck unavailable");
      return;
    }
    await fullLaunchPull("no rev baseline");
  } catch (e) {
    if (e.name === "AuthError") {
      setSyncIndicator("● Not authenticated", "var(--red)");
      syncLog(`Auth rejected — your invite may have been revoked. Ask admin for a new link.`, "var(--red)");
      // Bounce to the login screen exactly like the cold-cache path
      // (pullAndRender's catch → handleAuthFailure, main.js) — an expired or
      // revoked token must not just leave the warm-cache render sitting there
      // with a "not authenticated" pill; the user needs to sign back in.
      // typeof-guarded: handleAuthFailure lives in main.js, which the
      // sync-core-only test harness (makeClient) doesn't load.
      if (typeof handleAuthFailure === "function") handleAuthFailure();
    } else {
      setSyncIndicator("● Sync failed", "var(--red)");
      syncLog(`Auto-sync failed: ${e.message}`, "var(--red)");
    }
  }
}
