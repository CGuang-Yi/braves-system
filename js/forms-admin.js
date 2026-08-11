// Polar photo AI import, backup import, and the account / auth forms (addendum A1).
//
// Split out of the original monolithic forms.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// ─── POLAR PHOTO IMPORT (AI extract) ───────────────────
// Drop / pick photos of Polar class summary screens — group them by
// conduct so the conduct + date + time are entered once per conduct,
// not per photo. Batch-analyze via Claude (proxied through Apps Script).
// Each photo → many recruit rows appended to STATE.polar + pushed to the
// sheet via appendMany. No inline review (per user choice).

let _polarStagedGroups = [];  // [{id, conduct, date, time, photos: [{id, dataUrl, base64, mediaType, status, added?, notes?}]}]
let _polarGroupCounter = 0;
let _polarPhotoCounter = 0;

// Down-sample an image File to <500KB JPEG via canvas. Anthropic accepts
// up to 5MB/image but smaller payloads = faster round-trips + cheaper.
function resizeImageForUpload(file, maxWidth = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        // Return both the full data URL (for preview) and the bare base64
        // (for API payload — backend strips the data: prefix anyway).
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Add an empty conduct group. Date defaults to today; time auto-fills
// when the user types/picks a conduct name (via inferTimeForConduct).
function addPolarGroup() {
  _polarStagedGroups.push({
    id: ++_polarGroupCounter,
    conductId: "",
    date: todayISO(),
    time: "",
    photos: []
  });
  render();
}

function removePolarGroup(id) {
  _polarStagedGroups = _polarStagedGroups.filter(g => g.id !== id);
  render();
}

// Inline edit handler from the group card. When conductId changes, auto-fill
// both date and time from historical data so the user doesn't have to
// re-enter them. Date prefers the most-recent attendance/detail entry for
// the conduct that doesn't yet have polar coverage (i.e. the session the
// user is probably importing photos for); time uses the most-frequently-
// logged time across conductDetail + polar. The user can still override
// either field manually after.
function updatePolarGroup(id, field, value) {
  const g = _polarStagedGroups.find(g => g.id === id);
  if (!g) return;
  g[field] = value;
  if (field === "conductId" && value) {
    let touched = false;
    const inferredDate = inferDateForConduct(value);
    if (inferredDate) { g.date = inferredDate; touched = true; }
    if (!g.time) {
      const inferredTime = inferTimeForConduct(value);
      if (inferredTime) { g.time = inferredTime; touched = true; }
    }
    if (touched) render();
  }
}

// Add photos to a specific group. Resizes each to <500KB JPEG for upload.
async function addPolarPhotosToGroup(groupId, files) {
  const g = _polarStagedGroups.find(x => x.id === groupId);
  if (!g || !files || !files.length) return;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const { dataUrl, base64, mediaType } = await resizeImageForUpload(file);
      g.photos.push({
        id: ++_polarPhotoCounter,
        dataUrl, base64, mediaType,
        status: "ready"
      });
    } catch (e) {
      alert("Couldn't read " + file.name + ": " + e.message);
    }
  }
  render();
}

function removePolarPhotoFromGroup(groupId, photoId) {
  const g = _polarStagedGroups.find(x => x.id === groupId);
  if (!g) return;
  g.photos = g.photos.filter(p => p.id !== photoId);
  render();
}

