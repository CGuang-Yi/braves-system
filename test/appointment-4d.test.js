// Unit tests for the appointment-coded 4D parser, loaded in isolation.
//
// The module is a leaf by design (see js/appointment-4d.js's header): both
// js/helpers.js and js/duty-eligibility.js call it, and each of those is loaded
// ALONE by a different existing test harness, so the parser cannot live in
// either without breaking the other's sandbox.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

function loadParser() {
  const sandbox = { module: { exports: {} }, String, Number, Object, JSON, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "appointment-4d.js"), "utf8"),
    sandbox, { filename: "appointment-4d.js" }
  );
  return sandbox;
}

module.exports = async function run() {
  const m = loadParser();

  suite("appointment-4d: parseAppointment4D");

  await test("SC<plt><sect> is a section commander with a numbered section", () => {
    eq(m.parseAppointment4D("SC21"), { appointment: "SectComd", platoon: "PLT2", section: "1" });
    eq(m.parseAppointment4D("SC14"), { appointment: "SectComd", platoon: "PLT1", section: "4" });
  });

  await test("PC<plt> and PS<plt> land in the Command section of their platoon", () => {
    eq(m.parseAppointment4D("PC2"), { appointment: "PC", platoon: "PLT2", section: "Command" });
    eq(m.parseAppointment4D("PS2"), { appointment: "PS", platoon: "PLT2", section: "Command" });
  });

  await test("parsing is case-insensitive and tolerates surrounding whitespace", () => {
    // The sheet is typed by hand; "sc21" and " PC2 " are the same appointment.
    eq(m.parseAppointment4D("sc21"), { appointment: "SectComd", platoon: "PLT2", section: "1" });
    eq(m.parseAppointment4D("  PC2  "), { appointment: "PC", platoon: "PLT2", section: "Command" });
  });

  await test("a recruit 4D is not an appointment code", () => {
    // The single most important null: recruit 4Ds vastly outnumber commander
    // ones, and mis-parsing one would rewrite a recruit's platoon.
    eq(m.parseAppointment4D("1101"), null);
    eq(m.parseAppointment4D("1411"), null);
  });

  await test("blank, nullish and junk values return null rather than guessing", () => {
    eq(m.parseAppointment4D(""), null);
    eq(m.parseAppointment4D("   "), null);
    eq(m.parseAppointment4D(null), null);
    eq(m.parseAppointment4D(undefined), null);
    eq(m.parseAppointment4D("Commander"), null);
    eq(m.parseAppointment4D("OC"), null);
  });

  await test("out-of-range and multi-digit forms return null instead of being mis-parsed", () => {
    // Single-digit is a confirmed constraint. "SC211" is ambiguous (plt 2 sect 11
    // or plt 21 sect 1?), so it must fall through to existing behaviour, not guess.
    eq(m.parseAppointment4D("SC211"), null);
    eq(m.parseAppointment4D("PC12"), null);
    eq(m.parseAppointment4D("SC01"), null);
    eq(m.parseAppointment4D("SC20"), null);
    eq(m.parseAppointment4D("PC0"), null);
    eq(m.parseAppointment4D("SC2"), null);
  });

  suite("appointment-4d: fourDSortKey");

  // NOTE: these assert with ok(===) and not eq(). eq() compares via
  // JSON.stringify, and JSON.stringify(Infinity) is "null" — so an eq() against
  // Infinity would pass for null, undefined and NaN alike, which is precisely
  // the class of bug this helper exists to prevent.

  await test("a numeric fourD sorts on its own value", () => {
    ok(m.fourDSortKey({ fourD: "1101", id: "1101" }) === 1101);
  });

  await test("an appointment-coded fourD falls through to the numeric id", () => {
    // This is the bug being fixed: parseInt("SC21") is NaN, which the old call
    // sites coerced to Infinity, sorting every commander to the bottom.
    ok(m.fourDSortKey({ fourD: "SC21", id: "0003" }) === 3, "SC21 should fall through to id 0003");
    ok(m.fourDSortKey({ fourD: "PC2", id: "0001" }) === 1, "PC2 should fall through to id 0001");
  });

  await test("a blank fourD falls through to the id, as it always did", () => {
    ok(m.fourDSortKey({ fourD: "", id: "0007" }) === 7);
  });

  await test("a row with no usable number sorts last, not first", () => {
    ok(m.fourDSortKey({ fourD: "SC21", id: "ABC" }) === Infinity, "no numeric anywhere ⇒ last");
    ok(m.fourDSortKey({}) === Infinity, "empty row ⇒ last");
    ok(m.fourDSortKey(null) === Infinity, "null row ⇒ last");
  });
};
