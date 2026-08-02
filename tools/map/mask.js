// Offset-preserving masker: replaces comment bodies and string/template TEXT with
// spaces so downstream text scans never see a call site that isn't one — while
// keeping `${...}` interpolations as live code, because render.js/forms.js build
// their HTML in template literals and the interpolated expressions are real calls.
// Blanking whole templates would throw away a large share of the genuine call
// sites in the two biggest files in the repo.
//
// Newlines are never masked: every downstream stage converts a match offset to a
// line number by counting newlines before it, so the masked copy must stay
// byte-for-byte aligned with the original.

// A '/' begins a regex literal (not division) when the previous significant
// character can't end an expression. Standard heuristic; misreads only exotic
// cases (e.g. `a++ /re/`), none of which appear in this codebase.
const REGEX_PRECEDERS = "(,=:[!&|?{};+-*%~^<>";
const REGEX_KEYWORDS = ["return", "typeof", "case", "in", "of", "delete", "void", "instanceof", "do", "else", "yield", "await"];
const IDENT = /[A-Za-z0-9_$]/;
const SPACE = { " ": 1, "\t": 1, "\n": 1, "\r": 1 };

// Walks backwards through the ALREADY-MASKED output, so comments and string
// bodies behind us can't influence the decision. Scans only as far as the
// preceding token — never rebuilds the whole buffer, which would make this
// quadratic on a 211KB file.
function isRegexStart(out, i) {
  let j = i - 1;
  while (j >= 0 && SPACE[out[j]]) j--;
  if (j < 0) return true;                                   // start of source
  const c = out[j];
  if (REGEX_PRECEDERS.indexOf(c) !== -1) return true;
  if (IDENT.test(c)) {
    // A word before '/' is either an identifier (division) or a keyword
    // (`return /re/`). Only the keyword case is a regex.
    let k = j;
    while (k >= 0 && IDENT.test(out[k])) k--;
    return REGEX_KEYWORDS.indexOf(out.slice(k + 1, j + 1).join("")) !== -1;
  }
  return false;
}

function maskSource(src) {
  const out = src.split("");
  const strings = [];
  // One entry per open template literal. 0 = we are in its TEXT; >0 = we are
  // inside its `${...}`, and the number is the brace depth within that
  // expression, so the matching '}' returns us to text mode. A stack, because
  // a template can appear inside another template's interpolation.
  const tmpl = [];
  let inTemplateText = false;
  let i = 0;

  function blank(from, to) {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  }

  while (i < src.length) {
    if (inTemplateText) {
      // Consume template TEXT until the closing backtick or the next `${`.
      let j = i;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "`" || (src[j] === "$" && src[j + 1] === "{")) break;
        j++;
      }
      if (j > src.length) j = src.length;
      strings.push({ start: i, end: Math.min(j, src.length), text: src.slice(i, j) });
      blank(i, Math.min(j, src.length));
      if (j >= src.length) { tmpl.pop(); inTemplateText = false; i = src.length; continue; }
      if (src[j] === "`") {
        tmpl.pop();
        inTemplateText = tmpl.length > 0 && tmpl[tmpl.length - 1] === 0;
        i = j + 1;
      } else {
        tmpl[tmpl.length - 1] = 1;   // entering `${` — expression depth 1
        inTemplateText = false;
        i = j + 2;
      }
      continue;
    }

    const c = src[i], d = src[i + 1];

    if (c === "/" && d === "/") {
      let j = i; while (j < src.length && src[j] !== "\n") j++;
      blank(i, j); i = j; continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2; while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, src.length);
      blank(i, j); i = j; continue;
    }
    if (c === "/" && isRegexStart(out, i)) {
      let j = i + 1, inClass = false, closed = false;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) { closed = true; break; }
        else if (src[j] === "\n") break;   // unterminated — bail rather than eat the rest of the file
        j++;
      }
      j = Math.min(j + 1, src.length);
      // Consume trailing flags (g, i, m, s, u, v, y, ...) so they don't leak
      // into the masked output as an unmasked bare-identifier-looking token.
      if (closed) while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      blank(i + 1, j);
      i = j; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "\n") break;        // unterminated — don't run past the line
        j++;
      }
      strings.push({ start: i + 1, end: j, text: src.slice(i + 1, j) });
      blank(i + 1, j);
      i = Math.min(j + 1, src.length); continue;
    }
    if (c === "`") { tmpl.push(0); inTemplateText = true; i++; continue; }

    // Inside a `${...}` expression: track braces so we can find where it ends.
    if (tmpl.length && tmpl[tmpl.length - 1] > 0) {
      if (c === "{") tmpl[tmpl.length - 1]++;
      else if (c === "}") {
        tmpl[tmpl.length - 1]--;
        if (tmpl[tmpl.length - 1] === 0) { inTemplateText = true; i++; continue; }
      }
    }
    i++;
  }

  return { masked: out.join(""), strings };
}

module.exports = { maskSource };
