/**
 * @module milkdown-table-insert.test
 * Purpose: Verify runInsertTable validates dimensions, dispatches
 * insertTableCommand against the active Milkdown editor, and surfaces
 * failures (cursor inside an existing table → ProseMirror command
 * returns false). Spec from docs/plans/20260502-plan-table-crud.md WI-1.1.
 *
 * Strategy: mock the editor.action / commandsCtx interaction (mirrors
 * tests/milkdown-image-resize.test.ts pattern).
 */

import { describe, expect, it, vi } from "vitest";
import { runInsertTable } from "../src/plugins/milkdown/table/insertTable";

interface MockEditor {
  action: (fn: (ctx: unknown) => void) => void;
}

function makeMockEditor(commandResult: boolean): MockEditor {
  const fakeCommands = {
    call: vi.fn(() => commandResult),
  };
  const fakeCtx = {
    get: vi.fn(() => fakeCommands),
  };
  return {
    action: (fn) => fn(fakeCtx),
  };
}

describe("runInsertTable — input validation", () => {
  it.each([
    { rows: 0, cols: 4, label: "rows=0" },
    { rows: -1, cols: 4, label: "rows=-1" },
    { rows: 51, cols: 4, label: "rows>50" },
    { rows: 4, cols: 0, label: "cols=0" },
    { rows: 4, cols: -1, label: "cols=-1" },
    { rows: 4, cols: 51, label: "cols>50" },
    { rows: 1.5, cols: 4, label: "rows non-integer" },
    { rows: 4, cols: NaN, label: "cols NaN" },
  ])("rejects out-of-range dimensions ($label)", ({ rows, cols }) => {
    const editor = makeMockEditor(true);
    expect(runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], rows, cols)).toBe(false);
  });

  it("accepts boundary values 1×1 and 50×50", () => {
    const editor = makeMockEditor(true);
    expect(runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 1, 1)).toBe(true);
    expect(runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 50, 50)).toBe(true);
  });
});

describe("runInsertTable — dispatch behavior", () => {
  it("returns true when insertTableCommand applies", () => {
    const editor = makeMockEditor(true);
    expect(runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 3, 4)).toBe(true);
  });

  it("returns false when the cursor is inside an invalid position (command returns false)", () => {
    // Critical regression case from WI-1.1 acceptance criteria — caller must
    // be able to surface the failure to the user, not silently no-op.
    const editor = makeMockEditor(false);
    expect(runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 3, 4)).toBe(false);
  });

  it("dispatches insertTableCommand with { row, col } payload", () => {
    const fakeCommands = { call: vi.fn(() => true) };
    const editor: MockEditor = {
      action: (fn) =>
        fn({
          get: () => fakeCommands,
        }),
    };

    runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 3, 4);

    expect(fakeCommands.call).toHaveBeenCalledTimes(1);
    const [, payload] = fakeCommands.call.mock.calls[0];
    expect(payload).toEqual({ row: 3, col: 4 });
  });
});
