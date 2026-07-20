// Deterministic synthetic-company fixture for tools/bench/sync-bench.js.
//
// SYNC_PERF_IMPROVEMENTS_SPEC.md §2's cost model says request COUNT and
// PAYLOAD SIZE dominate — both scale with company size — so the bench needs a
// realistically-sized dataset, not a handful of rows. ~119 people mirrors the
// synthetic sandbox company used elsewhere in this repo (CLAUDE.md's
// sandbox-testing skill), with Medical/Attendance/ConductDetail/IPPT scaled
// proportionally (a real company accumulates several sick-parade events and
// two IPPT attempts per person over a training cycle, and a conduct roughly
// once every couple of days over several months).
//
// Deterministic: a fixed-seed PRNG (mulberry32), never Math.random(), so two
// bench runs against the same tree produce byte-identical payloads and the
// before/after comparison isn't muddied by run-to-run noise.

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 40197;   // arbitrary, fixed — "40 SAR" nod, not load-bearing
const PEOPLE = 119;
const PLATOONS = 4;
const SECTIONS_PER_PLATOON = 3;

const ROSTER_HEADERS = [
  "id", "name", "age", "status", "notes", "phone", "email", "ration",
  "allergies", "msk", "highest education level", "motorcycle license",
  "height", "weight", "role", "rank", "leaveQuota", "platoon", "section",
  "rankGroup", "fourD"
];
const MEDICAL_HEADERS = [
  "id", "d4", "date", "reason", "location", "status", "startDate", "endDate",
  "type", "urtiType", "mrTiming", "visitId", "origin", "bookInDate"
];
const ATTENDANCE_HEADERS = [
  "id", "date", "time", "conductId", "total", "participating", "lms", "px",
  "fallout", "remarks", "participants", "periods", "currencyTags", "source",
  "statusReviewed"
];
const CONDUCT_DETAIL_HEADERS = ["id", "date", "time", "conductId", "d4", "type", "reason"];
const IPPT_HEADERS = ["id", "d4", "attempt", "date", "pushups", "situps", "runTime", "score"];

const MEDICAL_STATUSES = ["MC", "LD", "Excuse Heavy Load", "Pending", "NIL"];
const CONDUCT_REASONS = ["MC", "LD", "Leave", "Off", "Excuse Heavy Load"];

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function pad2(n) { return String(n).padStart(2, "0"); }

// 4D allocation: first 4 are commanders (00xx pattern the app auto-detects),
// the rest spread round-robin across PLATOONS x SECTIONS_PER_PLATOON so a
// filtered/scoped view (platoon/section render paths) has realistic spread
// rather than one giant platoon.
function buildD4List(count) {
  const out = [];
  for (let i = 1; i <= 4 && out.length < count; i++) out.push("00" + pad2(i));
  let plt = 1, sect = 1, num = 1;
  while (out.length < count) {
    out.push(String(plt) + String(sect) + pad2(num));
    num++;
    if (num > 9) { num = 1; sect++; if (sect > SECTIONS_PER_PLATOON) { sect = 1; plt++; if (plt > PLATOONS) plt = 1; } }
  }
  return out.slice(0, count);
}

