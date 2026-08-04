// The platoon gate on accumulated report-sick history (spec §1).
//
// This is a SERVER-SIDE gate: the client helpers only hide UI. So the tests that
// matter are the ones a hand-rolled request would hit — scope resolution from a
// token, and the row cut that decides what a scoped caller is allowed to see.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend } = require("./harness");

module.exports = async function run() {
  suite("rs-scope: scope resolution");

  const ROSTER_HEADERS = ["id", "name", "role", "platoon", "section", "fourD"];
  const ROSTER_ROWS = [
    ["0011", "PC ONE", "Commander", "PLT1", "Command", "PC1"],
    ["0021", "PC TWO", "Commander", "PLT2", "Command", "PC2"],
    ["0001", "OC", "Commander", "HQ", "", ""],
    ["1101", "REC ALPHA", "Recruit", "PLT1", "1", "1101"],
    ["2101", "REC BRAVO", "Recruit", "PLT2", "1", "2101"],
    ["0099", "HQ CLERK", "Commander", "HQ", "", ""]
  ];
  const seedRoster = b => b.db.seed("Roster", ROSTER_HEADERS, ROSTER_ROWS);

  const ctx = (role, caps, personId) => ({
    email: "x@example.com", personId: personId || "0011", role: role,
    caps: caps || "", issuedAt: new Date().toISOString()
  });

  await test("admin resolves to company scope", () => {
    const b = loadBackend();
    seedRoster(b);
    const s = b.rsScopeOf_(ctx("admin", ""));
    ok(s.company, "company");
    eq(b.rsScopeKey_(s), "company", "key");
  });

  await test("rs:company cap resolves to company scope", () => {
    const b = loadBackend();
    seedRoster(b);
    ok(b.rsScopeOf_(ctx("commander", "rs:company")).company, "company");
  });

  await test("rs:plt:<key> caps resolve to exactly those platoons, uppercased", () => {
    const b = loadBackend();
    seedRoster(b);
    // parseCaps lowercases, so the stored cap is "rs:plt:plt2" while the roster
    // says "PLT2". If this test passes with a raw comparison, the normalisation
    // is missing and it will silently grant nothing in production.
    const s = b.rsScopeOf_(ctx("commander", "rs:plt:plt2,rs:plt:hq"));
    ok(!s.company, "not company");
    eq(b.rsScopeKey_(s), "HQ|PLT2", "sorted, uppercased, pipe-joined");
  });

  await test("with no caps, scope falls back to the caller's own platoon", () => {
    const b = loadBackend();
    seedRoster(b);
    eq(b.rsScopeKey_(b.rsScopeOf_(ctx("commander", "", "0021"))), "PLT2", "own platoon");
  });

  // Failing CLOSED is the point: an unresolvable platoon is a data problem, and a
  // thin RS log prompts someone to fix it. Failing open hands out the company.
  await test("an unresolvable personId yields an EMPTY scope, not company", () => {
    const b = loadBackend();
    seedRoster(b);
    const s = b.rsScopeOf_(ctx("commander", "", "9999"));
    ok(!s.company, "not company");
    eq(b.rsScopeKey_(s), "", "empty key");
    eq(b.rsPersonInScope_(s, "1101", b.rsPlatoonIndex_()), false, "sees nobody");
  });

  await test("HQ is its own scope — a PLT1 commander does not hold it", () => {
    const b = loadBackend();
    seedRoster(b);
    const idx = b.rsPlatoonIndex_();
    const s = b.rsScopeOf_(ctx("commander", "", "0011"));
    eq(b.rsPersonInScope_(s, "1101", idx), true, "own platoon in scope");
    eq(b.rsPersonInScope_(s, "0099", idx), false, "HQ clerk out of scope");
    eq(b.rsPersonInScope_(s, "2101", idx), false, "PLT2 out of scope");
  });

  await test("the platoon index pads 4Ds, so an unpadded lookup still resolves", () => {
    const b = loadBackend();
    seedRoster(b);
    const idx = b.rsPlatoonIndex_();
    eq(idx["0011"], "PLT1", "padded key present");
    const s = b.rsScopeOf_(ctx("commander", "", "0011"));
    eq(b.rsPersonInScope_(s, 11, idx), true, "numeric 11 resolves to 0011");
  });

  suite("rs-scope: capability validation");

  const acct = b => b.db.seed("Accounts",
    ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt", "caps"],
    [["p@example.com", "0021", "commander", "h", "s", "", "", ""]]);
  const ADMIN = { email: "a@example.com", personId: "0001", role: "admin" };

  await test("rs:company and rs:plt:<key> are accepted", () => {
    const b = loadBackend();
    acct(b);
    const r = b.handleSetAccountCaps({ targetEmail: "p@example.com", caps: "duty,rs:company" }, ADMIN);
    ok(r.ok, "granted: " + JSON.stringify(r));
    eq(b.db.rowsOf("Accounts")[0].caps, "duty,rs:company", "cell written");

    ok(b.handleSetAccountCaps({ targetEmail: "p@example.com", caps: "rs:plt:PLT2,rs:plt:HQ" }, ADMIN).ok,
       "platoon grants accepted");
    eq(b.db.rowsOf("Accounts")[0].caps, "rs:plt:plt2,rs:plt:hq", "stored lowercased by parseCaps");
  });

  // The allowlist is the only thing between a typo and a commander who was
  // "granted" something that will never match. It must stay strict as it gains
  // a prefix form.
  await test("a bare rs:plt: with no key is rejected", () => {
    const b = loadBackend();
    acct(b);
    const r = b.handleSetAccountCaps({ targetEmail: "p@example.com", caps: "rs:plt:" }, ADMIN);
    ok(r.error, "rejected: " + r.error);
    eq(b.db.rowsOf("Accounts")[0].caps, "", "row untouched");
  });

  await test("near-miss capability names are still rejected", () => {
    const b = loadBackend();
    acct(b);
    ["rs:companies", "rs:plt", "rsplt:1", "rs:coy", "dutty"].forEach(bad => {
      const r = b.handleSetAccountCaps({ targetEmail: "p@example.com", caps: bad }, ADMIN);
      ok(r.error, bad + " rejected");
    });
    eq(b.db.rowsOf("Accounts")[0].caps, "", "row untouched throughout");
  });

  await test("the duty capability is unaffected", () => {
    const b = loadBackend();
    acct(b);
    ok(b.handleSetAccountCaps({ targetEmail: "p@example.com", caps: "duty" }, ADMIN).ok, "duty still granted");
  });

  suite("rs-scope: the operational/history cut");

  // Rows carry DISPLAY dates ("16 May 2026"), which is what displayDateToISO
  // parses — not ISO. Building fixtures in ISO would pass a broken cut.
  const disp = iso => {
    const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const [y, m, d] = iso.split("-");
    return d + " " + M[parseInt(m, 10) - 1] + " " + y;
  };
  const TODAY = "2026-08-04";
  const op = (b, row) => b.rsRowIsOperational_("Medical", row, TODAY);

  await test("a blank endDate is operational — an open MC has not ended", () => {
    const b = loadBackend();
    ok(op(b, { d4: "1101", status: "MC", endDate: "", bookInDate: disp("2026-01-01") }), "open-ended");
  });

  await test("a row inside the 2-day ghost tail is operational", () => {
    const b = loadBackend();
    // MC+1/MC+2 recovery tags are computed at render time from a CLOSED record.
    // Cutting at exactly `today` makes them vanish for out-of-scope people.
    ok(op(b, { d4: "1101", endDate: disp("2026-08-02"), bookInDate: disp("2026-08-03") }), "today-2 kept");
    ok(op(b, { d4: "1101", endDate: disp("2026-08-04"), bookInDate: disp("2026-08-04") }), "today kept");
  });

  await test("a row past the ghost tail with a bookInDate is history", () => {
    const b = loadBackend();
    eq(op(b, { d4: "1101", endDate: disp("2026-08-01"), bookInDate: disp("2026-08-02") }), false, "today-3 cut");
    eq(op(b, { d4: "1101", endDate: disp("2026-03-01"), bookInDate: disp("2026-03-02") }), false, "months old cut");
  });

  // THE LOAD-BEARING CASE. Per PR #65 an ended-but-unbooked MC stays listed under
  // ATT C: the dates say it is over, the person was never booked in, and the
  // classifier keeps them away. Such a row can be arbitrarily old. Drop it and a
  // scoped commander's COMPANY parade state silently loses people — which looks
  // exactly like a correct parade state. Do not "simplify" this clause away.
  await test("an ended-but-unbooked row survives the cut no matter how old", () => {
    const b = loadBackend();
    ok(op(b, { d4: "1101", endDate: disp("2025-11-01"), bookInDate: "" }), "no bookInDate → operational");
    ok(op(b, { d4: "1101", endDate: disp("2025-11-01") }), "absent bookInDate key → operational");
    ok(op(b, { d4: "1101", endDate: disp("2025-11-01"), bookInDate: "   " }), "whitespace → operational");
  });

  // MSK has no endDate and no bookInDate (schema: timestamp | d4 | type |
  // description | physioDate | exercises | cleared | manualRegions), so the date
  // cut is undefined there. `cleared` is the analogue: a live injury stays
  // visible, a closed case is history. See plan deviation D2.
  await test("MSK cuts on `cleared`, not on dates", () => {
    const b = loadBackend();
    const m = r => b.rsRowIsOperational_("MSK", r, TODAY);
    ok(m({ d4: "1101", cleared: "" }), "uncleared → operational");
    ok(m({ d4: "1101" }), "absent cleared → operational");
    eq(m({ d4: "1101", cleared: true }), false, "cleared boolean → history");
    eq(m({ d4: "1101", cleared: "TRUE" }), false, "cleared string → history");
  });
};
