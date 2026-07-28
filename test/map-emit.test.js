// Marker-region replacement. The hand-written prose in docs/CODEBASE_MAP.md
// (orientation, known-trap registry) is the part no generator can reproduce, so
// a bug that eats it is the worst failure this tool could have.
const { suite, test, ok, eq, throws } = require("./_tap");
const { replaceRegion } = require("../tools/map/emit");

module.exports = async function () {
  suite("map/emit");

  await test("replaces only the marked region", () => {
    const md = "keep A\n<!-- GENERATED:inv:start -->\nold\n<!-- GENERATED:inv:end -->\nkeep B\n";
    const out = replaceRegion(md, "inv", "new body");
    ok(out.indexOf("keep A\n") === 0, "prose above preserved");
    ok(/keep B\n$/.test(out), "prose below preserved");
    ok(out.includes("new body") && !out.includes("old"), "body swapped");
  });

  await test("is idempotent", () => {
    const md = "<!-- GENERATED:x:start -->\na\n<!-- GENERATED:x:end -->\n";
    eq(replaceRegion(replaceRegion(md, "x", "b"), "x", "b"), replaceRegion(md, "x", "b"));
  });

  await test("leaves other regions untouched", () => {
    const md = "<!-- GENERATED:a:start -->\nAAA\n<!-- GENERATED:a:end -->\n"
             + "<!-- GENERATED:b:start -->\nBBB\n<!-- GENERATED:b:end -->\n";
    const out = replaceRegion(md, "a", "ZZZ");
    ok(out.includes("BBB"), "sibling region intact");
    ok(!out.includes("AAA"), "target region replaced");
  });

  await test("throws when the marker pair is missing", () => {
    throws(() => replaceRegion("no markers here", "inv"), "missing marker must be loud");
  });

  await test("throws when the markers are out of order", () => {
    throws(() => replaceRegion("<!-- GENERATED:x:end -->\n<!-- GENERATED:x:start -->", "x"), "malformed pair must be loud");
  });
};
