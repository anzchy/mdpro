// @vitest-environment node
/**
 * @module d278-parity-values.test
 * Purpose: D278's parity gate (plan § Parity proof, layer 1; user ruling
 * 「Demote browser check (Recommended)」). D278 moves colour literals and the
 * `--settings-*` fills into tokens without changing a rendered colour. Each
 * row reads the real declaration from its CSS file, resolves it in three
 * token sets (`:root` alone = first paint, `:root` + light, `:root` + dark)
 * and asserts the exact `[r, g, b, a]`. Alpha is compared as is: nothing is
 * composited or rounded to hex, so `0.6 → 0.59` fails.
 *
 * What this proves: declaration and token values. What it does not:
 * cascade, specificity or pseudo-element rendering. The "still wins" cases
 * are static order and specificity checks, and the browser run in
 * `docs/test/` is evidence only.
 *
 * Strategy: source inspection with the theme-token resolver of
 * tests/support/contrast.ts, as tests/contrast-d227.test.ts does.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, parseDeclarations } from "./support/cssTokenScan";
import { contrast, over, resolveColor, rootTokens, themeTokens, type Rgba } from "./support/contrast";

const SRC = join(__dirname, "..", "src");
const SEC = "styles/sections";
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** The value of `property` in the rule whose selector list contains exactly `selector`, in `file`. */
function valueOf(file: string, selector: string, property: string): string {
  const hits = parseDeclarations(read(file)).filter(
    (d) => d.property === property && d.selector.split(",").some((s) => s.trim() === selector),
  );
  if (hits.length !== 1) throw new Error(`${file}: ${hits.length} \`${property}\` in ${selector}, expected 1`);
  return hits[0].value;
}

const FRAMES = { root: rootTokens(), light: themeTokens("light"), dark: themeTokens("dark") } as const;
type Frame = keyof typeof FRAMES;

function expectRgba(actual: Rgba, expected: Rgba, label: string) {
  actual.forEach((c, i) => expect(c, `${label} channel ${i}`).toBeCloseTo(expected[i], 6));
}

interface Row {
  file: string;
  selector: string;
  property: string;
  /** The colour part of the value, e.g. a border's colour after `1px solid `. */
  colour?: (value: string) => string;
  expect: Record<Frame, Rgba>;
}

const GROUP_LIGHT: Rgba = [246, 247, 251, 0.8];
const GROUP_DARK: Rgba = [15, 18, 28, 0.6];
const INPUT_LIGHT: Rgba = [255, 255, 255, 0.9];
const INPUT_DARK: Rgba = [15, 18, 28, 0.9];
const group = { root: GROUP_LIGHT, light: GROUP_LIGHT, dark: GROUP_DARK };
const input = { root: INPUT_LIGHT, light: INPUT_LIGHT, dark: INPUT_DARK };

/** WI-4: the `--settings-*` fills, now `--color-group-bg` / `--color-input-bg`. */
const SETTINGS_FILLS: Row[] = [
  { file: `${SEC}/settings-shell.css`, selector: ".shortcuts-section", property: "background", expect: group },
  { file: `${SEC}/settings-pages.css`, selector: ".settings-form-row", property: "background", expect: group },
  { file: `${SEC}/settings-pages.css`, selector: ".settings-select", property: "background", expect: input },
  { file: `${SEC}/settings-shell.css`, selector: ".shortcut-value", property: "background", expect: input },
  { file: `${SEC}/settings-shell.css`, selector: ".settings-search", property: "background", expect: input },
  { file: `${SEC}/toc-sidebar.css`, selector: ".settings-input", property: "background", expect: input },
];

function checkRows(rows: Row[]) {
  it.each(rows.map((r) => [`${r.selector} { ${r.property} }`, r] as const))("%s keeps its colour", (_, r) => {
    const raw = valueOf(r.file, r.selector, r.property);
    const colour = r.colour ? r.colour(raw) : raw;
    for (const frame of Object.keys(FRAMES) as Frame[]) {
      expectRgba(resolveColor(colour, FRAMES[frame]), r.expect[frame], `${r.selector} ${frame}`);
    }
  });
}

describe("D278-WI-4: the Settings fills keep their colours", () => {
  checkRows(SETTINGS_FILLS);

  it("the group fill is --color-group-bg and the input fill --color-input-bg", () => {
    for (const r of SETTINGS_FILLS) {
      const token = r.expect === group ? "var(--color-group-bg)" : "var(--color-input-bg)";
      expect(valueOf(r.file, r.selector, r.property), r.selector).toBe(token);
    }
  });

  it("no --settings-* token is declared or used anywhere in src", () => {
    const files = (readdirSync(SRC, { recursive: true }) as string[])
      .map((p) => p.split("\\").join("/"))
      .filter((p) => /\.(css|ts|tsx)$/.test(p));
    const hits = files.flatMap((p) =>
      [...blankComments(read(p)).matchAll(/--settings-[\w-]+/g)].map((m) => `${p}: ${m[0]}`),
    );
    expect(hits).toEqual([]);
  });

  it("the orphan .settings-placeholder-card rule is deleted (red on master by construction)", () => {
    const sel = parseDeclarations(read(`${SEC}/settings-pages.css`)).filter((d) =>
      d.selector.split(",").some((s) => s.trim() === ".settings-placeholder-card"),
    );
    expect(sel).toEqual([]);
  });

  it(".shortcut-value.is-editing still overrides the input fill (static order and specificity)", () => {
    const decls = parseDeclarations(read(`${SEC}/settings-shell.css`));
    const base = decls.find((d) => d.selector === ".shortcut-value" && d.property === "background");
    const editing = decls.find((d) => d.selector === ".shortcut-value.is-editing" && d.property === "background");
    expect(editing?.value).toBe("var(--color-accent-soft)");
    expect(editing!.line).toBeGreaterThan(base!.line);
  });
});

/** True when `text` on `layers` (top first, over an opaque base) reaches `min`. */
function reaches(text: string, layers: string[], frame: Frame, min: number): boolean {
  const t = FRAMES[frame];
  const bg = layers.reduceRight<Rgba>((under, layer) => over(resolveColor(layer, t), under), [255, 255, 255, 1]);
  return contrast(over(resolveColor(text, t), bg), bg) >= min;
}

describe("D278-WI-4: text on the Settings fills (characterisation)", () => {
  const PANEL = "var(--color-panel)";
  const STACKS: [string, string[]][] = [
    [".shortcuts-section", ["var(--color-group-bg)", PANEL]],
    [".shortcut-value", ["var(--color-input-bg)", "var(--color-group-bg)", PANEL]],
    [".settings-select / .settings-input", ["var(--color-input-bg)", PANEL]],
  ];
  const cases = STACKS.flatMap(([name, layers]) =>
    (["light", "dark"] as Frame[]).flatMap((frame) =>
      ["var(--color-text)", "var(--color-muted)"].map((text) => [name, frame, text, layers] as const),
    ),
  );

  it.each(cases)("%s, %s: %s reaches 4.5:1", (_, frame, text, layers) => {
    expect(reaches(text, [...layers], frame, 4.5)).toBe(true);
  });

  it("the check fails a fill that drops muted text below 4.5:1", () => {
    expect(reaches("var(--color-muted)", ["color-mix(in srgb, var(--color-muted) 60%, transparent)", PANEL], "light", 4.5)).toBe(false);
  });
});
