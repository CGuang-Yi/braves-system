// btnBusy / btnDone — the shared button-feedback pair.
//
// The behaviours pinned here are the ones that bite: a double-call must not
// stash the busy label as the "original" (the button would never get its real
// text back), and a null button must be a silent no-op rather than a throw,
// because the delegated capture legitimately resolves to null whenever a
// handler runs outside a click.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { makeBrowser } = require("./mocks/browser");

const ROOT = path.resolve(__dirname, "..");

function load() {
  const browser = makeBrowser();
  const sb = Object.assign({
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl
  }, browser.globals);
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ["js/state.js", "js/helpers.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
  }
  // A bare stand-in for a button: the helper only ever touches these two.
  vm.runInContext('var __btn = { textContent: "Save", disabled: false };', sb);
  return { sb, ctl: browser.ctl };
}

module.exports = async function run() {
  suite("button feedback: btnBusy / btnDone");

  await test("btnBusy relabels and disables", () => {
    const { sb } = load();
    vm.runInContext('btnBusy(__btn, "Saving…");', sb);
    eq(vm.runInContext("__btn.textContent", sb), "Saving…");
    eq(vm.runInContext("__btn.disabled", sb), true);
  });

  await test("the returned closure restores the original label", () => {
    const { sb } = load();
    vm.runInContext('var __restore = btnBusy(__btn, "Saving…"); __restore();', sb);
    eq(vm.runInContext("__btn.textContent", sb), "Save");
    eq(vm.runInContext("__btn.disabled", sb), false);
  });

  // The one that would be silently broken: a second btnBusy must not overwrite
  // the stashed original with "Saving…", or restore() hands back the wrong text.
  await test("btnBusy is idempotent — a double call keeps the true original", () => {
    const { sb } = load();
    vm.runInContext('btnBusy(__btn, "Saving…"); var __r = btnBusy(__btn, "Still saving…"); __r();', sb);
    eq(vm.runInContext("__btn.textContent", sb), "Save");
  });

  await test("btnDone shows the transient label, then restores on the timer", () => {
    const { sb, ctl } = load();
    vm.runInContext('btnDone(__btn, "✓ Copied!");', sb);
    eq(vm.runInContext("__btn.textContent", sb), "✓ Copied!");
    ctl.flushTimers();
    eq(vm.runInContext("__btn.textContent", sb), "Save");
  });

  await test("btnDone re-enables a button left disabled by btnBusy", () => {
    const { sb } = load();
    vm.runInContext('btnBusy(__btn, "Saving…"); btnDone(__btn, "✓ Saved");', sb);
    eq(vm.runInContext("__btn.disabled", sb), false);
  });

  await test("a null button is a no-op, not a throw", () => {
    const { sb } = load();
    vm.runInContext('btnDone(null, "✓"); var __r = btnBusy(null, "…"); __r();', sb);
    ok(true, "no exception");
  });

  // De-duplication guard: the transient tick existed twice by hand before
  // btnDone. If a future edit re-inlines a setTimeout label swap, that is the
  // start of a third copy — catch it here rather than in review.
  await test("the copy paths use btnDone, not a hand-rolled label swap", () => {
    for (const f of ["js/parade-tab.js", "js/forms-reports.js"]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      ok(src.indexOf("btnDone") !== -1, f + " should use btnDone");
      ok(!/textContent\s*=\s*"✓ Copied!"/.test(src),
        f + " still hand-rolls the transient tick — use btnDone");
    }
  });
};
