// @vitest-environment node
/**
 * @module contrast-d227.test
 * Purpose: D227, three control colours below A9, fixed under the user's
 * rulings on prototype/p-wi35-a9-controls:
 *   - input borders 「A: text 50% both (Recommended)」 → `--color-control-border`
 *   - toggle off-track 「light 55% / dark 45% (Recommended)」 → `--color-control-off`
 *   - danger button 「danger-text 80% mix (Recommended)」 → `--color-danger-text`
 *
 * Strategy: the ratios themselves are asserted by the Stage 3 contrast table
 * (`tests/contrast-stage3.test.ts`, whose D227 rows the fix removes). This
 * file pins the ruled values and checks that every control rule uses its
 * token, so a new input that keeps the hairline border fails here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations, tokenBlock } from "./support/cssTokenScan";
import { themeTokens } from "./support/contrast";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const valueOf = (file: string, selector: string, property: string) =>
  parseDeclarations(read(file)).find(
    (d) => d.property === property && d.selector.split(",").some((s) => s.trim() === selector),
  )?.value;

const RULED: Record<string, { light: string; dark: string }> = {
  "--color-control-border": {
    light: "color-mix(in srgb, var(--color-text) 50%, transparent)",
    dark: "color-mix(in srgb, var(--color-text) 50%, transparent)",
  },
  "--color-control-off": {
    light: "color-mix(in srgb, var(--color-text) 55%, var(--color-panel))",
    dark: "color-mix(in srgb, var(--color-text) 45%, var(--color-panel))",
  },
  "--color-danger-text": {
    light: "color-mix(in srgb, var(--color-danger) 80%, var(--color-text))",
    dark: "var(--color-danger)",
  },
};

// Every form control whose edge was the hairline `--color-border`.
const CONTROLS: [file: string, selector: string][] = [
  ["src/styles/sections/settings-pages.css", ".settings-select"],
  ["src/styles/sections/settings-shell.css", ".settings-search"],
  ["src/styles/sections/toc-sidebar.css", ".settings-input"],
  ["src/styles/sections/link-insert-modal.css", ".link-insert-input"],
  ["src/styles/sections/table-insert-modal.css", ".table-insert-input"],
  ["src/styles/sections/settings-rows.css", ".settings-stepper"],
  ["src/components/Editor/ImageContextMenu.css", ".image-context-menu-input"],
  ["src/styles/sections/editor-source.css", ".editor-shell .cm-editor .cm-panels .cm-textfield"],
];

describe("D227 tokens carry the ruled values", () => {
  for (const [name, values] of Object.entries(RULED)) {
    it(`${name} in both theme files`, () => {
      expect(themeTokens("light").get(name)).toBe(values.light);
      expect(themeTokens("dark").get(name)).toBe(values.dark);
    });

    it(`${name} has the light copy in :root (Q2)`, () => {
      expect(tokenBlock(read("src/styles/globals.css"), ":root").get(name)).toBe(values.light);
    });
  }
});

describe("form controls draw their edge with --color-control-border", () => {
  for (const [file, selector] of CONTROLS) {
    it(`${selector}`, () => {
      expect(valueOf(file, selector, "border")).toBe("1px solid var(--color-control-border)");
    });
  }
});

describe("no form control in the app CSS keeps the hairline edge", () => {
  // A selector that names a form control. Matching on the name keeps a new
  // input from slipping past the list above.
  const CONTROL = /input|select|search|textfield|textarea|stepper/i;
  const cssFiles = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? cssFiles(`${dir}/${e.name}`) : e.name.endsWith(".css") ? [`${dir}/${e.name}`] : [],
    );

  it("finds no border on a control selector that uses --color-border", () => {
    const offenders = cssFiles("src").flatMap((file) =>
      parseDeclarations(read(file))
        .filter((d) => d.property.startsWith("border") && /var\(--color-border\)/.test(d.value))
        .filter((d) => CONTROL.test(d.selector))
        .map((d) => `${file}:${d.line} ${d.selector}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the sweep sees every listed control", () => {
    const seen = CONTROLS.filter(([, selector]) => CONTROL.test(selector));
    expect(seen).toHaveLength(CONTROLS.length);
  });
});

describe("the toggle and the danger button use their tokens", () => {
  it("the off-track is --color-control-off, no longer the #ccc literal", () => {
    expect(valueOf("src/styles/sections/settings-rows.css", ".toggle-slider", "background-color")).toBe(
      "var(--color-control-off)",
    );
  });

  it("the danger label is --color-danger-text; its edge stays --color-danger", () => {
    const file = "src/styles/sections/settings-pages.css";
    expect(valueOf(file, ".toolbar-button.danger", "color")).toBe("var(--color-danger-text)");
    expect(valueOf(file, ".toolbar-button.danger", "border-color")).toBe("var(--color-danger)");
  });
});

describe("the D227 tokens are documented", () => {
  const rule31 = read(".claude/rules/31-design-tokens.md");
  const design = read("docs/design/mdpro-ui-new/DESIGN.md");
  const tokens = design.slice(design.indexOf("## Tokens"), design.indexOf("## Layout"));

  for (const name of Object.keys(RULED)) {
    it(`${name} has a rule 31 entry and a DESIGN.md § Tokens row`, () => {
      expect(rule31).toContain(`\`${name}\``);
      expect(tokens).toMatch(new RegExp(`^\\| \`${name}\` \\|`, "m"));
    });
  }
});
