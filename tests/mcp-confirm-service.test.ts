// @vitest-environment node
/**
 * ADR-0042 WI-6 — `mcpConfirmService.reply`, the typed wrapper for
 * `mcp_confirm_reply`.
 *
 * Cases SV-1, SV-2, SV-3 of `.claude/tdd-guardian/tests-20260929-102912.md`.
 *
 * Law: the wire args are exactly `{requestId, approved}` for every input. No
 * window label is ever sent (Rust takes it from the calling webview).
 *
 * Mocked: `@tauri-apps/api/core` `invoke` (no Tauri runtime in jsdom) and
 * `loggingService.logEventSync` (the logging boundary). The IPC hop itself is
 * paired with G1 / G8 in the WI-10 GUI acceptance run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { mcpConfirmService, reply } from "../src/services/mcpConfirmService";
import { loggingService } from "../src/services/loggingService";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  invokeMock.mockReset();
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

function busCalls(): Array<{ cmd: unknown; args: unknown }> {
  return invokeMock.mock.calls.map(([cmd, args]) => ({ cmd, args }));
}

describe("SV-1 verdict returned and args exact over the input domain", () => {
  it("SV-1 approved × {canonical, uppercase} UUID: verdict surfaced, args exactly {requestId, approved}", async () => {
    const ids = ["3f2504e0-4f89-41d3-9a0c-0305e82c3301", "3F2504E0-4F89-41D3-9A0C-0305E82C3301"];
    const domain: Array<[string, boolean]> = [];
    for (const approved of [true, false]) for (const id of ids) domain.push([id, approved]);
    expect(domain).toHaveLength(4);

    invokeMock
      .mockResolvedValueOnce("resolved")
      .mockResolvedValueOnce("resolved")
      .mockResolvedValue("ignoredUnknown");

    for (const [i, [id, approved]] of domain.entries()) {
      const verdict = await reply(id, approved);
      expect(verdict, `call ${i}`).toBe(i < 2 ? "resolved" : "ignoredUnknown");
    }

    const calls = busCalls();
    expect(calls).toHaveLength(4);
    for (const [i, [id, approved]] of domain.entries()) {
      expect(calls[i], `call ${i}`).toStrictEqual({
        cmd: "mcp_confirm_reply",
        args: { requestId: id, approved },
      });
      const keys = Object.keys(calls[i].args as object);
      for (const banned of ["window", "label", "windowLabel"]) {
        expect(keys, `call ${i}`).not.toContain(banned);
      }
    }
  });

  it("SV-1 the service object exposes the same reply", async () => {
    invokeMock.mockResolvedValue("ignoredWrongWindow");
    await expect(mcpConfirmService.reply("r-9", false)).resolves.toBe("ignoredWrongWindow");
    expect(busCalls()).toStrictEqual([
      { cmd: "mcp_confirm_reply", args: { requestId: "r-9", approved: false } },
    ]);
  });
});

describe("SV-2 bare-string rejection → Error plus one redacted fail log", () => {
  it("SV-2 rejects with an Error carrying the string, and logs {requestId, approved} once", async () => {
    invokeMock.mockRejectedValue("stale request");

    const outcome = await reply("r-1", true).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    expect(outcome.ok).toBe(false);
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("stale request");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = logSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ event: "mcp.confirm.reply", status: "fail" });
    expect(payload.context).toStrictEqual({ requestId: "r-1", approved: true });
  });
});

describe("SV-3 Error and object rejections narrow correctly", () => {
  it("SV-3 an Error rejection surfaces its message", async () => {
    invokeMock.mockRejectedValue(new Error("disk"));
    const err = await reply("r-2", false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("disk");
  });

  it("SV-3 an object rejection surfaces as an Error with String(object)", async () => {
    invokeMock.mockRejectedValue({ code: 3 });
    const err = await reply("r-3", true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("[object Object]");
  });
});
