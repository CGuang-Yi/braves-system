// Write-side guards for the report-sick platoon gate (spec §1.5).
//
// The danger this closes is specific and total: writeTab derives sheet headers
// from Object.keys(data[0]) and REPLACES the whole tab. A scoped account holding
// a filtered Medical tab that triggers any full-tab replace would delete every
// other platoon's rows from the sheet — silent, cross-platoon, unrecoverable
// without a backup. So `write` is refused outright below company scope, and
// row-level ops are checked against the row's subject.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend } = require("./harness");

module.exports = async function run() {
  suite("rs-scope: write guards");

  const ROSTER_HEADERS = ["id", "name", "role", "platoon", "section", "fourD"];
  const ROSTER_ROWS = [
    ["0011", "PC ONE", "Commander", "PLT1", "Command", "PC1"],
    ["1101", "REC ALPHA", "Recruit", "PLT1", "1", "1101"],
    ["2101", "REC BRAVO", "Recruit", "PLT2", "1", "2101"]
  ];
  const MED_HEADERS = ["id", "d4", "date", "reason", "status", "startDate", "endDate", "type", "bookInDate"];

  const setup = () => {
    const b = loadBackend();
    b.db.seed("Roster", ROSTER_HEADERS, ROSTER_ROWS);
    b.db.seed("Medical", MED_HEADERS, [
      ["m1", "1101", "01 Feb 2026", "fever", "MC", "01 Feb 2026", "03 Feb 2026", "RSI", "04 Feb 2026"],
      ["m2", "2101", "01 Feb 2026", "cough", "MC", "01 Feb 2026", "03 Feb 2026", "RSI", "04 Feb 2026"]
    ]);
    return b;
  };
  const tok = (b, personId, caps, role) => {
    const t = "tok-" + personId + "-" + (caps || "none");
    b.db.setProp("auth:" + t, JSON.stringify({
      email: personId + "@example.com", personId: personId, role: role || "commander",
      caps: caps || "", issuedAt: new Date().toISOString()
    }));
    return t;
  };
  const post = (b, t, body) => JSON.parse(b.doPost({
    parameter: {}, postData: { contents: JSON.stringify(Object.assign({ auth: t }, body)) }
  }).getContent());

  await test("a scoped commander may append a row for their own platoon", () => {
    const b = setup();
    const r = post(b, tok(b, "0011"), {
      action: "append", tab: "Medical",
      row: { id: "m3", d4: "1101", date: "04 Aug 2026", reason: "fever", status: "MC" }
    });
    ok(r.ok, "accepted: " + JSON.stringify(r));
    eq(b.db.rowsOf("Medical").length, 3, "row landed");
  });

  await test("a scoped commander may edit and delete their own platoon's rows", () => {
    const b = setup();
    const t = tok(b, "0011");
    ok(post(b, t, { action: "upsertRow", tab: "Medical", row: { id: "m1", d4: "1101", reason: "flu" } }).ok, "upsert ok");
    ok(post(b, t, { action: "deleteRowById", tab: "Medical", id: "m1" }).ok, "delete ok");
    eq(b.db.rowsOf("Medical").filter(r => r.id === "m1").length, 0, "row gone");
  });

  await test("a scoped commander cannot write another platoon's row", () => {
    const b = setup();
    const t = tok(b, "0011");
    [
      { action: "append", tab: "Medical", row: { id: "m9", d4: "2101", reason: "x" } },
      { action: "appendMany", tab: "Medical", rows: [{ id: "m9", d4: "2101", reason: "x" }] },
      { action: "upsertRow", tab: "Medical", row: { id: "m2", d4: "2101", reason: "x" } },
      { action: "deleteRowById", tab: "Medical", id: "m2" }
    ].forEach(v => {
      const r = post(b, t, v);
      eq(r.code, 403, v.action + " refused");
      ok(/out of scope/i.test(r.error), v.action + " refused by the scope guard: " + r.error);
    });
    eq(b.db.rowsOf("Medical").length, 2, "sheet untouched");
  });

  // Capture defence: without the OLD-subject check, a scoped caller could upsert
  // someone else's row with their own platoon's d4 and take ownership of it.
  await test("upsert is checked against BOTH the existing and the incoming subject", () => {
    const b = setup();
    const r = post(b, tok(b, "0011"), {
      action: "upsertRow", tab: "Medical", row: { id: "m2", d4: "1101", reason: "captured" }
    });
    eq(r.code, 403, "refused");
    eq(b.db.rowsOf("Medical").filter(x => x.id === "m2")[0].d4, "2101", "m2 still belongs to PLT2");
  });

  // THE CATASTROPHIC PATH. writeTab replaces the whole tab from the pushed rows.
  await test("a whole-tab replace is REFUSED below company scope, and deletes nothing", () => {
    const b = setup();
    const r = post(b, tok(b, "0011"), {
      action: "write", tab: "Medical",
      data: [{ id: "m1", d4: "1101", date: "01 Feb 2026", reason: "fever", status: "MC" }]
    });
    eq(r.code, 403, "refused");
    ok(/replace/i.test(r.error), "refused as a replace: " + r.error);
    eq(b.db.rowsOf("Medical").length, 2, "PLT2's row survives — this is the whole point");
  });

  await test("company scope and admin may still replace the tab", () => {
    const b = setup();
    ok(post(b, tok(b, "0011", "rs:company"), {
      action: "write", tab: "Medical",
      data: [{ id: "m1", d4: "1101", date: "01 Feb 2026", reason: "fever", status: "MC" }]
    }).ok, "rs:company may replace");

    const b2 = setup();
    ok(post(b2, tok(b2, "0001", "", "admin"), {
      action: "write", tab: "Medical",
      data: [{ id: "m1", d4: "1101", date: "01 Feb 2026", reason: "fever", status: "MC" }]
    }).ok, "admin may replace");
  });

  await test("the guard does not spill onto other tabs", () => {
    const b = setup();
    b.db.seed("Attendance", ["id", "date", "conductId"], []);
    ok(post(b, tok(b, "0011"), { action: "append", tab: "Attendance", row: { id: "a1", date: "04 Aug 2026" } }).ok,
       "Attendance write unaffected");
    ok(post(b, tok(b, "0011"), {
      action: "write", tab: "Attendance", data: [{ id: "a1", date: "04 Aug 2026", conductId: "c1" }]
    }).ok, "Attendance replace unaffected");
  });

  await test("an unresolvable-platoon caller can write nothing to Medical", () => {
    const b = setup();
    const r = post(b, tok(b, "9999"), { action: "append", tab: "Medical", row: { id: "m9", d4: "1101" } });
    eq(r.code, 403, "empty scope writes nothing");
  });
};
