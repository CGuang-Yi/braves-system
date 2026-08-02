// Guards the Log Conduct wizard's save→sync wiring in forms.js. forms.js is too
// DOM/wizard-state heavy to execute in the vm harness, so — like
// render-wiring.test.js — this asserts against the source string.
//
// Regression (PR #24 follow-up): saveLogConductWizard() merges the wizard's
// partial entry onto the existing row locally (mergeAttendanceEdit, so
// participants/periods/currencyTags/source survive), but the OCC upsert push
// still sent the un-merged `attendanceEntry`. The backend upsertRow rebuilds
// the sheet row from the pushed object's keys, so any missing column is blanked
// — re-stripping the CSV-only fields the merge had just preserved (and also
// pushing a stale lms:0, since recomputeAttendanceLmsFromPolar mutates the
// STATE row, not attendanceEntry). The pushed row MUST be the object that
// actually landed in STATE.
const fs = require("fs");
const path = require("path");
const { suite, test, ok } = require("./_tap");
const { sourceText } = require("./sources");

module.exports = async function run() {
  suite("forms wiring: Log Conduct wizard pushes the merged row (PR #24 follow-up)");
  const forms = sourceText("forms");

  await test("saveLogConductWizard's Attendance upsert does NOT push the bare attendanceEntry", () => {
    ok(!/autoSync\(\s*"Attendance"\s*,\s*\{\s*type:\s*"upsert"\s*,\s*row:\s*attendanceEntry\s*\}/.test(forms),
      "still pushes attendanceEntry — CSV-only fields + recomputed lms are lost on the sheet");
  });

  await test("it pushes the row that actually landed in STATE (the merged row)", () => {
    ok(/autoSync\(\s*"Attendance"\s*,\s*\{\s*type:\s*"upsert"\s*,\s*row:\s*syncedRow\s*\}/.test(forms),
      "Attendance upsert no longer pushes `syncedRow`");
    // syncedRow must be assigned from the merge on the edit path, not rebuilt.
    ok(/syncedRow\s*=\s*STATE\.attendance\[idx\]\s*=\s*mergeAttendanceEdit\(/.test(forms),
      "syncedRow is not tied to the mergeAttendanceEdit result on the edit path");
  });

  suite("forms wiring: submitMedical no longer mirrors medical status onto the Roster (item 4a)");

  await test("submitMedical does not push a Roster upsert or carry the rosterEdit mirror", () => {
    const body = forms.slice(forms.indexOf("function submitMedical"), forms.indexOf("function openAttendanceForm"));
    ok(!/autoSync\(\s*"Roster"/.test(body), "submitMedical still pushes a Roster upsert");
    ok(!/rosterEdit/.test(body), "submitMedical still carries the rosterEdit roster-mirror plumbing");
    ok(!/r\.status\s*=\s*main\.status/.test(body), "submitMedical still writes r.status = main.status");
  });

  // Feature 32 — Enter saves the medical form even with nothing focused. The
  // handler itself is exercised in a real browser (a synthetic keydown in the vm
  // harness would prove nothing about implicit submission); what's pinned here is
  // the set of guards, because each one silently un-breaks a different modal and
  // none of them is obvious enough to survive a tidy-up on its own.
  suite("forms wiring: the medical form's Enter-to-save is bound once and self-gated");

  await test("the binder is called from openMedicalForm and guards against re-binding", () => {
    ok(/bindMedicalEnterToSave\(\);/.test(forms.slice(forms.indexOf("function openMedicalForm"),
                                                      forms.indexOf("function openMedicalForm") + 1200)),
      "openMedicalForm no longer arms the Enter handler");
    // The listener sits on #modal-overlay, which outlives every modal — binding
    // per open would stack one listener per time the form was ever opened.
    ok(/_medEnterBound/.test(forms), "the bind-once flag is gone; listeners will stack per open");
  });

  await test("the form carries the id the handler gates on", () => {
    ok(/<form id="med-form"/.test(forms),
      "#med-form is gone — the handler can no longer tell the medical form from any other modal");
  });

  await test("it submits through the form, so HTML5 required validation still runs", () => {
    const body = forms.slice(forms.indexOf("function bindMedicalEnterToSave"),
                             forms.indexOf("function openMedicalForm"));
    ok(/form\.requestSubmit\(\)/.test(body),
      "no requestSubmit — calling submitMedical directly would skip `required` and half-save");
    ok(!/submitMedical\(\)/.test(body),
      "the handler calls submitMedical directly, bypassing the form's validation");
    ok(/form\.contains\(e\.target\)/.test(body),
      "the focus-inside-the-form bail-out is gone — Enter in a field would double-fire, "
      + "and it would step on personSearchEnter's pick-the-top-match");
    ok(/TEXTAREA/.test(body), "the textarea guard is gone — Enter would save instead of newline");
    ok(/classList\.contains\("hidden"\)/.test(body),
      "no hidden-overlay guard — Enter with no modal open could fire a save");
  });

  suite("parade-tab wiring: the roster mirror is gone (item 4a)");
  const paradeTab = fs.readFileSync(path.join(__dirname, "..", "js", "parade-tab.js"), "utf8");

  await test("mirrorRoster is fully removed from parade-tab.js", () => {
    ok(!/mirrorRoster/.test(paradeTab), "parade-tab.js still references mirrorRoster");
    ok(!/rosterStatus/.test(paradeTab), "saveParadeCode still carries the unused rosterStatus var");
  });
};
