/**
 * D29-R1 (ADR-0033 Decision 3): a failed sync must not poison the dedupe hash.
 *
 * `doSync` records the payload hash before awaiting the IPC call (that is what
 * stops a double immediate sync on open). If the call that carries
 * `routable: true` fails, and the hash stays recorded, every retry of the same
 * payload is deduped and Rust keeps the window unroutable. The catch must
 * forget the hash so the next identical sync goes out; a sync that succeeds
 * still dedupes an identical follow-up.
 *
 * Boundaries mocked: `mcpService.syncDocuments` (IPC), `@tauri-apps/api/window`
 * and the `loggingService` sink. The document and editor stores are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { syncDocuments, sink } = vi.hoisted(() => ({
  syncDocuments: vi.fn(async (..._args: unknown[]): Promise<void> => undefined),
  sink: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
  },
}));

vi.mock("../src/services/mcpService", () => ({
  mcpService: { syncDocuments: (...args: unknown[]) => syncDocuments(...args) },
  syncDocuments: (...args: unknown[]) => syncDocuments(...args),
}));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "mdpro-a" }) }));

import { useMcpSync } from "../src/hooks/useMcpSync";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";

interface Payload {
  windowLabel: string;
  routable?: boolean;
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
  syncDocuments.mockClear();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  syncDocuments.mockReset();
  syncDocuments.mockImplementation(async () => undefined);
  sink.logEventSync.mockClear();
  useEditorStore.setState({ editorView: null });
  useDocumentStore.setState({ documents: [makeDoc("d1", "/a/one.md")] as never, activeDocumentId: "d1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a failed routable sync is retried", () => {
  it("after the routable:true sync rejects, the next identical syncNow sends again", async () => {
    const { rerender, result } = await mountSettled({ routable: false });
    syncDocuments.mockRejectedValueOnce(new Error("ipc down"));

    await act(async () => {
      rerender({ routable: true });
    });
    expect(syncDocuments).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.syncNow();
    });

    expect(syncDocuments).toHaveBeenCalledTimes(2);
    expect(payloads()[1]).toHaveProperty("routable", true);
    expect(payloads()[1]).toEqual(payloads()[0]);
  });

  it("after the routable:true sync rejects, the debounced path also retries", async () => {
    const { rerender, result } = await mountSettled({ routable: false });
    syncDocuments.mockRejectedValueOnce(new Error("ipc down"));

    await act(async () => {
      rerender({ routable: true });
    });
    await act(async () => {
      result.current.syncDebounced();
      vi.advanceTimersByTime(300);
    });

    expect(syncDocuments).toHaveBeenCalledTimes(2);
    expect(payloads()[1]).toHaveProperty("routable", true);
  });

  it("a sync that succeeds still dedupes an identical follow-up", async () => {
    const { rerender, result } = await mountSettled({ routable: false });

    await act(async () => {
      rerender({ routable: true });
    });
    await act(async () => {
      result.current.syncNow();
    });

    expect(syncDocuments).toHaveBeenCalledTimes(1);
    expect(payloads()[0]).toHaveProperty("routable", true);
  });
});
