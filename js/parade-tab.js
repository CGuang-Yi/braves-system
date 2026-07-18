// ============================================================================
// PARADE STATE TAB (js/parade-tab.js)
// ----------------------------------------------------------------------------
// A first-class tab (sidebar "Parade State") that replaces the old Dashboard
// "Generate Report → First/Last Parade State" flow. Two views, chosen by the
// scope selector:
//
//   • COMPANY — shows the full company parade-state message in an editable
//     textarea with a Copy button. The text is the canonical §8–9 output
//     (generateBravesParadeState in braves-parade.js) — byte-identical to what
//     the old modal produced; this view only relocates it into the tab.
//
//   • PLATOON — a strength/counts bento header plus a spreadsheet-style grid
//     (4D · Name · Attendance Code · Remarks). The Attendance Code cell is an
//     editable <select>; changing it opens a small prefilled editor that writes
//     the REAL source record (Medical/Leave/Appointment) and mirrors the roster
//     status, so the strength and counts update the same way the rest of the app
//     computes them. A recruit whose MC has ENDED keeps showing as MC (out of
//     camp) until the commander manually changes their code — that persistence
//     now lives in the shared §8 classifier (bpClassifyPerson keys it off the
//     roster-status mirror), so the grid, the copy-paste message and the Telegram
//     bot all agree. MR (Medical Review) is its own code / MR section.
//
// All per-person classification and strength math is reused from braves-parade.js
// (bpPrimaryForDay / bpStrength / bpIsActive / rankGroupOf) — this file is a view
// + a focused write-back helper, not a second source of truth. bp* globals
// resolve at call time (braves-parade.js loads immediately before this file).
// ============================================================================

// ── Tab state (module-level, mirrors render.js's _archiveTab pattern) ────────
let _paradeScope = "company";      // "company" | "platoon:<CODE>"
let _paradeDate = "";              // ISO yyyy-mm-dd; lazily defaulted to today
let _paradeType = "FP";            // "FP" | "LP"
let _paradeTime = "";              // free-text HHMM for the company header

// The editable attendance codes. These map 1:1 to the parade-state sections a
// person can fall into, plus "Present" = in camp, no restriction. MR (Medical
// Review) is its own code and lands in the MR section; it's independent/additive
// (a person can be on LD and go for MR), so setting it does NOT end their other
// statuses — see saveParadeCode.
const PARADE_CODES = ["Present", "MC", "RS", "MR", "AL/OIL", "STATUS", "OTHERS"];

// Parade-grid edit lock (item 5): only these away-codes are editable from the
// grid, and the ONLY change offered is → Present (book-in). Every other code
// (Present, RS, MR, STATUS) renders as read-only text — no new statuses are
// assigned from this tab. See renderParadePlatoon.
const PARADE_EDITABLE_CODES = ["MC", "AL/OIL", "OTHERS"];

// §8 primary-section key → grid code. bpPrimaryForDay's chain is
// REPORTING SICK > ATT C(MC) > AL/OIL > STATUS > OTHERS.
const PARADE_SECTION_TO_CODE = {
  reportingSick: "RS", attC: "MC", alOil: "AL/OIL", status: "STATUS", others: "OTHERS"
};

function paradeCurrentDateISO() { return _paradeDate || todayISO(); }

// ── Control-bar setters (each re-renders only the body, keeping the toolbar) ──
function setParadeScope(v) { _paradeScope = v; refreshParade(); }
function setParadeDate(v) { _paradeDate = v; refreshParade(); }
function setParadeType(v) { _paradeType = v; refreshParade(); }
function setParadeTime(v) { _paradeTime = v; if (_paradeScope === "company") refreshParade(); }

