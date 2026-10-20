/**
 * Purpose: a wholesale replacement invalidates a Save captured before it, even
 * when the user types afterward or the replacement has identical Markdown.
 * @coordinates-with src/services/documentSave.ts — held Save guard
 * @coordinates-with src/stores/documentStore.ts — replacement lifetime stamp
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { saveActiveDocument } from "../src/services/documentSave";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { applyRecoveredDocument } from "../src/utils/recoverIntoOpenTab";
import { commitOpenedDocument } from "../src/utils/openWriteGuard";
import { resetHarness, logLines } from "./helpers/fileWatcherLogHarness";
import { B, advance, deferred, emitChange, flush, ipcCount, mountPrompt, onIpc, resetExternalChangeHarness, toasts, view } from "./support/externalChangeHarness";
import { coreModule } from "./support/externalChangeIpc";

const DIRTY = { ...B, content: "# old b\n", isModified: true };

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [DIRTY], activeDocumentId: "b" });
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => vi.useRealTimers());

async function holdSave() {
  const held = deferred<unknown>();
  vi.mocked(coreModule.isTauri).mockReturnValue(true);
  onIpc("get_preferences", () => held.promise);
  let save: Promise<void> = Promise.resolve();
  await flush(() => {
    save = performSave("d290-wi-7", {
      saveActiveDocument,
      updateRecentFiles: () => {},
      showToast: (message) => toasts.push(message),
      onRecreateRequired: () => { throw new Error("unexpected recreate request"); },
    });
  });
  expect(ipcCount("get_preferences")).toBe(1);
  return async () => {
    await flush(() => held.resolve({ markdown: { autoReformatTablesOnSave: false } }));
    await flush(() => save);
  };
}

function expectCancelledWithRetainedText(content: string) {
  const current = useDocumentStore.getState().getDocumentById("b");
  expect(ipcCount("save_file")).toBe(0);
  expect(current?.content).toBe(content);
  expect(current?.isModified).toBe(true);
  expect(logLines("file.save.stale_cancelled").map((line) => line.context)).toEqual([{ reason: "reloaded" }]);
  expect(toasts).not.toContain("Saved");
}

describe("D290-WI-7 replacement during a held Save", () => {
  it.each([
    { name: "changed Markdown", reloaded: "# disk b\n", lineEnding: "lf" },
    { name: "identical Markdown, new line ending", reloaded: DIRTY.content, lineEnding: "crlf" },
  ])("external-change Reload, then typing: $name", async ({ reloaded, lineEnding }) => {
    await mountPrompt();
    const release = await holdSave();
    onIpc("reload_file", async () => ({ ...B, content: reloaded, lineEnding }));
    emitChange(B.path!, "modified");
    advance(300);
    await flush(() => view.current?.handleReloadFile());
    act(() => useDocumentStore.getState().updateDocumentContent("b", `${reloaded}typed\n`));
    await release();
    expectCancelledWithRetainedText(`${reloaded}typed\n`);
    expect(useDocumentStore.getState().getDocumentById("b")?.lineEnding).toBe(lineEnding);
  });

  it("a clean file reopen through the open guard invalidates an older Save", async () => {
    useDocumentStore.setState({ documents: [B], activeDocumentId: "b" });
    await mountPrompt();
    const release = await holdSave();
    act(() => commitOpenedDocument({ ...B, content: "# reopened b\n" }, "file-open"));
    act(() => useDocumentStore.getState().updateDocumentContent("b", "# reopened b\ntyped\n"));
    await release();
    expectCancelledWithRetainedText("# reopened b\ntyped\n");
  });

  it("draft recovery into an open clean tab invalidates an older Save", async () => {
    useDocumentStore.setState({ documents: [B], activeDocumentId: "b" });
    await mountPrompt();
    const release = await holdSave();
    onIpc("get_draft", async () => null);
    onIpc("save_draft", async () => true);
    onIpc("delete_draft", async () => true);
    let placement = "";
    await flush(async () => {
      placement = await applyRecoveredDocument("draft-b", { ...B, id: "draft-b", content: "# recovered b\n" }, {
        upsertAndActivate: view.current!.api.upsertAndActivateDocument,
        showToast: (message) => toasts.push(message),
      });
    });
    expect(placement).toBe("merged-into-clean");
    act(() => useDocumentStore.getState().updateDocumentContent("b", "# recovered b\ntyped\n"));
    await release();
    expectCancelledWithRetainedText("# recovered b\ntyped\n");
  });
});