async function analyzeAndPushPolarPhotos() {
  // Flatten groups into a queue while validating each group has the
  // required conduct + date set. Empty groups (no photos yet) are silently
  // skipped — user might be staging an upcoming conduct.
  const queue = [];
  _polarStagedGroups.forEach(g => {
    if (!g.photos.length) return;
    g.photos.forEach(p => queue.push({ group: g, photo: p }));
  });
  if (!queue.length) {
    alert("Add at least one photo to a conduct group before analyzing.");
    return;
  }
  const missingConduct = _polarStagedGroups.filter(g => g.photos.length && !g.conductId);
  if (missingConduct.length) {
    alert(`Pick a conduct on ${missingConduct.length} group(s) before analyzing.`);
    return;
  }

  // Pre-build the valid-d4 list once (recruits only — commanders don't
  // appear in Polar class summary screens).
  const validD4s = STATE.roster
    .filter(r => r.role !== "Commander")
    .map(r => String(r.id).replace(/^C/i, ""));

  const progress = document.getElementById("polar-analyze-progress");
  if (progress) progress.style.display = "block";

  const newRows = [];
  const errors = [];
  let added = 0;
  const totalPhotos = queue.length;

  for (let i = 0; i < queue.length; i++) {
    const { group, photo } = queue[i];
    const groupName = conductName(group.conductId);
    if (progress) progress.innerHTML = `Analyzing ${i + 1}/${totalPhotos} — <strong>${escapeAttr(groupName)}</strong><br><span style="color:var(--muted)">${added} rows added · ${errors.length} errors</span>`;
    photo.status = "analyzing";
    try {
      const res = await API.analyzePhoto(photo.base64, photo.mediaType, validD4s);
      if (res.error) {
        errors.push({ photo: `${groupName} (photo ${i + 1})`, error: res.error });
        photo.status = "error";
        continue;
      }
      const dateDisplay = isoToDisplayDate(group.date);
      const time = pad4Time(group.time || "0730");
      let photoAdded = 0;
      let unverifiedCount = 0;
      (res.recruits || []).forEach(r => {
        const d4 = padD4(String(r.d4 || "").replace(/^C/i, ""));
        if (!d4) return;
        if (r.unverified) unverifiedCount++;
        const entry = {
          id: nextId(),
          d4,
          conductId: group.conductId,
          date: dateDisplay,
          time,
          avgHr: r.avgHR ?? "",
          maxHr: r.maxHR ?? "",
          minHr: "",
          calories: r.calories ?? "",
          trainingLoad: "",
          recovery: "",
          duration: r.duration ?? "",
          distance: ""
        };
        STATE.polar.push(entry);
        newRows.push(entry);
        added++;
        photoAdded++;
      });
      photo.status = "done";
      photo.added = photoAdded;
      photo.unverified = unverifiedCount;
      // Truncation warning: when Claude's self-reported rowCount exceeds the
      // actual extracted recruits, the model dropped rows mid-output (usually
      // long photos). Surface so the user can re-run or accept partial.
      if (res.rowCount != null && +res.rowCount > photoAdded) {
        const missing = +res.rowCount - photoAdded;
        errors.push({
          photo: `${groupName} (photo ${i + 1})`,
          error: `⚠️ Truncated extraction — Claude counted ${res.rowCount} rows in the photo but only extracted ${photoAdded}. ${missing} row${missing === 1 ? "" : "s"} likely missing. Re-run the analysis (Claude may extract differently) or check the photo manually.`
        });
      }
      if (res.notes) photo.notes = res.notes;
    } catch (e) {
      errors.push({ photo: `${groupName} (photo ${i + 1})`, error: e.message });
      photo.status = "error";
    }
  }

  const lmsChanged = recomputeAttendanceLmsFromPolar();
  saveLocal();

  // Push to sheet in one batch. appendMany only sends new rows — much
  // cheaper than the full pushTab(PolarFlow, STATE.polar) round-trip.
  let sheetPushed = false;
  if (newRows.length && STATE.apiUrl) {
    try {
      await API.post({ action: "appendMany", tab: "PolarFlow", rows: newRows, baseRev: STATE.rev["PolarFlow"] });
      sheetPushed = true;
    } catch (e) {
      errors.push({ photo: "(sheet push)", error: e.message });
    }
  }
  // Persist any attendance LMS changes the new polar rows triggered. Per-row
  // upsert (OCC-safe) so a concurrent attendance edit on another device isn't
  // clobbered — previously these LMS changes were never pushed at all.
  if (STATE.apiUrl) lmsChanged.forEach(row => autoSync("Attendance", { type: "upsert", row }));

  // Summary modal — shows what happened, plus any per-photo errors.
  const errorList = errors.length
    ? `<div style="margin-top:12px"><div style="font-size:11px;color:var(--red);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Errors (${errors.length})</div>${errors.map(e => `<div style="font-size:11px;padding:4px 8px;background:#F8514922;border-left:2px solid var(--red);border-radius:3px;margin-bottom:3px"><strong>${escapeAttr(e.photo)}:</strong> ${escapeAttr(e.error)}</div>`).join("")}</div>`
    : "";
  openModal("📸 Photo analysis complete", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="stats-row">
        <div class="stat"><label>Photos processed</label><div class="val">${totalPhotos}</div></div>
        <div class="stat"><label>Rows added</label><div class="val" style="color:var(--green)">${added}</div></div>
        <div class="stat"><label>Errors</label><div class="val" style="color:${errors.length ? 'var(--red)' : 'var(--muted)'}">${errors.length}</div></div>
      </div>
      <div style="font-size:12px;color:var(--muted)">
        ${sheetPushed ? "✓ New rows pushed to the <strong>PolarFlow</strong> sheet." : (newRows.length ? "⚠ Rows added locally but sheet push failed — use <strong>Push All to Sheet</strong> to retry." : "Nothing pushed.")}
      </div>
      ${errorList}
      <button class="btn btn-primary" onclick="closePolarAnalysisModal()">Done</button>
    </div>
  `);
}

// Closes the modal AND clears the staging list (the photos have been
// processed; user gets a clean drop zone).
function closePolarAnalysisModal() {
  _polarStagedGroups = [];
  closeModal();
  render();
}

function importBackup(input) {
  // Admin-only (RBAC): restoring a full backup. UI is .admin-only; this guard
  // covers programmatic calls; the backend re-checks via the `imported` flag.
  if (!isAdminRole()) { input.value = ""; alert("Admin only — restoring a backup is restricted to admin accounts."); return; }
  const reader = new FileReader();
  reader.onload = e => { try {
    const d = JSON.parse(e.target.result);
    if (d.roster) STATE.roster = d.roster;
    if (d.medical) STATE.medical = d.medical;
    if (d.attendance) STATE.attendance = d.attendance;
    if (d.ippt) STATE.ippt = d.ippt;
    if (d.rm) STATE.rm = d.rm;
    if (d.soc) STATE.soc = d.soc;
    if (d.polar) STATE.polar = d.polar;
    if (d.conductDetail) STATE.conductDetail = d.conductDetail;
    if (d.appointments) STATE.appointments = d.appointments;
    if (d.leave) STATE.leave = d.leave;
    if (d.msk) STATE.msk = d.msk;
    saveLocal(); render();
  } catch (err) { alert("Import failed: " + err.message); } };
  reader.readAsText(input.files[0]); input.value = "";
}

// ═══════════════════════════════════════════════════════
// ACCOUNT / AUTH FORMS  (Step 1 — addendum A1)
// ═══════════════════════════════════════════════════════
// All of these talk to the role-gated backend; the server is the real authority.
// The admin-only forms still appear behind .admin-only + isAdminRole() so a
// non-admin never sees them, but the backend rejects them regardless.

// ── Change own password (any signed-in role) ─────────────
function openChangePasswordForm() {
  openModal("Change Password", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <label class="form-label">Current password<input type="password" id="cp-current" class="form-input" autocomplete="current-password"></label>
      <label class="form-label">New password (min 6)<input type="password" id="cp-new" class="form-input" autocomplete="new-password"></label>
      <label class="form-label">Confirm new password<input type="password" id="cp-confirm" class="form-input" autocomplete="new-password"></label>
      <div id="cp-error" style="color:var(--red);font-size:12px;min-height:16px"></div>
      <button class="btn btn-primary" onclick="submitChangePassword()">Update Password</button>
    </div>`);
}
async function submitChangePassword() {
  const cur = document.getElementById("cp-current").value;
  const nw = document.getElementById("cp-new").value;
  const cf = document.getElementById("cp-confirm").value;
  const err = document.getElementById("cp-error");
  err.textContent = "";
  if (nw.length < 6) { err.textContent = "New password must be at least 6 characters."; return; }
  if (nw !== cf) { err.textContent = "New passwords do not match."; return; }
  try {
    const res = await API.changePassword(cur, nw);
    if (res && res.ok) { closeModal(); alert("Password updated."); }
    else err.textContent = (res && res.error) || "Could not change password.";
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    err.textContent = "Network error: " + e.message;
  }
}

