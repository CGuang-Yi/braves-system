// ============================================================================
// BRAVES PARADE STATE — Step 3 (spec §7–9)
// ============================================================================
// The Braves §7–9 parade-state generator. Loaded after forms.js / before sync.js
// (it leans on globals defined in earlier files). Replaces the legacy Cougar
// parade builders; `regenerateReport()` routes FP/LP here via
// generateBravesParadeState(scope, type, dateIso, time), and `paradeRN` delegates
// to bravesParadeRN (so the borderline/appointment checklist sections still work).
//
// Byte-validated 2026-06-21 against `Message Formats.md` with a Node fixture
// harness (structural match + literal helper assertions). The sample is an
// internally date-inconsistent montage and can't be reproduced verbatim end-to-
// end (no source data; it even mis-counts one section and renders one person two
// ways) — so the validation is structural + per-helper, not literal 279-pax.
// Format decisions: DECISIONS #26–33 + #35 (this session). The sample's incidental
// double-spaces are dropped (#26); names are NOT force-uppercased (#30).
//
// DEPENDENCIES (globals from earlier files; present once loaded after forms.js):
//   STATE, configGet, displayDateToISO, medStatusActive, personPlatoon,
//   personSection, rankGroupOf, activePlatoons.
// ============================================================================

// ── Separators (DECISIONS #27) ──────────────────────────────────────────────
// Reproduced verbatim from the sample. The platoon/HQ block uses a per-section
// dash count; the company aggregate block uses 80 dashes before every category.
const BP_BIG_SEP = "-".repeat(80);                 // inter-block + company-block category sep
const BP_EQ_SEP = "=".repeat(30);                  // company aggregate ↔ HQ block
// Dash counts BEFORE [AL/OIL, MR, REPORTING SICK, ATT C, STATUS, OTHERS]:
const BP_PLT_SECTION_SEPS = [30, 30, 30, 28, 29, 29];

// Section order is fixed across all blocks.
const BP_SECTIONS = ["alOil", "mr", "reportingSick", "attC", "status", "others"];
const BP_SECTION_LABELS = {
  alOil: "AL/OIL",
  mr: "MR",
  reportingSick: "REPORTING SICK",
  attC: "ATT C",
  status: "STATUS",
  others: "OTHERS"
};

// Leave types that count as AL/OIL vs OTHERS (DECISIONS #32, resolved #35 this
// session). Config-driven: configGet("alOilLeaveTypes") supplies the list
// (comma-separated string or array); the hardcoded set below is the fallback if
// Config is absent. Everything NOT in the set falls to OTHERS, sub-typed in/out
// of camp by the reason-keyword derivation (bpOthersNotInCamp), per spec §8.
const BP_ALOIL_TYPES_DEFAULT =
  ["leave", "off-in-lieu", "oil", "al", "annual leave", "weekend", "night's out", "nights out", "compassionate"];
function bpAlOilTypeSet() {
  const cfg = configGet("alOilLeaveTypes");
  if (cfg) {
    const arr = Array.isArray(cfg) ? cfg : String(cfg).split(",");
    const cleaned = arr.map(s => String(s).trim().toLowerCase()).filter(Boolean);
    if (cleaned.length) return new Set(cleaned);
  }
  return new Set(BP_ALOIL_TYPES_DEFAULT);
}
function bpIsAlOilType(type) {
  return bpAlOilTypeSet().has(String(type || "").trim().toLowerCase());
}

// ── Date helpers ────────────────────────────────────────────────────────────
// "2026-05-20" → "200526" (battalion DDMMYY). Local, so this file doesn't depend
// on forms.js's toDDMMYY load order.
function bpDDMMYY(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return m[3] + m[2] + m[1].slice(2);
}
function bp2(n) { return String(n).padStart(2, "0"); }

