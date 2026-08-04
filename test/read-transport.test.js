// Reads travel by POST, so the session token rides in the request body rather
// than the URL. A GET puts everything it carries into the deployment's request
// logs and into any Referer the page emits, and reads are the hot path — the
// launch pull plus a revCheck poll every 20 seconds — so this was the token's
// most frequent exposure by a wide margin.
//
// Three things are worth pinning down, and they are different claims:
//   1. the backend answers the four read actions over POST;
//   2. GET no longer answers them at all — the second half of the move, which
//      is what actually closes the leak rather than merely routing around it;
//   3. the frontend uses the POST path, and puts no token in any URL.
// (1) alone would let a frontend regression go unnoticed; (3) alone would not
// notice a GET arm quietly reappearing on the backend.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient, readVia, VALID_TOKEN } = require("./harness");

const MED_HEADERS = ["id", "d4", "date", "reason", "location", "status", "startDate", "endDate"];
const ROSTER_HEADERS = ["id", "d4", "name"];

module.exports = async function run() {
  suite("read transport: POST answers the read actions");

  // A missing isReadAction branch would drop every read into the write router
  // and come back "Unknown action", so these assert the POST path is wired up
  // at all and returns real data — not merely that it returns something.
  const seeded = () => {
    const b = loadBackend();
    b.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    b.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "fever", "", "", "", ""]]);
    return b;
  };
  const viaGet = (b, params) =>
    JSON.parse(b.doGet({ parameter: Object.assign({ auth: VALID_TOKEN }, params) }).getContent());
  const viaPost = (b, body) => readVia(b, body);

  await test("readAll over POST returns the seeded tabs", () => {
    const b = seeded();
    // readAll keys by STATE name with bare arrays (roster/medical/…), unlike
    // `read`'s {rows, rev} — the frontend assigns these straight onto STATE.
    const r = viaPost(b, { action: "readAll" });
    eq(r.roster.length, 1, "Roster came back");
    eq(r.medical[0].reason, "fever", "Medical came back with its data");
  });

  await test("single-tab read over POST returns rows and a rev", () => {
    const b = seeded();
    const r = viaPost(b, { action: "read", tab: "Medical" });
    eq(r.rows.length, 1, "one Medical row");
    eq(typeof r.rev, "number", "carries a numeric rev to baseline against");
  });

  await test("batched readTabs over POST reads `tabs` off the body", () => {
    const b = seeded();
    const r = viaPost(b, { action: "readTabs", tabs: "Roster,Medical" });
    ok(r.ok, "ok:true");
    eq(Object.keys(r.tabs).sort(), ["Medical", "Roster"], "both tabs answered");
    eq(r.tabs.Medical.rows, viaPost(b, { action: "read", tab: "Medical" }).rows,
       "rows match a single read");
  });

  await test("revCheck over POST carries revs and the scope key", () => {
    const b = seeded();
    const r = viaPost(b, { action: "revCheck" });
    ok(r.ok, "ok:true");
    eq(typeof r.revs.Medical, "number", "per-tab revisions present and numeric");
    ok(typeof r.scopeKey === "string", "scope key present");
  });

  // Gating lives in routeRead, so it applies to POST for free — but "for free"
  // is exactly the kind of claim that stops being true after a refactor.
  await test("per-tab gating still bites on the POST route", () => {
    const b = seeded();
    b.db.setProp("auth:viewertok", JSON.stringify({
      email: "viewer@example.com", personId: "0098", role: "viewer", issuedAt: new Date().toISOString()
    }));
    const r = JSON.parse(b.doPost({
      parameter: {},
      postData: { contents: JSON.stringify({ action: "read", tab: "Accounts", auth: "viewertok" }) }
    }).getContent());
    eq(r.code, 403, "Accounts is never readable, whatever the transport");
  });

  await test("an unauthenticated read over POST is still rejected", () => {
    const b = seeded();
    const r = JSON.parse(b.doPost({
      parameter: {}, postData: { contents: JSON.stringify({ action: "readAll", auth: "bogus" }) }
    }).getContent());
    eq(r.code, 401, "401 for a bad token");
  });

  suite("read transport: GET no longer answers reads");

  // The point of this half of the move. Routing reads through POST while GET
  // still answered them shrank nothing — anyone holding the deployment URL
  // could keep reading over GET, and the app's own token kept working there.
  // These are the tests that stop a read arm being re-added to doGet out of
  // sympathy for a stale client.
  await test("each read action over GET is refused, even with a valid token", () => {
    const b = seeded();
    [{ action: "readAll" },
     { action: "revCheck" },
     { action: "read", tab: "Medical" },
     { action: "readTabs", tabs: "Roster,Medical" }].forEach(params => {
      const r = viaGet(b, params);
      ok(/Unknown action/.test(r.error || ""), params.action + " over GET is refused");
      ok(!r.rows && !r.revs && !r.tabs && !r.medical, params.action + " leaked no data");
    });
  });

  await test("ping still answers over GET, unauthenticated", () => {
    const b = seeded();
    const r = JSON.parse(b.doGet({ parameter: { action: "ping" } }).getContent());
    ok(r.ok, "the liveness check survives — js/sync.js's connection test uses it");
  });

  await test("a GET with no action at all reads nothing", () => {
    const b = seeded();
    // It used to default to readAll, so a bare GET on the deployment URL with a
    // token appended dumped the whole sheet. There is no default now.
    const r = JSON.parse(b.doGet({ parameter: { auth: VALID_TOKEN } }).getContent());
    ok(/Unknown action/.test(r.error || ""), "no implicit readAll");
    ok(!r.roster, "no tab data");
  });

  suite("read transport: the client puts no token in a URL");

  // The point of the change, asserted where it can actually regress. Wrapping
  // the sandbox's fetch (rather than reading the spy) is deliberate: the spy
  // records parsed fields, and what matters here is the raw URL string.
  const recordUrls = client => {
    const urls = [];
    const inner = client.sb.fetch;
    client.sb.fetch = async (url, init) => { urls.push(String(url)); return inner(url, init); };
    return urls;
  };

  await test("a full pull sends no query string at all", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    const A = makeClient(backend);
    const urls = recordUrls(A);
    await A.sb.API.pullAll();
    ok(urls.length > 0, "the pull did make a request");
    ok(urls.every(u => !u.includes("?")), "no request carried a query string");
  });

  await test("a partial pull and a revCheck poll carry no auth= parameter", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    backend.db.seed("Medical", MED_HEADERS, []);
    const A = makeClient(backend);
    await A.sb.API.pullAll();
    const urls = recordUrls(A);
    await A.sb.API.revCheck();
    await A.sb.API.pullTabs(["Roster", "Medical"]);
    ok(urls.length > 0, "requests were made");
    ok(urls.every(u => !u.includes("auth=")), "no token in any URL");
  });

  await test("reads are POSTs — the spy sees no read-shaped GET", async () => {
    const backend = loadBackend();
    backend.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    const A = makeClient(backend);
    A.fetchSpy.length = 0;
    await A.sb.API.pullAll();
    await A.sb.API.revCheck();
    const gets = A.fetchSpy.filter(r => r.method === "GET");
    eq(gets.length, 0, "every read went out as a POST");
  });
};
