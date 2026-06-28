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

// Node test export (browser ignores `module`); see js/calc.js consumers below.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { addDaysISO, endDateFromStartAndDays, daysFromStartEndInclusive };
}
