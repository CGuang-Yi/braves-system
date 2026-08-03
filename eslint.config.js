// ESLint for a codebase with NO module system.
//
// Every file under js/ is a classic <script> tag sharing one global scope, so
// `import`/`export` do not exist here and `sourceType: "module"` would be a lie.
// Everything is script mode.
//
// WHY THIS EXISTS: the rule that earns its keep is `no-undef`. In a bare-globals
// codebase nothing else checks that a cross-file call resolves — no compiler, no
// bundler graph, no import statement. Rename or mistype a function and the tests
// stay green while a click handler throws in production. `no-undef` is the
// closest thing this repo has to a compiler, and it only works if the global
// surface is known — which is what the derivation below is for.
//
// THE GLOBALS ARE DERIVED, NOT LISTED. A hand-written globals list rots: it
// tolerates names that no longer exist (so a stale call site stays "valid") and
// rejects new ones (so every added function needs a config edit nobody remembers
// to make). Instead the surface is scanned out of the sources themselves at
// config-load time, reusing tools/map/collect.js — the same scanner the codebase
// map already trusts, so there is one definition of "a top-level declaration"
// rather than two that can disagree.
//
// The consequence worth understanding: this cannot flag "you called a function
// that does not exist *in the design*" — it flags "you called a name that is not
// declared anywhere in the loaded sources". That is exactly the check that was
// missing. Rename `renderDashboard` and every stale caller lights up, because the
// old name is no longer in the derived set.
//
// NOT ENFORCED, and deliberately so: the <script> tag ORDER in index.html. ESLint
// sees a flat namespace, not a load sequence, so it cannot tell you that helpers.js
// uses something state.js defines later. test/static.test.js owns that check.

const path = require("path");
const globals = require("globals");
const { collectFile } = require("./tools/map/collect");

const ROOT = __dirname;

// The <script src> files from index.html, in load order. Kept as a literal rather
// than parsed out of the HTML because ESLint config load failures are opaque and
// this list changes roughly twice a year.
const FRONTEND_FILES = [
  "js/state.js", "js/api.js", "js/ippt-scoring.js", "js/calc.js", "js/helpers.js",
  "js/sick-history-import.js", "js/duty-points.js", "js/duty-eligibility.js", "js/duty-import.js",
  "js/render.js", "js/render-dashboard.js", "js/render-records.js", "js/render-conducts.js", "js/render-statusboard.js",
  "js/forms.js", "js/forms-import.js", "js/forms-records.js", "js/forms-reports.js", "js/forms-conducts.js", "js/forms-wizard.js", "js/forms-admin.js",
  "js/braves-parade.js", "js/actions.js", "js/parade-tab.js", "js/sync.js", "js/main.js"
];

// Top-level declarations of the given files, as a readonly ESLint globals map.
// `kind: "method"` entries are members of a top-level object literal (API.pullAll)
// — they are properties, not globals, so they are dropped.
function declaredGlobals(files) {
  const out = {};
  for (const rel of files) {
    for (const d of collectFile(path.join(ROOT, rel)).decls) {
      if (d.kind !== "method") out[d.name] = "readonly";
    }
  }
  return out;
}

// Loaded from vendor/ by index.html before any app script.
const VENDOR_GLOBALS = { Chart: "readonly", Papa: "readonly", ExcelJS: "readonly" };

// An Apps Script PROJECT shares one global scope across its .gs files exactly as
// index.html's script tags do, so seed-synthetic.gs legitimately calls into
// apps-script-Code.gs. Lint them against the union.
const GS_FILES = ["apps-script-Code.gs", "seed-synthetic.gs"];

