/**
 * D16 WI-7 — `useQuitGuard`, the webview half of the ADR-0025 quit protocol.
 *
 * The fake event bus is `Map<string, Set<cb>>` on purpose: the single-slot map
 * used elsewhere cannot see a leaked second listener, and a second listener here
 * means a double reply to a coordinator that treats the second one as out of
 * phase.
 *
 * The fake `invoke` records `{cmd, args}`, which IS the output of this hook —
 * everything it does crosses that boundary. The stores are real; only
 * `@tauri-apps/api/{event,core}` and `loggingService` are mocked.
 *
 * Law:
 * - at most one phase-1 reply per `app:quit-requested`, and at most one phase-2
 *   reply (`discard` / `cancel` / `clean`) per `app:quit-prompt`;
 * - every reply echoes the event's `requestId`;
 * - `quitPrompt` is non-null only between a prompt for request r and the first
 *   of `confirmQuit`, `cancelQuit` or `app:quit-cancelled{r}`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;
/** One registration: which window it belongs to, and its handler. */
type Entry = { target: string; cb: Cb };

/**
 * `"*"` is the global `listen` — it hears every emit, whoever it was addressed
 * to. A per-webview `listen` registers under that window's own label and hears
 * only what was emitted to it (plus `emit_all`). Modelling the difference is
 * what lets a test tell the two subscriptions apart.
 */
const GLOBAL = "*";
const THIS_WINDOW = "main";
const OTHER_WINDOW = "second";

const { bus, core } = vi.hoisted(() => ({
  bus: {
    listeners: new Map<string, Set<{ target: string; cb: Cb }>>(),
    pendingResolvers: [] as Array<() => void>,
    deferred: { value: false },
    currentLabel: { value: "main" },
  },
  core: {
    replies: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
    rejectOnce: { value: null as string | null },
  },
}));

/** Register `cb` for `name` under `target`, honouring the deferred-resolve mode. */
function register(name: string, target: string, cb: Cb): Promise<() => void> {
  const set = bus.listeners.get(name) ?? new Set<Entry>();
  const entry: Entry = { target, cb };
  set.add(entry);
  bus.listeners.set(name, set);
  const dispose = () => {
    set.delete(entry);
  };
  if (!bus.deferred.value) return Promise.resolve(dispose);
  return new Promise<() => void>((resolve) => {
    bus.pendingResolvers.push(() => resolve(dispose));
  });
}

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: Cb) => register(name, "*", cb)),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: bus.currentLabel.value,
    listen: (name: string, cb: Cb) => register(name, bus.currentLabel.value, cb),
  })),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.replies.push({ cmd, args: { ...args } });
    const failure = core.rejectOnce.value;
    if (failure !== null) {
      core.rejectOnce.value = null;
      throw failure;
    }
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
  useDocumentStore.setState({
    documents: docs,
    activeDocumentId: docs[0]?.id ?? null,
  });
}

/** Every recorded quit reply, in order. Other commands are not this hook's output. */
const allQuitReplies = () => core.replies.filter((r) => r.cmd === "quit_guard_reply");

/**
 * The *decisions* this window sent. `delivered` is excluded on purpose: it is a
 * transport ack (ADR-0029 §1), not an answer, and the phase-1/phase-2 laws this
 * file pins are about answers. The cases below that are about the ack itself use
 * `allQuitReplies`.
 */
