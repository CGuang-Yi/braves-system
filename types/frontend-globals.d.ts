// Ambient declarations for cross-file globals used by type-checked modules.
//
// Nothing is compiled and nothing ships — this exists only so `npm run
// typecheck` can resolve a call that the browser resolves through the shared
// global scope created by plain <script> tags.
//
// Why it is needed at all: every checked module ends with a
// `module.exports` guard for the Node test harness, which makes tsc treat the
// file as a CommonJS module. A module's top-level declarations are NOT global,
// so a reference from one checked file to a function declared in another fails
// with TS2304 even though both are in `files` and both are genuinely global at
// runtime. Declaring the handful of crossings here is the small, honest fix;
// the alternative — duplicating the function — is how date arithmetic drifts.
//
// Keep this list SHORT. It is a list of dependencies between pure modules, and
// it should stay small enough to read. It is not a place to declare `STATE` or
// anything DOM-bound: `lib` deliberately omits DOM so that the checked modules
// stay DOM-free, and adding globals here would quietly undo that.

/** js/calc.js — shift an ISO date by whole days, tz-safely. */
declare function addDaysISO(iso: string, n: number | string): string;
