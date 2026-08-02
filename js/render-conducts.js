// Polar Flow, the conduct dashboard, the Conducts registry view, and Heat Acclimatisation.
//
// Split out of the original monolithic render.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

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

// Feature 20 — Class Progression export. The rows are stashed when the card is
// built (see renderConductDashboard) and cleared when it is not, so the button
// can never export a previous series' numbers: navigating away or switching back
// to "All conducts" skips the card, which nulls this.
let _conductExportData = null;
function exportConductProgression() {
  if (!_conductExportData) return;
  const d = _conductExportData;
  const slug = String(d.series || "all").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  downloadCSVText(conductProgressionCSV(d.rows, d.held, d.partByD4, d.series),
    exportFileName(`class-progression-${slug}`, "csv"));
}

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
  const _resolvedClasses = resolveConductClasses(STATE.conducts || []);
  const seriesGroups = {};          // classKey → { ids:Set, count, manual }
  const numById = {};               // conductId → ordinal within its class (makeup-resolved)
  (STATE.conducts || []).forEach(c => {
    const key = _resolvedClasses.keyById[String(c.id)];
    numById[c.id] = _resolvedClasses.seqById[String(c.id)];
    if (!key) return;
    const g = seriesGroups[key] || (seriesGroups[key] = { ids: new Set(), count: 0, manual: false });
    g.ids.add(c.id); g.count++;
    if ((c.className || "").trim() || c.makeupFor) g.manual = true;
  });
  const bases = Object.keys(seriesGroups).sort();
  const seriesIds = (_conductSeries && seriesGroups[_conductSeries]) ? seriesGroups[_conductSeries].ids : null;
  const inSeries = id => !seriesIds || seriesIds.has(id);
  const keepDate = disp => inWin(disp);            // window applies in all modes (incl. class mode)
  const numOf = id => numById[id] != null ? numById[id] : conductClassSeq({ name: conductName(id) });

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
  // Feature 20: drop any stashed export payload up front. The branch below sets
  // it again if (and only if) it builds the progression card, so switching back
  // to "All conducts" can't leave the previous series' rows exportable.
  _conductExportData = null;
  if (seriesIds) {
    // Held instances + who attended — drawn from the windowed class attendance
    // (attnWin), so the progression frontier/position respect the date window too.
    const presentByConduct = {};
    attnWin.forEach(a => {
      presentByConduct[a.conductId] = new Set(parseParticipantIds(a.participants));
    });
    // Makeup crediting (progression ONLY — never participation %): a conduct with
    // makeupFor=A credits everyone present at it as present at instance A, so a made-up
    // miss reads as on-track. Makeup SOURCES may sit outside the selected class (so they
    // are absent from attnWin) — pull their present-sets from full attendance, honouring
    // only the date window (keepDate), then union sources into targets via creditMakeups.
    const makeupMap = buildMakeupMap(STATE.conducts);
    const makeupSources = new Set();
    Object.keys(makeupMap).forEach(t => makeupMap[t].forEach(s => makeupSources.add(s)));
    (STATE.attendance || []).forEach(a => {
      if (!makeupSources.has(a.conductId)) return;
      if (!keepDate(a.date)) return;
      const set = presentByConduct[a.conductId] || (presentByConduct[a.conductId] = new Set());
      parseParticipantIds(a.participants).forEach(id => set.add(id));
    });
    const creditedPresent = creditMakeups(presentByConduct, makeupMap);
    // Held = class instances that actually ran in-window — one with real
    // attendance data or a tracked miss (loggedIds). An empty placeholder
    // attendance row (no participants, no misses) is excluded so it can't inflate
    // the company frontier or every recruit's completion denominator.
    const held = (STATE.conducts || [])
      .filter(c => seriesIds.has(c.id) && loggedIds.has(c.id))
      .map(c => ({ conductId: c.id, num: numById[c.id] }));
    const recruitIds = filteredRoster().map(r => r.id);
    const prog = conductProgress(held, creditedPresent, recruitIds);
    // Per-person participation % over the selected class + window ("added-in" rule):
    // present / (conducts the member was in the participant list of OR logged absent for).
    const partByD4 = personParticipation(attnWin, STATE.conductDetail || [], seriesIds);
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
    // Feature 20: stash what the export needs, rather than making the button
    // handler recompute the whole progression. Reset on every render of this
    // card, so an export always matches the filter / series / window currently
    // on screen — including the sort, since `rows` is already screen-ordered.
    _conductExportData = { rows, held: prog.held, partByD4, series: _conductSeries };
    progressionHTML = `<div class="card" style="margin-top:10px">
      <h3 style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>Class Progression — ${escapeHTML(_conductSeries)} <span style="font-weight:400;color:var(--dim);font-size:11px">(company frontier: ${frontier} · ${prog.held.length} held)</span></span>
        <button class="btn" style="font-size:11px;font-weight:400" onclick="exportConductProgression()" title="Download exactly these rows, in this order, as CSV">⤓ Export CSV</button>
      </h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${isFilterActive() ? filterLabel() : "Whole company"} — each member's latest attended instance, gaps below it (missed), and how far behind the frontier they are. Click a row to open the member.</div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th style="text-align:left">Name</th><th>Current</th><th>Done</th><th title="Present ÷ conducts added into (this class, this window)">Part%</th><th style="text-align:left">Missed</th><th style="text-align:left">Status</th></tr></thead><tbody>
        ${rows.map(p => { const pp = partByD4[String(p.d4)] || { present: 0, addedIn: 0, pct: null }; const partCell = pp.pct == null ? `<span style="color:var(--dim)">—</span>` : `${pp.pct}% <span style="color:var(--dim);font-size:10px">(${pp.present}/${pp.addedIn})</span>`; return `<tr onclick="openPerson('${p.d4}')" style="cursor:pointer"><td class="mono" style="font-weight:700;color:var(--accent)">${displayId(p.d4)}</td><td style="text-align:left">${escapeHTML(displayPersonLabel(p.d4))}</td><td>${curCell(p)}</td><td>${p.completed}/${prog.held.length}</td><td>${partCell}</td><td style="text-align:left;color:${p.missed.length ? "var(--red)" : "var(--dim)"}">${p.missed.length ? p.missed.map(n => "#" + n).join(", ") : "—"}</td><td style="text-align:left">${statusCell(p)}</td></tr>`; }).join("")}
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
      ${bases.map(b => { const g = seriesGroups[b]; return `<option value="${escapeAttr(b)}" ${b === _conductSeries ? "selected" : ""}>${escapeHTML(b)}${g.count > 1 ? ` (${g.count})` : ""}${g.manual ? " ·manual" : ""}</option>`; }).join("")}
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
      <div class="card" style="margin-top:10px"><h3>Cumulative Conduct-Miss Buildup <span style="font-weight:400;color:var(--dim);font-size:11px">(running total by ${groupBy} · original misses; makeups don't rewrite history)</span></h3><div class="chart-box" style="height:220px"><canvas id="cd-cumulative"></canvas></div></div>
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
  if (!isAdminRole()) {
    el.innerHTML = `<div class="card empty-state"><h2 style="font-size:18px;margin-bottom:8px">🏷️ Conduct ID</h2>
      <p>This area is restricted to <strong>admin</strong> accounts.</p></div>`;
    return;
  }
  const rows = [...STATE.conducts].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const _regResolved = resolveConductClasses(STATE.conducts);
  const totalUsage = rows.reduce((s, c) => s + countConductUsage(c.id).total, 0);
  const orphanedCount = (arr) => arr.filter(r => r.conductId !== undefined && !STATE.conducts.find(c => c.id === r.conductId)).length;
  const orphans = orphanedCount(STATE.attendance) + orphanedCount(STATE.polar) + orphanedCount(STATE.conductDetail);
  const anyRecordsWithConductId = STATE.attendance.some(r => r.conductId) || STATE.polar.some(r => r.conductId) || STATE.conductDetail.some(r => r.conductId);
  const emptyRegistryWithUsage = rows.length === 0 && anyRecordsWithConductId;
  const classNames = [...new Set(STATE.conducts.map(c => (c.className || "").trim()).filter(Boolean))].sort();
  const classDatalist = `<datalist id="conduct-class-names">${classNames.map(n => `<option value="${escapeAttr(n)}"></option>`).join("")}</datalist>`;

  el.innerHTML = `
    ${classDatalist}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:700">Conduct ID Registry <span style="color:var(--muted);font-weight:400;font-size:13px">${rows.length} entries · ${totalUsage} record${totalUsage === 1 ? "" : "s"}</span></h2>
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
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th style="text-align:left">Name</th><th style="text-align:left">Class</th><th title="Order within the class">Seq</th><th style="text-align:left">Makeup for</th><th>Attendance</th><th>Polar</th><th>Detail</th><th>Total</th><th></th></tr></thead><tbody>
      ${rows.map(c => {
        const u = countConductUsage(c.id);
        const mergeOpts = rows.filter(o => o.id !== c.id).map(o => `<option value="${o.id}">→ ${escapeAttr(o.name)}</option>`).join("");
        return `<tr>
          <td class="mono" style="color:var(--muted);font-size:11px">${c.id}</td>
          <td style="text-align:left;font-weight:600">${escapeAttr(c.name)}</td>
          <td style="text-align:left">
            ${c.makeupFor
              ? `<input type="text" value="${escapeAttr(_regResolved.keyById[String(c.id)] || "")}" disabled title="Inherited from the conduct this makes up for" style="width:120px;font-size:11px;padding:3px 6px;background:var(--surface);border:1px dashed var(--border);color:var(--muted);border-radius:3px">`
              : `<input type="text" list="conduct-class-names" value="${escapeAttr(c.className || "")}" placeholder="—" onchange="setConductClass('${c.id}', this.value)" style="width:120px;font-size:11px;padding:3px 6px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px">`}
          </td>
          <td>
            ${c.makeupFor
              ? `<input type="number" value="${_regResolved.seqById[String(c.id)] || ''}" disabled title="Inherited slot from the conduct this makes up for" style="width:52px;font-size:11px;padding:3px 4px;background:var(--surface);border:1px dashed var(--border);color:var(--muted);border-radius:3px">`
              : `<input type="number" min="0" step="1" value="${(c.className || '').trim() ? (c.classSeq || 0) : ''}" ${(c.className || '').trim() ? '' : 'disabled'} placeholder="auto" onchange="setConductClassSeq('${c.id}', this.value)" style="width:52px;font-size:11px;padding:3px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px" title="${(c.className || '').trim() ? 'Order within the class' : 'Set a class first'}">`}
          </td>
          <td style="text-align:left">
            <select onchange="setConductMakeupFor('${c.id}', this.value)" style="font-size:10px;padding:2px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px" title="Attending this conduct credits attendance for the selected instance in the Conduct Dashboard">
              <option value="">— none —</option>
              ${rows.filter(o => o.id !== c.id).map(o => `<option value="${o.id}" ${c.makeupFor === o.id ? "selected" : ""}>→ ${escapeAttr(o.name)}</option>`).join("")}
            </select>
          </td>
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
            const last = ha.lastActivity ? isoToDisplayDate(ha.lastActivity) : '<span style="color:var(--muted)">—</span>';
            // A lapsed recruit's bars show live re-qualification progress (the
            // fresh open window) instead of the historical completion still
            // sitting in .periods; everyone else shows .periods as normal. This
            // applies to Double as well — it is no longer gated off for lapsed
            // people, so it has to agree with the Single/Expanded columns beside it.
            const lapsed = ha.overallStatus === "Lapsed";
            const barVal = t => lapsed ? (t?.currentWindowPeriods || 0) : (t?.periods || 0);
            const dbl = !ha.doubleEligible
              ? `<span style="font-size:10px;color:var(--muted)">🔒 ${ha.singleStatus === "Single HA Complete" || ha.overallStatus.includes("Double") ? "ineligible" : "locked"}</span>`
              : cell(barVal(ha.doubleTrack), 13, "#388BFD");
            const curr = ha.currency && ha.currency.lapsed
              ? `<span style="color:var(--red)">lapsed ${ha.currency.lapseDateIso ? isoToDisplayDate(ha.currency.lapseDateIso) : ""}</span>`
              : (ha.currency && ha.currency.deadlineIso ? `<span style="color:var(--muted)">by ${isoToDisplayDate(ha.currency.deadlineIso)}</span>` : "—");
            return `<tr onclick="openPerson('${r.id}')" style="cursor:pointer">
              <td class="mono" style="font-weight:700;color:var(--accent)">${displayId(r.id)}</td>
              <td style="text-align:left">${escapeHTML(displayPersonLabel(r.id))}</td>
              <td>${personPlatoon(r) || "—"}${personSection(r) ? " · " + personSection(r) : ""}</td>
              <td><span class="badge" style="background:${c}22;color:${c};border:1px solid ${c}44;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:600">${ha.overallStatus}</span></td>
              <td style="text-align:left">${cell(barVal(ha.single), 10, "#2DD4BF")}</td>
              <td style="text-align:left">${cell(barVal(ha.expanded), 14, "#D29922")}</td>
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
