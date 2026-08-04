// Drift guard for the hand-maintained GAS copy of dcrDutyMutations.
//
// apps-script-Code.gs carries its own copy of js/duty-request.js's slot-matching
// and mutation rules, because handleDecideDutyRequest applies an approved request
// server-side and the two runtimes share no code at run time (no require, no
// modules). Nothing regenerates that copy — it is maintained BY HAND.
//
// The failure mode is the reason this file exists and it is not a loud one: the
// submitter's preview says approving will do X, the backend does Y, and the
// request still reads "Approved". Nobody diffs a roster against a request they
// already approved, so a drift would live until someone turned up for a duty
// that was not theirs.
//
// Behavioural equality, not identical source — the frontend copy is written in
// modern JS and the port in the file's ES5 house style, so comparing text would
// go red on `const` vs `var`. What must never diverge is the OUTPUT.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq } = require("./_tap");
const { loadBackend } = require("./harness");

function loadFrontend() {
  const ctx = { console, JSON, Math, Date, String, Number, Object, Boolean };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js/duty-request.js"), "utf8"), ctx);
  return vm.runInContext("dcrDutyMutations", ctx);
}

const DUTY = [
  { id: "d1", date: "2026-09-01", dutyType: "COS", platoon: "", d4: "0042", source: "manual" },
  { id: "d2", date: "2026-09-08", dutyType: "PDS", platoon: "PLT1", d4: "0051", source: "auto" },
  { id: "d3", date: "2026-09-08", dutyType: "PDS", platoon: "PLT2", d4: "0061", source: "manual" }
];

const base = {
  id: "r1", submittedBy: "0042", submittedAt: "2026-08-05T00:00:00.000Z",
  date: "2026-09-01", dutyType: "COS", platoon: "",
  fromD4: "0042", toD4: "0077",
  swapDate: "", swapDutyType: "", swapPlatoon: "",
  reason: "why", status: "Pending",
  decidedBy: "0001", decidedAt: "2026-08-06T00:00:00.000Z", decisionNote: ""
};
const req = over => Object.assign({}, base, over);

// Every shape that behaves differently, not a sample. A case only present on one
// side of the port is exactly the case that would drift unnoticed.
const CASES = [
  ["reassign, slot held", req({ kind: "reassign" })],
  ["reassign, slot empty", req({ kind: "reassign", date: "2026-09-15" })],
  ["add, slot empty", req({ kind: "add", date: "2026-09-02", fromD4: "", toD4: "0077" })],
  ["add, slot already held", req({ kind: "add", toD4: "0077" })],
  ["remove, slot held", req({ kind: "remove", toD4: "" })],
  ["remove, slot empty", req({ kind: "remove", date: "2026-09-03", toD4: "" })],
  ["swap, both slots held", req({
    kind: "swap", toD4: "0051", swapDate: "2026-09-08", swapDutyType: "PDS", swapPlatoon: "PLT1"
  })],
  ["swap, far slot empty", req({
    kind: "swap", toD4: "0088", swapDate: "2026-09-20", swapDutyType: "COS", swapPlatoon: ""
  })],
  ["swap, near slot empty", req({
    kind: "swap", date: "2026-09-19", toD4: "0051",
    swapDate: "2026-09-08", swapDutyType: "PDS", swapPlatoon: "PLT1"
  })],
  ["swap between two platoons' PDS", req({
    kind: "swap", date: "2026-09-08", dutyType: "PDS", platoon: "PLT1", fromD4: "0051", toD4: "0061",
    swapDate: "2026-09-08", swapDutyType: "PDS", swapPlatoon: "PLT2"
  })],
  ["unknown kind writes nothing", req({ kind: "obliterate" })],
  ["empty duty tab", req({ kind: "reassign" })]
];

module.exports = async function run() {
  suite("duty request port parity: the GAS copy matches js/duty-request.js");

  const fe = loadFrontend();
  const be = loadBackend().dcrDutyMutations;

  for (const [name, r] of CASES) {
    await test(name, () => {
      const rows = name === "empty duty tab" ? [] : DUTY;
      eq(be(r, rows), fe(r, rows), "the two copies disagree — mirror the change into apps-script-Code.gs");
    });
  }

  await test("both copies survive a null request without throwing", () => {
    eq(be(null, DUTY), fe(null, DUTY), "same empty result");
  });

  await test("both copies treat a missing platoon and an empty one as the same slot", () => {
    // "" vs undefined is the classic way a hand-port drifts: one side coalesces,
    // the other compares strictly, and PDS silently stops matching.
    const r = req({ kind: "reassign", platoon: undefined });
    eq(be(r, DUTY), fe(r, DUTY), "same slot resolved");
  });
};
