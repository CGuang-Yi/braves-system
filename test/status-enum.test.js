// Guards the medical status enum: new excuses + RIB present in helpers.js.
const fs = require("fs");
const path = require("path");
const { suite, test, ok } = require("./_tap");

module.exports = async function run() {
  suite("status enum: new excuses + RIB");
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const required = [
    "Excuse FLEGS", "Excuse Sunlight", "Excuse Stay In", "Excuse PT",
    "Excuse Shoes", "Excuse Camo", "Excuse Loud Noise", "RIB (Rest in Bunk)"
  ];
  await test("MED_STATUS_GROUPS contains every new status", () => {
    for (const s of required) ok(src.includes(s), "missing: " + s);
  });
};
