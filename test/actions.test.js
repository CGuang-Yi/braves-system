// The delegated action registry (js/actions.js).
//
// What is worth testing here is NOT "does a click call the function" — it is the
// set of guarantees that make this mechanism safe to migrate onto. Replacing
// `onclick="foo()"` with `data-action="foo"` trades a loud ReferenceError for a
// lookup that could silently do nothing, so every failure mode below is asserted
// explicitly. If one of these regresses, a broken button becomes invisible again
// and the migration has made the codebase worse, not better.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, ok, eq } = require("./_tap");
const { maskSource } = require("../tools/map/mask");

// Load actions.js with NO `document`, exercising its own guard, and drive
// dispatchAction directly with synthetic events. A real DOM is not needed: the
// contract under test is (attribute → nearest element → registered fn), and a
// fake element with closest()/getAttribute()/dataset models exactly that.
function loadActions() {
  const sandbox = {
    module: { exports: {} }, Object, String, Error, console,
    // no `document` — the load-time listener attachment must no-op, not throw
  };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "actions.js"), "utf8"),
    sandbox, { filename: "actions.js" }
  );
  return sandbox.module.exports;
}

// An element carrying `attrs`, whose closest() returns itself when it has the
// requested attribute and otherwise walks to its parent — the same resolution
// the real DOM does for a click on a child node.
function el(attrs, parent) {
  return {
    dataset: Object.keys(attrs).reduce((d, k) => {
      const m = /^data-(.+)$/.exec(k);
      if (m && !m[1].startsWith("action")) {
        d[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attrs[k];
      }
      return d;
    }, {}),
    getAttribute: k => (k in attrs ? attrs[k] : null),
    closest(sel) {
      const want = sel.replace(/^\[|\]$/g, "");
      if (want in attrs) return this;
      return parent ? parent.closest(sel) : null;
    }
  };
}

module.exports = async function () {
  suite("actions: registration guards");

  await test("a duplicate name throws instead of silently overwriting", () => {
    const A = loadActions();
    A.registerActions({ doThing: () => {} });
    let threw = null;
    try { A.registerActions({ doThing: () => {} }); } catch (e) { threw = e; }
    ok(threw, "second registration threw");
    ok(/already registered/.test(threw.message), "message names the problem");
    // Silent last-write-wins is precisely the bare-globals failure this mechanism
    // exists to escape; re-importing it here would defeat the purpose.
  });

  await test("registering a non-function throws", () => {
    const A = loadActions();
    let threw = null;
    // What `registerActions({ opneThing })` produces when the shorthand name is
    // misspelled and the identifier resolves to undefined.
    try { A.registerActions({ typo: undefined }); } catch (e) { threw = e; }
    ok(threw && /not a function/.test(threw.message), "rejected with a clear message");
  });

  await test("loading without a document does not throw", () => {
    // Guards the Node test sandboxes, which load this file with no DOM at all.
    const A = loadActions();
    ok(typeof A.registerActions === "function", "module loaded and exported");
  });

  suite("actions: dispatch");

  await test("a click resolves to the nearest ancestor carrying the attribute", () => {
    const A = loadActions();
    let got = null;
    A.registerActions({ openPerson: (e2) => { got = e2.dataset.id; } });
    const button = el({ "data-action": "openPerson", "data-id": "1234" });
    const icon = el({}, button);           // the <span> actually clicked
    A.dispatchAction("data-action", { target: icon });
    eq(got, "1234", "handler ran with the button's dataset, not the icon's");
  });

  await test("handlers receive (el, event)", () => {
    const A = loadActions();
    let sawEvent = null;
    A.registerActions({ act: (_e, ev) => { sawEvent = ev; } });
    const node = el({ "data-action": "act" });
    const event = { target: node, tag: "the-event" };
    A.dispatchAction("data-action", event);
    eq(sawEvent && sawEvent.tag, "the-event", "the original event object is passed through");
  });

  await test("an UNREGISTERED action logs an error rather than failing silently", () => {
    // The load-bearing assertion of this file. Inline onclick threw a visible
    // ReferenceError on a typo; if this mechanism swallowed it, a dead button
    // would look exactly like a working one.
    const A = loadActions();
    const errs = [];
    const realError = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try {
      A.dispatchAction("data-action", { target: el({ "data-action": "noSuchThing" }) });
    } finally { console.error = realError; }
    eq(errs.length, 1, "exactly one error logged");
    ok(/noSuchThing/.test(errs[0]), "the error names the missing action");
  });

  await test("a click on nothing actionable is a no-op", () => {
    const A = loadActions();
    // No [data-action] ancestor, and targets with no closest() at all (text
    // nodes, document) must not throw — they are the common case for any click.
    A.dispatchAction("data-action", { target: el({}) });
    A.dispatchAction("data-action", { target: {} });
    A.dispatchAction("data-action", { target: null });
    ok(true, "no throw");
  });

  suite("actions: wiring");

  await test("every data-action in js/ has a registered handler", () => {
    // The check that makes the migration safe to continue: markup and registry
    // are written in different places and nothing else ties them together. A
    // converted handler whose registerActions entry was forgotten fails HERE
    // rather than under a user's finger.
    const jsDir = path.join(__dirname, "..", "js");
    const registered = new Set();
    const used = [];
    for (const f of fs.readdirSync(jsDir).filter(n => n.endsWith(".js"))) {
      const src = fs.readFileSync(path.join(jsDir, f), "utf8");
      // Names in a registerActions({...}) block: `name:` or bare shorthand.
      for (const block of src.match(/registerActions\(\{[\s\S]*?\n\}\)/g) || []) {
        for (const m of block.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)) registered.add(m[1]);
      }
      // Scan STRING BODIES, not raw source: markup only ever lives in a string,
      // and a raw scan reads the documentation examples in js/actions.js as if
      // they were real markup (it did, on the first run of this test). maskSource
      // hands back exactly the string literals, comments already excluded.
      for (const s of maskSource(src).strings) {
        for (const m of s.text.matchAll(/\bdata-action(?:-\w+)?="([A-Za-z_$][\w$]*)"/g)) {
          used.push({ file: f, name: m[1] });
        }
      }
    }
    ok(used.length > 0, `found ${used.length} data-action attributes to check`);
    const missing = used.filter(u => !registered.has(u.name));
    eq(missing.map(m => `${m.file}:${m.name}`), [], "every data-action name is registered");
  });
};
