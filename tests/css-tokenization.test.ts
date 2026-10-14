// @vitest-environment node
/**
 * @module css-tokenization.test
 * Purpose: the tokenization guard of plan P (WI-2.1). Every app-owned CSS file
 * under `src/` may carry a literal only where the A5 definition of "100%
 * tokenized" allows it (`docs/plans/20260911-ui-redesign/baseline-protocol.md`
 * § Definition): the rule 31 allowlist, the rule 31 z-index table, an approved
 * exception, or the stage-tagged deferred list. Anything else fails, naming
 * the file, line, selector and value.
 *
 * Strategy: source inspection, in the style of
 * `tests/design-tokens-accent-danger.test.ts`. The scanner lives in
 * `tests/support/cssTokenScan.ts`; its fixtures below pin its edge cases, so a
 * scanner bug cannot pass silently.
 *
 * Lists (Appendix A, `docs/plans/20260911-ui-redesign/appendix-a-literals.md`):
 * - EXCEPTIONS: the five 2026-10-03 exception rows (Q10, R4 ×2, R8, R9 `pre`).
 * - DEFERRED: class (b) literals, each tagged with the stage and item that
 *   owns the snap. A listed literal passes; anything else fails.
 * - UNRENDERED: literals whose selector nothing renders, A8 dead code
 *   (`TabBar/`) or orphans with no consumer. Deletion candidates, not
 *   tokenization targets.
 *
 * Every list entry must still match a real declaration, so a migrated or
 * deleted literal has to leave its list in the same commit.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blankRootBlocks,
  declaredTokens,
  scanCss,
  tokenBlock,
  type CssFinding,
} from "./support/cssTokenScan";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/** A5 exclusions: token definition files and the A8 dead-code candidate `App.css`. */
const EXCLUDED = new Set(["App.css", "styles/themes/light.css", "styles/themes/dark.css"]);

const allCss = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((p) => p.endsWith(".css"))
  .map((p) => p.split("\\").join("/"))
  .sort();
const inScope = allCss.filter((p) => !EXCLUDED.has(p));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const declared = declaredTokens(allCss.map(read));

/** The A5 findings of one in-scope file; `globals.css :root` is a token file. */
function findingsOf(rel: string): CssFinding[] {
  const css = rel === "styles/globals.css" ? blankRootBlocks(read(rel)) : read(rel);
  return scanCss(css, declared);
}

interface Row {
  file: string;
  selector: string;
  property: string;
  value: string;
}
interface Exception extends Row {
  line: number;
  reason: string;
  source: string;
}
interface Deferred extends Row {
  stage: 2 | 3 | 4;
  item: string;
}
interface Unrendered extends Row {
  reason: string;
}

const row = (file: string, selector: string, property: string, value: string): Row => ({
  file,
  selector,
  property,
  value,
});

const EXCEPTIONS: Exception[] = [
  {
    ...row("styles/sections/recovery-toast.css", ".spinner", "animation", "spin 0.8s linear infinite"),
    line: 53,
    reason: "spinner keeps rotating (DR13); the zeroed motion token cannot carry it",
    source: "R4, 2026-10-03",
  },
  {
    ...row(
      "plugins/milkdown/imagePastePlugin.css",
      ".image-paste-placeholder::before",
      "animation",
      "spin 0.8s linear infinite",
    ),
    line: 24,
    reason: "spinner keeps rotating (DR13); the zeroed motion token cannot carry it",
    source: "R4, 2026-10-03",
  },
  {
    ...row(
      "components/Editor/MilkdownEditor.css",
      ".milkdown-editor .ProseMirror mark",
      "background",
      "rgba(255, 85, 130, 0.65)",
    ),
    line: 266,
    reason: "highlight fill",
    source: "R8, 2026-10-03",
  },
  {
    ...row("components/Editor/MilkdownEditor.css", ".milkdown-editor .ProseMirror pre", "border-radius", "8px"),
    line: 105,
    reason: "editor-content shape; DR23 gives it no role",
    source: "R9, 2026-10-03",
  },
  {
    ...row(
      "components/Editor/MilkdownEditor.css",
      ".milkdown-editor .ProseMirror .column-resize-handle",
      "z-index",
      "1",
    ),
    line: 214,
    reason: "local stacking inside the table, not a floating surface",
    source: "Q10",
  },
];

