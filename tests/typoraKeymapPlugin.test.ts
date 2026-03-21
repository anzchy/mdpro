/**
 * Tests for typoraKeymapPlugin
 *
 * Root cause of issue #31: Commands like `wrapInHeadingCommand` are part of the
 * commonmark preset, which is NOT loaded when the editor uses `.use(gfm)` only.
 * Calling `commands.call(wrapInHeadingCommand.key, N)` throws `contextNotFound`
 * at runtime, making heading shortcuts silently fail.
 *
 * Fix: Use ProseMirror's `setBlockType` / `toggleMark` directly, looking up
 * node/mark types from `state.schema` instead of going through the Milkdown
 * command registry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Command } from "@milkdown/kit/prose/state";

// ---------------------------------------------------------------------------
// Helpers: minimal ProseMirror-like mocks
// ---------------------------------------------------------------------------

function makeMarkType(name: string) {
  return { name, spec: {} };
}

function makeNodeType(name: string) {
  return { name, spec: {} };
}

function makeSchema(nodes: string[], marks: string[]) {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n, makeNodeType(n)])),
    marks: Object.fromEntries(marks.map((m) => [m, makeMarkType(m)])),
  };
}

function makeState(schema: ReturnType<typeof makeSchema>) {
  return {
    schema,
    selection: { from: 0, to: 0 },
    tr: {
      setNodeMarkup: vi.fn().mockReturnThis(),
      addMark: vi.fn().mockReturnThis(),
    },
  };
}

// ---------------------------------------------------------------------------
// The plugin returns a $useKeymap result. We test the logic layer:
// the `command` function for each keybinding must return a ProseMirror Command
// that accepts (state, dispatch) parameters.
// ---------------------------------------------------------------------------

// Import the module under test.  We test exports that expose the command
// functions so we can unit-test them without spinning up a full Milkdown editor.
import {
  makeHeadingCommand,
  makeParagraphCommand,
  makeBoldCommand,
  makeItalicCommand,
} from "../src/plugins/milkdown/typoraKeymapPlugin";

describe("typoraKeymapPlugin — heading commands", () => {
  it("makeHeadingCommand returns a function (the ProseMirror Command)", () => {
    const cmd = makeHeadingCommand(1);
    expect(typeof cmd).toBe("function");
  });

  it("makeHeadingCommand accepts (state, dispatch) — correct Command signature", () => {
    const cmd = makeHeadingCommand(1);
    expect(cmd.length).toBeLessThanOrEqual(3); // (state, dispatch?, view?)
  });

  it("makeHeadingCommand returns false when heading node type is absent from schema", () => {
    const schema = makeSchema(["paragraph"], ["strong", "emphasis"]);
    const state = makeState(schema) as unknown as Parameters<Command>[0];
    const dispatch = vi.fn();

    const cmd = makeHeadingCommand(1);
    const result = cmd(state, dispatch);

    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("makeHeadingCommand levels 1-6 each produce distinct commands", () => {
    const cmds = [1, 2, 3, 4, 5, 6].map(makeHeadingCommand);
    // All are functions
    cmds.forEach((cmd) => expect(typeof cmd).toBe("function"));
    // They are not the same reference (each level is a separate closure)
    expect(cmds[0]).not.toBe(cmds[1]);
  });
});

describe("typoraKeymapPlugin — paragraph command", () => {
  it("makeParagraphCommand returns a function", () => {
    const cmd = makeParagraphCommand();
    expect(typeof cmd).toBe("function");
  });

  it("makeParagraphCommand returns false when paragraph node is absent", () => {
    const schema = makeSchema(["heading"], ["strong"]);
    const state = makeState(schema) as unknown as Parameters<Command>[0];
    const dispatch = vi.fn();

    const cmd = makeParagraphCommand();
    const result = cmd(state, dispatch);

    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("typoraKeymapPlugin — bold command", () => {
  it("makeBoldCommand returns a function", () => {
    const cmd = makeBoldCommand();
    expect(typeof cmd).toBe("function");
  });

  it("makeBoldCommand returns false when strong mark is absent from schema", () => {
    const schema = makeSchema(["paragraph", "heading"], ["emphasis"]);
    const state = makeState(schema) as unknown as Parameters<Command>[0];
    const dispatch = vi.fn();

    const cmd = makeBoldCommand();
    const result = cmd(state, dispatch);

    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("typoraKeymapPlugin — italic command", () => {
  it("makeItalicCommand returns a function", () => {
    const cmd = makeItalicCommand();
    expect(typeof cmd).toBe("function");
  });

  it("makeItalicCommand returns false when emphasis mark is absent from schema", () => {
    const schema = makeSchema(["paragraph", "heading"], ["strong"]);
    const state = makeState(schema) as unknown as Parameters<Command>[0];
    const dispatch = vi.fn();

    const cmd = makeItalicCommand();
    const result = cmd(state, dispatch);

    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("typoraKeymapPlugin — shortcut definitions", () => {
  it("exports typoraKeymapPlugin with milkdownPlugin factory", async () => {
    const { typoraKeymapPlugin } = await import(
      "../src/plugins/milkdown/typoraKeymapPlugin"
    );
    expect(typeof typoraKeymapPlugin.milkdownPlugin).toBe("function");
  });

  it("milkdownPlugin factory returns a value (the $useKeymap result)", async () => {
    const { typoraKeymapPlugin } = await import(
      "../src/plugins/milkdown/typoraKeymapPlugin"
    );
    const result = typoraKeymapPlugin.milkdownPlugin?.({} as never, {} as never);
    expect(result).toBeTruthy();
  });
});