const quitReplies = () => allQuitReplies().filter((r) => r.args.answer !== "delivered");

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function deliver(
  name: string,
  payload: unknown,
  target: string = THIS_WINDOW,
): Promise<void> {
  await act(async () => {
    const entries = [...(bus.listeners.get(name) ?? [])].filter(
      (e) => e.target === GLOBAL || e.target === target,
    );
    for (const { cb } of entries) cb({ payload });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderGuard() {
  const rendered = renderHook(() => useQuitGuard());
  await settle();
  return rendered;
}

beforeEach(() => {
  bus.listeners.clear();
  bus.pendingResolvers.length = 0;
  bus.deferred.value = false;
  bus.currentLabel.value = THIS_WINDOW;
  core.replies.length = 0;
  core.rejectOnce.value = null;
  vi.clearAllMocks();
  useMilkdownEditorStore.setState({ flushers: {} });
  setDocuments([]);
});

afterEach(() => {
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("useQuitGuard — phase 1 (WI7-Q1, Q7)", () => {
  it("WI7-Q1: a clean window replies `clean` and mounts no dialog", async () => {
    setDocuments([makeDoc("a", false), makeDoc("b", false)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 7 });

    expect(quitReplies()).toEqual([
      { cmd: "quit_guard_reply", args: { requestId: 7, answer: "clean" } },
    ]);
    expect(result.current.quitPrompt).toBeNull();
  });

  it("WI7-Q7: a failed flush answers `dirty` even though no document is modified", async () => {
    setDocuments([makeDoc("a", false)]);
    useMilkdownEditorStore.getState().registerFlusher("a", () => ({ status: "failed" }));
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 6 });

    expect(quitReplies()[0]?.args.answer).toBe("dirty");
    expect(result.current.quitPrompt).toBeNull();
  });
});

describe("useQuitGuard — phase 2 (WI7-Q2, Q3, Q6)", () => {
  it("WI7-Q2: dirty, prompt opens the dialog, confirm discards exactly the dirty ids", async () => {
    setDocuments([makeDoc("a", false), makeDoc("b", true), makeDoc("c", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 9 });
    expect(result.current.quitPrompt).toBeNull();

    await deliver(PROMPT, { requestId: 9 });
    expect(result.current.quitPrompt).toEqual({ requestId: 9 });

    await act(async () => {
      result.current.confirmQuit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(quitReplies()).toEqual([
      { cmd: "quit_guard_reply", args: { requestId: 9, answer: "dirty" } },
      {
        cmd: "quit_guard_reply",
        args: { requestId: 9, answer: "discard", documentIds: ["b", "c"] },
      },
    ]);
    expect(result.current.quitPrompt).toBeNull();
  });

  it("WI7-Q3: the discarded ids are read at confirm time, in store order", async () => {
    setDocuments([makeDoc("a", false), makeDoc("b", true), makeDoc("c", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 9 });
    await deliver(PROMPT, { requestId: 9 });

    // A document dirtied after the prompt must still have its draft discarded,
    // otherwise it resurrects on the next launch.
    await act(async () => {
      useDocumentStore.getState().markDocumentModified("a", true);
    });

    await act(async () => {
      result.current.confirmQuit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(quitReplies()[1]?.args.documentIds).toEqual(["a", "b", "c"]);
  });

  it("WI7-Q6: a document saved between `dirty` and the prompt answers `clean`, no dialog", async () => {
    setDocuments([makeDoc("b", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 4 });
    expect(quitReplies()[0]?.args.answer).toBe("dirty");
    expect(result.current.quitPrompt).toBeNull();

    await act(async () => {
      useDocumentStore.getState().markDocumentModified("b", false);
    });

    await deliver(PROMPT, { requestId: 4 });

    expect(quitReplies()[1]).toEqual({
      cmd: "quit_guard_reply",
      args: { requestId: 4, answer: "clean" },
    });
    expect(result.current.quitPrompt).toBeNull();
  });

  it("cancelQuit replies `cancel` with no documentIds", async () => {
    setDocuments([makeDoc("b", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 2 });
    await deliver(PROMPT, { requestId: 2 });
    await act(async () => {
      result.current.cancelQuit();
      await Promise.resolve();
    });

    expect(quitReplies()[1]).toEqual({
      cmd: "quit_guard_reply",
      args: { requestId: 2, answer: "cancel" },
    });
    expect(result.current.quitPrompt).toBeNull();
  });
});

describe("useQuitGuard — the cancelled event (WI7-Q5)", () => {
  it("WI7-Q5: a stale requestId leaves the dialog open; the matching one closes it", async () => {
    setDocuments([makeDoc("b", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 3 });
    await deliver(PROMPT, { requestId: 3 });
    expect(result.current.quitPrompt).toEqual({ requestId: 3 });

    await deliver(CANCELLED, { requestId: 2 });
    expect(result.current.quitPrompt).toEqual({ requestId: 3 });

    await deliver(CANCELLED, { requestId: 3 });
    expect(result.current.quitPrompt).toBeNull();

    // A cancelled quit is the coordinator's own decision: the window answers nothing.
    expect(quitReplies()).toHaveLength(1);
  });
});

describe("useQuitGuard — exactly one phase-2 reply per prompt (WI7-Q4)", () => {
  const ACTIONS = ["confirm", "cancel", "cancelled5", "cancelled4", "prompt5"] as const;
  type Action = (typeof ACTIONS)[number];

  const sequences: Action[][] = [];
  for (const a of ACTIONS) {
    sequences.push([a]);
    for (const b of ACTIONS) {
      sequences.push([a, b]);
      for (const c of ACTIONS) sequences.push([a, b, c]);
    }
  }

  it(
    "every sequence of length <= 3 sends at most one phase-2 reply, always for request 5",
    async () => {
      expect(sequences).toHaveLength(5 + 25 + 125);
      let exactlyOneSeen = 0;

      for (const sequence of sequences) {
        bus.listeners.clear();
        core.replies.length = 0;
        useMilkdownEditorStore.setState({ flushers: {} });
        setDocuments([makeDoc("b", true), makeDoc("c", true)]);

        const { result, unmount } = await renderGuard();
        await deliver(REQUESTED, { requestId: 5 });
        await deliver(PROMPT, { requestId: 5 });
        expect(quitReplies()).toHaveLength(1);

        for (const action of sequence) {
          const before = quitReplies().length;
          const hadReplied = before > 1;

          if (action === "confirm") {
            await act(async () => {
              result.current.confirmQuit();
              await Promise.resolve();
              await Promise.resolve();
            });
          } else if (action === "cancel") {
            await act(async () => {
              result.current.cancelQuit();
              await Promise.resolve();
              await Promise.resolve();
            });
          } else if (action === "cancelled5") {
            await deliver(CANCELLED, { requestId: 5 });
          } else if (action === "cancelled4") {
            await deliver(CANCELLED, { requestId: 4 });
          } else {
            await deliver(PROMPT, { requestId: 5 });
          }

          const after = quitReplies().length;
          // A repeat prompt after the window already answered must not reply
          // again and must not reopen the dialog.
          if (action === "prompt5" && hadReplied) {
            expect(after).toBe(before);
            expect(result.current.quitPrompt).toBeNull();
          }
          if (action === "confirm" || action === "cancel" || action === "cancelled5") {
            expect(result.current.quitPrompt).toBeNull();
          }
          if (after > 1) {
            expect(result.current.quitPrompt).toBeNull();
          }
        }

        const replies = quitReplies();
        const phase2 = replies.slice(1);
        expect(phase2.length).toBeLessThanOrEqual(1);
        for (const reply of replies) expect(reply.args.requestId).toBe(5);
        if (phase2.length === 1) exactlyOneSeen += 1;

        unmount();
      }

      // Non-vacuity: the enumeration really did exercise the reply path.
      expect(exactlyOneSeen).toBeGreaterThan(0);
    },
    60_000,
  );
});

describe("useQuitGuard — failure and lifecycle (WI7-Q8, Q9)", () => {
  it("WI7-Q8: a rejected reply is logged, not thrown, and the user's choice stands", async () => {
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      setDocuments([makeDoc("b", true)]);
      const { result } = await renderGuard();

      await deliver(REQUESTED, { requestId: 8 });
      core.rejectOnce.value = "stale request";

      await deliver(PROMPT, { requestId: 8 });
      await act(async () => {
        result.current.confirmQuit();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(unhandled).toBe(0);
      expect(result.current.quitPrompt).toBeNull();

      const failures = vi
        .mocked(loggingService.logEventSync)
        .mock.calls.map(([entry]) => entry)
        .filter((entry) => entry.status === "fail");
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some((entry) => entry.event.startsWith("app.quit."))).toBe(true);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("WI7-Q9: unmounting before the listeners resolve leaves zero listeners on the bus", async () => {
    setDocuments([makeDoc("b", true)]);
    bus.deferred.value = true;

    const { unmount } = renderHook(() => useQuitGuard());
    unmount();

    await act(async () => {
      for (const resolve of bus.pendingResolvers) resolve();
      bus.pendingResolvers.length = 0;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    for (const name of [REQUESTED, PROMPT, CANCELLED]) {
      expect(bus.listeners.get(name)?.size ?? 0).toBe(0);
    }

    await deliver(REQUESTED, { requestId: 1 });
    expect(quitReplies()).toHaveLength(0);
  });
});

describe("useQuitGuard — logging (WI7-Q10)", () => {
  it("WI7-Q10: logs carry an answer and a count, never document content", async () => {
    setDocuments([
      makeDoc("a", false, "TOP-SECRET clean"),
      makeDoc("b", true, "TOP-SECRET one"),
      makeDoc("c", true, "TOP-SECRET two"),
    ]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 9 });
    await deliver(PROMPT, { requestId: 9 });
    await act(async () => {
      result.current.confirmQuit();
      await Promise.resolve();
      await Promise.resolve();
    });

    const checks = vi
      .mocked(loggingService.logEventSync)
      .mock.calls.map(([entry]) => entry)
      .filter((entry) => entry.event === "app.quit.check");
    expect(checks.length).toBeGreaterThan(0);
    expect(checks[0]?.context).toMatchObject({ answer: "dirty", dirtyCount: 2 });

    // `logDialogAction(id, "success", …)` is the ui.dialog.confirm event.
    const dialogCalls = vi.mocked(loggingService.logDialogAction).mock.calls;
    expect(dialogCalls.length).toBeGreaterThan(0);
    const [, status, context] = dialogCalls[dialogCalls.length - 1]!;
    expect(status).toBe("success");
    expect(context).toMatchObject({ target: "quit" });

    const everything = JSON.stringify([
      vi.mocked(loggingService.logEventSync).mock.calls,
      dialogCalls,
    ]);
    expect(everything).not.toContain("TOP-SECRET");
  });

  it("WI7-Q10: cancelling logs the cancel dialog action with the quit target", async () => {
    setDocuments([makeDoc("b", true, "TOP-SECRET")]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 12 });
    await deliver(PROMPT, { requestId: 12 });
    await act(async () => {
      result.current.cancelQuit();
      await Promise.resolve();
    });

    const dialogCalls = vi.mocked(loggingService.logDialogAction).mock.calls;
    const [, status, context] = dialogCalls[dialogCalls.length - 1]!;
    expect(status).toBe("cancel");
    expect(context).toMatchObject({ target: "quit" });
    expect(JSON.stringify(dialogCalls)).not.toContain("TOP-SECRET");
  });
});

/**
 * ADR-0029 §1: the prompt's deadline bounds the *delivery* of the dialog, not
 * the user's reading of it. The ack is what separates the two — until it
 * arrives, the coordinator is timing a webview; after it, it is timing nobody.
 */
describe("useQuitGuard — the delivery ack (BLOCK1-T13..T15)", () => {
  it("T13: a raised dialog acks delivery immediately, for that request", async () => {
    setDocuments([makeDoc("b", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 21 });
    await deliver(PROMPT, { requestId: 21 });

    expect(result.current.quitPrompt).toEqual({ requestId: 21 });
    expect(allQuitReplies()).toEqual([
      { cmd: "quit_guard_reply", args: { requestId: 21, answer: "dirty" } },
      { cmd: "quit_guard_reply", args: { requestId: 21, answer: "delivered" } },
    ]);
  });

  it("T14: the `clean` fast path answers, and does not ack a dialog it never raised", async () => {
    setDocuments([makeDoc("b", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 22 });
    await act(async () => {
      useDocumentStore.getState().markDocumentModified("b", false);
    });
    await deliver(PROMPT, { requestId: 22 });

    // No dialog was drawn, so there is nothing whose delivery to confirm — and
    // the answer itself already ends the request for this window.
    expect(result.current.quitPrompt).toBeNull();
    expect(allQuitReplies()).toEqual([
      { cmd: "quit_guard_reply", args: { requestId: 22, answer: "dirty" } },
      { cmd: "quit_guard_reply", args: { requestId: 22, answer: "clean" } },
    ]);
  });

  it("T15: a repeat prompt for an already-answered request acks nothing", async () => {
    setDocuments([makeDoc("b", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 23 });
    await deliver(PROMPT, { requestId: 23 });
    await act(async () => {
      result.current.cancelQuit();
      await Promise.resolve();
    });

    const before = allQuitReplies().length;
    await deliver(PROMPT, { requestId: 23 });

    expect(allQuitReplies()).toHaveLength(before);
    expect(result.current.quitPrompt).toBeNull();
  });
});

/**
 * Device evidence (2026-09-23): one `app.quit.prompt{windowLabel:"main"}` raised
 * two dialogs and produced two `app.quit.check{phase:"prompt"}` lines, because
 * the global `listen` hears events addressed to any window. The per-window
 * `answeredRequestRef` latch cannot see the other window, so nothing downstream
 * can undo it — the subscription itself has to be per-webview.
 */
describe("useQuitGuard — a prompt is addressed to one window (BLOCK1-T16)", () => {
  it("T16: a prompt for another window raises no dialog here and sends no reply", async () => {
    setDocuments([makeDoc("b", true)]);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 31 });
    expect(quitReplies()).toHaveLength(1);

    await deliver(PROMPT, { requestId: 31 }, OTHER_WINDOW);

    expect(result.current.quitPrompt).toBeNull();
    expect(allQuitReplies()).toEqual([
      { cmd: "quit_guard_reply", args: { requestId: 31, answer: "dirty" } },
    ]);

    // The window is not deaf: its own prompt still works.
    await deliver(PROMPT, { requestId: 31 }, THIS_WINDOW);
    expect(result.current.quitPrompt).toEqual({ requestId: 31 });
  });

  it("T16b: `app:quit-requested` still reaches this window, however it is emitted", async () => {
    // Phase 1 is an `emit_all`; only the prompt is addressed. A per-webview
    // subscription must still hear the broadcast.
    setDocuments([makeDoc("a", false)]);
    await renderGuard();

    await deliver(REQUESTED, { requestId: 32 }, THIS_WINDOW);

    expect(quitReplies()).toEqual([
      { cmd: "quit_guard_reply", args: { requestId: 32, answer: "clean" } },
    ]);
  });
});
