/**
 * D44 WI-1: the real ⌘S format-on-save path drops overflow cells. With
 * `autoReformatTablesOnSave` on, `useDocument.saveActiveDocument` writes
 * `| g   | h   |` to disk for `| g | h |Z`, losing Z.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261007-155353.md` S-SAVE-ON,
 * S-SAVE-OFF, S-SAVE-FENCED, S-SAVE-LOG. No law: orchestration only (the
 * laws live in the formatter suites).
 *
 * Boundary: `@tauri-apps/api/core` `invoke` (through `tests/helpers/heldInvoke.ts`),
 * plus the `@tauri-apps/api/{event,window}` modules. `useDocument`,
 * `preferencesService`, `fileService`, `formatAllTables`, `makeIsFenced`,
 * `loggingService` and the stores are real. Harness from
 * `save-format-leading-blank.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import type { Document } from "../src/types/document";
import { A_PATH, SAVED_AT, createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";

const TOC_INITIAL = useTOCStore.getState();
const LOGGING_INITIAL = useLoggingStore.getState();
const REPRO = "| a | b |\n| - | - |\n| e | f |\n| g | h |Z\n";
const REPRO_FORMATTED = "| a   | b   |     |\n| --- | --- | --- |\n| e   | f   |     |\n| g   | h   | Z   |\n";
const WIDENED = "editor.table.format-widened";

let held: HeldInvoke;
const docA = () => useDocumentStore.getState().documents.find((d) => d.id === "doc-a");
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function doc(content: string): Document {
  return { id: "doc-a", path: A_PATH, content, encoding: "UTF-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: null };
}

function resetStores(content: string): void {
  useDocumentStore.setState({ documents: [doc(content)], activeDocumentId: "doc-a" });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "source", editorView: null });
  useTOCStore.setState(TOC_INITIAL, true);
}

async function saveWith(content: string, autoReformatTablesOnSave: boolean): Promise<string> {
  resetStores(content);
  held.reply("get_preferences", () => ({ markdown: { autoReformatTablesOnSave } }));
  const before = held.calls("save_file").length;
  const { result, unmount } = renderHook(() => useDocument());
  await act(async () => { await result.current.saveActiveDocument(); });
  await settle();
  unmount();
  expect(held.calls("save_file")).toHaveLength(before + 1);
  return held.calls("save_file")[before].content as string;
}

type LogPayload = { event: string; context?: Record<string, unknown> };
const logs = (event: string): LogPayload[] =>
  held.calls("log_event").map((a) => a.payload as LogPayload).filter((p) => p.event === event);

beforeEach(() => {
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  held.reply("log_event", () => null);
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(() => {
  held.assertDrained();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useLoggingStore.setState(LOGGING_INITIAL, true);
});

describe("D44 ⌘S format-on-save keeps overflow cells", () => {
  it("S-SAVE-ON: auto-reformat on writes Z in a third column", async () => {
    expect(await saveWith(REPRO, true)).toBe(REPRO_FORMATTED);
    expect(docA()!.lastSaved).toBe(SAVED_AT);
    expect(docA()!.content).toBe(REPRO_FORMATTED);
  });

  it("S-SAVE-OFF: auto-reformat off writes the bytes verbatim, Z included", async () => {
    expect(await saveWith(REPRO, false)).toBe(REPRO);
    expect(docA()!.lastSaved).toBe(SAVED_AT);
  });

  it("S-SAVE-FENCED: the real fence predicate leaves the fenced copy alone", async () => {
    const src = "```\n| a | b |\n| - | - |\n| g | h |Z\n```\n\n| a | b |\n| - | - |\n| g | h |Z\n";
    expect(await saveWith(src, true)).toBe(
      "```\n| a | b |\n| - | - |\n| g | h |Z\n```\n\n| a   | b   |     |\n| --- | --- | --- |\n| g   | h   | Z   |\n",
    );
    expect(docA()!.lastSaved).toBe(SAVED_AT);
  });

  it("S-SAVE-LOG: the widened entry reaches log_event once, without cell text", async () => {
    useLoggingStore.setState({ enabled: true, level: "info" });
    await saveWith(REPRO, true);
    const widened = logs(WIDENED);
    expect(widened).toHaveLength(1);
    expect(widened[0].context).toEqual({ start: 0, end: 40, fromColCount: 2, toColCount: 3 });
    expect(JSON.stringify(widened[0])).not.toContain("Z");
    expect(logs("editor.table.auto-reformat-on-save")).toHaveLength(1);

    const before = held.calls("log_event").length;
    await saveWith("| a | b |\n| - | - |\n| 1 | 2 |\n", true);
    const later = held.calls("log_event").slice(before).map((a) => a.payload as LogPayload);
    expect(later.filter((p) => p.event === WIDENED)).toHaveLength(0);
  });
});