// Google Apps Script platform services. Apps Script has no import system either,
// so these are ambient in apps-script-Code.gs exactly as browser globals are in js/.
const GAS_GLOBALS = {
  SpreadsheetApp: "readonly", PropertiesService: "readonly", LockService: "readonly",
  Session: "readonly", Utilities: "readonly", ContentService: "readonly",
  Logger: "readonly", ScriptApp: "readonly", MailApp: "readonly",
  UrlFetchApp: "readonly", DriveApp: "readonly", HtmlService: "readonly",
  CacheService: "readonly"
};

// A project invariant that currently lives only as prose in CLAUDE.md and is
// enforced by whether the next person happens to remember it. It has gone wrong
// before — js/helpers.js:900 carries a comment about exactly this.
//
// Scope matters and is narrower than "the whole frontend". The constraint is not
// per-file in principle, it is per (file × test sandbox): some isolated tests build
// a vm context with no `Array` global at all, so `Array.from` throws there while
// working fine in a browser. Only these two files are currently loaded into such a
// sandbox — js/calc.js by test/calc.test.js and test/conduct-resolve-class.test.js,
// js/helpers.js by test/id-generation.test.js. render.js and forms.js use
// Array.from legitimately and are NOT covered; adding them would be a false
// positive. If a new isolated test loads another file bare, add it here.
const ARRAY_FROM_SANDBOX_FILES = ["js/calc.js", "js/helpers.js"];
const NO_ARRAY_FROM = {
  selector: "MemberExpression[object.name='Array'][property.name='from']",
  message: "Use a spread ([...x]) instead of Array.from: the isolated vm sandbox that loads this file has no `Array` global (CLAUDE.md, Tests)."
};

module.exports = [
  {
    // Never lint third-party bundles or generated artifacts.
    ignores: ["vendor/**", "node_modules/**", "docs/**", "trash/**", "Sanitised Sheets/**"]
  },

  // ── Frontend: browser globals + every top-level declaration in js/ ──────────
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...VENDOR_GLOBALS,
        ...declaredGlobals(FRONTEND_FILES)
      }
    },
    rules: {
      "no-undef": "error",
      // builtinGlobals:false is REQUIRED, not a loosening. Every top-level
      // declaration is injected above as a global so other files can call it —
      // with builtinGlobals on, the file that actually declares the name is then
      // reported as redeclaring it, which is 800+ errors of pure noise. Duplicate
      // declarations WITHIN a file, the thing worth catching, are still caught.
      "no-redeclare": ["error", { builtinGlobals: false }],
      // NOT enabled: no-implicit-globals. Implicit globals are not a smell here,
      // they are the architecture — every file is a <script> tag deliberately
      // publishing into one shared scope. The rule fired 631 times, once per
      // top-level declaration, and every hit was correct-by-design. A warning
      // that is always wrong trains people to ignore the whole report.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }]
    }
  },

  // Narrower than the js/** block above — see ARRAY_FROM_SANDBOX_FILES.
  {
    files: ARRAY_FROM_SANDBOX_FILES,
    rules: { "no-restricted-syntax": ["error", NO_ARRAY_FROM] }
  },

  // Loaded BOTH as a browser <script> and as a CommonJS module by their unit
  // tests, so they end with a `typeof module !== "undefined"` export tail.
  // `module` is genuinely ambient in one of their two homes.
  {
    files: ["js/calc.js", "js/actions.js", "js/duty-points.js", "js/duty-eligibility.js", "js/duty-import.js"],
    languageOptions: { globals: { module: "readonly" } }
  },

  // ── Backend: Apps Script, ES5-flavoured, one shared project global scope ────
  {
    files: ["**/*.gs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...GAS_GLOBALS, ...declaredGlobals(GS_FILES) }
    },
    rules: {
      "no-undef": "error",
      "no-redeclare": ["error", { builtinGlobals: false }],
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }]
    }
  },

  // ── Tests and tooling: real Node CommonJS, not browser scripts ─────────────
  {
    files: ["test/**/*.js", "tools/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node }
    },
    rules: {
      "no-undef": "error",
      "no-redeclare": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }]
    }
  }
];
