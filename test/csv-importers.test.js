// CSV importer row-building (Fix 16 / Feature 23).
//
// The bug these guard against: importIPPT pushed rows into STATE and called
// saveLocal(), but NEVER autoSync — so imported rows lived only in localStorage
// and were destroyed by the next full pull. The rows rendered, which is exactly
// why it read as working. We test the pure row-builders (ipptUpsertRows /
// socUpsertRows) rather than the PapaParse callbacks, so no DOM or file input is
// needed; the "did it actually sync" half gets its own suite at the bottom.
//
// forms.js is a browser-global bundle whose collaborators live in other files, so
// it loads into a Proxy-global vm context — same trick as log-conduct-wizard.
// helpers.js is loaded for REAL rather than stubbed, because the exact semantics
// of col/colNum are load-bearing here: colNum is `+(col(...)) || 0`, so a blank
// Attempt cell arrives as the number 0, not "". A hand-written stub that returned
// "" would make these tests pass against behaviour production doesn't have.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { suite, test, eq, ok } = require("./_tap");

function loadCtx(roster, existingIppt, existingSoc) {
  const target = {
    console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map,
    RegExp, isNaN, parseInt, parseFloat, Symbol
  };
  const ctx = vm.createContext(new Proxy(target, { has: () => true, get: (t, k) => t[k] }));
  const load = f => vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f });
  load("helpers.js");   // real col / colNum / checkCols / nextId
  load("forms.js");
  // padD4 lives in state.js, which we can't load here (localStorage side effects
  // at import time). Mirrored verbatim from js/state.js instead.
  target.padD4 = d4 => {
    const s = String(d4 == null ? "" : d4).trim().replace(/^C/i, "");
    return /^\d{1,3}$/.test(s) ? s.padStart(4, "0") : s;
  };
  target.calculateIPPTScore = () => ({ total: 77 });
  target.ageGroupForIPPT = () => 1;
  target.IPPT_AGE_LABELS = ["<22"];
  target.STATE = { roster: roster || [], ippt: existingIppt || [], soc: existingSoc || [] };
  return { ctx, target };
}

