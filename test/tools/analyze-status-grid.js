// Standalone Status-Grid analyzer — reproduces exactly what the Status Board
// grid computes for a given day, from a full-backup JSON export, using the REAL
// frontend normalizers (state.js) and classifier (helpers.js + braves-parade.js).
//
// USAGE:
//   node test/tools/analyze-status-grid.js path/to/backup.json [YYYY-MM-DD]
//
// The backup is the "Full Backup (JSON)" export (Sync tab). Only roster +
// medical + leave + appointments are needed for the grid; names/reasons may be
// redacted before sharing — the grid logic doesn't depend on them.
//
// It prints, per person (ordered as the grid orders them):
//   4D  plt=… sect=…  status(roster mirror)  meds/leave counts  todayCell  primary
// and a FLAGS section listing anomalies:
//   • ORDER   — platoon/section that won't sort into a clean group
//   • STALE   — MC/status shown today only because roster.status mirror is stale
//               (ended-MC persistence) — i.e. no medical row is actually active
//   • LONGDUR — a status whose computed duration is implausibly long (>21 days),
//               usually a blank startDate falling back to an old `date`

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");

const backupPath = process.argv[2];
const TODAY = process.argv[3] || new Date().toISOString().slice(0, 10);
if (!backupPath) { console.error("usage: node analyze-status-grid.js <backup.json> [YYYY-MM-DD]"); process.exit(1); }
const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));

// ── Load real frontend logic into one sandbox ────────────────────────────────
const sb = {
  console, JSON, Math, Date, String, Number, Array, Object, Boolean, Set, Map, RegExp,
  isNaN, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  window: {}, document: { getElementById: () => null },
};
vm.createContext(sb);
const src = ["js/state.js", "js/helpers.js", "js/braves-parade.js"]
  .map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n")
  + `\n;this.normalizeRoster=normalizeRoster; this.normalizeMedical=normalizeMedical;
     this.STATE=STATE; this.bpBuildIndex=bpBuildIndex; this.bpGridCell=bpGridCell;
     this.bpPrimaryForDay=bpPrimaryForDay; this.personPlatoon=personPlatoon;
     this.personSection=personSection; this.medStatusActive=medStatusActive;
     this.displayDateToISO=displayDateToISO; this.bpInclusiveDays=bpInclusiveDays;`;
vm.runInContext(src, sb, { filename: "frontend" });

const roster = sb.normalizeRoster(backup.roster || []);
const medical = sb.normalizeMedical(backup.medical || []);
sb.STATE.roster = roster;
sb.STATE.medical = medical;
sb.STATE.leave = backup.leave || [];
sb.STATE.appointments = backup.appointments || [];
// pad d4 on leave/appointments the way loadLocal/pullAll would
["leave", "appointments"].forEach(k => {
  sb.STATE[k] = (sb.STATE[k] || []).map(r => r && r.d4 != null ? { ...r, d4: String(r.d4).replace(/^C/i, "").replace(/^(\d{1,3})$/, m => m.padStart(4, "0")) } : r);
});

const { personPlatoon, personSection } = sb;
function sbOrdered(rows) {
  const plRank = c => c === "HQ" ? 9999 : (parseInt(String(c).replace(/\D/g, ""), 10) || 9000);
  const secRank = s => s === "Command" ? -1 : (parseInt(s, 10) || 9000);
  return [...rows].sort((a, b) => {
    const pa = plRank(personPlatoon(a)), pb = plRank(personPlatoon(b));
    if (pa !== pb) return pa - pb;
    const sa = secRank(personSection(a)), sb2 = secRank(personSection(b));
    if (sa !== sb2) return sa - sb2;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }).map(r => ({ r, group: `${personPlatoon(r) || "—"}${personSection(r) ? " · " + (personSection(r) === "Command" ? "Command" : "Sect " + personSection(r)) : ""}` }));
}

const idx = sb.bpBuildIndex();
const ordered = sbOrdered(roster);

const flags = { order: [], stale: [], longdur: [] };
let lastGroup = null;
console.log(`\n=== Status Grid @ ${TODAY} — ${roster.length} people ===`);
ordered.forEach(({ r, group }) => {
  if (group !== lastGroup) { console.log(`\n-- ${group} --`); lastGroup = group; }
  const plt = personPlatoon(r), sect = personSection(r);
  const cell = sb.bpGridCell(r, TODAY, idx);
  const p = sb.bpPrimaryForDay(r, TODAY, idx);
  const meds = idx.medical[r.id] || [];
  const activeMeds = meds.filter(m => sb.medStatusActive(m, TODAY));
  const status = p.primary ? `${p.primary.label}:${p.primary.type}` : "present";
  console.log(`${String(r.id).padEnd(6)} plt=${String(plt).padEnd(6)} sect=${String(sect).padEnd(8)} rosterStatus=${String(r.status||"").padEnd(14)} meds=${meds.length} active=${activeMeds.length} cell=${cell.primary||"-"} ${status}`);

  // FLAGS
  const plClean = plt === "HQ" || /^PLT\d+$/.test(plt) || plt === "";
  const secClean = sect === "" || sect === "Command" || /^\d+$/.test(sect);
  if (!plClean || !secClean) flags.order.push(`${r.id}: plt="${plt}" sect="${sect}"`);
  // Stale roster.status mirror: reads "MC" while no MC medical row is active
  // today. Keyed off the mirror + active meds, NOT cell.primary — PR #57's grid
  // stops colouring the persisted MC+1/MC+2 tail (cell.primary goes null there),
  // so a cell-colour check would miss exactly the stale-mirror people this flag
  // exists to surface. Note whether parade still parks them under ATT C (inside
  // the MC+1/MC+2 persist window) or they've auto-hidden with the mirror uncleared.
  if (String(r.status || "").trim() === "MC" && !activeMeds.some(m => m.status === "MC")) {
    const parked = p.primary && p.primary.key === "attC";
    flags.stale.push(`${r.id}: roster.status="MC" but no MC active today` +
      (parked ? " (parked under ATT C — MC+1/MC+2 persist window)" : " (auto-hidden; mirror never cleared)"));
  }
  meds.forEach(m => {
    if (!sb.medStatusActive(m, TODAY)) return;
    const d = sb.bpInclusiveDays(m);
    if (d && d > 21) flags.longdur.push(`${r.id}: ${m.status} = ${d}D (start=${m.startDate||"(blank→"+m.date+")"} end=${m.endDate})`);
  });
});

console.log(`\n\n===== FLAGS =====`);
console.log(`\nORDER anomalies (won't group cleanly) — ${flags.order.length}:`);
flags.order.forEach(x => console.log("  " + x));
console.log(`\nSTALE roster.status="MC" mirror (no active MC row today) — ${flags.stale.length}:`);
flags.stale.slice(0, 40).forEach(x => console.log("  " + x));
console.log(`\nLONG durations (>21D, likely blank startDate) — ${flags.longdur.length}:`);
flags.longdur.slice(0, 40).forEach(x => console.log("  " + x));
