// @vitest-environment node
/**
 * @module motion-dr12.test
 * Purpose: plan P WI-3.2 item 11 (DR12, DR13). Colours change instantly; only
 * shape and visibility animate. So a `transition` in app CSS may name only
 * `transform` or `opacity` (or be `none`), every duration comes from the
 * motion tokens, and one `prefers-reduced-motion: reduce` block zeroes
 * them. Progress spinners keep rotating: their keyframe `animation` is a
 * WI-2.1 exception (R4), not a transition. Rule 32 § Animations says so.
 *
 * Strategy: source inspection over the same file set as the tokenization
 * guard, plus `globals.css` and rule 32.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, parseDeclarations } from "./support/cssTokenScan";
import { collectionCases } from "./support/collectionCases";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
/** A5 exclusions, as in the tokenization guard; TabBar's `tab-bar.css` is dead (A8) and goes with its TODOS entry. */
const EXCLUDED = new Set(["App.css", "styles/themes/light.css", "styles/themes/dark.css", "styles/sections/tab-bar.css"]);
const inScope = (readdirSync(SRC, { recursive: true }) as string[])
  .map((p) => p.split("\\").join("/"))
  .filter((p) => p.endsWith(".css") && !EXCLUDED.has(p))
  .sort();
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const ANIMATABLE = new Set(["transform", "opacity"]);
const TIME = /^-?[\d.]+m?s$|^var\(/;

/** The properties a `transition` value names; `null` for a part that names none (it then animates `all`). */
function transitioned(value: string): Array<string | null> {
  if (value.trim() === "none") return [];
  return value.split(/,(?![^(]*\))/).map((part) => {
    const first = part.trim().split(/\s+/)[0];
    return TIME.test(first) ? null : first.toLowerCase();
  });
}

describe("transition parser fixtures", () => {
  it("reads properties, bare durations and none", () => {
    expect(transitioned("opacity var(--motion-duration-fast)")).toEqual(["opacity"]);
    expect(transitioned("background 0.15s ease, border-color 0.05s ease")).toEqual(["background", "border-color"]);
    expect(transitioned("0.2s")).toEqual([null]);
    expect(transitioned("all 0.15s")).toEqual(["all"]);
    expect(transitioned("none")).toEqual([]);
  });
});

describe("only transform and opacity animate (DR12)", () => {
  for (const file of collectionCases("tests/motion-dr12.test.ts:53", inScope)) {
    const offenders = parseDeclarations(read(file))
      .filter((d) => d.property === "transition" || d.property === "transition-property")
      .filter((d) =>
        (d.property === "transition" ? transitioned(d.value) : d.value.split(",").map((p) => p.trim())).some(
          (p) => p === null || !ANIMATABLE.has(p),
        ),
      )
      .map((d) => `${d.line} ${d.selector} { ${d.property}: ${d.value} }`);
    it(file, () => {
      expect(offenders).toEqual([]);
    });
  }

  it("the switch knob slides on the motion token", () => {
    const knob = parseDeclarations(read("styles/sections/settings-rows.css")).filter(
      (d) => d.selector === ".toggle-slider:before" && d.property === "transition",
    );
    expect(knob.map((d) => d.value)).toEqual(["transform var(--motion-duration-fast)"]);
  });
});

describe("reduced motion (DR13)", () => {
  it("one prefers-reduced-motion: reduce block zeroes the motion duration token", () => {
    // The block sets tokens only: no ordinary property (a `transition: none` here would also stop the spinners' siblings).
    const ordinary = parseDeclarations(read("styles/globals.css")).filter((d) =>
      d.selector.startsWith("@media (prefers-reduced-motion: reduce)"),
    );
    expect(ordinary).toEqual([]);
    const block = blankComments(read("styles/globals.css")).match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/,
    );
    expect(block?.[1].replace(/\s+/g, " ").trim()).toBe("--motion-duration-fast: 0ms;");
  });

  it("rule 32 § Animations describes the token, the reduce block and the spinners", () => {
    const rule32 = readFileSync(join(ROOT, ".claude/rules/32-component-patterns.md"), "utf8");
    const section = rule32.slice(rule32.indexOf("## Animations"), rule32.indexOf("## Scrollbars"));
    expect(section).not.toContain("prefers-reduced-motion: no-preference");
    expect(section).toContain("`@media (prefers-reduced-motion: reduce)`");
    expect(section).toMatch(/spinners? keep rotating/i);
  });
});
