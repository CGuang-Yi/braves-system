// Duty change requests, backend half (design §3).
//
// Two rules carry this feature, and both are only real on the server:
//
//   1. A reason is mandatory. The client marks the field `required`, which is a
//      suggestion — this is where it is enforced.
//   2. `status` only ever changes through decideDutyRequest, which needs the
//      `duty` capability. That is NOT true by virtue of the decide action being
//      gated: it is true because the generic row mutations are refused on this
//      tab. Without that refusal a submitter just upserts their own row to
//      "Approved" and the gate is decorative. The negative tests below are the
//      ones that matter.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, VALID_TOKEN } = require("./harness");

const DCR_HEADERS = ["id", "submittedBy", "submittedAt", "date", "dutyType", "platoon", "kind",
  "fromD4", "toD4", "swapDate", "swapDutyType", "swapPlatoon", "reason",
  "status", "decidedBy", "decidedAt", "decisionNote"];
const DUTY_HEADERS = ["id", "date", "dutyType", "platoon", "d4", "assignedBy", "assignedAt", "source"];

module.exports = async function run() {
  suite("duty change request: submission");

  const session = (b, name, role, personId, caps) => {
    const tok = "tok-" + name;
    b.db.setProp("auth:" + tok, JSON.stringify({
      email: name + "@example.com", personId: personId, role: role,
      caps: caps || "", issuedAt: new Date().toISOString()
    }));
    return tok;
  };
  const post = (b, tok, body) => JSON.parse(b.doPost({
    parameter: {}, postData: { contents: JSON.stringify(Object.assign({ auth: tok }, body)) }
  }).getContent());
  // Reads go over POST — the backend answers them on both transports today, and
  // the GET route is being removed, so posting keeps this file transport-stable.
  const read = (b, body) => post(b, VALID_TOKEN, body);

  const seed = (b, dcrRows, dutyRows) => {
    b.db.seed("DutyChangeRequest", DCR_HEADERS, dcrRows || []);
    b.db.seed("Duty", DUTY_HEADERS, dutyRows || [
      ["d1", "2026-09-01", "COS", "", "0042", "a@b.c", "", "manual"]
    ]);
    return b;
  };

  const REQ = {
    id: "r1", submittedAt: "2026-08-05T00:00:00.000Z",
    date: "2026-09-01", dutyType: "COS", platoon: "", kind: "reassign",
    fromD4: "0042", toD4: "0077", swapDate: "", swapDutyType: "", swapPlatoon: "",
    reason: "medical appointment"
  };

  await test("a plain commander may submit — this is not planner-only", () => {
    const b = seed(loadBackend());
    const tok = session(b, "cdr", "commander", "0042");
    const r = post(b, tok, { action: "append", tab: "DutyChangeRequest", row: Object.assign({}, REQ) });
    ok(r.ok && !r.error, "accepted: " + JSON.stringify(r.error || ""));
    eq(b.db.rowsOf("DutyChangeRequest").length, 1, "row written");
  });

  await test("a blank or whitespace-only reason is refused server-side", () => {
    const b = seed(loadBackend());
    const tok = session(b, "cdr", "commander", "0042");
    ["", "   "].forEach(reason => {
      const r = post(b, tok, {
        action: "append", tab: "DutyChangeRequest",
        row: Object.assign({}, REQ, { reason })
      });
      eq(r.code, 400, "refused");
      ok(/reason is required/i.test(r.error), "and says why");
    });
    eq(b.db.rowsOf("DutyChangeRequest").length, 0, "nothing written");
  });

  await test("an unknown kind is refused", () => {
    const b = seed(loadBackend());
    const tok = session(b, "cdr", "commander", "0042");
    const r = post(b, tok, {
      action: "append", tab: "DutyChangeRequest",
      row: Object.assign({}, REQ, { kind: "obliterate" })
    });
    eq(r.code, 400, "refused");
  });

  await test("status is forced to Pending even when the body claims Approved", () => {
    const b = seed(loadBackend());
    const tok = session(b, "cdr", "commander", "0042");
    post(b, tok, {
      action: "append", tab: "DutyChangeRequest",
      row: Object.assign({}, REQ, {
        status: "Approved", decidedBy: "0042", decidedAt: "2026-08-05T00:00:00Z",
        decisionNote: "I approve of myself"
      })
    });
    const row = b.db.rowsOf("DutyChangeRequest")[0];
    eq(row.status, "Pending", "self-approval on the way in does not stick");
    eq(row.decidedBy, "", "decision columns cleared");
    eq(row.decisionNote, "", "including the note");
  });

  await test("submittedBy comes off the token, not the body", () => {
    const b = seed(loadBackend());
    const tok = session(b, "cdr", "commander", "0042");
    post(b, tok, {
      action: "append", tab: "DutyChangeRequest",
      row: Object.assign({}, REQ, { submittedBy: "0099" })
    });
    eq(b.db.rowsOf("DutyChangeRequest")[0].submittedBy, "0042",
       "a request cannot be filed under someone else's name");
  });

  suite("duty change request: the tab refuses the generic mutations");

  // The hole this closes: submit, then upsert your own row to Approved. The
  // decide gate would still be enforced and still be pointless, because the
  // roster reads status off the row.
  await test("upsertRow is refused — for a commander AND for a duty planner", () => {
    const b = seed(loadBackend(), [["r1", "0042", "", "2026-09-01", "COS", "", "reassign",
      "0042", "0077", "", "", "", "why", "Pending", "", "", ""]]);
    const approved = Object.assign({}, REQ, { status: "Approved" });
    [["cdr", "commander", ""], ["planner", "commander", "duty"]].forEach(([n, role, caps]) => {
      const tok = session(b, n, role, "0042", caps);
      const r = post(b, tok, { action: "upsertRow", tab: "DutyChangeRequest", row: approved });
      eq(r.code, 403, n + " refused");
    });
    eq(b.db.rowsOf("DutyChangeRequest")[0].status, "Pending", "still pending");
  });

  await test("write (whole-tab replace) and appendMany are refused too", () => {
    const b = seed(loadBackend());
    const tok = session(b, "planner", "commander", "0042", "duty");
    eq(post(b, tok, { action: "write", tab: "DutyChangeRequest", data: [REQ] }).code, 403, "replace");
    eq(post(b, tok, { action: "appendMany", tab: "DutyChangeRequest", rows: [REQ] }).code, 403, "appendMany");
  });

  await test("a submitter may withdraw their OWN pending request, and only their own", () => {
    const b = seed(loadBackend(), [
      ["r1", "0042", "", "2026-09-01", "COS", "", "reassign", "0042", "0077", "", "", "", "why", "Pending", "", "", ""],
      ["r2", "0099", "", "2026-09-02", "COS", "", "reassign", "0042", "0077", "", "", "", "why", "Pending", "", "", ""]
    ]);
    const tok = session(b, "cdr", "commander", "0042");
    const mine = post(b, tok, { action: "deleteRowById", tab: "DutyChangeRequest", id: "r1" });
    ok(mine.ok && !mine.error, "own row withdrawn");
    const theirs = post(b, tok, { action: "deleteRowById", tab: "DutyChangeRequest", id: "r2" });
    eq(theirs.code, 403, "someone else's is refused");
    eq(b.db.rowsOf("DutyChangeRequest").map(r => r.id), ["r2"], "and survives");
  });

  suite("duty change request: deciding applies and flips atomically");

  const pending = (over) => {
    const base = ["r1", "0042", "2026-08-05T00:00:00Z", "2026-09-01", "COS", "", "reassign",
      "0042", "0077", "", "", "", "why", "Pending", "", "", ""];
    return [Object.assign([], base, over || {})];
  };

  await test("a non-cap holder cannot decide", () => {
    const b = seed(loadBackend(), pending());
    const tok = session(b, "cdr", "commander", "0042");
    const r = post(b, tok, { action: "decideDutyRequest", id: "r1", decision: "approve" });
    eq(r.code, 403, "refused");
    eq(b.db.rowsOf("DutyChangeRequest")[0].status, "Pending", "untouched");
    eq(b.db.rowsOf("Duty")[0].d4, "0042", "roster untouched");
  });

  await test("approving writes the Duty row AND flips the status in one call", () => {
    const b = seed(loadBackend(), pending());
    const tok = session(b, "planner", "commander", "0001", "duty");
    const r = post(b, tok, { action: "decideDutyRequest", id: "r1", decision: "approve" });
    ok(r.ok, "ok: " + JSON.stringify(r.error || ""));

    const duty = b.db.rowsOf("Duty");
    eq(duty.length, 1, "the slot was rewritten, not duplicated");
    eq(duty[0].d4, "0077", "new holder");
    eq(duty[0].source, "request", "provenance recorded");

    const req = b.db.rowsOf("DutyChangeRequest")[0];
    eq(req.status, "Approved", "flipped in the same call");
    eq(req.decidedBy, "0001", "decider recorded");
    ok(req.decidedAt, "and when");
  });

  await test("rejecting writes nothing to Duty", () => {
    const b = seed(loadBackend(), pending());
    const tok = session(b, "planner", "commander", "0001", "duty");
    const r = post(b, tok, { action: "decideDutyRequest", id: "r1", decision: "reject", decisionNote: "no cover" });
    ok(r.ok, "ok");
    eq(b.db.rowsOf("Duty")[0].d4, "0042", "roster untouched");
    const req = b.db.rowsOf("DutyChangeRequest")[0];
    eq(req.status, "Rejected", "flipped");
    eq(req.decisionNote, "no cover", "note kept");
  });

  await test("a second decision on an already-decided request is refused, not applied twice", () => {
    // Two planners on two devices, both looking at the same pending queue.
    const b = seed(loadBackend(), pending());
    const tok = session(b, "planner", "commander", "0001", "duty");
    post(b, tok, { action: "decideDutyRequest", id: "r1", decision: "approve" });
    const again = post(b, tok, { action: "decideDutyRequest", id: "r1", decision: "reject" });
    eq(again.code, 409, "refused as already decided");
    eq(b.db.rowsOf("DutyChangeRequest")[0].status, "Approved", "the first decision stands");
  });

  await test("an unknown decision verb is refused before anything is written", () => {
    const b = seed(loadBackend(), pending());
    const tok = session(b, "planner", "commander", "0001", "duty");
    const r = post(b, tok, { action: "decideDutyRequest", id: "r1", decision: "maybe" });
    eq(r.code, 400, "refused");
    eq(b.db.rowsOf("DutyChangeRequest")[0].status, "Pending", "untouched");
  });

  await test("deciding a request that no longer exists says so rather than throwing", () => {
    const b = seed(loadBackend(), pending());
    const tok = session(b, "planner", "commander", "0001", "duty");
    const r = post(b, tok, { action: "decideDutyRequest", id: "nope", decision: "approve" });
    eq(r.code, 404, "not found");
  });

  await test("approving an ADD into an empty slot mints an id rather than failing", () => {
    // dcrDutyMutations leaves id "" when it found no row; upsertRow refuses a
    // blank id outright, so the handler has to fill it. Without that the whole
    // add path silently writes nothing.
    const b = seed(loadBackend(), [["r1", "0042", "2026-08-05T00:00:00Z", "2026-09-09", "COS", "",
      "add", "", "0077", "", "", "", "why", "Pending", "", "", ""]]);
    const tok = session(b, "planner", "commander", "0001", "duty");
    const r = post(b, tok, { action: "decideDutyRequest", id: "r1", decision: "approve" });
    ok(r.ok, "ok: " + JSON.stringify(r.error || ""));
    const added = b.db.rowsOf("Duty").filter(x => x.date === "2026-09-09");
    eq(added.length, 1, "the new slot exists");
    ok(added[0].id, "and carries an id");
    eq(added[0].d4, "0077", "held by the requested person");
  });

  suite("duty change request: the tab is registered everywhere it must be");

  await test("readAll carries the key, so a cold cache loads the queue", () => {
    // pullAll gates each assignment on Array.isArray, so an absent key is
    // skipped in silence while the rev baseline still advances — the client then
    // believes an empty queue is current and never asks again.
    const b = seed(loadBackend(), pending());
    const all = read(b, { action: "readAll" });
    ok(Array.isArray(all.dutyChangeRequest), "readAll carried no dutyChangeRequest key");
    eq(all.dutyChangeRequest.length, 1, "and the row came back");
  });

  await test("revCheck tracks the tab, so a change is noticed incrementally", () => {
    const b = seed(loadBackend(), pending());
    const rc = read(b, { action: "revCheck" });
    ok(typeof rc.revs.DutyChangeRequest === "number", "in REV_TABS");
  });

  await test("a 4D and a date survive the write instead of being coerced", () => {
    // The negative control for the Sheets coercion trap: without the
    // WRITE_TEXT_COLS_BY_TAB entry "0042" becomes 42 and the date is re-served
    // as "01 Sep 2026", the documented cause of bugs #33 and #69.
    const b = seed(loadBackend());
    const tok = session(b, "cdr", "commander", "0042");
    post(b, tok, {
      action: "append", tab: "DutyChangeRequest",
      row: Object.assign({}, REQ, { fromD4: "0042", toD4: "0007" })
    });
    const row = b.db.rowsOf("DutyChangeRequest")[0];
    eq(row.fromD4, "0042", "leading zeros survive");
    eq(row.toD4, "0007", "on both 4D columns");
    eq(row.date, "2026-09-01", "and the date is still ISO");
  });
};
