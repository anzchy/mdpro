/**
 * ADR-0035 WI-8 (A3, A5) — `useQuitGuard` answers the re-check, latches on
 * `(requestId, round)`, and honours the discard snapshot.
 *
 * Law:
 * - Latch uniqueness: per `(requestId, round)` at most one answer to
 *   `app:quit-requested` and at most one dialog for `app:quit-prompt`; a prompt
 *   whose round is below the highest round seen for its request is ignored.
 * - Round echo: every reply echoes its event's round; an invalid or absent round
 *   gives a reply with no `round` key.
 * - Snapshot ordering: the discard snapshot is read after `confirmQuit`'s flush,
 *   and every re-check compares it against the store read after its own flush.
 *
 * Mocked: `@tauri-apps/api/{webviewWindow,core}` and `loggingService` only. The
 * stores and the flusher registry are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { bus, core } = vi.hoisted(() => ({
  bus: { listeners: new Map<string, Set<Cb>>() },
  core: { replies: [] as Array<{ cmd: string; args: Record<string, unknown> }> },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: Cb) => {
      const set = bus.listeners.get(name) ?? new Set<Cb>();
      set.add(cb);
      bus.listeners.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.replies.push({ cmd, args: { ...args } });
    return null;
  }),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

import { loggingService } from "../src/services/loggingService";
import { useQuitGuard } from "../src/hooks/useQuitGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";

const REQUESTED = "app:quit-requested";
const PROMPT = "app:quit-prompt";
const CANCELLED = "app:quit-cancelled";

function makeDoc(id: string, isModified: boolean, content = ""): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified,
    lastSaved: null,
    fileSize: null,
  };
}

function setDocuments(docs: Document[]): void {
  useDocumentStore.setState({ documents: docs, activeDocumentId: docs[0]?.id ?? null });
}

/** Reply payloads (args only) crossing the `invoke` boundary, in order. */
const allQuitReplies = () =>
  core.replies.filter((r) => r.cmd === "quit_guard_reply").map((r) => r.args);
const quitReplies = () => allQuitReplies().filter((a) => a.answer !== "delivered");
const lastReply = () => quitReplies().at(-1);

const checkLogs = () =>
  vi
    .mocked(loggingService.logEventSync)
    .mock.calls.map(([entry]) => entry)
    .filter((entry) => entry.event === "app.quit.check" && entry.status === "success");

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.listeners.get(name) ?? [])]) cb({ payload });
    for (let i = 0; i < 3; i += 1) await Promise.resolve();
  });
}

async function renderGuard() {
  const rendered = renderHook(() => useQuitGuard());
  await settle();
  return rendered;
}

type Guard = Awaited<ReturnType<typeof renderGuard>>;

async function confirm(guard: Guard): Promise<void> {
  await act(async () => {
    guard.result.current.confirmQuit();
    await Promise.resolve();
  });
}

async function cancel(guard: Guard): Promise<void> {
  await act(async () => {
    guard.result.current.cancelQuit();
    await Promise.resolve();
  });
}

/** a dirty ("A1"), request 9 round 0: dirty → prompt → Discard. */
async function discardRound0(): Promise<Guard> {
  setDocuments([makeDoc("a", true, "A1"), makeDoc("b", false, "B0")]);
  const guard = await renderGuard();
  await deliver(REQUESTED, { requestId: 9, round: 0 });
  await deliver(PROMPT, { requestId: 9, round: 0 });
  expect(guard.result.current.quitPrompt).toEqual({ requestId: 9 });
  await confirm(guard);
  return guard;
}

/** A flusher whose first call types into `id`, then reports clean. */
function onceFlusher(id: string, content: string) {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls > 1) return { status: "clean" as const };
    useDocumentStore.getState().updateDocumentContent(id, content);
    useDocumentStore.getState().markDocumentModified(id, true);
    return { status: "written" as const };
  };
}

beforeEach(() => {
  bus.listeners.clear();
  core.replies.length = 0;
  vi.clearAllMocks();
  useMilkdownEditorStore.setState({ flushers: {} });
  setDocuments([]);
});