// Inclusive day count between two display dates, e.g. 13–21 May = 9.
function bpInclusiveDays(record) {
  const s = displayDateToISO(record.startDate || record.date || "");
  const e = displayDateToISO(record.endDate || "");
  if (!s || !e) return null;
  const days = Math.round((new Date(e + "T00:00:00") - new Date(s + "T00:00:00")) / 86400000) + 1;
  return days > 0 ? days : null;
}
// Spaced "(210526 - 220526)" for AL/OIL & STATUS-LD; unspaced "(130526-210526)"
// for ATT C & OTHERS (DECISIONS #28).
function bpRange(record, spaced) {
  const s = displayDateToISO(record.startDate || record.date || "");
  const e = displayDateToISO(record.endDate || "");
  if (!s || !e) return "";
  return spaced ? `(${bpDDMMYY(s)} - ${bpDDMMYY(e)})` : `(${bpDDMMYY(s)}-${bpDDMMYY(e)})`;
}

// ── R/N formatting (spec §7, DECISIONS #30) ─────────────────────────────────
// 4D personnel: "MARTIN TAN B1411" (name + prefix + 4D). No-4D personnel:
// "LCP CALVIN LEE" (rank + name) or just "TREVOR LEE". Names rendered as stored
// (not force-uppercased) per the sample.
function bravesParadeRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = r.name || "";
  const prefix = configGet("companyPrefix") || "B";
  if (r.fourD && String(r.fourD).trim() !== "") {
    return `${name} ${prefix}${String(r.fourD).trim()}`.trim();
  }
  return [r.rank, name].filter(Boolean).join(" ").trim();
}

// Sick-message R/N (spec §10): name (+ B<4D>) with NO rank prefix.
function sickRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = r.name || "";
  const prefix = configGet("companyPrefix") || "B";
  if (r.fourD && String(r.fourD).trim() !== "") {
    return `${name} ${prefix}${String(r.fourD).trim()}`.trim();
  }
  return name.trim();
}

// ── OTHERS sub-type (spec §8) ───────────────────────────────────────────────
function bpOthersNotInCamp(reasonText, override) {
  if (override === true) return false;   // othersInCamp = true → in camp
  if (override === false) return true;
  const t = String(reasonText || "").toLowerCase();
  if (/book\s*out|booked out|out of camp|\bma\b|appointment/.test(t)) return true;
  return false; // default IN CAMP
}

