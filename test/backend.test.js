// Backend unit tests — run the REAL apps-script-Code.gs functions against the
// in-memory Sheets/Properties/Lock mocks. Also validates mock fidelity.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, VALID_TOKEN } = require("./harness");

module.exports = async function run() {
  suite("backend: revisions + OCC");

  const post = (backend, body) => {
    const out = backend.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({ auth: VALID_TOKEN }, body)) } });
    return JSON.parse(out.getContent());
  };

  await test("getRev seeds to 1, bumpRev increments", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    eq(b.getRev("Medical"), 1);
    eq(b.bumpRev("Medical"), 2);
    eq(b.getRev("Medical"), 2);
  });

  await test("upsert with matching baseRev applies + bumps", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    const r = post(b, { action: "upsertRow", tab: "Medical", row: { id: 1, reason: "fever" }, baseRev: b.getRev("Medical") });
    ok(r.ok, "ok");
    eq(r.rev, 2, "rev bumped");
    eq(b.db.rowsOf("Medical").length, 1, "row written");
  });

  await test("upsert with stale baseRev APPLIES (row-scoped, not rejected)", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    post(b, { action: "upsertRow", tab: "Medical", row: { id: 1, reason: "a" }, baseRev: 1 }); // -> rev 2
    // A DIFFERENT row with a now-stale baseRev must still apply — upsert is
    // row-scoped, so two devices on different recruits never conflict.
    const r = post(b, { action: "upsertRow", tab: "Medical", row: { id: 2, reason: "b" }, baseRev: 1 });
    ok(r.ok && !r.conflict, "row-scoped upsert applies despite stale baseRev");
    eq(b.db.rowsOf("Medical").length, 2, "both rows present");
  });

  await test("full write (replace) with stale baseRev IS rejected (catastrophe path)", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], [["1", "a"]]);
    post(b, { action: "upsertRow", tab: "Medical", row: { id: 2, reason: "b" }, baseRev: b.getRev("Medical") }); // rev↑
    const r = post(b, { action: "write", tab: "Medical", data: [{ id: 1, reason: "bulk" }], baseRev: 1 }); // stale replace
    ok(r.conflict, "stale full-tab replace is rejected");
    eq(b.db.rowsOf("Medical").length, 2, "rows NOT clobbered");
  });

  await test("missing baseRev applies (backward-compat) + still bumps", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    const before = b.getRev("Medical");
    const r = post(b, { action: "upsertRow", tab: "Medical", row: { id: 9, reason: "x" } }); // no baseRev
    ok(r.ok && !r.conflict, "applied, no conflict");
    ok(r.rev > before, "rev still bumped");
  });

  await test("append never conflicts even when far behind", () => {
    const b = loadBackend();
    b.db.seed("Roster", ["id", "name"], []);
    b.bumpRev("Roster"); b.bumpRev("Roster"); // server at rev 3-ish
    const r = post(b, { action: "append", tab: "Roster", row: { id: 1, name: "Z" }, baseRev: 1 });
    ok(r.ok && !r.conflict, "append applied despite stale baseRev");
    eq(b.db.rowsOf("Roster").length, 1, "row appended");
  });

  await test("ensureColumnsForKeys adds a missing column on upsert", () => {
    const b = loadBackend();
    b.db.seed("Roster", ["id", "name"], [["1", "Alice"]]);
    post(b, { action: "upsertRow", tab: "Roster", row: { id: "1", name: "Alice", phone: "999" }, baseRev: b.getRev("Roster") });
    eq(b.db.rowsOf("Roster")[0].phone, "999", "new field persisted in a new column");
  });

  await test("deleteRowById removes the row and bumps", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], [["1", "a"], ["2", "b"]]);
    const r = post(b, { action: "deleteRowById", tab: "Medical", id: "1", baseRev: b.getRev("Medical") });
    ok(r.ok, "ok");
    eq(b.db.rowsOf("Medical").map(x => x.id), ["2"], "row 1 deleted");
  });

  await test("untracked tab (ReportSick) still writes, just no rev", () => {
    // Braves' withRevLock returns fn() directly for non-REV_TABS — bot tabs like
    // ReportSick must keep working even though they carry no revision.
    const b = loadBackend();
    b.db.seed("ReportSick", ["id", "state"], []);
    const r = post(b, { action: "upsertRow", tab: "ReportSick", row: { id: 1, state: "Requested" } });
    ok(r.ok && !r.conflict, "untracked-tab write applies");
    eq(b.db.rowsOf("ReportSick").length, 1, "row written");
  });

  suite("backend: revCheck + readAll carry revisions");

  await test("revCheck returns per-tab revs; readAll includes revs", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    post(b, { action: "upsertRow", tab: "Medical", row: { id: 1, reason: "a" }, baseRev: b.getRev("Medical") });
    const rc = JSON.parse(b.doGet({ parameter: { action: "revCheck", auth: VALID_TOKEN } }).getContent());
    ok(rc.ok && rc.revs, "revCheck shape");
    ok(rc.revs.Medical >= 2, "Medical rev reflected");
    const all = JSON.parse(b.doGet({ parameter: { action: "readAll", auth: VALID_TOKEN } }).getContent());
    ok(all.revs && typeof all.revs.Medical === "number", "readAll carries revs");
  });

  await test("single-tab read carries { rows, rev }", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], [["1", "a"]]);
    const r = JSON.parse(b.doGet({ parameter: { action: "read", tab: "Medical", auth: VALID_TOKEN } }).getContent());
    ok(Array.isArray(r.rows), "rows is an array");
    ok(typeof r.rev === "number", "rev is a number");
  });

  await test("unauthorized request is rejected", () => {
    const b = loadBackend();
    const out = JSON.parse(b.doGet({ parameter: { action: "readAll", auth: "bogus" } }).getContent());
    eq(out.code, 401, "401 for bad token");
  });

  suite("backend: admin-only RBAC (email + imports)");

  // Mint a session token for an arbitrary role (the harness only seeds an admin).
  const mkToken = (b, role) => {
    const token = role + "tok";
    b.db.setProp("auth:" + token, JSON.stringify({
      email: role + "@example.com", personId: "0001", role, issuedAt: new Date().toISOString()
    }));
    return token;
  };
  const postAs = (b, token, body) => JSON.parse(
    b.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({ auth: token }, body)) } }).getContent()
  );

  await test("sendEmail: commander is 403, admin is allowed past the RBAC gate", () => {
    const b = loadBackend();
    const cmdr = postAs(b, mkToken(b, "commander"),
      { action: "sendEmail", to: "r@x.com", subject: "Hi", htmlBody: "<p>x</p>" });
    eq(cmdr.code, 403, "commander blocked from email dispatch");
    const adm = postAs(b, mkToken(b, "admin"),
      { action: "sendEmail", to: "r@x.com", subject: "Hi", htmlBody: "<p>x</p>" });
    ok(adm.code !== 403, "admin not blocked by the RBAC gate");
  });

  await test("sendEmail: viewer is read-only (403) before reaching the email gate", () => {
    const b = loadBackend();
    const out = postAs(b, mkToken(b, "viewer"),
      { action: "sendEmail", to: "r@x.com", subject: "Hi", htmlBody: "<p>x</p>" });
    eq(out.code, 403, "viewer blocked");
  });

  await test("imported bulk write: commander is 403, admin succeeds", () => {
    const b = loadBackend();
    b.db.seed("ConductDetail", ["id", "d4"], []);
    const cmdrTok = mkToken(b, "commander");
    const blocked = postAs(b, cmdrTok,
      { action: "write", tab: "ConductDetail", data: [{ id: 1, d4: "0001" }], imported: true, baseRev: b.getRev("ConductDetail") });
    eq(blocked.code, 403, "commander blocked from a flagged import");
    eq(b.db.rowsOf("ConductDetail").length, 0, "nothing written");

    const adm = postAs(b, mkToken(b, "admin"),
      { action: "write", tab: "ConductDetail", data: [{ id: 1, d4: "0001" }], imported: true, baseRev: b.getRev("ConductDetail") });
    ok(adm.ok, "admin import applies");
    eq(b.db.rowsOf("ConductDetail").length, 1, "row written");
  });

  await test("commander's NORMAL write (no imported flag) is unaffected", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    const r = postAs(b, mkToken(b, "commander"),
      { action: "upsertRow", tab: "Medical", row: { id: 1, reason: "fever" }, baseRev: b.getRev("Medical") });
    ok(r.ok && !r.conflict, "commander single-row edit still applies");
    eq(b.db.rowsOf("Medical").length, 1, "row written");
  });

  suite("backend: §8 classifier honours explicit isInCamp (mirrors frontend fix)");

  await test("apps-script bpClassifyPerson: explicit isInCamp:false wins over a reason with no book-out keyword", () => {
    const b = loadBackend();
    b.STATE = {
      roster: [{ id: "0001", name: "Test One", fourD: "1411", rank: "REC" }],
      medical: [],
      leave: [{ id: 1, d4: "0001", type: "Course", startDate: "01 Jun 2026", endDate: "02 Jun 2026", reason: "APSC course", isInCamp: false }]
    };
    const c = b.bpClassifyPerson(b.STATE.roster[0], "2026-06-01");
    ok(c.notInCamp === true, "explicit isInCamp:false must be honoured with no reason-keyword guessing");
  });

  await test("apps-script bpClassifyPerson: missing isInCamp defaults to Not In Camp", () => {
    const b = loadBackend();
    b.STATE = {
      roster: [{ id: "0001", name: "Test One", fourD: "1411", rank: "REC" }],
      medical: [],
      leave: [{ id: 1, d4: "0001", type: "Guard Duty", startDate: "01 Jun 2026", endDate: "02 Jun 2026", reason: "gate duty" }]
    };
    const c = b.bpClassifyPerson(b.STATE.roster[0], "2026-06-01");
    ok(c.notInCamp === true, "missing isInCamp must default to Not In Camp, not a reason-keyword guess");
  });

  suite("backend: writeTab forces text format on coercion-prone columns");

  await test("Attendance.participants column is forced to plain-text and round-trips verbatim", () => {
    const b = loadBackend();
    b.db.seed("Attendance", ["id", "date", "conductId", "participants", "source"], []);
    // A comma-joined 4D roll. In real Sheets, General format coerces this into one
    // number (commas as thousands separators) and zero-fills past ~15 sig-figs,
    // destroying the roll. The fix forces the column to "@" so it survives.
    const roll = "0110,0111,0023,0101,0310";
    const r = b.writeTab("Attendance", [{ id: 1, date: "18 Jun 2026", conductId: 5, participants: roll, source: "csv" }]);
    ok(r.ok, "write ok");
    eq(b.db.rowsOf("Attendance")[0].participants, roll, "participants stored verbatim");
    // participants is the 4th header (1-based col 4).
    eq(b.db.numberFormat("Attendance", 4), "@", "participants column forced to plain text");
  });

  await test("a tab with no coercion-prone columns is left in default format", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    b.writeTab("Medical", [{ id: 1, reason: "fever" }]);
    eq(b.db.numberFormat("Medical", 1), null, "Medical columns not needlessly forced to text");
  });

  suite("backend: bravesBackfillLeaveInCamp (one-off migration)");

  await test("fills blank isInCamp using the legacy guess, skips already-explicit rows", () => {
    const b = loadBackend();
    b.db.seed("Leave", ["id", "d4", "type", "startDate", "endDate", "days", "reason", "isInCamp", "isInCampReviewed"], [
      ["1", "0001", "Weekend", "01 Jun 2026", "02 Jun 2026", "2", "", "", ""],
      ["2", "0001", "Course", "01 Jun 2026", "02 Jun 2026", "2", "book out for range", "", ""],
      ["3", "0001", "Guard Duty", "01 Jun 2026", "02 Jun 2026", "2", "gate duty", "", ""],
      ["4", "0001", "Guard Duty", "01 Jun 2026", "02 Jun 2026", "2", "gate duty", true, ""]
    ]);
    b.bravesBackfillLeaveInCamp();
    const rows = b.db.rowsOf("Leave");
    eq(rows[0].isInCamp, false, "AL/OIL type blank -> FALSE (legacy hardcoded default)");
    eq(rows[1].isInCamp, false, "OTHERS type with a book-out keyword blank -> FALSE (legacy guess)");
    eq(rows[2].isInCamp, true, "OTHERS type with no keyword blank -> TRUE (legacy guess)");
    eq(rows[3].isInCamp, true, "already-explicit row is left untouched");
  });
};
