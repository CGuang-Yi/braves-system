// View layer. render() dispatches to a per-tab function which fills #content.
// Each tab function may also (re)create charts; old chart instances are
// destroyed at the top of render() to avoid Chart.js canvas reuse errors.

function render() {
  Object.values(STATE.charts).forEach(c => c.destroy());
  STATE.charts = {};
  // Drop any deferred-build closures from the previous view so an un-tapped
  // builder can't pin its captured scope or fire against now-stale DOM.
  _deferredBuilders = {};

  // Reset scroll on tab switches so a long previous tab doesn't leave the
  // next one looking pre-scrolled (and on mobile hiding the topbar).
  document.getElementById("content")?.scrollTo(0, 0);

  // Keep filter dropdown options in sync with the current roster — cheap to
  // rebuild a few <option>s and means we don't have to remember to call this
  // from every site that mutates STATE.roster (pull, import, edit).
  if (typeof refreshFilterUI === "function") refreshFilterUI();

  const el = document.getElementById("content");
  const scoped = filteredRoster();
  const active = scoped.filter(r => r.status === "Active").length;
  const scopeLabel = isFilterActive() ? ` [${filterLabel()}]` : "";
  document.getElementById("str-counter").textContent = `Str: ${scoped.length} | Active: ${active}${scopeLabel}`;

  switch (STATE.nav) {
    case "dashboard": renderDashboard(el); break;
    case "parade": renderParade(el); break;
    case "roster": renderRoster(el); break;
    case "attendance": renderAttendance(el); break;
    case "detail": renderConductDetail(el); break;
    case "medical": renderMedical(el); break;
    case "statusboard": renderStatusBoard(el); break;
    case "ippt": renderIPPT(el); break;
    case "rm": renderRM(el); break;
    case "soc": renderSOC(el); break;
    case "ha": renderHA(el); break;
    case "polar": renderPolar(el); break;
    case "leave": renderLeave(el); break;
    case "mskAnalytics": renderMSKAnalytics(el); break;
    case "conducts": renderConducts(el); break;
    case "conductdash": renderConductDashboard(el); break;
    case "archive": renderArchive(el); break;
    case "sync": renderSync(el); break;
    default: el.innerHTML = "";
  }
}

// ── Archive (Item 1, admin-only) — view logged parade-state / report-sick msgs ──
// The archive tabs are pulled only for admins (api.js), and the backend blocks the
// raw read for non-admins; this view adds a client-side guard on top so a stale
// non-admin STATE never renders them.
let _archiveTab = "parade";   // "parade" | "sick"
let _archiveQuery = "";
function setArchiveTab(t) { _archiveTab = t; render(); }
function setArchiveQuery(q) { _archiveQuery = q; renderArchiveList(); }

async function doArchiveNow(kind) {
  if (!STATE.apiUrl || !STATE.authToken) { alert("Not connected to the sheet — can't archive."); return; }
  try {
    const res = await API.archiveNow(kind);
    if (res && res.error) { alert("Archive failed: " + res.error); return; }
    await doPull();            // refresh STATE.paradeArchive / sickArchive
    render();
    const a = (res && res.archived) || {};
    const made = [a.parade ? "parade" : null, a.sick ? "sick" : null].filter(Boolean);
    alert(made.length
      ? `Archived ${made.join(" + ")} for ${res.date} ${res.slot}.`
      : `Nothing new for ${res.date} ${res.slot} — that slot is already archived.`);
  } catch (e) {
    if (e.name === "AuthError" && typeof handleAuthFailure === "function") { handleAuthFailure(); return; }
    alert("Archive error: " + e.message);
  }
}

function renderArchive(el) {
  if (!isAdminRole()) {
    el.innerHTML = `<div class="card empty-state"><h2 style="font-size:18px;margin-bottom:8px">🗄️ Archive</h2>
      <p>This area is restricted to <strong>admin</strong> accounts.</p></div>`;
    return;
  }
  const pTimes = configGet("archiveParadeTimes");
  const sTimes = configGet("archiveSickTimes");
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700">🗄️ Message Archive <span style="font-size:12px;color:var(--muted);font-weight:400">(admin only)</span></h2>
      <div style="display:flex;gap:6px">
        <button class="btn" onclick="doArchiveNow('parade')" title="Snapshot the current company parade state now">＋ Archive Parade now</button>
        <button class="btn" onclick="doArchiveNow('sick')" title="Snapshot the current report-sick message now">＋ Archive Sick now</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;font-size:12px;color:var(--muted)">
      <strong>Scheduled archiving</strong> (server-side, unattended) — set <code>archiveParadeTimes</code> in the Config tab, then run <code>setupBravesArchive()</code> once in Apps Script to install the trigger.<br>
      Each parade time is <code>HHMM</code>, optionally tagged <code>:FP</code>/<code>:LP</code> — e.g. <code>0730:FP,1300:FP,2130:LP</code>. Untagged: the latest time of the day is <strong>LP</strong> (night/last parade), all earlier ones are <strong>FP</strong> (morning + midday).<br>
      <strong>Report sick</strong> is archived at <code>archiveSickTimes</code> if set, otherwise automatically at the <strong>FP (morning + midday)</strong> parade times — never at the night/LP slot.<br>
      Parade times: <strong>${escapeAttr(pTimes || "(not set)")}</strong> &nbsp;·&nbsp; Sick times: <strong>${escapeAttr(sTimes || "(auto: FP slots)")}</strong>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:4px">
        <button class="btn ${_archiveTab === "parade" ? "btn-primary" : ""}" onclick="setArchiveTab('parade')">Parade State (${(STATE.paradeArchive || []).length})</button>
        <button class="btn ${_archiveTab === "sick" ? "btn-primary" : ""}" onclick="setArchiveTab('sick')">Report Sick (${(STATE.sickArchive || []).length})</button>
      </div>
      <input id="archive-search" placeholder="Filter by date / slot / text…" value="${escapeAttr(_archiveQuery)}" oninput="setArchiveQuery(this.value)"
        style="flex:1;min-width:160px;padding:6px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px">
      <button class="btn" onclick="exportArchiveCSV('${_archiveTab}')" title="Export the messages currently shown (respects the filter) to CSV">⬇ Export CSV</button>
    </div>
    <div id="archive-list"></div>`;
  renderArchiveList();
}

function renderArchiveList() {
  const host = document.getElementById("archive-list");
  if (!host) return;
  const rows = (_archiveTab === "parade" ? STATE.paradeArchive : STATE.sickArchive) || [];
  const q = _archiveQuery.trim().toLowerCase();
  // Newest first by timestamp (ISO); fall back to insertion order.
  const sorted = rows.slice().sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const filtered = q
    ? sorted.filter(r => `${r.date} ${r.slot} ${r.type || r.format || ""} ${r.message || ""}`.toLowerCase().includes(q))
    : sorted;

  if (!filtered.length) {
    host.innerHTML = `<div class="empty-state">${rows.length ? "No entries match the filter." : "No archived messages yet. Use “Archive … now”, or set up scheduled archiving."}</div>`;
    return;
  }
  host.innerHTML = filtered.map((r, i) => {
    const label = _archiveTab === "parade" ? (r.type || "") : (r.format || "RS");
    const id = `arc-${_archiveTab}-${i}`;
    return `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
        <div style="font-size:12px"><strong class="mono" style="color:var(--accent)">${escapeAttr(r.date || "")}</strong>
          <span style="color:var(--muted)">slot ${escapeAttr(r.slot || "—")}</span>
          <span class="badge badge-accent" style="font-size:9px">${escapeAttr(label)}</span>
          ${r.scope ? `<span style="font-size:10px;color:var(--dim)">${escapeAttr(r.scope)}</span>` : ""}
          ${r.timestamp ? `<span style="font-size:10px;color:var(--dim)">· ${new Date(r.timestamp).toLocaleString()}</span>` : ""}
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn" style="font-size:10px" onclick="(function(){const t=document.getElementById('${id}').textContent;navigator.clipboard&&navigator.clipboard.writeText(t);})()">Copy</button>
          <button class="btn btn-icon btn-danger" title="Delete this archived message (admin only)" onclick="deleteArchiveEntry('${_archiveTab}','${escapeAttr(r.timestamp || "")}','${escapeAttr(r.date || "")}','${escapeAttr(r.slot || "")}')">✕</button>
        </div>
      </div>
      <pre id="${id}" style="white-space:pre-wrap;word-break:break-word;font-size:11px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin:0;max-height:320px;overflow:auto">${escapeAttr(r.message || "")}</pre>
    </div>`;
  }).join("");
}

// Delete one archived message (admin-only; backend re-checks the role). Matches
// on the unique timestamp, with date+slot as a fallback for legacy rows.
async function deleteArchiveEntry(kind, ts, date, slot) {
  if (!confirm("Delete this archived message? This removes it from the audit trail and cannot be undone.")) return;
  try {
    const res = await API.deleteArchive(kind, { timestamp: ts, date, slot });
    if (res && res.error) { alert("Delete failed: " + res.error); return; }
    const key = kind === "sick" ? "sickArchive" : "paradeArchive";
    STATE[key] = (STATE[key] || []).filter(r =>
      ts ? String(r.timestamp) !== String(ts) : !(r.date === date && String(r.slot) === String(slot)));
    renderArchive(document.getElementById("content"));
  } catch (e) {
    if (e.name === "AuthError" && typeof handleAuthFailure === "function") { handleAuthFailure(); return; }
    alert("Delete error: " + e.message);
  }
}

// Export the currently-shown archive tab (respecting the search filter) to CSV.
function exportArchiveCSV(kind) {
  const rows = (kind === "parade" ? STATE.paradeArchive : STATE.sickArchive) || [];
  const q = _archiveQuery.trim().toLowerCase();
  const flat = rows.slice()
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
    .filter(r => !q || `${r.date} ${r.slot} ${r.type || r.format || ""} ${r.message || ""}`.toLowerCase().includes(q))
    .map(r => ({
      timestamp: r.timestamp || "", date: r.date || "", slot: r.slot || "",
      type: r.type || r.format || "", scope: r.scope || "", message: r.message || ""
    }));
  if (!flat.length) { alert("Nothing to export."); return; }
  exportCSV(flat, `${kind === "parade" ? "parade_state" : "report_sick"}_archive.csv`);
}

function renderDashboard(el) {
  // Empty-state guard. The dashboard has nothing meaningful to show until
  // the roster loads, but the message depends on WHY it's empty: an
  // authenticated user is mid-pull (or the pull failed); an unauthenticated
  // visitor needs an invite link. Either way, the user should never see a
  // "click Pull from Sheet" prompt — that's an auto-handled step now.
  if (!STATE.roster.length) {
    const body = STATE.authToken
      ? `<p style="margin-bottom:8px">Loading data from the sheet…</p>
         <p style="font-size:11px;color:var(--dim)">If this stays empty for more than a few seconds, the sync may have failed. <button class="btn" onclick="doPull()" style="margin-left:6px">Retry now</button></p>`
      : `<p style="margin-bottom:8px">No invite redeemed on this device yet.</p>
         <p>Ask your admin for an invite link, then open it on this device — the app will sync automatically.</p>`;
    el.innerHTML = `
      <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Company Strength Board</h2>
      <div class="card empty-state">${body}</div>`;
    return;
  }

  const scoped = filteredRoster();
  const visible = visibleD4Set();
  const today = todayISO();
  // Derive non-active personnel from today's effective medical layer. A
  // recruit can have multiple simultaneous statuses (e.g. MC + Excuse Heavy
  // Load), all of which we want to surface on the dashboard. The "all"
  // variant returns every active status; we partition into live vs recovering
  // based on the recruit's *most-severe* tag (statuses[0]) so a recruit with
  // an active MC plus a ghost-tagged LD still sits in the live (red) table.
  const effectiveAll = currentMedicalEffectiveAll(today).filter(e => passesFilter(e.d4, visible));
  const allByD4 = Object.fromEntries(effectiveAll.map(e => [e.d4, e]));
  const topTag = r => allByD4[r.id]?.statuses[0];
  const liveRows = scoped.filter(r => topTag(r) && topTag(r).ghostDay === 0)
    .sort((a, b) => medSeverityRank(topTag(b).tag) - medSeverityRank(topTag(a).tag));
  const recoveringRows = scoped.filter(r => topTag(r) && topTag(r).ghostDay > 0)
    .sort((a, b) => topTag(a).ghostDay - topTag(b).ghostDay);
  const active = scoped.length - liveRows.length;
  const _part = scopedParticipation(STATE.attendance, STATE.conductDetail, visible);
  const avgPart = _part.pct;
  const scopeBanner = isFilterActive() ? `<div style="font-size:11px;color:var(--accent);margin-bottom:8px">Scope: <strong>${filterLabel()}</strong> — strength &amp; participation figures reflect this scope.</div>` : "";

  // Braves §16 additions, computed via the §8 classifier (braves-parade.js,
  // loaded after render.js — resolved at this runtime call). "Not Available" =
  // physically IN CAMP and currently RSI or MR (present but not available for
  // normal activities). RSO (report sick OUTSIDE) and STATUS/LD/excuse are
  // deliberately excluded (resolves open §20.7, DECISIONS #42). See
  // bpIsNotAvailable in braves-parade.js. Strength-by-rank-group replaces
  // Cougar's platoon-by-platoon breakdown (§16).
  const notAvailable = scoped.filter(r => bpIsNotAvailable(r, today)).length;
  // In Camp = the §8 classifier's CURRENT STRENGTH for this scope (same math
  // the parade-state message uses) — NOT a simplified MC/Warded-only guess.
  const grpStrength = bpStrength(scoped, today);
  const inCamp = grpStrength.current;
  const grpLine = g => `${grpStrength.groups[g].cur}/${grpStrength.groups[g].tot}`;

  // R/C breakdown — only shown when scope is "All". Helps reproduce the
  // parade-state-style "PLATOON x: y/z … COMMANDERS: a/b" split in one
  // glance without forcing a separate Commanders card.
  const isAll = !STATE.filterRole;
  const recRows = scoped.filter(r => r.role !== "Commander");
  const cmdRows = scoped.filter(r => r.role === "Commander");
  const recLive = liveRows.filter(r => r.role !== "Commander");
  const cmdLive = liveRows.filter(r => r.role === "Commander");
  const recActive = recRows.length - recLive.length;
  const cmdActive = cmdRows.length - cmdLive.length;
  const recInCamp = bpStrength(recRows, today).current;
  const cmdInCamp = bpStrength(cmdRows, today).current;
  // Inline "total/recruits/commanders" — the /R/C portion renders smaller
  // and dimmer so the headline number stays pronounced. Hidden when scope
  // is already narrowed to one role.
  const inlineBreakdown = (rec, cmd) => isAll
    ? `<span style="font-size:55%;color:var(--muted);font-weight:400;margin-left:1px">/${rec}/${cmd}</span>`
    : "";

  // Feature 4 — defer Chart.js construction on mobile (the jank source). Tiles
  // and tables above still render immediately; charts wait for a tap.
  const deferActive = shouldDeferCharts();

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;flex-wrap:wrap">
      <h2 style="font-size:18px;font-weight:700">Company Strength Board</h2>
      <div class="dropdown-wrapper">
        <button class="btn btn-primary" onclick="toggleReportMenu(event)">📋 Generate Report ▾</button>
        <div id="report-menu" class="dropdown-menu hidden">
          <button type="button" onclick="openReportModal('RS'); closeReportMenu()">🤒 RS Format (Sick Report)</button>
          <button type="button" onclick="openReportModal('RSIP'); closeReportMenu()">🤒 RSI Personnel (by Platoon)</button>
          <button type="button" onclick="openReportModal('MED'); closeReportMenu()">🏥 Medical Status List</button>
          <button type="button" onclick="openReportModal('MSK'); closeReportMenu()">🦵 MSK Report</button>
          <button type="button" onclick="openReportModal('CONDUCT'); closeReportMenu()">📊 Per-Conduct Chat Format</button>
        </div>
      </div>
    </div>
    ${scopeBanner}
    <div class="stats-row" style="margin-top:12px">
      <div class="stat"><label>Total Str</label><div class="val">${scoped.length}${inlineBreakdown(recRows.length, cmdRows.length)}</div></div>
      <div class="stat"><label>Active today</label><div class="val" style="color:var(--green)">${active}${inlineBreakdown(recActive, cmdActive)}</div></div>
      <div class="stat"><label>Non-Active</label><div class="val" style="color:var(--red)">${liveRows.length}${inlineBreakdown(recLive.length, cmdLive.length)}</div></div>
      <div class="stat"><label>In Camp</label><div class="val" style="color:var(--teal)">${inCamp}${inlineBreakdown(recInCamp, cmdInCamp)}</div></div>
      <div class="stat" title="Includes personnel in camp who are currently RSI or MR — physically present but not available for normal activities (§16). RSO and STATUS/LD/excuse are excluded."><label>Not Available <span style="cursor:help;color:var(--dim);font-weight:400" title="Includes personnel in camp who are currently RSI or MR — physically present but not available for normal activities (§16). RSO and STATUS/LD/excuse are excluded.">ⓘ</span></label><div class="val" style="color:var(--purple)">${notAvailable}</div></div>
      <div class="stat"><label>Avg Part.${isFilterActive() ? ` <span style="color:var(--dim);font-weight:400">(${filterLabel()})</span>` : ` <span style="color:var(--dim);font-weight:400">(Company)</span>`}</label><div class="val" style="color:var(--accent)" title="${isFilterActive() ? `Scoped to ${filterLabel()} across ${_part.conducts} conduct(s)` : "Entire company average"}">${avgPart}%</div></div>
    </div>
    <div class="card" style="padding:10px 16px;margin-top:10px">
      <h3 style="font-size:13px;color:var(--muted);margin-bottom:6px">Strength by Rank Group <span style="font-weight:400;color:var(--dim)">(current/total in scope — §16)</span></h3>
      <div style="display:flex;gap:20px;flex-wrap:wrap;font-family:var(--mono);font-size:13px">
        <div>[OFFICER] <strong style="color:var(--text)">${grpLine("Officer")}</strong></div>
        <div>[WOSPEC] <strong style="color:var(--text)">${grpLine("WOSPEC")}</strong></div>
        <div>[ENLISTEE] <strong style="color:var(--text)">${grpLine("Enlistee")}</strong></div>
      </div>
    </div>
    ${renderDashAppointments(visible, today)}
    <div class="grid-2" id="dash-charts"${deferActive ? ' style="display:none"' : ''}>
      <div class="card"><h3>Status Breakdown (today)</h3><canvas id="chart-status" height="200"></canvas></div>
      <div class="card"><h3>Participation Trend</h3><canvas id="chart-participation" height="200"></canvas></div>
    </div>
    ${deferActive ? chartGateMarkup("loadDashboardCharts()", "dash-chart-gate") : ""}
    ${renderDashProfileCards(scoped)}
    <h3 style="font-size:13px;color:var(--muted);margin-bottom:8px">Non-Active Personnel <span style="color:var(--dim);font-weight:400">(live medical status on ${today})</span></h3>
    ${liveRows.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th style="text-align:left">Name</th><th style="text-align:left">Status today</th><th style="text-align:left">Reason</th><th style="text-align:left">Duration</th></tr></thead><tbody>
    ${liveRows.map(r => {
      const entry = allByD4[r.id];
      const multi = entry.statuses.length > 1;
      // Stack badges, reasons, and durations vertically so each cell aligns
      // row-by-row across the three columns when a recruit has 2+ statuses.
      const tagsCell = entry.statuses.map(s => `<div style="padding:2px 0">${medTagBadge(s.tag)}</div>`).join("");
      const reasonsCell = entry.statuses.map(s => `<div style="padding:2px 0">${s.record.reason ? escapeHTML(s.record.reason) : '<span style="color:var(--dim)">—</span>'}</div>`).join("");
      const durationsCell = entry.statuses.map(s => `<div style="padding:2px 0">${escapeHTML(medDurationLabel(s.record))}</div>`).join("");
      const multiHint = multi ? ` <span style="font-size:9px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:.5px">×${entry.statuses.length}</span>` : "";
      return `<tr onclick="openPerson('${r.id}')" style="cursor:pointer"><td class="mono" style="font-weight:700;color:var(--accent);vertical-align:top">${displayId(r.id)}</td><td style="text-align:left;vertical-align:top">${escapeHTML(displayPersonLabel(r.id))}${multiHint}</td><td style="text-align:left;vertical-align:top">${tagsCell}</td><td style="text-align:left;font-size:11px;vertical-align:top">${reasonsCell}</td><td style="text-align:left;font-size:11px;color:var(--muted);vertical-align:top">${durationsCell}</td></tr>`;
    }).join("")}
    </tbody></table></div>` : `<div class="empty-state" style="padding:16px;font-size:12px">All scoped personnel are Active today.</div>`}
    ${recoveringRows.length ? `<h3 style="font-size:13px;color:var(--muted);margin:16px 0 8px">Recovering <span style="color:var(--dim);font-weight:400">(post-MC/LD ghost tag — back to training but monitor)</span></h3>
    <div class="table-wrap"><table><thead><tr><th>4D</th><th style="text-align:left">Name</th><th style="text-align:left">Tag</th><th style="text-align:left">Original</th><th style="text-align:left">Cleared</th></tr></thead><tbody>
    ${recoveringRows.map(r => {
      const entry = allByD4[r.id];
      const tagsCell = entry.statuses.map(s => `<div style="padding:2px 0">${medTagBadge(s.tag)}</div>`).join("");
      const originalCell = entry.statuses.map(s => `<div style="padding:2px 0">${escapeHTML(s.record.status)} · ${escapeHTML(s.record.reason || '')}</div>`).join("");
      const clearedCell = entry.statuses.map(s => `<div style="padding:2px 0">${s.record.endDate || ''}</div>`).join("");
      return `<tr onclick="openPerson('${r.id}')" style="cursor:pointer"><td class="mono" style="font-weight:700;color:var(--accent);vertical-align:top">${displayId(r.id)}</td><td style="text-align:left;vertical-align:top">${escapeHTML(displayPersonLabel(r.id))}</td><td style="text-align:left;vertical-align:top">${tagsCell}</td><td style="text-align:left;font-size:11px;color:var(--muted);vertical-align:top">${originalCell}</td><td style="text-align:left;font-size:11px;color:var(--muted);vertical-align:top">${clearedCell}</td></tr>`;
    }).join("")}
    </tbody></table></div>` : ""}
    ${renderDashMSKCases(visible)}
    ${renderDashLeaveOut(visible, today)}`;

  // Status Breakdown chart: tally every active status (a recruit on MC +
  // Excuse contributes once to each slice). The "Active" slice is per-recruit
  // so it adds up to roster size only when nobody has stacked statuses.
  const statusCounts = { Active: active };
  effectiveAll.forEach(e => e.statuses.forEach(s => { statusCounts[s.tag] = (statusCounts[s.tag] || 0) + 1; }));
  const buildDashboardCharts = () => {
  const chartColor = label => {
    if (label === "Active") return "#3FB950";
    if (label === "MC" || label === "Warded") return "#F85149";
    if (label === "LD" || label === "MC+1") return "#D29922";
    if (label === "LD+1" || label === "MC+2") return "#E3B341";
    if (label === "RMJ" || (typeof label === "string" && label.startsWith("Excuse"))) return "#58A6FF";
    return "#8B949E";
  };
  STATE.charts.status = new Chart(document.getElementById("chart-status"), {
    type: "doughnut",
    data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: Object.keys(statusCounts).map(chartColor) }] },
    options: { plugins: { legend: { position: "right", labels: { color: "#8B949E", font: { size: 11 } } } } }
  });

  // Participation trend — a smooth line whose color ENCODES participation
  // health using the same thresholds as the attendance table: green ≥95%
  // (healthy), amber ≥70% (watch), red <70% (problem). Each point is colored
  // by its own rate; each segment takes the color of the rate it descends/rises
  // INTO, so the eye is drawn to where participation drops into a bad conduct.
  // Plot chronologically — oldest conduct on the left, newest on the right.
  const partRows = [...STATE.attendance].sort((a, b) => {
    const ai = displayDateToISO(a.date) || a.date || "";
    const bi = displayDateToISO(b.date) || b.date || "";
    if (ai !== bi) return ai < bi ? -1 : 1;
    return (a.time || "") < (b.time || "") ? -1 : 1;
  });
  const partData = partRows.map(a => pct(a.participating, a.total));
  const rateColorHex = r => r >= 95 ? "#3FB950" : r >= 70 ? "#D29922" : "#F85149";
  const partColors = partData.map(rateColorHex);
  STATE.charts.participation = new Chart(document.getElementById("chart-participation"), {
    type: "line",
    data: { labels: partRows.map(a => conductName(a.conductId).slice(0, 12)), datasets: [{
      data: partData,
      borderColor: "#8B949E",
      borderWidth: 2,
      tension: 0.35,
      fill: false,
      pointRadius: 4,
      pointHoverRadius: 7,
      pointBackgroundColor: partColors,
      pointBorderColor: partColors,
      // Color each segment by the rate it lands on (the later point), so a drop
      // into a weak conduct turns the descending line red/amber.
      segment: { borderColor: ctx => rateColorHex(partData[ctx.p1DataIndex]) }
    }] },
    // No fixed min/max — let the axis auto-scale around the data so dips below
    // 80% are visible instead of being clipped off the bottom.
    options: { plugins: { legend: { display: false } }, scales: { y: { grace: "10%", grid: { color: "#30363D" }, ticks: { color: "#8B949E" } }, x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 9 } } } } }
  });
  }; // buildDashboardCharts
  if (deferActive) _deferredBuilders["dash-chart-gate"] = buildDashboardCharts; else buildDashboardCharts();
}

// ── Deferred-content gate (Feature 4) ────────────────────────────────────────
// Heavy DOM / Chart.js construction is deferred behind a "Load" affordance when
// shouldDeferCharts() is true (mobile, or explicit pref). Each deferrable block
// has a UNIQUE gateId + container id so multiple gated blocks never collide on a
// shared element id; the build closure is stashed in _deferredBuilders[gateId]
// and run once on tap. render() clears the registry wholesale so a builder for an
// abandoned view can't leak its captured scope or fire against stale DOM.
let _deferredBuilders = {};
function chartGateMarkup(onclickExpr, gateId, label) {
  return `<div class="card" id="${gateId || "chart-gate"}" style="text-align:center;padding:18px;margin-top:10px">
    <button class="btn btn-primary" onclick="${onclickExpr}">${label || "📊 Load charts"}</button>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">Deferred for a faster load${window.innerWidth <= 768 ? " on mobile" : ""}. <a href="#" onclick="setChartPref('eager');return false" style="color:var(--accent)">Always load</a></div>
  </div>`;
}
// Reveal a hidden container, remove its gate, and run its stashed builder once.
function runDeferred(containerId, gateId) {
  const g = document.getElementById(containerId); if (g) g.style.display = "";
  const gate = document.getElementById(gateId); if (gate) gate.remove();
  const b = _deferredBuilders[gateId];
  if (b) { delete _deferredBuilders[gateId]; b(); }
}
function loadDashboardCharts() { runDeferred("dash-charts", "dash-chart-gate"); }
function loadConductDashCharts() { runDeferred("cd-charts", "cd-chart-gate"); }
// Change the lazy-load preference (auto|defer|eager) and re-render the view.
function setChartPref(mode) { setDeferCharts(mode); render(); }

// Auto-defer keys off window.innerWidth, which only changes on resize/rotate.
// Re-render when the defer decision actually flips across the 768px breakpoint so
// a mobile→desktop (or rotate) transition reflects the new mode instead of being
// stuck behind a gate (or showing an unwanted gate) until an unrelated re-render.
// Debounced; no-op while the decision is unchanged.
if (typeof window !== "undefined") {
  let _lastDefer = shouldDeferCharts(), _deferResizeT = null;
  window.addEventListener("resize", () => {
    clearTimeout(_deferResizeT);
    _deferResizeT = setTimeout(() => {
      const now = shouldDeferCharts();
      if (now !== _lastDefer) { _lastDefer = now; render(); }
    }, 200);
  });
}

// Active MSK Cases — recruits who self-reported an injury via the Google
// Form ("Cougar MSK / Physio Log"). One card per recruit, aggregating
// their initial injury text, any physio appointment we have on file, and
// the timeline of exercises they've logged. Cleared cases are hidden by
// default behind a toggle.
function renderDashMSKCases(visible) {
  const scoped = STATE.msk.filter(m => passesFilter(m.d4, visible));
  if (!scoped.length) return "";

  // Group by d4. Per-d4: active if ANY row is not cleared. Cleared if all
  // are cleared.
  const byD4 = {};
  scoped.forEach(m => { (byD4[m.d4] = byD4[m.d4] || []).push(m); });

  const cases = Object.entries(byD4).map(([d4, rows]) => {
    const allCleared = rows.every(r => r.cleared);
    const injuries = rows.filter(r => (r.type || "").toLowerCase().includes("report"));
    const exercises = rows.filter(r => (r.type || "").toLowerCase().includes("log") || (r.type || "").toLowerCase().includes("exercise"));
    // Latest injury report as the headline; sort by timestamp desc.
    const tsOf = r => String(r.timestamp || r.Timestamp || "");
    const latestInjury = [...injuries].sort((a, b) => tsOf(a) < tsOf(b) ? 1 : -1)[0];
    const orderedExercises = [...exercises].sort((a, b) => tsOf(a) < tsOf(b) ? 1 : -1);
    return { d4, rows, allCleared, latestInjury, orderedExercises };
  });

  const active = cases.filter(c => !c.allCleared);
  const cleared = cases.filter(c => c.allCleared);

  const renderCard = (c, faded) => {
    const upcomingAppts = STATE.appointments.filter(a =>
      a.d4 === c.d4 && !a.resolved && (displayDateToISO(a.date) || "") >= todayISO()
    );
    const apptLine = upcomingAppts.length
      ? upcomingAppts.map(a => `<div style="font-size:11px;color:var(--accent)">📅 ${a.date}${a.time ? ` @ ${fmtHrs(a.time)}` : ""} — ${escapeHTML(a.reason || "")} <span style="color:var(--muted)">(${escapeHTML(a.location || "")})</span></div>`).join("")
      : `<div style="font-size:11px;color:var(--dim)">No physio appointment scheduled yet.</div>`;

    const injuryLine = c.latestInjury
      ? `<div style="font-size:12px"><span style="color:var(--muted)">Injury:</span> ${escapeHTML(c.latestInjury.description || "")}</div>`
      : `<div style="font-size:12px;color:var(--dim)">No injury description on file.</div>`;

    // Body region chips — auto-classified by default, sergeant can re-tag
    // by clicking the pencil. Stored on the latest Report Injury row.
    const regions = c.latestInjury ? getMSKRegionsForRecruit(c.d4) : [];
    const regionsLine = c.latestInjury ? `<div style="margin-top:4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">
      ${regions.map(reg => `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}22;color:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}">${escapeHTML(reg)}</span>`).join("")}
      <button class="btn btn-icon" onclick="event.stopPropagation(); openMSKRegionMenu('${c.d4}')" title="Re-tag body regions" style="font-size:9px;padding:1px 6px">✎ tag</button>
    </div>` : "";

    const exercises = c.orderedExercises.length
      ? `<div style="margin-top:6px"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Physio visits (${c.orderedExercises.length})</div>${c.orderedExercises.map(e => {
          const d = e.physioDate || e.timestamp || "";
          const exText = e.exercises ? ` — ${escapeHTML(e.exercises)}` : ` <span style="color:var(--dim)">(no new exercises)</span>`;
          return `<div style="font-size:11px;padding:4px 6px;background:var(--bg);border-left:2px solid var(--teal);margin-bottom:3px"><span class="mono" style="color:var(--muted);font-size:10px">${d}</span>${exText}</div>`;
        }).join("")}</div>`
      : `<div style="font-size:11px;color:var(--dim);margin-top:6px">No physio visits logged yet.</div>`;

    return `<div class="card" style="padding:12px;${faded ? 'opacity:.55;' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
        <div onclick="openPerson('${c.d4}')" style="cursor:pointer;font-weight:700">${displayId(c.d4) ? `<span class="mono" style="color:var(--accent);margin-right:6px">${displayId(c.d4)}</span>` : ""}${escapeHTML(displayPersonLabel(c.d4))} <span class="badge badge-pink" style="font-size:9px;margin-left:4px">🦵 MSK</span></div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn" style="font-size:10px;padding:3px 8px" onclick="openAppointmentForm(null, {d4:'${c.d4}', reason:'Physio review', location:'Physio Centre'})" title="Book a physio appointment for this recruit">📅 Book</button>
          <button class="btn ${c.allCleared ? 'btn-success' : ''}" style="font-size:10px;padding:3px 8px" onclick="toggleMSKCleared('${c.d4}')" title="${c.allCleared ? 'Reopen this case' : 'Mark this case cleared (hides from active list)'}">${c.allCleared ? '↺ Reopen' : '✓ Mark Cleared'}</button>
        </div>
      </div>
      ${injuryLine}
      ${regionsLine}
      ${apptLine}
      ${exercises}
    </div>`;
  };

  // Scrollable container — caps height so the MSK section doesn't push
  // the rest of the dashboard off-screen as cases accumulate. About 3
  // cards visible at a time; scroll for more.
  const activeCards = active.length
    ? `<div style="max-height:560px;overflow-y:auto;padding-right:6px;border:1px solid var(--border);border-radius:8px;background:var(--surface)"><div style="display:flex;flex-direction:column;gap:10px;padding:10px">${active.map(c => renderCard(c, false)).join("")}</div></div>`
    : `<div class="empty-state" style="padding:12px;font-size:11px">No active MSK cases.</div>`;

  const clearedSection = cleared.length
    ? `<div style="margin-top:12px"><button class="btn" style="font-size:11px" onclick="toggleMSKShowCleared()">${_mskShowCleared ? "▾ Hide" : "▸ Show"} cleared (${cleared.length})</button>${_mskShowCleared ? `<div style="max-height:400px;overflow-y:auto;padding-right:6px;margin-top:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface)"><div style="display:flex;flex-direction:column;gap:10px;padding:10px">${cleared.map(c => renderCard(c, true)).join("")}</div></div>` : ""}</div>`
    : "";

  return `<h3 style="font-size:13px;color:var(--muted);margin:16px 0 8px">🦵 Active MSK Cases <span style="color:var(--dim);font-weight:400">(${active.length}${cleared.length ? ` active · ${cleared.length} cleared` : ""}) <span style="font-size:10px;font-style:italic;color:var(--dim)">— scroll to see all</span></span></h3>
    ${activeCards}
    ${clearedSection}`;
}

// ── MSK ANALYTICS PAGE ───────────────────────────────────
// Full-page injury aggregation: daily impact, region breakdown, most-
// affected personnel. Answers the CO's "how many injured and what kind?"
// at a glance. Date range pickers default to last 14 days; topbar scope
// filter narrows the population.
let _mskAnalyticsStart = "";
let _mskAnalyticsEnd = "";
const _mskAnalyticsCharts = {};

function setMSKAnalyticsRange() {
  _mskAnalyticsStart = gv("msk-an-start");
  _mskAnalyticsEnd = gv("msk-an-end");
  render();
}

// Drill-in: show all recruits currently classified under a body region,
// with the underlying source text (Form report + conductDetail reasons)
// so the sergeant can see WHY each one landed there. Especially useful
// for the "Other" bucket — surfaces injuries the auto-classifier couldn't
// tag, with a one-click Re-tag button to fix manually.
function viewMSKRegion(region) {
  const startIso = _mskAnalyticsStart;
  const endIso = _mskAnalyticsEnd;
  const visible = visibleD4Set();

  const inWindowReport = m => {
    if ((m.type || "").toLowerCase().indexOf("report") < 0) return false;
    if (!passesFilter(m.d4, visible)) return false;
    const iso = displayDateToISO(m.timestamp) || String(m.timestamp || "").slice(0, 10);
    return iso && iso >= startIso && iso <= endIso;
  };
  const inWindowCD = c => {
    if (!passesFilter(c.d4, visible)) return false;
    const iso = displayDateToISO(c.date);
    return iso && iso >= startIso && iso <= endIso && isMSKReason(c.reason);
  };

  // All d4s ever affected in this window
  const affectedD4s = new Set([
    ...STATE.msk.filter(inWindowReport).map(m => m.d4),
    ...STATE.conductDetail.filter(inWindowCD).map(c => c.d4)
  ]);

  // Keep only those whose resolved regions include this one
  const matching = [...affectedD4s].filter(d4 => getMSKRegionsForRecruit(d4).includes(region));

  // Gather source text per recruit so sergeant can see WHY they were classified.
  const cards = matching.map(d4 => {
    const reports = STATE.msk.filter(m => m.d4 === d4 && (m.type || "").toLowerCase().includes("report"));
    const cdRows = STATE.conductDetail.filter(c => c.d4 === d4 && isMSKReason(c.reason));
    const hasManual = reports.some(r => r.manualRegions && String(r.manualRegions).trim());
    const sources = [
      ...reports.map(r => ({ kind: "Form report", text: r.description || "—", color: "#E97BC2" })),
      ...cdRows.map(c => ({ kind: c.type, text: c.reason || "—", color: c.type === "Status" ? "#5B8DEF" : c.type === "PXP" ? "#39D2C0" : c.type === "Fallout" ? "#E8573A" : "#F2A93B" }))
    ];
    const allRegions = getMSKRegionsForRecruit(d4);
    return { d4, sources, allRegions, hasManual };
  });

  const regionChipsHtml = regs => regs.map(reg => `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}22;color:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}">${escapeHTML(reg)}</span>`).join(" ");

  const body = `
    <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:10px;line-height:1.55">
      <strong style="color:${MSK_REGION_COLORS[region]}">${escapeHTML(region)}</strong> — ${matching.length} recruit${matching.length === 1 ? "" : "s"} classified${region === "Other" ? ". 'Other' means the keyword classifier couldn't tag them automatically — click <strong>Re-tag</strong> to fix manually." : ". Sources below show why each recruit was tagged."}
    </div>
    ${cards.length ? `<div style="display:flex;flex-direction:column;gap:8px;max-height:480px;overflow-y:auto;padding-right:4px">
      ${cards.map(c => `<div style="padding:10px 12px;background:var(--surface2);border-radius:6px;border-left:3px solid ${MSK_REGION_COLORS[region]}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <div style="display:flex;gap:8px;align-items:center">
            <span class="mono" style="color:var(--accent);font-weight:700">${displayId(c.d4)}</span>
            <span style="font-weight:600">${escapeHTML(displayPersonLabel(c.d4))}</span>
            ${c.hasManual ? '<span style="font-size:9px;color:var(--green);text-transform:uppercase;letter-spacing:.5px">Manual override</span>' : ""}
          </div>
          <button class="btn" style="font-size:10px;padding:3px 8px" onclick="openMSKRegionMenu('${c.d4}')">✎ Re-tag</button>
        </div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Source text</div>
        <div style="display:flex;flex-direction:column;gap:3px">
          ${c.sources.length ? c.sources.map(s => `<div style="font-size:11px;padding:4px 8px;background:var(--bg);border-left:2px solid ${s.color};border-radius:3px"><span style="color:${s.color};font-weight:600;font-size:10px">[${escapeHTML(s.kind)}]</span> ${escapeHTML(s.text)}</div>`).join("") : `<div style="font-size:11px;color:var(--dim)">No source text on file.</div>`}
        </div>
        <div style="margin-top:6px;font-size:10px;color:var(--muted)">All regions: ${regionChipsHtml(c.allRegions)}</div>
      </div>`).join("")}
    </div>` : `<div class="empty-state" style="padding:12px;font-size:12px">No recruits classified under this region in the current window.</div>`}
  `;

  openModal(`Region drill-in — ${escapeHTML(region)}`, body);
  document.querySelector(".modal")?.classList.add("wide");
}

