// Modal infrastructure, person-detail view, form openers/submitters, and CSV importers.

function openModal(title, html) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

function openPerson(d4) {
  const p = STATE.roster.find(r => r.id === d4); if (!p) return;
  const med = STATE.medical.filter(m => m.d4 === d4);
  const ippts = STATE.ippt.filter(i => i.d4 === d4).sort((a, b) => a.attempt - b.attempt);
  const rms = STATE.rm.filter(r => r.d4 === d4).sort((a, b) => a.rmNum - b.rmNum);
  const socs = STATE.soc.filter(s => s.d4 === d4).sort((a, b) => a.socNum - b.socNum);

  let html = `<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${p.id} — P${p.plt}S${p.sect} — ${statusBadge(p.status)}</div>`;
  if (p.conditions) html += `<div style="background:#F8514922;border:1px solid #F8514944;border-radius:6px;padding:8px;margin-bottom:12px;font-size:12px;color:var(--red)">Pre-existing: ${p.conditions}</div>`;

  html += `<div class="stats-row"><div class="stat"><label>RSIs</label><div class="val" style="color:${med.length > 1 ? 'var(--red)' : 'var(--muted)'}">${med.length}</div></div>`;
  html += `<div class="stat"><label>IPPT Best</label><div class="val" style="color:var(--orange)">${ippts.length ? Math.max(...ippts.map(i => +i.score)) : "—"}</div></div>`;
  html += `<div class="stat"><label>RMs</label><div class="val" style="color:var(--teal)">${rms.length}</div></div>`;
  html += `<div class="stat"><label>SOCs</label><div class="val" style="color:var(--purple)">${socs.length}</div></div></div>`;

  if (ippts.length) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">IPPT Progression</h4>`;
    html += `<canvas id="person-ippt-chart" height="140"></canvas>`;
    html += ippts.map(i => `<span class="badge badge-accent" style="margin:2px">#${i.attempt}: ${i.score} ${awardBadge(i.score)}</span>`).join("");
  }
  if (rms.length) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">Route March</h4><div style="display:flex;gap:8px;flex-wrap:wrap">`;
    html += rms.map(r => `<div style="background:var(--surface2);border-radius:6px;padding:8px 12px;border:1px solid var(--border);text-align:center"><div style="font-size:10px;color:var(--muted)">RM ${r.rmNum}</div><div class="mono" style="font-size:16px;font-weight:700;color:var(--teal)">${r.time}</div></div>`).join("");
    html += `</div>`;
  }
  if (socs.length) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">SOC</h4><div style="display:flex;gap:8px;flex-wrap:wrap">`;
    html += socs.map(s => `<div style="background:var(--surface2);border-radius:6px;padding:8px 12px;border:1px solid var(--border);text-align:center"><div style="font-size:10px;color:var(--muted)">SOC ${s.socNum}</div><div class="mono" style="font-size:16px;font-weight:700;color:var(--purple)">${s.time}</div></div>`).join("");
    html += `</div>`;
  }
  if (med.length) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">Medical History</h4>`;
    html += med.map(m => `<div style="background:var(--surface2);border-radius:6px;padding:6px 10px;margin-bottom:4px;border:1px solid var(--border);font-size:12px"><span style="color:var(--muted)">${m.date}</span> ${typeBadge(m.type)} ${m.reason} ${m.status ? `<span style="color:var(--muted)">— ${m.status}</span>` : ""}</div>`).join("");
  }

  openModal(p.name, html);

  // Chart needs to be created after modal contents are in the DOM
  setTimeout(() => {
    const canvas = document.getElementById("person-ippt-chart");
    if (canvas && ippts.length) {
      new Chart(canvas, {
        type: "line",
        data: { labels: ippts.map(i => "#" + i.attempt), datasets: [{ data: ippts.map(i => +i.score), borderColor: "#D29922", backgroundColor: "#D2992233", fill: true, tension: .3, pointRadius: 5 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, grid: { color: "#30363D" } }, x: { grid: { color: "#30363D" } } } }
      });
    }
  }, 100);
}

// ─── FORM OPENERS + SUBMITTERS ─────────────────────────

