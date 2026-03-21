import { describe, expect, it, vi } from "vitest";
import {
  typoraKeymapPlugin,
  buildParagraphCommand,
  buildHeadingCommand,
} from "../src/plugins/milkdown/typoraKeymapPlugin";

describe("typoraKeymapPlugin — metadata", () => {
  it("is named 'typora-keymap'", () => {
    expect(typoraKeymapPlugin.name).toBe("typora-keymap");
  });

  it("supports milkdown mode only", () => {
    expect(typoraKeymapPlugin.supportedModes).toEqual(["milkdown"]);
  });

  it("is enabled by default", () => {
    expect(typoraKeymapPlugin.defaultConfig.enabled).toBe(true);
  });
});

describe("buildParagraphCommand", () => {
  it("calls turnIntoTextCommand.key — NOT wrapInHeadingCommand with level 0", () => {
    const mockCommandsCall = vi.fn().mockReturnValue(true);
    const mockCtx = {
      get: vi.fn().mockReturnValue({ call: mockCommandsCall }),
    };

    const executor = buildParagraphCommand(mockCtx as never);
    executor();

    // Must NOT call wrapInHeadingCommand with 0 — that would be the bug
    const calls = mockCommandsCall.mock.calls;
    for (const [, arg] of calls) {
      expect(arg).not.toBe(0);
    }

    // Should have called exactly one command
    expect(mockCommandsCall).toHaveBeenCalledTimes(1);
  });

  it("returns a boolean (or falsy/truthy) result", () => {
    const mockCommandsCall = vi.fn().mockReturnValue(true);
    const mockCtx = {
      get: vi.fn().mockReturnValue({ call: mockCommandsCall }),
    };

    const executor = buildParagraphCommand(mockCtx as never);
    const result = executor();
    expect(result).toBe(true);
  });
});

describe("buildHeadingCommand", () => {
  it.each([1, 2, 3, 4, 5, 6])("level %i calls wrapInHeadingCommand with that level", (level) => {
    const mockCommandsCall = vi.fn().mockReturnValue(true);
    const mockCtx = {
      get: vi.fn().mockReturnValue({ call: mockCommandsCall }),
    };

    const executor = buildHeadingCommand(level)(mockCtx as never);
    executor();

    expect(mockCommandsCall).toHaveBeenCalledTimes(1);
    expect(mockCommandsCall.mock.calls[0][1]).toBe(level);
  });

  it("never passes level 0 to wrapInHeadingCommand via heading shortcuts", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const mockCommandsCall = vi.fn().mockReturnValue(true);
      const mockCtx = {
        get: vi.fn().mockReturnValue({ call: mockCommandsCall }),
      };
      buildHeadingCommand(level)(mockCtx as never)();
      expect(mockCommandsCall.mock.calls[0][1]).not.toBe(0);
    }
  });
});