function renderMSKAnalytics(el) {
  const today = todayISO();
  if (!_mskAnalyticsStart) {
    const d = new Date(today); d.setDate(d.getDate() - 13);
    _mskAnalyticsStart = d.toISOString().slice(0, 10);
  }
  if (!_mskAnalyticsEnd) _mskAnalyticsEnd = today;
  const startIso = _mskAnalyticsStart;
  const endIso = _mskAnalyticsEnd;

  // Scope: respect topbar role/platoon filter for which d4s count.
  const visible = visibleD4Set();

  // Build the date axis (every day from start to end inclusive).
  const dates = [];
  {
    const d0 = new Date(startIso), d1 = new Date(endIso);
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  const dateLabels = dates.map(iso => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  });

  // Filter conductDetail to MSK-only rows in scope + window.
  const mskConductRows = STATE.conductDetail.filter(c => {
    if (!passesFilter(c.d4, visible)) return false;
    const iso = displayDateToISO(c.date);
    if (!iso || iso < startIso || iso > endIso) return false;
    return isMSKReason(c.reason);
  });

  // Daily aggregation — unique d4s per type per day.
  const daily = dates.map(iso => {
    const dayRows = mskConductRows.filter(c => displayDateToISO(c.date) === iso);
    const px = new Set(dayRows.filter(c => c.type === "Status").map(c => c.d4));
    const fo = new Set(dayRows.filter(c => c.type === "Fallout").map(c => c.d4));
    const rsi = new Set(dayRows.filter(c => c.type === "RSI").map(c => c.d4));
    const total = new Set([...px, ...fo, ...rsi]);
    return { iso, px: px.size, fo: fo.size, rsi: rsi.size, total: total.size };
  });

  // Injury reports (STATE.msk type=Report Injury) in scope + window.
  const reportRows = STATE.msk.filter(m => {
    if ((m.type || "").toLowerCase().indexOf("report") < 0) return false;
    if (!passesFilter(m.d4, visible)) return false;
    const iso = displayDateToISO(m.timestamp) || String(m.timestamp || "").slice(0, 10);
    return iso && iso >= startIso && iso <= endIso;
  });
  // Unique injured personnel — union of Form reporters AND recruits who
  // appeared in MSK-classified conductDetail rows in this window. Closes
  // the gap where someone who falls out due to MSK at PT but never fills
  // the Form would be missing from the region breakdown.
  const injuredD4s = new Set([
    ...reportRows.map(r => r.d4),
    ...mskConductRows.map(c => c.d4)
  ]);

  // Region counts — unique recruits per region. Manual override wins.
  // getMSKRegionsForRecruit now also unions in regions derived from
  // conductDetail reasons, so no recruit gets dropped silently.
  const regionToRecruits = {};
  injuredD4s.forEach(d4 => {
    const regions = getMSKRegionsForRecruit(d4);
    regions.forEach(reg => {
      (regionToRecruits[reg] = regionToRecruits[reg] || new Set()).add(d4);
    });
  });
  const regionCounts = Object.entries(regionToRecruits)
    .map(([region, set]) => ({ region, count: set.size }))
    .sort((a, b) => b.count - a.count);

  // Personnel frequency from conductDetail (entries, not unique conducts).
  const freq = {};
  mskConductRows.forEach(c => {
    if (!freq[c.d4]) freq[c.d4] = { d4: c.d4, count: 0, types: new Set() };
    freq[c.d4].count++;
    freq[c.d4].types.add(c.type);
  });
  const ranked = Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 15);
  const maxRanked = ranked[0]?.count || 1;

  // Chronic = has Report Injury AND ≥3 MSK conductDetail entries.
  const chronic = [...injuredD4s]
    .filter(d4 => (freq[d4]?.count || 0) >= 3)
    .map(d4 => ({ d4, count: freq[d4].count, regions: getMSKRegionsForRecruit(d4) }))
    .sort((a, b) => b.count - a.count);

  const regionChip = reg => `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}22;color:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other};margin-right:3px">${escapeHTML(reg)}</span>`;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <div style="min-width:0;flex:1 1 200px">
        <h2 style="font-size:18px;font-weight:700">📊 MSK Analytics${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}]</span>` : ""}</h2>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Musculoskeletal injuries — sourced from MSK form reports + conduct detail rows filtered by injury keywords.</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;font-size:11px;flex-wrap:wrap;flex:1 1 220px;justify-content:flex-end">
        <span style="color:var(--muted)">Window:</span>
        <input id="msk-an-start" type="date" value="${escapeAttr(startIso)}" onchange="setMSKAnalyticsRange()" class="topbar-select" style="min-width:130px;flex:1 1 130px">
        <span style="color:var(--muted)">→</span>
        <input id="msk-an-end" type="date" value="${escapeAttr(endIso)}" onchange="setMSKAnalyticsRange()" class="topbar-select" style="min-width:130px;flex:1 1 130px">
      </div>
    </div>

    <div class="stats-row">
      <div class="stat"><label>Injured personnel</label><div class="val" style="color:var(--red)">${injuredD4s.size}</div></div>
      <div class="stat"><label>MSK log entries</label><div class="val" style="color:var(--orange)">${mskConductRows.length}</div></div>
      <div class="stat"><label>Injury regions</label><div class="val" style="color:var(--accent)">${regionCounts.length}</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>Daily MSK Impact</h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px;line-height:1.55">
        Unique personnel affected per day, MSK cases only. Stacked by category:<br>
        <span style="color:#5B8DEF;font-weight:600">■ Status</span> = pre-existing medical/excuse status before the conduct ·
        <span style="color:#E8573A;font-weight:600">■ Fallout</span> = dropped out during the conduct ·
        <span style="color:#F2A93B;font-weight:600">■ RSI</span> = reported sick at first parade
      </div>
      <div class="chart-box tall"><canvas id="msk-daily-bar"></canvas></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>Total Affected Trend</h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Unique MSK cases per day across all types.</div>
      <div class="chart-box"><canvas id="msk-trend-line"></canvas></div>
    </div>

    <div class="grid-2" style="margin-bottom:14px">
      <div class="card">
        <h3>Injuries by Region <span style="color:var(--dim);font-weight:400;font-size:10px">— click any slice to drill in</span></h3>
        <div class="chart-box"><canvas id="msk-region-donut"></canvas></div>
      </div>
      <div class="card">
        <h3>Personnel per Region <span style="color:var(--dim);font-weight:400;font-size:10px">— click any bar to drill in</span></h3>
        <div class="chart-box"><canvas id="msk-region-bar"></canvas></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>Reported Injuries Detail <span style="color:var(--dim);font-weight:400;font-size:11px">(${reportRows.length})</span></h3>
      ${reportRows.length ? `<div style="display:flex;flex-direction:column;gap:4px">
        ${reportRows.sort((a, b) => (a.timestamp || "") < (b.timestamp || "") ? 1 : -1).map(r => {
          const regions = getMSKRegionsForRecruit(r.d4);
          return `<div onclick="openMSKRegionMenu('${r.d4}')" style="cursor:pointer;font-size:12px;padding:8px 10px;background:var(--surface2);border-radius:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="mono" style="color:var(--accent);font-weight:700">${displayId(r.d4)}</span>
            <span style="font-weight:600">${escapeHTML(displayPersonLabel(r.d4))}</span>
            <span style="flex:1 1 200px;min-width:0;color:var(--muted)">${escapeHTML(r.description || "")}</span>
            <span style="display:flex;flex-wrap:wrap;gap:3px">${regions.map(regionChip).join("")}</span>
          </div>`;
        }).join("")}
      </div>` : `<div style="color:var(--muted);font-size:12px">No injury reports in this window.</div>`}
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>Most Affected Personnel</h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Ranked by MSK-related conduct detail entries (Status / Fallout / RSI).</div>
      ${ranked.length ? `<div style="display:flex;flex-direction:column;gap:4px">
        ${ranked.map((p, i) => `<div onclick="openPerson('${p.d4}')" style="cursor:pointer;font-size:11px;padding:6px 8px;background:var(--surface2);border-radius:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="color:var(--orange);font-weight:700;min-width:22px;text-align:right">${i + 1}</span>
          <span class="mono" style="color:var(--accent);font-weight:700">${displayId(p.d4)}</span>
          <span style="flex:1 1 110px;min-width:0">${escapeHTML(displayPersonLabel(p.d4))}</span>
          <div style="flex:2 1 140px;min-width:80px;height:14px;background:var(--bg);border-radius:3px;position:relative;overflow:hidden">
            <div style="position:absolute;inset:0 ${100 - (p.count / maxRanked) * 100}% 0 0;background:linear-gradient(90deg, var(--accent), var(--teal));opacity:.7"></div>
            <span style="position:absolute;left:6px;top:0;font-size:10px;font-weight:600;line-height:14px">${p.count}</span>
          </div>
          <span style="font-size:10px;color:var(--muted);text-align:right">${[...p.types].join(", ")}</span>
        </div>`).join("")}
      </div>` : `<div style="color:var(--muted);font-size:12px">No MSK log entries in this window.</div>`}
    </div>

    ${chronic.length ? `<div class="card">
      <h3>🚨 Chronic / Recurring Cases <span style="color:var(--dim);font-weight:400;font-size:11px">(${chronic.length})</span></h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Recruits with a reported injury AND ≥3 MSK conduct entries — needs ongoing attention.</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${chronic.map(c => `<div onclick="openPerson('${c.d4}')" style="cursor:pointer;font-size:12px;padding:8px 10px;background:var(--surface2);border-radius:6px;border-left:3px solid ${MSK_REGION_COLORS[c.regions[0]] || MSK_REGION_COLORS.Other};display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="mono" style="color:var(--accent);font-weight:700">${displayId(c.d4)}</span>
          <span style="flex:1 1 140px;min-width:0">${escapeHTML(displayPersonLabel(c.d4))}</span>
          <span class="mono" style="color:var(--red);font-weight:700">${c.count}× missed</span>
          <span style="display:flex;flex-wrap:wrap;gap:3px">${c.regions.map(regionChip).join("")}</span>
        </div>`).join("")}
      </div>
    </div>` : ""}
  `;

  // Render the charts after the canvases are in the DOM.
  setTimeout(() => {
    Object.values(_mskAnalyticsCharts).forEach(c => { try { c.destroy(); } catch (e) {} });

    // Shared axis styling — softer grid, no borders, integer ticks.
    const axisBase = {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 6, right: 4, bottom: 0, left: 0 } },
      plugins: {
        legend: { labels: { color: "#8B949E", font: { size: 11 }, padding: 12, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
        tooltip: { backgroundColor: "#161B22", borderColor: "#30363D", borderWidth: 1, padding: 10, titleColor: "#E6EDF3", bodyColor: "#E6EDF3", cornerRadius: 6, displayColors: true }
      },
      scales: {
        y: { beginAtZero: true, ticks: { color: "#8B949E", font: { size: 10 }, precision: 0, padding: 6 }, grid: { color: "#30363D55", drawTicks: false }, border: { display: false } },
        x: { ticks: { color: "#8B949E", font: { size: 10 }, maxRotation: 0, autoSkip: true, padding: 4 }, grid: { display: false }, border: { display: false } }
      }
    };

    // Stacked bar — bigger rounded corners on the top of each stack, no
    // borders. Tooltip shows the per-day breakdown + total.
    _mskAnalyticsCharts.daily = new Chart(document.getElementById("msk-daily-bar"), {
      type: "bar",
      data: { labels: dateLabels, datasets: [
        { label: "Status",        data: daily.map(d => d.px),  backgroundColor: "#5B8DEF", stack: "a", borderWidth: 0, borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.85 },
        { label: "Fallout",       data: daily.map(d => d.fo),  backgroundColor: "#E8573A", stack: "a", borderWidth: 0, borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.85 },
        { label: "RSI",           data: daily.map(d => d.rsi), backgroundColor: "#F2A93B", stack: "a", borderWidth: 0, borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.85 }
      ] },
      options: {
        ...axisBase,
        plugins: {
          ...axisBase.plugins,
          legend: { ...axisBase.plugins.legend, position: "bottom" },
          tooltip: {
            ...axisBase.plugins.tooltip,
            callbacks: {
              footer: (items) => {
                const total = items.reduce((s, i) => s + (i.parsed.y || 0), 0);
                return total ? `Total: ${total}` : "";
              }
            }
          }
        },
        scales: { ...axisBase.scales, x: { ...axisBase.scales.x, stacked: true }, y: { ...axisBase.scales.y, stacked: true } }
      }
    });

    _mskAnalyticsCharts.trend = new Chart(document.getElementById("msk-trend-line"), {
      type: "line",
      data: { labels: dateLabels, datasets: [{ label: "Total affected", data: daily.map(d => d.total), borderColor: "#43C59E", backgroundColor: "#43C59E33", tension: 0.35, fill: true, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: "#43C59E", pointBorderColor: "#0D1117", pointBorderWidth: 2, borderWidth: 2.5 }] },
      options: { ...axisBase, plugins: { ...axisBase.plugins, legend: { display: false } } }
    });

    if (regionCounts.length) {
      // Click handlers: drill into the region. Cursor changes on hover so
      // it's obvious slices/bars are interactive.
      const drillOnClick = (e, elements) => {
        if (elements.length) viewMSKRegion(regionCounts[elements[0].index].region);
      };
      const cursorOnHover = (e, elements) => {
        if (e.native) e.native.target.style.cursor = elements.length ? "pointer" : "default";
      };

      // Mobile: legend below the donut (right-side legend leaves no room
      // for the donut itself on narrow screens). Desktop: keep on right.
      const isMobile = window.innerWidth <= 768;
      _mskAnalyticsCharts.donut = new Chart(document.getElementById("msk-region-donut"), {
        type: "doughnut",
        data: { labels: regionCounts.map(r => r.region), datasets: [{ data: regionCounts.map(r => r.count), backgroundColor: regionCounts.map(r => MSK_REGION_COLORS[r.region] || MSK_REGION_COLORS.Other), borderWidth: 3, borderColor: "#161B22", hoverOffset: 8 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: "62%",
          onClick: drillOnClick, onHover: cursorOnHover,
          plugins: {
            legend: { position: isMobile ? "bottom" : "right", labels: { color: "#E6EDF3", font: { size: 11 }, padding: 10, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
            tooltip: { backgroundColor: "#161B22", borderColor: "#30363D", borderWidth: 1, padding: 10, cornerRadius: 6, callbacks: { label: c => `${c.label}: ${c.parsed} recruit${c.parsed === 1 ? "" : "s"} (click to drill in)` } }
          }
        }
      });

      // Horizontal bar — rounded right side, bigger bars, value labels via tooltip.
      _mskAnalyticsCharts.regionBar = new Chart(document.getElementById("msk-region-bar"), {
        type: "bar",
        data: { labels: regionCounts.map(r => r.region), datasets: [{ data: regionCounts.map(r => r.count), backgroundColor: regionCounts.map(r => MSK_REGION_COLORS[r.region] || MSK_REGION_COLORS.Other), borderWidth: 0, borderRadius: 6, borderSkipped: false, barPercentage: 0.7 }] },
        options: {
          responsive: true, maintainAspectRatio: false, indexAxis: "y",
          layout: { padding: { top: 4, right: 16, bottom: 0, left: 0 } },
          onClick: drillOnClick, onHover: cursorOnHover,
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: "#161B22", borderColor: "#30363D", borderWidth: 1, padding: 10, cornerRadius: 6, displayColors: false, callbacks: { label: c => `${c.parsed.x} recruit${c.parsed.x === 1 ? "" : "s"} (click to drill in)` } }
          },
          scales: {
            x: { beginAtZero: true, ticks: { color: "#8B949E", font: { size: 10 }, precision: 0, padding: 4 }, grid: { color: "#30363D55", drawTicks: false }, border: { display: false } },
            y: { ticks: { color: "#E6EDF3", font: { size: 11, weight: "600" }, padding: 6 }, grid: { display: false }, border: { display: false } }
          }
        }
      });
    }
  }, 50);
}

// Dashboard sub-widgets — kept separate from renderDashboard to keep the main
// function readable. Both respect the active scope filter via the `scoped`
// roster passed in.
// Upcoming appointments — anything dated today or later. Sheet retains the
// full history (past entries are not deleted, just filtered out of view here)
// so an admin can audit "did we make this appointment?" later. Sorted by
// date+time ascending so the next one is always at the top.
// Out today / This week widget — the dashboard equivalent of the WhatsApp
// parade-state OTHERS block. Anyone currently inside a leave/out date range
// shows up here; near-future entries are grouped under "This week".
function renderDashLeaveOut(visible, todayIso) {
  const sevenDaysOut = (() => {
    const d = new Date(todayIso); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const scoped = STATE.leave
    .filter(l => passesFilter(l.d4, visible))
    .map(l => ({ ...l, startIso: displayDateToISO(l.startDate) || "", endIso: displayDateToISO(l.endDate) || "" }))
    .filter(l => l.startIso && l.endIso);

  const onToday = scoped.filter(l => l.startIso <= todayIso && todayIso <= l.endIso);
  const upcoming = scoped.filter(l => l.startIso > todayIso && l.startIso <= sevenDaysOut);

  const typeColor = t => t === "Off-in-Lieu" ? "accent" : t === "Leave" ? "teal" : t === "Compassionate" ? "red" : t === "Weekend" ? "green" : t === "Night's Out" ? "pink" : t === "Course" ? "purple" : t === "Guard Duty" ? "orange" : t === "NDP" ? "yellow" : "muted";

  const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px">
    <h3 style="font-size:13px;color:var(--muted);margin:0">🪖 Out today / This week <span style="color:var(--dim);font-weight:400">(${onToday.length} now · ${upcoming.length} upcoming)</span></h3>
    <button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="openLeaveForm()">+ Log</button>
  </div>`;

  if (!onToday.length && !upcoming.length) {
    return header + `<div class="empty-state" style="padding:12px;font-size:11px;margin-bottom:12px">No commanders out today or in the next 7 days.</div>`;
  }

  const row = l => `<tr onclick="openPerson('${l.d4}')" style="cursor:pointer">
    <td style="text-align:left;font-weight:600">${escapeHTML(displayPersonLabel(l.d4))}</td>
    <td>${badge(l.type, typeColor(l.type))}${l.isInCamp ? ` ${badge("In Camp", "teal")}` : ""}${l.isInCampReviewed === false ? ` ${badge("⚠ Confirm In Camp", "orange")}` : ""}</td>
    <td style="white-space:nowrap;font-size:11px;color:var(--muted)">${l.startDate}${l.startIso !== l.endIso ? ` → ${l.endDate}` : ""}</td>
    <td style="text-align:left;font-size:11px;color:var(--muted)">${escapeHTML(l.reason || "")}</td>
    <td style="white-space:nowrap"><button class="btn btn-icon" onclick="event.stopPropagation(); openLeaveForm(${l.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('leave', ${l.id}, 'leave record')" title="Delete">✕</button></td>
  </tr>`;

  return header + `<div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th style="text-align:left">Name</th><th>Type</th><th>Dates</th><th style="text-align:left">Reason</th><th></th></tr></thead><tbody>
    ${onToday.map(row).join("")}
    ${upcoming.length ? `<tr><td colspan="5" style="padding:6px 8px;font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;background:var(--surface2)">Upcoming this week</td></tr>` : ""}
    ${upcoming.map(row).join("")}
  </tbody></table></div>`;
}

function renderLeave(el) {
  const visible = visibleD4Set();
  const today = todayISO();
  const scoped = STATE.leave
    .filter(l => passesFilter(l.d4, visible))
    .map(l => ({ ...l, startIso: displayDateToISO(l.startDate) || "", endIso: displayDateToISO(l.endDate) || "" }));

  const rows = [...scoped].sort((a, b) => {
    if (a.startIso !== b.startIso) return a.startIso < b.startIso ? 1 : -1;
    return 0;
  });

  const onTodayCount = scoped.filter(l => l.startIso <= today && today <= l.endIso).length;
  const titleSuffix = isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.leave.length}]</span>` : ` (${STATE.leave.length})`;

  const typeColor = t => t === "Off-in-Lieu" ? "accent" : t === "Leave" ? "teal" : t === "Compassionate" ? "red" : t === "Weekend" ? "green" : t === "Night's Out" ? "pink" : t === "Course" ? "purple" : t === "Guard Duty" ? "orange" : t === "NDP" ? "yellow" : "muted";

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="font-size:18px;font-weight:700">📅 Leave / Out${titleSuffix}</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-success" onclick="pushTab('Leave',STATE.leave)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="openLeaveForm()">+ Log</button>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><label>Total entries</label><div class="val">${scoped.length}</div></div>
      <div class="stat"><label>Out today</label><div class="val" style="color:var(--orange)">${onTodayCount}</div></div>
    </div>
    ${renderLeaveTimeline(scoped, today)}
    ${rows.length ? `<h3 style="font-size:13px;color:var(--muted);margin:16px 0 8px">All entries</h3><div class="table-wrap"><table><thead><tr><th style="text-align:left">Name</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th style="text-align:left">Reason</th><th></th></tr></thead><tbody>
    ${rows.map(l => `<tr onclick="openPerson('${l.d4}')" style="cursor:pointer"><td style="text-align:left;font-weight:600">${escapeHTML(displayPersonLabel(l.d4))}</td><td>${badge(l.type, typeColor(l.type))}${l.isInCamp ? ` ${badge("In Camp", "teal")}` : ""}${l.isInCampReviewed === false ? ` ${badge("⚠ Confirm In Camp", "orange")}` : ""}</td><td>${l.startDate || ""}</td><td>${l.endDate || ""}</td><td class="mono" style="font-weight:700">${l.days || ""}</td><td style="text-align:left;font-size:11px;color:var(--muted);max-width:240px;white-space:normal">${escapeHTML(l.reason || "")}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="event.stopPropagation(); openLeaveForm(${l.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('leave', ${l.id}, 'leave record')" title="Delete">✕</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">${STATE.leave.length ? `No leave records in ${filterLabel()}.` : "No leave records yet. Tap + Log to add one."}</div>`}`;
}

// Gantt-style 21-day timeline: each row a person with at least one leave
// overlapping the window, cells filled per-day with the leave type's color.
// Answers "who is taking off when" at a glance — much more useful than a
// running total of off-in-lieu days.
function renderLeaveTimeline(scoped, todayIso) {
  const TIMELINE_DAYS = 21;
  const start = new Date(todayIso);
  const days = Array.from({ length: TIMELINE_DAYS }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    return d;
  });
  const dayIso = days.map(d => d.toISOString().slice(0, 10));
  const windowEnd = dayIso[TIMELINE_DAYS - 1];

  const overlapping = scoped.filter(l => l.startIso && l.endIso && l.endIso >= todayIso && l.startIso <= windowEnd);
  if (!overlapping.length) {
    return `<div class="card" style="margin-bottom:12px"><h3>Leave Timeline <span style="color:var(--dim);font-weight:400;font-size:11px">(next ${TIMELINE_DAYS} days)</span></h3><div style="color:var(--muted);font-size:12px;padding:8px 0">No upcoming leave in the next ${TIMELINE_DAYS} days.</div></div>`;
  }

  // Group by person; sort people by earliest upcoming entry.
  const byPerson = {};
  overlapping.forEach(l => { (byPerson[l.d4] = byPerson[l.d4] || []).push(l); });
  const people = Object.keys(byPerson).sort((a, b) => {
    const aEarliest = byPerson[a].reduce((m, l) => l.startIso < m ? l.startIso : m, "9999");
    const bEarliest = byPerson[b].reduce((m, l) => l.startIso < m ? l.startIso : m, "9999");
    return aEarliest < bEarliest ? -1 : 1;
  });

  const typeBg = t => ({
    "Off-in-Lieu": "#58A6FF", "Leave": "#39D2C0", "Compassionate": "#F85149", "Weekend": "#3FB950", "Night's Out": "#F778BA",
    "Course": "#BC8CFF", "Guard Duty": "#D29922", "NDP": "#E3B341", "Other": "#8B949E"
  })[t] || "#8B949E";

  // Header: show the day-of-month for week boundaries + today marker.
  const headerCells = days.map((d, i) => {
    const isWeekStart = i === 0 || d.getDay() === 1;  // Monday
    const isToday = dayIso[i] === todayIso;
    const label = isWeekStart || i === 0 ? `${d.getDate()}/${d.getMonth() + 1}` : "";
    return `<th style="padding:2px 0;font-size:9px;color:${isToday ? 'var(--red)' : 'var(--muted)'};font-weight:${isToday ? 700 : 400};width:18px;text-align:center;border-left:${isWeekStart ? '1px solid var(--border)' : 'none'}">${label}</th>`;
  }).join("");

  const personRows = people.map(d4 => {
    const personLeave = byPerson[d4];
    const cells = dayIso.map((iso, i) => {
      const match = personLeave.find(l => l.startIso <= iso && iso <= l.endIso);
      const isToday = iso === todayIso;
      const isWeekStart = i === 0 || days[i].getDay() === 1;
      const borderLeft = isWeekStart ? '1px solid var(--border)' : 'none';
      if (match) {
        const isStart = iso === match.startIso;
        const isEnd = iso === match.endIso;
        const radius = `${isStart ? '3px' : '0'} ${isEnd ? '3px' : '0'} ${isEnd ? '3px' : '0'} ${isStart ? '3px' : '0'}`;
        return `<td style="padding:0;border-left:${borderLeft};height:18px" title="${escapeHTML(match.type)}${match.reason ? ': ' + escapeHTML(match.reason) : ''} (${match.startDate} → ${match.endDate})"><div style="background:${typeBg(match.type)};height:14px;margin:2px 0;border-radius:${radius};opacity:.85"></div></td>`;
      }
      const todayMark = isToday ? "background:#F8514922;" : "";
      return `<td style="padding:0;border-left:${borderLeft};${todayMark}height:18px"></td>`;
    }).join("");
    return `<tr onclick="openPerson('${d4}')" style="cursor:pointer"><td style="padding:3px 8px;white-space:nowrap;font-size:11px;font-weight:600;background:var(--surface);border-right:2px solid var(--border);position:sticky;left:0;z-index:1">${escapeHTML(displayPersonLabel(d4))}</td>${cells}</tr>`;
  }).join("");

  // Legend mirrors the type-color palette so users can decode the bars.
  const legend = ["Off-in-Lieu", "Leave", "Compassionate", "Weekend", "Night's Out", "Course", "Guard Duty", "NDP", "Other"]
    .map(t => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--muted)"><span style="width:10px;height:10px;background:${typeBg(t)};border-radius:2px;opacity:.85"></span>${t}</span>`)
    .join(" ");

  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Leave Timeline <span style="color:var(--dim);font-weight:400;font-size:11px">(next ${TIMELINE_DAYS} days · ${people.length} ${people.length === 1 ? 'person' : 'people'})</span></h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${legend}</div>
    </div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse"><thead><tr><th style="background:var(--surface);position:sticky;left:0;z-index:2"></th>${headerCells}</tr></thead><tbody>${personRows}</tbody></table></div>
  </div>`;
}

function renderDashAppointments(visible, todayIso) {
  const upcoming = STATE.appointments
    .filter(a => !a.resolved)
    .filter(a => passesFilter(a.d4, visible))
    .filter(a => {
      const iso = displayDateToISO(a.date);
      return iso && iso >= todayIso;
    })
    .sort((a, b) => {
      const ai = displayDateToISO(a.date) || "";
      const bi = displayDateToISO(b.date) || "";
      if (ai !== bi) return ai < bi ? -1 : 1;
      return (a.time || "") < (b.time || "") ? -1 : 1;
    });

  const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px">
    <h3 style="font-size:13px;color:var(--muted);margin:0">📅 Upcoming Appointments <span style="color:var(--dim);font-weight:400">(${upcoming.length})</span></h3>
    <button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="openAppointmentForm()">+ Book</button>
  </div>`;

  if (!upcoming.length) {
    return header + `<div class="empty-state" style="padding:12px;font-size:11px;margin-bottom:12px">No upcoming appointments.</div>`;
  }

  // Highlight today's appointments so they don't get lost in a long list.
  const rows = upcoming.map(a => {
    const iso = displayDateToISO(a.date);
    const isToday = iso === todayIso;
    const dayLabel = isToday ? `<span class="badge badge-red" style="font-size:9px">TODAY</span>` : "";
    return `<tr onclick="openPerson('${a.d4}')" style="cursor:pointer${isToday ? ';background:#F8514911' : ''}">
      <td class="mono" style="font-weight:700;color:var(--accent)">${displayId(a.d4)}</td>
      <td style="text-align:left">${escapeHTML(displayPersonLabel(a.d4))}</td>
      <td style="text-align:left">${escapeHTML(a.reason || "")}</td>
      <td style="white-space:nowrap">${a.date || ""} ${dayLabel}</td>
      <td class="mono" style="white-space:nowrap">${fmtHrs(a.time)}</td>
      <td style="text-align:left;font-size:11px;color:var(--muted)">${escapeHTML(a.location || "")}${a.outOfCamp ? ` <span class="badge badge-pink" style="font-size:9px">OUTSIDE</span>` : ""}</td>
      <td style="white-space:nowrap"><button class="btn btn-icon" style="color:var(--green)" onclick="event.stopPropagation(); toggleAppointmentResolved(${a.id})" title="Mark as resolved (hides from dashboard + parade state)">✓</button> <button class="btn btn-icon" onclick="event.stopPropagation(); openAppointmentForm(${a.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('appointments', ${a.id}, 'appointment')" title="Delete">✕</button></td>
    </tr>`;
  }).join("");

  return header + `<div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>4D</th><th style="text-align:left">Name</th><th style="text-align:left">Reason</th><th>Date</th><th>Time</th><th style="text-align:left">Location</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderDashProfileCards(scoped) {
  // Ration: count distinct values. Unknowns get grouped under "Unspecified"
  // so they show up but don't disappear silently.
  const rationCounts = {};
  scoped.forEach(r => { const k = (r.ration || "").trim() || "Unspecified"; rationCounts[k] = (rationCounts[k] || 0) + 1; });
  const rationRows = Object.entries(rationCounts).sort((a, b) => b[1] - a[1]);
  const rationColor = k => k === "Muslim" ? "var(--green)" : k === "Non-Muslim" ? "var(--accent)" : "var(--muted)";

  // Allergies: each recruit's `allergies` is free text — split on comma so a
  // single "Peanuts, Dairy" entry counts toward two distinct allergens.
  const allergenCounts = {};
  const allergic = [];
  scoped.forEach(r => {
    const raw = (r.allergies || "").trim();
    if (!raw) return;
    allergic.push(r);
    raw.split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(a => {
      const key = a.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      allergenCounts[key] = (allergenCounts[key] || 0) + 1;
    });
  });
  const allergenRows = Object.entries(allergenCounts).sort((a, b) => b[1] - a[1]);

  return `<div class="grid-2">
    <div class="card"><h3>Ration Breakdown</h3>
      ${rationRows.length ? `<div style="display:flex;flex-direction:column;gap:6px">
        ${rationRows.map(([k, n]) => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px"><span style="color:${rationColor(k)};font-weight:600">${escapeHTML(k)}</span><span class="mono" style="color:var(--muted)">${n} (${pct(n, scoped.length)}%)</span></div>`).join("")}
      </div>` : `<div style="color:var(--muted);font-size:12px">No ration data</div>`}
    </div>
    <div class="card"><h3>Allergies <span style="color:var(--muted);font-weight:400;font-size:11px">(${allergic.length} recruit${allergic.length === 1 ? '' : 's'})</span></h3>
      ${allergic.length ? `
        ${allergenRows.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${allergenRows.map(([a, n]) => `<span class="badge badge-yellow">${escapeHTML(a)} · ${n}</span>`).join("")}</div>` : ""}
        <div style="display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto">
          ${allergic.map(r => `<div onclick="openPerson('${r.id}')" style="cursor:pointer;font-size:11px;padding:4px 6px;border-radius:4px;background:var(--surface2);display:flex;justify-content:space-between;gap:8px"><span><span class="mono" style="color:var(--accent);font-weight:700">${r.id}</span> ${escapeHTML(r.name)}</span><span style="color:var(--yellow);text-align:right">${escapeHTML(r.allergies)}</span></div>`).join("")}
        </div>
      ` : `<div style="color:var(--muted);font-size:12px">No recruits with allergies recorded</div>`}
    </div>
  </div>`;
}

function renderRoster(el) {
  const rsiCount = {};
  STATE.medical.forEach(m => { rsiCount[m.d4] = (rsiCount[m.d4] || 0) + 1; });
  const scoped = filteredRoster();
  // Push/Export operate on the FULL roster — scoping is a view concern; we
  // don't want the user to silently overwrite the sheet with only their slice.
  const titleSuffix = isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.roster.length}]</span>` : ` (${STATE.roster.length})`;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">Master Roster${titleSuffix}</h2>
      <div style="display:flex;gap:8px" class="write-only">
        <button class="btn" onclick="exportCSV(STATE.roster,exportFileName('Roster','csv'))">Export CSV</button>
        <button class="btn btn-success" onclick="pushTab('Roster',STATE.roster)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
      </div>
    </div>
    ${scoped.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th style="text-align:left">Name</th><th>Plt · Sect</th><th>Role</th><th>Status</th><th>BMI</th><th>RSIs</th></tr></thead><tbody>
    ${scoped.map(r => {
      const bmi = calcBMI(r);
      const isCmd = r.role === "Commander";
      const nameCell = isCmd ? `${escapeHTML(r.rank ? r.rank + " " : "")}${escapeHTML(r.name)}` : escapeHTML(r.name);
      const idCell = isCmd ? "" : r.id;
      const roleCell = isCmd ? `<span class="badge badge-purple">Commander</span>` : `<span style="color:var(--muted);font-size:11px">Recruit</span>`;
      // Braves org columns (spec §5). Show the explicit platoon/section when
      // present; em-dash when the roster row hasn't been populated yet.
      const plt = personPlatoon(r);
      const sect = personSection(r);
      const orgCell = (plt || sect) ? `${plt || "—"}${sect ? " · " + sect : ""}` : "—";
      return `<tr onclick="openPerson('${r.id}')" style="cursor:pointer"><td class="mono" style="font-weight:700;color:var(--accent)">${idCell}</td><td style="text-align:left">${nameCell}</td><td style="font-size:11px;color:var(--muted)">${orgCell}</td><td>${roleCell}</td><td>${statusBadge(r.status)}</td><td style="font-weight:700;color:${bmiColor(bmi)}">${isCmd ? '—' : (bmi ?? '—')}</td><td style="color:${(rsiCount[r.id] || 0) > 1 ? 'var(--red)' : 'var(--muted)'}">${rsiCount[r.id] || 0}</td></tr>`;
    }).join("")}
    </tbody></table></div>` : `<div class="empty-state">${STATE.roster.length ? `No personnel in ${filterLabel()}.` : (STATE.authToken ? "Loading roster from sheet…" : "No invite redeemed on this device yet.")}</div>`}`;
}

function renderAttendance(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700">Conduct Attendance</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="refreshLmsFromPolar()" title="Recount LMS participants for every conduct from STATE.polar (the Polar class summary photo is the LMS roster) and write into the attendance rows">🔄 Recompute LMS</button>
        <button class="btn btn-success" onclick="pushTab('Attendance',STATE.attendance)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <label class="btn admin-only" title="Admin: import one or many attendance CSV exports at once (Activity metadata + User/Unit/Status/Remarks). Each file = one conduct; ids auto-created. Present rows feed HA participation.">📥 Import CSV(s)
          <input type="file" accept=".csv" multiple onchange="importConductCSV(this)" style="display:none">
        </label>
        <button class="btn" onclick="showConductImportSchema()" title="Show the expected CSV / import format">ⓘ Format</button>
        <button class="btn btn-primary" onclick="openLogConductWizard()" title="One-shot wizard: date + time + conduct + Status Personnel checklist + bulk Report Sick / Fallout / RSI rows + auto totals + chat-format copy">+ Log Conduct</button>
      </div>
    </div>
    ${STATE.attendance.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Conduct</th><th title="Counts toward Heat Acclimatisation (click a cell to toggle)">HA</th><th>Total</th><th>Part.</th><th>LMS</th><th>Status</th><th>Fallout</th><th>Rate</th><th>LMS Rate</th><th style="text-align:left">Remarks</th><th></th></tr></thead><tbody>
    ${[...STATE.attendance].sort((a, b) => {
      // Newest first by date, then time (later in the day on top within a date).
      const ai = displayDateToISO(a.date) || a.date || "";
      const bi = displayDateToISO(b.date) || b.date || "";
      if (ai !== bi) return ai < bi ? 1 : -1;
      return (a.time || "") < (b.time || "") ? 1 : -1;
    }).map(a => {
      const r = pct(a.participating, a.total);
      const lms = +a.lms || 0;
      const lmsRate = pct(lms, a.participating);
      const rateColor = r >= 95 ? 'var(--green)' : r >= 70 ? 'var(--orange)' : 'var(--red)';
      const lmsRateColor = a.participating ? (lmsRate >= 95 ? 'var(--green)' : lmsRate >= 70 ? 'var(--orange)' : 'var(--red)') : 'var(--muted)';
      const time = fmtHrs(a.time) || '—';
      // HA-eligibility cell (§14.3). The verdict shown must mirror what computeHA
      // (haCountsRow) actually does, or the column lies. For WIZARD rows that is
      // ALWAYS the currencyTags HA token — the per-conduct "Counts toward HA"
      // checkbox stamped it, independent of haEligibilitySource — so the toggle
      // stays live even under the legacy isHAExcluded name-config. CSV rows follow
      // the configured source: a live toggle under 'currencyTag', else a read-only
      // name-logic verdict. Legacy wizard rows (source "") predate participant
      // tracking and are never HA-eligible.
      const tagSrc = configGet("haEligibilitySource") === "currencyTag";
      const isWizard = a.source === "wizard";
      const haOn = isWizard ? haCountsRow(a) : conductHAEligible(a);
      const toggleable = isWizard || tagSrc;   // the currencyTags token is the live signal
      const haCell = (a.source !== "csv" && a.source !== "wizard")
        ? `<span style="color:var(--dim)" title="Legacy wizard conduct — re-save it in the wizard with 'Counts toward HA' to include it">—</span>`
        : toggleable
          ? `<button class="btn btn-icon" onclick="toggleConductHA(${a.id})" style="color:${haOn ? 'var(--green)' : 'var(--dim)'};font-weight:700" title="${haOn ? 'Counts toward HA — click to exclude' : 'Not an HA conduct — click to count it toward HA'}">${haOn ? 'HA ✓' : 'HA ✕'}</button>`
          : `<span style="color:${haOn ? 'var(--green)' : 'var(--dim)'}" title="Eligibility comes from the conduct name (Config haEligibilitySource = 'isHAExcluded'); set it to 'currencyTag' to toggle per conduct">${haOn ? 'HA' : '—'}</span>`;
      return `<tr><td>${a.date}</td><td class="mono" style="color:${a.time ? 'var(--text)' : 'var(--dim)'}">${time}</td><td style="text-align:left">${escapeHTML(conductName(a.conductId))}</td><td>${haCell}</td><td>${a.total}</td><td>${a.participating}</td><td style="color:${lms > 0 ? 'var(--accent)' : 'var(--muted)'}">${lms}</td><td style="color:${a.px > 0 ? 'var(--orange)' : 'var(--muted)'}">${a.px}</td><td style="color:${a.fallout > 0 ? 'var(--red)' : 'var(--muted)'}">${a.fallout}</td><td style="font-weight:700;color:${rateColor}">${r}%</td><td style="font-weight:700;color:${lmsRateColor}">${a.participating ? lmsRate + '%' : '—'}</td><td style="text-align:left;color:${a.remarks ? 'var(--yellow)' : 'var(--muted)'};max-width:200px;white-space:normal;font-size:11px">${escapeHTML(a.remarks || '')}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="copyConductChatFormat(${a.id})" title="Copy WhatsApp-format parade state message">📋</button> <button class="btn btn-icon" onclick="openLogConductWizard(${a.id})" title="Edit conduct (wizard)">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('attendance', ${a.id}, 'attendance entry')" title="Delete">✕</button></td></tr>`;
    }).join("")}
    </tbody></table></div>` : `<div class="empty-state">No attendance records yet.</div>`}`;
}

// ── Conduct Detail tab ────────────────────────────────────
// Filters are module-scope rather than persisted — they reset on reload so a
// returning user sees the whole picture instead of yesterday's filter state.
let _detailFilterConduct = "";
let _detailFilterType = "";
let _showParticipants = false;
function setDetailFilterConduct(v) { _detailFilterConduct = v; _showParticipants = false; render(); }
function setDetailFilterType(v) { _detailFilterType = v; render(); }
function clearDetailFilters() { _detailFilterConduct = ""; _detailFilterType = ""; _showParticipants = false; render(); }
function toggleParticipants() { _showParticipants = !_showParticipants; render(); }

// When a single conduct is selected, derive who participated from
// `roster - absent` (the user's insight: detail rows enumerate absentees, so
// the inverse gives us the participants for free, no extra data needed).
function renderDetailParticipantsSummary(scopedAll) {
  if (!_detailFilterConduct) return "";
  const conductRecords = scopedAll.filter(d => `${d.date}|${d.time || ""}|${d.conductId || ""}` === _detailFilterConduct);
  // "PXP" = present doing stretches → NOT absent; exclude it from the absent set
  // so PX people aren't subtracted from "participated" or tallied as no-shows.
  const absentRecords = conductRecords.filter(d => d.type !== "PXP");
  const absentSet = new Set(absentRecords.map(d => d.d4));
  const inScope = filteredRoster();
  const participants = inScope.filter(r => !absentSet.has(r.id));
  const ct = t => conductRecords.filter(d => d.type === t).length;
  return `
    <div class="card" style="padding:10px 14px;margin-bottom:12px;background:var(--surface2)">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;flex-wrap:wrap;gap:8px">
        <div>
          <span style="color:var(--muted)">This conduct →</span>
          <strong style="color:var(--green)">Participated: ${participants.length}</strong>
          <span style="color:var(--muted)"> · </span>
          <strong style="color:var(--red)">Absent: ${absentSet.size}</strong>
          <span style="color:var(--muted)"> (Status ${ct("Status")} · RSI ${ct("RSI")} · Fallout ${ct("Fallout")} · ReportSick ${ct("ReportSick")}${ct("PXP") ? ` · PX ${ct("PXP")} present` : ""})</span>
        </div>
        <button class="btn" onclick="toggleParticipants()">${_showParticipants ? "▾ Hide" : "▸ Show"} participants (${participants.length})</button>
      </div>
      ${_showParticipants ? `<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">
        ${participants.length ? participants.map(r => `<button onclick="openPerson('${r.id}')" style="cursor:pointer;font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--accent);font-family:'JetBrains Mono',monospace;font-weight:700" title="${escapeAttr(r.name)}">${r.id}</button>`).join("") : `<span style="color:var(--muted);font-size:11px">No participants in current scope</span>`}
      </div>` : ""}
    </div>`;
}

function renderConductDetail(el) {
  const visible = visibleD4Set();
  const scopedAll = STATE.conductDetail.filter(d => passesFilter(d.d4, visible));
  let scoped = scopedAll;
  if (_detailFilterConduct) scoped = scoped.filter(d => `${d.date}|${d.time || ""}|${d.conductId || ""}` === _detailFilterConduct);
  if (_detailFilterType) scoped = scoped.filter(d => d.type === _detailFilterType);

  // Unique conduct keys for the dropdown — newest first by parsed date.
  const conductKeys = [...new Set(scopedAll.map(d => `${d.date}|${d.time || ""}|${d.conductId || ""}`))]
    .filter(Boolean)
    .sort((a, b) => {
      const [ad, at] = a.split("|"), [bd, bt] = b.split("|");
      const ai = displayDateToISO(ad) || ad;
      const bi = displayDateToISO(bd) || bd;
      if (ai !== bi) return ai < bi ? 1 : -1;
      return (at || "") < (bt || "") ? 1 : -1;
    });

  // Sort the visible records the same way — newest-first feels right when
  // scanning for "what happened today / yesterday."
  let rows = [...scoped].sort((a, b) => {
    const ai = displayDateToISO(a.date) || a.date || "";
    const bi = displayDateToISO(b.date) || b.date || "";
    if (ai !== bi) return ai < bi ? 1 : -1;
    return (a.time || "") < (b.time || "") ? 1 : -1;
  });
  // D1: name/4D search on top of the conduct/type sub-filters.
  rows = listSearchFilter("conduct", rows);

  // ReportSick dedupes per (d4, date) — a single recruit who fell out of
  // multiple conducts on the same day only went to MO once. The other
  // types remain as row counts (each row = a distinct conduct event).
  const cnt = t => {
    const rows = scoped.filter(d => d.type === t);
    if (t === "ReportSick") return new Set(rows.map(d => `${d.d4}|${d.date}`)).size;
    return rows.length;
  };

  // "Most conducts missed" ignores the conduct/type sub-filter so the ranking
  // remains a stable view of overall absence within the platoon scope.
  const missed = {};
  scopedAll.forEach(d => {
    const k = `${d.date}|${d.time || ""}|${d.conductId || ""}`;
    (missed[d.d4] = missed[d.d4] || new Set()).add(k);
  });
  const topMissed = Object.entries(missed)
    .map(([d4, set]) => ({ d4, count: set.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const typeBadgeColor = t => t === "Status" ? "orange" : t === "PXP" ? "teal" : t === "RSI" ? "red" : t === "Fallout" ? "purple" : "yellow";
  const totalConducts = [...new Set(scopedAll.map(d => `${d.date}|${d.time || ""}|${d.conductId || ""}`))].length;
  const titleSuffix = isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scopedAll.length}/${STATE.conductDetail.length}]</span>` : ` (${STATE.conductDetail.length})`;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="font-size:18px;font-weight:700">Conduct Detail${titleSuffix}</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-success" onclick="pushTab('ConductDetail',STATE.conductDetail)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="openConductDetailForm()">+ Log</button>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><label>Status (pre-existing)</label><div class="val" style="color:var(--orange)">${cnt("Status")}</div></div>
      <div class="stat"><label>RSI (1st parade)</label><div class="val" style="color:var(--red)">${cnt("RSI")}</div></div>
      <div class="stat"><label>Fallout (mid-conduct)</label><div class="val" style="color:var(--purple)">${cnt("Fallout")}</div></div>
      <div class="stat"><label>Reported Sick (mid-day)</label><div class="val" style="color:var(--yellow)">${cnt("ReportSick")}</div></div>
      ${cnt("PXP") ? `<div class="stat"><label>PX (present, stretches)</label><div class="val" style="color:var(--teal)">${cnt("PXP")}</div></div>` : ""}
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
      <span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Filter:</span>
      <select onchange="setDetailFilterConduct(this.value)" class="topbar-select" style="min-width:260px">
        <option value="">All conducts (${totalConducts})</option>
        ${conductKeys.map(k => { const [dt, tm, cid] = k.split("|"); return `<option value="${escapeAttr(k)}" ${k === _detailFilterConduct ? "selected" : ""}>${dt}${tm ? " " + fmtHrs(tm) : ""} — ${escapeHTML(conductName(cid) || "(unknown)")}</option>`; }).join("")}
      </select>
      <select onchange="setDetailFilterType(this.value)" class="topbar-select">
        <option value="">All types</option>
        ${[["Status","Status"],["PXP","PX (present)"],["RSI","RSI"],["Fallout","Fallout"],["ReportSick","Report Sick"]].map(([val,lab]) => `<option value="${val}" ${val === _detailFilterType ? "selected" : ""}>${lab}</option>`).join("")}
      </select>
      ${listSearchInput("conduct", "Search name / 4D…")}
      ${(_detailFilterConduct || _detailFilterType) ? `<button class="btn" onclick="clearDetailFilters()">Reset</button>` : ""}
    </div>
    ${renderDetailParticipantsSummary(scopedAll)}
    <div class="grid-2" style="grid-template-columns:2fr 1fr;align-items:start">
      <div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th style="text-align:left">Conduct</th><th>4D</th><th style="text-align:left">Name</th><th>Type</th><th style="text-align:left">Reason</th><th></th></tr></thead><tbody>
        ${rows.map(d => `<tr onclick="openPerson('${d.d4}')" style="cursor:pointer"><td>${d.date || ""}</td><td class="mono">${fmtHrs(d.time) || "—"}</td><td style="text-align:left">${escapeHTML(conductName(d.conductId))}</td><td class="mono" style="font-weight:700;color:var(--accent)">${d.d4}</td><td style="text-align:left">${escapeHTML(getName(d.d4))}</td><td>${badge(d.type, typeBadgeColor(d.type))}</td><td style="text-align:left;max-width:280px;white-space:normal;font-size:11px">${escapeHTML(d.reason || "")}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="event.stopPropagation(); openConductDetailForm(${d.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('conductDetail', ${d.id}, 'conduct detail record')" title="Delete">✕</button></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty-state">${STATE.conductDetail.length ? "No records match current filter." : "No conduct detail records yet. Tap + Log to add one."}</div>`}
      </div>
      <div class="card">
        <h3>Most Conducts Missed${isFilterActive() ? ` <span style="color:var(--accent);font-weight:400;font-size:10px">in ${filterLabel()}</span>` : ""}</h3>
        ${topMissed.length ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto">
          ${topMissed.map(m => `<div onclick="openPerson('${m.d4}')" style="cursor:pointer;font-size:11px;padding:6px 8px;border-radius:4px;background:var(--surface2);display:flex;justify-content:space-between;gap:8px">
            <span><span class="mono" style="color:var(--accent);font-weight:700">${m.d4}</span> ${escapeHTML(getName(m.d4))}</span>
            <span class="mono" style="font-weight:700;color:${m.count >= 5 ? "var(--red)" : m.count >= 3 ? "var(--orange)" : "var(--muted)"}">${m.count}</span>
          </div>`).join("")}
        </div>` : `<div style="color:var(--muted);font-size:12px">No data yet</div>`}
      </div>
    </div>`;
}

function renderMedical(el) {
  const visible = visibleD4Set();
  const scoped = STATE.medical.filter(m => passesFilter(m.d4, visible));
  const today = todayISO();
  // Per-row "tag today" reflects whether the status is currently active, in
  // its +1/+2 ghost window, or fully cleared.
  const rowsWithTag = scoped.map(m => ({ m, tagInfo: medStatusTag(m, today) }));
  // Sort newest first by startDate (fallback to date logged).
  rowsWithTag.sort((a, b) => {
    const ai = displayDateToISO(a.m.startDate || a.m.date) || "";
    const bi = displayDateToISO(b.m.startDate || b.m.date) || "";
    return ai < bi ? 1 : ai > bi ? -1 : 0;
  });
  const activeCount = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay === 0).length;
  const ghostCount = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay > 0).length;
  const pendingCount = scoped.filter(m => m.status === "Pending").length;

  // R/C breakdown — same logic as the dashboard: only shown when "All" is
  // the active role scope, so the stat is double-clickable for "is this a
  // recruit-side problem or a commander problem?"
  const isAll = !STATE.filterRole;
  const splitC = pred => ({
    rec: scoped.filter(m => pred(m) && !isCommander(m.d4)).length,
    cmd: scoped.filter(m => pred(m) && isCommander(m.d4)).length
  });
  const activeSplit = (() => {
    const rec = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay === 0 && !isCommander(r.m.d4)).length;
    const cmd = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay === 0 && isCommander(r.m.d4)).length;
    return { rec, cmd };
  })();
  const recoveringSplit = (() => {
    const rec = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay > 0 && !isCommander(r.m.d4)).length;
    const cmd = rowsWithTag.filter(r => r.tagInfo && r.tagInfo.ghostDay > 0 && isCommander(r.m.d4)).length;
    return { rec, cmd };
  })();
  const pendingSplit = splitC(m => m.status === "Pending");
  const inlineBreakdown = ({ rec, cmd }) => isAll
    ? `<span style="font-size:55%;color:var(--muted);font-weight:400;margin-left:1px">/${rec}/${cmd}</span>`
    : "";

  // Total unique (d4, date) pairs across the whole scope — drives the
  // "Total report sicks" tile so it matches the leaderboard semantics.
  const totalReportSickDays = new Set(scoped.map(m => `${m.d4}|${m.date}`)).size;
  const totalReportSickDaysSplit = {
    rec: new Set(scoped.filter(m => !isCommander(m.d4)).map(m => `${m.d4}|${m.date}`)).size,
    cmd: new Set(scoped.filter(m => isCommander(m.d4)).map(m => `${m.d4}|${m.date}`)).size
  };

  el.innerHTML = `
    <div class="tab-toolbar">
      <h2 class="tab-title" style="font-size:18px;font-weight:700">Report Sick Log${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.medical.length}]</span>` : ""}</h2>
      <div class="tab-actions">
        <button class="btn btn-success" onclick="pushTab('Medical',STATE.medical)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻<span class="btn-label"> Re-push all</span></button>
        <label class="btn admin-only" style="cursor:pointer" title="Admin: import a colour-coded RSI/RSO REC sheet (xlsx). Cell fill colour = status, text = reason. Previews before committing.">📥<span class="btn-label"> Import Sick History (xlsx)</span><input type="file" accept=".xlsx" onchange="importSickHistoryXLSX(this)" style="display:none"></label>
        ${listSearchInput("medical", "Search name / 4D…")}
        <button class="btn btn-primary" onclick="openMedicalForm()">+<span class="btn-label"> Log Report Sick</span></button>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><label>Total report sicks</label><div class="val" title="Unique (recruit, date) — multiple medical rows on the same day count as one event">${totalReportSickDays}${inlineBreakdown(totalReportSickDaysSplit)}</div></div>
      <div class="stat"><label>Active today</label><div class="val" style="color:var(--red)">${activeCount}${inlineBreakdown(activeSplit)}</div></div>
      <div class="stat"><label>Recovering</label><div class="val" style="color:var(--orange)">${ghostCount}${inlineBreakdown(recoveringSplit)}</div></div>
      <div class="stat"><label>Pending</label><div class="val" style="color:var(--muted)">${pendingCount}${inlineBreakdown(pendingSplit)}</div></div>
    </div>
    <div id="med-results"></div>`;
  registerListRenderer("medical", renderMedicalRows);
  renderMedicalRows();
}
function renderMedicalRows() {
  const host = document.getElementById("med-results");
  if (!host) return;
  const visible = visibleD4Set();
  const scoped = STATE.medical.filter(m => passesFilter(m.d4, visible));
  const today = todayISO();
  const rowsWithTag = scoped.map(m => ({ m, tagInfo: medStatusTag(m, today) }));
  rowsWithTag.sort((a, b) => {
    const ai = displayDateToISO(a.m.startDate || a.m.date) || "";
    const bi = displayDateToISO(b.m.startDate || b.m.date) || "";
    return ai < bi ? 1 : ai > bi ? -1 : 0;
  });
  const _medQ = listCtl("medical").q.trim().toLowerCase();
  let medRows = _medQ
    ? rowsWithTag.filter(({ m }) => { const nm = (getName(m.d4) || "").toLowerCase(); return nm.includes(_medQ) || String(m.d4).toLowerCase().includes(_medQ); })
    : rowsWithTag;
  medRows = listApplySort("medical", medRows, {
    reported: x => displayDateToISO(x.m.startDate || x.m.date) || "",
    fourD: x => x.m.d4 || "",
    name: x => getName(x.m.d4) || "",
    status: x => x.m.status || ""
  });
  // Leaderboard: count UNIQUE report-sick days per recruit within the scope.
  const rsDaySets = {};
  scoped.forEach(m => { (rsDaySets[m.d4] = rsDaySets[m.d4] || new Set()).add(m.date); });
  const topReporters = Object.entries(rsDaySets)
    .map(([d4, days]) => ({ d4, count: days.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  host.innerHTML = `
    <div class="grid-2" style="grid-template-columns:2fr 1fr;align-items:start">
      <div>
        ${medRows.length ? `<div class="table-wrap"><table><thead><tr>${sortTh("medical", "reported", "Reported")}${sortTh("medical", "fourD", "4D")}${sortTh("medical", "name", "Name", "left")}<th style="text-align:left">Reason</th>${sortTh("medical", "status", "Status")}<th>Start</th><th>End</th><th>Today</th><th></th></tr></thead><tbody>
        ${medRows.map(({ m, tagInfo }) => { const noDur = m.status === "Pending" || m.status === "NIL"; return `<tr onclick="openPerson('${m.d4}')" style="cursor:pointer"><td>${m.date || ""}</td><td class="mono" style="font-weight:700;color:var(--accent)">${displayId(m.d4)}</td><td style="text-align:left">${escapeHTML(displayPersonLabel(m.d4))}</td><td style="text-align:left">${m.type ? `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;letter-spacing:.5px;background:var(--surface2);border:1px solid var(--border);color:var(--muted);margin-right:5px">${m.type}${m.type === "MR" && m.mrTiming ? " " + escapeAttr(m.mrTiming) : ""}</span>` : ""}${escapeHTML(m.reason || "")}${m.urtiType ? `<span style="font-size:9px;color:var(--dim);margin-left:5px">${escapeHTML(m.urtiType)}</span>` : ""}${m.origin === "conductLog" ? `<span class="badge badge-teal" style="font-size:8px;margin-left:5px" title="Auto-created from a conduct import/log — confirm the MO outcome">from conduct log</span>` : ""}${m.location ? `<div style="font-size:10px;color:var(--muted)">📍 ${escapeAttr(m.location)}</div>` : ""}</td><td>${m.status ? medTagBadge(m.status) : '<span style="color:var(--muted)">—</span>'}</td><td>${m.startDate || (noDur ? '<span style="color:var(--muted)">—</span>' : "")}</td><td>${m.endDate || (noDur ? '<span style="color:var(--muted)">—</span>' : "")}</td><td>${tagInfo ? medTagBadge(tagInfo.tag) : '<span style="color:var(--dim)">cleared</span>'}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="event.stopPropagation(); openMedicalForm(${m.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('medical', ${m.id}, 'medical record')" title="Delete">✕</button></td></tr>`; }).join("")}
        </tbody></table></div>` : `<div class="empty-state">${_medQ ? "No records match the search." : (STATE.medical.length ? `No report sick records in ${filterLabel()}.` : "No report sick records yet.")}</div>`}
      </div>
      <div class="card">
        <h3>Most Reports Sick${isFilterActive() ? ` <span style="color:var(--accent);font-weight:400;font-size:10px">in ${filterLabel()}</span>` : ""}</h3>
        ${topReporters.length ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto">
          ${topReporters.map(r => `<div onclick="openPerson('${r.d4}')" style="cursor:pointer;font-size:11px;padding:6px 8px;border-radius:4px;background:var(--surface2);display:flex;justify-content:space-between;gap:8px">
            <span>${displayId(r.d4) ? `<span class="mono" style="color:var(--accent);font-weight:700">${displayId(r.d4)}</span> ` : ""}${escapeHTML(displayPersonLabel(r.d4))}</span>
            <span class="mono" style="font-weight:700;color:${r.count >= 5 ? "var(--red)" : r.count >= 3 ? "var(--orange)" : "var(--muted)"}">${r.count}</span>
          </div>`).join("")}
        </div>` : `<div style="color:var(--muted);font-size:12px">No data yet</div>`}
      </div>
    </div>`;
}

function renderIPPT(el) {
  const visible = visibleD4Set();
  const scoped = STATE.ippt.filter(i => passesFilter(i.d4, visible));

  // Aggregate one entry per recruit (latest or best) for the stats/charts/
  // leaderboard. The underlying table below still shows every row.
  const aggMode = STATE.ipptAggMode || "latest";
  const aggregated = aggregateIPPT(scoped, aggMode);
  const stats = computeIPPTStats(aggregated);

  // YTT chase: recruits in the filtered scope who either have an all-zero
  // IPPT row OR have no IPPT row at all — both are "haven't taken yet".
  const rosterInScope = filteredRoster();
  const takenD4s = new Set(scoped.filter(e => !isYTT(e)).map(e => e.d4));
  const yttRecruits = rosterInScope.filter(r => !takenD4s.has(r.id));

  // Top performers: aggregated, sorted by score desc, YTT excluded.
  const topPerformers = aggregated
    .filter(e => !isYTT(e))
    .slice()
    .sort((a, b) => (+b.score || 0) - (+a.score || 0))
    .slice(0, 10);

  // Score-distribution buckets aligned to award thresholds:
  // [YTT, Fail 0–60, Pass 61–74, Silver 75–84, Gold 85–89, Gold★ 90+]
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const e of aggregated) {
    if (isYTT(e)) { buckets[0]++; continue; }
    const s = +e.score || 0;
    if (s <= 60) buckets[1]++;
    else if (s <= 74) buckets[2]++;
    else if (s <= 84) buckets[3]++;
    else if (s <= 89) buckets[4]++;
    else buckets[5]++;
  }

  // ── D2: table view selector (All / by attempt # / by date) ────────────────
  const attemptsAvail = [...new Set(scoped.map(e => e.attempt).filter(a => a !== "" && a != null))].sort((a, b) => (+a) - (+b));

  // ── Cross-attempt cohort (progression / compare / award-mix charts) ────────
  // Shared model so all three cross-attempt charts agree on who counts.
  const ipptSeries = ipptSeriesByRecruit(scoped);
  const attemptNums = attemptsAvail.map(Number).filter(n => n > 0);
  const hasMultiAttempt = attemptNums.length >= 2;
  // Compare picker A→B: default first vs last available attempt; re-validate the
  // stored pick against the current attempt set so a stale value can't survive a
  // scope/data change.
  let cmpA = +_ipptCmpA, cmpB = +_ipptCmpB;
  if (!attemptNums.includes(cmpA)) cmpA = attemptNums[0];
  if (!attemptNums.includes(cmpB) || cmpB === cmpA) cmpB = attemptNums[attemptNums.length - 1];
  const datesAvail = [...new Set(scoped.map(e => e.date).filter(Boolean))].sort((a, b) => (displayDateToISO(b) || "").localeCompare(displayDateToISO(a) || ""));
  const ipptView = _ipptView || "all";
  let tableRows = scoped;
  if (ipptView.startsWith("att:")) tableRows = scoped.filter(e => String(e.attempt) === ipptView.slice(4));
  else if (ipptView.startsWith("date:")) tableRows = scoped.filter(e => e.date === ipptView.slice(5));
  // D1: name/4D search + sortable columns.
  tableRows = listSearchFilter("ippt", tableRows);
  tableRows = listApplySort("ippt", tableRows, {
    fourD: e => e.d4 || "", name: e => getName(e.d4) || "", attempt: e => +e.attempt || 0,
    date: e => displayDateToISO(e.date) || e.date || "", score: e => isYTT(e) ? -1 : (+e.score || 0),
    pushups: e => +e.pushups || 0, situps: e => +e.situps || 0
  });

  // ── D3: mean/median total score over time (non-YTT, grouped by date) ──────
  const byDate = {};
  scoped.filter(e => !isYTT(e)).forEach(e => { const iso = displayDateToISO(e.date) || e.date || ""; (byDate[iso] = byDate[iso] || []).push(+e.score || 0); });
  const trendDates = Object.keys(byDate).filter(Boolean).sort();
  const _median = arr => { const s = arr.slice().sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  const ipptTrend = {
    labels: trendDates.map(iso => isoToDisplayDate(iso) || iso),
    mean: trendDates.map(iso => Math.round(byDate[iso].reduce((a, b) => a + b, 0) / byDate[iso].length)),
    median: trendDates.map(iso => Math.round(_median(byDate[iso])))
  };

  // ── D3: static (push-up + sit-up) vs run (2.4km) strength on latest attempt.
  // Compares each recruit's static station score (out of 50) against their run
  // score (out of 50) from the SAF tables; a ±2-point band counts as balanced.
  const latestForStrength = aggregateIPPT(scoped, "latest");
  const strength = { static: [], run: [], balanced: [], unknown: 0 };
  latestForStrength.filter(e => !isYTT(e)).forEach(e => {
    const r = STATE.roster.find(x => x.id === e.d4);
    const age = r && r.age;
    const res = age ? calculateIPPTScore(age, e.pushups, e.situps, e.runTime) : null;
    if (!res) { strength.unknown++; return; }
    const stat = (res.pushupScore || 0) + (res.situpScore || 0), run = res.runScore || 0;
    if (stat > run + 2) strength.static.push(e.d4);
    else if (run > stat + 2) strength.run.push(e.d4);
    else strength.balanced.push(e.d4);
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 style="font-size:18px;font-weight:700">IPPT Tracker${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.ippt.length}]</span>` : ""}</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label class="btn" style="cursor:pointer">Import CSV<input type="file" accept=".csv" onchange="importIPPT(this)" style="display:none"></label>
        <button class="btn btn-success" onclick="pushTab('IPPT',STATE.ippt)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="openIPPTForm()">+ Add</button>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Stats use</span>
      <div class="filter-role-group">
        <button class="role-btn ${aggMode === "latest" ? "active" : ""}" onclick="setIpptAggMode('latest'); render()">Latest</button>
        <button class="role-btn ${aggMode === "best" ? "active" : ""}" onclick="setIpptAggMode('best'); render()">Best</button>
      </div>
      <span style="font-size:11px;color:var(--muted)">attempt per recruit</span>
    </div>

    <div class="stats-row">
      <div class="stat"><label>Taken</label><div class="val">${stats.taken}<span style="font-size:12px;color:var(--muted);font-weight:400">/${stats.total}</span></div><div class="sub">${pct(stats.taken, stats.total)}% recorded</div></div>
      <div class="stat"><label>Passed (61+)</label><div class="val" style="color:var(--green)">${stats.passed}</div><div class="sub">${pct(stats.passed, stats.taken)}% of taken</div></div>
      <div class="stat"><label>Failed</label><div class="val" style="color:var(--red)">${stats.fail}</div><div class="sub">${pct(stats.fail, stats.taken)}% of taken</div></div>
      <div class="stat"><label>YTT</label><div class="val" style="color:var(--accent)">${stats.ytt}</div><div class="sub">yet to take</div></div>
      <div class="stat"><label>Avg Score</label><div class="val" style="color:var(--accent)">${stats.avgScore || "—"}</div><div class="sub">${stats.scoreN} results</div></div>
      <div class="stat"><label>Avg 2.4km</label><div class="val" style="color:var(--accent)">${formatSeconds(stats.avgRunSec)}</div><div class="sub">${stats.runSecN} results</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Award Breakdown${isFilterActive() ? ` <span style="color:var(--accent);font-weight:400;font-size:10px">in ${filterLabel()}</span>` : ""}</h3>
        <div class="chart-box tall"><canvas id="chart-ippt-awards"></canvas></div>
      </div>
      <div class="card">
        <h3>Score Distribution</h3>
        <div class="chart-box tall"><canvas id="chart-ippt-distribution"></canvas></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>YTT Chase List <span style="color:var(--accent);font-weight:400;font-size:10px">${yttRecruits.length} to chase</span></h3>
        ${yttRecruits.length ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto">
          ${yttRecruits.map(r => `<div onclick="openPerson('${r.id}')" style="cursor:pointer;font-size:11px;padding:6px 8px;border-radius:4px;background:var(--surface2);display:flex;justify-content:space-between;gap:8px;align-items:center">
            <span>${displayId(r.id) ? `<span class="mono" style="color:var(--accent);font-weight:700">${displayId(r.id)}</span> ` : ""}${escapeHTML(displayPersonLabel(r.id))}</span>
            <span class="badge badge-accent" style="font-size:9px">YTT</span>
          </div>`).join("")}
        </div>` : `<div style="color:var(--muted);font-size:12px;padding:8px">Everyone in scope has taken IPPT 🎉</div>`}
      </div>
      <div class="card">
        <h3>Top Performers <span style="color:var(--muted);font-weight:400;font-size:10px">by ${aggMode === "best" ? "best" : "latest"} attempt</span></h3>
        ${topPerformers.length ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:400px;overflow-y:auto">
          ${topPerformers.map((e, idx) => `<div onclick="openPerson('${e.d4}')" style="cursor:pointer;font-size:11px;padding:6px 8px;border-radius:4px;background:var(--surface2);display:flex;align-items:center;gap:8px">
            <span class="mono" style="font-weight:700;color:var(--muted);min-width:18px">#${idx + 1}</span>
            <span style="flex:1">${displayId(e.d4) ? `<span class="mono" style="color:var(--accent);font-weight:700">${displayId(e.d4)}</span> ` : ""}${escapeHTML(displayPersonLabel(e.d4))}</span>
            <span class="mono" style="font-weight:700">${e.score}</span>
            ${awardBadge(e.score)}
          </div>`).join("")}
        </div>` : `<div style="color:var(--muted);font-size:12px;padding:8px">No taken results yet.</div>`}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Score Over Time <span style="color:var(--muted);font-weight:400;font-size:10px">mean &amp; median total, by date</span></h3>
        ${trendDates.length ? `<div class="chart-box tall"><canvas id="chart-ippt-trend"></canvas></div>` : `<div style="color:var(--muted);font-size:12px;padding:8px">Need taken results on at least one date.</div>`}
      </div>
      <div class="card">
        <h3>Static vs Run Strength <span style="color:var(--muted);font-weight:400;font-size:10px">latest attempt</span></h3>
        <div style="font-size:12px;line-height:1.7">
          <div><span class="badge badge-yellow">Stronger static</span> <strong>${strength.static.length}</strong> <span style="color:var(--muted)">(push-ups + sit-ups &gt; 2.4km)</span></div>
          <div><span class="badge badge-accent">Stronger run</span> <strong>${strength.run.length}</strong> <span style="color:var(--muted)">(2.4km &gt; push-ups + sit-ups)</span></div>
          <div><span class="badge badge-green">Balanced</span> <strong>${strength.balanced.length}</strong> <span style="color:var(--muted)">(within ±2 pts)</span></div>
          ${strength.unknown ? `<div style="color:var(--dim);font-size:11px;margin-top:4px">${strength.unknown} not classified (age missing on roster — can't derive station scores)</div>` : ""}
          ${strength.static.length ? `<div style="margin-top:6px;font-size:11px;color:var(--muted)"><strong style="color:var(--yellow)">Static:</strong> ${strength.static.map(d4 => escapeAttr(getName(d4) || displayId(d4))).join(", ")}</div>` : ""}
          ${strength.run.length ? `<div style="margin-top:4px;font-size:11px;color:var(--muted)"><strong style="color:var(--accent)">Run:</strong> ${strength.run.map(d4 => escapeAttr(getName(d4) || displayId(d4))).join(", ")}</div>` : ""}
        </div>
      </div>
    </div>

    ${hasMultiAttempt ? `
    <div class="grid-2">
      <div class="card">
        <h3>Attempt Progression <span style="color:var(--muted);font-weight:400;font-size:10px">per recruit · <span style="color:var(--green)">green</span> up / <span style="color:var(--red)">red</span> down vs first · bold = company avg</span></h3>
        <div class="chart-box tall"><canvas id="chart-ippt-progress"></canvas></div>
      </div>
      <div class="card">
        <h3>Award Mix by Attempt <span style="color:var(--muted);font-weight:400;font-size:10px">% of takers per attempt</span></h3>
        <div class="chart-box tall"><canvas id="chart-ippt-awardmix"></canvas></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3 style="font-size:15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">Compare Attempts
        <select id="ippt-cmp-a" class="topbar-select" onchange="ipptComparePick()">${attemptNums.map(n => `<option value="${n}" ${n === cmpA ? "selected" : ""}>IPPT ${n}</option>`).join("")}</select>
        <span style="color:var(--muted)">→</span>
        <select id="ippt-cmp-b" class="topbar-select" onchange="ipptComparePick()">${attemptNums.map(n => `<option value="${n}" ${n === cmpB ? "selected" : ""}>IPPT ${n}</option>`).join("")}</select>
        <span id="ippt-cmp-summary" style="color:var(--muted);font-weight:400;font-size:11px"></span>
      </h3>
      <div class="chart-box tall"><canvas id="chart-ippt-compare"></canvas></div>
    </div>` : ""}

    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      ${listSearchInput("ippt", "Search name / 4D…")}
      <select onchange="setIpptView(this.value)" class="topbar-select" title="Filter the table to one attempt number or one date">
        <option value="all" ${ipptView === "all" ? "selected" : ""}>All attempts &amp; dates</option>
        <optgroup label="By attempt">${attemptsAvail.map(a => `<option value="att:${a}" ${ipptView === "att:" + a ? "selected" : ""}>Attempt ${a}</option>`).join("")}</optgroup>
        <optgroup label="By date">${datesAvail.map(d => `<option value="date:${escapeAttr(d)}" ${ipptView === "date:" + d ? "selected" : ""}>${escapeAttr(d)}</option>`).join("")}</optgroup>
      </select>
      <span style="font-size:11px;color:var(--muted)">${tableRows.length} row${tableRows.length === 1 ? "" : "s"}</span>
    </div>
    ${tableRows.length ? `<div class="table-wrap"><table><thead><tr>${sortTh("ippt", "fourD", "4D")}${sortTh("ippt", "name", "Name", "left")}${sortTh("ippt", "attempt", "#")}${sortTh("ippt", "date", "Date")}${sortTh("ippt", "pushups", "PU")}${sortTh("ippt", "situps", "SU")}<th>2.4km</th>${sortTh("ippt", "score", "Score")}<th>Award</th><th></th></tr></thead><tbody>
    ${tableRows.map(i => `<tr><td class="mono" style="font-weight:700">${displayId(i.d4)}</td><td style="text-align:left">${escapeHTML(displayPersonLabel(i.d4))}</td><td>${i.attempt}</td><td>${i.date}</td><td>${i.pushups}</td><td>${i.situps}</td><td>${i.runTime}</td><td style="font-weight:700;font-size:15px">${isYTT(i) ? '<span style="color:var(--muted)">—</span>' : i.score}</td><td>${ipptAwardBadge(i)}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="openIPPTForm(${i.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="deleteEntry('ippt', ${i.id}, 'IPPT entry')" title="Delete">✕</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">${STATE.ippt.length ? `No IPPT entries match the current scope / filter.` : "No IPPT data yet. Add results or import CSV."}</div>`}`;

  // Charts attached after DOM is in place. Old instances were already wiped
  // by the destroy loop at the top of render().
  buildIPPTAwardsChart(stats);
  buildIPPTDistributionChart(buckets);
  buildIPPTTrendChart(ipptTrend);
  if (hasMultiAttempt) {
    buildIPPTProgressChart(ipptSeries);
    buildIPPTAwardMixChart(scoped, attemptNums);
    buildIPPTCompareChart(ipptSeries, cmpA, cmpB);
  }
}
let _ipptView = "all";
function setIpptView(v) { _ipptView = v; render(); }
// Compare-picker view state (attempt A → B). View-only; re-validated in
// renderIPPT against the live attempt set.
let _ipptCmpA = "", _ipptCmpB = "";
function setIpptCompare(a, b) { _ipptCmpA = a; _ipptCmpB = b; render(); }
function ipptComparePick() {
  const a = document.getElementById("ippt-cmp-a"), b = document.getElementById("ippt-cmp-b");
  if (a && b) setIpptCompare(a.value, b.value);
}

function buildIPPTTrendChart(trend) {
  const canvas = document.getElementById("chart-ippt-trend");
  if (!canvas || !trend.labels.length) return;
  STATE.charts.ipptTrend = new Chart(canvas, {
    type: "line",
    data: {
      labels: trend.labels,
      datasets: [
        { label: "Mean", data: trend.mean, borderColor: "#58A6FF", backgroundColor: "#58A6FF22", tension: .3, pointRadius: 3 },
        { label: "Median", data: trend.median, borderColor: "#3FB950", backgroundColor: "#3FB95022", tension: .3, pointRadius: 3 }
      ]
    },
    options: {
      plugins: { legend: { labels: { color: "#8B949E", font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, suggestedMax: 100, grid: { color: "#30363D" }, ticks: { color: "#8B949E" } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 10 } } }
      }
    }
  });
}

function buildIPPTAwardsChart(stats) {
  const canvas = document.getElementById("chart-ippt-awards");
  if (!canvas) return;
  // Order high → low so the legend reads top-to-bottom intuitively.
  // Only include non-zero slices so the chart isn't cluttered with empty tiers.
  const labels = [], data = [], colors = [];
  if (stats.goldStar) { labels.push("Gold★"); data.push(stats.goldStar); colors.push("#BC8CFF"); }
  if (stats.gold)     { labels.push("Gold");   data.push(stats.gold);     colors.push("#E3B341"); }
  if (stats.silver)   { labels.push("Silver"); data.push(stats.silver);   colors.push("#58A6FF"); }
  if (stats.pass)     { labels.push("Pass");   data.push(stats.pass);     colors.push("#3FB950"); }
  if (stats.fail)     { labels.push("Fail");   data.push(stats.fail);     colors.push("#F85149"); }
  if (stats.ytt)      { labels.push("YTT");    data.push(stats.ytt);      colors.push("#484F58"); }
  if (!data.length) return;

  STATE.charts.ipptAwards = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#161B22", borderWidth: 2 }] },
    options: { plugins: { legend: { position: "right", labels: { color: "#8B949E", font: { size: 11 } } } } }
  });
}

function buildIPPTDistributionChart(buckets) {
  const canvas = document.getElementById("chart-ippt-distribution");
  if (!canvas) return;
  // buckets: [YTT, Fail 0–60, Pass 61–74, Silver 75–84, Gold 85–89, Gold★ 90+]
  STATE.charts.ipptDistribution = new Chart(canvas, {
    type: "bar",
    data: {
      labels: ["YTT", "Fail", "Pass", "Silver", "Gold", "Gold★"],
      datasets: [{
        data: buckets,
        backgroundColor: ["#484F58", "#F85149", "#3FB950", "#58A6FF", "#E3B341", "#BC8CFF"],
        borderWidth: 0,
        borderRadius: 4
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "#30363D" }, ticks: { color: "#8B949E", stepSize: 1 } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 10 } } }
      }
    }
  });
}

