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
 *   accent-filled current size the panel colour inset 4px, 「D234:a」);
 * - D244-WI-2: the Settings font-size stepper's group gets pattern 2 and its
 *   − / + buttons inset rings (「a2: inset rings (Recommended)」); the Settings
 *   rail's category buttons get an inset ring. D260 retargets the rail: no
 *   focus fill (DESIGN.md § Settings rail, focus and selection read apart),
 *   measured over the flat `--color-surface` rail at rest, hovered and
 *   selected.
 * A sweep fails on any rendered `<button>` that satisfies no `:focus-visible`
 * compound (every class of it among the button's classes).
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
import { focusVisibleCompounds, scanButtons } from "./support/buttonFocusSweep";

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
  { selector: ".settings-stepper:focus-visible", behind: [["var(--color-panel)"]] },
];

/** Inset rings (offset −2px): the ring and the layers inside the element, top first. */
const INSET: { selector: string; behind: string[][] }[] = [
  // The stepper's buttons have no fill of their own.
  { selector: ".settings-stepper__step:focus-visible", behind: [["var(--color-panel)"]] },
  {
    selector: ".settings-category-btn:focus-visible",
    // D260 (F1): the focus rule has no fill, so the ring sits on the row's own
    // background: resting (the rail's surface), hovered, and selected. The old
    // lists measured the D244 accent-soft focus fill over the gradient
    // `--settings-sidebar-bg`, both of which D260 removes.
    behind: [
      ["var(--color-surface)"],
      ["var(--color-hover)", "var(--color-surface)"],
      ["color-mix(in srgb, var(--color-text) 9%, transparent)", "var(--color-surface)"],
    ],
  },
];

function backdrop(layers: string[], t: ReadonlyMap<string, string>): Rgba {
  return layers.reduceRight<Rgba>((under, layer) => over(resolveColor(layer, t), under), [255, 255, 255, 1]);
}

/**
 * A layer that is a token holding a `linear-gradient` (the Settings sidebar)
 * becomes one layer list per colour stop, so the ring is measured on each.
 */
function expandGradients(layers: string[], t: ReadonlyMap<string, string>): string[][] {
  return layers.reduce<string[][]>(
    (lists, layer) => {
      const value = t.get(layer.match(/^var\((--[\w-]+)\)$/)?.[1] ?? "") ?? "";
      const stops = value.startsWith("linear-gradient(") ? (value.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/g) ?? []) : [];
      const options = stops.length > 0 ? stops : [layer];
      return lists.flatMap((list) => options.map((o) => [...list, o]));
    },
    [[]],
  );
}

/** The lowest ring contrast over every stop of `layers`. */
const ringOn = (theme: Theme, colour: string, layers: string[]) => {
  const t = themeTokens(theme);
  const ring = resolveColor(colour, t);
  return Math.min(...expandGradients(layers, t).map((l) => contrast(ring, backdrop(l, t))));
};

describe("D244: each button draws rule 33's ring", () => {
  it.each(OUTER.map((o) => o.selector))("%s is pattern 2", (selector) => {
    const r = rule(selector);
    expect(r.get("outline")).toBe(RING);
    expect(r.get("outline-offset")).toBe("2px");
  });

  it.each(INSET.map((o) => o.selector))("%s is an inset ring", (selector) => {
    const r = rule(selector);
    expect(r.get("outline")).toBe(RING);
    expect(r.get("outline-offset")).toBe("-2px");
  });

  it("the stepper's − and + carry the class the inset ring targets", () => {
    const tsx = read("components/common/settings/SettingsStepper.tsx");
    expect(tsx.match(/<button\b[^>]*className="settings-stepper__step"/g)).toHaveLength(2);
  });

  // D260 (F3): DESIGN.md § Settings rail supersedes pattern 3's accent-soft
  // fill here: focus is the inset ring alone, so focus and selection read
  // apart. The old "focus before .is-active" ordering only protected that fill;
  // the hover/active ordering is pinned by d260-settings-rail-css.test.ts C6.
  it("a focused Settings category draws no fill of its own (D260)", () => {
    const r = rule(".settings-category-btn:focus-visible");
    expect(r.get("outline")).toBe(RING);
    expect(r.has("background")).toBe(false);
    expect(r.has("background-color")).toBe(false);
  });

  // D260 (F2): the ring on the resting rail, DESIGN.md § Settings rail > Measured.
  it.each<[Theme, number]>([
    ["light", 4.83],
    ["dark", 6.85],
  ])("%s: the rail's focus ring on the resting surface is %s:1", (theme, ratio) => {
    expect(ringOn(theme, "var(--color-focus-ring)", ["var(--color-surface)"])).toBeCloseTo(ratio, 2);
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
    for (const { selector, behind } of [...OUTER, ...INSET]) {
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
 * Fewer rendered buttons than this means the scan broke, not that buttons
 * went away: 44 on 2026-10-15. Lower it only alongside removing buttons.
 * 43 since D260 (F4): the Settings footer's "Close" button was removed.
 */
const MIN_BUTTONS = 43;

describe("D244 sweep: every rendered <button> reaches a :focus-visible rule", () => {
  const compounds = focusVisibleCompounds(appCss);
  const scanned = files
    .filter((f) => f.endsWith(".tsx") && !DEAD(f))
    .flatMap((p) => scanButtons(read(p), compounds).map((b) => ({ ...b, file: p })));

  it(`scans at least ${MIN_BUTTONS} buttons`, () => {
    expect(scanned.length).toBeGreaterThanOrEqual(MIN_BUTTONS);
  });

  it("finds no button without a ring", () => {
    expect(scanned.filter((b) => !b.ringed).map((b) => `${b.file} ${b.key}`)).toEqual([]);
  });
});

describe("the sweep itself", () => {
  const compounds = focusVisibleCompounds(
    [
      ".a:focus-visible{} .wrap .b:hover:focus-visible{} .c:has(.d:focus-visible){} /* .e:focus-visible */",
      ".item.is-active:focus-visible{} .f:not(.g):focus-visible{} button:focus-visible{}",
    ].join("\n"),
  );
  const unringed = (tsx: string) => scanButtons(tsx, compounds).filter((b) => !b.ringed).map((b) => b.key);

  it("collects each compound that carries :focus-visible, without :not() or class-less ones", () => {
    expect(compounds).toEqual([["a"], ["b"], ["d"], ["item", "is-active"], ["f"]]);
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
    expect(scanButtons(tsx, compounds)).toHaveLength(4);
    expect(unringed(tsx)).toEqual(["c", "(unclassed)"]);
  });

  it("does not let one class of a compound ring a button (the rail's `is-active`)", () => {
    // Matching any single class of any compound passed this button.
    const rail = "<button className={`rail ${on ? \"is-active\" : \"\"}`}>General</button>";
    expect(unringed(rail)).toEqual(["rail"]);
    const item = "<button className={`item ${on ? \"is-active\" : \"\"}`}>16px</button>";
    expect(unringed(item)).toEqual([]);
  });
});
