// Guards for the "omit personnel already on status" option on the sick-report
// generators (js/braves-parade.js §10):
//   • generateRSFormat  — the RS Format (URTI / NON-URTI) message.
//   • generateRSIPersonnel — the RSI-Personnel-by-platoon message (PR 1 adds the
//     option here; it already existed on generateRSFormat since PR #71).
// The option filters out report-sick rows for personnel who ALREADY carry an
// unexpired medical status, via bpHasOtherStatus — so the message lists only the
// day's new cases and the TOTAL / per-platoon PAX counts follow the filtered set.
//
// This file is the feature's FIRST direct coverage (PR #71 shipped it untested).
// Loaded in a vm sandbox (parade-classifier.test.js pattern) with faithful stubs
// for the external globals the generators lean on. Covers the PR-1 second call
// site (RSI Personnel) AND the PR-2 widened predicate — a status is suppressive
// if its end date is on or after the report date, whether it started before that
// day, on it, or later.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

const TODAY = "2026-06-29";

// ISO-or-blank echo — test data is already stored in ISO.
function displayDateToISO(s) {
  const m = String(s == null ? "" : s).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}
// Faithful copy of helpers.js medStatusActive. The widened bpHasOtherStatus no
// longer calls it, but other braves-parade.js internals loaded into the sandbox
// reference it, so it stays stubbed defensively.
function medStatusActive(record, todayIso) {
  if (record.status === "NIL") return false;
  const start = displayDateToISO(record.startDate || record.date || "");
  if (!start) return false;
  if (record.status === "Pending") return todayIso === start;
  const end = displayDateToISO(record.endDate || "");
  if (!end) return false;
  return todayIso >= start && todayIso <= end;
}

// Roster is keyed by platoon via a `plt` field the stubbed personPlatoon reads.
function loadParade(roster, medical) {
  const STATE = { roster, medical: medical || [], leave: [], appointments: [] };
  const platoonsPresent = [...new Set(roster.map(r => r.plt))];
  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat,
    STATE,
    configGet: key => {
      if (key === "companyPrefix") return "B";
      if (key === "companyCoyCode") return "BRAVES";
      if (key === "unitCode") return "40SAR";
      if (key === "hqLabel") return "HQ";
      return "";
    },
    displayDateToISO,
    medStatusActive,
    classifyURTI: () => "NON-URTI",
    personPlatoon: r => (r ? r.plt : ""),
    // activePlatoons drives the platoon ORDER; return every platoon the roster uses.
    activePlatoons: () => platoonsPresent.filter(c => c && c !== "HQ").map(c => ({ code: c }))
                          .concat(platoonsPresent.includes("HQ") ? [{ code: "HQ" }] : [])
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8")
    + "\n;this.generateRSFormat = generateRSFormat; this.generateRSIPersonnel = generateRSIPersonnel;\n";
  vm.runInContext(src, sandbox, { filename: "braves-parade.js" });
  return sandbox;
}

// A person who reports sick today (RSI), optionally carrying a second medical row.
function rsiRow(d4, extra) { return Object.assign({ id: `rs-${d4}`, d4, type: "RSI", date: TODAY, status: "Pending", startDate: TODAY, reason: "FEVER" }, extra || {}); }

