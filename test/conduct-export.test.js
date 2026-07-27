// Conduct Dash CSV export (Feature 20). Two things are worth pinning here: the
// derived "Classes Completed" list — it is not stored anywhere, prog.rows only
// carries a count, so it is recomputed at export time as the held instances up to
// the member's position minus their gaps — and the semicolon separator inside
// list cells, since a comma there would force CSV quoting and read ambiguously
// against the file's own delimiter.
//
// helpers.js is a browser-global bundle, so it loads into a Proxy-global vm
// context with its collaborators stubbed.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

function loadCtx() {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8"),
    ctx, { filename: "helpers.js" }
  );
  target.displayPersonLabel = d4 => "REC Test " + d4;
  target.displayId = d4 => d4;
  return { ctx, target };
}

module.exports = async function run() {
  suite("conduct dash: CSV export");

  const HELD = [1, 2, 3, 4];

  await test("header names the count column Gaps, with Behind separate", () => {
    const { ctx } = loadCtx();
    const csv = vm.runInContext(
      `conductProgressionCSV([], ${JSON.stringify(HELD)}, {}, "Endurance Run")`, ctx);
    const header = csv.split("\n")[0];
    eq(header, "4D,Name,Current,Done,Classes Completed,Part%,Gaps,Missed Classes,Behind");
  });

  await test("Classes Completed is held-up-to-position minus gaps, semicolon separated", () => {
    const { ctx } = loadCtx();
    const csv = vm.runInContext(
      `conductProgressionCSV(` +
      `[{ d4: "0123", position: 4, completed: 3, behind: 0, missed: [2] }], ` +
      `${JSON.stringify(HELD)}, { "0123": { present: 3, addedIn: 4, pct: 75 } }, "Endurance Run")`, ctx);
    const row = csv.split("\n")[1];
    ok(row.includes("#1; #3; #4"), "completed list excludes the gap at #2: " + row);
    ok(row.includes("#2"), "missed list present");
    ok(row.includes("Endurance Run 4"), "Current is the series name plus position");
    ok(row.includes(",75,"), "Part% is the bare number");
  });

  await test("an instance above the member's position is neither completed nor missed", () => {
    const { ctx } = loadCtx();
    const csv = vm.runInContext(
      `conductProgressionCSV([{ d4: "0123", position: 2, completed: 2, behind: 2, missed: [] }], ` +
      `${JSON.stringify(HELD)}, {}, "Endurance Run")`, ctx);
    const row = csv.split("\n")[1];
    ok(row.includes("#1; #2"), "row: " + row);
    ok(!row.includes("#3"), "instance 3 is ahead of them, not a completed class: " + row);
  });

  await test("a not-started member renders Not started with an empty completed list", () => {
    const { ctx } = loadCtx();
    const csv = vm.runInContext(
      `conductProgressionCSV([{ d4: "0124", position: 0, completed: 0, behind: 4, missed: [] }], ` +
      `${JSON.stringify(HELD)}, {}, "Endurance Run")`, ctx);
    const row = csv.split("\n")[1];
    ok(row.includes("Not started"), row);
    ok(!row.includes("#"), "nothing completed and nothing missed: " + row);
  });

  await test("a null participation pct exports as empty, not the string null", () => {
    const { ctx } = loadCtx();
    const csv = vm.runInContext(
      `conductProgressionCSV([{ d4: "0125", position: 1, completed: 1, behind: 3, missed: [] }], ` +
      `${JSON.stringify(HELD)}, { "0125": { present: 0, addedIn: 0, pct: null } }, "Endurance Run")`, ctx);
    ok(!csv.includes("null"), "no literal null in the output");
  });

  await test("a member absent from partByD4 entirely also exports an empty Part%", () => {
    const { ctx } = loadCtx();
    const csv = vm.runInContext(
      `conductProgressionCSV([{ d4: "0126", position: 1, completed: 1, behind: 3, missed: [] }], ` +
      `${JSON.stringify(HELD)}, {}, "Endurance Run")`, ctx);
    ok(!csv.includes("undefined"), "no literal undefined in the output");
  });

  await test("a field containing the delimiter is quoted", () => {
    const { ctx, target } = loadCtx();
    target.displayPersonLabel = () => "Tan, Ah Kow";
    const csv = vm.runInContext(
      `conductProgressionCSV([{ d4: "0126", position: 1, completed: 1, behind: 0, missed: [] }], ` +
      `${JSON.stringify(HELD)}, {}, "Endurance Run")`, ctx);
    ok(csv.includes('"Tan, Ah Kow"'), "comma-bearing name is quoted");
  });

  await test("row order is preserved exactly as passed in (already screen-sorted)", () => {
    const { ctx } = loadCtx();
    const csv = vm.runInContext(
      `conductProgressionCSV([` +
      `{ d4: "0130", position: 3, completed: 3, behind: 1, missed: [] },` +
      `{ d4: "0120", position: 1, completed: 1, behind: 3, missed: [] }], ` +
      `${JSON.stringify(HELD)}, {}, "Endurance Run")`, ctx);
    const lines = csv.split("\n");
    ok(lines[1].startsWith("0130"), "no re-sorting: " + lines[1]);
    ok(lines[2].startsWith("0120"), "no re-sorting: " + lines[2]);
  });
};
