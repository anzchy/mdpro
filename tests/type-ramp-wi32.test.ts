// @vitest-environment node
/**
 * @module type-ramp-wi32.test
 * Purpose: the type and density rows of plan P WI-3.2. Item 12 (DR22) puts
 * every chrome font size on the four-step ramp (`--font-size-ui-sm`, `-ui`,
 * `-ui-lg`, and the new `--font-size-title`, DESIGN.md § Tokens :131),
 * ruling R7 sizes Milkdown tables relative to the editor font, and TOC
 * rows get the 28px row height (settings-nav rows: 32px since D260). Glyph sizes are not text: they
 * wait for stage 4 WI-4.2 (tests/css-tokenization.test.ts).
 *
 * Strategy: source inspection, one row per declaration.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations, tokenBlock } from "./support/cssTokenScan";

const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const S = "styles/sections/";

/** Every value `property` takes on exactly `selector` in `file`. */
const valuesOf = (file: string, selector: string, property: string) =>
  parseDeclarations(read(file))
    .filter((d) => d.selector === selector && d.property === property)
    .map((d) => d.value);

const ROLES: Array<[file: string, selector: string, token: string]> = [
  [S + "settings-rows.css", ".settings-section-label", "--font-size-ui-sm"],
  [S + "table-context-menu.css", ".table-context-menu-group-label", "--font-size-ui-sm"],
  [S + "table-context-menu.css", ".table-context-menu-item-hint", "--font-size-ui-sm"],
  ["plugins/codemirror/wysiwygDecorationsPlugin.css", ".wysiwyg-marker", "--font-size-ui-sm"],
  [S + "buttons-dialog.css", ".dialog-title", "--font-size-ui-lg"],
  [S + "settings-shell.css", ".settings-title", "--font-size-ui-lg"],
  [S + "settings-rows.css", ".settings-integrations h4", "--font-size-ui-lg"],
  [S + "settings-pages.css", ".settings-page-title", "--font-size-title"],
  [S + "settings-about.css", ".about-app-name", "--font-size-title"],
  [S + "settings-rows.css", ".settings-integrations h3", "--font-size-title"],
  [S + "settings-shell.css", ".shortcuts-header h3", "--font-size-title"],
];

describe("chrome type ramp (item 12, DR22)", () => {
  it("--font-size-title is 16px in :root, beside the other ramp steps", () => {
    const root = tokenBlock(read("styles/globals.css"), ":root");
    expect(root.get("--font-size-title")).toBe("16px");
  });

  for (const [file, selector, token] of ROLES) {
    it(`${selector} uses ${token}`, () => {
      expect(valuesOf(file, selector, "font-size")).toEqual([`var(${token})`]);
    });
  }
});

describe("R7: Milkdown tables follow the editor font", () => {
  it("the table is 0.875em of the editor font, not a fixed 14px", () => {
    expect(valuesOf("components/Editor/MilkdownEditor.css", ".milkdown-editor .ProseMirror table", "font-size")).toEqual([
      "0.875em",
    ]);
  });
});

describe("row height (DESIGN.md § Heights)", () => {
  it.each([[S + "toc-sidebar.css", ".toc-entry__content"]])("%s %s is at least 28px tall", (file, selector) => {
    expect(valuesOf(file, selector, "min-height")).toEqual(["28px"]);
  });

  // D260 (T1): the Settings rail's rows are 32px, DESIGN.md § Settings rail
  // (VMark's rail, prototype D), superseding WI-3.2's 28px for this one row.
  it("settings-shell.css .settings-category-btn is at least 32px tall (D260)", () => {
    expect(valuesOf(S + "settings-shell.css", ".settings-category-btn", "min-height")).toEqual(["32px"]);
  });
});
