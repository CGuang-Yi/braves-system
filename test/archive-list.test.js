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

function loadCtx(rows, tab) {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8"),
    ctx, { filename: "render.js" }
  );
  // Collaborators from other bundles.
  target.STATE = { paradeArchive: tab === "parade" ? rows : [], sickArchive: tab === "sick" ? rows : [] };
  target.isAdminRole = () => true;
  target.escapeAttr = s => String(s == null ? "" : s);
  target.escapeHTML = s => String(s == null ? "" : s);
  target.platoonDisplayName = code => code;
  // Minimal DOM: one element whose innerHTML we can read back.
  let html = "";
  // The drawer elements only need enough surface for openArchiveDrawer to fill
  // them and toggle .open — we assert on what it wrote, not on real layout.
  const mkEl = () => ({
    innerHTML: "", _cls: new Set(),
    classList: { add(c) { this._cls.add(c); }, remove(c) { this._cls.delete(c); }, contains(c) { return this._cls.has(c); } }
  });
  const drawer = mkEl(), backdrop = mkEl();
  drawer.classList._cls = drawer._cls; backdrop.classList._cls = backdrop._cls;
  // renderArchiveList writes the drawer markup as part of #archive-list's own
  // innerHTML, so in a real DOM both drawer nodes are destroyed and recreated
  // (closed) on every render. Model that, or the restore logic looks like it
  // leaves stale drawers open when it does not.
  const resetDrawers = () => {
    [drawer, backdrop].forEach(e => { e.innerHTML = ""; e._cls.clear(); });
  };
  target.document = {
    getElementById: id => id === "archive-list" ? { set innerHTML(v) { html = v; resetDrawers(); }, get innerHTML() { return html; } }
      : id === "arc-drawer" ? drawer
      : id === "arc-drawer-backdrop" ? backdrop
      : null
  };
  return { ctx, target, getHtml: () => html, drawer, backdrop };
}

function renderWith(rows, tab, scope) {
  const { ctx, getHtml } = loadCtx(rows, tab);
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
};
