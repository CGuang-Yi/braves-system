// View layer. render() dispatches to a per-tab function which fills #content.
// Each tab function may also (re)create charts; old chart instances are
// destroyed at the top of render() to avoid Chart.js canvas reuse errors.

function render() {
  Object.values(STATE.charts).forEach(c => c.destroy());
  STATE.charts = {};

  const el = document.getElementById("content");
  const active = STATE.roster.filter(r => r.status === "Active").length;
  document.getElementById("str-counter").textContent = `Str: ${STATE.roster.length} | Active: ${active}`;

  switch (STATE.nav) {
    case "dashboard": renderDashboard(el); break;
    case "roster": renderRoster(el); break;
    case "attendance": renderAttendance(el); break;
    case "medical": renderMedical(el); break;
    case "ippt": renderIPPT(el); break;
    case "rm": renderRM(el); break;
    case "soc": renderSOC(el); break;
    case "polar": renderPolar(el); break;
    case "sync": renderSync(el); break;
    default: el.innerHTML = "";
  }
}

function renderDashboard(el) {
  // Empty-state guard: until the user pulls from the sheet, the dashboard
  // has nothing meaningful to show.
  if (!STATE.roster.length) {
    el.innerHTML = `
      <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Company Strength Board</h2>
      <div class="card empty-state">
        <p style="margin-bottom:12px">No roster data loaded yet.</p>
        <p>Open <strong>Sync &amp; I/O</strong> in the sidebar to configure your Google Sheet connection and pull the roster.</p>
      </div>`;
    return;
  }

  const active = STATE.roster.filter(r => r.status === "Active").length;
  const avgPart = STATE.attendance.length ? Math.round(STATE.attendance.reduce((a, c) => a + (c.participating / c.total * 100), 0) / STATE.attendance.length) : 0;

  el.innerHTML = `
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Company Strength Board</h2>
    <div class="stats-row">
      <div class="stat"><label>Total Str</label><div class="val">${STATE.roster.length}</div></div>
      <div class="stat"><label>Active</label><div class="val" style="color:var(--green)">${active}</div></div>
      <div class="stat"><label>MC/LD/RSI</label><div class="val" style="color:var(--red)">${STATE.roster.length - active}</div></div>
      <div class="stat"><label>Med Events</label><div class="val" style="color:var(--orange)">${STATE.medical.length}</div></div>
      <div class="stat"><label>Avg Part.</label><div class="val" style="color:var(--accent)">${avgPart}%</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>Status Breakdown</h3><canvas id="chart-status" height="200"></canvas></div>
      <div class="card"><h3>Participation Trend</h3><canvas id="chart-participation" height="200"></canvas></div>
    </div>
    <h3 style="font-size:13px;color:var(--muted);margin-bottom:8px">Non-Active Personnel</h3>
    <div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>Plt</th><th>Status</th><th>Conditions</th><th>Notes</th></tr></thead><tbody>
    ${STATE.roster.filter(r => r.status !== "Active").map(r => `<tr onclick="openPerson('${r.id}')" style="cursor:pointer"><td class="mono" style="font-weight:700;color:var(--accent)">${r.id}</td><td style="text-align:left">${r.name}</td><td>${r.plt}</td><td>${statusBadge(r.status)}</td><td style="text-align:left">${r.conditions || ""}</td><td style="text-align:left">${r.notes || ""}</td></tr>`).join("")}
    </tbody></table></div>`;

  const statusCounts = {};
  STATE.roster.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
  STATE.charts.status = new Chart(document.getElementById("chart-status"), {
    type: "doughnut",
    data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: Object.keys(statusCounts).map(s => s === "Active" ? "#3FB950" : s === "Warded" ? "#F85149" : s === "RMJ" ? "#E3B341" : "#D29922") }] },
    options: { plugins: { legend: { position: "right", labels: { color: "#8B949E", font: { size: 11 } } } } }
  });

  STATE.charts.participation = new Chart(document.getElementById("chart-participation"), {
    type: "bar",
    data: { labels: STATE.attendance.map(a => a.conduct?.slice(0, 12)), datasets: [{ data: STATE.attendance.map(a => pct(a.participating, a.total)), backgroundColor: "#58A6FF44", borderColor: "#58A6FF", borderWidth: 1 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { min: 80, max: 100, grid: { color: "#30363D" }, ticks: { color: "#8B949E" } }, x: { grid: { display: false }, ticks: { color: "#8B949E", font: { size: 9 } } } } }
  });
}

