// The Dashboard: strength bento, MSK analytics, status trend, dashboard parade, leave, appointments, profile cards.
//
// Split out of the original monolithic render.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

function sectionStrengthBreakdown(people, dateIso) {
  const byPlt = new Map();                       // code -> people[]
  people.forEach(r => {
    const code = personPlatoon(r) || "";
    if (!byPlt.has(code)) byPlt.set(code, []);
    byPlt.get(code).push(r);
  });

  // Ordered platoon codes: activePlatoons() first, then extras present in the
  // data, then the blank-platoon group ("") always last.
  const active = activePlatoons();
  const order = [];
  active.forEach(p => { if (byPlt.has(p.code)) order.push(p.code); });
  [...byPlt.keys()].forEach(code => { if (code !== "" && !order.includes(code)) order.push(code); });
  if (byPlt.has("")) order.push("");

  const isCommandGroup = code => code === "HQ" || code === "";
  const nameFor = code => {
    if (code === "") return "Command / Unassigned";
    const hit = active.find(p => p.code === code);
    return hit ? hit.displayName : code;
  };
  // numeric sections ascending, then non-numeric alpha, then blank "—" last.
  const sortLabels = labels => labels.sort((a, b) => {
    if (a === "—") return 1;
    if (b === "—") return -1;
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    const aNum = String(na) === a, bNum = String(nb) === b;
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // Rank-group boxes for the command element (fixed order, blanks dropped).
  const RANK_ORDER = ["Officer", "WOSPEC", "Enlistee"];
  const RANK_LABEL = { Officer: "OFFICER", WOSPEC: "WOSPEC", Enlistee: "ENLISTEE" };
  const commandBoxes = ppl => {
    const byRank = new Map();
    ppl.forEach(r => {
      const g = rankGroupOf(r);
      if (!byRank.has(g)) byRank.set(g, []);
      byRank.get(g).push(r);
    });
    return RANK_ORDER.filter(g => byRank.has(g)).map(g => {
      const s = bpStrength(byRank.get(g), dateIso);
      return { label: g, displayLabel: RANK_LABEL[g], cur: s.current, tot: s.total };
    });
  };
  // Section boxes for a normal platoon ("Command" first via sortLabels, blank "—").
  const sectionBoxes = ppl => {
    const bySect = new Map();
    ppl.forEach(r => {
      const sect = personSection(r) || "";
      const label = sect === "" ? "—" : String(sect);
      if (!bySect.has(label)) bySect.set(label, []);
      bySect.get(label).push(r);
    });
    return sortLabels([...bySect.keys()]).map(label => {
      const s = bpStrength(bySect.get(label), dateIso);
      const displayLabel = label === "—" ? "HQ" : (label === "Command" ? "Command" : "Sect " + label);
      return { label, displayLabel, cur: s.current, tot: s.total };
    });
  };

  return order.map(code => {
    const ppl = byPlt.get(code);
    const sections = isCommandGroup(code) ? commandBoxes(ppl) : sectionBoxes(ppl);
    return { code, displayName: nameFor(code), sections };
  });
}

function renderDashboard(el) {
  // Empty-state guard. The dashboard has nothing meaningful to show until
  // the roster loads, but the message depends on WHY it's empty: an
  // authenticated user is mid-pull (or the pull failed); an unauthenticated
  // visitor needs to log in. Either way, the user should never see a
  // "click Pull from Sheet" prompt — that's an auto-handled step now.
  if (!STATE.roster.length) {
    const body = STATE.authToken
      ? `<p style="margin-bottom:8px">Loading data from the sheet…</p>
         <p style="font-size:11px;color:var(--dim)">If this stays empty for more than a few seconds, the sync may have failed. <button class="btn" onclick="doPull()" style="margin-left:6px">Retry now</button></p>`
      : `<p style="margin-bottom:8px">Not signed in on this device yet.</p>
         <p>Log in with your account to sync — the app will load automatically once you're signed in.</p>`;
    el.innerHTML = `
      <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Company Strength Board</h2>
      <div class="card empty-state">${body}</div>`;
    return;
  }

  // Strength scope, not raw roster scope: strengthRoster() drops genuine
  // departures (ORD / Posted Out / Discharged / …) exactly as bpStrength does, so
  // every tile, table and card below is counted over the same population the
  // parade state reports. Using filteredRoster() here made "Total Str" (and the
  // Non-Active table) include people who have left the company, so the Dashboard
  // read a couple of PAX above the parade state's TOTAL STRENGTH. Departures are
  // still listed and badged on the Roster tab — they just aren't strength.
  const scoped = strengthRoster();
  const scopedIds = new Set(scoped.map(r => r.id));
  const visible = visibleD4Set();
  const today = todayISO();
  // Derive non-active personnel from today's effective medical layer. A
  // recruit can have multiple simultaneous statuses (e.g. MC + Excuse Heavy
  // Load), all of which we want to surface on the dashboard. The "all"
  // variant returns every active status; we partition into live vs recovering
  // based on the recruit's *most-severe* tag (statuses[0]) so a recruit with
  // an active MC plus a ghost-tagged LD still sits in the live (red) table.
  // Filtered against `scopedIds` rather than passesFilter(): that set already IS
  // the scoped roster, and keying off it also drops medical rows belonging to a
  // departed (or unknown) 4D, which must not show up in the tables or the chart.
  const effectiveAll = currentMedicalEffectiveAll(today).filter(e => scopedIds.has(e.d4));
  const allByD4 = Object.fromEntries(effectiveAll.map(e => [e.d4, e]));
  const topTag = r => allByD4[r.id]?.statuses[0];
  const liveRows = scoped.filter(r => topTag(r) && topTag(r).ghostDay === 0)
    .sort((a, b) => medSeverityRank(topTag(b).tag) - medSeverityRank(topTag(a).tag));
  const recoveringRows = scoped.filter(r => topTag(r) && topTag(r).ghostDay > 0)
    .sort((a, b) => topTag(a).ghostDay - topTag(b).ghostDay);
  // "Active today" is deliberately the MEDICAL-layer complement of the Non-Active
  // table below (everyone without a live MC/LD/excuse/… today) — it is NOT the
  // parade state's CURRENT STRENGTH, which is the In Camp tile: an in-camp RSI
  // counts as non-active here but still in camp there, and a person on AL is in
  // camp for neither. Now that `scoped` is departure-free the pair adds up:
  // Active today + Non-Active === Total Str.
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
  // Total Str / In Camp = the §8 classifier's TOTAL / CURRENT STRENGTH for this
  // scope (same math the parade-state message uses) — NOT a raw row count, and
  // NOT a simplified MC/Warded-only guess. `scoped` is already departure-free, so
  // totalStr === scoped.length; reading it off the same object the In Camp tile
  // uses keeps the pair provably consistent with the message.
  const grpStrength = bpStrength(scoped, today);
  const totalStr = grpStrength.total;
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
      <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
      <!-- Feature 22: the Dashboard has no row context, so it gets one button
           in the header rather than a per-row trigger, and both forms open
           blank — each already carries a person search box, so no separate
           person-picker step is needed. Hidden from viewers, not disabled. -->
      ${canWrite() ? `<button class="btn" onclick="openQuickLogMenu('')" title="Log a medical or leave record">＋ Log</button>` : ""}
      <div class="dropdown-wrapper">
        <button class="btn btn-primary" onclick="toggleReportMenu(event)">📋 Generate Report ▾</button>
        <div id="report-menu" class="dropdown-menu hidden">
          <button type="button" onclick="openReportModal('RS'); closeReportMenu()">🤒 RS Format (Sick Report)</button>
          <button type="button" onclick="openReportModal('RSIP'); closeReportMenu()">🤒 RSI Personnel (by Platoon)</button>
          <button type="button" onclick="openReportModal('MED'); closeReportMenu()">🏥 Medical Status List</button>
          <button type="button" onclick="openReportModal('MSK'); closeReportMenu()">🦵 MSK Report</button>
          <button type="button" onclick="openReportModal('CONDUCT'); closeReportMenu()">📊 Per-Conduct Chat Format</button>
          <button type="button" onclick="openReportModal('MR'); closeReportMenu()">🩺 MR (Medical Review)</button>
          <button type="button" onclick="openReportModal('DUTYBOARD'); closeReportMenu()">🛡️ Duty Board (one day)</button>
          ${canPlanDuty() ? `<button type="button" onclick="openReportModal('DUTYREMIND'); closeReportMenu()">🛡️ Duty Planning Reminder</button>` : ""}
        </div>
      </div>
      </div>
    </div>
    ${scopeBanner}
    <div class="stats-row" style="margin-top:12px">
      <div class="stat"><label>Total Str</label><div class="val">${totalStr}${inlineBreakdown(recRows.length, cmdRows.length)}</div></div>
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
    ${(() => {
      const breakdown = sectionStrengthBreakdown(scoped, today);
      if (!breakdown.length) return "";
      return `<div class="card" style="padding:10px 16px;margin-top:10px">
        <h3 style="font-size:13px;color:var(--muted);margin-bottom:8px">Strength by Section <span style="font-weight:400;color:var(--dim)">(current/total in scope — §16)</span></h3>
        <div class="sect-strength">
          ${breakdown.map(g => `
            <div class="sect-strength__grp">
              <div class="sect-strength__grp-label">${escapeHTML(g.displayName)}</div>
              <div class="sect-strength__boxes">
                ${g.sections.map(s => `
                  <div class="sect-strength__box">
                    <div class="sect-strength__box-label">${escapeHTML(s.displayLabel || s.label)}</div>
                    <div class="sect-strength__box-val">${s.cur}/${s.tot}</div>
                  </div>`).join("")}
              </div>
            </div>`).join("")}
        </div>
      </div>`;
    })()}
    ${renderDashAppointments(visible, today)}
    ${renderDashDuty(today)}
    <!-- Feature 25: the people who are OUT come before the analytics. A duty
         commander opens this page to find out who is missing, not to read a
         chart — so Non-Active, Recovering and Out-today sit directly under
         Appointments, and the charts and reference cards move below them.
         This is a pure re-order: no card's contents changed. -->
    <h3 style="font-size:13px;color:var(--muted);margin-bottom:8px">Non-Active Personnel <span style="color:var(--dim);font-weight:400">(live medical status on ${today})</span></h3>
    ${liveRows.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th style="text-align:left">Name</th><th style="text-align:left">Status today</th><th style="text-align:left">Reason</th><th style="text-align:left">Duration</th></tr></thead><tbody>
    ${liveRows.map(r => {
      const entry = allByD4[r.id];
      const multi = entry.statuses.length > 1;
      // Stack badges, reasons, and durations vertically so each cell aligns
      // row-by-row across the three columns when a recruit has 2+ statuses.
      // Feature 30.1: one visit can yield several statuses (LD + Excuse RMJ).
      // The suffix belongs to the VISIT, not to each status, so it is shown once
      // — on the first badge. Same-day only: yesterday's RSI time against
      // today's badge would be a lie.
      const visit = visitForDay(r.id, today);
      const visitSuf = visit ? visitSuffix(visit) : "";
      const tagsCell = entry.statuses.map((s, i) =>
        `<div style="padding:2px 0">${medTagBadge(s.tag)}${(i === 0 && visitSuf)
          ? ` <span style="font-size:10px;color:var(--muted)">+ ${escapeHTML(visitSuf)}</span>` : ""}</div>`).join("");
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
    ${renderDashLeaveOut(visible, today)}
    ${renderDashParade()}
    <div class="grid-2" id="dash-charts"${deferActive ? ' style="display:none"' : ''}>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <h3 id="status-trend-title" style="margin:0">Status Trend (${statusTrendRangeLabel()})</h3>
          <div class="filter-role-group" id="status-trend-range">${statusTrendRangePillsHtml()}</div>
        </div>
        <div class="chart-box trend"><canvas id="chart-status"></canvas></div>
      </div>
      <div class="card"><h3>Participation Trend</h3><canvas id="chart-participation" height="200"></canvas></div>
    </div>
    ${deferActive ? chartGateMarkup("loadDashboardCharts()", "dash-chart-gate") : ""}
    ${renderDashProfileCards(scoped)}
    ${renderDashMSKCases(visible)}`;

  const buildDashboardCharts = () => {
  buildStatusTrendChart(scopedIds);

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
// Tracks which nav tab the last render() painted, so we only scroll-to-top on an
// actual tab switch — same-tab re-renders (in-place edits, filter/scope changes)
// must keep the user's scroll position (previously every render() jumped to top,
// bouncing the view whenever e.g. a conduct was assigned a class).
let _lastRenderedNav = null;
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
  // Report-sick scope (§1.7): per-person MSK cards name the person and their
  // injury, so out-of-scope people are withheld and stated as a count instead.
  const scoped = STATE.msk.filter(m => passesFilter(m.d4, visible) && inRSScope(m.d4));
  const scopeNote = rsScope().company ? "" : rsOutOfScopeCounts()
    .map(x => `<div style="font-size:11px;color:var(--muted);padding:4px 0">${escapeHTML(x.platoon)} — ${x.count} pax · MSK cases outside your scope</div>`)
    .join("");
  if (!scoped.length) return scopeNote;

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
      ${regions.map(reg => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}22;color:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}">${escapeHTML(reg)}</span>`).join("")}
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
          <button class="btn" style="font-size:10px;padding:3px 8px" onclick="openMedicalForm(null, {type:'MA', d4:'${c.d4}', reason:'Physio review', location:'Physio Centre'})" title="Book a physio appointment for this recruit">📅 Book</button>
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
    ${clearedSection}
    ${scopeNote}`;
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

  // This view renders one NAMED card per affected person with their injury
  // text, so both source layers carry the report-sick scope.
  const inWindowReport = m => {
    if ((m.type || "").toLowerCase().indexOf("report") < 0) return false;
    if (!passesFilter(m.d4, visible) || !inRSScope(m.d4)) return false;
    const iso = displayDateToISO(m.timestamp) || String(m.timestamp || "").slice(0, 10);
    return iso && iso >= startIso && iso <= endIso;
  };
  const inWindowCD = c => {
    if (!passesFilter(c.d4, visible) || !inRSScope(c.d4)) return false;
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

  const regionChipsHtml = regs => regs.map(reg => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}22;color:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}">${escapeHTML(reg)}</span>`).join(" ");

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
    // Report-sick scope: this feeds the most-affected-personnel breakdown,
    // which names people.
    if (!inRSScope(m.d4)) return false;
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

  const regionChip = reg => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other}22;color:${MSK_REGION_COLORS[reg] || MSK_REGION_COLORS.Other};margin-right:3px">${escapeHTML(reg)}</span>`;

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

// ── Feature 26: status trend, replacing the single-day status doughnut ───────
// The doughnut answered "what does today look like?", which the Non-Active table
// directly above already answers better and by name. A trend answers the thing a
// table cannot: is this getting worse?
//
// Registered on STATE.charts.status — the SAME key the doughnut used, so
// render()'s destroy-before-dispatch sweep keeps working unchanged and the
// instance can never leak across renders.
//
// See statusTrendSeries (helpers.js) for the exclusion rules; they are decisions,
// not omissions.
// Window for the trend, in days. Session-scoped module state (not persisted and
// not on STATE) — the same treatment the Parade card's Lookahead pills get, and
// for the same reason: it is a way of LOOKING at the dashboard, not data.
// Infinity means "All" and is resolved to a concrete count by
// statusTrendWindowDays() at build time.
let _statusTrendDays = 14;
const STATUS_TREND_RANGES = [["7", "7d"], ["14", "14d"], ["30", "30d"], ["all", "All"]];
// Hard ceiling on the "All" window. buildStatusTrendChart recomputes the WHOLE
// effective medical layer once per day in the window (currentMedicalEffectiveAll
// walks every medical record, each through a Date-allocating displayDateToISO),
// so the work is days × records — and it runs synchronously on the main thread
// straight out of the pill's onclick, with no spinner and nothing to cancel. An
// uncapped span over a sheet that has been running for a couple of years is
// millions of Date allocations and a visibly frozen tab. 400 days keeps the
// worst case around a year of history while staying an order of magnitude below
// that. The label reports the real number, and says so when the cap bit, so a
// capped chart never silently claims to be showing everything.
const STATUS_TREND_MAX_DAYS = 400;

// Resolve "All" to a real day count: today back to the earliest medical record,
// clamped to STATUS_TREND_MAX_DAYS. Medical is the only layer this chart reads,
// so a window wider than the oldest record can only prepend zero-columns.
// Floored at 14 so an empty/one-day sheet still draws a line rather than a
// single point, and guarded against a record dated in the future (a pre-booked
// MC) producing a negative span.
function statusTrendWindowDays() {
  if (_statusTrendDays !== Infinity) return _statusTrendDays;
  return Math.min(STATUS_TREND_MAX_DAYS, statusTrendFullSpanDays());
}
// The UNCAPPED span, so the label can tell whether the cap actually bit.
function statusTrendFullSpanDays() {
  const end = todayISO();
  let earliest = "";
  (STATE.medical || []).forEach(m => {
    const s = displayDateToISO(m.startDate || m.date || "");
    if (s && (!earliest || s < earliest)) earliest = s;
  });
  if (!earliest || earliest >= end) return 14;
  return Math.max(14, daysBetween(earliest, end) + 1);
}
function statusTrendRangeLabel() {
  if (_statusTrendDays !== Infinity) return `${_statusTrendDays} days`;
  const days = statusTrendWindowDays();
  return statusTrendFullSpanDays() > days
    ? `latest ${days} days of ${statusTrendFullSpanDays()}`
    : `all time · ${days} days`;
}
function statusTrendRangePillsHtml() {
  return STATUS_TREND_RANGES.map(([v, l]) => {
    const on = (v === "all") ? _statusTrendDays === Infinity : Number(v) === _statusTrendDays;
    return `<button type="button" class="role-btn${on ? " active" : ""}" onclick="setStatusTrendDays('${v}')">${l}</button>`;
  }).join("");
}
// Deliberately NOT a render() — this card can sit behind the mobile defer gate,
// and a full re-render would re-arm that gate and hide the chart the user just
// asked to re-scale. So we rebuild only this chart and repaint its own header.
// scopedIds is recomputed rather than stashed: strengthRoster() is the same
// derivation renderDashboard uses, so the rebuilt chart cannot drift out of
// sync with the topbar scope.
function setStatusTrendDays(v) {
  _statusTrendDays = (v === "all") ? Infinity : (Number(v) || 14);
  if (STATE.charts.status) { STATE.charts.status.destroy(); STATE.charts.status = null; }
  buildStatusTrendChart(new Set(strengthRoster().map(r => r.id)));
  const title = document.getElementById("status-trend-title");
  if (title) title.textContent = `Status Trend (${statusTrendRangeLabel()})`;
  const pills = document.getElementById("status-trend-range");
  if (pills) pills.innerHTML = statusTrendRangePillsHtml();
}

function buildStatusTrendChart(scopedIds) {
  const canvas = document.getElementById("chart-status");
  if (!canvas) return;
  // The window ends today and runs back _statusTrendDays (see above). This
  // recomputes the effective medical layer once PER DAY, so the cost scales
  // linearly with the selected range — which is exactly why this chart lives
  // inside #dash-charts and inherits the defer gate, and why "All" is opt-in
  // rather than the default.
  const DAYS = statusTrendWindowDays();
  const end = todayISO();
  const byDay = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const iso = addDaysISO(end, -i);
    byDay.push({ iso, entries: currentMedicalEffectiveAll(iso).filter(e => scopedIds.has(e.d4)) });
  }
  const { labels, series } = statusTrendSeries(byDay, DAYS, 8);
  const palette = ["#F85149", "#D29922", "#58A6FF", "#3FB950", "#BC8CFF", "#E3B341", "#43C59E", "#8B949E", "#484F58"];
  // Past ~6 weeks the per-day dots stop being readable and turn the line into a
  // dotted band, so they are dropped — hover still works (interaction.mode is
  // "index", which doesn't need a visible point to hit). Beyond a year MM/DD
  // wraps around, so the label carries the year.
  const dense = DAYS > 45;
  const spansYears = DAYS > 365;
  STATE.charts.status = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels.map(iso => spansYears
        ? `${iso.slice(5).replace("-", "/")}/${iso.slice(2, 4)}`   // MM/DD/YY
        : iso.slice(5).replace("-", "/")),                          // MM/DD
      datasets: series.map((s, i) => ({
        label: s.label, data: s.data,
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length] + "22",
        tension: 0.3, pointRadius: dense ? 0 : 2, pointHoverRadius: 5, fill: false
      }))
    },
    options: {
      // maintainAspectRatio:false is only safe because the canvas sits in a
      // .chart-box wrapper with an explicit CSS height (see the markup above and
      // the comment on .chart-box in styles.css). Without that wrapper Chart.js
      // derives its height from an auto-height parent, the parent then grows to
      // fit the taller canvas, the resize observer fires, and the chart ratchets
      // taller on every pass — which is exactly what this chart did when it
      // shipped as a bare <canvas> inside the .card.
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "right", labels: { color: "#8B949E", font: { size: 11 } } },
        // Counts on hover — the doughnut showed them by slice, so the replacement
        // must not lose them.
        tooltip: { backgroundColor: "#161B22", borderColor: "#30363D", borderWidth: 1, padding: 10 }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: "#30363D" }, ticks: { color: "#8B949E", precision: 0 } },
        x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 10 }, autoSkip: true, maxTicksLimit: dense ? 10 : 14, maxRotation: 0 } }
      }
    }
  });
}

