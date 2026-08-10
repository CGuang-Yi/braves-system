// Modal infrastructure, the person card, and the core record forms (medical, attendance, IPPT, SOC).
//
// Split out of the original monolithic forms.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// Modal infrastructure, person-detail view, form openers/submitters, and CSV importers.

// There is exactly ONE overlay (index.html), so a modal opened from inside
// another modal REPLACES its caller rather than stacking on it. `onClose` is the
// escape hatch for that case: closeModal runs it instead of leaving the user on
// a blank screen, so the ✕, the backdrop and any Cancel button all restore the
// caller. Cleared on every open, so an ordinary modal never inherits the hook.
let _modalOnClose = null;
function openModal(title, html, onClose) {
  _modalOnClose = onClose || null;
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  // Read and clear BEFORE running: the hook re-opens a modal, and a hook that
  // was still installed at that moment would fire again on the next close.
  const after = _modalOnClose;
  _modalOnClose = null;
  document.getElementById("modal-overlay").classList.add("hidden");
  // Reset the wide-modal flag so the next form-style modal isn't oversized.
  document.querySelector(".modal")?.classList.remove("wide");
  if (after) after();
}

// Backdrop-click close, wired from the overlay in index.html.
//
// WHY A TARGET CHECK AND NOT stopPropagation ON .modal. The overlay covers the
// whole screen, so a click inside the modal also hits the overlay on the way up;
// the old markup suppressed that with onclick="event.stopPropagation()" on the
// inner .modal. But js/actions.js dispatches EVERY data-action from one listener
// on `document` — stopping the event at .modal meant no click inside any modal
// ever reached it, so a data-action button in a modal silently did nothing and
// logged nothing. That is what broke the parade "Mark Present" confirm: the
// button was inert and the popup stayed open. Comparing event.target to the
// overlay gets the same close behaviour while letting the event keep bubbling.
function closeModalOnBackdrop(event) {
  if (event && event.target === document.getElementById("modal-overlay")) closeModal();
}

// Delete a record from within the person card, then re-open the card so the
// operator stays in context (plain deleteEntry would leave a stale modal up).
function pcDelete(arrayName, id, label, d4) {
  deleteEntry(arrayName, id, label);   // confirms, mutates, syncs, re-renders
  openPerson(d4);                      // refresh the card (no-op-ish if cancelled)
}

