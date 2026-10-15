// @vitest-environment node
/**
 * D189 / ADR-0088: the sidebar's CSS. The sidebar keeps its width at every
 * window width (issue #416, both faces: squeezed by wide content, ballooning
 * with none), the rendered width clamps so the main column keeps 320px, the
 * resize handle and the toggle button meet DESIGN.md's icon-button and
 * rule 33's focus contracts.
 *
 * Strategy: source inspection, one row per declaration. jsdom has no layout,
 * so rendered widths are a device check (sequencing doc, D189 row).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations, tokenBlock } from "./support/cssTokenScan";

const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const APP_SHELL = "styles/sections/app-shell.css";
const RESPONSIVE = "styles/sections/responsive.css";
const BOTTOM_TABS = "components/BottomTabs/BottomTabs.css";

/** Every value `property` takes on exactly `selector` in `file`. */
const valuesOf = (file: string, selector: string, property: string) =>
  parseDeclarations(read(file))
    .filter((d) => d.selector === selector && d.property === property)
    .map((d) => d.value);

describe("D189 the sidebar keeps its width at every window width (#416)", () => {
  it("no media query overrides the app shell's grid", () => {
    const shellRules = parseDeclarations(read(RESPONSIVE)).filter((d) => /\.app-shell\b/.test(d.selector));
    expect(shellRules).toEqual([]);
  });

  it("the narrow-window block still lays Source mode's split view out in a column", () => {
    const decls = parseDeclarations(read(RESPONSIVE));
    const narrow = (sel: string) => decls.filter((d) => d.selector.endsWith(`> ${sel}`) && d.selector.startsWith("@media"));
    expect(narrow(".split-view").map((d) => `${d.property}: ${d.value}`)).toEqual(["flex-direction: column"]);
    expect(narrow(".split-pane").map((d) => `${d.property}: ${d.value}`)).toEqual(["width: 100% !important"]);
  });

  it("the sidebar column is the stored width, clamped so main keeps its minimum; main may shrink below its content", () => {
    expect(valuesOf(APP_SHELL, ".app-shell", "grid-template-columns")).toEqual([
      "clamp(var(--sidebar-width-min), var(--sidebar-width), 100vw - var(--main-min-width)) minmax(0, 1fr)",
    ]);
  });

  it("the layout tokens are the decided values", () => {
    const root = tokenBlock(read("styles/globals.css"), ":root");
    expect(root.get("--sidebar-width")).toBe("220px");
    expect(root.get("--sidebar-width-min")).toBe("180px");
    expect(root.get("--main-min-width")).toBe("320px");
  });
});

describe("D189 resize handle (ADR-0088 decision 3)", () => {
  const H = ".sidebar-resize-handle";

  it("the sidebar is its positioning box", () => {
    expect(valuesOf(APP_SHELL, ".sidebar", "position")).toEqual(["relative"]);
  });

  it.each([
    ["position", "absolute"],
    ["top", "0"],
    ["bottom", "0"],
    ["right", "0"],
    ["width", "8px"],
    ["cursor", "col-resize"],
    ["touch-action", "none"],
  ])("%s: %s", (property, value) => {
    expect(valuesOf(APP_SHELL, H, property)).toEqual([value]);
  });

  it("shows a 2px bar on the edge on hover and while dragging, none at rest", () => {
    expect(valuesOf(APP_SHELL, `${H}::after`, "width")).toEqual(["2px"]);
    expect(valuesOf(APP_SHELL, `${H}::after`, "background")).toEqual(["transparent"]);
    expect(valuesOf(APP_SHELL, `${H}:hover::after, ${H}:active::after`, "background")).toEqual([
      "var(--color-border)",
    ]);
  });

  it("has a rule 33 pattern 2 outline, inset because the sidebar clips overflow", () => {
    expect(valuesOf(APP_SHELL, `${H}:focus-visible`, "outline")).toEqual(["2px solid var(--color-accent)"]);
    expect(valuesOf(APP_SHELL, `${H}:focus-visible`, "outline-offset")).toEqual(["-2px"]);
  });
});

describe("D189 sidebar toggle (ADR-0088 decision 1, DESIGN.md icon button)", () => {
  const B = ".bottom-tabs__sidebar-toggle";

  it.each([
    ["width", "24px"],
    ["height", "24px"],
    ["background", "transparent"],
    ["color", "var(--color-muted)"],
    ["border-radius", "var(--radius-control)"],
    ["flex-shrink", "0"],
  ])("%s: %s", (property, value) => {
    expect(valuesOf(BOTTOM_TABS, B, property)).toEqual([value]);
  });

  it("hover gives the hover fill and the text colour", () => {
    expect(valuesOf(BOTTOM_TABS, `${B}:hover`, "background")).toEqual(["var(--color-hover)"]);
    expect(valuesOf(BOTTOM_TABS, `${B}:hover`, "color")).toEqual(["var(--color-text)"]);
  });

  it("has a rule 33 pattern 2 outline", () => {
    expect(valuesOf(BOTTOM_TABS, `${B}:focus-visible`, "outline")).toEqual(["2px solid var(--color-accent)"]);
    expect(valuesOf(BOTTOM_TABS, `${B}:focus-visible`, "outline-offset")).toEqual(["2px"]);
  });
});
