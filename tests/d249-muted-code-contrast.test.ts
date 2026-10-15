// @vitest-environment node
/**
 * @module d249-muted-code-contrast.test
 * Purpose: D249. WYSIWYG code takes its context's colour. In a blockquote or
 * an h6 that was `--color-muted`, 4.29:1 on the code fill in light (rule 31
 * needs 4.5). Code there now uses the muted colour mixed 90% with the text,
 * so it stays in the quote's muted register. Linked code keeps the accent,
 * in a quote or an h6 too: the muted rules exclude code inside a link, since a
 * rule on `code` itself would beat the colour it inherits from the `a`.
 *
 * Strategy: source inspection of MilkdownEditor.css, and contrast measured
 * from the theme tokens (tests/support/contrast), as the Stage 3 tests do.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";
import { contrast, resolveColor, themeTokens, type Theme } from "./support/contrast";

const CSS = readFileSync(join(__dirname, "..", "src", "components", "Editor", "MilkdownEditor.css"), "utf8");
const decls = parseDeclarations(CSS);

/** The value `property` takes on exactly `selector` (one of a selector list). */
const valueOf = (selector: string, property: string) =>
  decls.find((d) => d.property === property && d.selector.split(",").some((s) => s.trim() === selector))?.value;

const PM = ".milkdown-editor .ProseMirror";
const MUTED_CODE = "color-mix(in srgb, var(--color-muted) 90%, var(--color-text))";
/** Code that is not inside a link: linked code inherits the link's accent. */
const UNLINKED = ":not(a code)";

describe("D249: code in a muted context stays readable on the code fill", () => {
  it.each([`${PM} blockquote code${UNLINKED}`, `${PM} h6 code${UNLINKED}`])("%s takes the darker muted mix", (selector) => {
    expect(valueOf(selector, "color")).toBe(MUTED_CODE);
  });

  it("linked code is left to the link's accent", () => {
    expect(valueOf(`${PM} a`, "color")).toBe("var(--color-accent)");
    // No colour rule lands on code inside a link (an exclusion in `:not()` is not one).
    const onLinkedCode = (selector: string) => /\ba\s+code\b/.test(selector.replace(/:not\([^)]*\)/g, ""));
    expect(decls.filter((d) => d.property === "color" && onLinkedCode(d.selector))).toEqual([]);
    expect(valueOf(`${PM} code`, "color")).toBeUndefined();
  });

  it.each<Theme>(["light", "dark"])("%s: quote, h6 and linked code are each at least 4.5:1 on the fill", (theme) => {
    const t = themeTokens(theme);
    const fill = resolveColor("var(--color-code-bg)", t);
    // Code with no colour rule of its own inherits its context's colour.
    const codeIn = (context: string) =>
      valueOf(`${PM} ${context} code${UNLINKED}`, "color") ?? valueOf(`${PM} ${context}`, "color") ?? "var(--color-text)";
    const ratios = Object.fromEntries(
      ["blockquote", "h6", "a"].map((context) => [context, contrast(resolveColor(codeIn(context), t), fill)]),
    );
    expect(Object.entries(ratios).filter(([, r]) => r < 4.5)).toEqual([]);
  });
});