// HA Activity Days grid — GitHub-contribution-style calendar (§13 display).
// HA_GRID_CELL/HA_GRID_DOW/HA_GRID_MONTH live in helpers.js so any future grid
// view can reuse the same colour scheme without duplicating it.
function haActivityGridHtml(ha, d4, proj) {
  const dayMap = ha.dayMap || {};
  const excluded = haExcludedDayMap(d4);
  const keys = Object.keys(dayMap).concat(Array.from(excluded));
  const todayKey = todayISO();

  // Forecast markers: the minimum future training days to reach Single HA
  // (projected cells), the day it was attained (gold), and the currency
  // deadline / lapse day (amber). The grid is extended past today to cover
  // whichever of these lands furthest out, so the plan is actually visible.
  // `proj` is passed in by openPerson (which needs the full projection anyway)
  // so the expensive Double forward-simulation isn't run twice per card; fall
  // back to computing it if a future caller omits it.
  proj = proj || haProjection(ha);
  const projSet = new Set(proj.projectedDates);
  const completedIso = (ha.single && ha.single.completionDate) || (ha.expanded && ha.expanded.completionDate) || null;
  const lapseIso = ha.currency ? (ha.currency.lapseDateIso || ha.currency.deadlineIso || null) : null;

  if (!keys.length && !proj.projectedDates.length) return "";
  // With no logged days yet (a not-started recruit), anchor the grid at today so
  // the projected days still have a canvas to render on.
  const minIso = keys.length ? keys.reduce((a, b) => (b < a ? b : a)) : todayKey;
  let maxIso = todayKey;
  if (proj.projectedDates.length && proj.projectedDates[proj.projectedDates.length - 1] > maxIso) maxIso = proj.projectedDates[proj.projectedDates.length - 1];
  if (lapseIso && lapseIso > maxIso) maxIso = lapseIso;
  const weeks = haGridWeeks(minIso, maxIso);

  let lastMonth = null;
  const monthHead = weeks.map(w => {
    // Label the month where its 1st actually falls within this week, not just
    // the week's Monday — otherwise a month starting mid-week gets its label
    // delayed to the following column (the week whose Monday first reaches it).
    const firstOfMonth = w.days.find(iso => iso.slice(8, 10) === "01");
    const m = firstOfMonth ? +firstOfMonth.slice(5, 7) - 1 : +w.monIso.slice(5, 7) - 1;
    const label = m !== lastMonth ? HA_GRID_MONTH[m] : "";
    lastMonth = m;
    return `<th style="font-size:9px;font-weight:600;color:var(--muted);text-align:left;padding-left:1px">${label}</th>`;
  }).join("");

  const rows = HA_GRID_DOW.map((dow, r) => {
    const cells = weeks.map(w => {
      const iso = w.days[r];
      const disp = isoToDisplayDate(iso);
      let cell, title;
      // Precedence: projected plan → lapse deadline (may be future) → other
      // future → the attained day (gold, overlays a trained day) → excused →
      // trained → nothing.
      if (projSet.has(iso)) {
        cell = HA_GRID_CELL.projected;
        title = `${disp} — projected HA day (minimum plan)`;
      } else if (iso === lapseIso) {
        cell = HA_GRID_CELL.lapse;
        title = `${disp} — ${ha.currency && ha.currency.lapsed ? "currency lapsed here" : "currency deadline"}`;
      } else if (iso > todayKey) {
        cell = HA_GRID_CELL.future;
        title = "";
      } else if (iso === completedIso) {
        cell = HA_GRID_CELL.completed;
        title = `${disp} — Single HA attained`;
      } else if (excluded.has(iso)) {
        cell = HA_GRID_CELL.excused;
        title = `${disp} — medically excused`;
      } else if ((dayMap[iso] || 0) >= 2) {
        cell = HA_GRID_CELL.trained2;
        title = `${disp} — trained, ${dayMap[iso]} periods`;
      } else if ((dayMap[iso] || 0) >= 1) {
        cell = HA_GRID_CELL.trained1;
        title = `${disp} — trained, 1 period`;
      } else {
        cell = HA_GRID_CELL.none;
        title = `${disp} — no activity`;
      }
      const dayNum = +iso.slice(8, 10);
      return `<td class="ha-grid-td"><div class="ha-grid-cell" ${title ? `title="${escapeAttr(title)}"` : ""} style="background:${cell.bg};color:${cell.fg}${cell.border ? `;border:${cell.border}` : ""}">${dayNum}</div></td>`;
    }).join("");
    return `<tr><td class="ha-grid-dow">${r % 2 === 0 ? dow : ""}</td>${cells}</tr>`;
  }).join("");

  const legendKeys = ["none", "trained1", "trained2", "excused"];
  if (completedIso) legendKeys.push("completed");
  if (lapseIso) legendKeys.push("lapse");
  if (proj.projectedDates.length) legendKeys.push("projected");
  const legend = legendKeys
    .map(k => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:10px;color:var(--muted)"><span style="width:11px;height:11px;border-radius:2px;background:${HA_GRID_CELL[k].bg};display:inline-block;border:${HA_GRID_CELL[k].border || "1px solid var(--border)"}"></span>${HA_GRID_CELL[k].label}</span>`)
    .join("");

  return `
    <div style="overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px">
      <table class="ha-grid"><thead><tr><td></td>${monthHead}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div style="margin-top:6px">${legend}</div>
  `;
}

// ── Roster Notes, editable in place on the person card ──────────────────────
// Notes is the ONE roster column edited in-app. Every other roster field comes
// from the pre-enlistment nominal roll and is maintained in the Sheet (see
// openCommanderForm's comment) — but notes are exactly the kind of thing a
// commander writes down mid-day, and making them go to the Sheet for it meant
// they simply never got written.
//
// Deliberately NOT a modal: the person card IS the modal, and opening a second
// one over it would lose the reader's place in a long card. The block swaps
// itself between a read view and a textarea, in place.
//
// Rendered even when blank (for writers) — the old block was skipped when empty,
// which meant the only people who could see the field were the ones who already
// had notes, and there was no affordance to add the first one. Viewers still see
// nothing when it's blank; there is nothing for them to read or do.
function personNotesHtml(d4, editing) {
  const p = STATE.roster.find(r => r.id === d4);
  if (!p) return "";
  const notes = p.notes || "";
  const box = "background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:12px";
  if (!canWrite()) {
    return notes
      ? `<div style="${box};color:var(--text);white-space:pre-wrap"><strong style="color:var(--muted)">Notes:</strong> ${escapeHTML(notes)}</div>`
      : "";
  }
  if (editing) {
    return `<div style="${box}">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Notes</div>
      <textarea id="person-notes-input" rows="4" maxlength="1000" placeholder="Free-text remarks — e.g. wears specs, vehicle licence, recurring admin"
        style="width:100%;resize:vertical;padding:7px 9px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit;font-size:12px;outline:none"
        onkeydown="if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();personNotesSave('${d4}')}">${escapeHTML(notes)}</textarea>
      <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
        <button type="button" class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="personNotesSave('${d4}')">Save</button>
        <button type="button" class="btn" style="font-size:11px;padding:4px 10px" onclick="personNotesRefresh('${d4}', false)">Cancel</button>
        <span style="font-size:10px;color:var(--dim)">⌘/Ctrl + Enter to save</span>
      </div>
    </div>`;
  }
  return `<div style="${box};color:var(--text)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="white-space:pre-wrap;min-width:0">${notes
        ? `<strong style="color:var(--muted)">Notes:</strong> ${escapeHTML(notes)}`
        : `<span style="color:var(--dim)">No notes yet.</span>`}</div>
      <button type="button" class="btn btn-icon" style="padding:0 6px;flex-shrink:0"
        onclick="personNotesRefresh('${d4}', true)" title="${notes ? "Edit notes" : "Add notes"}">✎</button>
    </div>
  </div>`;
}
// Repaints only the notes block, so the rest of the card — and the reader's
// scroll position in it, and an open Report Sick Patterns panel — survive.
function personNotesRefresh(d4, editing) {
  const host = document.getElementById("person-notes");
  if (!host) return;
  host.innerHTML = personNotesHtml(d4, editing);
  if (editing) {
    const ta = document.getElementById("person-notes-input");
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
}
function personNotesSave(d4) {
  const ta = document.getElementById("person-notes-input");
  if (!ta) return;
  const idx = STATE.roster.findIndex(r => r.id === d4);
  if (idx < 0) return;
  const next = ta.value.trim();
  if (next === (STATE.roster[idx].notes || "")) { personNotesRefresh(d4, false); return; }
  STATE.roster[idx] = { ...STATE.roster[idx], notes: next };
  saveLocal();
  personNotesRefresh(d4, false);
  // Push the WHOLE roster row, never a {id, notes} patch. The backend's
  // upsertRow rewrites every sheet column from the row it is given
  // (`trimmed.map(h => rowData[h] ?? "")`), so a patch would blank name, age,
  // phone, allergies — the entire rest of that person's record.
  if (STATE.apiUrl) autoSync("Roster", { type: "upsert", row: STATE.roster[idx] });
}

function openPerson(d4) {
  const p = STATE.roster.find(r => r.id === d4); if (!p) return;
  const med = STATE.medical.filter(m => m.d4 === d4);
  const ippts = STATE.ippt.filter(i => i.d4 === d4).sort((a, b) => a.attempt - b.attempt);
  const socs = STATE.soc.filter(s => s.d4 === d4).sort((a, b) => a.socNum - b.socNum);

  // Polar sessions, chronological. Dates from the sheet arrive as "17 May 2026",
  // so convert to ISO for a reliable sort and fall back to raw string if parse fails.
  const pol = STATE.polar.filter(x => x.d4 === d4).slice().sort((a, b) => {
    const ai = displayDateToISO(a.date) || a.date || "";
    const bi = displayDateToISO(b.date) || b.date || "";
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  // Per-session derived metrics. Guard against div-by-zero on missing HR/duration.
  const computed = pol.map(x => {
    const avg = +x.avgHr || 0, max = +x.maxHr || 0, cal = +x.calories || 0, dur = +x.duration || 0;
    return {
      date: x.date, conduct: conductName(x.conductId),
      avgHr: avg, maxHr: max, calories: cal, duration: dur,
      efficiency: avg ? +(cal / avg).toFixed(2) : 0,
      intensity:  max ? +((avg / max) * 100).toFixed(1) : 0,
      workload:   avg * dur
    };
  });
  const latest = computed[computed.length - 1];

  // Commanders never show their 00xx id — surface rank instead. Recruits keep
  // the existing "4D — status" header.
  //
  // Feature 33: the status here is derived LIVE from the medical layer via
  // rosterDisplayStatusAll, not read off p.status. Since PR #65 removed the
  // medical→roster mirror, roster.status holds only active-vs-departed, so the
  // old statusBadge(p.status) badged someone on MC as "Active" while the roster
  // row beside it — which already goes through rosterDisplayStatus — said "MC".
  // The "All" variant lists every concurrent status (LD + Excuse RMJ), matching
  // the parade grid. Ghost recovery tags (MC+1/LD+2) appear here as everywhere.
  // DISPLAY ONLY: nothing on this card writes back to the Roster sheet.
  // No effByD4 map is passed — this is one person, the documented lone-caller
  // fallback; do not copy this call into a list render.
  const liveStatus = rosterDisplayStatusAll(p);
  let html = p.role === "Commander"
    ? `<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${p.rank ? p.rank + " · " : ""}Commander — ${liveStatus}</div>`
    : `<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${p.id} — ${liveStatus}</div>`;

  // ── Profile section ──────────────────────────────────
  const bmi = calcBMI(p);
  // 8-digit local numbers display nicer with a space in the middle.
  const fmtPhone = s => { const d = String(s || "").replace(/\D/g, ""); return d.length === 8 ? d.slice(0, 4) + " " + d.slice(4) : (s || ""); };
  const edu = p["highest education level"] || "";
  const moto = p["motorcycle license"] || "";
  const fact = (label, val, color) => `<span style="color:var(--muted)">${label}:</span> <strong style="color:${color || 'var(--text)'}">${escapeHTML(val || '—')}</strong>`;

  html += `<div class="card" style="margin-bottom:12px;padding:14px"><h3 style="margin-bottom:10px">Profile</h3>
    <div class="stats-row" style="margin-bottom:10px">
      <div class="stat"><label>Age</label><div class="val">${p.age || '—'}</div></div>
      <div class="stat"><label>Height</label><div class="val">${p.height ? p.height + '<span style="font-size:11px;color:var(--muted)"> cm</span>' : '—'}</div></div>
      <div class="stat"><label>Weight</label><div class="val">${p.weight ? p.weight + '<span style="font-size:11px;color:var(--muted)"> kg</span>' : '—'}</div></div>
      <div class="stat"><label>BMI</label><div class="val" style="color:${bmiColor(bmi)}">${bmi ?? '—'}</div></div>
    </div>
    ${p.phone || p.email ? `<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;margin-bottom:8px">
      ${p.phone ? `<span>📞 <a href="tel:${escapeAttr(String(p.phone).replace(/\D/g, ""))}" style="color:var(--accent);text-decoration:none">${escapeHTML(fmtPhone(p.phone))}</a></span>` : ""}
      ${p.email ? `<span>✉ <a href="mailto:${escapeAttr(p.email)}" style="color:var(--accent);text-decoration:none;word-break:break-all">${escapeHTML(p.email)}</a></span>` : ""}
    </div>` : ""}
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px">
      ${fact("Ration", p.ration)}
      ${fact("Edu", edu)}
      ${fact("Motorcycle", moto || "No")}
    </div>
  </div>`;

  if (p.allergies) html += `<div style="background:#E3B34122;border:1px solid #E3B34144;border-radius:6px;padding:8px;margin-bottom:8px;font-size:12px;color:var(--yellow)"><strong>Allergies:</strong> ${escapeHTML(p.allergies)}</div>`;
  if (p.msk) html += `<div style="background:#F8514922;border:1px solid #F8514944;border-radius:6px;padding:8px;margin-bottom:12px;font-size:12px;color:var(--red)"><strong>MSK history:</strong> ${escapeHTML(p.msk)}</div>`;
  // Roster Notes column — free-text remarks kept on the roster row (neutral,
  // not a warning like allergies/MSK). Editable in place; see personNotesHtml.
  html += `<div id="person-notes">${personNotesHtml(p.id, false)}</div>`;

  // RSIs stat is clickable when there are records — opens an inline patterns
  // panel below the stats strip with day-of-week, status mix, timeline, reasons.
  // Count is deduped per date so a recruit with multiple medical entries on
  // the same day (e.g. wizard auto-Pending + manual MC + manual Excuse) only
  // shows as one report-sick event.
  // Report-sick scope (spec §1.1). The server already withheld this person's
  // accumulated history — what reaches STATE for an out-of-scope person is only
  // their OPERATIONAL rows, the ones parade state needs. Rendering those as
  // "Medical History (2)" would therefore be a lie in the most damaging
  // direction: it reads as a complete record that happens to be short.
  //
  // Their CURRENT status stays visible throughout: §1.1 makes today's picture
  // ungated, and the badge comes from rosterDisplayStatus(), which reads exactly
  // those operational rows.
  const rsInScope = inRSScope(d4);
  const rsClickable = med.length > 0 && rsInScope;
  const medDays = new Set(med.map(m => m.date)).size;
  html += `<div class="stats-row"><div class="stat" ${rsClickable ? `onclick="toggleReportSickPatterns('${d4}')" style="cursor:pointer" title="Click to see patterns (unique days — multiple medical rows on the same day count as 1)"` : ""}><label>RSIs ${rsClickable ? '<span style="color:var(--dim);font-size:9px">▾ patterns</span>' : ''}</label><div class="val" style="color:${rsInScope && medDays > 1 ? 'var(--red)' : 'var(--muted)'}">${rsInScope ? medDays : "—"}</div></div>`;
  html += `<div class="stat"><label>IPPT Best</label><div class="val" style="color:var(--orange)">${ippts.length ? Math.max(...ippts.map(i => +i.score)) : "—"}</div></div>`;
  html += `<div class="stat"><label>SOCs</label><div class="val" style="color:var(--purple)">${socs.length}</div></div></div>`;
  html += `<div id="rs-patterns" style="display:none"></div>`;

  // Conduct Participation History — sits above IPPT/RM/SOC so a PC checking
  // "why has this recruit been missing conducts" sees the answer first thing.
  const cd = STATE.conductDetail.filter(d => d.d4 === d4).slice().sort((a, b) => {
    const ai = displayDateToISO(a.date) || a.date || "";
    const bi = displayDateToISO(b.date) || b.date || "";
    if (ai !== bi) return ai < bi ? 1 : -1;
    return (a.time || "") < (b.time || "") ? 1 : -1;
  });
  if (cd.length) {
    const cdTypeColor = t => t === "Status" ? "orange" : t === "RSI" ? "red" : t === "Fallout" ? "purple" : t === "PXP" ? "teal" : "yellow";
    // ReportSick is deduped by date — a recruit who falls out of three
    // conducts on the same day only went to MO once. Other types count rows
    // directly since each row is a distinct conduct miss.
    const cdCount = t => {
      const rows = cd.filter(d => d.type === t);
      if (t === "ReportSick") return new Set(rows.map(d => d.date)).size;
      return rows.length;
    };
    // "PXP" = present but not participating (doing stretches) → NOT a miss; only
    // Status/RSI/Fallout/ReportSick rows are genuine conduct misses. (Stored as
    // "PXP" not "PX" so the legacy PX→Status read migration never clobbers it.)
    const missedCount = cd.filter(d => d.type !== "PXP").length;
    html += `<h4 style="font-size:12px;color:var(--muted);margin:16px 0 8px">Conduct Participation History — <span style="color:var(--red)">${missedCount} missed</span> <span style="color:var(--dim);font-weight:400">(${cdCount("Status")} Status · ${cdCount("RSI")} RSI · ${cdCount("Fallout")} Fallout · ${cdCount("ReportSick")} ReportSick${cdCount("PXP") ? ` · ${cdCount("PXP")} PX` : ""})</span></h4>`;
    // A grid, not a <table>. Four columns of wildly different natural widths
    // inside a 520px modal left the auto table layout no good option, and on a
    // phone it compressed TYPE to ~49px — which, with the modal's inherited
    // word-break:break-word, shattered "REPORTSICK" into "REPO / RTSI / CK".
    // The grid gives each column a floor, and below ~440px of CONTAINER width
    // (.pc-cph in styles.css) the row restacks into a block: when + type on the
    // first line, conduct, then reason. Nothing is ever squeezed narrower than
    // its content. The <th> row survives as .pc-cph__head — sticky on the wide
    // layout, hidden once stacked, where per-row labels would be noise.
    const cphRow = (cls, when, what, type, why) =>
      `<div class="pc-cph__row${cls}"><div class="pc-cph__when">${when}</div><div class="pc-cph__what">${what}</div><div class="pc-cph__type">${type}</div><div class="pc-cph__why">${why}</div></div>`;
    html += `<div class="pc-cph">
      ${cphRow(" pc-cph__head", "Date", "Conduct", "Type", "Reason")}
      ${cd.map(d => cphRow("",
        `${d.date}${d.time ? ` <span class="mono pc-cph__time">${fmtHrs(d.time)}</span>` : ""}`,
        escapeHTML(conductName(d.conductId)),
        badge(d.type, cdTypeColor(d.type)),
        escapeHTML(d.reason || ""))).join("")}
    </div>`;
  }

  // Tiny inline edit/delete controls reused across the card record blocks.
  const pcBtns = (formFn, arrayName, id, label) =>
    `<span style="display:inline-flex;gap:2px;margin-left:4px"><button class="btn btn-icon" style="padding:0 5px" onclick="event.stopPropagation(); ${formFn}(${id})" title="Edit">✎</button><button class="btn btn-icon btn-danger" style="padding:0 5px" onclick="event.stopPropagation(); pcDelete('${arrayName}',${id},'${label}','${d4}')" title="Delete">✕</button></span>`;

  if (ippts.length) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">IPPT Progression</h4>`;
    html += `<div class="chart-box"><canvas id="person-ippt-chart"></canvas></div>`;
    // Fix 17: progression chips take the same full-pill shape as every other tag.
    html += ippts.map(i => `<span style="display:inline-flex;align-items:center;margin:2px;background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:2px 6px;font-size:11px">#${i.attempt}: ${isYTT(i) ? "—" : i.score} ${awardBadge(i.score)}${pcBtns("openIPPTForm", "ippt", i.id, "IPPT entry")}</span>`).join("");
  }
  // Chore 7: the Route March block sat here (and an "RMs" count in the stats
  // strip above). Both went with the Route March tab — STATE.rm still holds the
  // data and Settings still exports it, there is just no UI reading it.
  if (socs.length) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">SOC</h4><div style="display:flex;gap:8px;flex-wrap:wrap">`;
    html += socs.map(s => `<div style="background:var(--surface2);border-radius:6px;padding:8px 12px;border:1px solid var(--border);text-align:center"><div style="font-size:10px;color:var(--muted)">SOC ${s.socNum}</div><div class="mono" style="font-size:16px;font-weight:700;color:var(--purple)">${socDurationDisplay(s.time)}</div>${pcBtns("openSOCForm", "soc", s.id, "SOC entry")}</div>`).join("");
    html += `</div>`;
  }
  if (!rsInScope) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">Medical History</h4>
      <div style="font-size:12px;color:var(--muted);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:4px;padding:8px 12px">
        History outside your scope.
      </div>`;
  } else if (med.length) {
    const today = todayISO();
    // Sort newest-first by startDate (falling back to date logged) so the
    // most recent / currently-relevant entries are at the top.
    const medSorted = med.slice().sort((a, b) => {
      const ai = displayDateToISO(a.startDate || a.date) || "";
      const bi = displayDateToISO(b.startDate || b.date) || "";
      return ai < bi ? 1 : ai > bi ? -1 : 0;
    });
    // Feature 29: one card per VISIT. The count in the heading stays a count of
    // STATUSES (med.length) — it feeds the "how many report-sick events" read
    // that the patterns panel below is built on, and quietly changing it to a
    // visit count would move a number the rest of the card reasons about.
    const medGroups = groupByVisit(medSorted);
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">Medical History <span style="color:var(--dim);font-weight:400">(${med.length})</span></h4>`;
    html += medGroups.map(grp => {
      const m = grp.first;
      const shared = `${medTypeBadge(m)}${escapeHTML(m.reason || "")}${m.origin === "conductLog" ? ` <span class="badge badge-teal" style="font-size:8px">from conduct log</span>` : ""}`;
      const todayOf = r => {
        const ti = medStatusTag(r, today);
        return ti ? `<span style="margin-left:6px">${medTagBadge(ti.tag)}<span style="color:var(--dim);font-size:10px;margin-left:4px">today</span></span>` : "";
      };
      // A single-status visit keeps its existing one-card layout exactly —
      // that is the overwhelmingly common case and there is no reason to move
      // anything under it. Only a genuine multi-status visit gets the stacked
      // shape, where Edit belongs to the visit and Delete to each status.
      if (grp.rows.length === 1) {
        return `<div style="background:var(--surface2);border-radius:6px;padding:8px 10px;margin-bottom:4px;border:1px solid var(--border);font-size:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <span>${medTypeBadge(m)}${m.status ? medTagBadge(m.status) : '<span style="color:var(--muted)">No status</span>'} ${escapeHTML(m.reason || "")}${m.origin === "conductLog" ? ` <span class="badge badge-teal" style="font-size:8px">from conduct log</span>` : ""}</span>
            <span style="display:inline-flex;align-items:center;gap:4px">${todayOf(m)}${pcBtns("openMedicalForm", "medical", m.id, "medical record")}</span>
          </div>
          <div style="color:var(--muted);font-size:11px;margin-top:2px">${medDurationLabel(m)}</div>
        </div>`;
      }
      return `<div style="background:var(--surface2);border-radius:6px;padding:8px 10px;margin-bottom:4px;border:1px solid var(--border);font-size:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span>${shared} <span style="color:var(--dim);font-size:10px">· ${grp.rows.length} statuses from one visit</span></span>
          <button class="btn btn-icon" style="padding:0 5px" onclick="event.stopPropagation(); openMedicalForm(${JSON.stringify(m.id)})" title="Edit this visit (all statuses)">✎</button>
        </div>
        ${grp.rows.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;padding-top:4px;border-top:1px solid var(--border)">
          <span>${r.status ? medTagBadge(r.status) : '<span style="color:var(--muted)">No status</span>'} <span style="color:var(--muted);font-size:11px">${medDurationLabel(r)}</span></span>
          <span style="display:inline-flex;align-items:center;gap:4px">${todayOf(r)}<button class="btn btn-icon btn-danger" style="padding:0 5px" onclick="event.stopPropagation(); pcDelete('medical',${JSON.stringify(r.id)},'status','${d4}')" title="Delete just this status">✕</button></span>
        </div>`).join("")}
      </div>`;
    }).join("");
  }

  // ── MSK / Physio section ─────────────────────────────
  // Self-reported via Google Form (separate from medical layer). Shows
  // injury reports + exercise log timeline + whether the case is currently
  // cleared. Helps a sergeant get the full physio picture in one glance.
  // Same report-sick scope as the medical history above — MSK is the other
  // gated tab, and an out-of-scope person's cleared cases were withheld server
  // side, so a timeline built from what's left would misrepresent the case.
  const mskRows = rsInScope ? STATE.msk.filter(m => m.d4 === d4) : [];
  if (!rsInScope) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">MSK / Physio</h4>
      <div style="font-size:12px;color:var(--muted);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:4px;padding:8px 12px">
        History outside your scope.
      </div>`;
  } else if (mskRows.length) {
    const tsOf = r => String(r.timestamp || "");
    const injuries = mskRows.filter(r => (r.type || "").toLowerCase().includes("report"))
      .sort((a, b) => tsOf(a) < tsOf(b) ? 1 : -1);
    const exercises = mskRows.filter(r => (r.type || "").toLowerCase().includes("log") || (r.type || "").toLowerCase().includes("exercise"))
      .sort((a, b) => tsOf(a) < tsOf(b) ? 1 : -1);
    const allCleared = mskRows.every(r => r.cleared);
    const clearedBadge = allCleared
      ? ` <span class="badge badge-green" style="font-size:9px">CLEARED</span>`
      : ` <span class="badge badge-pink" style="font-size:9px">ACTIVE</span>`;
    html += `<h4 style="font-size:12px;color:var(--muted);margin:16px 0 8px">🦵 MSK / Physio <span style="color:var(--dim);font-weight:400">(${mskRows.length} record${mskRows.length === 1 ? '' : 's'})</span>${clearedBadge}</h4>`;
    if (injuries.length) {
      html += `<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Injury reports</div>`;
      html += injuries.map(r => {
        // Apps Script already formats Date cells as "21 May 2026" — use
        // as-is. Slicing was truncating the last digit of the year.
        const t = r.timestamp || "";
        return `<div style="background:var(--surface2);border-radius:6px;padding:8px 10px;margin-bottom:4px;border-left:2px solid var(--pink);font-size:12px"><div style="color:var(--muted);font-size:10px">${t}</div>${escapeHTML(r.description || "")}</div>`;
      }).join("");
    }
    if (exercises.length) {
      html += `<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px">Physio visits</div>`;
      html += exercises.map(r => {
        const d = r.physioDate || r.timestamp || "";
        const exText = r.exercises ? escapeHTML(r.exercises) : `<span style="color:var(--dim)">(no new exercises)</span>`;
        return `<div style="background:var(--surface2);border-radius:6px;padding:8px 10px;margin-bottom:4px;border-left:2px solid var(--teal);font-size:12px"><div style="color:var(--muted);font-size:10px">${d}</div>${exText}</div>`;
      }).join("");
    }
  }

  // ── Heat Acclimatisation section ─────────────────────
  if (p.role === "Recruit" || p.role === "") {
    const ha = computeHA(d4);
    const badgeColor = haStatusColor(ha.overallStatus);

    // Three parallel programme bars (§13): Single (teal), Expanded (amber),
    // Double (blue, only when eligible). Each shows periods/target + breaks used.
    const bar = (label, track, target, color, extra) => {
      const periods = track ? track.periods : 0;
      const pct = Math.min(100, Math.round((periods / target) * 100));
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
          <span style="color:${color};font-weight:600">${label}</span>
          <span style="color:var(--muted)">${periods}/${target} periods${extra || ""}</span>
        </div>
        <div style="width:100%;height:7px;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${color};transition:width .4s ease"></div>
        </div>
      </div>`;
    };

    // Minimum-days-to-attain projection — used by the figure lines below AND
    // the activity grid's projected cells. Computed once and shared so the grid
    // doesn't re-run the expensive Double forward-simulation.
    const proj = haProjection(ha);

    // Activity grid: GitHub-contribution-style calendar of this recruit's HA days.
    const timelineHtml = haActivityGridHtml(ha, d4, proj);

    const currLine = ha.currency && ha.currency.lapsed
      ? `<div style="font-size:11px;color:var(--red);margin-top:6px">⚠ Currency lapsed${ha.currency.lapseDateIso ? " (deadline " + isoToDisplayDate(ha.currency.lapseDateIso) + ")" : ""} — re-qualify via any programme.</div>`
      : (ha.currency && ha.currency.deadlineIso ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">Currency deadline: ${isoToDisplayDate(ha.currency.deadlineIso)}</div>` : "");

    // Minimum-days-to-attain figure (mirrors the projected cells on the grid;
    // `proj` was computed once above and shared with haActivityGridHtml).
    const projLine = proj.attained
      ? `<div style="font-size:11px;color:var(--green);margin-top:6px">✅ Single HA attained</div>`
      : `<div style="font-size:11px;color:#2DD4BF;margin-top:6px">🎯 Minimum <strong>${proj.days}</strong> training day${proj.days === 1 ? "" : "s"} to Single HA${proj.projectedDates.length ? ` (by ${isoToDisplayDate(proj.projectedDates[proj.projectedDates.length - 1])} if trained daily)` : ""}</div>`;

    // Double projection — shown only once Single is complete and the recruit is
    // Double-eligible (haProjection.double is null otherwise, and the "locked"
    // Double bar line already explains why). Forward-simulated from the live state
    // machine at the standard 2-period session/day (helpers.js haProjectDouble).
    const dblProjLine = (proj.double && proj.double.relevant)
      ? (proj.double.attained
          ? `<div style="font-size:11px;color:var(--green);margin-top:4px">✅ Double HA attained</div>`
          : proj.double.reachable
            ? `<div style="font-size:11px;color:#388BFD;margin-top:4px">🎯 Minimum <strong>${proj.double.days}</strong> training day${proj.double.days === 1 ? "" : "s"} to Double HA${proj.double.projectedDates.length ? ` (by ${isoToDisplayDate(proj.double.projectedDates[proj.double.projectedDates.length - 1])} if trained daily)` : ""}</div>`
            : `<div style="font-size:11px;color:var(--muted);margin-top:4px">Double HA not attainable at the standard session rate</div>`)
      : "";

    html += `
      <h4 style="font-size:12px;color:var(--muted);margin:16px 0 8px">🌡️ Heat Acclimatisation (HA)</h4>
      <div class="card" style="padding:14px;background:var(--surface2);margin-bottom:12px">
        <div style="margin-bottom:10px">
          Status: <span class="badge" style="background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor}44;padding:2px 6px;border-radius:999px;font-size:11px;font-weight:600">${ha.overallStatus}</span>
          ${ha.singleTrack ? `<span style="font-size:10px;color:var(--muted);margin-left:6px">(via ${ha.singleTrack})</span>` : ""}
        </div>
        ${bar("Single", ha.single, 10, "#2DD4BF", ha.single ? `, ${ha.single.breaksUsed} breaks` : "")}
        ${bar("Expanded", ha.expanded, 14, "#D29922", ha.expanded ? `, ${ha.expanded.breaksUsed} breaks / ${ha.expanded.consecutiveBreak || 0} consec` : "")}
        ${ha.doubleEligible
          ? bar("Double", ha.doubleTrack, 13, "#388BFD", ha.doubleTrack ? `, ${ha.doubleTrack.breaksUsed} breaks` : "")
          : `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Double: 🔒 ${ha.singleStatus === "Single HA Complete" ? "not eligible (needs VocFit or ≥3SG/≥2LT)" : "locked until Single HA complete"}</div>`}
        ${projLine}
        ${dblProjLine}
        ${currLine}
        ${timelineHtml ? `
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px">Activity Days</div>
          ${timelineHtml}
        ` : `<div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px">No HA participation logged yet (CSV import).</div>`}
      </div>
    `;
  }

  // ── Polar metrics section ────────────────────────────
  if (computed.length) {
    // Color thresholds: HR ranges follow the existing Polar table convention.
    // Intensity uses standard zone bands (~70 moderate, 80 hard, 90 max).
    const avgHrCol = latest.avgHr > 160 ? 'var(--red)' : latest.avgHr > 140 ? 'var(--orange)' : latest.avgHr ? 'var(--green)' : 'var(--muted)';
    const intCol = latest.intensity >= 90 ? 'var(--red)' : latest.intensity >= 80 ? 'var(--orange)' : latest.intensity >= 70 ? 'var(--yellow)' : latest.intensity ? 'var(--green)' : 'var(--muted)';

    html += `<h4 style="font-size:12px;color:var(--muted);margin:16px 0 8px">Polar Metrics & Progression <span style="color:var(--dim);font-weight:400">(${computed.length} session${computed.length === 1 ? '' : 's'}, latest: ${latest.date || '—'})</span></h4>`;

    html += `<div class="stats-row" style="margin-bottom:10px">
      <div class="stat" title="Latest session average heart rate"><label>Avg HR</label><div class="val" style="color:${avgHrCol};font-size:17px">${latest.avgHr || '—'}</div></div>
      <div class="stat" title="Latest session peak heart rate"><label>Max HR</label><div class="val" style="color:var(--red);font-size:17px">${latest.maxHr || '—'}</div></div>
      <div class="stat" title="Calories burned latest session"><label>kcal</label><div class="val" style="color:var(--orange);font-size:17px">${latest.calories || '—'}</div></div>
      <div class="stat" title="kcal / avg HR — output per heartbeat"><label>Efficiency</label><div class="val" style="color:var(--teal);font-size:17px">${latest.efficiency || '—'}</div></div>
      <div class="stat" title="avg HR / max HR — how close to ceiling"><label>Intensity</label><div class="val" style="color:${intCol};font-size:17px">${latest.intensity ? latest.intensity + '%' : '—'}</div></div>
      <div class="stat" title="avg HR × duration — total cardiac load"><label>Workload</label><div class="val" style="color:var(--purple);font-size:17px">${latest.workload || '—'}</div></div>
    </div>`;

    html += `<div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:12px;line-height:1.55">
      <div><strong style="color:var(--teal)">Efficiency</strong> = kcal ÷ avg HR. Rising over time means more output per heartbeat — improving conditioning.</div>
      <div><strong style="color:var(--yellow)">Intensity</strong> = avg HR ÷ max HR (%). How close to their ceiling they worked. &lt;70% easy, 70–80% moderate, 80–90% hard, &gt;90% max effort.</div>
      <div><strong style="color:var(--pink)">Recovery</strong> = max HR trend across identical sessions. A declining max HR at the same workload suggests improved fitness <em>or</em> fatigue/overtraining — context matters.</div>
      <div><strong style="color:var(--purple)">Workload</strong> = avg HR × duration (min). Total cardiac load — useful for tracking weekly load and periodisation.</div>
    </div>`;

    html += `<div class="grid-2" style="gap:10px">
      <div class="card" style="padding:10px;margin:0"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">Heart Rate (avg vs max)</div><div class="chart-box"><canvas id="pm-hr"></canvas></div></div>
      <div class="card" style="padding:10px;margin:0"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">Calories (kcal)</div><div class="chart-box"><canvas id="pm-cal"></canvas></div></div>
      <div class="card" style="padding:10px;margin:0"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">Efficiency (kcal / avg HR)</div><div class="chart-box"><canvas id="pm-eff"></canvas></div></div>
      <div class="card" style="padding:10px;margin:0"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">Intensity (avg / max %)</div><div class="chart-box"><canvas id="pm-int"></canvas></div></div>
      <div class="card" style="padding:10px;margin:0;grid-column:span 2"><div style="font-size:10px;color:var(--muted);margin-bottom:4px">Workload (avg HR × min)</div><div class="chart-box tall"><canvas id="pm-wl"></canvas></div></div>
    </div>`;
  }

  openModal(p.name, html);
  // Wide modal: this view is chart-heavy and needs more horizontal room than
  // the default form-sized modal.
  document.querySelector(".modal")?.classList.add("wide");

  // Charts need to be created after modal contents are in the DOM.
  setTimeout(() => {
    const ipptCanvas = document.getElementById("person-ippt-chart");
    if (ipptCanvas && ippts.length) {
      new Chart(ipptCanvas, {
        type: "line",
        data: { labels: ippts.map(i => "#" + i.attempt), datasets: [{ data: ippts.map(i => +i.score), borderColor: "#D29922", backgroundColor: "#D2992233", fill: true, tension: .3, pointRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, grid: { color: "#30363D" } }, x: { grid: { color: "#30363D" } } } }
      });
    }

    if (computed.length) {
      // Short labels — drop the year so the x-axis stays readable in a small canvas.
      const labels = computed.map(c => {
        const parts = (c.date || "").split(" ");
        return parts.length >= 2 ? parts.slice(0, 2).join(" ") : (c.date || "");
      });
      // maintainAspectRatio: false → fill the .chart-box wrapper's fixed height
      // instead of growing the canvas indefinitely with container width.
      const axisBase = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => computed[items[0].dataIndex]?.conduct || labels[items[0].dataIndex] } } },
        scales: {
          y: { grid: { color: "#30363D" }, ticks: { color: "#8B949E", font: { size: 9 } } },
          x: { grid: { color: "#30363D" }, ticks: { color: "#8B949E", font: { size: 9 }, maxRotation: 0, autoSkip: true } }
        }
      };

      new Chart(document.getElementById("pm-hr"), {
        type: "line",
        data: { labels, datasets: [
          { label: "Avg HR", data: computed.map(c => c.avgHr), borderColor: "#58A6FF", backgroundColor: "#58A6FF22", tension: .3, pointRadius: 3 },
          { label: "Max HR", data: computed.map(c => c.maxHr), borderColor: "#F85149", backgroundColor: "#F8514922", tension: .3, pointRadius: 3 }
        ] },
        options: { ...axisBase, plugins: { ...axisBase.plugins, legend: { display: true, position: "bottom", labels: { color: "#8B949E", font: { size: 9 }, boxWidth: 10 } } } }
      });

      new Chart(document.getElementById("pm-cal"), {
        type: "line",
        data: { labels, datasets: [{ data: computed.map(c => c.calories), borderColor: "#D29922", backgroundColor: "#D2992233", fill: true, tension: .3, pointRadius: 3 }] },
        options: axisBase
      });

      new Chart(document.getElementById("pm-eff"), {
        type: "line",
        data: { labels, datasets: [{ data: computed.map(c => c.efficiency), borderColor: "#39D2C0", backgroundColor: "#39D2C033", fill: true, tension: .3, pointRadius: 3 }] },
        options: axisBase
      });

      new Chart(document.getElementById("pm-int"), {
        type: "line",
        data: { labels, datasets: [{ data: computed.map(c => c.intensity), borderColor: "#E3B341", backgroundColor: "#E3B34133", fill: true, tension: .3, pointRadius: 3 }] },
        options: { ...axisBase, scales: { ...axisBase.scales, y: { min: 0, max: 100, grid: { color: "#30363D" }, ticks: { color: "#8B949E", font: { size: 9 }, callback: v => v + '%' } } } }
      });

      new Chart(document.getElementById("pm-wl"), {
        type: "bar",
        data: { labels, datasets: [{ data: computed.map(c => c.workload), backgroundColor: "#BC8CFF44", borderColor: "#BC8CFF", borderWidth: 1 }] },
        options: axisBase
      });
    }
  }, 100);
}

// Inline expand under the RSIs stat — shows day-of-week, status mix, timeline,
// and top reasons. A PC checking "is this guy gaming the system?" gets the
// answer at a glance: Mondays + always-NIL → suspicious; mixed days + LD/MC
// with real diagnoses → genuine pattern.
function toggleReportSickPatterns(d4) {
  const panel = document.getElementById("rs-patterns");
  if (!panel) return;
  if (panel.style.display !== "none") { panel.style.display = "none"; panel.innerHTML = ""; return; }

  // Belt-and-braces: the trigger is already hidden for an out-of-scope person
  // (openPerson), but this is the pattern-analysis panel — the single most
  // sensitive surface in the card — so it refuses on its own rather than
  // trusting a caller.
  if (!inRSScope(d4)) return;
  const med = STATE.medical.filter(m => m.d4 === d4);
  if (!med.length) return;

  // Day-of-week distribution. The "report sick" date is what matters here —
  // not the MC start date, which can shift forward by a day.
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dow = [0, 0, 0, 0, 0, 0, 0];
  med.forEach(m => {
    const iso = displayDateToISO(m.date);
    if (!iso) return;
    dow[new Date(iso).getDay()]++;
  });
  const maxDow = Math.max(...dow, 1);

  // Status mix — reveals "always NIL" (malingering signal) vs real MC/LD pattern.
  const statusCounts = {};
  med.forEach(m => { const k = m.status || "—"; statusCounts[k] = (statusCounts[k] || 0) + 1; });
  const statusOrder = ["MC", "Warded", "LD", "RIB (Rest in Bunk)", "RMJ", "Excuse Heavy Load", "Excuse Kneeling", "Excuse Squatting", "Excuse Uniform", "Excuse RMJ", "Excuse Swimming", "Excuse Prolonged Standing", "Excuse Upper Limb", "Excuse Lower Limb", "Excuse FLEGS", "Excuse Sunlight", "Excuse Stay In", "Excuse PT", "Excuse Shoes", "Excuse Boots", "Excuse Camo", "Excuse Loud Noise", "Pending", "NIL"];
  const statusRows = statusOrder.filter(s => statusCounts[s]).map(s => [s, statusCounts[s]]);
  const nilPct = med.length ? Math.round((statusCounts["NIL"] || 0) / med.length * 100) : 0;

  // Avg gap between report-sick events — accelerating frequency is a signal.
  const isoDates = med.map(m => displayDateToISO(m.date)).filter(Boolean).sort();
  const gaps = [];
  for (let i = 1; i < isoDates.length; i++) {
    gaps.push(Math.round((new Date(isoDates[i]) - new Date(isoDates[i - 1])) / 86400000));
  }
  const avgGap = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null;
  const lastGap = gaps.length ? gaps[gaps.length - 1] : null;

  // Top reasons (case-insensitive grouping; show original casing of first occurrence).
  const reasonMap = {};
  med.forEach(m => {
    const key = (m.reason || "").trim().toLowerCase();
    if (!key) return;
    if (!reasonMap[key]) reasonMap[key] = { display: (m.reason || "").trim(), count: 0 };
    reasonMap[key].count++;
  });
  const topReasons = Object.values(reasonMap).sort((a, b) => b.count - a.count).slice(0, 6);

  // Timeline: each report-sick as a dot on a date axis, colored by status.
  const tlPoints = med
    .map(m => ({ iso: displayDateToISO(m.date), status: m.status || "—", reason: m.reason || "" }))
    .filter(p => p.iso)
    .sort((a, b) => a.iso < b.iso ? -1 : 1);

  const statusColor = {
    "MC": "#F85149", "Warded": "#F85149",
    "LD": "#D29922", "RMJ": "#D29922", "RIB (Rest in Bunk)": "#E3B341",
    "Excuse Heavy Load": "#E3B341", "Excuse Kneeling": "#E3B341", "Excuse Squatting": "#E3B341", "Excuse Uniform": "#E3B341", "Excuse RMJ": "#E3B341", "Excuse Swimming": "#E3B341", "Excuse Prolonged Standing": "#E3B341", "Excuse Upper Limb": "#E3B341", "Excuse Lower Limb": "#E3B341",
    "Excuse FLEGS": "#E3B341", "Excuse Sunlight": "#E3B341", "Excuse Stay In": "#E3B341", "Excuse PT": "#E3B341", "Excuse Shoes": "#E3B341", "Excuse Boots": "#E3B341", "Excuse Camo": "#E3B341", "Excuse Loud Noise": "#E3B341",
    "Pending": "#8B949E", "NIL": "#39D353", "—": "#6E7681"
  };

  const dowBars = dow.map((c, i) => {
    const h = Math.round((c / maxDow) * 80);
    // Flag Mon (1) prominently if it's the modal day and there are ≥3 entries.
    const isMonPeak = i === 1 && c === maxDow && c >= 3;
    const color = isMonPeak ? "var(--red)" : c === maxDow && c > 0 ? "var(--orange)" : "var(--accent)";
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <div style="font-size:10px;color:var(--muted);height:12px">${c || ""}</div>
      <div style="width:100%;background:${color};height:${h}px;min-height:${c ? 2 : 0}px;border-radius:3px 3px 0 0;opacity:${c ? 1 : .15}"></div>
      <div style="font-size:10px;color:var(--muted)">${dowNames[i]}</div>
    </div>`;
  }).join("");

  // Label ABOVE the bar, not in a fixed-width column beside it. The old layout
  // pinned the badge into a `flex:0 0 110px` track, which is narrower than most
  // real status names — "Excuse Prolonged Standing" wrapped to three lines and
  // in this panel's half-width grid column it degenerated into a column of
  // single words. Stacking removes the constraint entirely: the badge gets the
  // full row width so it stays on one line, and every bar now starts at x=0, so
  // they are MORE comparable than when a variable-height label sat beside them.
  const statusBars = statusRows.map(([s, n]) => {
    const pct = Math.round((n / med.length) * 100);
    return `<div style="display:flex;flex-direction:column;gap:3px;font-size:11px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="min-width:0">${medTagBadge(s)}</span>
        <span class="mono" style="color:var(--muted);white-space:nowrap">${n} · ${pct}%</span>
      </div>
      <div style="background:var(--surface2);border-radius:3px;height:14px;position:relative;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${statusColor[s] || "var(--accent)"}"></div>
      </div>
    </div>`;
  }).join("");

  // Detect concerning patterns and surface them as text callouts.
  const flags = [];
  if (nilPct >= 50 && med.length >= 3) flags.push(`<span style="color:var(--red)">⚠ ${nilPct}% NIL outcomes</span> — MO frequently finds nothing wrong`);
  if (dow[1] === maxDow && dow[1] >= 3) flags.push(`<span style="color:var(--orange)">⚠ Monday-heavy</span> — ${dow[1]} of ${med.length} on Mondays`);
  if (lastGap !== null && avgGap !== null && lastGap < avgGap / 2 && gaps.length >= 2) flags.push(`<span style="color:var(--orange)">⚠ Accelerating</span> — last gap ${lastGap}d vs avg ${avgGap}d`);

  panel.innerHTML = `
    <div class="card" style="margin:8px 0 16px;padding:14px;border-left:3px solid var(--accent)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:13px">Report Sick Patterns <span style="color:var(--dim);font-weight:400;font-size:11px">(${med.length} events${avgGap !== null ? ` · avg ${avgGap}d apart` : ""})</span></h3>
        <button class="btn btn-icon" onclick="toggleReportSickPatterns('${d4}')" title="Close">✕</button>
      </div>
      ${flags.length ? `<div style="background:var(--surface2);border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:11px;line-height:1.7">${flags.join("<br>")}</div>` : ""}
      <div class="grid-2" style="gap:14px;align-items:start">
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Day of Week</div>
          <div style="display:flex;gap:4px;align-items:flex-end;height:110px">${dowBars}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Status Mix</div>
          <div style="display:flex;flex-direction:column;gap:9px">${statusBars}</div>
        </div>
      </div>
      ${tlPoints.length ? `<div style="margin-top:14px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Timeline <span style="color:var(--dim);text-transform:none;letter-spacing:0">(first → last, color = status)</span></div>
        <div class="chart-box" style="height:80px"><canvas id="rs-timeline"></canvas></div>
      </div>` : ""}
      ${topReasons.length ? `<div style="margin-top:14px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Top Reasons</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${topReasons.map(r => `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:11px"><span style="color:var(--text)">${escapeHTML(r.display)}</span> <span class="mono" style="color:var(--accent);font-weight:700;margin-left:4px">×${r.count}</span></div>`).join("")}
        </div>
      </div>` : ""}
    </div>
  `;
  panel.style.display = "";

  setTimeout(() => {
    const tlCanvas = document.getElementById("rs-timeline");
    if (!tlCanvas || !tlPoints.length) return;
    new Chart(tlCanvas, {
      type: "scatter",
      data: { datasets: [{
        data: tlPoints.map(p => ({ x: new Date(p.iso).getTime(), y: 0, _status: p.status, _reason: p.reason, _iso: p.iso })),
        backgroundColor: tlPoints.map(p => statusColor[p.status] || "#6E7681"),
        borderColor: tlPoints.map(p => statusColor[p.status] || "#6E7681"),
        pointRadius: 7, pointHoverRadius: 9
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => { const p = c.raw; const d = new Date(p.x); return `${d.toLocaleDateString()} — ${p._status}${p._reason ? ": " + p._reason : ""}`; } } }
        },
        scales: {
          y: { display: false, min: -1, max: 1 },
          x: { type: "linear", grid: { color: "#30363D" }, ticks: { color: "#8B949E", font: { size: 9 }, callback: v => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}`; } } }
        }
      }
    });
  }, 50);
}

