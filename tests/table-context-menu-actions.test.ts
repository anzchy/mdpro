/**
 * @module table-context-menu-actions.test
 * Purpose: Verify the action-descriptor catalog (WI-1.3) and the pure
 * `getTableActions` function that derives the per-cell action list
 * (with isActive / isDisabled flags) from a TableContext.
 *
 * The TableContext is computed once by the React component from the
 * live ProseMirror view; getTableActions is then a pure function on
 * that context, which keeps the unit tests free of editor mocks.
 */

import { describe, expect, it } from "vitest";
import {
  TABLE_ACTION_DESCRIPTORS,
  TABLE_ACTION_GROUPS,
} from "../src/plugins/milkdown/table/actionDescriptors";
import { getTableActions } from "../src/plugins/milkdown/table/contextMenu";
import type { TableContext } from "../src/plugins/milkdown/table/types";

const FULL_CTX: TableContext = {
  rowIndex: 1,
  colIndex: 1,
  rowCount: 3,
  colCount: 3,
  alignment: "left",
};

describe("TABLE_ACTION_DESCRIPTORS — catalog", () => {
  it("declares the 4 Insert actions", () => {
    const ids = TABLE_ACTION_DESCRIPTORS.map((d) => d.id);
    expect(ids).toContain("insert_row_before");
    expect(ids).toContain("insert_row_after");
    expect(ids).toContain("insert_column_before");
    expect(ids).toContain("insert_column_after");
  });

  it("declares the 4 Move actions", () => {
    const ids = TABLE_ACTION_DESCRIPTORS.map((d) => d.id);
    expect(ids).toContain("move_row_up");
    expect(ids).toContain("move_row_down");
    expect(ids).toContain("move_column_left");
    expect(ids).toContain("move_column_right");
  });

  it("declares the 3 Alignment actions", () => {
    const ids = TABLE_ACTION_DESCRIPTORS.map((d) => d.id);
    expect(ids).toContain("align_left");
    expect(ids).toContain("align_center");
    expect(ids).toContain("align_right");
  });

  it("declares the 3 Destructive actions", () => {
    const ids = TABLE_ACTION_DESCRIPTORS.map((d) => d.id);
    expect(ids).toContain("delete_row");
    expect(ids).toContain("delete_column");
    expect(ids).toContain("delete_table");
  });

  it("groups every descriptor into one of the 4 known sections", () => {
    for (const d of TABLE_ACTION_DESCRIPTORS) {
      expect(TABLE_ACTION_GROUPS).toContain(d.group);
    }
  });

  it("has at least one descriptor per group", () => {
    for (const group of TABLE_ACTION_GROUPS) {
      const inGroup = TABLE_ACTION_DESCRIPTORS.filter((d) => d.group === group);
      expect(inGroup.length).toBeGreaterThan(0);
    }
  });

  it("preserves a stable, user-friendly label for every action", () => {
    for (const d of TABLE_ACTION_DESCRIPTORS) {
      expect(d.label.length).toBeGreaterThan(0);
      // Labels are user-facing; they must not be raw action ids.
      expect(d.label).not.toMatch(/^[a-z_]+$/);
    }
  });
});

describe("getTableActions — gating + isActive + isDisabled", () => {
  it("returns one entry per descriptor when in a cell", () => {
    expect(getTableActions(FULL_CTX).length).toBe(TABLE_ACTION_DESCRIPTORS.length);
  });

  it("disables Move row up at the first row", () => {
    const actions = getTableActions({ ...FULL_CTX, rowIndex: 0 });
    expect(byId(actions, "move_row_up").isDisabled).toBe(true);
    expect(byId(actions, "move_row_down").isDisabled).toBe(false);
  });

  it("disables Move row down at the last row", () => {
    const actions = getTableActions({ ...FULL_CTX, rowIndex: 2 });
    expect(byId(actions, "move_row_down").isDisabled).toBe(true);
    expect(byId(actions, "move_row_up").isDisabled).toBe(false);
  });

  it("disables Move column left at the first column", () => {
    const actions = getTableActions({ ...FULL_CTX, colIndex: 0 });
    expect(byId(actions, "move_column_left").isDisabled).toBe(true);
    expect(byId(actions, "move_column_right").isDisabled).toBe(false);
  });

  it("disables Move column right at the last column", () => {
    const actions = getTableActions({ ...FULL_CTX, colIndex: 2 });
    expect(byId(actions, "move_column_right").isDisabled).toBe(true);
    expect(byId(actions, "move_column_left").isDisabled).toBe(false);
  });

  it("marks the matching alignment action as isActive", () => {
    const center = getTableActions({ ...FULL_CTX, alignment: "center" });
    expect(byId(center, "align_center").isActive).toBe(true);
    expect(byId(center, "align_left").isActive).toBe(false);
    expect(byId(center, "align_right").isActive).toBe(false);

    const right = getTableActions({ ...FULL_CTX, alignment: "right" });
    expect(byId(right, "align_right").isActive).toBe(true);
  });

  it("non-alignment actions are never marked isActive", () => {
    const actions = getTableActions(FULL_CTX);
    for (const a of actions) {
      if (!a.id.startsWith("align_")) {
        expect(a.isActive).toBe(false);
      }
    }
  });

  it("destructive actions are not marked isDisabled by default", () => {
    const actions = getTableActions(FULL_CTX);
    expect(byId(actions, "delete_row").isDisabled).toBe(false);
    expect(byId(actions, "delete_column").isDisabled).toBe(false);
    expect(byId(actions, "delete_table").isDisabled).toBe(false);
  });
});

function byId(
  actions: ReturnType<typeof getTableActions>,
  id: (typeof TABLE_ACTION_DESCRIPTORS)[number]["id"],
) {
  const found = actions.find((a) => a.id === id);
  if (!found) throw new Error(`action ${id} not found`);
  return found;
}
