// Duty workbook importer — the browser half of MD_Docs/DUTY_LIST_SPEC.md §7,
// and §1 of MD_Docs/DUTY_UX_AND_RS_SELECTION_SPEC.md.
//
// §12 of the duty spec deferred this UI on the grounds that history loads once
// and the importer would then have no user. That held while the alternative was
// a node script; it does not hold against the actual alternative in the tree,
// tools/duty-import-load.gs, which had to be pasted into the Apps Script editor
// and duplicated every row if it was ever run twice.
//
// The PARSER is not here — it is js/duty-import.js, pure and shared with
// tools/duty-import-run.js. This file is only the plumbing: read a file, flatten
// it, show what was found, and commit on confirmation.

// ExcelJS worksheet → the neutral shape parseDutyWorkbook wants:
//   { name, cells: { "B2": { value, fill } }, maxRow, maxCol }
//
// Fill goes through the parser's own dutyNormFill rather than a local copy, so
// the browser and the node runner cannot disagree about what a colour is. ARGB
// from ExcelJS carries an alpha prefix ("FFF4CCCC"); dutyNormFill is what strips
// it, and duplicating that logic here is exactly how the two paths would drift.
function dutyFlattenWorkbook(wb) {
  const sheets = [];
  wb.eachSheet(ws => {
    const cells = {};
    let maxRow = 0;
    let maxCol = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > maxRow) maxRow = rowNumber;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber > maxCol) maxCol = colNumber;
        const fillObj = cell.fill;
        const argb = fillObj && fillObj.fgColor && fillObj.fgColor.argb;
        cells[cell.address] = {
          value: dutyCellValue(cell),
          fill: dutyNormFill(argb || "")
        };
      });
    });
    sheets.push({ name: ws.name, cells, maxRow, maxCol });
  });
  return { sheets };
}

