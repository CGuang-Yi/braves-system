// Backend tests for SYNC_PERF_IMPROVEMENTS_SPEC.md §3 items P2-2/P2-3/P2-4.
// Runs the REAL apps-script-Code.gs against the in-memory mocks (test/harness.js).
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, VALID_TOKEN } = require("./harness");

const AUDIT_HEADERS = ["timestamp", "email", "personId", "role", "action", "target", "detail", "tokenPrefix"];

module.exports = async function run() {
  const post = (backend, body) => {
    const out = backend.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({ auth: VALID_TOKEN }, body)) } });
    return JSON.parse(out.getContent());
  };
  const rawPost = (backend, body) => {
    const out = backend.doPost({ parameter: {}, postData: { contents: JSON.stringify(body) } });
    return JSON.parse(out.getContent());
  };

  // ── P2-2: getAllRevs via one bulk getProperties() call ──────────────────
  suite("P2-2: getAllRevs bulk getProperties()");

  await test("no rev: property set → every REV_TABS entry reports 1 (lazy-seed semantics preserved)", () => {
    const b = loadBackend();
    const revs = b.getAllRevs();
    for (const t of b.REV_TABS) eq(revs[t], 1, "tab " + t + " defaults to 1");
    eq(Object.keys(revs).sort(), b.REV_TABS.slice().sort(), "same key set as REV_TABS");
  });

  await test("seeded/bumped revs are reflected exactly as before", () => {
    const b = loadBackend();
    b.bumpRev("Medical"); b.bumpRev("Medical"); // rev 3
    b.db.setProp("rev:Roster", "7");
    const revs = b.getAllRevs();
    eq(revs.Medical, 3, "bumped tab reflected");
    eq(revs.Roster, 7, "directly-set property reflected");
    eq(revs.IPPT, 1, "untouched tab still defaults to 1");
  });

  await test("getAllRevs makes exactly ONE getProperties call and ZERO getProperty calls", () => {
    const b = loadBackend();
    b.bumpRev("Medical");                 // uses getProperty/setProperty — not under test
    b.db.spy.getProperty = 0;
    b.db.spy.getProperties = 0;
    b.getAllRevs();
    eq(b.db.spy.getProperties, 1, "exactly one bulk getProperties() call");
    eq(b.db.spy.getProperty, 0, "zero individual getProperty() calls");
  });

  await test("revCheck endpoint response shape/values unaffected by the bulk-read rewrite", () => {
    const b = loadBackend();
    b.db.seed("Medical", ["id", "reason"], []);
    post(b, { action: "upsertRow", tab: "Medical", row: { id: 1, reason: "a" } }); // bumps Medical
    const rc = JSON.parse(b.doGet({ parameter: { action: "revCheck", auth: VALID_TOKEN } }).getContent());
    ok(rc.ok && rc.revs, "revCheck shape preserved");
    eq(rc.revs.Medical, 2, "changed tab rev reflected");
    eq(rc.revs.IPPT, 1, "lazily-seeded tab still reports 1 in the response");
  });

  // ── P2-3: writeAuditLog role passed by caller, not re-resolved ──────────
  suite("P2-3: writeAuditLog role parameter (no redundant getAuthContext)");

  await test("(a) data write: audit row byte-identical (role from ctx, no extra auth lookup)", () => {
    const b = loadBackend();
    b.db.seed("AuditLog", AUDIT_HEADERS, []);
    b.db.seed("Medical", ["id", "reason"], []);

    let authCalls = 0;
    const origAuth = b.getAuthContext;
    b.getAuthContext = function (token) { authCalls++; return origAuth(token); };

    const r = post(b, { action: "upsertRow", tab: "Medical", row: { id: 1, reason: "fever" }, baseRev: b.getRev("Medical") });
    ok(r.ok && !r.error, "write applied");

    eq(authCalls, 1, "getAuthContext called exactly once per write (doPost's own resolution — no second lookup inside writeAuditLog)");

    const rows = b.db.rowsOf("AuditLog");
    eq(rows.length, 1, "one audit row appended");
    const row = rows[0];
    eq(row.email, "test@example.com", "email column");
    eq(row.personId, "0001", "personId column (from the seeded admin session)");
    eq(row.role, "admin", "role column carries the admin session's role");
    eq(row.action, "write_medical", "action column = auditActionForTab(Medical)");
    eq(row.target, "Medical", "target column = tab name");
    eq(row.detail, "upsertRow", "detail column = the dispatched action");
    eq(row.tokenPrefix, VALID_TOKEN.slice(0, 8), "tokenPrefix column = first 8 chars of the auth token");
  });

  await test("(b) login: audit row byte-identical (role = the just-issued session's role)", () => {
    const b = loadBackend();
    b.db.seed("AuditLog", AUDIT_HEADERS, []);
    const salt = "s4lt";
    const password = "correcthorsebattery";
    const hash = b.hashPassword(password, salt);
    b.db.seed("Accounts",
      ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt"],
      [["commander@example.com", "0002", "commander", hash, salt, "admin@example.com", "2026-01-01T00:00:00.000Z"]]);

    const res = rawPost(b, { action: "login", email: "commander@example.com", password: password });
    ok(res.ok && res.authToken, "login succeeded");
    eq(res.role, "commander", "response role");

    const rows = b.db.rowsOf("AuditLog");
    eq(rows.length, 1, "one audit row appended");
    const row = rows[0];
    eq(row.email, "commander@example.com", "email column");
    eq(row.personId, "0002", "personId column");
    eq(row.role, "commander", "role column = the account's role, resolved without a second lookup");
    eq(row.action, "login", "action column");
    eq(row.target, "", "target column (null → \"\")");
    eq(row.detail, "", "detail column (null → \"\")");
    eq(row.tokenPrefix, res.authToken.slice(0, 8), "tokenPrefix column matches the issued token");
  });

  await test("(c) failed login: audit row byte-identical (role stays \"\" — no account/session to resolve)", () => {
    const b = loadBackend();
    b.db.seed("AuditLog", AUDIT_HEADERS, []);
    b.db.seed("Accounts", ["email", "personId", "role", "passwordHash", "salt", "addedBy", "addedAt"], []);

    const res = rawPost(b, { action: "login", email: "nobody@example.com", password: "whatever1" });
    ok(res.error, "login rejected");

    const rows = b.db.rowsOf("AuditLog");
    eq(rows.length, 1, "one audit row appended for the failed attempt");
    const row = rows[0];
    eq(row.email, "nobody@example.com", "email column (attempted email)");
    eq(row.personId, "", "personId column empty — no account/session known");
    eq(row.role, "", "role column empty — matches today's behaviour (no auth token to resolve)");
    eq(row.action, "login_failed", "action column");
    eq(row.detail, "Email not found", "detail column carries the failure reason");
    eq(row.tokenPrefix, "", "tokenPrefix column empty — no token was ever issued");
  });

  await test("logout audit row role stays \"\" — token already deleted before writeAuditLog runs (kept-lookup path)", () => {
    const b = loadBackend();
    b.db.seed("AuditLog", AUDIT_HEADERS, []);
    const r = post(b, { action: "logout" });
    ok(r.ok, "logout ok");
    const row = b.db.rowsOf("AuditLog")[0];
    eq(row.action, "logout");
    eq(row.role, "", "role column empty, exactly as before P2-3 (the token is deleted before this call, and it always passed a null token)");
  });

  await test("revoke_all_tokens audit row role stays \"\" — caller's own token is revoked before writeAuditLog runs", () => {
    const b = loadBackend();
    b.db.seed("AuditLog", AUDIT_HEADERS, []);
    const r = post(b, { action: "revokeAllTokens" });
    ok(r.ok, "revokeAllTokens ok");
    const row = b.db.rowsOf("AuditLog")[0];
    eq(row.action, "revoke_all_tokens");
    eq(row.role, "", "role column empty — the caller's own session (among all revoked) is gone by the time we log");
  });

  // ── P2-4: bound the admin readAll AuditLog payload ───────────────────────
  suite("P2-4: readAllTabs caps AuditLog to the newest AUDIT_READALL_MAX_ROWS rows");

  function seedBigAuditLog(b, n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(["2026-01-01T00:00:0" + (i % 10) + ".000Z", "u@example.com", "0001", "admin", "act" + i, "", "", "tok12345"]);
    }
    b.db.seed("AuditLog", AUDIT_HEADERS, rows);
  }

  await test("admin readAll returns exactly the newest AUDIT_READALL_MAX_ROWS rows, order preserved", () => {
    const b = loadBackend();
    seedBigAuditLog(b, 520);
    const all = JSON.parse(b.doGet({ parameter: { action: "readAll", auth: VALID_TOKEN } }).getContent());
    eq(all.auditLog.length, b.AUDIT_READALL_MAX_ROWS, "capped to the constant");
    eq(all.auditLog.length, 500, "the constant is 500 per spec §7 Q1");
    // 520 rows (act0..act519), keep the newest 500 → act20..act519, in the
    // SAME top-to-bottom sheet order as an uncapped read (oldest-of-the-tail
    // first) — the client reverses for newest-first display, unchanged here.
    eq(all.auditLog[0].action, "act20", "oldest row in the capped tail");
    eq(all.auditLog[all.auditLog.length - 1].action, "act519", "newest row still last");
  });

  await test("a small AuditLog (< cap) returns all rows unchanged", () => {
    const b = loadBackend();
    seedBigAuditLog(b, 10);
    const all = JSON.parse(b.doGet({ parameter: { action: "readAll", auth: VALID_TOKEN } }).getContent());
    eq(all.auditLog.length, 10, "all 10 rows returned");
    eq(all.auditLog[0].action, "act0");
    eq(all.auditLog[9].action, "act9");
  });

  await test("non-admin readAll payload has no auditLog key at all (unchanged gating)", () => {
    const b = loadBackend();
    seedBigAuditLog(b, 520);
    const token = "viewertok";
    b.db.setProp("auth:" + token, JSON.stringify({
      email: "viewer@example.com", personId: "0099", role: "viewer", issuedAt: new Date().toISOString()
    }));
    const all = JSON.parse(b.doGet({ parameter: { action: "readAll", auth: token } }).getContent());
    ok(!("auditLog" in all), "non-admin payload carries no auditLog field");
  });

  await test("readTabTail matches readTab's row shaping for a Date-bearing tab (no format drift)", () => {
    // Sanity check that the tail-read path shapes rows identically to the
    // full-read path it partially replaces (Date coercion / hasData filter),
    // just over a Attendance-shaped tab instead of AuditLog. Not itself an
    // AuditLog concern — guards readTabTail's fidelity to readTab generally.
    const b = loadBackend();
    b.db.seed("Sample", ["id", "when"], [["1", new Date(2026, 0, 15)], ["2", new Date(2026, 0, 16)]]);
    const full = b.readTab("Sample");
    const tail = b.readTabTail("Sample", 500);
    eq(tail, full, "identical output when the row count is under the cap");
  });
};
