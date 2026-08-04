// The duty-planning capability gate (MD_Docs/DUTY_LIST_SPEC.md §9).
//
// This is the ONLY thing actually enforcing who may plan duties. `canPlanDuty()`
// on the client hides buttons; a hand-rolled POST goes straight past it and
// lands here. So the tests that matter are the negative ones: a commander
// WITHOUT the cap must be refused on all three tabs, and refused for every write
// verb rather than just the one the UI happens to use.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend } = require("./harness");

module.exports = async function run() {
  suite("duty: caps gate");

  // Mint a session with an arbitrary role/caps pair. The harness only ships an
  // admin token, and admin bypasses every gate here, so it cannot express the
  // cases under test.
  const session = (b, role, caps) => {
    const tok = "tok-" + role + "-" + (caps || "none");
    b.db.setProp("auth:" + tok, JSON.stringify({
      email: role + "@example.com", personId: "0001", role: role,
      caps: caps || "", issuedAt: new Date().toISOString()
    }));
    return tok;
  };
  const post = (b, tok, body) => JSON.parse(b.doPost({
    parameter: {}, postData: { contents: JSON.stringify(Object.assign({ auth: tok }, body)) }
  }).getContent());

  const seedDuty = (b) => {
    b.db.seed("Duty", ["id", "date", "dutyType", "platoon", "d4", "assignedBy", "assignedAt", "source"], []);
    b.db.seed("DutyCorrection", ["id", "date", "d4", "reason", "delta", "note", "enteredBy", "enteredAt"], []);
    b.db.seed("Holidays", ["date", "name", "tentative"], []);
  };

  const DUTY_ROW = { id: "d1", date: "2026-09-01", dutyType: "COS", platoon: "", d4: "0042" };

  await test("commander WITHOUT the duty cap is refused on all three duty tabs", () => {
    const b = loadBackend();
    seedDuty(b);
    const tok = session(b, "commander", "");
    ["Duty", "DutyCorrection", "Holidays"].forEach(tab => {
      const r = post(b, tok, { action: "append", tab: tab, row: DUTY_ROW });
      eq(r.code, 403, tab + " refused with 403");
      eq(b.db.rowsOf(tab).length, 0, tab + " unchanged");
    });
  });

  // The gate is on the TAB, not on one action. A UI that only ever appends must
  // not leave delete/upsert/replace open to anyone who can read the API docs.
  await test("the gate covers every write verb, not just append", () => {
    const b = loadBackend();
    seedDuty(b);
    const tok = session(b, "commander", "");
    const verbs = [
      { action: "append", tab: "Duty", row: DUTY_ROW },
      { action: "appendMany", tab: "Duty", rows: [DUTY_ROW] },
      { action: "upsertRow", tab: "Duty", row: DUTY_ROW },
      { action: "deleteRowById", tab: "Duty", id: "d1" },
      { action: "write", tab: "Duty", data: [DUTY_ROW] }
    ];
    verbs.forEach(v => eq(post(b, tok, v).code, 403, v.action + " refused"));
  });

  await test("commander WITH the duty cap may write duty tabs", () => {
    const b = loadBackend();
    seedDuty(b);
    const tok = session(b, "commander", "duty");
    const r = post(b, tok, { action: "append", tab: "Duty", row: DUTY_ROW });
    ok(r.ok, "write accepted");
    eq(b.db.rowsOf("Duty").length, 1, "row landed");
  });

  // Capabilities sit ALONGSIDE the role ladder, they do not substitute for it.
  // canWrite() runs first, so caps can never promote a read-only account.
  await test("a viewer with the duty cap is still read-only", () => {
    const b = loadBackend();
    seedDuty(b);
    const tok = session(b, "viewer", "duty");
    const r = post(b, tok, { action: "append", tab: "Duty", row: DUTY_ROW });
    eq(r.code, 403, "refused");
    ok(/read-only/i.test(r.error), "refused by the canWrite gate, not the caps gate: " + r.error);
  });

  await test("admin holds the capability implicitly", () => {
    const b = loadBackend();
    seedDuty(b);
    const tok = session(b, "admin", "");
    ok(post(b, tok, { action: "append", tab: "Duty", row: DUTY_ROW }).ok, "admin write accepted");
  });

  // A token minted before the caps column existed carries no `caps` key at all.
  // It must degrade to "no capabilities", not throw.
  await test("a pre-caps token degrades to no capabilities", () => {
    const b = loadBackend();
    seedDuty(b);
    const tok = "legacy";
    b.db.setProp("auth:" + tok, JSON.stringify({
      email: "old@example.com", personId: "0001", role: "commander", issuedAt: new Date().toISOString()
    }));
    eq(post(b, tok, { action: "append", tab: "Duty", row: DUTY_ROW }).code, 403, "refused, not crashed");
  });

  // The gate must not spill onto tabs it has no business restricting — a
  // commander without the cap still does all their normal work.
  await test("non-duty tabs are unaffected", () => {
    const b = loadBackend();
    seedDuty(b);
    b.db.seed("Medical", ["id", "d4", "reason"], []);
    // Medical is report-sick-scoped (rsGuardWrite_), so the commander must
    // resolve to a platoon and the row must name someone in it — otherwise this
    // asserts nothing about the DUTY gate, which is what it exists to test.
    b.db.seed("Roster", ["id", "name", "role", "platoon"], [
      ["0001", "PC", "Commander", "PLT1"],
      ["1101", "REC", "Recruit", "PLT1"]
    ]);
    const tok = session(b, "commander", "");
    ok(post(b, tok, { action: "append", tab: "Medical", row: { id: "m1", d4: "1101", reason: "fever" } }).ok,
       "Medical write still accepted");
  });

  suite("duty: caps parsing + admin management");

  await test("parseCaps trims, lowercases and drops blanks", () => {
    const b = loadBackend();
    eq(b.parseCaps(" Duty , ,dUtY ").join("|"), "duty|duty", "normalised");
    eq(b.parseCaps("").length, 0, "empty string -> []");
    eq(b.parseCaps(null).length, 0, "null -> []");
  });

  await test("login returns caps as an array", () => {
    const b = loadBackend();
    const salt = b.generateSalt();
    b.db.seed("Accounts", ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt", "caps"],
      [["planner@example.com", "0002", "commander", b.hashPassword("hunter22", salt), salt, "", "", "duty"]]);
    const r = b.handleLogin({ email: "planner@example.com", password: "hunter22" });
    ok(r.ok, "logged in");
    eq(r.caps.join(","), "duty", "caps returned");
  });

  await test("setAccountCaps rejects an unknown capability", () => {
    const b = loadBackend();
    b.db.seed("Accounts", ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt", "caps"],
      [["p@example.com", "0002", "commander", "h", "s", "", "", ""]]);
    const ctx = { email: "a@example.com", personId: "0001", role: "admin" };
    const r = b.handleSetAccountCaps({ targetEmail: "p@example.com", caps: "dutty" }, ctx);
    ok(r.error, "rejected: " + r.error);
    eq(b.db.rowsOf("Accounts")[0].caps, "", "row untouched");
  });

  await test("setAccountCaps writes the caps cell and is admin-only", () => {
    const b = loadBackend();
    b.db.seed("Accounts", ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt", "caps"],
      [["p@example.com", "0002", "commander", "h", "s", "", "", ""]]);
    const admin = { email: "a@example.com", personId: "0001", role: "admin" };
    ok(b.handleSetAccountCaps({ targetEmail: "p@example.com", caps: "duty" }, admin).ok, "granted");
    eq(b.db.rowsOf("Accounts")[0].caps, "duty", "cell written");

    const cmdr = { email: "c@example.com", personId: "0003", role: "commander" };
    eq(b.handleSetAccountCaps({ targetEmail: "p@example.com", caps: "" }, cmdr).code, 403, "commander refused");
    eq(b.db.rowsOf("Accounts")[0].caps, "duty", "still granted");
  });

  // listAccounts is the admin UI's only view of caps, and it must keep never
  // returning the hash/salt while gaining the new field.
  await test("listAccounts exposes caps but never the password hash", () => {
    const b = loadBackend();
    b.db.seed("Accounts", ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt", "caps"],
      [["p@example.com", "0002", "commander", "SECRETHASH", "SECRETSALT", "", "", "duty"]]);
    const r = b.handleListAccounts({}, { email: "a@example.com", role: "admin" });
    eq(r.accounts[0].caps.join(","), "duty", "caps present");
    ok(!("passwordHash" in r.accounts[0]) && !("salt" in r.accounts[0]), "no credentials leaked");
  });
};
