// Risk markers. The orphan rules carry the most weight: a false orphan sends a
// reviewer to delete live code, so the string-wiring and entry-point exemptions
// are tested explicitly rather than assumed.
const { suite, test, ok, eq } = require("./_tap");
const { buildMarkers } = require("../tools/map/markers");

const OPTS = { maxFunctionLines: 100, fanInTop: 25 };

module.exports = async function () {
  suite("map/markers");

  await test("a function with no refs anywhere is an orphan", () => {
    const byName = { dead: { name: "dead", definedIn: "a.js", directRefs: [], stringRefs: [], fanIn: 0 } };
    const r = buildMarkers(byName, [], {}, OPTS);
    eq(r.orphans.map(o => o.name), ["dead"]);
  });

  await test("an allowlisted entry point is never an orphan", () => {
    const byName = { doGet: { name: "doGet", definedIn: "apps-script-Code.gs", directRefs: [], stringRefs: [], fanIn: 0 } };
    const r = buildMarkers(byName, [], {}, OPTS);
    eq(r.orphans, [], "doGet exempt");
  });

  await test("a prefix-allowlisted family is never an orphan", () => {
    const byName = { tgSendMessage: { name: "tgSendMessage", definedIn: "apps-script-Code.gs", directRefs: [], stringRefs: [], fanIn: 0 } };
    const r = buildMarkers(byName, [], {}, OPTS);
    eq(r.orphans, [], "tg* exempt");
  });

  await test("the prefix rule does not exempt an unrelated lowercase name", () => {
    // `tg` must be followed by an uppercase letter — otherwise a function called
    // `tgether` (or any word starting with those letters) silently escapes review.
    const byName = { tgether: { name: "tgether", definedIn: "a.js", directRefs: [], stringRefs: [], fanIn: 0 } };
    const r = buildMarkers(byName, [], {}, OPTS);
    eq(r.orphans.map(o => o.name), ["tgether"], "not exempt");
  });

  await test("a function reachable only from an HTML string is NOT an orphan", () => {
    const byName = { onlyClicked: { name: "onlyClicked", definedIn: "forms.js", directRefs: [], stringRefs: [{ file: "render.js", line: 4 }], fanIn: 1 } };
    const r = buildMarkers(byName, [], {}, OPTS);
    eq(r.orphans, [], "string-wired handler is live code");
  });

  await test("a const referenced only by subscript is NOT an orphan", () => {
    const byName = { TABLE: { name: "TABLE", definedIn: "a.js", directRefs: [], stringRefs: [], identRefFiles: ["b.js"], fanIn: 1 } };
    const r = buildMarkers(byName, [], {}, OPTS);
    eq(r.orphans, [], "identifier reference keeps it alive");
  });

  await test("untested surface is what no test file names", () => {
    const byName = {
      covered: { name: "covered", definedIn: "a.js", directRefs: [{ file: "a.js", line: 2 }], stringRefs: [], fanIn: 0 },
      bare:    { name: "bare",    definedIn: "a.js", directRefs: [{ file: "a.js", line: 3 }], stringRefs: [], fanIn: 0 }
    };
    const r = buildMarkers(byName, [], { covered: ["test/a.test.js"] }, OPTS);
    eq(r.untested.map(u => u.name), ["bare"]);
  });

  await test("long functions are listed longest-first", () => {
    const files = [{ file: "a.js", decls: [
      { name: "small", kind: "function", line: 1, endLine: 10, length: 10 },
      { name: "huge",  kind: "function", line: 20, endLine: 400, length: 381 },
      { name: "mid",   kind: "function", line: 401, endLine: 550, length: 150 }
    ] }];
    const r = buildMarkers({}, files, {}, OPTS);
    eq(r.longFunctions.map(f => f.name), ["huge", "mid"], "over threshold, longest first");
  });

  await test("fan-in is ranked highest first and capped", () => {
    const byName = {
      a: { name: "a", definedIn: "x.js", directRefs: [], stringRefs: [], fanIn: 9 },
      b: { name: "b", definedIn: "x.js", directRefs: [], stringRefs: [], fanIn: 3 },
      c: { name: "c", definedIn: "x.js", directRefs: [], stringRefs: [], fanIn: 0 }
    };
    const r = buildMarkers(byName, [], {}, { maxFunctionLines: 100, fanInTop: 2 });
    eq(r.topFanIn.map(f => f.name), ["a", "b"], "sorted, capped, zero-fan-in dropped");
  });
};