function renderRoster(el) {
  const rsiCount = {};
  STATE.medical.forEach(m => { rsiCount[m.d4] = (rsiCount[m.d4] || 0) + 1; });
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">Master Roster (${STATE.roster.length})</h2>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="exportCSV(STATE.roster,'roster.csv')">Export CSV</button>
        <button class="btn btn-success" onclick="pushTab('Roster',STATE.roster)">Push to Sheet</button>
      </div>
    </div>
    ${STATE.roster.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>Plt</th><th>Sect</th><th>Status</th><th>Conditions</th><th>RSIs</th></tr></thead><tbody>
    ${STATE.roster.map(r => `<tr onclick="openPerson('${r.id}')" style="cursor:pointer"><td class="mono" style="font-weight:700;color:var(--accent)">${r.id}</td><td style="text-align:left">${r.name}</td><td>${r.plt}</td><td>${r.sect}</td><td>${statusBadge(r.status)}</td><td style="text-align:left">${r.conditions || ""}</td><td style="color:${(rsiCount[r.id] || 0) > 1 ? 'var(--red)' : 'var(--muted)'}">${rsiCount[r.id] || 0}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">No roster loaded. Pull from sheet in Sync &amp; I/O.</div>`}`;
}

function renderAttendance(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">Conduct Attendance</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-success" onclick="pushTab('Attendance',STATE.attendance)">Push to Sheet</button>
        <button class="btn btn-primary" onclick="openAttendanceForm()">+ Log</button>
      </div>
    </div>
    ${STATE.attendance.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Conduct</th><th>Total</th><th>Part.</th><th>PX</th><th>RSI</th><th>Fallout</th><th>Rate</th><th>By</th></tr></thead><tbody>
    ${STATE.attendance.map(a => { const r = pct(a.participating, a.total); return `<tr><td>${a.date}</td><td style="text-align:left">${a.conduct}</td><td>${a.total}</td><td>${a.participating}</td><td style="color:${a.px > 0 ? 'var(--orange)' : 'var(--muted)'}">${a.px}</td><td style="color:${a.rsi > 0 ? 'var(--red)' : 'var(--muted)'}">${a.rsi}</td><td style="color:${a.fallout > 0 ? 'var(--red)' : 'var(--muted)'}">${a.fallout}</td><td style="font-weight:700;color:${r >= 95 ? 'var(--green)' : 'var(--orange)'}">${r}%</td><td>${a.by || ""}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty-state">No attendance records yet.</div>`}`;
}

function renderMedical(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">Medical &amp; Injury Log</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-success" onclick="pushTab('Medical',STATE.medical)">Push to Sheet</button>
        <button class="btn btn-primary" onclick="openMedicalForm()">+ Report</button>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><label>Total</label><div class="val" style="color:var(--red)">${STATE.medical.length}</div></div>
      <div class="stat"><label>RSI</label><div class="val" style="color:var(--orange)">${STATE.medical.filter(m => m.type === "RSI").length}</div></div>
      <div class="stat"><label>Injury</label><div class="val" style="color:var(--red)">${STATE.medical.filter(m => m.type === "Injury").length}</div></div>
      <div class="stat"><label>Pending</label><div class="val" style="color:var(--purple)">${STATE.medical.filter(m => m.status === "Pending").length}</div></div>
    </div>
    ${STATE.medical.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>4D</th><th>Name</th><th>Type</th><th>Reason</th><th>Status</th><th>Missed</th></tr></thead><tbody>
    ${STATE.medical.map(m => `<tr onclick="openPerson('${m.d4}')" style="cursor:pointer"><td>${m.date}</td><td class="mono" style="font-weight:700;color:var(--accent)">${m.d4}</td><td style="text-align:left">${getName(m.d4)}</td><td>${typeBadge(m.type)}</td><td style="text-align:left">${m.reason}</td><td>${badge(m.status || "-", m.status === "Pending" ? "purple" : "orange")}</td><td style="text-align:left">${m.conductMissed || ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">No medical records yet.</div>`}`;
}

function renderIPPT(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">IPPT Tracker</h2>
      <div style="display:flex;gap:8px">
        <label class="btn" style="cursor:pointer">Import CSV<input type="file" accept=".csv" onchange="importIPPT(this)" style="display:none"></label>
        <button class="btn btn-success" onclick="pushTab('IPPT',STATE.ippt)">Push to Sheet</button>
        <button class="btn btn-primary" onclick="openIPPTForm()">+ Add</button>
      </div>
    </div>
    ${STATE.ippt.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>#</th><th>Date</th><th>PU</th><th>SU</th><th>2.4km</th><th>Score</th><th>Award</th></tr></thead><tbody>
    ${STATE.ippt.map(i => `<tr><td class="mono" style="font-weight:700">${i.d4}</td><td style="text-align:left">${getName(i.d4)}</td><td>${i.attempt}</td><td>${i.date}</td><td>${i.pushups}</td><td>${i.situps}</td><td>${i.runTime}</td><td style="font-weight:700;font-size:15px">${i.score}</td><td>${awardBadge(i.score)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">No IPPT data yet. Add results or import CSV.</div>`}`;
}

function renderRM(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">Route March Tracker</h2>
      <div style="display:flex;gap:8px">
        <label class="btn" style="cursor:pointer">Import CSV<input type="file" accept=".csv" onchange="importRM(this)" style="display:none"></label>
        <button class="btn btn-success" onclick="pushTab('RouteMarch',STATE.rm)">Push to Sheet</button>
        <button class="btn btn-primary" onclick="openRMForm()">+ Add</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
    ${[{ n: 1, d: "3KM" }, { n: 2, d: "3KM" }, { n: 3, d: "3KM" }, { n: 4, d: "4KM" }, { n: 5, d: "8KM" }, { n: 6, d: "12KM" }].map(rm => `<div style="flex:1;min-width:90px;background:var(--surface2);border-radius:8px;padding:10px 12px;border:1px solid ${STATE.rm.some(r => r.rmNum == rm.n) ? 'var(--green)' : 'var(--border)'};text-align:center"><div style="font-size:16px;font-weight:700;color:${STATE.rm.some(r => r.rmNum == rm.n) ? 'var(--green)' : 'var(--muted)'}">RM ${rm.n}</div><div style="font-size:10px;color:var(--muted)">${rm.d}</div><div style="font-size:10px;color:var(--dim)">${STATE.rm.filter(r => r.rmNum == rm.n).length} entries</div></div>`).join("")}
    </div>
    ${STATE.rm.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>RM</th><th>Date</th><th>Time</th><th>Avg HR</th><th>Max HR</th><th>Pass</th></tr></thead><tbody>
    ${STATE.rm.map(r => `<tr><td class="mono" style="font-weight:700">${r.d4}</td><td style="text-align:left">${getName(r.d4)}</td><td>${r.rmNum}</td><td>${r.date}</td><td class="mono" style="font-weight:700">${r.time}</td><td>${r.avgHr}</td><td>${r.maxHr}</td><td>${badge(r.pass === "Y" ? "PASS" : "FAIL", r.pass === "Y" ? "green" : "red")}</td></tr>`).join("")}
    </tbody></table></div>` : ""}`;
}

function renderSOC(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">SOC Tracker</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-success" onclick="pushTab('SOC',STATE.soc)">Push to Sheet</button>
        <button class="btn btn-primary" onclick="openSOCForm()">+ Add</button>
      </div>
    </div>
    ${STATE.soc.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>SOC#</th><th>Date</th><th>Time</th><th>Avg HR</th><th>Pass</th></tr></thead><tbody>
    ${STATE.soc.map(s => `<tr><td class="mono">${s.d4}</td><td style="text-align:left">${getName(s.d4)}</td><td>${s.socNum}</td><td>${s.date}</td><td class="mono" style="font-weight:700">${s.time}</td><td>${s.avgHr}</td><td>${badge(s.pass === "Y" ? "PASS" : "FAIL", s.pass === "Y" ? "green" : "red")}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">No SOC data yet.</div>`}`;
}

function renderPolar(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">Polar Flow Data</h2>
      <div style="display:flex;gap:8px">
        <label class="btn btn-primary" style="cursor:pointer">Import Polar CSV<input type="file" accept=".csv" onchange="importPolar(this)" style="display:none"></label>
        <button class="btn btn-success" onclick="pushTab('PolarFlow',STATE.polar)">Push to Sheet</button>
      </div>
    </div>
    <div class="card"><h3>Expected CSV Columns</h3><code class="mono" style="font-size:11px;color:var(--accent)">4D, Conduct, Date, Avg HR, Max HR, Min HR, Calories, Training Load, Recovery, Duration, Distance</code></div>
    ${STATE.polar.length ? `<div class="table-wrap"><table><thead><tr><th>4D</th><th>Name</th><th>Conduct</th><th>Date</th><th>Avg HR</th><th>Max HR</th><th>Cal</th><th>Load</th><th>Dur</th></tr></thead><tbody>
    ${STATE.polar.map(p => `<tr><td class="mono">${p.d4}</td><td style="text-align:left">${getName(p.d4)}</td><td style="text-align:left">${p.conduct}</td><td>${p.date}</td><td style="color:${+p.avgHr > 160 ? 'var(--red)' : +p.avgHr > 140 ? 'var(--orange)' : 'var(--green)'}">${p.avgHr}</td><td>${p.maxHr}</td><td>${p.calories}</td><td>${p.trainingLoad}</td><td>${p.duration}m</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-state">No Polar data. Import a CSV.</div>`}`;
}
