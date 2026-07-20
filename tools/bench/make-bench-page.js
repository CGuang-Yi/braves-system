// Live-deployment bench harness for SYNC_PERF_IMPROVEMENTS_SPEC.md §5 / §8.5.
//
// Generates <repo>/bench-sandbox.html: index.html + two injected inline <script> tags that
// (a) point STATE at the sandbox deployment and pre-seed the auth token so reloads stay
// logged in, (b) instrument fetch() so request/response bytes + wall-clock are captured per
// GAS action automatically instead of being read off the DevTools Network tab by hand, and
// (c) wrap render() to stamp first content paint.
//
// Usage:
//   BENCH_TOKEN=<sandbox token> BENCH_URL=<sandbox /exec URL> node tools/bench/make-bench-page.js
//   then serve the repo (.claude/launch.json "static", :8777) and open /bench-sandbox.html
//
// The GENERATED page carries a live sandbox token, so it is gitignored and should be deleted
// after a pass; this generator holds no secrets (both come from the environment). Regenerate
// per checkout — the injection anchors match index.html's ?v= cache-busting tags, which differ
// between branches.
//
// Two traps this encodes, both of which silently produce NO reading rather than a wrong one
// (see §8.5's method note):
//   • The paint probe goes immediately before js/main.js, NOT on DOMContentLoaded — bootstrap()
//     is a parse-time IIFE, so the warm-path render() happens before any DOMContentLoaded
//     listener can run.
//   • Don't poll the DOM with requestAnimationFrame to detect paint; rAF is paused while the
//     tab is backgrounded.
//
// Companion docs: tools/bench/browser-bench.md (the manual procedure this automates),
// tools/bench/sync-bench.js (the offline request-count/payload half).
const fs = require("fs");
const path = require("path");

// Resolve from this file's location so the tool works from any cwd / worktree.
const REPO = path.resolve(__dirname, "..", "..");
const TOKEN = process.env.BENCH_TOKEN;
const URL_ = process.env.BENCH_URL;
if (!TOKEN || !URL_) throw new Error("set BENCH_TOKEN and BENCH_URL");

const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");