// One line per recruit across their attempts (colour = net journey direction:
// green up / red down / grey flat), plus a bold company-average overlay. Legend
// off — one line per recruit would swamp it.
function buildIPPTProgressChart(series) {
  const canvas = document.getElementById("chart-ippt-progress");
  if (!canvas || !series.length) return;
  const allAttempts = [...new Set(series.flatMap(r => Object.keys(r.byAttempt).map(Number)))].sort((a, b) => a - b);
  if (!allAttempts.length) return;
  const colorFor = d => d > 0 ? "#3FB95088" : d < 0 ? "#F8514988" : "#484F5888";
  const datasets = series.map(r => {
    const c = colorFor(ipptNetDelta(r));
    return {
      label: r.d4,
      data: allAttempts.map(n => r.byAttempt[n] != null ? r.byAttempt[n] : null),
      borderColor: c, backgroundColor: c, borderWidth: 1.5, pointRadius: 2, tension: .2, spanGaps: true
    };
  });
  const avg = allAttempts.map(n => {
    const vals = series.map(r => r.byAttempt[n]).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  });
  datasets.push({ label: "Company avg", data: avg, borderColor: "#C9D1D9", backgroundColor: "#C9D1D9", borderWidth: 3, pointRadius: 3, tension: .2, spanGaps: true });
  STATE.charts.ipptProgress = new Chart(canvas, {
    type: "line",
    data: { labels: allAttempts.map(n => "IPPT " + n), datasets },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, suggestedMax: 100, grid: { color: "#30363D" }, ticks: { color: "#8B949E" } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 10 } } }
      }
    }
  });
}