describe("useQuitGuard — re-check and round latch (WI-8, A5)", () => {
  it("HK-1: clean, then a background edit, then the re-check answers dirty (D26)", async () => {
    setDocuments([makeDoc("a", false, "A0"), makeDoc("b", false, "B0")]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 9, round: 0 });
    await act(async () => {
      useDocumentStore.getState().updateDocumentContent("b", "edited");
      useDocumentStore.getState().markDocumentModified("b", true);
    });
    await deliver(REQUESTED, { requestId: 9, round: 1 });

    expect(quitReplies()).toStrictEqual([
      { requestId: 9, answer: "clean", round: 0 },
      { requestId: 9, answer: "dirty", round: 1 },
    ]);
    expect(result.current.quitPrompt).toBeNull();
  });

  it("HK-2: a re-prompt after a discard raises the dialog again and acks delivered, round 1", async () => {
    const guard = await discardRound0();
    await act(async () => {
      useDocumentStore.getState().updateDocumentContent("a", "A2");
    });
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    expect(lastReply()).toStrictEqual({ requestId: 9, answer: "dirty", round: 1 });

    await deliver(PROMPT, { requestId: 9, round: 1 });

    expect(guard.result.current.quitPrompt).toEqual({ requestId: 9 });
    expect(allQuitReplies()).toContainEqual({ requestId: 9, answer: "delivered", round: 1 });
  });

  it("HK-3: a repeated prompt with the same round after a cancel is ignored", async () => {
    setDocuments([makeDoc("a", true, "A1")]);
    const guard = await renderGuard();
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    await deliver(PROMPT, { requestId: 9, round: 1 });
    await cancel(guard);
    await deliver(PROMPT, { requestId: 9, round: 1 });

    expect(guard.result.current.quitPrompt).toBeNull();
    const delivered = allQuitReplies().filter((a) => a.answer === "delivered");
    expect(delivered).toStrictEqual([{ requestId: 9, answer: "delivered", round: 1 }]);
  });

  it("HK-4: a late lower-round prompt is ignored after a higher round was seen", async () => {
    setDocuments([makeDoc("a", true, "A1")]);
    const { result } = await renderGuard();
    await deliver(REQUESTED, { requestId: 9, round: 0 });
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    await deliver(PROMPT, { requestId: 9, round: 0 });

    expect(result.current.quitPrompt).toBeNull();
    expect(allQuitReplies().filter((a) => a.answer === "delivered")).toStrictEqual([]);
  });

  it("HK-7: valid rounds are echoed; every other value gives a reply with no round key", async () => {
    setDocuments([makeDoc("a", false)]);
    await renderGuard();
    const table: Array<[unknown, number | null]> = [
      [undefined, null],
      [0, 0],
      [3, 3],
      [-1, null],
      ["1", null],
      [1.5, null],
      [null, null],
    ];
    for (const [i, [round, echoed]] of table.entries()) {
      const requestId = 9 + i;
      const payload: Record<string, unknown> = { requestId };
      if (round !== undefined) payload.round = round;
      await deliver(REQUESTED, payload);
      const expected =
        echoed === null ? { requestId, answer: "clean" } : { requestId, answer: "clean", round: echoed };
      expect(lastReply(), `round ${String(round)}`).toStrictEqual(expected);
    }
    expect(quitReplies()).toHaveLength(table.length);
  });
});