// The two cell types in this workbook pull in opposite directions, so neither
// cell.value nor cell.text alone is right:
//
//   · A 4D is a leading-zero string ("0042"). cell.value hands back the NUMBER
//     42 for it — the same class of bug as the Sheets numeric-coercion trap — so
//     these must come through cell.text.
//   · Column A is a date. The parser's excelSerialToISO wants Excel's serial,
//     but ExcelJS has already resolved date-formatted cells to a JS Date, and
//     cell.text renders that as locale-formatted display text ("1/4/2026").
//     Feeding either to excelSerialToISO yields NaN, i.e. "unparseable date" on
//     every row of every sheet.
//
// So: convert a Date back to the serial the parser expects, and take cell.text
// for everything else. The inverse of excelSerialToISO's epoch — 1899-12-30,
// whose two-day offset absorbs both 1-based numbering and Excel's fictitious
// 1900 leap day — and computed in UTC because that is the basis excelSerialToISO
// reads it back on.
function dutyCellValue(cell) {
  const v = cell.value;
  if (v instanceof Date) {
    return (Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
  }
  return cell.text == null ? "" : String(cell.text);
}

// Parsed-but-uncommitted import. Held here until the planner confirms, the same
// arrangement the auto-scheduler's proposal uses: the tool proposes, the planner
// decides, and nothing reaches a tab without a deliberate click.
let _dutyImport = null;

function openDutyImportForm() {
  if (!canPlanDuty()) return;
  _dutyImport = null;
  openModal("Import duty workbook", `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px">
        Reads the legacy "Braves Duty List" workbook. Columns I–R are ignored on purpose —
        they are derived values this app recomputes, and inheriting them would inherit their
        bugs. Nothing is written until you press Import.
      </div>
      <input type="file" id="duty-import-file" accept=".xlsx"
        style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px">
      <div id="duty-import-report"></div>
    </div>`);
  document.getElementById("duty-import-file").addEventListener("change", handleDutyImportFile);
}

async function handleDutyImportFile(e) {
  const file = e.target && e.target.files && e.target.files[0];
  if (!file) return;
  const box = document.getElementById("duty-import-report");
  if (typeof ExcelJS === "undefined") {
    box.innerHTML = `<p style="color:var(--red)">The ExcelJS library hasn't loaded. Reload the page and try again.</p>`;
    return;
  }
  box.innerHTML = `<p style="color:var(--muted)">Reading…</p>`;
  try {
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const flat = dutyFlattenWorkbook(wb);
    const cfg = dutyConfig();
    // Parsed per sheet rather than in one parseDutyWorkbook call, because the
    // report offers per-sheet checkboxes and needs to attribute every row and
    // warning to the sheet it came from.
    const perSheet = flat.sheets
      .filter(s => !DUTY_SKIP_SHEETS[s.name])
      .map(s => ({ name: s.name, result: parseDutyMonthSheet(s, cfg) }));
    _dutyImport = { perSheet, selected: perSheet.map(s => s.name) };
    renderDutyImportReport();
  } catch (err) {
    box.innerHTML = `<p style="color:var(--red)">Could not read that file: ${escapeHTML(String(err && err.message || err))}</p>`;
  }
}

function toggleDutyImportSheet(name) {
  if (!_dutyImport) return;
  const i = _dutyImport.selected.indexOf(name);
  if (i >= 0) _dutyImport.selected.splice(i, 1); else _dutyImport.selected.push(name);
  renderDutyImportReport();
}

// Rows in the selected sheets only, flattened across them.
function dutyImportSelectedRows() {
  const sel = _dutyImport.selected;
  const out = { rows: [], corrections: [], holidays: [], warnings: [] };
  _dutyImport.perSheet.forEach(s => {
    if (sel.indexOf(s.name) < 0) return;
    out.rows = out.rows.concat(s.result.rows);
    out.corrections = out.corrections.concat(s.result.corrections);
    out.holidays = out.holidays.concat(s.result.holidays);
    out.warnings = out.warnings.concat(s.result.warnings);
  });
  return out;
}

// Per person: what the workbook's column R claims, against what this app's
// points engine computes from the rows just parsed. Every difference is
// expected to have a cause (a holiday now applied, the 31st now counted, a
// correction re-derived, roll-up drift removed) — a difference with NO
// identifiable cause is the one worth stopping for, because that means the
// engine is doing something unaccounted for.
//
// Mirrors the reconciliation in tools/duty-import-run.js rather than defining a
// second answer to "what does the sheet claim": the claimed side comes from the
// parser's claimedTotals (column R keyed by column K), and the computed side
// from dutyTotals over an unbounded range, exactly as the node runner does it.
function dutyImportReconcile(perSheet, selected, cfg) {
  const rows = [], corrections = [], holidays = [];
  const claimed = {};                       // person → the sheet's own R total
  perSheet.forEach(s => {
    if (selected.indexOf(s.name) < 0) return;
    rows.push(...s.result.rows);
    corrections.push(...s.result.corrections);
    holidays.push(...s.result.holidays);
    Object.keys(s.result.claimedTotals || {}).forEach(d4 => {
      claimed[d4] = (claimed[d4] || 0) + Number(s.result.claimedTotals[d4] || 0);
    });
  });
  // { from: "", to: "" } is this engine's "all time" — see dutyRangeFor.
  const mine = dutyTotals(rows, corrections, cfg, indexHolidays(holidays), { from: "", to: "" });
  const all = [...new Set(Object.keys(claimed).concat(Object.keys(mine.byPerson)))];
  return all.map(d4 => ({
    d4,
    claimed: Number(claimed[d4] || 0),
    computed: (mine.byPerson[d4] && mine.byPerson[d4].total) || 0
  })).sort((a, b) => String(a.d4).localeCompare(String(b.d4)));
}

function renderDutyImportReport() {
  const box = document.getElementById("duty-import-report");
  if (!box || !_dutyImport) return;
  const cfg = dutyConfig();
  const sel = dutyImportSelectedRows();
  const existing = STATE.duty || [];

  const sheetRows = _dutyImport.perSheet.map(s => {
    const on = _dutyImport.selected.indexOf(s.name) >= 0;
    // How many rows already in Braves this sheet would REPLACE — the number that
    // tells a planner whether a re-import is a refresh or a first load.
    const keys = {};
    s.result.rows.forEach(r => { keys[dutyKeyOfDuty(r)] = true; });
    const replacing = existing.filter(r => keys[dutyKeyOfDuty(r)]).length;
    return `<label style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;cursor:pointer">
      <input type="checkbox" ${on ? "checked" : ""} style="width:15px;height:15px;cursor:pointer"
        data-action-change="dutyImportToggleSheet" data-sheet="${escapeAttr(s.name)}">
      <span><strong>${escapeHTML(s.name)}</strong></span>
      <span style="color:var(--muted)">${s.result.rows.length} duties · ${s.result.corrections.length} corrections · ${s.result.holidays.length} holidays${replacing ? ` · replaces ${replacing} existing` : ""}</span>
    </label>`;
  }).join("");

  // Reconciliation (spec §7.3): "a deliverable, not a nicety" — it is the only
  // evidence the points engine is right, and §1.3 guarantees the numbers WILL
  // differ from the workbook. Differences never disable Import.
  const recon = dutyImportReconcile(_dutyImport.perSheet, _dutyImport.selected, cfg);
  const differ = recon.filter(r => r.claimed !== r.computed);
  const reconHTML = recon.length
    ? `<p style="font-size:11px;color:var(--muted);margin:0 0 6px">
         ${recon.length - differ.length} match · ${differ.length} differ.
         Differences are expected: the engine applies public holidays, counts the 31st, and
         cannot drift on roll-ups — three defects the source formula has (spec §1.3).
         A difference with no cause you can name is the one worth chasing.
       </p>
       ${differ.length ? `<div style="max-height:180px;overflow:auto">
         <table style="width:100%;border-collapse:collapse;font-size:11px">
           <tr style="color:var(--muted);text-align:left">
             <th style="padding:2px 6px">4D</th><th style="padding:2px 6px">Sheet says</th>
             <th style="padding:2px 6px">Braves says</th><th style="padding:2px 6px">Difference</th>
           </tr>
           ${differ.map(r => {
             const d = r.computed - r.claimed;
             return `<tr>
               <td style="padding:2px 6px">${escapeHTML(String(r.d4))}</td>
               <td style="padding:2px 6px">${r.claimed}</td>
               <td style="padding:2px 6px">${r.computed}</td>
               <td style="padding:2px 6px;color:var(--orange)">${d > 0 ? "+" + d : d}</td>
             </tr>`;
           }).join("")}
         </table></div>` : ""}`
    : `<p style="font-size:12px;color:var(--muted)">Nothing to reconcile — the selected sheets carry no column-R totals.</p>`;

  // Warnings grouped by kind. §7.3: flagged items DO NOT block the import — the
  // magnitude highlights are known not to agree with the legend, so they are
  // surfaced for a human and nothing more. Showing them as a blocking error
  // would misrepresent what they mean.
  const byKind = {};
  sel.warnings.forEach(w => { (byKind[w.kind || "other"] = byKind[w.kind || "other"] || []).push(w); });
  const warnHTML = Object.keys(byKind).length
    ? Object.keys(byKind).map(k => `
        <details style="margin-top:4px">
          <summary style="cursor:pointer;font-size:12px;color:var(--orange)">${escapeHTML(k)} — ${byKind[k].length}</summary>
          <div style="font-size:11px;color:var(--muted);padding:4px 0 0 12px;max-height:160px;overflow:auto">
            ${byKind[k].map(w => escapeHTML(`${w.sheet || ""} ${w.cell || ""} ${w.message || ""}`)).join("<br>")}
          </div>
        </details>`).join("")
    : `<p style="font-size:12px;color:var(--muted)">No warnings.</p>`;

  box.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:6px;padding:8px 10px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">Sheets</div>
      ${sheetRows || '<p style="font-size:12px;color:var(--muted)">No month sheets found.</p>'}
    </div>
    <div style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-top:8px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">Reconciliation</div>
      ${reconHTML}
    </div>
    <div style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-top:8px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">Flagged for a human</div>
      <p style="font-size:11px;color:var(--muted);margin:0 0 4px">
        None of these stop the import. They are recorded so someone can look at them —
        a difference traceable to a flagged cell is expected, not a defect.
      </p>
      ${warnHTML}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button type="button" class="btn btn-primary" data-action="dutyImportCommit"
        ${sel.rows.length || sel.corrections.length || sel.holidays.length ? "" : "disabled"}>
        Import ${sel.rows.length} duties
      </button>
      <button type="button" class="btn" data-action="dutyImportCancel">Cancel</button>
    </div>`;
}

// Commit. Each tab is rebuilt locally and pushed whole through autoSync's
// existing "replace" mode — no new backend action, and idempotent by
// construction, so a second run of the same workbook changes nothing.
//
// resolveConflict never auto-clobbers a replace: a stale one refreshes and asks
// the user to redo the bulk change. For an import that is the right behaviour —
// re-parse and re-commit against the refreshed data.
function commitDutyImport() {
  if (!canPlanDuty() || !_dutyImport) return;
  const sel = dutyImportSelectedRows();
  const now = new Date().toISOString();

  const dutyRows = sel.rows.map(r => ({
    id: nextId(), date: r.date, dutyType: r.dutyType, platoon: r.platoon || "",
    d4: r.d4, assignedBy: "import", assignedAt: now, source: "import"
  }));
  const corrRows = sel.corrections.map(r => ({
    id: nextId(), date: r.date, d4: r.d4, reason: r.reason, delta: r.delta,
    note: r.note || "", enteredBy: "import", enteredAt: now
  }));
  const holRows = sel.holidays.map(r => ({
    date: r.date, name: r.name || "", tentative: r.tentative || ""
  }));

  const mergedDuty = dutyMergeImport(STATE.duty || [], dutyRows, dutyKeyOfDuty);
  const mergedCorr = dutyMergeImport(STATE.dutyCorrection || [], corrRows, dutyKeyOfCorrection);
  const mergedHol = dutyMergeImport(STATE.holidays || [], holRows, dutyKeyOfHoliday);

  STATE.duty = mergedDuty;
  STATE.dutyCorrection = mergedCorr;
  STATE.holidays = mergedHol;
  saveLocal();
  closeModal();
  render();

  if (STATE.apiUrl) {
    if (dutyRows.length) autoSync("Duty", { type: "replace", data: mergedDuty, imported: true });
    if (corrRows.length) autoSync("DutyCorrection", { type: "replace", data: mergedCorr, imported: true });
    if (holRows.length) autoSync("Holidays", { type: "replace", data: mergedHol, imported: true });
  }
}

registerActions({
  dutyImportToggleSheet: el => toggleDutyImportSheet(el.dataset.sheet),
  dutyImportCommit: () => commitDutyImport(),
  dutyImportCancel: () => closeModal()
});
