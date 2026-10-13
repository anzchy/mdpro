/**
 * Purpose: The inline CSS and JS for the single-file feature-ledger HTML.
 * Split out of `render.mjs` purely to keep both files under rule 50's 300-line
 * ceiling; nothing here touches the filesystem.
 *
 * Key decisions:
 * - Colour and type values are lifted from `src/styles/globals.css`,
 *   `themes/light.css` and `themes/dark.css` (rule 31: read the files, don't
 *   invent). Two hues have no counterpart in the app palette — it has no
 *   success or warning token — so `--ledger-ok` / `--ledger-warn` are declared
 *   doc-local and used only by the state badges.
 * - The Windows difference tables (ADR-0089) reuse the same badge classes, so
 *   a Windows chip has the macOS colours for its state; `.badge-na` is the one
 *   addition, neutral (`--color-muted` only, dashed) because N/A is not a state.
 * - Theme switches on `prefers-color-scheme` alone. The app's
 *   `.theme-light` / `.theme-dark` classes (rule 34) are toggled by React at
 *   runtime; a static file:// page has no React, so the media query is the
 *   only mechanism available.
 *
 * @module scripts/ledger/template
 * @coordinates-with scripts/ledger/render.mjs
 */

export const LEDGER_CSS = `
:root {
  --color-bg: #ffffff;
  --color-surface: #f6f7fb;
  --color-panel: #ffffff;
  --color-text: #1a1a1a;
  --color-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-accent: #2563eb;
  --color-accent-soft: color-mix(in srgb, #2563eb 18%, transparent);
  --color-danger: #dc2626;
  --color-code-bg: #f4f4f4;
  --shadow-soft: 0 12px 30px rgba(15, 23, 42, 0.08);
  --font-sans: "SF Pro Text", "Avenir Next", "Helvetica Neue", sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --ledger-ok: #16a34a;
  --ledger-warn: #d97706;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0f1115;
    --color-surface: #161a22;
    --color-panel: #141821;
    --color-text: #e5e7eb;
    --color-muted: #9aa4b2;
    --color-border: #242a36;
    --color-accent: #60a5fa;
    --color-accent-soft: color-mix(in srgb, #60a5fa 22%, transparent);
    --color-danger: #f87171;
    --color-code-bg: #1b2230;
    --shadow-soft: 0 12px 30px rgba(0, 0, 0, 0.4);
    --ledger-ok: #4ade80;
    --ledger-warn: #fbbf24;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
  line-height: 1.6;
}
header.top {
  position: sticky; top: 0; z-index: 20;
  background: color-mix(in srgb, var(--color-panel) 92%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--color-border);
  padding: 12px 24px;
}
.brand { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.brand h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
.brand .sub { color: var(--color-muted); font-size: 13px; }
.controls { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
#search {
  font: inherit; font-size: 13px; padding: 6px 10px; min-width: 260px;
  background: var(--color-surface); color: var(--color-text);
  border: 1px solid var(--color-border); border-radius: 8px;
}
#search:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 1px; }
.chip {
  font: inherit; font-size: 12px; padding: 5px 10px; cursor: pointer;
  background: var(--color-surface); color: var(--color-text);
  border: 1px solid var(--color-border); border-radius: 999px;
  display: inline-flex; align-items: center; gap: 6px;
}
.chip[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-accent-soft); }
.chip .n { color: var(--color-muted); font-variant-numeric: tabular-nums; }
.chip .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.chip[data-state="Shipped"] .dot { background: var(--ledger-ok); }
.chip[data-state="Partial"] .dot { background: var(--color-accent); }
.chip[data-state="Stub"] .dot { background: var(--ledger-warn); }
.chip[data-state="Absent"] .dot { background: var(--color-muted); }
.chip[data-state="Unknown"] .dot { background: var(--color-danger); }
#counter { margin-left: auto; color: var(--color-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 32px; padding: 24px; max-width: 1240px; margin: 0 auto; }
nav.toc { position: sticky; top: 108px; align-self: start; max-height: calc(100vh - 140px); overflow: auto; font-size: 13px; }
nav.toc a { display: block; padding: 3px 8px; color: var(--color-muted); text-decoration: none; border-left: 2px solid transparent; border-radius: 0 4px 4px 0; }
nav.toc a.lvl3 { padding-left: 20px; font-size: 12px; }
nav.toc a:hover { color: var(--color-text); }
nav.toc a.active { color: var(--color-accent); border-left-color: var(--color-accent); background: var(--color-accent-soft); }
main { min-width: 0; }
h1, h2, h3 { letter-spacing: -0.01em; scroll-margin-top: 120px; }
h2 { margin-top: 36px; padding-bottom: 6px; border-bottom: 1px solid var(--color-border); }
h3 { margin-top: 24px; font-size: 16px; }
p { margin: 10px 0; }
a { color: var(--color-accent); }
code { font-family: var(--font-mono); font-size: 0.88em; background: var(--color-code-bg); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--color-code-bg); padding: 12px 14px; border-radius: 8px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 12px 0; padding: 4px 14px; border-left: 3px solid var(--color-border); color: var(--color-muted); }
hr { border: none; border-top: 1px solid var(--color-border); margin: 28px 0; }
.table-wrap { overflow-x: auto; margin: 14px 0; border: 1px solid var(--color-border); border-radius: 10px; box-shadow: var(--shadow-soft); }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
thead th { background: var(--color-surface); position: sticky; top: 0; font-weight: 600; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--color-surface); }
tr.hidden { display: none; }
.badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; border: 1px solid; }
.badge-shipped { color: var(--ledger-ok); border-color: var(--ledger-ok); background: color-mix(in srgb, var(--ledger-ok) 12%, transparent); }
.badge-partial { color: var(--color-accent); border-color: var(--color-accent); background: var(--color-accent-soft); }
.badge-stub { color: var(--ledger-warn); border-color: var(--ledger-warn); background: color-mix(in srgb, var(--ledger-warn) 14%, transparent); }
.badge-absent { color: var(--color-muted); border-color: var(--color-border); background: var(--color-surface); }
.badge-unknown { color: var(--color-danger); border-color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 12%, transparent); }
.badge-na { color: var(--color-muted); border-color: var(--color-muted); background: transparent; border-style: dashed; }
.badge-invalid { color: var(--color-danger); border-color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 22%, transparent); text-decoration: underline wavy; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } nav.toc { display: none; } }
`;

