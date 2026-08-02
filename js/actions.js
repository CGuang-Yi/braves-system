// Delegated event dispatch — the replacement for `onclick="foo('${id}')"`.
//
// THE PROBLEM THIS SOLVES. Most of this app's interactivity is wired from HTML
// strings built inside template literals in render.js/forms.js. Those edges are
// invisible to every tool: `no-undef` cannot see inside a string, "find
// references" returns nothing, and the codebase map had to grow a whole
// string-scanning pass just to report that ~195 declarations are reachable *only*
// that way. The practical cost is that a rename looks safe, ships, and breaks
// when a user clicks. Markup that says `data-action="openPerson"` and a registry
// that says `registerActions({ openPerson })` turn that invisible edge into a
// real identifier in real code — greppable, lintable, renameable.
//
// OBSERVABILITY IS THE POINT, so read this before adding an action. Inline
// `onclick="openPerson()"` had one genuine virtue: a typo threw a loud
// ReferenceError in the console the moment you clicked. A naive delegation
// mechanism silently does nothing instead, which is strictly WORSE than what it
// replaces. So:
//   • an unknown data-action logs an error naming the action and the element;
//   • registering the same name twice throws at load time rather than letting the
//     later definition quietly win (that is the bare-globals failure mode, and
//     re-importing it here would defeat the purpose);
//   • registering a non-function throws, which is what a typo'd shorthand
//     ({ openPerson } where openPerson is misspelled) produces.
//
// HOW HANDLERS RECEIVE ARGUMENTS. They do not take positional args parsed out of
// a string. Each handler is called as fn(el, event) and reads its own parameters
// off el.dataset. This is deliberate: string-interpolated arguments are why the
// old markup needed escapeAttr on every value and still broke on a name with an
// apostrophe. dataset values are set by the DOM, never parsed.
//
//   markup:  `<button data-action="openPerson" data-id="${escapeAttr(id)}">`
//   handler: registerActions({ openPerson: el => openPersonCard(el.dataset.id) })
//
// MIGRATION STATE: this coexists with inline handlers by design. Both mechanisms
// work; convert a render function at a time, with its tests. Do not sweep.

// Object.create(null), not {} — a handler named "constructor" or "toString" would
// otherwise collide with Object.prototype and dispatch something that is not a
// registered action at all. The same trap already bit tools/map's lookup tables.
const ACTIONS = Object.create(null);

// Which DOM event each attribute dispatches on. Separate attributes rather than
// one `data-action` plus a `data-on` modifier, so the markup states the event
// where a reader is already looking, and a <select> can never accidentally be
// wired to click.
const ACTION_ATTRS = {
  "data-action": "click",
  "data-action-change": "change",
  "data-action-input": "input",
  "data-action-submit": "submit"
};

// Register a batch of named handlers. Pass the functions by shorthand —
// registerActions({ openPerson, closeEditor }) — so ESLint's no-undef sees a real
// reference to each one and a rename that misses this call site fails the lint.
function registerActions(map) {
  Object.keys(map || {}).forEach(name => {
    if (name in ACTIONS) {
      throw new Error(`registerActions: "${name}" is already registered. ` +
        `Names are global across the app; pick a distinct one rather than shadowing.`);
    }
    if (typeof map[name] !== "function") {
      throw new Error(`registerActions: "${name}" is ${typeof map[name]}, not a function.`);
    }
    ACTIONS[name] = map[name];
  });
}

// Exposed for tests and for a console sanity check ("is this action wired?").
function actionNames() { return Object.keys(ACTIONS).sort(); }

// Resolve the nearest ancestor carrying `attr` (so a click on an icon or a <span>
// inside a button still finds the button's action), then run it.
function dispatchAction(attr, event) {
  const target = event.target;
  // event.target can be a text/comment node or the document itself; closest()
  // exists only on Elements.
  const el = target && typeof target.closest === "function" ? target.closest(`[${attr}]`) : null;
  if (!el) return;
  const name = el.getAttribute(attr);
  if (!name) return;
  const fn = ACTIONS[name];
  if (!fn) {
    // Loud on purpose — see the observability note at the top of this file.
    console.error(`[actions] no handler registered for ${attr}="${name}"`, el);
    return;
  }
  fn(el, event);
}

// One listener per event type, on document, attached once at load. Delegation is
// what makes this survive `render()` blowing away #content on every repaint —
// re-rendered markup needs no re-binding, which is the other half of why inline
// handlers were used in the first place.
//
// Guarded for the Node test sandboxes, which load this file without a document.
if (typeof document !== "undefined" && document.addEventListener) {
  Object.keys(ACTION_ATTRS).forEach(attr => {
    document.addEventListener(ACTION_ATTRS[attr], event => dispatchAction(attr, event));
  });
}

// Node test export (browser ignores `module`), mirroring js/calc.js.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { registerActions, actionNames, dispatchAction, ACTIONS, ACTION_ATTRS };
}
