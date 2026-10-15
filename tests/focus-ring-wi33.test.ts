// @vitest-environment node
/**
 * @module focus-ring-wi33.test
 * Purpose: plan P WI-3.3 (DR15, item 7). `--color-focus-ring` is declared once
 * in `:root` as the solid accent, so it follows each theme's accent; rule 33
 * pattern 2 outlines and pattern 3's TOC inset ring use it; toolbar buttons get
 * the `:focus-visible` outline they lacked.
 *
 * Strategy: source inspection, the pattern of
 * tests/design-tokens-accent-danger.test.ts. jsdom has no `:focus-visible`, so
 * the device check (STOP 3) covers what a selector cannot.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, parseDeclarations } from "./support/cssTokenScan";

const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const cssFiles = (readdirSync(SRC, { recursive: true }) as string[])
  .map((p) => p.split("\\").join("/"))
  .filter((p) => p.endsWith(".css"));
const RING = "2px solid var(--color-focus-ring)";

/** The declarations of `selector` in `file`, as a property → value map. */
const rule = (file: string, selector: string) =>
  new Map(
    parseDeclarations(read(file))
      .filter((d) => d.selector === selector)
      .map((d) => [d.property, d.value]),
  );

describe("--color-focus-ring (DR15)", () => {
  it(":root declares it as the solid accent", () => {
    const root = blankComments(read("styles/globals.css")).match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(root).toMatch(/--color-focus-ring:\s*var\(--color-accent\);/);
  });

  it("no other stylesheet redefines it, so it follows each theme's accent", () => {
    const definers = cssFiles.filter((f) => /--color-focus-ring\s*:/.test(blankComments(read(f))));
    expect(definers).toEqual(["styles/globals.css"]);
  });
});

describe("rule 33 pattern 2: outlines", () => {
  it(".toolbar-button:focus-visible draws a 2px focus-ring outline, offset 2px", () => {
    const decls = rule("styles/sections/buttons-dialog.css", ".toolbar-button:focus-visible");
    expect(decls.get("outline")).toBe(RING);
    expect(decls.get("outline-offset")).toBe("2px");
  });

  it("every :focus-visible outline in app CSS uses the token, not the accent", () => {
    const outlines = cssFiles.flatMap((f) =>
      parseDeclarations(read(f))
        .filter((d) => d.selector.includes(":focus-visible") && d.property === "outline" && d.value !== "none")
        .map((d) => `${f} ${d.selector} { outline: ${d.value} }`),
    );
    expect(outlines.length).toBeGreaterThanOrEqual(5);
    expect(outlines.filter((o) => !o.endsWith(`{ outline: ${RING} }`))).toEqual([]);
  });
});

describe("rule 33 pattern 3: the TOC row", () => {
  // The row itself is a <div>; keyboard focus lands on its link (TOCSidebar.tsx).
  const decls = rule("styles/sections/toc-sidebar.css", ".toc-entry__content:has(.toc-entry__link:focus-visible)");

  it("a focused link fills its row with accent-soft", () => {
    expect(decls.get("background")).toBe("var(--color-accent-soft)");
  });

  it("and adds the inset focus ring", () => {
    expect(decls.get("outline")).toBe(RING);
    expect(decls.get("outline-offset")).toBe("-2px");
  });

  it("the link draws no second ring of its own", () => {
    expect(rule("styles/sections/toc-sidebar.css", ".toc-entry__link:focus-visible").get("outline")).toBe("none");
  });
});

describe("stand-ins retired", () => {
  it("editor-source.css no longer lists --color-focus-ring as a token not in the CSS yet", () => {
    expect(read("styles/sections/editor-source.css")).not.toMatch(/--color-focus-ring\s*→/);
  });
});
