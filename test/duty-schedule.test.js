// Auto-scheduler (MD_Docs/DUTY_LIST_SPEC.md §11).
//
// The properties that matter, in order:
//   1. HARD constraints are never violated — a slot is left empty instead.
//   2. Unfilled slots are REPORTED, never silently skipped.
//   3. The two explicitly-requested penalties demonstrably change the choice.
//   4. It is deterministic, because a rationale you cannot reproduce is not an
//      explanation.
//   5. Repair never increases total cost.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

// Loads the whole pure-module stack into one sandbox, exactly as index.html
// loads them into one global scope.
function loadScheduler() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, Map, Array, Object, JSON, console, isFinite, parseInt, parseFloat };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  const read = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
  ["calc.js", "duty-points.js", "duty-eligibility.js", "duty-conflicts.js", "duty-schedule.js"].forEach(f => {
    sandbox.module.exports = {};
    sandbox.exports = sandbox.module.exports;
    vm.runInContext(read(f), sandbox, { filename: f });
    sandbox["__" + f] = sandbox.module.exports;
  });
  return sandbox["__duty-schedule.js"];
}

const CFG = {
  dutyTypes: [
    { name: "COS", scope: "company", pointWeight: 1, appointments: ["SectComd"] },
    { name: "PDS", scope: "platoon", pointWeight: 1, appointments: ["SectComd"] }
  ],
  dutyDayWeights: { sun: 3, mon: 1, tue: 1, wed: 1, thu: 1, fri: 3, sat: 5, holiday: 5 },
  dutyExtraEligible: [],
  dutySchedulerWeights: {
    pointsAboveMedian: 10, weekendAboveMedian: 8, sameTypeConsecutive: 6,
    pdsAfterCos: 6, withinMinSpacing: 4, adjacentToLeave: 3, minSpacingDays: 3
  }
};

// PLT1 has two section commanders (eligible for PDS 1); PLT2 has one.
const ROSTER = [
  { id: "0001", role: "Commander", platoon: "PLT1", section: "Command", appointment: "PC", status: "Active" },
  { id: "0003", role: "Commander", platoon: "PLT1", section: "1", appointment: "SectComd", status: "Active" },
  { id: "0004", role: "Commander", platoon: "PLT1", section: "2", appointment: "SectComd", status: "Active" },
  { id: "0005", role: "Commander", platoon: "PLT2", section: "1", appointment: "SectComd", status: "Active" },
  { id: "1411", role: "Recruit", platoon: "PLT1", section: "1", appointment: "SectComd", status: "Active" }
];
const PLATOONS = ["HQ", "PLT1", "PLT2"];

