// Heat Acclimatisation (HA) calculation tests — js/helpers.js computeHA /
// runHAStateMachine / computeHACurrency, checked against HA.md.
//
// helpers.js is a browser-global script (no module.exports) with a few eager
// top-level refs to the DOM/other bundles. We load it into a vm context whose
// global is a Proxy with `has: () => true`, so any unresolved free identifier
// reads as `undefined` instead of throwing — the HA functions themselves only
// touch STATE / configGet / conductName / parseParticipantIds / todayISO, which
// we inject. Function declarations still bind onto the real target object.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

function loadHelpers() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8"), ctx, { filename: "helpers.js" });
  // Injected deps the HA code reaches for. Set AFTER load so our stubs win over
  // helpers.js's own declarations (e.g. conductName, which reads STATE tabs we
  // don't seed). parseParticipantIds/configGet live in other bundles (no collision).
  target.parseParticipantIds = p =>
    String(p == null ? "" : p).split(",").map(s => s.trim()).filter(Boolean);
  // Mirrors the production default (state.js DEFAULT_CONFIG): per-conduct
  // currencyTags govern HA eligibility. Individual tests swap this stub to
  // "isHAExcluded" to exercise the legacy name path.
  target.configGet = key => (key === "haEligibilitySource" ? "currencyTag" : undefined);
  target.conductName = () => "Endurance Run";         // not IPPT/Sports/Swim ⇒ HA-eligible
  target.STATE = { attendance: [], roster: [], vocfit: [], conductDetail: [] };
  return target;
}

