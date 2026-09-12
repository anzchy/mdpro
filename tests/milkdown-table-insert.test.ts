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

// Track which mock the next isInTable call should return.
const isInTableHook = { value: false };

vi.mock("@milkdown/kit/prose/tables", () => ({
  isInTable: () => isInTableHook.value,
}));

function makeMockEditor(commandResult: boolean): MockEditor {
  const fakeCommands = {
    call: vi.fn(() => commandResult),
  };
  const fakeView = { state: {} };
  const fakeCtx = {
    get: vi.fn((key: unknown) => {
      // commandsCtx vs editorViewCtx — distinguish via toString
      const k = String(key);
      if (k.includes("view") || k.includes("View")) return fakeView;
      return fakeCommands;
    }),
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
  it("returns true when insertTableCommand applies (cursor not in table)", () => {
    isInTableHook.value = false;
    const editor = makeMockEditor(true);
    expect(runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 3, 4)).toBe(true);
  });

  it("returns false when the cursor is inside an existing table (audit fix H2)", () => {
    // Milkdown's insertTableCommand returns true unconditionally — pre-checking
    // isInTable is the only way to enforce the documented "false on invalid
    // position" contract, which TableInsertModal relies on for its error UX.
    isInTableHook.value = true;
    const editor = makeMockEditor(true);
    expect(runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 3, 4)).toBe(false);
  });

  it("returns false when insertTableCommand declines (legacy contract)", () => {
    isInTableHook.value = false;
    const editor = makeMockEditor(false);
    expect(runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 3, 4)).toBe(false);
  });

  it("dispatches insertTableCommand with { row, col } payload", () => {
    isInTableHook.value = false;
    const fakeCommands = {
      call: vi.fn((_command: unknown, _payload?: unknown) => true),
    };
    const fakeView = { state: {} };
    const editor: MockEditor = {
      action: (fn) =>
        fn({
          get: (key: unknown) => {
            const k = String(key);
            if (k.includes("view") || k.includes("View")) return fakeView;
            return fakeCommands;
          },
        }),
    };

    runInsertTable(editor as unknown as Parameters<typeof runInsertTable>[0], 3, 4);

    expect(fakeCommands.call).toHaveBeenCalledTimes(1);
    const [, payload] = fakeCommands.call.mock.calls[0];
    expect(payload).toEqual({ row: 3, col: 4 });
  });
});
