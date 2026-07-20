// In-memory stubs for the browser globals the frontend sync-core touches at load
// and runtime (localStorage, document, window, timers, performance, confirm).
// Each client gets its own instance, so two simulated tabs don't share state.
// `ctl` lets tests flip the modal-open state and the confirm() return value.

function makeBrowser() {
  const ctl = { modalOpen: false, confirm: true };

  // P3-2 (SYNC_PERF_IMPROVEMENTS_SPEC.md): setTimeout used to be a pure no-op
  // (`() => 0`) that never invoked its callback at all — nothing under test
  // ever fired on a real timer. That's exactly what state.js's debounced
  // saveLocal() needs to be exercised deliberately rather than by accident,
  // so upgrade the stub to actually RECORD scheduled callbacks (and let
  // clearTimeout cancel them) without ever auto-firing them; a test opts in
  // by calling `ctl.flushTimers()`. Since the old stub never fired anything
  // either, this is behavior-preserving for every existing test that doesn't
  // call flushTimers().
  const timers = new Map();
  let nextTimerId = 1;

  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => store.clear()
  };

  function makeEl() {
    return {
      style: { cssText: "" }, innerHTML: "", textContent: "", title: "", onclick: null,
      value: "", disabled: false, dataset: {},
      classList: {
        _s: new Set(["hidden"]),
        contains(c) { return this._s.has(c); },
        add(c) { this._s.add(c); },
        remove(c) { this._s.delete(c); },
        toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }
      },
      appendChild() {}, querySelector() { return null; },
      // Needed once js/main.js is loaded into the vm sandbox (launch-bootstrap
      // tests): its top-level wiring calls addEventListener on several
      // getElementById() results. No-op is fine — those tests drive behaviour
      // by calling the named functions (bootstrap/pullAndRender/etc) directly,
      // not by dispatching real DOM events.
      addEventListener() {}, removeEventListener() {}
    };
  }
  // P3-2: document/window addEventListener used to be pure no-ops (call
  // accepted, callback discarded) — fine while nothing under test needed a
  // real DOM event. state.js now wires pagehide/visibilitychange→hidden to
  // flush saveLocal(), and a test needs to actually fire those. Record
  // listeners per (scope, type) and expose ctl.fireWindowEvent/
  // ctl.fireDocumentEvent to invoke them on demand; nothing fires on its own,
  // so every existing test that never triggers an event keeps seeing the old
  // no-op behavior.
  const listeners = { document: new Map(), window: new Map() };
  function addListener(scope, type, fn) {
    if (!listeners[scope].has(type)) listeners[scope].set(type, []);
    listeners[scope].get(type).push(fn);
  }
  ctl.fireDocumentEvent = type => { for (const fn of (listeners.document.get(type) || [])) fn(); };
  ctl.fireWindowEvent = type => { for (const fn of (listeners.window.get(type) || [])) fn(); };

  const els = {};
  const document = {
    getElementById(id) {
      const e = els[id] || (els[id] = makeEl());
      if (id === "modal-overlay") { if (ctl.modalOpen) e.classList.remove("hidden"); else e.classList.add("hidden"); }
      return e;
    },
    // main.js's top-level nav/filter wiring does
    // `document.querySelectorAll(".nav-btn").forEach(...)` etc. — no matching
    // elements exist in this mock DOM, so an empty array (a real forEach-able)
    // is the correct "nothing to wire" answer.
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return makeEl(); },
    body: makeEl(),
    addEventListener(type, fn) { addListener("document", type, fn); },
    visibilityState: "visible"
  };
  const window = { addEventListener(type, fn) { addListener("window", type, fn); } };

  // Run every timer currently pending, in scheduling order. Snapshots the
  // queue first so a callback that itself schedules a new timer (e.g. a
  // re-armed debounce) doesn't get pulled into THIS flush — call
  // flushTimers() again to run that one. Keeps this a deterministic single
  // pass instead of a potentially-unbounded drain loop.
  ctl.flushTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const fn of pending) { try { fn(); } catch (e) { /* surface via test assertions */ throw e; } }
  };

  return {
    ctl,
    globals: {
      localStorage, document, window,
      confirm: () => ctl.confirm,
      performance: { now: () => Date.now() },
      setTimeout: fn => { const id = nextTimerId++; timers.set(id, fn); return id; },
      clearTimeout: id => { timers.delete(id); },
      setInterval: () => 0, clearInterval: () => {}
    }
  };
}

module.exports = { makeBrowser };