const S = "styles/sections/";
const d = (file: string, selector: string, property: string, value: string, stage: 2 | 3 | 4, item: string): Deferred => ({
  ...row(file, selector, property, value),
  stage,
  item,
});

/** Class (b): the snap changes pixels, so it waits for its stage. */
const DEFERRED: Deferred[] = [
  d("components/BottomTabs/BottomTabs.css", ".bottom-tabs__add", "font-size", "18px", 4, "WI-4.2"),
  d("components/BottomTabs/BottomTabs.css", ".bottom-tabs__add", "transition", "all 0.15s", 3, "WI-3.2 item 11"),
  d("components/BottomTabs/BottomTabs.css", ".bottom-tab", "transition", "all 0.15s", 3, "WI-3.2 item 11"),
  d("components/BottomTabs/BottomTabs.css", ".bottom-tab--active", "box-shadow", "0 1px 2px rgba(0, 0, 0, 0.05)", 3, "WI-3.2 flat rows and tabs"),
  d("components/BottomTabs/BottomTabs.css", ".bottom-tab__close", "font-size", "14px", 4, "WI-4.2"),
  d("components/BottomTabs/BottomTabs.css", ".bottom-tab__close:hover", "background", "rgba(0, 0, 0, 0.08)", 3, "WI-3.2 hover"),
  d("components/Editor/ImageContextMenu.css", ".image-context-menu", "border-radius", "8px", 3, "WI-3.1 DR23"),
  d("components/Editor/ImageContextMenu.css", ".image-context-menu-button", "border-radius", "6px", 3, "WI-3.1 DR23"),
  d("components/Editor/MilkdownEditor.css", ".milkdown-editor .ProseMirror table", "font-size", "14px", 3, "WI-3.2 rulings R7"),
  d("plugins/codemirror/wysiwygDecorationsPlugin.css", ".wysiwyg-marker", "font-size", "10px", 3, "WI-3.2 item 12"),
  d("plugins/milkdown/inlineEditPlugin.css", ".milkdown-editor .ProseMirror .milkdown-link-expanded", "border-radius", "3px", 3, "WI-3.1 DR23"),
  d("plugins/milkdown/linkDefinitions/linkDefinitions.css", ".milkdown-editor .ProseMirror .mdpro-link-definition", "border-radius", "4px", 3, "open at STOP 2: editor-content radius (D194, after Appendix A)"),
  d(S + "app-shell.css", ".sidebar-header", "font-size", "11px", 3, "WI-3.2 item 12"),
  d(S + "app-shell.css", ".sidebar-mode-label", "font-size", "10px", 3, "WI-3.2 item 12"),
  d(S + "app-shell.css", ".sidebar-mode-label", "border-radius", "4px", 3, "WI-3.1 DR23"),
  d(S + "buttons-dialog.css", ".toolbar-button", "border-radius", "8px", 3, "WI-3.1 DR23"),
  d(S + "buttons-dialog.css", ".dialog-card", "border-radius", "16px", 3, "WI-3.1 DR23"),
  d(S + "buttons-dialog.css", ".dialog-title", "font-size", "16px", 3, "WI-3.2 item 12"),
  d(S + "editor-source.css", ".editor-shell .cm-table-active-cell", "border-radius", "2px", 3, "WI-3.1 DR23"),
  d(S + "link-insert-modal.css", ".link-insert-input", "border-radius", "8px", 3, "WI-3.1 DR23"),
  d(S + "link-insert-modal.css", ".toolbar-button--primary:hover:not(:disabled)", "background", "#1d4ed8", 3, "WI-3.2 rulings R3"),
  d(S + "recovery-toast.css", ".recovery-item", "border-radius", "12px", 3, "WI-3.1 DR23"),
  d(S + "recovery-toast.css", ".toast", "border-radius", "12px", 3, "WI-3.1 DR23"),
  d(S + "recovery-toast.css", ".toast-close", "font-size", "18px", 4, "WI-4.2"),
  d(S + "settings-about.css", ".about-app-name", "font-size", "18px", 3, "WI-3.2 item 12"),
  d(S + "settings-about.css", ".about-status-ok", "color", "var(--color-success, #34c759)", 3, "WI-3.2 rulings R10"),
  d(S + "settings-about.css", ".about-status-error", "color", "var(--color-error, #ff3b30)", 3, "WI-3.2 rulings R10"),
  d(S + "settings-about.css", ".about-status-disabled", "color", "var(--color-text-tertiary, #999)", 3, "WI-3.2 rulings R10"),
  d(S + "settings-about.css", ".about-progress-bar", "border-radius", "3px", 3, "WI-3.1 DR23"),
  d(S + "settings-about.css", ".about-progress-bar::-webkit-progress-bar", "border-radius", "3px", 3, "WI-3.1 DR23"),
  d(S + "settings-about.css", ".about-progress-bar::-webkit-progress-value", "border-radius", "3px", 3, "WI-3.1 DR23"),
  d(S + "settings-mcp.css", ".mcp-status-badge", "border-radius", "12px", 4, "item 6 (WI-4.4)"),
  d(S + "settings-mcp.css", ".mcp-status-badge.running", "background", "#dcfce7", 4, "item 6 (WI-4.4)"),
  d(S + "settings-mcp.css", ".mcp-status-badge.running", "color", "#16a34a", 4, "item 6 (WI-4.4)"),
  d(S + "settings-mcp.css", ".mcp-server-info", "border-radius", "8px", 3, "WI-3.1 DR23"),
  d(S + "settings-mcp.css", ".mcp-copy-btn", "font-size", "14px", 4, "WI-4.2"),
  d(S + "settings-mcp.css", ".mcp-copy-btn.small", "font-size", "11px", 3, "WI-3.2 item 12"),
  d(S + "settings-mcp.css", ".mcp-client-row", "border-radius", "8px", 3, "WI-3.1 DR23"),
  d(S + "settings-mcp.css", ".mcp-client-status", "font-size", "16px", 3, "WI-3.2 item 12"),
  d(S + "settings-mcp.css", ".mcp-client-status.installed", "color", "#16a34a", 3, "WI-3.2 rulings R1"),
  d(S + "settings-pages.css", ".settings-page-title", "font-size", "15px", 3, "WI-3.2 item 12"),
  d(S + "settings-pages.css", ".settings-dirty-banner", "background", "rgba(245, 158, 11, 0.12)", 4, "WI-4.3"),
  d(S + "settings-pages.css", ".settings-dirty-banner", "border", "1px solid rgba(245, 158, 11, 0.4)", 4, "WI-4.3"),
  d(S + "settings-pages.css", ".settings-dirty-banner button", "border-radius", "4px", 3, "WI-3.1 DR23"),
  d(S + "settings-pages.css", ".toolbar-button.primary:hover", "background", "#1d4ed8", 3, "WI-3.2 rulings R3"),
  d(S + "settings-rows.css", ".settings-integrations h3", "font-size", "18px", 3, "WI-3.2 item 12"),
  d(S + "settings-rows.css", ".settings-integrations h4", "font-size", "15px", 3, "WI-3.2 item 12"),
  d(S + "settings-rows.css", ".settings-section-label", "font-size", "11px", 3, "WI-3.2 item 12"),
  d(S + "settings-rows.css", ".settings-stepper button", "font-size", "16px", 4, "WI-4.2"),
  d(S + "settings-rows.css", ".settings-stepper button", "border-radius", "3px", 3, "WI-3.1 DR23"),
  d(S + "settings-rows.css", ".toggle-slider", "background-color", "#ccc", 4, "item 6 (WI-4.4)"),
  d(S + "settings-rows.css", ".toggle-slider", "transition", "0.2s", 3, "WI-3.2 item 11"),
  d(S + "settings-rows.css", ".toggle-slider", "border-radius", "24px", 3, "WI-3.1 DR23"),
  d(S + "settings-rows.css", ".toggle-slider:before", "transition", "0.2s", 3, "WI-3.2 item 11"),
  d(S + "settings-shell.css", ".settings-dialog", "border-radius", "16px", 3, "WI-3.1 DR23"),
  d(S + "settings-shell.css", ".settings-title", "font-size", "18px", 3, "WI-3.2 item 12"),
  d(S + "settings-shell.css", ".settings-close", "font-size", "24px", 4, "WI-4.2"),
  d(S + "settings-shell.css", ".settings-category-btn", "border-radius", "8px", 3, "WI-3.1 DR23"),
  d(S + "settings-shell.css", ".shortcuts-header h3", "font-size", "18px", 3, "WI-3.2 item 12"),
  d(S + "settings-shell.css", ".shortcuts-section", "border-radius", "12px", 3, "WI-3.1 DR23"),
  d(S + "settings-shell.css", ".shortcut-value.is-editing", "background", "rgba(37, 99, 235, 0.1)", 3, "WI-3.2 item 1"),
  d(S + "table-context-menu.css", ".table-context-menu", "border-radius", "8px", 3, "WI-3.1 DR23"),
  d(S + "table-context-menu.css", ".table-context-menu-group-label", "font-size", "11px", 3, "WI-3.2 item 12"),
  d(S + "table-context-menu.css", ".table-context-menu-item", "border-radius", "6px", 3, "WI-3.1 DR23"),
  d(S + "table-context-menu.css", ".table-context-menu-item-hint", "font-size", "11px", 3, "WI-3.2 item 12"),
  d(S + "table-insert-modal.css", ".grid-picker-cell", "border-radius", "2px", 3, "WI-3.1 DR23"),
  d(S + "table-insert-modal.css", ".grid-picker-cell", "transition", "background 0.05s ease, border-color 0.05s ease", 3, "WI-3.2 item 11"),
  d(S + "toc-sidebar.css", ".toc-entry__content", "transition", "background 0.15s ease", 3, "WI-3.2 item 11"),
  d(S + "toc-sidebar.css", ".toc-entry__content--active", "background", "rgba(37, 99, 235, 0.1)", 3, "WI-3.2 item 1"),
  d(S + "toc-sidebar.css", ".toc-entry__collapse-icon", "font-size", "10px", 3, "WI-3.2 item 12"),
  d(S + "toc-sidebar.css", ".settings-input", "border-radius", "4px", 3, "WI-3.1 DR23"),
];

