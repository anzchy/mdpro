// @vitest-environment node
/**
 * @module d244-button-focus-visible.test
 * Purpose: D244. Buttons with no `:focus-visible` rule drew WebKit's default
 * translucent ring on keyboard focus (the "+" read `#7baff8`, 2.10:1 on the
 * tab bar), not rule 33's. Each now has its own ring:
 * - pattern 2 (2px `--color-focus-ring`, offset 2px) on the "+", the TOC
 *   caret, the Settings ×, the toast ×, the shortcut banner's Discard, the
 *   shortcut value, the image menu's Apply and the MCP copy buttons, which
 *   also go to full opacity on focus, as on hover (D231 (c) reveal-on-focus);
 * - the table menu's ring on the image menu's items (inset 2px, and on the
 *   accent-filled current size the panel colour inset 4px, 「D234:a」).
 * A sweep fails on any rendered `<button>` whose classes reach no
 * `:focus-visible` rule, unless it is on the allow-list.
 *
 * Strategy: source inspection (jsdom has no `:focus-visible`), the pattern of
 * tests/focus-ring-wi33.test.ts; ring contrast is measured against the real
 * background from the theme tokens, as tests/d231-tab-active-contrast.test.ts
 * does. The device Tab walk covers what a selector cannot.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, parseDeclarations } from "./support/cssTokenScan";
import { contrast, over, resolveColor, themeTokens, type Rgba, type Theme } from "./support/contrast";
import { focusVisibleClasses, unringedButtons } from "./support/buttonFocusSweep";

const SRC = join(__dirname, "..", "src");
const files = (readdirSync(SRC, { recursive: true }) as string[]).map((p) => p.split("\\").join("/"));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const cssPaths = files.filter((p) => p.endsWith(".css"));
const appCss = cssPaths.map((p) => blankComments(read(p))).join("\n");
const decls = cssPaths.flatMap((p) => parseDeclarations(read(p)));

/** The declarations of exactly `selector` across app CSS, property → value. */
const rule = (selector: string) =>
  new Map(
    decls
      .filter((d) => d.selector.split(",").some((s) => s.trim() === selector))
      .map((d) => [d.property, d.value]),
  );

const RING = "2px solid var(--color-focus-ring)";

/** Pattern 2 rings and the layers behind each, top first (CSS colours). */
const OUTER: { selector: string; behind: string[][] }[] = [
  { selector: ".bottom-tabs__add:focus-visible", behind: [["var(--color-surface)"]] },
  {
    selector: ".toc-entry__collapse:focus-visible",
    // A resting row, and the current (accent-tinted) row.
    behind: [["var(--color-surface)"], ["var(--color-accent-soft)", "var(--color-surface)"]],
  },
  { selector: ".settings-close:focus-visible", behind: [["var(--color-panel)"]] },
  { selector: ".toast-close:focus-visible", behind: [["var(--color-panel)"]] },
  {
    selector: ".settings-dirty-banner__discard:focus-visible",
    behind: [["rgba(245, 158, 11, 0.12)", "var(--color-panel)"]],
  },
  { selector: ".shortcut-value:focus-visible", behind: [["var(--settings-card-bg)", "var(--color-panel)"]] },
  { selector: ".image-context-menu-apply:focus-visible", behind: [["var(--color-panel)"]] },
  { selector: ".mcp-copy-btn:focus-visible", behind: [["var(--color-bg-secondary)", "var(--color-panel)"]] },
];

function backdrop(layers: string[], t: ReadonlyMap<string, string>): Rgba {
  return layers.reduceRight<Rgba>((under, layer) => over(resolveColor(layer, t), under), [255, 255, 255, 1]);
}

const ringOn = (theme: Theme, colour: string, layers: string[]) => {
  const t = themeTokens(theme);
  return contrast(resolveColor(colour, t), backdrop(layers, t));
};

