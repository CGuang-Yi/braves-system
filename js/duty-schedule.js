// Duty auto-scheduler (MD_Docs/DUTY_LIST_SPEC.md §11).
//
// PURE MODULE — no STATE, no DOM. Depends on the other pure duty modules
// (duty-eligibility, duty-points, duty-conflicts) and on addDaysISO from
// js/calc.js, all of which load earlier.
//
// It PROPOSES ONLY. Nothing here writes; the output is an uncommitted proposal
// the planner reviews, edits and then saves, and saved rows carry
// source: "auto" so an auto-generated assignment stays distinguishable after
// the fact. That is deliberate — the planner owns the roster, and a scheduler
// that wrote directly would make them the reviewer of a decision they never
// made.
//
// Greedy with a repair pass, chosen over local search and constraint solving.
// Local search is measurably fairer but nondeterministic without a seeded PRNG
// and cannot explain a choice; a solver needs a dependency and a bundler, and
// this repo has neither. Explainability wins: a roster the planner cannot
// justify to whoever drew Saturday COS is worse than a slightly uneven one they
// can. Hence a rationale string on every assignment.

// Every slot in the range, dates ascending, then Config order within a date.
// Ascending matters: the greedy pass's cost depends on what it has already
// placed, so the walk order IS part of the algorithm.
function dutySlotsInRange(range, cfg, platoons) {
  const out = [];
  if (!range || !range.from || !range.to) return out;
  let d = range.from;
  let guard = 0;
  const types = (cfg && cfg.dutyTypes) || [];
  // Slot order within a date is load-bearing, and it answers two problems.
  //
  // (1) MOST-CONSTRAINED FIRST. A PDS draws from one platoon's section
  //     commanders — typically two people — while a company duty draws from the
  //     whole pool. Planning the wide slots first lets them take the very people
  //     the narrow slots depend on, and the narrow slot is then left unfilled
  //     with nobody to blame. On a saturated 30-day month (150 slots, 5
  //     commanders, one of them on 5 days' leave) this took unfilled slots from
  //     22 down to 5 — and 5 is the floor, being exactly the person-days the
  //     leave removes.
  //
  // (2) SCORING SLOTS BEFORE FREE ONES. Doing only (1) traded one problem for
  //     another: COS is the sole type that scores by default, so as the last
  //     slot of the day it fell to whoever happened to still be free, and the
  //     points spread blew out to 53 with a median of 0. A duty type whose
  //     pointWeight is null costs its holder nothing, so it must not be allowed
  //     to consume the capacity the scoring slot needs. Higher point weight is
  //     planned first, while the fairness objective still has candidates to
  //     choose between.
  //
  // Config order breaks remaining ties, so the walk stays deterministic.
  const ordered = types.slice().sort((a, b) => {
    const narrow = t => (dutyTypeScope(cfg, t.name) === "platoon" ? 0 : 1);
    if (narrow(a) !== narrow(b)) return narrow(a) - narrow(b);
    const pw = t => Number(t.pointWeight) || 0;
    return pw(b) - pw(a);
  });
  while (d <= range.to && guard++ < 800) {
    for (let i = 0; i < ordered.length; i++) {
      const pls = dutyPlatoonsFor(ordered[i].name, platoons, cfg);
      for (let j = 0; j < pls.length; j++) out.push({ date: d, dutyType: ordered[i].name, platoon: pls[j] });
    }
    d = addDaysISO(d, 1);
  }
  return out;
}

// Spread of the total-points distribution. Reported before and after so the
// planner can see whether the proposal actually improved anything rather than
// taking "the computer did it" on faith — a proposal that makes the spread
// worse is one they should reject, and they can only know that if it is shown.
function dutyFairnessOf(totals) {
  const vals = Object.keys(totals.byPerson).map(k => totals.byPerson[k].total).sort((a, b) => a - b);
  if (!vals.length) return { n: 0, min: 0, max: 0, median: 0, spread: 0 };
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return { n: vals.length, min: vals[0], max: vals[vals.length - 1], median, spread: vals[vals.length - 1] - vals[0] };
}

const DUTY_SCHED_DEFAULT_WEIGHTS = {
  pointsAboveMedian: 10, weekendAboveMedian: 8, dutiesAboveMedian: 5,
  sameTypeConsecutive: 6, pdsAfterCos: 6, withinMinSpacing: 4,
  adjacentToLeave: 3, minSpacingDays: 3
};