module.exports = async function run() {
  // Three recruits report sick today; B also sits on a prior active MC.
  const ROSTER = [
    { id: "0001", name: "Alpha One", fourD: "0001", plt: "PLT1", role: "Recruit" },
    { id: "0002", name: "Bravo Two", fourD: "0002", plt: "PLT2", role: "Recruit" },
    { id: "0003", name: "Charlie Three", fourD: "0003", plt: "HQ", role: "Recruit" }
  ];
  // B's prior active MC: started a week ago, still covering today.
  const priorMC = { id: "mc-b", d4: "0002", type: "RSO", status: "MC", startDate: "2026-06-22", endDate: "2026-07-03", date: "2026-06-22" };
  const medical = () => [rsiRow("0001"), rsiRow("0002"), rsiRow("0003"), priorMC];

  // ── generateRSIPersonnel ───────────────────────────────────────────────────
  suite("RSI Personnel: omit-on-status option");

  await test("omit OFF → all three listed, TOTAL 3, every platoon shown", () => {
    const sb = loadParade(ROSTER, medical());
    const out = sb.generateRSIPersonnel(TODAY, "0700");
    ok(/TOTAL: 03 PAX/.test(out), "TOTAL counts all three");
    ok(/PLATOON 1: 01 PAX/.test(out), "PLT1 present");
    ok(/PLATOON 2: 01 PAX/.test(out), "PLT2 present");
    ok(/HQ: 01 PAX/.test(out), "HQ present");
  });

  await test("omit ON → prior-status B suppressed, TOTAL 2", () => {
    const sb = loadParade(ROSTER, medical());
    const out = sb.generateRSIPersonnel(TODAY, "0700", "", { omitOnStatus: true });
    ok(/TOTAL: 02 PAX/.test(out), "TOTAL drops to two");
    ok(/PLATOON 1: 01 PAX/.test(out), "PLT1 still present");
    ok(/HQ: 01 PAX/.test(out), "HQ still present");
  });

  await test("omit ON → a platoon emptied by filtering drops out entirely", () => {
    const sb = loadParade(ROSTER, medical());
    const out = sb.generateRSIPersonnel(TODAY, "0700", "", { omitOnStatus: true });
    ok(!/PLATOON 2/.test(out), "PLT2 (only B) disappears from the message");
  });

  await test("omit ON + platoon scope on the emptied platoon → TOTAL 0", () => {
    const sb = loadParade(ROSTER, medical());
    const out = sb.generateRSIPersonnel(TODAY, "0700", "PLT2", { omitOnStatus: true });
    ok(/TOTAL: 00 PAX/.test(out), "scoped-to-PLT2 total is zero once B is omitted");
  });

  await test("opts omitted → byte-identical to opts:false (back-compat)", () => {
    const a = loadParade(ROSTER, medical()).generateRSIPersonnel(TODAY, "0700", "");
    const b = loadParade(ROSTER, medical()).generateRSIPersonnel(TODAY, "0700", "", { omitOnStatus: false });
    eq(a, b, "default path unchanged by an explicit false");
  });

  // ── generateRSFormat (regression: the option keeps working after PR 1) ───────
  suite("RS Format: omit-on-status option (regression)");

  await test("omit ON → prior-status B suppressed from the URTI/NON-URTI counts", () => {
    const sb = loadParade(ROSTER, medical());
    const off = sb.generateRSFormat(TODAY, "0700");
    const on = sb.generateRSFormat(TODAY, "0700", { omitOnStatus: true });
    ok(/NON-URTI: 03/.test(off), "unfiltered lists all three");
    ok(/NON-URTI: 02/.test(on), "filtered drops B");
  });

  // ── Widened predicate (bpHasOtherStatus) ────────────────────────────────────
  // The omit toggle originally suppressed only personnel whose other status
  // STARTED before the report date. It now suppresses anyone carrying an unexpired
  // other status regardless of when it starts — so an MC handed out as the outcome
  // of today's report sick, or a future-dated status, also drop the entry. A
  // status is "unexpired" iff it has a real end date on or after the report date;
  // a blank end date does NOT suppress (consistent with medStatusActive, which
  // treats end-less records as inactive everywhere else).
  suite("RS Format: widened omit predicate (starts today / future / edge cases)");

  // Each person reports sick today and carries exactly one OTHER medical record.
  const wRoster = [
    { id: "0004", name: "Delta Four", fourD: "0004", plt: "PLT1", role: "Recruit" },   // MC starts TODAY
    { id: "0005", name: "Echo Five", fourD: "0005", plt: "PLT1", role: "Recruit" },     // MC starts in the FUTURE
    { id: "0006", name: "Foxtrot Six", fourD: "0006", plt: "PLT1", role: "Recruit" },   // MC already ENDED
    { id: "0007", name: "Golf Seven", fourD: "0007", plt: "PLT1", role: "Recruit" }     // MC with BLANK end date
  ];
  // The OTHER records carry a BLANK visit type (a pure status record, not an
  // RSI/RSO sick visit), so bpSickReports never counts them as a second report —
  // matching how a standalone MC/LD status is stored, distinct from the day's
  // report-sick row.
  const wMedical = () => [
    rsiRow("0004"), rsiRow("0005"), rsiRow("0006"), rsiRow("0007"),
    { id: "o-4", d4: "0004", type: "", status: "MC", startDate: TODAY,         endDate: "2026-07-03", date: TODAY },
    { id: "o-5", d4: "0005", type: "", status: "MC", startDate: "2026-07-01",  endDate: "2026-07-05", date: "2026-07-01" },
    { id: "o-6", d4: "0006", type: "", status: "MC", startDate: "2026-06-20",  endDate: "2026-06-25", date: "2026-06-20" },
    { id: "o-7", d4: "0007", type: "", status: "LD", startDate: "2026-06-22", endDate: "",           date: "2026-06-22" }
  ];

  await test("status starting TODAY (outcome of this report sick) is suppressed", () => {
    const on = loadParade(wRoster, wMedical()).generateRSFormat(TODAY, "0700", { omitOnStatus: true });
    ok(!/Delta Four/.test(on), "Delta's own MC starting today accounts for him → omitted");
  });

  await test("status starting in the FUTURE is suppressed", () => {
    const on = loadParade(wRoster, wMedical()).generateRSFormat(TODAY, "0700", { omitOnStatus: true });
    ok(!/Echo Five/.test(on), "Echo's future-dated MC accounts for him → omitted");
  });

  await test("status that ENDED before the report date is still listed", () => {
    const on = loadParade(wRoster, wMedical()).generateRSFormat(TODAY, "0700", { omitOnStatus: true });
    ok(/Foxtrot Six/.test(on), "Foxtrot's expired MC does not account for a fresh report sick");
  });

  await test("a BLANK end date does NOT suppress (resolved edge case)", () => {
    const on = loadParade(wRoster, wMedical()).generateRSFormat(TODAY, "0700", { omitOnStatus: true });
    ok(/Golf Seven/.test(on), "an end-less status is treated as inactive, so Golf stays listed");
  });

  await test("net count: only the two unexpired-status people drop", () => {
    const off = loadParade(wRoster, wMedical()).generateRSFormat(TODAY, "0700");
    const on = loadParade(wRoster, wMedical()).generateRSFormat(TODAY, "0700", { omitOnStatus: true });
    ok(/NON-URTI: 04/.test(off), "all four listed unfiltered");
    ok(/NON-URTI: 02/.test(on), "Delta + Echo omitted; Foxtrot + Golf remain");
  });

  // ── forms.js UI wiring ───────────────────────────────────────────────────────
  // openReportModal is too DOM-heavy for the vm harness, so guard the wiring by
  // source-string assertion (the render-wiring.test.js / forms-wiring.test.js
  // pattern): the checkbox must render for RSIP as well as RS, its onchange must
  // dispatch to the actual report type (not a hardcoded "RS"), and the RSIP
  // branch must forward the checkbox state into generateRSIPersonnel.
  suite("forms wiring: omit toggle reaches the RSI Personnel report");
  const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");

  await test("the omit checkbox is gated on RS OR RSIP, not RS alone", () => {
    ok(/showOmitToggle\s*=\s*type === "RS" \|\| type === "RSIP"/.test(forms),
      "showOmitToggle no longer covers both report types");
    ok(/\$\{showOmitToggle \? `<label/.test(forms),
      "the checkbox block is still gated on the old isRS flag");
  });

  await test("the checkbox onchange dispatches to the live report type", () => {
    ok(/id="rep-omit-status" onchange="regenerateReport\('\$\{type\}'\)"/.test(forms),
      "onchange still hardcodes regenerateReport('RS') — RSIP toggling would regenerate the wrong report");
  });

  await test("the RSIP branch forwards the checkbox into generateRSIPersonnel", () => {
    ok(/generateRSIPersonnel\(dateIso, time, code, \{ omitOnStatus: !!document\.getElementById\("rep-omit-status"\)\?\.checked \}\)/.test(forms),
      "RSIP dispatch does not pass the omitOnStatus option");
  });
};
