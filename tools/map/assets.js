// index.html + styles.css analysis. These two carry NO automated coverage at all
// (CLAUDE.md: "UI/CSS still has no automated coverage"), so the mechanical checks
// here are the only safety net that exists for them.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TAG_RE = /<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"?]+)(?:\?v=(\d+))?"/g;

function parseLoadOrder(html) {
  const out = []; let m; let order = 0;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (/^https?:/.test(m[1])) continue;              // external font stylesheet
    out.push({ src: m[1], version: m[2] ? Number(m[2]) : null, order: order++ });
  }
  return out;
}

// CSS has its own comment rules and none of JavaScript's string/regex ambiguity —
// reusing the JS masker here would misread `url(//host)` as a regex literal.
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function findCssClasses(css) {
  const out = new Set(); let m;
  const re = /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g;
  const clean = stripCssComments(css);
  while ((m = re.exec(clean)) !== null) out.add(m[1]);
  return [...out];
}

function git(root, args) {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim() || null; }
  catch (e) { return null; }
}

function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Cache-bust drift, measured entirely in git history rather than filesystem
// mtimes: a fresh clone stamps every file with the checkout time, which would
// make every asset look stale. Comparing "last commit that touched the source"
// against "last commit that changed its ?v= line in index.html" is stable.
// -G (regex over changed lines), NOT -S: the pickaxe counts occurrences of a
// string, and `js/state.js?v=` occurs exactly once before and after a bump, so
// -S would report no commits at all.
function versionDrift(root, src) {
  const srcTouched = git(root, ["log", "-1", "--format=%cI", "--", src]);
  const verBumped = git(root, ["log", "-1", "--format=%cI", "-G" + reEscape(src) + "\\?v=", "--", "index.html"]);
  if (!srcTouched || !verBumped) return null;
  return srcTouched > verBumped ? { srcTouched, verBumped } : null;
}

// Ids the app actually looks up. Targeted patterns rather than "any string that
// looks like an identifier", which would flood the report with noise.
const ID_PATTERNS = [
  /getElementById\(\s*["'`]([A-Za-z][\w-]*)["'`]/g,
  /querySelector(?:All)?\(\s*["'`]#([A-Za-z][\w-]*)/g
];

function analyzeAssets(root) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const loadOrder = parseLoadOrder(html);

  const jsFiles = fs.readdirSync(path.join(root, "js")).filter(f => f.endsWith(".js")).map(f => "js/" + f);
  const sources = jsFiles.map(f => ({ file: f, src: fs.readFileSync(path.join(root, f), "utf8") }));

  const staleVersions = [];
  for (const t of loadOrder) {
    if (t.version === null || !fs.existsSync(path.join(root, t.src))) continue;
    const d = versionDrift(root, t.src);
    if (d) staleVersions.push({ src: t.src, version: t.version, srcTouched: d.srcTouched, versionBumpedAt: d.verBumped });
  }

  // A class counts as used if it appears in index.html or any JS file. JS is
  // searched RAW, not masked: nearly all of this app's markup lives inside
  // template strings, which is exactly where class names appear.
  const cssClasses = findCssClasses(css).map(cls => {
    const re = new RegExp("(^|[\\s\"'`.])" + reEscape(cls) + "([\\s\"'`.]|$)");
    const usedIn = [];
    if (re.test(html)) usedIn.push("index.html");
    for (const s of sources) if (re.test(s.src)) usedIn.push(s.file);
    return { cls, usedIn };
  });
  const deadCss = cssClasses.filter(c => !c.usedIn.length).map(c => c.cls);

  const declared = new Set();
  let m; const idRe = /\sid="([^"]+)"/g;
  while ((m = idRe.exec(html)) !== null) declared.add(m[1]);

  const queried = new Set();
  for (const s of sources.concat([{ file: "index.html", src: html }])) {
    for (const pat of ID_PATTERNS) {
      pat.lastIndex = 0;
      let q;
      while ((q = pat.exec(s.src)) !== null) queried.add(q[1]);
    }
  }

  const domIds = {
    declaredOnly: [...declared].filter(id => !queried.has(id)).sort(),
    queriedOnly: [...queried].filter(id => !declared.has(id)).sort()
  };

  return { loadOrder, staleVersions, cssClasses, deadCss, domIds };
}

module.exports = { analyzeAssets, parseLoadOrder, findCssClasses, stripCssComments };