// ── Per-person classification (spec §8) ─────────────────────────────────────
// Multi-section: a person may appear under several sections. Returns the section
// → entry-line map for this one person, plus a binary notInCamp flag (counted
// once). Dedupe within a section is by exact line text.
function bpClassifyPerson(r, dateIso) {
  const rn = bravesParadeRN(r.id);
  const out = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  let notInCamp = false;

  // Leave → AL/OIL (in the AL/OIL type set) or OTHERS (not in camp).
  STATE.leave.forEach(l => {
    if (l.d4 !== r.id) return;
    const s = displayDateToISO(l.startDate), e = displayDateToISO(l.endDate);
    if (!s || !e || !(s <= dateIso && dateIso <= e)) return;
    // The entry text is the free-text reason ("48HR BO"), falling back to the
    // leave type when no reason was recorded. (NOT "type — reason" — the sample
    // shows a single clean label.)
    const reason = l.reason || l.type || "";
    if (bpIsAlOilType(l.type)) {
      out.alOil.push(`${rn} - ${reason} ${bpRange(l, true)}`.trim());
      notInCamp = true;  // AL/OIL is always not in camp
    } else {
      // Non-AL/OIL leave → OTHERS; in/out of camp via the §8 reason-keyword
      // default ("book out"/"out of camp"/MA → NOT IN CAMP; else IN CAMP).
      const nic = bpOthersNotInCamp(reason);
      const label = nic ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
      const rng = bpRange(l, false);
      out.others.push(`${rn} - ${reason}${rng ? " " + rng : ""} (${label})`.trim());
      if (nic) notInCamp = true;
    }
  });

  // Medical rows for this person.
  STATE.medical.forEach(m => {
    if (m.d4 !== r.id) return;
    const reportedToday = displayDateToISO(m.date) === dateIso;

    // MR — own section, independent of everything else (spec §6/§8).
    if (m.type === "MR" && reportedToday) {
      const timing = m.mrTiming ? ` (${m.mrTiming})` : "";
      out.mr.push(`${rn} - ${m.reason || ""}${timing}`.trim());
    }

    // REPORTING SICK — RSI/RSO reported today, or a Pending status active today.
    const isRS = ((m.type === "RSI" || m.type === "RSO") && reportedToday)
      || (m.status === "Pending" && medStatusActive(m, dateIso));
    if (isRS) {
      const label = m.type === "RSO" ? "RSO" : "RSI"; // Pending→RSI (DECISIONS #31)
      out.reportingSick.push(`${rn} - ${m.reason || ""} (${label})`.trim());
    }

    // ATT C — active MC (not-in-camp). Warded handled as OTHERS below.
    if (m.status === "MC" && medStatusActive(m, dateIso)) {
      const days = bpInclusiveDays(m);
      const label = days ? `${days}D MC` : "MC";
      out.attC.push(`${rn} - ${label} ${bpRange(m, false)}`.trim());
      notInCamp = true;
    }

    // STATUS — active LD or any Excuse-* (in camp, restricted).
    if (medStatusActive(m, dateIso) && m.status !== "MC" && m.status !== "Warded"
        && m.status !== "Pending" && m.status !== "NIL") {
      if (m.status === "LD") {
        const days = bpInclusiveDays(m);
        const label = days ? `${days}D LD` : "LD";
        out.status.push(`${rn} - ${label} ${bpRange(m, true)}`.trim());
      } else {
        // Excuse-* / custom: show the status text + range when dated.
        const range = bpRange(m, true);
        out.status.push(`${rn} - ${m.status}${range ? " " + range : ""}`.trim());
      }
    }

    // Warded → OTHERS (NOT IN CAMP).
    if (m.status === "Warded" && medStatusActive(m, dateIso)) {
      out.others.push(`${rn} - ${m.reason || "Warded"} (OTHERS (NOT IN CAMP))`.trim());
      notInCamp = true;
    }
  });

  // Medical appointments (MA) dated today → OTHERS. The stored `outOfCamp` bit
  // (set when booking, toggled live by the parade presence-tick) drives the
  // sub-type: out of camp → NOT IN CAMP (and subtracts from current strength);
  // in camp → OTHERS (IN CAMP), still present. Resolved appointments drop out.
  (STATE.appointments || []).forEach(a => {
    if (a.d4 !== r.id || a.resolved) return;
    if (displayDateToISO(a.date) !== dateIso) return;
    const outOfCamp = !!a.outOfCamp;
    const label = outOfCamp ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
    out.others.push(`${rn} - ${a.reason || "Appointment"} (${label})`.trim());
    if (outOfCamp) notInCamp = true;
  });

  // Dedupe each section by exact line (collapses multi-status sibling rows).
  BP_SECTIONS.forEach(k => { out[k] = [...new Set(out[k])]; });
  return { rn, sections: out, notInCamp };
}

// ── Strength (spec §8) ──────────────────────────────────────────────────────
function bpIsActive(r) {
  return r.status === "Active" || !r.status; // DECISIONS #33
}
// people: array of in-scope roster rows. Returns totals + per-rankGroup ratios.
function bpStrength(people, dateIso) {
  const active = people.filter(bpIsActive);
  const groups = { Officer: { cur: 0, tot: 0 }, WOSPEC: { cur: 0, tot: 0 }, Enlistee: { cur: 0, tot: 0 } };
  let total = 0, current = 0;
  active.forEach(r => {
    const g = rankGroupOf(r);
    const bucket = groups[g] || groups.Enlistee;
    const inCamp = !bpClassifyPerson(r, dateIso).notInCamp;
    total++; bucket.tot++;
    if (inCamp) { current++; bucket.cur++; }
  });
  return { total, current, groups };
}

