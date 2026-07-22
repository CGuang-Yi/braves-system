// personParticipation (js/calc.js): per-person participation over the "added-in" set.
// A person is "added into" a conduct when they are in its CSV participant list OR have
// a non-participation (conductDetail) row for it. pct = present / added-in. Makeups need
// no special-casing — a missed original and an attended makeup are separate conducts,
// both in added-in.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");

function loadCalc() {
  const sandbox = { module: { exports: {} }, Date, Math, String, Number, Set, Object, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "calc.js"), "utf8"), sandbox, { filename: "calc.js" });
  return sandbox;
}

module.exports = async function run() {
  suite("calc: personParticipation");
  const c = loadCalc();

  await test("present vs added-in from participants + out-rows", () => {
    const attendance = [
      { conductId: "c1", date: "01/06/26", source: "csv", participants: "0001,0002" },
      { conductId: "c2", date: "02/06/26", source: "csv", participants: "0001" }
    ];
    // 0002 was logged absent (Status) for c2 → added-in but not present.
    const conductDetail = [{ conductId: "c2", date: "02/06/26", d4: "0002", type: "Status" }];
    const r = c.personParticipation(attendance, conductDetail, null);
    eq(r["0001"].present, 2); eq(r["0001"].addedIn, 2); eq(r["0001"].pct, 100);
    eq(r["0002"].present, 1); eq(r["0002"].addedIn, 2); eq(r["0002"].pct, 50);
  });

  await test("makeup: missed original + attended makeup both count", () => {
    // 0003 missed c3 (out-row) and attended its makeup c3m (participant).
    const attendance = [
      { conductId: "c3", date: "03/06/26", source: "csv", participants: "0001" },
      { conductId: "c3m", date: "05/06/26", source: "csv", participants: "0003" }
    ];
    const conductDetail = [{ conductId: "c3", date: "03/06/26", d4: "0003", type: "Fallout" }];
    const r = c.personParticipation(attendance, conductDetail, null);
    // added-in = {c3 (absent), c3m (present)} → 1/2 = 50%.
    eq(r["0003"].present, 1); eq(r["0003"].addedIn, 2); eq(r["0003"].pct, 50);
  });

  await test("non-csv attendance rows are excluded", () => {
    const attendance = [{ conductId: "c1", date: "01/06/26", source: "manual", participating: 10, total: 10 }];
    const r = c.personParticipation(attendance, [], null);
    eq(Object.keys(r).length, 0);
  });

  await test("conductIdSet restricts the counted conducts", () => {
    const attendance = [
      { conductId: "c1", date: "01/06/26", source: "csv", participants: "0001" },
      { conductId: "c2", date: "02/06/26", source: "csv", participants: "0001" }
    ];
    const r = c.personParticipation(attendance, [], new Set(["c1"]));
    eq(r["0001"].addedIn, 1);
  });

  await test("addedIn 0 → pct null (never emitted)", () => {
    const r = c.personParticipation([], [], null);
    eq(Object.keys(r).length, 0);
  });
};
