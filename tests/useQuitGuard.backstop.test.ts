/**
 * ADR-0035 WI-8 — `useQuitGuard` answers `app:quit-backstop`.
 *
 * Law (idempotence, ordering, redaction):
 * - Per `requestId`, the writer runs at most once and at most one `drafted`
 *   reply is sent.
 * - That reply is sent strictly after every `save_draft` has settled, carrying
 *   exactly the writer's counts.
 * - No log carries a document id, path or content — even when a `save_draft`
 *   error message contains them.
 *
 * Mocked: `@tauri-apps/api/{webviewWindow,core}` and `loggingService` only. The
 * stores and the backstop writer are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;
type Call = { cmd: string; args: Record<string, unknown> };

const { bus, core } = vi.hoisted(() => ({
  bus: { listeners: new Map<string, Set<Cb>>() },
  core: {
    calls: [] as Call[],
    /** Commands whose next call rejects (once each). */
    rejectOnce: new Set<string>(),
    /** When set, `save_draft` returns a promise the test settles. */
    deferDrafts: { value: false },
    pendingDrafts: [] as Array<{ resolve: () => void }>,
    /** documentId → rejection for `save_draft`. */
    draftErrors: new Map<string, Error>(),
  },
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

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.calls.push({ cmd, args: { ...args } });
    if (core.rejectOnce.delete(cmd)) throw new Error(`${cmd} rejected`);
    if (cmd !== "save_draft") return null;
    const failure = core.draftErrors.get(String(args.documentId));
    if (failure) throw failure;
    if (!core.deferDrafts.value) return null;
    return new Promise<null>((resolve) => {
      core.pendingDrafts.push({ resolve: () => resolve(null) });
    });
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
import { QUIT_BACKSTOP_WRITE_FAILED, useQuitGuard } from "../src/hooks/useQuitGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";

const REQUESTED = "app:quit-requested";
const PROMPT = "app:quit-prompt";
const BACKSTOP = "app:quit-backstop";
const BACKSTOP_KEYS = ["draftedCount", "failedCount", "flushFailed", "requestId", "round"];
const CHECK_KEYS = [
  "answer",
  "dirtyCount",
  "discardedUnchangedCount",
  "flushFailed",
  "phase",
  "requestId",
];

function makeDoc(id: string, isModified: boolean, content = "", path = `/tmp/${id}.md`): Document {
  return {
    id,
    path,
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

const drafts = () => core.calls.filter((c) => c.cmd === "save_draft");
const replies = () => core.calls.filter((c) => c.cmd === "quit_guard_reply").map((c) => c.args);
const draftedReplies = () => replies().filter((a) => a.answer === "drafted");
const logEntries = () => vi.mocked(loggingService.logEventSync).mock.calls.map(([e]) => e);
const logsOf = (event: string) => logEntries().filter((e) => e.event === event);

async function flush(n = 8): Promise<void> {
  await act(async () => {
    for (let i = 0; i < n; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.listeners.get(name) ?? [])]) cb({ payload });
  });
  await flush();
}

