// Classifies every reference to a known declaration into one of two buckets.
//
// The split matters more here than in a normal codebase. A large share of
// forms.js's handlers are reachable ONLY through onclick= attributes inside
// HTML template strings (index.html:108 does the same with closeModal). No
// linter, no test and no editor "find references" catches a rename of those —
// nothing fails until a user clicks. Surfacing them as their own category is
// the point of the tool, so they must never be silently merged into direct
// calls, nor silently dropped into the orphan list.
//
// The scan is INVERTED — each file is read once with a generic
// identifier-followed-by-paren regex and each hit is looked up in the known-name
// set — rather than running one regex per known name across every file. With
// ~1150 declarations and a 360KB forms.js the per-name approach means gigabytes
// of redundant scanning; this is linear in total source size.
const CALL_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*\(/g;

// Newline offsets, so a match offset becomes a line number by binary search
// instead of rescanning the file from byte 0 on every hit.
function lineIndex(text) {
  const nl = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") nl.push(i);
  return nl;
}
function lineOf(nl, offset) {
  let lo = 0, hi = nl.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nl[mid] < offset) lo = mid + 1; else hi = mid;
  }
  return lo + 1;
}

function buildRefs(files) {
  // Null-prototype throughout: real code declares members named `constructor`
  // (js/api.js's `class extends Error`), and on a plain object that lookup would
  // return Object.prototype.constructor — truthy, and not what we stored.
  const byName = Object.create(null);
  for (const f of files) {
    for (const d of f.decls) {
      if (byName[d.name]) continue;   // first definition wins; duplicates are a finding, not a crash
      byName[d.name] = {
        name: d.name, kind: d.kind, definedIn: f.file, definedAtLine: d.line,
        directRefs: [], stringRefs: [], fanIn: 0
      };
    }
  }

  // A member ("API.pullAll") is matched on the member itself, so several
  // declared names can share one lookup key.
  const byNeedle = Object.create(null);
  for (const name of Object.keys(byName)) {
    const dot = name.indexOf(".");
    const needle = dot === -1 ? name : name.slice(dot + 1);
    (byNeedle[needle] || (byNeedle[needle] = [])).push(name);
  }

  for (const f of files) {
    const nl = lineIndex(f.masked);   // masked preserves newline positions, so it indexes f.src too

    // Direct call sites: scan the MASKED source, so comments and string bodies
    // are invisible while `${...}` interpolations remain visible.
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(f.masked)) !== null) {
      const hits = byNeedle[m[1]];
      if (!hits) continue;
      const line = lineOf(nl, m.index);
      for (const name of hits) {
        const rec = byName[name];
        if (f.file === rec.definedIn && line === rec.definedAtLine) continue;   // the definition itself
        rec.directRefs.push({ file: f.file, line });
      }
    }

    // String-literal references: scan the recorded string bodies only.
    for (const s of f.strings) {
      if (s.text.indexOf("(") === -1) continue;
      CALL_RE.lastIndex = 0;
      let sm;
      while ((sm = CALL_RE.exec(s.text)) !== null) {
        const hits = byNeedle[sm[1]];
        if (!hits) continue;
        const line = lineOf(nl, s.start);
        for (const name of hits) byName[name].stringRefs.push({ file: f.file, line });
      }
    }
  }

  for (const name of Object.keys(byName)) {
    const rec = byName[name];
    const others = new Set();
    for (const r of rec.directRefs) if (r.file !== rec.definedIn) others.add(r.file);
    for (const r of rec.stringRefs) if (r.file !== rec.definedIn) others.add(r.file);
    rec.fanIn = others.size;
  }

  const byFile = Object.create(null);
  for (const f of files) byFile[f.file] = { callsInto: [], calledBy: [] };
  for (const name of Object.keys(byName)) {
    const rec = byName[name];
    for (const r of rec.directRefs.concat(rec.stringRefs)) {
      if (r.file === rec.definedIn || !byFile[r.file]) continue;
      if (byFile[r.file].callsInto.indexOf(rec.definedIn) === -1) byFile[r.file].callsInto.push(rec.definedIn);
      if (byFile[rec.definedIn].calledBy.indexOf(r.file) === -1) byFile[rec.definedIn].calledBy.push(r.file);
    }
  }

  return { byName, byFile };
}

module.exports = { buildRefs };
