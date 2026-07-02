// Regression guard for nextId()'s collision-resistance (js/helpers.js).
//
// Root cause of the bug this guards against: _idCounter used to seed from
// Math.floor(Math.random() * 9000) + 1000 — only ~9000 possible starting
// values, never checked against ids already in the sheet. Two independent
// sessions/devices could generate the same id for two unrelated rows in the
// same tab. Since appendMany doesn't check for existing ids, and upsertRow
// (apps-script-Code.gs) matches "first row whose id column equals this",
// editing the newer row silently overwrote the OLDER, unrelated row instead
// (confirmed incident: conduct-log Report Sick auto-created Medical rows
// whose ids collided with different recruits' existing records).
//
// Loaded in a vm sandbox (calc.test.js pattern) — helpers.js has no
// undefined-global side effects at load time (only function/const
// declarations execute at the top level), so it's safe to load whole.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

function loadHelpersIdGen() {
  const sandbox = { Math, console, Date, String, Number, Set, RegExp };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8")
    + "\n;this.nextId = nextId; this.__seed = _idCounter;\n";
  vm.runInContext(src, sandbox, { filename: "helpers.js" });
  return sandbox;
}

module.exports = async function run() {
  suite("id generation: collision resistance (js/helpers.js nextId)");

  await test("seed lands in the wide range, not the old 1000-9999 keyspace", () => {
    const h = loadHelpersIdGen();
    ok(h.__seed >= 100000000000, `seed ${h.__seed} should be >= 1e11`);
    ok(h.__seed <= 999999999999, `seed ${h.__seed} should be <= ~1e12`);
  });

  await test("nextId() increments monotonically within a session", () => {
    const h = loadHelpersIdGen();
    const a = h.nextId(), b = h.nextId(), c = h.nextId();
    ok(b === a + 1 && c === b + 1, "sequential calls increment by 1");
  });

  await test("1000 independent sessions never collide on their first id (would fail constantly on the old 9000-value range)", () => {
    const seen = new Set();
    let collisions = 0;
    for (let i = 0; i < 1000; i++) {
      const id = loadHelpersIdGen().nextId();
      if (seen.has(id)) collisions++;
      seen.add(id);
    }
    eq(collisions, 0, "no two of 1000 fresh sessions picked the same starting id");
  });
};
