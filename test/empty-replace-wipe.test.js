// Regression suite for the full-sheet wipe (PR #145, reverted as #147).
//
// The wipe needed four things to line up, and each is guarded independently
// here so that removing any ONE of them is still enough to save the sheet:
//
//   1. A device whose cached row arrays were empty while STATE.dirty still
//      named tabs. DIRTY_KEY lives OUTSIDE the cached blob on purpose
//      (state.js: "must outlive a cache wipe"), so anything that stops the blob
//      loading — the encrypted-cache work, a cleared key, a quota error —
//      produces exactly this pairing.
//   2. pullAll deliberately SKIPS dirty tabs and holds their stale rev, so the
//      launch pull could not repair the empty arrays. It preserved them.
//   3. retryAllDirty's no-stashed-ops fallback pushed STATE[arrKey] as a full
//      replace behind an `if (arrKey && STATE[arrKey])` guard — and [] is
//      truthy, so the guard passed an empty array straight through.
//   4. rev lives INSIDE the cached blob, so baseRev was undefined, and
//      withRevLock's "missing baseRev = old client, skip the check" branch waved
//      the write past OCC into writeTab's delete-every-row path.
//
// Tests 1-2 are the frontend guards, 3-5 the backend ones. Test 6 is the
// end-to-end reproduction through the real launch path.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient, VALID_TOKEN } = require("./harness");

const MED_HEADERS = ["id", "d4", "date", "reason", "location", "status", "startDate", "endDate"];
const medRow = id => [String(id), "11" + id, "", "r" + id, "", "", "", ""];

function writeVia(backend, body) {
  const out = backend.doPost({
    parameter: {},
    postData: { contents: JSON.stringify(Object.assign({ auth: VALID_TOKEN }, body)) }
  });
  return JSON.parse(out.getContent());
}

