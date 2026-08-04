// Who may hold a given duty slot (MD_Docs/DUTY_LIST_SPEC.md §5).
//
// PURE MODULE — no STATE, no DOM. Roster and config arrive as arguments.
//
// The single most important property of this file is what it CANNOT do: it has no
// parameter through which stored Duty rows could arrive, so it is structurally
// incapable of retroactively invalidating one (spec §5.1.1/§5.1.2). Eligibility is
// evaluated once, at assignment time; a stored row is a historical fact, not a live
// query. If a commander later moves from PLT4 to PLT2, their old PDS 4 rows keep
// counting and keep their PLT4 literal, and no past total moves.
//
// Do not add a roster-wide re-validation pass here. That would be the whole bug.

function dutyTypeEntry(cfg, dutyType) {
  const types = (cfg && cfg.dutyTypes) || [];
  for (let i = 0; i < types.length; i++) if (types[i].name === dutyType) return types[i];
  return null;
}

function dutyTypeScope(cfg, dutyType) {
  const t = dutyTypeEntry(cfg, dutyType);
  return t ? t.scope : "company";
}

// ── Appointment ──────────────────────────────────────────────────────────────
// Which appointment a duty draws from is CONFIG, not code: `appointments` on a
// dutyTypes entry (spec §3.5/§5). CDO is the PC duty, CDS the PS duty, COS and
// PDS the section-commander duties — but that is a statement about this company,
// not about the app, so it is editable from the Config sheet like every other
// duty rule. A type with no `appointments` key is unrestricted, which is what
// keeps a hand-added duty type working without a config migration.
function dutyTypeAppointments(cfg, dutyType) {
  const t = dutyTypeEntry(cfg, dutyType);
  const a = t && t.appointments;
  return a && a.length ? a.map(function (x) { return dutyCanonAppointment(x); }) : null;
}

// Canonical appointment codes: "PC", "PS", "SectComd". The sheet is typed by
// hand, so accept the spellings a person actually writes rather than making a
// backfill typo look like an empty duty roster.
function dutyCanonAppointment(v) {
  const s = String(v || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "";
  if (s === "pc" || s === "platooncommander") return "PC";
  if (s === "ps" || s === "platoonsergeant" || s === "platoonsgt") return "PS";
  if (s === "sc" || s === "sectcomd" || s === "sectioncommander" ||
      s === "sectcommander" || s === "sectioncomd") return "SectComd";
  return "";
}

// A person's appointment. Prefers the explicit `appointment` roster column; falls
// back to the org model so the rules work on day one, before anyone has backfilled
// the new column (the same "explicit column wins, otherwise derive" shape as
// personPlatoon/personSection/rankGroupOf in helpers.js).
//
// The ladder has three tiers: the explicit column, then the appointment code
// carried in the fourD column, then the org model.
//
// The fourD tier is the one that does the real work. Commanders' 4Ds name their
// appointment outright — "PC2" is the platoon commander of platoon 2 — which the
// org-model tier below cannot reproduce: `section` is "Command" for the PC and
// the PS alike, and separating them needs the rankGroup column, which is blank
// on most rows. Without this tier the CDO/CDS pools came up empty until someone
// hand-backfilled the appointment column. See js/appointment-4d.js.
//
// The org-model tier below remains, for rows carrying no appointment code at all.
// It is deliberately incomplete: a numbered section means section commander
// unambiguously, but "Command" with a blank rankGroup returns "" rather than
// guessing. A blank appointment is offered for no duty at all, which surfaces as
// an empty dropdown: visible, and fixed by filling the column in. Guessing would
// instead put the PS on CDO silently, which is the failure nobody catches.
function dutyAppointmentOf(r) {
  if (!r) return "";
  const explicit = dutyCanonAppointment(r.appointment);
  if (explicit) return explicit;
  const appt = parseAppointment4D(r.fourD);
  if (appt) return appt.appointment;
  const sect = String(r.section || "").trim();
  if (/^\d+$/.test(sect)) return "SectComd";
  if (sect === "Command") {
    const g = String(r.rankGroup || "").trim().toLowerCase();
    if (g.indexOf("off") === 0) return "PC";
    if (g.indexOf("wo") === 0 || g.indexOf("spec") === 0) return "PS";
  }
  return "";
}

// Company-scoped types occupy one unnamed column; platoon-scoped types get one
// column per live platoon, read from STATE.platoons by the caller rather than
// hardcoded — the number and numbering of platoons can change. HQ is excluded
// because it is not a PLT*, which is exactly why "HQ has no PDS" needs no special
// case of its own.
function dutyPlatoonsFor(dutyType, platoons, cfg) {
  if (dutyTypeScope(cfg, dutyType) !== "platoon") return [""];
  const out = [];
  const list = platoons || [];
  for (let i = 0; i < list.length; i++) {
    const name = typeof list[i] === "string" ? list[i] : (list[i] && list[i].name);
    if (name && name !== "HQ") out.push(name);
  }
  return out;
}

function dutyIsActive(r) {
  const s = String((r && r.status) || "").toLowerCase();
  return s !== "departed" && s !== "inactive";
}

// Base pool: commanders (the org model gives them 4Ds 0001-0099) plus any explicit
// opt-ins from Config.
//
// dutyExtraEligible lives in Config rather than in the auth model because
// eligibility is not a security boundary — being offered in a dropdown grants
// nothing. The duty-PLANNING permission is a boundary, and it deliberately does
// NOT live in Config, because Config is an ordinary writable tab that any
// commander could edit to grant themselves access (spec §9.1).
function dutyExtraSet(cfg) {
  const extra = (cfg && cfg.dutyExtraEligible) || [];
  return new Set(extra.map(function (x) { return String(x); }));
}

function dutyBasePool(roster, cfg) {
  const extraSet = dutyExtraSet(cfg);
  const out = [];
  const list = roster || [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || !r.id) continue;
    if (r.role === "Commander" || extraSet.has(String(r.id))) out.push(r);
  }
  return out;
}

