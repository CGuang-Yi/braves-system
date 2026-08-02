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
//     • PLATOON — a strength/counts bento header plus a spreadsheet-style grid
//     (4D · Name · Attendance Code · Remarks · quick-log, the last shown only to
//     canWrite() roles). The Attendance Code cell is
//     editable ONLY for the away-codes MC / AL/OIL / OTHERS (item 5), and the
//     one change offered is → Present (book-in); every other code renders as
//     read-only text. Booking a person in sets `bookInDate` on their REAL source
//     record (Medical/Leave) WITHOUT rewriting its dates, so the classifier reads
//     them Present from that date on while history/HA keep the true range. A
//     recruit whose MC has ENDED keeps showing as MC (out of camp) through the
//     MC+1/MC+2 grace window — that persistence lives in the shared §8 classifier
//     (bpClassifyPerson's ended-MC tail, gated on the record NOT being booked in),
//     so the grid, the copy-paste message and the archiver all agree. MR
//     (Medical Review) is its own code / MR section.
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

// Fix 18: how far forward the parade state looks for not-yet-started absences
// (spec §8.3 — default 7d). Session-scoped like _paradeDate / _paradeType and
// deliberately NOT persisted, so a commander who widened it once to plan the
// month doesn't silently keep a month-wide parade state tomorrow morning.
//
// This is the ONLY place the horizon lives. bpClassifyPerson defaults it off, so
// every other consumer of the classifier — the Status Board grid, the Dashboard
// tables, the sick-report generators, the archiver — keeps
// strict today-only semantics without knowing this variable exists.
let _paradeLookahead = 7;          // days; Infinity = "All"

// Item 19: once the user picks a parade type by hand, we stop auto-flipping to
// LP for the rest of the session (manual choice wins). Reset only on reload.
let _paradeTypeManual = false;
// Handle for the 1700 auto-flip interval so we never stack timers across renders.
let _paradeFlipTimer = null;

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

// Display order for the multi-status grid cell: the §8 primary priority chain
// (REPORTING SICK > ATT C > AL/OIL > STATUS > OTHERS), with MR last — matching
// the old single-primary-then-"· MR" note ordering. BP_SECTIONS exists too but
// its order (alOil, mr, …) is tuned for message assembly, not grid priority.
const PARADE_CODE_ORDER = ["reportingSick", "attC", "alOil", "status", "others", "mr"];

// Grid code → status colour (mirrors the --ps-* palette in styles.css). Kept as
// literal hex here (not var()) because the grid pills compose translucent bg/
// border via hex+alpha suffixes (#RRGGBBaa), matching the .badge-* convention;
// the bento .val figures use the var() names directly. Any change here MUST be
// mirrored in the :root --ps-* block. Codes: Present, AL/OIL, MC, RS, STATUS,
// OTHERS, MR (the full set paradeClassifyPlatoon can emit).
const PARADE_CODE_HEX = {
  "Present": "#3FB950", "AL/OIL": "#2C8A4B", "MC": "#F85149",
  "RS": "#C4611C", "STATUS": "#E3B341", "OTHERS": "#B04A5A", "MR": "#79C0FF"
};

function paradeCurrentDateISO() { return _paradeDate || todayISO(); }

// ── Control-bar setters (each re-renders only the body, keeping the toolbar) ──
function setParadeScope(v) { _paradeScope = v; refreshParade(); }
function setParadeDate(v) { _paradeDate = v; refreshParade(); }
function setParadeType(v) { _paradeType = v; _paradeTypeManual = true; refreshParade(); }
function setParadeTime(v) { _paradeTime = v; if (_paradeScope === "company") refreshParade(); }
function setParadeLookahead(v) { _paradeLookahead = (v === "all") ? Infinity : Number(v) || 0; refreshParade(); }
// The opts object every parade-side classifier call threads through. Exported as
// a function rather than the bare variable so the Dashboard's parade textarea
// (branch 5) picks up the same horizon without reaching into module state.
function paradeLookaheadOpts() { return { lookaheadDays: _paradeLookahead }; }

