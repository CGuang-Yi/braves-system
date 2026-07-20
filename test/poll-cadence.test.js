// SYNC_PERF_IMPROVEMENTS_SPEC.md P4-1 — adaptive revCheck cadence.
//
// The poll relaxes from 20s to 60s after a run of consecutive no-change polls, and
// snaps back to 20s on ANY sign of activity. The behaviour is asserted by driving
// autoRefreshTick() directly (as the rest of the sync suite does) and reading the
// sandbox's own module state — the harness stubs setInterval to a no-op, so the
// timer itself isn't the thing under test here; the cadence DECISION is.
//
// Why this is worth locking down: relaxing a user-chosen cadence was approved only
// on the condition that the slower interval is user-visible (spec §7 Q2), so the
// reset paths matter as much as the stretch — a cadence that relaxed and then
// failed to recover would quietly degrade freshness, which is exactly what the
// user's condition was guarding against.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient } = require("./harness");

const MED_HEADERS = ["id", "d4", "date", "reason", "location", "status", "startDate", "endDate"];
const med = (id, reason) => ({ id, d4: "11" + id, date: "", reason, location: "", status: "", startDate: "", endDate: "" });

// Poll N times with nothing changing on the server.
async function quietPolls(client, n) {
  for (let i = 0; i < n; i++) {
    client.sb._lastCheckedAt = null;   // bypass the 8s focus/visibility debounce
    await client.sb.autoRefreshTick("interval");
  }
}

module.exports = async function run() {
  suite("P4-1: adaptive poll cadence");

  await test("stays at the responsive cadence until the no-change streak threshold is reached", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    await quietPolls(A, A.sb.pollCadenceInfo().idleAfter - 1);
    eq(A.sb.pollCadenceInfo().relaxed, false, "one poll short of the threshold → still on the 20s cadence");

    await quietPolls(A, 1);
    eq(A.sb.pollCadenceInfo().relaxed, true, "threshold reached → relaxed to the idle cadence");
  });

  await test("a changed tab snaps the cadence back and clears the streak", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();

    await quietPolls(A, A.sb.pollCadenceInfo().idleAfter);
    eq(A.sb.pollCadenceInfo().relaxed, true, "relaxed after the quiet run");

    await B.sb.autoSync("Medical", { type: "upsert", row: med(1, "B-fresh") });
    A.sb._lastCheckedAt = null;
    await A.sb.autoRefreshTick("interval");

    eq(A.sb.pollCadenceInfo().relaxed, false, "a real change returns the poll to 20s");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "1"), "and the changed row actually landed");
  });

  await test("a local write resets the cadence even with no server-side change", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    await quietPolls(A, A.sb.pollCadenceInfo().idleAfter);
    eq(A.sb.pollCadenceInfo().relaxed, true, "relaxed after the quiet run");

    await A.sb.autoSync("Medical", { type: "upsert", row: med(9, "local edit") });
    eq(A.sb.pollCadenceInfo().relaxed, false, "the user is clearly active — back to the responsive cadence");
  });

  await test("the streak restarts from zero after a reset, so one quiet poll doesn't immediately re-relax", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    await quietPolls(A, A.sb.pollCadenceInfo().idleAfter);
    await A.sb.autoSync("Medical", { type: "upsert", row: med(9, "local edit") });   // reset
    await quietPolls(A, 1);

    eq(A.sb.pollCadenceInfo().relaxed, false, "a single quiet poll after a reset must not re-trigger the stretch");
  });

  await test("the relaxed interval is longer than the responsive one, and both are sane", () => {
    const backend = loadBackend();
    const A = makeClient(backend);
    ok(A.sb.pollCadenceInfo().idleMs > A.sb.pollCadenceInfo().activeMs, "idle cadence is slower than the active one");
    eq(A.sb.pollCadenceInfo().activeMs, 20000, "the user-chosen 20s active cadence is unchanged");
    ok(A.sb.pollCadenceInfo().idleAfter >= 2, "needs a genuine run of quiet polls, not a single one");
  });
};
