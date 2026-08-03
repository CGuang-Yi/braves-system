// Duty point accounting (MD_Docs/DUTY_LIST_SPEC.md §4).
//
// PURE MODULE — no STATE, no DOM, no configGet(). Config arrives as an argument
// so this file can be unit-tested in isolation and type-checked with `lib`
// omitting DOM. Keep it that way.
//
// This deliberately does NOT reproduce the source spreadsheet's column-R formula
// verbatim; see spec §1.3. Two of that formula's bugs are fixed here and the
// resulting differences are expected, not regressions: public holidays are
// actually applied (the sheet's formula never read its own Holidays sheet), and
// no date range is silently dropped.

// Index 0..6 matches Date#getUTCDay() (0 = Sunday).
const DUTY_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Normalise a Holidays tab into a date-keyed lookup. `tentative` is coerced to a
// real boolean here so callers never have to re-interpret a sheet's truthy string.
function indexHolidays(holidayRows) {
  const out = {};
  const rows = holidayRows || [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.date) continue;
    const iso = String(r.date).trim();
    if (!iso) continue;
    out[iso] = { date: iso, name: r.name || "", tentative: !!(r.tentative && String(r.tentative).trim()) };
  }
  return out;
}

// Weekday of an ISO date, timezone-safe. Parsing the string with `new Date(iso)`
// yields UTC midnight, which renders as the PREVIOUS day in any negative-offset
// zone — that would silently turn a 5-point Saturday into a 3-point Friday. Build
// from explicit parts and read in UTC so local offset can never enter.
function dutyDayOfWeek(isoDate) {
  const parts = String(isoDate || "").split("-");
  if (parts.length !== 3) return -1;
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return -1;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// A public holiday outranks whatever weekday it lands on. Tentative holidays are
// weighted the same as confirmed ones — they are surfaced in the UI and in the
// reconciliation report instead, so a provisional 5-pointer stays visible rather
// than being silently baked in at a lower weight.
function dutyDayWeight(isoDate, cfg, holidaysByDate) {
  const weights = (cfg && cfg.dutyDayWeights) || {};
  const dow = dutyDayOfWeek(isoDate);
  if (dow < 0) return 0;
  if (holidaysByDate && holidaysByDate[isoDate]) return Number(weights.holiday) || 0;
  return Number(weights[DUTY_DAY_KEYS[dow]]) || 0;
}

function dutyTypeDef(cfg, name) {
  const types = (cfg && cfg.dutyTypes) || [];
  for (let i = 0; i < types.length; i++) if (types[i].name === name) return types[i];
  return null;
}

// pointWeight === null means "counted but never scored" — the count-only case, and
// the default for every type except COS (spec §1.3 #4: only COS scores, which is
// intentional in the source system rather than a bug).
//
// An unknown type scores zero rather than throwing, so a stale row left behind by a
// removed config entry degrades quietly instead of breaking the whole view.
function dutyPointsFor(row, cfg, holidaysByDate) {
  if (!row || !row.date) return 0;
  const def = dutyTypeDef(cfg, row.dutyType);
  if (!def || def.pointWeight === null || def.pointWeight === undefined) return 0;
  return Number(def.pointWeight) * dutyDayWeight(row.date, cfg, holidaysByDate);
}

// Node test export (browser ignores `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DUTY_DAY_KEYS, indexHolidays, dutyDayOfWeek, dutyDayWeight, dutyTypeDef, dutyPointsFor };
}