// Fix 18: the sections now COUNT upcoming entries but CURRENT STRENGTH
// deliberately does not, so the two visibly stop reconciling. Say so, rather
// than letting a commander find the arithmetic broken and quietly distrust the
// number. UI only — it never enters the message text, so archived snapshots are
// unaffected.
//
// The count is read off the generated message rather than by re-classifying
// everyone: the message IS the list, so this can never disagree with what is on
// screen, and it saves a fourth full pass over the roster on every render.
//
// Only the FIRST block is counted. The company message lists every person twice
// — once in the aggregate block, once in their platoon's — so counting the whole
// string would report exactly double. Splitting on BP_EQ_SEP takes the aggregate
// block alone; a platoon message has no such separator, so the split is a no-op
// there and the whole text is counted, which is what we want.
function paradeUpcomingBanner(text) {
  const firstBlock = String(text || "").split(BP_EQ_SEP)[0];
  const n = (firstBlock.match(/ \[UPCOMING\]/g) || []).length;
  if (!n) return "";
  return `<div class="card" style="padding:10px 14px;margin-bottom:12px;border-color:var(--yellow);font-size:12px;color:var(--muted)">
    ⚠️ <strong>${n}</strong> future-dated ${n === 1 ? "status is" : "statuses are"} listed and counted in the sections below (marked <code>[UPCOMING]</code>),
    but <strong>are not deducted from CURRENT STRENGTH</strong> — those personnel are present today.
    The section totals and CURRENT STRENGTH will not reconcile while this is showing.</div>`;
}

// Item 19: default/flip the parade type by local wall-clock. FP before 1700,
// LP from 1700 on. `new Date()` (local tz) is intentional — the app runs in the
// user's timezone and calc.js is date-only. A manual pick (setParadeType) opts
// out for the session.
function paradeShouldBeLP() {
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes()) >= 17 * 60; // >= 1700
}
// Called on each parade-tab render: seed the default unless the user overrode it.
function paradeAutoTypeInit() {
  if (_paradeTypeManual) return;
  _paradeType = paradeShouldBeLP() ? "LP" : "FP";
}
// Called on each parade-tab render: (re)start a ~60s watcher that flips to LP the
// moment 1700 passes while the tab stays open. Self-clears when the user leaves
// the Parade tab or has manually overridden — no cross-file teardown needed.
function paradeStartLpFlipTimer() {
  if (_paradeFlipTimer) { clearInterval(_paradeFlipTimer); _paradeFlipTimer = null; }
  _paradeFlipTimer = setInterval(() => {
    if (STATE.nav !== "parade" || _paradeTypeManual) { clearInterval(_paradeFlipTimer); _paradeFlipTimer = null; return; }
    if (paradeShouldBeLP() && _paradeType !== "LP") { _paradeType = "LP"; refreshParade(); }
  }, 60 * 1000);
}

// ── Top-level render ─────────────────────────────────────────────────────────
function renderParade(el) {
  paradeAutoTypeInit();
  paradeStartLpFlipTimer();
  if (!STATE.roster.length) {
    el.innerHTML = `<h2 style="font-size:18px;font-weight:700;margin-bottom:16px">🎖️ Parade State</h2>
      <div class="card empty-state">${STATE.authToken
        ? `<p>Loading data from the sheet…</p>`
        : `<p>Not signed in on this device. Log in to sync.</p>`}</div>`;
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
          <select data-action-change="paradeScope" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;min-width:220px">${scopeOptions}</select>
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--muted)">Date</label><br>
          <input type="date" value="${escapeAttr(dateIso)}" data-action-change="paradeDate" style="padding:6px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--muted)">Parade</label><br>
          <select data-action-change="paradeType" style="padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">
            <option value="FP"${_paradeType === "FP" ? " selected" : ""}>First Parade</option>
            <option value="LP"${_paradeType === "LP" ? " selected" : ""}>Last Parade</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--muted)">Time (company header)</label><br>
          <input type="text" value="${escapeAttr(_paradeTime)}" placeholder="e.g. 0730" maxlength="9" data-action-input="paradeTime" style="padding:6px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;width:110px">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--muted)" title="How far ahead to list absences that have not started yet">Lookahead</label><br>
          <div class="filter-role-group">
            ${[["7", "7d"], ["14", "14d"], ["30", "30d"], ["all", "All"]].map(([v, l]) => {
              const on = (v === "all") ? _paradeLookahead === Infinity : Number(v) === _paradeLookahead;
              return `<button type="button" class="role-btn${on ? " active" : ""}" data-action="paradeLookahead" data-value="${v}">${l}</button>`;
            }).join("")}
          </div>
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
  const text = generateBravesParadeState({ level: "company" }, _paradeType, dateIso, _paradeTime, paradeLookaheadOpts());
  const blockBtns = paradeCompanyBlocks().map((b, i) =>
    `<button type="button" id="parade-copy-${i}" class="btn" style="font-size:12px"
       data-action="paradeCopyBlock" data-code="${escapeAttr(b.code)}" data-btn="parade-copy-${i}">📋 ${escapeHTML(b.label)}</button>`
  ).join("");
  host.innerHTML = paradeUpcomingBanner(text) + `
    <div class="card" style="padding:14px">
      <textarea id="parade-text" rows="26" spellcheck="false"
        style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.45;resize:vertical;white-space:pre">${escapeHTML(text)}</textarea>
      <button type="button" id="parade-copy-btn" class="btn btn-success" style="margin-top:10px" data-action="paradeCopyText">📋 Copy to Clipboard</button>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-size:11px;color:var(--muted)">Copy per platoon:</span>
        ${blockBtns}
      </div>
    </div>`;
}

