// Static load-time guards — catch the failure class that twice reached prod:
//  (a) a duplicate top-level const across scripts that threw on load and blanked
//      the dashboard, and (b) a write path that forgot to bump the revision.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok } = require("./_tap");

const ROOT = path.resolve(__dirname, "..");
const REV_TABS = ["Roster", "Medical", "Attendance", "IPPT", "RouteMarch", "SOC",
  "PolarFlow", "ConductDetail", "Appointments", "Leave", "MSK", "Conducts"];

module.exports = async function run() {
  suite("static: load-time guards");

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  // All local <script src="js/....js?v=NN"> in document order.
  const scriptRe = /<script\s+src="(js\/[^"?]+)(?:\?v=(\d+))?"><\/script>/g;
  const scripts = [];
  let m;
  while ((m = scriptRe.exec(html)) !== null) scripts.push({ src: m[1], v: m[2] });

  await test("found the frontend scripts in index.html", () => {
    ok(scripts.length >= 6, "expected several js/*.js script tags, got " + scripts.length);
  });

  // (a) Concatenate all scripts in load order and COMPILE as one program — this
  // reproduces the browser's shared global lexical scope, so a duplicate top-level
  // `const`/`let` across files (the STATE_TO_TAB blank-dashboard bug) is an early
  // SyntaxError here. Compile-only: never executes, so browser globals are fine.
  await test("all scripts parse together (no duplicate top-level declarations)", () => {
    const bundle = scripts.map(s => fs.readFileSync(path.join(ROOT, s.src), "utf8")).join("\n;\n");
    new vm.Script(bundle, { filename: "bundle.js" }); // throws on dup const/let or syntax error
  });

  // (b) Braves bumps cache versions PER FILE (CLAUDE.md: "bump the version number
  // on that tag" for the file you changed) — unlike Cougar's single global ?v=.
  // So we only require that every local script HAS a numeric ?v= (a missing one
  // ships uncacheable / unbustable JS), not that they all match.
  await test("every script tag carries a numeric ?v= cache version", () => {
    const missing = scripts.filter(s => !s.v).map(s => s.src);
    ok(missing.length === 0, "scripts missing a ?v= version: " + JSON.stringify(missing));
  });

  // (c) Duty-list load order (DUTY_LIST_SPEC.md §12). ESLint sees a flat
  // namespace, not a load sequence, so it cannot catch either of these; they
  // fail at runtime in the browser and nowhere else.
  const at = src => scripts.findIndex(s => s.src === src);

  await test("the pure duty modules load before the view that consumes them", () => {
    const view = at("js/render-duty.js");
    ok(view !== -1, "js/render-duty.js is not in index.html");
    ["js/duty-points.js", "js/duty-eligibility.js", "js/duty-conflicts.js",
     "js/duty-import.js", "js/duty-schedule.js"].forEach(src => {
      const i = at(src);
      ok(i !== -1, src + " is not in index.html");
      ok(i < view, src + " must load before js/render-duty.js");
    });
  });

  // duty-conflicts is the one duty module that is not self-contained: it calls
  // addDaysISO from calc.js. Loading it earlier is a ReferenceError the first
  // time a planner opens an assignment cell — a runtime-only failure on a path
  // no test exercises in the browser.
  await test("duty-conflicts loads after calc, whose addDaysISO it calls", () => {
    ok(at("js/calc.js") !== -1 && at("js/calc.js") < at("js/duty-conflicts.js"),
       "js/duty-conflicts.js must load after js/calc.js");
  });

  // duty-schedule is the most dependent of the pure modules: it scores against
  // duty-points, resolves candidates through duty-eligibility, and reuses
  // duty-conflicts' predicates so its costs and the assignment form's warnings
  // cannot diverge. Load it last of the five.
  await test("duty-schedule loads after every module it calls into", () => {
    ["js/calc.js", "js/duty-points.js", "js/duty-eligibility.js", "js/duty-conflicts.js"].forEach(src => {
      ok(at(src) !== -1 && at(src) < at("js/duty-schedule.js"),
         "js/duty-schedule.js must load after " + src);
    });
  });

  await test("render-duty loads after actions, because it calls registerActions()", () => {
    // This is why render-duty sits beside parade-tab rather than with the other
    // render-* files: registerActions is defined in js/actions.js and called at
    // the top level of render-duty, so loading it earlier throws on page load.
    ok(at("js/actions.js") < at("js/render-duty.js"),
       "js/render-duty.js must load after js/actions.js");
  });

  // (d) The modal must not swallow clicks before they reach document. js/actions.js
  // delegates EVERY data-action from a single document listener, so a
  // stopPropagation() anywhere on the modal's own container silently disables
  // every data-action button rendered into a modal — which is exactly how the
  // parade "Mark Present" button did nothing: the popup stayed open, no error.
  // The backdrop-close must therefore be a target-identity check on the overlay,
  // never a stopped event on the inner .modal.
  await test("the modal does not stopPropagation (js/actions.js delegates on document)", () => {
    const modalBlock = html.slice(html.indexOf(`id="modal-overlay"`),
      html.indexOf(`id="modal-overlay"`) + 600);
    ok(!/stopPropagation/.test(modalBlock),
       "the modal container stops click propagation, so data-action buttons inside " +
       "any modal never reach the delegated listener in js/actions.js");
  });

  suite("static: no unbumped tracked-tab writes (heuristic)");

  // (c) Heuristic lint: any DIRECT write primitive called with a tracked-tab
  // STRING LITERAL (i.e. bypassing routeAuthedPost's withRevLock, which passes
  // `tab` as a variable) must have a bumpRev("<sameTab>") within a few lines —
  // otherwise the change silently misses every client's revCheck (the
  // server-side-write leak class). Calls with a variable tab (the web-app
  // dispatch) are wrapped in withRevLock and so are exempt.
  await test("direct tracked-tab writes are followed by a bumpRev", () => {
    const gs = fs.readFileSync(path.join(ROOT, "apps-script-Code.gs"), "utf8").split("\n");
    const callRe = /\b(appendRow|appendMany|upsertRow|writeTab|deleteRowById|updateRow)\(\s*"([A-Za-z]+)"/;
    const offenders = [];
    for (let i = 0; i < gs.length; i++) {
      const mm = gs[i].match(callRe);
      if (!mm) continue;
      const tab = mm[2];
      if (REV_TABS.indexOf(tab) === -1) continue;        // untracked tab → irrelevant
      const windowText = gs.slice(i, i + 16).join("\n");  // look ahead (multi-line literal + comments)
      const bumped = new RegExp('bumpRev\\(\\s*"' + tab + '"').test(windowText)
        || /withRevLock\(/.test(gs.slice(Math.max(0, i - 3), i + 1).join("\n"));
      if (!bumped) offenders.push((i + 1) + ": " + gs[i].trim());
    }
    ok(offenders.length === 0, "tracked-tab writes missing a nearby bumpRev:\n   " + offenders.join("\n   "));
  });

  // Mobile button feedback (Layer A). Two failure classes, both invisible to
  // every other check in this repo because CSS has no automated coverage:
  //  (a) no :active rule → a tap produces no visible change at all;
  //  (b) an unguarded :hover → on touch it sticks after the tap and the
  //      last-tapped button stays lit, which is worse than no feedback.
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

  await test("controls have :active press states", () => {
    for (const sel of [".btn:active", ".nav-btn:active", ".btn-icon:active"]) {
      ok(css.indexOf(sel) !== -1, "styles.css is missing a press state for " + sel);
    }
  });

  await test("every :hover rule sits inside @media (hover: hover)", () => {
    // Blank out comments first — the block below is *documented* with prose that
    // names :hover, and flagging an explanation as if it were a rule would only
    // teach the next person to write vaguer comments. Spaces (not deletion)
    // keep line numbers true so the failure message still points at real lines.
    let rest = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
    let guard;
    const re = /@media\s*\(hover:\s*hover\)\s*\{/;
    while ((guard = re.exec(rest)) !== null) {
      // Walk braces from the block opener to find its matching close.
      let i = guard.index + guard[0].length, depth = 1;
      while (i < rest.length && depth > 0) {
        if (rest[i] === "{") depth++;
        else if (rest[i] === "}") depth--;
        i++;
      }
      rest = rest.slice(0, guard.index) + rest.slice(i);
    }
    const stray = rest.split("\n")
      .map((l, n) => ({ l, n: n + 1 }))
      .filter(x => x.l.indexOf(":hover") !== -1);
    ok(stray.length === 0,
      "unguarded :hover sticks after a tap on touch devices — move to @media (hover: hover): "
      + stray.map(x => "line " + x.n).join(", "));
  });
};