function dutySchedWeights(cfg) {
  const w = (cfg && cfg.dutySchedulerWeights) || {};
  const out = {};
  Object.keys(DUTY_SCHED_DEFAULT_WEIGHTS).forEach(k => {
    const v = Number(w[k]);
    out[k] = isFinite(v) ? v : DUTY_SCHED_DEFAULT_WEIGHTS[k];
  });
  return out;
}

// Cost of putting `d4` in `slot`, given everything placed so far. Returns the
// number AND the components, because the components are what the rationale is
// written from — a score with no breakdown is exactly the unexplainable output
// this design rejected.
function dutySoftCost(d4, slot, ctx) {
  const w = ctx.weights;
  const parts = [];
  let cost = 0;
  const add = (n, why) => { if (n > 0) { cost += n; parts.push({ n, why }); } };

  const slotPts = dutyPointsFor({ date: slot.date, dutyType: slot.dutyType }, ctx.cfg, ctx.holidays);
  const proj = (ctx.points[d4] || 0) + slotPts;
  add(Math.max(0, proj - ctx.median) * w.pointsAboveMedian, "already at or above the median points");

  // Duty COUNT, not just points. The spec's points objective is inert for
  // count-only types — and `pointWeight: null` is the default for everything
  // except COS, faithfully reproducing the source sheet. Without this, taking
  // CDO or CDS is free, so whoever the tie-break favours hoovers up the unscored
  // columns every morning, is then hard-blocked from COS as already-on-duty, and
  // the only column that scores lands on whoever sorts last. Measured on a real
  // month: 1 point vs 20 across five commanders. Counting duties makes the free
  // columns cost something, which is what makes the points objective reachable.
  add(Math.max(0, (ctx.duties[d4] || 0) + 1 - ctx.dutiesMedian) * w.dutiesAboveMedian,
      "already holding as many duties as anyone");

  const dow = dutyDayOfWeek(slot.date);
  const isHeavy = !!ctx.holidays[slot.date] || dow === 0 || dow === 6;
  if (isHeavy) {
    const wproj = (ctx.weekend[d4] || 0) + slotPts;
    add(Math.max(0, wproj - ctx.weekendMedian) * w.weekendAboveMedian, "already carrying weekend/PH burden");
  }

  const prev = addDaysISO(slot.date, -1);
  const next = addDaysISO(slot.date, 1);
  const held = (iso, type) => dutyRowsFor(ctx.rows, d4, iso, "").some(r => !type || r.dutyType === type);

  if (held(prev, slot.dutyType) || held(next, slot.dutyType)) {
    add(w.sameTypeConsecutive, "same duty type on an adjacent day");
  }
  // Correction reason #1 in the source system, so this is a known real problem
  // rather than a theoretical one.
  if (slot.dutyType === "PDS" && held(prev, "COS")) {
    add(w.pdsAfterCos, "PDS the day after a COS");
  }

  const span = Math.max(0, Math.floor(w.minSpacingDays));
  for (let k = 1; k <= span; k++) {
    if (held(addDaysISO(slot.date, -k), null) || held(addDaysISO(slot.date, k), null)) {
      add(w.withinMinSpacing, "another duty within " + span + " days");
      break;
    }
  }

  const spans = ctx.leaveSpans[d4] || [];
  if (dutyDateInSpans(prev, spans) || dutyDateInSpans(next, spans)) {
    add(w.adjacentToLeave, "duty butts up against leave");
  }

  return { cost, parts };
}

// Hard constraints (§11.1). A slot is left EMPTY rather than breached, and the
// reason is reported — a silently skipped slot reads as "no duty needed that
// day", which is the opposite of what it means.
function dutyHardBlocked(d4, slot, ctx) {
  if (ctx.isAway(d4, slot.date)) return "unavailable";
  if (dutyRowsFor(ctx.rows, d4, slot.date, "").length) return "already on duty that date";
  return "";
}

