// Conduct registry: the legacy-string migration, CRUD, and the conduct picker widget.
//
// Split out of the original monolithic forms.js. Same classic
// <script> tag, same shared global scope, NO module boundary — this is purely a
// filing change. The parts were cut on line boundaries and their concatenation
// is byte-identical to the pre-split file, so nothing about load or execution
// order changed. index.html must keep these tags in the original top-to-bottom
// sequence; reordering them is a real breakage with no compile error.

// ─── CONDUCT REGISTRY MIGRATION ──────────────────────────
// Promotes legacy free-text `conduct` strings on attendance/polar/conductDetail
// records into a stable `conductId` referencing STATE.conducts. Runs once on
// the first launch after the refactor ships (detected by an empty registry
// alongside any record that still carries a string `conduct` field).

// True if there's legacy data that hasn't been migrated yet.
function needsConductMigration() {
  if ((STATE.conducts || []).length > 0) return false;
  const hasLegacy = (arr) => (arr || []).some(r => typeof r?.conduct === "string" && r.conduct.trim());
  return hasLegacy(STATE.attendance) || hasLegacy(STATE.polar) || hasLegacy(STATE.conductDetail);
}

// In-memory working state for the review modal. Each group:
//   { gid: "g0", canonical: "Orientation Run", variants: [{name, count}, …], count, key }
// gid is a temporary id used only by modal event handlers — the real
// conductId is assigned at commit time.
let _conductMigrationGroups = null;