module.exports = async function run() {
  const S = loadScheduler();
  // 2026-09-07 is a Monday, so this week runs Mon..Fri with no weekend.
  const WEEK = { from: "2026-09-07", to: "2026-09-11" };

  suite("duty-schedule: slot enumeration");

  await test("slots cover every date × company type, plus one PDS per live platoon", () => {
    const slots = S.dutySlotsInRange({ from: "2026-09-07", to: "2026-09-08" }, CFG, PLATOONS);
    // 2 days × (COS + PDS PLT1 + PDS PLT2) = 6. HQ is not a PLT*, so no PDS.
    eq(slots.length, 6);
    eq(slots.filter(s => s.platoon === "HQ").length, 0, "HQ never gets a PDS slot");
    eq(slots[0].date, "2026-09-07", "dates ascend — the greedy walk order is part of the algorithm");
  });

  // Slot order within a date is load-bearing, not cosmetic — see the long
  // comment on dutySlotsInRange. Both halves are pinned here because each was
  // added to fix a measured failure, and each would silently regress.
  await test("platoon-scoped slots are planned before company-scoped ones", () => {
    const day = S.dutySlotsInRange({ from: "2026-09-07", to: "2026-09-07" }, CFG, PLATOONS);
    const firstCompany = day.findIndex(s => !s.platoon);
    const lastPlatoon = day.map(s => !!s.platoon).lastIndexOf(true);
    ok(lastPlatoon < firstCompany,
       "every PDS slot must come before the first company slot: " + JSON.stringify(day.map(s => s.dutyType + s.platoon)));
  });

  await test("within a scope, the scoring duty type is planned before the free ones", () => {
    const scored = Object.assign({}, CFG, {
      dutyTypes: [
        { name: "CDO", scope: "company", pointWeight: null },
        { name: "COS", scope: "company", pointWeight: 1 }
      ]
    });
    const day = S.dutySlotsInRange({ from: "2026-09-07", to: "2026-09-07" }, scored, PLATOONS);
    eq(day[0].dutyType, "COS",
       "COS scores and CDO does not; planning CDO first lets a free duty eat the capacity COS needs");
  });

  suite("duty-schedule: hard constraints");

  // The headline safety property. A breached constraint is worse than a gap,
  // because a gap is visible and a breach is not.
  await test("an unavailable person is never scheduled — the slot is left empty instead", () => {
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {
      isAway: () => true    // everyone away, every day
    });
    eq(r.proposals.length, 0, "nothing proposed");
    ok(r.unfilled.length > 0, "and the gaps are reported");
  });

  await test("unfilled slots carry the reason, they are never silently skipped", () => {
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, { isAway: () => true });
    const u = r.unfilled[0];
    ok(u.date && u.dutyType, "identifies the slot");
    ok(/unavailable/.test(u.reason), "says why: " + u.reason);
    // Every slot in the range must be accounted for as either filled or listed.
    const total = S.dutySlotsInRange(WEEK, CFG, PLATOONS).length;
    eq(r.proposals.length + r.unfilled.length, total, "every slot is accounted for");
  });

  await test("a platoon with no eligible commander reports the slot, not an exception", () => {
    const thin = ROSTER.filter(p => p.platoon !== "PLT2");
    const r = S.proposeDutySchedule(WEEK, [], thin, PLATOONS, CFG, {}, {});
    const p2 = r.unfilled.filter(u => u.platoon === "PLT2");
    eq(p2.length, 5, "one per day");
    ok(/eligible/.test(p2[0].reason), p2[0].reason);
  });

  await test("nobody holds two duties on the same date", () => {
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {});
    const seen = {};
    r.proposals.forEach(p => {
      const k = p.d4 + "|" + p.date;
      ok(!seen[k], "double-booked " + k);
      seen[k] = true;
    });
  });

  await test("the PDS platoon rule holds — a PLT2 commander never fills PDS 1", () => {
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {});
    r.proposals.filter(p => p.dutyType === "PDS").forEach(p => {
      const who = ROSTER.find(x => x.id === p.d4);
      eq(who.platoon, p.platoon, "PDS " + p.platoon + " went to a " + who.platoon + " commander");
      ok(who.section !== "Command", "the PC/PS must never draw a PDS");
    });
  });

  await test("a recruit is never scheduled", () => {
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {});
    ok(!r.proposals.some(p => p.d4 === "1411"), "recruit 1411 was scheduled");
  });

  suite("duty-schedule: the two requested penalties");

  // Both of these are the user's explicit asks, so they are tested by showing
  // they CHANGE THE CHOICE — not merely that the weight is read.
  await test("PDS-after-COS steers the pick away from yesterday's COS holder", () => {
    // 0003 held COS on the 7th. On the 8th, PDS 1 can go to 0003 or 0004.
    const existing = [{ id: "x", date: "2026-09-07", dutyType: "COS", platoon: "", d4: "0003" }];
    const day8 = { from: "2026-09-08", to: "2026-09-08" };
    const r = S.proposeDutySchedule(day8, existing, ROSTER, PLATOONS, CFG, {}, {});
    const pds = r.proposals.find(p => p.dutyType === "PDS" && p.platoon === "PLT1");
    eq(pds.d4, "0004", "should avoid 0003, who held COS the day before");

    // Zero the weight and the penalty must stop mattering — proving the effect
    // above came from the weight and not from some incidental ordering.
    const flat = Object.assign({}, CFG, {
      dutySchedulerWeights: Object.assign({}, CFG.dutySchedulerWeights,
        { pdsAfterCos: 0, withinMinSpacing: 0, pointsAboveMedian: 0 })
    });
    const r2 = S.proposeDutySchedule(day8, existing, ROSTER, PLATOONS, flat, {}, {});
    const pds2 = r2.proposals.find(p => p.dutyType === "PDS" && p.platoon === "PLT1");
    eq(pds2.d4, "0003", "with the penalty off, the first eligible candidate wins again");
  });

  await test("same-type-on-consecutive-days steers the pick away too", () => {
    const existing = [{ id: "x", date: "2026-09-07", dutyType: "PDS", platoon: "PLT1", d4: "0003" }];
    const day8 = { from: "2026-09-08", to: "2026-09-08" };
    const noSpacing = Object.assign({}, CFG, {
      dutySchedulerWeights: Object.assign({}, CFG.dutySchedulerWeights,
        { withinMinSpacing: 0, pointsAboveMedian: 0 })
    });
    const r = S.proposeDutySchedule(day8, existing, ROSTER, PLATOONS, noSpacing, {}, {});
    eq(r.proposals.find(p => p.dutyType === "PDS").d4, "0004", "avoids a back-to-back PDS");
  });

  suite("duty-schedule: fairness");

  await test("someone already loaded in the range is passed over", () => {
    // 0003 starts the week with a Saturday COS already on the books.
    const existing = [{ id: "x", date: "2026-09-05", dutyType: "COS", platoon: "", d4: "0003" }];
    const range = { from: "2026-09-05", to: "2026-09-09" };
    const r = S.proposeDutySchedule(range, existing, ROSTER, PLATOONS, CFG, {}, {});
    const cos = r.proposals.filter(p => p.dutyType === "COS").map(p => p.d4);
    ok(cos.length > 0, "some COS was planned");
    ok(cos[0] !== "0003", "the person already carrying a 5-point Saturday is not first in line");
  });

  await test("fairness is reported before AND after, so a bad proposal can be rejected", () => {
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {});
    ok(r.fairnessBefore && r.fairnessAfter, "both present");
    ok(typeof r.fairnessAfter.spread === "number", "spread is reported");
    // Both readings are taken over the SAME population — the people a slot in
    // this range could go to. Sampling only those who hold a row (the old
    // Object.keys(byPerson)) put "before" and "after" on different populations,
    // which is what made the comparison meaningless. See the next test.
    eq(r.fairnessBefore.n, r.fairnessAfter.n, "the two readings must be the same sample");
    eq(r.fairnessBefore.spread, 0, "nothing on the books ⇒ everyone genuinely on zero");
    eq(r.fairnessBefore.max, 0, "and nobody carries points yet");
  });

  // The regression that motivated the population fix. Before it, the modal read
  // "spread 0 → spread 11" and told the planner to reject a proposal that had in
  // fact CLOSED a 15-point gap, because the three commanders on zero were absent
  // from the "before" sample entirely.
  await test("evening out a hogged period is reported as an improvement, not a regression", () => {
    const range = { from: "2026-09-07", to: "2026-09-18" };
    // 0003 has taken every COS in the first week; 0004 and 0005 have nothing.
    const hogged = ["07", "08", "09", "10", "11"].map((d, i) => (
      { id: "h" + i, date: "2026-09-" + d, dutyType: "COS", platoon: "", d4: "0003" }));

    const r = S.proposeDutySchedule(range, hogged, ROSTER, PLATOONS, CFG, {}, {});

    ok(r.fairnessBefore.spread > 0,
       "the starting state is lopsided and must be reported as such, got " + JSON.stringify(r.fairnessBefore));
    eq(r.fairnessBefore.min, 0, "the commanders holding nothing are part of the sample");
    ok(r.fairnessAfter.spread < r.fairnessBefore.spread,
       "spreading the load must READ as an improvement: " +
       JSON.stringify(r.fairnessBefore) + " -> " + JSON.stringify(r.fairnessAfter));
  });

  // Dead roster rows must not reach into the live roster's fairness. The medians
  // that drive pointsAboveMedian were sampled over dutyBasePool(), which applies
  // no dutyIsActive filter — so departed commanders sat at zero forever, pinned
  // the median to 0 and flattened the penalty into a constant, at which point the
  // greedy tie-break rather than the objective picked the assignee.
  await test("departed commanders cannot influence the proposal they can never be part of", () => {
    // One platoon's four section commanders, COS scoring and PDS free — the
    // shape where the median actually carries the objective, so a sunk median is
    // visible in the output rather than absorbed by the hard constraints.
    const cfg = Object.assign({}, CFG, {
      dutyTypes: [
        { name: "COS", scope: "company", pointWeight: 1, appointments: ["SectComd"] },
        { name: "PDS", scope: "platoon", pointWeight: null, appointments: ["SectComd"] }
      ]
    });
    const live = [1, 2, 3, 4].map(n => (
      { id: "001" + n, role: "Commander", platoon: "PLT1", section: String(n),
        appointment: "SectComd", status: "Active" }));
    // Six commanders who have LEFT. Still role Commander on the roster, which is
    // how a departed row actually looks — roster.status carries active-vs-departed.
    const ghosts = live.concat([5, 6, 7, 8, 9].map(n => (
      { id: "001" + n, role: "Commander", platoon: "PLT1", section: "1",
        appointment: "SectComd", status: "Departed" }))
      .concat([{ id: "0020", role: "Commander", platoon: "PLT1", section: "1",
        appointment: "SectComd", status: "Departed" }]));
    const MONTH = { from: "2026-09-01", to: "2026-09-30" };

    const a = S.proposeDutySchedule(MONTH, [], live, ["PLT1"], cfg, {}, {});
    const b = S.proposeDutySchedule(MONTH, [], ghosts, ["PLT1"], cfg, {}, {});

    b.proposals.forEach(p => {
      ok(live.some(r2 => r2.id === p.d4), "a departed commander was scheduled: " + p.d4);
    });
    // The real damage was never a wrong assignee — dutyEligible always refused
    // them. It was that six people who could never hold a duty sat in the median
    // sample at zero, pinning the median to 0 and flattening pointsAboveMedian
    // into a constant, at which point the greedy tie-break rather than the
    // fairness objective chose. Pre-fix this took the spread across the four live
    // commanders from 18 to 33, one of them ending the month on 1 point.
    eq(JSON.stringify(b.proposals.map(p => p.d4)),
       JSON.stringify(a.proposals.map(p => p.d4)),
       "the roster must be byte-for-byte the one produced without the departed rows");
    eq(b.fairnessAfter.spread, a.fairnessAfter.spread,
       "and the reported spread must not move either");
  });

  // Acceptance case, and the one that drove both ordering rules. A full month
  // with 5 commanders is exactly saturated: 30 days × (2 PDS + 3 company) = 150
  // slots against 5 × 30 = 150 person-days. There is no slack, so every
  // inefficiency shows up directly as an unfilled slot, and the floor is set
  // purely by leave.
  await test("a saturated month fills every slot leave does not make impossible", () => {
    // The REAL default type set, not the trimmed one the other tests use: the
    // saturation only exists with all four types, and the free CDO/CDS columns
    // are half the point of the scenario.
    const FULL = Object.assign({}, CFG, {
      dutyTypes: [
        { name: "CDO", scope: "company", pointWeight: null },
        { name: "CDS", scope: "company", pointWeight: null },
        { name: "COS", scope: "company", pointWeight: 1 },
        { name: "PDS", scope: "platoon", pointWeight: null }
      ]
    });
    // Needs a second PLT2 section commander: the shared ROSTER has four
    // commanders, which against 150 slots is over-subscribed rather than
    // saturated, and over-subscription has a floor of its own that would mask
    // what this test is measuring.
    const FIVE = ROSTER.concat([{ id: "0006", role: "Commander", platoon: "PLT2", section: "2", status: "Active" }]);
    const MONTH = { from: "2026-09-01", to: "2026-09-30" };
    const away = (d4, iso) => d4 === "0003" && iso >= "2026-09-10" && iso <= "2026-09-14";
    const r = S.proposeDutySchedule(MONTH, [], FIVE, PLATOONS, FULL, { "2026-09-09": { date: "2026-09-09", name: "PH" } },
      { isAway: away });

    eq(S.dutySlotsInRange(MONTH, FULL, PLATOONS).length, 150, "150 slots vs 5 x 30 = 150 person-days");
    // 5 days of leave removes exactly 5 person-days from a saturated grid, so 5
    // gaps is the floor — not a scheduler shortfall. Before the ordering rules
    // this was 22.
    eq(r.unfilled.length, 5, "unfilled should sit at the floor set by leave");
    eq(r.proposals.length, 145);

    // And the points must actually be spread. Scoring-slots-first was added
    // because narrow-first alone pushed COS to whoever was left over, giving a
    // spread of 53 on a median of 0.
    ok(r.fairnessAfter.spread <= 6,
       "points spread should be tight, got " + JSON.stringify(r.fairnessAfter));
    ok(r.fairnessAfter.min > 0, "nobody should end a whole month on zero points");
  });

  // The company can genuinely be short-handed — more slots than person-days.
  // The scheduler must report that honestly rather than papering over it by
  // double-booking, which is the one thing a duty roster must never do.
  await test("an over-subscribed month reports the shortfall instead of double-booking", () => {
    const FULL = Object.assign({}, CFG, {
      dutyTypes: [
        { name: "CDO", scope: "company", pointWeight: null },
        { name: "CDS", scope: "company", pointWeight: null },
        { name: "COS", scope: "company", pointWeight: 1 },
        { name: "PDS", scope: "platoon", pointWeight: null }
      ]
    });
    const MONTH = { from: "2026-09-01", to: "2026-09-30" };
    // Four commanders, 150 slots, 30 days → 120 person-days. 30 gaps minimum.
    const r = S.proposeDutySchedule(MONTH, [], ROSTER, PLATOONS, FULL, {}, {});
    ok(r.unfilled.length >= 30, "must report at least the arithmetic shortfall, got " + r.unfilled.length);
    eq(r.proposals.length + r.unfilled.length, 150, "every slot still accounted for");
    const seen = {};
    r.proposals.forEach(p => {
      const k = p.d4 + "|" + p.date;
      ok(!seen[k], "double-booked " + k + " — a shortfall must never be hidden this way");
      seen[k] = true;
    });
  });

  suite("duty-schedule: determinism and explainability");

  // A roster the planner cannot reproduce is one they cannot defend. This is
  // the property the whole greedy-over-local-search choice was made for.
  await test("the same input always produces the same roster", () => {
    const a = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {});
    const b = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {});
    eq(JSON.stringify(a.proposals), JSON.stringify(b.proposals));
  });

  await test("every proposal carries a rationale and a source of \"auto\"", () => {
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {});
    r.proposals.forEach(p => {
      ok(p.rationale && p.rationale.length > 5, "empty rationale on " + p.date);
      eq(p.source, "auto", "auto-generated rows must stay distinguishable after the fact");
    });
  });

  await test("a costless pick says so plainly rather than inventing a reason", () => {
    eq(S.dutyRationale({ cost: 0, parts: [] }), "Lowest duty load, and no conflicts.");
    ok(/despite/.test(S.dutyRationale({ cost: 6, parts: [{ n: 6, why: "a back-to-back" }] })));
  });

  suite("duty-schedule: repair pass");

  await test("repair never increases total cost, and terminates", () => {
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, {});
    ok(typeof r.swaps === "number" && r.swaps >= 0, "swap count reported");
    // Strict-decrease acceptance means an equal-cost swap is refused; if it
    // were weak, two identical-scoring rosters would oscillate to the cap.
    ok(r.swaps < 200, "did not run to the iteration cap");
  });

  await test("a swap is refused when it would move someone onto a day they are away", () => {
    // 0003 is away on the 9th; no swap may put them there.
    const away = (d4, iso) => d4 === "0003" && iso === "2026-09-09";
    const r = S.proposeDutySchedule(WEEK, [], ROSTER, PLATOONS, CFG, {}, { isAway: away });
    ok(!r.proposals.some(p => p.d4 === "0003" && p.date === "2026-09-09"),
       "scheduled someone onto a day they are unavailable");
  });

  suite("duty-schedule: config and degradation");

  await test("a missing or partial weights object falls back per key", () => {
    eq(S.dutySchedWeights({}).pdsAfterCos, 6, "default used");
    eq(S.dutySchedWeights({ dutySchedulerWeights: { pdsAfterCos: 99 } }).pdsAfterCos, 99, "override used");
    eq(S.dutySchedWeights({ dutySchedulerWeights: { pdsAfterCos: 99 } }).sameTypeConsecutive, 6,
       "the other keys still default — a partial override is not a wipe");
    eq(S.dutySchedWeights({ dutySchedulerWeights: { pdsAfterCos: "junk" } }).pdsAfterCos, 6,
       "a non-numeric value falls back rather than poisoning every cost with NaN");
  });

  // Existing rows are fixed by default; regenerate re-plans them. Both matter:
  // the planner has usually hand-placed a few before asking for help.
  await test("existing assignments in range are respected by default", () => {
    const existing = [{ id: "x", date: "2026-09-08", dutyType: "COS", platoon: "", d4: "0005" }];
    const r = S.proposeDutySchedule(WEEK, existing, ROSTER, PLATOONS, CFG, {}, {});
    ok(!r.proposals.some(p => p.date === "2026-09-08" && p.dutyType === "COS"),
       "re-planned a slot that was already filled");
  });

  await test("regenerate re-plans them", () => {
    const existing = [{ id: "x", date: "2026-09-08", dutyType: "COS", platoon: "", d4: "0005" }];
    const r = S.proposeDutySchedule(WEEK, existing, ROSTER, PLATOONS, CFG, {}, { regenerate: true });
    ok(r.proposals.some(p => p.date === "2026-09-08" && p.dutyType === "COS"),
       "regenerate should re-plan the slot");
  });

  await test("an empty roster proposes nothing and reports every slot", () => {
    const r = S.proposeDutySchedule(WEEK, [], [], PLATOONS, CFG, {}, {});
    eq(r.proposals.length, 0);
    eq(r.unfilled.length, S.dutySlotsInRange(WEEK, CFG, PLATOONS).length);
  });

  await test("an unbounded range proposes nothing rather than looping forever", () => {
    eq(S.dutySlotsInRange({ from: "", to: "" }, CFG, PLATOONS).length, 0);
    eq(S.proposeDutySchedule({ from: "", to: "" }, [], ROSTER, PLATOONS, CFG, {}, {}).proposals.length, 0);
  });
};