/**
 * @param {{from:string,to:string}} range
 * @param {Array} existing  Duty rows already stored. Respected as fixed unless
 *   opts.regenerate is set, in which case rows inside the range are discarded
 *   and re-planned.
 * @param {Array} roster
 * @param {Array} platoons  live platoon codes, for the PDS columns
 * @param {object} cfg
 * @param {object} holidays  indexHolidays() output
 * @param {{isAway?:function, leaveSpansFor?:function, corrections?:Array, regenerate?:boolean}} [opts]
 *   opts.isAway(d4, isoDate) — REQUIRED to honour the availability constraint.
 *     Passed in rather than derived because the answer comes from
 *     bpClassifyPerson, which reads STATE; taking it as a callback is what keeps
 *     this module pure and unit-testable. Omitting it does not silently disable
 *     the constraint by accident — see the explicit default below.
 *   opts.leaveSpansFor(d4) — leave spans, same reasoning.
 *   opts.corrections — counted into fairness, since a docked person is
 *     genuinely behind.
 */
function proposeDutySchedule(range, existing, roster, platoons, cfg, holidays, opts) {
  const o = opts || {};
  // Default to "nobody is ever away". Stated loudly rather than hidden: a
  // caller that forgets isAway gets a proposal that ignores leave, and the
  // rationale strings will not mention availability, so it is visible in the
  // output rather than silently wrong.
  const isAway = typeof o.isAway === "function" ? o.isAway : () => false;
  const leaveSpansFor = typeof o.leaveSpansFor === "function" ? o.leaveSpansFor : () => [];
  const corrections = o.corrections || [];
  const hol = holidays || {};

  const kept = (existing || []).filter(r =>
    r && r.d4 && (!o.regenerate || !dutyInRange(r.date, range)));
  const rows = kept.slice();

  const pool = dutyBasePool(roster, cfg).map(r => String(r.id));
  const leaveSpans = {};
  pool.forEach(d4 => { leaveSpans[d4] = leaveSpansFor(d4); });

  const fairnessBefore = dutyFairnessOf(dutyTotals(rows, corrections, cfg, hol, range));

  // Running projections, seeded from what is already on the books in the range
  // so the scheduler evens out the WHOLE period rather than only the part it
  // planned. Someone who already drew two Saturdays should not draw a third.
  const seed = dutyTotals(rows, corrections, cfg, hol, range).byPerson;
  const points = {}, weekend = {}, duties = {};
  pool.forEach(d4 => {
    points[d4] = seed[d4] ? seed[d4].total : 0;
    weekend[d4] = seed[d4] ? seed[d4].weekendPoints : 0;
    duties[d4] = seed[d4]
      ? Object.keys(seed[d4].counts).reduce((n, t) => n + seed[d4].counts[t], 0) : 0;
  });

  const weights = dutySchedWeights(cfg);
  const median = () => {
    const v = pool.map(d => points[d]).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  const weekendMedian = () => {
    const v = pool.map(d => weekend[d]).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  const dutiesMedian = () => {
    const v = pool.map(d => duties[d]).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };

  const proposals = [], unfilled = [];
  const slots = dutySlotsInRange(range, cfg, platoons);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    // A slot someone already holds is not re-planned.
    if (rows.some(r => r.date === slot.date && r.dutyType === slot.dutyType &&
                       (r.platoon || "") === slot.platoon)) continue;

    const eligible = dutyEligible(slot.dutyType, slot.platoon, slot.date, roster, cfg, {});
    if (!eligible.length) {
      unfilled.push({ date: slot.date, dutyType: slot.dutyType, platoon: slot.platoon,
                      reason: "nobody is eligible for this slot" });
      continue;
    }

    const ctx = { cfg, holidays: hol, rows, points, weekend, duties, weights, leaveSpans,
                  median: median(), weekendMedian: weekendMedian(),
                  dutiesMedian: dutiesMedian(), isAway };

    let best = null, blockedAll = "";
    for (let j = 0; j < eligible.length; j++) {
      const d4 = eligible[j];
      const blocked = dutyHardBlocked(d4, slot, ctx);
      if (blocked) { blockedAll = blockedAll || blocked; continue; }
      const sc = dutySoftCost(d4, slot, ctx);
      // Strict < keeps the walk deterministic: ties go to the first candidate,
      // and dutyEligible returns the roster in a stable order.
      if (!best || sc.cost < best.cost) best = { d4, cost: sc.cost, parts: sc.parts };
    }

    if (!best) {
      unfilled.push({ date: slot.date, dutyType: slot.dutyType, platoon: slot.platoon,
                      reason: "every eligible person is " + (blockedAll || "unavailable") });
      continue;
    }

    const row = { date: slot.date, dutyType: slot.dutyType, platoon: slot.platoon,
                  d4: best.d4, source: "auto" };
    rows.push(row);
    const pts = dutyPointsFor(row, cfg, hol);
    points[best.d4] += pts;
    duties[best.d4] = (duties[best.d4] || 0) + 1;
    const dw = dutyDayOfWeek(slot.date);
    if (hol[slot.date] || dw === 0 || dw === 6) weekend[best.d4] += pts;

    proposals.push(Object.assign({}, row, {
      softCost: best.cost,
      rationale: dutyRationale(best)
    }));
  }

  const repaired = dutyRepair(proposals, rows, {
    cfg, holidays: hol, points, weekend, duties, weights, leaveSpans, isAway,
    median: median(), weekendMedian: weekendMedian(), dutiesMedian: dutiesMedian()
  });

  const fairnessAfter = dutyFairnessOf(dutyTotals(rows, corrections, cfg, hol, range));
  return { proposals, unfilled, fairnessBefore, fairnessAfter, swaps: repaired };
}

// One sentence, naming the dominant cost — or saying plainly that there wasn't
// one. "Lowest duty load and no conflicts" is a real answer to "why me"; a bare
// number is not.
function dutyRationale(best) {
  if (!best.parts.length) return "Lowest duty load, and no conflicts.";
  const top = best.parts.slice().sort((a, b) => b.n - a.n)[0];
  return "Best available despite " + top.why + ".";
}

// Pass 2 — bounded pairwise repair. Swaps two proposals of the same type (and
// platoon, for platoon-scoped types) and keeps the swap ONLY if total cost
// strictly decreases. Strictly, not weakly: equal-cost swaps would let it
// oscillate forever between two identical-scoring rosters.
//
// Deterministic and capped, so the same input always yields the same roster —
// which is the property that makes the rationale trustworthy.
function dutyRepair(proposals, rows, ctx) {
  let swaps = 0;
  const CAP = 200;
  const sameSlot = (r, p) =>
    r.date === p.date && r.dutyType === p.dutyType && (r.platoon || "") === p.platoon;
  // Score a candidate against the roster MINUS the slot being scored, otherwise
  // the row would count itself as its own same-day conflict and every candidate
  // would tie at "already on duty that date".
  const costOf = (d4, p) => dutySoftCost(d4, p, Object.assign({}, ctx, {
    rows: rows.filter(r => !sameSlot(r, p))
  })).cost;

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < proposals.length && swaps < CAP; i++) {
      for (let j = i + 1; j < proposals.length && swaps < CAP; j++) {
        const a = proposals[i], b = proposals[j];
        if (a.dutyType !== b.dutyType || a.platoon !== b.platoon) continue;
        if (a.d4 === b.d4) continue;
        // The repair pass has to re-check the HARD constraints, not just cost.
        // Pass 1 verified them for the placement it made; a swap is a new
        // placement and can breach them — most easily by moving someone onto a
        // date where they already hold a DIFFERENT duty type, which the
        // same-type-only pairing does nothing to prevent.
        if (ctx.isAway(a.d4, b.date) || ctx.isAway(b.d4, a.date)) continue;
        if (dutyRowsFor(rows.filter(r => !sameSlot(r, b)), a.d4, b.date, "").length) continue;
        if (dutyRowsFor(rows.filter(r => !sameSlot(r, a)), b.d4, a.date, "").length) continue;

        const before = costOf(a.d4, a) + costOf(b.d4, b);
        const after = costOf(b.d4, a) + costOf(a.d4, b);
        if (after < before) {
          const t = a.d4; a.d4 = b.d4; b.d4 = t;
          // Keep the shared `rows` view in step, so later comparisons in this
          // same pass score against the swapped roster rather than a stale one.
          rows.forEach(r => {
            if (sameSlot(r, a)) r.d4 = a.d4;
            if (sameSlot(r, b)) r.d4 = b.d4;
          });
          a.rationale = "Swapped with " + b.date + " to even out the load.";
          b.rationale = "Swapped with " + a.date + " to even out the load.";
          swaps++;
        }
      }
    }
  }
  return swaps;
}

// Node test export (browser ignores `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { dutySlotsInRange, dutyFairnessOf, dutySchedWeights, dutySoftCost,
                     dutyHardBlocked, proposeDutySchedule, dutyRationale, dutyRepair,
                     DUTY_SCHED_DEFAULT_WEIGHTS };
}
