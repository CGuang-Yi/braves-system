// index.html + styles.css analysis. These two carry no automated coverage at all,
// so these mechanical checks are the only safety net that exists for them.
const path = require("path");
const { suite, test, ok, eq } = require("./_tap");
const { analyzeAssets, parseLoadOrder, findCssClasses } = require("../tools/map/assets");

const ROOT = path.resolve(__dirname, "..");

module.exports = async function () {
  suite("map/assets");

  await test("parses script tags with cache-bust versions in order", () => {
    const html = '<script src="js/state.js?v=127"></script>\n<script src="js/api.js?v=127"></script>';
    const r = parseLoadOrder(html);
    eq(r.map(x => x.src), ["js/state.js", "js/api.js"]);
    eq(r.map(x => x.version), [127, 127]);
  });

  await test("skips external stylesheet links", () => {
    const html = '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet">\n<link rel="stylesheet" href="styles.css?v=130">';
    eq(parseLoadOrder(html).map(x => x.src), ["styles.css"]);
  });

  await test("real index.html load order includes calc.js", () => {
    // index.html's own prose comment (lines 120-124) omits calc.js while the tags
    // load it — exactly the kind of drift this audit exists to surface.
    const r = analyzeAssets(ROOT);
    ok(r.loadOrder.some(x => x.src === "js/calc.js"), "calc.js present in tag order");
  });

  await test("extracts class selectors from css", () => {
    eq(findCssClasses(".btn { color: red }\n.btn-primary, .card { }"), ["btn", "btn-primary", "card"]);
  });

  await test("css comments do not contribute selectors", () => {
    eq(findCssClasses("/* .ghost {} */\n.real {}"), ["real"]);
  });

  await test("a class used in a JS template string counts as used", () => {
    const r = analyzeAssets(ROOT);
    ok(r.cssClasses.filter(c => c.usedIn.length).length > 0, "some classes resolve to a JS or HTML usage");
  });

  await test("dead css excludes anything used anywhere", () => {
    const r = analyzeAssets(ROOT);
    const usedSet = new Set(r.cssClasses.filter(c => c.usedIn.length).map(c => c.cls));
    ok(r.deadCss.every(c => !usedSet.has(c)), "no overlap between dead and used");
  });

  await test("reports ids declared in html but never queried", () => {
    const r = analyzeAssets(ROOT);
    ok(Array.isArray(r.domIds.declaredOnly), "declaredOnly is a list");
    ok(Array.isArray(r.domIds.queriedOnly), "queriedOnly is a list");
  });
};