const override = `
<script>
(function () {
  var SANDBOX_URL = ${JSON.stringify(URL_)};
  var SANDBOX_TOKEN = ${JSON.stringify(TOKEN)};

  // Persist auth the same way a real login would, so a plain reload (which every
  // warm/cold-launch scenario needs) comes back authenticated without re-injection.
  localStorage.setItem("cougar-auth", SANDBOX_TOKEN);
  localStorage.setItem("braves-role", "commander");
  localStorage.setItem("braves-email", "commander@sandbox.local");

  // state.js has already run at this point (this tag sits directly after it), so STATE
  // exists and its apiUrl/authToken can be redirected before api.js/main.js read them.
  STATE.apiUrl = SANDBOX_URL;
  STATE.authToken = SANDBOX_TOKEN;
  STATE.role = "commander";
  STATE.email = "commander@sandbox.local";

  // ── Network recorder ────────────────────────────────────────────────────────
  // browser-bench.md has the human read request count + payload size off the Network
  // tab; wrapping fetch captures the same two numbers exactly and attributes each call
  // to its GAS action, which is what the scenarios actually need to distinguish
  // (revCheck vs read vs readTabs vs readAll).
  var NET_KEY = "braves-bench-net";
  window.__benchNet = JSON.parse(localStorage.getItem(NET_KEY) || "[]");
  function persistNet() { localStorage.setItem(NET_KEY, JSON.stringify(window.__benchNet)); }

  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var body = (init && init.body) || "";
    var action = "";
    try {
      if (typeof body === "string" && body) {
        try { action = (JSON.parse(body).action) || ""; } catch (e) {}
      }
      if (!action) action = (url.match(/[?&]action=([^&]+)/) || [])[1] || "";
    } catch (e) {}
    var t0 = performance.now();
    var reqBytes = (typeof body === "string" ? body.length : 0) + url.length;
    return origFetch(input, init).then(function (res) {
      var clone = res.clone();
      return clone.text().then(function (txt) {
        window.__benchNet.push({
          t: Date.now(), action: action || "(unknown)", method: (init && init.method) || "GET",
          ms: +(performance.now() - t0).toFixed(1), reqBytes: reqBytes, resBytes: txt.length
        });
        persistNet();
        return res;
      }).catch(function () { return res; });
    });
  };

  // ── First-content paint ─────────────────────────────────────────────────────
  // P1-1's headline claim is "content is visible before any network response
  // arrives", which neither the Network tab nor syncTimingSummary() can show. Poll
  // #content each frame from page load and stamp the first frame where it holds real
  // markup; on the before-tree that lands after the blocking readAll resolves, on the
  // after-tree it should land before any response does.
  //
  // Implemented by wrapping render() rather than polling the DOM: a rAF/interval poll
  // is throttled or paused outright while the tab is backgrounded, which silently
  // yields no reading at all. render() is the single function that fills #content
  // (js/render.js), so its first invocation IS first content.
  window.__benchFirstPaint = null;
  window.__benchRenderLog = [];

  // ── browser-bench.md's accumulator (verbatim behaviour), auto-attached per load ──
  window.bravesBench = window.bravesBench || { rows: JSON.parse(localStorage.getItem("braves-bench-scratch") || "[]") };
  window.bravesBenchRecord = function (label, category, requests, payloadKB) {
    var buf = (typeof _syncTimings !== "undefined" && _syncTimings[category]) || [];
    var ms = buf.length ? buf[buf.length - 1] : null;
    bravesBench.rows.push({ label: label, requests: requests, payloadKB: payloadKB, ms: ms });
    localStorage.setItem("braves-bench-scratch", JSON.stringify(bravesBench.rows));
    return ms;
  };
  window.bravesBenchSaveLocal = function () {
    var t0 = performance.now();
    (typeof saveLocalNow === "function" ? saveLocalNow : saveLocal)();
    return +(performance.now() - t0).toFixed(2);
  };
  window.bravesBenchNetClear = function () { window.__benchNet = []; persistNet(); };

  // Marks where a scenario begins, so the recorder can slice __benchNet to just that
  // scenario's calls even across the reload a launch scenario requires.
  window.bravesBenchMark = function (label) {
    localStorage.setItem("braves-bench-mark", JSON.stringify({ label: label, at: Date.now(), idx: window.__benchNet.length }));
  };
  window.bravesBenchSince = function () {
    var m = JSON.parse(localStorage.getItem("braves-bench-mark") || "null");
    if (!m) return window.__benchNet;
    return window.__benchNet.slice(m.idx);
  };
})();
</script>
`;

// state.js must have executed (STATE must exist) but api.js/main.js must not have read
// apiUrl yet — so the override goes directly after the state.js tag.
const stateTag = html.match(/<script src="js\/state\.js[^>]*><\/script>/);
if (!stateTag) throw new Error("could not locate js/state.js script tag");
let out = html.replace(stateTag[0], stateTag[0] + override);

// The paint probe must go AFTER render.js (so window.render exists to wrap) but BEFORE
// main.js — bootstrap() is a parse-time IIFE, not a DOMContentLoaded listener, so on the
// warm path it calls render() the instant main.js is parsed. A probe installed any later
// (e.g. on DOMContentLoaded) misses that first call entirely and reads back null.
const paintProbe = `
<script>
(function () {
  var origRender = window.render;
  window.render = function () {
    var at = +performance.now().toFixed(1);
    window.__benchRenderLog.push(at);
    if (window.__benchFirstPaint === null) {
      window.__benchFirstPaint = at;
      localStorage.setItem("braves-bench-firstpaint", String(at));
    }
    return origRender.apply(this, arguments);
  };
})();
</script>
`;
const mainTag = out.match(/<script src="js\/main\.js[^>]*><\/script>/);
if (!mainTag) throw new Error("could not locate js/main.js script tag");
out = out.replace(mainTag[0], paintProbe + mainTag[0]);

const dest = path.join(REPO, "bench-sandbox.html");
fs.writeFileSync(dest, out);
console.log("wrote " + dest + " (" + out.length + " bytes), injected after: " + stateTag[0]);
