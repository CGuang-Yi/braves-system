// Guard for a display bug: bravesParadeRN / sickRN (js/braves-parade.js)
// appended the "<prefix><fourD>" tag to ANY roster row with a non-blank
// fourD, including commanders — who per spec (apps-script-Code.gs header,
// §5) are "never displayed in the UI by id", rank+name shows instead. A
// commander row can end up with a stray fourD value (legacy sheet data,
// manual entry), so the formatters must check role, not just fourD.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");

function loadParade(roster) {
  const STATE = { roster, medical: [], leave: [], appointments: [] };
  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    isNaN, parseInt, parseFloat,
    STATE,
    configGet: key => (key === "companyPrefix" ? "B" : ""),
    displayDateToISO: () => "",
    medStatusActive: () => false
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8")
    + "\n;this.bravesParadeRN = bravesParadeRN; this.sickRN = sickRN;\n";
  vm.runInContext(src, sandbox, { filename: "braves-parade.js" });
  return sandbox;
}

module.exports = async function run() {
  suite("R/N formatting: commanders never get a 4D suffix");

  await test("commander with a stray fourD shows rank+name, not name+B<4D>", () => {
    const sb = loadParade([
      { id: "0001", name: "Martin Tan", rank: "CPT", role: "Commander", fourD: "0001" }
    ]);
    eq(sb.bravesParadeRN("0001"), "CPT Martin Tan");
    // The sick R/N keeps the no-4D rule for commanders but now carries the rank.
    eq(sb.sickRN("0001"), "CPT Martin Tan");
  });

  await test("recruit with a fourD gets rank + name+B<4D> on both surfaces", () => {
    const sb = loadParade([
      { id: "1411", name: "Trevor Lee", rank: "REC", role: "Recruit", fourD: "1411" }
    ]);
    // Both R/N surfaces prepend the roster rank (a Braves-requested divergence
    // from Message Formats.md). The sick R/N used to be deliberately rank-less
    // per spec §10; that was overridden on 2026-07-28 — DECISIONS #122.
    eq(sb.bravesParadeRN("1411"), "REC Trevor Lee B1411");
    eq(sb.sickRN("1411"), "REC Trevor Lee B1411");
  });

  await test("recruit with a blank rank defaults to REC, not a bare name", () => {
    // The roster's rank column is left blank for most recruits, so this — not the
    // populated case above — is what the generators actually see in production.
    const sb = loadParade([
      { id: "1411", name: "Trevor Lee", rank: "", role: "Recruit", fourD: "1411" }
    ]);
    eq(sb.bravesParadeRN("1411"), "REC Trevor Lee B1411");
    eq(sb.sickRN("1411"), "REC Trevor Lee B1411");
  });

  await test("commander with a blank rank stays bare — never defaulted to REC", () => {
    // A blank rank on a commander means the roster row is incomplete. Rendering
    // a sergeant as "REC" would be wrong, not merely terse.
    const sb = loadParade([
      { id: "0002", name: "Nicholas Eng", rank: "", role: "Commander", fourD: "0002" }
    ]);
    eq(sb.bravesParadeRN("0002"), "Nicholas Eng");
    eq(sb.sickRN("0002"), "Nicholas Eng");
  });

  await test("no-4D recruit falls back to rank+name on both surfaces", () => {
    const sb = loadParade([
      { id: "OC1", name: "Calvin Lee", rank: "LCP", role: "Recruit", fourD: "" }
    ]);
    eq(sb.bravesParadeRN("OC1"), "LCP Calvin Lee");
    eq(sb.sickRN("OC1"), "LCP Calvin Lee");
  });

  ok(true);
};
