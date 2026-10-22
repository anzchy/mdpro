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
import { contrast, over, resolveColor, rgbaEquals, rootTokens, themeTokens, toHex, type Rgba } from "./support/contrast";
import { collectionCases } from "./support/collectionCases";

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
  expect(rgbaEquals(actual, expected), `${label}: [${actual.join(", ")}] vs [${expected.join(", ")}]`).toBe(true);
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
  it.each(collectionCases("tests/d278-parity-values.test.ts:74", rows.map((r) => [`${r.selector} { ${r.property} }`, r] as const)))("%s keeps its colour", (_, r) => {
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

  it.each(collectionCases("tests/d278-parity-values.test.ts:139", cases))("%s, %s: %s reaches 4.5:1", (_, frame, text, layers) => {
    expect(reaches(text, [...layers], frame, 4.5)).toBe(true);
  });

  it("the check fails a fill that drops muted text below 4.5:1", () => {
    expect(reaches("var(--color-muted)", ["color-mix(in srgb, var(--color-muted) 60%, transparent)", PANEL], "light", 4.5)).toBe(false);
  });
});

const ACCENT_LIGHT: Rgba = [37, 99, 235, 1];
const ACCENT_DARK: Rgba = [96, 165, 250, 1];
const same = (c: Rgba) => ({ root: c, light: c, dark: c });
/** The colour after a border's `1px solid `, which the row also pins. */
const afterSolid = (v: string) => {
  expect(v.startsWith("1px solid ")).toBe(true);
  return v.slice("1px solid ".length);
};

/** WI-2 and D275: the remaining colour literals, now tokens; nothing renders differently. */
const LITERAL_MOVES: Row[] = [
  { file: `${SEC}/settings-mcp.css`, selector: ".mcp-status-badge.running", property: "background", expect: same([220, 252, 231, 1]) },
  { file: `${SEC}/settings-mcp.css`, selector: ".mcp-status-badge.running", property: "color", expect: same([22, 163, 74, 1]) },
  { file: `${SEC}/settings-rows.css`, selector: ".toggle-slider", property: "background-color", expect: same([204, 204, 204, 1]) },
  { file: `${SEC}/settings-pages.css`, selector: ".settings-dirty-banner", property: "background", expect: same([245, 158, 11, 0.12]) },
  {
    file: `${SEC}/settings-pages.css`,
    selector: ".settings-dirty-banner",
    property: "border",
    colour: afterSolid,
    expect: same([245, 158, 11, 0.4]),
  },
  {
    file: `${SEC}/settings-about.css`,
    selector: ".about-progress-bar::-webkit-progress-value",
    property: "background",
    expect: { root: ACCENT_LIGHT, light: ACCENT_LIGHT, dark: ACCENT_DARK },
  },
];

describe("D278-WI-2: the moved colour literals keep their colours", () => {
  checkRows(LITERAL_MOVES);

  it("each moved literal goes through its token", () => {
    const via = (file: string, selector: string, property: string) => valueOf(`${SEC}/${file}`, selector, property);
    expect(via("settings-mcp.css", ".mcp-status-badge.running", "background")).toBe("var(--color-running-fill)");
    expect(via("settings-mcp.css", ".mcp-status-badge.running", "color")).toBe("var(--color-running-text)");
    expect(via("settings-rows.css", ".toggle-slider", "background-color")).toBe("var(--color-toggle-track-off)");
    expect(via("settings-pages.css", ".settings-dirty-banner", "background")).toBe(
      "color-mix(in srgb, var(--color-banner-unsaved) 12%, transparent)",
    );
    expect(via("settings-pages.css", ".settings-dirty-banner", "border")).toBe(
      "1px solid color-mix(in srgb, var(--color-banner-unsaved) 40%, transparent)",
    );
    expect(via("settings-about.css", ".about-progress-bar::-webkit-progress-value", "background")).toBe("var(--color-accent)");
  });

  it("--color-danger-soft derives from --color-danger at today's values (D275 C9)", () => {
    const expected = { root: [220, 38, 38, 0.12], light: [220, 38, 38, 0.12], dark: [248, 113, 113, 0.18] } as Record<Frame, Rgba>;
    for (const frame of Object.keys(FRAMES) as Frame[]) {
      const raw = FRAMES[frame].get("--color-danger-soft") ?? "";
      expect(raw, frame).toMatch(/^color-mix\(in srgb, var\(--color-danger\) \d+%, transparent\)$/);
      expectRgba(resolveColor(raw, FRAMES[frame]), expected[frame], `--color-danger-soft ${frame}`);
    }
  });

  it("the checked toggle still overrides the off-track (static order and specificity)", () => {
    const decls = parseDeclarations(read(`${SEC}/settings-rows.css`));
    const off = decls.find((d) => d.selector === ".toggle-slider" && d.property === "background-color");
    const on = decls.find(
      (d) => d.selector === ".toggle-switch input:checked + .toggle-slider" && d.property === "background-color",
    );
    expect(on?.value).toBe("var(--color-accent)");
    expect(on!.line).toBeGreaterThan(off!.line);
  });

  it("the dead TabBar's active shadow is --shadow-soft: an expected change, red on master by construction", () => {
    expect(valueOf(`${SEC}/tab-bar.css`, ".tab--active", "box-shadow")).toBe("var(--shadow-soft)");
  });
});