// ── Feature 28: parade state on the Dashboard ────────────────────────────────
// A second VIEW onto the Parade tab's machinery, not a second implementation —
// same generator, same copy helper, same archive path (including its
// double-archive guard). The point is that a duty commander gets the message
// without leaving the board they already have open.
//
// Scope deliberately has NO dropdown here: it follows the topbar platoon filter,
// so the card always shows the block matching whatever the app is already scoped
// to. Its own controls are Date, FP/LP, Time and Lookahead only.
//
// Not role-gated. A viewer can read and copy; only the archive side effect is
// commander+admin, and archiveParadeSnapshot enforces that itself.
let _dashParadeDate = "", _dashParadeType = "", _dashParadeTime = "";
let _dashParadeLookahead = 0;      // days; 0 = off (today only), Infinity = "All". Session-scoped, like the tab's.
function setDashParadeDate(v) { _dashParadeDate = v; render(); }
function setDashParadeType(v) { _dashParadeType = v; render(); }
// Time is the one control bound to `oninput` — a full render() rebuilds
// #content and REPLACES the very input being typed into, so focus is lost after
// every keystroke and "0730" ends up as "0". Refresh only the generated block,
// exactly as the Parade tab's toolbar/refreshParade split does. The other three
// setters fire on commit (change/click) and re-render their own control state
// (the Lookahead pill highlight), so they still go through render().
function setDashParadeTime(v) { _dashParadeTime = v; refreshDashParade(); }
function refreshDashParade() {
  const host = document.getElementById("dash-parade-body");
  if (host) host.innerHTML = dashParadeBodyHtml();
}
function setDashParadeLookahead(v) { _dashParadeLookahead = (v === "all") ? Infinity : Number(v) || 0; render(); }

