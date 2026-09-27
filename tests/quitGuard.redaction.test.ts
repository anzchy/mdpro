/**
 * ADR-0035 review M-2 — quit-guard redaction against the REAL loggingService.
 *
 * The HK-13 / HK-17 / QH-7 checks mock `loggingService`, so they prove what the
 * hook *hands* the logger, not what reaches disk. Here the logger is real and the
 * only mock is the Tauri boundary: every `invoke("log_event", {payload})` is
 * captured, serialized, and searched for any id, path or content that the
 * scenario put in the store or in an IPC error.
 *
 * Law: no serialized `log_event` payload contains a document id, path or
 * content — while the ids still travel on the `quit_guard_reply` IPC itself
 * (the M-1 `drafted` reply). Each case carries a positive control that the log
 * lines it inspects were actually written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;
type Call = { cmd: string; args: Record<string, unknown> };

const { bus, core } = vi.hoisted(() => ({
  bus: { listeners: new Map<string, Set<Cb>>() },
  core: {
    calls: [] as Call[],
    /** Commands whose next call rejects with the given message. */
    rejectOnce: new Map<string, string>(),
    /** documentId → rejection message for `save_draft`. */
    draftErrors: new Map<string, string>(),
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
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    core.calls.push({ cmd, args: JSON.parse(JSON.stringify(args)) });
    const once = core.rejectOnce.get(cmd);
    if (once !== undefined) {
      core.rejectOnce.delete(cmd);
      throw once;
    }
    if (cmd === "save_draft") {
      const failure = core.draftErrors.get(String(args.documentId));
      if (failure) throw new Error(failure);
    }
    return null;
  }),
}));

import { QUIT_BACKSTOP_WRITE_FAILED, useQuitGuard } from "../src/hooks/useQuitGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { takeDiscardSnapshot } from "../src/utils/quitDiscardSnapshot";
import { runQuitBackstop } from "../src/utils/quitGuardHandlers";

const REQUESTED = "app:quit-requested";
const PROMPT = "app:quit-prompt";
const BACKSTOP = "app:quit-backstop";

function makeDoc(id: string, content: string, path: string): Document {
  return {
    id,
    path,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: true,
    lastSaved: null,
    fileSize: null,
  };
}

type LogPayload = { event: string; level: string; status: string; context?: unknown; error?: string };
const logPayloads = (): LogPayload[] =>
  core.calls
    .filter((c) => c.cmd === "log_event")
    .map((c) => (c.args as { payload: LogPayload }).payload);
const logsOf = (event: string) => logPayloads().filter((p) => p.event === event);
const replies = () => core.calls.filter((c) => c.cmd === "quit_guard_reply").map((c) => c.args);

/** Every secret must be absent from the serialized log_event traffic. */
function expectRedacted(secrets: readonly string[]): void {
  const serialized = JSON.stringify(logPayloads());
  for (const secret of secrets) {
    expect(serialized, `log_event leaked ${JSON.stringify(secret)}`).not.toContain(secret);
    expect(serialized, `log_event leaked escaped ${JSON.stringify(secret)}`).not.toContain(
      JSON.stringify(secret).slice(1, -1),
    );
  }
}

async function flush(n = 8): Promise<void> {
  await act(async () => {
    for (let i = 0; i < n; i += 1) await Promise.resolve();
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.listeners.get(name) ?? [])]) cb({ payload });
  });
  await flush();
}