describe("D244: each button draws rule 33's ring", () => {
  it.each(OUTER.map((o) => o.selector))("%s is pattern 2", (selector) => {
    const r = rule(selector);
    expect(r.get("outline")).toBe(RING);
    expect(r.get("outline-offset")).toBe("2px");
  });

  it("the + ring is the sidebar toggle's", () => {
    expect(Object.fromEntries(rule(".bottom-tabs__add:focus-visible"))).toEqual(
      Object.fromEntries(rule(".bottom-tabs__sidebar-toggle:focus-visible")),
    );
  });

  it("the MCP copy button shows at full strength when focused, as on hover", () => {
    expect(rule(".mcp-copy-btn").get("opacity")).toBe("0.6");
    expect(rule(".mcp-copy-btn:focus-visible").get("opacity")).toBe("1");
    expect(rule(".mcp-copy-btn:hover").get("opacity")).toBe("1");
  });

  it("the image menu's items copy the table menu's rings (「D234:a」)", () => {
    const pairs: [string, string][] = [
      [".image-context-menu-button:focus-visible", ".table-context-menu-item:focus-visible"],
      [".image-context-menu-button.is-active:focus-visible", ".table-context-menu-item.is-active:focus-visible"],
    ];
    for (const [image, table] of pairs) {
      expect(rule(image).size).toBeGreaterThan(0);
      expect(Object.fromEntries(rule(image))).toEqual(Object.fromEntries(rule(table)));
    }
  });

  it.each<Theme>(["light", "dark"])("%s: every ring is ≥ 3:1 against what is behind it", (theme) => {
    const low: string[] = [];
    for (const { selector, behind } of OUTER) {
      for (const layers of behind) {
        const r = ringOn(theme, "var(--color-focus-ring)", layers);
        if (r < 3) low.push(`${selector} on ${layers.join(" over ")}: ${r.toFixed(2)}`);
      }
    }
    // Inset rings: the accent on the resting item (panel), the panel on the
    // current size's accent fill.
    const inset = ringOn(theme, "var(--color-focus-ring)", ["var(--color-panel)"]);
    const active = ringOn(theme, "var(--color-panel)", ["var(--color-accent)"]);
    if (inset < 3) low.push(`image menu item: ${inset.toFixed(2)}`);
    if (active < 3) low.push(`image menu current size: ${active.toFixed(2)}`);
    expect(low).toEqual([]);
  });
});

/** `TabBar/` is dead: only its own index imports it (plan P A8). */
const DEAD = (p: string) => p.startsWith("components/TabBar/");

/**
 * Rendered buttons with no ring of our own, keyed `file class` with a count.
 * A stale entry fails too, so this list only shrinks.
 */
const ALLOWED: Record<string, number> = {
  // D244-WI-2, awaiting user ruling: the stepper's ring (a1/a2/a3 prototype).
  "components/common/settings/SettingsStepper.tsx (unclassed)": 2,
};

describe("D244 sweep: every rendered <button> reaches a :focus-visible rule", () => {
  const ringed = focusVisibleClasses(appCss);
  const found: Record<string, number> = {};
  for (const p of files.filter((f) => f.endsWith(".tsx") && !DEAD(f))) {
    for (const key of unringedButtons(read(p), ringed)) {
      const k = `${p} ${key}`;
      found[k] = (found[k] ?? 0) + 1;
    }
  }

  it("finds no button outside the allow-list", () => {
    expect(Object.keys(found).filter((k) => found[k] > (ALLOWED[k] ?? 0))).toEqual([]);
  });

  it("has no stale allow-list entry", () => {
    expect(Object.keys(ALLOWED).filter((k) => (found[k] ?? 0) !== ALLOWED[k])).toEqual([]);
  });
});

describe("the sweep itself", () => {
  const ringed = focusVisibleClasses(
    ".a:focus-visible{} .wrap .b:hover:focus-visible{} .c:has(.d:focus-visible){} /* .e:focus-visible */",
  );

  it("collects only classes in the compound that carries :focus-visible", () => {
    expect([...ringed].sort()).toEqual(["a", "b", "d"]);
  });

  it("flags unclassed and unringed buttons, and skips ringed ones and comments", () => {
    const tsx = [
      "// a <button> in a comment",
      '<button className="a">x</button>',
      "<button className={`b ${on ? \"z\" : \"\"}`}>y</button>",
      '<button className="c">z</button>',
      "<button onClick={() => go()}>w</button>",
      '/* <button className="q"> */',
    ].join("\n");
    expect(unringedButtons(tsx, ringed)).toEqual(["c", "(unclassed)"]);
  });
});
