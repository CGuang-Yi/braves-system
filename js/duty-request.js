// Duty change requests — the pure half (design §3).
//
// No STATE, no DOM, no clock. Everything here is a function of its arguments,
// which is what lets test/duty-request.test.js load this one file with stubbed
// globals and lets the same rules be hand-ported into apps-script-Code.gs for
// the approval path.
//
// The module exists for ONE reason: dcrDutyMutations() has to have exactly one
// definition. The backend applies it when a request is approved, and the
// submitter's preview shows it before the request is filed. Two implementations
// of "what does approving this do" would drift, and the drift would surface as a
// duty roster that does not match what somebody approved — which nobody would
// think to check, because the request itself would read Approved.
//
// The GAS copy is guarded against drift by test/duty-request-port-parity.test.js,
// the same arrangement js/braves-parade.js has with its port.

const DCR_KINDS = ["add", "remove", "reassign", "swap"];
const DCR_STATUSES = ["Pending", "Approved", "Rejected"];

// Find the Duty row sitting in a slot. A slot is (date, dutyType, platoon) —
// platoon is "" for the company-wide types (CDO/CDS/COS) and a platoon key for
// PDS, exactly as dutyRowAt() in js/forms-duty.js resolves it.
function dcrSlotRow(dutyRows, date, dutyType, platoon) {
  return (dutyRows || []).find(r =>
    r && r.date === date && r.dutyType === dutyType
    && (r.platoon || "") === (platoon || "")) || null;
}

// What approving this request would do to the Duty tab.
//
// Returns {upserts, deletes} rather than performing anything, so the caller
// decides whether that is a preview or a write. `deletes` carries row ids.
//
// Slot-empty handling is deliberate and worth stating: a `reassign` filed
// against a slot that someone has since cleared still lands, as an add. The
// alternative — refusing because the row vanished — would reject a request whose
// intent ("this person should hold this slot") is still perfectly satisfiable,
// and would do so at approval time, long after the submitter could react.
function dcrDutyMutations(req, dutyRows) {
  const out = { upserts: [], deletes: [] };
  if (!req) return out;

  const kind = String(req.kind || "");
  const primary = dcrSlotRow(dutyRows, req.date, req.dutyType, req.platoon);

  // Every row this writes carries source:"request", joining "auto" (scheduler),
  // "manual" and "import", so an assignment's provenance survives the approval.
  const stamp = (row, d4, date, dutyType, platoon) => ({
    id: row ? row.id : "",          // "" means the caller mints one
    date: date,
    dutyType: dutyType,
    platoon: platoon || "",
    d4: d4,
    assignedBy: req.decidedBy || req.submittedBy || "",
    assignedAt: req.decidedAt || "",
    source: "request"
  });

  if (kind === "add" || kind === "reassign") {
    if (req.toD4) out.upserts.push(stamp(primary, req.toD4, req.date, req.dutyType, req.platoon));
  } else if (kind === "remove") {
    if (primary) out.deletes.push(primary.id);
  } else if (kind === "swap") {
    const other = dcrSlotRow(dutyRows, req.swapDate, req.swapDutyType, req.swapPlatoon);
    // Each slot takes the other's holder. Falling back to the request's own
    // fromD4/toD4 covers the case where one side's row was cleared meanwhile —
    // the trade the two people agreed to still happens.
    const primaryHolder = primary ? primary.d4 : req.fromD4;
    const otherHolder = other ? other.d4 : req.toD4;
    if (otherHolder) {
      out.upserts.push(stamp(primary, otherHolder, req.date, req.dutyType, req.platoon));
    }
    if (primaryHolder) {
      out.upserts.push(stamp(other, primaryHolder, req.swapDate, req.swapDutyType, req.swapPlatoon));
    }
  }
  return out;
}

// Problems with a request, as human-readable lines. Empty means submittable.
//
// This is the client-side half of a rule the backend enforces independently
// (dcrGuardWrite_). Both are needed: this one tells the submitter what is wrong
// while they can still fix it, that one is what actually holds.
function dcrValidate(req) {
  const problems = [];
  if (!req || !req.kind || DCR_KINDS.indexOf(String(req.kind)) === -1) {
    problems.push("Pick what kind of change this is.");
    return problems;      // nothing below is meaningful without a kind
  }
  if (!req.date) problems.push("Pick the date of the duty being changed.");
  if (!req.dutyType) problems.push("Pick the duty.");
  if (!String(req.reason || "").trim()) {
    problems.push("Give a reason — a request without one cannot be judged.");
  }

  if (req.kind === "add" && !req.toD4) problems.push("Pick who should take the duty.");
  if (req.kind === "remove" && !req.fromD4) problems.push("Pick who is coming off the duty.");
  if (req.kind === "reassign") {
    if (!req.toD4) problems.push("Pick who should take the duty.");
    if (req.toD4 && req.fromD4 && req.toD4 === req.fromD4) {
      problems.push("That is the same person — nothing would change.");
    }
  }
  if (req.kind === "swap") {
    // The swap* triple is the counterparty's slot. Without it a swap is not
    // expressible at all — see the DutyChangeRequest schema note in
    // apps-script-Code.gs for why it is stored rather than inferred.
    if (!req.toD4) problems.push("Pick who you are swapping with.");
    if (!req.swapDate || !req.swapDutyType) {
      problems.push("Pick the duty you are swapping for.");
    }
    if (req.swapDate === req.date && req.swapDutyType === req.dutyType
        && (req.swapPlatoon || "") === (req.platoon || "")) {
      problems.push("Both sides are the same slot — use Reassign instead.");
    }
  }
  return problems;
}

// Pending first and oldest first, because a queue people are meant to work
// through should surface the thing that has been waiting longest.
function dcrPending(rows) {
  return (rows || [])
    .filter(r => r && String(r.status || "Pending") === "Pending")
    .slice()
    .sort((a, b) => String(a.submittedAt || "").localeCompare(String(b.submittedAt || "")));
}

function dcrDecided(rows) {
  return (rows || [])
    .filter(r => r && String(r.status || "Pending") !== "Pending")
    .slice()
    .sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || "")));
}

// One-line summary, used by both the list and the decision dialog so the two
// cannot describe the same request differently. `name` is injected rather than
// looked up, keeping this module free of STATE.
function dcrLabel(req, name) {
  const nm = d4 => (typeof name === "function" ? name(d4) : d4) || "—";
  const slot = (d, t, p) => t + (p ? " " + String(p).replace(/^PLT/, "") : "") + " on " + d;
  const here = slot(req.date, req.dutyType, req.platoon);
  if (req.kind === "add") return "Add " + nm(req.toD4) + " to " + here;
  if (req.kind === "remove") return "Remove " + nm(req.fromD4) + " from " + here;
  if (req.kind === "reassign") return here + ": " + nm(req.fromD4) + " → " + nm(req.toD4);
  if (req.kind === "swap") {
    return "Swap " + nm(req.fromD4) + " (" + here + ") with " + nm(req.toD4)
      + " (" + slot(req.swapDate, req.swapDutyType, req.swapPlatoon) + ")";
  }
  return here;
}
