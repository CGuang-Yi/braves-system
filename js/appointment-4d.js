// Parser for appointment-coded 4Ds.
//
// Commanders carry an appointment code in the Roster `fourD` column rather than
// a numeric 4D: "SC21" is the section commander of platoon 2 section 1, "PS2" the
// platoon sergeant of platoon 2, "PC2" its platoon commander. The `id` column is
// unaffected and still holds the administrative 00xx value, so padD4() and the
// /^00\d{2}$/ commander auto-detection in normalizeRoster() are untouched by this.
//
// WHY THIS IS ITS OWN FILE. Both js/helpers.js (personPlatoon/personSection) and
// js/duty-eligibility.js (dutyAppointmentOf) call in here, and each of those two
// is loaded ALONE into a vm sandbox by an existing test — duty-eligibility.test.js
// and parade-port-parity.test.js respectively. Putting the parser in either one
// makes the other's sandbox throw ReferenceError. A leaf below both loads cleanly
// into either, and earns a tsconfig slot and an isolated unit test besides.
//
// WHY IT PARSES AND NEVER WRITES. Callers use this as a fallback tier beneath the
// explicit roster column, never as a source of truth to persist. writeTab derives
// sheet headers from Object.keys(data[0]), so anything stamped onto a roster row
// round-trips into the Google Sheet on the next push — silently backfilling
// columns the user never typed. Derive on read; leave the sheet alone. This is the
// same shape as padD4 / canonicalPlatoonCode / rankGroupOf.

// Single-digit platoon AND section, both 1-9. Deliberately strict: "SC211" is
// ambiguous (plt 2 sect 11, or plt 21 sect 1?) so it returns null and the caller
// keeps whatever behaviour it had before, rather than acting on a guess. Widening
// this regex without a separator in the code would silently re-introduce that
// ambiguity, so don't — add a separator to the convention first.
const APPT4D_SECT = /^SC([1-9])([1-9])$/i;
const APPT4D_CMD = /^(PC|PS)([1-9])$/i;

// "SC21" -> { appointment: "SectComd", platoon: "PLT2", section: "1" }
// "PC2"  -> { appointment: "PC",       platoon: "PLT2", section: "Command" }
// Anything unrecognised -> null. `platoon` is emitted as the canonical "PLT<n>"
// code (matching canonicalPlatoonCode and what personPlatoon returns), and
// `section` uses the org model's "Command" for PC/PS (see js/state.js).
function parseAppointment4D(fourD) {
  const s = String(fourD == null ? "" : fourD).trim();
  if (!s) return null;
  const sc = APPT4D_SECT.exec(s);
  if (sc) return { appointment: "SectComd", platoon: "PLT" + sc[1], section: sc[2] };
  const cmd = APPT4D_CMD.exec(s);
  if (cmd) return { appointment: cmd[1].toUpperCase(), platoon: "PLT" + cmd[2], section: "Command" };
  return null;
}

// Sort key for the 4D column. Numeric fourD, else numeric id, else last.
//
// Restores the pre-existing intent. Call sites used to read `r.fourD || r.id`,
// which fell through to the id for commanders because their fourD was blank —
// so 00xx sorted them first. An appointment-coded fourD is truthy but NOT
// numeric, so the || stopped falling through and parseInt("SC21") -> NaN ->
// Infinity dumped every commander at the bottom. Testing for numeric rather
// than truthy is the whole fix.
function fourDSortKey(r) {
  if (!r) return Infinity;
  const f = String(r.fourD == null ? "" : r.fourD).trim();
  if (/^\d+$/.test(f)) return parseInt(f, 10);
  const id = String(r.id == null ? "" : r.id).trim();
  if (/^\d+$/.test(id)) return parseInt(id, 10);
  return Infinity;
}

// Node test export (browser ignores `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseAppointment4D, fourDSortKey };
}