// ── Top-level render ─────────────────────────────────────────────────────────
function renderParade(el) {
  if (!STATE.roster.length) {
    el.innerHTML = `<h2 style="font-size:18px;font-weight:700;margin-bottom:16px">🎖️ Parade State</h2>
      <div class="card empty-state">${STATE.authToken
        ? `<p>Loading data from the sheet…</p>`
        : `<p>No invite redeemed on this device yet. Open an invite link to sync.</p>`}</div>`;
    return;
  }
  const dateIso = paradeCurrentDateISO();
  const scopeOptions = [`<option value="company"${_paradeScope === "company" ? " selected" : ""}>Company (full parade state)</option>`]
    .concat(activePlatoons().map(p => {
      const v = `platoon:${p.code}`;
      return `<option value="${escapeAttr(v)}"${_paradeScope === v ? " selected" : ""}>${escapeAttr(p.displayName || p.code)}</option>`;
    })).join("");

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700">🎖️ Parade State</h2>
    </div>
    <div class="card" style="padding:10px 14px;margin-bottom:14px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--muted)">Scope</label><br>
          <select onchange="setParadeScope(this.value)" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;min-width:220px">${scopeOptions}</select>
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--muted)">Date</label><br>
          <input type="date" value="${escapeAttr(dateIso)}" onchange="setParadeDate(this.value)" style="padding:6px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--muted)">Parade</label><br>
          <select onchange="setParadeType(this.value)" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">
            <option value="FP"${_paradeType === "FP" ? " selected" : ""}>First Parade</option>
            <option value="LP"${_paradeType === "LP" ? " selected" : ""}>Last Parade</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--muted)">Time (company header)</label><br>
          <input type="text" value="${escapeAttr(_paradeTime)}" placeholder="e.g. 0730" maxlength="9" oninput="setParadeTime(this.value)" style="padding:6px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;width:110px">
        </div>
      </div>
    </div>
    <div id="parade-body"></div>`;
  refreshParade();
}

// Re-render just the body (bento + grid, or the company textarea) so editing the
// toolbar controls doesn't rebuild/lose them, and a write-back can refresh the
// figures in place.
function refreshParade() {
  const host = document.getElementById("parade-body");
  if (!host) return;
  if (_paradeScope === "company") renderParadeCompany(host);
  else renderParadePlatoon(host, _paradeScope.slice("platoon:".length));
}

// ── COMPANY VIEW — the canonical §8–9 message, editable + copyable ───────────
// The company message concatenates the aggregate summary + HQ block + one block
// per platoon. Per-platoon copy buttons let a commander grab a single block's
// standalone text (byte-identical to that block inside the full message, since
// both go through bpBuildBlock). The button set mirrors the blocks the message
// actually emits: HQ (always) + each active platoon that has personnel — no
// aggregate/summary button.
function paradeCompanyBlocks() {
  const hasPeople = code => STATE.roster.some(r => personPlatoon(r) === code);
  const out = [{ code: "HQ", label: configGet("hqLabel") || "HQ" }];
  activePlatoons().forEach(p => {
    if (p.code === "HQ" || !hasPeople(p.code)) return;
    out.push({ code: p.code, label: p.displayName || p.code });
  });
  return out;
}

function renderParadeCompany(host) {
  const dateIso = paradeCurrentDateISO();
  const text = generateBravesParadeState({ level: "company" }, _paradeType, dateIso, _paradeTime);
  const blockBtns = paradeCompanyBlocks().map((b, i) =>
    `<button type="button" id="parade-copy-${i}" class="btn" style="font-size:12px"
       onclick="copyParadeBlock('${escapeAttr(b.code)}','parade-copy-${i}')">📋 ${escapeHTML(b.label)}</button>`
  ).join("");
  host.innerHTML = `
    <div class="card" style="padding:14px">
      <textarea id="parade-text" rows="26" spellcheck="false"
        style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.45;resize:vertical;white-space:pre">${escapeHTML(text)}</textarea>
      <button type="button" id="parade-copy-btn" class="btn btn-success" style="margin-top:10px" onclick="copyParadeText()">📋 Copy to Clipboard</button>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-size:11px;color:var(--muted)">Copy per platoon:</span>
        ${blockBtns}
      </div>
    </div>`;
}

// Copy an arbitrary string, with a transient "✓ Copied!" on the given button and
// the same select-and-alert fallback as the old report modal (drops the text into
// the textarea so the user can Cmd+C when the clipboard API is blocked).
async function paradeCopyString(text, btnId) {
  const btn = btnId ? document.getElementById(btnId) : null;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { const o = btn.textContent; btn.textContent = "✓ Copied!"; setTimeout(() => { btn.textContent = o; }, 1800); }
  } catch {
    const ta = document.getElementById("parade-text");
    if (ta) { ta.value = text; ta.focus(); ta.select(); }
    alert("Copy blocked — text is selected, press Cmd+C / Ctrl+C to copy.");
  }
}

// Copy the whole company message (the textarea, which stays editable).
async function copyParadeText() {
  const ta = document.getElementById("parade-text");
  if (!ta) return;
  await paradeCopyString(ta.value, "parade-copy-btn");
  archiveParadeSnapshot(ta.value);
}

// Archive the exact copied parade text (incl. hand edits) so it can be compared
// later in the admin Archive → Compare view. Copy is the "this is what was sent"
// moment. Admin-only (paradeArchive is admin-only) and fire-and-forget — a failed
// or blocked archive must NEVER interfere with the copy. Optimistically prepends
// the row to STATE.paradeArchive so the compare picker sees it immediately;
// deduped so re-copying identical text doesn't pile up rows.
function archiveParadeSnapshot(text) {
  if (!text || typeof isAdminRole !== "function" || !isAdminRole()) return;
  if (!STATE.apiUrl || !STATE.authToken) return;
  const row = {
    timestamp: new Date().toISOString(),
    date: paradeCurrentDateISO(), slot: String(_paradeTime || ""),
    type: _paradeType || "", scope: "company", message: String(text)
  };
  if (paradeSnapshotDup(STATE.paradeArchive, row)) return;
  STATE.paradeArchive = [row, ...(STATE.paradeArchive || [])];
  Promise.resolve(API.archiveNow("parade", { text: row.message, type: row.type, date: row.date, slot: row.slot, scope: row.scope }))
    .catch(() => { /* quiet by design — the copy already succeeded */ });
}

// Copy a single platoon/HQ block's standalone parade-state text. Reads the
// current toolbar state (type/date/time) so it always matches what's shown.
async function copyParadeBlock(code, btnId) {
  const text = generateBravesParadeState({ level: "platoon", platoon: code }, _paradeType, paradeCurrentDateISO(), _paradeTime);
  await paradeCopyString(text, btnId);
}

// ── PLATOON VIEW — bento header + editable grid ──────────────────────────────
// Classify every person in the platoon into a single grid code. The §8 classifier
// (bpPrimaryForDay → bpClassifyPerson) already handles the ENDED-MC persistence
// (roster-status mirror) and everything else, so this is a thin mapping:
//   primary section → code; else an active MR → "MR"; else "Present".
// If someone has BOTH a primary (e.g. LD) and an MR, the primary is the code and
// the MR is shown as a note (matching the message, which lists them in both
// sections). Returns [{ r, code, remark, notInCamp }].
function paradeClassifyPlatoon(people, dateIso) {
  return people.map(r => {
    const p = bpPrimaryForDay(r, dateIso);
    let code, remark, notInCamp = p.notInCamp;
    if (p.primary) {
      code = PARADE_SECTION_TO_CODE[p.primary.key] || "OTHERS";
      remark = p.primary.reason || "";
      if (p.mr) remark = `${remark} · MR: ${p.mr}`;
    } else if (p.mr) {
      code = "MR"; remark = p.mr;
    } else {
      code = "Present"; remark = "";
    }
    return { r, code, remark, notInCamp };
  });
}

function renderParadePlatoon(host, code) {
  const dateIso = paradeCurrentDateISO();
  const people = STATE.roster.filter(r => personPlatoon(r) === code);
  const rows = paradeClassifyPlatoon(people, dateIso).filter(x => bpIsActive(x.r));
  // Strength is the shared §8 computation (bpStrength) so the header always
  // matches the copy-paste message and the rest of the app.
  const s = bpStrength(people, dateIso);
  const grp = g => `${s.groups[g].cur}/${s.groups[g].tot}`;

  // Bento section counts = the exact per-section ENTRY counts the parade message
  // prints, so the header always equals the copy-paste message's section tallies.
  // These can exceed the number of grid rows: a person on LD + MR is one grid row
  // (coded STATUS) but counts in both STATUS and MR here, just as the message
  // lists them in both sections.
  const sec = { alOil: 0, mr: 0, reportingSick: 0, attC: 0, status: 0, others: 0 };
  people.forEach(r => {
    if (!bpIsActive(r)) return;
    const c = bpClassifyPerson(r, dateIso);
    BP_SECTIONS.forEach(k => { sec[k] += c.sections[k].length; });
  });

  // Bento header. First box carries CURRENT/TOTAL together; second carries the
  // three rank groups together; then one box per parade section.
  const bento = `
    <div class="stats-row" style="margin-bottom:12px">
      <div class="stat"><label>Current / Total</label><div class="val"><span style="color:var(--green)">${s.current}</span> <span style="color:var(--dim)">/</span> ${s.total}</div></div>
      <div class="stat"><label>Officer · WOSPEC · Enlistee</label><div class="val" style="font-family:var(--mono);font-size:15px">${grp("Officer")} · ${grp("WOSPEC")} · ${grp("Enlistee")}</div></div>
      <div class="stat"><label>AL/OIL</label><div class="val">${sec.alOil}</div></div>
      <div class="stat"><label>Report Sick</label><div class="val">${sec.reportingSick}</div></div>
      <div class="stat"><label>MR</label><div class="val">${sec.mr}</div></div>
      <div class="stat"><label>MC</label><div class="val" style="color:var(--red)">${sec.attC}</div></div>
      <div class="stat"><label>Status</label><div class="val" style="color:var(--yellow)">${sec.status}</div></div>
      <div class="stat"><label>Others</label><div class="val">${sec.others}</div></div>
    </div>`;

  // Sort: commanders to the BOTTOM rows; everyone else by 4D ascending. Sorting
  // by 4D (not by attendance code) keeps MC / RS / STATUS / etc. personnel in
  // their natural 4D position interleaved with the present bulk, instead of being
  // collected at the top. Commanders carry 00xx 4Ds so ascending-4D would sort
  // them first — force them last so they sit at the bottom (still 4D-ordered among
  // themselves). Name breaks ties (e.g. a commander with no numeric 4D).
  const isCmdr = r => isCommander(r.id);
  const fourDNum = r => { const n = parseInt(String(r.fourD || r.id || "").replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : Infinity; };
  rows.sort((a, b) =>
    ((isCmdr(a.r) ? 1 : 0) - (isCmdr(b.r) ? 1 : 0))
    || (fourDNum(a.r) - fourDNum(b.r))
    || String(getName(a.r.id)).localeCompare(String(getName(b.r.id))));

  const body = rows.map(x => {
    const remarkColor = x.remark ? "var(--yellow)" : "var(--muted)";
    // Editable rows get a 2-option select (current away-code + Present); choosing
    // Present routes through onParadeCodeChange → openParadeClearConfirm (book-in).
    // Locked rows render static text styled to match the disabled control so the
    // column still reads uniformly.
    const codeCell = PARADE_EDITABLE_CODES.includes(x.code)
      ? `<select onchange="onParadeCodeChange('${escapeAttr(x.r.id)}', this.value)"
            style="padding:4px 6px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px"><option value="${escapeHTML(x.code)}" selected>${escapeHTML(x.code)}</option><option value="Present">Present</option></select>`
      : `<span style="display:inline-block;padding:4px 6px;font-size:12px;color:var(--muted)">${escapeHTML(x.code)}</span>`;
    return `<tr>
      <td class="mono">${escapeHTML(x.r.id)}</td>
      <td>${escapeHTML(displayPersonLabel(x.r.id))}</td>
      <td>${codeCell}</td>
      <td style="color:${remarkColor};white-space:normal;font-size:12px">${escapeHTML(x.remark)}</td>
    </tr>`;
  }).join("");

  // Standalone platoon parade-state message — the same block this platoon
  // contributes to the full company message (byte-identical to the company
  // view's per-platoon copy button, since both go through
  // generateBravesParadeState at level:"platoon"). Editable free-text + a Copy
  // button, mirroring the company view. Reuses the company view's #parade-text /
  // #parade-copy-btn ids and copyParadeText() — safe because the company and
  // platoon views never render at the same time (both fill #parade-body), and
  // the clipboard fallback in paradeCopyString looks up #parade-text.
  // Note: a grid edit calls refreshParade(), which regenerates this textarea
  // from fresh data — so grid edits flow into the message, but any free-text
  // edits typed here are discarded on the next grid edit (same as the company
  // textarea; the normal flow is edit-grid-then-copy, or free-text edit last).
  const msg = generateBravesParadeState({ level: "platoon", platoon: code }, _paradeType, dateIso, _paradeTime);

  // Message textarea sits ABOVE the grid so a commander lands on the copy-ready
  // parade text first; the editable grid (which regenerates the textarea on every
  // code change — see refreshParade) follows below.
  host.innerHTML = bento + `
    <div class="card" style="padding:14px;margin-bottom:14px">
      <textarea id="parade-text" rows="20" spellcheck="false"
        style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.45;resize:vertical;white-space:pre">${escapeHTML(msg)}</textarea>
      <button type="button" id="parade-copy-btn" class="btn btn-success" style="margin-top:10px" onclick="copyParadeText()">📋 Copy to Clipboard</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th style="width:70px">4D</th><th>Name</th><th style="width:120px">Attendance Code</th><th>Remarks</th></tr></thead>
      <tbody>${body || `<tr><td colspan="4" class="empty-state">No personnel in this platoon.</td></tr>`}</tbody>
    </table></div>`;
}

// ── Edit → write-back ────────────────────────────────────────────────────────
// Changing a grid code opens a small prefilled editor (shared modal) that writes
// the real record. Cancelling re-renders the grid so the <select> snaps back to
// the person's true current code.
function onParadeCodeChange(d4, code) {
  if (code === "Present") { openParadeClearConfirm(d4); return; }
  openParadeCodeEditor(d4, code);
}

// Find an active Medical row for this person matching a predicate (to edit in
// place rather than stack a duplicate when adjusting an existing status).
function paradeActiveMed(d4, pred) {
  const iso = paradeCurrentDateISO();
  return (STATE.medical || []).find(m => m.d4 === d4 && pred(m) && medStatusActive(m, iso));
}
function paradeActiveLeave(d4, wantAlOil) {
  const iso = paradeCurrentDateISO();
  return (STATE.leave || []).find(l => {
    if (l.d4 !== d4) return false;
    const s = displayDateToISO(l.startDate), e = displayDateToISO(l.endDate);
    if (!(s && e && s <= iso && iso <= e)) return false;
    return bpIsAlOilType(l.type) === wantAlOil;
  });
}
// An MR row for today, still pending (blank/Pending status). MR carries no end
// date so medStatusActive doesn't apply — match on the report date instead.
function paradeActiveMr(d4) {
  const iso = paradeCurrentDateISO();
  return (STATE.medical || []).find(m =>
    m.d4 === d4 && m.type === "MR" && displayDateToISO(m.date) === iso && (!m.status || m.status === "Pending"));
}

// The status options offered for the STATUS code — every restricted in-camp
// status (excludes MC/Warded/Pending/NIL which are their own codes) plus any
// custom statuses the unit has defined.
function paradeStatusOptions(selected) {
  const std = MED_STATUSES.filter(s => !["MC", "Warded", "Pending", "NIL"].includes(s));
  const custom = (STATE.customStatuses || []).map(c => c.name);
  const all = [...std, ...custom];
  return all.map(s => `<option value="${escapeAttr(s)}"${s === selected ? " selected" : ""}>${escapeHTML(s)}</option>`).join("");
}

function openParadeCodeEditor(d4, code) {
  const iso = paradeCurrentDateISO();
  const name = displayPersonLabel(d4);
  const dateField = (id, label, val) =>
    `<div class="form-group"><label>${label}</label><input type="date" id="${id}" value="${escapeAttr(val || "")}" style="width:100%;padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text)"></div>`;
  const textField = (id, label, val, ph) =>
    `<div class="form-group"><label>${label}</label><input type="text" id="${id}" value="${escapeAttr(val || "")}" placeholder="${escapeAttr(ph || "")}" style="width:100%;padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text)"></div>`;
  const selField = (id, label, optsHTML) =>
    `<div class="form-group"><label>${label}</label><select id="${id}" style="width:100%;padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text)">${optsHTML}</select></div>`;

  let fields = "";
  if (code === "MC") {
    const cur = paradeActiveMed(d4, m => m.status === "MC");
    fields =
      textField("pe-reason", "Reason", cur?.reason, "e.g. Fever") +
      dateField("pe-start", "Start (inclusive)", cur ? displayDateToISO(cur.startDate) : iso) +
      dateField("pe-end", "End (inclusive)", cur ? displayDateToISO(cur.endDate) : "");
  } else if (code === "STATUS") {
    const cur = paradeActiveMed(d4, m => !["MC", "Warded", "Pending", "NIL"].includes(m.status) && m.status);
    fields =
      selField("pe-status", "Status", paradeStatusOptions(cur?.status || "LD")) +
      textField("pe-reason", "Reason", cur?.reason, "e.g. Sprained ankle") +
      dateField("pe-start", "Start (inclusive)", cur ? displayDateToISO(cur.startDate) : iso) +
      dateField("pe-end", "End (inclusive)", cur ? displayDateToISO(cur.endDate) : "");
  } else if (code === "RS") {
    const cur = paradeActiveMed(d4, m => (m.type === "RSI" || m.type === "RSO") && (!m.status || m.status === "Pending"));
    fields =
      selField("pe-rstype", "Type", `<option value="RSI"${cur?.type === "RSI" ? " selected" : ""}>RSI (report sick inside)</option><option value="RSO"${cur?.type === "RSO" ? " selected" : ""}>RSO (report sick outside)</option>`) +
      textField("pe-reason", "Reason", cur?.reason, "e.g. Cough & flu");
  } else if (code === "MR") {
    const cur = paradeActiveMr(d4);
    fields =
      textField("pe-reason", "Reason", cur?.reason, "e.g. Physio review") +
      textField("pe-mrtiming", "Timing (optional)", cur?.mrTiming, "e.g. AM / 1400");
  } else if (code === "AL/OIL") {
    const cur = paradeActiveLeave(d4, true);
    fields =
      selField("pe-altype", "Type", `<option value="AL"${cur?.type === "AL" ? " selected" : ""}>AL (annual leave)</option><option value="OIL"${cur?.type === "OIL" ? " selected" : ""}>OIL (off-in-lieu)</option>`) +
      textField("pe-reason", "Reason / label", cur?.reason, "e.g. 48HR BO") +
      dateField("pe-start", "Start (inclusive)", cur ? displayDateToISO(cur.startDate) : iso) +
      dateField("pe-end", "End (inclusive)", cur ? displayDateToISO(cur.endDate) : iso);
  } else if (code === "OTHERS") {
    const cur = paradeActiveLeave(d4, false);
    fields =
      textField("pe-reason", "Reason / detail", cur?.reason, "e.g. Course, Interview") +
      selField("pe-incamp", "In / out of camp", `<option value="false"${cur && cur.isInCamp === false ? " selected" : ""}>Not in camp (out)</option><option value="true"${cur && cur.isInCamp === true ? " selected" : ""}>In camp</option>`) +
      dateField("pe-start", "Start (inclusive)", cur ? displayDateToISO(cur.startDate) : iso) +
      dateField("pe-end", "End (inclusive)", cur ? displayDateToISO(cur.endDate) : iso);
  }

  openModal(`Set ${code} — ${name}`, `
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Writes the real ${code === "AL/OIL" || code === "OTHERS" ? "leave" : "medical"} record for <strong>${escapeHTML(name)}</strong> and updates the parade state.</div>
    ${fields}
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn btn-primary" onclick="saveParadeCode('${escapeAttr(d4)}','${escapeAttr(code)}')">Save</button>
      <button class="btn" onclick="closeParadeEditor()">Cancel</button>
    </div>`);
}

// Cancel: close the modal and refresh so the <select> resets to the true state.
function closeParadeEditor() { closeModal(); refreshParade(); }

function saveParadeCode(d4, code) {
  const iso = paradeCurrentDateISO();
  const gvi = id => (document.getElementById(id)?.value || "").trim();
  const changed = [];
  let targetId = null;          // the record we KEEP; every OTHER active contributor is ended

  if (code === "MC" || code === "STATUS") {
    const status = code === "MC" ? "MC" : gvi("pe-status");
    if (!status) { alert("Select a status."); return; }
    const startIso = gvi("pe-start"), endIso = gvi("pe-end");
    // Both dates are required: an MC/STATUS with a blank end never reads as active
    // (medStatusActive needs an end) and isn't caught by the ended-MC persistence
    // either, so it would save the record but leave the person showing "Present"
    // — a silent no-op that misreports the parade state.
    if (!startIso || !endIso) { alert("Enter both a start and end date."); return; }
    if (endIso < startIso) { alert("End date cannot be before start date."); return; }
    const existing = code === "MC"
      ? paradeActiveMed(d4, m => m.status === "MC")
      : paradeActiveMed(d4, m => m.status === status);
    const rec = {
      id: existing ? existing.id : nextId(),
      d4, date: existing?.date || isoToDisplayDate(iso), reason: gvi("pe-reason"), location: existing?.location || "",
      status, startDate: startIso ? isoToDisplayDate(startIso) : "", endDate: endIso ? isoToDisplayDate(endIso) : "",
      type: existing?.type || "", urtiType: existing?.urtiType || "", mrTiming: existing?.mrTiming || "",
      visitId: existing?.visitId || "", origin: existing?.origin || "manual"
    };
    upsertLocal("medical", rec); changed.push(["Medical", rec]);
    targetId = rec.id;
  } else if (code === "RS") {
    const rsType = gvi("pe-rstype") || "RSI";
    const existing = paradeActiveMed(d4, m => (m.type === "RSI" || m.type === "RSO") && (!m.status || m.status === "Pending"));
    const rec = {
      id: existing ? existing.id : nextId(),
      d4, date: isoToDisplayDate(iso), reason: gvi("pe-reason"), location: "",
      status: "Pending", startDate: isoToDisplayDate(iso), endDate: "",
      type: rsType, urtiType: existing?.urtiType || "", mrTiming: "", visitId: existing?.visitId || "", origin: existing?.origin || "manual"
    };
    upsertLocal("medical", rec); changed.push(["Medical", rec]);
    targetId = rec.id;
  } else if (code === "MR") {
    // MR (Medical Review) is independent/additive — a person can be MR AND still
    // carry an LD/excuse. So we write a blank-status MR row (blank status keeps it
    // in the MR section only, never double-listed as REPORTING SICK / STATUS) and
    // do NOT end their other statuses or book them in.
    const existing = paradeActiveMr(d4);
    const rec = {
      id: existing ? existing.id : nextId(),
      d4, date: isoToDisplayDate(iso), reason: gvi("pe-reason"), location: "",
      status: "", startDate: isoToDisplayDate(iso), endDate: "",
      type: "MR", urtiType: "", mrTiming: gvi("pe-mrtiming"), visitId: existing?.visitId || "", origin: existing?.origin || "manual"
    };
    upsertLocal("medical", rec); changed.push(["Medical", rec]);
    targetId = rec.id;
  } else if (code === "AL/OIL" || code === "OTHERS") {
    const startIso = gvi("pe-start"), endIso = gvi("pe-end");
    if (endIso && startIso && endIso < startIso) { alert("End date cannot be before start date."); return; }
    const wantAlOil = code === "AL/OIL";
    const existing = paradeActiveLeave(d4, wantAlOil);
    const type = wantAlOil ? (gvi("pe-altype") || "AL") : "Others";
    const inCamp = wantAlOil ? false : (gvi("pe-incamp") === "true");
    const days = (startIso && endIso)
      ? Math.round((new Date(endIso) - new Date(startIso)) / 86400000) + 1 : 0;
    const rec = {
      id: existing ? existing.id : nextId(),
      d4, type, startDate: isoToDisplayDate(startIso || iso), endDate: isoToDisplayDate(endIso || iso),
      days: days > 0 ? days : 0, reason: gvi("pe-reason"), isInCamp: inCamp, isInCampReviewed: true
    };
    upsertLocal("leave", rec); changed.push(["Leave", rec]);
    targetId = rec.id;
  }

  // Changing a person's code means they should end up with ONLY the new code, so
  // end every OTHER active contributor (the old MC when switching to LD, a
  // lingering leave row, a same-day out appointment). Otherwise a higher-priority
  // stale record would mask the new code and the edit would appear to do nothing.
  // MR is the exception — it's additive (coexists with LD/excuse), so it
  // doesn't end other statuses.
  if (code !== "MR") {
    paradeEndActiveContributors(d4, targetId, changed);
  }

  saveLocal();
  if (STATE.apiUrl) changed.forEach(([tab, row]) => { if (row) autoSync(tab, { type: "upsert", row }); });
  closeModal();
  refreshParade();
}

// Clear a person back to Present: book every active parade-contributing record
// IN from the parade date (bookInDate, keeping the record's real dates), resolve
// a same-day pending MR, and resolve same-day out-of-camp appointments. Never
// rewrites dates or hard-deletes (preserves history — see paradeEndActiveContributors).
function openParadeClearConfirm(d4) {
  const name = displayPersonLabel(d4);
  const iso = paradeCurrentDateISO();
  openModal(`Mark Present — ${name}`, `
    <div style="font-size:13px;margin-bottom:14px">Mark <strong>${escapeHTML(name)}</strong> present from <strong>${escapeHTML(iso)}</strong>? Their MC / status / leave records are kept on file with their real dates (record dates kept) — they simply read Present from this date onward.</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" onclick="paradeClearPerson('${escapeAttr(d4)}')">Mark Present</button>
      <button class="btn" onclick="closeParadeEditor()">Cancel</button>
    </div>`);
}

function paradeClearPerson(d4) {
  const iso = paradeCurrentDateISO();
  const changed = [];
  paradeEndActiveContributors(d4, null, changed);
  // paradeEndActiveContributors only books in records ACTIVE today. A recruit in
  // the MC+1/MC+2 grace tail (their MC ended 1–2 days ago but the classifier
  // still parks them under ATT C) has no active record to touch — book in the
  // most-recent already-ended MC directly so the tail drops out from the parade
  // date onward (bookedInBy). Matches the classifier's recovery-tail window
  // (endDate < parade date, within 2 days) and only touches an un-booked MC.
  const graceMc = (STATE.medical || [])
    .filter(m => m.d4 === d4 && m.status === "MC" && !m.bookInDate
      && displayDateToISO(m.endDate || "") && displayDateToISO(m.endDate) < iso)
    .sort((a, b) => displayDateToISO(b.endDate).localeCompare(displayDateToISO(a.endDate)))[0];
  if (graceMc) {
    const endIso = displayDateToISO(graceMc.endDate || "");
    const sinceEnd = endIso ? Math.round((new Date(iso + "T00:00:00") - new Date(endIso + "T00:00:00")) / 86400000) : 99;
    if (sinceEnd <= 2) { graceMc.bookInDate = isoToDisplayDate(iso); changed.push(["Medical", graceMc]); }
  }
  // Marking Present means nothing is outstanding, so also resolve a same-day
  // pending MR. MR is normally additive (a person can be on LD AND MR), so
  // applying another code leaves it alone — but a blank-status MR carries no end
  // date, so medStatusActive never sees it and paradeEndActiveContributors can't
  // reach it. Without this the row would snap straight back to "MR" after the
  // commander clicked "Present". Resolve (Pending/blank → NIL) rather than delete.
  const mr = paradeActiveMr(d4);
  if (mr) { mr.status = "NIL"; changed.push(["Medical", mr]); }

  saveLocal();
  if (STATE.apiUrl) changed.forEach(([tab, row]) => { if (row) autoSync(tab, { type: "upsert", row }); });
  closeModal();
  refreshParade();
}

// Book every ACTIVE parade-contributing record for a person IN as of the parade
// date — WITHOUT rewriting the record's real dates (item 4c). An active Medical
// status (MC/Warded/LD/Excuse/…) gets `bookInDate = parade date` instead of
// endDate → yesterday: the record keeps its true range (correct for HA / history
// / viewing past parade dates) while the classifier reads the person Present
// on/after bookInDate (bookedInBy). Pending Medical has no range to preserve, so
// it still resolves to NIL. Active Leave (AL/OIL or OTHERS-from-leave) is booked
// in the same way. Same-day out-of-camp Appointments are single-day events with
// no range to keep, so they still resolve. The record whose id === exceptId is
// left untouched (unused now the grid only offers →Present, kept for the
// arbitrary-code caller). Mutated rows are appended to `changed` as [tab, row].
function paradeEndActiveContributors(d4, exceptId, changed) {
  const iso = paradeCurrentDateISO();
  (STATE.medical || []).forEach(m => {
    if (m.d4 !== d4 || m.id === exceptId || m.status === "NIL") return;
    if (!medStatusActive(m, iso)) return;
    // Pending has no date range → resolve to NIL. Everything else keeps its
    // dates and is simply marked booked-in from the parade date.
    if (m.status === "Pending") m.status = "NIL"; else m.bookInDate = isoToDisplayDate(iso);
    changed.push(["Medical", m]);
  });
  (STATE.leave || []).forEach(l => {
    if (l.d4 !== d4 || l.id === exceptId) return;
    const s = displayDateToISO(l.startDate), e = displayDateToISO(l.endDate);
    if (!(s && e && s <= iso && iso <= e)) return;
    l.bookInDate = isoToDisplayDate(iso);   // keep the leave's real range; Present on/after
    changed.push(["Leave", l]);
  });
  (STATE.appointments || []).forEach(a => {
    if (a.d4 !== d4 || a.resolved || a.id === exceptId) return;
    if (displayDateToISO(a.date) !== iso) return;
    a.resolved = true;
    changed.push(["Appointments", a]);
  });
}

// ── Small local mutation helpers ─────────────────────────────────────────────
// Insert or replace a row (by id) in a STATE array.
function upsertLocal(key, rec) {
  const arr = STATE[key] || (STATE[key] = []);
  const i = arr.findIndex(x => x.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
}