const DEAD_TABBAR = "A8 dead code: only src/components/TabBar/ renders it";
const ORPHAN = "orphan: no src/ file references the selector";
const u = (file: string, selector: string, property: string, value: string, reason: string): Unrendered => ({
  ...row(file, selector, property, value),
  reason,
});

/** Nothing renders these selectors; they go when their dead code is deleted. */
const UNRENDERED: Unrendered[] = [
  u(S + "app-shell.css", ".pane-title", "font-size", "12px", ORPHAN),
  u(S + "buttons-dialog.css", ".toolbar-mode", "font-size", "12px", ORPHAN),
  u(S + "settings-shell.css", ".settings-search", "border-radius", "10px", ORPHAN),
  u(S + "settings-shell.css", ".settings-search", "font-size", "13px", ORPHAN),
  u(S + "settings-shell.css", ".settings-sidebar-title", "font-size", "11px", ORPHAN),
  u(S + "settings-pages.css", ".settings-placeholder h3", "font-size", "18px", ORPHAN),
  u(S + "settings-pages.css", ".settings-placeholder p", "font-size", "13px", ORPHAN),
  u(S + "settings-pages.css", ".settings-placeholder-card", "border-radius", "12px", ORPHAN),
  u(S + "settings-pages.css", ".settings-placeholder-card", "font-size", "13px", ORPHAN),
  u(S + "settings-pages.css", ".settings-placeholder-note", "font-size", "12px", ORPHAN),
  u(S + "settings-pages.css", ".settings-general h3", "font-size", "18px", ORPHAN),
  u(S + "settings-pages.css", ".settings-general p", "font-size", "13px", ORPHAN),
  u(S + "settings-pages.css", ".settings-form-row", "border-radius", "10px", ORPHAN),
  u(S + "settings-pages.css", ".settings-form-row label", "font-size", "14px", ORPHAN),
  u(S + "settings-pages.css", ".settings-form-hint", "font-size", "12px", ORPHAN),
  u(S + "toc-sidebar.css", ".toc-sidebar__header", "font-size", "14px", ORPHAN),
  u(S + "tab-bar.css", ".tab-bar__new-tab", "border-radius", "6px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab-bar__new-tab", "font-size", "18px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab", "border-radius", "6px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab", "transition", "background 0.15s ease, opacity 0.3s ease", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab--active", "box-shadow", "0 1px 3px rgba(0, 0, 0, 0.08)", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__title", "font-size", "13px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__close", "border-radius", "4px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__close", "font-size", "14px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__close", "transition", "opacity 0.15s ease", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__dirty-indicator", "font-size", "10px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__pin-indicator", "font-size", "10px", DEAD_TABBAR),
];

/** Expected list sizes per stage and item; a list change has to update this too. */
const DEFERRED_COUNTS: Record<string, number> = {
  "stage 3": 59,
  "stage 4": 12,
};

const keyOf = (r: Row) => `${r.file} | ${r.selector} | ${r.property} | ${r.value}`;
const listed = new Set([...EXCEPTIONS, ...DEFERRED, ...UNRENDERED].map(keyOf));
const describeFinding = (f: string, x: CssFinding) =>
  `${f}:${x.line} ${x.selector} { ${x.property}: ${x.value} } (${x.category})`;

describe("scanner fixtures", () => {
  const count = (css: string, tokens?: string[]) => scanCss(css, tokens ? new Set(tokens) : undefined).length;

  it("ignores literals inside comments, and finds one next to a comment", () => {
    expect(count("/* color: #fff; font-size: 12px */ .a { color: var(--x); }")).toBe(0);
    expect(count(".a { /* #fff */ color: #000; }")).toBe(1);
  });

  it("reads a multi-line value and reports the property's line", () => {
    const found = scanCss(".a {\n  box-shadow:\n    0 1px 2px\n    rgba(0, 0, 0, 0.1);\n}");
    expect(found.map((x) => [x.line, x.category])).toEqual([[2, "colour"]]);
  });

  it("scans @media and @keyframes bodies", () => {
    const media = scanCss("@media (max-width: 400px) { .a { font-size: 12px; } }");
    expect(media.map((x) => x.selector)).toEqual(["@media (max-width: 400px) > .a"]);
    expect(count("@keyframes k { from { color: red; } to { opacity: 1; } }")).toBe(1);
  });

  it("allows a var() fallback for a declared token and flags one for an undeclared token", () => {
    expect(count(".a { color: var(--x, #fff); }", ["--x"])).toBe(0);
    expect(count(".a { color: var(--y, #fff); }", ["--x"])).toBe(1);
  });

  it("flags a literal argument to color-mix() and allows one over var()s", () => {
    expect(count(".a { background: color-mix(in srgb, #fff 10%, transparent); }")).toBe(1);
    expect(count(".a { background: color-mix(in srgb, var(--a) 10%, transparent); }")).toBe(0);
  });

  it("allows an rgba() line directly before the same property in color-mix() (rule 31 fallback)", () => {
    expect(count(".a { background: rgba(0, 0, 0, 0.1); background: color-mix(in srgb, var(--a) 10%, transparent); }")).toBe(0);
  });

  it("holds radii, z-index and motion to the allowlists", () => {
    expect(count(".a { border-radius: 50%; } .b { border-radius: 999px; } .c { border-radius: var(--r); }")).toBe(0);
    expect(count(".a { border-radius: 6px; }")).toBe(1);
    expect(count(".a { z-index: 20; } .b { z-index: 1000; }")).toBe(0);
    expect(count(".a { z-index: 5; }")).toBe(1);
    expect(count(".a { transition: none; } .b { transition: opacity var(--motion-duration-fast); }")).toBe(0);
    expect(count(".a { transition: opacity 0.15s; }")).toBe(1);
  });

  it("allows em font sizes in editor content only", () => {
    expect(count(".milkdown-editor .ProseMirror h1 { font-size: 2em; }")).toBe(0);
    expect(count(".toolbar { font-size: 0.9em; }")).toBe(1);
    expect(count(".a { font-family: Inter, sans-serif; }")).toBe(1);
  });
});

describe("scanner fixtures (audit b125)", () => {
  const count = (css: string, tokens?: string[]) => scanCss(css, tokens ? new Set(tokens) : undefined).length;

  it("checks the size and the family of the font shorthand separately", () => {
    expect(count(".a { font: 12px var(--font-sans); }")).toBe(1);
    expect(count(".a { font: var(--font-size-ui) Arial, sans-serif; }")).toBe(1);
    expect(count(".a { font: var(--font-size-ui) var(--font-sans); }")).toBe(0);
    expect(count(".a { font: 600 var(--font-size-ui)/1.4 var(--font-sans); }")).toBe(0);
  });

  it("treats a var() fallback for an undeclared token as a literal in every category", () => {
    expect(count(".a { font-size: var(--nope, 12px); }", ["--x"])).toBe(1);
    expect(count(".a { border-radius: var(--nope, 6px); }", ["--x"])).toBe(1);
    expect(count(".a { font-size: var(--x, 12px); }", ["--x"])).toBe(0);
  });

  it("flags a signed motion time", () => {
    expect(count(".a { transition-delay: -0.2s; }")).toBe(1);
    expect(count(".a { animation-delay: -.5s; }")).toBe(1);
  });
});

describe("app CSS is tokenized (A5)", () => {
  it("scans the app's CSS files", () => {
    expect(inScope).toContain("styles/globals.css");
    expect(inScope.length).toBeGreaterThanOrEqual(20);
  });

  for (const file of inScope) {
    it(`${file}: every literal is allowed, excepted or deferred`, () => {
      const unlisted = findingsOf(file).filter((x) => !listed.has(keyOf({ ...x, file })));
      expect(unlisted.map((x) => describeFinding(file, x))).toEqual([]);
    });
  }
});

describe("the lists stay exact", () => {
  const all = new Set(inScope.flatMap((f) => findingsOf(f).map((x) => keyOf({ ...x, file: f }))));

  it("every list entry still matches a literal in the tree", () => {
    const stale = [...EXCEPTIONS, ...DEFERRED, ...UNRENDERED].map(keyOf).filter((k) => !all.has(k));
    expect(stale).toEqual([]);
  });

  it("no literal is listed twice", () => {
    const keys = [...EXCEPTIONS, ...DEFERRED, ...UNRENDERED].map(keyOf);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("the exceptions are exactly the five ruled rows, at their lines", () => {
    expect(EXCEPTIONS).toHaveLength(5);
    for (const e of EXCEPTIONS) {
      const hit = findingsOf(e.file).find((x) => keyOf({ ...x, file: e.file }) === keyOf(e));
      expect(hit?.line, keyOf(e)).toBe(e.line);
    }
  });

  it("the deferred list has the expected size per stage", () => {
    const counts: Record<string, number> = {};
    for (const x of DEFERRED) {
      const k = x.stage === 2 ? `stage 2 ${x.item}` : `stage ${x.stage}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual(DEFERRED_COUNTS);
  });
});

describe("theme parity (Q2)", () => {
  // An alias (`--a: var(--b)`) is compared by what it resolves to in its own block.
  const resolve = (block: Map<string, string>, value: string, depth = 0): string => {
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    const target = alias ? block.get(alias[1]) : undefined;
    return target !== undefined && depth < 8 ? resolve(block, target, depth + 1) : value;
  };

  it("every token declared in both :root and .theme-light has the same value", () => {
    const root = tokenBlock(read("styles/globals.css"), ":root");
    const light = tokenBlock(read("styles/themes/light.css"), ".theme-light");
    const drift = [...light]
      .filter(([k, v]) => root.has(k) && resolve(root, root.get(k) ?? "") !== resolve(light, v))
      .map(([k, v]) => `${k}: :root ${root.get(k)} vs .theme-light ${v}`);
    expect(light.size).toBeGreaterThan(0);
    expect(drift).toEqual([]);
  });
});

describe("dead-code guard (A8, temporary)", () => {
  // Delete this block when TODOS.md "Remove dead App.css and TabBar; fix rule
  // 34's App.css claim" lands.
  const sources = (readdirSync(SRC, { recursive: true }) as string[])
    .map((p) => p.split("\\").join("/"))
    .filter((p) => /\.(tsx?|css)$/.test(p) && p !== "App.css" && !p.startsWith("components/TabBar/"));
  const importers = (pattern: RegExp) => [
    ...sources.filter((p) => pattern.test(read(p))),
    ...(pattern.test(readFileSync(join(ROOT, "index.html"), "utf8")) ? ["../index.html"] : []),
  ];
  const message =
    'App.css and TabBar/ are A8 dead code; an import brings them into tokenization scope. See TODOS.md "Remove dead App.css and TabBar; fix rule 34\'s App.css claim".';

  it("nothing imports src/App.css", () => {
    expect(importers(/(import|@import)[^;\n]*["'][^"']*\bApp\.css["']/), message).toEqual([]);
  });

  it("nothing imports src/components/TabBar/", () => {
    expect(importers(/(from|import)\s*\(?\s*["'][^"']*\/TabBar(\/[^"']*)?["']/), message).toEqual([]);
  });

  it("the files it guards still exist", () => {
    expect(existsSync(join(SRC, "App.css"))).toBe(true);
    expect(existsSync(join(SRC, "components/TabBar/TabBar.tsx"))).toBe(true);
  });
});