// ── Add account (admin) ──────────────────────────────────
function openAddAccountForm() {
  openModal("Add Account", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <label class="form-label">Email<input type="email" id="aa-email" class="form-input" placeholder="pc1@unit.mil"></label>
      <label class="form-label">PersonID (Roster 4D, optional)<input type="text" id="aa-personid" class="form-input" placeholder="e.g. 0012"></label>
      <label class="form-label">Role
        <select id="aa-role" class="form-input">
          <option value="viewer">viewer — read-only</option>
          <option value="commander" selected>commander — can edit</option>
          <option value="admin">admin — full control</option>
        </select>
      </label>
      <label class="form-label">Temporary password (min 6)<input type="text" id="aa-password" class="form-input" placeholder="they change it after first login"></label>
      <label class="form-label" style="flex-direction:row;align-items:center;gap:8px">
        <input type="checkbox" id="aa-cap-duty"> Can plan duties
      </label>
      <div id="aa-error" style="color:var(--red);font-size:12px;min-height:16px"></div>
      <button class="btn btn-primary" onclick="submitAddAccount()">Create Account</button>
    </div>`);
}
async function submitAddAccount() {
  const email = document.getElementById("aa-email").value.trim();
  const personId = document.getElementById("aa-personid").value.trim();
  const role = document.getElementById("aa-role").value;
  const pw = document.getElementById("aa-password").value;
  const err = document.getElementById("aa-error");
  err.textContent = "";
  if (!email || pw.length < 6) { err.textContent = "Email and a 6+ char password are required."; return; }
  try {
    const caps = document.getElementById("aa-cap-duty")?.checked ? "duty" : "";
    const res = await API.addAccount(email, personId, role, pw, caps);
    if (res && res.ok) {
      closeModal();
      if (res.warning) alert("Account created.\n\nNote: " + res.warning);
      refreshAdminData();
    } else err.textContent = (res && res.error) || "Could not create account.";
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    err.textContent = "Network error: " + e.message;
  }
}

// ── Remove account (admin) ───────────────────────────────
async function doRemoveAccount(emailEnc) {
  const email = decodeURIComponent(emailEnc);
  if (!confirm(`Remove the account for ${email}?\n\nThis deletes the account and signs out all of their devices.`)) return;
  try {
    const res = await API.removeAccount(email);
    if (res && res.ok) refreshAdminData();
    else alert((res && res.error) || "Could not remove account.");
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    alert("Network error: " + e.message);
  }
}

// ── Edit an account's capabilities (admin) ───────────────
// Capabilities, not roles — see DUTY_LIST_SPEC.md §9 and hasCap() in state.js.
// This was a single duty toggle until report-sick scoping added a second and
// third capability; a toggle that submitted `"duty"` or `""` would have silently
// wiped an account's rs grants on every use, because setAccountCaps REPLACES the
// whole caps cell rather than merging into it.
//
// The full set is submitted every time, which is why the editor must render the
// account's CURRENT caps as its initial state — anything it fails to show, it
// erases.
function openCapsEditor(emailEnc) {
  const email = decodeURIComponent(emailEnc);
  const acct = (STATE.accounts || []).find(a => String(a.email || "").toLowerCase() === email.toLowerCase());
  if (!acct) { alert("Account not found — refresh the admin panel."); return; }
  const caps = (acct.caps || []).map(c => String(c).toLowerCase());
  const hasDuty = caps.indexOf("duty") !== -1;
  const hasCompanyRS = caps.indexOf("rs:company") !== -1;
  // Stored lowercased by the backend's parseCaps; platoon codes are uppercase.
  const grantedPlts = caps.filter(c => c.indexOf("rs:plt:") === 0).map(c => c.slice(7).toUpperCase());

  const pltBoxes = activePlatoons().map(p => `
    <label style="display:inline-flex;align-items:center;gap:5px;margin:0 10px 6px 0;font-size:12px">
      <input type="checkbox" class="caps-plt" value="${escapeAttr(p.code)}"${grantedPlts.indexOf(String(p.code).toUpperCase()) !== -1 ? " checked" : ""}>
      ${escapeHTML(p.displayName || p.code)}
    </label>`).join("");

  openModal(`Capabilities — ${email}`, `
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
      Capabilities sit alongside the role. This account is a <strong>${escapeHTML(acct.role || "")}</strong>.
    </div>

    <label style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <input type="checkbox" id="caps-duty"${hasDuty ? " checked" : ""}> Duty planning
    </label>

    <div style="border-top:1px solid var(--border);padding-top:10px">
      <div style="font-weight:600;font-size:12px;margin-bottom:6px">Report sick history</div>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <input type="checkbox" id="caps-rs-company"${hasCompanyRS ? " checked" : ""}> Whole company
      </label>
      <div id="caps-plt-wrap" style="${hasCompanyRS ? "opacity:.45;pointer-events:none" : ""}">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">…or specific platoons:</div>
        ${pltBoxes || '<div style="font-size:11px;color:var(--muted)">No platoons on the roster yet.</div>'}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">
        With none of these set, the account sees only its own platoon (resolved from the roster).
      </div>
    </div>

    <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:10px;font-size:11px;color:var(--muted)">
      Capabilities apply at that account's <strong>next login</strong>. Widening takes effect when
      they sign in again; to narrow someone <strong>immediately</strong>, revoke their sessions as well.
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn" onclick="doRevokeSessionsFor('${encodeURIComponent(email)}')">Revoke sessions</button>
      <button class="btn btn-success" onclick="doSaveAccountCaps('${encodeURIComponent(email)}')">Save</button>
    </div>
  `);

  // rs:company supersedes the per-platoon grants; letting both be set would
  // produce a cap string that reads as more specific than it actually is.
  document.getElementById("caps-rs-company").addEventListener("change", e => {
    const wrap = document.getElementById("caps-plt-wrap");
    wrap.style.opacity = e.target.checked ? ".45" : "";
    wrap.style.pointerEvents = e.target.checked ? "none" : "";
  });
}

async function doSaveAccountCaps(emailEnc) {
  const email = decodeURIComponent(emailEnc);
  const caps = [];
  if (document.getElementById("caps-duty").checked) caps.push("duty");
  if (document.getElementById("caps-rs-company").checked) {
    caps.push("rs:company");
  } else {
    document.querySelectorAll(".caps-plt:checked").forEach(el => caps.push("rs:plt:" + el.value));
  }
  const capsCsv = caps.join(",");
  try {
    const res = await API.setAccountCaps(email, capsCsv);
    // The backend returns {error} inside a 200 — an unknown capability lands
    // here, not in a catch.
    if (!res || res.error) { alert((res && res.error) || "Could not update capabilities."); return; }
    closeModal();
    syncLog(`Capabilities for ${email}: ${capsCsv || "(none)"}`, "var(--green)");
    refreshAdminData();
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    alert("Network error: " + e.message);
  }
}

// The other half of the next-login caveat: without this, narrowing a grant does
// nothing to a device that is already signed in.
async function doRevokeSessionsFor(emailEnc) {
  const email = decodeURIComponent(emailEnc);
  if (!confirm(`Revoke every active session for ${email}?\n\nThey will have to sign in again, which is what makes a narrowed capability apply immediately.`)) return;
  try {
    const res = await API.revokeAllForEmail(email);
    if (!res || res.error) { alert((res && res.error) || "Could not revoke sessions."); return; }
    syncLog(`Revoked all sessions for ${email}`, "var(--orange)");
    refreshAdminData();
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    alert("Network error: " + e.message);
  }
}

// ── Admin reset another account's password ───────────────
function openResetPasswordForm(emailEnc) {
  const email = decodeURIComponent(emailEnc);
  openModal("Reset Password", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <p style="font-size:12px;color:var(--muted)">Set a temporary password for <strong>${escapeHTML(email)}</strong>. They should change it after logging in.</p>
      <label class="form-label">Temporary password (min 6)<input type="text" id="rp-password" class="form-input"></label>
      <div id="rp-error" style="color:var(--red);font-size:12px;min-height:16px"></div>
      <button class="btn btn-primary" onclick="submitResetPassword('${encodeURIComponent(email)}')">Set Password</button>
    </div>`);
}
async function submitResetPassword(emailEnc) {
  const email = decodeURIComponent(emailEnc);
  const pw = document.getElementById("rp-password").value;
  const err = document.getElementById("rp-error");
  err.textContent = "";
  if (pw.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }
  try {
    const res = await API.adminResetPassword(email, pw);
    if (res && res.ok) { closeModal(); alert(`Password reset for ${email}.`); }
    else err.textContent = (res && res.error) || "Could not reset password.";
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    err.textContent = "Network error: " + e.message;
  }
}