// ─── FORM OPENERS + SUBMITTERS ─────────────────────────

// Validation strategy: every form is wrapped in <form onsubmit> so HTML5
// constraint validation (required, min, max, type=date/time) runs before our
// JS. Cross-field rules (e.g. participating ≤ total) are checked in submit*.
//
// Edit mode: open*Form(id) pre-fills the form from the existing entry. A hidden
// f-entry-id input carries the id through to submit*, which then replaces the
// row instead of pushing a new one. Edits stay local — sheet sync only auto-
// appends new rows; edited rows wait for a manual "Push to Sheet" to avoid
// duplicating rows in the sheet.

// Small banner shown in edit mode to remind users that edits don't auto-sync.
const editHint = `<div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;margin-bottom:4px">Edits save locally. Use the tab's <strong>Push to Sheet</strong> button to sync.</div>`;


// Builds the <option> markup for a medical-status <select>: the standard enum
// (grouped by severity), saved custom statuses, and — when `selected` is a
// one-off status not in any known list — an orphan option so it stays selected.
// Shared by the main status field and every "additional status" row.
function medStatusOptionsHtml(selected = "") {
  const std = MED_STATUS_GROUPS.map(g =>
    `<optgroup label="${g.label}">${g.options.map(o => `<option value="${o}" ${o === selected ? "selected" : ""}>${o}</option>`).join("")}</optgroup>`
  ).join("");
  const customList = STATE.customStatuses || [];
  const custom = customList.length
    ? `<optgroup label="Custom">${customList.map(c => `<option value="${escapeAttr(c.name)}" ${c.name === selected ? "selected" : ""}>${escapeAttr(c.name)}${c.participates ? " (participates)" : ""}</option>`).join("")}</optgroup>`
    : "";
  const known = new Set([...MED_STATUSES, ...customList.map(c => c.name)]);
  const orphan = (selected && !known.has(selected))
    ? `<optgroup label="Current"><option value="${escapeAttr(selected)}" selected>${escapeAttr(selected)}</option></optgroup>`
    : "";
  return `<option value="">Select status...</option>${std}${custom}${orphan}`;
}

