/**
 * D29 WI-4 (ADR-0033 Decision 4): the MCP registry must be trustworthy enough
 * to route an external open on.
 *
 * - The label is resolved synchronously, so a window's FIRST sync is filed
 *   under its own label rather than "main".
 * - A document's `path` change (Save As) syncs at t=0, like open/close/switch,
 *   instead of waiting for the 300 ms content debounce (which never fires for
 *   a path-only change: the content hash is `id:len:isModified`).
 *
 * Boundaries mocked: `@tauri-apps/api/window` (the Tauri process) and
 * `mcpService.syncDocuments` (IPC). The document and editor stores are real.
 * Paired integration: G-D29-1 and G-D29-2 in WI-8 (not run by this lane).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const syncDocuments = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/services/mcpService", () => ({
  mcpService: {
    syncDocuments: (...args: unknown[]) => syncDocuments(...args),
  },
  syncDocuments: (...args: unknown[]) => syncDocuments(...args),
}));

// Controlled per test: either a label or a thrown error ("not in Tauri").
const windowMock: { label: string; throws: boolean } = { label: "main", throws: false };

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (windowMock.throws) throw new Error("not tauri");
    return { label: windowMock.label };
  },
}));

interface SyncedDoc {
  id: string;
  title: string;
  path: string | null;
}
interface SyncPayload {
  windowLabel: string;
  documents: SyncedDoc[];
}

function makeDoc(id: string, path: string | null, content = "x") {
  return {
    id,
    path,
    content,
    encoding: "utf-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

function payloadAt(i: number): SyncPayload {
  return syncDocuments.mock.calls[i][0] as SyncPayload;
}

function lastPayload(): SyncPayload {
  const calls = syncDocuments.mock.calls;
  return calls[calls.length - 1][0] as SyncPayload;
}

/** Fresh module instances (hook, stores, React) so each label is a new window. */
async function loadFresh() {
  vi.resetModules();
  const rtl = await import("@testing-library/react");
  const { useDocumentStore } = await import("../src/stores/documentStore");
  const { useEditorStore } = await import("../src/stores/editorStore");
  const { useMcpSync } = await import("../src/hooks/useMcpSync");
  useEditorStore.setState({ editorView: null });
  return { ...rtl, useDocumentStore, useMcpSync };
}

beforeEach(() => {
  syncDocuments.mockClear();
  windowMock.label = "main";
  windowMock.throws = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMcpSync resolves its window label before the first sync", () => {
  for (const label of ["mdpro-x", "mdpro-y"]) {
    it(`first sync carries this window's label, not "main" (${label})`, async () => {
      // REGRESSION: the label was read by an async dynamic import in an
      // effect, so a sync sent straight after mount went out as "main" and
      // the window's entry was filed under the wrong key.
      windowMock.label = label;
      const { renderHook, useDocumentStore, useMcpSync } = await loadFresh();
      useDocumentStore.setState({
        documents: [makeDoc("d1", "/a/one.md")] as never,
        activeDocumentId: "d1",
      });

      const { result } = renderHook(() => useMcpSync());
      result.current.syncNow();

      expect(syncDocuments).toHaveBeenCalled();
      expect(payloadAt(0).windowLabel).toBe(label);
    });
  }

  it('label getter throws → "main", nothing throws', async () => {
    windowMock.throws = true;
    const { renderHook, useDocumentStore, useMcpSync } = await loadFresh();
    useDocumentStore.setState({
      documents: [makeDoc("d1", "/a/one.md")] as never,
      activeDocumentId: "d1",
    });

    let syncNow: (() => void) | undefined;
    expect(() => {
      syncNow = renderHook(() => useMcpSync()).result.current.syncNow;
    }).not.toThrow();
    syncNow!();

    expect(syncDocuments).toHaveBeenCalled();
    expect(payloadAt(0).windowLabel).toBe("main");
  });
});