// ═══════════════════════════════════════════════════════
// ORD DEPROVISIONING  (BACKEND_MIGRATION_REVIEW.md §4.6 item 4 / §4.7.7)
// ═══════════════════════════════════════════════════════
// The mechanism to remove a departed member's access already existed
// (removeAccount → revokeAllTokensForEmail); what did not exist was any LINK
// from "this person has ORD'd" to "therefore revoke their access". Nothing
// prompted, nothing reconciled, so an ORD'd member simply kept their account.
//
// This is the reconcile-on-load half, which the review calls sufficient on its
// own: every account whose personId maps to a departed roster row is surfaced in
// the admin panel with a one-click removal. The other half the review sketches —
// prompt at the moment the status changes — has no hook in this app, because
// roster status is not editable in the UI at all; departures are entered
// directly in the Sheet. Reconciliation is therefore the ONLY place the link can
// live here, which is also why it must be visible rather than buried.
//
// Note the ordering dependency the review flags (§4.7.7 point 3): removing the
// account is bounded by the token lifetime, not by the removal — a live session
// keeps working until its token expires. That is why SESSION_TTL_MS went from 30
// days to 7 in the same change; removeAccount also revokes tokens outright, so
// the residual window applies only to accounts an admin has not yet actioned.
function departedAccounts() {
  if (typeof BP_DEPARTED_STATUSES === "undefined") return [];
  return (STATE.accounts || []).map(a => {
    const pid = a.personId ? padD4(a.personId) : "";
    if (!pid) return null;
    const person = STATE.roster.find(r => r.id === pid);
    if (!person) return null;
    const status = String(person.status || "").trim();
    if (!BP_DEPARTED_STATUSES.has(status)) return null;
    return { email: a.email, personId: pid, name: person.name || "", status };
  }).filter(Boolean);
}