// Appends an "additional status" row to the medical form so one report-sick
// entry can carry several statuses (e.g. "2D LD" + "4D Excuse RMJ"), each with
// its own duration. On submit these become sibling Medical rows sharing the
// recruit/date/reason/location — which the parade state + dashboard already
// group under one person. Optional args pre-fill the row when editing.
let _medExtraIdx = 0;
function addMedStatusRow(status = "", startIso = null, endIso = null) {
  const host = document.getElementById("f-extra-statuses");
  if (!host) return;
  // Subsequent statuses usually share the previous one's duration, so default
  // the dates to the status directly above (the last extra row, or the main
  // status fields if this is the first extra). Passing explicit dates overrides.
  if (startIso === null || endIso === null) {
    const rows = host.querySelectorAll(".med-extra-row");
    const last = rows.length ? rows[rows.length - 1] : null;
    const prevStart = last ? (last.querySelector(".f-extra-start")?.value || "") : gv("f-start");
    const prevEnd = last ? (last.querySelector(".f-extra-end")?.value || "") : gv("f-end");
    if (startIso === null) startIso = prevStart;
    if (endIso === null) endIso = prevEnd;
  }
  _medExtraIdx++;
  const row = document.createElement("div");
  row.className = "med-extra-row";
  row.style.cssText = "display:flex;flex-direction:column;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px";
  row.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:11px;color:var(--muted);font-weight:600">Additional status</span>
      <button type="button" class="btn btn-icon btn-danger" title="Remove this status" onclick="this.closest('.med-extra-row').remove()">✕</button>
    </div>
    <div class="form-group"><label>Status</label>
      <select class="f-extra-status" required onchange="medExtraStatusChanged(this)">
        ${medStatusOptionsHtml(status)}
        <option value="__new__">＋ New custom status…</option>
      </select>
    </div>
    <div class="f-extra-custom" style="display:none;flex-direction:column;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px">
      <div class="form-group"><label>New status name</label><input class="f-extra-custom-name" type="text" maxlength="40" placeholder="e.g. Excuse Finger"></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" class="f-extra-custom-participates" style="width:15px;height:15px"> Still participates in conducts</label>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" class="f-extra-custom-save" checked style="width:15px;height:15px"> Save for reuse <span style="color:var(--dim)">(adds it to the dropdowns)</span></label>
    </div>
    <div class="form-row form-row-3">
      <div class="form-group"><label>Start (inclusive)</label><input type="date" class="f-extra-start" value="${escapeAttr(startIso)}" min="2020-01-01" max="2099-12-31" onchange="medExtraRecalcEnd(this)"></div>
      <div class="form-group"><label>Days</label><input type="number" class="f-extra-days" min="1" max="365" step="1" inputmode="numeric" oninput="medExtraRecalcEnd(this)"></div>
      <div class="form-group"><label>End (inclusive)</label><input type="date" class="f-extra-end" value="${escapeAttr(endIso)}" min="2020-01-01" max="2099-12-31"></div>
    </div>`;
  host.appendChild(row);
}

// Reveal a row's custom-status fields only when "＋ New custom status…" is picked.
function medExtraStatusChanged(sel) {
  const wrap = sel.closest(".med-extra-row")?.querySelector(".f-extra-custom");
  if (wrap) wrap.style.display = sel.value === "__new__" ? "flex" : "none";
}

// Feature 32 — Enter saves the medical form even when nothing is focused.
//
// The form is a real <form> with a type=submit button, so Enter from INSIDE any
// field already submits it. The gap is everything else: click a checkbox, or pick
// a recruit from the search box (which blurs), and focus lands on <body> — where
// a <form> ignores Enter entirely and the user is left pressing it at a form that
// looks finished.
//
// Same shape as bindWizardEnterToSave below: ONE listener on the persistent
// #modal-overlay, bound once (the overlay outlives every modal, so binding per
// open would stack listeners), self-gated on the medical form's own DOM being
// what is on screen. That last check is what keeps it inert for the ~30 other
// modals that share the overlay — a stray Enter must not become an app-wide save.
//
// requestSubmit(), NOT submitMedical(): going through the form keeps HTML5
// validation, so an empty required field gets the browser's "please fill in this
// field" flag instead of a silent half-save. (The conduct wizard calls its saver
// directly only because it is a plain <div> with no required fields to honour.)
let _medEnterBound = false;
function bindMedicalEnterToSave() {
  if (_medEnterBound) return;
  _medEnterBound = true;
  document.getElementById("modal-overlay").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (document.getElementById("modal-overlay").classList.contains("hidden")) return;
    const form = document.getElementById("med-form");
    if (!form) return;                            // some other modal owns the overlay
    // The form has no textarea TODAY (Reason is an <input>), so this is a guard
    // against a future one rather than a live case — kept because the failure it
    // prevents (Enter saving instead of inserting a newline) is silent and
    // annoying, and the check is free.
    if (e.target.tagName === "TEXTAREA") return;
    // Focus already inside the form → leave it to the browser's own implicit
    // submission. Doing it ourselves here would double-fire, and would step on
    // personSearchEnter (which preventDefaults Enter in the recruit box to pick
    // the top match rather than submit a half-filled form).
    if (form.contains(e.target)) return;
    e.preventDefault();
    form.requestSubmit();
  });
}

function openMedicalForm(id, prefill) {
  // `prefill` is honoured only when creating (not editing) — used to route
  // appointment bookings through this form pre-set to type MA (Item 17
  // consolidation), mirroring openAppointmentForm's prefill contract.
  // `isEdit` gates the modal chrome (title / edit-hint / Save vs Submit / the
  // hidden entry-id); `e` holds the field values and, for a NEW booking, may be a
  // prefill object (no id) — so chrome must key off isEdit, not the truthiness of e.
  const isEdit = !!id;
  const e = id ? STATE.medical.find(x => x.id === id) : (prefill || null);
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  const startVal = e ? displayDateToISO(e.startDate) || dateVal : todayISO();
  const endVal = e ? displayDateToISO(e.endDate) || "" : "";
  const daysVal = (startVal && endVal) ? daysFromStartEndInclusive(startVal, endVal) : "";
  const selectedStatus = e?.status || "";
  _medExtraIdx = 0;
  bindMedicalEnterToSave();
  // The id is load-bearing, not decoration: bindMedicalEnterToSave uses it both
  // as the "is the medical form the modal on screen?" guard and as the thing it
  // calls requestSubmit() on.
  openModal(isEdit ? "Edit Report Sick Entry" : "Log Report Sick", `
    <form id="med-form" onsubmit="event.preventDefault(); submitMedical(); return false">
      <input type="hidden" id="f-entry-id" value="${isEdit ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${isEdit ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${personSearchBox({ boxId: "med-person", valueId: "f-d4", placeholder: "Search recruit by name / 4D…", selected: e?.d4 || "" })}</div>
        <div class="form-group">
          <label>Visit type</label>
          <select id="f-type" onchange="medTypeChanged(this.value)">
            ${[["", "— (status only / pre-existing)"], ["RSI", "RSI — Report Sick In-camp"], ["RSO", "RSO — Report Sick Out-of-camp"], ["MR", "MR — Medical Review"], ["MA", "MA — Medical Appointment"]]
              .map(([v, l]) => `<option value="${v}" ${v === (e?.type || "") ? "selected" : ""}>${l}</option>`).join("")}
          </select>
          <div style="font-size:10px;color:var(--muted);margin-top:4px">RSI/RSO drive the REPORTING SICK section &amp; URTI split; MR is its own parade-state section (person stays in camp).</div>
        </div>
        <div class="form-row">
          ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
          <!-- MR used to have its own free-text timing input here (mrTiming, spec
               §6 — "PM" was as valid as "1400"). Feature 30.1 needs ONE time
               source across all four visit types so the status suffix can read a
               single field, so MR now shares this HHMM input like everyone else.
               Existing values were moved across by the one-shot
               bravesMigrateMrTiming() in apps-script-Code.gs, which drops (and
               reports) anything that isn't a parseable time. -->
          <div class="form-group" id="f-time-wrap" style="${MED_TIMED_TYPES.includes(e?.type || "") ? "" : "display:none"}">
            <label>Time ${e?.type === "MA" ? "" : "<span style=\"color:var(--dim);font-weight:400\">(optional)</span>"}</label>
            <input id="f-time" type="text" maxlength="10" placeholder="0930" value="${escapeAttr(e?.time)}" onfocus="medTimeLazyFill()">
          </div>
        </div>
        <label id="f-med-ooc-wrap" style="${e?.type === "MA" ? "display:flex" : "display:none"};align-items:center;gap:8px;font-size:12px;color:var(--muted);cursor:pointer;margin:-2px 0 2px">
          <input id="f-med-ooc" type="checkbox" ${e?.outOfCamp ? "checked" : ""} style="width:16px;height:16px;cursor:pointer">
          Out of camp (recruit leaves camp for this appointment) — otherwise OTHERS (IN CAMP)
        </label>
        ${formField("f-reason", "Reason / Purpose", "text", "Fever, sore throat...", `required maxlength="200" value="${escapeAttr(e?.reason)}" oninput="medReasonChanged(this.value)"`)}
        ${formField("f-location", "Location (clinic/hospital if outside)", "text", "e.g. Lim Clinic and Surgery", `maxlength="200" value="${escapeAttr(e?.location)}"`)}
        <div class="form-group" id="f-urti-wrap" style="${(e?.type === "RSI" || e?.type === "RSO") ? "" : "display:none"}">
          <label>URTI classification</label>
          <select id="f-urti">
            ${[["", "Auto-suggest from reason"], ["URTI", "URTI"], ["NON-URTI", "NON-URTI"]]
              .map(([v, l]) => `<option value="${v}" ${v === (e?.urtiType || "") ? "selected" : ""}>${l}</option>`).join("")}
          </select>
          <div style="font-size:10px;color:var(--muted);margin-top:4px">The MO outcome (the parade-state / sick-message "follow up status from MO") is the <strong>Status</strong> below — update it after the MO visit.</div>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select id="f-status" required onchange="medStatusSelChanged(this.value)">
            ${medStatusOptionsHtml(selectedStatus)}
            <option value="__new__">＋ New custom status…</option>
          </select>
        </div>
        <div id="f-custom-wrap" style="display:none;flex-direction:column;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px">
          ${formField("f-custom-name", "New status name", "text", "e.g. Excuse Finger", `maxlength="40"`)}
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="f-custom-participates" style="width:15px;height:15px"> Still participates in conducts <span style="color:var(--dim)">(wizard won't auto-mark as out)</span></label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" id="f-custom-save" checked style="width:15px;height:15px"> Save for reuse <span style="color:var(--dim)">(adds it to this dropdown)</span></label>
          <div style="font-size:10px;color:var(--muted)">Custom statuses are in-camp/restricted and don't get +1/+2 recovery tags.</div>
        </div>
        <div class="form-row form-row-3">
          ${formField("f-start", "Start (inclusive)", "date", "", `value="${startVal}" min="2020-01-01" max="2099-12-31" onchange="medRecalcEndFromDays()"`)}
          ${formField("f-days", "Days", "number", "", `min="1" max="365" step="1" inputmode="numeric" placeholder="e.g. 3" value="${daysVal}" oninput="medRecalcEndFromDays()"`)}
          ${formField("f-end", "End (inclusive)", "date", "", `value="${endVal}" min="2020-01-01" max="2099-12-31" onchange="medSyncDaysFromEnd()"`)}
        </div>
        <div style="font-size:10px;color:var(--muted)">Start and end dates can be left blank for <strong>Pending</strong> (MO outcome unknown) and <strong>NIL</strong> (MO cleared, no status). Required for everything else.</div>
        <div id="f-extra-statuses" style="display:flex;flex-direction:column;gap:8px"></div>
        <button type="button" class="btn" style="font-size:11px;align-self:flex-start" onclick="addMedStatusRow()">＋ Add another status</button>
        <div style="font-size:10px;color:var(--muted)">Use this when the MO gives more than one status for the same visit (e.g. <strong>2D LD</strong> + <strong>4D Excuse RMJ</strong>). Each status keeps its own duration.</div>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save" : "Submit"}</button>
      </div>
    </form>`);
  // Feature 29: Edit opens the whole VISIT, not one of its status rows. The
  // grouped list row offers a single Edit button, so the form has to show
  // everything that row shows — otherwise you open "2D LD + 4D Excuse RMJ",
  // see only the LD, and the Excuse silently survives whatever you do.
  //
  // This is not cosmetic. date / reason / location / type / time are per-visit
  // and submitMedical writes them to every sibling it emits, so editing one row
  // in isolation used to move the visit's date on the primary while leaving the
  // sibling behind on the old one — two rows that still grouped (same d4 +
  // visitId) but disagreed about the day they happened.
  //
  // Matched on d4 + visitId, exactly as groupByVisit does, so the form and the
  // list can never disagree about what belongs to this visit.
  if (isEdit && e && String(e.visitId || "").trim()) {
    const vid = String(e.visitId).trim();
    STATE.medical
      .filter(m => m.d4 === e.d4 && String(m.visitId || "").trim() === vid && m.id !== e.id)
      .forEach(m => addMedStatusRow(m.status || "",
        displayDateToISO(m.startDate) || "", displayDateToISO(m.endDate) || ""));
  }
}
// Reveal the custom-status fields only when "＋ New custom status…" is picked.
function medStatusSelChanged(v) {
  const wrap = document.getElementById("f-custom-wrap");
  if (wrap) wrap.style.display = v === "__new__" ? "flex" : "none";
}
// Visit-type toggle: MR reveals the timing field; RSI/RSO reveal the URTI +
// follow-up fields and default the location to the configured sick location
// (PTMC) when it's still blank — RSO leaves it for manual entry. Item 17: RSI/
// RSO/MA reveal the Time field (and MA the out-of-camp checkbox); the time lazily
// autofills the current HHMM when empty.
// Feature 30.1: the visit types that carry an HHMM `time`. MR joined this set
// when its free-text mrTiming column was retired, so all four visit types now
// read their time from ONE field — which is what lets helpers.js visitSuffix()
// render a status suffix without knowing the visit type.
//
// Deliberately the same set as helpers.js VISIT_SUFFIX_TYPES, and duplicated
// rather than aliased: a top-level `const X = VISIT_SUFFIX_TYPES` would throw at
// load in any test that loads forms.js without helpers.js. Change one, change
// both — test/visit-suffix.test.js pins the helpers copy.
const MED_TIMED_TYPES = ["RSI", "RSO", "MA", "MR"];
function medTypeChanged(v) {
  const urti = document.getElementById("f-urti-wrap");
  if (urti) urti.style.display = (v === "RSI" || v === "RSO") ? "" : "none";
  if (v === "RSI") {
    const loc = document.getElementById("f-location");
    if (loc && !loc.value.trim()) loc.value = (typeof configGet === "function" ? configGet("defaultSickLocation") : "PTMC") || "PTMC";
  }
  const timeWrap = document.getElementById("f-time-wrap");
  if (timeWrap) timeWrap.style.display = MED_TIMED_TYPES.includes(v) ? "" : "none";
  const oocWrap = document.getElementById("f-med-ooc-wrap");
  if (oocWrap) oocWrap.style.display = v === "MA" ? "flex" : "none";
  if (MED_TIMED_TYPES.includes(v)) medTimeLazyFill();
}
// Item 17: fill f-time with the current HHMM only when it is empty (lazy), so we
// never clobber a user-entered/edited time. Called on type-switch and on focus.
function medTimeLazyFill() {
  const el = document.getElementById("f-time");
  if (!el || el.value.trim()) return;
  const now = new Date();
  el.value = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
}
// Live URTI auto-suggest: while the URTI dropdown is on "Auto", mirror the
// classifier's guess into a hint so the commander sees what will be stored.
function medReasonChanged(v) {
  const sel = document.getElementById("f-urti");
  if (!sel || sel.value) return; // only when still on Auto
  // No DOM hint element to update right now; classification is applied at submit.
}

function submitMedical() {
  const editId = +gv("f-entry-id");
  let status = gv("f-status");
  // Resolve a freshly-created custom status: use the typed name as the status,
  // and (optionally) persist it to the reusable list with its participates flag.
  if (status === "__new__") {
    const name = gv("f-custom-name").trim();
    if (!name) { alert("Enter a name for the new custom status."); return; }
    const participates = !!document.getElementById("f-custom-participates")?.checked;
    if (document.getElementById("f-custom-save")?.checked) addCustomStatus(name, participates);
    status = name;
  }
  // Visit-level fields, shared across every sibling status row of this visit
  // (spec §6: type/urtiType/mrTiming are per-visit, not per-status).
  const type = gv("f-type");
  // URTI auto-classification (spec §10.3): only meaningful for RSI/RSO. When the
  // dropdown is left on "Auto", derive from the reason; else honour the choice.
  let urtiType = gv("f-urti");
  if ((type === "RSI" || type === "RSO") && !urtiType) urtiType = classifyURTI(gv("f-reason"));
  if (type !== "RSI" && type !== "RSO") urtiType = "";
  // Item 17 / Feature 30.1: visit-level time (appointment time for MA, review
  // time for MR, optional report-sick time for RSI/RSO) and the MA out-of-camp
  // flag. pad4Time keeps "930" → "0930".
  //
  // MR joined this field in the mrTiming migration. The old free-text mrTiming
  // column is no longer WRITTEN, but it is still emitted as "" below — writeTab
  // derives the sheet's headers from Object.keys(data[0]), so dropping the key
  // from newly-written rows would silently strip the column from the whole
  // pushed Medical sheet, taking every historical value with it. Keeping the
  // blank key preserves the column (and the migration's own audit trail) while
  // guaranteeing nothing new lands in it.
  const time = MED_TIMED_TYPES.includes(type) ? pad4Time(gv("f-time")) : "";
  const outOfCamp = type === "MA" ? !!document.getElementById("f-med-ooc")?.checked : false;

  // Gather the main status plus any "additional status" rows. Each carries its
  // own status + duration; they share the recruit/date/reason/location/type below.
  const statuses = [{ status, startIso: gv("f-start"), endIso: gv("f-end") }];
  for (const row of document.querySelectorAll("#f-extra-statuses .med-extra-row")) {
    let s = row.querySelector(".f-extra-status")?.value || "";
    if (!s) continue; // ignore a blank row rather than erroring
    // Resolve a per-row freshly-created custom status, same as the main field.
    if (s === "__new__") {
      const name = (row.querySelector(".f-extra-custom-name")?.value || "").trim();
      if (!name) { alert("Enter a name for the new custom status."); return; }
      const participates = !!row.querySelector(".f-extra-custom-participates")?.checked;
      if (row.querySelector(".f-extra-custom-save")?.checked) addCustomStatus(name, participates);
      s = name;
    }
    statuses.push({
      status: s,
      startIso: row.querySelector(".f-extra-start")?.value || "",
      endIso: row.querySelector(".f-extra-end")?.value || ""
    });
  }

  const noDurationStatuses = ["Pending", "NIL"];
  for (const st of statuses) {
    if (!st.status) { alert("Select a status for every row (or remove the empty one)."); return; }
    // End date is optional for every status — just remind, don't block save.
    if (!noDurationStatuses.includes(st.status) && type !== "MR" && !st.endIso) { alert(`No end date entered for "${st.status}" — you should input one when it's known.`); }
    if (st.endIso && st.startIso && st.endIso < st.startIso) { alert(`End date cannot be before start date for "${st.status}".`); return; }
  }

  const d4 = gv("f-d4");
  // The recruit is now picked via a search box (hidden input), so it can be
  // left blank — guard here since a hidden input can't be HTML-`required`.
  if (!d4) { alert("Pick a recruit (search by name / 4D)."); return; }
  const date = isoToDisplayDate(gv("f-date"));
  const reason = gv("f-reason");
  const location = gv("f-location").trim();

  // Sibling rows of one multi-status visit share a visitId (spec §6); a single-
  // status visit leaves it blank, preserving any existing group id on edit.
  const prev = editId ? STATE.medical.find(m => m.id === editId) : null;
  const visitId = statuses.length > 1 ? (prev?.visitId || ("v" + nextId())) : (prev?.visitId || "");

  // Feature 29: since the form now LOADS the whole visit, it must SAVE the whole
  // visit. Every sibling except the edited row is replaced by the freshly-emitted
  // records below (which take new ids), so the originals are stale and have to
  // go — without this, re-saving a two-status visit leaves the old Excuse RMJ
  // beside a new identical one, and each subsequent save doubles the row count.
  // Removing a status row in the form therefore also deletes it, which is the
  // behaviour the single Edit button implies.
  const staleSiblings = (editId && prev && String(prev.visitId || "").trim())
    ? STATE.medical.filter(m => m.d4 === prev.d4
        && String(m.visitId || "").trim() === String(prev.visitId).trim()
        && m.id !== editId)
    : [];

  // First status reuses the edited row's id; each extra status becomes a new
  // sibling row. type/urtiType/visitId are per-visit (shared across siblings).
  //
  // bookInDate must survive per STATUS, not just for the edited (i===0) row.
  // Every sibling below i===0 gets a brand-new id on every save (Feature 29,
  // above) — its OLD row is one of staleSiblings and is about to be deleted —
  // so without matching it back to that old row, editing ANY shared visit
  // field (even just fixing a typo in the reason) would silently un-book a
  // sibling status that had been Mark-Present'd on its own. That's exactly the
  // openMedicalForm doc-comment's own example: "2D LD + 4D Excuse RMJ" — if the
  // Excuse RMJ half was already booked in, correcting the LD status's dates
  // must not clear it. Matched by status label against staleSiblings (captured
  // above, before this save); each stale sibling is consumed at most once so
  // two identically-named statuses in one visit don't both claim the same
  // bookInDate.
  const siblingPool = staleSiblings.slice();
  const takeSibling = status => {
    const i = siblingPool.findIndex(s => s.status === status);
    return i < 0 ? null : siblingPool.splice(i, 1)[0];
  };
  const records = statuses.map((st, i) => {
    const priorRow = i === 0 ? prev : takeSibling(st.status);
    return {
      id: (i === 0 && editId) ? editId : nextId(),
      d4, date, reason, location,
      status: st.status,
      startDate: isoToDisplayDate(st.startIso),
      endDate: st.endIso ? isoToDisplayDate(st.endIso) : "",
      type, urtiType, visitId,
      // Written as "" and never populated again — see the comment on `time` above
      // for why the KEY has to survive even though the value never will.
      mrTiming: "",
      // Item 17: visit-level (shared across sibling status rows), like type/urtiType.
      time, outOfCamp,
      // Preserve provenance on edit (don't silently flip a conduct-log row to
      // "manual"); new sibling rows are manual.
      origin: (i === 0 && prev) ? (prev.origin || "manual") : "manual",
      // bookInDate is immutable once stamped by "Mark Present" (PR #65) — see
      // the comment above this block for why priorRow can be a matched sibling,
      // not just prev.
      bookInDate: priorRow ? (priorRow.bookInDate || "") : ""
    };
  });

  records.forEach((rec, i) => {
    if (i === 0 && editId) {
      const idx = STATE.medical.findIndex(m => m.id === editId);
      if (idx >= 0) STATE.medical[idx] = rec; else STATE.medical.push(rec);
    } else {
      STATE.medical.push(rec);
    }
  });

  // Drop the superseded sibling rows AFTER the new ones are in place, so a
  // failure part-way through leaves duplicates (visible, fixable) rather than a
  // visit that lost a status.
  staleSiblings.forEach(s => {
    const i = STATE.medical.findIndex(m => m.id === s.id);
    if (i >= 0) STATE.medical.splice(i, 1);
  });

  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) {
    records.forEach(rec => autoSync("Medical", { type: "upsert", row: rec }));
    // Queued after the upserts on purpose: writes are strictly FIFO per tab, so
    // the replacements land before the originals are removed and the visit is
    // never momentarily statusless on another device mid-sequence.
    staleSiblings.forEach(s => autoSync("Medical", { type: "delete", id: s.id }));
  }
}

