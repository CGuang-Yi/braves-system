// Full-stack in-memory harness: loads the REAL Apps Script backend and the REAL
// frontend sync-core into one Node process, wired through a mock fetch — so a
// test can drive multiple simulated browser tabs against one server.
//
//   const backend = loadBackend();          // real apps-script-Code.gs
//   const A = makeClient(backend);          // real state.js + api.js + sync.js
//   const B = makeClient(backend);          // a second tab on the same server
//
// Frontend sync-core uses top-level `const` (STATE, API, TAB_TO_STATE) which —
// unlike browser <script> tags — does NOT cross separate vm.runInContext calls.
// So we concatenate the three files into ONE script (faithfully reproducing the
// browser's shared global scope) and expose the consts via a small epilogue.

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { makeGoogle } = require("./mocks/google");
const { makeBrowser } = require("./mocks/browser");

const ROOT = path.resolve(__dirname, "..");
const GS_PATH = path.join(ROOT, "apps-script-Code.gs");
const FRONTEND_FILES = ["js/state.js", "js/api.js", "js/sync.js"];
const VALID_TOKEN = "testtoken";
// Braves uses per-account auth: getAuthContext() parses the stored value as a
// JSON {email, personId, role, issuedAt} and isTokenExpired() checks issuedAt
// against the 30-day TTL. Seed an admin session issued "now" so the token is
// valid and canWrite(ctx) is true. (Cougar stored a bare "1" — that no longer
// satisfies the role-based auth.)
const AUTH_PAYLOAD = () => JSON.stringify({
  email: "test@example.com", personId: "0001", role: "admin", issuedAt: new Date().toISOString()
});

// opts.root lets a caller point the harness at a DIFFERENT checkout of this
// repo (e.g. tools/bench/sync-bench.js comparing an old `master` worktree
// against this branch) while still using the CURRENT repo's mocks/harness
// logic below — the instrumentation must stay fixed even when the code under
// test doesn't. Defaults to ROOT (this repo), which is every existing call
// site's behavior, unchanged.
function loadBackend(opts) {
  opts = opts || {};
  const root = opts.root || ROOT;
  const gsPath = path.join(root, "apps-script-Code.gs");
  const { services, db } = makeGoogle();
  const sandbox = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, RegExp,
    isNaN, parseInt, parseFloat
  }, services);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(gsPath, "utf8"), sandbox, { filename: "apps-script-Code.gs" });
  db.setProp("auth:" + VALID_TOKEN, AUTH_PAYLOAD());   // a valid admin session for clients
  sandbox.db = db;                                     // test helpers (seed/rowsOf/spy/props)
  return sandbox;
}

function parseQuery(url) {
  const u = new URL(url);
  return {
    action: u.searchParams.get("action") || "",
    tab: u.searchParams.get("tab") || "",
    tabs: u.searchParams.get("tabs") || "",
    auth: u.searchParams.get("auth") || ""
  };
}

function makeClient(backend, opts) {
  opts = opts || {};
  const root = opts.root || ROOT;   // see loadBackend's opts.root comment
  const browser = makeBrowser();
  const fetchSpy = [];   // [{ method, action, tab }]

  async function fetchImpl(url, init) {
    const method = (init && init.method ? init.method : "GET").toUpperCase();
    let out, rec;
    if (method === "GET") {
      const q = parseQuery(url);
      rec = { method: "GET", action: q.action, tab: q.tab, tabs: q.tabs };
      out = backend.doGet({ parameter: { action: q.action, tab: q.tab, tabs: q.tabs, auth: q.auth } });
    } else {
      const body = JSON.parse(init.body);
      rec = { method: "POST", action: body.action, tab: body.tab };
      // parameter:{} → e.parameter.tgsecret is undefined, so doPost skips the
      // Telegram-webhook branch and routes to the normal authed POST handler.
      out = backend.doPost({ parameter: {}, postData: { contents: init.body } });
    }
    fetchSpy.push(rec);
    const text = out.getContent();
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  }

  // Quiet console for the client so sync.js's "[sync] …" timing logs don't spam
  // test output; errors still surface.
  const quietConsole = { log() {}, info() {}, warn() {}, table() {}, error: console.error.bind(console) };

  const sandbox = Object.assign({
    console: quietConsole, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp, Promise,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL,
    fetch: fetchImpl,
    render: () => {},                 // stub (render.js not loaded); sync guards most calls
    showLogin: () => {},              // stub (main.js not loaded); sync.js's signOut() calls this unconditionally
    escapeHTML: s => String(s == null ? "" : s),   // helpers.js not bundled; syncLog uses it
  }, browser.globals);
  vm.createContext(sandbox);

  // Concatenate the three frontend files + an epilogue exposing the consts.
  const src = FRONTEND_FILES.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n")
    + "\n;this.STATE = STATE; this.API = API; this.TAB_TO_STATE = TAB_TO_STATE;\n";
  vm.runInContext(src, sandbox, { filename: "frontend-bundle.js" });

  sandbox.STATE.authToken = opts.authToken || VALID_TOKEN;
  sandbox.STATE.apiUrl = "https://mock.local/exec";
  // Braves gates writes on STATE.role via canWrite() (state.js). Make each test
  // client a writer (admin) so the read-only viewer guard in autoSync doesn't
  // intercept; pass opts.role to simulate a viewer (read-only) device instead.
  sandbox.STATE.role = opts.role || "admin";

  return { sb: sandbox, fetchSpy, ctl: browser.ctl, db: backend.db };
}

// Convenience: pull a client to a clean baseline (full readAll → STATE.rev set).
async function baseline(client) {
  await client.sb.API.pullAll();
  client.fetchSpy.length = 0;   // reset spy after baseline so scenario asserts are clean
}

