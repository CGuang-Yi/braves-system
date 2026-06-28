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

// Node test export (browser ignores `module`); see js/calc.js consumers below.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { addDaysISO, endDateFromStartAndDays, daysFromStartEndInclusive, scopedParticipation };
}
