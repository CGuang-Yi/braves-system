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

module.exports = async function run() {
  suite("forms wiring: Log Conduct wizard pushes the merged row (PR #24 follow-up)");
  const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");

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
};
