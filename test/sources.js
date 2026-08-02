// Source-file lookup for the two frontend bundles that are split across several
// <script> tags.
//
// js/forms.js and js/render.js were each split into a handful of files (see the
// header on any part). The split is a FILING change only: the parts concatenated
// in index.html tag order are byte-identical to the pre-split file, minus each
// part's added header comment. So `sourceText("forms")` is a drop-in replacement
// for the old `fs.readFileSync(".../js/forms.js", "utf8")` — every existing
// regex assertion over that text keeps working, and running the concatenation in
// a vm is equivalent to running the parts in order, because classic <script>
// tags share one global scope.
//
// Tests go through here rather than naming files directly so that the next split
// (or merge) is one edit in this file instead of a sweep through 22 test files.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// Must match index.html's tag order exactly — that order IS the semantics.
const PARTS = {
  forms: [
    "js/forms.js", "js/forms-import.js", "js/forms-records.js", "js/forms-reports.js",
    "js/forms-conducts.js", "js/forms-wizard.js", "js/forms-admin.js"
  ],
  render: [
    "js/render.js", "js/render-dashboard.js", "js/render-records.js",
    "js/render-conducts.js", "js/render-statusboard.js"
  ]
};

// Strip the split header so the returned text matches the pre-split file exactly.
// Headers are the leading comment block, terminated by the first blank line; a
// part with no such header (an unsplit file) is returned untouched.
function stripSplitHeader(src) {
  if (!src.startsWith("//") || src.indexOf("Split out of the original") === -1) return src;
  const i = src.indexOf("\n\n");
  return i === -1 ? src : src.slice(i + 2);
}

function partPaths(name) {
  const parts = PARTS[name];
  if (!parts) throw new Error(`sources: unknown bundle "${name}" (have: ${Object.keys(PARTS).join(", ")})`);
  return parts.map(p => path.join(ROOT, p));
}

// The whole bundle as one string, in load order.
function sourceText(name) {
  return partPaths(name).map(p => stripSplitHeader(fs.readFileSync(p, "utf8"))).join("\n");
}

// Expand a list of frontend files, replacing any reference to a split bundle
// with its parts in load order and leaving everything else untouched. For the
// several tests that carry their own ordered file list and run each one into a
// vm — wrap the list rather than hand-maintaining the parts in each test.
// Accepts both "js/forms.js" and a bare "forms.js", because both spellings are
// in use; the returned entries keep whichever form was passed in.
function expandFiles(files) {
  return files.flatMap(f => {
    const bare = f.replace(/^js\//, "");
    const name = bare.replace(/\.js$/, "");
    if (!PARTS[name]) return [f];
    return f.startsWith("js/") ? PARTS[name] : PARTS[name].map(p => p.replace(/^js\//, ""));
  });
}

module.exports = { sourceText, partPaths, expandFiles, PARTS, ROOT };