describe("D278: the resolver reads what the baselines need", () => {
  const t = FRAMES.light;

  it("resolves a var() fallback only when the token is undeclared (C8 baseline)", () => {
    expect(resolveColor("var(--undeclared, #007aff)", t)).toEqual([0, 122, 255, 1]);
    expect(resolveColor("var(--color-accent, #007aff)", t)).toEqual(ACCENT_LIGHT);
  });

  it("parses 4- and 8-digit hex with alpha", () => {
    expectRgba(resolveColor("#ff5582a6", t), [255, 85, 130, 166 / 255], "#ff5582a6");
    expectRgba(resolveColor("#fff8", t), [255, 255, 255, 0x88 / 255], "#fff8");
  });

  it("toHex keeps alpha: 6 digits when opaque, 8 otherwise, lowercase", () => {
    expect(toHex([37, 99, 235, 1])).toBe("#2563eb");
    expect(toHex([15, 23, 42, 0.35])).toBe("#0f172a59");
    expect(toHex([255, 85, 130, 0.65])).toBe("#ff5582a6");
  });
});

// D278-FIX-1 (audit H1 on PR #498): every state and pseudo row of the plan's
// matrix resolves to its colour in all three frames, not only the base fills.
const ACCENT_SOFT = { root: [37, 99, 235, 0.14], light: [37, 99, 235, 0.14], dark: [96, 165, 250, 0.22] } as Record<Frame, Rgba>;
const ACCENT = { root: ACCENT_LIGHT, light: ACCENT_LIGHT, dark: ACCENT_DARK };
const MUTED = { root: [107, 114, 128, 1], light: [107, 114, 128, 1], dark: [154, 164, 178, 1] } as Record<Frame, Rgba>;
// light: the accent 80% with the text #1a1a1a; dark: the accent.
const ACCENT_TEXT = { root: [34.8, 84.4, 193.2, 1], light: [34.8, 84.4, 193.2, 1], dark: ACCENT_DARK } as Record<Frame, Rgba>;
/** The colour after a fixed prefix, which the row also pins. */
const after = (prefix: string) => (v: string) => {
  expect(v.startsWith(prefix), `${v} starts with ${prefix}`).toBe(true);
  return v.slice(prefix.length);
};

const STATE_ROWS: Row[] = [
  { file: `${SEC}/settings-rows.css`, selector: ".toggle-switch input:checked + .toggle-slider", property: "background-color", expect: ACCENT },
  { file: `${SEC}/settings-rows.css`, selector: ".toggle-slider:before", property: "background-color", expect: same([255, 255, 255, 1]) },
  { file: `${SEC}/settings-rows.css`, selector: ".toggle-switch input:focus-visible + .toggle-slider", property: "outline", colour: after("2px solid "), expect: ACCENT },
  { file: `${SEC}/settings-pages.css`, selector: ".settings-select:focus-visible", property: "border-color", expect: ACCENT },
  { file: `${SEC}/settings-pages.css`, selector: ".settings-select:focus-visible", property: "outline", colour: after("2px solid "), expect: ACCENT },
  { file: `${SEC}/settings-shell.css`, selector: ".shortcut-value:hover", property: "border-color", expect: ACCENT },
  { file: `${SEC}/settings-shell.css`, selector: ".shortcut-value.is-editing", property: "background", expect: ACCENT_SOFT },
  { file: `${SEC}/settings-shell.css`, selector: ".shortcut-value.is-editing", property: "border-color", expect: ACCENT },
  { file: `${SEC}/settings-shell.css`, selector: ".shortcut-value.is-editing", property: "color", expect: ACCENT_TEXT },
  { file: `${SEC}/settings-shell.css`, selector: ".shortcut-value:focus-visible", property: "outline", colour: after("2px solid "), expect: ACCENT },
  { file: `${SEC}/toc-sidebar.css`, selector: ".settings-input::placeholder", property: "color", expect: MUTED },
  { file: `${SEC}/settings-shell.css`, selector: ".settings-search::placeholder", property: "color", expect: MUTED },
];

describe("D278-FIX-1: the state and pseudo rows keep their colours", () => {
  checkRows(STATE_ROWS);

  it(".settings-input::placeholder keeps opacity 1", () => {
    expect(valueOf(`${SEC}/toc-sidebar.css`, ".settings-input::placeholder", "opacity")).toBe("1");
  });

  it("alpha is compared exactly: 0.5999999 is not 0.6", () => {
    expect(rgbaEquals([245, 158, 11, 0.5999999], [245, 158, 11, 0.6])).toBe(false);
    expect(rgbaEquals([245, 158, 11, 0.6], [245, 158, 11, 0.6])).toBe(true);
    expect(rgbaEquals([34.8 + 1e-12, 84.4, 193.2, 1], [34.8, 84.4, 193.2, 1])).toBe(true);
  });
});
