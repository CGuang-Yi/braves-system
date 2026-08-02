// Warns (never fails) when docs/codebase-map.json's recorded hashes no longer
// match the sources. A hard failure would red-light `npm test` on every JS edit
// until regeneration, putting noise on a signal this project relies on
// mid-refactor. The trade-off is understood and deliberate — a quiet warning is
// exactly what let docs/frontend/ drift 1158 lines out of date — so the warning
// is made maximally actionable to compensate: it names every drifted file and
// prints the literal command that fixes it.
const fs = require("fs");
const path = require("path");
const { suite, test, ok, eq } = require("./_tap");
const { sha256 } = require("../tools/map/emit");

const ROOT = path.resolve(__dirname, "..");
const MAP_JSON = path.join(ROOT, "docs", "codebase-map.json");

function drifted(map) {
  const out = [];
  for (const rel of Object.keys(map.hashes)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { out.push(rel + " (deleted)"); continue; }
    if (sha256(fs.readFileSync(abs, "utf8")) !== map.hashes[rel]) out.push(rel);
  }
  // A source file the map has never seen is drift too — otherwise a whole new
  // module could be added and the map would still report itself as current.
  const known = new Set(Object.keys(map.hashes));
  for (const f of fs.readdirSync(path.join(ROOT, "js"))) {
    if (f.endsWith(".js") && !known.has("js/" + f)) out.push("js/" + f + " (new, unmapped)");
  }
  return out;
}

module.exports = async function () {
  suite("map/freshness");

  await test("the generated map exists and parses", () => {
    ok(fs.existsSync(MAP_JSON), "docs/codebase-map.json present — run `npm run map` if missing");
    const map = JSON.parse(fs.readFileSync(MAP_JSON, "utf8"));
    ok(map.hashes && Object.keys(map.hashes).length > 0, "map records source hashes");
  });

  await test("map freshness (warns only, never fails)", () => {
    // Absence is reported by the test above; this one must live up to its name
    // and never fail, so it bails rather than throwing ENOENT.
    if (!fs.existsSync(MAP_JSON)) return;
    const map = JSON.parse(fs.readFileSync(MAP_JSON, "utf8"));
    const d = drifted(map);
    if (d.length) {
      console.log("");
      console.log("  ┌───────────────────────────────────────────────────────────────");
      console.log("  │ ⚠  CODEBASE MAP IS STALE — " + d.length + " file(s) changed since it was generated");
      for (const f of d) console.log("  │      • " + f);
      console.log("  │");
      console.log("  │  Regenerate before relying on docs/CODEBASE_MAP.md for review:");
      console.log("  │      npm run map");
      console.log("  └───────────────────────────────────────────────────────────────");
      console.log("");
    }
    ok(true, "informational only");
  });

  await test("drift detection actually fires on a changed hash", () => {
    // Negative control: prove the check CAN report drift, so that a silent pass
    // means "the map is fresh" rather than "the check is broken".
    if (!fs.existsSync(MAP_JSON)) return;
    const map = JSON.parse(fs.readFileSync(MAP_JSON, "utf8"));
    const rel = Object.keys(map.hashes)[0];
    const mutated = { hashes: Object.assign({}, map.hashes) };
    mutated.hashes[rel] = sha256("something else entirely");
    ok(drifted(mutated).indexOf(rel) !== -1, "a wrong hash is reported as drift");
    eq(drifted(map).indexOf(rel), -1, "the real hash is not reported as drift");
  });
};