// Builds the full seed set: { roster, medical, attendance, conductDetail, ippt }
// each { headers, rows } ready for backend.db.seed(tab, headers, rows) — rows
// are arrays-of-values in header order, matching every existing test's seed
// shape (test/sync.test.js, test/readtabs-batch.test.js, …).
function buildFixture() {
  const rng = mulberry32(SEED);
  const d4s = buildD4List(PEOPLE);

  const roster = { headers: ROSTER_HEADERS, rows: [] };
  d4s.forEach((d4, i) => {
    const isCmdr = /^00\d{2}$/.test(d4);
    const plt = isCmdr ? "HQ" : "PLT" + d4[0];
    const sect = isCmdr ? "Command" : d4[1];
    roster.rows.push([
      d4, (isCmdr ? "Cmdr " : "Recruit ") + (i + 1), 19 + Math.floor(rng() * 15),
      "Active", "", "9" + String(10000000 + Math.floor(rng() * 89999999)).slice(0, 7),
      `p${i + 1}@example.test`, pick(rng, ["Normal", "Vegetarian", "Halal"]), "",
      "", pick(rng, ["N", "O", "A"]), pick(rng, ["Y", "N"]),
      160 + Math.floor(rng() * 30), 55 + Math.floor(rng() * 30),
      isCmdr ? "Commander" : "Recruit", isCmdr ? pick(rng, ["3SG", "2LT", "CPT"]) : "",
      isCmdr ? 14 : "", plt, sect, isCmdr ? "WOSPEC" : "Enlistee", isCmdr ? "" : d4
    ]);
  });

  // ~2 historical report-sick events per person (a training cycle's worth).
  const medical = { headers: MEDICAL_HEADERS, rows: [] };
  let medId = 1;
  d4s.forEach(d4 => {
    const n = 1 + Math.floor(rng() * 3);   // 1-3 events/person, averages ~2
    for (let k = 0; k < n; k++) {
      const day = 1 + Math.floor(rng() * 28);
      const status = pick(rng, MEDICAL_STATUSES);
      medical.rows.push([
        String(medId++), d4, pad2(day) + " Jan 2026", "Fever", "", status,
        pad2(day) + " Jan 2026", pad2(Math.min(28, day + 2)) + " Jan 2026",
        pick(rng, ["RSI", "RSO", "MR"]), pick(rng, ["URTI", "NON-URTI"]), "", "",
        "manual", ""
      ]);
    }
  });

  // ~60 conducts over the cycle (roughly one every couple of days).
  const CONDUCT_COUNT = 60;
  const attendance = { headers: ATTENDANCE_HEADERS, rows: [] };
  const conductDetail = { headers: CONDUCT_DETAIL_HEADERS, rows: [] };
  let cdId = 1;
  for (let c = 1; c <= CONDUCT_COUNT; c++) {
    const day = 1 + (c % 28);
    const date = pad2(day) + " Feb 2026";
    const conductId = "c" + c;
    const absentees = 3 + Math.floor(rng() * 6);   // ~3-8 absentees/conduct
    const present = PEOPLE - absentees;
    attendance.rows.push([
      String(c), date, "0730", conductId, PEOPLE, present,
      Math.floor(present * 0.9), absentees, 0, "",
      d4s.slice(0, present).join(","), 1, "HA", "wizard", "TRUE"
    ]);
    for (let a = 0; a < absentees; a++) {
      const d4 = d4s[PEOPLE - 1 - a];
      conductDetail.rows.push([String(cdId++), date, "0730", conductId, d4, "Status", pick(rng, CONDUCT_REASONS)]);
    }
  }

  // 2 IPPT attempts per person.
  const ippt = { headers: IPPT_HEADERS, rows: [] };
  let ipptId = 1;
  d4s.forEach(d4 => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      ippt.rows.push([
        String(ipptId++), d4, attempt, "15 Mar 2026",
        30 + Math.floor(rng() * 30), 30 + Math.floor(rng() * 30),
        "9:" + pad2(30 + Math.floor(rng() * 29)), 50 + Math.floor(rng() * 50)
      ]);
    }
  });

  return { roster, medical, attendance, conductDetail, ippt, d4s };
}

// Seeds every tab a scenario cares about onto a fresh backend (db.seed per
// tab). Other readAllTabs tabs (RouteMarch/SOC/PolarFlow/Leave/MSK/
// Appointments/Conducts/VocFit/Platoons/Config) are left unseeded — readTab
// returns [] for a sheet that doesn't exist (apps-script-Code.gs readAllTabs),
// so omitting them is realistic ("not every tab is in heavy use") rather than
// a shortcut that changes the measured shape of the heavily-used tabs.
function seedBackend(backend, fixture) {
  backend.db.seed("Roster", fixture.roster.headers, fixture.roster.rows);
  backend.db.seed("Medical", fixture.medical.headers, fixture.medical.rows);
  backend.db.seed("Attendance", fixture.attendance.headers, fixture.attendance.rows);
  backend.db.seed("ConductDetail", fixture.conductDetail.headers, fixture.conductDetail.rows);
  backend.db.seed("IPPT", fixture.ippt.headers, fixture.ippt.rows);
}

// Builds `n` fresh ConductDetail row OBJECTS (not the array-of-values seed
// shape above) for a replaceConduct autoSync call — mirrors the shape
// js/forms.js's saveLogConductWizard builds (test/sync.test.js's 30-row
// contiguous-match case uses the identical field set).
function buildWizardConductRows(n, conductId, date) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({
      id: "wiz" + i, date, time: "0730", conductId,
      d4: "11" + pad2(i), type: "Status", reason: "MC"
    });
  }
  return rows;
}

module.exports = {
  SEED, PEOPLE, buildFixture, seedBackend, buildWizardConductRows,
  ROSTER_HEADERS, MEDICAL_HEADERS, ATTENDANCE_HEADERS, CONDUCT_DETAIL_HEADERS, IPPT_HEADERS
};
