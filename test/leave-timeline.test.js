// Functional guards for the Leave / Out 21-day timeline's collapsed view.
// render.js is DOM-heavy, so brace-match only the timeline renderer and its
// small toggle handler into a vm sandbox with their direct dependencies.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

function extractFunction(src, name) {
  const start = src.indexOf("function " + name);
  if (start < 0) throw new Error("function not found: " + name);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces for " + name);
}

function load() {
  const sandbox = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
    escapeHTML: value => String(value == null ? "" : value),
    displayPersonLabel: d4 => d4
  };
  vm.createContext(sandbox);
  const render = fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8");
  const src = ["toggleLeaveTimeline", "renderLeaveTimeline"]
    .map(name => extractFunction(render, name)).join("\n")
    + "\n;this.toggleLeaveTimeline = toggleLeaveTimeline; this.renderLeaveTimeline = renderLeaveTimeline;";
  vm.runInContext(src, sandbox, { filename: "leave-timeline-slice.js" });
  return sandbox;
}

function isoAt(offset) {
  const date = new Date("2026-07-15T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function leave(d4, offset) {
  const iso = isoAt(offset);
  return {
    d4,
    startIso: iso,
    endIso: iso,
    startDate: iso,
    endDate: iso,
    type: "Leave",
    reason: ""
  };
}

function entries(count) {
  return Array.from({ length: count }, (_, i) => leave(String(1001 + i), i));
}

function timelineRows(html) {
  return [...html.matchAll(/<tr( data-leave-overflow hidden)? onclick="openPerson\('([^']+)'\)"/g)]
    .map(match => ({ overflow: Boolean(match[1]), d4: match[2] }));
}

module.exports = async function run() {
  suite("leave timeline: collapsed overflow rows");

  await test("five people render normally without an expansion control", () => {
    const html = load().renderLeaveTimeline(entries(5), "2026-07-15");
    const rows = timelineRows(html);
    eq(rows.length, 5);
    ok(rows.every(row => !row.overflow), "none of the first five rows should be hidden");
    ok(!html.includes("Show all"), "five people should not render an expansion control");
    ok(html.includes("5 people"), "heading should retain the total-person count");
  });

  await test("six people render five visible rows and one collapsed overflow row", () => {
    const html = load().renderLeaveTimeline(entries(6), "2026-07-15");
    const rows = timelineRows(html);
    eq(rows.map(row => row.d4).join(","), "1001,1002,1003,1004,1005,1006", "earliest-leave-first order must stay intact");
    eq(rows.filter(row => row.overflow).length, 1, "only the sixth row should start hidden");
    eq(rows.find(row => row.overflow).d4, "1006");
    ok(html.includes("Show all (1 more)"));
    ok(html.includes('aria-expanded="false"'));
    ok(html.includes("6 people"), "heading should show all people, not only the visible five");
  });

  await test("the renderer uses only the already-scoped input when counting overflow", () => {
    const scoped = entries(7).filter(row => row.d4 !== "1002");
    const html = load().renderLeaveTimeline(scoped, "2026-07-15");
    eq(timelineRows(html).length, 6);
    ok(!html.includes("1002"), "a person outside the supplied scope must stay absent");
    ok(html.includes("Show all (1 more)"), "hidden count must be calculated after scoping");
  });

  await test("the control reveals overflow rows, then restores the collapsed view", () => {
    const sb = load();
    const rows = [{ hidden: true }, { hidden: true }];
    const attrs = { "aria-expanded": "false" };
    const button = {
      textContent: "Show all (2 more)",
      closest: selector => selector === "[data-leave-timeline]" ? {
        querySelectorAll: rowSelector => rowSelector === "[data-leave-overflow]" ? rows : []
      } : null,
      getAttribute: name => attrs[name],
      setAttribute: (name, value) => { attrs[name] = value; }
    };

    sb.toggleLeaveTimeline(button);
    ok(rows.every(row => row.hidden === false), "expanding should reveal every overflow row");
    eq(attrs["aria-expanded"], "true");
    eq(button.textContent, "Show less");

    sb.toggleLeaveTimeline(button);
    ok(rows.every(row => row.hidden === true), "collapsing should hide every overflow row again");
    eq(attrs["aria-expanded"], "false");
    eq(button.textContent, "Show all (2 more)");
  });
};
