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
  target.configGet = () => undefined;                 // → default "isHAExcluded" path
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
    return { source: "csv", conductId: "C1", date: disp, participants: "0001", periods, currencyTags: "" };
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

  for (const status of ["MR", "Excuse Kneeling", "NIL", "Pending"]) {
    await test(`${status} keeps the day — recruit still counts`, () => {
      seedThreeDays([med("0001", status, iso(2026, 5, 2), iso(2026, 5, 2), status === "MR" ? "MR" : "RSI")]);
      eq(Object.keys(H.haDayMap("0001")).length, 3);
    });
  }

  await test("an MC for a DIFFERENT recruit does not touch 0001's days", () => {
    seedThreeDays([med("0002", "MC", iso(2026, 5, 2), iso(2026, 5, 2))]);
    eq(Object.keys(H.haDayMap("0001")).length, 3);
  });

  await test("an MC window that misses every conduct day changes nothing", () => {
    seedThreeDays([med("0001", "MC", iso(2026, 4, 20), iso(2026, 4, 25))]);
    eq(Object.keys(H.haDayMap("0001")).length, 3);
  });
};