// Copy an arbitrary string, with a transient "✓ Copied!" on the given button and
// the same select-and-alert fallback as the old report modal (drops the text into
// the textarea so the user can Cmd+C when the clipboard API is blocked).
//
// `taId` names the textarea used for that fallback. It defaults to the Parade
// tab's own, but the Dashboard card (Feature 28) renders a DIFFERENT textarea on
// a page where "parade-text" does not exist — without this the clipboard-blocked
// path would alert "text is selected" having selected nothing at all.
async function paradeCopyString(text, btnId, taId) {
  const btn = btnId ? document.getElementById(btnId) : null;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { const o = btn.textContent; btn.textContent = "✓ Copied!"; setTimeout(() => { btn.textContent = o; }, 1800); }
  } catch {
    const ta = document.getElementById(taId || "parade-text");
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
// later in the Archive → Compare view. Copy is the "this is what was sent"
// moment. Commander + admin (Fix1B — parade state is archived when either role
// copies it) and fire-and-forget — a failed or blocked archive must NEVER
// interfere with the copy. The snapshot records its real scope (company or a
// platoon). Optimistically prepends the row to STATE.paradeArchive so the compare
// picker sees it immediately; deduped so re-copying identical text doesn't pile up.
//
// `meta` supplies {date, slot, type, scope} for callers outside this tab. It
// defaults to the Parade tab's own toolbar state, which is what every original
// caller wants — but the Dashboard card (Feature 28) has its OWN date/type/time
// and takes its scope from the topbar filter, and without passing them the
// snapshot would be stamped with whatever the Parade tab happened to be showing.
// That mislabels the archive row (wrong date/slot) and, worse, defeats the
// paradeSnapshotDup guard, which keys on date+slot+type+message.
function archiveParadeSnapshot(text, meta) {
  if (!text || typeof canWrite !== "function" || !canWrite()) return;
  if (!STATE.apiUrl || !STATE.authToken) return;
  const m = meta || {
    date: paradeCurrentDateISO(), slot: _paradeTime, type: _paradeType, scope: _paradeScope
  };
  const row = {
    timestamp: new Date().toISOString(),
    date: m.date || todayISO(), slot: String(m.slot || ""),
    type: m.type || "", scope: m.scope || "company", message: String(text)
  };
  if (paradeSnapshotDup(STATE.paradeArchive, row)) return;
  STATE.paradeArchive = [row, ...(STATE.paradeArchive || [])];
  Promise.resolve(API.archiveNow("parade", { text: row.message, type: row.type, date: row.date, slot: row.slot, scope: row.scope }))
    .catch(() => { /* quiet by design — the copy already succeeded */ });
}

// Copy a single platoon/HQ block's standalone parade-state text. Reads the
// current toolbar state (type/date/time) so it always matches what's shown.
async function copyParadeBlock(code, btnId) {
  const text = generateBravesParadeState({ level: "platoon", platoon: code }, _paradeType, paradeCurrentDateISO(), _paradeTime, paradeLookaheadOpts());
  await paradeCopyString(text, btnId);
}

// ── PLATOON VIEW — bento header + editable grid ──────────────────────────────
// Classify every person in the platoon into EVERY grid code they currently hold
// (not just the §8 single primary) — see paradeClassifyPlatoon below for why.
// Returns [{ r, codes, remark, notInCamp }] where codes is an ordered
// [{ code, editable, reason }], always at least one entry.
function paradeClassifyPlatoon(people, dateIso) {
  return people.map(r => {
    const c = bpClassifyPerson(r, dateIso, null, paradeLookaheadOpts());
    // List EVERY section the person is classified into — not just the single
    // §8 primary. Collapsing to one code dropped a lower-priority TOGGLEABLE
    // status (MC/AL·OIL/OTHERS) whenever a higher-priority NON-editable one
    // (RS/STATUS) outranked it, making it unbookable from the grid. The bento
    // section counts already tally people across multiple sections, so listing
    // them all also makes the grid match the header. Book-in stays whole-person
    // (onParadeCodeChange → paradeClearPerson resolves ALL of the person's
    // records at once), so each editable code simply offers → Present.
    const codes = [];
    PARADE_CODE_ORDER.forEach(k => {
      if (!c.sections[k] || !c.sections[k].length) return;
      const code = k === "mr" ? "MR" : (PARADE_SECTION_TO_CODE[k] || "OTHERS");
      const reason = (c.meta[k] && c.meta[k][0] && c.meta[k][0].reason) || "";
      // Fix 18: an upcoming entry is never editable, whatever its code. The only
      // grid edit is "Mark Present", which books a record IN as of the parade
      // date — meaningless for a window that has not started, and
      // paradeEndActiveContributors only touches records active TODAY, so the
      // select would have silently done nothing while looking like it worked.
      const upcoming = !!(c.meta[k] && c.meta[k][0] && c.meta[k][0].upcoming);
      codes.push({ code, editable: PARADE_EDITABLE_CODES.includes(code) && !upcoming, reason, upcoming });
    });
    // Section-less ⇒ a single, non-editable Present cell (old fallback).
    if (!codes.length) codes.push({ code: "Present", editable: false, reason: "" });
    // Feature 30.1: attach the visit-type-and-time suffix to the FIRST pill only.
    // It cannot go on the RS pill as one might expect — once the MO issues a
    // status the person DROPS OFF reporting-sick entirely and holds only a
    // STATUS/MC pill, which is exactly the "LD + RSI 0830" case. Where the code
    // already names the visit type (RS, MR) only the time is appended, since
    // "RS + RSI" reads redundantly; elsewhere the full "+ TYPE time" carries it.
    // Never applied to an UPCOMING pill — that pill describes a window which has
    // not started, and today's visit time pinned to it would read as "the MC
    // starting Thursday began at 0830". So it lands on the first pill that is
    // actually current: an upcoming MC can outrank the LD the person is really
    // on today, and dropping the suffix in that case would lose the visit
    // entirely rather than move it one row down.
    const visit = visitForDay(r.id, dateIso);
    const target = codes.find(cc => !cc.upcoming);
    if (visit && target) {
      const bare = target.code === "RS" || target.code === "MR";
      const time = String(visit.time || "").trim();
      target.suffix = bare ? (time ? ` ${time}` : "") : ` + ${visitSuffix(visit)}`;
    }
    const remark = codes.map(cc => cc.reason).filter(Boolean).join(" · ");
    return { r, codes, remark, notInCamp: c.notInCamp };
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
    // Lookahead-aware, so the tiles keep matching the message's section counts —
    // which now include upcoming entries.
    const c = bpClassifyPerson(r, dateIso, null, paradeLookaheadOpts());
    BP_SECTIONS.forEach(k => { sec[k] += c.sections[k].length; });
  });

  // Bento header. First box carries CURRENT/TOTAL together; second carries the
  // three rank groups together; then one box per parade section.
  const bento = `
    <div class="stats-row" style="margin-bottom:12px">
      <div class="stat"><label>Current / Total</label><div class="val"><span style="color:var(--green)">${s.current}</span> <span style="color:var(--dim)">/</span> ${s.total}</div></div>
      <div class="stat"><label>Officer · WOSPEC · Enlistee</label><div class="val" style="font-family:var(--mono);font-size:15px">${grp("Officer")} · ${grp("WOSPEC")} · ${grp("Enlistee")}</div></div>
      <div class="stat"><label>AL/OIL</label><div class="val" style="color:var(--ps-aloil)">${sec.alOil}</div></div>
      <div class="stat"><label>Report Sick</label><div class="val" style="color:var(--ps-rs)">${sec.reportingSick}</div></div>
      <div class="stat"><label>MR</label><div class="val" style="color:var(--ps-mr)">${sec.mr}</div></div>
      <div class="stat"><label>MC</label><div class="val" style="color:var(--ps-mc)">${sec.attC}</div></div>
      <div class="stat"><label>Status</label><div class="val" style="color:var(--ps-status)">${sec.status}</div></div>
      <div class="stat"><label>Others</label><div class="val" style="color:var(--ps-others)">${sec.others}</div></div>
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
    // One control per concurrent status, stacked vertically so a person on e.g.
    // STATUS + OTHERS shows both. Each control is tinted by its status colour
    // (PARADE_CODE_HEX; falls back to muted grey for any unmapped code). Editable
    // codes (MC/AL·OIL/OTHERS) get the 2-option → Present select — kept looking
    // like a form control (rounded rect + caret) but tinted to the status so it
    // still reads as "editable → Present"; choosing Present routes through
    // onParadeCodeChange → openParadeClearConfirm (book-in). Non-editable codes
    // render a solid .ps-badge pill. hex+'22'/'55' are the translucent fill/border.
    // Geometry for the select lives in .ps-select/.ps-select-wrap (Fix 14) — it
    // must stay 16px to dodge iOS auto-zoom, so it is transform-scaled down to
    // .ps-badge size rather than given a smaller font. Only colour stays inline.
    const codeCell = `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">${
      x.codes.map(cc => {
        const hex = PARADE_CODE_HEX[cc.code];
        // Fix 18: an upcoming pill is dimmed and given a "→" lead-in so it reads
        // as "coming, not current" at a glance. The Remarks cell carries the
        // dates and the [UPCOMING] marker, so no extra text is needed here.
        const dim = cc.upcoming ? "opacity:.55;" : "";
        const label = (cc.upcoming ? "→ " : "") + cc.code + (cc.suffix || "");
        const tip = cc.upcoming ? ' title="Not started yet — listed and counted, but still present today"' : "";
        return cc.editable
          ? `<span class="ps-select-wrap"><select class="ps-select" data-action-change="paradeCode" data-id="${escapeAttr(x.r.id)}"
              style="background:${hex}22;border-color:${hex}55;color:${hex}"><option value="${escapeHTML(cc.code)}" selected>${escapeHTML(label)}</option><option value="Present">Present</option></select></span>`
          : hex
            ? `<span class="ps-badge"${tip} style="${dim}background:${hex}22;border-color:${hex}55;color:${hex}">${escapeHTML(label)}</span>`
            : `<span${tip} style="display:inline-block;${dim}padding:4px 6px;font-size:12px;color:var(--muted)">${escapeHTML(label)}</span>`;
      }).join("")
    }</div>`;
    // 4D + Name open the person's full profile card (openPerson — the same card
    // the Roster and other tabs open). Rendered as explicit <button>s wrapping
    // ONLY the text (not the whole cell/row) so the tap target is tight: on
    // mobile an incidental touch while swipe-scrolling the grid won't land on it,
    // and a scroll gesture cancels the click outright (click fires only on a
    // stationary tap). Kept off the Attendance Code cell so its Mark-Present
    // select stays the sole action there. .parade-name-btn styles it as an accent
    // link (transparent button chrome) — see styles.css.
    const cardBtn = (inner, extra) =>
      `<button type="button" class="parade-name-btn"${extra || ""} data-action="paradeOpenPerson" data-id="${escapeAttr(x.r.id)}" title="Open ${escapeAttr(displayPersonLabel(x.r.id))} card">${inner}</button>`;
    return `<tr>
      <td class="mono">${cardBtn(escapeHTML(x.r.id), ' style="font-weight:700"')}</td>
      <td>${cardBtn(escapeHTML(displayPersonLabel(x.r.id)))}</td>
      <td>${codeCell}</td>
      <td style="color:${remarkColor};white-space:normal;font-size:12px">${escapeHTML(x.remark)}</td>
      <!-- Feature 22: its OWN column, deliberately never inside the Attendance
           Code cell. That cell's Mark-Present select is its sole action by
           design (see the header comment above), so that an incidental tap
           while swipe-scrolling the grid on a phone cannot fire something else.
           Adding a second control there would give that away. Hidden entirely
           from viewers rather than disabled — and the <th> and the empty-state
           colspan are gated on the same canWrite() so the column count still
           lines up either way. -->
      ${canWrite() ? `<td style="width:44px;text-align:center"><button type="button" class="btn btn-icon"
        title="Log medical or leave for ${escapeAttr(displayPersonLabel(x.r.id))}"
        data-action="paradeQuickLog" data-id="${escapeAttr(x.r.id)}">＋</button></td>` : ""}
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
  const msg = generateBravesParadeState({ level: "platoon", platoon: code }, _paradeType, dateIso, _paradeTime, paradeLookaheadOpts());

  // Message textarea sits ABOVE the grid so a commander lands on the copy-ready
  // parade text first; the editable grid (which regenerates the textarea on every
  // code change — see refreshParade) follows below.
  host.innerHTML = paradeUpcomingBanner(msg) + bento + `
    <div class="card" style="padding:14px;margin-bottom:14px">
      <textarea id="parade-text" rows="20" spellcheck="false"
        style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.45;resize:vertical;white-space:pre">${escapeHTML(msg)}</textarea>
      <button type="button" id="parade-copy-btn" class="btn btn-success" style="margin-top:10px" data-action="paradeCopyText">📋 Copy to Clipboard</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th style="width:70px">4D</th><th>Name</th><th style="width:120px">Attendance Code</th><th>Remarks</th>${canWrite() ? "<th></th>" : ""}</tr></thead>
      <tbody>${body || `<tr><td colspan="${canWrite() ? 5 : 4}" class="empty-state">No personnel in this platoon.</td></tr>`}</tbody>
    </table></div>`;
}

