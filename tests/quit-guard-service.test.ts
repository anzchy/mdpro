// @vitest-environment node
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

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
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
import { loggingService } from "../src/services/loggingService";

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

/**
 * D16F WI-3 (audit rows 4, 19): the service removes every id it sent from the
 * rejection text before logging it and before rethrowing it. Defence in depth
 * against any Rust or serde message that quotes an id back.
 */
function logCalls(): Array<{ error?: string; context?: Record<string, unknown> }> {
  return vi.mocked(loggingService.logEventSync).mock.calls.map(
    (c) => c[0] as { error?: string; context?: Record<string, unknown> },
  );
}

async function rejection(p: Promise<void>): Promise<Error> {
  const e = await p.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(Error);
  return e as Error;
}

describe("D16F-WI-3 own ids are scrubbed from the error text", () => {
  beforeEach(() => {
    vi.mocked(loggingService.logEventSync).mockClear();
    bus.shouldReject = true;
  });

  it("scrubs a leaked id from both the log and the rethrow", async () => {
    bus.rejectWith = 'invalid document id: "doc-abc/x"';

    const error = await rejection(quitGuardService.reply(7, "discard", ["doc-abc/x", "doc-ok"]));

    expect(error.message.startsWith("quit_guard_reply failed: ")).toBe(true);
    expect(error.message).not.toContain("doc-abc/x");
    expect(error.message).not.toContain("doc-ok");
    const logs = logCalls();
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toEqual({ requestId: 7, answer: "discard", documentIdCount: 2 });
    expect(logs[0].error).not.toContain("doc-abc/x");
    expect(logs[0].error).not.toContain("doc-ok");
  });

  it("property: overlapping and regex-special ids are all scrubbed", async () => {
    let state = 0xd16_0003n;
    const next = (): bigint => {
      state = (state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return z ^ (z >> 31n);
    };
    const below = (n: number): number => Number(next() % BigInt(n));
    const pool = ["doc-1", "doc-12", "doc-123", "a.b*(", "$&", "x|y"];

    for (let c = 0; c < 200; c++) {
      const count = 1 + below(4);
      const ids = Array.from({ length: count }, () =>
        below(7) === 6 ? `doc-${next().toString(16)}` : pool[below(pool.length)],
      );
      bus.rejectWith = `refused ${ids.map((id) => `"${id}"`).join(" and ")} twice: ${ids.join(",")}`;
      vi.mocked(loggingService.logEventSync).mockClear();

      const error = await rejection(quitGuardService.reply(c, "discard", ids));
      const logged = logCalls()[0].error ?? "";
      for (const id of ids) {
        expect(error.message, `case ${c} ids ${JSON.stringify(ids)}`).not.toContain(id);
        expect(logged, `case ${c} ids ${JSON.stringify(ids)}`).not.toContain(id);
      }
    }
  });

  it("passes a message with no ids through unchanged", async () => {
    bus.rejectWith = "too many documentIds: 101 (the limit is 100)";

    const error = await rejection(quitGuardService.reply(8, "discard", ["doc-a"]));

    expect(error.message).toBe(
      "quit_guard_reply failed: too many documentIds: 101 (the limit is 100)",
    );
    const logs = logCalls();
    expect(logs).toHaveLength(1);
    expect(logs[0].error).toBe("too many documentIds: 101 (the limit is 100)");
  });

  it("scrubs an Error rejection, and tolerates a reply with no ids", async () => {
    bus.rejectWith = new Error('bad "doc-z"');
    const a = await rejection(quitGuardService.reply(9, "discard", ["doc-z"]));
    expect(a.message).not.toContain("doc-z");
    expect(logCalls()[0].error).not.toContain("doc-z");
    expect(logCalls()[0].context?.documentIdCount).toBe(1);

    vi.mocked(loggingService.logEventSync).mockClear();
    bus.rejectWith = "window gone";
    const b = await rejection(quitGuardService.reply(10, "cancel"));
    expect(b.message).toBe("quit_guard_reply failed: window gone");
    expect(logCalls()[0].context?.documentIdCount).toBe(0);
  });
});

describe("D16F-WI-3 scrub edge cases", () => {
  it("leaves no id behind when a removal splices one together, or an id is tiny", async () => {
    bus.shouldReject = true;
    bus.rejectWith = 'bad id "ddoc-1oc-1" and "d"';
    vi.mocked(loggingService.logEventSync).mockClear();

    const error = await rejection(quitGuardService.reply(11, "discard", ["doc-1", "id", "d"]));

    for (const id of ["doc-1", "id", "d"]) {
      expect(error.message.slice("quit_guard_reply failed: ".length)).not.toContain(id);
      expect(logCalls()[0].error).not.toContain(id);
    }
  });
});

/** ADR-0035 WI-6 (A5): the `drafted` answer, its counts, and the optional `round`. */
describe("ADR35-WI-6 the drafted reply", () => {
  it("SV-1 drafted with counts crosses IPC with exactly its keys", async () => {
    const extras = { draftedCount: 2, failedCount: 1 };
    await expect(quitGuardService.reply(7, "drafted", undefined, extras)).resolves.toBeUndefined();
    expect([bus.calls[0].cmd, bus.calls[0].args]).toStrictEqual([
      "quit_guard_reply",
      { requestId: 7, answer: "drafted", draftedCount: 2, failedCount: 1 },
    ]);
  });

  it("SV-2 property: the payload key set is a pure function of the arguments", async () => {
    const seed = 0xad35_0006n;
    let s = seed;
    const below = (n: number): number => {
      s = (s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let z = ((s ^ (s >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return Number((z ^ (z >> 31n)) % BigInt(n));
    };
    const answers = ["clean", "dirty", "discard", "cancel", "delivered", "drafted"] as const;
    const rounds = [undefined, 0, 1, 7, -1, 1.5, Number.NaN];
    const maybe = <T>(v: T): T | undefined => (below(2) === 0 ? undefined : v);

    for (let i = 0; i < 600; i++) {
      const answer = answers[below(answers.length)];
      const ids = [undefined, [], [`doc-${below(1000)}`, `doc-${below(1000)}`]][below(3)];
      const extras = maybe({
        ...maybe({ draftedCount: below(102) }),
        ...maybe({ failedCount: below(102) }),
        ...maybe({ round: rounds[below(rounds.length)] }),
      });
      bus.calls.length = 0;

      await quitGuardService.reply(i, answer, ids, extras);

      const want: Record<string, unknown> = { requestId: i, answer };
      if (answer === "discard" && ids !== undefined) want.documentIds = ids;
      const [d, f, r] = [extras?.draftedCount, extras?.failedCount, extras?.round];
      if (answer === "drafted" && d !== undefined && f !== undefined) {
        Object.assign(want, { draftedCount: d, failedCount: f });
      }
      if (typeof r === "number" && Number.isInteger(r) && r >= 0) want.round = r;
      const label = `seed ${seed} index ${i}`;
      const got = bus.calls[0].args;
      expect(Object.keys(got).sort(), label).toEqual(Object.keys(want).sort());
      for (const k of Object.keys(want)) expect(got[k], `${label} key ${k}`).toBe(want[k]);
    }
  });

  it("SV-3 a rejected drafted reply is logged with counts only and rethrown as Error", async () => {
    vi.mocked(loggingService.logEventSync).mockClear();
    bus.shouldReject = true;
    bus.rejectWith = "boom";
    const extras = { draftedCount: 2, failedCount: 1, round: 1 };

    const error = await rejection(quitGuardService.reply(7, "drafted", undefined, extras));

    expect(error.message).toContain("boom");
    const all = vi.mocked(loggingService.logEventSync).mock.calls.map((c) => c[0]);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ event: "app.quit.reply", status: "fail" });
    expect(all[0].context).toStrictEqual({
      requestId: 7,
      answer: "drafted",
      documentIdCount: 0,
      ...extras,
    });
  });
});

describe("ADR-0035 review M-1 the drafted reply names its undiscarded ids", () => {
  it("SV-4 undiscardedIds cross IPC as documentIds, only with a drafted reply that has its counts", async () => {
    const undiscardedIds = ["a", "b"];
    await quitGuardService.reply(9, "drafted", undefined, {
      draftedCount: 2,
      failedCount: 0,
      round: 1,
      undiscardedIds,
    });
    expect(bus.calls[0].args).toStrictEqual({
      requestId: 9,
      answer: "drafted",
      draftedCount: 2,
      failedCount: 0,
      round: 1,
      documentIds: ["a", "b"],
    });
  });

  it("SV-5 no documentIds for an empty list, on a count-less drafted, or on any other answer", async () => {
    await quitGuardService.reply(1, "drafted", undefined, {
      draftedCount: 0,
      failedCount: 0,
      undiscardedIds: [],
    });
    await quitGuardService.reply(2, "drafted", undefined, { draftedCount: 1, undiscardedIds: ["a"] });
    await quitGuardService.reply(3, "clean", undefined, { undiscardedIds: ["a"] });
    await quitGuardService.reply(4, "discard", ["x"], { undiscardedIds: ["a"] });

    expect(bus.calls.map((c) => c.args)).toStrictEqual([
      { requestId: 1, answer: "drafted", draftedCount: 0, failedCount: 0 },
      { requestId: 2, answer: "drafted" },
      { requestId: 3, answer: "clean" },
      { requestId: 4, answer: "discard", documentIds: ["x"] },
    ]);
  });

  it("SV-6 a rejection quoting an undiscarded id is scrubbed from the log and the rethrow", async () => {
    vi.mocked(loggingService.logEventSync).mockClear();
    bus.shouldReject = true;
    bus.rejectWith = "invalid document id doc-secret-77";

    const error = await rejection(
      quitGuardService.reply(9, "drafted", undefined, {
        draftedCount: 1,
        failedCount: 0,
        round: 1,
        undiscardedIds: ["doc-secret-77"],
      }),
    );

    expect(error.message).not.toContain("doc-secret-77");
    const all = vi.mocked(loggingService.logEventSync).mock.calls.map((c) => c[0]);
    expect(all).toHaveLength(1);
    expect(JSON.stringify(all)).not.toContain("doc-secret-77");
    expect(all[0].context).toStrictEqual({
      requestId: 9,
      answer: "drafted",
      documentIdCount: 1,
      draftedCount: 1,
      failedCount: 0,
      round: 1,
    });
  });
});