export const LEDGER_JS = `
(function () {
  var search = document.getElementById("search");
  var counter = document.getElementById("counter");
  var chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
  var rows = Array.prototype.slice.call(document.querySelectorAll("tr.inv-row"));
  var off = Object.create(null);

  chips.forEach(function (chip) {
    var state = chip.getAttribute("data-state");
    var n = rows.filter(function (r) { return r.getAttribute("data-state") === state; }).length;
    chip.querySelector(".n").textContent = String(n);
    chip.addEventListener("click", function () {
      off[state] = !off[state];
      chip.setAttribute("aria-pressed", off[state] ? "false" : "true");
      apply();
    });
  });

  function apply() {
    var q = (search.value || "").trim().toLowerCase();
    var shown = 0;
    rows.forEach(function (row) {
      var state = row.getAttribute("data-state");
      var text = (row.textContent || "").toLowerCase();
      var visible = !off[state] && (q === "" || text.indexOf(q) !== -1);
      row.classList.toggle("hidden", !visible);
      if (visible) shown += 1;
    });
    counter.textContent = shown + " / " + rows.length + " 行";
  }

  search.addEventListener("input", apply);
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
      search.select();
    } else if (e.key === "Escape") {
      search.value = "";
      apply();
      search.blur();
    }
  });

  var links = {};
  Array.prototype.forEach.call(document.querySelectorAll("nav.toc a"), function (a) {
    links[a.getAttribute("href").slice(1)] = a;
  });
  var targets = Object.keys(links)
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);
  if (targets.length && window.IntersectionObserver) {
    var visible = Object.create(null);
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { visible[entry.target.id] = entry.isIntersecting; });
      var current = null;
      for (var i = 0; i < targets.length; i += 1) {
        if (visible[targets[i].id]) { current = targets[i].id; break; }
      }
      if (!current) return;
      Object.keys(links).forEach(function (id) { links[id].classList.toggle("active", id === current); });
    }, { rootMargin: "-120px 0px -70% 0px", threshold: 0 });
    targets.forEach(function (t) { obs.observe(t); });
  }

  apply();
})();
`;
