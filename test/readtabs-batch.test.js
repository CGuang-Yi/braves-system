// Tests for SYNC_PERF_IMPROVEMENTS_SPEC.md P2-1: the batched `readTabs` action.
//
//   Backend suite: exercises the real apps-script-Code.gs doGet directly
//   (loadBackend() + b.doGet(...)) — same pattern as test/perf-p2.test.js.
//
//   Frontend suite: exercises the real js/api.js pullTabs() through the
//   full-stack harness (test/harness.js). The shared harness's mock fetch DOES
//   forward a `tabs` query param through to doGet (so every other multi-tab
//   integration test in the suite exercises the batched readTabs path by
//   default, matching what a redeployed backend does in production) — so
//   readTabs works against the vanilla harness with NO patching, and only the
//   "not-yet-redeployed backend" fallback tests need a local fetch override
//   that deliberately fails/rejects `action=readTabs` (added here, scoped to
//   this file — harness.js itself stays generic).
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient, VALID_TOKEN } = require("./harness");

const AUDIT_HEADERS = ["timestamp", "email", "personId", "role", "action", "target", "detail", "tokenPrefix"];
const MED_HEADERS = ["id", "d4", "date", "reason", "location", "status", "startDate", "endDate"];
const med = (id, reason) => ({ id, d4: "11" + id, date: "", reason, location: "", status: "", startDate: "", endDate: "" });
const ROSTER_HEADERS = ["id", "d4", "name"];

// Local fetch override that DOES forward `tabs`, wired straight to the real
// backend object — a faithful stand-in for "the redeployed backend is live"
// without touching the shared harness.js mock.
function patchTabsAwareFetch(client, backend) {
  client.sb.fetch = async (url, init) => {
    const method = (init && init.method ? init.method : "GET").toUpperCase();
    let out, rec;
    if (method === "GET") {
      const u = new URL(url);
      const q = {
        action: u.searchParams.get("action") || "",
        tab: u.searchParams.get("tab") || "",
        tabs: u.searchParams.get("tabs") || "",
        auth: u.searchParams.get("auth") || ""
      };
      rec = { method: "GET", action: q.action, tab: q.tab, tabs: q.tabs };
      out = backend.doGet({ parameter: q });
    } else {
      const body = JSON.parse(init.body);
      rec = { method: "POST", action: body.action, tab: body.tab };
      out = backend.doPost({ parameter: {}, postData: { contents: init.body } });
    }
    client.fetchSpy.push(rec);
    const text = out.getContent();
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
}

// Fetch override that forwards action/tab/auth to the REAL current backend
// but deliberately drops `tabs` — the shape of "the client is talking to a
// backend deployment that doesn't understand ?tabs=…" (e.g. mid-rollout, one
// tab still on an older Apps Script version). Hitting the CURRENT doGet's
// `action === "readTabs" && e.parameter.tabs` guard with tabs missing falls
// through to its generic "Unknown action" branch — a genuine response from
// today's real code, not a hardcoded stand-in — so this proves the fallback
// also works against the exact error text the live backend produces, not
// just the older wording patchFetchSimulateOldBackend below hardcodes.
function patchFetchDropTabsParam(client, backend) {
  client.sb.fetch = async (url, init) => {
    const method = (init && init.method ? init.method : "GET").toUpperCase();
    let out, rec;
    if (method === "GET") {
      const u = new URL(url);
      const q = {
        action: u.searchParams.get("action") || "",
        tab: u.searchParams.get("tab") || "",
        auth: u.searchParams.get("auth") || ""
        // tabs deliberately omitted
      };
      rec = { method: "GET", action: q.action, tab: q.tab };
      out = backend.doGet({ parameter: q });
    } else {
      const body = JSON.parse(init.body);
      rec = { method: "POST", action: body.action, tab: body.tab };
      out = backend.doPost({ parameter: {}, postData: { contents: init.body } });
    }
    client.fetchSpy.push(rec);
    const text = out.getContent();
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
}

// Wraps a tabs-aware fetch so any `readTabs` request gets the exact
// unknown-action error an OLDER, not-yet-redeployed backend would send (the
// pre-P2-1 message, which doesn't even mention readTabs) — proving the
// client's fallback detection isn't accidentally coupled to today's exact
// error wording.
function patchFetchSimulateOldBackend(client, backend) {
  patchTabsAwareFetch(client, backend);
  const inner = client.sb.fetch;
  client.sb.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.searchParams.get("action") === "readTabs") {
      client.fetchSpy.push({ method: "GET", action: "readTabs", tabs: u.searchParams.get("tabs") });
      return {
        ok: true, status: 200,
        json: async () => ({ error: "Unknown action. Use: readAll, revCheck, read&tab=TabName, or ping" })
      };
    }
    return inner(url, init);
  };
}

