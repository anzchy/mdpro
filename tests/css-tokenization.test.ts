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
 * - EXCEPTIONS: the 2026-10-03 exception rows (Q10, R4 ×2, R9 `pre`). R8, the
 *   highlight fill, left with D256: it is the `--color-highlight` token now.
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
  blankTokenDeclarations,
  exemptTokenDeclarations,
  declaredTokens,
  scanCss,
  scanTsColours,
  tokenBlock,
  type CssFinding,
} from "./support/cssTokenScan";
import { validateTokenFile } from "./support/tokenFileGrammar";
import { resolveColor, themeTokens, toHex } from "./support/contrast";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/**
 * A5 file exclusions: none (D278). The token files are scanned too; only their
 * token declarations are exempt (`blankTokenDeclarations`).
 */
const EXCLUDED = new Set<string>();

const allCss = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((p) => p.endsWith(".css"))
  .map((p) => p.split("\\").join("/"))
  .sort();
const inScope = allCss.filter((p) => !EXCLUDED.has(p));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const declared = declaredTokens(allCss.map(read));

/** The A5 findings of one in-scope file; `globals.css :root` is a token file. */
function findingsOf(rel: string): CssFinding[] {
  return findingsIn(rel, read(rel));
}

/** The findings of `css` as if it were the file `rel`: the token exemption depends on the path (D278-FIX-1). */
function findingsIn(rel: string, css: string): CssFinding[] {
  return scanCss(exemptTokenDeclarations(rel, css), declared);
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
  d("components/BottomTabs/BottomTabs.css", ".bottom-tab__close", "font-size", "14px", 4, "WI-4.2"),
  d(S + "recovery-toast.css", ".toast-close", "font-size", "18px", 4, "WI-4.2"),
  d(S + "settings-mcp.css", ".mcp-status-badge", "border-radius", "12px", 4, "item 6 (WI-4.4)"),
  d(S + "settings-mcp.css", ".mcp-copy-btn", "font-size", "14px", 4, "WI-4.2"),
  d(S + "settings-mcp.css", ".mcp-copy-btn.small", "font-size", "11px", 4, "WI-4.2"),
  d(S + "settings-mcp.css", ".mcp-client-status", "font-size", "16px", 4, "WI-4.2"),
  d(S + "settings-rows.css", ".settings-stepper button", "font-size", "16px", 4, "WI-4.2"),
  d(S + "settings-shell.css", ".settings-close", "font-size", "24px", 4, "WI-4.2"),
  d(S + "toc-sidebar.css", ".toc-entry__collapse-icon", "font-size", "10px", 4, "WI-4.2"),
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
  u(S + "tab-bar.css", ".tab__title", "font-size", "13px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__close", "border-radius", "4px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__close", "font-size", "14px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__close", "transition", "opacity 0.15s ease", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__dirty-indicator", "font-size", "10px", DEAD_TABBAR),
  u(S + "tab-bar.css", ".tab__pin-indicator", "font-size", "10px", DEAD_TABBAR),
];

/** Expected list sizes per stage and item; a list change has to update this too. */
const DEFERRED_COUNTS: Record<string, number> = {
  "stage 4": 10,
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

  it("flags a colour fallback in var() whether or not the token is declared (D278, Q3)", () => {
    expect(count(".a { color: var(--x, #fff); }", ["--x"])).toBe(1);
    expect(count(".a { color: var(--y, #fff); }", ["--x"])).toBe(1);
    expect(count(".a { color: var(--x); }", ["--x"])).toBe(0);
  });

  it("flags a literal argument to color-mix() and allows one over var()s", () => {
    expect(count(".a { background: color-mix(in srgb, #fff 10%, transparent); }")).toBe(1);
    expect(count(".a { background: color-mix(in srgb, var(--a) 10%, transparent); }")).toBe(0);
  });

  it("flags an rgba() line before the same property in color-mix(): no browser-fallback exemption (D278, Q3)", () => {
    expect(count(".a { background: rgba(0, 0, 0, 0.1); background: color-mix(in srgb, var(--a) 10%, transparent); }")).toBe(1);
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

describe("scanner fixtures: every colour literal (D278, Q3 「Every literal, rgba too」)", () => {
  const colours = (css: string) => scanCss(css).filter((x) => x.category === "colour").length;

  it("checks hex and colour functions on every property", () => {
    expect(colours(".a { text-shadow: 0 0 1px #fff; }")).toBe(1);
    expect(colours(".a { background-image: linear-gradient(#fff, #000); }")).toBe(1);
    expect(colours(".a { filter: drop-shadow(0 0 1px red); }")).toBe(1);
    expect(colours(".a { mask: linear-gradient(rgb(0 0 0 / 50%), transparent); }")).toBe(1);
  });

  it("knows color() and the other colour functions", () => {
    expect(colours(".a { color: color(display-p3 1 0 0); }")).toBe(1);
    expect(colours(".a { color: oklch(0.6 0.1 200); }")).toBe(1);
  });

  it("scans custom properties declared outside the token blocks, named colours included", () => {
    expect(colours(".a { --local: #fff; color: var(--local); }")).toBe(1);
    expect(colours(".a { --c: red; color: var(--c); }")).toBe(1);
    expect(colours(".a { --gap: 4px; }")).toBe(0);
  });

  it("knows the CSS system colours", () => {
    expect(colours(".a { color: Canvas; }")).toBe(1);
    expect(colours(".a { border-color: ButtonBorder; }")).toBe(1);
  });

  it("decodes SVG data URIs", () => {
    expect(colours(`.a { background: url("data:image/svg+xml,%3Csvg fill='%23fff'%3E%3C/svg%3E"); }`)).toBe(1);
    const b64 = Buffer.from("<svg><path fill='#fff'/></svg>").toString("base64");
    expect(colours(`.a { background: url("data:image/svg+xml;base64,${b64}"); }`)).toBe(1);
    expect(colours(`.a { background: url("data:image/svg+xml,<svg><stop style='stop-color:red'/></svg>"); }`)).toBe(1);
    expect(colours(`.a { background: url("data:image/svg+xml,<svg><path fill='none'/></svg>"); }`)).toBe(0);
  });

  it("ignores quoted strings that are not colours", () => {
    expect(colours('.a::before { content: "#"; }')).toBe(0);
    expect(colours('.a::before { content: "#fff"; }')).toBe(0);
  });

  it("exempts token declarations in the token blocks only, not the files that hold them", () => {
    const theme = ".theme-dark { --color-x: rgba(15, 18, 28, 0.6); }\n.theme-dark .x { color: rgba(15, 18, 28, 0.6); }";
    expect(scanCss(blankTokenDeclarations(theme)).map((x) => x.selector)).toEqual([".theme-dark .x"]);
    const root = ":root { --a: #fff; }\n@media (prefers-reduced-motion: reduce) { :root { --b: #000; } }\nbody { color: #fff; }";
    expect(scanCss(blankTokenDeclarations(root)).map((x) => x.selector)).toEqual(["body"]);
  });
});

describe("TS and TSX carry no colour literal (D278, Q3)", () => {
  it("finds hex and colour functions in string and template literals, not in comments", () => {
    expect(scanTsColours('const a = "#abcdef";')).toHaveLength(1);
    expect(scanTsColours("const a = `rgba(0, 0, 0, ${x})`;")).toHaveLength(1);
    expect(scanTsColours('// "#abcdef"\nconst a = "#root";')).toHaveLength(0);
    expect(scanTsColours('const a = "#add-button";')).toHaveLength(0);
  });

  it("finds named colours where the value is a colour", () => {
    expect(scanTsColours('<p style={{ color: "red" }} />')).toHaveLength(1);
    expect(scanTsColours('el.style.setProperty("color", "red");')).toHaveLength(1);
    expect(scanTsColours('el.style.setProperty("--x", "red");')).toHaveLength(1);
    expect(scanTsColours('el.style.setProperty("--editor-font-family", "Menlo");')).toHaveLength(0);
    expect(scanTsColours('<p style={{ color: "var(--color-muted)" }} />')).toHaveLength(0);
  });

  /** Literals written into the user's document, not app chrome: they must render outside mdpro. */
  const DOCUMENT_CONTENT = [
    {
      file: "plugins/core/pluginConfig.ts",
      literal: "#FF5582A6",
      reason: "the highlight openTag, inserted into the user's Markdown (highlightPlugin.ts:37)",
    },
  ];

  it("app source holds exactly the document-content literals", () => {
    const sources = (readdirSync(SRC, { recursive: true }) as string[])
      .map((p) => p.split("\\").join("/"))
      .filter((p) => /\.(ts|tsx)$/.test(p))
      .sort();
    const found = sources.flatMap((p) => scanTsColours(read(p)).map((x) => `${p}: ${x.literal}`));
    expect(found).toEqual(DOCUMENT_CONTENT.map((d) => `${d.file}: ${d.literal}`));
  });

  it("the highlight literal serialises like light --color-highlight", () => {
    const literal = DOCUMENT_CONTENT[0].literal.toLowerCase();
    expect(literal).toBe("#ff5582a6");
    expect(toHex(resolveColor(themeTokens("light").get("--color-highlight") ?? "", themeTokens("light")))).toBe(literal);
  });
});

describe("no listed literal is a colour (D278, Q3)", () => {
  it("EXCEPTIONS, DEFERRED and UNRENDERED carry no colour value", () => {
    const coloured = [...EXCEPTIONS, ...DEFERRED, ...UNRENDERED]
      .filter((r) => scanCss(`.x { ${r.property}: ${r.value}; }`).some((x) => x.category === "colour"))
      .map(keyOf);
    expect(coloured).toEqual([]);
  });

  it("only the token declarations of the three token files are exempt", () => {
    expect(EXCLUDED.size).toBe(0);
    expect(inScope).toEqual(expect.arrayContaining(["styles/themes/light.css", "styles/themes/dark.css"]));
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

  it("the exceptions are exactly the four ruled rows, at their lines", () => {
    expect(EXCEPTIONS).toHaveLength(4);
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
  // D278 deleted App.css (「delete App.css, fold it into D278」). Delete this
  // block when TODOS.md "Remove dead TabBar" lands.
  const sources = (readdirSync(SRC, { recursive: true }) as string[])
    .map((p) => p.split("\\").join("/"))
    .filter((p) => /\.(tsx?|css)$/.test(p) && !p.startsWith("components/TabBar/"));
  const importers = (pattern: RegExp) => [
    ...sources.filter((p) => pattern.test(read(p))),
    ...(pattern.test(readFileSync(join(ROOT, "index.html"), "utf8")) ? ["../index.html"] : []),
  ];
  const message =
    'TabBar/ is A8 dead code; an import brings it into tokenization scope. See TODOS.md "Remove dead TabBar".';

  it("nothing imports src/components/TabBar/", () => {
    expect(importers(/(from|import)\s*\(?\s*["'][^"']*\/TabBar(\/[^"']*)?["']/), message).toEqual([]);
  });

  it("App.css is deleted and TabBar/ still exists (D278)", () => {
    expect(existsSync(join(SRC, "App.css"))).toBe(false);
    expect(existsSync(join(SRC, "components/TabBar/TabBar.tsx"))).toBe(true);
  });
});

describe("D278-FIX-1: the token exemption belongs to the token files and their own block", () => {
  const rogue = ":root { --rogue: #fff; }\n.a { color: var(--rogue); }";

  it("a :root token block in a section file is scanned (audit H2 on PR #498)", () => {
    expect(findingsIn("styles/sections/settings-mcp.css", rogue).map((x) => x.selector)).toEqual([":root"]);
  });

  it("each token file is exempt only in its own block", () => {
    const sel = (rel: string, css: string) => findingsIn(rel, css).map((x) => x.selector);
    expect(sel("styles/globals.css", rogue)).toEqual([]);
    // D278-FIX-3: the reduced-motion block may only re-time an existing --motion-* token.
    expect(sel("styles/globals.css", ":root { --motion-duration-fast: 150ms; }\n@media (prefers-reduced-motion: reduce) { :root { --motion-duration-fast: 0ms; } }")).toEqual([]);
    expect(sel("styles/globals.css", ".theme-dark { --x: #fff; }")).toEqual([".theme-dark"]);
    expect(sel("styles/themes/light.css", ".theme-light { --x: #fff; }")).toEqual([]);
    expect(sel("styles/themes/light.css", ":root { --x: #fff; }")).toEqual([":root"]);
    expect(sel("styles/themes/dark.css", ".theme-dark { --x: #fff; }")).toEqual([]);
    expect(sel("styles/themes/dark.css", ".theme-light { --x: #fff; }")).toEqual([".theme-light"]);
  });

  it("TS colour functions are found whatever their first argument", () => {
    expect(scanTsColours('const c = "hsl(-20 100% 50%)";').map((x) => x.literal)).toHaveLength(1);
    expect(scanTsColours('const c = `rgb(${r}, 0, 0)`;').map((x) => x.literal)).toHaveLength(1);
  });

  it("named colours in TS comments are not literals", () => {
    expect(scanTsColours('// el.style.setProperty("color", "red");\n/* <a style={{ color: "red" }} /> */\n')).toEqual([]);
  });
});

describe("D278-FIX-2: only a rule whose whole selector is the token block is exempt", () => {
  const rogue = (selector: string) => `${selector} { --rogue: #fff; }\n.settings-dialog { color: var(--rogue); }`;
  const props = (rel: string, css: string) => findingsIn(rel, css).map((x) => x.property);

  it("a selector list ending in the block is scanned (audit H2 residual on PR #498)", () => {
    expect(props("styles/themes/light.css", rogue(".settings-dialog, .theme-light"))).toEqual(["--rogue"]);
    expect(props("styles/globals.css", rogue(".x,:root"))).toEqual(["--rogue"]);
  });

  it("a selector list starting with the block is scanned", () => {
    expect(props("styles/themes/dark.css", rogue(".theme-dark, .settings-dialog"))).toEqual(["--rogue"]);
  });

  it("a compound or descendant selector containing the block is scanned", () => {
    expect(props("styles/themes/light.css", rogue(".theme-light .x"))).toEqual(["--rogue"]);
    expect(props("styles/themes/light.css", rogue(".x .theme-light"))).toEqual(["--rogue"]);
    expect(props("styles/themes/light.css", rogue(".theme-light.x"))).toEqual(["--rogue"]);
  });

  it("the block itself stays exempt, after another rule and inside @media", () => {
    expect(props("styles/themes/light.css", ".a { color: var(--x); }\n.theme-light { --x: #fff; }")).toEqual([]);
    // D278-FIX-3: the reduced-motion block may only re-time an existing --motion-* token.
    expect(props("styles/globals.css", ":root { --motion-duration-fast: 150ms; }\n@media (prefers-reduced-motion: reduce) {\n  :root { --motion-duration-fast: 0ms; }\n}")).toEqual([]);
  });
});

// D278-FIX-3 (user: 「Let Codex weigh in」; Codex A+, adopted by the delegator): the three
// token files must match a closed grammar, enforced inside the exemption and tokenBlock()
// themselves, so unsupported syntax throws instead of being misread.
describe("D278-FIX-3: the token files match a closed grammar", () => {
  const exempt = (rel: string, css: string) => () => exemptTokenDeclarations(rel, css);
  const LIGHT = "styles/themes/light.css";
  const GLOBALS = "styles/globals.css";
  const MOTION_ROOT = ":root { --motion-duration-fast: 150ms; }\n";
  const media = (body: string) => `${MOTION_ROOT}@media (prefers-reduced-motion: reduce) {\n  :root { ${body} }\n}`;

  it("(1a) a nested rule inside a token block throws", () => {
    expect(exempt(LIGHT, ".theme-light { --a: #fff; .x { --b: #000; } }")).toThrow(/nested rule/);
  });

  it("(1b) a quoted } in a token value throws", () => {
    expect(exempt(LIGHT, '.theme-light { --a: "}"; }\n.x { color: red; }')).toThrow(/string contains/);
  });

  it("(2) a token block inside @supports or another @media throws", () => {
    expect(exempt(GLOBALS, ":root { --a: 1px; }\n@supports (color: red) { :root { --b: #fff; } }")).toThrow(/at-rule/);
    expect(exempt(GLOBALS, ":root { --a: 1px; }\n@media (min-width: 1px) { :root { --b: #fff; } }")).toThrow(/at-rule/);
    expect(exempt(LIGHT, ".theme-light { --a: #fff; }\n@media (prefers-reduced-motion: reduce) { .theme-light { --b: #fff; } }")).toThrow(/at-rule/);
  });

  it("(3) a quoted ; throws", () => {
    expect(exempt(LIGHT, '.theme-light { --font-sans: "a;b"; }\n.x { color: red; }')).toThrow(/string contains/);
  });

  it("(4) a declaration without its ; throws", () => {
    expect(exempt(LIGHT, ".theme-light {\n  --g: rgba(246, 247, 251, 0.8);\n  --g: rgba(1, 2, 3, 0.59)\n}")).toThrow(/without ;/);
  });

  it("rejects broken lexing: unterminated string or comment, unbalanced braces or parens", () => {
    expect(exempt(LIGHT, '.theme-light { --a: "x; }')).toThrow(/unterminated string/);
    expect(exempt(LIGHT, ".theme-light { --a: #fff; } /* open")).toThrow(/unterminated comment/);
    expect(exempt(LIGHT, ".theme-light { --a: #fff; }}")).toThrow(/unbalanced/);
    expect(exempt(LIGHT, ".theme-light { --a: #fff;")).toThrow(/unbalanced/);
    expect(exempt(LIGHT, ".theme-light { --a: calc(1px; }")).toThrow(/unbalanced/);
  });

  it("rejects comment delimiters in strings, backslashes and url( in any form", () => {
    expect(exempt(LIGHT, '.theme-light { --a: "/* x */"; }')).toThrow(/string contains/);
    expect(exempt(LIGHT, ".theme-light { --a: \\66 ff; }")).toThrow(/backslash/);
    expect(exempt(LIGHT, '.theme-light { --a: "a\\"b"; }')).toThrow(/backslash/);
    expect(exempt(LIGHT, ".theme-light { --a: url(x.svg); }")).toThrow(/url\(/);
    expect(exempt(LIGHT, '.theme-light { --a: URL("x.svg"); }')).toThrow(/url\(/);
  });

  it("the default block holds only custom properties, plus color-scheme in a theme file", () => {
    expect(exempt(LIGHT, ".theme-light { color-scheme: light; --a: #fff; }")).not.toThrow();
    expect(exempt(LIGHT, ".theme-light { color: red; }")).toThrow(/not a token declaration/);
    expect(exempt(GLOBALS, ":root { color-scheme: light; }")).toThrow(/not a token declaration/);
  });

  it("a file has at most one default block, and tokenBlock() needs exactly one", () => {
    expect(exempt(LIGHT, ".theme-light { --a: #fff; }\n.theme-light { --a: #000; }")).toThrow(/default block/);
    expect(() => tokenBlock(".x { --a: #fff; }", ".theme-light")).toThrow(/default block/);
    expect(() => tokenBlock(".theme-light { --a: #fff; .x { --b: #000; } }", ".theme-light")).toThrow(/nested rule/);
  });

  it("allows exactly the reduced-motion @media: one :root re-timing existing --motion-* tokens", () => {
    expect(exempt(GLOBALS, media("--motion-duration-fast: 0ms;"))).not.toThrow();
    expect(exempt(GLOBALS, media("--motion-duration-fast: 0.1s;"))).not.toThrow();
    expect(exempt(GLOBALS, media("--motion-rogue: #fff;"))).toThrow(/--motion-rogue/);
    expect(exempt(GLOBALS, media("--motion-duration-fast: #fff;"))).toThrow(/not a time/);
    expect(exempt(GLOBALS, media("--motion-rogue: 0ms;"))).toThrow(/not declared in the default :root/);
    expect(exempt(GLOBALS, media("--color-x: #fff;"))).toThrow(/--motion-\*/);
    expect(exempt(GLOBALS, `${MOTION_ROOT}@media (prefers-reduced-motion: reduce) { :root { --motion-duration-fast: 0ms; } .theme-light { --a: 0ms; } }`)).toThrow(/:root/);
    expect(exempt(GLOBALS, `${media("--motion-duration-fast: 0ms;")}\n@media (prefers-reduced-motion: reduce) { :root { --motion-duration-fast: 0ms; } }`)).toThrow(/at-rule/);
  });

  it("the three real token files pass, with and without tokenBlock()", () => {
    expect(() => validateTokenFile(read("styles/globals.css"), "globals", { requireBlock: true })).not.toThrow();
    expect(() => validateTokenFile(read("styles/themes/light.css"), "light", { requireBlock: true })).not.toThrow();
    expect(() => validateTokenFile(read("styles/themes/dark.css"), "dark", { requireBlock: true })).not.toThrow();
  });
});

describe("D278-FIX-4: a token file declares each property once, never !important, never empty", () => {
  const exempt = (rel: string, css: string) => () => exemptTokenDeclarations(rel, css);
  const LIGHT = "styles/themes/light.css";
  const GLOBALS = "styles/globals.css";

  it("a property declared twice in one block throws, in the default block and in the @media", () => {
    expect(exempt(LIGHT, ".theme-light {\n  --color-group-bg: rgba(246, 247, 251, 0.8);\n  --color-group-bg: rgba(1, 2, 3, 0.59);\n}")).toThrow(/declared twice/);
    expect(exempt(GLOBALS, ":root { --motion-duration-fast: 150ms; }\n@media (prefers-reduced-motion: reduce) { :root { --motion-duration-fast: 0ms; --motion-duration-fast: 1ms; } }")).toThrow(/declared twice/);
    expect(() => tokenBlock(".theme-light { --a: #fff; --a: #000; }", ".theme-light")).toThrow(/declared twice/);
  });

  it("!important anywhere in a token file throws (audit confirm 3, finding 1)", () => {
    expect(exempt(LIGHT, ".theme-light {\n  --color-group-bg: rgba(1, 2, 3, 0.59) !important;\n  --color-x: #fff;\n}")).toThrow(/!important/);
    expect(exempt(LIGHT, ".theme-light { --a: #fff; }\n.x { color: var(--a) ! important; }")).toThrow(/!important/);
  });

  it("an empty or whitespace-only value throws (audit confirm 3, finding 2)", () => {
    expect(exempt(LIGHT, ".theme-light {\n  --color-group-bg: rgba(246, 247, 251, 0.8);\n  --color-y:;\n}")).toThrow(/empty value/);
    expect(exempt(LIGHT, ".theme-light { --a:   ; }")).toThrow(/empty value/);
    expect(exempt(LIGHT, ".theme-light { --a: /* gone */; }")).toThrow(/empty value/);
  });

  it("the reduced-motion fixtures of FIX-1 and FIX-2 really are exempted, not merely finding-free", () => {
    const fix1 = ":root { --motion-duration-fast: 150ms; }\n@media (prefers-reduced-motion: reduce) { :root { --motion-duration-fast: 0ms; } }";
    const fix2 = ":root { --motion-duration-fast: 150ms; }\n@media (prefers-reduced-motion: reduce) {\n  :root { --motion-duration-fast: 0ms; }\n}";
    for (const css of [fix1, fix2]) {
      const out = exemptTokenDeclarations(GLOBALS, css);
      expect(out).not.toMatch(/--motion-duration-fast/);
      expect(out.length).toBe(css.length);
      expect(out.match(/:root \{/g)).toHaveLength(2);
    }
  });
});

describe("D278-FIX-4: tokenBlock and the exemption read the block the grammar parsed (Fable F1)", () => {
  const LIGHT = "styles/themes/light.css";
  const GLOBALS = "styles/globals.css";

  it("a selector list ending in the block, above the real block, is never taken for it: it throws", () => {
    const css = ".x,\n.theme-light { --color-text: var(--color-ink); }\n.theme-light { --color-text: #eeeeee; }";
    expect(() => tokenBlock(css, ".theme-light")).toThrow(/root element/);
    const listed = ".x,\n.theme-light { --c: #fff; }\n.theme-light { --c: #000; }";
    expect(() => findingsIn(LIGHT, listed)).toThrow(/root element/);
  });

  it("the reduced-motion @media above the default :root throws", () => {
    const css = "@media (prefers-reduced-motion: reduce) { :root { --motion-duration-fast: 0ms; } }\n:root { --motion-duration-fast: 150ms; }";
    expect(() => tokenBlock(css, ":root")).toThrow(/before the default block/);
    expect(() => exemptTokenDeclarations(GLOBALS, css)).toThrow(/before the default block/);
  });

  it("a block that follows another rule on the same line is read", () => {
    const css = ".y { --a: 1px; }.theme-light { --b: #fff; }";
    expect([...tokenBlock(css, ".theme-light")]).toEqual([["--b", "#fff"]]);
    expect(findingsIn(LIGHT, ".y { --a: #fff; }.theme-light { --b: #fff; }").map((x) => `${x.selector} ${x.property}`)).toEqual([".y --a"]);
  });

  it("a custom-property name outside [\\w-] throws", () => {
    expect(() => exemptTokenDeclarations(LIGHT, ".theme-light { --色: #fff; }")).toThrow(/name/);
    expect(() => exemptTokenDeclarations(LIGHT, ".theme-light { --a: #fff; }\n.x { --b.c: 1px; }")).toThrow(/name/);
  });
});

describe("D278-FIX-4: no rule but the default block sets tokens on the root element", () => {
  const exempt = (rel: string, css: string) => () => exemptTokenDeclarations(rel, css);
  const LIGHT = "styles/themes/light.css";
  const GLOBALS = "styles/globals.css";

  it("a later rule reaching the root element cannot override a token unseen by tokenBlock", () => {
    expect(exempt(LIGHT, ".theme-light { --color-text: #1a1a1a; }\n.x,\n.theme-light { --color-text: var(--color-danger); }")).toThrow(/root element/);
    expect(exempt(GLOBALS, ":root { --a: 1px; }\nhtml { --a: 2px; }")).toThrow(/root element/);
    expect(exempt(GLOBALS, ":root { --a: 1px; }\n:root.theme-dark { --a: 2px; }")).toThrow(/root element/);
    expect(() => tokenBlock(".theme-dark { --a: 1px; }\nhtml.theme-dark { --a: 2px; }", ".theme-dark")).toThrow(/root element/);
  });

  it("other rules may still set custom properties, and root rules may set ordinary properties", () => {
    expect(exempt(GLOBALS, ":root { --a: 1px; }\nbody.tauri-macos { --t: 78px; }\nhtml,\nbody { height: 100%; }")).not.toThrow();
  });
});
