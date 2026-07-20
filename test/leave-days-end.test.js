// Behavioural guard for the Leave/Out form's Days⇄End auto-calculation
// (js/forms.js). forms.js is too DOM-heavy to load whole in the vm harness, so
// this pulls the three real handler functions OUT of the source by brace-matching
// and runs them against a fake DOM — the test exercises the SHIPPED code, not a
// copy. Deps: a faithful endDateFromStartAndDays (calc.js, itself covered by
// calc.test.js) and Math/Date/Number.
//
// The feature: typing a whole-number Days fills End (Start + Days − 1). A
// fractional Days (half-day, a quota concept) drives nothing. Moving Start slides
// End when Days is whole, else falls back to recomputing Days from the span (the
// pre-feature behaviour, so half-days are unregressed).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

// Faithful copy of calc.js endDateFromStartAndDays (+ its addDaysISO core).
function endDateFromStartAndDays(startIso, days) {
  const n = Number(days);
  if (!startIso || !n || n < 1) return "";
  const d = new Date(startIso + "T00:00:00");
  d.setDate(d.getDate() + (n - 1));
  const p = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Extract `function NAME(...) { ... }` from source by brace-matching. Safe here:
// the three target functions contain no braces inside strings/regex/templates.
function sliceFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("function not found in forms.js: " + name);
  let depth = 0, started = false;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") { depth++; started = true; }
    else if (src[k] === "}") { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error("unbalanced braces extracting: " + name);
}

// Fake DOM: three inputs addressable by id, mutable .value like real inputs.
function makeDoc(start, days, end) {
  const fields = {
    "f-start": { value: start },
    "f-days": { value: days },
    "f-end": { value: end }
  };
  return { getElementById: id => fields[id] || null, _f: fields };
}

function load(doc) {
  const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
  const src = [
    sliceFn(forms, "recalcLeaveDays"),
    sliceFn(forms, "recalcLeaveEndFromDays"),
    sliceFn(forms, "recalcLeaveStart")
  ].join("\n") + "\n;this.recalcLeaveDays=recalcLeaveDays;this.recalcLeaveEndFromDays=recalcLeaveEndFromDays;this.recalcLeaveStart=recalcLeaveStart;";
  const sandbox = { document: doc, Math, Date, Number, console, endDateFromStartAndDays };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "forms.js#leave-recalc" });
  return sandbox;
}

module.exports = async function run() {
  suite("Leave form: Days → End (whole numbers only)");

  await test("whole-number Days fills End = Start + (Days − 1)", () => {
    const doc = makeDoc("2026-01-05", "3", "");
    load(doc).recalcLeaveEndFromDays();
    eq(doc._f["f-end"].value, "2026-01-07", "3 days from Jan 5 is Jan 7 inclusive");
  });

  await test("Days = 1 fills End = Start (same day)", () => {
    const doc = makeDoc("2026-01-05", "1", "");
    load(doc).recalcLeaveEndFromDays();
    eq(doc._f["f-end"].value, "2026-01-05", "a 1-day leave ends the day it starts");
  });

  await test("fractional Days leaves End untouched", () => {
    const doc = makeDoc("2026-01-05", "1.5", "2026-01-09");
    load(doc).recalcLeaveEndFromDays();
    eq(doc._f["f-end"].value, "2026-01-09", "a half-day must not overwrite a manually-set End");
  });

  await test("Days = 0 leaves End untouched", () => {
    const doc = makeDoc("2026-01-05", "0", "2026-01-09");
    load(doc).recalcLeaveEndFromDays();
    eq(doc._f["f-end"].value, "2026-01-09", "zero/blank days derives no End");
  });

  await test("blank Start derives nothing", () => {
    const doc = makeDoc("", "3", "2026-01-09");
    load(doc).recalcLeaveEndFromDays();
    eq(doc._f["f-end"].value, "2026-01-09", "no Start ⇒ no End computation");
  });

  suite("Leave form: Start moved → slides End (whole) / recomputes Days (fractional)");

  await test("whole Days: moving Start slides End, preserving the duration", () => {
    const doc = makeDoc("2026-01-10", "3", "2026-01-07"); // End stale after Start moved
    load(doc).recalcLeaveStart();
    eq(doc._f["f-end"].value, "2026-01-12", "3-day window from the new Jan 10 start");
    eq(doc._f["f-days"].value, "3", "Days preserved");
  });

  await test("fractional Days: moving Start recomputes Days from the span (pre-feature behaviour)", () => {
    const doc = makeDoc("2026-01-10", "1.5", "2026-01-11");
    load(doc).recalcLeaveStart();
    eq(doc._f["f-days"].value, 2, "Jan 10–11 inclusive = 2 days");
    eq(doc._f["f-end"].value, "2026-01-11", "End left as the anchor");
  });

  // The behavioural tests above exercise the handlers; these guard that the Leave
  // form's HTML actually wires the fields to them (openLeaveForm is too DOM-heavy
  // to render in the vm harness — the forms-wiring.test.js pattern).
  suite("Leave form: field wiring");
  const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
  const leaveForm = forms.slice(forms.indexOf("function openLeaveForm"), forms.indexOf("function onLeaveScopeChange"));

  // Each field is emitted by a single-line formField("f-…", …) call, so anchor on
  // that call and confirm its handler travels with it.
  await test("f-days fires recalcLeaveEndFromDays on input", () => {
    eq(/formField\("f-days"[^\n]*oninput="recalcLeaveEndFromDays\(\)"/.test(leaveForm), true,
      "the Days field must drive End via oninput");
  });

  await test("f-start fires recalcLeaveStart (not the old recalcLeaveDays) on change", () => {
    eq(/formField\("f-start"[^\n]*onchange="recalcLeaveStart\(\)"/.test(leaveForm), true,
      "Start must route through recalcLeaveStart so a whole-number Days slides End");
  });

  await test("f-end still recomputes Days on change", () => {
    eq(/formField\("f-end"[^\n]*onchange="recalcLeaveDays\(\)"/.test(leaveForm), true,
      "End must still keep Days honest");
  });
};
