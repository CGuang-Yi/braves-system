// Duty change requests — the pure rules (design §3).
//
// PURE MODULE — loaded on its own with no STATE and no DOM. dcrDutyMutations is
// the single definition of what approving a request does to the Duty tab, so it
// is worth testing where nothing else can interfere with it.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

function load() {
  const ctx = { console, JSON, Math, Date, String, Number, Object, Boolean };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js/duty-request.js"), "utf8"), ctx);
  return name => vm.runInContext(name, ctx);
}

// A COS slot on 1 Sep held by 0042, and a PDS 1 slot on 8 Sep held by 0051.
const DUTY = [
  { id: "d1", date: "2026-09-01", dutyType: "COS", platoon: "", d4: "0042", source: "manual" },
  { id: "d2", date: "2026-09-08", dutyType: "PDS", platoon: "PLT1", d4: "0051", source: "auto" }
];

const req = over => Object.assign({
  id: "r1", submittedBy: "0042", submittedAt: "2026-08-05T00:00:00.000Z",
  date: "2026-09-01", dutyType: "COS", platoon: "",
  kind: "reassign", fromD4: "0042", toD4: "0077",
  swapDate: "", swapDutyType: "", swapPlatoon: "",
  reason: "medical appointment", status: "Pending",
  decidedBy: "", decidedAt: "", decisionNote: ""
}, over);