function openMedicalForm() {
  openModal("Report Medical/RSI", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4")}</div>
      ${formField("f-date", "Date", "text", "17 May")}
      ${formSelect("f-type", "Type", ["RSI", "Injury", "Fallout", "MC", "LD"])}
      ${formField("f-reason", "Reason", "text", "Fever, sore throat...")}
      ${formSelect("f-status", "Status", ["", "RSI", "MC", "LD", "RMJ", "Warded", "Pending", "Active"])}
      ${formField("f-missed", "Conducts Missed", "text", "Oregon Circuit...")}
      <button class="btn btn-primary" onclick="submitMedical()">Submit</button>
    </div>`);
}
function submitMedical() {
  const entry = { id: nextId(), d4: gv("f-d4"), date: gv("f-date"), type: gv("f-type"), reason: gv("f-reason"), status: gv("f-status"), conductMissed: gv("f-missed") };
  STATE.medical.push(entry);
  if (entry.d4 && entry.status) { const r = STATE.roster.find(x => x.id === entry.d4); if (r) r.status = entry.status; }
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) API.appendRow("Medical", entry).catch(() => {});
}

function openAttendanceForm() {
  openModal("Log Conduct Attendance", `
    <div style="display:flex;flex-direction:column;gap:10px">
      ${formField("f-date", "Date", "text", "17 May")}
      ${formField("f-conduct", "Conduct", "text", "Metabolic Circuit 2")}
      <div class="form-row">
        ${formField("f-total", "Total Str", "number")}
        ${formField("f-part", "Participating", "number")}
        ${formField("f-px", "PX", "number")}
        ${formField("f-rsi", "RSI", "number")}
        ${formField("f-fallout", "Fallout", "number")}
        ${formField("f-by", "Submitted By")}
      </div>
      <button class="btn btn-primary" onclick="submitAttendance()">Submit</button>
    </div>`);
}
function submitAttendance() {
  const entry = { id: nextId(), date: gv("f-date"), conduct: gv("f-conduct"), total: +gv("f-total"), participating: +gv("f-part"), px: +gv("f-px"), rsi: +gv("f-rsi"), fallout: +gv("f-fallout"), by: gv("f-by") };
  STATE.attendance.push(entry);
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) API.appendRow("Attendance", entry).catch(() => {});
}

function openIPPTForm() {
  openModal("Add IPPT Result", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4")}</div>
      ${formSelect("f-attempt", "Attempt", ["1", "2", "3", "4"])}
      ${formField("f-date", "Date", "text", "26 May")}
      <div class="form-row">
        ${formField("f-pu", "Push-ups", "number")}
        ${formField("f-su", "Sit-ups", "number")}
        ${formField("f-run", "2.4km (mm:ss)", "text", "12:30")}
        ${formField("f-score", "Total Score", "number")}
      </div>
      <button class="btn btn-primary" onclick="submitIPPT()">Submit</button>
    </div>`);
}
function submitIPPT() {
  const entry = { id: nextId(), d4: gv("f-d4"), attempt: +gv("f-attempt"), date: gv("f-date"), pushups: +gv("f-pu"), situps: +gv("f-su"), runTime: gv("f-run"), score: +gv("f-score") };
  STATE.ippt.push(entry);
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) API.appendRow("IPPT", entry).catch(() => {});
}

function openRMForm() {
  openModal("Add Route March Result", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4")}</div>
      ${formSelect("f-rm", "RM #", ["1", "2", "3", "4", "5", "6"])}
      ${formField("f-date", "Date")}
      ${formField("f-time", "Completion Time", "text", "1:15:30")}
      <div class="form-row">
        ${formField("f-avghr", "Avg HR", "number")}
        ${formField("f-maxhr", "Max HR", "number")}
      </div>
      ${formSelect("f-pass", "Pass", [["Y", "Pass"], ["N", "Fail"]])}
      <button class="btn btn-primary" onclick="submitRM()">Submit</button>
    </div>`);
}
function submitRM() {
  const entry = { id: nextId(), d4: gv("f-d4"), rmNum: +gv("f-rm"), date: gv("f-date"), time: gv("f-time"), avgHr: +gv("f-avghr"), maxHr: +gv("f-maxhr"), pass: gv("f-pass") };
  STATE.rm.push(entry);
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) API.appendRow("RouteMarch", entry).catch(() => {});
}

function openSOCForm() {
  openModal("Add SOC Result", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4")}</div>
      ${formSelect("f-soc", "SOC #", ["1", "2", "3", "4", "5"])}
      ${formField("f-date", "Date")}
      ${formField("f-time", "Completion Time", "text", "7:30")}
      ${formField("f-avghr", "Avg HR", "number")}
      ${formSelect("f-pass", "Pass", [["Y", "Pass"], ["N", "Fail"]])}
      <button class="btn btn-primary" onclick="submitSOC()">Submit</button>
    </div>`);
}
function submitSOC() {
  const entry = { id: nextId(), d4: gv("f-d4"), socNum: +gv("f-soc"), date: gv("f-date"), time: gv("f-time"), avgHr: +gv("f-avghr"), pass: gv("f-pass") };
  STATE.soc.push(entry);
  saveLocal(); closeModal(); render();
  if (STATE.apiUrl) API.appendRow("SOC", entry).catch(() => {});
}

