/**
 * D29 WI-6 (ADR-0033 Decisions 3 and 4): the `routable` flag in the MCP sync
 * payload, and `forceSync`, the hash-bypassing sync a cancelled close uses to
 * re-register the window.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260924-131525.md` § WI-6 (revision 3).
 *
 * Law — dedupe with a bypass: the number of sends equals the number of
 * structural or state changes plus the number of `forceSync` calls. After a
 * `forceSync`, the next unchanged `syncNow` sends nothing.
 *
 * Boundaries mocked: `mcpService.syncDocuments` (IPC), `@tauri-apps/api/window`
 * and `@tauri-apps/api/webviewWindow` (the Tauri process), and the
 * `loggingService` sink. The document and editor stores, `useMcpSync` and
 * `useOpenInWindow` are real.
 * Paired integration: G-D29-2 and G-D29-3 in WI-8 (not run by this lane).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { syncDocuments, sink, bus } = vi.hoisted(() => ({
  syncDocuments: vi.fn(async (..._args: unknown[]): Promise<void> => undefined),
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
  },
  bus: { pending: [] as Array<() => void> },
}));

vi.mock("../src/services/mcpService", () => ({
  mcpService: { syncDocuments: (...args: unknown[]) => syncDocuments(...args) },
  syncDocuments: (...args: unknown[]) => syncDocuments(...args),
}));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "mdpro-a" }) }));
// A deferred subscription: `listen` resolves only when the test drains `bus.pending`.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "mdpro-a",
    listen: () =>
      new Promise<() => void>((resolve) => {
        bus.pending.push(() => resolve(() => {}));
      }),
  }),
}));

import { useMcpSync } from "../src/hooks/useMcpSync";
import { useOpenInWindow } from "../src/hooks/useOpenInWindow";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";

interface Payload {
  windowLabel: string;
  routable?: boolean;
  documents: Array<{ id: string; content: string }>;
}

function makeDoc(id: string, path: string, content = "x") {
  return { id, path, content, encoding: "utf-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}

const payloads = (): Payload[] => syncDocuments.mock.calls.map((call) => call[0] as Payload);

type Props = { routable?: boolean } | undefined;

/** Mount with one document, let the initial content debounce send, clear the mock. */
async function mountSettled(initialProps: Props) {
  const view = renderHook((props: Props) => useMcpSync(props), { initialProps });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  const baseline = payloads();
  syncDocuments.mockClear();
  return { ...view, baseline };
}

beforeEach(() => {
  vi.useFakeTimers();
  syncDocuments.mockReset();
  syncDocuments.mockImplementation(async () => undefined);
  sink.logEventSync.mockClear();
  bus.pending = [];
  useEditorStore.setState({ editorView: null });
  useDocumentStore.setState({ documents: [makeDoc("d1", "/a/one.md")] as never, activeDocumentId: "d1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the payload carries routable", () => {
  it("useMcpSync() with no argument sends routable:false", () => {
    const { result } = renderHook(() => useMcpSync());
    result.current.syncNow();

    expect(syncDocuments).toHaveBeenCalledTimes(1);
    expect(payloads()[0]).toHaveProperty("routable", false);
  });

  it("payload carries routable; a flip alone syncs at t=0", async () => {
    const { rerender, baseline } = await mountSettled({ routable: false });
    expect(baseline).toHaveLength(1);
    expect(baseline[0]).toHaveProperty("routable", false);

    rerender({ routable: true });

    expect(syncDocuments).toHaveBeenCalledTimes(1);
    expect(payloads()[0]).toEqual({ ...baseline[0], routable: true });
  });
});

describe("Law: dedupe with a bypass", () => {
  type Op = "syncNow" | "forceSync";
  const rows: Array<{ ops: Op[]; sends: number }> = [
    { ops: ["syncNow"], sends: 0 },
    { ops: ["syncNow", "syncNow"], sends: 0 },
    { ops: ["syncNow", "syncNow", "syncNow", "syncNow", "syncNow"], sends: 0 },
    { ops: ["forceSync"], sends: 1 },
    { ops: ["forceSync", "forceSync"], sends: 2 },
    { ops: ["forceSync", "forceSync", "forceSync", "forceSync", "forceSync"], sends: 5 },
    { ops: ["forceSync", "syncNow", "syncNow"], sends: 1 },
  ];
  for (const row of rows) {
    it(`[${row.ops.join(", ")}] on an unchanged state sends ${row.sends}`, async () => {
      const { result, baseline } = await mountSettled({ routable: true });

      for (const op of row.ops) {
        await act(async () => {
          await result.current[op]();
        });
      }

      expect(syncDocuments).toHaveBeenCalledTimes(row.sends);
      // Every send is the unchanged payload, routable included.
      for (const payload of payloads()) expect(payload).toEqual(baseline[0]);
    });
  }

  it("toggling routable f→t→f→t sends 3, carrying [true, false, true]", async () => {
    const { rerender } = await mountSettled({ routable: false });

    rerender({ routable: true });
    rerender({ routable: false });
    rerender({ routable: true });

    expect(payloads().map((p) => p.routable)).toEqual([true, false, true]);
  });

  it("a content edit then forceSync sends once at t=0 with the new content, and still once after 300 ms", async () => {
    const { result } = await mountSettled({ routable: true });

    act(() => {
      useDocumentStore.getState().updateDocumentContent("d1", "edited");
    });
    await act(async () => {
      await result.current.forceSync();
    });

    expect(syncDocuments).toHaveBeenCalledTimes(1);
    expect(payloads()[0].documents[0].content).toBe("edited");
    expect(payloads()[0].routable).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(syncDocuments).toHaveBeenCalledTimes(1);
  });
});

describe("a failed sync", () => {
  it("logs and does not throw, and the next forceSync sends again", async () => {
    const { result } = await mountSettled({ routable: true });
    syncDocuments.mockRejectedValueOnce(new Error("boom"));

    await act(async () => {
      await expect(result.current.forceSync()).resolves.toBeUndefined();
    });

    const failures = sink.logEventSync.mock.calls
      .map(([entry]) => entry as { event: string; status: string })
      .filter((entry) => entry.event === "mcp.sync" && entry.status === "fail");
    expect(failures).toHaveLength(1);

    await act(async () => {
      await result.current.forceSync();
    });
    expect(syncDocuments).toHaveBeenCalledTimes(2);
  });
});

describe("composition with the real useOpenInWindow", () => {
  it("routable becomes true only after the listener resolves", async () => {
    const openDocumentFromPath = vi.fn(async () => null);
    const { result } = renderHook(() => {
      const openInWindow = useOpenInWindow({ openDocumentFromPath });
      return useMcpSync({ routable: openInWindow.routable });
    });

    act(() => {
      result.current.syncNow();
    });
    const before = payloads();
    expect(before.length).toBeGreaterThan(0);
    for (const payload of before) expect(payload).toHaveProperty("routable", false);

    expect(bus.pending).toHaveLength(1);
    await act(async () => {
      bus.pending.splice(0).forEach((settle) => settle());
    });

    const after = payloads().slice(before.length);
    expect(after).toHaveLength(1);
    expect(after[0]).toHaveProperty("routable", true);
  });
});