beforeEach(() => {
  bus.listeners.clear();
  core.calls.length = 0;
  core.rejectOnce.clear();
  core.draftErrors.clear();
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useMilkdownEditorStore.setState({ flushers: {} });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

afterEach(() => {
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("quit-guard logs through the real loggingService (review M-2)", () => {
  it("R-1: discard, edit, re-check, backstop and a lost reply log no id, path or content", async () => {
    const idA = "doc/../x";
    const idB = 'é"q';
    const secrets = [idA, idB, "SECRET-CONTENT", "/Users/x/secret.md", "secret.md"];
    useDocumentStore.setState({
      documents: [
        makeDoc(idA, "# T\nSECRET-CONTENT", "/Users/x/secret.md"),
        makeDoc(idB, "SECRET-CONTENT two", "/Users/x/secret.md"),
      ],
      activeDocumentId: idA,
    });
    const { result } = renderHook(() => useQuitGuard());
    await flush();

    await deliver(REQUESTED, { requestId: 9, round: 0 });
    await deliver(PROMPT, { requestId: 9, round: 0 });
    await act(async () => result.current.confirmQuit());
    await flush();
    await act(async () => {
      useDocumentStore.getState().updateDocumentContent(idB, "SECRET-CONTENT edited");
    });
    await deliver(REQUESTED, { requestId: 9, round: 1 });
    // Rust refuses the drafted reply and (hypothetically) quotes the id it named;
    // the service scrubs every id it sent. Paths never reach a quit reply error.
    core.rejectOnce.set("quit_guard_reply", `invalid document id ${idB}`);
    await deliver(BACKSTOP, { requestId: 9, round: 1 });
    await settle();

    // Positive controls: each line was really written through log_event.
    expect(logsOf("app.quit.check").length).toBeGreaterThan(0);
    expect(logsOf("app.quit.backstop")).toHaveLength(1);
    expect(logsOf("app.quit.reply")).toHaveLength(1);
    expect(logsOf("app.quit.send")).toHaveLength(1);
    expect(logsOf("ui.dialog.confirm")).toHaveLength(1);
    // The ids do travel on the reply IPC — that is where they belong.
    expect(replies().at(-1)).toMatchObject({ answer: "drafted", documentIds: [idB] });

    expectRedacted(secrets);
  });

  it("R-2: a rejected save_draft quoting path, id and content logs only the fixed error", async () => {
    const secrets = ["doc-7f3a", "/Users/x/secret-plan.md", "secret-plan", "SECRET-CONTENT"];
    useDocumentStore.setState({
      documents: [
        makeDoc("doc-7f3a", "# T\nSECRET-CONTENT", "/Users/x/secret-plan.md"),
        makeDoc("doc-b", "B", "/tmp/b.md"),
      ],
      activeDocumentId: "doc-7f3a",
    });
    core.draftErrors.set(
      "doc-7f3a",
      "failed to write /Users/x/secret-plan.md for doc-7f3a: SECRET-CONTENT",
    );
    renderHook(() => useQuitGuard());
    await flush();

    await deliver(BACKSTOP, { requestId: 9, round: 1 });

    const backstop = logsOf("app.quit.backstop");
    expect(backstop).toHaveLength(1);
    expect(backstop[0]).toMatchObject({ level: "warn", status: "fail" });
    expect(backstop[0]!.error).toBe(QUIT_BACKSTOP_WRITE_FAILED);
    expectRedacted([...secrets, "doc-b", "/tmp/b.md"]);
  });

  it("R-3: runQuitBackstop hands the ids to the reply and none to the log", async () => {
    useDocumentStore.setState({
      documents: [makeDoc("doc-sec-1", "SECRET-CONTENT new", "/Users/x/secret.md")],
      activeDocumentId: "doc-sec-1",
    });
    const snapshot = takeDiscardSnapshot(
      7,
      [{ id: "doc-sec-1", content: "SECRET-CONTENT old" }],
      ["doc-sec-1"],
    );
    const reply = vi.fn();

    await runQuitBackstop({ requestId: 7 }, snapshot, reply);

    expect(reply.mock.calls).toStrictEqual([
      [{ draftedCount: 1, failedCount: 0, flushFailed: false }, ["doc-sec-1"]],
    ]);
    expect(logsOf("app.quit.backstop")).toHaveLength(1);
    expectRedacted(["doc-sec-1", "SECRET-CONTENT", "/Users/x/secret.md"]);
  });
});
