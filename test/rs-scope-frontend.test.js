// The CLIENT-side mirror of the report-sick gate. Everything here is cosmetic —
// the server already withheld the rows (test/rs-scope.test.js). These helpers
// only decide whether a panel draws a person's row or a per-platoon count line,
// so the failure mode they prevent is a MISLEADING EMPTY ROW: an out-of-scope
// person rendered with no records reads as "never reported sick", which is a
// false statement about a real person.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient } = require("./harness");

module.exports = async function run() {
  suite("rs-scope: client helpers");

  // state.js's helpers call personPlatoon (js/helpers.js), which the sync-core
  // bundle does not include. Define it in the sandbox exactly as helpers.js does
  // for the explicit-column case these fixtures use.
  const client = (opts) => {
    const b = loadBackend();
    const c = makeClient(b, opts);
    c.sb.personPlatoon = r => String((r && r.platoon) || "").trim();
    c.sb.STATE.roster = [
      { id: "0011", name: "PC ONE", platoon: "PLT1" },
      { id: "0021", name: "PC TWO", platoon: "PLT2" },
      { id: "1101", name: "REC ALPHA", platoon: "PLT1" },
      { id: "2101", name: "REC BRAVO", platoon: "PLT2" },
      { id: "2102", name: "REC CHARLIE", platoon: "PLT2" },
      { id: "0099", name: "HQ CLERK", platoon: "HQ" }
    ];
    return c.sb;
  };

  await test("an admin holds company scope", () => {
    const sb = client({ role: "admin" });
    sb.STATE.role = "admin"; sb.STATE.caps = [];
    ok(sb.rsScope().company, "company");
    ok(sb.inRSScope("2101"), "sees everyone");
  });

  await test("rs:company grants company scope to a commander", () => {
    const sb = client({ role: "commander" });
    sb.STATE.role = "commander"; sb.STATE.caps = ["rs:company"];
    ok(sb.rsScope().company, "company");
  });

  // parseCapsCSV lowercases, so the cap is "rs:plt:plt2" while personPlatoon
  // returns "PLT2". Without the uppercase normalisation this silently matches
  // nothing and the commander sees a blank log — indistinguishable from having
  // been granted nothing at all.
  await test("rs:plt caps are uppercased before matching a platoon code", () => {
    const sb = client({ role: "commander" });
    sb.STATE.role = "commander"; sb.STATE.caps = ["rs:plt:plt2"];
    const s = sb.rsScope();
    eq(s.company, false, "not company");
    eq(s.plt.join(","), "PLT2", "uppercased");
    ok(sb.inRSScope("2101"), "PLT2 in scope");
    ok(!sb.inRSScope("1101"), "PLT1 out of scope");
  });

  await test("with no caps, scope falls back to the signed-in person's platoon", () => {
    const sb = client({ role: "commander" });
    sb.STATE.role = "commander"; sb.STATE.caps = []; sb.STATE.personId = "0021";
    eq(sb.rsScope().plt.join(","), "PLT2", "own platoon");
    ok(!sb.inRSScope("0099"), "HQ is its own scope");
  });

  await test("an unresolvable personId yields an empty scope, not company", () => {
    const sb = client({ role: "commander" });
    sb.STATE.role = "commander"; sb.STATE.caps = []; sb.STATE.personId = "9999";
    eq(sb.rsScope().company, false, "not company");
    eq(sb.rsScope().plt.length, 0, "empty");
    ok(!sb.inRSScope("1101"), "sees nobody");
  });

  // This is what the panels render instead of empty rows.
  await test("rsOutOfScopeCounts groups withheld people by platoon", () => {
    const sb = client({ role: "commander" });
    sb.STATE.role = "commander"; sb.STATE.caps = []; sb.STATE.personId = "0011";
    const out = sb.rsOutOfScopeCounts();
    const byPlt = {};
    out.forEach(x => { byPlt[x.platoon] = x.count; });
    eq(byPlt.PLT2, 3, "PLT2: PC TWO + 2 recruits");
    eq(byPlt.HQ, 1, "HQ: the clerk");
    eq(byPlt.PLT1, undefined, "own platoon is not listed as out of scope");
  });

  await test("company scope reports nothing out of scope", () => {
    const sb = client({ role: "admin" });
    sb.STATE.role = "admin"; sb.STATE.caps = [];
    eq(sb.rsOutOfScopeCounts().length, 0, "no count lines to draw");
  });

  suite("rs-scope: scope-key-driven refresh");

  const sbFor = () => {
    const b = loadBackend();
    const c = makeClient(b, {});
    return c.sb;
  };

  await test("an unchanged scope key adds no tabs", () => {
    const sb = sbFor();
    sb.STATE.scopeKey = "PLT1";
    eq(sb.rsApplyScopeKey({ scopeKey: "PLT1" }).length, 0, "nothing forced");
    eq(sb.STATE.scopeKey, "PLT1", "unchanged");
  });

  await test("a changed scope key forces Medical and MSK", () => {
    const sb = sbFor();
    sb.STATE.scopeKey = "PLT1";
    eq(sb.rsApplyScopeKey({ scopeKey: "company" }).sort().join(","), "MSK,Medical", "both forced");
    eq(sb.STATE.scopeKey, "company", "key advanced");
  });

  await test("a first-ever key (empty cache) forces a pull", () => {
    const sb = sbFor();
    sb.STATE.scopeKey = "";
    eq(sb.rsApplyScopeKey({ scopeKey: "PLT1" }).sort().join(","), "MSK,Medical", "cold cache pulls");
  });

  // An older backend deploy has no scopeKey at all. The client must not read
  // that as "your scope became empty" and thrash a re-pull on every poll.
  await test("a response with no scopeKey field changes nothing", () => {
    const sb = sbFor();
    sb.STATE.scopeKey = "PLT1";
    eq(sb.rsApplyScopeKey({ ok: true, revs: {} }).length, 0, "no forced tabs");
    eq(sb.STATE.scopeKey, "PLT1", "cached key preserved");
  });

  // Guard on plan deviation D1: the revs map must stay numeric so sync.js's
  // Number(a) > Number(b) filter keeps working.
  await test("the forced tabs are added WITHOUT touching STATE.rev", () => {
    const sb = sbFor();
    sb.STATE.scopeKey = "PLT1";
    sb.STATE.rev = { Medical: 7, MSK: 3 };
    sb.rsApplyScopeKey({ scopeKey: "company" });
    eq(sb.STATE.rev.Medical, 7, "rev untouched — OCC baseRev must stay valid");
    eq(sb.STATE.rev.MSK, 3, "rev untouched");
  });
};
