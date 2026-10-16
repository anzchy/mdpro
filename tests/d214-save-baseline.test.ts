// @vitest-environment node
/**
 * D214-WI-2 — what a finished save leaves as the saved-content baseline, through the
 * real `applySaveResult`, real stores and real dataLossGuards.
 *
 * A1: a failed settle flush demotes the save, so the editor may hold text the store
 * lacks. The document must lose its baseline (sticky dirty) until the next clean
 * point; otherwise writing the old text back would read clean and close without a
 * prompt. The flusher fails ONLY on "save-settle" and is clean on every other reason,
 * so the close prompt cannot come from a failing close flush.
 * A2: a failing close flush still prompts when the content equals the baseline.
 * A3: an edit during the save: the baseline is the written text.
 * A4: reformat on save: the baseline is the formatted text.
 *
 * Only the Tauri core boundary is mocked (invoke records `delete_draft`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn(async () => null) }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...(args as [])),
}));

import { applySaveResult } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore, type Flusher } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import {
  activeDocumentAfterFlush,
  assessWindowUnsaved,
  decideCloseRequest,
} from "../src/utils/dataLossGuards";

const PATH = "/tmp/doc-a.md";
const SAVED_AT = 1_760_000_000_000;

function D(content: string): Document {
  return {
    id: "doc-a",
    path: PATH,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

const store = () => useDocumentStore.getState();
const doc = () => store().getDocumentById("doc-a")!;
const write = (content: string) => store().updateDocumentContent("doc-a", content);
const save = (snapshot: string, written: string) =>
  applySaveResult("doc-a", snapshot, written, { success: true, path: PATH, savedAt: SAVED_AT });
const deleteDraftCalls = () => invokeMock.mock.calls.filter((c) => (c as unknown[])[0] === "delete_draft");
const register = (flush: Flusher) => useMilkdownEditorStore.getState().registerFlusher("doc-a", flush);

/** Seed a clean document with a baseline and make it active. */
function seedClean(content: string): void {
  store().upsertDocument(D(content));
  store().setActiveDocumentId("doc-a");
}

beforeEach(() => {
  invokeMock.mockClear();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("A1 a failed settle flush leaves the document without a baseline", () => {
  const FAILURES = {
    "returns-failed": (): ReturnType<Flusher> => ({ status: "failed" }),
    throws: (): ReturnType<Flusher> => {
      throw new Error("settle flush blew up");
    },
  } as const;

  it.each(Object.keys(FAILURES) as Array<keyof typeof FAILURES>)(
    "flusher %s on save-settle only: dirty, no baseline, close prompts, until a clean point",
    (mode) => {
      const reasons: string[] = [];
      register((reason) => {
        reasons.push(reason);
        return reason === "save-settle" ? FAILURES[mode]() : { status: "clean" };
      });
      seedClean("BASE");
      store().markDocumentModified("doc-a", true); // the editor holds an edit

      save("BASE", "BASE");

      expect(reasons).toContain("save-settle");
      expect(doc().isModified).toBe(true);
      expect(doc().savedContent).toBeUndefined();
      expect(doc().lastSaved).toBe(SAVED_AT);

      write("BASE");
      expect(doc().isModified).toBe(true);
      expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
      expect(assessWindowUnsaved("window-close")).toEqual({
        flushFailed: false,
        dirtyDocuments: [{ id: "doc-a", path: PATH }],
      });

      write("BASE+1");
      expect(doc().isModified).toBe(true);
      store().markDocumentModified("doc-a", false);
      write("BASE+1");
      expect(doc().isModified).toBe(false);
      expect(doc().savedContent).toBe("BASE+1");

      expect(deleteDraftCalls()).toEqual([]);
    },
  );
});

describe("A2 a failing close flush prompts even when content equals the baseline", () => {
  it("prompts, reports flushFailed, and leaves the store document untouched", () => {
    register((reason) => (reason === "tab-close" || reason === "window-close" ? { status: "failed" } : { status: "clean" }));
    seedClean("BASE");
    write("BASE+1");
    write("BASE");
    const before = structuredClone(doc());
    expect(before.isModified).toBe(false);

    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
    expect(assessWindowUnsaved("window-close").flushFailed).toBe(true);
    expect(doc()).toEqual(before);
  });
});

describe("A3 an edit during the save", () => {
  it("records the written text as the baseline; the live edit stays dirty", () => {
    seedClean("OLD");
    write("MID");
    // The save started from "MID"; the user typed while it awaited.
    write("MID+NEW");
    save("MID", "MID");

    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["MID+NEW", true, "MID"]);
    write("MID");
    expect(doc().isModified).toBe(false);
    write("MID+NEW");
    expect(doc().isModified).toBe(true);
    write("OLD");
    expect(doc().isModified).toBe(true);
    expect(deleteDraftCalls()).toEqual([]);
  });
});

describe("A4 reformat on save", () => {
  it("the formatted text is the baseline", () => {
    seedClean("OLD");
    write("T0");
    save("T0", "T0-FMT");

    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["T0-FMT", false, "T0-FMT"]);
    write("T0");
    expect(doc().isModified).toBe(true);
    write("T0-FMT");
    expect(doc().isModified).toBe(false);
  });
});