// ═══════════════════════════════════════════════════════
// RETENTION  (BACKEND_MIGRATION_REVIEW.md §4.6 item 6 / §4.5)
// ═══════════════════════════════════════════════════════
// "Nothing purges departed personnel" — the system knows perfectly well who has
// ORD'd and keeps their medical history forever anyway. The policy implemented
// here, in full:
//
//   Health and availability records (Medical, MSK, Appointments, Leave) for a
//   person whose roster status is a departure are deleted once RETENTION_DAYS
//   have passed with no activity. The Roster row itself is KEPT — it is what
//   lets the app badge historical records as belonging to a departed member, it
//   is the smallest possible remnant, and deleting it would orphan every
//   aggregate that references the 4D. Fitness records (IPPT/RM/SOC/Polar) are
//   also kept: they are unit performance history, not health data.
//
// The retention clock is DAYS SINCE THE PERSON'S MOST RECENT DATED RECORD, not
// days since departure — because there is no departure-date column anywhere in
// the schema (see the Roster header comment in apps-script-Code.gs) and adding
// one would need a bravesMigrateSchema() run plus manual backfill for everyone
// who has already left. Last activity is a conservative proxy: it can only ever
// be LATER than the real departure, so it never purges early. If a departure
// date is added to the schema later, switch this to use it.
const RETENTION_DAYS = 90;

