// Guards the dashboard scoped-participation wiring (render.js <-> calc.js).
// Regression: the scoped AVG PART. tile once called a non-existent helper
// `filterVisibleSet` guarded by `typeof ... === "function"`, which silently
// evaluated to null so the tile never actually scoped while its label claimed
// it did. The real helper is `visibleD4Set()` (helpers.js). This test fails if
// render.js references the wrong name or stops wiring scopedParticipation.
const fs = require("fs");
const path = require("path");
const { suite, test, ok } = require("./_tap");

module.exports = async function run() {
  suite("render wiring: scoped participation");
  const render = fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8");
  const helpers = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");

  await test("render.js does not reference the non-existent filterVisibleSet", () => {
    ok(!render.includes("filterVisibleSet"), "render.js still references undefined filterVisibleSet");
  });

  await test("the scope-set helper render.js relies on is actually defined", () => {
    ok(render.includes("visibleD4Set("), "render.js no longer calls visibleD4Set()");
    ok(helpers.includes("function visibleD4Set"), "visibleD4Set is not defined in helpers.js");
  });

  await test("the AVG PART tile wires scopedParticipation with the visible set", () => {
    ok(render.includes("scopedParticipation(STATE.attendance, STATE.conductDetail, visible)"),
      "render.js no longer passes the visible set into scopedParticipation");
  });
};
