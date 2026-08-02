// Writes generated content into marker-delimited regions so hand-written prose
// (orientation, the known-trap registry) is never clobbered by a regeneration.
// That prose is the part of the map no generator can reproduce, so a silent
// overwrite would be the worst failure this tool could have — hence the throw on
// a missing or malformed marker pair rather than a best-effort append.
const fs = require("fs");
const crypto = require("crypto");

function replaceRegion(md, id, body) {
  const start = "<!-- GENERATED:" + id + ":start -->";
  const end = "<!-- GENERATED:" + id + ":end -->";
  const a = md.indexOf(start), b = md.indexOf(end);
  if (a === -1 || b === -1 || b < a) {
    throw new Error("missing or malformed marker region: " + id);
  }
  return md.slice(0, a + start.length) + "\n" + body + "\n" + md.slice(b);
}

function sha256(text) { return crypto.createHash("sha256").update(text).digest("hex"); }

function writeJson(outPath, payload) {
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
}

module.exports = { replaceRegion, sha256, writeJson };