// ── Edit → write-back ────────────────────────────────────────────────────────
// The locked grid (item 5) only ever offers → Present, so book-in is the only
// action reachable from a code cell. Anything else is ignored (the arbitrary-code
// status editor was removed — statuses are set from the Medical/Leave forms).
function onParadeCodeChange(d4, code) {
  if (code === "Present") openParadeClearConfirm(d4);
}

// An MR row for today, still pending (blank/Pending status). MR carries no end
// date so medStatusActive doesn't apply — match on the report date instead.
function paradeActiveMr(d4) {
  const iso = paradeCurrentDateISO();
  return (STATE.medical || []).find(m =>
    m.d4 === d4 && m.type === "MR" && displayDateToISO(m.date) === iso && (!m.status || m.status === "Pending"));
}

// Cancel: close the Mark-Present modal and refresh so the grid resets to state.
function closeParadeEditor() { closeModal(); refreshParade(); }

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
      <button class="btn btn-primary" data-action="paradeMarkPresent" data-d4="${escapeAttr(d4)}">Mark Present</button>
      <button class="btn" data-action="paradeCancelEditor">Cancel</button>
    </div>`);
}

function paradeClearPerson(d4) {
  const iso = paradeCurrentDateISO();
  const changed = [];
  paradeEndActiveContributors(d4, changed);
  // paradeEndActiveContributors only books in records ACTIVE today. A recruit in
  // the MC+1/MC+2 grace tail (their MC ended 1–2 days ago but the classifier
  // still parks them under ATT C) has no active record to touch — book in the
  // most-recent already-ended MC directly so the tail drops out from the parade
  // date onward (bookedInBy). Matches the classifier's recovery-tail window
  // (endDate < parade date, within 2 days) and only touches an un-booked MC.
  const graceMc = (STATE.medical || [])
    .filter(m => m.d4 === d4 && m.status === "MC" && !bookedInBy(m, iso)
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

// Book every ACTIVE AWAY record for a person IN as of the parade date — WITHOUT
// rewriting the record's real dates (item 4c). An active away Medical status
// (MC/Warded) gets `bookInDate = parade date` instead of endDate → yesterday:
// the record keeps its true range (correct for HA / history / viewing past
// parade dates) while the classifier reads the person Present on/after
// bookInDate (bookedInBy). Pending Medical has no range to preserve, so it still
// resolves to NIL. Active Leave (AL/OIL or OTHERS-from-leave) is booked in the
// same way. Same-day out-of-camp Appointments are single-day events with no
// range to keep, so they still resolve. Mutated rows are appended to `changed`
// as [tab, row]. Only reached from Mark-Present (paradeClearPerson) now.
//
// IN-CAMP STATUSES ARE LEFT ALONE. Booking a person in says "they are back in
// camp", which an LD / RIB / Excuse-* never contradicted — they were in camp the
// whole time. This used to stamp every active row regardless, so marking someone
// Present on return from a 2-day MC also booked in the 84-day LD they are still
// on, and the classifier then dropped it from STATUS for the rest of its run.
// The classifier no longer reads bookInDate for in-camp statuses either, so old
// rows already carrying a stray stamp recover on their own. To end an in-camp
// status early, edit its end date — that is what the Medical form is for.
function paradeEndActiveContributors(d4, changed) {
  const iso = paradeCurrentDateISO();
  (STATE.medical || []).forEach(m => {
    if (m.d4 !== d4 || m.status === "NIL") return;
    if (!medStatusActive(m, iso)) return;
    // Pending has no date range → resolve to NIL. Away records keep their dates
    // and are simply marked booked-in from the parade date: MC and Warded, plus
    // type MA — an appointment is a discrete event whose own classifier branch
    // still honours bookInDate, so book-in legitimately closes it. Everything
    // else reaching here is an in-camp status and is left untouched.
    if (m.status === "Pending") m.status = "NIL";
    else if (m.status === "MC" || m.status === "Warded" || m.type === "MA") m.bookInDate = isoToDisplayDate(iso);
    else return;
    changed.push(["Medical", m]);
  });
  (STATE.leave || []).forEach(l => {
    if (l.d4 !== d4) return;
    const s = displayDateToISO(l.startDate), e = displayDateToISO(l.endDate);
    if (!(s && e && s <= iso && iso <= e)) return;
    l.bookInDate = isoToDisplayDate(iso);   // keep the leave's real range; Present on/after
    changed.push(["Leave", l]);
  });
  (STATE.appointments || []).forEach(a => {
    if (a.d4 !== d4 || a.resolved) return;
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

// ── Action registry (see js/actions.js) ──────────────────────────────────────
// This tab is the pilot for moving handlers out of HTML strings. Every name here
// appears in the markup above as data-action="…" / data-action-change="…", and
// every value is a real identifier — so `no-undef` and editor "find references"
// now cover these edges, which an onclick= string never exposed.
//
// Handlers take (el, event) and read their parameters off el.dataset rather than
// from interpolated string arguments. That is what retires the escapeAttr-on-
// every-value discipline the old markup needed: a name containing an apostrophe
// used to break the generated onclick, and dataset values are never parsed.
registerActions({
  paradeScope:      el => setParadeScope(el.value),
  paradeDate:       el => setParadeDate(el.value),
  paradeType:       el => setParadeType(el.value),
  paradeTime:       el => setParadeTime(el.value),
  paradeLookahead:  el => setParadeLookahead(el.dataset.value),
  paradeCopyText:   () => copyParadeText(),
  paradeCopyBlock:  el => copyParadeBlock(el.dataset.code, el.dataset.btn),
  paradeCode:       el => onParadeCodeChange(el.dataset.id, el.value),
  paradeOpenPerson: el => openPerson(el.dataset.id),
  // The inline version called event.stopPropagation() first. The parade row has
  // no click handler of its own (see the tap-target comment above), so nothing
  // depends on it today — kept because delegation would not reproduce it if a
  // row handler were ever added, and losing it silently would be a bug.
  paradeQuickLog:   (el, event) => { event.stopPropagation(); openQuickLogMenu(el.dataset.id); },
  paradeMarkPresent: el => paradeClearPerson(el.dataset.d4),
  paradeCancelEditor: () => closeParadeEditor()
});