// Every dated health/availability row for a 4D, tagged with its tab so the purge
// can dispatch deletes per tab. Kept as one list so the review UI and the purge
// cannot disagree about scope.
function retentionRowsFor(d4) {
  const pick = (arr, tab) => (arr || []).filter(r => r.d4 === d4).map(r => ({ tab, row: r }));
  return [].concat(
    pick(STATE.medical, "Medical"),
    pick(STATE.msk, "MSK"),
    pick(STATE.appointments, "Appointments"),
    pick(STATE.leave, "Leave")
  );
}

// Any date-ish field on a row, as an ISO string. Rows carry dates in several
// shapes ("17 May 2026" from Sheets, ISO from forms) and under several names,
// so this is deliberately permissive — the cost of missing a date is that the
// person looks MORE recently active than they are, i.e. purged later, which is
// the safe direction to be wrong in.
function retentionRowLatestISO(row) {
  const fields = ["date", "startDate", "endDate", "start", "end", "reviewDate", "injuryDate"];
  let latest = "";
  fields.forEach(f => {
    const v = row[f];
    if (!v) return;
    const iso = /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10)
      : (typeof displayDateToISO === "function" ? displayDateToISO(v) : "");
    if (iso && iso > latest) latest = iso;
  });
  return latest;
}

// Departed people who still hold purgeable records, newest-activity first.
// `overdue` is the subset the purge acts on.
function retentionCandidates() {
  if (typeof BP_DEPARTED_STATUSES === "undefined") return [];
  const today = todayISO();
  return (STATE.roster || [])
    .filter(p => BP_DEPARTED_STATUSES.has(String(p.status || "").trim()))
    .map(p => {
      const rows = retentionRowsFor(p.id);
      let lastActivity = "";
      rows.forEach(({ row }) => {
        const iso = retentionRowLatestISO(row);
        if (iso && iso > lastActivity) lastActivity = iso;
      });
      const days = lastActivity ? daysBetween(lastActivity, today) : null;
      return {
        id: p.id, name: p.name || "", status: String(p.status || "").trim(),
        count: rows.length, lastActivity, days,
        // No dated row at all → nothing to date it by. Treated as overdue only
        // when there is something to purge, since an undated health record for a
        // departed member is exactly as stale as a very old one.
        overdue: rows.length > 0 && (days === null || days >= RETENTION_DAYS)
      };
    })
    .filter(c => c.count > 0)
    .sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));
}

