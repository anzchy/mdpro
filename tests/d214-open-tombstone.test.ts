/**
 * D214-WI-7 — codex-audit H-B PARTIAL on 0d2569e0: an open whose tab was closed while
 * its reply was in flight.
 *
 * Trace: a clean tab is open → an open's reply is held → an external write drops the
 * tab's baseline → the user closes the tab → the reply lands with no candidate tab, so
 * `commitOpenedDocument` skipped the epoch check and wrote the document clean with a
 * stale baseline (edit / undo → silent close, no draft, disk differs).
 *
 * Fix: a write that replaces nothing is demoted too when the opened document's id OR
 * its path moved since the captured generation. `dropBaseline` and `closeDocument`
 * stamp the path as well (a separate map), so a UUID tab matched only by path (D145)
 * is covered after it closed. Accepted cost, pinned below: closing the tab while an
 * open of the same file is in flight demotes that open (a false dirty, never a loss).
 *
 * The three `useDocument` routes passing `startGeneration` are pinned by the source
 * pin in tests/d214-baseline-generation.test.ts (WI-6); this file drives the guard
 * with the ctx they pass.
 *
 * jsdom, like d214-baseline-generation: the guard's import chain loads DOMPurify.
 * Real stores and the real guard; boundaries mocked: `@tauri-apps/api/core` (inert
 * invoke) and `@tauri-apps/api/window`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { resetFileChanges } from "../src/stores/externalChangeStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { activeDocumentAfterFlush, decideCloseRequest } from "../src/utils/dataLossGuards";
import { commitOpenedDocument } from "../src/utils/openWriteGuard";

const PATH = "/tmp/a.md";

function D(id: string, content: string, extra: Partial<Document> = {}): Document {
  return {
    id,
    path: PATH,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...extra,
  };
}

interface GenerationState {
  baselineGeneration: number;
  baselinePathEpoch: Record<string, number>;
}
const store = () => useDocumentStore.getState();
const gen = () => store() as unknown as GenerationState;
const doc = (id: string) => store().getDocumentById(id)!;
const write = (id: string, content: string) => store().updateDocumentContent(id, content);

/** A clean tab `id` at PATH, active. */
function openClean(id: string, content = "A"): void {
  store().upsertDocument(D(id, content));
  store().setActiveDocumentId(id);
}

beforeEach(() => {
  resetFileChanges();
  useDocumentStore.setState({ documents: [], activeDocumentId: null, baselineEpoch: {} });
  useDocumentStore.setState({ baselineGeneration: 0, baselinePathEpoch: {} } as never);
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("the audit trace: drop, then close, while the open's reply is in flight", () => {
  it.each([
    ["path-derived id (same id as the opened document)", "a"],
    ["UUID tab matched by path (D145)", "uuid-a"],
  ] as const)("%s: the reply goes in dirty with no baseline", (_label, tabId) => {
    const log = vi.spyOn(loggingService, "logEventSync");
    openClean(tabId);
    const startGeneration = gen().baselineGeneration; // captured before open_file
    store().dropBaseline(tabId); // an external write recorded during the read
    store().closeDocument(tabId); // the user closes the tab

    const result = commitOpenedDocument(D("a", "DISK"), "file-open", { actionId: "act-open", startGeneration });

    expect(result.kind).toBe("written");
    expect([doc("a").content, doc("a").isModified, doc("a").savedContent]).toEqual(["DISK", true, undefined]);
    write("a", "DISK+1");
    write("a", "DISK");
    expect(doc("a").isModified).toBe(true);
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
    const demotedLine = log.mock.calls
      .map(([e]) => e)
      .find((e) => e.context?.reason === "external_change_during_open");
    expect(demotedLine?.context).toMatchObject({ documentId: "a", demoted: true });
  });
});

describe("controls", () => {
  it("accepted cost: closing the tab while an open of the same file is in flight demotes that open", () => {
    openClean("a");
    const startGeneration = gen().baselineGeneration;
    store().closeDocument("a");
    commitOpenedDocument(D("a", "DISK"), "file-open", { startGeneration });
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([true, undefined]);
  });

  it("a fresh open with no close or drop during the flight reads clean", () => {
    const startGeneration = gen().baselineGeneration;
    commitOpenedDocument(D("a", "DISK"), "file-open", { startGeneration });
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([false, "DISK"]);
  });

  it("a drop and close before the capture do not demote a later open", () => {
    openClean("a");
    store().dropBaseline("a");
    store().closeDocument("a");
    const startGeneration = gen().baselineGeneration;
    commitOpenedDocument(D("a", "DISK"), "file-open", { startGeneration });
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([false, "DISK"]);
  });

  it("a drop on a different path during the flight does not demote", () => {
    store().upsertDocument(D("b", "B", { path: "/tmp/b.md" }));
    const startGeneration = gen().baselineGeneration;
    store().dropBaseline("b");
    store().closeDocument("b");
    commitOpenedDocument(D("a", "DISK"), "file-open", { startGeneration });
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([false, "DISK"]);
  });
});

describe("the path stamp (store)", () => {
  it("is set on drop and on close with the new generation, and never repeats", () => {
    store().upsertDocument(D("a", "A"));
    store().dropBaseline("a");
    const onDrop = gen().baselinePathEpoch[PATH];
    expect(onDrop).toBe(gen().baselineGeneration);
    expect(onDrop).toBe(store().getBaselineEpoch("a"));
    store().closeDocument("a");
    const onClose = gen().baselinePathEpoch[PATH];
    expect(onClose).toBe(gen().baselineGeneration);
    expect(onClose).toBeGreaterThan(onDrop);
    store().upsertDocument(D("a2", "A"));
    store().dropBaseline("a2");
    expect(gen().baselinePathEpoch[PATH]).toBeGreaterThan(onClose);
  });

  it("is kept apart from the id map, and a null path stamps nothing", () => {
    store().upsertDocument(D("u", "U", { path: null }));
    store().dropBaseline("u");
    store().closeDocument("u");
    expect(gen().baselinePathEpoch).toEqual({});
    expect(store().getBaselineEpoch("u")).toBeGreaterThan(0);
    store().upsertDocument(D("a", "A"));
    store().dropBaseline("a");
    expect(Object.keys(gen().baselinePathEpoch)).toEqual([PATH]);
    expect(Object.keys(store().baselineEpoch).sort()).toEqual(["a", "u"]);
  });
});
