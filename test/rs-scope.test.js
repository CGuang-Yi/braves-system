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
};
