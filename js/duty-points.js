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

// Inclusive on both ends. An empty bound means unbounded, which is how the
// all-time range is expressed without special-casing every call site.
function dutyInRange(isoDate, range) {
  if (!isoDate) return false;
  if (!range) return true;
  if (range.from && isoDate < range.from) return false;
  if (range.to && isoDate > range.to) return false;
  return true;
}

function dutyLastDayOfMonth(y, m1to12) {
  return new Date(Date.UTC(y, m1to12, 0)).getUTCDate(); // day 0 of next month
}

function dutyPad2(n) { return (n < 10 ? "0" : "") + n; }

// `kind` is "month" | "cycle" | "all"; `anchorISO` is any date inside the wanted
// period. Cycles roll forward from dutyCycleStart in fixed dutyCycleMonths blocks,
// so the caller only ever has to say "the period containing this date" rather than
// track boundaries itself.
function dutyRangeFor(kind, anchorISO, cfg) {
  if (kind === "all") return { from: "", to: "", label: "All time" };

  const parts = String(anchorISO || "").split("-");
  const y = Number(parts[0]), m = Number(parts[1]);
  if (!y || !m) return { from: "", to: "", label: "All time" };

  if (kind === "month") {
    const last = dutyLastDayOfMonth(y, m);
    return {
      from: y + "-" + dutyPad2(m) + "-01",
      to: y + "-" + dutyPad2(m) + "-" + dutyPad2(last),
      label: y + "-" + dutyPad2(m)
    };
  }

  const startParts = String((cfg && cfg.dutyCycleStart) || "").split("-");
  const sy = Number(startParts[0]), sm = Number(startParts[1]);
  const len = Number(cfg && cfg.dutyCycleMonths) || 6;
  if (!sy || !sm) return { from: "", to: "", label: "All time" };

  // Math.floor (not truncation) so a date BEFORE the configured cycle start still
  // lands in a whole cycle rather than straddling the boundary — negative month
  // offsets have to round down, and `| 0` would round them toward zero.
  const monthsSinceStart = (y - sy) * 12 + (m - sm);
  const idx = Math.floor(monthsSinceStart / len);
  const fromAbs = sy * 12 + (sm - 1) + idx * len;
  const toAbs = fromAbs + len - 1;
  const fy = Math.floor(fromAbs / 12), fm = (fromAbs % 12) + 1;
  const ty = Math.floor(toAbs / 12), tm = (toAbs % 12) + 1;
  return {
    from: fy + "-" + dutyPad2(fm) + "-01",
    to: ty + "-" + dutyPad2(tm) + "-" + dutyPad2(dutyLastDayOfMonth(ty, tm)),
    label: "Cycle " + fy + "-" + dutyPad2(fm)
  };
}

function dutyBlankTotals() {
  return { counts: {}, basePoints: 0, weekendPoints: 0, corrections: 0, total: 0 };
}

// Aggregates by summing the underlying ROWS over the requested range. It never
// sums precomputed per-month subtotals, which is what made the source sheet's
// "Overall duties" roll-up drift (spec §1.3 bug #3) — that class of bug is
// structurally impossible here. Likewise the range comes from the data, not from
// a fixed 30-row assumption, which is bug #2.
function dutyTotals(dutyRows, correctionRows, cfg, holidaysByDate, range) {
  const byPerson = {};
  const rows = dutyRows || [];
  const hol = holidaysByDate || {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.d4 || !dutyInRange(row.date, range)) continue;
    const d4 = String(row.d4);
    if (!byPerson[d4]) byPerson[d4] = dutyBlankTotals();
    const p = byPerson[d4];
    p.counts[row.dutyType] = (p.counts[row.dutyType] || 0) + 1;
    const pts = dutyPointsFor(row, cfg, hol);
    p.basePoints += pts;
    // "Weekend burden" is what people actually compare when they argue about
    // fairness, so a public holiday counts toward it regardless of which weekday
    // it happened to fall on.
    const dow = dutyDayOfWeek(row.date);
    if (hol[row.date] || dow === 0 || dow === 6) p.weekendPoints += pts;
  }

  const corrs = correctionRows || [];
  for (let i = 0; i < corrs.length; i++) {
    const c = corrs[i];
    if (!c || !c.d4 || !dutyInRange(c.date, range)) continue;
    const d4 = String(c.d4);
    // A correction can exist for someone with no duties in range (a deduction
    // carried over, say), so this must be able to create the entry.
    if (!byPerson[d4]) byPerson[d4] = dutyBlankTotals();
    byPerson[d4].corrections += Number(c.delta) || 0;
  }

  const ids = Object.keys(byPerson);
  for (let i = 0; i < ids.length; i++) {
    const p = byPerson[ids[i]];
    p.total = p.basePoints + p.corrections;
  }

  return { byPerson: byPerson, range: range || { from: "", to: "" } };
}

// Node test export (browser ignores `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DUTY_DAY_KEYS, indexHolidays, dutyDayOfWeek, dutyDayWeight, dutyTypeDef,
                     dutyPointsFor, dutyInRange, dutyRangeFor, dutyTotals };
}
