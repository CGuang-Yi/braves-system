// Neutral risk markers. These are FACTS a reviewer should weigh, not verdicts —
// the map deliberately does not rule on whether any of them is a problem. That
// separation is the point: findings belong in review output, where they can be
// argued with, not baked into a generated document that anchors every future
// review the same way.
const ENTRY = require("./entry-points");

function exemptReason(name) {
  if (Object.prototype.hasOwnProperty.call(ENTRY.exact, name)) return ENTRY.exact[name];
  for (const p of Object.keys(ENTRY.prefixes)) {
    // Require an uppercase letter after the prefix so `tg` exempts tgSendMessage
    // but not an unrelated word that merely starts with those letters.
    const next = name.charAt(p.length);
    if (name.indexOf(p) === 0 && next && next === next.toUpperCase() && next !== next.toLowerCase()) {
      return ENTRY.prefixes[p];
    }
  }
  return null;
}

function buildMarkers(byName, files, testRefs, opts) {
  const names = Object.keys(byName);

  // A name is an orphan only if NOTHING mentions it — not a call, not an HTML
  // string, not even a bare identifier reference. Each of those exclusions is
  // load-bearing: a handler wired solely through an onclick= attribute is live
  // code, and a `const` used as `NAME[i]` is never followed by '(' at all.
  // Reporting either as dead would send a reviewer to delete working code.
  const orphans = names
    .filter(n => byName[n].directRefs.length === 0
              && byName[n].stringRefs.length === 0
              && (byName[n].identRefFiles || []).length === 0)
    .filter(n => !exemptReason(n))
    .map(n => ({ name: n, file: byName[n].definedIn, kind: byName[n].kind }));

  const untested = names
    .filter(n => !(testRefs[n] && testRefs[n].length))
    .map(n => ({ name: n, file: byName[n].definedIn }));

  const longFunctions = [];
  for (const f of files) {
    for (const d of f.decls) {
      if (d.length > opts.maxFunctionLines) {
        longFunctions.push({ name: d.name, file: f.file, line: d.line, length: d.length });
      }
    }
  }
  longFunctions.sort((a, b) => b.length - a.length);

  const topFanIn = names
    .map(n => ({ name: n, file: byName[n].definedIn, fanIn: byName[n].fanIn }))
    .filter(x => x.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn || a.name.localeCompare(b.name))
    .slice(0, opts.fanInTop);

  // A global the vm load produced but the scanner missed is a bug in this tool.
  // Surfacing it in the output keeps the scanner's error rate measured rather
  // than assumed.
  const scannerGaps = files
    .filter(f => f.vmCheck && f.vmCheck.ran && f.vmCheck.missing.length)
    .map(f => ({ file: f.file, missing: f.vmCheck.missing }));

  return { orphans, untested, longFunctions, topFanIn, scannerGaps };
}

module.exports = { buildMarkers, exemptReason };
