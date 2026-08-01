// Guards the dashboard scoped-participation wiring (render.js <-> calc.js).
// Regression: the scoped AVG PART. tile once called a non-existent helper
// `filterVisibleSet` guarded by `typeof ... === "function"`, which silently
// evaluated to null so the tile never actually scoped while its label claimed
// it did. The real helper is `visibleD4Set()` (helpers.js). This test fails if
// render.js references the wrong name or stops wiring scopedParticipation.
const fs = require("fs");
const path = require("path");
const { suite, test, ok } = require("./_tap");

module.exports = async function run() {
  suite("render wiring: scoped participation");
  const render = fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8");
  const helpers = fs.readFileSync(path.join(__dirname, "..", "js", "helpers.js"), "utf8");
  const parade = fs.readFileSync(path.join(__dirname, "..", "js", "braves-parade.js"), "utf8");

  await test("render.js does not reference the non-existent filterVisibleSet", () => {
    ok(!render.includes("filterVisibleSet"), "render.js still references undefined filterVisibleSet");
  });

  await test("the Not Available tile delegates to bpIsNotAvailable (Bug 2)", () => {
    ok(render.includes("bpIsNotAvailable("), "render.js no longer uses the bpIsNotAvailable helper");
    ok(parade.includes("function bpIsNotAvailable"), "bpIsNotAvailable is not defined in braves-parade.js");
    // It must NOT fall back to the old over-broad predicate that counted RSO.
    ok(!render.includes("c.sections.mr.length > 0 || c.sections.reportingSick.length > 0"),
      "render.js still uses the old Not-Available predicate (counts RSO)");
  });

  await test("the scope-set helper render.js relies on is actually defined", () => {
    ok(render.includes("visibleD4Set("), "render.js no longer calls visibleD4Set()");
    ok(helpers.includes("function visibleD4Set"), "visibleD4Set is not defined in helpers.js");
  });

  await test("the AVG PART tile wires scopedParticipation with the visible set", () => {
    ok(render.includes("scopedParticipation(STATE.attendance, STATE.conductDetail, visible)"),
      "render.js no longer passes the visible set into scopedParticipation");
  });

  suite("render wiring: conduct dashboard + lazy-load (Phase 2)");

  await test("Conduct Dashboard view is wired end to end", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    const calc = fs.readFileSync(path.join(__dirname, "..", "js", "calc.js"), "utf8");
    ok(html.includes('data-nav="conductdash"'), "no Conduct Dashboard nav button in index.html");
    ok(render.includes('case "conductdash": renderConductDashboard'), "render() does not route conductdash");
    ok(render.includes("function renderConductDashboard"), "renderConductDashboard missing");
    ok(render.includes("conductBuildup(") && render.includes("perConductParticipation("),
      "render.js does not use the calc.js conduct aggregators");
    ok(calc.includes("function conductBuildup") && calc.includes("function perConductParticipation"),
      "calc.js conduct aggregators missing");
  });

  await test("lazy-load gate is wired for both heavy views", () => {
    const state = fs.readFileSync(path.join(__dirname, "..", "js", "state.js"), "utf8");
    const sync = fs.readFileSync(path.join(__dirname, "..", "js", "sync.js"), "utf8");
    ok(state.includes("function shouldDeferCharts"), "shouldDeferCharts missing in state.js");
    ok(render.includes("shouldDeferCharts()"), "render.js never consults shouldDeferCharts");
    ok(render.includes("loadDashboardCharts") && render.includes("loadConductDashCharts"),
      "chart loaders for the two heavy views are not both wired");
    ok(sync.includes("setChartPref(") && sync.includes("Display / Performance"),
      "Settings page is missing the lazy-load control");
  });

  await test("conduct class scoping + progression list are wired", () => {
    const calc = fs.readFileSync(path.join(__dirname, "..", "js", "calc.js"), "utf8");
    ok(calc.includes("function parseConductSeries") && calc.includes("function conductProgress"),
      "calc.js series/progression helpers missing");
    ok(calc.includes("function conductClassKey") && calc.includes("function conductClassSeq"),
      "calc.js class-key/seq helpers missing");
    ok(calc.includes("function resolveConductClasses"),
      "calc.js resolveConductClasses (makeup-aware class/seq resolver) missing");
    // render.js groups via resolveConductClasses (which wraps conductClassKey/conductClassSeq
    // in calc.js and follows makeupFor to the target's class+slot) rather than calling
    // conductClassKey/conductClassSeq directly.
    ok(render.includes("resolveConductClasses(") && render.includes("conductProgress("),
      "render.js does not use the class-scoping/progression helpers");
    ok(render.includes("function setConductSeries"), "no conduct-class selector handler");
    ok(render.includes("Class Progression"), "progression list not rendered");
  });

  await test("status grid is lazy-loaded behind the shared chart pref", () => {
    ok(render.includes("function loadStatusGrid"), "no status-grid loader");
    ok(render.includes("function renderSBGrid") && render.includes("_sbGridShown"),
      "renderSBGrid does not gate on the _sbGridShown flag");
    // The grid defer decision must reuse shouldDeferCharts so one pref governs all
    // heavy views; sbGridNav must keep the grid shown once loaded.
    ok(/renderSBGrid[\s\S]{0,400}shouldDeferCharts\(\)/.test(render),
      "renderSBGrid never consults shouldDeferCharts");
    ok(/function sbGridNav[\s\S]{0,120}_sbGridShown = true/.test(render),
      "sbGridNav re-defers the grid instead of keeping it shown");
  });

  suite("parade-tab wiring: Mark Present books in via bookInDate, never truncates (item 4c)");
  const paradeTab = fs.readFileSync(path.join(__dirname, "..", "js", "parade-tab.js"), "utf8");

  await test("paradeEndActiveContributors sets bookInDate and no longer truncates active records to yesterday", () => {
    ok(/m\.bookInDate\s*=\s*isoToDisplayDate\(iso\)/.test(paradeTab), "active Medical is not booked in via bookInDate");
    ok(/l\.bookInDate\s*=\s*isoToDisplayDate\(iso\)/.test(paradeTab), "active Leave is not booked in via bookInDate");
    ok(!/l\.endDate\s*=\s*yest/.test(paradeTab), "active Leave is still truncated to yesterday");
    ok(!/else\s+m\.endDate\s*=\s*yest/.test(paradeTab), "active Medical is still truncated to yesterday");
  });

  await test("paradeClearPerson books in a grace-window ended MC", () => {
    ok(/graceMc[\s\S]{0,200}bookInDate\s*=\s*isoToDisplayDate\(iso\)/.test(paradeTab),
      "the grace-window ended MC is not booked in on Mark Present");
  });

  suite("parade grid wiring: only MC / AL·OIL / OTHERS rows are editable (item 5)");

  await test("renderParadePlatoon gates the <select> behind the editable-code set", () => {
    ok(/const PARADE_EDITABLE_CODES\s*=\s*\["MC",\s*"AL\/OIL",\s*"OTHERS"\]/.test(paradeTab),
      "no PARADE_EDITABLE_CODES gate defined");
    ok(/PARADE_EDITABLE_CODES\.includes\(code\)/.test(paradeTab),
      "paradeClassifyPlatoon no longer marks codes editable via PARADE_EDITABLE_CODES");
    // Window widened past 200 chars when Fix 18 added the upcoming dim/label
    // lines between the map head and the cc.editable branch.
    ok(/x\.codes\.map\(cc =>[\s\S]{0,600}cc\.editable/.test(paradeTab),
      "renderParadePlatoon no longer renders one control per concurrent status via cc.editable");
    // The editable branch offers exactly the current code + Present, not the full list.
    ok(/<option value="Present">Present<\/option>/.test(paradeTab),
      "the editable select no longer offers a Present option");
    ok(!/PARADE_CODES\.map\(c =>[\s\S]{0,120}onParadeCodeChange/.test(paradeTab),
      "the grid still renders the full PARADE_CODES <select> for every row");
  });

  suite("parade lookahead wiring: the control reaches every parade-side surface (Fix 18)");

  await test("setParadeLookahead is declared — the toolbar buttons call it from an onclick", () => {
    ok(/function setParadeLookahead\(/.test(paradeTab), "setParadeLookahead is not defined");
    ok(/onclick="setParadeLookahead\('\$\{v\}'\)"/.test(paradeTab),
      "the Lookahead button group no longer wires setParadeLookahead");
    ok(/function paradeLookaheadOpts\(/.test(paradeTab), "paradeLookaheadOpts is not defined");
  });

  await test("every parade-side classifier call threads the horizon", () => {
    // Four surfaces have to agree, or the grid, the bento tiles and the copied
    // message disagree about who is away: the company message, the per-platoon
    // copy button, the platoon message, and the grid/bento classification.
    // Matched per SOURCE LINE rather than by balancing parens: every one of
    // these calls is written on a single line, and a "up to the next )" regex
    // stops at the first nested close and reports a false miss.
    const callLines = fn => paradeTab.split("\n").filter(l => l.includes(fn + "("));
    const generateCalls = callLines("generateBravesParadeState").filter(l => !l.trim().startsWith("//"));
    ok(generateCalls.length >= 3, "expected the company, per-block and platoon message calls");
    generateCalls.forEach(c => ok(/paradeLookaheadOpts\(\)/.test(c),
      "a generateBravesParadeState call does not pass the lookahead: " + c.trim()));
    const classifyCalls = callLines("bpClassifyPerson").filter(l => !l.trim().startsWith("//"));
    ok(classifyCalls.length >= 2, "expected the grid and bento classification calls");
    classifyCalls.forEach(c => ok(/paradeLookaheadOpts\(\)/.test(c),
      "a bpClassifyPerson call does not pass the lookahead: " + c.trim()));
  });

  await test("an upcoming code is never editable — Mark Present would be a silent no-op", () => {
    ok(/PARADE_EDITABLE_CODES\.includes\(code\) && !upcoming/.test(paradeTab),
      "paradeClassifyPlatoon still offers Mark Present on a not-yet-started record");
  });

  await test("the divergence banner exists and stays out of the message text", () => {
    ok(/function paradeUpcomingBanner\(/.test(paradeTab), "paradeUpcomingBanner is not defined");
    ok(/CURRENT STRENGTH/.test(paradeTab), "the banner no longer names the figure it is explaining");
    // It must wrap the host HTML, never the textarea contents — an archived
    // snapshot is the copied text, and banner markup must never reach it.
    ok(/host\.innerHTML = paradeUpcomingBanner\(text\)/.test(paradeTab), "company view renders no banner");
    ok(/host\.innerHTML = paradeUpcomingBanner\(msg\) \+ bento/.test(paradeTab), "platoon view renders no banner");
    ok(!/parade-text[^>]*>\$\{paradeUpcomingBanner/.test(paradeTab),
      "the banner leaks into the copyable/archivable message text");
  });

  suite("visit suffix wiring: one builder, three surfaces (Feature 30.1)");

  await test("all three consumers go through the shared builder, none rolls its own", () => {
    const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
    ok(/function visitSuffix\(/.test(helpers), "visitSuffix is not defined in helpers.js");
    ok(/function visitForDay\(/.test(helpers), "visitForDay is not defined in helpers.js");
    [["parade grid", paradeTab], ["Dashboard Non-Active", render], ["conduct wizard", forms]]
      .forEach(([name, src]) => {
        ok(/visitSuffix\(/.test(src), name + " does not call visitSuffix");
        ok(/visitForDay\(/.test(src), name + " does not use the shared same-day lookup");
      });
  });

  await test("the suffix is same-day only, and the wizard uses ITS date not today", () => {
    const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
    // The date argument is what makes this same-day. The wizard routinely
    // back-dates, so binding it to todayISO() would stamp today's visit time
    // onto a status from last Tuesday.
    ok(/visitForDay\(d4, dateVal\)/.test(forms),
      "the wizard checklist resolves the visit against the wrong date");
    ok(/visitForDay\(r\.id, today\)/.test(render), "the Dashboard table is not bound to `today`");
    ok(/visitForDay\(r\.id, dateIso\)/.test(paradeTab), "the parade grid is not bound to the parade date");
  });

  await test("the parade grid targets the first CURRENT pill and suppresses the redundant type", () => {
    // Placement itself is asserted behaviourally in
    // test/parade-grid-multistatus.test.js; this only pins the two structural
    // choices a refactor could quietly undo — that the target is chosen by
    // skipping upcoming pills, and that RS/MR pills get the bare time because
    // "RS + RSI" reads redundantly.
    ok(/codes\.find\(cc => !cc\.upcoming\)/.test(paradeTab),
      "the grid no longer skips upcoming pills when choosing where the visit lands");
    ok(/target\.code === "RS" \|\| target\.code === "MR"/.test(paradeTab),
      "the grid no longer suppresses the redundant type on RS/MR pills");
  });

  await test("the Dashboard table shows the suffix once, on the first badge", () => {
    ok(/i === 0 && visitSuf/.test(render),
      "the Dashboard repeats the visit suffix on every status badge from one visit");
  });

  await test("the wizard appends only the TIME — its statusTag already names the type", () => {
    const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
    // rebuildLogConductStatus folds the day's visit types into statusTag
    // ("MC + RSO"), so emitting the full TYPE+time there printed the type twice.
    ok(forms.includes('...(visit ? visit.tags : [])].join(" + ")'),
      "statusTag no longer carries the day's visit types — the wizard suffix rule depends on it");
    ok(/endsWith\(v\.type\) \? ` \$\{time\}` : ` \+ \$\{visitSuffix\(v\)\}`/.test(forms),
      "the wizard no longer suppresses the type it is already displaying");
  });

  suite("quick-log wiring: gated, and never inside the Attendance Code cell (Feature 22)");

  await test("both entry points go through the one gated opener", () => {
    const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
    const state = fs.readFileSync(path.join(__dirname, "..", "js", "state.js"), "utf8");
    ok(/function openQuickLogMenu\(/.test(forms), "openQuickLogMenu is not defined in forms.js");
    ok(/const canWrite = /.test(state), "canWrite is not defined in state.js");
    // The opener re-checks the gate itself. The callers only HIDE the button,
    // and a hidden button is not a permission check.
    ok(/function openQuickLogMenu\(d4\) \{\s*\n\s*if \(!canWrite\(\)\) return;/.test(forms),
      "openQuickLogMenu no longer enforces canWrite() itself");
    ok(/openQuickLogMenu\('\$\{escapeAttr\(x\.r\.id\)\}'\)/.test(paradeTab),
      "the parade grid no longer passes the row's person to the quick-log menu");
    ok(/openQuickLogMenu\(''\)/.test(render),
      "the Dashboard no longer opens the quick-log menu with no person context");
  });

  await test("the trigger is a separate column — the Attendance Code cell keeps one action", () => {
    // That cell's Mark-Present select is deliberately its sole action so an
    // incidental tap while swipe-scrolling cannot fire something else.
    const codeCell = paradeTab.slice(paradeTab.indexOf("const codeCell"), paradeTab.indexOf("const cardBtn"));
    ok(codeCell.length > 0, "codeCell block not found — this guard needs re-pointing");
    ok(!/openQuickLogMenu/.test(codeCell), "the quick-log trigger leaked into the Attendance Code cell");
  });

  await test("the viewer gate covers the cell, the header AND the empty-state colspan", () => {
    // Gating only the <td> would leave a stray <th> and misalign every row for
    // viewers — the column count has to move as one.
    ok(/canWrite\(\) \? `<td style="width:44px/.test(paradeTab), "the quick-log cell is not gated");
    ok(/canWrite\(\) \? "<th><\/th>" : ""/.test(paradeTab), "the quick-log header cell is not gated");
    ok(/colspan="\$\{canWrite\(\) \? 5 : 4\}"/.test(paradeTab),
      "the empty-state colspan does not track the gated column");
  });

  await test("both forms honour a prefill, and only when creating", () => {
    const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
    // openLeaveForm had no prefill parameter at all; adding one meant every
    // "is this an edit" test inside it had to stop keying off the truthiness of
    // `e`, or a prefill would hide the bulk scope selector and flip the submit
    // button to "Save" on a brand-new row.
    ok(/function openLeaveForm\(id, prefill\)/.test(forms), "openLeaveForm takes no prefill");
    ok(/function openMedicalForm\(id, prefill\)/.test(forms), "openMedicalForm takes no prefill");
    const leave = forms.slice(forms.indexOf("function openLeaveForm"), forms.indexOf("function onLeaveScopeChange"));
    ok(/const isEdit = !!id;/.test(leave), "openLeaveForm does not distinguish edit from prefill");
    ok(/: \(prefill \|\| null\);/.test(leave), "openLeaveForm ignores the prefill when creating");
    ok(!/\$\{e \? "" :/.test(leave), "an edit-only section still keys off `e`, so a prefill would hide it");
    ok(!/\$\{e \? "Save" : "Log"\}/.test(leave), "the submit label still keys off `e`, not isEdit");
    ok(!/value="\$\{e \? e\.id : ""\}"/.test(leave), "the hidden entry id still keys off `e`, not isEdit");
  });

  suite("visit grouping wiring: display only, and it must not disturb the suffix (Feature 29)");

  await test("the Medical table and the person card both go through groupByVisit", () => {
    const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
    ok(/function groupByVisit\(/.test(helpers), "groupByVisit is not defined in helpers.js");
    ok(/groupByVisit\(medRows\.map\(x => x\.m\)\)/.test(render),
      "the Medical table no longer groups, or groups before the search/date filter and sort");
    ok(/groupByVisit\(medSorted\)/.test(forms), "the person card no longer groups its medical history");
  });

  await test("grouping stayed display-only — no schema, classifier or GAS change", () => {
    // The whole justification for Feature 29 being cheap is that submitMedical
    // ALREADY writes siblings sharing a visitId. If grouping ever reaches the
    // classifier or the backend, that justification is gone and the GAS port
    // has silently drifted.
    const gas = fs.readFileSync(path.join(__dirname, "..", "apps-script-Code.gs"), "utf8");
    ok(!/groupByVisit/.test(parade), "the parade classifier must not know about visit grouping");
    ok(!/groupByVisit/.test(gas), "grouping leaked into the Apps Script port");
  });

  await test("the Dashboard Non-Active table is untouched — it never split a visit into two rows", () => {
    // It renders one row PER PERSON with entry.statuses stacked, so a two-status
    // visit was already one row. Adding grouping there would have been a no-op
    // at best and would have moved branch 3's suffix at worst.
    ok(/const tagsCell = entry\.statuses\.map\(\(s, i\) =>/.test(render),
      "the Dashboard's per-person status stack changed shape");
    ok(/i === 0 && visitSuf/.test(render),
      "grouping moved or duplicated the Dashboard visit suffix (branch 3, Feature 30.1)");
  });

  await test("Edit acts on the visit, Delete acts on the single status", () => {
    const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
    // openMedicalForm on the first sibling reconstructs the extra-status rows,
    // so editing the visit as a whole needs no new code — but only if Edit is
    // wired to grp.first and Delete is wired to the per-row id.
    ok(/openMedicalForm\(\$\{JSON\.stringify\(m\.id\)\}\)/.test(render),
      "the Medical table's Edit is no longer bound to the group's first sibling");
    ok(/deleteEntry\('medical', \$\{JSON\.stringify\(r\.id\)\}/.test(render),
      "the Medical table's Delete is no longer per-status");
    ok(/pcDelete\('medical',\$\{JSON\.stringify\(r\.id\)\},'status'/.test(forms),
      "the person card's Delete is no longer per-status");
  });

  await test("editing a grouped visit loads AND saves every sibling", () => {
    const forms = fs.readFileSync(path.join(__dirname, "..", "js", "forms.js"), "utf8");
    // The plan assumed openMedicalForm already reconstructed the extra-status
    // rows. It did not — it loads a single record by id. Left alone, the single
    // Edit button on a grouped row opened one status and silently stranded the
    // rest, and because date/reason/type are per-visit and written to every
    // sibling, an edit could leave two rows in the same group disagreeing about
    // the date they happened.
    ok(/addMedStatusRow\(m\.status \|\| ""/.test(forms),
      "openMedicalForm no longer pre-fills the visit's sibling statuses on edit");
    // ...and the other half: without the stale-sibling sweep, each re-save
    // appends a fresh copy of every extra status beside the originals.
    ok(/const staleSiblings =/.test(forms),
      "submitMedical no longer removes the siblings its new rows replace");
    ok(/staleSiblings\.forEach\(s => autoSync\("Medical", \{ type: "delete", id: s\.id \}\)\)/.test(forms),
      "the superseded sibling rows are dropped locally but never deleted from the sheet");
  });

  await test("the Status Board is deliberately excluded from grouping", () => {
    // Spec §11 scopes this to the Medical tab, person card and Dashboard. The
    // Status Board is a per-person-per-day grid where a visit's statuses are
    // meant to show individually.
    const sb = render.slice(render.indexOf("function renderStatusBoard"));
    ok(sb.length > 0, "renderStatusBoard not found — this guard needs re-pointing");
    ok(!/groupByVisit/.test(sb.slice(0, 6000)), "grouping leaked into the Status Board");
  });

  suite("render wiring: roster status badge derives from the medical layer (item 4b)");

  await test("the Roster list badges rosterDisplayStatus, not the raw stored status", () => {
    ok(render.includes("rosterDisplayStatus(r,") || render.includes("rosterDisplayStatus(r)"),
      "render.js Roster list no longer badges via rosterDisplayStatus");
    ok(helpers.includes("function rosterDisplayStatus"), "rosterDisplayStatus is not defined in helpers.js");
    ok(!/<td>\$\{statusBadge\(r\.status\)\}<\/td>/.test(render), "render.js still badges the raw stored r.status in the Roster row");
  });

  suite("render wiring: topbar Active counter derives presence live (item 4a fallout)");

  await test("the Active counter reuses bpStrength(...).current, not roster.status === Active", () => {
    ok(!/r\.status === "Active"/.test(render), "the Active counter still reads the raw roster.status mirror");
    // Both topbar numbers now come off ONE bpStrength() call — `Str:` reads .total
    // (departures excluded, so it matches the parade state) and `Active:` .current.
    // See test/dashboard-strength.test.js for the behavioural guard.
    ok(/const str = bpStrength\(filteredRoster\(\), todayISO\(\)\)/.test(render),
      "the topbar counters are not derived from the canonical bpStrength()");
    ok(/\$\{str\.current\}/.test(render),
      "the Active counter is not derived from the canonical bpStrength(...).current");
  });

  suite("render wiring: Dashboard order puts who-is-out above the analytics (Feature 25)");

  await test("Non-Active, Recovering and Out-today all precede the charts grid", () => {
    const body = render.slice(render.indexOf("function renderDashboard"), render.indexOf("// Status Breakdown chart"));
    const at = s => { const i = body.indexOf(s); ok(i >= 0, "block not found in renderDashboard: " + s); return i; };
    const nonActive = at(">Non-Active Personnel");
    const recovering = at("recoveringRows.length ?");
    const leaveOut = at("renderDashLeaveOut(visible, today)");
    const charts = at(`id="dash-charts"`);
    // A duty commander opens this page to find who is missing, not to read a
    // chart. If any of these slides back below the charts the page has silently
    // regressed to the old analytics-first order.
    ok(nonActive < charts, "Non-Active fell back below the charts");
    ok(recovering < charts, "Recovering fell back below the charts");
    ok(leaveOut < charts, "Out today / This week fell back below the charts");
    ok(nonActive < recovering && recovering < leaveOut, "the three out-tables are out of order");
  });

  await test("the chart gate still immediately follows the grid it reveals", () => {
    // chartGateMarkup renders the "load charts" button; it only makes sense
    // adjacent to the hidden #dash-charts div it un-hides. The reorder moved
    // both — this fails if only one of them travelled.
    // The character budget is a proximity proxy, not a size limit on the grid:
    // widened from 400 when the Status Trend card grew its range selector, which
    // legitimately added ~270 chars of markup BETWEEN the two markers.
    ok(/id="dash-charts"[\s\S]{0,900}?chartGateMarkup\("loadDashboardCharts\(\)", "dash-chart-gate"\)/.test(render),
      "the dashboard chart gate is no longer adjacent to #dash-charts");
  });

  await test("the status trend canvas stays inside a fixed-height .chart-box", () => {
    // This is the whole fix for the runaway-height bug, and it is invisible at
    // the call site: buildStatusTrendChart runs with maintainAspectRatio:false,
    // which makes Chart.js take its height from the PARENT element. Mounted bare
    // in the auto-height .card (as it originally shipped), the card grows to fit
    // the canvas, the resize observer fires, and the chart ratchets taller on
    // every pass. The .chart-box wrapper's explicit CSS height is what breaks
    // that loop — a well-meaning "unwrap the redundant div" cleanup reintroduces
    // the bug, so guard the wrapper rather than trusting a comment.
    ok(/<div class="chart-box trend"><canvas id="chart-status"><\/canvas><\/div>/.test(render),
      "#chart-status is no longer wrapped in a fixed-height .chart-box");
    ok(/maintainAspectRatio: false/.test(
      render.slice(render.indexOf("function buildStatusTrendChart"),
                   render.indexOf("function buildStatusTrendChart") + 2500)),
      "buildStatusTrendChart no longer sets maintainAspectRatio:false — the .chart-box height it relies on may now be wrong");
  });

  suite("render wiring: Dashboard parade card reuses the Parade tab (Feature 28)");

  await test("it calls the shared generator/copy/archive, not a private reimplementation", () => {
    ok(/function renderDashParade\(/.test(render), "renderDashParade is not defined");
    ok(/\$\{renderDashParade\(\)\}/.test(render), "renderDashParade is never rendered into the Dashboard");
    // The generated half now lives in dashParadeBodyHtml so the Time input can be
    // refreshed without rebuilding (and unfocusing) itself — the generator call
    // travelled with it.
    ok(/generateBravesParadeState\(dashParadeScope\(\), type, dateIso/.test(render),
      "the Dashboard card no longer builds its text with the canonical generator");
    ok(/paradeCopyString\(ta\.value, "dash-parade-copy", "dash-parade-text"\)/.test(render),
      "the Dashboard card no longer copies via the shared paradeCopyString");
    ok(/archiveParadeSnapshot\(ta\.value, dashParadeMeta\(\)\)/.test(render),
      "the Dashboard card no longer archives through the shared snapshot path");
  });

  await test("the archive helper takes explicit meta so the card is not stamped with the tab's state", () => {
    // archiveParadeSnapshot used to read _paradeDate/_paradeTime/_paradeType/
    // _paradeScope straight off parade-tab module state. A second caller with its
    // own date and time would have archived rows labelled with whatever the
    // Parade TAB was showing — wrong date/slot, and it defeats paradeSnapshotDup,
    // which keys on date+slot+type+message.
    ok(/function archiveParadeSnapshot\(text, meta\)/.test(paradeTab),
      "archiveParadeSnapshot no longer accepts caller-supplied meta");
    ok(/const m = meta \|\| \{/.test(paradeTab),
      "archiveParadeSnapshot no longer defaults meta to the Parade tab's own state");
    ok(/function paradeCopyString\(text, btnId, taId\)/.test(paradeTab),
      "paradeCopyString no longer accepts a fallback textarea id");
    ok(/getElementById\(taId \|\| "parade-text"\)/.test(paradeTab),
      "the clipboard-blocked fallback is hardcoded to the Parade tab's textarea again");
  });

  await test("scope follows the topbar filter and has no dropdown of its own", () => {
    const card = render.slice(render.indexOf("function renderDashParade"), render.indexOf("async function copyDashParadeText"));
    ok(card.length > 0, "renderDashParade block not found — this guard needs re-pointing");
    ok(/function dashParadeScope\(\)[\s\S]*?STATE\.filterPlt/.test(render),
      "dashParadeScope no longer derives scope from the topbar platoon filter");
    // The settled decision: its own controls are Date, FP/LP, Time and Lookahead
    // — NOT Scope. A Scope select here would silently diverge from the filter the
    // rest of the Dashboard is already obeying.
    ok(!/setDashParadeScope/.test(render), "the Dashboard parade card grew its own Scope control");
    ok(/setDashParadeDate|setDashParadeType|setDashParadeTime|setDashParadeLookahead/.test(card),
      "the Dashboard parade card lost its own controls");
  });

  await test("it is not role-gated — only the archive side effect is", () => {
    const card = render.slice(render.indexOf("function renderDashParade"), render.indexOf("async function copyDashParadeText"));
    ok(!/canWrite\(\)/.test(card), "the parade card was role-gated; a viewer must still be able to read and copy it");
    ok(/if \(!text \|\| typeof canWrite !== "function" \|\| !canWrite\(\)\) return;/.test(paradeTab),
      "archiveParadeSnapshot no longer enforces the write gate itself");
  });
};
