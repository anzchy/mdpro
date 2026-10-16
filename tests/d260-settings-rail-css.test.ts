// @vitest-environment node
/**
 * @module d260-settings-rail-css.test
 * Purpose: D260-WI-1, the rail's stylesheet. DESIGN.md § Settings rail: a
 * flat `--color-surface` rail with a `--color-border-subtle` edge; 32px rows
 * on `--radius-control` with a 10px icon gap; hover `--color-hover`; the
 * current row a neutral grey (`--color-text` 9%) with no weight change; focus
 * the inset ring with no fill. The footer and the emoji rail are gone.
 *
 * Specification: `.claude/tdd-guardian/tests-20261016-142610.md`, C1-C11 and C2b.
 * Law: no stylesheet anywhere in `src/` overrides the rail (every value is
 * read across all of `src/**\/*.css`, and C11 pins the set of selectors).
 *
 * Strategy: source inspection with `parseDeclarations`. Mock boundary: none.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, parseDeclarations } from "./support/cssTokenScan";

const SRC = join(__dirname, "..", "src");
const files = (readdirSync(SRC, { recursive: true }) as string[]).map((p) => p.split("\\").join("/"));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const cssPaths = files.filter((p) => p.endsWith(".css"));
const decls = cssPaths.flatMap((p) => parseDeclarations(read(p)));

const parts = (selector: string) => selector.split(",").map((s) => s.trim());

/** Every value `property` takes on exactly `selector`, across all app CSS. */
const valuesAcross = (selector: string, property: string) =>
  decls.filter((d) => parts(d.selector).includes(selector) && d.property === property).map((d) => d.value);

/** Every declaration on exactly `selector`, across all app CSS. */
const declsOf = (selector: string) =>
  Object.fromEntries(decls.filter((d) => parts(d.selector).includes(selector)).map((d) => [d.property, d.value]));

const BTN = ".settings-category-btn";
const railDecls = decls.filter((d) => d.selector.includes("settings-category-btn"));

describe("D260: the rail surface", () => {
  it("C1: the sidebar is flat --color-surface with a --color-border-subtle edge", () => {
    expect(valuesAcross(".settings-sidebar", "background")).toEqual(["var(--color-surface)"]);
    expect(valuesAcross(".settings-sidebar", "border-right")).toEqual(["1px solid var(--color-border-subtle)"]);
  });

  it("C2b: the sidebar and row paddings and the row gap match prototype D", () => {
    expect(valuesAcross(".settings-sidebar", "padding")).toEqual(["12px 8px"]);
    expect(valuesAcross(".settings-sidebar", "gap")).toEqual(["2px"]);
    expect(valuesAcross(BTN, "padding")).toEqual(["0 10px"]);
  });
});

describe("D260: the rail rows", () => {
  it.each([
    ["display", "flex"],
    ["align-items", "center"],
    ["gap", "10px"],
    ["min-height", "32px"],
    ["border-radius", "var(--radius-control)"],
    ["color", "var(--color-text)"],
  ])("C2: .settings-category-btn %s is %s", (property, value) => {
    expect(valuesAcross(BTN, property)).toEqual([value]);
  });

  it("C3: hover is --color-hover and nothing else", () => {
    expect(declsOf(`${BTN}:hover`)).toEqual({ background: "var(--color-hover)" });
  });

  it("C4: the current row is the neutral 9% grey in --color-text, no weight change", () => {
    expect(declsOf(`${BTN}.is-active`)).toEqual({
      background: "color-mix(in srgb, var(--color-text) 9%, transparent)",
      color: "var(--color-text)",
    });
  });

  it("C5: focus is the inset ring and no fill", () => {
    expect(declsOf(`${BTN}:focus-visible`)).toEqual({
      outline: "2px solid var(--color-focus-ring)",
      "outline-offset": "-2px",
    });
  });

  it("C6: :hover is declared before .is-active, so the current row keeps its fill under the pointer", () => {
    const css = blankComments(read("styles/sections/settings-shell.css"));
    const hover = css.indexOf(`${BTN}:hover`);
    expect(hover).toBeGreaterThan(-1);
    expect(hover).toBeLessThan(css.indexOf(`${BTN}.is-active`));
  });

  it("C7: no rail selector sets a font-weight, nor a colour on the glyph", () => {
    expect(railDecls.filter((d) => d.property === "font-weight")).toEqual([]);
    const glyph = railDecls.filter(
      (d) => /svg|icon/.test(d.selector) && ["color", "stroke", "fill"].includes(d.property),
    );
    expect(glyph).toEqual([]);
  });

  it("C11: the only rail selectors are the row and its three states", () => {
    const selectors = new Set(
      decls.flatMap((d) => parts(d.selector)).filter((s) => s.includes("settings-category-btn")),
    );
    expect([...selectors].sort()).toEqual(
      [BTN, `${BTN}:hover`, `${BTN}.is-active`, `${BTN}:focus-visible`].sort(),
    );
  });
});

describe("D260: what went away", () => {
  const sources = files.filter((p) => /\.(css|tsx|ts)$/.test(p));

  it("C8: no settings-footer or settings-nav-icon in src CSS or TSX", () => {
    const hits = files
      .filter((p) => /\.(css|tsx)$/.test(p))
      .filter((p) => /settings-footer|settings-nav-icon/.test(read(p)));
    expect(hits).toEqual([]);
  });

  it("C9: none of the old rail emoji appears in src", () => {
    const EMOJI = ["⚙️", "✏️", "📝", "🖼️", "🔗", "📤", "🎨", "⌨️", "🔧", "ℹ️"];
    const hits = sources.flatMap((p) => EMOJI.filter((e) => read(p).includes(e)).map((e) => `${p} ${e}`));
    expect(hits).toEqual([]);
  });

  it("C10: both TSX files stay under 300 lines, and the icon file has a Purpose header", () => {
    const dialog = read("components/common/SettingsDialog.tsx");
    const icon = read("components/common/settings/SettingsRailIcon.tsx");
    // Newline count, as `wc -l` reports it.
    const lines = (text: string) => (text.match(/\n/g) ?? []).length;
    expect(lines(dialog)).toBeLessThan(300);
    expect(lines(icon)).toBeLessThan(300);
    expect(icon).toMatch(/^ \* Purpose: /m);
  });
});
