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
// Config is absent. Everything NOT in the set falls to OTHERS. In/out-of-camp
// for every leave row (AL/OIL and OTHERS alike) is the explicit isInCamp the
// commander picks in the Leave form — see bpClassifyPerson below.
// bpOthersNotInCamp is kept only to compute the form's smart-prefill
// suggestion and the one-off GAS backfill migration; the classifier itself
// never calls it.
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
  if (r.role !== "Commander" && r.fourD && String(r.fourD).trim() !== "") {
    return `${name} ${prefix}${String(r.fourD).trim()}`.trim();
  }
  return [r.rank, name].filter(Boolean).join(" ").trim();
}

// Sick-message R/N (spec §10): name (+ B<4D>) with NO rank prefix. Commanders
// never get a 4D suffix here either — they're never displayed by id.
function sickRN(personId) {
  const r = STATE.roster.find(x => x.id == personId);
  if (!r) return String(personId);
  const name = r.name || "";
  const prefix = configGet("companyPrefix") || "B";
  if (r.role !== "Commander" && r.fourD && String(r.fourD).trim() !== "") {
    return `${name} ${prefix}${String(r.fourD).trim()}`.trim();
  }
  return name.trim();
}

// ── OTHERS sub-type guess (spec §8, legacy) ─────────────────────────────────
// No longer called by bpClassifyPerson (every leave row now carries an
// explicit isInCamp). Kept for two callers: the Leave form's smart-prefill
// (forms.js) and the one-off GAS backfill migration (bravesBackfillLeaveInCamp).
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
function bpClassifyPerson(r, dateIso, idx) {
  const rn = bravesParadeRN(r.id);
  const out = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  // Structured twin of `out`: for each pushed line we also record { line, reason,
  // type } so the Status Board (A4 grid / A7 category) can read status/reason/type
  // directly instead of regex-scraping the formatted parade text (which must stay
  // byte-identical to Message Formats.md). `reason` always equals the line minus
  // the "RN - " prefix, so it matches what bpStripRN would have returned.
  const meta = { alOil: [], mr: [], reportingSick: [], attC: [], status: [], others: [] };
  let notInCamp = false;
  // Push to both `out` and `meta`, keeping the formatted line and its structured
  // record aligned. `body` is the text after "RN - "; the line is built exactly as
  // before (`${rn} - ${body}` trimmed) so output is unchanged.
  const push2 = (section, body, type) => {
    const line = `${rn} - ${body}`.trim();
    out[section].push(line);
    meta[section].push({ line, reason: bpStripRN(line, rn), type });
  };

  // Per-person rows: use the prebuilt d4→rows index when supplied (the Status
  // Board grid passes one to avoid O(roster×days) full-array rescans); otherwise
  // filter STATE on the fly. Either way the d4 match is already applied here, so
  // the loop bodies below don't re-check it.
  const leaveRows = idx ? (idx.leave[r.id] || []) : STATE.leave.filter(l => l.d4 === r.id);
  const medRows = idx ? (idx.medical[r.id] || []) : STATE.medical.filter(m => m.d4 === r.id);
  const apptRows = idx ? (idx.appointments[r.id] || []) : (STATE.appointments || []).filter(a => a.d4 === r.id);

  // Leave → AL/OIL (in the AL/OIL type set) or OTHERS. Every leave row now
  // carries an explicit isInCamp (In Camp/Not In Camp, picked by the
  // commander in the Leave form — no more reason-keyword guessing). Applies
  // uniformly to AL/OIL and OTHERS types. The "any row this day is explicitly
  // In Camp" case is tracked separately and applied AFTER the loop (not
  // inline per-row) so it's strictly additive: if a person has a second,
  // Not-In-Camp leave row active the same day, the In Camp row still pulls
  // them in rather than being cancelled by that other row's notInCamp=true.
  // It only ever clears the leave-contributed part of notInCamp — a later
  // MC/Warded/out-of-camp appointment this function checks below is untouched.
  let leaveOverride = false;
  leaveRows.forEach(l => {
    const s = displayDateToISO(l.startDate), e = displayDateToISO(l.endDate);
    if (!s || !e || !(s <= dateIso && dateIso <= e)) return;
    // The entry text is the free-text reason ("48HR BO"), falling back to the
    // leave type when no reason was recorded. (NOT "type — reason" — the sample
    // shows a single clean label.)
    const reason = l.reason || l.type || "";
    const inCamp = l.isInCamp === true;
    if (inCamp) leaveOverride = true;
    if (bpIsAlOilType(l.type)) {
      push2("alOil", `${reason} ${bpRange(l, true)}`.trim(), "AL/OIL");
      notInCamp = true;  // AL/OIL is not in camp unless overridden (below)
    } else {
      // Non-AL/OIL leave → OTHERS; the commander picks In Camp/Not In Camp
      // explicitly on every record (see bpOthersNotInCamp's own comment for
      // where the old guess logic now only applies — form prefill/migration).
      const label = inCamp ? "OTHERS (IN CAMP)" : "OTHERS (NOT IN CAMP)";
      const rng = bpRange(l, false);
      push2("others", `${reason}${rng ? " " + rng : ""} (${label})`, "OTHERS");
      if (!inCamp) notInCamp = true;
    }
  });
  if (leaveOverride) notInCamp = false;

  // Medical rows for this person.
  medRows.forEach(m => {
    const reportedToday = displayDateToISO(m.date) === dateIso;

    // REPORTING SICK — reported RSI/RSO today AND still awaiting the MO outcome
    // (status Pending or blank). Once the MO issues any status — MC/LD/Excuse/
    // Warded/RIB/custom, or NIL (cleared) — the person is no longer "reporting
    // sick" and drops off this list (they appear under ATT C / STATUS / OTHERS
    // instead). Fixes the double-listing of assigned/cleared personnel on the
    // active RS list. A still-active Pending status keeps them on RS regardless
    // of report date. NOTE: the daily sick-report messages (bpSickReports →
    // generateRSFormat / generateRSIPersonnel) intentionally list everyone who
    // reported that morning and are NOT affected by this guard.
    const moPending = !m.status || m.status === "Pending";

    // MR — own section, independent of everything else (spec §6/§8). Same
    // pending gate as REPORTING SICK: once the MO resolves the review with a
    // final status (MC/LD/Excuse/NIL/…), it's no longer awaiting review and
    // drops off this list (the resolved status surfaces it under ATT C /
    // STATUS / OTHERS instead) — otherwise a resolved MR double-lists.
    if (m.type === "MR" && reportedToday && moPending) {
      const timing = m.mrTiming ? ` (${m.mrTiming})` : "";
      push2("mr", `${m.reason || ""}${timing}`, "MR");
    }
    const isRS = (((m.type === "RSI" || m.type === "RSO") && reportedToday) && moPending)
      || (m.status === "Pending" && medStatusActive(m, dateIso));
    if (isRS) {
      const label = m.type === "RSO" ? "RSO" : "RSI"; // Pending→RSI (DECISIONS #31)
      push2("reportingSick", `${m.reason || ""} (${label})`, label);
    }

    // ATT C — active MC (not-in-camp). Warded handled as OTHERS below.
    if (m.status === "MC" && medStatusActive(m, dateIso)) {
      const days = bpInclusiveDays(m);
      const label = days ? `${days}D MC` : "MC";
      push2("attC", `${label} ${bpRange(m, false)}`.trim(), "MC");
      notInCamp = true;
    }

    // STATUS — active LD or any Excuse-* (in camp, restricted). Requires a non-
    // empty status: an imported RS/SENT_OUT episode carries status:"" with an
    // active date range, which would otherwise emit a blank "RN - " STATUS line
    // (and double-list someone already in REPORTING SICK).
    if (m.status && medStatusActive(m, dateIso) && m.status !== "MC" && m.status !== "Warded"
        && m.status !== "Pending" && m.status !== "NIL") {
      if (m.status === "LD") {
        const days = bpInclusiveDays(m);
        const label = days ? `${days}D LD` : "LD";
        push2("status", `${label} ${bpRange(m, true)}`.trim(), "LD");
      } else {
        // Excuse-* / custom: show the status text + range when dated.
        const range = bpRange(m, true);
        push2("status", `${m.status}${range ? " " + range : ""}`, m.status);
      }
    }

    // Warded → OTHERS (NOT IN CAMP).
    if (m.status === "Warded" && medStatusActive(m, dateIso)) {
      push2("others", `${m.reason || "Warded"} (OTHERS (NOT IN CAMP))`, "OTHERS");
      notInCamp = true;
    }
  });

  // Medical appointments (MA) dated today → OTHERS. The stored `outOfCamp` bit
  // (set when booking, toggled live by the parade presence-tick) drives the
  // sub-type: out of camp → NOT IN CAMP (and subtracts from current strength);
  // in camp → OTHERS (IN CAMP), still present. Resolved appointments drop out.
  apptRows.forEach(a => {
    if (a.resolved) return;
    if (displayDateToISO(a.date) !== dateIso) return;
    const outOfCamp = !!a.outOfCamp;
    const label = outOfCamp ? "OTHERS (NOT IN CAMP)" : "OTHERS (IN CAMP)";
    push2("others", `${a.reason || "Appointment"} (${label})`, "OTHERS");
    if (outOfCamp) notInCamp = true;
  });

  // Dedupe each section by exact line first, keeping `meta` aligned with `out`.
  BP_SECTIONS.forEach(k => {
    const seen = new Set(), o = [], mt = [];
    out[k].forEach((line, i) => {
      if (seen.has(line)) return;
      seen.add(line); o.push(line); mt.push(meta[k][i]);
    });
    out[k] = o; meta[k] = mt;
  });
  // STATUS multi-status collapse (DECISIONS #44): a recruit on several restricted
  // statuses from one visit (e.g. LD + Excuse RMJ) produced one line per row, so
  // they showed up as separate numbered entries. Since this classifier is per-
  // person, every out.status line belongs to the same recruit — fold them into a
  // single "RN - desc1, desc2" entry (descriptors joined, rn shown once). Only
  // STATUS is collapsed: other sections carry per-entry "(OTHERS (…))"-style
  // suffixes that don't read sensibly comma-joined, and a person rarely has >1.
  if (out.status.length > 1) {
    const descs = meta.status.map(x => x.reason);
    const line = `${rn} - ${descs.join(", ")}`;
    out.status = [line];
    meta.status = [{ line, reason: descs.join(", "), type: "STATUS" }];
  }
  return { rn, sections: out, meta, notInCamp };
}