module.exports = async function run() {
  suite("empty-replace wipe guards");

  // ── 1. The reproduction, at the layer that actually fired it ────────────
  // A device reloads: DIRTY_KEY survived, the cached rows did not. The user
  // clicks OK on the launch "N tabs have unpushed changes — push now?" prompt.
  await test("retryAllDirty does not push an empty array when the local cache is empty", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2), medRow(3)]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    // Reproduce the post-reload state: dirty marker present (its own key),
    // rows and rev gone (they were in the blob that failed to load).
    A.sb.markDirty("Medical");
    A.sb.STATE.medical = [];
    A.sb.STATE.rev = {};

    await A.sb.retryAllDirty();

    eq(backend.db.rowsOf("Medical").length, 3, "all three rows survive the retry");
  });

  // The same guard must not fire on the legitimate case it superficially
  // resembles: a session that really did delete every row, where the deletes
  // were stashed as granular ops and replay surgically.
  await test("retryAllDirty still replays stashed granular deletes down to an empty tab", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1)]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    // A delete that failed to push (offline) is stashed as a granular op, so the
    // retry replays THAT rather than falling back to a full replace.
    const online = A.sb.fetch;
    A.sb.fetch = async () => { throw new Error("offline"); };
    A.sb.STATE.medical = [];
    await A.sb.autoSync("Medical", { type: "delete", id: "1" });
    A.sb.fetch = online;
    ok(A.sb.STATE.dirty.has("Medical"), "the failed delete marked the tab dirty");

    await A.sb.retryAllDirty();

    eq(backend.db.rowsOf("Medical").length, 0, "the row is gone — a real emptying still works");
    eq(A.sb.STATE.dirty.size, 0, "and the tab is clean again");
  });

  // ── 2. pushTab: the same empty array from the manual "Re-push all" button ──
  // Here the user is present, so this asks instead of refusing — but it asks
  // before deleting, which is the part that was missing.
  await test("pushTab does not empty a populated tab when the user declines", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2)]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    A.sb.STATE.medical = [];
    A.ctl.confirm = false;                 // "Cancel = leave the sheet alone"

    await A.sb.pushTab("Medical", A.sb.STATE.medical);

    eq(backend.db.rowsOf("Medical").length, 2, "rows survive an accidental empty re-push");
  });

  await test("pushTab still clears a tab when the user confirms the deletion", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2)]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    A.sb.STATE.medical = [];
    A.ctl.confirm = true;                  // "OK = delete them"

    await A.sb.pushTab("Medical", A.sb.STATE.medical);

    eq(backend.db.rowsOf("Medical").length, 0, "a deliberate clear still works end to end");
  });

  // ── 3. Backend: a full-tab write with no baseRev is a client bug ─────────
  // The "missing baseRev = old cached client, skip the check" branch is what
  // let the empty write past OCC. Granular writes (enforce=false) never
  // consulted baseRev anyway, so tightening `write` costs them nothing.
  await test("backend rejects a full-tab write that carries no baseRev", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2)]);

    const res = writeVia(backend, { action: "write", tab: "Medical", data: [] });

    ok(res.conflict, "no baseRev is treated as a conflict, not as an old client");
    eq(backend.db.rowsOf("Medical").length, 2, "and nothing was deleted");
  });

  await test("backend still accepts a full-tab write whose baseRev is current", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1)]);
    const rev = writeVia(backend, { action: "revCheck" }).revs.Medical;

    const res = writeVia(backend, {
      action: "write", tab: "Medical", baseRev: rev, data: [{ id: "9", d4: "1109", reason: "new" }]
    });

    ok(res.ok, "a correctly-based write still lands");
    eq(backend.db.rowsOf("Medical").map(r => String(r.id)), ["9"], "and replaced the contents");
  });

  // ── 4. Backend: emptying a tab must be asked for, not inferred ───────────
  // writeTab treats data:[] as "delete every data row". That IS a real
  // operation (cascade-deleting a conduct's last records), but an empty array
  // arriving by accident is indistinguishable from one arriving on purpose —
  // so purpose has to be stated.
  await test("backend refuses to empty a tab unless the write opts in", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2)]);
    const rev = writeVia(backend, { action: "revCheck" }).revs.Medical;

    const res = writeVia(backend, { action: "write", tab: "Medical", baseRev: rev, data: [] });

    ok(res.error, "refused with an error");
    eq(backend.db.rowsOf("Medical").length, 2, "rows untouched");
  });

  await test("backend empties a tab when the write says allowEmpty", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2)]);
    const rev = writeVia(backend, { action: "revCheck" }).revs.Medical;

    const res = writeVia(backend, {
      action: "write", tab: "Medical", baseRev: rev, data: [], allowEmpty: true
    });

    ok(res.ok, "the deliberate empty replace is honoured");
    eq(backend.db.rowsOf("Medical").length, 0, "tab cleared");
  });

  // ── 4b. The flag has to survive the trip from call site to backend ───────
  // deleteConduct's cascade and deleteDutyHoliday both legitimately reduce a
  // tab to zero rows and push through autoSync, not pushTab — so `allowEmpty`
  // has to thread mode → runWrite → API.pushTab → request body, or those
  // deletions silently stop working.
  await test("a replace marked allowEmpty clears the tab through autoSync", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2)]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    await A.sb.autoSync("Medical", { type: "replace", data: [], allowEmpty: true });

    eq(backend.db.rowsOf("Medical").length, 0, "the deliberate cascade delete lands");
    eq(A.sb.STATE.dirty.size, 0, "and is not left dirty");
  });

  await test("a replace without allowEmpty leaves the tab alone and goes dirty", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2)]);
    const A = makeClient(backend);
    await A.sb.API.pullAll();

    await A.sb.autoSync("Medical", { type: "replace", data: [] });

    eq(backend.db.rowsOf("Medical").length, 2, "rows survive");
    ok(A.sb.STATE.dirty.has("Medical"), "the refusal surfaces as unsaved rather than passing silently");
  });

  // ── 5. End-to-end: the launch path that actually wiped the sheet ─────────
  // Everything above tests one layer. This drives the whole thing: a real
  // client, a real backend, dirty markers restored from their own key, cached
  // rows absent — the exact shape a device had after the encrypted cache
  // failed to open.
  await test("a reload with dirty markers but no cached rows cannot wipe the sheet", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, [medRow(1), medRow(2), medRow(3)]);
    backend.db.seed("Roster", ["id", "name"], [["1", "One"], ["2", "Two"]]);

    const A = makeClient(backend);
    // Post-reload: dirty from the previous session, nothing else restored.
    A.sb.markDirty("Medical");
    A.sb.markDirty("Roster");

    // The launch pull runs — and by design refuses to repair a dirty tab.
    await A.sb.API.pullAll();
    eq(A.sb.STATE.medical.length, 0, "pullAll left the dirty tab empty, as it is designed to");

    // The user clicks OK on the restore prompt.
    await A.sb.retryAllDirty();

    eq(backend.db.rowsOf("Medical").length, 3, "Medical intact");
    eq(backend.db.rowsOf("Roster").length, 2, "Roster intact");
  });
};
