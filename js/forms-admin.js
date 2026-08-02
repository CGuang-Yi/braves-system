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
    const res = await API.addAccount(email, personId, role, pw);
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