// The topbar filter drives scope. STATE.filterPlt is the platoon filter (there is
// no currentFilterPlatoon accessor); a section or role filter alone still means
// the company block, because the §8 message has no narrower unit than a platoon.
function dashParadeScope() {
  const plt = String(STATE.filterPlt || "");
  return plt ? { level: "platoon", platoon: plt } : { level: "company" };
}
function dashParadeMeta() {
  const s = dashParadeScope();
  return {
    date: _dashParadeDate || todayISO(),
    slot: _dashParadeTime,
    type: _dashParadeType || (paradeShouldBeLP() ? "LP" : "FP"),
    scope: s.level === "platoon" ? `platoon:${s.platoon}` : "company"
  };
}

// The generated half of the card, split out so refreshDashParade can replace it
// without touching the controls above it.
function dashParadeBodyHtml() {
  const dateIso = _dashParadeDate || todayISO();
  const type = _dashParadeType || (paradeShouldBeLP() ? "LP" : "FP");
  const text = generateBravesParadeState(dashParadeScope(), type, dateIso, _dashParadeTime,
    { lookaheadDays: _dashParadeLookahead });
  return paradeUpcomingBanner(text) + `
    <textarea id="dash-parade-text" rows="18" spellcheck="false"
      style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.45;resize:vertical;white-space:pre">${escapeHTML(text)}</textarea>
    <button type="button" id="dash-parade-copy" class="btn btn-success" style="margin-top:10px"
      onclick="copyDashParadeText()">📋 Copy to Clipboard</button>`;
}

