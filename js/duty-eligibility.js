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

function dutyTypeScope(cfg, dutyType) {
  const types = (cfg && cfg.dutyTypes) || [];
  for (let i = 0; i < types.length; i++) if (types[i].name === dutyType) return types[i].scope;
  return "company";
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
function dutyBasePool(roster, cfg) {
  const extra = (cfg && cfg.dutyExtraEligible) || [];
  const extraSet = new Set(extra.map(function (x) { return String(x); }));
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
  const pool = dutyBasePool(roster, cfg);
  const out = [];

  for (let i = 0; i < pool.length; i++) {
    const r = pool[i];
    if (!dutyIsActive(r)) continue;
    if (scope === "platoon") {
      if (r.platoon !== platoon) continue;
      // `section` is already "Command" for PC/PS and a number for section
      // commanders, so "that platoon's commanders who are not the PC or PS" needs
      // no new field. Blank means HQ-flat, which never holds a platoon duty.
      const sect = String(r.section || "");
      if (sect === "Command" || sect === "") continue;
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

// Node test export (browser ignores `module`).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { dutyTypeScope, dutyPlatoonsFor, dutyIsActive, dutyBasePool, dutyEligible };
}
