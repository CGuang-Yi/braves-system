// The Apps Script web app never answers a fetch directly: every response is
// delivered via a mandatory 302 redirect from script.google.com to
// script.googleusercontent.com/macros/echo. On some networks/devices that second
// hop intermittently returns a 404 HTML error page. The OLD client did
// `await res.json()` on it, which threw a raw, UNCAUGHT
// `SyntaxError: JSON.parse: unexpected character at line 1 column 1` on every
// refresh (2026-08-12). These pin the fix:
//   1. a non-JSON / non-2xx body becomes a catchable TransportError, never a
//      bare SyntaxError;
//   2. reads (idempotent) retry exactly once on that transient failure;
//   3. writes (non-idempotent) do NOT auto-retry — a re-sent append/upsert could
//      double-apply; the sync engine's OCC + dirty-replay owns write retries.
// See handoff_docs/SYNC_RELIABILITY_AND_SUPABASE_EVALUATION.md.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient } = require("./harness");

// A mock Response carrying an arbitrary body — only text() is needed, since
// API._fetchJson reads the body via res.text() and parses it itself.
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const HTML_404 = "<!DOCTYPE html><html lang=\"en\"><head><script>window.ppConfig={}</script></head><body>Not found</body></html>";

module.exports = async function run() {
  suite("transport resilience: redirect-layer HTML becomes catchable, reads retry, writes don't");

  await test("post() throws a TransportError (not a raw SyntaxError) when the body is HTML", async () => {
    const c = makeClient(loadBackend());
    c.sb.fetch = async () => resp(404, HTML_404);
    let err;
    try { await c.sb.API.post({ action: "revCheck" }); } catch (e) { err = e; }
    ok(err, "post rejected");
    eq(err.name, "TransportError", "typed as TransportError");
    ok(!/JSON\.parse|unexpected character/i.test(err.message), "message is not a raw parse error");
  });

  await test("post() also fails closed on a 200 that carries HTML instead of JSON", async () => {
    const c = makeClient(loadBackend());
    c.sb.fetch = async () => resp(200, "<html>nope</html>");
    let err;
    try { await c.sb.API.post({ action: "revCheck" }); } catch (e) { err = e; }
    eq(err && err.name, "TransportError");
  });

  await test("post() surfaces a network-level fetch failure as a TransportError", async () => {
    const c = makeClient(loadBackend());
    c.sb.fetch = async () => { throw new Error("NetworkError when attempting to fetch resource."); };
    let err;
    try { await c.sb.API.post({ action: "revCheck" }); } catch (e) { err = e; }
    eq(err && err.name, "TransportError");
  });

  await test("read() retries once and succeeds when the first attempt is a transport blip", async () => {
    const c = makeClient(loadBackend());
    let n = 0;
    c.sb.fetch = async () => (++n === 1 ? resp(404, HTML_404) : resp(200, JSON.stringify({ revs: { Roster: 3 } })));
    const res = await c.sb.API.read("revCheck");
    eq(n, 2, "fetched twice — one automatic retry");
    ok(res && res.revs && res.revs.Roster === 3, "returned the good JSON from the retry");
  });

  await test("read() gives up after a single retry (two blips in a row → TransportError)", async () => {
    const c = makeClient(loadBackend());
    let n = 0;
    c.sb.fetch = async () => { n++; return resp(404, HTML_404); };
    let err;
    try { await c.sb.API.read("revCheck"); } catch (e) { err = e; }
    eq(n, 2, "tried exactly twice, then gave up");
    eq(err && err.name, "TransportError");
  });

  await test("a write via post() does NOT auto-retry — exactly one attempt, no silent re-send", async () => {
    const c = makeClient(loadBackend());
    let n = 0;
    c.sb.fetch = async () => { n++; return resp(404, HTML_404); };
    try { await c.sb.API.post({ action: "append", tab: "Roster", row: { d4: "1101" } }); } catch (e) { /* expected */ }
    eq(n, 1, "write attempted exactly once (idempotency is not guaranteed for writes)");
  });

  await test("read() still returns a legitimate JSON error body without retrying (it is valid JSON)", async () => {
    const c = makeClient(loadBackend());
    let n = 0;
    c.sb.fetch = async () => { n++; return resp(200, JSON.stringify({ error: "Unknown action" })); };
    const res = await c.sb.API.read("revCheck");
    eq(n, 1, "a valid JSON error is not a transport failure — no retry");
    eq(res.error, "Unknown action");
  });
};
