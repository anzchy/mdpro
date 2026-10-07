// @vitest-environment node
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

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection, type Command } from "@milkdown/kit/prose/state";

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
  makeCodeBlockIndentCommand,
  makeHeadingCommand,
  makeParagraphCommand,
  makeBoldCommand,
  makeItalicCommand,
} from "../src/plugins/milkdown/typoraKeymapPlugin";

const codeBlockTestSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { content: "text*", group: "block" },
    code_block: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
    },
  },
  marks: {},
});

function makeCodeBlockState(text: string, fromOffset: number, toOffset: number) {
  const codeBlock = text.length > 0
    ? codeBlockTestSchema.node("code_block", null, [codeBlockTestSchema.text(text)])
    : codeBlockTestSchema.node("code_block");
  const doc = codeBlockTestSchema.node("doc", null, [codeBlock]);
  const blockStart = 1;
  return EditorState.create({
    schema: codeBlockTestSchema,
    doc,
    selection: TextSelection.create(doc, blockStart + fromOffset, blockStart + toOffset),
  });
}

function makeParagraphState(text: string) {
  const paragraph = codeBlockTestSchema.node(
    "paragraph",
    null,
    text.length > 0 ? [codeBlockTestSchema.text(text)] : undefined,
  );
  const doc = codeBlockTestSchema.node("doc", null, [paragraph]);
  return EditorState.create({
    schema: codeBlockTestSchema,
    doc,
    selection: TextSelection.create(doc, 1, 1),
  });
}

function getFirstBlockText(tr: { doc: { firstChild: { textContent: string } | null } }) {
  return tr.doc.firstChild?.textContent ?? "";
}

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

describe("typoraKeymapPlugin — code block indentation", () => {
  it("indents only selected code block lines on Tab", () => {
    const text = "const a = 1;\nreturn a;\nconsole.log(a);";
    const state = makeCodeBlockState(text, 0, text.indexOf("console.log"));
    const dispatch = vi.fn();

    const result = makeCodeBlockIndentCommand("indent")(state, dispatch);

    expect(result).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(getFirstBlockText(dispatch.mock.calls[0][0])).toBe(
      "    const a = 1;\n    return a;\nconsole.log(a);",
    );
  });

  it("outdents selected code block lines on Shift-Tab", () => {
    const text = "    const a = 1;\n  return a;\n\tconsole.log(a);";
    const state = makeCodeBlockState(text, 0, text.length);
    const dispatch = vi.fn();

    const result = makeCodeBlockIndentCommand("outdent")(state, dispatch);

    expect(result).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(getFirstBlockText(dispatch.mock.calls[0][0])).toBe(
      "const a = 1;\nreturn a;\nconsole.log(a);",
    );
  });

  it("consumes Shift-Tab inside an unindented code block without dispatching", () => {
    const state = makeCodeBlockState("const a = 1;", 0, 0);
    const dispatch = vi.fn();

    const result = makeCodeBlockIndentCommand("outdent")(state, dispatch);

    expect(result).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns false outside code blocks so other Tab handlers can run", () => {
    const state = makeParagraphState("plain text");
    const dispatch = vi.fn();

    const result = makeCodeBlockIndentCommand("indent")(state, dispatch);

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

  it("binds Tab and Shift-Tab for code block indentation", async () => {
    const { TYPORA_KEYMAP_CONFIG } = await import(
      "../src/plugins/milkdown/typoraKeymapPlugin"
    );

    expect(TYPORA_KEYMAP_CONFIG.codeBlockIndent.shortcuts).toBe("Tab");
    expect(TYPORA_KEYMAP_CONFIG.codeBlockOutdent.shortcuts).toBe("Shift-Tab");
  });
});
