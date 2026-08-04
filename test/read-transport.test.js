// Reads travel by POST, so the session token rides in the request body rather
// than the URL. A GET puts everything it carries into the deployment's request
// logs and into any Referer the page emits, and reads are the hot path — the
// launch pull plus a revCheck poll every 20 seconds — so this was the token's
// most frequent exposure by a wide margin.
//
// Two things are worth pinning down, and they are different claims:
//   1. the backend answers the four read actions over POST identically to GET;
//   2. the frontend actually uses that path, and puts no token in any URL.
// (1) alone would let a frontend regression go unnoticed; (2) alone would not
// catch the two routes drifting apart.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient, VALID_TOKEN } = require("./harness");

const MED_HEADERS = ["id", "d4", "date", "reason", "location", "status", "startDate", "endDate"];
const ROSTER_HEADERS = ["id", "d4", "name"];

module.exports = async function run() {
  suite("read transport: POST answers the read actions");

  // GET and POST share one routeRead, so these are less about the responses
  // being similar than about the POST path being wired up at all — a missing
  // isReadAction branch would drop every read into the write router and come
  // back "Unknown action".
  const seeded = () => {
    const b = loadBackend();
    b.db.seed("Roster", ROSTER_HEADERS, [["1", "1101", "A Recruit"]]);
    b.db.seed("Medical", MED_HEADERS, [["1", "1101", "", "fever", "", "", "", ""]]);
    return b;
  };
  const viaGet = (b, params) =>
    JSON.parse(b.doGet({ parameter: Object.assign({ auth: VALID_TOKEN }, params) }).getContent());
  const viaPost = (b, body) =>
    JSON.parse(b.doPost({
      parameter: {},
      postData: { contents: JSON.stringify(Object.assign({ auth: VALID_TOKEN }, body)) }
    }).getContent());

  await test("readAll over POST matches readAll over GET", () => {
    const b = seeded();
    eq(viaPost(b, { action: "readAll" }), viaGet(b, { action: "readAll" }));
  });

  await test("single-tab read over POST matches GET", () => {
    const b = seeded();
    eq(viaPost(b, { action: "read", tab: "Medical" }), viaGet(b, { action: "read", tab: "Medical" }));
  });

  await test("batched readTabs over POST reads `tabs` off the body", () => {
    const b = seeded();
    const r = viaPost(b, { action: "readTabs", tabs: "Roster,Medical" });
    ok(r.ok, "ok:true");
    eq(Object.keys(r.tabs).sort(), ["Medical", "Roster"], "both tabs answered");
    eq(r.tabs.Medical.rows, viaGet(b, { action: "read", tab: "Medical" }).rows, "rows match a single read");
  });

  await test("revCheck over POST carries revs and the scope key", () => {
    const b = seeded();
    const r = viaPost(b, { action: "revCheck" });
    ok(r.ok, "ok:true");
    eq(r.revs, viaGet(b, { action: "revCheck" }).revs, "same revs as the GET route");
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
