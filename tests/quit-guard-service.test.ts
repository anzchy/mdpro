/**
 * WI-5 (D16) — `quitGuardService.reply`, the typed wrapper over the
 * `quit_guard_reply` IPC command.
 *
 * Two things are pinned here:
 *  - the wire payload (S1). Tauri maps camelCase args onto snake_case params, so
 *    the arg names ARE the IPC contract. The window label is never sent: Rust takes
 *    it from the calling `WebviewWindow` (ADR-0025 / rule 60 trust boundary), and a
 *    label in the payload would be a spoofable input.
 *  - error narrowing (S2/S3). `invoke` rejects with whatever Rust returned, which is
 *    frequently a bare string. The rule-50 pattern
 *    (`error instanceof Error ? error.message : String(error)`) must turn that into
 *    a readable `Error` rather than letting a non-Error escape to the caller.
 *
 * The only mock is the Tauri core boundary itself, plus loggingService.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const bus = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
  rejectWith: null as unknown,
  shouldReject: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    bus.calls.push({ cmd, args });
    if (bus.shouldReject) throw bus.rejectWith;
    return null;
  },
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { quitGuardService } from "../src/services/quitGuardService";

beforeEach(() => {
  bus.calls.length = 0;
  bus.rejectWith = null;
  bus.shouldReject = false;
});

describe("WI5-S1 the wire payload", () => {
  it("sends exactly requestId + answer, with documentIds only on discard", async () => {
    await quitGuardService.reply(7, "discard", ["a", "b"]);
    await quitGuardService.reply(7, "clean");
    await quitGuardService.reply(8, "dirty");
    await quitGuardService.reply(9, "cancel");

    expect(bus.calls).toEqual([
      {
        cmd: "quit_guard_reply",
        args: { requestId: 7, answer: "discard", documentIds: ["a", "b"] },
      },
      { cmd: "quit_guard_reply", args: { requestId: 7, answer: "clean" } },
      { cmd: "quit_guard_reply", args: { requestId: 8, answer: "dirty" } },
      { cmd: "quit_guard_reply", args: { requestId: 9, answer: "cancel" } },
    ]);
  });

  it("never sends a window label under any name", async () => {
    await quitGuardService.reply(1, "discard", ["x"]);
    await quitGuardService.reply(2, "cancel");

    for (const call of bus.calls) {
      const keys = Object.keys(call.args);
      expect(keys).not.toContain("windowLabel");
      expect(keys).not.toContain("label");
      expect(keys).not.toContain("window");
    }
  });

  it("omits documentIds entirely on a non-discard answer, even when ids are passed", async () => {
    await quitGuardService.reply(3, "clean", ["a"]);

    expect(Object.keys(bus.calls[0].args)).toEqual(["requestId", "answer"]);
  });
});

describe("WI5-S2 a non-Error rejection becomes a readable Error", () => {
  it("narrows a rejected string", async () => {
    bus.shouldReject = true;
    bus.rejectWith = "stale request";

    await expect(quitGuardService.reply(7, "clean")).rejects.toThrow(/stale request/);
    await expect(quitGuardService.reply(7, "clean")).rejects.toBeInstanceOf(Error);
  });

  it("narrows a rejected plain object through String()", async () => {
    bus.shouldReject = true;
    bus.rejectWith = { code: 3 };

    const error = await quitGuardService.reply(7, "cancel").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("[object Object]");
  });
});

describe("WI5-S3 an Error rejection keeps its message", () => {
  it("preserves the message text", async () => {
    bus.shouldReject = true;
    bus.rejectWith = new Error("disk");

    const error = await quitGuardService.reply(7, "discard", ["a"]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("disk");
  });
});