// ── Launch-bootstrap harness (P1-1) ──────────────────────────────────────
// Everything above (makeClient) loads only the sync CORE (state/api/sync.js)
// and exercises it by calling functions like autoSyncOnLaunch/autoRefreshTick
// directly — sufficient for testing sync.js's own logic (items 5-7 of the
// P1-1 spec). Testing bootstrap()'s warm-vs-cold launch DECISION and the
// shared post-launch continuation (main.js) needs main.js loaded too, which
// this second harness does.
const LAUNCH_FRONTEND_FILES = FRONTEND_FILES.concat(["js/main.js"]);
// localStorage key literals main.js/state.js read at load time (state.js is
// the source of truth for these; duplicated here because they're internal
// `const`s, not exported).
const LS_STORAGE_KEY = "cougar-data-v2";
const LS_AUTH_KEY = "cougar-auth";
const LS_ROLE_KEY = "braves-role";
const LS_PERSONID_KEY = "braves-personid";
const LS_EMAIL_KEY = "braves-email";
const LS_DIRTY_KEY = "cougar-dirty-tabs";

// Unlike makeClient, the session (authToken/role/…) and any cached STATE
// (roster/rev — what loadLocal() will hydrate) must be seeded into
// localStorage BEFORE the bundle evaluates: state.js's `const STATE = {...}`
// and main.js's self-invoking `bootstrap()` both read localStorage
// SYNCHRONOUSLY at load time. By the time vm.runInContext(...) returns below,
// bootstrap() has already made its warm/cold decision and (fire-and-forget)
// kicked off whatever pull it chose — exactly like a real page load, where
// nothing awaits the bootstrap IIFE either.
function makeLaunchClient(backend, opts) {
  opts = opts || {};
  const root = opts.root || ROOT;   // see loadBackend's opts.root comment
  const browser = makeBrowser();
  if (opts.modalOpen) browser.ctl.modalOpen = true;
  const fetchSpy = [];        // [{ method, action, tab }], in call order
  const renderCalls = [];     // fetchSpy.length AT THE MOMENT each render() fired —
                               // renderCalls[0] === 0 proves the first render beat
                               // every network call, not just every network response.

  async function fetchImpl(url, init) {
    const method = (init && init.method ? init.method : "GET").toUpperCase();
    let out, rec;
    if (method === "GET") {
      const q = parseQuery(url);
      rec = { method: "GET", action: q.action, tab: q.tab, tabs: q.tabs };
      out = backend.doGet({ parameter: { action: q.action, tab: q.tab, tabs: q.tabs, auth: q.auth } });
    } else {
      const body = JSON.parse(init.body);
      rec = { method: "POST", action: body.action, tab: body.tab };
      out = backend.doPost({ parameter: {}, postData: { contents: init.body } });
    }
    fetchSpy.push(rec);
    const text = out.getContent();
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  }

  const quietConsole = { log() {}, info() {}, warn() {}, table() {}, error: console.error.bind(console) };

  browser.globals.localStorage.setItem(LS_AUTH_KEY, opts.authToken || VALID_TOKEN);
  browser.globals.localStorage.setItem(LS_ROLE_KEY, opts.role || "admin");
  if (opts.personId) browser.globals.localStorage.setItem(LS_PERSONID_KEY, opts.personId);
  if (opts.email) browser.globals.localStorage.setItem(LS_EMAIL_KEY, opts.email);
  if (opts.cachedState) browser.globals.localStorage.setItem(LS_STORAGE_KEY, JSON.stringify(opts.cachedState));
  if (opts.dirty) browser.globals.localStorage.setItem(LS_DIRTY_KEY, JSON.stringify(opts.dirty));

  const sandbox = Object.assign({
    console: quietConsole, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp, Promise,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL,
    fetch: fetchImpl,
    render: () => { renderCalls.push(fetchSpy.length); },
    escapeHTML: s => String(s == null ? "" : s),   // helpers.js not bundled; syncLog uses it
    // forms.js is not part of this bundle; afterLaunchSyncSettles() (main.js)
    // calls this unconditionally on every launch (matches production), so
    // stub it the same way render/escapeHTML are stubbed above.
    maybeRunConductMigration: () => {},
  }, browser.globals);
  vm.createContext(sandbox);

  const src = LAUNCH_FRONTEND_FILES.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n")
    + "\n;this.STATE = STATE; this.API = API; this.TAB_TO_STATE = TAB_TO_STATE;\n";
  vm.runInContext(src, sandbox, { filename: "launch-bundle.js" });   // bootstrap() fires here

  sandbox.STATE.apiUrl = "https://mock.local/exec";

  return { sb: sandbox, fetchSpy, renderCalls, ctl: browser.ctl, db: backend.db };
}

// The launch chain (bootstrap → autoSyncOnLaunch/pullAndRender → …) is pure
// promise chaining on these test paths — maybeRestoreDirty's setTimeout is
// mocked to a no-op and initAutoRefresh's setInterval likewise, so nothing
// under test is waiting on a real timer. Repeatedly yielding the microtask
// queue lets every pending .then/await in the chain settle without needing a
// handle on bootstrap()'s own promise (it's an unexported IIFE — see comment
// above makeLaunchClient).
async function flushMicrotasks(rounds) {
  for (let i = 0; i < (rounds || 40); i++) await Promise.resolve();
}

module.exports = {
  loadBackend, makeClient, baseline, makeLaunchClient, flushMicrotasks,
  VALID_TOKEN, ROOT, FRONTEND_FILES, LAUNCH_FRONTEND_FILES
};