// Build a d4→rows index of leave/medical/appointments once, to pass to
// bpClassifyPerson(r, dateIso, idx). The Status Board grid classifies every
// person across ~35 day-cells; without this each call full-scans all three
// STATE arrays (O(roster×days×rows)). Build once per render, reuse for all cells.
function bpBuildIndex() {
  const idx = { leave: {}, medical: {}, appointments: {} };
  const add = (bucket, row) => {
    const k = row && row.d4;
    if (k == null) return;
    (bucket[k] || (bucket[k] = [])).push(row);
  };
  (STATE.leave || []).forEach(l => add(idx.leave, l));
  (STATE.medical || []).forEach(m => add(idx.medical, m));
  (STATE.appointments || []).forEach(a => add(idx.appointments, a));
  return idx;
}

// ── Status Board helpers (addendum A4/A7) — reuse the §8 classifier ──────────
// A7.3 "today's category": the single-label §8 priority chain
// (REPORTING SICK > ATT C > AL/OIL > STATUS > OTHERS); MR is independent.
// Returns { primary:{key,label,reason}|null, mr:reason|null, sections, rn }.
const BP_PRIMARY_CHAIN = [
  ["reportingSick", "REPORTING SICK"], ["attC", "ATT C"], ["alOil", "AL/OIL"],
  ["status", "STATUS"], ["others", "OTHERS"]
];
function bpStripRN(line, rn) {
  // "Martin Tan B1411 - FEVER (RSI)" → "FEVER (RSI)" (best-effort reason text).
  // Still used while building lines (push2) and the STATUS collapse; the Status
  // Board consumers now read the structured `meta.reason` instead of re-parsing.
  const pre = rn + " - ";
  return line.startsWith(pre) ? line.slice(pre.length) : line;
}
function bpPrimaryForDay(r, dateIso, idx) {
  const c = bpClassifyPerson(r, dateIso, idx);
  let primary = null;
  for (const [k, label] of BP_PRIMARY_CHAIN) {
    if (c.sections[k].length) { primary = { key: k, label, reason: c.meta[k][0].reason }; break; }
  }
  const mr = c.meta.mr.length ? c.meta.mr[0].reason : null;
  return { primary, mr, sections: c.sections, rn: c.rn, notInCamp: c.notInCamp };
}
// A4.2 grid cell: fill priority Leave > MC > LD > Excuse > RSI/RSO > MR, plus
// secondary RSI/RSO markers. LD and Excuse share the §8 `status` section but are
// split here (per the agreed priority) by reading the structured types: a "LD"
// type wins the LD colour, otherwise an Excuse-* status takes the EX colour.
// Returns { primary, hasRSI, hasRSO, hasMR, any }.
function bpGridCell(r, dateIso, idx) {
  const c = bpClassifyPerson(r, dateIso, idx);
  const s = c.sections;
  // Read the type from the structured twin rather than regex-matching the line.
  const hasRSO = c.meta.reportingSick.some(x => x.type === "RSO");
  const hasRSI = c.meta.reportingSick.some(x => x.type === "RSI");
  let primary = null;
  if (s.alOil.length) primary = "LV";
  else if (s.attC.length) primary = "MC";
  else if (s.status.length) {
    // type is "LD" for an LD row; for the collapsed multi-status line it becomes
    // "STATUS", so also sniff the reason text for an "LD" token. LD outranks Excuse.
    const reason = c.meta.status.map(x => x.reason || "").join(", ");
    const isLD = c.meta.status.some(x => x.type === "LD") || /\bLD\b/.test(reason);
    primary = isLD ? "LD" : "EX";
  }
  else if (s.reportingSick.length) primary = hasRSO ? "RSO" : "RSI";
  else if (s.mr.length) primary = "MR";
  return { primary, hasRSI, hasRSO, hasMR: s.mr.length > 0, any: !!primary };
}

