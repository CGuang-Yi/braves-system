/**
 * ─────────────────────────────────────────────────────────────────────────────
 * seed-synthetic.gs — SANDBOX SYNTHETIC DATA SEEDER (not part of production)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Paste this file into the SAME Apps Script project as apps-script-Code.gs on a
 * *separate, throwaway* Google Sheet (never the live company sheet). It fills a
 * fresh sheet with a realistic-but-entirely-fake company so the app can be driven
 * against synthetic data with no risk to real personnel information.
 *
 * The data is 100% invented (deterministic PRNG — same output every run). Names,
 * 4Ds, medical events, etc. are made up. Nothing here mirrors real people.
 *
 * ── HOW TO ADD THIS FILE ────────────────────────────────────────────────────
 * This is a SEPARATE file from apps-script-Code.gs. In the Apps Script editor,
 * all .gs files in a project share one global namespace, so you can either:
 *   (a) click the "+" next to Files → Script → name it "seed-synthetic" → paste
 *       THIS file's contents (cleanest), OR
 *   (b) paste THIS file's contents at the very BOTTOM of Code.gs, below the
 *       backend. Do NOT replace the backend's contents with this file — they are
 *       different code that must both be present.
 *
 * ── HOW TO RUN (from the Apps Script editor, once) ──────────────────────────
 *   1. Create a new blank Google Sheet → Extensions → Apps Script.
 *   2. Add apps-script-Code.gs (the real backend) AND this file (see above).
 *   3. Run:  seedFirstAdmin("you@example.com", "your-admin-password")
 *   4. Run:  seedSynthetic()
 *        → creates/repairs all reference tabs, wipes+fills every data tab with
 *          synthetic rows, and creates two throwaway accounts (see below).
 *   5. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone) →
 *      copy the Web App URL.
 *   6. Log in to the web app with one of the accounts below. Delete the accounts
 *      (admin panel) when you're done to revoke access.
 *
 * Re-running seedSynthetic() is safe: it deletes and rewrites only the data tabs
 * it owns. It never touches Accounts (beyond adding the sandbox logins if
 * absent), AuditLog, the bot's Config tab, ParadeArchive, or SickArchive.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Credentials for the auto-created sandbox accounts. Re-running seedSynthetic()
// only creates each account if its email is absent (createAccount is a no-op
// otherwise), so editing a password here means deleting that account first.
//   • viewer    — read-only. Safe token for inspection/repro.
//   • commander — read + write. Use this token when you want to exercise the
//                 write/sync engine end-to-end against the fake data. Not admin,
//                 so it can't manage accounts/tokens. Re-run to restore data.
// Both live on a throwaway sheet with invented data, so handing out the commander
// token is low-risk — worst case a bad write mangles synthetic rows you can reset.
var SANDBOX_VIEWER_EMAIL = "viewer@sandbox.local";
var SANDBOX_VIEWER_PASSWORD = "sandbox-viewer-2026";
var SANDBOX_CMDR_EMAIL = "commander@sandbox.local";
var SANDBOX_CMDR_PASSWORD = "sandbox-cmdr-2026";

// Anchor date for all generated dates. Chosen as "today" at authoring time so
// current MC/LD windows are live and a couple of just-ended ones exercise the
// client-side MC+1/MC+2/LD+1/LD+2 ghost tags. Freshness of "current" status
// naturally depends on when you view it relative to this anchor.
var SEED_TODAY = new Date(2026, 6, 14); // 14 Jul 2026 (month is 0-indexed)

// ── Deterministic PRNG (LCG) ────────────────────────────────────────────────
// A fixed seed keeps the dataset identical across runs, so the sandbox is stable
// and reproducible (and re-running never reshuffles who is on MC, etc.).
function makeRng_(seed) {
  var s = seed >>> 0;
  return function () {
    // Numerical Recipes LCG constants.
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function pick_(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function randint_(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

// ── Date helpers ────────────────────────────────────────────────────────────
var MONTHS_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function addDays_(base, n) {
  var d = new Date(base.getTime());
  d.setDate(d.getDate() + n);
  return d;
}
// Display format the whole app uses: "8 Jun 2026" (no leading zero on day).
function fmtDate_(d) {
  return d.getDate() + " " + MONTHS_[d.getMonth()] + " " + d.getFullYear();
}
function dayOffset_(n) { return fmtDate_(addDays_(SEED_TODAY, n)); }

// ── Name pools (invented) ───────────────────────────────────────────────────
var FIRST_ = ["Wei Ming", "Jun Hao", "Zhi Hao", "Yong Sheng", "Kai X Ler",
  "Ryan", "Marcus", "Daniel", "Isaac", "Nathaniel", "Aloysius", "Bryan",
  "Farhan", "Iskandar", "Haziq", "Rizwan", "Arjun", "Karthik", "Praveen",
  "Aaron", "Ethan", "Javier", "Timothy", "Gabriel", "Shawn", "Darius",
  "Wen Jie", "Jing Yang", "Cheng Han", "Boon Keng", "Muhammad", "Amirul",
  "Vignesh", "Dinesh", "Sanjay", "Joel", "Caleb", "Lucas", "Nicholas", "Xavier"];
var LAST_ = ["Tan", "Lim", "Lee", "Ng", "Wong", "Goh", "Chua", "Koh", "Ong",
  "Teo", "Sim", "Yeo", "Ho", "Low", "Toh", "Ang", "Chan", "Foo", "Heng",
  "bin Rahman", "bin Hassan", "s/o Kumar", "s/o Raju", "Kaur", "Singh"];

// ═════════════════════════════════════════════════════════════════════════════
// DATA BUILDERS  — each returns { headers:[...], rows:[{...}] } in SHEET schema.
// ═════════════════════════════════════════════════════════════════════════════

// Company shape: 4 platoons × 3 sections × ~9 recruits = ~108 recruits, plus a
// small commander cadre in HQ + one PC/PS per platoon.
var PLATOONS_ = ["PLT1", "PLT2", "PLT3", "PLT4"];
var SECTIONS_ = [1, 2, 3];
var PER_SECTION_ = 9;

// Returns the full roster of person records used by every other builder.
// Each: {id, fourD, name, rank, role, rankGroup, platoon, section, plt, sect}
function buildPeople_(rng) {
  var people = [];

  // Commanders (4D 00xx). role "Commander"; shown by rank+name, not 4D.
  people.push(cmdr_("0001", "OC", "MAJ", "Officer", "HQ", "Command"));
  people.push(cmdr_("0002", "2IC", "CPT", "Officer", "HQ", "Command"));
  people.push(cmdr_("0003", "CSM", "MSG", "WOSPEC", "HQ", "Command"));
  for (var p = 0; p < PLATOONS_.length; p++) {
    var plt = PLATOONS_[p];
    people.push(cmdr_("00" + (11 + p * 10), "PC" + (p + 1), "LTA", "Officer", plt, "Command"));
    people.push(cmdr_("00" + (12 + p * 10), "PS" + (p + 1), "3SG", "WOSPEC", plt, "Command"));
  }

  // Recruits (4D = platoon digit + section digit + running 2-digit index).
  for (var pi = 0; pi < PLATOONS_.length; pi++) {
    for (var si = 0; si < SECTIONS_.length; si++) {
      for (var k = 1; k <= PER_SECTION_; k++) {
        var pnum = pi + 1, snum = SECTIONS_[si];
        var fourD = "" + pnum + snum + ("0" + k).slice(-2); // e.g. 1101, 2309
        people.push({
          id: fourD, fourD: fourD,
          name: pick_(rng, FIRST_) + " " + pick_(rng, LAST_),
          rank: "REC", role: "Recruit", rankGroup: "Enlistee",
          platoon: PLATOONS_[pi], section: String(snum),
          plt: PLATOONS_[pi], sect: snum
        });
      }
    }
  }
  return people;
}
function cmdr_(id, name, rank, rankGroup, platoon, section) {
  return {
    id: id, fourD: "", name: name, rank: rank, role: "Commander",
    rankGroup: rankGroup, platoon: platoon, section: section,
    plt: platoon, sect: section
  };
}

function buildRoster_(people, rng) {
  var headers = ["4d", "name", "age", "status", "notes", "phone", "email",
    "ration", "allergies", "msk", "highest education level",
    "motorcycle license", "height", "weight", "role", "rank",
    "leaveQuota", "platoon", "section", "rankGroup", "fourD"];
  var EDU = ["ITE", "Poly Diploma", "A Levels", "Degree", "O Levels"];
  var RATION = ["", "", "", "No Pork No Lard", "Vegetarian"];
  var rows = people.map(function (pp) {
    var isCmd = pp.role === "Commander";
    return {
      "4d": pp.id,
      name: pp.name,
      age: isCmd ? randint_(rng, 24, 38) : randint_(rng, 18, 22),
      status: "Active",
      notes: "",
      phone: "9" + randint_(rng, 1000000, 9999999),
      email: "",
      ration: pick_(rng, RATION),
      allergies: rng() < 0.08 ? pick_(rng, ["Penicillin", "Seafood", "Nuts"]) : "",
      msk: "",
      "highest education level": pick_(rng, EDU),
      "motorcycle license": rng() < 0.15 ? "Class 2B" : "",
      height: randint_(rng, 160, 185),
      weight: randint_(rng, 52, 88),
      role: pp.role,
      rank: pp.rank,
      leaveQuota: isCmd ? randint_(rng, 10, 18) : "",
      platoon: pp.platoon,
      section: pp.section,
      rankGroup: pp.rankGroup,
      fourD: pp.fourD
    };
  });
  return { headers: headers, rows: rows };
}

// Medical: a spread of MC / LD / Warded / Excuse / Pending / NIL, some ended
// (endDate a day or two before SEED_TODAY → ghost tags), some current, some
// open-ended Pending. Only recruits report sick here.
function buildMedical_(people, rng) {
  var headers = ["id", "d4", "date", "reason", "location", "status",
    "startDate", "endDate", "type", "urtiType", "mrTiming", "visitId", "origin"];
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var reasons = ["fever, cough", "sore throat", "gastric pain", "ankle sprain",
    "knee pain", "lower back pain", "diarrhoea", "headache, giddiness",
    "shoulder strain", "blisters"];
  var rows = [];
  var n = 0;
  // ~18 medical events across distinct recruits.
  var picks = shuffle_(recruits.slice(), rng).slice(0, 18);
  picks.forEach(function (r, i) {
    n++;
    var kind = i % 6; // rotate through the status archetypes
    var startOff, endOff, status, type, urti = "", loc = "";
    if (kind === 0) {            // current MC
      startOff = -1; endOff = 2; status = "MC"; type = "RSO"; urti = "URTI"; loc = "PTMC";
    } else if (kind === 1) {     // just-ended MC → ghost MC+1/MC+2
      startOff = -4; endOff = -2; status = "MC"; type = "RSI"; urti = "URTI";
    } else if (kind === 2) {     // current LD (light duty)
      startOff = -2; endOff = 4; status = "LD"; type = "RSI";
    } else if (kind === 3) {     // Excuse (partial)
      startOff = -1; endOff = 6; status = pick_(rng, ["Excuse RMJ", "Excuse Lower Limb", "Excuse Heavy Load"]); type = "RSI";
    } else if (kind === 4) {     // Warded (out of camp)
      startOff = -1; endOff = 3; status = "Warded"; type = "RSO"; loc = "Changi General Hospital";
    } else {                     // Pending (reported, awaiting MO)
      startOff = 0; endOff = null; status = "Pending"; type = "RSI";
    }
    rows.push({
      id: "MED" + n, d4: r.fourD, date: dayOffset_(startOff),
      reason: pick_(rng, reasons), location: loc, status: status,
      startDate: dayOffset_(startOff),
      endDate: endOff === null ? "" : dayOffset_(endOff),
      type: type, urtiType: urti, mrTiming: "", visitId: "V" + n, origin: "manual"
    });
  });
  return { headers: headers, rows: rows };
}

// Conducts registry (id | name). Referenced by conductId everywhere else.
var CONDUCTS_ = [
  { id: "c001", name: "Morning PT" },
  { id: "c002", name: "Endurance Run" },
  { id: "c003", name: "Metabolic Circuit" },
  { id: "c004", name: "Route March 8km" },
  { id: "c005", name: "SOC Familiarisation" },
  { id: "c006", name: "Strength Training" }
];
function buildConducts_() {
  return { headers: ["id", "name"], rows: CONDUCTS_.map(function (c) {
    return { id: c.id, name: c.name };
  }) };
}

// Attendance + ConductDetail together, so the aggregates line up with the
// per-recruit absentee rows (Status counts toward px). HA fields populated for
// the HA-eligible conducts (currencyTags "HA", source "csv") so computeHA has
// real input; wizard-style rows for the rest.
function buildConductData_(people, rng) {
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var attHeaders = ["id", "date", "time", "conductId", "total", "participating",
    "lms", "px", "fallout", "remarks", "participants", "periods",
    "currencyTags", "source", "statusReviewed"];
  var cdHeaders = ["id", "date", "time", "conductId", "d4", "type", "reason"];
  var att = [], cd = [];
  var atN = 0, cdN = 0;

  // 8 training days over the ~3 weeks leading up to SEED_TODAY.
  var days = [-20, -18, -15, -13, -11, -8, -6, -3];
  days.forEach(function (off, di) {
    // Each day runs 2 conducts.
    var todays = [CONDUCTS_[di % CONDUCTS_.length], CONDUCTS_[(di + 3) % CONDUCTS_.length]];
    todays.forEach(function (cdt, ci) {
      atN++;
      var haEligible = (cdt.id === "c002" || cdt.id === "c003" || cdt.id === "c004");
      // Present ~85% of recruits; the rest are absentees split across types.
      var present = [], absent = [];
      recruits.forEach(function (r) {
        if (rng() < 0.85) present.push(r); else absent.push(r);
      });
      var participants = present.map(function (r) { return r.fourD; }).join(",");
      var pxCount = 0, falloutCount = 0;
      absent.forEach(function (r) {
        var t = pick_(rng, ["Status", "Status", "RSI", "PXP", "Fallout"]);
        if (t === "Status") pxCount++;
        if (t === "Fallout") falloutCount++;
        cdN++;
        cd.push({
          id: "CD" + cdN, date: dayOffset_(off), time: ci === 0 ? "0730" : "1630",
          conductId: cdt.id, d4: r.fourD, type: t,
          reason: t === "Status" ? pick_(rng, ["MC", "LD", "Excuse RMJ", "Off"]) :
                  t === "PXP" ? "PX (stretches)" :
                  t === "RSI" ? "reported sick AM" : "dropped out"
        });
      });
      att.push({
        id: "AT" + atN, date: dayOffset_(off), time: ci === 0 ? "0730" : "1630",
        conductId: cdt.id, total: recruits.length, participating: present.length,
        lms: haEligible ? Math.round(present.length * 0.4) : 0,
        px: pxCount, fallout: falloutCount,
        remarks: cdt.name,
        participants: participants,
        periods: haEligible ? randint_(rng, 1, 2) : "",
        currencyTags: haEligible ? "HA" : "",
        source: haEligible ? "csv" : "wizard",
        statusReviewed: true
      });
    });
  });
  return {
    attendance: { headers: attHeaders, rows: att },
    conductDetail: { headers: cdHeaders, rows: cd }
  };
}

// IPPT — multi-attempt for ~40 recruits, across award bands.
function buildIppt_(people, rng) {
  var headers = ["id", "d4", "attempt", "date", "pushups", "situps", "runTime", "score"];
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var rows = [], n = 0;
  shuffle_(recruits.slice(), rng).slice(0, 40).forEach(function (r) {
    var attempts = rng() < 0.5 ? 2 : 1;
    for (var a = 1; a <= attempts; a++) {
      n++;
      var pu = randint_(rng, 20, 60), su = randint_(rng, 25, 60);
      var runSec = randint_(rng, 540, 900); // 9:00–15:00
      var mm = Math.floor(runSec / 60), ss = runSec % 60;
      var score = Math.max(0, Math.min(100,
        Math.round(pu * 0.45 + su * 0.45 + (900 - runSec) / 6)));
      rows.push({
        id: "IPPT" + n, d4: r.fourD, attempt: a,
        date: dayOffset_(-30 + a * 7),
        pushups: pu, situps: su,
        runTime: mm + ":" + ("0" + ss).slice(-2),
        score: score
      });
    }
  });
  return { headers: headers, rows: rows };
}

function buildRm_(people, rng) {
  var headers = ["id", "d4", "rmNum", "date", "time", "avgHr", "maxHr", "pass"];
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var rows = [], n = 0;
  shuffle_(recruits.slice(), rng).slice(0, 25).forEach(function (r) {
    n++;
    rows.push({
      id: "RM" + n, d4: r.fourD, rmNum: 8, date: dayOffset_(-6), time: "0500",
      avgHr: randint_(rng, 130, 160), maxHr: randint_(rng, 165, 190),
      pass: rng() < 0.9
    });
  });
  return { headers: headers, rows: rows };
}

function buildSoc_(people, rng) {
  var headers = ["id", "d4", "socNum", "date", "time", "avgHr", "pass"];
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var rows = [], n = 0;
  shuffle_(recruits.slice(), rng).slice(0, 20).forEach(function (r) {
    n++;
    var t = randint_(rng, 480, 780); // 8:00–13:00
    rows.push({
      id: "SOC" + n, d4: r.fourD, socNum: 1, date: dayOffset_(-3), time: "0800",
      avgHr: randint_(rng, 140, 170),
      pass: t < 690
    });
  });
  return { headers: headers, rows: rows };
}

// PolarFlow — HR imports tied to the HA-eligible conducts.
function buildPolar_(people, rng) {
  var headers = ["id", "d4", "conductId", "date", "avgHr", "maxHr", "minHr",
    "z1", "z2", "z3", "z4", "z5", "calories", "trainingLoad", "recovery",
    "duration", "distance"];
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var rows = [], n = 0;
  shuffle_(recruits.slice(), rng).slice(0, 15).forEach(function (r) {
    n++;
    rows.push({
      id: "PF" + n, d4: r.fourD, conductId: "c002", date: dayOffset_(-8),
      avgHr: randint_(rng, 140, 165), maxHr: randint_(rng, 175, 195),
      minHr: randint_(rng, 70, 95),
      z1: randint_(rng, 2, 6), z2: randint_(rng, 8, 15), z3: randint_(rng, 12, 20),
      z4: randint_(rng, 6, 12), z5: randint_(rng, 1, 5),
      calories: randint_(rng, 350, 700), trainingLoad: randint_(rng, 60, 180),
      recovery: randint_(rng, 12, 48),
      duration: randint_(rng, 30, 55), distance: (randint_(rng, 40, 70) / 10)
    });
  });
  return { headers: headers, rows: rows };
}

function buildAppointments_(people, rng) {
  var headers = ["id", "d4", "reason", "date", "time", "location", "outOfCamp", "resolved"];
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var reasons = ["dental review", "physio follow-up", "specialist (ortho)",
    "IPPT retake", "eye check", "medical board"];
  var rows = [], n = 0;
  shuffle_(recruits.slice(), rng).slice(0, 8).forEach(function (r, i) {
    n++;
    var future = i < 6;                 // most upcoming, a couple past/resolved
    rows.push({
      id: "APPT" + n, d4: r.fourD, reason: pick_(rng, reasons),
      date: dayOffset_(future ? randint_(rng, 1, 20) : -randint_(rng, 3, 10)),
      time: pick_(rng, ["0830", "0900", "1030", "1400"]),
      location: pick_(rng, ["PTMC", "Changi General Hospital", "SAF Physio Centre"]),
      outOfCamp: rng() < 0.5, resolved: !future
    });
  });
  return { headers: headers, rows: rows };
}

function buildLeave_(people, rng) {
  var headers = ["id", "d4", "type", "startDate", "endDate", "days", "reason",
    "isInCamp", "isInCampReviewed"];
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var rows = [], n = 0;
  var types = ["Off-in-Lieu", "Leave", "Guard Duty", "Course", "Weekend",
    "Compassionate", "Night's Out"];
  shuffle_(recruits.slice(), rng).slice(0, 12).forEach(function (r) {
    n++;
    var type = pick_(rng, types);
    var start = randint_(rng, -2, 4);
    var span = (type === "Night's Out") ? 0 : randint_(rng, 0, 3);
    // Guard Duty is working (in camp); most leave types are out of camp.
    var inCamp = (type === "Guard Duty" || type === "Course");
    rows.push({
      id: "LV" + n, d4: r.fourD, type: type,
      startDate: dayOffset_(start), endDate: dayOffset_(start + span),
      days: span + 1, reason: pick_(rng, ["48HR BO", "family matter", "unit tasking", "rest day"]),
      isInCamp: inCamp, isInCampReviewed: true
    });
  });
  return { headers: headers, rows: rows };
}

function buildMsk_(people, rng) {
  var headers = ["timestamp", "d4", "type", "description", "physioDate",
    "exercises", "cleared", "manualRegions"];
  var recruits = people.filter(function (p) { return p.role === "Recruit"; });
  var rows = [], n = 0;
  var descs = ["ankle rolled during run", "recurring knee pain", "lower back ache",
    "shoulder impingement", "shin splints"];
  var regions = ["Ankle", "Knee", "Lower Back", "Shoulder", "Shin"];
  shuffle_(recruits.slice(), rng).slice(0, 6).forEach(function (r, i) {
    n++;
    rows.push({
      timestamp: addDays_(SEED_TODAY, -randint_(rng, 2, 20)).toISOString(),
      d4: r.fourD, type: "Report Injury",
      description: descs[i % descs.length], physioDate: dayOffset_(randint_(rng, 1, 10)),
      exercises: "", cleared: rng() < 0.3, manualRegions: regions[i % regions.length]
    });
  });
  return { headers: headers, rows: rows };
}

function buildVocFit_(people, rng) {
  var headers = ["personId", "completionDate", "certifyingUnit"];
  // Commanders (rank >= 3SG/2LT) get VocFit → gates Double-HA eligibility.
  var cmds = people.filter(function (p) { return p.role === "Commander"; });
  var rows = cmds.map(function (c) {
    return { personId: c.id, completionDate: dayOffset_(-60), certifyingUnit: "40SAR" };
  });
  return { headers: headers, rows: rows };
}

function buildPlatoons_() {
  var headers = ["code", "displayName", "active", "createdAt"];
  var rows = [{ code: "HQ", displayName: "HQ", active: true, createdAt: dayOffset_(-120) }];
  PLATOONS_.forEach(function (p, i) {
    rows.push({ code: p, displayName: "Platoon " + (i + 1), active: true, createdAt: dayOffset_(-120) });
  });
  return { headers: headers, rows: rows };
}

// ── Fisher–Yates using the seeded rng (deterministic) ───────────────────────
function shuffle_(arr, rng) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// ── Tab writer: delete + recreate a sheet, write headers + object rows ───────
// Self-contained (does not depend on the backend's writeTab/upsert). Booleans and
// numbers are written as native values so the sheet stores real TRUE/FALSE/number
// cells, matching what readTab expects.
function seedTab_(ss, name, headers, rows) {
  var old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  var sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  if (rows.length) {
    var values = rows.map(function (r) {
      return headers.map(function (h) {
        var v = r[h];
        return (v === undefined || v === null) ? "" : v;
      });
    });
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
  return rows.length;
}

// ═════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — run this once from the editor.
// ═════════════════════════════════════════════════════════════════════════════
function seedSynthetic() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rng = makeRng_(20260714); // fixed seed → deterministic dataset

  // 1. Reference tabs + BravesConfig + auth tabs (idempotent, backend-owned).
  if (typeof bravesMigrateSchema === "function") bravesMigrateSchema();
  if (typeof setupAuthTabs === "function") setupAuthTabs();

  // 2. Build the synthetic company.
  var people = buildPeople_(rng);
  var roster = buildRoster_(people, rng);
  var medical = buildMedical_(people, rng);
  var conducts = buildConducts_();
  var conductData = buildConductData_(people, rng);
  var ippt = buildIppt_(people, rng);
  var rm = buildRm_(people, rng);
  var soc = buildSoc_(people, rng);
  var polar = buildPolar_(people, rng);
  var appts = buildAppointments_(people, rng);
  var leave = buildLeave_(people, rng);
  var msk = buildMsk_(people, rng);
  var vocfit = buildVocFit_(people, rng);
  var platoons = buildPlatoons_();

  // 3. Write every data tab (delete + rewrite).
  var counts = {};
  counts.Roster        = seedTab_(ss, "Roster", roster.headers, roster.rows);
  counts.Medical       = seedTab_(ss, "Medical", medical.headers, medical.rows);
  counts.Conducts      = seedTab_(ss, "Conducts", conducts.headers, conducts.rows);
  counts.Attendance    = seedTab_(ss, "Attendance", conductData.attendance.headers, conductData.attendance.rows);
  counts.ConductDetail = seedTab_(ss, "ConductDetail", conductData.conductDetail.headers, conductData.conductDetail.rows);
  counts.IPPT          = seedTab_(ss, "IPPT", ippt.headers, ippt.rows);
  counts.RouteMarch    = seedTab_(ss, "RouteMarch", rm.headers, rm.rows);
  counts.SOC           = seedTab_(ss, "SOC", soc.headers, soc.rows);
  counts.PolarFlow     = seedTab_(ss, "PolarFlow", polar.headers, polar.rows);
  counts.Appointments  = seedTab_(ss, "Appointments", appts.headers, appts.rows);
  counts.Leave         = seedTab_(ss, "Leave", leave.headers, leave.rows);
  counts.MSK           = seedTab_(ss, "MSK", msk.headers, msk.rows);
  counts.VocFit        = seedTab_(ss, "VocFit", vocfit.headers, vocfit.rows);
  counts.Platoons      = seedTab_(ss, "Platoons", platoons.headers, platoons.rows);

  // 4. Sandbox accounts (uses the backend's own hashing via createAccount, which
  //    is a no-op if the email already exists — safe to re-run).
  if (typeof createAccount === "function") {
    createAccount(SANDBOX_VIEWER_EMAIL, "", "viewer", SANDBOX_VIEWER_PASSWORD);
    createAccount(SANDBOX_CMDR_EMAIL, "", "commander", SANDBOX_CMDR_PASSWORD);
  }

  Logger.log("seedSynthetic complete. Row counts: " + JSON.stringify(counts));
  Logger.log("Viewer (read-only)  → " + SANDBOX_VIEWER_EMAIL + " / " + SANDBOX_VIEWER_PASSWORD);
  Logger.log("Commander (r/w)     → " + SANDBOX_CMDR_EMAIL + " / " + SANDBOX_CMDR_PASSWORD);
  Logger.log("Now: Deploy → New deployment → Web app, copy the URL.");
}