describe("useQuitGuard — the discard snapshot (WI-8, A3)", () => {
  it("HK-5: discard, then a re-check with no edits answers clean, logging the count", async () => {
    const guard = await discardRound0();
    expect(lastReply()).toStrictEqual({ requestId: 9, answer: "discard", documentIds: ["a"], round: 0 });

    await deliver(REQUESTED, { requestId: 9, round: 1 });

    expect(lastReply()).toStrictEqual({ requestId: 9, answer: "clean", round: 1 });
    expect(checkLogs().at(-1)?.context).toMatchObject({ discardedUnchangedCount: 1 });
    expect(guard.result.current.quitPrompt).toBeNull();
  });

  it("HK-6(i): an edit to the discarded doc answers dirty", async () => {
    await discardRound0();
    await act(async () => {
      useDocumentStore.getState().updateDocumentContent("a", "A-changed");
    });
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    expect(lastReply()).toStrictEqual({ requestId: 9, answer: "dirty", round: 1 });
  });

  it("HK-6(ii): an edit to another background doc answers dirty", async () => {
    await discardRound0();
    await act(async () => {
      useDocumentStore.getState().updateDocumentContent("b", "B-changed");
      useDocumentStore.getState().markDocumentModified("b", true);
    });
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    expect(lastReply()).toStrictEqual({ requestId: 9, answer: "dirty", round: 1 });
  });

  it("HK-8: a snapshot from a cancelled request does not silence a new quit", async () => {
    await discardRound0();
    await deliver(CANCELLED, { requestId: 9 });
    await deliver(REQUESTED, { requestId: 10, round: 0 });
    expect(lastReply()).toStrictEqual({ requestId: 10, answer: "dirty", round: 0 });
  });

  it("HK-9: a second discard refreshes the snapshot", async () => {
    const guard = await discardRound0();
    await act(async () => {
      useDocumentStore.getState().updateDocumentContent("a", "A2");
    });
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    await deliver(PROMPT, { requestId: 9, round: 1 });
    await confirm(guard);
    await deliver(REQUESTED, { requestId: 9, round: 2 });
    expect(lastReply()).toStrictEqual({ requestId: 9, answer: "clean", round: 2 });
  });

  it("HK-16(i): an edit still in the flusher after the discard is not silenced", async () => {
    await discardRound0();
    useMilkdownEditorStore.getState().registerFlusher("a", onceFlusher("a", "A1-typed"));
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    expect(lastReply()).toStrictEqual({ requestId: 9, answer: "dirty", round: 1 });
  });

  it("HK-16(ii): the flush inside confirmQuit is part of the snapshot", async () => {
    setDocuments([makeDoc("a", true, "A1")]);
    const guard = await renderGuard();
    await deliver(REQUESTED, { requestId: 9, round: 0 });
    await deliver(PROMPT, { requestId: 9, round: 0 });
    useMilkdownEditorStore.getState().registerFlusher("a", onceFlusher("a", "A1-typed"));
    await confirm(guard);
    await deliver(REQUESTED, { requestId: 9, round: 1 });

    expect(lastReply()).toStrictEqual({ requestId: 9, answer: "clean", round: 1 });
    expect(checkLogs().at(-1)?.context).toMatchObject({ discardedUnchangedCount: 1 });
  });
});

describe("useQuitGuard — the phase-1 latch (A5, coverage)", () => {
  const failLogs = () =>
    vi
      .mocked(loggingService.logEventSync)
      .mock.calls.map(([entry]) => entry)
      .filter((entry) => entry.event === "app.quit.check" && entry.status === "fail");

  it.each([1, 2, 3, 4])(
    "HK-18: a repeat of an answered round (x%i, doc dirtied in between) is not answered again",
    async (repeats) => {
      setDocuments([makeDoc("a", false, "A0")]);
      await renderGuard();
      await deliver(REQUESTED, { requestId: 5, round: 0 });
      await act(async () => {
        useDocumentStore.getState().updateDocumentContent("a", "A1");
        useDocumentStore.getState().markDocumentModified("a", true);
      });
      for (let i = 0; i < repeats; i += 1) await deliver(REQUESTED, { requestId: 5, round: 0 });

      expect(allQuitReplies()).toStrictEqual([{ requestId: 5, answer: "clean", round: 0 }]);
      expect(checkLogs()).toHaveLength(1);

      // The latch is per round, not per request: the next round is a new question.
      await deliver(REQUESTED, { requestId: 5, round: 1 });
      expect(allQuitReplies()).toStrictEqual([
        { requestId: 5, answer: "clean", round: 0 },
        { requestId: 5, answer: "dirty", round: 1 },
      ]);
      expect(checkLogs()).toHaveLength(2);
    },
  );

  it("HK-19: a lower-round re-check after a higher one is stale; a new request is answered", async () => {
    setDocuments([makeDoc("a", false, "A0")]);
    await renderGuard();
    await deliver(REQUESTED, { requestId: 5, round: 2 });
    await deliver(REQUESTED, { requestId: 5, round: 1 });

    expect(allQuitReplies()).toStrictEqual([{ requestId: 5, answer: "clean", round: 2 }]);
    expect(checkLogs()).toHaveLength(1);

    await deliver(REQUESTED, { requestId: 6, round: 0 });
    expect(allQuitReplies()).toStrictEqual([
      { requestId: 5, answer: "clean", round: 2 },
      { requestId: 6, answer: "clean", round: 0 },
    ]);
    expect(checkLogs()).toHaveLength(2);
  });

  it("HK-20: a null quit-requested payload is logged once as a fail and not answered", async () => {
    setDocuments([makeDoc("a", true, "A1")]);
    await renderGuard();

    await expect(deliver(REQUESTED, null)).resolves.toBeUndefined();

    expect(allQuitReplies()).toStrictEqual([]);
    expect(checkLogs()).toStrictEqual([]);
    const failures = failLogs();
    expect(failures).toHaveLength(1);
    expect(failures[0]!.context).toStrictEqual({ eventName: "app:quit-requested" });
  });
});
