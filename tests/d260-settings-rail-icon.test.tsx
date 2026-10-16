/**
 * @module d260-settings-rail-icon.test
 * Purpose: D260-WI-1, unit `SettingsRailIcon`. The Settings rail draws one
 * outline glyph per page on Lucide's geometry (DESIGN.md § Icons > Settings
 * rail exceptions): 24 viewBox, 19px, 1.75 stroke, round caps and joins,
 * `currentColor`, no fill, hidden from the accessibility tree.
 *
 * Specification: `.claude/tdd-guardian/tests-20261016-142610.md`, P1 and I1-I4.
 * Law: render(id)'s children equal the accepted prototype's `LUCIDE[id]`,
 * for every page id (I2, S5). The oracle is the prototype file itself
 * (tests/support/settingsRailPrototype.ts), so the geometry is not restated
 * here except in I3, which pins two glyphs literally in case the parser and
 * the component ever agree on something wrong.
 *
 * Mock boundary: none.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SettingsRailIcon, type SettingsPageId } from "../src/components/common/settings/SettingsRailIcon";
import { PROTOTYPE_LUCIDE, PROTOTYPE_NAV, attributes, geometry, parseLucide } from "./support/settingsRailPrototype";

const IDS = [
  "general",
  "editor",
  "markdown",
  "image",
  "integrations",
  "export",
  "appearance",
  "keyboard-shortcuts",
  "advanced",
  "about",
] as const satisfies readonly SettingsPageId[];

/** The root `<svg>` that `<SettingsRailIcon id={id} />` renders. */
function svgOf(id: SettingsPageId): SVGSVGElement {
  const { container } = render(<SettingsRailIcon id={id} />);
  const svg = container.querySelector("svg");
  expect(svg, `${id} renders an <svg>`).not.toBeNull();
  expect(container.children).toHaveLength(1);
  return svg as SVGSVGElement;
}

describe("P1: the prototype oracle", () => {
  it("the prototype's NAV and LUCIDE maps parse to the same 10 ids, in NAV order", () => {
    expect(PROTOTYPE_NAV.map(([id]) => id)).toEqual([...IDS]);
    expect(Object.keys(PROTOTYPE_LUCIDE).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(parseLucide(PROTOTYPE_LUCIDE[id]).length).toBeGreaterThan(0);
  });
});

describe("SettingsRailIcon (D260)", () => {
  it.each(IDS)("I1 %s: the root <svg> carries exactly the outline contract attributes", (id) => {
    expect(attributes(svgOf(id))).toEqual({
      viewBox: "0 0 24 24",
      width: "19",
      height: "19",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.75",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    });
  });

  it.each(IDS)("I2 %s: children equal the prototype's LUCIDE geometry (names, attributes, order)", (id) => {
    expect(geometry(svgOf(id))).toEqual(parseLucide(PROTOTYPE_LUCIDE[id]));
  });

  it("I3: about and advanced draw their literal shapes", () => {
    expect(geometry(svgOf("about"))).toEqual([
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "M12 16v-4" }],
      ["path", { d: "M12 8h.01" }],
    ]);
    expect(geometry(svgOf("advanced"))).toEqual([
      ["circle", { cx: "7", cy: "7", r: "2.5" }],
      ["circle", { cx: "17", cy: "7", r: "2.5" }],
      ["circle", { cx: "7", cy: "17", r: "2.5" }],
      ["circle", { cx: "17", cy: "17", r: "2.5" }],
    ]);
  });

  it("I4: an unknown page id is a type error (enforced by typecheck:tests)", () => {
    // @ts-expect-error "nope" is not a SettingsPageId
    const el = <SettingsRailIcon id="nope" />;
    expect(el.props).toEqual({ id: "nope" });
  });
});
