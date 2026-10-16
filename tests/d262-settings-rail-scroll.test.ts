// @vitest-environment node
/**
 * @module d262-settings-rail-scroll.test
 * Purpose: D262-WI-1 (Windows #487). At 270% scaling the dialog's
 * `min(600px, 80vh)` height is shorter than the ten rail rows, and the rail was
 * clipped by `.settings-dialog { overflow: hidden }`. The rail now scrolls.
 *
 * Specification: `.claude/tdd-guardian/tests-20261016-142610.md`, R1-R4.
 * Law: at any dialog height the rail's overflow is contained by the rail
 * itself: the dialog is bounded, every flex level between it and the rail can
 * shrink (`min-height: 0`), and the rail is the scroll container.
 *
 * Strategy: source inspection with `parseDeclarations`, across all app CSS.
 * Mock boundary: none. jsdom has no layout, so the scroll itself is a device
 * check (D262-dev: on a short dialog the About row can be scrolled to and opened).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";

const SRC = join(__dirname, "..", "src");
const cssPaths = (readdirSync(SRC, { recursive: true }) as string[])
  .map((p) => p.split("\\").join("/"))
  .filter((p) => p.endsWith(".css"));
const decls = cssPaths.flatMap((p) => parseDeclarations(readFileSync(join(SRC, p), "utf8")));

const parts = (selector: string) => selector.split(",").map((s) => s.trim());

/** Every value `property` takes on exactly `selector`, across all app CSS. */
const valuesAcross = (selector: string, property: string) =>
  decls.filter((d) => parts(d.selector).includes(selector) && d.property === property).map((d) => d.value);

/** Every declaration on any selector naming the rail itself (not `.settings-sidebar-title`). */
const RAIL = /\.settings-sidebar(?![\w-])/;
const railDecls = decls.filter((d) => RAIL.test(d.selector));

describe("D262: the Settings rail scrolls when the dialog is short", () => {
  it("R1: the rail scrolls: overflow-y auto and min-height 0", () => {
    expect(valuesAcross(".settings-sidebar", "overflow-y")).toEqual(["auto"]);
    expect(valuesAcross(".settings-sidebar", "min-height")).toEqual(["0"]);
  });

  it("R2: the chain from the dialog to the rail lets the rail scroll at any height", () => {
    expect(valuesAcross(".settings-dialog", "height")).toEqual(["min(600px, 80vh)"]);
    expect(valuesAcross(".settings-dialog", "overflow")).toEqual(["hidden"]);
    expect(valuesAcross(".settings-dialog", "display")).toEqual(["flex"]);
    expect(valuesAcross(".settings-dialog", "flex-direction")).toEqual(["column"]);
    expect(valuesAcross(".settings-content", "flex")).toEqual(["1"]);
    expect(valuesAcross(".settings-content", "min-height")).toEqual(["0"]);
    expect(valuesAcross(".settings-content", "display")).toEqual(["flex"]);
  });

  it("R3: nothing sizes or clips the rail itself", () => {
    expect(railDecls.length).toBeGreaterThan(0);
    expect(railDecls.filter((d) => d.property === "height" || d.property === "max-height")).toEqual([]);
    expect(
      railDecls.filter((d) => d.property.startsWith("overflow")).map((d) => [d.property, d.value]),
    ).toEqual([["overflow-y", "auto"]]);
  });

  it("R4: rail rows overflow the rail instead of shrinking to fit", () => {
    const shrinkers = decls.filter(
      (d) =>
        parts(d.selector).includes(".settings-category-btn") &&
        ["flex", "flex-shrink", "max-height"].includes(d.property),
    );
    expect(shrinkers).toEqual([]);
    expect(valuesAcross(".settings-category-btn", "min-height")).toEqual(["32px"]);
  });
});

/*
 * D262-WI-2 (b177 Medium, PR #489): R2 read only the chain's own declarations,
 * so `.settings-content { align-items: flex-start }` survived. With it the rail
 * takes its content height instead of the row's bounded height, and
 * `overflow-y: auto` never engages. The cross axis must stay stretched, on every
 * selector that names the content row or the rail (scoped, compound, @media).
 */
const CONTENT = /\.settings-content(?![\w-])/;
const STRETCH_ITEMS = new Set(["stretch", "normal", "unset"]);
const STRETCH_SELF = new Set(["unset", "auto", "stretch"]);

/** Declarations that pull the content row or the rail off the stretched cross axis. */
function crossAxisViolations(all: ReturnType<typeof parseDeclarations>) {
  return all.filter(
    (d) =>
      (CONTENT.test(d.selector) &&
        (d.property === "align-items" || d.property === "place-items") &&
        !STRETCH_ITEMS.has(d.value)) ||
      (RAIL.test(d.selector) &&
        (d.property === "align-self" || d.property === "place-self") &&
        !STRETCH_SELF.has(d.value)),
  );
}

describe("D262-WI-2: the rail's cross axis stays stretched", () => {
  it("R2b: the real CSS keeps the content row's cross axis stretched", () => {
    expect(crossAxisViolations(decls)).toEqual([]);
  });

  it.each([
    [".settings-content { align-items: flex-start }", 1],
    [".settings-content { align-items: center }", 1],
    [".settings-content { align-items: flex-end }", 1],
    [".settings-content { align-items: baseline }", 1],
    [".settings-content { align-items: start }", 1],
    [".settings-content { align-items: end }", 1],
    [".settings-content { place-items: center }", 1],
    [".theme-dark .settings-content { align-items: flex-start }", 1],
    ["@media (max-width: 600px) { .settings-content { align-items: center } }", 1],
    [".settings-sidebar { align-self: center }", 1],
    [".settings-content { display: flex }", 0],
    [".settings-content { align-items: stretch }", 0],
    [".settings-content { align-items: normal }", 0],
    [".settings-content { align-items: unset }", 0],
    [".settings-content-x { align-items: center }", 0],
    [".settings-sidebar { align-self: stretch }", 0],
  ])("R2c: %s → %i violation(s)", (css, count) => {
    expect(crossAxisViolations(parseDeclarations(css))).toHaveLength(count);
  });
});
