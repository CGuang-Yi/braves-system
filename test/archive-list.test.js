// Archive list rendering (Feature 21) — the list is now compact one-liners and
// the message body moved into an on-demand drawer. These tests pin the column
// mapping (parade: date/slot/FP-LP/scope; sick: date/slot/format) and the
// scope-defaulting rule, because those are the parts a refactor silently gets
// wrong. render.js is a browser-global bundle, so it loads into a Proxy-global
// vm context with its collaborators stubbed — same trick as log-conduct-wizard.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok } = require("./_tap");
const { sourceText } = require("./sources");

function loadCtx(rows, tab, platoons, rsCompany) {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(
    sourceText("render"),
    ctx, { filename: "render.js" }
  );
  // Collaborators from other bundles.
  // Platoons are supplied as DATA, not as a stubbed resolver function: an
  // earlier version of this file stubbed a `platoonDisplayName` global that
  // exists nowhere in the app, so the test passed against its own stub while
  // production rendered the raw code. renderArchiveList reads STATE.platoons
  // itself, so these rows exercise the real lookup.
  target.STATE = {
    paradeArchive: tab === "parade" ? rows : [], sickArchive: tab === "sick" ? rows : [],
    platoons: platoons || []
  };
  target.isAdminRole = () => true;
  // Report-sick scope (spec §1). The sick archive is whole-company generated
  // message text with no per-person row to filter, so it is withheld entirely
  // below company scope. These suites assert the COLUMN MAPPING, so they run as
  // a company-scope viewer unless a case says otherwise.
  target.rsScope = () => ({ company: rsCompany !== false, plt: rsCompany === false ? ["PLT1"] : [] });
  target.escapeAttr = s => String(s == null ? "" : s);
  target.escapeHTML = s => String(s == null ? "" : s);
  // Minimal DOM: one element whose innerHTML we can read back.
  let html = "";
  // The drawer elements only need enough surface for openArchiveDrawer to fill
  // them and toggle .open — we assert on what it wrote, not on real layout.
  const mkEl = () => ({
    innerHTML: "", _cls: new Set(),
    classList: {
      add(c) { this._cls.add(c); }, remove(c) { this._cls.delete(c); },
      contains(c) { return this._cls.has(c); },
      // Feature 34 marks <body> while a drawer is open; the real DOMTokenList
      // has toggle(c, force) and setArchiveDrawerOpen always passes the force
      // argument, so model that form rather than the bare toggle.
      toggle(c, on) { if (on) this._cls.add(c); else this._cls.delete(c); }
    }
  });
  const drawer = mkEl(), backdrop = mkEl(), body = mkEl();
  drawer.classList._cls = drawer._cls; backdrop.classList._cls = backdrop._cls;
  body.classList._cls = body._cls;
  // renderArchiveList writes the drawer markup as part of #archive-list's own
  // innerHTML, so in a real DOM both drawer nodes are destroyed and recreated
  // (closed) on every render. Model that, or the restore logic looks like it
  // leaves stale drawers open when it does not.
  const resetDrawers = () => {
    [drawer, backdrop].forEach(e => { e.innerHTML = ""; e._cls.clear(); });
  };
  target.document = {
    body,
    // bindArchiveDrawerEsc attaches the Escape handler here. Captured rather
    // than discarded so a test can fire a synthetic key event at it.
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    getElementById: id => id === "archive-list" ? { set innerHTML(v) { html = v; resetDrawers(); }, get innerHTML() { return html; } }
      : id === "arc-drawer" ? drawer
      : id === "arc-drawer-backdrop" ? backdrop
      : null
  };
  return { ctx, target, getHtml: () => html, drawer, backdrop, body };
}

function renderWith(rows, tab, scope, platoons, rsCompany) {
  const { ctx, getHtml } = loadCtx(rows, tab, platoons, rsCompany);
  vm.runInContext(
    `_archiveTab = ${JSON.stringify(tab)}; _archiveQuery = ""; _archiveCompare = false; ` +
    `_archiveScope = ${JSON.stringify(scope || "")}; renderArchiveList();`, ctx);
  return getHtml();
}