function openAttendanceForm(id) {
  const e = id ? STATE.attendance.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  const numVal = v => v !== undefined && v !== null ? ` value="${v}"` : "";
  openModal(e ? "Edit Conduct Attendance" : "Log Conduct Attendance", `
    <form onsubmit="event.preventDefault(); submitAttendance(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        <div class="form-group">
          <label>Conduct</label>
          ${conductPicker({ inputId: "f-conductId", selectedId: e?.conductId || "" })}
        </div>
        <div class="form-row">
          ${formField("f-total", "Total Str", "number", "", `required min="0" max="999" step="1"${numVal(e?.total)}`)}
          ${formField("f-part", "Participating", "number", "", `required min="0" max="999" step="1"${numVal(e?.participating)}`)}
          ${formField("f-lms", "LMS Participation", "number", "", `min="0" max="999" step="1" value="${e?.lms ?? 0}"`)}
        </div>
        <div class="form-row">
          ${formField("f-px", "Status (pre-existing medical status)", "number", "", `required min="0" max="999" step="1" value="${e?.px ?? 0}"`)}
          ${formField("f-fallout", "Fallout", "number", "", `required min="0" max="999" step="1" value="${e?.fallout ?? 0}"`)}
        </div>
        <div class="form-group"><label>Remarks (data inconsistencies, recruit flags)</label><textarea id="f-remarks" maxlength="500" rows="2" style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;resize:vertical" placeholder="e.g. JOHN: HR drop sus; 2 Polar rows missing">${escapeAttr(e?.remarks)}</textarea></div>
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitAttendance() {
  const editId = +gv("f-entry-id");
  const total = +gv("f-total"), part = +gv("f-part"), lms = +gv("f-lms"), px = +gv("f-px"), fallout = +gv("f-fallout");
  const conductId = gv("f-conductId");
  if (!conductId) { alert("Pick a conduct (or create a new one from the dropdown)."); return; }
  if (part > total) { alert("Participating cannot exceed total."); return; }
  if (px + fallout > total) { alert("Status + Fallout cannot exceed total."); return; }
  if (lms > part) { alert("LMS Participation cannot exceed Participating."); return; }
  // Run the row through normalizeAttendance so it carries the four HA columns
  // (participants/periods/currencyTags/source) as empty strings. Without them, if
  // this bare row ever sat at index 0 of a full-tab `replace` push, writeTab would
  // derive the sheet headers from Object.keys(data[0]) and silently strip those
  // columns sheet-wide — wiping the CSV-import HA participation source.
  const entry = normalizeAttendance([{
    id: editId || nextId(),
    date: isoToDisplayDate(gv("f-date")),
    conductId,
    total, participating: part, lms, px, fallout,
    remarks: gv("f-remarks")
  }])[0];
  if (editId) {
    const idx = STATE.attendance.findIndex(a => a.id === editId);
    if (idx >= 0) STATE.attendance[idx] = entry;
  } else {
    STATE.attendance.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("Attendance", { type: "upsert", row: entry });
}

function openIPPTForm(id) {
  // 2.4km run is a duration in mm:ss, not a time of day. Native <input type=time>
  // can't do MM:SS-only, so use two number inputs and combine at submit.
  const e = id ? STATE.ippt.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  const [runMinPrefill, runSecPrefill] = (e?.runTime || "").split(":");
  const numVal = v => v !== undefined && v !== null && v !== "" ? ` value="${v}"` : "";
  // Three rep/time inputs all call recomputeIPPTScore() on change so the
  // score field auto-fills as the user types. Recruit picker too — score
  // depends on age-group, which depends on the picked recruit's age.
  const recalcAttr = `oninput="recomputeIPPTScore()" onchange="recomputeIPPTScore()"`;
  openModal(e ? "Edit IPPT Result" : "Add IPPT Result", `
    <form onsubmit="event.preventDefault(); submitIPPT(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div class="form-group"><label>Recruit</label><span onchange="recomputeIPPTScore()">${rosterSelect("f-d4", true, e?.d4 || "")}</span></div>
        ${formSelect("f-attempt", "Attempt", ["1", "2", "3", "4"], true, e?.attempt ? String(e.attempt) : "")}
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        <div class="form-row">
          <div class="form-group"><label>Push-ups</label><input id="f-pu" type="number" required min="0" max="99" step="1"${numVal(e?.pushups)} ${recalcAttr}></div>
          <div class="form-group"><label>Sit-ups</label><input id="f-su" type="number" required min="0" max="99" step="1"${numVal(e?.situps)} ${recalcAttr}></div>
          <div class="form-group">
            <label>2.4km Run (min:sec)</label>
            <div style="display:flex;gap:6px;align-items:center">
              <input id="f-run-min" type="number" required min="8" max="30" step="1" placeholder="min"${runMinPrefill ? ` value="${+runMinPrefill}"` : ""} ${recalcAttr}>
              <span style="color:var(--muted)">:</span>
              <input id="f-run-sec" type="number" required min="0" max="59" step="1" placeholder="sec"${runSecPrefill ? ` value="${+runSecPrefill}"` : ""} ${recalcAttr}>
            </div>
          </div>
          <div class="form-group">
            <label>Total Score <span style="font-size:10px;color:var(--muted);font-weight:400">(auto, editable)</span></label>
            <input id="f-score" type="number" required min="0" max="100" step="1"${numVal(e?.score)}>
          </div>
        </div>
        <div id="ippt-score-breakdown" style="font-size:11px;color:var(--muted);padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;line-height:1.5;display:none"></div>
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
  // Wire the recruit picker's change handler (rosterSelect returns a plain
  // <select>, so the wrapping <span onchange> above bubble-catches it).
  // Run an initial recompute so the score is pre-filled when editing.
  setTimeout(recomputeIPPTScore, 0);
}

// Reads the current form inputs + the picked recruit's age, computes the
// IPPT score via the scoring tables, pre-fills the Total Score field, and
// renders a live breakdown below the form. Called on every input/change.
// Falls back gracefully when age is missing or run time is incomplete.
function recomputeIPPTScore() {
  const d4 = gv("f-d4");
  const r = STATE.roster.find(x => x.id === d4);
  const age = r?.age;
  const pu = gv("f-pu");
  const su = gv("f-su");
  const min = gv("f-run-min");
  const sec = gv("f-run-sec");
  const runTime = (min !== "" && sec !== "") ? `${+min}:${String(+sec).padStart(2, "0")}` : "";
  const breakdown = document.getElementById("ippt-score-breakdown");
  if (!breakdown) return;

  if (!age) {
    breakdown.style.display = "block";
    breakdown.innerHTML = `<span style="color:var(--orange)">Auto-calc unavailable:</span> recruit's age not on roster — enter score manually.`;
    return;
  }
  const result = calculateIPPTScore(age, pu, su, runTime);
  if (!result) {
    breakdown.style.display = "block";
    breakdown.innerHTML = `Fill in push-ups, sit-ups, and run time to auto-calculate score (age group ${IPPT_AGE_LABELS[ageGroupForIPPT(age) - 1] || "?"}).`;
    return;
  }
  const scoreField = document.getElementById("f-score");
  if (scoreField) scoreField.value = result.total;
  // If every component is 0, surface "YTT" instead of "N/A"/"Fail" so the form
  // matches the table's YTT tagging convention.
  const ytt = isYTT({ pushups: pu, situps: su, runTime });
  const awardColors = { "Gold★": "var(--purple)", Gold: "var(--yellow)", Silver: "var(--accent)", Pass: "var(--green)", Fail: "var(--red)" };
  const displayAward = ytt ? "YTT" : result.award;
  const awardColor = ytt ? "var(--accent)" : (awardColors[result.award] || "var(--muted)");
  breakdown.style.display = "block";
  breakdown.innerHTML = `
    <div>Age group <strong>${result.ageLabel}</strong> · <span>PU ${result.pushupScore}/25 + SU ${result.situpScore}/25 + Run ${result.runScore}/50</span> = <strong style="color:var(--text)">${result.total}/100</strong> <span style="color:${awardColor};font-weight:700;margin-left:6px">${displayAward}</span></div>
    <div style="font-size:10px;color:var(--dim);margin-top:2px">Tiers: ≥61 Pass · ≥75 Silver · ≥85 Gold · ≥90 Gold★ (NDU / Commando / Guards)</div>
  `;
}
function submitIPPT() {
  const editId = +gv("f-entry-id");
  const runMin = +gv("f-run-min"), runSec = +gv("f-run-sec");
  const runTime = `${String(runMin).padStart(2, "0")}:${String(runSec).padStart(2, "0")}`;
  const entry = {
    id: editId || nextId(), d4: gv("f-d4"),
    attempt: +gv("f-attempt"),
    date: isoToDisplayDate(gv("f-date")),
    pushups: +gv("f-pu"), situps: +gv("f-su"),
    runTime,
    score: +gv("f-score")
  };
  if (editId) {
    const idx = STATE.ippt.findIndex(i => i.id === editId);
    if (idx >= 0) STATE.ippt[idx] = entry;
  } else {
    STATE.ippt.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("IPPT", { type: "upsert", row: entry });
}

// Chore 7: openRMForm / submitRM lived here, alongside importRM further down.
// All three went with the Route March tab. Nothing writes STATE.rm any more, but
// it is still loaded, normalized, synced and pushed — see js/state.js and
// js/sync.js — so retiring the UI cost no data and needs no sheet migration.

function openSOCForm(id) {
  const e = id ? STATE.soc.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  const numVal = v => v !== undefined && v !== null && v !== "" ? ` value="${v}"` : "";
  // SOC time is a completion *duration*, not a time of day. Parse any stored
  // value ("mm:ss" or legacy "hh:mm:ss" from the old clock input) into total
  // seconds, then split to minutes + seconds for the two-field duration entry.
  const dur = socDurationParts(e?.time);
  openModal(e ? "Edit SOC Result" : "Add SOC Result", `
    <form onsubmit="event.preventDefault(); submitSOC(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formSelect("f-soc", "SOC #", ["1", "2", "3", "4", "5"], true, e?.socNum ? String(e.socNum) : "")}
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        <div class="form-group"><label>Completion Duration (min : sec)</label>
          <div class="form-row">
            ${formField("f-min", "Minutes", "number", "", `required min="0" max="59" step="1"${numVal(dur.min)}`)}
            ${formField("f-sec", "Seconds", "number", "", `required min="0" max="59" step="1"${numVal(dur.sec)}`)}
          </div>
        </div>
        ${formField("f-avghr", "Avg HR (optional)", "number", "", `min="30" max="220" step="1"${numVal(e?.avgHr)}`)}
        ${formSelect("f-pass", "Pass", [["Y", "Pass"], ["N", "Fail"]], true, e?.pass || "")}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitSOC() {
  const editId = +gv("f-entry-id");
  // Build the canonical "mm:ss" duration string (zero-padded seconds).
  const mins = Math.max(0, parseInt(gv("f-min"), 10) || 0);
  const secs = Math.max(0, Math.min(59, parseInt(gv("f-sec"), 10) || 0));
  const avgHrRaw = gv("f-avghr").trim();   // HR optional → keep "" rather than NaN
  const entry = {
    id: editId || nextId(), d4: gv("f-d4"), socNum: +gv("f-soc"),
    date: isoToDisplayDate(gv("f-date")),
    time: `${mins}:${String(secs).padStart(2, "0")}`,
    avgHr: avgHrRaw === "" ? "" : +avgHrRaw,
    pass: gv("f-pass")
  };
  if (editId) {
    const idx = STATE.soc.findIndex(s => s.id === editId);
    if (idx >= 0) STATE.soc[idx] = entry;
  } else {
    STATE.soc.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) autoSync("SOC", { type: "upsert", row: entry });
}