// Dashboard "Not Available" (Bug 2): a person counts only if they are physically
// IN CAMP and currently RSI (Report Sick INSIDE) or MR (Medical Review). RSO
// (report sick OUTSIDE) is excluded — they're not in camp — as are STATUS / LD /
// Excuse / ATT C. Reads the structured `meta` twin so it keys off the parsed RSI
// type rather than the formatted line. Frontend-only (dashboard concept) — not
// mirrored into the Apps Script copy.
function bpIsNotAvailable(r, dateIso, idx) {
  const c = bpClassifyPerson(r, dateIso, idx);
  if (c.notInCamp) return false;                       // must be physically in camp
  const hasRSI = c.meta.reportingSick.some(x => x.type === "RSI");
  const hasMR = c.sections.mr.length > 0;
  return hasRSI || hasMR;
}

// ── Strength (spec §8) ──────────────────────────────────────────────────────
// Roster statuses that mean the person has LEFT the company — only these drop a
// row from strength. The roster `status` field doubles as a live mirror of the
// recruit's current MEDICAL status (submitMedical writes MC/LD/Excuse/…/custom
// back onto the roster row), so those values must NOT exclude anyone: a recruit
// on MC is still posted to the company and counts toward TOTAL STRENGTH; their
// not-in-camp state for CURRENT STRENGTH is derived from the Medical/Leave layer
// (ATT C / OTHERS), not from this field. Only genuine departures are excluded.
const BP_DEPARTED_STATUSES = new Set(["Discharged", "ORD", "Posted Out", "Transferred", "Withdrawn", "Inactive"]);
function bpIsActive(r) {
  const s = (r && r.status != null) ? String(r.status).trim() : "";
  return !BP_DEPARTED_STATUSES.has(s); // DECISIONS #33 — blank/Active/medical-mirror all count
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

// ════════════════════════════════════════════════════════════════════════════
// SICK MESSAGES (spec §10)
// ════════════════════════════════════════════════════════════════════════════
// Two formats, both validated against `Message Formats.md`. Source = Medical rows
// with type RSI/RSO reported on the given date (the day's sick parade). URTI vs
// NON-URTI split by `urtiType`, falling back to classifyURTI(reason) for rows that
// predate the field. Layout (updated Message Formats.md, DECISIONS #45): the six
// field lines of an entry are SINGLE-spaced (joined "\n" into one chunk); builders
// then join chunks (header, count headers, per-platoon labels, entries) with
// "\n\n", so blank lines fall only between entries / around the count headers — not
// between fields. R/N uses sickRN (name + B<4D>, no rank prefix — spec §10/§7 note).

// "0700" → "0700H" (battalion time suffix). Pads to 4 digits defensively.
function bpTimeH(time) {
  return String(time || "").trim().padStart(4, "0").slice(0, 4) + "H";
}
// key/value field line — omits the trailing space when the value is blank, so an
// unfilled field renders exactly "R/N:" (not "R/N: ") as in the sample.
function bpKV(key, val) {
  return val ? `${key}: ${val}` : `${key}:`;
}
// Report-sick rows for the day: type RSI/RSO reported on dateIso.
function bpSickReports(dateIso) {
  return (STATE.medical || []).filter(m =>
    (m.type === "RSI" || m.type === "RSO") && displayDateToISO(m.date) === dateIso
  );
}
// URTI / NON-URTI bucket for a report-sick row.
function bpUrtiOf(m) {
  const t = m.urtiType || classifyURTI(m.reason || "");
  return t === "URTI" ? "URTI" : "NON-URTI";
}
// "FOLLOW UP STATUS FROM MO" value = the MO outcome from the medical record's
// status (spec §10.4 — no separate field). Pending / blank → blank line (MO not
// seen yet). MC/LD render with the inclusive day count ("9D MC").
function bpSickFollowUp(m) {
  if (!m.status || m.status === "Pending") return "";
  if (m.status === "MC" || m.status === "LD") {
    const days = bpInclusiveDays(m);
    return days ? `${days}D ${m.status}` : m.status;
  }
  return m.status;
}
// The six field lines for one report-sick entry (S/N supplied by the caller,
// which restarts numbering per URTI/NON-URTI sub-section — spec §10.2).
function bpSickEntryLines(m, sn) {
  return [
    bpKV("S/N", bp2(sn)),
    bpKV("R/N", sickRN(m.d4)),
    bpKV("DATE", bpDDMMYY(displayDateToISO(m.date))),
    bpKV("LOCATION", m.location || configGet("defaultSickLocation")),
    bpKV("PURPOSE", m.reason || ""),
    bpKV("FOLLOW UP STATUS FROM MO", bpSickFollowUp(m))
  ];
}
// Emit a URTI block then a NON-URTI block (both always shown with counts), S/N
// restarting in each. Returns a line array.
function bpSickUrtiBlocks(reports) {
  const urti = reports.filter(m => bpUrtiOf(m) === "URTI");
  const nonUrti = reports.filter(m => bpUrtiOf(m) === "NON-URTI");
  // Each entry is ONE chunk (its 6 field lines single-spaced, joined by "\n").
  // The callers join chunks with "\n\n", so blank lines fall only between
  // entries and around the URTI/NON-URTI count headers — matching the updated
  // Message Formats.md (DECISIONS #45). Field lines within an entry are no
  // longer double-spaced.
  const lines = [`URTI: ${bp2(urti.length)}`];
  urti.forEach((m, i) => lines.push(bpSickEntryLines(m, i + 1).join("\n")));
  lines.push(`NON-URTI: ${bp2(nonUrti.length)}`);
  nonUrti.forEach((m, i) => lines.push(bpSickEntryLines(m, i + 1).join("\n")));
  return lines;
}

// §10.1 — single report-sick message: header → URTI block → NON-URTI block.
function generateRSFormat(dateIso, time) {
  const reports = bpSickReports(dateIso);
  const lines = [`${bpDDMMYY(dateIso)} ${configGet("companyCoyCode")} ${configGet("unitCode")} ${bpTimeH(time)}`];
  lines.push(...bpSickUrtiBlocks(reports));
  return lines.join("\n\n");
}

// §10.2 — company-wide RSI personnel, broken by platoon. Only platoons (and HQ)
// with ≥1 report-sick entry are shown; TOTAL = sum across them.
// scopeCode: optional platoon code (e.g. "PLT1", "HQ") to restrict output to a
// single platoon; "" or omitted → full company output (backward-compatible).
function generateRSIPersonnel(dateIso, time, scopeCode) {
  scopeCode = scopeCode || "";
  const reports = bpSickReports(dateIso);
  const platoonOf = d4 => {
    const r = STATE.roster.find(x => x.id == d4);
    return r ? personPlatoon(r) : "";
  };
  const scoped = scopeCode ? reports.filter(m => platoonOf(m.d4) === scopeCode) : reports;
  const byPlt = {};
  scoped.forEach(m => { (byPlt[platoonOf(m.d4)] = byPlt[platoonOf(m.d4)] || []).push(m); });

  const scopeTag = scopeCode
    ? (scopeCode === "HQ" ? (configGet("hqLabel") || "HQ") : `PLATOON ${String(scopeCode).replace(/^PLT/i, "")}`)
    : "";
  const header = scopeCode ? `RSI PERSONNEL ${bpDDMMYY(dateIso)} ${bpTimeH(time)} — ${scopeTag}` : `RSI PERSONNEL ${bpDDMMYY(dateIso)} ${bpTimeH(time)}`;
  const lines = [header, `TOTAL: ${bp2(scoped.length)} PAX`];

  const known = activePlatoons().map(p => p.code);
  const codes = Object.keys(byPlt);
  const ordered = known.filter(c => byPlt[c]).concat(codes.filter(c => !known.includes(c)));
  ordered.forEach(code => {
    const members = byPlt[code];
    if (!members || !members.length) return;
    const label = code === "HQ" ? configGet("hqLabel")
      : code ? `PLATOON ${String(code).replace(/^PLT/i, "")}` : "UNASSIGNED";
    lines.push(`${label}: ${bp2(members.length)} PAX`);
    lines.push(...bpSickUrtiBlocks(members));
  });
  return lines.join("\n\n");
}
