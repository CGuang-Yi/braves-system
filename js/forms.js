// Modal infrastructure, person-detail view, form openers/submitters, and CSV importers.

function openModal(title, html) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  // Reset the wide-modal flag so the next form-style modal isn't oversized.
  document.querySelector(".modal")?.classList.remove("wide");
}

function openPerson(d4) {
  const p = STATE.roster.find(r => r.id === d4); if (!p) return;
  const med = STATE.medical.filter(m => m.d4 === d4);
  const ippts = STATE.ippt.filter(i => i.d4 === d4).sort((a, b) => a.attempt - b.attempt);
  const rms = STATE.rm.filter(r => r.d4 === d4).sort((a, b) => a.rmNum - b.rmNum);
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
      date: x.date, conduct: x.conduct,
      avgHr: avg, maxHr: max, calories: cal, duration: dur,
      efficiency: avg ? +(cal / avg).toFixed(2) : 0,
      intensity:  max ? +((avg / max) * 100).toFixed(1) : 0,
      workload:   avg * dur
    };
  });
  const latest = computed[computed.length - 1];

  let html = `<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${p.id} — ${statusBadge(p.status)}</div>`;
  if (p.conditions) html += `<div style="background:#F8514922;border:1px solid #F8514944;border-radius:6px;padding:8px;margin-bottom:12px;font-size:12px;color:var(--red)">Pre-existing: ${p.conditions}</div>`;

  html += `<div class="stats-row"><div class="stat"><label>RSIs</label><div class="val" style="color:${med.length > 1 ? 'var(--red)' : 'var(--muted)'}">${med.length}</div></div>`;
  html += `<div class="stat"><label>IPPT Best</label><div class="val" style="color:var(--orange)">${ippts.length ? Math.max(...ippts.map(i => +i.score)) : "—"}</div></div>`;
  html += `<div class="stat"><label>RMs</label><div class="val" style="color:var(--teal)">${rms.length}</div></div>`;
  html += `<div class="stat"><label>SOCs</label><div class="val" style="color:var(--purple)">${socs.length}</div></div></div>`;

  if (ippts.length) {
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">IPPT Progression</h4>`;
    html += `<div class="chart-box"><canvas id="person-ippt-chart"></canvas></div>`;
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

function openMedicalForm(id) {
  const e = id ? STATE.medical.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  openModal(e ? "Edit Medical/RSI" : "Report Medical/RSI", `
    <form onsubmit="event.preventDefault(); submitMedical(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        ${formSelect("f-type", "Type", ["RSI", "Injury", "Fallout", "MC", "LD"], true, e?.type || "")}
        ${formField("f-reason", "Reason", "text", "Fever, sore throat...", `required maxlength="200" value="${escapeAttr(e?.reason)}"`)}
        ${formSelect("f-status", "Status", ["", "RSI", "MC", "LD", "RMJ", "Warded", "Pending", "Active"], false, e?.status || "")}
        ${formField("f-missed", "Conducts Missed", "text", "Oregon Circuit...", `maxlength="200" value="${escapeAttr(e?.conductMissed)}"`)}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitMedical() {
  const editId = +gv("f-entry-id");
  const entry = {
    id: editId || nextId(),
    d4: gv("f-d4"),
    date: isoToDisplayDate(gv("f-date")),
    type: gv("f-type"),
    reason: gv("f-reason"),
    status: gv("f-status"),
    conductMissed: gv("f-missed")
  };
  if (editId) {
    const idx = STATE.medical.findIndex(m => m.id === editId);
    if (idx >= 0) STATE.medical[idx] = entry;
  } else {
    STATE.medical.push(entry);
  }
  if (entry.d4 && entry.status) { const r = STATE.roster.find(x => x.id === entry.d4); if (r) r.status = entry.status; }
  saveLocal(); closeModal(); render();
  if (!editId && STATE.apiUrl) API.appendRow("Medical", entry).catch(() => {});
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
        ${formField("f-conduct", "Conduct", "text", "Metabolic Circuit 2", `required maxlength="100" value="${escapeAttr(e?.conduct)}"`)}
        <div class="form-row">
          ${formField("f-total", "Total Str", "number", "", `required min="0" max="999" step="1"${numVal(e?.total)}`)}
          ${formField("f-part", "Participating", "number", "", `required min="0" max="999" step="1"${numVal(e?.participating)}`)}
          ${formField("f-lms", "LMS Participation", "number", "", `min="0" max="999" step="1" value="${e?.lms ?? 0}"`)}
          ${formField("f-px", "PX", "number", "", `required min="0" max="999" step="1" value="${e?.px ?? 0}"`)}
          ${formField("f-rsi", "RSI", "number", "", `required min="0" max="999" step="1" value="${e?.rsi ?? 0}"`)}
          ${formField("f-fallout", "Fallout", "number", "", `required min="0" max="999" step="1" value="${e?.fallout ?? 0}"`)}
          ${formField("f-by", "Submitted By", "text", "", `required maxlength="50" value="${escapeAttr(e?.by)}"`)}
        </div>
        <div class="form-group"><label>Remarks (data inconsistencies, recruit flags)</label><textarea id="f-remarks" maxlength="500" rows="2" style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;resize:vertical" placeholder="e.g. JOHN: HR drop sus; 2 Polar rows missing">${escapeAttr(e?.remarks)}</textarea></div>
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitAttendance() {
  const editId = +gv("f-entry-id");
  const total = +gv("f-total"), part = +gv("f-part"), lms = +gv("f-lms"), px = +gv("f-px"), rsi = +gv("f-rsi"), fallout = +gv("f-fallout");
  if (part > total) { alert("Participating cannot exceed total."); return; }
  if (px + rsi + fallout > total) { alert("PX + RSI + Fallout cannot exceed total."); return; }
  if (lms > part) { alert("LMS Participation cannot exceed Participating."); return; }
  const entry = {
    id: editId || nextId(),
    date: isoToDisplayDate(gv("f-date")),
    conduct: gv("f-conduct"),
    total, participating: part, lms, px, rsi, fallout,
    remarks: gv("f-remarks"),
    by: gv("f-by")
  };
  if (editId) {
    const idx = STATE.attendance.findIndex(a => a.id === editId);
    if (idx >= 0) STATE.attendance[idx] = entry;
  } else {
    STATE.attendance.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (!editId && STATE.apiUrl) API.appendRow("Attendance", entry).catch(() => {});
}

function openIPPTForm(id) {
  // 2.4km run is a duration in mm:ss, not a time of day. Native <input type=time>
  // can't do MM:SS-only, so use two number inputs and combine at submit.
  const e = id ? STATE.ippt.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  const [runMinPrefill, runSecPrefill] = (e?.runTime || "").split(":");
  const numVal = v => v !== undefined && v !== null && v !== "" ? ` value="${v}"` : "";
  openModal(e ? "Edit IPPT Result" : "Add IPPT Result", `
    <form onsubmit="event.preventDefault(); submitIPPT(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formSelect("f-attempt", "Attempt", ["1", "2", "3", "4"], true, e?.attempt ? String(e.attempt) : "")}
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        <div class="form-row">
          ${formField("f-pu", "Push-ups", "number", "", `required min="0" max="99" step="1"${numVal(e?.pushups)}`)}
          ${formField("f-su", "Sit-ups", "number", "", `required min="0" max="99" step="1"${numVal(e?.situps)}`)}
          <div class="form-group">
            <label>2.4km Run (min:sec)</label>
            <div style="display:flex;gap:6px;align-items:center">
              <input id="f-run-min" type="number" required min="8" max="30" step="1" placeholder="min"${runMinPrefill ? ` value="${+runMinPrefill}"` : ""}>
              <span style="color:var(--muted)">:</span>
              <input id="f-run-sec" type="number" required min="0" max="59" step="1" placeholder="sec"${runSecPrefill ? ` value="${+runSecPrefill}"` : ""}>
            </div>
          </div>
          ${formField("f-score", "Total Score", "number", "", `required min="0" max="100" step="1"${numVal(e?.score)}`)}
        </div>
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
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
  if (!editId && STATE.apiUrl) API.appendRow("IPPT", entry).catch(() => {});
}

function openRMForm(id) {
  // f-time is the wall-clock time the march was completed (e.g. 13:45), not a duration.
  const e = id ? STATE.rm.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  const numVal = v => v !== undefined && v !== null && v !== "" ? ` value="${v}"` : "";
  openModal(e ? "Edit Route March Result" : "Add Route March Result", `
    <form onsubmit="event.preventDefault(); submitRM(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formSelect("f-rm", "RM #", ["1", "2", "3", "4", "5", "6"], true, e?.rmNum ? String(e.rmNum) : "")}
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        ${formField("f-time", "Finish Time (hh:mm)", "time", "", `required value="${escapeAttr(e?.time)}"`)}
        <div class="form-row">
          ${formField("f-avghr", "Avg HR", "number", "", `required min="30" max="220" step="1"${numVal(e?.avgHr)}`)}
          ${formField("f-maxhr", "Max HR", "number", "", `required min="30" max="220" step="1"${numVal(e?.maxHr)}`)}
        </div>
        ${formSelect("f-pass", "Pass", [["Y", "Pass"], ["N", "Fail"]], true, e?.pass || "")}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitRM() {
  const editId = +gv("f-entry-id");
  const avgHr = +gv("f-avghr"), maxHr = +gv("f-maxhr");
  if (maxHr < avgHr) { alert("Max HR cannot be lower than Avg HR."); return; }
  const entry = {
    id: editId || nextId(), d4: gv("f-d4"), rmNum: +gv("f-rm"),
    date: isoToDisplayDate(gv("f-date")),
    time: gv("f-time"),
    avgHr, maxHr, pass: gv("f-pass")
  };
  if (editId) {
    const idx = STATE.rm.findIndex(r => r.id === editId);
    if (idx >= 0) STATE.rm[idx] = entry;
  } else {
    STATE.rm.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (!editId && STATE.apiUrl) API.appendRow("RouteMarch", entry).catch(() => {});
}

function openSOCForm(id) {
  const e = id ? STATE.soc.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  const numVal = v => v !== undefined && v !== null && v !== "" ? ` value="${v}"` : "";
  openModal(e ? "Edit SOC Result" : "Add SOC Result", `
    <form onsubmit="event.preventDefault(); submitSOC(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formSelect("f-soc", "SOC #", ["1", "2", "3", "4", "5"], true, e?.socNum ? String(e.socNum) : "")}
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        ${formField("f-time", "Completion Time (hh:mm:ss)", "time", "", `required step="1" min="00:04:00" max="00:30:00" value="${escapeAttr(e?.time)}"`)}
        ${formField("f-avghr", "Avg HR", "number", "", `required min="30" max="220" step="1"${numVal(e?.avgHr)}`)}
        ${formSelect("f-pass", "Pass", [["Y", "Pass"], ["N", "Fail"]], true, e?.pass || "")}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitSOC() {
  const editId = +gv("f-entry-id");
  const entry = {
    id: editId || nextId(), d4: gv("f-d4"), socNum: +gv("f-soc"),
    date: isoToDisplayDate(gv("f-date")),
    time: gv("f-time"),
    avgHr: +gv("f-avghr"),
    pass: gv("f-pass")
  };
  if (editId) {
    const idx = STATE.soc.findIndex(s => s.id === editId);
    if (idx >= 0) STATE.soc[idx] = entry;
  } else {
    STATE.soc.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (!editId && STATE.apiUrl) API.appendRow("SOC", entry).catch(() => {});
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
