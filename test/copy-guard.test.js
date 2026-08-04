// unsyncedCopyGuard — the confirm shown when a message is copied while a pull
// from the sheet is in flight.
//
// The guard is deliberately SILENT in the common case. A dialog that fires on
// every copy is one people learn to dismiss without reading, which would make
// the warning worse than none — so "no confirm when no pull" is asserted as
// hard as the warning itself.
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient } = require("./harness");

module.exports = async function run() {
  suite("copy guard: warn only while a pull is in flight");

  // makeClient loads the real state.js + api.js + sync.js into one context,
  // which is exactly the trio unsyncedCopyGuard lives in and reads from.
  function client() {
    const c = makeClient(loadBackend());
    vm.runInContext(
      "var __confirms = []; confirm = m => { __confirms.push(m); return __confirmAnswer; };"
      + "var __confirmAnswer = true;", c.sb, { filename: "install-confirm.js" });
    return c;
  }

  await test("no pull in flight → returns true and shows no dialog", () => {
    const c = client();
    vm.runInContext("_pullInFlight = false;", c.sb);
    eq(vm.runInContext('unsyncedCopyGuard("parade state")', c.sb), true);
    eq(vm.runInContext("__confirms.length", c.sb), 0);
  });

  await test("pull in flight → asks, and returns the user's YES", () => {
    const c = client();
    vm.runInContext("_pullInFlight = true; __confirmAnswer = true;", c.sb);
    eq(vm.runInContext('unsyncedCopyGuard("parade state")', c.sb), true);
    eq(vm.runInContext("__confirms.length", c.sb), 1);
  });

  await test("pull in flight → returns the user's NO", () => {
    const c = client();
    vm.runInContext("_pullInFlight = true; __confirmAnswer = false;", c.sb);
    eq(vm.runInContext('unsyncedCopyGuard("parade state")', c.sb), false);
  });

  await test("the dialog names what is being copied", () => {
    const c = client();
    vm.runInContext("_pullInFlight = true;", c.sb);
    vm.runInContext('unsyncedCopyGuard("report sick message")', c.sb);
    ok(/report sick message/.test(vm.runInContext("__confirms[0]", c.sb)),
      "confirm text should name the thing being copied");
  });

  // The archive interaction. copyParadeText archives the copied text as "what
  // was sent" — so a CANCELLED copy must not archive, or the Archive gains a
  // message nobody ever sent and the Compare view diffs against a phantom.
  await test("a cancelled parade copy does not archive a snapshot", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "js/parade-tab.js"), "utf8");
    const fn = src.slice(src.indexOf("async function copyParadeText"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    const guardAt = body.indexOf("unsyncedCopyGuard");
    const archiveAt = body.indexOf("archiveParadeSnapshot");
    ok(guardAt !== -1, "copyParadeText must consult unsyncedCopyGuard");
    ok(archiveAt !== -1, "copyParadeText should still archive on the success path");
    ok(guardAt < archiveAt, "the guard must return BEFORE archiveParadeSnapshot runs");
    ok(/return\s*;/.test(body.slice(guardAt, archiveAt)),
      "the guard must early-return, not merely be consulted");
  });

  await test("the wizard's silent post-save copy is exempt from the guard", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "js/forms-wizard.js"), "utf8");
    const fn = src.slice(src.indexOf("async function copyConductChatFormat"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    ok(/unsyncedCopyGuard/.test(body), "copyConductChatFormat must consult the guard");
    ok(/!silent\s*&&|silent\s*\|\|/.test(body),
      "the guard must be skipped when silent=true (the post-save invocation)");
  });
};
