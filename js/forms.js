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

  // Commanders never show their 00xx id — surface rank instead. Recruits keep
  // the existing "4D — status" header.
  let html = p.role === "Commander"
    ? `<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${p.rank ? p.rank + " · " : ""}Commander${p.status ? ` — ${statusBadge(p.status)}` : ""}</div>`
    : `<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${p.id} — ${statusBadge(p.status)}</div>`;

  // ── Profile section ──────────────────────────────────
  const bmi = calcBMI(p);
  // 8-digit local numbers display nicer with a space in the middle.
  const fmtPhone = s => { const d = String(s || "").replace(/\D/g, ""); return d.length === 8 ? d.slice(0, 4) + " " + d.slice(4) : (s || ""); };
  const edu = p["highest education level"] || "";
  const moto = p["motorcycle license"] || "";
  const fact = (label, val, color) => `<span style="color:var(--muted)">${label}:</span> <strong style="color:${color || 'var(--text)'}">${val || '—'}</strong>`;

  html += `<div class="card" style="margin-bottom:12px;padding:14px"><h3 style="margin-bottom:10px">Profile</h3>
    <div class="stats-row" style="margin-bottom:10px">
      <div class="stat"><label>Age</label><div class="val">${p.age || '—'}</div></div>
      <div class="stat"><label>Height</label><div class="val">${p.height ? p.height + '<span style="font-size:11px;color:var(--muted)"> cm</span>' : '—'}</div></div>
      <div class="stat"><label>Weight</label><div class="val">${p.weight ? p.weight + '<span style="font-size:11px;color:var(--muted)"> kg</span>' : '—'}</div></div>
      <div class="stat"><label>BMI</label><div class="val" style="color:${bmiColor(bmi)}">${bmi ?? '—'}</div></div>
    </div>
    ${p.phone || p.email ? `<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;margin-bottom:8px">
      ${p.phone ? `<span>📞 <a href="tel:${escapeAttr(String(p.phone).replace(/\D/g, ""))}" style="color:var(--accent);text-decoration:none">${fmtPhone(p.phone)}</a></span>` : ""}
      ${p.email ? `<span>✉ <a href="mailto:${escapeAttr(p.email)}" style="color:var(--accent);text-decoration:none;word-break:break-all">${p.email}</a></span>` : ""}
    </div>` : ""}
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px">
      ${fact("Ration", p.ration)}
      ${fact("Edu", edu)}
      ${fact("Motorcycle", moto || "No")}
    </div>
  </div>`;

  if (p.allergies) html += `<div style="background:#E3B34122;border:1px solid #E3B34144;border-radius:6px;padding:8px;margin-bottom:8px;font-size:12px;color:var(--yellow)"><strong>Allergies:</strong> ${p.allergies}</div>`;
  if (p.msk) html += `<div style="background:#F8514922;border:1px solid #F8514944;border-radius:6px;padding:8px;margin-bottom:12px;font-size:12px;color:var(--red)"><strong>MSK history:</strong> ${p.msk}</div>`;

  // RSIs stat is clickable when there are records — opens an inline patterns
  // panel below the stats strip with day-of-week, status mix, timeline, reasons.
  const rsClickable = med.length > 0;
  html += `<div class="stats-row"><div class="stat" ${rsClickable ? `onclick="toggleReportSickPatterns('${d4}')" style="cursor:pointer" title="Click to see patterns"` : ""}><label>RSIs ${rsClickable ? '<span style="color:var(--dim);font-size:9px">▾ patterns</span>' : ''}</label><div class="val" style="color:${med.length > 1 ? 'var(--red)' : 'var(--muted)'}">${med.length}</div></div>`;
  html += `<div class="stat"><label>IPPT Best</label><div class="val" style="color:var(--orange)">${ippts.length ? Math.max(...ippts.map(i => +i.score)) : "—"}</div></div>`;
  html += `<div class="stat"><label>RMs</label><div class="val" style="color:var(--teal)">${rms.length}</div></div>`;
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
    const cdTypeColor = t => t === "PX" ? "orange" : t === "RSI" ? "red" : t === "Fallout" ? "purple" : "yellow";
    const cdCount = t => cd.filter(d => d.type === t).length;
    html += `<h4 style="font-size:12px;color:var(--muted);margin:16px 0 8px">Conduct Participation History — <span style="color:var(--red)">${cd.length} missed</span> <span style="color:var(--dim);font-weight:400">(${cdCount("PX")} PX · ${cdCount("RSI")} RSI · ${cdCount("Fallout")} Fallout · ${cdCount("ReportSick")} ReportSick)</span></h4>`;
    html += `<div style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="position:sticky;top:0;background:var(--surface2);padding:6px 8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;text-align:left">Date</th><th style="position:sticky;top:0;background:var(--surface2);padding:6px 8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;text-align:left">Conduct</th><th style="position:sticky;top:0;background:var(--surface2);padding:6px 8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Type</th><th style="position:sticky;top:0;background:var(--surface2);padding:6px 8px;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;text-align:left">Reason</th></tr></thead>
        <tbody>
          ${cd.map(d => `<tr style="border-top:1px solid var(--border)"><td style="padding:6px 8px;font-size:11px;color:var(--muted);white-space:nowrap">${d.date}${d.time ? ' <span class="mono" style="color:var(--dim)">' + pad4Time(d.time) + '</span>' : ''}</td><td style="padding:6px 8px;font-size:11px">${d.conduct || ''}</td><td style="padding:6px 8px;text-align:center">${badge(d.type, cdTypeColor(d.type))}</td><td style="padding:6px 8px;font-size:11px;color:var(--text)">${d.reason || ''}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

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
    const today = todayISO();
    // Sort newest-first by startDate (falling back to date logged) so the
    // most recent / currently-relevant entries are at the top.
    const medSorted = med.slice().sort((a, b) => {
      const ai = displayDateToISO(a.startDate || a.date) || "";
      const bi = displayDateToISO(b.startDate || b.date) || "";
      return ai < bi ? 1 : ai > bi ? -1 : 0;
    });
    html += `<h4 style="font-size:12px;color:var(--muted);margin:12px 0 8px">Medical History <span style="color:var(--dim);font-weight:400">(${med.length})</span></h4>`;
    html += medSorted.map(m => {
      const tagInfo = medStatusTag(m, today);
      const todayLabel = tagInfo ? `<span style="margin-left:6px">${medTagBadge(tagInfo.tag)}<span style="color:var(--dim);font-size:10px;margin-left:4px">today</span></span>` : "";
      return `<div style="background:var(--surface2);border-radius:6px;padding:8px 10px;margin-bottom:4px;border:1px solid var(--border);font-size:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span>${m.status ? medTagBadge(m.status) : '<span style="color:var(--muted)">No status</span>'} ${m.reason || ""}</span>
          ${todayLabel}
        </div>
        <div style="color:var(--muted);font-size:11px;margin-top:2px">${medDurationLabel(m)}</div>
      </div>`;
    }).join("");
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
  const statusOrder = ["MC", "Warded", "LD", "RMJ", "Excuse Heavy Load", "Excuse Kneeling", "Excuse Squatting", "Excuse Uniform", "Excuse RMJ", "Pending", "NIL"];
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
    "LD": "#D29922", "RMJ": "#D29922",
    "Excuse Heavy Load": "#E3B341", "Excuse Kneeling": "#E3B341", "Excuse Squatting": "#E3B341", "Excuse Uniform": "#E3B341", "Excuse RMJ": "#E3B341",
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

  const statusBars = statusRows.map(([s, n]) => {
    const pct = Math.round((n / med.length) * 100);
    return `<div style="display:flex;align-items:center;gap:8px;font-size:11px">
      <div style="flex:0 0 110px">${medTagBadge(s)}</div>
      <div style="flex:1;background:var(--surface2);border-radius:3px;height:14px;position:relative;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${statusColor[s] || "var(--accent)"}"></div>
      </div>
      <div class="mono" style="flex:0 0 60px;text-align:right;color:var(--muted)">${n} · ${pct}%</div>
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
          <div style="display:flex;flex-direction:column;gap:5px">${statusBars}</div>
        </div>
      </div>
      ${tlPoints.length ? `<div style="margin-top:14px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Timeline <span style="color:var(--dim);text-transform:none;letter-spacing:0">(first → last, color = status)</span></div>
        <div class="chart-box" style="height:80px"><canvas id="rs-timeline"></canvas></div>
      </div>` : ""}
      ${topReasons.length ? `<div style="margin-top:14px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Top Reasons</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${topReasons.map(r => `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:11px"><span style="color:var(--text)">${r.display}</span> <span class="mono" style="color:var(--accent);font-weight:700;margin-left:4px">×${r.count}</span></div>`).join("")}
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


function openMedicalForm(id) {
  const e = id ? STATE.medical.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  const startVal = e ? displayDateToISO(e.startDate) || dateVal : todayISO();
  const endVal = e ? displayDateToISO(e.endDate) || "" : "";
  const selectedStatus = e?.status || "";
  // Status is an enum drawn from the official parade-state vocabulary. Grouped
  // with optgroups so the form makes the severity tiers visually obvious.
  const statusOptions = MED_STATUS_GROUPS.map(g =>
    `<optgroup label="${g.label}">${g.options.map(o => `<option value="${o}" ${o === selectedStatus ? "selected" : ""}>${o}</option>`).join("")}</optgroup>`
  ).join("");
  openModal(e ? "Edit Report Sick Entry" : "Log Report Sick", `
    <form onsubmit="event.preventDefault(); submitMedical(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formField("f-date", "Date Reported Sick", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        ${formField("f-reason", "Reason", "text", "Fever, sore throat...", `required maxlength="200" value="${escapeAttr(e?.reason)}"`)}
        <div class="form-group">
          <label>Status</label>
          <select id="f-status" required>
            <option value="">Select status...</option>
            ${statusOptions}
          </select>
        </div>
        <div class="form-row">
          ${formField("f-start", "Start (inclusive)", "date", "", `value="${startVal}" min="2020-01-01" max="2099-12-31"`)}
          ${formField("f-end", "End (inclusive)", "date", "", `value="${endVal}" min="2020-01-01" max="2099-12-31"`)}
        </div>
        <div style="font-size:10px;color:var(--muted)">Start and end dates can be left blank for <strong>Pending</strong> (MO outcome unknown) and <strong>NIL</strong> (MO cleared, no status). Required for everything else.</div>
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitMedical() {
  const editId = +gv("f-entry-id");
  const status = gv("f-status");
  const startIso = gv("f-start");
  const endIso = gv("f-end");
  const noDurationStatuses = ["Pending", "NIL"];
  if (!noDurationStatuses.includes(status) && !endIso) { alert("End date is required for all statuses except Pending and NIL."); return; }
  if (endIso && startIso && endIso < startIso) { alert("End date cannot be before start date."); return; }
  const entry = {
    id: editId || nextId(),
    d4: gv("f-d4"),
    date: isoToDisplayDate(gv("f-date")),
    reason: gv("f-reason"),
    status,
    startDate: isoToDisplayDate(startIso),
    endDate: endIso ? isoToDisplayDate(endIso) : ""
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
        <div class="form-group">
          <label>Conduct</label>
          <input id="f-conduct" type="text" list="conduct-options" placeholder="Metabolic Circuit 2" required maxlength="100" value="${escapeAttr(e?.conduct)}">
          <datalist id="conduct-options">${getAllConducts().map(c => `<option value="${escapeAttr(c)}">`).join("")}</datalist>
        </div>
        <div class="form-row">
          ${formField("f-total", "Total Str", "number", "", `required min="0" max="999" step="1"${numVal(e?.total)}`)}
          ${formField("f-part", "Participating", "number", "", `required min="0" max="999" step="1"${numVal(e?.participating)}`)}
          ${formField("f-lms", "LMS Participation", "number", "", `min="0" max="999" step="1" value="${e?.lms ?? 0}"`)}
        </div>
        <div class="form-row">
          ${formField("f-px", "PX (Status personnel)", "number", "", `required min="0" max="999" step="1" value="${e?.px ?? 0}"`)}
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
  if (part > total) { alert("Participating cannot exceed total."); return; }
  if (px + fallout > total) { alert("PX + Fallout cannot exceed total."); return; }
  if (lms > part) { alert("LMS Participation cannot exceed Participating."); return; }
  const entry = {
    id: editId || nextId(),
    date: isoToDisplayDate(gv("f-date")),
    conduct: gv("f-conduct"),
    total, participating: part, lms, px, fallout,
    remarks: gv("f-remarks")
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
function openConductDetailForm(id) {
  const e = id ? STATE.conductDetail.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  openModal(e ? "Edit Conduct Detail" : "Log Conduct Detail", `
    <form onsubmit="event.preventDefault(); submitConductDetail(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
        ${formField("f-time", "Time (optional)", "text", "0730", `maxlength="10" value="${escapeAttr(e?.time)}"`)}
        <div class="form-group">
          <label>Conduct</label>
          <input id="f-conduct" type="text" list="conduct-options" placeholder="Oregon Circuit" required maxlength="100" value="${escapeAttr(e?.conduct)}">
          <datalist id="conduct-options">${getAllConducts().map(c => `<option value="${escapeAttr(c)}">`).join("")}</datalist>
        </div>
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formSelect("f-type", "Type", [["PX", "PX (Status personnel)"], ["Fallout", "Fallout"], ["RSI", "RSI (fallout → report-sick)"], ["ReportSick", "Reported Sick (mid-day)"]], true, e?.type || "")}
        ${formField("f-reason", "Reason", "text", "Sprained ankle / Fever / Shin splint...", `required maxlength="200" value="${escapeAttr(e?.reason)}"`)}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Submit"}</button>
      </div>
    </form>`);
}
function submitConductDetail() {
  const editId = +gv("f-entry-id");
  const entry = {
    id: editId || nextId(),
    date: isoToDisplayDate(gv("f-date")),
    time: pad4Time(gv("f-time")),
    conduct: gv("f-conduct"),
    d4: gv("f-d4"),
    type: gv("f-type"),
    reason: gv("f-reason")
  };
  if (editId) {
    const idx = STATE.conductDetail.findIndex(d => d.id === editId);
    if (idx >= 0) STATE.conductDetail[idx] = entry;
  } else {
    STATE.conductDetail.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (!editId && STATE.apiUrl) API.appendRow("ConductDetail", entry).catch(() => {});
}

function openAppointmentForm(id) {
  const e = id ? STATE.appointments.find(x => x.id === id) : null;
  const dateVal = e ? displayDateToISO(e.date) || todayISO() : todayISO();
  openModal(e ? "Edit Appointment" : "Book Appointment", `
    <form onsubmit="event.preventDefault(); submitAppointment(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div class="form-group"><label>Recruit</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formField("f-reason", "Reason", "text", "Knee specialist review / IPPT retake / Board…", `required maxlength="200" value="${escapeAttr(e?.reason)}"`)}
        <div class="form-row">
          ${formField("f-date", "Date", "date", "", `required value="${dateVal}" min="2020-01-01" max="2099-12-31"`)}
          ${formField("f-time", "Time", "text", "0930", `required maxlength="10" value="${escapeAttr(e?.time)}"`)}
        </div>
        ${formField("f-location", "Location", "text", "MO Office / SAFTI MC / Camp HQ…", `required maxlength="100" value="${escapeAttr(e?.location)}"`)}
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);cursor:pointer">
          <input id="f-resolved" type="checkbox" ${e?.resolved ? "checked" : ""} style="width:16px;height:16px;cursor:pointer">
          Mark as resolved (hides from dashboard + parade state)
        </label>
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Book"}</button>
      </div>
    </form>`);
}
function submitAppointment() {
  const editId = +gv("f-entry-id");
  const entry = {
    id: editId || nextId(),
    d4: gv("f-d4"),
    reason: gv("f-reason"),
    date: isoToDisplayDate(gv("f-date")),
    time: gv("f-time"),
    location: gv("f-location"),
    resolved: document.getElementById("f-resolved")?.checked || false
  };
  entry.time = pad4Time(entry.time);
  if (editId) {
    const idx = STATE.appointments.findIndex(a => a.id === editId);
    if (idx >= 0) STATE.appointments[idx] = entry;
  } else {
    STATE.appointments.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (!editId && STATE.apiUrl) API.appendRow("Appointments", entry).catch(() => {});
}

// Inline tick from the dashboard widget — flips the resolved bit. The
// appointment disappears from dashboard/parade state immediately. To un-
// resolve, edit the entry via the pencil icon (visible while it's still
// in the list) or correct via the sheet.
function toggleAppointmentResolved(id) {
  const a = STATE.appointments.find(x => x.id === id);
  if (!a) return;
  a.resolved = !a.resolved;
  saveLocal(); render();
}

// Lightweight roster-add form scoped to commanders. Recruits are added via
// the Google Sheet directly (their data is sourced from pre-enlistment
// nominal rolls); commanders are added ad-hoc in-app so the user doesn't
// need to touch the sheet just to track their own team.
function openCommanderForm(id) {
  const e = id ? STATE.roster.find(r => r.id === id && r.role === "Commander") : null;
  openModal(e ? "Edit Commander" : "+ Add Commander", `
    <form onsubmit="event.preventDefault(); submitCommander(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px">Commander IDs use the <strong>00xx</strong> range (0001–0099). The ID is administrative — the app only ever shows rank + name.</div>
        <div class="form-row">
          ${formField("f-id", "4D (00xx)", "text", "0001", `required maxlength="4" pattern="00[0-9]{2}" value="${escapeAttr(e?.id)}"${e ? " readonly" : ""}`)}
          ${formField("f-rank", "Rank", "text", "3SG / 2LT / CPT…", `required maxlength="10" value="${escapeAttr(e?.rank)}"`)}
        </div>
        ${formField("f-name", "Name", "text", "Nicholas Eng", `required maxlength="100" value="${escapeAttr(e?.name)}"`)}
        ${formField("f-quota", "Off-in-Lieu Quota (days)", "number", "14", `min="0" max="365" step="1" value="${e?.leaveQuota ?? 14}"`)}
        ${formField("f-phone", "Phone (optional)", "text", "9123 4567", `maxlength="20" value="${escapeAttr(e?.phone)}"`)}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Add Commander"}</button>
      </div>
    </form>`);
}
function submitCommander() {
  const editId = gv("f-entry-id");
  const id = gv("f-id").trim();
  if (!/^00\d{2}$/.test(id)) { alert("Commander ID must be 4 digits in the 00xx range (e.g. 0001)."); return; }
  if (!editId && STATE.roster.some(r => r.id === id)) { alert(`ID ${id} is already taken.`); return; }
  const entry = {
    id,
    name: gv("f-name"),
    rank: gv("f-rank"),
    role: "Commander",
    leaveQuota: +gv("f-quota") || 0,
    phone: gv("f-phone") || "",
    status: "",
    plt: "",
    sect: ""
  };
  if (editId) {
    const idx = STATE.roster.findIndex(r => r.id === editId);
    if (idx >= 0) STATE.roster[idx] = { ...STATE.roster[idx], ...entry };
  } else {
    STATE.roster.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (!editId && STATE.apiUrl) API.appendRow("Roster", entry).catch(() => {});
}

function openLeaveForm(id) {
  const e = id ? STATE.leave.find(x => x.id === id) : null;
  const startVal = e ? displayDateToISO(e.startDate) || todayISO() : todayISO();
  const endVal = e ? displayDateToISO(e.endDate) || todayISO() : todayISO();
  openModal(e ? "Edit Leave/Out Entry" : "Log Leave / Out", `
    <form onsubmit="event.preventDefault(); submitLeave(); return false">
      <input type="hidden" id="f-entry-id" value="${e ? e.id : ""}">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${e ? editHint : ""}
        <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;line-height:1.6">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">📋 Pick the type</div>
          <div><strong>Off-in-Lieu</strong> — counts against the commander's quota.</div>
          <div><strong>Leave / Course / Guard Duty / NDP / Other</strong> — tracked but doesn't decrement the off balance.</div>
        </div>
        <div class="form-group"><label>Person</label>${rosterSelect("f-d4", true, e?.d4 || "")}</div>
        ${formSelect("f-type", "Type", [["Off-in-Lieu", "Off-in-Lieu (counts toward quota)"], ["Leave", "Leave"], ["Night's Out", "Night's Out (same-day, evening off-camp)"], ["Course", "Course"], ["Guard Duty", "Guard Duty"], ["NDP", "NDP"], ["Other", "Other"]], true, e?.type || "")}
        <div class="form-row">
          ${formField("f-start", "Start date", "date", "", `required value="${startVal}" min="2020-01-01" max="2099-12-31" onchange="recalcLeaveDays()"`)}
          ${formField("f-end", "End date", "date", "", `required value="${endVal}" min="2020-01-01" max="2099-12-31" onchange="recalcLeaveDays()"`)}
        </div>
        ${formField("f-days", "Days (auto-calc — editable for half-days)", "number", "1", `required min="0" max="365" step="0.5" value="${e?.days ?? 1}"`)}
        ${formField("f-reason", "Reason / notes", "text", "APSC course / NDP rehearsal / Cleared leave balance…", `maxlength="200" value="${escapeAttr(e?.reason)}"`)}
        <button type="submit" class="btn btn-primary">${e ? "Save" : "Log"}</button>
      </div>
    </form>`);
}
// Auto-recompute the days field from the start/end date inputs on the leave
// form. Half-day edge case: users override after this fires.
function recalcLeaveDays() {
  const s = document.getElementById("f-start"), en = document.getElementById("f-end"), d = document.getElementById("f-days");
  if (!s || !en || !d || !s.value || !en.value) return;
  const diff = Math.round((new Date(en.value) - new Date(s.value)) / 86400000) + 1;
  if (diff > 0) d.value = diff;
}
function submitLeave() {
  const editId = +gv("f-entry-id");
  const startIso = gv("f-start");
  const endIso = gv("f-end");
  if (endIso < startIso) { alert("End date must be on or after start date."); return; }
  const entry = {
    id: editId || nextId(),
    d4: gv("f-d4"),
    type: gv("f-type"),
    startDate: isoToDisplayDate(startIso),
    endDate: isoToDisplayDate(endIso),
    days: +gv("f-days") || 0,
    reason: gv("f-reason") || ""
  };
  if (editId) {
    const idx = STATE.leave.findIndex(l => l.id === editId);
    if (idx >= 0) STATE.leave[idx] = entry;
  } else {
    STATE.leave.push(entry);
  }
  saveLocal(); closeModal(); render();
  if (!editId && STATE.apiUrl) API.appendRow("Leave", entry).catch(() => {});
}

// ─── PARADE STATE + MEDICAL STATUS GENERATORS ─────────
// Compose the three battalion-format WhatsApp messages (First/Last Parade
// State + standalone Medical Status list) from live STATE. The PDS spec
// previously retyped these by hand from chats; now the dashboard generates
// an editable preview that round-trips to clipboard in one tap.

const SEP = "----------------------------------------------------------------";

// "2026-05-20" → "200526" — battalion uses DDMMYY everywhere.
function toDDMMYY(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return m[3] + m[2] + m[1].slice(2);
}

// R/N formatting per chat convention. Commanders are rank+name, no 4D.
// Recruits are "REC <NAME> C<4D>" — the C prefix marks Cougar in the
// battalion-wide parade state.
function paradeRN(d4) {
  const r = STATE.roster.find(x => x.id === d4);
  if (!r) return d4;
  const name = (r.name || "").toUpperCase();
  if (r.role === "Commander") return [r.rank, name].filter(Boolean).join(" ");
  // Strip any existing C prefix on the id before re-adding it — some sheets
  // store the recruit 4D as "C1415" already, which would round-trip to
  // "CC1415" otherwise.
  const bareId = String(r.id).replace(/^C/i, "");
  return `REC ${name} C${bareId}`;
}

// Duration label per chat samples ("Duration: 180526 - 010626"). Pending /
// NIL records have no end date; emit a single-day note instead.
function paradeDuration(record) {
  const s = displayDateToISO(record.startDate || record.date || "");
  const e = displayDateToISO(record.endDate || "");
  if (s && e) return `${toDDMMYY(s)} - ${toDDMMYY(e)}`;
  if (s) return toDDMMYY(s);
  return "";
}

// Day count for the status line ("Status: 5D MC"). Inclusive of both ends.
function paradeStatusLabel(record) {
  const s = displayDateToISO(record.startDate || "");
  const e = displayDateToISO(record.endDate || "");
  if (!record.status) return "";
  if (!s || !e) return record.status;
  const days = Math.round((new Date(e) - new Date(s)) / 86400000) + 1;
  return days > 0 ? `${days}D ${record.status}` : record.status;
}

// Group medical entries by d4 so a person with multiple active statuses
// appears under one S/N with stacked sub-entries (matches the BENJAMIN
// C4110 sample in the chat).
function buildMedicalSection(label, dateIso, statusList) {
  const matches = STATE.medical.filter(m =>
    medStatusActive(m, dateIso) && statusList.includes(m.status)
  );
  const byD4 = {};
  matches.forEach(m => { (byD4[m.d4] = byD4[m.d4] || []).push(m); });
  const peopleIds = Object.keys(byD4);

  if (!peopleIds.length) {
    return `${label}:\n\nS/N:\nR/N:\nReason:`;
  }

  const blocks = peopleIds.map((d4, idx) => {
    const records = byD4[d4];
    const sn = String(idx + 1).padStart(2, "0");
    const rn = paradeRN(d4);
    // Use the first record's reason as the headline — multi-status entries
    // typically share an underlying cause (per BENJAMIN sample).
    const reason = records[0].reason || "";

    if (records.length === 1) {
      const r = records[0];
      return `S/N: ${sn}\nR/N: ${rn}\nReason: ${reason}\nStatus: ${paradeStatusLabel(r)}\nDuration: ${paradeDuration(r)}`;
    }
    // Multi-status: stack numbered Status + Duration pairs under one R/N.
    const subStatuses = records.map((r, i) =>
      `${i + 1}. ${paradeStatusLabel(r)}\nDuration: ${paradeDuration(r)}`
    ).join("\n");
    return `S/N: ${sn}\nR/N: ${rn}\nReason: ${reason}\nStatus received:\n${subStatuses}`;
  });

  return `${label}: ${String(peopleIds.length).padStart(2, "0")}\n\n${blocks.join("\n\n")}`;
}

// Parse an appointment's time field to "minutes since midnight" so we can
// compare it against the parade time. Handles "0930", "09:30", "0700-2100"
// (uses the END of a range — appt still ongoing if range covers parade
// time). Returns Infinity for unparseable input so the row is shown by
// default (safer than hiding it silently).
function apptEndMinutes(timeStr) {
  const s = String(timeStr || "").replace(/\s/g, "");
  const range = s.match(/(\d{1,4}):?(\d{0,2})\s*[-–]\s*(\d{1,4}):?(\d{0,2})/);
  if (range) {
    const hh = String(range[3]).padStart(4, "0").slice(0, 2);
    const mm = (range[4] || String(range[3]).padStart(4, "0").slice(2, 4)).padStart(2, "0");
    return parseInt(hh, 10) * 60 + parseInt(mm, 10);
  }
  const single = s.match(/(\d{3,4})/);
  if (single) {
    const padded = single[1].padStart(4, "0");
    return parseInt(padded.slice(0, 2), 10) * 60 + parseInt(padded.slice(2, 4), 10);
  }
  return Infinity;
}

function paradeTimeMinutes(timeStr) {
  const padded = String(timeStr || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  return parseInt(padded.slice(0, 2), 10) * 60 + parseInt(padded.slice(2, 4), 10);
}

function buildAppointmentSection(dateIso, paradeTime) {
  const paradeMins = paradeTimeMinutes(paradeTime);
  const todays = STATE.appointments
    .filter(a => !a.resolved)
    .filter(a => displayDateToISO(a.date) === dateIso)
    .filter(a => apptEndMinutes(a.time) >= paradeMins);
  if (!todays.length) return `MEDICAL APPT:\n\nS/N:\nR/N:\nReason:\nLocation:\nDate:\nTime:`;
  const blocks = todays.map((a, idx) => {
    const sn = String(idx + 1).padStart(2, "0");
    return `S/N: ${sn}\nR/N: ${paradeRN(a.d4)}\nReason: ${a.reason || ""}\nLocation: ${a.location || ""}\nDate: ${toDDMMYY(displayDateToISO(a.date))}\nTime: ${pad4Time(a.time) || ""}`;
  });
  return `MEDICAL APPT: ${String(todays.length).padStart(2, "0")}\n\n${blocks.join("\n\n")}`;
}

function buildOthersSection(dateIso) {
  const active = STATE.leave.filter(l => {
    const s = displayDateToISO(l.startDate);
    const e = displayDateToISO(l.endDate);
    return s && e && s <= dateIso && dateIso <= e;
  });
  if (!active.length) return `OTHERS:\n\nS/N:\nR/N:\nReason:`;
  const blocks = active.map((l, idx) => {
    const sn = String(idx + 1).padStart(2, "0");
    // Reason = leave type + optional free text, so the section reads like
    // the chat's "Guard Duty" / "APSC in Gedong till 24th April" entries.
    const reasonParts = [l.type, l.reason].filter(Boolean);
    return `S/N: ${sn}\nR/N: ${paradeRN(l.d4)}\nReason: ${reasonParts.join(" — ")}`;
  });
  return `OTHERS: ${String(active.length).padStart(2, "0")}\n\n${blocks.join("\n\n")}`;
}

// Strength block — TOTAL is the entire roster (recruits + commanders);
// CURRENT is TOTAL minus anyone away today (active MC/Warded + any leave
// covering the date). Per-platoon and commander lines break the count out.
function buildStrengthBlock(dateIso) {
  const all = STATE.roster;
  const recruits = all.filter(r => r.role !== "Commander");
  const commanders = all.filter(r => r.role === "Commander");

  // Anyone away from camp today — physically not present.
  const attcD4s = new Set(STATE.medical
    .filter(m => medStatusActive(m, dateIso) && (m.status === "MC" || m.status === "Warded"))
    .map(m => m.d4));
  const othersD4s = new Set(STATE.leave
    .filter(l => {
      const s = displayDateToISO(l.startDate);
      const e = displayDateToISO(l.endDate);
      return s && e && s <= dateIso && dateIso <= e;
    })
    .map(l => l.d4));
  const isAway = r => attcD4s.has(r.id) || othersD4s.has(r.id);

  // Per-platoon recruit breakdown.
  const recruitPlatoons = {};
  recruits.forEach(r => {
    const p = getPlt(r) || "?";
    (recruitPlatoons[p] = recruitPlatoons[p] || { total: 0, away: 0 }).total++;
    if (isAway(r)) recruitPlatoons[p].away++;
  });
  const pltKeys = Object.keys(recruitPlatoons).filter(k => k !== "?").sort();
  const pltLines = pltKeys.map(p => {
    const { total, away } = recruitPlatoons[p];
    return `PLATOON ${p}: ${total - away}/${total}`;
  }).join("\n");

  const totalAway = all.filter(isAway).length;
  const cmdAway = commanders.filter(isAway).length;

  return [
    `TOTAL STRENGTH: ${all.length}`,
    `CURRENT STRENGTH: ${all.length - totalAway}`,
    pltLines,
    `COMMANDERS: ${commanders.length - cmdAway}/${commanders.length}`
  ].filter(Boolean).join("\n");
}

function generateParadeStateText(type, dateIso, time) {
  const dateStr = toDDMMYY(dateIso);
  const header = (type === "FP" ? "FIRST" : "LAST") + " PARADE STATE";
  const sections = [
    buildStrengthBlock(dateIso),
    buildMedicalSection("ATTC", dateIso, ["MC", "Warded"]),
    buildMedicalSection("REPORT SICK", dateIso, ["Pending"]),
    buildMedicalSection("MEDICAL STATUS", dateIso, ["LD", "RMJ", "Excuse Heavy Load", "Excuse Kneeling", "Excuse Squatting", "Excuse Uniform", "Excuse RMJ"]),
    buildAppointmentSection(dateIso, time),
    buildOthersSection(dateIso)
  ];
  return `COUGAR COMPANY\n${header}\nDATE: ${dateStr} @ ${time}\n\n${SEP}\n\n${sections.join(`\n\n${SEP}\n\n`)}\n\n${SEP}`;
}

function generateMedicalStatusText(dateIso, time) {
  const dateStr = toDDMMYY(dateIso);
  const heading = `${dateStr}(latest version as of ${dateStr} @${time})`;
  const body = buildMedicalSection("MEDICAL STATUS", dateIso, ["LD", "RMJ", "Excuse Heavy Load", "Excuse Kneeling", "Excuse Squatting", "Excuse Uniform", "Excuse RMJ"]);
  return `${heading}\n\n${body}`;
}

function openReportModal(type) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const defaultDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultTime = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const titleLabel = type === "FP" ? "First Parade State"
    : type === "LP" ? "Last Parade State"
    : "Medical Status List";

  openModal("Generate " + titleLabel, `
    <form onsubmit="event.preventDefault(); regenerateReport('${type}'); return false">
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px">
          Adjust date/time → tap <strong>Regenerate</strong>. The textarea is editable for last-minute tweaks (e.g. "latest version as of…", manual corrections). Tap <strong>Copy to Clipboard</strong> when ready and paste into WhatsApp.
        </div>
        <div class="form-row">
          ${formField("rep-date", "Date", "date", "", `value="${defaultDate}" required`)}
          ${formField("rep-time", "Time (HHMM)", "text", "0700", `value="${defaultTime}" maxlength="4" pattern="[0-9]{4}" required`)}
        </div>
        <button type="submit" class="btn">↻ Regenerate</button>
        <textarea id="rep-text" rows="20" spellcheck="false" style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.45;resize:vertical;white-space:pre"></textarea>
        <button type="button" id="rep-copy-btn" class="btn btn-success" onclick="copyReportToClipboard()">📋 Copy to Clipboard</button>
      </div>
    </form>
  `);
  // Stash the report type so regenerate from the date/time onchange knows
  // which composer to call.
  document.getElementById("rep-text").dataset.type = type;
  regenerateReport(type);
}

function regenerateReport(type) {
  const dateIso = gv("rep-date");
  const time = gv("rep-time") || "0700";
  const text = type === "MED"
    ? generateMedicalStatusText(dateIso, time)
    : generateParadeStateText(type, dateIso, time);
  document.getElementById("rep-text").value = text;
}

async function copyReportToClipboard() {
  const ta = document.getElementById("rep-text");
  const btn = document.getElementById("rep-copy-btn");
  const text = ta.value;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "✓ Copied!";
      setTimeout(() => { btn.textContent = original; }, 1800);
    }
  } catch {
    // Fallback: select all in the textarea so the user can manually Cmd+C.
    ta.focus(); ta.select();
    alert("Copy blocked — text is selected, press Cmd+C / Ctrl+C to copy.");
  }
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
    if (d.conductDetail) STATE.conductDetail = d.conductDetail;
    if (d.appointments) STATE.appointments = d.appointments;
    if (d.leave) STATE.leave = d.leave;
    saveLocal(); render();
  } catch (err) { alert("Import failed: " + err.message); } };
  reader.readAsText(input.files[0]); input.value = "";
}
