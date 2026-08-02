// Entry point: `npm run map`. Regenerates docs/codebase-map.json in full and the
// GENERATED regions of docs/CODEBASE_MAP.md in place.
//
// Division of labour between the two outputs: the .md is read start-to-finish by
// a review agent with fresh context, so every line in it costs that agent
// reasoning room — it carries orientation, traps and outliers only. The .json
// carries everything and is queried on demand, never read whole.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { maskSource } = require("./mask");
const { collectFile } = require("./collect");
const { buildRefs } = require("./refs");
const { buildMarkers } = require("./markers");
const { analyzeAssets } = require("./assets");
const { replaceRegion, sha256, writeJson } = require("./emit");

// Tunable thresholds — change these, not the logic.
const MAX_FUNCTION_LINES = 100;
const FAN_IN_TOP = 25;
const MD_LONG_FN_SHOWN = 15;   // the .md is read whole by an agent; the full list lives in the .json

const ROOT = path.resolve(__dirname, "..", "..");
const MD_PATH = path.join(ROOT, "docs", "CODEBASE_MAP.md");
const JSON_PATH = path.join(ROOT, "docs", "codebase-map.json");

function sourceFiles() {
  const js = fs.readdirSync(path.join(ROOT, "js")).filter(f => f.endsWith(".js")).map(f => "js/" + f);
  return js.concat(["apps-script-Code.gs"]);
}

// Which test files mention each declared name. Scans each test file ONCE and
// intersects against the known names, rather than running one regex per name
// across every test file.
const IDENT_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
function testFileRefs(names) {
  const dir = path.join(ROOT, "test");
  const out = Object.create(null);
  const byNeedle = Object.create(null);
  for (const n of names) {
    const dot = n.indexOf(".");
    const needle = dot === -1 ? n : n.slice(dot + 1);
    (byNeedle[needle] || (byNeedle[needle] = [])).push(n);
  }
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".test.js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const seen = new Set();
    IDENT_RE.lastIndex = 0;
    let m;
    while ((m = IDENT_RE.exec(src)) !== null) seen.add(m[1]);
    for (const ident of seen) {
      const hits = byNeedle[ident];
      if (!hits) continue;
      for (const n of hits) (out[n] || (out[n] = [])).push("test/" + f);
    }
  }
  return out;
}

function currentCommit() {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch (e) { return "unknown"; }
}

function renderInventory(files, byFile, testRefs) {
  const rows = files.map(f => {
    const tests = new Set();
    for (const d of f.decls) for (const t of (testRefs[d.name] || [])) tests.add(t);
    const into = byFile[f.file].callsInto.slice().sort();
    const from = byFile[f.file].calledBy.slice().sort();
    return "| `" + f.file + "` | " + f.lines + " | " + f.decls.length + " | "
      + (into.length ? into.map(x => "`" + x + "`").join(" ") : "—") + " | "
      + (from.length ? from.map(x => "`" + x + "`").join(" ") : "—") + " | " + tests.size + " |";
  });
  return "| file | lines | decls | calls into | called by | test files |\n"
    + "|---|---:|---:|---|---|---:|\n" + rows.join("\n");
}

function renderMarkers(m, totalDecls) {
  const s = [];
  s.push("**Longest functions** (over " + MAX_FUNCTION_LINES + " lines, longest first)\n");
  s.push(m.longFunctions.slice(0, MD_LONG_FN_SHOWN)
    .map(f => "- `" + f.name + "` — " + f.length + " lines, `" + f.file + ":" + f.line + "`").join("\n") || "_none_");
  if (m.longFunctions.length > MD_LONG_FN_SHOWN) {
    s.push("\n_" + (m.longFunctions.length - MD_LONG_FN_SHOWN) + " more over the threshold; full list in `docs/codebase-map.json` → `markers.longFunctions`._");
  }

  s.push("\n**Highest fan-in** — most referencing files, so the largest blast radius if changed\n");
  s.push(m.topFanIn.map(f => "- `" + f.name + "` — referenced from " + f.fanIn + " other file(s) (defined in `" + f.file + "`)").join("\n") || "_none_");

  s.push("\n**Orphan candidates** — leads, not verdicts; see the trust table\n");
  s.push(m.orphans.map(o => "- `" + o.name + "` (`" + o.file + "`)").join("\n") || "_none_");

  s.push("\n**Untested surface**\n");
  s.push("_" + m.untested.length + " of " + totalDecls + " declarations are named by no test file._ "
    + "Full list in `docs/codebase-map.json` → `markers.untested`. "
    + "Being named by a test is not proof of meaningful coverage — see the trust table.");

  if (m.scannerGaps.length) {
    s.push("\n**Scanner gaps** — the `vm` load found a global the scanner missed, which is a bug in this tool\n");
    s.push(m.scannerGaps.map(g => "- `" + g.file + "`: " + g.missing.join(", ")).join("\n"));
  }
  return s.join("\n");
}