// Group every unique conduct string across attendance / polar / conductDetail
// by normalizeConductKey. For each bucket, pick the most-frequent variant
// as the proposed canonical name (ties broken by longest, since the longer
// variant usually has the full punctuation/capitalization). Sorted by
// total usage descending so heavy-traffic conducts surface first in the modal.
function buildConductRegistryProposal() {
  const buckets = new Map();
  const accumulate = (arr) => (arr || []).forEach(r => {
    const raw = r?.conduct;
    if (typeof raw !== "string" || !raw.trim()) return;
    const key = normalizeConductKey(raw);
    if (!buckets.has(key)) buckets.set(key, new Map());
    const variants = buckets.get(key);
    variants.set(raw, (variants.get(raw) || 0) + 1);
  });
  accumulate(STATE.attendance);
  accumulate(STATE.polar);
  accumulate(STATE.conductDetail);

  const out = [];
  for (const [key, variants] of buckets) {
    const sorted = [...variants.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    const canonical = sorted[0][0];
    const total = sorted.reduce((s, [, n]) => s + n, 0);
    out.push({
      key,
      canonical,
      variants: sorted.map(([name, count]) => ({ name, count })),
      count: total
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

// Called from bootstrap on launch and as a manual fallback from the Conducts
// admin tab. Opens the review modal only if there's actually legacy data to
// migrate; otherwise no-op.
function maybeRunConductMigration() {
  if (!needsConductMigration()) return;
  openConductReviewModal();
}

function openConductReviewModal() {
  const proposal = buildConductRegistryProposal();
  if (proposal.length === 0) {
    alert("No legacy conducts to migrate.");
    return;
  }
  _conductMigrationGroups = proposal.map((p, i) => ({ ...p, gid: "g" + i }));
  renderConductReviewModal();
}

function renderConductReviewModal() {
  const groups = _conductMigrationGroups;
  const body = `
    <p style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">
      Each entry below becomes one conduct in the registry with a stable ID. Records
      using any variant beneath get repointed to that ID. Spaces are shown as · so
      hidden whitespace differences are visible.
    </p>
    <div id="conduct-review-list" style="display:flex;flex-direction:column;gap:8px;max-height:55vh;overflow-y:auto">
      ${groups.map(g => `
        <div class="card" style="padding:10px 12px;background:var(--surface2)" data-gid="${g.gid}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <input type="text" value="${escapeAttr(g.canonical)}" oninput="updateConductGroupName('${g.gid}', this.value)" style="flex:1;font-weight:600;font-size:13px;padding:5px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text)">
            <span style="font-size:11px;color:var(--muted);white-space:nowrap">${g.count} rec${g.count === 1 ? "" : "s"}</span>
            <button class="btn btn-icon btn-danger" title="Drop this conduct (records using it will have an empty conductId)" onclick="dropConductGroup('${g.gid}')">✕</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;font-size:11px">
            ${g.variants.map(v => {
              const visible = escapeAttr(v.name).replace(/ /g, '·');
              const enc = encodeURIComponent(v.name);
              return `
                <div style="display:flex;align-items:center;gap:6px;padding:3px 6px;background:var(--surface);border-radius:3px">
                  <code style="flex:1;font-family:var(--mono);color:var(--text);font-size:11px">"${visible}"</code>
                  <span style="color:var(--muted);min-width:28px;text-align:right">${v.count}×</span>
                  <button class="btn btn-icon" title="Split this variant into its own new conduct" onclick="splitConductVariant('${g.gid}', decodeURIComponent('${enc}'))">⤴</button>
                  <select onchange="if (this.value) { moveConductVariant('${g.gid}', decodeURIComponent('${enc}'), this.value); this.value=''; }" style="font-size:10px;padding:2px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px">
                    <option value="">Merge →</option>
                    ${groups.filter(o => o.gid !== g.gid).map(o => `<option value="${o.gid}">${escapeAttr(o.canonical).slice(0, 40)}</option>`).join("")}
                  </select>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `).join("")}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
      <span style="font-size:11px;color:var(--muted)">${groups.length} conduct${groups.length === 1 ? "" : "s"} · ${groups.reduce((s, g) => s + g.count, 0)} records</span>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="closeModal()">Review later</button>
        <button class="btn btn-success" onclick="commitConductMigration()">Commit migration</button>
      </div>
    </div>
  `;
  openModal(`Review conducts (${groups.length})`, body);
}

function updateConductGroupName(gid, name) {
  const g = _conductMigrationGroups.find(x => x.gid === gid);
  if (g) g.canonical = name;
}

function dropConductGroup(gid) {
  if (!confirm("Drop this conduct? Records using its variants will have an empty conductId after migration.")) return;
  _conductMigrationGroups = _conductMigrationGroups.filter(g => g.gid !== gid);
  renderConductReviewModal();
}

function splitConductVariant(gid, variantName) {
  const g = _conductMigrationGroups.find(x => x.gid === gid);
  if (!g) return;
  const idx = g.variants.findIndex(v => v.name === variantName);
  if (idx === -1) return;
  const v = g.variants.splice(idx, 1)[0];
  g.count -= v.count;
  const maxN = _conductMigrationGroups.reduce((m, x) => Math.max(m, parseInt(x.gid.slice(1), 10) || 0), -1);
  _conductMigrationGroups.push({ gid: "g" + (maxN + 1), canonical: v.name, variants: [v], count: v.count, key: normalizeConductKey(v.name) });
  if (g.variants.length === 0) _conductMigrationGroups = _conductMigrationGroups.filter(x => x.gid !== gid);
  renderConductReviewModal();
}

function moveConductVariant(fromGid, variantName, toGid) {
  const from = _conductMigrationGroups.find(x => x.gid === fromGid);
  const to = _conductMigrationGroups.find(x => x.gid === toGid);
  if (!from || !to) return;
  const idx = from.variants.findIndex(v => v.name === variantName);
  if (idx === -1) return;
  const v = from.variants.splice(idx, 1)[0];
  from.count -= v.count;
  const dup = to.variants.find(x => x.name === v.name);
  if (dup) dup.count += v.count;
  else to.variants.push(v);
  to.count += v.count;
  if (from.variants.length === 0) _conductMigrationGroups = _conductMigrationGroups.filter(x => x.gid !== fromGid);
  renderConductReviewModal();
}

async function commitConductMigration() {
  const groups = _conductMigrationGroups;
  if (!groups || groups.length === 0) { closeModal(); return; }

  // Validate: every group needs a non-empty canonical name.
  const blank = groups.find(g => !g.canonical || !g.canonical.trim());
  if (blank) { alert("One or more conducts have an empty name. Fill them in or drop them, then commit again."); return; }

  // Assign final ids; build name→id and key→id maps for rewriting records.
  const registry = groups.map((g, i) => ({ id: "c" + String(i + 1).padStart(3, "0"), name: g.canonical.trim() }));
  const nameToId = new Map();
  const keyToId = new Map();
  groups.forEach((g, i) => {
    g.variants.forEach(v => nameToId.set(v.name, registry[i].id));
    keyToId.set(g.key, registry[i].id);
  });

  // Repoint every record: lookup by exact variant name first (preserves any
  // user-driven re-grouping done in the modal), then fall back to normalized
  // key (covers records that share a key with a known variant but had a
  // string we didn't see — defensive).
  const rewrite = (arr) => (arr || []).forEach(r => {
    if (typeof r.conduct !== "string") return;
    const id = nameToId.get(r.conduct) || keyToId.get(normalizeConductKey(r.conduct)) || "";
    r.conductId = id;
    delete r.conduct;
  });
  rewrite(STATE.attendance);
  rewrite(STATE.polar);
  rewrite(STATE.conductDetail);

  STATE.conducts = registry;
  // Backfill LMS counts now that polar/attendance can finally join on
  // conductId. Before this migration the LMS column was likely stale on rows
  // where the conduct string had any drift between the two layers. (Count only —
  // this migration re-pushes the whole Attendance tab below anyway.)
  const lmsChanged = recomputeAttendanceLmsFromPolar().length;
  saveLocal();
  closeModal();
  render();

  // The sheet push is part of the atomic migration — not optional. If we
  // skipped it, future appendRow/appendMany on PolarFlow / Attendance /
  // ConductDetail would write into the OLD schema (which still has a
  // `conduct` column, not `conductId`), silently dropping the conductId
  // values. Push all four tabs via autoSync so the indicator + dirty-
  // tracking handle any failure — user can retry from the sidebar.
  if (STATE.apiUrl) {
    autoSync("Conducts", { type: "replace", data: STATE.conducts });
    autoSync("Attendance", { type: "replace", data: STATE.attendance });
    autoSync("PolarFlow", { type: "replace", data: STATE.polar });
    autoSync("ConductDetail", { type: "replace", data: STATE.conductDetail });
  }
  alert(`Migrated ${registry.length} conduct${registry.length === 1 ? "" : "s"} and syncing to the Google Sheet.\n${lmsChanged ? `Backfilled LMS on ${lmsChanged} attendance row${lmsChanged === 1 ? "" : "s"} from Polar data.\n` : ""}\nConducts tab created; Attendance / PolarFlow / ConductDetail now use the conductId column.\n\nWatch the sidebar sync indicator — if any push fails, click "Retry now" to re-send.`);
}

// ─── CONDUCT REGISTRY CRUD ───────────────────────────────
// Create a new conduct from any UI that has access to a name string. If a
// conduct with the same normalized name already exists, returns its id
// (idempotent) so the calling form can just select the existing entry.
function createConduct(name) {
  const clean = String(name || "").trim();
  if (!clean) return "";
  const existing = conductIdByName(clean);
  if (existing) return existing;
  const id = nextConductId();
  const entry = { id, name: clean, className: "", classSeq: 0, makeupFor: "" };
  STATE.conducts.push(entry);
  saveLocal();
  // Auto-push the new row — the original bug fix. Other devices pulling
  // immediately after will resolve the new conductId to its name instead
  // of showing `[c00X?]` placeholders.
  autoSync("Conducts", { type: "append", row: entry });
  return id;
}

// Groups of conducts that share the same id (data corruption from the old
// max+1 id scheme). Returns [{ id, conducts: [refs…] }] for ids used >1 time.
function duplicateConductIdGroups() {
  const byId = {};
  (STATE.conducts || []).forEach(c => { (byId[c.id] = byId[c.id] || []).push(c); });
  return Object.keys(byId)
    .filter(id => byId[id].length > 1)
    .map(id => ({ id, conducts: byId[id] }));
}

// Repair modal: for each shared id, the user picks which conduct KEEPS the id
// (and therefore the records logged under it — they're ambiguous, so only the
// owner the user knows about can claim them). The other conducts in the group
// get fresh unique ids and start empty.
function openFixConductIdsModal() {
  const groups = duplicateConductIdGroups();
  if (!groups.length) { alert("No duplicate conduct ids — nothing to fix."); return; }
  const blocks = groups.map((g, gi) => {
    const u = countConductUsage(g.id);
    const usage = `${u.attendance} attendance · ${u.polar} polar · ${u.detail} detail (${u.total} record${u.total === 1 ? "" : "s"})`;
    const opts = g.conducts.map((c, ci) => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;background:var(--surface2);margin-bottom:4px">
        <input type="radio" name="dup-${gi}" value="${ci}" ${ci === 0 ? "checked" : ""} style="width:14px;height:14px">
        <span style="font-weight:600">${escapeAttr(c.name)}</span>
      </label>`).join("");
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;margin-bottom:2px">Shared id <span class="mono" style="color:var(--accent)">${g.id}</span></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${usage} — these stay with the conduct you pick:</div>
      ${opts}
    </div>`;
  }).join("");
  openModal("Fix duplicate conduct ids", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;line-height:1.55">
        ${groups.length} id${groups.length === 1 ? " is" : "s are"} shared by multiple conducts, so their records resolve to the wrong name. Pick which conduct keeps each id (and its existing records); the others get fresh, empty ids. Records can't be auto-split — if some belong to a renamed conduct, re-point them after via <strong>Merge</strong> or by editing.
      </div>
      ${blocks}
      <button type="button" class="btn btn-primary" onclick="applyConductIdFixes()">Fix ids</button>
    </div>`);
}

function applyConductIdFixes() {
  const groups = duplicateConductIdGroups();
  let reassigned = 0;
  groups.forEach((g, gi) => {
    const sel = document.querySelector(`input[name="dup-${gi}"]:checked`);
    const keepIdx = sel ? +sel.value : 0;
    g.conducts.forEach((c, ci) => {
      if (ci === keepIdx) return;   // this one keeps the original id + records
      c.id = nextConductId();        // others get a fresh, unique, empty id
      reassigned++;
    });
  });
  saveLocal();
  closeModal();
  render();
  // Ids changed on existing rows, so a full rewrite (not per-row upsert) is the
  // safe way to persist — upsert would append new rows and orphan the old ones.
  if (STATE.apiUrl) pushTab("Conducts", STATE.conducts);
  alert(`Reassigned ${reassigned} conduct id${reassigned === 1 ? "" : "s"}.\nRecords stayed with the conduct you chose; the rest now have fresh, empty ids.`);
}

function renameConduct(id, newName) {
  const c = STATE.conducts.find(x => x.id === id);
  if (!c) return;
  const clean = String(newName || "").trim();
  if (!clean) { alert("Conduct name cannot be empty."); return; }
  const conflict = STATE.conducts.find(x => x.id !== id && normalizeConductKey(x.name) === normalizeConductKey(clean));
  if (conflict) { alert(`"${clean}" already exists (${conflict.id}). Use Merge instead.`); return; }
  c.name = clean;
  saveLocal();
  autoSync("Conducts", { type: "upsert", row: c });
  render();
}

// Merges one conduct into another: every record pointing to fromId is
// repointed to toId, then fromId is removed from the registry. Used both
// from the admin tab and indirectly from migration edits.
function mergeConductInto(fromId, toId) {
  if (fromId === toId) return;
  const from = STATE.conducts.find(x => x.id === fromId);
  const to = STATE.conducts.find(x => x.id === toId);
  if (!from || !to) return;
  if (!confirm(`Merge "${from.name}" → "${to.name}"?\n\nAll records currently using "${from.name}" will be repointed to "${to.name}", and "${from.name}" will be removed from the registry.\n\nThis touches every record across Attendance, ConductDetail, and PolarFlow — those tabs will be re-pushed.`)) return;
  const repoint = (arr) => (arr || []).forEach(r => { if (r.conductId === fromId) r.conductId = toId; });
  repoint(STATE.attendance);
  repoint(STATE.polar);
  repoint(STATE.conductDetail);
  STATE.conducts = STATE.conducts.filter(x => x.id !== fromId);
  saveLocal();
  // Surgical delete on the registry, full replace on the affected child
  // tabs (mergeConductInto rewrites N rows per tab — full replace is the
  // honest "this is a bulk rewrite" signal).
  autoSync("Conducts", { type: "delete", id: fromId });
  autoSync("Attendance", { type: "replace", data: STATE.attendance });
  autoSync("ConductDetail", { type: "replace", data: STATE.conductDetail });
  autoSync("PolarFlow", { type: "replace", data: STATE.polar });
  render();
}

// Registry: set a conduct's manual class label. Empty string clears it (the conduct
// then reverts to name-based auto-detection in the Conduct Dashboard). On first
// assigning a non-empty class with no seq yet, default the seq to (max in class)+1.
function setConductClass(id, className) {
  const c = STATE.conducts.find(x => x.id === id);
  if (!c) return;
  const clean = String(className == null ? "" : className).trim();
  c.className = clean;
  if (clean && (!c.classSeq || c.classSeq < 1)) c.classSeq = _nextClassSeq(id, clean);
  _pushConductsRegistry();
}

// Next free ordinal within a manual class: (highest classSeq already used in that
// class) + 1, excluding the conduct being edited. Used to auto-assign a distinct
// positive seq so a manually-classed conduct never falls back to its name number.
function _nextClassSeq(excludeId, className) {
  const clean = String(className == null ? "" : className).trim();
  const maxSeq = STATE.conducts.reduce((m, x) =>
    (x.id !== excludeId && (x.className || "").trim() === clean && Number(x.classSeq) > m) ? Number(x.classSeq) : m, 0);
  return maxSeq + 1;
}

// Registry: set a conduct's explicit ordinal within its class. Coerced to a
// non-negative integer (0 = "unset" → the Dash falls back to the name's number).
// But a MANUALLY-classed conduct must never be left at 0: conductClassSeq() would
// then fall back to the name's trailing number, which can collide with a sibling
// in the same class and silently merge two instances in the progression list (a
// recruit who missed one of the two num-collided instances reads as on-track).
// So when a className is set, a blank/<1 seq snaps to the next free ordinal.
function setConductClassSeq(id, seq) {
  const c = STATE.conducts.find(x => x.id === id);
  if (!c) return;
  let n = Math.max(0, Math.floor(Number(seq) || 0));
  if (n < 1 && (c.className || "").trim()) n = _nextClassSeq(id, c.className);
  c.classSeq = n;
  _pushConductsRegistry();
}

// Registry: point a conduct at the instance it makes up for. Empty clears it; a
// self-reference is ignored (a conduct cannot make up for itself).
function setConductMakeupFor(id, targetId) {
  const c = STATE.conducts.find(x => x.id === id);
  if (!c) return;
  const t = String(targetId == null ? "" : targetId);
  c.makeupFor = (t && t !== id) ? t : "";
  _pushConductsRegistry();
}

// Shared persist+resync+rerender for the three registry mutators above. Mirrors the
// replace-push pattern used elsewhere for the Conducts tab.
function _pushConductsRegistry() {
  saveLocal();
  if (STATE.apiUrl) autoSync("Conducts", { type: "replace", data: STATE.conducts });
  render();
}

// Deleting a conduct cascades: every Attendance / PolarFlow / ConductDetail
// row referencing it is permanently removed too (not just unlinked), since
// those rows are meaningless without the conduct they describe. Surgical
// delete on the registry, full replace on the affected child tabs — same
// pattern as mergeConductInto's bulk rewrite.
function deleteConduct(id) {
  const c = STATE.conducts.find(x => x.id === id);
  if (!c) return;
  const usage = countConductUsage(id);
  const msg = usage.total > 0
    ? `Delete "${c.name}"? This will permanently delete ${usage.total} record${usage.total === 1 ? "" : "s"} that reference it (${usage.attendance} attendance, ${usage.polar} polar, ${usage.detail} detail). This cannot be undone.`
    : `Delete "${c.name}"? It has no records using it.`;
  if (!confirm(msg)) return;
  STATE.attendance = STATE.attendance.filter(r => r.conductId !== id);
  STATE.polar = STATE.polar.filter(r => r.conductId !== id);
  STATE.conductDetail = STATE.conductDetail.filter(r => r.conductId !== id);
  STATE.conducts = STATE.conducts.filter(x => x.id !== id);
  saveLocal();
  // allowEmpty: deleting the only conduct that had records leaves these arrays
  // genuinely empty, and a full replace with no rows is a delete-every-row that
  // the backend otherwise refuses (an empty array is normally a symptom of a
  // local copy that failed to load, not an intention). Here it IS the
  // intention — the user confirmed the cascade above — so say so.
  autoSync("Conducts", { type: "delete", id });
  if (usage.attendance > 0) autoSync("Attendance", { type: "replace", data: STATE.attendance, allowEmpty: true });
  if (usage.polar > 0) autoSync("PolarFlow", { type: "replace", data: STATE.polar, allowEmpty: true });
  if (usage.detail > 0) autoSync("ConductDetail", { type: "replace", data: STATE.conductDetail, allowEmpty: true });
  render();
}

function countConductUsage(id) {
  const attendance = STATE.attendance.filter(r => r.conductId === id).length;
  const polar = STATE.polar.filter(r => r.conductId === id).length;
  const detail = STATE.conductDetail.filter(r => r.conductId === id).length;
  return { attendance, polar, detail, total: attendance + polar + detail };
}

// ─── CONDUCT PICKER (form widget) ────────────────────────
// Renders the conduct <select> used by attendance / conductDetail / polar
// staging forms. Selecting "+ New conduct" prompts for a name inline, creates
// the registry entry, and selects its id. The hidden input mirrors the
// current id so form submit handlers can read it via gv(inputId).
//
//   conductPicker({ inputId, selectedId, onChange })
//     inputId:    DOM id of the hidden input that stores the conductId
//     selectedId: pre-selected conductId (e.g. when editing an existing row)
//     onChange:   optional JS expression run after selection changes
//                 (use to update derived form fields like inferred time)
function conductPicker({ inputId, selectedId = "", onChange = "" }) {
  const opts = getAllConducts();
  const onChangeJS = `handleConductPickerChange('${inputId}', this); ${onChange}`;
  return `
    <input type="hidden" id="${inputId}" value="${escapeAttr(selectedId)}">
    <select onchange="${onChangeJS}" style="width:100%;padding:7px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:13px">
      <option value="" ${selectedId ? "" : "selected"}>— pick a conduct —</option>
      <option value="__new__">+ New conduct…</option>
      ${opts.map(c => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escapeAttr(c.name)}</option>`).join("")}
    </select>
  `;
}

// Companion to conductPicker(). When the user picks "+ New conduct…" we
// prompt for a name, create the registry entry, and select it inline. We
// avoid a full render() here so any modal currently open (e.g. attendance
// form) doesn't get torn down mid-edit.
function handleConductPickerChange(inputId, selectEl) {
  const hidden = document.getElementById(inputId);
  if (!hidden) return;
  if (selectEl.value === "__new__") {
    const name = (prompt("New conduct name:") || "").trim();
    if (!name) {
      selectEl.value = hidden.value || "";
      return;
    }
    const id = createConduct(name);
    hidden.value = id;
    // Patch this select inline so the new option appears + is selected.
    // Other pickers on the page will refresh next time the user opens them.
    const existingOpt = [...selectEl.options].find(o => o.value === id);
    if (!existingOpt) {
      const newOpt = document.createElement("option");
      newOpt.value = id;
      newOpt.textContent = name;
      // Append. "+ New conduct…" sits at the TOP of the list (right under the
      // placeholder) so it stays reachable without scrolling past a long
      // registry — so inserting before it, as this used to do, would now file
      // every new conduct above the real ones instead of among them.
      selectEl.appendChild(newOpt);
    }
    selectEl.value = id;
  } else {
    hidden.value = selectEl.value;
  }
}

// Normalize any date string to ISO ("2026-05-17") so the polar↔attendance
// join works regardless of which format each side was stored in. The two
// sides accumulate different formats over time:
//   - Form-entered attendance:    "17 May 2026" (display, via isoToDisplayDate)
//   - CSV-imported polar:         "2026-05-17" (raw from CSV, untouched)
//   - Photo-extracted polar:      "17 May 2026" (display, via isoToDisplayDate)
//   - Sheet-pulled rows:          either, depending on how the cell was stored
// Returning ISO from every path means joins compare apples to apples.
function dateJoinKey(d) {
  const s = String(d || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = displayDateToISO(s);
  if (iso) return iso;
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  return s;
}

// Builds the conduct-matching key for a record. Prefers conductId (post-
// migration source of truth); falls back to a normalized conduct-name key
// for records that still carry a legacy `conduct` string. Returns "" when
// neither is present so the caller can skip those rows.
function conductJoinKey(rec) {
  if (rec.conductId) return "id:" + rec.conductId;
  if (typeof rec.conduct === "string" && rec.conduct.trim()) return "name:" + normalizeConductKey(rec.conduct);
  return "";
}

// Writes the unique-d4 count from STATE.polar into STATE.attendance[].lms
// for every matching (date, conduct) pair. The Polar class summary photo
// IS the LMS roster for that conduct — same screen, same count — so we
// treat Polar entries as the source of truth for LMS participation. The
// joiner is tolerant of (a) different date formats on each side, and (b)
// records that haven't migrated to conductId yet (falls back to normalized
// conduct-string matching). Returns the number of attendance rows whose
// lms value actually changed.
function recomputeAttendanceLmsFromPolar() {
  const polarByConduct = {};
  STATE.polar.forEach(p => {
    const ck = conductJoinKey(p);
    if (!ck) return;
    const k = `${dateJoinKey(p.date)}|${ck}`;
    (polarByConduct[k] = polarByConduct[k] || new Set()).add(padD4(p.d4));
  });
  // Collect the attendance rows whose LMS actually moved so callers can push
  // them individually (OCC-safe upsert) instead of a full-tab replace that
  // clobbers concurrent edits. Returns the array of changed rows.
  const changed = [];
  STATE.attendance.forEach(a => {
    if ("polar" in a) delete a.polar;
    const ck = conductJoinKey(a);
    if (!ck) return;
    const count = polarByConduct[`${dateJoinKey(a.date)}|${ck}`]?.size;
    if (count == null) return;
    if ((+a.lms || 0) !== count) {
      a.lms = count;
      changed.push(a);
    }
  });
  if (changed.length) saveLocal();
  return changed;
}

// Flip a conduct's HA eligibility by toggling the "HA" token on its
// currencyTags (the §14.3 signal — only honoured when Config
// haEligibilitySource is "currencyTag", which is the default). Pushes the FULL
// local row via OCC upsert so sibling fields (participants/periods/source)
// survive the write.
function toggleConductHA(id) {
  const a = STATE.attendance.find(x => x.id === id);
  if (!a) return;
  a.currencyTags = toggleHATag(a.currencyTags);
  saveLocal();
  render();
  if (STATE.apiUrl) autoSync("Attendance", { type: "upsert", row: a });
}

// Human label for a polar/attendance key — used in the diagnostic alert
// so the user can read mismatched entries without decoding "id:c003".
function describeJoinKey(k) {
  const [d, ck] = k.split("|");
  if (ck?.startsWith("id:")) {
    const id = ck.slice(3);
    return `${d} — ${conductName(id) || `(unknown id ${id})`}`;
  }
  if (ck?.startsWith("name:")) {
    return `${d} — "${ck.slice(5)}" (unmigrated legacy string)`;
  }
  return `${d} — ?`;
}

// Manual trigger from the Attendance tab header. Surfaces matched/unmatched
// counts so the user can diagnose why a recompute didn't move some rows.
function refreshLmsFromPolar() {
  const polarKeys = new Set();
  let polarSkipped = 0;
  STATE.polar.forEach(p => {
    const ck = conductJoinKey(p);
    if (!ck) { polarSkipped++; return; }
    polarKeys.add(`${dateJoinKey(p.date)}|${ck}`);
  });
  const attendanceKeys = new Set();
  let attendanceSkipped = 0;
  STATE.attendance.forEach(a => {
    const ck = conductJoinKey(a);
    if (!ck) { attendanceSkipped++; return; }
    attendanceKeys.add(`${dateJoinKey(a.date)}|${ck}`);
  });
  const unmatched = [...polarKeys].filter(k => !attendanceKeys.has(k));
  const matched = [...polarKeys].filter(k => attendanceKeys.has(k));
  const changed = recomputeAttendanceLmsFromPolar().length;   // diagnostic count only
  render();

  let msg = changed
    ? `✓ Updated LMS on ${changed} attendance row${changed === 1 ? "" : "s"} from Polar data.`
    : `No LMS values changed.`;
  msg += `\n\nDiagnostic:`;
  msg += `\n  • Polar (date, conduct) pairs: ${polarKeys.size} unique${polarSkipped ? ` (+ ${polarSkipped} polar rows skipped: no conductId or conduct name)` : ""}`;
  msg += `\n  • Attendance (date, conduct) pairs: ${attendanceKeys.size} unique${attendanceSkipped ? ` (+ ${attendanceSkipped} attendance rows skipped: no conductId or conduct name)` : ""}`;
  msg += `\n  • Matched: ${matched.length} · Unmatched (polar with no attendance row): ${unmatched.length}`;
  if (unmatched.length) {
    const preview = unmatched.slice(0, 8).map(describeJoinKey).join("\n  • ");
    msg += `\n\nUnmatched Polar entries:\n  • ${preview}${unmatched.length > 8 ? `\n  • …and ${unmatched.length - 8} more` : ""}`;
  }
  if (polarSkipped > 0 || attendanceSkipped > 0) {
    msg += `\n\n⚠️ Skipped rows mean the conduct registry migration hasn't completed for them. Run it from the Conducts tab if needed.`;
  }
  if (changed) msg += `\n\n→ Click "Push to Sheet" on the Attendance tab to sync the updated LMS counts back to the Google Sheet.`;
  alert(msg);
}
