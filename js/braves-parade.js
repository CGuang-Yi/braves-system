// ============================================================================
// BRAVES PARADE STATE — Step 3 (spec §7–9)  ***DRAFT — NOT YET LOADED***
// ============================================================================
// This file is intentionally NOT referenced from index.html yet. It was written
// during the overnight session while the Bash safety classifier was unavailable,
// so it could NOT be run, `node --check`ed, or byte-validated against
// `Message Formats.md` (the explicit Step-3 acceptance test). Loading it blind
// could break the whole app (all scripts share global scope), so integration is
// deferred until it can be verified. See SESSION_LOG.md handoff + DECISIONS #26–33.
//
// INTEGRATION CHECKLIST (do once Bash/node is back):
//   1. node --check js/braves-parade.js
//   2. Add  <script src="js/braves-parade.js?v=NN"></script>  AFTER forms.js,
//      BEFORE sync.js, in index.html; bump ?v on every tag.
//   3. Replace the legacy Cougar generators: point regenerateReport()'s FP/LP
//      branch at generateBravesParadeState(scope, type, dateIso, time), and add a
//      company/platoon scope selector to openReportModal (see notes at bottom).
//   4. Remove the now-dead Cougar parade fns from forms.js (buildStrengthBlock,
//      buildMedicalSection, buildOthersSection, buildAppointmentSection,
//      generateParadeStateText, the old paradeRN) — or keep paradeRN's name and
//      have it delegate to bravesParadeRN.
//   5. Run the byte-comparison: generate FP for the sample data and diff against
//      `Message Formats.md` (Company + Platoon sections). Tune SEP arrays / spacing.
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

// Leave types that count as AL/OIL (DECISIONS #32 — flag for confirmation; make
// Config-driven later). Everything else → OTHERS (NOT IN CAMP).
const BP_ALOIL_TYPES = new Set(
  ["leave", "off-in-lieu", "oil", "al", "annual leave", "weekend", "night's out", "nights out", "compassionate"]
);
function bpIsAlOilType(type) {
  return BP_ALOIL_TYPES.has(String(type || "").trim().toLowerCase());
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
    const reason = [l.type, l.reason].filter(Boolean).join(" — ") || l.type || "";
    if (bpIsAlOilType(l.type)) {
      out.alOil.push(`${rn} - ${reason} ${bpRange(l, true)}`.trim());
    } else {
      out.others.push(`${rn} - ${reason} ${bpRange(l, false)} (OTHERS (NOT IN CAMP))`.replace(/\s+\(/, " (").trim());
    }
    notInCamp = true;
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

  // Out-of-camp medical appointments (MA) dated today → OTHERS (NOT IN CAMP).
  (STATE.appointments || []).forEach(a => {
    if (a.d4 !== r.id || a.resolved) return;
    if (displayDateToISO(a.date) !== dateIso) return;
    if (!bpOthersNotInCamp(a.reason, a.othersInCamp)) return;
    out.others.push(`${rn} - ${a.reason || "Appointment"} (OTHERS (NOT IN CAMP))`.trim());
    notInCamp = true;
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
