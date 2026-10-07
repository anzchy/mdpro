// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";

// Mock fileService
const mockSaveFile = vi.fn();
vi.mock("../src/services/fileService", () => ({
  fileService: {
    saveFile: (...args: unknown[]) => mockSaveFile(...args),
  },
}));

// Mock loggingService
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    generateActionId: () => "test-action-id",
    logEventSync: vi.fn(),
  },
}));

// Import after mocks
import { prepareForRelaunch } from "../src/hooks/useUpdater";
import { loggingService } from "../src/services/loggingService";

/** The real toast action, captured before any test can swap a spy in. */
const REAL_SHOW_TOAST = useToastStore.getState().showToast;

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    path: "/tmp/test.md",
    content: "# Test",
    encoding: "utf-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: Date.now(),
    fileSize: 100,
    ...overrides,
  };
}

describe("prepareForRelaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({ documents: [], activeDocumentId: null });
    useToastStore.setState({ message: null });
    mockSaveFile.mockResolvedValue({ success: true });
  });

  it("returns true when no modified docs", async () => {
    useDocumentStore.setState({
      documents: [makeDoc({ isModified: false })],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(true);
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it("saves a single modified doc with a path", async () => {
    useDocumentStore.setState({
      documents: [makeDoc({ isModified: true, path: "/tmp/a.md", content: "hello" })],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(true);
    // Options object (not positional) — guards the wrong-arg footgun the
    // refactor closes.
    expect(mockSaveFile).toHaveBeenCalledWith({
      documentId: "doc-1",
      content: "hello",
      path: "/tmp/a.md",
      encoding: "utf-8",
      lineEnding: "lf",
      actionId: "test-action-id",
    });
  });

  it("saves multiple modified docs", async () => {
    useDocumentStore.setState({
      documents: [
        makeDoc({ id: "doc-1", isModified: true, path: "/tmp/a.md" }),
        makeDoc({ id: "doc-2", isModified: true, path: "/tmp/b.md" }),
      ],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(true);
    expect(mockSaveFile).toHaveBeenCalledTimes(2);
  });

  it("blocks relaunch and shows toast when untitled doc is modified", async () => {
    useDocumentStore.setState({
      documents: [makeDoc({ isModified: true, path: null })],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(false);
    expect(useToastStore.getState().message).toContain("unsaved changes");
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it("blocks relaunch and shows toast when save_file throws", async () => {
    mockSaveFile.mockRejectedValue(new Error("disk full"));
    useDocumentStore.setState({
      documents: [makeDoc({ isModified: true, path: "/tmp/a.md" })],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(false);
    expect(useToastStore.getState().message).toContain("Failed to save");
  });

  it("blocks relaunch on first untitled even if second doc is saveable", async () => {
    useDocumentStore.setState({
      documents: [
        makeDoc({ id: "doc-1", isModified: true, path: null }),
        makeDoc({ id: "doc-2", isModified: true, path: "/tmp/b.md" }),
      ],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(false);
    expect(mockSaveFile).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * D16 WI-8 — prepareForRelaunch flushes first (ADR-0025).
 *
 * The law under test:
 *   prepareForRelaunch() returns true iff the flush did not fail, no
 *   post-flush dirty document is untitled, and every save resolved. When
 *   it returns true, every document that was modified AFTER the flush has
 *   been saved with the flushed content, and nothing else was saved.
 *
 * The flush here is the real `milkdownEditorStore` registry — a flusher
 * that writes into documentStore exactly as the edit-sync plugin does.
 * Only the Tauri boundary is faked: `fileService.saveFile` writes into an
 * in-memory "disk", so the test can assert the bytes that reached it.
 * ------------------------------------------------------------------ */

interface FakeDisk {
  /** Every accepted write, in the order the implementation issued it. */
  writes: Array<{ path: string; content: string }>;
  /** Final on-disk state: path -> content. */
  snapshot: () => Record<string, string>;
}

function installFakeDisk(options: { rejectNthSave?: number } = {}): FakeDisk {
  const writes: Array<{ path: string; content: string }> = [];
  let calls = 0;
  mockSaveFile.mockImplementation(async (args: { path: string; content: string }) => {
    calls += 1;
    if (options.rejectNthSave === calls) throw new Error("disk full");
    writes.push({ path: args.path, content: args.content });
    return { success: true };
  });
  return {
    writes,
    snapshot: () => Object.fromEntries(writes.map((w) => [w.path, w.content])),
  };
}

function relaunchFailures(): Array<Record<string, unknown>> {
  return vi
    .mocked(loggingService.logEventSync)
    .mock.calls.map((call) => call[0] as unknown as Record<string, unknown>)
    .filter((e) => e.event === "updater.prepare_relaunch" && e.status === "fail");
}

function resetWorld(): void {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ flushers: {} });
  useToastStore.getState().clearToast();
  useToastStore.setState({ showToast: REAL_SHOW_TOAST });
}

describe("prepareForRelaunch — flushes pending WYSIWYG edits first", () => {
  beforeEach(resetWorld);

  it("saves the flushed text, not the stale text, for an edit still inside the edit-sync delay", async () => {
    // The document reads CLEAN before the flush: the pending edit exists only
    // inside the editor. Reading isModified first would save nothing at all.
    useDocumentStore.setState({
      documents: [
        makeDoc({ id: "doc-1", path: "/disk/a.md", content: "stale", isModified: false }),
      ],
    });
    const disk = installFakeDisk();
    const unregister = useMilkdownEditorStore
      .getState()
      .registerFlusher("doc-1", () => {
        useDocumentStore.getState().updateDocumentContent("doc-1", "flushed");
        return { status: "written" as const };
      });

    try {
      const result = await prepareForRelaunch();

      expect(result).toBe(true);
      expect(disk.snapshot()).toEqual({ "/disk/a.md": "flushed" });
    } finally {
      unregister();
    }
  });

  it("returns false, saves nothing and shows exactly one toast when the flush fails", async () => {
    useDocumentStore.setState({
      documents: [
        makeDoc({ id: "doc-1", path: "/disk/a.md", content: "stale", isModified: true }),
      ],
    });
    const disk = installFakeDisk();
    const toastSpy = vi.fn(REAL_SHOW_TOAST);
    useToastStore.setState({ showToast: toastSpy });
    const unregister = useMilkdownEditorStore
      .getState()
      .registerFlusher("doc-1", () => ({ status: "failed" as const }));

    try {
      const result = await prepareForRelaunch();

      expect(result).toBe(false);
      expect(disk.writes).toEqual([]);
      expect(toastSpy).toHaveBeenCalledTimes(1);
      expect(useToastStore.getState().message).toBe(
        "Could not capture the latest editor changes. Update cancelled.",
      );

      const failures = relaunchFailures();
      expect(failures).toHaveLength(1);
      expect(failures[0].context).toMatchObject({ reason: "flush_failed" });
    } finally {
      unregister();
    }
  });
});

describe("prepareForRelaunch — exhaustive law", () => {
  beforeEach(resetWorld);

  type DocKind = "clean" | "dirtyPath" | "dirtyUntitled";
  type FlushKind = "clean" | "written" | "failed";

  const DOC_KINDS: readonly DocKind[] = ["clean", "dirtyPath", "dirtyUntitled"];
  const FLUSH_KINDS: readonly FlushKind[] = ["clean", "written", "failed"];

  /** Every document sequence of length 0..max over DOC_KINDS. */
  function docSequences(max: number): DocKind[][] {
    const all: DocKind[][] = [[]];
    let level: DocKind[][] = [[]];
    for (let n = 1; n <= max; n++) {
      const next: DocKind[][] = [];
      for (const seq of level) for (const kind of DOC_KINDS) next.push([...seq, kind]);
      all.push(...next);
      level = next;
    }
    return all;
  }

  function buildDocs(kinds: DocKind[]): Document[] {
    return kinds.map((kind, i) =>
      makeDoc({
        id: `doc-${i}`,
        path: kind === "dirtyUntitled" ? null : `/disk/${i}.md`,
        content: `stale-${i}`,
        isModified: kind !== "clean",
      }),
    );
  }

  it("returns true iff the flush held, nothing is untitled and every save resolved", async () => {
    const sequences = docSequences(3);
    expect(sequences).toHaveLength(40);
    let cases = 0;

    for (const kinds of sequences) {
      for (const flush of FLUSH_KINDS) {
        for (const rejectSecondSave of [false, true]) {
          resetWorld();
          cases += 1;
          const label = `docs=[${kinds.join(",")}] flush=${flush} rejectSecond=${rejectSecondSave}`;

          const docs = buildDocs(kinds);
          useDocumentStore.setState({ documents: docs, activeDocumentId: null });
          const disk = installFakeDisk({ rejectNthSave: rejectSecondSave ? 2 : undefined });

          // The state the law is written against: the store AFTER the flush.
          const postDocs = docs.map((doc, i) =>
            flush === "written" && i === 0
              ? { ...doc, content: `flushed-${i}`, isModified: true }
              : doc,
          );
          const postDirty = postDocs.filter((doc) => doc.isModified);

          let unregister = (): void => {};
          if (flush === "written" && docs.length > 0) {
            unregister = useMilkdownEditorStore.getState().registerFlusher("doc-0", () => {
              useDocumentStore.getState().updateDocumentContent("doc-0", "flushed-0");
              return { status: "written" as const };
            });
          } else if (flush === "failed") {
            unregister = useMilkdownEditorStore
              .getState()
              .registerFlusher("phantom-doc", () => ({ status: "failed" as const }));
          }

          const flushFailed = flush === "failed";
          const hasUntitled = postDirty.some((doc) => doc.path === null);
          const aSaveRejects = rejectSecondSave && !hasUntitled && postDirty.length >= 2;
          const expected = !flushFailed && !hasUntitled && !aSaveRejects;

          try {
            const result = await prepareForRelaunch();

            // Both directions of the iff, over the whole space.
            expect(result, label).toBe(expected);

            if (expected) {
              // Exactly the post-flush dirty documents, with the flushed bytes.
              expect(disk.snapshot(), label).toEqual(
                Object.fromEntries(postDirty.map((doc) => [doc.path as string, doc.content])),
              );
              expect(disk.writes.length, label).toBe(postDirty.length);
              expect(useToastStore.getState().message, label).toBeNull();
            } else {
              expect(useToastStore.getState().message, label).not.toBeNull();
              if (flushFailed || hasUntitled) {
                // Nothing is known to need writing, so nothing is written.
                expect(disk.writes, label).toEqual([]);
              } else {
                // The second save rejected: the first write landed, and the
                // implementation stopped instead of writing the rest.
                expect(disk.writes, label).toEqual([
                  { path: postDirty[0].path as string, content: postDirty[0].content },
                ]);
              }
            }
          } finally {
            unregister();
          }
        }
      }
    }

    expect(cases).toBe(240);
  });
});
