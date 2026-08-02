// Extracts a file's top-level declaration surface.
//
// WHY the scanner is primary and vm is only a cross-check: vm.runInContext puts
// `function` and `var` declarations on the context object, but `const`, `let` and
// `class` are lexical bindings that never appear there. This codebase has 181
// top-level const/let/class declarations, and js/api.js has ZERO top-level
// function declarations — its entire surface is `const API = {...}`. A vm diff
// would report api.js as empty. So we scan the (masked) text for declarations and
// use vm purely to verify the scanner didn't miss a function/var global; any
// disagreement is surfaced as a scanner gap in the generated output rather than
// being quietly assumed away.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { maskSource } = require("./mask");

function lineAt(src, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") n++;
  return n;
}

// Declarations at brace depth 0 only. Depth is counted on the MASKED source, so
// braces inside comments and string bodies never move it.
const DECL_RE = /^[ \t]*(?:async[ \t]+)?(function|const|let|var|class)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)/;
// Members of a top-level object literal, exactly one nesting level in. A method
// body sits at 4+ spaces, so requiring exactly 2 keeps us to direct members.
const MEMBER_RE = /^[ \t]{2}(?![ \t])(?:async[ \t]+)?([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*[:(]/;
const NOT_MEMBERS = ["if", "for", "while", "switch", "return", "catch", "do", "else", "try", "function"];

function countBraces(line) {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "{") n++; else if (c === "}") n--;
  }
  return n;
}

// Walk forward until brace depth returns to where it started. A declaration with
// no block at all (`const X = 5;`) ends at its semicolon; if neither terminator
// shows up we stop at the next top-level declaration rather than swallowing the
// rest of the file.
function findEnd(lines, startIdx) {
  let depth = 0, sawBlock = false;
  for (let i = startIdx; i < lines.length; i++) {
    const before = depth;
    depth += countBraces(lines[i]);
    if (depth > before) sawBlock = true;
    if (sawBlock && depth <= 0) return i + 1;
    if (!sawBlock) {
      if (/;[ \t]*$/.test(lines[i])) return i + 1;
      if (i > startIdx && DECL_RE.test(lines[i])) return i;
    }
  }
  return lines.length;
}

function collectMembers(lines, startIdx, endLine, owner, out) {
  for (let i = startIdx + 1; i < endLine - 1 && i < lines.length; i++) {
    const m = MEMBER_RE.exec(lines[i]);
    if (m && NOT_MEMBERS.indexOf(m[1]) === -1) {
      out.push({ name: owner + "." + m[1], kind: "method", line: i + 1, endLine: i + 1, length: 1 });
    }
  }
}

// Loads the file in an isolated context with permissive stubs and compares the
// resulting globals against what the scanner found. Files that legitimately
// cannot load (browser or Google globals touched at load time) report ran:false —
// that is expected, not a failure.
function vmCrossCheck(absPath, src, decls) {
  const found = new Set(decls.map(d => d.name));
  const base = {
    console: { log() {}, warn() {}, error() {}, info() {}, table() {} },
    JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    Promise, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent
  };
  const ctx = Object.assign({}, base);
  try {
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: path.basename(absPath), timeout: 5000 });
  } catch (e) {
    return { ran: false, missing: [], reason: String((e && e.message) || e).split("\n")[0] };
  }
  const globals = Object.keys(ctx).filter(k => !(k in base));
  return { ran: true, missing: globals.filter(g => !found.has(g)) };
}

function collectFile(absPath) {
  const src = fs.readFileSync(absPath, "utf8");
  const { masked } = maskSource(src);
  const lines = masked.split("\n");
  const decls = [];
  let depth = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (depth === 0) {
      const m = DECL_RE.exec(line);
      if (m) {
        const startLine = li + 1;
        const endLine = findEnd(lines, li);
        decls.push({ name: m[2], kind: m[1], line: startLine, endLine, length: endLine - startLine + 1 });
        // A top-level `const NAME = { ... }` holds the file's real surface when
        // the file exposes an object rather than loose functions (js/api.js).
        if (m[1] === "const" && /=[ \t]*\{[ \t]*$/.test(line)) {
          collectMembers(lines, li, endLine, m[2], decls);
        }
      }
    }
    depth += countBraces(line);
  }

  return { file: absPath, lines: lines.length, decls, vmCheck: vmCrossCheck(absPath, src, decls) };
}

module.exports = { collectFile, lineAt };
