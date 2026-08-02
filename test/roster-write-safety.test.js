// Regression: writing a single Roster row must UPDATE that person, not add a
// second copy of them, and must not blank the columns the writing form doesn't
// collect.
//
// Two independent bugs, both surfaced by PR #106 making roster `notes` editable
// from the person card (js/forms.js personNotesSave) — the first code path that
// makes per-row Roster writes reachable for ordinary recruits rather than just
// commanders:
//
//   1. upsertRow looked for a column literally named "id". The live Roster keys
//      on the 4D under the header "4d" (see readTab's normalizer comment in
//      apps-script-Code.gs: "the Roster id column (named 4d on the sheet)"), so
//      ensureColumnsForKeys minted a brand-new EMPTY "id" column, the row match
//      found nothing, and the write fell through to the APPEND branch —
//      duplicating the person on the sheet. On the next pull that person is in
//      STATE.roster twice, double-counting them in strengthRoster()/bpStrength()
//      and the parade state. Even on a sheet that does carry an "id" column,
//      Sheets stores "0007" as the number 7, so the String() compare could never
//      match a commander (0001-0099) or a leading-zero 4D like "0110".
//
//   2. submitCommander merged the form into STATE but pushed only the bare
//      `entry` it collected. upsertRow rewrites EVERY sheet column from the row
//      it is handed (`trimmed.map(h => rowData[h] ?? "")`), so an edit that
//      changed a phone number blanked notes/age/email/allergies/msk/... on the
//      sheet, and the next pull dropped them from STATE.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, VALID_TOKEN, ROOT } = require("./harness");
const { makeBrowser } = require("./mocks/browser");
const { expandFiles } = require("./sources");

