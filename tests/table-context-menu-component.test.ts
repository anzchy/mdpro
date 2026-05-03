/**
 * @module table-context-menu-component.test
 * Purpose: Source-inspection contract for the TableContextMenu React
 * shell (WI-1.3). Verifies it follows the component pattern from
 * `.claude/rules/32-component-patterns.md` and the eng-review's R7
 * coexistence rule (image-menu wins for image targets).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const indexSrc = fs.readFileSync(
  path.join(ROOT, "src/components/Editor/TableContextMenu/index.tsx"),
  "utf-8",
);
const actionListSrc = fs.readFileSync(
  path.join(ROOT, "src/components/Editor/TableContextMenu/ActionList.tsx"),
  "utf-8",
);

describe("TableContextMenu — listener wiring", () => {
  it("registers a contextmenu listener on #milkdown-container", () => {
    expect(indexSrc).toMatch(/milkdown-container/);
    expect(indexSrc).toMatch(/contextmenu/);
  });

  it("bails when the right-click target is an image (image menu owns those)", () => {
    // Critical regression — eng review R7 + WI-1.3 acceptance criteria:
    // Right-click on an image inside a table cell must open the image menu,
    // not the table menu. Order-independent — bail when target isn't yours.
    expect(indexSrc).toMatch(/closest\(["']\.ProseMirror img["']\)/);
  });

  it("bails when the right-click target is not inside a table", () => {
    expect(indexSrc).toMatch(/closest\(["']\.ProseMirror table["']\)/);
  });

  it("uses fixed positioning anchored to event.clientX/Y", () => {
    expect(indexSrc).toMatch(/clientX/);
    expect(indexSrc).toMatch(/clientY/);
  });

  it("dismisses on Escape and on outside click", () => {
    expect(indexSrc).toMatch(/Escape/);
    expect(indexSrc).toMatch(/pointerdown/);
  });

  it("logs ui.table-context-menu.* events via loggingService", () => {
    expect(indexSrc).toMatch(/loggingService/);
    expect(indexSrc).toMatch(/ui\.table-context-menu/);
  });

  it("has role=menu + aria-label for screen readers", () => {
    expect(indexSrc).toMatch(/role="menu"/);
    expect(indexSrc).toMatch(/aria-label/);
  });
});

describe("TableContextMenu — destructive group + sectioning", () => {
  it("ActionList groups items by section with role=group + aria-label", () => {
    expect(actionListSrc).toMatch(/role="group"/);
    expect(actionListSrc).toMatch(/aria-label/);
  });

  it("ActionList items use role=menuitem", () => {
    expect(actionListSrc).toMatch(/role="menuitem"/);
  });

  it("disabled items set aria-disabled=true", () => {
    expect(actionListSrc).toMatch(/aria-disabled/);
  });

  it("the destructive group is visually distinguished via a CSS class", () => {
    // Class name allows CSS to color the group in --color-danger and add
    // an extra top margin per the design spec.
    expect(actionListSrc).toMatch(/destructive/);
  });
});