async function renderGuard() {
  const rendered = renderHook(() => useQuitGuard());
  await flush();
  return rendered;
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => void unhandled.push(reason);

beforeEach(() => {
  bus.listeners.clear();
  core.calls.length = 0;
  core.rejectOnce.clear();
  core.deferDrafts.value = false;
  core.pendingDrafts.length = 0;
  core.draftErrors.clear();
  unhandled.length = 0;
  vi.clearAllMocks();
  useMilkdownEditorStore.setState({ flushers: {} });
  setDocuments([]);
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
});

describe("useQuitGuard — the backstop (WI-8)", () => {
  it("HK-10: drafted is sent only after every save_draft settled, with the writer's counts", async () => {
    setDocuments([makeDoc("a", true, "A"), makeDoc("b", true, "B")]);
    core.deferDrafts.value = true;
    await renderGuard();

    await deliver(BACKSTOP, { requestId: 9, round: 1 });
    expect(drafts()).toHaveLength(2);
    expect(draftedReplies()).toStrictEqual([]);

    await act(async () => core.pendingDrafts[0]!.resolve());
    await flush();
    expect(draftedReplies()).toStrictEqual([]);

    await act(async () => core.pendingDrafts[1]!.resolve());
    await flush();
    expect(draftedReplies()).toStrictEqual([
      { requestId: 9, answer: "drafted", draftedCount: 2, failedCount: 0, round: 1 },
    ]);
  });

  it("HK-11: a repeated backstop for the same request writes and replies once", async () => {
    setDocuments([makeDoc("a", true, "A"), makeDoc("b", true, "B")]);
    core.deferDrafts.value = true;
    await renderGuard();

    await deliver(BACKSTOP, { requestId: 9, round: 1 });
    await deliver(BACKSTOP, { requestId: 9, round: 1 });
    for (const pending of core.pendingDrafts.splice(0)) pending.resolve();
    await flush();
    await deliver(BACKSTOP, { requestId: 9, round: 1 });
    for (const pending of core.pendingDrafts.splice(0)) pending.resolve();
    await flush();

    expect(drafts()).toHaveLength(2);
    expect(draftedReplies()).toHaveLength(1);
  });

  it("HK-12: a malformed backstop payload is logged and not answered", async () => {
    setDocuments([makeDoc("a", true, "A")]);
    await renderGuard();

    await deliver(BACKSTOP, { requestId: "9" });
    await deliver(BACKSTOP, {});

    expect(drafts()).toStrictEqual([]);
    expect(replies()).toStrictEqual([]);
    // ADR-0035 review L-2/L-7: the malformed-payload line now carries its own
    // subscription's event name, so the either-name filter is narrowed to one.
    const failures = logEntries().filter((e) => e.status === "fail");
    expect(failures.map((e) => [e.event, e.context])).toStrictEqual([
      ["app.quit.backstop", { eventName: BACKSTOP }],
      ["app.quit.backstop", { eventName: BACKSTOP }],
    ]);
  });

  it("HK-13: backstop and check logs carry exactly their counts-only key sets", async () => {
    const hostile = [
      makeDoc("doc/../x", true, "# T\nSECRET-CONTENT", "/Users/x/secret.md"),
      makeDoc('é"q', true, "SECRET-CONTENT two", "/Users/x/secret.md"),
    ];
    setDocuments(hostile);
    const { result } = await renderGuard();

    await deliver(REQUESTED, { requestId: 9, round: 0 });
    await deliver(PROMPT, { requestId: 9, round: 0 });
    await act(async () => result.current.confirmQuit());
    await flush();
    await act(async () => {
      useDocumentStore.getState().updateDocumentContent('é"q', "SECRET-CONTENT edited");
    });
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    await deliver(BACKSTOP, { requestId: 9, round: 1 });

    const backstop = logsOf("app.quit.backstop");
    expect(backstop).toHaveLength(1);
    expect(Object.keys(backstop[0]!.context ?? {}).sort()).toStrictEqual(BACKSTOP_KEYS);
    expect(backstop[0]!.context).toMatchObject({ draftedCount: 1, failedCount: 0 });
    const checks = logsOf("app.quit.check");
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(Object.keys(check.context ?? {}).sort()).toStrictEqual(CHECK_KEYS);
    }
    const everything = JSON.stringify([
      vi.mocked(loggingService.logEventSync).mock.calls,
      vi.mocked(loggingService.logDialogAction).mock.calls,
    ]);
    for (const secret of ["doc/../x", 'é\\"q', "SECRET-CONTENT", "/Users/x/secret.md"]) {
      expect(everything, secret).not.toContain(secret);
    }
  });

  it("HK-14: a rejected drafted reply is contained and the hook state is unchanged", async () => {
    setDocuments([makeDoc("a", true, "A")]);
    const { result } = await renderGuard();
    core.rejectOnce.add("quit_guard_reply");

    await deliver(BACKSTOP, { requestId: 9, round: 1 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(unhandled).toStrictEqual([]);
    expect(draftedReplies()).toHaveLength(1);
    expect(logsOf("app.quit.reply").filter((e) => e.status === "fail")).toHaveLength(1);
    expect(result.current.quitPrompt).toBeNull();
  });

  it("HK-15: the backstop skips documents discarded and unchanged since", async () => {
    setDocuments([makeDoc("a", true, "A1")]);
    const { result } = await renderGuard();
    await deliver(REQUESTED, { requestId: 9, round: 0 });
    await deliver(PROMPT, { requestId: 9, round: 0 });
    await act(async () => result.current.confirmQuit());
    await flush();
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    expect(replies().at(-1)).toStrictEqual({ requestId: 9, answer: "clean", round: 1 });

    await deliver(BACKSTOP, { requestId: 9, round: 1 });

    expect(drafts()).toStrictEqual([]);
    expect(draftedReplies()).toStrictEqual([
      { requestId: 9, answer: "drafted", draftedCount: 0, failedCount: 0, round: 1 },
    ]);
  });

  it("HK-17: a rejected backstop write is redacted from every log", async () => {
    setDocuments([
      makeDoc("doc-7f3a", true, "# T\nSECRET-CONTENT", "/Users/x/secret-plan.md"),
      makeDoc("doc-b", true, "B"),
    ]);
    core.draftErrors.set(
      "doc-7f3a",
      new Error("failed to write /Users/x/secret-plan.md for doc-7f3a: SECRET-CONTENT"),
    );
    await renderGuard();

    await deliver(BACKSTOP, { requestId: 9, round: 1 });

    expect(draftedReplies()).toStrictEqual([
      { requestId: 9, answer: "drafted", draftedCount: 1, failedCount: 1, round: 1 },
    ]);
    const everything = JSON.stringify(vi.mocked(loggingService.logEventSync).mock.calls);
    for (const secret of ["doc-7f3a", "/Users/x/secret-plan.md", "secret-plan", "SECRET-CONTENT"]) {
      expect(everything, secret).not.toContain(secret);
    }
    const backstop = logsOf("app.quit.backstop");
    expect(backstop).toHaveLength(1);
    expect(Object.keys(backstop[0]!.context ?? {}).sort()).toStrictEqual(BACKSTOP_KEYS);
    const { error } = backstop[0]!;
    expect(typeof QUIT_BACKSTOP_WRITE_FAILED).toBe("string");
    // ADR-0035 review L-6: a failed write always sets the error, so `undefined`
    // is no longer an acceptable answer here.
    expect(error).toBe(QUIT_BACKSTOP_WRITE_FAILED);
  });
});

describe("useQuitGuard — a discarded document edited before the backstop (review M-1)", () => {
  async function discardThenEdit(result: { current: { confirmQuit: () => void } }) {
    await deliver(REQUESTED, { requestId: 9, round: 0 });
    await deliver(PROMPT, { requestId: 9, round: 0 });
    await act(async () => result.current.confirmQuit());
    await flush();
    await act(async () => {
      useDocumentStore.getState().updateDocumentContent("a", "A1 edited after discard");
    });
  }

  it("HK-22: the drafted reply names the discarded doc it redrafted after an edit", async () => {
    setDocuments([makeDoc("a", true, "A0"), makeDoc("b", true, "B0")]);
    const { result } = await renderGuard();
    await discardThenEdit(result);

    await deliver(BACKSTOP, { requestId: 9, round: 1 });

    expect(drafts().map((c) => c.args.documentId)).toStrictEqual(["a"]);
    expect(draftedReplies()).toStrictEqual([
      {
        requestId: 9,
        answer: "drafted",
        draftedCount: 1,
        failedCount: 0,
        round: 1,
        documentIds: ["a"],
      },
    ]);
    const backstop = logsOf("app.quit.backstop");
    expect(Object.keys(backstop[0]!.context ?? {}).sort()).toStrictEqual(BACKSTOP_KEYS);
  });

  it("HK-22b: a redraft that failed is not named, so the discard still deletes it", async () => {
    setDocuments([makeDoc("a", true, "A0")]);
    core.draftErrors.set("a", new Error("disk full"));
    const { result } = await renderGuard();
    await discardThenEdit(result);

    await deliver(BACKSTOP, { requestId: 9, round: 1 });

    expect(draftedReplies()).toStrictEqual([
      { requestId: 9, answer: "drafted", draftedCount: 0, failedCount: 1, round: 1 },
    ]);
  });
});

describe("useQuitGuard — logging of a lost reply and a malformed payload (review L-2, L-5)", () => {
  it("X-3: a rejected reply logs one counts-only warn with a fixed error", async () => {
    setDocuments([makeDoc("doc-secret-1", true, "SECRET-CONTENT", "/Users/x/secret.md")]);
    await renderGuard();
    core.rejectOnce.add("quit_guard_reply");

    await deliver(BACKSTOP, { requestId: 9, round: 1 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(unhandled).toStrictEqual([]);
    const sends = logsOf("app.quit.send");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      level: "warn",
      status: "fail",
      error: "quit reply was not delivered",
    });
    expect(sends[0]!.context).toStrictEqual({ requestId: 9, round: 1, answer: "drafted" });
    expect(JSON.stringify(sends)).not.toMatch(/doc-secret-1|SECRET-CONTENT|secret\.md/);
  });

  it("X-3b: a round-less reply that is lost logs round null", async () => {
    setDocuments([makeDoc("a", false, "A")]);
    await renderGuard();
    core.rejectOnce.add("quit_guard_reply");

    await deliver(REQUESTED, { requestId: 4 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(logsOf("app.quit.send").map((e) => e.context)).toStrictEqual([
      { requestId: 4, round: null, answer: "clean" },
    ]);
  });

  it("HK-23: each subscription logs a malformed payload under its own event", async () => {
    await renderGuard();

    await deliver(REQUESTED, {});
    await deliver(PROMPT, {});
    await deliver("app:quit-cancelled", {});
    await deliver(BACKSTOP, {});

    const failures = logEntries().filter((e) => e.status === "fail");
    expect(failures.map((e) => [e.event, e.context])).toStrictEqual([
      ["app.quit.check", { eventName: REQUESTED }],
      ["app.quit.prompt", { eventName: PROMPT }],
      ["app.quit.cancel", { eventName: "app:quit-cancelled" }],
      ["app.quit.backstop", { eventName: BACKSTOP }],
    ]);
    expect(replies()).toStrictEqual([]);
  });
});

describe("useQuitGuard — a round-less backstop (A5, coverage)", () => {
  it("HK-21: a backstop with no round gets exactly one drafted reply, with no round key", async () => {
    setDocuments([makeDoc("a", true, "A")]);
    await renderGuard();

    await deliver(BACKSTOP, { requestId: 9 });

    expect(draftedReplies()).toStrictEqual([
      { requestId: 9, answer: "drafted", draftedCount: 1, failedCount: 0 },
    ]);
    const backstop = logsOf("app.quit.backstop");
    expect(backstop).toHaveLength(1);
    expect(backstop[0]!.context?.round).toBeNull();
  });
});