module.exports = async function run() {
  suite("duty request: what approving does to the Duty tab");

  await test("reassign rewrites the existing row in place, keeping its id", () => {
    const g = load();
    const m = g("dcrDutyMutations")(req(), DUTY);
    eq(m.deletes, [], "nothing deleted");
    eq(m.upserts.length, 1, "one upsert");
    // The id is the load-bearing part: a new id would leave the OLD row in the
    // sheet and the slot would end up held by two people.
    eq(m.upserts[0].id, "d1", "reuses the slot's row id");
    eq(m.upserts[0].d4, "0077", "new holder");
    eq(m.upserts[0].source, "request", "provenance recorded");
  });

  await test("add into an EMPTY slot leaves the id blank for the caller to mint", () => {
    const g = load();
    const m = g("dcrDutyMutations")(req({ kind: "add", date: "2026-09-02", fromD4: "", toD4: "0077" }), DUTY);
    eq(m.upserts.length, 1, "one upsert");
    eq(m.upserts[0].id, "", "blank id — the module does not know how ids are minted");
    eq(m.upserts[0].date, "2026-09-02", "the requested date, not the slot it did not find");
  });

  await test("remove deletes the row, and does nothing at all on an empty slot", () => {
    const g = load();
    const m = g("dcrDutyMutations")(req({ kind: "remove", toD4: "" }), DUTY);
    eq(m.deletes, ["d1"], "the held row");
    eq(m.upserts, [], "nothing written");

    const empty = g("dcrDutyMutations")(req({ kind: "remove", date: "2026-09-03", toD4: "" }), DUTY);
    eq(empty.deletes, [], "nothing to remove");
    eq(empty.upserts, [], "and nothing invented");
  });

  await test("reassign against a slot someone CLEARED meanwhile still lands, as an add", () => {
    // Refusing here would reject a request whose intent is still perfectly
    // satisfiable, at approval time, long after the submitter could react.
    const g = load();
    const m = g("dcrDutyMutations")(req({ date: "2026-09-15" }), DUTY);
    eq(m.upserts.length, 1, "still applied");
    eq(m.upserts[0].id, "", "as a new row");
    eq(m.upserts[0].d4, "0077", "with the requested holder");
  });

  await test("swap exchanges the two slots' holders, each keeping its own row id", () => {
    const g = load();
    const m = g("dcrDutyMutations")(req({
      kind: "swap", fromD4: "0042", toD4: "0051",
      swapDate: "2026-09-08", swapDutyType: "PDS", swapPlatoon: "PLT1"
    }), DUTY);
    eq(m.deletes, [], "a swap deletes nothing");
    eq(m.upserts.length, 2, "both slots written");

    const byId = {};
    m.upserts.forEach(u => { byId[u.id] = u; });
    eq(byId.d1.d4, "0051", "the COS slot takes the counterparty");
    eq(byId.d1.date, "2026-09-01", "and keeps its own date");
    eq(byId.d2.d4, "0042", "the PDS slot takes the submitter");
    eq(byId.d2.date, "2026-09-08", "and keeps its own date");
    eq(byId.d2.platoon, "PLT1", "and its own platoon");
  });

  await test("a swap whose counterparty slot is empty still moves the submitter across", () => {
    const g = load();
    const m = g("dcrDutyMutations")(req({
      kind: "swap", fromD4: "0042", toD4: "0088",
      swapDate: "2026-09-20", swapDutyType: "COS", swapPlatoon: ""
    }), DUTY);
    eq(m.upserts.length, 2, "both sides written");
    const moved = m.upserts.find(u => u.date === "2026-09-20");
    eq(moved.d4, "0042", "submitter takes the empty far slot");
    eq(moved.id, "", "which is a new row");
  });

  suite("duty request: validation");

  const problems = (g, r) => g("dcrValidate")(r);

  await test("a blank reason is refused whatever the kind", () => {
    const g = load();
    ["add", "remove", "reassign"].forEach(kind => {
      const p = problems(g, req({ kind, reason: "   ", toD4: "0077", fromD4: "0042" }));
      ok(p.some(x => /reason/i.test(x)), kind + " needs a reason");
    });
  });

  await test("an unknown kind is refused and short-circuits the rest", () => {
    const g = load();
    const p = problems(g, req({ kind: "obliterate" }));
    eq(p.length, 1, "one problem, not a cascade of meaningless ones");
  });

  await test("a swap with no counterparty slot is refused", () => {
    const g = load();
    const p = problems(g, req({ kind: "swap", toD4: "0051", swapDate: "", swapDutyType: "" }));
    ok(p.some(x => /swapping for/i.test(x)), "the swap* triple is required");
  });

  await test("a swap pointing at its OWN slot is refused as a reassign in disguise", () => {
    const g = load();
    const p = problems(g, req({
      kind: "swap", toD4: "0051",
      swapDate: "2026-09-01", swapDutyType: "COS", swapPlatoon: ""
    }));
    ok(p.some(x => /same slot/i.test(x)), "caught");
  });

  await test("reassigning someone to themselves is refused", () => {
    const g = load();
    const p = problems(g, req({ fromD4: "0042", toD4: "0042" }));
    ok(p.some(x => /same person/i.test(x)), "caught");
  });

  await test("a well-formed request of each kind has no problems", () => {
    const g = load();
    eq(problems(g, req()), [], "reassign");
    eq(problems(g, req({ kind: "add", fromD4: "", toD4: "0077" })), [], "add");
    eq(problems(g, req({ kind: "remove", fromD4: "0042", toD4: "" })), [], "remove");
    eq(problems(g, req({
      kind: "swap", toD4: "0051",
      swapDate: "2026-09-08", swapDutyType: "PDS", swapPlatoon: "PLT1"
    })), [], "swap");
  });

  suite("duty request: queue ordering");

  await test("pending is oldest-first and decided is newest-first", () => {
    const g = load();
    const rows = [
      req({ id: "a", submittedAt: "2026-08-03T00:00:00Z" }),
      req({ id: "b", submittedAt: "2026-08-01T00:00:00Z" }),
      req({ id: "c", status: "Approved", decidedAt: "2026-08-02T00:00:00Z" }),
      req({ id: "d", status: "Rejected", decidedAt: "2026-08-04T00:00:00Z" })
    ];
    eq(g("dcrPending")(rows).map(r => r.id), ["b", "a"], "longest-waiting first");
    eq(g("dcrDecided")(rows).map(r => r.id), ["d", "c"], "most recent decision first");
  });

  await test("a row with no status counts as Pending, not as neither", () => {
    const g = load();
    const rows = [req({ id: "x", status: "" })];
    eq(g("dcrPending")(rows).length, 1, "surfaced");
    eq(g("dcrDecided")(rows).length, 0, "and not double-counted");
  });
};
