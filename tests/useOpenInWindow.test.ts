/**
 * D29 / ADR-0033 WI-5 — `useOpenInWindow`, the per-webview `file:open-in-window` listener.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260924-131525.md` § WI-5 (revision 3).
 *
 * Law: focusing reads and writes nothing. For any store and any target present in it,
 * the only change an event makes is the active id in the two stores; documents and the
 * rest of `editorStore` stay deep-equal, and there is zero I/O. The store is read at
 * event time, not at subscription time.
 *
 * Mock boundary: `@tauri-apps/api/{webviewWindow,core,event,window}` and the
 * `loggingService` sink. Every store, `useDocument().openPathOutcome` and the
 * ADR-0028 guard are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { bus, invokeMock, eventListen, sink } = vi.hoisted(() => ({
  bus: {
    listeners: new Map<string, Set<Cb>>(),
    subscribes: [] as string[],
    disposes: { count: 0 },
    mode: { value: "resolve" as "resolve" | "defer" | "reject" },
    pending: [] as Array<() => void>,
  },
  invokeMock: vi.fn(),
  eventListen: vi.fn(async () => () => {}),
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
  },
}));

function register(name: string, cb: Cb): Promise<() => void> {
  bus.subscribes.push(name);
  return new Promise((resolve, reject) => {
    const settle = () => {
      if (bus.mode.value === "reject") return reject(new Error("listen failed"));
      const set = bus.listeners.get(name) ?? new Set<Cb>();
      set.add(cb);
      bus.listeners.set(name, set);
      resolve(() => {
        bus.disposes.count += 1;
        set.delete(cb);
      });
    };
    if (bus.mode.value === "defer") bus.pending.push(settle);
    else settle();
  });
}

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "mdpro-a", listen: register }),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: eventListen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "mdpro-a" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { useDocument } from "../src/hooks/useDocument";
import { OPEN_IN_WINDOW_EVENT, useOpenInWindow } from "../src/hooks/useOpenInWindow";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";

const LABEL = "mdpro-a";
const EVENT = "file:open-in-window";

function doc(id: string, path: string, isModified: boolean, content = `c-${id}`): Document {
  return { id, path, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}
const docs = () => useDocumentStore.getState().documents;
const activeIds = () => [useDocumentStore.getState().activeDocumentId, useEditorStore.getState().activeDocumentId];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const openCalls = () => invokeMock.mock.calls.filter(([cmd]) => cmd === "open_file");
const editorRest = () =>
  Object.fromEntries(
    Object.entries(useEditorStore.getState()).filter(([k, v]) => typeof v !== "function" && k !== "activeDocumentId"),
  );
const logs = () => sink.logEventSync.mock.calls.map(([p]) => p as Record<string, unknown>);

function seed(list: Document[], active: string | null): void {
  useDocumentStore.setState({ documents: list, activeDocumentId: active });
  useEditorStore.setState({ activeDocumentId: active, viewMode: "source" });
}

function openResult(d: Document): void {
  invokeMock.mockImplementation(async (cmd: string) =>
    cmd === "open_file" ? { document: d, recoveredDraft: null } : null,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function emit(payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.listeners.get(EVENT) ?? [])]) cb({ payload });
  });
  await settle();
}

const seen: boolean[] = [];
function mount() {
  return renderHook(() => {
    const { openPathOutcome } = useDocument();
    const state = useOpenInWindow({ openPathOutcome });
    seen.push(state.routable);
    return state;
  });
}

beforeEach(() => {
  bus.listeners.clear();
  bus.subscribes.length = 0;
  bus.disposes.count = 0;
  bus.mode.value = "resolve";
  bus.pending.length = 0;
  seen.length = 0;
  vi.clearAllMocks();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "wysiwyg" });
  seed([], null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("useOpenInWindow — focus by id", () => {
  it("exports the event name the Rust side emits", () => {
    expect(OPEN_IN_WINDOW_EVENT).toBe(EVENT);
  });

  it("event for an open id focuses it in both stores (dirty and clean target)", async () => {
    seed([doc("A", "/p/a.md", true), doc("B", "/p/b.md", false), doc("C", "/p/c.md", false)], "B");
    mount();
    await settle();
    await emit({ windowLabel: LABEL, documentId: "A", path: "/p/a.md" });
    expect(activeIds()).toEqual(["A", "A"]);
    await emit({ windowLabel: LABEL, documentId: "C", path: "/p/c.md" });
    expect(activeIds()).toEqual(["C", "C"]);
  });

  it("focus is read/write-free (Law, 8 masks x 3 targets x 3 initial actives)", async () => {
    mount();
    await settle();
    const ids = ["A", "B", "C"];
    let cells = 0;
    for (let mask = 0; mask < 8; mask += 1) {
      for (const target of ids) {
        for (const initial of ids) {
          const list = ids.map((id, i) => doc(id, `/p/${id}.md`, Boolean(mask & (1 << i)), `content-${id}-${mask}`));
          seed(list, initial);
          const before = clone(docs());
          const restBefore = clone(editorRest());
          invokeMock.mockClear();
          await emit({ windowLabel: LABEL, documentId: target, path: `/private/p/${target}.md` });
          expect(docs()).toEqual(before);
          expect(useDocumentStore.getState().activeDocumentId).toBe(target);
          expect(clone(editorRest())).toEqual(restBefore);
          expect(useEditorStore.getState().viewMode).toBe("source");
          expect(useEditorStore.getState().activeDocumentId).toBe(target);
          expect(invokeMock).toHaveBeenCalledTimes(0);
          cells += 1;
        }
      }
    }
    expect(cells).toBe(72);
  });

  it("a document opened after subscription is focused by id, not reopened", async () => {
    seed([doc("B", "/p/b.md", false)], "B");
    mount();
    await settle();
    act(() => useDocumentStore.getState().upsertDocument(doc("N", "/p/n.md", false, "n")));
    const after = clone(docs());
    await emit({ windowLabel: LABEL, documentId: "N", path: "/private/p/n.md" });
    expect(activeIds()).toEqual(["N", "N"]);
    expect(docs()).toEqual(after);
    expect(after.map((d) => d.id)).toEqual(["B", "N"]);
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });
});

describe("useOpenInWindow — unknown id reopens through the real open path", () => {
  it("unknown id calls open_file once with the payload path and activates the result", async () => {
    seed([doc("B", "/p/b.md", false)], "B");
    openResult(doc("Z", "/p/z.md", false, "# z"));
    mount();
    await settle();
    await emit({ windowLabel: LABEL, documentId: "Z", path: "/p/z.md" });
    expect(openCalls()).toHaveLength(1);
    expect(openCalls()[0][1]).toEqual(expect.objectContaining({ path: "/p/z.md" }));
    expect(docs().find((d) => d.id === "Z")?.content).toBe("# z");
    expect(activeIds()).toEqual(["Z", "Z"]);
  });

  it("unknown id, dirty doc at that path: the ADR-0028 guard focuses it", async () => {
    seed([doc("D", "/p/z.md", true, "mine")], null);
    openResult(doc("Z", "/p/z.md", false, "disk"));
    mount();
    await settle();
    await emit({ windowLabel: LABEL, documentId: "Z", path: "/p/z.md" });
    expect(docs()).toHaveLength(1);
    expect(docs()[0].content).toBe("mine");
    expect(useDocumentStore.getState().activeDocumentId).toBe("D");
  });
});

describe("useOpenInWindow — guards", () => {
  const rows: Array<[string, unknown]> = [
    ["wrong label", { windowLabel: "mdpro-b", documentId: "A", path: "/p/a.md" }],
    ["documentId missing", { windowLabel: LABEL, path: "/p/a.md" }],
    ["documentId non-string", { windowLabel: LABEL, documentId: 42, path: "/p/a.md" }],
    ["empty path", { windowLabel: LABEL, documentId: "A", path: "" }],
    ["null payload", null],
    ["string payload", "str"],
    ["unknown id, path missing", { windowLabel: LABEL, documentId: "Z" }],
  ];
  it.each(rows)("%s changes nothing", async (_name, payload) => {
    seed([doc("A", "/p/a.md", true), doc("B", "/p/b.md", false)], "B");
    openResult(doc("Z", "/p/z.md", false));
    mount();
    await settle();
    expect(bus.listeners.get(EVENT)?.size ?? 0).toBe(1);
    const before = clone(docs());
    await emit(payload);
    expect(docs()).toEqual(before);
    expect(activeIds()).toEqual(["B", "B"]);
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });

  it("subscribes once, per webview, and calls the latest unstable callback", async () => {
    const calls: Array<[number, string]> = [];
    const { rerender } = renderHook(({ n }: { n: number }) =>
      useOpenInWindow({ openPathOutcome: async (p: string) => (calls.push([n, p]), null) }), { initialProps: { n: 0 } });
    await settle();
    for (let n = 1; n <= 5; n += 1) {
      act(() => useDocumentStore.getState().upsertDocument(doc(`d${n}`, `/p/d${n}.md`, false)));
      rerender({ n });
      await settle();
    }
    await emit({ windowLabel: LABEL, documentId: "Z", path: "/p/z.md" });
    expect(bus.subscribes).toEqual([EVENT]);
    expect(eventListen).toHaveBeenCalledTimes(0);
    expect(calls).toEqual([[5, "/p/z.md"]]);
  });
});

describe("useOpenInWindow — routable and the subscription lifecycle", () => {
  const listenFails = () => logs().filter((p) => p.event === "file.open.route.listen" && p.status === "fail");

  it("routable is false until listen resolves, then true", async () => {
    bus.mode.value = "defer";
    const { result } = mount();
    await settle();
    expect(result.current.routable).toBe(false);
    await act(async () => bus.pending.splice(0).forEach((f) => f()));
    await settle();
    expect(result.current.routable).toBe(true);
  });

  it("a rejected subscription under Tauri stays false and logs one listen failure", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    bus.mode.value = "reject";
    const { result } = mount();
    await settle();
    expect(result.current.routable).toBe(false);
    expect(listenFails()).toHaveLength(1);
  });

  it("a rejected subscription outside Tauri stays false and logs nothing", async () => {
    bus.mode.value = "reject";
    const { result } = mount();
    await settle();
    expect(result.current.routable).toBe(false);
    expect(listenFails()).toHaveLength(0);
  });

  it("unmount before resolve disposes late and never flips", async () => {
    bus.mode.value = "defer";
    seed([doc("A", "/p/a.md", false), doc("B", "/p/b.md", false)], "B");
    const { result, unmount } = mount();
    await settle();
    expect(bus.pending).toHaveLength(1);
    unmount();
    await act(async () => bus.pending.splice(0).forEach((f) => f()));
    await settle();
    await emit({ windowLabel: LABEL, documentId: "A", path: "/p/a.md" });
    expect(bus.disposes.count).toBe(1);
    expect(bus.listeners.get(EVENT)?.size ?? 0).toBe(0);
    expect(result.current.routable).toBe(false);
    expect(seen).not.toContain(true);
    expect(activeIds()).toEqual(["B", "B"]);
  });

  it("route log carries ids and outcome, never content", async () => {
    seed([doc("A", "/p/a.md", true, "SECRET-CONTENT"), doc("B", "/p/b.md", false)], "B");
    openResult(doc("Z", "/p/z.md", false, "SECRET-CONTENT"));
    mount();
    await settle();
    await emit({ windowLabel: LABEL, documentId: "A", path: "/p/a.md" });
    await emit({ windowLabel: LABEL, documentId: "Z", path: "/p/z.md" });
    const route = logs().filter((p) => p.event === "file.open.route" && p.status === "success");
    expect(route.map((p) => p.context)).toEqual([
      expect.objectContaining({ outcome: "focused-tab", documentId: "A", windowLabel: LABEL }),
      expect.objectContaining({ outcome: "opened-path", documentId: "Z", windowLabel: LABEL }),
    ]);
    const everything = JSON.stringify([sink.logEventSync.mock.calls, sink.logEvent.mock.calls]);
    expect(everything).not.toContain("SECRET-CONTENT");
  });
});

// D46 WI-3 — matrix `.claude/tdd-guardian/tests-20261003-130127.md` § WI-3 (OW-1, OW-2).
// Law: one route event that fails to reopen gives exactly one toast emission (from the
// hook, never from the route handler), and `documents` and the active ids are conserved.
describe("useOpenInWindow — a failed reopen toasts once, from the hook (D46)", () => {
  const TOO_LARGE = { FileTooLarge: { path: "/p/z.md", size: 10485761 } };
  const routeFails = () => logs().filter((p) => p.event === "file.open.route" && p.status === "fail");

  function recordToastEmissions(): { emissions: string[]; stop: () => void } {
    const emissions: string[] = [];
    const stop = useToastStore.subscribe((s) => {
      if (s.message !== null) emissions.push(s.message);
    });
    return { emissions, stop };
  }

  beforeEach(() => {
    useToastStore.getState().clearToast();
  });

  afterEach(() => {
    useToastStore.getState().clearToast();
  });

  it("OW-1 FileTooLarge on a closed tab: one toast, documents and active ids unchanged, one route fail log", async () => {
    seed([doc("B", "/p/b.md", false)], "B");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "open_file") throw TOO_LARGE;
      return null;
    });
    mount();
    await settle();
    const before = clone(docs());
    const { emissions, stop } = recordToastEmissions();
    try {
      await emit({ windowLabel: LABEL, documentId: "Z", path: "/p/z.md" });
    } finally {
      stop();
    }
    expect(emissions).toEqual(["Failed to open file"]);
    expect(docs()).toEqual(before);
    expect(activeIds()).toEqual(["B", "B"]);
    expect(openCalls()).toHaveLength(1);
    expect(routeFails()).toHaveLength(1);
    expect(routeFails()[0]).toEqual(
      expect.objectContaining({
        error: "open returned nothing",
        context: expect.objectContaining({ outcome: "opened-path", documentId: "Z", windowLabel: LABEL }),
      }),
    );
  });

  it("OW-2 a successful reopen gives no toast", async () => {
    seed([doc("B", "/p/b.md", false)], "B");
    openResult(doc("Z", "/p/z.md", false));
    mount();
    await settle();
    const { emissions, stop } = recordToastEmissions();
    try {
      await emit({ windowLabel: LABEL, documentId: "Z", path: "/p/z.md" });
    } finally {
      stop();
    }
    expect(emissions).toEqual([]);
    expect(docs().some((d) => d.id === "Z")).toBe(true);
    expect(activeIds()).toEqual(["Z", "Z"]);
    expect(routeFails()).toHaveLength(0);
  });
});