// 100%-stacked bars, one per attempt, segmented by award tier. Percent-of-takers
// (not raw counts) so a smaller later cohort still compares honestly; tooltips
// carry the raw counts. Takers = non-YTT entries with a real run time.
function buildIPPTAwardMixChart(scoped, attemptNums) {
  const canvas = document.getElementById("chart-ippt-awardmix");
  if (!canvas || !attemptNums.length) return;
  const tiers = [
    { key: "Gold★", color: "#BC8CFF" }, { key: "Gold", color: "#E3B341" },
    { key: "Silver", color: "#58A6FF" }, { key: "Pass", color: "#3FB950" }, { key: "Fail", color: "#F85149" }
  ];
  const pct = {}, counts = {};
  tiers.forEach(t => { pct[t.key] = []; counts[t.key] = []; });
  attemptNums.forEach(n => {
    const takers = scoped.filter(e => +e.attempt === n && !isYTT(e) && parseRunTimeToSeconds(e.runTime) > 0);
    const tally = {}; tiers.forEach(t => tally[t.key] = 0);
    takers.forEach(e => { const a = getAward(+e.score || 0); if (tally[a] != null) tally[a]++; });
    tiers.forEach(t => {
      counts[t.key].push(tally[t.key]);
      pct[t.key].push(takers.length ? Math.round(tally[t.key] / takers.length * 100) : 0);
    });
  });
  STATE.charts.ipptAwardMix = new Chart(canvas, {
    type: "bar",
    data: {
      labels: attemptNums.map(n => "IPPT " + n),
      datasets: tiers.map(t => ({ label: t.key, data: pct[t.key], backgroundColor: t.color, _counts: counts[t.key] }))
    },
    options: {
      plugins: {
        legend: { labels: { color: "#8B949E", font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}% (${ctx.dataset._counts[ctx.dataIndex]})` } }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: "#8B949E" } },
        y: { stacked: true, min: 0, max: 100, grid: { color: "#30363D" }, ticks: { color: "#8B949E", callback: v => v + "%" } }
      }
    }
  });
}

// Paired A→B cohort: a diverging bar of each recruit's score delta (sorted),
// green up / red down. Fills the header summary with the up/down split.
function buildIPPTCompareChart(series, a, b) {
  const canvas = document.getElementById("chart-ippt-compare");
  if (!canvas) return;
  const cohort = ipptPairedCohort(series, a, b).slice().sort((x, y) => y.delta - x.delta);
  const sumEl = document.getElementById("ippt-cmp-summary");
  if (sumEl) {
    const up = cohort.filter(c => c.delta > 0).length, down = cohort.filter(c => c.delta < 0).length;
    sumEl.innerHTML = cohort.length
      ? `${cohort.length} took both · <span style="color:var(--green)">${up} up</span> · <span style="color:var(--red)">${down} down</span>`
      : "no recruit took both attempts";
  }
  if (!cohort.length) return;
  STATE.charts.ipptCompare = new Chart(canvas, {
    type: "bar",
    data: {
      labels: cohort.map(c => displayId(c.d4) || c.d4),
      datasets: [{
        label: `IPPT ${a} → ${b} Δ`,
        data: cohort.map(c => c.delta),
        backgroundColor: cohort.map(c => c.delta >= 0 ? "#3FB950" : "#F85149"),
        borderWidth: 0, borderRadius: 3
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => { const c = cohort[ctx.dataIndex]; return `${c.s1} → ${c.s2} (${c.delta >= 0 ? "+" : ""}${c.delta})`; } } }
      },
      scales: {
        y: { grid: { color: "#30363D" }, ticks: { color: "#8B949E" }, title: { display: true, text: "Δ score", color: "#8B949E" } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 9 }, maxRotation: 90 } }
      }
    }
  });
}

function renderRM(el) {
  const visible = visibleD4Set();
  const scoped = STATE.rm.filter(r => passesFilter(r.d4, visible));
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">Route March Tracker${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.rm.length}]</span>` : ""}</h2>
      <div style="display:flex;gap:8px">
        <label class="btn" style="cursor:pointer">Import CSV<input type="file" accept=".csv" onchange="importRM(this)" style="display:none"></label>
        <button class="btn btn-success" onclick="pushTab('RouteMarch',STATE.rm)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="openRMForm()">+ Add</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
    ${[{ n: 1, d: "3KM" }, { n: 2, d: "3KM" }, { n: 3, d: "3KM" }, { n: 4, d: "4KM" }, { n: 5, d: "8KM" }, { n: 6, d: "12KM" }].map(rm => `<div style="flex:1;min-width:90px;background:var(--surface2);border-radius:8px;padding:10px 12px;border:1px solid ${scoped.some(r => r.rmNum == rm.n) ? 'var(--green)' : 'var(--border)'};text-align:center"><div style="font-size:16px;font-weight:700;color:${scoped.some(r => r.rmNum == rm.n) ? 'var(--green)' : 'var(--muted)'}">RM ${rm.n}</div><div style="font-size:10px;color:var(--muted)">${rm.d}</div><div style="font-size:10px;color:var(--dim)">${scoped.filter(r => r.rmNum == rm.n).length} entries</div></div>`).join("")}
    </div>
    ${scoped.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>RM</th><th>Date</th><th>Finish Time</th><th>Avg HR</th><th>Max HR</th><th>Pass</th><th></th></tr></thead><tbody>
    ${scoped.map(r => `<tr><td class="mono" style="font-weight:700">${r.d4}</td><td style="text-align:left">${escapeHTML(getName(r.d4))}</td><td>${r.rmNum}</td><td>${r.date}</td><td class="mono" style="font-weight:700">${r.time}</td><td>${r.avgHr === "" || r.avgHr == null ? "—" : r.avgHr}</td><td>${r.maxHr === "" || r.maxHr == null ? "—" : r.maxHr}</td><td>${badge(r.pass === "Y" ? "PASS" : "FAIL", r.pass === "Y" ? "green" : "red")}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="openRMForm(${r.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="deleteEntry('rm', ${r.id}, 'route march entry')" title="Delete">✕</button></td></tr>`).join("")}
    </tbody></table></div>` : ""}`;
}

function renderSOC(el) {
  const visible = visibleD4Set();
  const scoped = STATE.soc.filter(s => passesFilter(s.d4, visible));
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">SOC Tracker${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.soc.length}]</span>` : ""}</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-success" onclick="pushTab('SOC',STATE.soc)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="openSOCForm()">+ Add</button>
      </div>
    </div>
    ${scoped.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>SOC#</th><th>Date</th><th>Duration</th><th>Avg HR</th><th>Pass</th><th></th></tr></thead><tbody>
    ${scoped.map(s => `<tr><td class="mono">${s.d4}</td><td style="text-align:left">${escapeHTML(getName(s.d4))}</td><td>${s.socNum}</td><td>${s.date}</td><td class="mono" style="font-weight:700">${socDurationDisplay(s.time)}</td><td>${s.avgHr === "" || s.avgHr == null ? "—" : s.avgHr}</td><td>${badge(s.pass === "Y" ? "PASS" : "FAIL", s.pass === "Y" ? "green" : "red")}</td><td style="white-space:nowrap"><button class="btn btn-icon" onclick="openSOCForm(${s.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="deleteEntry('soc', ${s.id}, 'SOC entry')" title="Delete">✕</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">${STATE.soc.length ? `No SOC entries in ${filterLabel()}.` : "No SOC data yet."}</div>`}`;
}

function renderPolar(el) {
  const visible = visibleD4Set();
  const scoped = STATE.polar.filter(p => passesFilter(p.d4, visible));
  const totalStagedPhotos = _polarStagedGroups.reduce((s, g) => s + g.photos.length, 0);

  // Group cards — one per conduct, conduct/date/time entered ONCE, then
  // many photos dropped into the same group.
  const groupCards = _polarStagedGroups.map(g => {
    const photos = g.photos.map(p => `
      <div style="position:relative;width:100px;height:60px;border-radius:4px;overflow:hidden;border:1px solid var(--border)">
        <img src="${escapeHTML(p.dataUrl)}" style="width:100%;height:100%;object-fit:cover">
        <div style="position:absolute;top:2px;left:2px;font-size:9px;color:${p.status === 'done' ? 'var(--green)' : p.status === 'error' ? 'var(--red)' : p.status === 'analyzing' ? 'var(--orange)' : 'var(--muted)'};background:rgba(13,17,23,.85);padding:1px 4px;border-radius:3px;text-transform:uppercase;letter-spacing:.5px">${p.status === 'done' ? `✓ ${p.added || 0}` : p.status === 'error' ? '✕' : p.status === 'analyzing' ? '…' : 'ready'}</div>
        <button class="btn btn-icon btn-danger" onclick="removePolarPhotoFromGroup(${g.id}, ${p.id})" title="Remove" style="position:absolute;top:2px;right:2px;font-size:9px;padding:1px 5px;line-height:1">✕</button>
      </div>
    `).join("");

    const pickerInputId = `polar-group-cid-${g.id}`;
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Conduct group · ${g.photos.length} photo${g.photos.length === 1 ? '' : 's'}</div>
        <button class="btn btn-icon btn-danger" onclick="removePolarGroup(${g.id})" title="Remove this group">✕ group</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 130px 90px;gap:6px;margin-bottom:8px">
        <div>${conductPicker({ inputId: pickerInputId, selectedId: g.conductId, onChange: `updatePolarGroup(${g.id}, 'conductId', document.getElementById('${pickerInputId}').value)` })}</div>
        <input type="date" value="${g.date}" onchange="updatePolarGroup(${g.id}, 'date', this.value)" style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px">
        <input type="text" maxlength="4" placeholder="0730" value="${escapeAttr(g.time)}" oninput="updatePolarGroup(${g.id}, 'time', this.value)" style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px" title="Auto-fills from past conducts">
      </div>
      ${g.photos.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${photos}</div>` : ""}
      <label class="btn" style="cursor:pointer;font-size:11px;padding:6px 10px;display:inline-block">+ Add photos to this group<input type="file" accept="image/*" multiple onchange="addPolarPhotosToGroup(${g.id}, this.files); this.value=''" style="display:none"></label>
      <div ondragover="event.preventDefault(); this.style.borderColor='var(--accent)'; this.style.background='#58A6FF11'" ondragleave="this.style.borderColor='var(--border)'; this.style.background='transparent'" ondrop="event.preventDefault(); this.style.borderColor='var(--border)'; this.style.background='transparent'; addPolarPhotosToGroup(${g.id}, event.dataTransfer.files)" style="display:inline-block;margin-left:6px;padding:6px 10px;font-size:11px;color:var(--muted);border:1px dashed var(--border);border-radius:6px">…or drop here</div>
    </div>`;
  }).join("");

  // Per-conduct "Polar attendance gaps" — for each conduct that has any
  // Polar data, show who actually attended (scoped roster − absent) but
  // doesn't appear in Polar for THAT conduct. Surfaces "wore the watch"
  // gaps at the per-class level instead of one global bucket.
  const conductKeys = [...new Set(STATE.polar.filter(p => p.conductId).map(p => `${p.date}|${p.conductId}|${p.time || ""}`))]
    .filter(k => k.split("|")[0] && k.split("|")[1]);
  const scopedRoster = filteredRoster().filter(r => r.role !== "Commander");
  const scopedRosterIds = new Set(scopedRoster.map(r => r.id));
  const conductGaps = conductKeys.map(k => {
    const [date, conductId, time] = k.split("|");
    const polarSet = new Set(STATE.polar.filter(p => p.date === date && p.conductId === conductId).map(p => p.d4));
    const absent = new Set(STATE.conductDetail
      .filter(c => c.date === date && c.conductId === conductId && (c.type === "Status" || c.type === "RSI" || c.type === "Fallout"))
      .map(c => c.d4));
    const expectedAttenders = [...scopedRosterIds].filter(id => !absent.has(id));
    const missing = expectedAttenders.filter(id => !polarSet.has(id));
    return { date, conductId, time, polarCount: polarSet.size, attended: expectedAttenders.length, missing };
  }).filter(g => g.missing.length > 0)
    .sort((a, b) => {
      const ai = displayDateToISO(a.date) || a.date || "";
      const bi = displayDateToISO(b.date) || b.date || "";
      return ai < bi ? 1 : -1;
    });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700">Polar Flow Data${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}/${STATE.polar.length}]</span>` : ""}</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label class="btn btn-primary" style="cursor:pointer">Import Polar CSV<input type="file" accept=".csv" onchange="importPolar(this)" style="display:none"></label>
        <button class="btn btn-success" onclick="pushTab('PolarFlow',STATE.polar)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div>
          <h3 style="margin:0">📸 Photo Import <span style="color:var(--dim);font-weight:400;font-size:11px">AI-extract Polar class summary</span></h3>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Add a conduct group, then drop the Polar summary screenshots for THAT conduct into it. One conduct = many photos.</div>
        </div>
        <button class="btn btn-primary" style="font-size:12px" onclick="addPolarGroup()">+ New conduct group</button>
      </div>
      ${groupCards}
      ${_polarStagedGroups.length === 0 ? `<div style="text-align:center;padding:16px;color:var(--muted);font-size:12px;border:1.5px dashed var(--border);border-radius:8px">Tap <strong>+ New conduct group</strong> to start. Each group holds one conduct's photos.</div>` : ""}
      ${totalStagedPhotos > 0 ? `
        <div id="polar-analyze-progress" style="display:none;font-size:12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px;margin-top:8px"></div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-success" style="flex:1;min-width:160px" onclick="analyzeAndPushPolarPhotos()">⚡ Analyze & Push ${totalStagedPhotos} photo${totalStagedPhotos === 1 ? '' : 's'} across ${_polarStagedGroups.filter(g => g.photos.length).length} conduct${_polarStagedGroups.filter(g => g.photos.length).length === 1 ? '' : 's'}</button>
          <button class="btn" onclick="_polarStagedGroups = []; render()">Clear all</button>
        </div>` : ""}
    </div>

    ${conductGaps.length ? `<div class="card" style="margin-bottom:14px">
      <h3>👻 Polar Attendance Gaps <span style="color:var(--dim);font-weight:400;font-size:11px">per conduct</span></h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Per conduct: recruits who attended (not Status/RSI/Fallout) but don't appear in Polar — chase them up to wear the watch.</div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:520px;overflow-y:auto">
        ${conductGaps.map(g => `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
            <div style="font-size:12px;font-weight:600">${g.date}${g.time ? ` <span class="mono" style="color:var(--muted);font-size:11px">${fmtHrs(g.time)}</span>` : ""} · ${escapeHTML(conductName(g.conductId))}</div>
            <div style="font-size:11px"><span style="color:var(--green)">${g.polarCount} wore polar</span> · <span style="color:var(--red);font-weight:700">${g.missing.length} didn't</span> · ${g.attended} attended</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${g.missing.map(d4 => `<button class="btn" style="font-size:10px;padding:3px 7px" onclick="openPerson('${d4}')" title="${escapeAttr(STATE.roster.find(r => r.id === d4)?.name || '')}"><span class="mono" style="color:var(--accent);font-weight:700">${displayId(d4)}</span> ${escapeHTML(STATE.roster.find(r => r.id === d4)?.name || '')}</button>`).join("")}
          </div>
        </div>`).join("")}
      </div>
    </div>` : ""}

    <div class="card"><h3>Expected CSV Columns</h3><code class="mono" style="font-size:11px;color:var(--accent)">4D, Conduct, Date, Avg HR, Max HR, Min HR, Calories, Training Load, Recovery, Duration, Distance</code></div>
    ${scoped.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>Conduct</th><th>Date</th><th>Avg HR</th><th>Max HR</th><th>Cal</th><th>Load</th><th>Dur</th></tr></thead><tbody>
    ${scoped.map(p => `<tr><td class="mono">${displayId(p.d4)}</td><td style="text-align:left">${escapeHTML(displayPersonLabel(p.d4))}</td><td style="text-align:left">${escapeHTML(conductName(p.conductId))}</td><td>${p.date}</td><td style="color:${+p.avgHr > 160 ? 'var(--red)' : +p.avgHr > 140 ? 'var(--orange)' : 'var(--green)'}">${p.avgHr}</td><td>${p.maxHr}</td><td>${p.calories}</td><td>${p.trainingLoad}</td><td>${p.duration}m</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">${STATE.polar.length ? `No Polar sessions in ${filterLabel()}.` : "No Polar data. Import a CSV or upload photos."}</div>`}`;
}

// ── Conduct Dashboard (Phase 2) ──────────────────────────────────────────────
// Aggregate, chart-led view of conduct PARTICIPATION buildup over a training
// cycle — distinct from the operational tables (renderAttendance /
// renderConductDetail / renderConducts). Sourced from STATE.conductDetail
// (misses typed Status/RSI/Fallout/ReportSick/PXP) + STATE.attendance
// (participation), scoped by the topbar filter, windowed by the date selector.
// Pure aggregation lives in calc.js (conductBuildup / perConductParticipation);
// this just wires STATE → calc → Chart.js (reusing the STATE.charts.* destroy
// pattern). Heavy chart construction is deferred on mobile (Feature 4).
let _conductDashStart;        // undefined → default window; "" → all-time; iso → windowed
let _conductDashEnd = "";
let _conductSeries = "";       // "" → all conducts; else a series base name (e.g. "Endurance Run")
const CONDUCT_TYPE_COLORS = { Status: "#F2A93B", RSI: "#F85149", Fallout: "#E8573A", ReportSick: "#A371F7", PXP: "#39D2C0" };
const CONDUCT_TYPE_LABELS = { Status: "Status", RSI: "RSI", Fallout: "Fallout", ReportSick: "Report Sick", PXP: "PX (excused)" };
const CONDUCT_GROUP_PALETTE = ["#58A6FF", "#3FB950", "#D29922", "#A371F7", "#F85149", "#39D2C0", "#E8573A", "#8B949E"];

// Date-window quick-select (30 / 90 / all). "" start = no lower bound.
function setConductWindow(days) {
  _conductDashEnd = todayISO();
  _conductDashStart = days === "all" ? "" : addDaysISO(todayISO(), -(Number(days) - 1));
  render();
}

// Conduct-class selector. "" → all conducts (date-windowed). A base name (e.g.
// "Endurance Run") → scope to that class's instances (#1..#N, all dates) and
// show the per-recruit progression list.
function setConductSeries(base) { _conductSeries = base || ""; render(); }

function renderConductDashboard(el) {
  const today = todayISO();
  if (_conductDashEnd === "") _conductDashEnd = today;
  if (_conductDashStart === undefined) _conductDashStart = addDaysISO(today, -89); // default: last 90 days
  const startIso = _conductDashStart, endIso = _conductDashEnd;
  const inWin = disp => {
    const iso = displayDateToISO(disp);
    if (!iso) return false;
    if (startIso && iso < startIso) return false;
    if (endIso && iso > endIso) return false;
    return true;
  };
  const winDays = startIso ? daysFromStartEndInclusive(startIso, endIso) : 0; // 0 = all

  // Conduct classes (series): group the registry by base name. Selecting one
  // scopes the dashboard to that class's instances and unlocks the per-recruit
  // progression list. The date window stays active in class mode too (pick "All"
  // to span the whole class), so charts AND progression honour it uniformly.
  // Group the conduct registry by series base in ONE pass — reused for the class
  // selector, its per-base instance counts, and the selected class's id set.
  // numById memoises each conduct's instance number so the chart-label code below
  // doesn't re-run the regex per row.
  const seriesGroups = {};          // base → { ids:Set, count }
  const numById = {};               // conductId → instance number
  (STATE.conducts || []).forEach(c => {
    const ps = parseConductSeries(c.name);
    numById[c.id] = ps.num;
    if (!ps.base) return;
    const g = seriesGroups[ps.base] || (seriesGroups[ps.base] = { ids: new Set(), count: 0 });
    g.ids.add(c.id); g.count++;
  });
  const bases = Object.keys(seriesGroups).sort();
  const seriesIds = (_conductSeries && seriesGroups[_conductSeries]) ? seriesGroups[_conductSeries].ids : null;
  const inSeries = id => !seriesIds || seriesIds.has(id);
  const keepDate = disp => inWin(disp);            // window applies in all modes (incl. class mode)
  const numOf = id => numById[id] != null ? numById[id] : parseConductSeries(conductName(id)).num;

  // Scope (topbar filter) + grouping: by section when narrowed to one platoon,
  // else by platoon.
  const visible = visibleD4Set();
  const scoped = isFilterActive() ? visible : null;
  const groupBy = STATE.filterPlt ? "section" : "platoon";
  const rosterById = {}; STATE.roster.forEach(r => { rosterById[r.id] = r; });
  const groupOf = d4 => {
    const r = rosterById[d4]; if (!r) return "Unassigned";
    return (groupBy === "section" ? personSection(r) : personPlatoon(r)) || "Unassigned";
  };

  // Aggregation column key: in class mode each INSTANCE is its own column (keyed
  // by instance number, zero-padded so string-sort == numeric-sort) so two
  // instances logged on the same calendar date don't collapse into one bar/point.
  // In all-conducts mode the column is the conduct date.
  const colKeyOf = c => seriesIds ? "i" + String(numOf(c.conductId)).padStart(6, "0") : displayDateToISO(c.date);

  // Miss rows (scope + window/series), tagged with group + column key → calc aggregation.
  const missDetailRows = (STATE.conductDetail || [])
    .filter(c => passesFilter(c.d4, visible) && inSeries(c.conductId) && keepDate(c.date));
  const missRows = missDetailRows
    .map(c => ({ dateIso: colKeyOf(c), group: groupOf(c.d4), type: c.type }));
  const agg = conductBuildup(missRows);

  // Participation per conduct (scope-aware) + scoped average for the tile. attnWin
  // only keeps rows with a parseable date (keepDate already enforces this), and the
  // tile + trend are fed the same set, so they always count the same conducts. The
  // out-row index is built once and shared by both calc helpers.
  const outByIdx = scoped ? conductOutByIndex(STATE.conductDetail || []) : null;
  const attnWin = (STATE.attendance || [])
    .filter(a => inSeries(a.conductId) && keepDate(a.date))
    .map(a => Object.assign({}, a, { dateIso: displayDateToISO(a.date) }));
  const part = perConductParticipation(attnWin, STATE.conductDetail || [], scoped, outByIdx)
    .sort((a, b) => a.dateIso < b.dateIso ? -1 : (a.dateIso > b.dateIso ? 1 : 0));
  const avg = scopedParticipation(attnWin, STATE.conductDetail || [], scoped, outByIdx);

  // A conduct counts as "logged" if it has an attendance row with real data OR a
  // tracked miss in scope — so a session where the whole scope was on status
  // (total 0, no participants) still counts instead of the tile reading 0 while
  // Total Misses shows its misses.
  const loggedIds = new Set();
  attnWin.forEach(a => { if (Number(a.total) > 0 || parseParticipantIds(a.participants).length) loggedIds.add(a.conductId); });
  missDetailRows.forEach(c => loggedIds.add(c.conductId));
  const conductsLogged = loggedIds.size;

  // Series mode: per-recruit progression through the class (calc.conductProgress).
  let progressionHTML = "";
  if (seriesIds) {
    // Held instances + who attended — drawn from the windowed class attendance
    // (attnWin), so the progression frontier/position respect the date window too.
    const presentByConduct = {};
    attnWin.forEach(a => {
      presentByConduct[a.conductId] = new Set(parseParticipantIds(a.participants));
    });
    // Held = class instances that actually ran in-window — one with real
    // attendance data or a tracked miss (loggedIds). An empty placeholder
    // attendance row (no participants, no misses) is excluded so it can't inflate
    // the company frontier or every recruit's completion denominator.
    const held = (STATE.conducts || [])
      .filter(c => seriesIds.has(c.id) && loggedIds.has(c.id))
      .map(c => ({ conductId: c.id, num: numById[c.id] }));
    const recruitIds = filteredRoster().map(r => r.id);
    const prog = conductProgress(held, presentByConduct, recruitIds);
    const rows = prog.rows.slice().sort((a, b) => (a.position - b.position) || (b.behind - a.behind) || (b.missed.length - a.missed.length));
    const frontier = prog.seriesMax ? `${escapeHTML(_conductSeries)} ${prog.seriesMax}` : "—";
    const curCell = p => p.position ? `${escapeHTML(_conductSeries)} ${p.position}` : `<span style="color:var(--dim)">Not started</span>`;
    const statusCell = p => {
      if (!p.position) return `<span style="color:var(--muted)">Not started</span>`;
      const bits = [];
      if (p.behind > 0) bits.push(`<span style="color:var(--orange)">behind ${p.behind}</span>`);
      if (p.missed.length) bits.push(`<span style="color:var(--red)">${p.missed.length} gap${p.missed.length > 1 ? "s" : ""}</span>`);
      return bits.length ? bits.join(" · ") : `<span style="color:var(--green)">✓ on track</span>`;
    };
    progressionHTML = `<div class="card" style="margin-top:10px">
      <h3>Class Progression — ${escapeHTML(_conductSeries)} <span style="font-weight:400;color:var(--dim);font-size:11px">(company frontier: ${frontier} · ${prog.held.length} held)</span></h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${isFilterActive() ? filterLabel() : "Whole company"} — each member's latest attended instance, gaps below it (missed), and how far behind the frontier they are. Click a row to open the member.</div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th style="text-align:left">Name</th><th>Current</th><th>Done</th><th style="text-align:left">Missed</th><th style="text-align:left">Status</th></tr></thead><tbody>
        ${rows.map(p => `<tr onclick="openPerson('${p.d4}')" style="cursor:pointer"><td class="mono" style="font-weight:700;color:var(--accent)">${displayId(p.d4)}</td><td style="text-align:left">${escapeHTML(displayPersonLabel(p.d4))}</td><td>${curCell(p)}</td><td>${p.completed}/${prog.held.length}</td><td style="text-align:left;color:${p.missed.length ? "var(--red)" : "var(--dim)"}">${p.missed.length ? p.missed.map(n => "#" + n).join(", ") : "—"}</td><td style="text-align:left">${statusCell(p)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty-state" style="padding:12px;font-size:12px">No members in scope.</div>`}
    </div>`;
  }

  const hasData = agg.dates.length > 0 || part.length > 0;
  const deferActive = shouldDeferCharts() && hasData;
  const winBtn = (label, days) => {
    const activeWin = (days === "all" && !startIso) || (days !== "all" && Number(days) === winDays);
    return `<button class="btn${activeWin ? " btn-primary" : ""}" style="font-size:11px" onclick="setConductWindow('${days}')">${label}</button>`;
  };
  const seriesSelect = `<select class="topbar-select" style="font-size:11px" onchange="setConductSeries(this.value)" title="Scope to a conduct class (series)">
      <option value="">All conducts</option>
      ${bases.map(b => { const n = seriesGroups[b].count; return `<option value="${escapeAttr(b)}" ${b === _conductSeries ? "selected" : ""}>${escapeHTML(b)}${n > 1 ? ` (${n})` : ""}</option>`; }).join("")}
    </select>`;
  const scopeBanner = isFilterActive()
    ? `<div style="font-size:11px;color:var(--accent);margin-bottom:8px">Scope: <strong>${filterLabel()}</strong>${seriesIds ? ` · class <strong>${escapeHTML(_conductSeries)}</strong>` : ""} — buildup grouped by ${groupBy}.</div>`
    : `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">${seriesIds ? `Class <strong>${escapeHTML(_conductSeries)}</strong> — ` : "Whole company — "}buildup grouped by ${groupBy}. Use the topbar filter to scope by platoon/section.</div>`;
  const prefHint = STATE.deferCharts === "auto" ? "auto" : STATE.deferCharts;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;flex-wrap:wrap">
      <h2 style="font-size:18px;font-weight:700">📈 Conduct Dashboard</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${seriesSelect}
        ${winBtn("30d", "30")}${winBtn("90d", "90")}${winBtn("All", "all")}
        <span style="font-size:10px;color:var(--dim);margin-left:6px">Charts: ${prefHint} ·
          <a href="#" onclick="setChartPref('${STATE.deferCharts === 'defer' ? 'eager' : 'defer'}');return false" style="color:var(--accent)">${STATE.deferCharts === "defer" ? "auto-load" : "defer"}</a></span>
      </div>
    </div>
    ${scopeBanner}
    <div class="stats-row" style="margin-top:8px">
      <div class="stat"><label>${seriesIds ? "Instances" : "Conducts"}</label><div class="val">${conductsLogged}</div></div>
      <div class="stat"><label>Avg Part.</label><div class="val" style="color:var(--accent)" title="${avg.conducts} conduct(s) in scope">${avg.pct}%</div></div>
      <div class="stat"><label>Total Misses</label><div class="val" style="color:var(--red)">${agg.totalMisses}</div></div>
      <div class="stat"><label>Worst Type</label><div class="val" style="color:var(--orange);font-size:18px">${agg.worstType ? (CONDUCT_TYPE_LABELS[agg.worstType] || agg.worstType) : "—"}</div></div>
    </div>
    ${progressionHTML}
    ${hasData ? `
    <div id="cd-charts"${deferActive ? ' style="display:none"' : ''}>
      <div class="card" style="margin-top:10px"><h3>Cumulative Conduct-Miss Buildup <span style="font-weight:400;color:var(--dim);font-size:11px">(running total by ${groupBy})</span></h3><div class="chart-box" style="height:220px"><canvas id="cd-cumulative"></canvas></div></div>
      <div class="grid-2">
        <div class="card"><h3>Miss Composition${seriesIds ? " by Instance" : " Over Time"}</h3><div class="chart-box" style="height:220px"><canvas id="cd-stacks"></canvas></div></div>
        <div class="card"><h3>Participation${seriesIds ? " by Instance" : " Trend"}</h3><div class="chart-box" style="height:220px"><canvas id="cd-participation"></canvas></div></div>
      </div>
    </div>
    ${deferActive ? chartGateMarkup("loadConductDashCharts()", "cd-chart-gate") : ""}`
    : `<div class="empty-state" style="padding:24px;font-size:13px;text-align:center;color:var(--muted)">No conduct data ${seriesIds ? `for class "${escapeHTML(_conductSeries)}"` : ""} in this window/scope. Log conducts in the Attendance tab or widen the date window.</div>`}
  `;

  if (!hasData) return;

  // X-axis label decode: in class mode the column key is "i<padded-num>" → "#N";
  // in all-conducts mode it's an ISO date → day/month.
  const dm = key => {
    if (seriesIds) { const n = Number(String(key).replace(/^i/, "")); return isNaN(n) ? key : "#" + n; }
    const d = new Date(key + "T00:00:00"); return isNaN(d) ? key : `${d.getDate()}/${d.getMonth() + 1}`;
  };
  const rateColorHex = r => r >= 95 ? "#3FB950" : r >= 70 ? "#D29922" : "#F85149";
  const axisBase = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#8B949E", font: { size: 11 }, padding: 12, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
      tooltip: { backgroundColor: "#161B22", borderColor: "#30363D", borderWidth: 1, padding: 10, titleColor: "#E6EDF3", bodyColor: "#E6EDF3", cornerRadius: 6 }
    },
    scales: {
      y: { beginAtZero: true, ticks: { color: "#8B949E", font: { size: 10 }, precision: 0, padding: 6 }, grid: { color: "#30363D55", drawTicks: false }, border: { display: false } },
      x: { ticks: { color: "#8B949E", font: { size: 10 }, maxRotation: 0, autoSkip: true, padding: 4 }, grid: { display: false }, border: { display: false } }
    }
  };

  const buildConductDashCharts = () => {
    // 1) Cumulative buildup line — one line per group.
    STATE.charts.cdCumulative = new Chart(document.getElementById("cd-cumulative"), {
      type: "line",
      data: {
        labels: agg.dates.map(dm),
        datasets: agg.groups.map((g, i) => {
          const col = CONDUCT_GROUP_PALETTE[i % CONDUCT_GROUP_PALETTE.length];
          return { label: g, data: agg.cumulative[g], borderColor: col, backgroundColor: col + "22", tension: 0.3, fill: false, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2 };
        })
      },
      options: { ...axisBase, plugins: { ...axisBase.plugins, legend: { ...axisBase.plugins.legend, position: "bottom" } } }
    });

    // 2) Miss-type composition — stacked bars per conduct date.
    STATE.charts.cdStacks = new Chart(document.getElementById("cd-stacks"), {
      type: "bar",
      data: {
        labels: agg.dates.map(dm),
        datasets: agg.types.map(t => ({
          label: CONDUCT_TYPE_LABELS[t] || t,
          data: agg.stacks[t],
          backgroundColor: CONDUCT_TYPE_COLORS[t] || "#8B949E",
          stack: "a", borderWidth: 0, borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.85
        }))
      },
      options: {
        ...axisBase,
        plugins: { ...axisBase.plugins, legend: { ...axisBase.plugins.legend, position: "bottom" },
          tooltip: { ...axisBase.plugins.tooltip, callbacks: { footer: items => { const t = items.reduce((s, i) => s + (i.parsed.y || 0), 0); return t ? `Total: ${t}` : ""; } } } },
        scales: { ...axisBase.scales, x: { ...axisBase.scales.x, stacked: true }, y: { ...axisBase.scales.y, stacked: true } }
      }
    });

    // 3) Participation trend — colour-coded by rate (matches the attendance table).
    const pData = part.map(p => p.pct);
    const pColors = pData.map(rateColorHex);
    STATE.charts.cdParticipation = new Chart(document.getElementById("cd-participation"), {
      type: "line",
      data: { labels: part.map(p => seriesIds ? "#" + numOf(p.conductId) : conductName(p.conductId).slice(0, 12)), datasets: [{
        data: pData, borderColor: "#8B949E", borderWidth: 2, tension: 0.35, fill: false,
        pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: pColors, pointBorderColor: pColors,
        segment: { borderColor: ctx => rateColorHex(pData[ctx.p1DataIndex]) }
      }] },
      options: { ...axisBase, plugins: { ...axisBase.plugins, legend: { display: false } }, scales: { ...axisBase.scales, y: { ...axisBase.scales.y, grace: "10%" } } }
    });
  };

  if (deferActive) _deferredBuilders["cd-chart-gate"] = buildConductDashCharts; else buildConductDashCharts();
}

// Conducts registry admin tab. Lists every entry in STATE.conducts with usage
// counts across attendance / polar / conductDetail, and offers rename / merge
// / delete actions. New conducts created here become available immediately
// in every form's conduct picker (the picker reads from STATE.conducts).
function renderConducts(el) {
  const rows = [...STATE.conducts].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const totalUsage = rows.reduce((s, c) => s + countConductUsage(c.id).total, 0);
  const orphanedCount = (arr) => arr.filter(r => r.conductId !== undefined && !STATE.conducts.find(c => c.id === r.conductId)).length;
  const orphans = orphanedCount(STATE.attendance) + orphanedCount(STATE.polar) + orphanedCount(STATE.conductDetail);
  const anyRecordsWithConductId = STATE.attendance.some(r => r.conductId) || STATE.polar.some(r => r.conductId) || STATE.conductDetail.some(r => r.conductId);
  const emptyRegistryWithUsage = rows.length === 0 && anyRecordsWithConductId;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700">Conducts Registry <span style="color:var(--muted);font-weight:400;font-size:13px">${rows.length} entries · ${totalUsage} record${totalUsage === 1 ? "" : "s"}</span></h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${needsConductMigration() ? `<button class="btn" onclick="maybeRunConductMigration()" title="Open the legacy-data migration modal">🔧 Migrate legacy data</button>` : ""}
        ${duplicateConductIdGroups().length ? `<button class="btn" style="background:#F8514922;border-color:#F8514944;color:var(--red)" onclick="openFixConductIdsModal()" title="Multiple conducts share the same id — records resolve to the wrong name. Fix it.">⚠️ Fix duplicate ids (${duplicateConductIdGroups().length})</button>` : ""}
        <button class="btn btn-success" onclick="pushTab('Conducts',STATE.conducts)" title="Full re-write of this tab. Useful after manual sheet edits or to recover from a sync failure — normal edits auto-push.">↻ Re-push all</button>
        <button class="btn btn-primary" onclick="promptCreateConduct()">+ New conduct</button>
      </div>
    </div>
    ${emptyRegistryWithUsage ? `<div class="card" style="padding:12px 14px;margin-bottom:12px;background:#F8514922;border:1px solid #F8514944;font-size:12px;color:var(--red);line-height:1.6">
      <strong>⚠️ Registry is empty but records reference conductIds.</strong> This usually means the Apps Script backend wasn't redeployed with the new <code>Conducts</code> tab in its <code>readAllTabs</code> map. Until that's fixed, conduct names will show as <code>[c001?]</code> placeholders across the app.
      <div style="margin-top:6px;color:var(--muted)">Fix: open Apps Script editor → confirm <code>"Conducts": "conducts"</code> is in <code>tabMap</code> → Deploy → Manage deployments → New version. Then pull again.</div>
    </div>` : ""}
    <div class="card" style="padding:10px 14px;margin-bottom:12px;background:var(--surface2);font-size:11px;color:var(--muted);line-height:1.6">
      Conduct names are renames-safe — every record references the conduct by ID, so renaming here updates every display site without touching record data.
      Use <strong>Merge</strong> to fix near-duplicates that slipped through; use <strong>Delete</strong> only when usage is 0.
      ${orphans > 0 ? `<div style="color:var(--red);margin-top:6px"><strong>Warning:</strong> ${orphans} record${orphans === 1 ? " references" : "s reference"} a conductId not in the registry. Edit those records to repoint them.</div>` : ""}
    </div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th style="text-align:left">Name</th><th>Attendance</th><th>Polar</th><th>Detail</th><th>Total</th><th></th></tr></thead><tbody>
      ${rows.map(c => {
        const u = countConductUsage(c.id);
        const mergeOpts = rows.filter(o => o.id !== c.id).map(o => `<option value="${o.id}">→ ${escapeAttr(o.name)}</option>`).join("");
        return `<tr>
          <td class="mono" style="color:var(--muted);font-size:11px">${c.id}</td>
          <td style="text-align:left;font-weight:600">${escapeAttr(c.name)}</td>
          <td>${u.attendance}</td>
          <td>${u.polar}</td>
          <td>${u.detail}</td>
          <td style="font-weight:700;color:${u.total > 0 ? 'var(--accent)' : 'var(--muted)'}">${u.total}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-icon" onclick="promptRenameConduct('${c.id}')" title="Rename">✎</button>
            <select onchange="if (this.value) { mergeConductInto('${c.id}', this.value); this.value=''; }" style="font-size:10px;padding:2px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px" title="Merge into another conduct">
              <option value="">Merge →</option>
              ${mergeOpts}
            </select>
            <button class="btn btn-icon btn-danger" onclick="deleteConduct('${c.id}')" title="${u.total > 0 ? `Cannot delete — used by ${u.total} record(s)` : 'Delete'}" ${u.total > 0 ? "disabled" : ""}>✕</button>
          </td>
        </tr>`;
      }).join("")}
    </tbody></table></div>` : `<div class="empty-state">No conducts yet. Add one with "+ New conduct" or run the legacy-data migration if you have existing records.</div>`}
  `;
}

function promptCreateConduct() {
  const name = (prompt("New conduct name:") || "").trim();
  if (!name) return;
  const existingId = conductIdByName(name);
  if (existingId) {
    alert(`"${name}" already exists (id ${existingId}).`);
    return;
  }
  createConduct(name);
  render();
}

function promptRenameConduct(id) {
  const c = STATE.conducts.find(x => x.id === id);
  if (!c) return;
  const newName = prompt("New name:", c.name);
  if (newName == null) return;
  renameConduct(id, newName);
}
// Render the Heat Acclimatisation (HA) tab (Braves §13 — three programmes).
// Status set (§12.6): Not Started / In Progress / Single HA Complete /
// In Progress (Double) / Double HA Complete / Lapsed. Track colours: Single=teal,
// Expanded=amber, Double=blue.
function haStatusColor(status) {
  switch (status) {
    case "Double HA Complete": return "#388BFD";   // blue
    case "Single HA Complete": return "#3FB950";    // green
    case "In Progress (Double)": return "#58A6FF";  // light blue
    case "In Progress": return "#D29922";           // amber
    case "Lapsed": return "#F85149";                // red
    default: return "#8B949E";                      // muted (Not Started)
  }
}
const HA_STATUSES = ["Not Started", "In Progress", "Single HA Complete", "In Progress (Double)", "Double HA Complete", "Lapsed"];

function renderHA(el) {
  const scoped = filteredRoster().filter(r => r.role === "Recruit" || r.role === "");
  const haResults = scoped.map(r => ({ recruit: r, ha: computeHA(r.id) }));

  // Sort by status priority (worst first) then Single progress ascending.
  const prio = { "Lapsed": 0, "Not Started": 1, "In Progress": 2, "Single HA Complete": 3, "In Progress (Double)": 4, "Double HA Complete": 5 };
  haResults.sort((a, b) => {
    const pa = prio[a.ha.overallStatus] ?? 9, pb = prio[b.ha.overallStatus] ?? 9;
    if (pa !== pb) return pa - pb;
    return (a.ha.single?.periods || 0) - (b.ha.single?.periods || 0);
  });
  // D1: name/4D search + optional column sort (default stays worst-status-first).
  const _haQ = listCtl("ha").q.trim().toLowerCase();
  let haRows = _haQ
    ? haResults.filter(({ recruit: r }) => (String(r.name || "").toLowerCase().includes(_haQ) || String(r.id || "").toLowerCase().includes(_haQ)))
    : haResults;
  haRows = listApplySort("ha", haRows, {
    fourD: x => x.recruit.id || "",
    name: x => x.recruit.name || "",
    status: x => prio[x.ha.overallStatus] ?? 9,
    single: x => x.ha.single?.periods || 0
  });

  const count = s => haResults.filter(x => x.ha.overallStatus === s).length;
  const counts = HA_STATUSES.map(count);

  const cell = (val, target, color) => {
    const pct = Math.min(100, Math.round((val / target) * 100));
    return `<div style="min-width:84px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:2px">${val}/${target}</div>
      <div style="height:6px;background:var(--surface);border:1px solid var(--border);border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${color}"></div></div>
    </div>`;
  };

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 style="font-size:18px;font-weight:700">Heat Acclimatisation (HA) Tracker${isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}: ${scoped.length}]</span>` : ""}</h2>
      ${listSearchInput("ha", "Search name / 4D…")}
    </div>

    <div class="stats-row">
      <div class="stat"><label>Recruits</label><div class="val">${scoped.length}</div></div>
      ${HA_STATUSES.map((s, i) => `<div class="stat" style="border-left:3px solid ${haStatusColor(s)}"><label>${s}</label><div class="val" style="color:${haStatusColor(s)}">${counts[i]}</div></div>`).join("")}
    </div>

    <div class="grid-2" style="margin-bottom:20px">
      <div class="card" style="padding:16px;min-height:280px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Status Breakdown</h3>
        <div style="height:200px;position:relative;width:100%;overflow:hidden"><canvas id="chart-ha-distribution" style="width:100% !important;height:100% !important"></canvas></div>
      </div>
      <div class="card" style="padding:16px;min-height:280px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Single HA Progress (periods /10)</h3>
        <div style="height:200px;overflow-y:auto;overflow-x:hidden;position:relative;width:100%"><canvas id="chart-ha-streaks" style="width:100% !important;display:block"></canvas></div>
      </div>
    </div>

    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Acclimatisation Status Roster</h3>
      <div class="table-wrap"><table>
        <thead><tr>
          ${sortTh("ha", "fourD", "4D")}${sortTh("ha", "name", "Name", "left")}<th>Plt/Sect</th>${sortTh("ha", "status", "Status")}
          ${sortTh("ha", "single", "Single (/10)", "left")}<th style="text-align:left">Expanded (/14)</th><th style="text-align:left">Double (/13)</th>
          <th>Last Activity</th><th>Currency</th>
        </tr></thead>
        <tbody>
          ${haRows.map(({ recruit: r, ha }) => {
            const c = haStatusColor(ha.overallStatus);
            const dbl = !ha.doubleEligible
              ? `<span style="font-size:10px;color:var(--muted)">🔒 ${ha.singleStatus === "Single HA Complete" || ha.overallStatus.includes("Double") ? "ineligible" : "locked"}</span>`
              : cell(ha.doubleTrack?.periods || 0, 13, "#388BFD");
            const last = ha.lastActivity ? isoToDisplayDate(ha.lastActivity) : '<span style="color:var(--muted)">—</span>';
            const curr = ha.currency && ha.currency.lapsed
              ? `<span style="color:var(--red)">lapsed ${ha.currency.lapseDateIso ? isoToDisplayDate(ha.currency.lapseDateIso) : ""}</span>`
              : (ha.currency && ha.currency.deadlineIso ? `<span style="color:var(--muted)">by ${isoToDisplayDate(ha.currency.deadlineIso)}</span>` : "—");
            return `<tr onclick="openPerson('${r.id}')" style="cursor:pointer">
              <td class="mono" style="font-weight:700;color:var(--accent)">${displayId(r.id)}</td>
              <td style="text-align:left">${escapeHTML(displayPersonLabel(r.id))}</td>
              <td>${personPlatoon(r) || "—"}${personSection(r) ? " · " + personSection(r) : ""}</td>
              <td><span class="badge" style="background:${c}22;color:${c};border:1px solid ${c}44;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600">${ha.overallStatus}</span></td>
              <td style="text-align:left">${cell(ha.single?.periods || 0, 10, "#2DD4BF")}</td>
              <td style="text-align:left">${cell(ha.expanded?.periods || 0, 14, "#D29922")}</td>
              <td style="text-align:left">${dbl}</td>
              <td>${last}</td>
              <td style="font-size:11px">${curr}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>
    </div>
  `;

  buildHADistributionChart(counts);
  buildHAStreaksChart(haResults);
}

function buildHADistributionChart(counts) {
  const canvas = document.getElementById("chart-ha-distribution");
  if (!canvas) return;
  STATE.charts.haDistribution = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: HA_STATUSES,
      datasets: [{
        data: counts,
        backgroundColor: HA_STATUSES.map(haStatusColor),
        borderColor: "#161B22",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "right", labels: { color: "#8B949E", font: { size: 11 } } } }
    }
  });
}

function buildHAStreaksChart(haResults) {
  const canvas = document.getElementById("chart-ha-streaks");
  if (!canvas) return;
  const sorted = [...haResults].sort((a, b) => (a.ha.single?.periods || 0) - (b.ha.single?.periods || 0));
  const labels = sorted.map(r => r.recruit.name || r.recruit.id);
  const data = sorted.map(r => r.ha.single?.periods || 0);
  const colors = sorted.map(r => haStatusColor(r.ha.overallStatus));
  const chartHeight = Math.max(200, sorted.length * 18);
  canvas.style.height = chartHeight + "px";
  canvas.style.width = "100%";
  STATE.charts.haStreaks = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ label: "Single HA periods", data, backgroundColor: colors, borderWidth: 0, borderRadius: 4 }] },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { min: 0, max: 10, ticks: { stepSize: 1, color: "#8B949E" }, grid: { color: "#30363D" } },
        y: { ticks: { color: "#8B949E", font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// STATUS BOARD (addendum A3 Leaderboard + A7 Roster Status List + A4 Status Grid)
// ════════════════════════════════════════════════════════════════════════════
let _sbSort = (() => { try { return localStorage.getItem("braves-sb-sort") || "Total"; } catch { return "Total"; } })();
let _sbCollapsed = (() => { try { return localStorage.getItem("braves-sb-collapsed") === "1"; } catch { return false; } })();
let _sbShowAll = false;
let _sbWeekOffset = 0;     // grid paging, in 5-week windows (0 = current)
let _sbSearch = "";
let _sbGridShown = false;  // lazy-load: false → show the "Load grid" gate (mobile)

// Grid cell palette (A4.2).
const SB_CELL = {
  RSI: { bg: "#EF9F27", fg: "#633806" }, RSO: { bg: "#378ADD", fg: "#042C53" },
  MC:  { bg: "#E24B4A", fg: "#501313" }, MR:  { bg: "#7F77DD", fg: "#26215C" },
  LD:  { bg: "#B4B2A9", fg: "#2C2C2A" }, LV:  { bg: "#1D9E75", fg: "#04342C" },
  EX:  { bg: "#B08D57", fg: "#241B0E" },  // Excuse-* — distinct from LD's grey
  WD:  { bg: "#9F1239", fg: "#3F0518" }   // Warded — away/not-in-camp, distinct from MC's red
};
function _sbKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

// Section-grouped ordering (A4.3/A7.4): platoon (HQ last), section (Command first,
// then numeric), then name.
function sbOrdered(rows) {
  const plRank = c => c === "HQ" ? 9999 : (parseInt(String(c).replace(/\D/g, ""), 10) || 9000);
  const secRank = s => s === "Command" ? -1 : (parseInt(s, 10) || 9000);
  return [...rows].sort((a, b) => {
    const pa = plRank(personPlatoon(a)), pb = plRank(personPlatoon(b));
    if (pa !== pb) return pa - pb;
    const sa = secRank(personSection(a)), sb = secRank(personSection(b));
    if (sa !== sb) return sa - sb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }).map(r => ({ r, group: `${personPlatoon(r) || "—"}${personSection(r) ? " · " + (personSection(r) === "Command" ? "Command" : "Sect " + personSection(r)) : ""}` }));
}

// RSI/RSO counts per person from the Medical tab (A3.1 / A4.6).
function sbRSCounts() {
  const map = {};
  (STATE.medical || []).forEach(m => {
    if (m.type !== "RSI" && m.type !== "RSO") return;
    const e = map[m.d4] = map[m.d4] || { rsi: 0, rso: 0 };
    if (m.type === "RSI") e.rsi++; else e.rso++;
  });
  return map;
}

function renderStatusBoard(el) {
  const scopeLabel = isFilterActive() ? ` <span style="color:var(--accent);font-size:13px">[${filterLabel()}]</span>` : "";
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <h2 style="font-size:18px;font-weight:700">🗓️ Status Board${scopeLabel}</h2>
    </div>
    <div id="sb-leaderboard" class="card" style="padding:14px;margin-bottom:14px"></div>
    <div id="sb-rosterlist" class="card" style="padding:14px;margin-bottom:14px"></div>
    <div id="sb-grid" class="card" style="padding:14px"></div>
    <div id="sb-popover"></div>
  `;
  _sbGridShown = false;   // re-defer the heavy calendar grid each time the board opens
  renderSBLeaderboard();
  renderSBRosterList();
  renderSBGrid();
}

// ── A3. Report Sick Leaderboard ─────────────────────────────────────────────
function renderSBLeaderboard() {
  const host = document.getElementById("sb-leaderboard");
  if (!host) return;
  const counts = sbRSCounts();
  const scoped = filteredRoster();
  let rows = scoped.map(r => {
    const c = counts[r.id] || { rsi: 0, rso: 0 };
    return { r, rsi: c.rsi, rso: c.rso, total: c.rsi + c.rso };
  });
  const byName = (a, b) => String(a.r.name || "").localeCompare(String(b.r.name || ""));
  const fourDNum = x => { const n = parseInt(String(x.r.fourD || x.r.id || ""), 10); return Number.isFinite(n) ? n : Infinity; };
  if (_sbSort === "Total") rows = rows.filter(x => x.total > 0).sort((a, b) => b.total - a.total || byName(a, b));
  else if (_sbSort === "RSI") rows = rows.filter(x => x.total > 0).sort((a, b) => b.rsi - a.rsi || b.total - a.total);
  else if (_sbSort === "RSO") rows = rows.filter(x => x.total > 0).sort((a, b) => b.rso - a.rso || b.total - a.total);
  else rows = rows.sort((a, b) => fourDNum(a) - fourDNum(b) || byName(a, b)); // 4D

  const shown = _sbCollapsed ? [] : (_sbShowAll ? rows : rows.slice(0, 3));
  const tab = m => `<button onclick="sbSetSort('${m}')" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border);background:${_sbSort === m ? "var(--accent)" : "var(--surface)"};color:${_sbSort === m ? "#fff" : "var(--text)"};font-size:11px;cursor:pointer">${m}</button>`;
  const row = (x, i) => `<div onclick="openPerson('${x.r.id}')" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px">
      <span class="mono" style="color:var(--muted);min-width:20px">${i + 1}.</span>
      <span style="flex:1">${escapeAttr(x.r.name || "")} ${x.r.role !== "Commander" && x.r.fourD ? `<span class="mono" style="color:var(--accent)">${configGet("companyPrefix")}${x.r.fourD}</span>` : ""}</span>
      <span style="background:#EF9F2722;color:#EF9F27;border:1px solid #EF9F2744;border-radius:4px;padding:1px 6px;font-size:10px">RSI ${x.rsi}</span>
      <span style="background:#378ADD22;color:#378ADD;border:1px solid #378ADD44;border-radius:4px;padding:1px 6px;font-size:10px">RSO ${x.rso}</span>
      <strong style="min-width:24px;text-align:right">${x.total}</strong>
    </div>`;
  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <h3 style="font-size:14px;font-weight:600;cursor:pointer" onclick="sbToggleCollapse()">${_sbCollapsed ? "▸" : "▾"} Report Sick Leaderboard <span style="font-weight:400;color:var(--muted);font-size:11px">(${rows.length} pax with RS)</span></h3>
      <div style="display:flex;gap:6px">${["Total", "4D", "RSI", "RSO"].map(tab).join("")}</div>
    </div>
    ${_sbCollapsed ? "" : `<div style="margin-top:8px">
      ${shown.length ? shown.map(row).join("") : `<div style="font-size:12px;color:var(--muted);padding:6px">No report-sick records in scope.</div>`}
      ${!_sbShowAll && rows.length > 3 ? `<button class="btn" style="margin-top:8px;font-size:11px" onclick="sbShowAllLeaderboard()">Show all ${rows.length} personnel</button>` : ""}
    </div>`}
  `;
}
function sbSetSort(m) { _sbSort = m; _sbShowAll = false; try { localStorage.setItem("braves-sb-sort", m); } catch {} renderSBLeaderboard(); }
function sbToggleCollapse() { _sbCollapsed = !_sbCollapsed; try { localStorage.setItem("braves-sb-collapsed", _sbCollapsed ? "1" : "0"); } catch {} renderSBLeaderboard(); }
function sbShowAllLeaderboard() { _sbShowAll = true; renderSBLeaderboard(); }

// ── A7. Roster Status List (live snapshot) ──────────────────────────────────
function renderSBRosterList() {
  const host = document.getElementById("sb-rosterlist");
  if (!host) return;
  const today = todayISO();
  let scoped = filteredRoster();
  const q = _sbSearch.trim().toLowerCase();
  if (q) scoped = scoped.filter(r => String(r.name || "").toLowerCase().includes(q) || String(r.id || "").toLowerCase().includes(q) || String(r.fourD || "").includes(q));
  const ordered = sbOrdered(scoped);
  // Index once; both bpPrimaryForDay and the per-row ghost-tag scan below would
  // otherwise re-scan STATE.medical/leave/appointments for every person.
  const idx = bpBuildIndex();

  // Warded lands in the "others" section (spec §8 keeps it out of ATT C) but is
  // still an away/not-in-camp case — colour it like MC/WD instead of the generic
  // grey OTHERS chip, which reads as an unremarkable in-camp leave entry.
  const catColor = primary => (primary?.type === "WD") ? SB_CELL.WD
    : ({ reportingSick: SB_CELL.RSI, attC: SB_CELL.MC, alOil: SB_CELL.LV, status: SB_CELL.LD, others: { bg: "#8B949E", fg: "#1c1c1c" } }[primary?.key] || { bg: "#8B949E", fg: "#1c1c1c" });
  let lastGroup = null, body = "";
  ordered.forEach(({ r, group }) => {
    if (group !== lastGroup) { body += `<tr><td colspan="4" style="background:var(--surface2);font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:4px 8px;font-weight:700">${escapeAttr(group)}</td></tr>`; lastGroup = group; }
    const p = bpPrimaryForDay(r, today, idx);
    const ghostInfo = (() => {
      // most-severe ghost tag among this person's medical rows today
      let best = null;
      (idx.medical[r.id] || []).forEach(m => {
        const t = medStatusTag(m, today);
        if (t && t.ghostDay > 0 && (!best || t.ghostDay < best.ghostDay)) best = t;
      });
      return best;
    })();
    const catBadge = p.primary
      ? `<span style="background:${catColor(p.primary).bg}33;color:${catColor(p.primary).bg};border:1px solid ${catColor(p.primary).bg}66;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600">${p.primary.type === "WD" ? "WARDED" : p.primary.label}</span>`
      : `<span style="color:var(--green);font-size:11px">Present</span>`;
    const mrBadge = p.mr ? ` <span style="background:#7F77DD33;color:#7F77DD;border:1px solid #7F77DD66;border-radius:4px;padding:2px 6px;font-size:9px">MR</span>` : "";
    const ghostBadge = ghostInfo ? ` <span title="recovering" style="color:var(--muted);font-size:9px;border:1px solid var(--border);border-radius:3px;padding:1px 4px">${ghostInfo.tag}</span>` : "";
    const reason = p.primary ? p.primary.reason : (p.mr || "");
    body += `<tr onclick="openSBCellDetail('${r.id}','${today}')" style="cursor:pointer">
      <td style="text-align:left">${escapeAttr(paradeRN(r.id))}</td>
      <td style="font-size:11px;color:var(--muted)">${personPlatoon(r) || "—"}${personSection(r) ? " · " + personSection(r) : ""}</td>
      <td>${catBadge}${mrBadge}${ghostBadge}</td>
      <td style="text-align:left;font-size:11px;color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAttr(reason)}">${escapeAttr(reason) || "—"}</td>
    </tr>`;
  });
  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <h3 style="font-size:14px;font-weight:600">Roster Status List <span style="font-weight:400;color:var(--muted);font-size:11px">(live — ${isoToDisplayDate(today)})</span></h3>
      <input id="sb-search" placeholder="Filter name / 4D…" value="${escapeAttr(_sbSearch)}" oninput="sbSearchInput(this.value)" style="padding:5px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px">
    </div>
    <div class="table-wrap" style="max-height:420px;overflow:auto"><table><thead><tr>
      <th style="text-align:left">R/N</th><th>Plt · Sect</th><th>Today</th><th style="text-align:left">Reason</th>
    </tr></thead><tbody>${body || `<tr><td colspan="4" style="color:var(--muted);padding:10px">No personnel in scope${q ? " match the filter" : ""}.</td></tr>`}</tbody></table></div>
  `;
  const inp = document.getElementById("sb-search");
  if (inp && q) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}
function sbSearchInput(v) { _sbSearch = v; renderSBRosterList(); }

// ── A4. Status Grid (calendar) ──────────────────────────────────────────────
function sbWeeks(offset) {
  const today = new Date(todayISO() + "T00:00:00");
  const dow = (today.getDay() + 6) % 7;            // 0 = Monday
  const monThis = new Date(today); monThis.setDate(today.getDate() - dow);
  const startMon = new Date(monThis); startMon.setDate(monThis.getDate() - 4 * 7 + offset * 5 * 7);
  const weeks = [];
  for (let w = 0; w < 5; w++) {
    const wkMon = new Date(startMon); wkMon.setDate(startMon.getDate() + w * 7);
    const days = [];
    for (let d = 0; d < 7; d++) { const dd = new Date(wkMon); dd.setDate(wkMon.getDate() + d); days.push(_sbKey(dd)); }
    weeks.push({ monIso: _sbKey(wkMon), days });
  }
  return weeks;
}
// Lazy-load: a wide grid is ~35 cells × N people of DOM — the same mobile jank
// the charts defer. Build it only when not deferred, the user has tapped "Load
// grid", or the scope is small enough to be cheap. Honours the shared chart pref
// (auto/defer/eager) so one toggle governs every heavy view.
const SB_GRID_DEFER_ROWS = 30;
function renderSBGrid() {
  const host = document.getElementById("sb-grid");
  if (!host) return;
  const scoped = filteredRoster();
  if (!_sbGridShown && shouldDeferCharts() && scoped.length > SB_GRID_DEFER_ROWS) {
    host.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="font-size:14px;font-weight:600">Status Grid <span style="font-weight:400;color:var(--muted);font-size:11px">(calendar — day = square, colour = status)</span></h3>
      </div>
      <div style="text-align:center;padding:18px">
        <button class="btn btn-primary" onclick="loadStatusGrid()">🗓️ Load status grid</button>
        <div style="font-size:11px;color:var(--muted);margin-top:8px">Deferred for a faster load on mobile (${scoped.length} rows). <a href="#" onclick="setChartPref('eager');return false" style="color:var(--accent)">Always load</a></div>
      </div>`;
    return;
  }
  const companyWide = !STATE.filterPlt;     // no platoon picked → whole company
  const weeks = sbWeeks(_sbWeekOffset);
  const todayKey = todayISO();
  const counts = sbRSCounts();
  const ordered = sbOrdered(scoped);
  // Index leave/medical/appointments by d4 once; the grid classifies every person
  // across ~35 day-cells and would otherwise re-scan all three STATE arrays per cell.
  const idx = bpBuildIndex();

  const legend = Object.entries({ RSI: "RSI", RSO: "RSO", MC: "MC/ATTC", WD: "Warded", MR: "MR", LD: "LD", EX: "Excuse", LV: "Leave" })
    .map(([k, lbl]) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:10px"><span style="width:11px;height:11px;border-radius:2px;background:${SB_CELL[k].bg};display:inline-block"></span>${lbl}</span>`).join("");

  const colspanAll = weeks.length * 7 + 3;   // 4D + Name + day cells + Total RS
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekHead = weeks.map(w => `<th colspan="7" style="border-left:2px solid var(--border);font-size:10px;color:var(--muted)">Wk of ${isoToDisplayDate(w.monIso).split(" ").slice(0, 2).join(" ")}</th>`).join("");
  const dowHead = weeks.map(() => dows.map((d, i) => `<th style="font-size:9px;${i === 0 ? "border-left:2px solid var(--border);" : ""}${i >= 5 ? "color:var(--dim);" : "color:var(--muted);"}min-width:26px">${d}</th>`).join("")).join("");

  let lastGroup = null, body = "";
  ordered.forEach(({ r, group }) => {
    if (group !== lastGroup) { body += `<tr><td colspan="${colspanAll}" class="sb-group">${escapeAttr(group)}</td></tr>`; lastGroup = group; }
    const c = counts[r.id] || { rsi: 0, rso: 0 };
    let cells = "";
    weeks.forEach(w => w.days.forEach((iso, i) => {
      const dayNum = +iso.slice(8, 10);                 // iso = YYYY-MM-DD
      const future = iso > todayKey;
      let inner;
      if (future) {
        inner = `<div class="sb-cell sb-future">${dayNum}</div>`;
      } else {
        const cell = bpGridCell(r, iso, idx);
        if (cell.any) {
          const pal = SB_CELL[cell.primary] || { bg: "#8B949E", fg: "#111" };
          // Secondary RSI/RSO not already shown as the primary colour → corner triangle.
          const sec = (cell.hasRSI && cell.primary !== "RSI") ? "#EF9F27" : (cell.hasRSO && cell.primary !== "RSO") ? "#378ADD" : "";
          inner = `<div class="sb-cell" data-d4="${r.id}" data-iso="${iso}" style="background:${pal.bg};color:${pal.fg}">${dayNum}${sec ? `<span class="sb-corner" style="border-top-color:${sec}"></span>` : ""}</div>`;
        } else {
          inner = `<div class="sb-cell sb-empty" data-d4="${r.id}" data-iso="${iso}">${dayNum}</div>`;
        }
      }
      cells += `<td class="sb-td${i === 0 ? " sb-wkstart" : ""}${i >= 5 ? " sb-weekend" : ""}">${inner}</td>`;
    }));
    body += `<tr>
      <td class="sb-id">${r.role !== "Commander" && r.fourD ? `${configGet("companyPrefix")}${r.fourD}` : escapeAttr(r.id)}</td>
      <td class="sb-name">${escapeAttr(r.name || "")}</td>
      ${cells}
      <td style="font-weight:700;text-align:center">${c.rsi + c.rso}</td>
    </tr>`;
  });

  host.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <h3 style="font-size:14px;font-weight:600">Status Grid <span style="font-weight:400;color:var(--muted);font-size:11px">(calendar — day = square, colour = status)</span></h3>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn" style="font-size:11px" onclick="sbGridNav(-1)">← earlier</button>
        <button class="btn" style="font-size:11px" onclick="sbGridNav(0)">current</button>
        <button class="btn" style="font-size:11px" onclick="sbGridNav(1)">later →</button>
      </div>
    </div>
    <div style="margin-bottom:8px">${legend}</div>
    ${companyWide ? `<div style="font-size:11px;color:var(--orange);background:#D2992211;border:1px solid #D2992244;border-radius:6px;padding:6px 10px;margin-bottom:8px">Company scope shows all ${scoped.length} rows — pick a platoon in the scope filter for a more readable grid.</div>` : ""}
    <div class="table-wrap" style="max-height:520px;overflow:auto"><table class="sb-table" style="border-collapse:collapse" onclick="sbGridClick(event)">
      <thead>
        <tr><th class="sb-id" style="text-align:left">4D</th><th class="sb-name" style="text-align:left">Name</th>${weekHead}<th rowspan="2" style="text-align:center">Total<br>RS</th></tr>
        <tr><th class="sb-id"></th><th class="sb-name"></th>${dowHead}</tr>
      </thead>
      <tbody>${body || `<tr><td style="color:var(--muted);padding:10px">No personnel in scope.</td></tr>`}</tbody>
    </table></div>
  `;
}
// Event delegation for grid cells (Misc/E3 perf): one listener on the table
// instead of an inline onclick per ~35×N cells — far less HTML + far fewer
// closures, which is what made iOS Chrome lag on the company-wide grid.
function sbGridClick(e) {
  const cell = e.target.closest("[data-iso]");
  if (cell && cell.dataset.d4) openSBCellDetail(cell.dataset.d4, cell.dataset.iso);
}
function loadStatusGrid() { _sbGridShown = true; renderSBGrid(); }
function sbGridNav(delta) { _sbGridShown = true; _sbWeekOffset = delta === 0 ? 0 : _sbWeekOffset + delta; renderSBGrid(); }

// ── A4.4 lightweight cell-detail popover (reused by A7 rows) ─────────────────
function openSBCellDetail(d4, iso) {
  const host = document.getElementById("sb-popover");
  if (!host) return;
  const r = STATE.roster.find(x => x.id === d4);
  if (!r) return;
  const c = bpClassifyPerson(r, iso);
  const order = [["reportingSick", "REPORTING SICK"], ["attC", "ATT C"], ["alOil", "AL/OIL"], ["status", "STATUS"], ["mr", "MR"], ["others", "OTHERS"]];
  const lines = [];
  order.forEach(([k, label]) => c.meta[k].forEach(x => lines.push(`<div style="padding:3px 0;border-bottom:1px solid var(--border)"><strong style="font-size:10px;color:var(--muted)">${label}</strong><br>${escapeAttr(x.reason)}</div>`)));
  host.innerHTML = `
    <div onclick="closeSBPopover()" style="position:fixed;inset:0;z-index:60"></div>
    <div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:61;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;min-width:260px;max-width:90vw;box-shadow:0 8px 28px rgba(0,0,0,.5)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:13px">${escapeAttr(paradeRN(d4))} — ${isoToDisplayDate(iso)}</strong>
        <button onclick="closeSBPopover()" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer">✕</button>
      </div>
      ${lines.length ? lines.join("") : `<div style="font-size:12px;color:var(--green)">Present / no status this day.</div>`}
    </div>`;
}
function closeSBPopover() { const h = document.getElementById("sb-popover"); if (h) h.innerHTML = ""; }
