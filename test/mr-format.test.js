// generateMRFormat (js/forms.js): the MR (Medical Review) message. Auto-lists personnel
// with a pending MR visit dated to the chosen date; Rank+Name and Coy prefilled, NRIC
// blank, MA dates from the per-person _mrDates map (blank → NIL).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { sourceText } = require("./sources");

function loadForms(STATE, mrDates) {
  const target = {
    console, JSON, Math, Number, String, Boolean, Array, Object, Set, Map, isNaN, isFinite, RegExp, Date
  };
  const ctx = new Proxy(target, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; } });
  vm.createContext(ctx);
  // Deterministic stubs for the composer's helpers — set BEFORE load so any top-level
  // references resolve, and read as free globals (not lexically declared in forms.js).
  target.STATE = STATE;
  target.displayDateToISO = s => { const m = String(s == null ? "" : s).match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : ""; };
  target.toDDMMYY = iso => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + m[2] + m[1].slice(2) : ""; };
  target.personPlatoon = r => (r ? r.plt : "");
  vm.runInContext(sourceText("forms"), ctx, { filename: "forms.js" });
  // The REAL braves-parade.js, in index.html's order (it loads after forms.js).
  // mrRankName calls bpDisplayRank from there for the blank-rank → REC default;
  // stubbing that would let the MR message drift away from the parade state and
  // sick message, which is exactly what sharing the helper is meant to prevent.
  // Loading is side-effect-free — the file is function declarations plus literal
  // BP_* constants.
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8"), ctx, { filename: "braves-parade.js" });
  // _mrDates is a top-level `let` in forms.js — a lexical binding, NOT a property of the
  // sandbox global. Reach it by assigning within the SAME context (visible to later
  // runInContext calls) so the composer's closure sees the seeded value.
  if (mrDates && Object.keys(mrDates).length) {
    vm.runInContext("Object.assign(_mrDates, " + JSON.stringify(mrDates) + ")", ctx);
  }
  return ctx;
}

module.exports = async function run() {
  suite("forms: generateMRFormat");

  const roster = [
    { id: "1110", name: "Jason Goh", rank: "LCP", plt: "1" },
    { id: "2111", name: "Kelvin Chua", rank: "REC", plt: "2" }
  ];

  await test("lists pending MR for the date, prefills name/coy, NIL dates", () => {
    const STATE = { roster, medical: [
      { d4: "1110", type: "MR", date: "2026-07-22", status: "Pending" },
      { d4: "2111", type: "MR", date: "2026-07-22", status: "" }
    ] };
    const ctx = loadForms(STATE, {});
    const out = ctx.generateMRFormat("2026-07-22", "0700");
    ok(out.indexOf("B COY *MEDICAL REVIEW* 220726") === 0, "heading");
    ok(out.indexOf("1) Rank + Full Name: LCP JASON GOH") !== -1, "person 1 rank+name");
    ok(out.indexOf("Coy: B") !== -1, "coy prefilled");
    ok(out.indexOf("NRIC: \n") !== -1, "NRIC blank");
    ok(out.indexOf("Date of most recent Medical Appointment: NIL") !== -1, "MA date defaults NIL");
    ok(out.indexOf("2) Rank + Full Name: REC KELVIN CHUA") !== -1, "person 2 listed");
  });

  await test("excludes MR resolved to a real status and other dates", () => {
    const STATE = { roster, medical: [
      { d4: "1110", type: "MR", date: "2026-07-22", status: "MC" },      // resolved
      { d4: "2111", type: "MR", date: "2026-07-21", status: "Pending" }  // other date
    ] };
    const ctx = loadForms(STATE, {});
    const out = ctx.generateMRFormat("2026-07-22", "0700");
    eq(out, "B COY *MEDICAL REVIEW* 220726\n\nNo personnel on medical review.");
  });

  await test("MA dates come from _mrDates when set", () => {
    const STATE = { roster, medical: [{ d4: "1110", type: "MR", date: "2026-07-22", status: "Pending" }] };
    const ctx = loadForms(STATE, { "1110": { recent: "2026-07-01", next: "2026-08-15" } });
    const out = ctx.generateMRFormat("2026-07-22", "0700");
    ok(out.indexOf("Date of most recent Medical Appointment: 010726") !== -1, "recent MA formatted");
    ok(out.indexOf("Date of next MA: 150826") !== -1, "next MA formatted");
  });

  // Diagnosis/Issue is the MR row's "Reason / Purpose" (the Medical form's field) —
  // it is what the MO is reviewing, so re-typing it by hand was pure duplication.
  await test("Diagnosis/Issue is prefilled from the MR record's reason", () => {
    const STATE = { roster, medical: [
      { d4: "1110", type: "MR", date: "2026-07-22", status: "Pending", reason: "Right knee pain review" },
      { d4: "2111", type: "MR", date: "2026-07-22", status: "" }  // no reason recorded
    ] };
    const out = loadForms(STATE, {}).generateMRFormat("2026-07-22", "0700");
    ok(out.indexOf("Diagnosis/Issue: Right knee pain review") !== -1,
      "reason should fill Diagnosis/Issue:\n" + out);
    ok(out.indexOf("Diagnosis/Issue: \n") !== -1,
      "a reason-less MR should still leave the field blank:\n" + out);
  });

  // A resolved/other-date MR is not the row the message lists, so its reason must not
  // leak into the listed person's block via a looser lookup than mrPeopleForDate's.
  await test("the reason comes from the pending row for THIS date", () => {
    const STATE = { roster, medical: [
      { d4: "1110", type: "MR", date: "2026-07-21", status: "Pending", reason: "Old review" },
      { d4: "1110", type: "MR", date: "2026-07-22", status: "Pending", reason: "Today's review" }
    ] };
    const out = loadForms(STATE, {}).generateMRFormat("2026-07-22", "0700");
    ok(out.indexOf("Diagnosis/Issue: Today's review") !== -1, "picks the dated row:\n" + out);
    ok(out.indexOf("Old review") === -1, "must not use the other date's reason:\n" + out);
  });

  // DECISIONS #122: the blank-rank → REC default is shared with the parade state
  // and sick message via bpDisplayRank. A bare "JASON GOH" here would contradict
  // the "REC Jason Goh B1110" in a parade state sent the same morning.
  await test("a blank roster rank renders as REC, not a bare name", () => {
    const STATE = {
      roster: [{ id: "1110", name: "Jason Goh", rank: "", role: "Recruit", plt: "1" }],
      medical: [{ d4: "1110", type: "MR", date: "2026-07-22", status: "Pending" }]
    };
    const out = loadForms(STATE, {}).generateMRFormat("2026-07-22", "0700");
    ok(out.indexOf("1) Rank + Full Name: REC JASON GOH") !== -1,
      "blank rank should default to REC:\n" + out);
  });
};
