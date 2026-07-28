// Functions invoked from OUTSIDE this repo. They have zero in-repo callers by
// design, so without this allowlist the orphan analysis would report each one as
// dead code. Each entry records WHO actually calls it — that reason is the whole
// value of the file, because a future reader must be able to tell a genuine
// external entry point from a stale exemption quietly hiding real dead code.
//
// Keep this list tight. An over-broad exemption is worse than a noisy orphan
// list: a noisy list wastes a reviewer's minute, a wrong exemption hides dead
// code forever.
module.exports = {
  exact: {
    // ── Google Apps Script web-app runtime ──────────────────────────────
    doGet:  "Google Apps Script runtime — HTTP GET entry point of the deployed web app.",
    doPost: "Google Apps Script runtime — HTTP POST entry point; also receives the Telegram webhook.",

    // ── Run by hand from the Apps Script editor ─────────────────────────
    bravesMigrateSchema: "Run manually from the Apps Script editor when a tab gains a column (CLAUDE.md, Sheet schema).",

    // ── Browser inline handlers written directly in index.html ──────────
    // These live in index.html's own markup, not in a JS template string, so
    // the string-reference scan (which only reads .js files) cannot see them.
    closeModal: "Called from index.html:108 and index.html:112 onclick attributes."
  },

  // Name prefixes exempted wholesale, with the reason for the whole family.
  // A prefix matches only when the next character is uppercase, so `tgSend`
  // is exempt but a function merely starting with the letters "tg" is not.
  prefixes: {
    tg: "Telegram bot integration in apps-script-Code.gs — dispatched by doPost's webhook branch through a name table rather than by direct call."
  }
};
