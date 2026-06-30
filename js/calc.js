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

// Single canonical parser for the stored participant CSV (one place so the
// format — delimiter, trimming, blank-skipping — has a single definition).
// Accepts the attendance row's raw `participants` string (or any CSV string).
function parseParticipantIds(participants) {
  return String(participants == null ? "" : participants)
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

// Index conductDetail out-rows by "conductId|date" → Set(d4) for O(1) lookup.
// Shared by scopedParticipation + perConductParticipation so a caller that needs
// both can build the index once and pass it in (avoids re-walking conductDetail).
function conductOutByIndex(conductDetail) {
  var outBy = {};
  (conductDetail || []).forEach(function (c) {
    var key = String(c.conductId) + "|" + String(c.date);
    if (!outBy[key]) outBy[key] = new Set();
    outBy[key].add(String(c.d4));
  });
  return outBy;
}

// Average participation. visibleSet === null → company-wide using the stored
// participating/total per conduct (exact back-compat with the old dashboard).
// Otherwise scope by the Present 4D list (numerator) and present+out-in-scope
// (denominator, out = a conductDetail non-participation row), skipping conducts
// with nobody in scope. Returns { pct: 0-100 integer, conducts: included count }.
// `outBy` (optional) is a precomputed conductOutByIndex — pass it to share the
// index with perConductParticipation instead of rebuilding it here.
function scopedParticipation(attendance, conductDetail, visibleSet, outBy) {
  if (visibleSet == null) {
    const usable = (attendance || []).filter(function(a) { return Number(a.total) > 0; });
    if (!usable.length) return { pct: 0, conducts: 0 };
    var sum = usable.reduce(function(acc, a) { return acc + (Number(a.participating) / Number(a.total)) * 100; }, 0);
    return { pct: Math.round(sum / usable.length), conducts: usable.length };
  }
  var rows = (attendance || []).filter(function(a) { return a.source === "csv"; });
  if (!outBy) outBy = conductOutByIndex(conductDetail);
  var total = 0, n = 0;
  rows.forEach(function(a) {
    var present = parseParticipantIds(a.participants);
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

  // Every miss must land on a group line so the cumulative chart's final values
  // sum to exactly totalMisses; a blank/missing group buckets to "Unassigned"
  // rather than being silently dropped (the UI caller never passes blanks, but
  // this keeps the pure API self-consistent).
  const normGroup = function (g) { return (g == null || g === "") ? "Unassigned" : g; };
  const dates = [...new Set(rows.map(function (r) { return r.dateIso; }))].sort();
  const dateIdx = {}; dates.forEach(function (d, i) { dateIdx[d] = i; });
  const groups = [...new Set(rows
    .filter(function (r) { return missSet.has(r.type); })
    .map(function (r) { return normGroup(r.group); }))].sort();
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
      const g = normGroup(r.group);
      if (cumulative[g]) cumulative[g][di]++;   // every miss group exists by construction
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
function perConductParticipation(attendance, conductDetail, visibleSet, outBy) {
  const out = [];
  if (visibleSet == null) {
    (attendance || []).forEach(function (a) {
      if (!(Number(a.total) > 0)) return;
      out.push({ conductId: a.conductId, dateIso: a.dateIso, pct: Math.round((Number(a.participating) / Number(a.total)) * 100) });
    });
    return out;
  }
  if (!outBy) outBy = conductOutByIndex(conductDetail);
  (attendance || []).forEach(function (a) {
    if (a.source !== "csv") return;
    const present = parseParticipantIds(a.participants);
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

// ── Conduct series / class progression (Phase 2b) ─────────────────────────────
// A "class" of conducts shares a base name and is distinguished by a TRAILING
// number; the first of its kind may omit the number (so it is instance 1).
//   "Endurance Run"   → { base: "Endurance Run", num: 1 }
//   "Endurance Run 6" → { base: "Endurance Run", num: 6 }
//   "5BX PT"          → { base: "5BX PT",        num: 1 }  (leading digit ≠ instance)
// Only a trailing run of digits (optionally space-separated) is the instance index.
function parseConductSeries(name) {
  const s = String(name == null ? "" : name).trim();
  const m = s.match(/^(.+?)\s*(\d+)$/);
  if (m) return { base: m[1].trim(), num: Number(m[2]) };
  return { base: s, num: 1 };
}

// Per-recruit progression through one conduct class.
//   instances:        [{ conductId, num }] — the class's HELD instances (any order)
//   presentByConduct: { conductId: Set(d4) } — who participated in each instance
//   recruitIds:       [d4] in scope (company/platoon/section already applied)
// Definitions (confirmed):
//   position = highest instance number the recruit attended (0 = not started)
//   missed   = instances BELOW their position that they skipped (gaps)
//   frontier = highest instance number held by anyone (seriesMax)
//   behind   = frontier − position
// Returns { seriesMax, held:[nums sorted], rows:[{ d4, position, completed, missed:[nums], behind }] }.
function conductProgress(instances, presentByConduct, recruitIds) {
  const held = (instances || [])
    .filter(function (x) { return x && typeof x.num === "number" && !isNaN(x.num); })
    .slice().sort(function (a, b) { return a.num - b.num; });
  const seriesMax = held.reduce(function (m, x) { return Math.max(m, x.num); }, 0);
  const rows = (recruitIds || []).map(function (d4) {
    const id = String(d4);
    const attended = held.filter(function (x) {
      const set = presentByConduct[x.conductId];
      return set && set.has(id);
    }).map(function (x) { return x.num; });
    const position = attended.length ? Math.max.apply(null, attended) : 0;
    const attendedSet = new Set(attended);
    const missed = held
      .filter(function (x) { return x.num < position && !attendedSet.has(x.num); })
      .map(function (x) { return x.num; });
    return { d4: d4, position: position, completed: attended.length, missed: missed, behind: Math.max(0, seriesMax - position) };
  });
  return { seriesMax: seriesMax, held: held.map(function (x) { return x.num; }), rows: rows };
}

// Node test export (browser ignores `module`); see js/calc.js consumers below.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { addDaysISO, endDateFromStartAndDays, daysFromStartEndInclusive, scopedParticipation, conductBuildup, perConductParticipation, CONDUCT_MISS_TYPES, parseConductSeries, conductProgress, parseParticipantIds, conductOutByIndex };
}