// ─── CSV IMPORTERS ─────────────────────────────────────

function importIPPT(input) {
  Papa.parse(input.files[0], { header: true, skipEmptyLines: true, complete: r => {
    const missing = checkCols(r.meta.fields, ["4D", "Score"]);
    if (missing.length) { alert("CSV missing required columns: " + missing.join(", ") + "\n\nExpected: 4D, Attempt, Date, Push-ups, Sit-ups, 2.4km, Score"); return; }
    r.data.forEach(row => STATE.ippt.push({
      id: nextId(), d4: col(row, "4D", "id"), attempt: colNum(row, "Attempt", "#", "attempt"),
      date: col(row, "Date", "date"), pushups: colNum(row, "Push-ups", "Pushups", "PU", "push-ups"),
      situps: colNum(row, "Sit-ups", "Situps", "SU", "sit-ups"), runTime: col(row, "2.4km", "Run", "RunTime", "run time", "2.4"),
      score: colNum(row, "Score", "Total", "Total Score", "score")
    }));
    saveLocal(); render(); alert(`Imported ${r.data.length} IPPT rows`);
  } }); input.value = "";
}
function importRM(input) {
  Papa.parse(input.files[0], { header: true, skipEmptyLines: true, complete: r => {
    const missing = checkCols(r.meta.fields, ["4D"]);
    if (missing.length) { alert("CSV missing required column: 4D\n\nExpected: 4D, RM, Date, Time, Avg HR, Max HR, Pass"); return; }
    r.data.forEach(row => STATE.rm.push({
      id: nextId(), d4: col(row, "4D", "id"), rmNum: colNum(row, "RM", "RM #", "RM#", "rmNum", "Route March"),
      date: col(row, "Date", "date"), time: col(row, "Time", "Completion Time", "time", "Duration"),
      avgHr: colNum(row, "Avg HR", "AvgHR", "avg_hr", "Average HR", "Heart Rate"),
      maxHr: colNum(row, "Max HR", "MaxHR", "max_hr", "Maximum HR"),
      pass: col(row, "Pass", "pass", "Result", "Status") || "Y"
    }));
    saveLocal(); render(); alert(`Imported ${r.data.length} Route March rows`);
  } }); input.value = "";
}
function importPolar(input) {
  Papa.parse(input.files[0], { header: true, skipEmptyLines: true, complete: r => {
    const missing = checkCols(r.meta.fields, ["4D"]);
    if (missing.length) { alert("CSV missing required column: 4D"); return; }
    r.data.forEach(row => STATE.polar.push({
      id: nextId(), d4: col(row, "4D", "id"), conduct: col(row, "Conduct", "Activity", "conduct", "Exercise"),
      date: col(row, "Date", "date"), avgHr: colNum(row, "Avg HR", "AvgHR", "avg_hr", "Average HR"),
      maxHr: colNum(row, "Max HR", "MaxHR", "max_hr"), minHr: colNum(row, "Min HR", "MinHR", "min_hr"),
      calories: colNum(row, "Calories", "Cal", "calories", "Energy"),
      trainingLoad: colNum(row, "Training Load", "TrainingLoad", "training_load", "Load"),
      duration: colNum(row, "Duration", "duration", "Time", "Dur"),
      distance: colNum(row, "Distance", "distance", "Dist")
    }));
    saveLocal(); render(); alert(`Imported ${r.data.length} Polar rows`);
  } }); input.value = "";
}
function importBackup(input) {
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
    saveLocal(); render();
  } catch (err) { alert("Import failed: " + err.message); } };
  reader.readAsText(input.files[0]); input.value = "";
}
