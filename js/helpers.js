// Pure utility functions — name lookups, ID generation, CSV column resolving,
// badge HTML, file exporters, form-field builders.

const getName = d4 => STATE.roster.find(r => r.id === d4)?.name || d4;

// Short sequential IDs instead of timestamps
let _idCounter = Math.floor(Math.random() * 9000) + 1000;
const nextId = () => ++_idCounter;

// Smart CSV column resolver — case-insensitive, handles aliases
function col(row, ...names) {
  for (const n of names) {
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === n.toLowerCase()) return row[key];
    }
  }
  return "";
}
function colNum(row, ...names) { return +(col(row, ...names)) || 0; }

// Validate CSV has required columns, return missing ones
function checkCols(headers, required) {
  const lower = headers.map(h => h.trim().toLowerCase());
  return required.filter(r => !lower.some(h => h === r.toLowerCase()));
}

const getAward = s => { if (!s || s === 0) return "N/A"; if (s >= 85) return "Gold"; if (s >= 75) return "Silver"; if (s >= 61) return "Pass"; return "Fail"; };
const badge = (text, cls) => `<span class="badge badge-${cls}">${text}</span>`;
const statusBadge = s => badge(s, s === "Active" ? "green" : s === "Warded" ? "red" : "orange");
const typeBadge = t => badge(t, t === "RSI" ? "orange" : t === "Injury" ? "red" : "yellow");
const awardBadge = s => { const a = getAward(s); const c = { Gold: "yellow", Silver: "accent", Pass: "green", Fail: "red", "N/A": "accent" }; return badge(a, c[a] || "accent"); };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

function exportCSV(data, filename) {
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function exportJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function rosterSelect(id = "form-d4") {
  return `<select id="${id}" style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px"><option value="">Select...</option>${STATE.roster.map(r => `<option value="${r.id}">${r.id} ${r.name}</option>`).join("")}</select>`;
}
function formField(id, label, type = "text", placeholder = "") {
  return `<div class="form-group"><label>${label}</label><input id="${id}" type="${type}" placeholder="${placeholder}"></div>`;
}
function formSelect(id, label, options) {
  return `<div class="form-group"><label>${label}</label><select id="${id}">${options.map(o => typeof o === "string" ? `<option value="${o}">${o}</option>` : `<option value="${o[0]}">${o[1]}</option>`).join("")}</select></div>`;
}
const gv = id => document.getElementById(id)?.value || "";