function renderDashParade() {
  const dateIso = _dashParadeDate || todayISO();
  const type = _dashParadeType || (paradeShouldBeLP() ? "LP" : "FP");
  const scope = dashParadeScope();
  const scopeNote = scope.level === "platoon"
    ? `Scoped to <strong>${escapeHTML(filterLabel())}</strong> by the topbar filter.`
    : `Whole company. Use the topbar filter to scope to a platoon.`;
  const ctl = "padding:6px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px";
  return `<div class="card" style="padding:14px;margin-bottom:14px">
    <h3 style="font-size:13px;color:var(--muted);margin-bottom:4px">🎖️ Parade State</h3>
    <div style="font-size:11px;color:var(--dim);margin-bottom:10px">${scopeNote}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="form-group" style="margin:0"><label style="font-size:11px;color:var(--muted)">Date</label><br>
        <input type="date" value="${escapeAttr(dateIso)}" onchange="setDashParadeDate(this.value)" style="${ctl}"></div>
      <div class="form-group" style="margin:0"><label style="font-size:11px;color:var(--muted)">Parade</label><br>
        <select onchange="setDashParadeType(this.value)" style="${ctl};padding:7px 10px">
          <option value="FP"${type === "FP" ? " selected" : ""}>First Parade</option>
          <option value="LP"${type === "LP" ? " selected" : ""}>Last Parade</option></select></div>
      <div class="form-group" style="margin:0"><label style="font-size:11px;color:var(--muted)">Time</label><br>
        <input type="text" value="${escapeAttr(_dashParadeTime)}" placeholder="e.g. 0730" maxlength="9"
          oninput="setDashParadeTime(this.value)" style="${ctl};width:110px"></div>
      <div class="form-group" style="margin:0">
        <label style="font-size:11px;color:var(--muted)" title="How far ahead to list absences that have not started yet">Lookahead</label><br>
        <div class="filter-role-group">
          ${[["0", "Off"], ["7", "7d"], ["14", "14d"], ["30", "30d"], ["all", "All"]].map(([v, l]) => {
            const on = (v === "all") ? _dashParadeLookahead === Infinity : Number(v) === _dashParadeLookahead;
            return `<button type="button" class="role-btn${on ? " active" : ""}" onclick="setDashParadeLookahead('${v}')">${l}</button>`;
          }).join("")}
        </div>
      </div>
    </div>
    <div id="dash-parade-body">${dashParadeBodyHtml()}</div>
  </div>`;
}