// ── Block assembly ──────────────────────────────────────────────────────────
// Build one platoon/HQ block (or the company aggregate block). `aggregate` =
// true uses 80-dash separators + 2-pad rankGroup ratios (DECISIONS #27/#29).
function bpBuildBlock(people, dateIso, type, opts) {
  opts = opts || {};
  const aggregate = !!opts.aggregate;
  const headerLabel = opts.headerLabel || "";
  const dateStr = bpDDMMYY(dateIso);

  // Collect entries per section across all people.
  const buckets = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  people.forEach(r => {
    if (!bpIsActive(r)) return;
    const c = bpClassifyPerson(r, dateIso);
    BP_SECTIONS.forEach(k => { c.sections[k].forEach(line => buckets[k].push(line)); });
  });

  const strength = bpStrength(people, dateIso);
  const ratio = (cur, tot) => aggregate ? `${bp2(cur)}/${bp2(tot)}` : `${cur}/${tot}`;

  // Header.
  const lines = [];
  if (aggregate) {
    lines.push(`${configGet("companyName")} PARADE STATE`);
    lines.push(`${dateStr} ${type} ${opts.time || ""}`.trim());
  } else {
    lines.push(`${dateStr} ${type}`);
    lines.push(headerLabel);
  }
  lines.push("");
  lines.push(`TOTAL STRENGTH: ${strength.total}`);
  lines.push(`CURRENT STRENGTH: ${strength.current}`);
  lines.push("");
  lines.push(`[OFFICER]: ${ratio(strength.groups.Officer.cur, strength.groups.Officer.tot)}`);
  lines.push(`[WOSPEC]: ${ratio(strength.groups.WOSPEC.cur, strength.groups.WOSPEC.tot)}`);
  lines.push(`[ENLISTEE]: ${ratio(strength.groups.Enlistee.cur, strength.groups.Enlistee.tot)}`);

  // Sections, each preceded by its separator.
  BP_SECTIONS.forEach((key, i) => {
    const sep = aggregate ? BP_BIG_SEP : "-".repeat(BP_PLT_SECTION_SEPS[i]);
    lines.push(sep);
    const entries = buckets[key];
    lines.push(`${BP_SECTION_LABELS[key]}: ${bp2(entries.length)}`);
    if (entries.length) {
      entries.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
    } else {
      lines.push(""); // empty section: header + count + one blank line (spec §9.2)
    }
  });

  return lines.join("\n");
}

// ── Public entry point ──────────────────────────────────────────────────────
// scope: { level: "company" } | { level: "platoon", platoon: "PLT1" | "HQ" }
// type: "FP" | "LP". Returns the full message text.
function generateBravesParadeState(scope, type, dateIso, time) {
  scope = scope || { level: "company" };
  const roster = STATE.roster || [];
  const platoonPeople = code => roster.filter(r => personPlatoon(r) === code);

  if (scope.level === "platoon") {
    const code = scope.platoon;
    const label = code === "HQ" ? configGet("hqLabel") : `PLATOON ${String(code).replace(/^PLT/i, "")}`;
    return bpBuildBlock(platoonPeople(code), dateIso, type, { headerLabel: label });
  }

  // Company: aggregate block → 30 `=` → HQ block → (80 dashes) → PLT blocks.
  const parts = [];
  parts.push(bpBuildBlock(roster, dateIso, type, { aggregate: true, time }));
  parts.push("");
  parts.push(BP_EQ_SEP);
  parts.push("");

  // Order: HQ first, then platoons in natural order.
  const plats = activePlatoons().map(p => p.code);
  const ordered = ["HQ", ...plats.filter(c => c !== "HQ")];
  const seen = new Set();
  const blocks = [];
  ordered.forEach(code => {
    if (seen.has(code)) return;
    seen.add(code);
    const people = platoonPeople(code);
    if (!people.length && code !== "HQ") return; // skip empty platoons (keep HQ)
    const label = code === "HQ" ? configGet("hqLabel") : `PLATOON ${String(code).replace(/^PLT/i, "")}`;
    blocks.push(bpBuildBlock(people, dateIso, type, { headerLabel: label }));
  });
  parts.push(blocks.join(`\n\n${BP_BIG_SEP}\n`));
  return parts.join("\n");
}

// ── INTEGRATION NOTES (openReportModal / regenerateReport) ──────────────────
// The current modal (forms.js openReportModal) has no scope selector. To wire
// Braves parade state:
//   • Add a <select id="rep-scope"> to the FP/LP modal: "Company" + one option
//     per activePlatoons() entry (value "company" or "platoon:PLT1").
//   • In regenerateReport, for FP/LP:
//       const sv = gv("rep-scope") || "company";
//       const scope = sv === "company" ? {level:"company"}
//                     : {level:"platoon", platoon: sv.split(":")[1]};
//       text = generateBravesParadeState(scope, type, dateIso, time);
//   • The §6 "live presence tick" design ideas (bidirectional left/returned)
//     map onto the existing _paradeOverrides borderline mechanism — generalise
//     it to toggle a person's notInCamp for OTHERS/appointments, not just MC.
