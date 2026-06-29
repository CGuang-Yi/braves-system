// Pure, dependency-free date + aggregation helpers. No browser globals, no STATE
// references — so they are unit-testable in isolation (test/calc.test.js) and safe
// to load before helpers.js. Dates are ISO yyyy-mm-dd; arithmetic is tz-safe
// (anchored at local midnight, never toISOString()).
function _isoKey(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
function addDaysISO(iso, n) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + (Number(n) || 0));
  return _isoKey(d);
}
// Inclusive / day-1: Start is Day 1, so End = Start + (Days - 1).
function endDateFromStartAndDays(startIso, days) {
  const n = Number(days);
  if (!startIso || !n || n < 1) return "";
  return addDaysISO(startIso, n - 1);
}
// Inverse: inclusive day count between two ISO dates (>=1), else 0.
function daysFromStartEndInclusive(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const s = new Date(startIso + "T00:00:00"), e = new Date(endIso + "T00:00:00");
  if (isNaN(s) || isNaN(e)) return 0;
  const diff = Math.round((e - s) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

// Average participation. visibleSet === null → company-wide using the stored
// participating/total per conduct (exact back-compat with the old dashboard).
// Otherwise scope by the Present 4D list (numerator) and present+out-in-scope
// (denominator, out = a conductDetail non-participation row), skipping conducts
// with nobody in scope. Returns { pct: 0-100 integer, conducts: included count }.
function scopedParticipation(attendance, conductDetail, visibleSet) {
  if (visibleSet == null) {
    const usable = (attendance || []).filter(function(a) { return Number(a.total) > 0; });
    if (!usable.length) return { pct: 0, conducts: 0 };
    var sum = usable.reduce(function(acc, a) { return acc + (Number(a.participating) / Number(a.total)) * 100; }, 0);
    return { pct: Math.round(sum / usable.length), conducts: usable.length };
  }
  var rows = (attendance || []).filter(function(a) { return a.source === "csv"; });
  // Index conductDetail out-rows by conductId|date for O(1) lookup.
  var outBy = {};
  (conductDetail || []).forEach(function(c) {
    var key = String(c.conductId) + "|" + String(c.date);
    if (!outBy[key]) outBy[key] = new Set();
    outBy[key].add(String(c.d4));
  });
  var total = 0, n = 0;
  rows.forEach(function(a) {
    var present = String(a.participants || "").split(",").map(function(s) { return s.trim(); }).filter(Boolean);
    var scopedPresent = present.filter(function(id) { return visibleSet.has(String(id)); });
    var outs = outBy[String(a.conductId) + "|" + String(a.date)] || new Set();
    var scopedOut = 0;
    outs.forEach(function(id) { if (visibleSet.has(String(id)) && scopedPresent.indexOf(String(id)) === -1) scopedOut++; });
    var involved = scopedPresent.length + scopedOut;
    if (involved === 0) return;
    total += (scopedPresent.length / involved) * 100;
    n++;
  });
  return { pct: n ? Math.round(total / n) : 0, conducts: n };
}

// ── Conduct Dashboard aggregation (Phase 2) ──────────────────────────────────
// The genuine "misses" that accumulate over a training cycle. PXP (present but
// excused) is shown in the stacked-bar composition but is NOT a miss, so it
// never feeds the cumulative buildup line or the headline totals.
const CONDUCT_MISS_TYPES = ["Status", "RSI", "Fallout", "ReportSick"];

// Aggregate conduct misses for the Conduct Dashboard. PURE: the caller pre-
// filters to scope + date window and tags each row with its grouping label
// (section/platoon) and ISO date.
//   rows: [{ dateIso, group, type }]   type ∈ Status|RSI|Fallout|ReportSick|PXP
// Returns:
//   dates        — sorted unique conduct-date axis (ISO)
//   groups       — sorted grouping labels present
//   types        — type order for the stack (misses first, then extras e.g. PXP)
//   cumulative   — { group: [running miss count aligned to dates] }  (buildup line)
//   stacks       — { type:  [count per date] }                       (stacked bars)
//   byType       — { type: total }                                   (tiles)
//   totalMisses  — total genuine misses in window/scope
//   worstType    — the miss type with the highest total (null if none)
function conductBuildup(rows, missTypes) {
  missTypes = missTypes || CONDUCT_MISS_TYPES;
  const missSet = new Set(missTypes);
  rows = (rows || []).filter(function (r) { return r && r.dateIso; });

  const dates = [...new Set(rows.map(function (r) { return r.dateIso; }))].sort();
  const dateIdx = {}; dates.forEach(function (d, i) { dateIdx[d] = i; });
  const groups = [...new Set(rows
    .map(function (r) { return r.group; })
    .filter(function (g) { return g != null && g !== ""; }))].sort();
  const present = [...new Set(rows.map(function (r) { return r.type; }).filter(Boolean))];
  const types = missTypes.filter(function (t) { return present.indexOf(t) !== -1; })
    .concat(present.filter(function (t) { return !missSet.has(t); }));

  const cumulative = {}; groups.forEach(function (g) { cumulative[g] = dates.map(function () { return 0; }); });
  const stacks = {}; types.forEach(function (t) { stacks[t] = dates.map(function () { return 0; }); });
  const byType = {}; types.forEach(function (t) { byType[t] = 0; });
  let totalMisses = 0;

  rows.forEach(function (r) {
    const di = dateIdx[r.dateIso];
    if (r.type && stacks[r.type]) stacks[r.type][di]++;
    if (r.type && byType[r.type] != null) byType[r.type]++;
    if (missSet.has(r.type)) {
      totalMisses++;
      if (r.group != null && cumulative[r.group]) cumulative[r.group][di]++;
    }
  });
  groups.forEach(function (g) {
    let acc = 0;
    cumulative[g] = cumulative[g].map(function (v) { acc += v; return acc; });
  });

  let worstType = null, worstN = -1;
  missTypes.forEach(function (t) { if ((byType[t] || 0) > worstN) { worstN = byType[t] || 0; worstType = t; } });
  if (worstN <= 0) worstType = null;

  return { dates: dates, groups: groups, types: types, cumulative: cumulative, stacks: stacks, byType: byType, totalMisses: totalMisses, worstType: worstType };
}

// Per-conduct participation %, scope-aware — one entry per conduct row (vs.
// scopedParticipation's single average). Same math as scopedParticipation:
// visibleSet == null → company rate from stored participating/total; otherwise
// scoped present ∩ scope over (present + out-in-scope). Each attendance row must
// already carry `dateIso`. Returns [{ conductId, dateIso, pct }] in input order
// (caller sorts + labels).
function perConductParticipation(attendance, conductDetail, visibleSet) {
  const out = [];
  if (visibleSet == null) {
    (attendance || []).forEach(function (a) {
      if (!(Number(a.total) > 0)) return;
      out.push({ conductId: a.conductId, dateIso: a.dateIso, pct: Math.round((Number(a.participating) / Number(a.total)) * 100) });
    });
    return out;
  }
  const outBy = {};
  (conductDetail || []).forEach(function (c) {
    const key = String(c.conductId) + "|" + String(c.date);
    if (!outBy[key]) outBy[key] = new Set();
    outBy[key].add(String(c.d4));
  });
  (attendance || []).forEach(function (a) {
    if (a.source !== "csv") return;
    const present = String(a.participants || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    const scopedPresent = present.filter(function (id) { return visibleSet.has(String(id)); });
    const outs = outBy[String(a.conductId) + "|" + String(a.date)] || new Set();
    let scopedOut = 0;
    outs.forEach(function (id) { if (visibleSet.has(String(id)) && scopedPresent.indexOf(String(id)) === -1) scopedOut++; });
    const involved = scopedPresent.length + scopedOut;
    if (involved === 0) return;
    out.push({ conductId: a.conductId, dateIso: a.dateIso, pct: Math.round((scopedPresent.length / involved) * 100) });
  });
  return out;
}

// Node test export (browser ignores `module`); see js/calc.js consumers below.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { addDaysISO, endDateFromStartAndDays, daysFromStartEndInclusive, scopedParticipation, conductBuildup, perConductParticipation, CONDUCT_MISS_TYPES };
}