// Mirrors copyParadeText: copy the on-screen text INCLUDING hand edits, then
// archive that exact string. Archiving is fire-and-forget — a viewer whose
// archive write is refused still gets their clipboard. The meta goes with it
// because archiveParadeSnapshot would otherwise stamp the Parade TAB's state.
async function copyDashParadeText() {
  const ta = document.getElementById("dash-parade-text");
  if (!ta) return;
  await paradeCopyString(ta.value, "dash-parade-copy", "dash-parade-text");
  archiveParadeSnapshot(ta.value, dashParadeMeta());
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
        <button class="btn" onclick="exportLeaveList()" title="Export the leave records in the current scope to CSV. The scope is in the filename.">⭳ CSV</button>
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
// The timeline always re-renders collapsed. Expansion is deliberately local to
// this card so a scope change or refresh cannot retain stale row visibility.
function toggleLeaveTimeline(button) {
  const timeline = button.closest("[data-leave-timeline]");
  const overflowRows = timeline.querySelectorAll("[data-leave-overflow]");
  const expanded = button.getAttribute("aria-expanded") === "true";

  overflowRows.forEach(row => { row.hidden = expanded; });
  button.setAttribute("aria-expanded", String(!expanded));
  button.textContent = expanded ? `Show all (${overflowRows.length} more)` : "Show less";
}

function renderLeaveTimeline(scoped, todayIso) {
  const TIMELINE_DAYS = 21;
  const COLLAPSED_PEOPLE = 5;
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

  // Group by person; sort by earliest upcoming entry, then canonical 4D so
  // collapsed tied rows do not depend on source/object-key insertion order.
  const byPerson = {};
  overlapping.forEach(l => { (byPerson[l.d4] = byPerson[l.d4] || []).push(l); });
  const people = Object.keys(byPerson).sort((a, b) => {
    const aEarliest = byPerson[a].reduce((m, l) => l.startIso < m ? l.startIso : m, "9999");
    const bEarliest = byPerson[b].reduce((m, l) => l.startIso < m ? l.startIso : m, "9999");
    if (aEarliest !== bEarliest) return aEarliest < bEarliest ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
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

  const personRows = people.map((d4, personIndex) => {
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
    const overflowAttrs = personIndex >= COLLAPSED_PEOPLE ? " data-leave-overflow hidden" : "";
    return `<tr${overflowAttrs} onclick="openPerson('${d4}')" style="cursor:pointer"><td style="padding:3px 8px;white-space:nowrap;font-size:11px;font-weight:600;background:var(--surface);border-right:2px solid var(--border);position:sticky;left:0;z-index:1">${escapeHTML(displayPersonLabel(d4))}</td>${cells}</tr>`;
  }).join("");

  const hiddenCount = Math.max(people.length - COLLAPSED_PEOPLE, 0);
  const expansionControl = hiddenCount ? `
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button type="button" class="btn" aria-expanded="false" onclick="toggleLeaveTimeline(this)">Show all (${hiddenCount} more)</button>
    </div>` : "";

  // Legend mirrors the type-color palette so users can decode the bars.
  const legend = ["Off-in-Lieu", "Leave", "Compassionate", "Weekend", "Night's Out", "Course", "Guard Duty", "NDP", "Other"]
    .map(t => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--muted)"><span style="width:10px;height:10px;background:${typeBg(t)};border-radius:2px;opacity:.85"></span>${t}</span>`)
    .join(" ");

  return `<div class="card" data-leave-timeline style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Leave Timeline <span style="color:var(--dim);font-weight:400;font-size:11px">(next ${TIMELINE_DAYS} days · ${people.length} ${people.length === 1 ? 'person' : 'people'})</span></h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${legend}</div>
    </div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse"><thead><tr><th style="background:var(--surface);position:sticky;left:0;z-index:2"></th>${headerCells}</tr></thead><tbody>${personRows}</tbody></table></div>
    ${expansionControl}
  </div>`;
}

// ── Today's and tomorrow's duty (spec §2) ───────────────────────────────────
//
// Tomorrow is the reason this card exists. Today's duty is already known to
// everyone who turned up; an unfilled slot TOMORROW is the thing worth finding
// now rather than at 0730. So unfilled slots render an explicit "— unassigned —"
// instead of a blank: a blank cell reads as "nothing here", which is exactly the
// wrong reading.
//
// Read-only, and a pure read of STATE.duty — assignment stays on the Duty tab,
// where the conflict preview and the points arithmetic live. Gated on canWrite()
// (the same gate the Archive nav and this page's "+ Log" button use): a viewer
// has no use for a planning aid. That gate is cosmetic, as everywhere else on
// the client — STATE.duty is present either way and the server's tab gate is
// what enforces.
function renderDashDuty(todayIso) {
  if (!canWrite()) return "";
  const cfg = dutyConfig();
  // No duty types configured means the company does not use this feature yet.
  // An empty card would read as "no duties tomorrow" — a false statement rather
  // than an absent one.
  if (!(cfg.dutyTypes || []).length) return "";

  // Soft unavailability flags (design §4.3). Indexed once for both columns.
  const unavail = duIndexByPerson(STATE.dutyUnavailable);

  const days = [["Today", todayIso], ["Tomorrow", addDaysISO(todayIso, 1)]];
  const cols = days.map(([label, iso]) => {
    const slots = dutyDaySlots(cfg, STATE.duty, iso);
    const rows = slots.map(s => {
      const mark = dutyUnavailMark(unavail, s.d4, iso);
      return `
      <div class="dash-duty__slot${mark ? " duty-unavail" : ""}">
        <span class="dash-duty__label">${escapeHTML(s.label)}</span>
        <span class="dash-duty__who">${s.d4
          ? dutyNameChip(s.d4, cfg) + mark
          : '<span class="dash-duty__gap">— unassigned —</span>'}</span>
      </div>`;
    }).join("");
    const gaps = slots.filter(s => !s.d4).length;
    const gapBadge = gaps
      ? ` <span class="badge badge-orange" style="font-size:9px">${gaps} open</span>`
      : "";
    return `<div class="dash-duty__day">
      <div class="dash-duty__head">${label} <span style="color:var(--dim);font-weight:400">${escapeHTML(iso)}</span>${gapBadge}</div>
      ${rows}
    </div>`;
  }).join("");

  return `<div class="card" style="padding:10px 16px;margin-top:10px">
    <h3 style="font-size:13px;color:var(--muted);margin-bottom:8px">🛡️ Duty <span style="font-weight:400;color:var(--dim)">(today and tomorrow)</span></h3>
    <div class="dash-duty">${cols}</div>
  </div>`;
}

function renderDashAppointments(visible, todayIso) {
  // Item 17 consolidation: bookings now route through the Medical form (type MA),
  // but legacy standalone Appointments records still exist. Merge BOTH sources so
  // nothing disappears — tag each row's origin so edit/actions dispatch correctly.
  const dateOk = d => { const iso = displayDateToISO(d); return iso && iso >= todayIso; };
  const legacy = (STATE.appointments || [])
    .filter(a => !a.resolved && passesFilter(a.d4, visible) && dateOk(a.date))
    .map(a => ({ src: "appt", id: a.id, d4: a.d4, reason: a.reason, date: a.date, time: a.time, location: a.location, outOfCamp: a.outOfCamp }));
  // Feature 30.1: ONE visit can produce several Medical rows (LD + Excuse RMJ),
  // and submitMedical stamps type="MA" on every sibling — so a plain filter lists
  // the same appointment once per status. groupByVisit collapses them the way the
  // Medical list and the person card already do; `first` is the row the ✎ edits,
  // which re-opens the whole visit anyway.
  //
  // bookInDate is the medical-side equivalent of the legacy rows' `resolved`:
  // once the commander has marked the person Present on the parade grid the
  // appointment is done with, and this path (which offers only Edit) would
  // otherwise keep showing it as upcoming with no way to clear it.
  const maRows = groupByVisit((STATE.medical || [])
      .filter(m => m.type === "MA" && !m.bookInDate && passesFilter(m.d4, visible) && dateOk(m.date)))
    .map(g => g.first)
    .map(m => ({ src: "med", id: m.id, d4: m.d4, reason: m.reason, date: m.date, time: m.time, location: m.location, outOfCamp: m.outOfCamp }));
  const upcoming = [...legacy, ...maRows].sort((a, b) => {
    const ai = displayDateToISO(a.date) || "";
    const bi = displayDateToISO(b.date) || "";
    if (ai !== bi) return ai < bi ? -1 : 1;
    return (a.time || "") < (b.time || "") ? -1 : 1;
  });

  const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px">
    <h3 style="font-size:13px;color:var(--muted);margin:0">📅 Upcoming Appointments <span style="color:var(--dim);font-weight:400">(${upcoming.length})</span></h3>
    <button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="openMedicalForm(null, {type:'MA'})">+ Book</button>
  </div>`;

  if (!upcoming.length) {
    return header + `<div class="empty-state" style="padding:12px;font-size:11px;margin-bottom:12px">No upcoming appointments.</div>`;
  }

  // Highlight today's appointments so they don't get lost in a long list.
  const rows = upcoming.map(a => {
    const iso = displayDateToISO(a.date);
    const isToday = iso === todayIso;
    const dayLabel = isToday ? `<span class="badge badge-red" style="font-size:9px">TODAY</span>` : "";
    // Medical-form MA rows edit via the Medical form (they carry a status/range);
    // the resolve/delete-appointment actions apply only to legacy Appointments rows.
    const actions = a.src === "med"
      ? `<button class="btn btn-icon" onclick="event.stopPropagation(); openMedicalForm(${a.id})" title="Edit (Medical Appointment)">✎</button>`
      : `<button class="btn btn-icon" style="color:var(--green)" onclick="event.stopPropagation(); toggleAppointmentResolved(${a.id})" title="Mark as resolved (hides from dashboard + parade state)">✓</button> <button class="btn btn-icon" onclick="event.stopPropagation(); openAppointmentForm(${a.id})" title="Edit">✎</button> <button class="btn btn-icon btn-danger" onclick="event.stopPropagation(); deleteEntry('appointments', ${a.id}, 'appointment')" title="Delete">✕</button>`;
    return `<tr onclick="openPerson('${a.d4}')" style="cursor:pointer${isToday ? ';background:#F8514911' : ''}">
      <td class="mono" style="font-weight:700;color:var(--accent)">${displayId(a.d4)}</td>
      <td style="text-align:left">${escapeHTML(displayPersonLabel(a.d4))}</td>
      <td style="text-align:left">${escapeHTML(a.reason || "")}${a.src === "med" ? ` <span class="badge" style="font-size:9px" title="Logged via the Medical form">MA</span>` : ""}</td>
      <td style="white-space:nowrap">${a.date || ""} ${dayLabel}</td>
      <td class="mono" style="white-space:nowrap">${fmtHrs(a.time)}</td>
      <td style="text-align:left;font-size:11px;color:var(--muted)">${escapeHTML(a.location || "")}${a.outOfCamp ? ` <span class="badge badge-pink" style="font-size:9px">OUTSIDE</span>` : ""}</td>
      <td style="white-space:nowrap">${actions}</td>
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