module.exports = async function run() {
  suite("archive: list columns");

  await test("parade rows expose date, slot, FP/LP and scope — not the message body", () => {
    const html = renderWith([
      { timestamp: "2026-07-20T07:30:00Z", date: "20 Jul 2026", slot: "0730", type: "FP", scope: "company", message: "SECRET BODY TEXT" }
    ], "parade");
    ok(html.includes("20 Jul 2026"), "date present");
    ok(html.includes("0730"), "slot present");
    ok(html.includes("FP"), "FP/LP present");
    ok(html.includes("Company"), "scope rendered as Company");
    ok(!html.includes("SECRET BODY TEXT"), "message body is NOT inlined — it belongs in the drawer");
  });

  await test("a parade row with no stored scope defaults to Company", () => {
    const html = renderWith([
      { timestamp: "2026-07-20T07:30:00Z", date: "20 Jul 2026", slot: "0730", type: "FP", message: "x" }
    ], "parade");
    ok(html.includes("Company"), "missing scope treated as company (pre-scope default)");
  });

  // A platoon-scoped archive is read alongside the parade tab and the fitness
  // reports, which both label scopes by display name. Showing "PLT1" here while
  // the rest of the app says "1st Platoon" reads as a different platoon.
  await test("a platoon-scoped row renders the platoon's display name", () => {
    const html = renderWith(
      [{ timestamp: "2026-07-20T07:30:00Z", date: "20 Jul 2026", slot: "0730", type: "FP", scope: "platoon:PLT1", message: "x" }],
      "parade", "", [{ code: "PLT1", displayName: "1st Platoon", active: true }]);
    ok(html.includes("1st Platoon"), "display name rendered");
    ok(!html.includes(">PLT1<"), "raw code rendered instead of the display name");
  });

  await test("an unknown platoon code falls back to the raw code", () => {
    // Covers both an empty Platoons tab and a platoon archived under a code
    // that no longer appears in it — the row must still say something.
    const html = renderWith(
      [{ timestamp: "2026-07-20T07:30:00Z", date: "20 Jul 2026", slot: "0730", type: "FP", scope: "platoon:PLT9", message: "x" }],
      "parade", "", [{ code: "PLT1", displayName: "1st Platoon", active: true }]);
    ok(html.includes("PLT9"), "unknown code should fall back to itself, not blank out");
  });

  await test("sick rows expose format and omit the FP/LP and scope columns", () => {
    const html = renderWith([
      { timestamp: "2026-07-20T07:30:00Z", date: "20 Jul 2026", slot: "0730", format: "RS", message: "SECRET BODY TEXT" }
    ], "sick");
    ok(html.includes("RS"), "format present");
    ok(!html.includes("SECRET BODY TEXT"), "message body is NOT inlined");
  });

  await test("newest-first ordering by timestamp survives the rewrite", () => {
    const html = renderWith([
      { timestamp: "2026-07-19T07:30:00Z", date: "19 Jul 2026", slot: "0730", type: "FP", scope: "company", message: "a" },
      { timestamp: "2026-07-21T07:30:00Z", date: "21 Jul 2026", slot: "0730", type: "FP", scope: "company", message: "b" }
    ], "parade");
    ok(html.indexOf("21 Jul 2026") < html.indexOf("19 Jul 2026"), "newest first");
  });

  suite("archive: drawer survives a re-render");

  // The 20s auto-refresh poll re-renders the list. Without the key-based
  // restore an open drawer would silently vanish mid-read; with a naive
  // index-based restore it would show a DIFFERENT row once the list reorders.
  const ROWS = [
    { timestamp: "2026-07-19T07:30:00Z", date: "19 Jul 2026", slot: "0730", type: "FP", scope: "company", message: "BODY OLD" },
    { timestamp: "2026-07-21T07:30:00Z", date: "21 Jul 2026", slot: "0730", type: "FP", scope: "company", message: "BODY NEW" }
  ];

  await test("a re-render re-opens the same row, not the same index", () => {
    const { ctx, drawer } = loadCtx(ROWS.slice(), "parade");
    vm.runInContext(`_archiveTab="parade"; _archiveQuery=""; _archiveCompare=false; _archiveScope=""; renderArchiveList();`, ctx);
    // Open the OLDER row — index 1 in the newest-first list.
    vm.runInContext(`openArchiveDrawer("parade", 1);`, ctx);
    ok(drawer.innerHTML.includes("BODY OLD"), "drawer opened on the older row");
    // A newer snapshot arrives and takes the top slot, pushing our row to index 2.
    vm.runInContext(`STATE.paradeArchive.push({timestamp:"2026-07-22T07:30:00Z",date:"22 Jul 2026",slot:"0730",type:"FP",scope:"company",message:"BODY NEWEST"}); renderArchiveList();`, ctx);
    ok(drawer.classList.contains("open"), "drawer is still open after the re-render");
    ok(drawer.innerHTML.includes("BODY OLD"), "still showing the row the user opened, not index 1");
  });

  await test("closing clears the key so the next re-render leaves it shut", () => {
    const { ctx, drawer } = loadCtx(ROWS.slice(), "parade");
    vm.runInContext(`_archiveTab="parade"; _archiveQuery=""; _archiveCompare=false; _archiveScope=""; renderArchiveList();`, ctx);
    vm.runInContext(`openArchiveDrawer("parade", 0); closeArchiveDrawer(); renderArchiveList();`, ctx);
    ok(!drawer.classList.contains("open"), "stays closed across a re-render");
  });

  await test("a row filtered out of view does not re-open the drawer", () => {
    const { ctx, drawer } = loadCtx(ROWS.slice(), "parade");
    vm.runInContext(`_archiveTab="parade"; _archiveQuery=""; _archiveCompare=false; _archiveScope=""; renderArchiveList();`, ctx);
    vm.runInContext(`openArchiveDrawer("parade", 1);`, ctx);   // the 19 Jul row
    ok(drawer.innerHTML.includes("BODY OLD"), "open on the 19 Jul row");
    // Filter down to the other row only — the open one is no longer listed.
    vm.runInContext(`_archiveQuery = "21 Jul"; renderArchiveList();`, ctx);
    ok(!drawer.classList.contains("open"), "drawer closed rather than showing a row that is not in the list");
  });

  // Feature 34 — the drawer pushes the list aside instead of covering it. The
  // CSS decides whether that shift or the mobile overlay applies; what has to be
  // right in JS is that the <body> marker tracks the drawer EXACTLY. A marker
  // left behind renders the next tab into a narrow column with nothing beside
  // it, which is worse than the overlay it replaced.
  suite("archive drawer: the push-aside body class tracks the drawer exactly");

  const openedCtx = () => {
    const h = loadCtx(ROWS.slice(), "parade");
    vm.runInContext(`_archiveTab="parade"; _archiveQuery=""; _archiveCompare=false; _archiveScope=""; renderArchiveList(); openArchiveDrawer("parade", 0);`, h.ctx);
    return h;
  };

  await test("opening sets it, closing clears it", () => {
    const { ctx, body } = openedCtx();
    ok(body.classList.contains("arc-drawer-open"), "opening the drawer did not shrink the layout");
    vm.runInContext(`closeArchiveDrawer();`, ctx);
    ok(!body.classList.contains("arc-drawer-open"), "closing left the layout shrunk");
  });

  await test("it survives a re-render that re-opens the same row", () => {
    const { ctx, body } = openedCtx();
    vm.runInContext(`renderArchiveList();`, ctx);
    ok(body.classList.contains("arc-drawer-open"),
      "the re-render cleared the class and never put it back — drawer open over a full-width list");
  });

  await test("a re-render that CANNOT re-open the row clears it", () => {
    // The row scrolls out of the filter: the drawer stays shut, so the layout
    // must un-shrink with it. This is the path that only clears _arcDrawerKey.
    const { ctx, body, drawer } = openedCtx();
    vm.runInContext(`_archiveQuery = "19 Jul"; renderArchiveList();`, ctx);
    ok(!drawer.classList.contains("open"), "precondition: the drawer really did stay shut");
    ok(!body.classList.contains("arc-drawer-open"), "layout left shrunk with no drawer on screen");
  });

  await test("Escape closes the drawer, but not while a modal is on top of it", () => {
    const { ctx, target, drawer } = openedCtx();
    const esc = (target.document._listeners.keydown || []);
    ok(esc.length === 1, "expected exactly one Escape listener, got " + esc.length);

    // A modal opened FROM the drawer owns Escape first.
    const overlay = { _cls: new Set(["hidden"]) };
    overlay.classList = { contains: c => overlay._cls.has(c) };
    const realGet = target.document.getElementById;
    target.document.getElementById = id => (id === "modal-overlay" ? overlay : realGet(id));
    overlay._cls.delete("hidden");                       // modal is showing
    esc[0]({ key: "Escape" });
    ok(drawer.classList.contains("open"), "Escape closed the drawer out from under an open modal");

    overlay._cls.add("hidden");                          // modal dismissed
    esc[0]({ key: "Tab" });
    ok(drawer.classList.contains("open"), "a key that is not Escape closed the drawer");
    esc[0]({ key: "Escape" });
    ok(!drawer.classList.contains("open"), "Escape did not close the drawer");
  });

  await test("the listener is bound once, however many times a drawer is opened", () => {
    // renderArchiveList re-runs on every auto-refresh poll and re-opens the
    // drawer each time; per-open binding would stack a handler per poll.
    const { ctx, target } = openedCtx();
    vm.runInContext(`renderArchiveList(); openArchiveDrawer("parade", 1); renderArchiveList();`, ctx);
    const n = (target.document._listeners.keydown || []).length;
    ok(n === 1, "Escape listeners stacked: " + n);
  });

  suite("archive list: report-sick scope (spec §1.1)");

  const SICK_ROW = [{ id: 1, timestamp: "2026-08-01T07:30:00.000Z", date: "2026-08-01", slot: "0730", text: "SICK MSG BODY" }];

  await test("a scoped account gets an explanation, never an empty list", () => {
    // An empty list would read as "no archives exist" — the same false-absence
    // problem as an empty status-grid row. The server withheld the tab; say so.
    const html = renderWith(SICK_ROW, "sick", "", [], false);
    ok(/company-scope accounts only/.test(html), "no explanation rendered: " + html.slice(0, 200));
    ok(!/SICK MSG BODY/.test(html), "the withheld message text was rendered anyway");
  });

  await test("a company-scope account still sees the archive", () => {
    const html = renderWith(SICK_ROW, "sick", "", [], true);
    ok(!/company-scope accounts only/.test(html), "company scope was blocked");
  });

  // The PARADE archive is deliberately NOT gated: parade state is ungated per
  // §1.1, so its archive is the same content by another route.
  await test("the parade archive is untouched by the report-sick gate", () => {
    const html = renderWith(
      [{ id: 1, timestamp: "2026-08-01T07:30:00.000Z", date: "2026-08-01", slot: "0730", type: "FP", scope: "company", text: "PARADE MSG" }],
      "parade", "", [], false);
    ok(!/company-scope accounts only/.test(html), "the parade archive was gated");
  });
};
