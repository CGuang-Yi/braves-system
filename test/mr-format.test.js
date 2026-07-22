// generateMRFormat (js/forms.js): the MR (Medical Review) message. Auto-lists personnel
// with a pending MR visit dated to the chosen date; Rank+Name and Coy prefilled, NRIC
// blank, MA dates from the per-person _mrDates map (blank → NIL).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

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
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8"), ctx, { filename: "forms.js" });
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
};