// ── date helpers for building fixtures ──────────────────────────────────────
function iso(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function addDays(isoStr, n) { const dt = new Date(isoStr + "T00:00:00"); dt.setDate(dt.getDate() + n); return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
function daySeq(startIso, n) { const out = []; for (let i = 0; i < n; i++) out.push(addDays(startIso, i)); return out; }
function mapFrom(days, periods) { const m = {}; days.forEach(k => { m[k] = periods; }); return m; }

module.exports = async function run() {
  const H = loadHelpers();

  // ── runHAStateMachine ─────────────────────────────────────────────────────
  suite("HA: runHAStateMachine — Single/Expanded (day mode)");

  await test("Single completes on the 10th consecutive active day", () => {
    const days = daySeq(iso(2026, 5, 1), 10);
    const r = H.runHAStateMachine(mapFrom(days, 1), days[0], days[9], { target: 10, maxBreak: 2, mode: "day" });
    eq(r.status, "Completed");
    eq(r.completionDate, iso(2026, 5, 10));
    eq(r.periods, 10);
    eq(r.completions.length, 1);
  });

  await test("Single restarts after a 3rd break day, then completes on the fresh run", () => {
    // 2 active, 3 consecutive breaks (3 > maxBreak 2 ⇒ reset), then 10 active.
    const map = {};
    daySeq(iso(2026, 5, 1), 2).forEach(k => (map[k] = 1));      // May 1-2 active
    // May 3-5 break (no entries)
    daySeq(iso(2026, 5, 6), 10).forEach(k => (map[k] = 1));     // May 6-15 active
    const r = H.runHAStateMachine(map, iso(2026, 5, 1), iso(2026, 5, 15), { target: 10, maxBreak: 2, mode: "day" });
    eq(r.status, "Completed");
    eq(r.completionDate, iso(2026, 5, 15));                     // completed on the restarted run
  });

  await test("state machine records EVERY completion (lapse-recovery support)", () => {
    // Two separate 10-day Single runs with a long gap between them.
    const map = {};
    daySeq(iso(2026, 5, 1), 10).forEach(k => (map[k] = 1));     // qualifies May 10
    daySeq(iso(2026, 7, 1), 10).forEach(k => (map[k] = 1));     // re-qualifies Jul 10
    const r = H.runHAStateMachine(map, iso(2026, 5, 1), iso(2026, 7, 10), { target: 10, maxBreak: 2, mode: "day" });
    eq(r.completions.length, 2);
    eq(r.completions[0], iso(2026, 5, 10));
    eq(r.completions[1], iso(2026, 7, 10));
    eq(r.completionDate, iso(2026, 5, 10));                     // first completion for display
  });

  // ── Bug 2: Double 7-day active-window ──────────────────────────────────────
  suite("HA: runHAStateMachine — Double 7-day window (bug 2)");

  await test("Double does NOT complete when 13 periods span more than 7 active days", () => {
    const days = daySeq(iso(2026, 4, 1), 13);                   // 13 consecutive days, 1 period each
    const r = H.runHAStateMachine(mapFrom(days, 1), days[0], days[12], { target: 13, maxBreak: 2, maxActiveDays: 7, mode: "time" });
    ok(r.status !== "Completed", "13 single-period days over 13 active days must not complete Double");
    eq(r.completions.length, 0);
  });

  await test("Double completes when 13+ periods land within 7 active days", () => {
    const days = daySeq(iso(2026, 4, 1), 7);                    // 7 days × 2 periods = 14
    const r = H.runHAStateMachine(mapFrom(days, 2), days[0], days[6], { target: 13, maxBreak: 2, maxActiveDays: 7, mode: "time" });
    eq(r.status, "Completed");
    eq(r.completionDate, iso(2026, 4, 7));
    eq(r.periods, 14);
  });

  // ── Start-date optimiser: try every window start, not just the first ─────────
  // The greedy pass seizes the first active day as the window start; when that
  // start breaches (spending break budget on gaps that only exist because of it)
  // and the post-reset restart lands too late, a start *inside* the failed window
  // would still complete. The optimiser reports the earliest completion any start
  // can reach. (Deliberate departure from HA.md's single-forward-pass wording.)
  suite("HA: runHAStateMachine — start-date optimiser (best window start)");

  await test("Single qualifies via a later start when the earliest start breaches", () => {
    // Greedy seizes Jun 1, spends its 2 breaks on Jun 2-3, then Jun 5 is a 3rd
    // break ⇒ reset lands on Jun 7 with only 9 active days left ⇒ never qualifies.
    // Starting Jun 4: breaks Jun 5-6 (=2), then Jun 7-15 dense ⇒ Jun 4 + 9 = 10.
    const map = {};
    map[iso(2026, 6, 1)] = 1;
    map[iso(2026, 6, 4)] = 1;
    daySeq(iso(2026, 6, 7), 9).forEach(k => (map[k] = 1));     // Jun 7-15 dense
    const r = H.runHAStateMachine(map, iso(2026, 6, 1), iso(2026, 6, 15), { target: 10, maxBreak: 2, mode: "day" });
    eq(r.status, "Completed");
    eq(r.completionDate, iso(2026, 6, 15));
    eq(r.completions[0], iso(2026, 6, 15));
  });

  await test("Expanded qualifies via a later start that banks early active days", () => {
    // From Jun 1 the window spends all 5 break days across the sparse early run
    // and breaches on the 6th before reaching 14; greedy's post-reset start
    // (Jun 10) has only 12 active days. Starting Jun 5 banks Jun 5 + Jun 8 ahead
    // of the Jun 10-21 dense run ⇒ 14 active days ⇒ qualifies Jun 21.
    const map = {};
    map[iso(2026, 6, 1)] = 1;
    map[iso(2026, 6, 5)] = 1;
    map[iso(2026, 6, 8)] = 1;
    daySeq(iso(2026, 6, 10), 12).forEach(k => (map[k] = 1));   // Jun 10-21 dense
    const r = H.runHAStateMachine(map, iso(2026, 6, 1), iso(2026, 6, 21), { target: 14, maxBreak: 5, maxConsec: 3, mode: "day" });
    eq(r.status, "Completed");
    eq(r.completionDate, iso(2026, 6, 21));
  });

  await test("Double qualifies via a later 7-day window start with denser periods", () => {
    // Greedy starts Jun 1: Jun 1-7 fill the 7-active-day window with only 7
    // periods, then Jun 8 forces a slide that drops them ⇒ 12 periods, no
    // qualify. Starting Jun 3 captures the Jun 8-9 heavy sessions inside a 7-day
    // window ⇒ 17 periods ⇒ qualifies Jun 9.
    const map = {};
    daySeq(iso(2026, 6, 1), 7).forEach(k => (map[k] = 1));     // Jun 1-7, 1 period each
    map[iso(2026, 6, 8)] = 6;
    map[iso(2026, 6, 9)] = 6;
    const r = H.runHAStateMachine(map, iso(2026, 6, 1), iso(2026, 6, 9), { target: 13, maxBreak: 2, maxActiveDays: 7, mode: "time" });
    eq(r.status, "Completed");
    eq(r.completionDate, iso(2026, 6, 9));
  });

  // ── Bug 1: currency lapse + recovery ───────────────────────────────────────
  suite("HA: computeHACurrency — lapse & recovery (bug 1)");

  await test("worked example: 8 Jun pairs with 5 Jun ⇒ deadline moves to 22 Jun", () => {
    H.todayISO = () => iso(2026, 6, 10);                        // before the deadline
    const keys = [iso(2026, 6, 5), iso(2026, 6, 8)].sort();
    const r = H.computeHACurrency(keys, [iso(2026, 6, 5)]);
    eq(r.lapsed, false);
    eq(r.deadlineIso, iso(2026, 6, 22));
  });

  await test("Example 1: partner past Day 14 ⇒ lapsed at the deadline", () => {
    H.todayISO = () => iso(2026, 6, 6);
    const keys = [iso(2026, 6, 5), iso(2026, 6, 20)];          // 20 Jun > deadline 19 Jun
    const r = H.computeHACurrency(keys, [iso(2026, 6, 5)]);
    eq(r.lapsed, true);
    eq(r.lapseDateIso, iso(2026, 6, 19));
  });

  await test("no re-qualification ⇒ stays lapsed once today passes the deadline", () => {
    H.todayISO = () => iso(2026, 7, 15);
    const keys = daySeq(iso(2026, 6, 1), 10);                   // qualifies 10 Jun, deadline 24 Jun, then nothing
    const r = H.computeHACurrency(keys, [iso(2026, 6, 10)]);
    eq(r.lapsed, true);
    eq(r.lapseDateIso, iso(2026, 6, 24));
  });

  await test("re-qualification after a lapse RECOVERS currency", () => {
    H.todayISO = () => iso(2026, 7, 15);
    // Qualify 1-10 Jun (deadline 24 Jun), lapse, then a full fresh run 1-10 Jul.
    const keys = daySeq(iso(2026, 6, 1), 10).concat(daySeq(iso(2026, 7, 1), 10));
    const quals = [iso(2026, 6, 10), iso(2026, 7, 10)];
    const r = H.computeHACurrency(keys, quals);
    eq(r.lapsed, false);                                       // was permanently Lapsed before the fix
    eq(r.deadlineIso, iso(2026, 7, 24));                       // fresh window off the re-qualification
  });

  // ── computeHA integration ──────────────────────────────────────────────────
  suite("HA: computeHA integration (bugs 3 & 4)");

  function seed(rows, roster) {
    H.STATE.attendance = rows;
    H.STATE.roster = roster || [{ id: "0001", rank: "3SG" }];
    H.STATE.vocfit = [];
    H.STATE.conductDetail = [];
  }
  function att(dateIso, periods) {
    const [y, m, d] = dateIso.split("-").map(Number);
    const disp = `${String(d).padStart(2, "0")} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
    return { source: "csv", conductId: "C1", date: disp, participants: "0001", periods, currencyTags: "HA" };
  }

  await test("bug 3: Double does not reuse the pre-qualification Single sessions", () => {
    H.todayISO = () => iso(2026, 5, 20);
    // 10 days May 1-10, each 2 periods (20 periods total) earn Single by May 10.
    seed(daySeq(iso(2026, 5, 1), 10).map(k => att(k, 2)), [{ id: "0001", rank: "3SG" }]);
    const ha = H.computeHA("0001");
    eq(ha.overallStatus, "Single HA Complete");                // NOT "Double HA Complete"
    eq(ha.doubleEligible, true);                               // 3SG ⇒ rank-eligible
    eq(ha.doubleTrack.periods, 0);                             // no post-qualification activity counted
  });

  await test("bug 4: a re-qualified member is not stuck Lapsed", () => {
    H.todayISO = () => iso(2026, 7, 15);
    // Qualify May 1-10, lapse, re-qualify Jul 1-10 (enlistee ⇒ Double not in play).
    seed(daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1)).concat(daySeq(iso(2026, 7, 1), 10).map(k => att(k, 1))),
      [{ id: "0001", rank: "REC" }]);
    const ha = H.computeHA("0001");
    ok(ha.overallStatus !== "Lapsed", "re-qualified member should not be Lapsed");
    eq(ha.currency.lapsed, false);
  });

  await test("lapsed recruit's Single bar shows current re-qual window, not the historical 10", () => {
    H.todayISO = () => iso(2026, 7, 9);
    // Qualify Single May 1-10 (10 active days). Then a long gap (currency lapses,
    // deadline May 24). Then 3 recent active days Jul 6-8 — an in-progress re-qual.
    seed(
      daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1))
        .concat(daySeq(iso(2026, 7, 6), 3).map(k => att(k, 1))),
      [{ id: "0001", rank: "REC" }]
    );
    const ha = H.computeHA("0001");
    eq(ha.overallStatus, "Lapsed");                 // currency lapsed
    eq(ha.single.periods, 10);                      // historical completion count unchanged
    eq(ha.single.currentWindowPeriods, 3);          // current open re-qual window = 3 recent days
    eq(ha.expanded.currentWindowPeriods, 3);        // expanded track also reflects the recent run
  });

  await test("currentWindowPeriods resets after a break longer than maxBreak (no carry-over)", () => {
    H.todayISO = () => iso(2026, 7, 13);
    // Qualify May 1-10, lapse. Then a 2-day run (Jul 6-7), a 4-day break
    // (Jul 8-11 > Single maxBreak 2 ⇒ that window breaches), then a FRESH 2-day
    // run (Jul 12-13). The current open window is the fresh Jul 12-13 run = 2 —
    // it must NOT carry the earlier 2 over into a 4 (the break resets the count).
    seed(
      daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1))
        .concat(daySeq(iso(2026, 7, 6), 2).map(k => att(k, 1)))
        .concat(daySeq(iso(2026, 7, 12), 2).map(k => att(k, 1))),
      [{ id: "0001", rank: "REC" }]
    );
    const ha = H.computeHA("0001");
    eq(ha.overallStatus, "Lapsed");
    eq(ha.single.currentWindowPeriods, 2);   // fresh post-break window, not 4
  });

  // ── Report-sick leak: a disqualifying medical status must not earn an HA day ──
  // A recruit stays in a conduct's CSV participant list even when they were MC /
  // LD / RIB / Excuse-PT that day. haDayMap must drop those days (user rule,
  // 2026-07): MC/Warded, LD, RIB, Excuse PT disqualify; MR (a visit type, not a
  // status) and every other excuse still count — the recruit trained.
  suite("HA: medical status excludes HA credit (report-sick leak)");

  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const disp = i => { const [y, m, d] = i.split("-").map(Number); return `${String(d).padStart(2, "0")} ${MON[m - 1]} ${y}`; };
  function med(d4, status, startIso, endIso, type) {
    return { d4, status, type: type || "RSI", date: disp(startIso), startDate: disp(startIso), endDate: disp(endIso || startIso) };
  }
  // Three 1-period HA-eligible conducts on May 1/2/3, recruit 0001 present at all.
  function seedThreeDays(medical) {
    H.STATE.attendance = [att(iso(2026, 5, 1), 1), att(iso(2026, 5, 2), 1), att(iso(2026, 5, 3), 1)];
    H.STATE.medical = medical;
    H.STATE.conductDetail = [];
  }

  for (const status of ["MC", "Warded", "LD", "RIB (Rest in Bunk)", "Excuse PT"]) {
    await test(`${status} on May 2 removes only May 2 from the HA day-map`, () => {
      seedThreeDays([med("0001", status, iso(2026, 5, 2), iso(2026, 5, 2))]);
      eq(Object.keys(H.haDayMap("0001")).sort().join(","), [iso(2026, 5, 1), iso(2026, 5, 3)].join(","));
    });
  }

  await test("a multi-day MC drops every conduct inside its window", () => {
    seedThreeDays([med("0001", "MC", iso(2026, 5, 1), iso(2026, 5, 3))]);
    eq(Object.keys(H.haDayMap("0001")).length, 0);
  });

  for (const status of ["Excuse Kneeling", "NIL", "Pending"]) {
    await test(`${status} keeps the day — recruit still counts`, () => {
      seedThreeDays([med("0001", status, iso(2026, 5, 2), iso(2026, 5, 2))]);
      eq(Object.keys(H.haDayMap("0001")).length, 3);
    });
  }

  // MR is a visit *type* (RSI/RSO/MR), never a medical *status* — the MO always
  // assigns a real status (e.g. NIL) during an MR review, so haDayMap must look
  // only at `status` and ignore `type` when deciding whether a day disqualifies.
  await test("an MR-type visit with a non-disqualifying status keeps the day", () => {
    seedThreeDays([med("0001", "NIL", iso(2026, 5, 2), iso(2026, 5, 2), "MR")]);
    eq(Object.keys(H.haDayMap("0001")).length, 3);
  });

  await test("an MC for a DIFFERENT recruit does not touch 0001's days", () => {
    seedThreeDays([med("0002", "MC", iso(2026, 5, 2), iso(2026, 5, 2))]);
    eq(Object.keys(H.haDayMap("0001")).length, 3);
  });

  await test("an MC window that misses every conduct day changes nothing", () => {
    seedThreeDays([med("0001", "MC", iso(2026, 4, 20), iso(2026, 4, 25))]);
    eq(Object.keys(H.haDayMap("0001")).length, 3);
  });

  // ── HA activity grid helpers ─────────────────────────────────────────────
  suite("HA: haExcludedDayMap / haGridWeeks (activity grid)");

  await test("haExcludedDayMap returns the medically-excused day, and only that day", () => {
    seedThreeDays([med("0001", "MC", iso(2026, 5, 2), iso(2026, 5, 2))]);
    const excluded = H.haExcludedDayMap("0001");
    eq(Array.from(excluded).sort().join(","), iso(2026, 5, 2));
  });

  await test("haExcludedDayMap is empty when nothing disqualifies", () => {
    seedThreeDays([med("0001", "NIL", iso(2026, 5, 2), iso(2026, 5, 2))]);
    eq(H.haExcludedDayMap("0001").size, 0);
  });

  await test("haGridWeeks aligns to Monday and covers the requested range", () => {
    // 2026-05-06 is a Wednesday; 2026-05-08 is a Friday.
    const weeks = H.haGridWeeks(iso(2026, 5, 6), iso(2026, 5, 8));
    eq(weeks.length, 1);
    eq(weeks[0].monIso, iso(2026, 5, 4));           // Monday of that week
    eq(weeks[0].days.length, 7);
    eq(weeks[0].days[0], iso(2026, 5, 4));
    eq(weeks[0].days[6], iso(2026, 5, 10));         // Sunday
  });

  await test("haGridWeeks spans a month boundary without gaps or overlaps", () => {
    const weeks = H.haGridWeeks(iso(2026, 4, 28), iso(2026, 5, 5));
    // Flatten and check every day in range is present exactly once, in order.
    const allDays = weeks.flatMap(w => w.days);
    for (let i = 1; i < allDays.length; i++) {
      eq(H._haAddDays(allDays[i - 1], 1), allDays[i]);
    }
    ok(allDays.includes(iso(2026, 4, 28)), "range start day present");
    ok(allDays.includes(iso(2026, 5, 5)), "range end day present");
  });

  // ── HA-eligibility source (§14.3) + per-conduct HA tag toggle ─────────────
  // The active signal is Config `haEligibilitySource`. Production default is
  // now "currencyTag" (per-conduct `Currency Tags: HA` metadata), because the
  // name logic wrongly counted untagged conducts like "Combat PT" toward HA.
  suite("HA: eligibility source (§14.3) — currencyTag default + tag toggle");

  await test("state.js DEFAULT_CONFIG haEligibilitySource is currencyTag", () => {
    // state.js gets its own vm context: its top-level `const STATE` would
    // lexically shadow the helpers context's injected STATE stub otherwise.
    // It also reads localStorage eagerly (authToken seed), so stub that.
    const target = {
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
      RegExp, isNaN, parseInt, parseFloat, Symbol,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
    };
    const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "state.js"), "utf8"), ctx, { filename: "state.js" });
    eq(vm.runInContext('configGet("haEligibilitySource")', ctx), "currencyTag");
  });

  await test("untagged CSV conduct (the Combat PT case) earns no HA day under the tag source", () => {
    const row = att(iso(2026, 5, 1), 2);
    row.currencyTags = "";                              // Combat PT's actual import shape
    seed([row]);
    eq(Object.keys(H.haDayMap("0001")).length, 0);
  });

  await test("the HA tag is matched case-insensitively", () => {
    const row = att(iso(2026, 5, 1), 2);
    row.currencyTags = "ha";
    seed([row]);
    eq(Object.keys(H.haDayMap("0001")).length, 1);
  });

  await test("explicit isHAExcluded Config still uses the conduct-name logic", () => {
    const prevCfg = H.configGet;
    H.configGet = key => (key === "haEligibilitySource" ? "isHAExcluded" : undefined);
    try {
      const row = att(iso(2026, 5, 1), 2);
      row.currencyTags = "";                            // untagged, but name is fine
      seed([row]);
      eq(Object.keys(H.haDayMap("0001")).length, 1, "harmless name ⇒ eligible");
      const prevName = H.conductName;
      H.conductName = () => "IPPT 1";                   // excluded by name
      try { eq(Object.keys(H.haDayMap("0001")).length, 0, "IPPT name ⇒ excluded"); }
      finally { H.conductName = prevName; }
    } finally { H.configGet = prevCfg; }
  });

  await test("toggleHATag adds and removes the HA token, preserving other tags", () => {
    eq(H.toggleHATag(""), "HA");
    eq(H.toggleHATag("HA"), "");
    eq(H.toggleHATag("ha"), "");                        // case-insensitive removal
    eq(H.toggleHATag("HA, RM"), "RM");
    eq(H.toggleHATag("RM"), "RM, HA");
    eq(H.toggleHATag(undefined), "HA");                 // wizard rows have no tags field
  });

  await test("toggleHATag removal agrees with conductHAEligible for space-separated tags", () => {
    // conductHAEligible reads /\bha\b/i, so "HA RM" (space-separated, no comma)
    // shows as HA ✓. The toggle-off must actually strip HA — an exact-token
    // matcher would miss it and append a second HA instead of removing it.
    eq(/\bha\b/i.test("HA RM"), true, "guard: the reader treats 'HA RM' as HA-eligible");
    eq(H.toggleHATag("HA RM"), "RM");                   // removed, not doubled
    eq(H.toggleHATag("RM HA"), "RM");
    eq(H.toggleHATag("RM, HA, SW"), "RM, SW");          // strips the middle token
    // After removal the row is no longer HA-eligible under the reader.
    eq(/\bha\b/i.test(H.toggleHATag("HA RM")), false, "removal leaves no HA word");
  });

  // ── haCountsRow — wizard-row HA gate (Log Conduct wizard HA checkbox) ────────
  // Wizard rows are shape-identical to CSV rows (source/currencyTags/periods),
  // but must count IFF the wizard's "Counts toward HA" checkbox stamped the HA
  // token — never via the configured haEligibilitySource (that config is a
  // CSV-only legacy knob). Legacy wizard rows (source "") never count.
  suite("HA: haCountsRow — wizard-row gate (Log Conduct wizard HA checkbox)");

  function wizAtt(dateIso, overrides) {
    const [y, m, d] = dateIso.split("-").map(Number);
    const disp = `${String(d).padStart(2, "0")} ${MON[m - 1]} ${y}`;
    return Object.assign({ source: "wizard", conductId: "C1", date: disp, participants: "1234", currencyTags: "HA", periods: 2 }, overrides);
  }

  await test("ticked wizard row credits the day with its stored periods", () => {
    seed([wizAtt(iso(2026, 5, 1))]);
    const map = H.haDayMap("1234");
    eq(Object.keys(map).length, 1);
    eq(map[iso(2026, 5, 1)], 2);
  });

  await test("wizard row with empty currencyTags does not count", () => {
    seed([wizAtt(iso(2026, 5, 1), { currencyTags: "" })]);
    eq(Object.keys(H.haDayMap("1234")).length, 0);
  });

  await test("legacy wizard row (source '') never counts, even tagged HA", () => {
    seed([wizAtt(iso(2026, 5, 1), { source: "" })]);
    eq(Object.keys(H.haDayMap("1234")).length, 0);
  });

  await test("ticked wizard row counts even when Config uses the legacy isHAExcluded source", () => {
    const prevCfg = H.configGet;
    H.configGet = key => (key === "haEligibilitySource" ? "isHAExcluded" : undefined);
    try {
      seed([wizAtt(iso(2026, 5, 1))]);
      eq(Object.keys(H.haDayMap("1234")).length, 1, "checkbox pierces the legacy name-config");
    } finally { H.configGet = prevCfg; }
  });

  // ── haProjection — minimum days to attain Single HA + projected days ─────────
  suite("HA: haProjection — minimum days to Single HA");

  await test("not started ⇒ 10 days, projected from tomorrow", () => {
    H.todayISO = () => iso(2026, 5, 1);
    seed([], [{ id: "0001", rank: "REC" }]);
    const proj = H.haProjection(H.computeHA("0001"));
    eq(proj.attained, false);
    eq(proj.days, 10);
    eq(proj.projectedDates.length, 10);
    eq(proj.projectedDates[0], iso(2026, 5, 2));                  // tomorrow
    eq(proj.projectedDates[9], iso(2026, 5, 11));
  });

  await test("in progress (4 periods, window alive) ⇒ 6 days remaining", () => {
    // Active May 1-4, today May 6 (2 breaks — window not yet reset) ⇒ periods 4.
    H.todayISO = () => iso(2026, 5, 6);
    seed(daySeq(iso(2026, 5, 1), 4).map(k => att(k, 1)), [{ id: "0001", rank: "REC" }]);
    const ha = H.computeHA("0001");
    eq(ha.single.periods, 4);
    const proj = H.haProjection(ha);
    eq(proj.attained, false);
    eq(proj.days, 6);
    eq(proj.projectedDates.length, 6);
    eq(proj.projectedDates[0], iso(2026, 5, 7));
  });

  await test("Single complete ⇒ attained, 0 days, no projection", () => {
    H.todayISO = () => iso(2026, 5, 15);
    seed(daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1)), [{ id: "0001", rank: "REC" }]);
    const proj = H.haProjection(H.computeHA("0001"));
    eq(proj.attained, true);
    eq(proj.days, 0);
    eq(proj.projectedDates.length, 0);
  });

  await test("lapsed member still counts as attained (currency is separate)", () => {
    H.todayISO = () => iso(2026, 7, 15);                          // long past the deadline
    seed(daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1)), [{ id: "0001", rank: "REC" }]);
    const ha = H.computeHA("0001");
    eq(ha.singleStatus, "Lapsed");
    const proj = H.haProjection(ha);
    eq(proj.attained, true);
    eq(proj.days, 0);
  });

  // ── haProjection.double — earliest projected Double HA completion ─────────────
  // Seeded from the live state machine (post-Single-qual periods + 7-active-day
  // window), assuming the standard 2-period Double session daily from tomorrow.
  suite("HA: haProjection — Double track projection");

  await test("double is null until Single is complete", () => {
    H.todayISO = () => iso(2026, 5, 6);
    seed(daySeq(iso(2026, 5, 1), 4).map(k => att(k, 1)), [{ id: "0001", rank: "3SG" }]);
    eq(H.haProjection(H.computeHA("0001")).double, null);
  });

  await test("double is null when Single is complete but the member is not eligible (enlistee)", () => {
    H.todayISO = () => iso(2026, 5, 15);
    seed(daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1)), [{ id: "0001", rank: "REC" }]);
    eq(H.haProjection(H.computeHA("0001")).double, null);
  });

  await test("Single-complete + eligible ⇒ 7 fresh days at 2 periods/day", () => {
    H.todayISO = () => iso(2026, 5, 15);
    seed(daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1)), [{ id: "0001", rank: "3SG" }]);
    const proj = H.haProjection(H.computeHA("0001"));
    ok(proj.double, "double projection present");
    eq(proj.double.relevant, true);
    eq(proj.double.attained, false);
    eq(proj.double.reachable, true);
    eq(proj.double.days, 7);                                      // fresh window: 7×2 = 14 ≥ 13
    eq(proj.double.dateIso, iso(2026, 5, 22));
    eq(proj.double.projectedDates.length, 7);
    eq(proj.double.projectedDates[0], iso(2026, 5, 16));          // tomorrow
  });

  await test("banked post-qual periods shorten the remaining Double days", () => {
    H.todayISO = () => iso(2026, 5, 13);
    // Single May 1-10, then two Double sessions May 11-12 (2 periods each = 4 banked).
    const rows = daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1))
      .concat([att(iso(2026, 5, 11), 2), att(iso(2026, 5, 12), 2)]);
    seed(rows, [{ id: "0001", rank: "3SG" }]);
    const ha = H.computeHA("0001");
    eq(ha.doubleTrack.periods, 4);                               // banked in the live window
    const proj = H.haProjection(ha);
    eq(proj.double.days, 5);                                     // ceil((13−4)/2) = 5 more days
    eq(proj.double.dateIso, iso(2026, 5, 18));                   // today May 13 + 5
  });

  await test("already-complete Double ⇒ attained, 0 days", () => {
    H.todayISO = () => iso(2026, 5, 20);
    // Single May 1-10, then a full Double May 11-17 (7 days × 2 = 14 ≥ 13).
    const rows = daySeq(iso(2026, 5, 1), 10).map(k => att(k, 1))
      .concat(daySeq(iso(2026, 5, 11), 7).map(k => att(k, 2)));
    seed(rows, [{ id: "0001", rank: "3SG" }]);
    const ha = H.computeHA("0001");
    eq(ha.doubleStatus, "Double HA Complete");
    const proj = H.haProjection(ha);
    eq(proj.double.attained, true);
    eq(proj.double.days, 0);
  });
};