describe("a path change syncs immediately", () => {
  async function mountSettled(docs: ReturnType<typeof makeDoc>[]) {
    vi.useFakeTimers();
    const env = await loadFresh();
    env.useDocumentStore.setState({ documents: docs as never, activeDocumentId: docs[0].id });
    env.renderHook(() => env.useMcpSync());
    await env.act(async () => {
      vi.advanceTimersByTime(300);
    });
    syncDocuments.mockClear();
    return env;
  }

  it("Save As path change syncs at t=0, not at 300 ms", async () => {
    const { act, useDocumentStore } = await mountSettled([makeDoc("d1", "/a/old.md")]);

    act(() => {
      useDocumentStore.getState().updateDocumentPath("d1", "/a/new.md");
    });

    expect(syncDocuments).toHaveBeenCalledTimes(1);
    expect(payloadAt(0).documents[0].path).toBe("/a/new.md");
    expect(payloadAt(0).documents[0].title).toBe("new.md");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(syncDocuments).toHaveBeenCalledTimes(1);
  });

  // Law — path freshness: 3 documents × {path→other path, null→path}.
  const transitions: Array<{ name: string; from: string | null }> = [
    { name: "path→other path", from: "/old" },
    { name: "null→path", from: null },
  ];
  for (const i of [0, 1, 2]) {
    for (const t of transitions) {
      it(`path freshness: doc ${i}, ${t.name}`, async () => {
        const ids = ["d0", "d1", "d2"];
        const initial = ids.map((id, k) => makeDoc(id, k === i ? (t.from === null ? null : `${t.from}/${id}.md`) : `/keep/${id}.md`));
        const { act, useDocumentStore } = await mountSettled(initial);
        const next = `/new/${ids[i]}.md`;

        act(() => {
          useDocumentStore.getState().updateDocumentPath(ids[i], next);
        });

        expect(syncDocuments).toHaveBeenCalled();
        const docs = lastPayload().documents;
        expect(docs.map((d) => d.id)).toEqual(ids);
        for (let k = 0; k < 3; k++) {
          expect(docs[k].path).toBe(k === i ? next : initial[k].path);
        }
      });
    }
  }

  it("content-only edit stays debounced", async () => {
    const { act, useDocumentStore } = await mountSettled([makeDoc("d1", "/a/one.md")]);

    act(() => {
      useDocumentStore.getState().updateDocumentContent("d1", "xy");
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(syncDocuments).toHaveBeenCalledTimes(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(syncDocuments).toHaveBeenCalledTimes(1);
  });

  it("opening a document still syncs immediately", async () => {
    const { act, useDocumentStore } = await mountSettled([makeDoc("d1", "/a/one.md")]);

    act(() => {
      useDocumentStore.getState().upsertDocument(makeDoc("d2", "/a/two.md") as never);
    });

    expect(syncDocuments).toHaveBeenCalledTimes(1);
    expect(payloadAt(0).documents.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("a tab switch still syncs immediately", async () => {
    const { act, useDocumentStore } = await mountSettled([makeDoc("d1", "/a/one.md"), makeDoc("d2", "/a/two.md")]);

    act(() => {
      useDocumentStore.getState().setActiveDocumentId("d2");
    });

    expect(syncDocuments).toHaveBeenCalledTimes(1);
    expect((payloadAt(0) as unknown as { activeDocumentId: string }).activeDocumentId).toBe("d2");
  });
});

describe("routing dependency is pinned (ADR-0033 Costs)", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf-8");

  it("the hook names ADR-0033, App mounts it unconditionally, and no preference gates it", () => {
    const hook = read("../src/hooks/useMcpSync.ts");
    const app = read("../src/App.tsx");

    expect(hook.slice(0, hook.indexOf("*/"))).toContain("ADR-0033");
    // A top-level statement in the App component body: two-space indent, not
    // nested inside a condition or callback.
    expect(app).toMatch(/^ {2}(const \w+ = )?useMcpSync\(/m);
    expect(hook).not.toMatch(/preferencesService/);
  });
});
