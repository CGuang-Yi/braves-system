// Masker behaviour. The masker is the accuracy ceiling for the whole codebase-map
// tool — every later stage is a text scan over its output — so these cover the
// cases that would silently corrupt downstream counts rather than crash.
const { suite, test, ok, eq } = require("./_tap");
const { maskSource } = require("../tools/map/mask");

module.exports = async function () {
  suite("map/mask");

  await test("preserves length and newlines", () => {
    const src = "a();\n// gone\nb();\n";
    const { masked } = maskSource(src);
    eq(masked.length, src.length, "length preserved");
    eq(masked.split("\n").length, src.split("\n").length, "newline count preserved");
  });

  await test("blanks line comments but keeps code", () => {
    const { masked } = maskSource("foo(); // bar()");
    ok(masked.includes("foo()"), "code kept");
    ok(!masked.includes("bar()"), "comment blanked");
  });

  await test("blanks block comments", () => {
    const { masked } = maskSource("a(); /* b();\n c(); */ d();");
    ok(masked.includes("a()") && masked.includes("d()"), "code kept");
    ok(!masked.includes("b()") && !masked.includes("c()"), "comment blanked");
  });

  await test("blanks string bodies and records them", () => {
    const { masked, strings } = maskSource("x('foo()');");
    ok(!masked.includes("foo()"), "string body blanked from code");
    eq(strings.map(s => s.text), ["foo()"], "string body recorded");
  });

  await test("template interpolation stays code, template text does not", () => {
    const { masked, strings } = maskSource("`<b>${esc(n)}</b> lit()`");
    ok(masked.includes("esc(n)"), "interpolation kept as code");
    ok(!masked.includes("lit()"), "template text blanked");
    ok(strings.some(s => s.text.includes("lit()")), "template text recorded as string");
  });

  await test("regex literal does not open a comment or swallow code", () => {
    const { masked } = maskSource("const re = /https?:\\/\\//; after();");
    ok(masked.includes("after()"), "code after regex survives");
  });

  await test("division is not mistaken for a regex", () => {
    const { masked } = maskSource("const r = a / b; after();");
    ok(masked.includes("after()"), "code after division survives");
  });

  await test("escaped quote does not end the string early", () => {
    const { masked } = maskSource("x('a\\'b()'); after();");
    ok(!masked.includes("b()"), "escaped quote kept inside string");
    ok(masked.includes("after()"), "code after string survives");
  });
};