module.exports = async function run() {
  // ── Backend: doGet action=readTabs ────────────────────────────────────
  suite("P2-1 backend: doGet action=readTabs");

  await test("returns per-tab {rows,rev} matching what single-tab `read` returns for the same tabs", () => {
    const b = loadBackend();
    b.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    b.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "fever", "", "", "", ""]]);
    b.bumpRev("Medical");

    const single = JSON.parse(b.doGet({ parameter: { action: "read", tab: "Roster", auth: VALID_TOKEN } }).getContent());
    const singleMed = JSON.parse(b.doGet({ parameter: { action: "read", tab: "Medical", auth: VALID_TOKEN } }).getContent());
    const batch = JSON.parse(b.doGet({ parameter: { action: "readTabs", tabs: "Roster,Medical", auth: VALID_TOKEN } }).getContent());

    ok(batch.ok, "ok:true");
    eq(batch.tabs.Roster.rows, single.rows, "Roster rows identical to single read");
    eq(batch.tabs.Roster.rev, single.rev, "Roster rev identical to single read");
    eq(batch.tabs.Medical.rows, singleMed.rows, "Medical rows identical to single read");
    eq(batch.tabs.Medical.rev, singleMed.rev, "Medical rev identical to single read (post-bump)");
  });

  await test("unknown tab name → same not-found shape as single `read` (nested in rows)", () => {
    const b = loadBackend();
    const single = JSON.parse(b.doGet({ parameter: { action: "read", tab: "Nope", auth: VALID_TOKEN } }).getContent());
    const batch = JSON.parse(b.doGet({ parameter: { action: "readTabs", tabs: "Nope", auth: VALID_TOKEN } }).getContent());
    ok(batch.ok, "ok:true even though the one tab inside is bad — shape stays composable");
    eq(batch.tabs.Nope.rows, single.rows, "same {error, available} not-found shape nested under rows");
    eq(batch.tabs.Nope.rev, single.rev, "untracked tab rev still reports 1, same as single read");
  });

  await test("gating: non-admin requesting AuditLog in a batch → that tab rejected exactly like single `read`, others still delivered", () => {
    const b = loadBackend();
    b.db.setProp("auth:viewertok", JSON.stringify({
      email: "viewer@example.com", personId: "0099", role: "viewer", issuedAt: new Date().toISOString()
    }));
    b.db.seed("AuditLog", AUDIT_HEADERS, [["2026-01-01T00:00:00.000Z", "a@x.com", "0001", "admin", "act", "", "", "tok12345"]]);
    b.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "fever", "", "", "", ""]]);

    const singleAudit = JSON.parse(b.doGet({ parameter: { action: "read", tab: "AuditLog", auth: "viewertok" } }).getContent());
    const batch = JSON.parse(b.doGet({ parameter: { action: "readTabs", tabs: "AuditLog,Medical", auth: "viewertok" } }).getContent());

    ok(batch.ok, "batch itself still succeeds (per-tab gating, not whole-request rejection)");
    eq(batch.tabs.AuditLog.error, singleAudit.error, "AuditLog rejected with the SAME error text as the single-tab route");
    eq(batch.tabs.AuditLog.code, singleAudit.code, "AuditLog rejected with the SAME code (403) as the single-tab route");
    ok(!batch.tabs.AuditLog.rows, "no AuditLog rows leaked to a non-admin");
    ok(Array.isArray(batch.tabs.Medical.rows), "Medical (non-gated) still delivered in the same batch");
    eq(batch.tabs.Medical.rows.length, 1, "Medical row present");
  });

  await test("gating: Accounts always rejected, even for an admin token", () => {
    const b = loadBackend();
    const batch = JSON.parse(b.doGet({ parameter: { action: "readTabs", tabs: "Accounts", auth: VALID_TOKEN } }).getContent());
    eq(batch.tabs.Accounts.error, "Not authorised", "Accounts rejected for admin too — never exposes hashes via raw read");
    eq(batch.tabs.Accounts.code, 403);
  });

  await test("readTabs with no ?tabs param falls through to the generic Unknown action error (mirrors `read` with no ?tab)", () => {
    const b = loadBackend();
    const noTab = JSON.parse(b.doGet({ parameter: { action: "read", auth: VALID_TOKEN } }).getContent());
    const noTabs = JSON.parse(b.doGet({ parameter: { action: "readTabs", auth: VALID_TOKEN } }).getContent());
    ok(/Unknown action/.test(noTab.error), "read with no tab → unknown action (existing behaviour)");
    ok(/Unknown action/.test(noTabs.error), "readTabs with no tabs → unknown action, same family");
  });

  // ── Frontend: js/api.js pullTabs() ────────────────────────────────────
  suite("P2-1 frontend: API.pullTabs batches 2+ tabs into one readTabs request");

  await test("2+ tab pull against a readTabs-capable backend → exactly ONE network request, STATE updated same as per-tab loop would produce", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(1, "B-fresh") });
    await B.sb.autoSync("Roster", { type: "upsert", row: { id: 1, d4: "1101", name: "Renamed" } });

    patchTabsAwareFetch(A, backend);
    A.fetchSpy.length = 0;
    const result = await A.sb.API.pullTabs(["Roster", "Medical"]);

    eq(A.fetchSpy.length, 1, "exactly one network request");
    eq(A.fetchSpy[0].action, "readTabs", "…and it's the batched action");
    ok(result.changed, "reports changed");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "1" && r.reason === "B-fresh"), "Medical row landed in STATE");
    ok(A.sb.STATE.roster.find(r => r.name === "Renamed"), "Roster row landed in STATE");
    ok(A.sb.STATE.rev.Medical >= 2, "Medical rev advanced");
    ok(A.sb.STATE.rev.Roster >= 2, "Roster rev advanced");
  });

  await test("single-tab pull is unchanged — still uses the single-tab `read` action, not readTabs", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(1, "B-fresh") });

    A.fetchSpy.length = 0;   // deliberately NOT patched — proves single-tab never even attempts readTabs
    const result = await A.sb.API.pullTabs(["Medical"]);

    eq(A.fetchSpy.length, 1, "exactly one request");
    eq(A.fetchSpy[0].action, "read", "single tab still uses plain `read`");
    eq(A.fetchSpy[0].tab, "Medical");
    ok(result.changed, "reports changed");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "1"), "row landed");
  });

  await test("fallback (against today's real backend, tabs param dropped): readTabs w/o ?tabs hits the CURRENT doGet's own Unknown-action branch → pullTabs silently falls back to per-tab GETs, same final STATE", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(1, "B-fresh") });
    await B.sb.autoSync("Roster", { type: "upsert", row: { id: 1, d4: "1101", name: "Renamed" } });

    patchFetchDropTabsParam(A, backend);   // forwards everything to the real doGet EXCEPT ?tabs
    A.fetchSpy.length = 0;
    const result = await A.sb.API.pullTabs(["Roster", "Medical"]);

    const actions = A.fetchSpy.map(r => r.action);
    eq(actions.filter(a => a === "readTabs").length, 1, "one attempted (and rejected) readTabs request");
    eq(actions.filter(a => a === "read").length, 2, "fell back to one `read` per tab");
    ok(result.changed, "still reports changed");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "1" && r.reason === "B-fresh"), "Medical landed via fallback");
    ok(A.sb.STATE.roster.find(r => r.name === "Renamed"), "Roster landed via fallback");
  });

  await test("fallback (explicit): backend returns the OLDER pre-P2-1 unknown-action wording (no mention of readTabs) → same silent fallback", async () => {
    const backend = loadBackend();
    backend.db.seed("Medical", MED_HEADERS, []);
    backend.db.seed("IPPT", ["id", "d4"], []);
    const A = makeClient(backend), B = makeClient(backend);
    await A.sb.API.pullAll();
    await B.sb.API.pullAll();
    await B.sb.autoSync("Medical", { type: "upsert", row: med(1, "B-fresh") });

    patchFetchSimulateOldBackend(A, backend);
    A.fetchSpy.length = 0;
    const result = await A.sb.API.pullTabs(["Medical", "IPPT"]);

    const actions = A.fetchSpy.map(r => r.action);
    eq(actions[0], "readTabs", "tried the batch first");
    eq(actions.filter(a => a === "read").length, 2, "fell back to per-tab reads for both tabs");
    ok(result.changed, "changed still reported");
    ok(A.sb.STATE.medical.find(r => String(r.id) === "1" && r.reason === "B-fresh"), "Medical landed via fallback");
  });

  await test("mixed-gating batch through the client doesn't throw and still lands the deliverable tab (AuditLog isn't a STATE-array tab, so it's silently skipped like any unrecognized key)", async () => {
    const backend = loadBackend();
    backend.db.setProp("auth:viewertok2", JSON.stringify({
      email: "viewer2@example.com", personId: "0098", role: "viewer", issuedAt: new Date().toISOString()
    }));
    backend.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "fever", "", "", "", ""]]);
    backend.db.seed("AuditLog", AUDIT_HEADERS, [["2026-01-01T00:00:00.000Z", "a@x.com", "0001", "admin", "act", "", "", "tok12345"]]);

    const V = makeClient(backend, { authToken: "viewertok2", role: "viewer" });
    patchTabsAwareFetch(V, backend);
    V.fetchSpy.length = 0;

    const result = await V.sb.API.pullTabs(["AuditLog", "Medical"]);
    eq(V.fetchSpy.length, 1, "one batched request even with a gated tab mixed in");
    ok(result.changed, "the deliverable tab still landed");
    ok(V.sb.STATE.medical.find(r => String(r.id) === "1"), "Medical rows present despite AuditLog being rejected in the same batch");
  });

  // ── P1-1 interplay: the launch path's partial pull automatically benefits ──
  suite("P2-1 x P1-1: autoSyncOnLaunch's partial pull now batches");

  await test("a 2-tab launch delta makes one readTabs request instead of two `read` requests", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();   // A's rev baseline

    backend.bumpRev("Roster");
    backend.bumpRev("Medical");

    patchTabsAwareFetch(A, backend);
    A.fetchSpy.length = 0;
    await A.sb.autoSyncOnLaunch();

    const actions = A.fetchSpy.map(r => r.action);
    ok(actions.includes("revCheck"), "polled revCheck first");
    ok(actions.includes("readTabs"), "used the batched readTabs for the partial launch pull");
    ok(!actions.includes("read"), "no per-tab GETs fired");
    ok(!actions.includes("readAll"), "did not fall back to a full pull (2 tabs is under the many-tabs threshold)");
  });
};
