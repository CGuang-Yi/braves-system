// Guards the pull-path normalization of the Conducts registry.
//
// Regression: the Conducts registry grew className / classSeq / makeupFor
// fields (manual conduct classes + makeup crediting). The localStorage-cache
// read boundary (state.js loadLocal → normalizeConducts) was updated, but the
// NETWORK pull boundary — PULL_ASSIGN.conducts in js/api.js, shared by pullAll
// and pullTabs — was left assigning the raw sheet rows verbatim. A freshly
// pulled registry (empty cache, or any launch that pulls the Conducts tab)
// therefore arrived WITHOUT the three fields, so the dashboard's class grouping
// and makeup crediting saw `undefined` classSeq / makeupFor until a cache
// round-trip healed it. This test seeds a legacy-shape Conducts row (id+name
// only) into the backend, does a real pullAll through the full-stack harness,
// and asserts the fields are present and defaulted.
const { suite, test, ok, eq } = require("./_tap");
const { loadBackend, makeClient } = require("./harness");

module.exports = async function run() {
  suite("pull normalization: Conducts registry gains class/makeup fields");

  await test("pullAll normalizes legacy id+name conduct rows to include className/classSeq/makeupFor", async () => {
    const b = loadBackend();
    // A legacy-shape registry: no className / classSeq / makeupFor columns at all.
    b.db.seed("Conducts", ["id", "name"], [["c001", "Morning PT"], ["c002", "Endurance Run"]]);
    const client = makeClient(b);

    await client.sb.API.pullAll();

    const conducts = client.sb.STATE.conducts;
    eq(conducts.length, 2, "both conduct rows pulled");
    const c0 = conducts[0];
    ok("className" in c0, "className field is missing after a network pull");
    ok("classSeq" in c0, "classSeq field is missing after a network pull");
    ok("makeupFor" in c0, "makeupFor field is missing after a network pull");
    eq(c0.className, "", "className should default to empty string");
    eq(c0.classSeq, 0, "classSeq should default to 0");
    eq(c0.makeupFor, "", "makeupFor should default to empty string");
    // Existing fields survive untouched.
    eq(c0.id, "c001", "id preserved");
    eq(c0.name, "Morning PT", "name preserved");
  });
};
