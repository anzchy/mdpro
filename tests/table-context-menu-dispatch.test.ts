// @vitest-environment node
/**
 * @module table-context-menu-dispatch.test
 * Purpose: Cover the High-severity correctness gaps from the
 * /codex-toolkit:audit run on commits c7bbec1..2b88a66:
 *   H1 — computeTableContext takes ResolvedPos; old code passed Selection
 *   H3 — dispatchTableAction must use the freshly-recomputed context
 *   H4 — destructive actions must short-circuit on select failure
 *   M1 — disabled actions must be rejected in dispatchTableAction
 */

import { describe, expect, it, vi } from "vitest";
import {
  computeTableContext,
  dispatchTableAction,
} from "../src/plugins/milkdown/table/contextMenu";
import type { TableContext } from "../src/plugins/milkdown/table/types";

// ---------------------------------------------------------------------------
// computeTableContext — accepts an explicit ResolvedPos (H1 + H5 enabler)
// ---------------------------------------------------------------------------

describe("computeTableContext — ResolvedPos input contract", () => {
  it("returns null when no table is found at the position", () => {
    // Build a fake view + ResolvedPos that findTable will reject.
    const $pos = makeResolvedPos({ depth: 0 });
    const view = makeView({ $from: $pos });
    expect(computeTableContext(view, $pos)).toBeNull();
  });

  it("falls back to selection.$from when no $pos is provided", () => {
    const $pos = makeResolvedPos({ depth: 0 });
    const view = makeView({ $from: $pos });
    // Same outcome (null), but proves the implicit-arg path doesn't throw.
    expect(computeTableContext(view)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dispatchTableAction — disabled gate + destructive chaining (H4 + M1)
// ---------------------------------------------------------------------------

const FRESH_CTX: TableContext = {
  rowIndex: 1,
  colIndex: 1,
  rowCount: 3,
  colCount: 3,
  alignment: "left",
};

describe("dispatchTableAction — disabled-action gate (M1)", () => {
  it("rejects move_row_up at the first row (isDisabled true)", () => {
    const editor = makeEditor({
      tableExists: true,
      commandResult: true,
      contextOverride: { ...FRESH_CTX, rowIndex: 0 },
    });
    expect(dispatchTableAction(editor, "move_row_up", FRESH_CTX)).toBe(false);
  });

  it("rejects move_column_right at the last column", () => {
    const editor = makeEditor({
      tableExists: true,
      commandResult: true,
      contextOverride: { ...FRESH_CTX, colIndex: 2, colCount: 3 },
    });
    expect(dispatchTableAction(editor, "move_column_right", FRESH_CTX)).toBe(false);
  });
});

describe("dispatchTableAction — destructive chaining (H4)", () => {
  it("returns false when selectRowCommand fails (does NOT call deleteSelectedCellsCommand)", () => {
    const calls: string[] = [];
    const editor = makeEditor({
      tableExists: true,
      commandImpl: (key: string) => {
        calls.push(key);
        if (key === "selectRowCommand") return false;
        return true;
      },
    });
    const result = dispatchTableAction(editor, "delete_row", FRESH_CTX);
    expect(result).toBe(false);
    expect(calls).toContain("selectRowCommand");
    // Critical: the delete must NOT have been attempted after select failed
    expect(calls).not.toContain("deleteSelectedCellsCommand");
  });

  it("returns true when selectRowCommand succeeds and delete succeeds", () => {
    const calls: string[] = [];
    const editor = makeEditor({
      tableExists: true,
      commandImpl: (key: string) => {
        calls.push(key);
        return true;
      },
    });
    expect(dispatchTableAction(editor, "delete_row", FRESH_CTX)).toBe(true);
    expect(calls).toContain("selectRowCommand");
    expect(calls).toContain("deleteSelectedCellsCommand");
  });

  it("delete_table chains selectTableCommand + deleteSelectedCellsCommand", () => {
    const calls: string[] = [];
    const editor = makeEditor({
      tableExists: true,
      commandImpl: (key: string) => {
        calls.push(key);
        return true;
      },
    });
    expect(dispatchTableAction(editor, "delete_table", FRESH_CTX)).toBe(true);
    expect(calls[0]).toBe("selectTableCommand");
    expect(calls[1]).toBe("deleteSelectedCellsCommand");
  });
});

// ---------------------------------------------------------------------------
// dispatchTableAction — uses fresh context (H3)
// ---------------------------------------------------------------------------

describe("dispatchTableAction — fresh context (H3)", () => {
  it("aborts when the table no longer exists at dispatch time", () => {
    const editor = makeEditor({
      tableExists: false,
      commandResult: true,
    });
    expect(dispatchTableAction(editor, "insert_row_after", FRESH_CTX)).toBe(false);
  });

  it("uses fresh row/col coordinates for move dispatch (not stale ctx)", () => {
    let payload: unknown = null;
    const editor = makeEditor({
      tableExists: true,
      contextOverride: { ...FRESH_CTX, rowIndex: 2, rowCount: 4 }, // moved!
      commandImpl: (key: string, p: unknown) => {
        if (key === "moveRowCommand") payload = p;
        return true;
      },
    });
    // Caller passes the original-open ctx (rowIndex=1) but document drifted
    // to rowIndex=2; the dispatch must use rowIndex=2 (the fresh value), so
    // moveRowCommand receives { from: 2, to: 3 } — not { from: 1, to: 2 }.
    dispatchTableAction(editor, "move_row_down", FRESH_CTX);
    expect(payload).toEqual({ from: 2, to: 3 });
  });
});

// ---------------------------------------------------------------------------
// Test helpers — small mocks of ProseMirror / Milkdown shapes
// ---------------------------------------------------------------------------

function makeResolvedPos(opts: { depth: number }) {
  return {
    depth: opts.depth,
    pos: 0,
    node: () => ({ type: { name: "doc" }, attrs: {} }),
  };
}

function makeView(opts: { $from: ReturnType<typeof makeResolvedPos> }) {
  return {
    state: {
      selection: { $from: opts.$from },
      doc: { resolve: () => opts.$from },
    },
  };
}

interface MakeEditorOpts {
  tableExists: boolean;
  commandResult?: boolean;
  commandImpl?: (key: string, payload?: unknown) => boolean;
  contextOverride?: TableContext;
}

/**
 * Build a mock Milkdown editor that:
 *   1. exposes a `commandsCtx` whose `.call(key, payload)` is recorded
 *   2. exposes an `editorViewCtx` that — when computeTableContext runs
 *      against it — returns `null` (no table) or the supplied
 *      `contextOverride`. Achieved by hooking findTable via the global
 *      flag below.
 */
function makeEditor(opts: MakeEditorOpts) {
  const fakeCommands = {
    call: vi.fn((key: unknown, payload?: unknown) => {
      const k = String((key as { displayName?: string } | string));
      const name = inferKeyName(k);
      if (opts.commandImpl) return opts.commandImpl(name, payload);
      return opts.commandResult ?? true;
    }),
  };
  // Stash desired computeTableContext result on a globalish hook the
  // mock for findTable below reads.
  (globalThis as { __mockContextResult?: TableContext | null }).__mockContextResult =
    opts.tableExists ? (opts.contextOverride ?? FRESH_CTX) : null;

  // computeTableContext derives rowIndex/colIndex from $pos.pos by
  // scanning TableMap. With map = [1, 2, 3, …], the loop assigns
  // cellIndex while map[i] < cellRel and breaks when map[i] >= cellRel.
  // To get cellIndex = N, set $pos.pos = N + 2 (so the loop walks
  // through indices 0..N before breaking).
  const ctxResult = opts.contextOverride ?? FRESH_CTX;
  const targetCellIndex = ctxResult.rowIndex * ctxResult.colCount + ctxResult.colIndex;
  const $from = {
    depth: 1,
    pos: targetCellIndex + 2,
    node: () => ({
      type: { name: "table_cell" },
      attrs: { alignment: ctxResult.alignment },
    }),
  };

  return {
    action: (fn: (ctx: unknown) => void) => {
      fn({
        get: (key: unknown) => {
          if ((key as { __which?: string }).__which === "view") {
            return makeView({ $from });
          }
          return fakeCommands;
        },
      });
    },
  };
}

function inferKeyName(k: string): string {
  // Milkdown command keys serialize their displayName when stringified —
  // when the test framework can't, we just return the raw token.
  if (k.includes("selectRow")) return "selectRowCommand";
  if (k.includes("selectCol")) return "selectColCommand";
  if (k.includes("selectTable")) return "selectTableCommand";
  if (k.includes("deleteSelected")) return "deleteSelectedCellsCommand";
  if (k.includes("addRowBefore")) return "addRowBeforeCommand";
  if (k.includes("addRowAfter")) return "addRowAfterCommand";
  if (k.includes("addColBefore")) return "addColBeforeCommand";
  if (k.includes("addColAfter")) return "addColAfterCommand";
  if (k.includes("moveRow")) return "moveRowCommand";
  if (k.includes("moveCol")) return "moveColCommand";
  if (k.includes("setAlign")) return "setAlignCommand";
  return k;
}

// Mock @milkdown/kit/core so `commandsCtx`/`editorViewCtx` get __which markers
// and getEditor returns deterministically.
vi.mock("@milkdown/kit/core", () => ({
  commandsCtx: { __which: "commands" },
  editorViewCtx: { __which: "view" },
}));

// Mock @milkdown/kit/preset/gfm so .key on each command returns its displayName.
vi.mock("@milkdown/kit/preset/gfm", () => {
  const cmd = (name: string) => ({ key: { displayName: name, toString: () => name } });
  return {
    addColAfterCommand: cmd("addColAfterCommand"),
    addColBeforeCommand: cmd("addColBeforeCommand"),
    addRowAfterCommand: cmd("addRowAfterCommand"),
    addRowBeforeCommand: cmd("addRowBeforeCommand"),
    deleteSelectedCellsCommand: cmd("deleteSelectedCellsCommand"),
    moveColCommand: cmd("moveColCommand"),
    moveRowCommand: cmd("moveRowCommand"),
    selectColCommand: cmd("selectColCommand"),
    selectRowCommand: cmd("selectRowCommand"),
    selectTableCommand: cmd("selectTableCommand"),
    setAlignCommand: cmd("setAlignCommand"),
  };
});

// Mock @milkdown/kit/prose/tables — findTable consults a global hook.
vi.mock("@milkdown/kit/prose/tables", () => ({
  findTable: () => {
    const result = (globalThis as { __mockContextResult?: TableContext | null }).__mockContextResult;
    if (!result) return null;
    return {
      node: { content: { content: [] } },
      start: 0,
      pos: 0,
      depth: 1,
    };
  },
  TableMap: {
    get: () => {
      const result = (globalThis as { __mockContextResult?: TableContext | null }).__mockContextResult;
      const r = result ?? FRESH_CTX;
      return {
        map: Array.from({ length: r.rowCount * r.colCount }, (_, i) => i + 1),
        width: r.colCount,
        height: r.rowCount,
      };
    },
  },
  isInTable: () => true,
}));