module.exports = async function run() {
  suite("csv import: IPPT row building");

  await test("a new 4D+attempt pair produces a fresh record with a padded 4D", () => {
    const { ctx } = loadCtx([{ id: "0123", age: 20 }], []);
    const out = vm.runInContext(`ipptUpsertRows([
      { "4D": "123", Attempt: "1", Date: "01 Jan 2026", "Push-ups": "40", "Sit-ups": "42", "2.4km": "10:30", Score: "80" }
    ])`, ctx);
    eq(out.records.length, 1);
    eq(out.records[0].d4, "0123", "4D canonicalized via padD4 so the roster join works");
    eq(out.records[0].score, 80, "numeric, matching what submitIPPT stores");
  });

  await test("re-importing the same 4D+attempt REUSES the existing id (upsert, not duplicate)", () => {
    const { ctx } = loadCtx(
      [{ id: "0123", age: 20 }],
      [{ id: "OLD1", d4: "0123", attempt: 1, date: "01 Jan 2026", pushups: 1, situps: 1, runTime: "14:00", score: 10 }]
    );
    const out = vm.runInContext(`ipptUpsertRows([
      { "4D": "0123", Attempt: "1", Date: "02 Feb 2026", "Push-ups": "40", "Sit-ups": "42", "2.4km": "10:30", Score: "80" }
    ])`, ctx);
    eq(out.records.length, 1);
    eq(out.records[0].id, "OLD1", "existing id preserved");
    eq(out.records[0].score, 80, "other fields overwritten");
  });

  await test("a blank attempt appends rather than colliding with another blank", () => {
    const { ctx } = loadCtx(
      [{ id: "0123", age: 20 }],
      [{ id: "OLD1", d4: "0123", attempt: 0, date: "01 Jan 2026", score: 10 }]
    );
    const out = vm.runInContext(`ipptUpsertRows([
      { "4D": "0123", Attempt: "", Date: "02 Feb 2026", "Push-ups": "40", "Sit-ups": "42", "2.4km": "10:30", Score: "80" }
    ])`, ctx);
    ok(out.records[0].id !== "OLD1", "a blank attempt is not a usable upsert key");
  });

  await test("a blank score is auto-derived from stations + roster age", () => {
    const { ctx } = loadCtx([{ id: "0123", age: 20 }], []);
    const out = vm.runInContext(`ipptUpsertRows([
      { "4D": "0123", Attempt: "1", Date: "01 Jan 2026", "Push-ups": "40", "Sit-ups": "42", "2.4km": "10:30", Score: "" }
    ])`, ctx);
    eq(out.records[0].score, 77, "auto-scored via calculateIPPTScore");
    eq(out.autoScored, 1);
  });

  await test("a literal 0 score is kept verbatim, not treated as blank", () => {
    const { ctx } = loadCtx([{ id: "0123", age: 20 }], []);
    const out = vm.runInContext(`ipptUpsertRows([
      { "4D": "0123", Attempt: "1", Date: "01 Jan 2026", "Push-ups": "0", "Sit-ups": "0", "2.4km": "", Score: "0" }
    ])`, ctx);
    eq(out.records[0].score, 0, "0 is a real YTT/Fail score");
    eq(out.autoScored, 0);
  });

  await test("a non-numeric placeholder score with no roster age is reported as uncalculated", () => {
    const { ctx } = loadCtx([{ id: "0123" }], []);   // no age
    const out = vm.runInContext(`ipptUpsertRows([
      { "4D": "0123", Attempt: "1", Date: "01 Jan 2026", "Push-ups": "40", "Sit-ups": "42", "2.4km": "10:30", Score: "N/A" }
    ])`, ctx);
    eq(out.records[0].score, "");
    eq(out.uncalculated.length, 1);
    eq(out.uncalculated[0], "0123");
  });

  suite("csv import: SOC row building");

  await test("MM:SS time is stored in the same shape the manual form produces", () => {
    const { ctx } = loadCtx([{ id: "0123" }], [], []);
    const out = vm.runInContext(`socUpsertRows([
      { "4D": "0123", SOC: "1", Date: "01 Jan 2026", Time: "12:45", "Avg HR": "165", Pass: "Y" }
    ])`, ctx);
    eq(out.records.length, 1);
    eq(out.records[0].time, "12:45", "MM:SS preserved verbatim");
    eq(out.records[0].socNum, 1);
    eq(out.records[0].avgHr, 165);
    eq(out.records[0].pass, "Y");
  });

  await test("re-importing the same 4D+socNum reuses the existing id", () => {
    const { ctx } = loadCtx(
      [{ id: "0123" }], [],
      [{ id: "OLDS", d4: "0123", socNum: 1, date: "01 Jan 2026", time: "20:00", avgHr: 100, pass: "N" }]
    );
    const out = vm.runInContext(`socUpsertRows([
      { "4D": "0123", SOC: "1", Date: "02 Feb 2026", Time: "12:45", "Avg HR": "165", Pass: "Y" }
    ])`, ctx);
    eq(out.records.length, 1);
    eq(out.records[0].id, "OLDS");
    eq(out.records[0].time, "12:45");
  });

  await test("4D is canonicalized and an unknown 4D is reported, not silently dropped", () => {
    const { ctx } = loadCtx([{ id: "0123" }], [], []);
    const out = vm.runInContext(`socUpsertRows([
      { "4D": "123",  SOC: "1", Date: "01 Jan 2026", Time: "12:45", "Avg HR": "165", Pass: "Y" },
      { "4D": "9999", SOC: "1", Date: "01 Jan 2026", Time: "13:00", "Avg HR": "160", Pass: "Y" }
    ])`, ctx);
    eq(out.records[0].d4, "0123");
    eq(out.records.length, 2, "the unknown 4D is still imported, just flagged");
    eq(out.unmatched.length, 1);
    eq(out.unmatched[0], "9999");
  });

  await test("Pass defaults to Y when the column is absent", () => {
    const { ctx } = loadCtx([{ id: "0123" }], [], []);
    const out = vm.runInContext(`socUpsertRows([
      { "4D": "0123", SOC: "1", Date: "01 Jan 2026", Time: "12:45", "Avg HR": "165" }
    ])`, ctx);
    eq(out.records[0].pass, "Y");
  });

  suite("csv import: the sync call itself (Fix 16 regression guard)");

  // This is the suite that actually pins the bug. The row-builders above prove
  // the RECORDS are right; without these, an importer could build perfect rows
  // and still never write them to the sheet — which is precisely what shipped.
  function stubImportEnv(target, rows, fields) {
    const synced = [];
    target.autoSync = (tab, op) => synced.push([tab, op.type, op.row.d4]);
    target.saveLocal = () => {};
    target.render = () => {};
    target.alert = () => {};
    target.STATE.apiUrl = "https://example.test/exec";
    target.Papa = { parse: (_f, opts) => opts.complete({ meta: { fields }, data: rows }) };
    return synced;
  }

  await test("importIPPT pushes every built record through autoSync", () => {
    const { ctx, target } = loadCtx([{ id: "0123", age: 20 }, { id: "0124", age: 20 }], []);
    const synced = stubImportEnv(target, [
      { "4D": "0123", Attempt: "1", Date: "01 Jan 2026", "Push-ups": "40", "Sit-ups": "42", "2.4km": "10:30", Score: "80" },
      { "4D": "0124", Attempt: "1", Date: "01 Jan 2026", "Push-ups": "41", "Sit-ups": "43", "2.4km": "10:20", Score: "82" }
    ], ["4D", "Attempt", "Date", "Push-ups", "Sit-ups", "2.4km", "Score"]);
    vm.runInContext(`importIPPT({ files: [{}], value: "x" })`, ctx);
    eq(synced.length, 2, "one autoSync per imported row — the bug was zero");
    eq(synced[0][0], "IPPT");
    eq(synced[0][1], "upsert");
    eq(target.STATE.ippt.length, 2, "and they land in STATE too");
  });

  await test("importIPPT replaces the matched row in STATE instead of appending a duplicate", () => {
    const { ctx, target } = loadCtx(
      [{ id: "0123", age: 20 }],
      [{ id: "OLD1", d4: "0123", attempt: 1, date: "01 Jan 2026", pushups: 1, situps: 1, runTime: "14:00", score: 10 }]
    );
    stubImportEnv(target, [
      { "4D": "0123", Attempt: "1", Date: "02 Feb 2026", "Push-ups": "40", "Sit-ups": "42", "2.4km": "10:30", Score: "80" }
    ], ["4D", "Attempt", "Date", "Push-ups", "Sit-ups", "2.4km", "Score"]);
    vm.runInContext(`importIPPT({ files: [{}], value: "x" })`, ctx);
    eq(target.STATE.ippt.length, 1, "re-import updates in place, no duplicate history");
    eq(target.STATE.ippt[0].score, 80);
  });

  await test("importSOC pushes every built record through autoSync", () => {
    const { ctx, target } = loadCtx([{ id: "0123" }], [], []);
    const synced = stubImportEnv(target, [
      { "4D": "0123", SOC: "1", Date: "01 Jan 2026", Time: "12:45", "Avg HR": "165", Pass: "Y" }
    ], ["4D", "SOC", "Date", "Time", "Avg HR", "Pass"]);
    vm.runInContext(`importSOC({ files: [{}], value: "x" })`, ctx);
    eq(synced.length, 1);
    eq(synced[0][0], "SOC");
    eq(synced[0][1], "upsert");
    eq(target.STATE.soc.length, 1);
  });
};