function dutyEligible(dutyType, platoon, isoDate, roster, cfg, opts) {
  const scope = dutyTypeScope(cfg, dutyType);
  const wanted = dutyTypeAppointments(cfg, dutyType);
  const extraSet = dutyExtraSet(cfg);
  const pool = dutyBasePool(roster, cfg);
  const out = [];

  for (let i = 0; i < pool.length; i++) {
    const r = pool[i];
    if (!dutyIsActive(r)) continue;
    if (scope === "platoon") {
      // Blank platoon means unplaced, which never holds a platoon duty. HQ is
      // rejected explicitly rather than relied on to be unreachable: dutyPlatoonsFor
      // never emits an HQ column, but a hand-written or imported row can still ask,
      // and "HQ has no PDS" should be true of the rule and not just of the caller.
      if (!r.platoon || r.platoon === "HQ" || r.platoon !== platoon) continue;
      // The PC/PS exclusion is a property of platoon SCOPE, not of the appointment
      // list, so it survives a duty type configured without `appointments` — a
      // platoon duty belongs to that platoon's sections, and the spec §5 rule
      // ("section !== 'Command'") is what says so. With the default config it is
      // redundant, since SectComd already excludes them; that redundancy is the
      // point. Blank section is HQ-flat, which never holds a platoon duty either.
      const sect = String(r.section || "");
      if (sect === "Command" || sect === "") continue;
    }
    // Appointment rule. Note it is applied WITHOUT a platoon test of its own, so
    // an HQ WOSPEC carrying a section-commander appointment is offered for COS —
    // the company-scoped section-commander duty — while still being excluded from
    // every PDS column by the platoon scope above. That is the intended reading:
    // COS asks what appointment you hold, not which platoon you hold it in.
    //
    // dutyExtraEligible bypasses this. It is the Config escape hatch for someone
    // outside the org model entirely, so filtering it by an appointment it was
    // never going to have would make the key grant nothing and quietly break the
    // only lever an admin has.
    if (wanted && !extraSet.has(String(r.id))) {
      if (wanted.indexOf(dutyAppointmentOf(r)) === -1) continue;
    }
    out.push(String(r.id));
  }

  // Grandfathering (§5.1.3): whoever already holds this row is always offered, even
  // if they have since transferred platoon or left the company. Otherwise reopening
  // a past row to edit an unrelated field would silently drop the person who
  // actually did the duty. This admits exactly one extra person and is not a
  // general bypass.
  const cur = opts && opts.currentAssignee ? String(opts.currentAssignee) : "";
  if (cur && out.indexOf(cur) === -1) out.push(cur);

  return out;
}

// ── Platoon colour ramps ─────────────────────────────────────────────────────
// Lives here rather than in the view because it is the same org-model knowledge
// the eligibility rules above encode: what "Command" means, and that sections are
// numbered. The view just paints what this returns.

// Position in a platoon's ramp. Index 0 is the Command element — PC and PS share
// one colour deliberately, which also covers a platoon carrying two PCs or two
// PSs. Sections 1..n take indexes 1..n.
function dutyColourIndexForSection(section) {
  const s = String(section || "").trim();
  if (s === "Command") return 0;
  const n = parseInt(s, 10);
  return n > 0 ? n : -1;
}

function dutyColourFor(platoon, section, cfg) {
  const ramps = (cfg && cfg.dutyPlatoonColours) || {};
  const ramp = ramps[platoon];
  if (!ramp || !ramp.length) return "";     // unknown platoon → no colour beats a wrong one
  const i = dutyColourIndexForSection(section);
  if (i < 0) return "";
  // Clamp rather than wrap. Wrapping would hand section 5 the Command colour,
  // which reads as a claim about the org chart that isn't true; clamping just
  // says "one more of this platoon's shade". The ramps run dark→light, so the
  // clamped end is the lightest, not a collision.
  return ramp[Math.min(i, ramp.length - 1)] || "";
}

// Readable foreground for a ramp colour. The palettes span #900b0a to #fff176,
// so any fixed foreground is unreadable at one end; pick by relative luminance.
function dutyContrastText(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return "";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  // Rec. 601 luma — cheap, and adequate for a two-way black/white decision.
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#000000" : "#ffffff";
}

// Node test export (browser ignores `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { dutyTypeScope, dutyTypeAppointments, dutyCanonAppointment, dutyAppointmentOf,
                     dutyPlatoonsFor, dutyIsActive, dutyExtraSet, dutyBasePool, dutyEligible,
                     dutyColourIndexForSection, dutyColourFor, dutyContrastText };
}