// Destructive, admin-only, and typed-confirmation gated. Deletes go through the
// ordinary per-row autoSync delete primitive rather than a bulk server call, so
// each one is OCC-guarded and lands in the audit log like any other write —
// a purge should be as reviewable afterwards as it was deliberate beforehand.
async function doRetentionPurge() {
  if (!isAdminRole()) { alert("Admin only."); return; }
  const overdue = retentionCandidates().filter(c => c.overdue);
  if (!overdue.length) { alert("Nothing is past the retention window."); return; }
  const rowTotal = overdue.reduce((n, c) => n + c.count, 0);
  const typed = prompt(
    `Permanently delete ${rowTotal} health record(s) — Medical, MSK, Appointments and Leave — ` +
    `for ${overdue.length} departed personnel with no activity in ${RETENTION_DAYS}+ days?\n\n` +
    `Roster rows and fitness records are kept. This cannot be undone from the app; the Sheet's ` +
    `own version history is the only recovery path.\n\nType PURGE to confirm:`
  );
  if (String(typed || "").trim().toUpperCase() !== "PURGE") return;

  const byTab = { Medical: [], MSK: [], Appointments: [], Leave: [] };
  overdue.forEach(c => retentionRowsFor(c.id).forEach(({ tab, row }) => byTab[tab].push(row.id)));

  const stateKey = { Medical: "medical", MSK: "msk", Appointments: "appointments", Leave: "leave" };
  let deleted = 0;
  Object.keys(byTab).forEach(tab => {
    const ids = new Set(byTab[tab]);
    if (!ids.size) return;
    STATE[stateKey[tab]] = STATE[stateKey[tab]].filter(r => !ids.has(r.id));
    deleted += ids.size;
    if (STATE.apiUrl) ids.forEach(id => autoSync(tab, { type: "delete", id }));
  });
  saveLocal();
  render();
  alert(`Purged ${deleted} record(s) for ${overdue.length} departed personnel.` +
        (STATE.apiUrl ? "\n\nDeletions are queued to the Sheet — watch the sync indicator." : ""));
}

// ── Token / session revocation (admin) ───────────────────
async function doRevokeToken(token, emailEnc) {
  const email = decodeURIComponent(emailEnc || "");
  if (!confirm(`Revoke this session${email ? " for " + email : ""}? That device will be signed out.`)) return;
  try {
    const res = await API.revokeToken(token, email);
    if (res && res.ok) refreshAdminData();
    else alert((res && res.error) || "Could not revoke session.");
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    alert("Network error: " + e.message);
  }
}
async function doRevokeAllTokens() {
  if (!confirm("Revoke ALL sessions, including your own? Everyone (you included) will have to log in again.")) return;
  try {
    const res = await API.revokeAllTokens();
    if (res && res.ok) { alert(`Revoked ${res.revoked} session(s). You will be signed out.`); handleAuthFailure(); }
    else alert((res && res.error) || "Could not revoke sessions.");
  } catch (e) {
    if (e.name === "AuthError") { handleAuthFailure(); return; }
    alert("Network error: " + e.message);
  }
}