function renderAssets(a) {
  const s = [];
  s.push("**Script load order** (`index.html`) — with no module system this order *is* the dependency graph\n");
  s.push(a.loadOrder.map(t => (t.order + 1) + ". `" + t.src + "` — `?v=" + t.version + "`").join("\n"));

  s.push("\n**Cache-bust drift** — source committed more recently than its `?v=` was bumped\n");
  s.push(a.staleVersions.map(x => "- `" + x.src + "` (`?v=" + x.version + "`) — source touched " + x.srcTouched + ", version last bumped " + x.versionBumpedAt).join("\n") || "_none_");

  s.push("\n**Dead CSS candidates** — " + a.deadCss.length + " of " + a.cssClasses.length + " classes\n");
  s.push(a.deadCss.length ? a.deadCss.map(c => "`." + c + "`").join(", ") : "_none_");

  s.push("\n**DOM ids declared in `index.html` but never queried** — " + a.domIds.declaredOnly.length + "\n");
  s.push(a.domIds.declaredOnly.length ? a.domIds.declaredOnly.map(i => "`#" + i + "`").join(", ") : "_none_");

  // Deliberately a count, not a list. Most of this app's ids are created at
  // runtime by render.js/forms.js inside #content, so "queried but not in
  // index.html" is the normal case, not a finding — printing all of them would
  // spend a large slice of a review agent's context on non-findings.
  s.push("\n**DOM ids queried in JS but absent from `index.html`** — " + a.domIds.queriedOnly.length + "\n");
  s.push("Expected: most ids are built at runtime into `#content`. Listed in `docs/codebase-map.json` → `assets.domIds.queriedOnly` if you need them.");
  return s.join("\n");
}

function main() {
  const rels = sourceFiles();
  const hashes = {};
  const files = rels.map(rel => {
    const abs = path.join(ROOT, rel);
    const src = fs.readFileSync(abs, "utf8");
    hashes[rel] = sha256(src);
    const { masked, strings } = maskSource(src);
    const c = collectFile(abs);
    return { file: rel, src, masked, strings, decls: c.decls, lines: c.lines, vmCheck: c.vmCheck };
  });

  const { byName, byFile } = buildRefs(files);
  const names = Object.keys(byName);
  const testRefs = testFileRefs(names);
  const markers = buildMarkers(byName, files, testRefs, { maxFunctionLines: MAX_FUNCTION_LINES, fanInTop: FAN_IN_TOP });
  const assets = analyzeAssets(ROOT);
  const commit = currentCommit();

  writeJson(JSON_PATH, {
    generatedAt: new Date().toISOString(),
    commit,
    thresholds: { maxFunctionLines: MAX_FUNCTION_LINES, fanInTop: FAN_IN_TOP },
    hashes,
    files: files.map(f => ({
      file: f.file, lines: f.lines, declCount: f.decls.length,
      callsInto: byFile[f.file].callsInto, calledBy: byFile[f.file].calledBy,
      vmCheck: f.vmCheck, decls: f.decls
    })),
    functions: Object.assign({}, byName),
    testRefs: Object.assign({}, testRefs),
    markers,
    assets
  });

  let md = fs.readFileSync(MD_PATH, "utf8");
  md = replaceRegion(md, "meta", "_Generated from `" + commit + "` by `npm run map`. "
    + files.length + " source files, " + names.length + " declarations._");
  md = replaceRegion(md, "inventory", renderInventory(files, byFile, testRefs));
  md = replaceRegion(md, "markers", renderMarkers(markers, names.length));
  md = replaceRegion(md, "assets", renderAssets(assets));
  fs.writeFileSync(MD_PATH, md);

  console.log("map: wrote " + path.relative(ROOT, MD_PATH) + " and " + path.relative(ROOT, JSON_PATH));
  console.log("map: " + files.length + " files, " + names.length + " declarations, "
    + markers.orphans.length + " orphan candidates, " + markers.scannerGaps.length + " scanner gaps");
}

if (require.main === module) main();
module.exports = { main };