module.exports = async function run() {
  suite("Roster row writes: key column resolution (backend)");

  const post = (backend, body) => {
    const out = backend.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({ auth: VALID_TOKEN }, body)) } });
    return JSON.parse(out.getContent());
  };

  // The shape the frontend actually pushes: normalizeRoster spreads the sheet's
  // own keys through, so the row carries BOTH the sheet's "4d" (as read, i.e.
  // numerically coerced) and the padded "id" it derived from it.
  const rosterRow = (fourD, id, extra) => Object.assign({ "4d": fourD, id, name: "Alpha" }, extra || {});

  await test('a "4d"-headed Roster updates in place instead of appending a duplicate', () => {
    const b = loadBackend();
    b.db.seed("Roster", ["4d", "name", "notes"], [[1411, "Alpha", "old note"]]);
    const r = post(b, {
      action: "upsertRow", tab: "Roster",
      row: rosterRow(1411, "1411", { notes: "new note" }), baseRev: b.getRev("Roster")
    });
    ok(r.ok, "write accepted");
    eq(r.action, "updated", "matched the existing row rather than appending");
    const rows = b.db.rowsOf("Roster");
    eq(rows.length, 1, "the person was duplicated on the sheet");
    eq(rows[0].notes, "new note", "the edit did not apply");
  });

  await test('a "4d"-headed Roster does not gain a redundant "id" column', () => {
    const b = loadBackend();
    b.db.seed("Roster", ["4d", "name"], [[1411, "Alpha"]]);
    post(b, { action: "upsertRow", tab: "Roster", row: rosterRow(1411, "1411", { phone: "999" }), baseRev: b.getRev("Roster") });
    const cols = Object.keys(b.db.rowsOf("Roster")[0]);
    ok(cols.indexOf("id") === -1, 'a second identity column ("id") was minted beside "4d"');
    ok(cols.indexOf("phone") !== -1, "genuinely new columns are still auto-created");
  });

  await test("a leading-zero 4D matches the number Sheets coerced it to", () => {
    const b = loadBackend();
    // Commanders are 0001-0099 and recruits include ids like 0110 — Sheets stores
    // both as plain numbers, which is what a real pull reads back.
    b.db.seed("Roster", ["4d", "name", "phone"], [[7, "Cmdr", "111"], [110, "Rec", "222"]]);
    post(b, { action: "upsertRow", tab: "Roster", row: rosterRow(7, "0007", { name: "Cmdr", phone: "999" }), baseRev: b.getRev("Roster") });
    post(b, { action: "upsertRow", tab: "Roster", row: rosterRow(110, "0110", { name: "Rec", phone: "888" }), baseRev: b.getRev("Roster") });
    const rows = b.db.rowsOf("Roster");
    eq(rows.length, 2, "leading-zero ids appended duplicates instead of matching");
    eq(rows[0].phone, "999", "0007 updated the right row");
    eq(rows[1].phone, "888", "0110 updated the right row");
    // ...and the key is written back PADDED, so the value stops depending on
    // whatever Sheets happened to coerce it to on the last full rewrite.
    eq(String(rows[0]["4d"]), "0007", "the key column was not re-normalised on write");
  });

  await test('an "id"-headed Roster still works, with the same padded match', () => {
    const b = loadBackend();
    b.db.seed("Roster", ["id", "name", "phone"], [[7, "Cmdr", "111"]]);
    const r = post(b, { action: "upsertRow", tab: "Roster", row: { id: "0007", name: "Cmdr", phone: "999" }, baseRev: b.getRev("Roster") });
    eq(r.action, "updated", "an id-headed sheet must behave identically");
    eq(b.db.rowsOf("Roster").length, 1, "duplicate appended");
  });

  await test("the Roster key column is written as plain text", () => {
    const b = loadBackend();
    b.db.seed("Roster", ["4d", "name"], [[7, "Cmdr"]]);
    post(b, { action: "upsertRow", tab: "Roster", row: rosterRow(7, "0007"), baseRev: b.getRev("Roster") });
    eq(b.db.numberFormat("Roster", 1), "@", 'the "4d" column was left coercion-prone');
  });

  await test("deleteRowById finds the row the matching upsert would have updated", () => {
    const b = loadBackend();
    b.db.seed("Roster", ["4d", "name"], [[7, "Cmdr"], [1411, "Alpha"]]);
    const r = post(b, { action: "deleteRowById", tab: "Roster", id: "0007", baseRev: b.getRev("Roster") });
    eq(r.action, "deleted", "delete could not resolve the key column");
    eq(b.db.rowsOf("Roster").map(x => String(x["4d"])), ["1411"], "the wrong row was deleted");
  });

  await test("non-Roster tabs keep the strict, unpadded id compare", () => {
    // Every other tab keys on the numeric nextId() counter, where "7" and "0007"
    // are genuinely different ids — padding them together would merge rows.
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], [[7, "fever"]]);
    const r = post(b, { action: "upsertRow", tab: "Medical", row: { id: "0007", reason: "other" }, baseRev: b.getRev("Medical") });
    eq(r.action, "appended", "a padded Medical id must NOT collapse onto id 7");
    eq(b.db.rowsOf("Medical").length, 2, "rows merged");
  });

  suite("Roster row writes: submitCommander pushes the whole row");

  const FILES = expandFiles(["js/state.js", "js/api.js", "js/ippt-scoring.js", "js/calc.js",
    "js/helpers.js", "js/sick-history-import.js", "js/render.js", "js/forms.js", "js/braves-parade.js"]);

  function loadFrontend(fx) {
    const browser = makeBrowser();
    const sb = Object.assign({
      console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
      isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, URL, Intl
    }, browser.globals);
    sb.globalThis = sb;
    vm.createContext(sb);
    for (const f of FILES) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
    }
    vm.runInContext(
      "Object.keys(STATE).forEach(k => { delete STATE[k]; }); Object.assign(STATE, "
        + JSON.stringify(fx) + ");"
      + "STATE.apiUrl = 'http://x';"
      + "saveLocal = () => {}; closeModal = () => {}; render = () => {};"
      // sync.js is not loaded here — capture what forms.js hands the sync engine.
      + "pushed = []; autoSync = (tab, mode) => { pushed.push({ tab, mode }); };",
      sb, { filename: "install-fixture.js" });
    return sb;
  }

  function submit(sb, fnName, fields) {
    const src = Object.entries(fields)
      .map(([id, v]) => `document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)};`)
      .join("\n") + `\n${fnName}();`;
    vm.runInContext(src, sb, { filename: "drive-submit.js" });
  }

  await test("editing a commander does not blank the columns the form has no input for", () => {
    const sb = loadFrontend({
      roster: [{
        id: "0007", "4d": 7, name: "Cmdr", rank: "3SG", role: "Commander",
        platoon: "HQ", section: "Command", rankGroup: "WOSPEC", fourD: "",
        leaveQuota: 5, phone: "111", status: "Active",
        // Everything below is maintained in the Sheet (or, for notes, from the
        // person card) and has no field on the commander form.
        notes: "keeps the coy keys", age: 23, email: "a@b.c", allergies: "peanuts",
        msk: "old ankle sprain", ration: "halal", height: 175, weight: 70
      }],
      medical: [], leave: [], attendance: [], appointments: [], config: [], msk: []
    });
    submit(sb, "submitCommander", {
      "f-entry-id": "0007", "f-id": "0007", "f-name": "Cmdr", "f-rank": "3SG",
      "f-quota": "5", "f-phone": "222", "f-platoon": "HQ", "f-section": "Command",
      "f-rankgroup": "WOSPEC"
    });
    const pushed = vm.runInContext("pushed", sb);
    eq(pushed.length, 1, "exactly one Roster write");
    eq(pushed[0].tab, "Roster");
    const row = pushed[0].mode.row;
    eq(row.phone, "222", "the edit itself did not apply");
    eq(row.notes, "keeps the coy keys", "notes would be blanked on the sheet");
    eq(row.allergies, "peanuts", "allergies would be blanked on the sheet");
    eq(row.msk, "old ankle sprain", "msk history would be blanked on the sheet");
    eq(row.age, 23, "age would be blanked on the sheet");
    eq(row.email, "a@b.c", "email would be blanked on the sheet");
  });

  await test("adding a commander still pushes just the new row", () => {
    const sb = loadFrontend({
      roster: [], medical: [], leave: [], attendance: [], appointments: [], config: [], msk: []
    });
    submit(sb, "submitCommander", {
      "f-entry-id": "", "f-id": "0012", "f-name": "New", "f-rank": "2LT",
      "f-quota": "0", "f-phone": "", "f-platoon": "PLT1", "f-section": "Command",
      "f-rankgroup": "Officer"
    });
    const pushed = vm.runInContext("pushed", sb);
    eq(pushed.length, 1, "exactly one Roster write");
    eq(pushed[0].mode.row.id, "0012", "the new commander was pushed");
    eq(vm.runInContext("STATE.roster.length", sb), 1, "and added locally");
  });
};
