/**
 * D19 WI-1: a save overwrites edits made while it is awaiting (source mode and MCP writers).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-232521-d19.md` (Revision 3) §2. The 14 red
 * cases fail against the pre-fix `useDocument`; the 6 guards pass before and after. WI-4
 * must turn this file green without editing it (rule 12, D19-WI-1 receipt).
 *
 * Boundary: `invoke` (held through `tests/helpers/heldInvoke.ts`), `loggingService`, and
 * the `@tauri-apps/api/{event,window}` bus. Stores, `useDocument`, `useMcpEvents`,
 * `formatAllTables` and `performSave` are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";

const { invokeMock, listeners } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listeners: {} as Record<string, (event: { payload: unknown }) => void>,
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners[name] = handler;
    return () => {};
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { useDocument } from "../src/hooks/useDocument";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { performSave } from "../src/services/saveService";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import type { Document } from "../src/types/document";
import { A_PATH, DIALOG_PATH, SAVED_AT, createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";

const TOC_INITIAL = useTOCStore.getState();
const T0 = "|a|b|\n|-|-|\n|1|2|\n";
type Api = ReturnType<typeof useDocument>;

let held: HeldInvoke;
const logMock = () => vi.mocked(loggingService.logEventSync);
const docA = () => useDocumentStore.getState().documents.find((d) => d.id === "doc-a");
const docB = () => useDocumentStore.getState().documents.find((d) => d.id === "doc-b");
const docAOf = (docs: Document[]) => docs.filter((d) => d.id === "doc-a");
const draftsFor = (id: string) => held.calls("delete_draft").filter((a) => a.documentId === id);
const ok = (path: string) => ({ success: true, path, savedAt: SAVED_AT });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const write = (id: string, content: string) =>
  act(() => { useDocumentStore.getState().updateDocumentContent(id, content); });
const mcp = (name: string, payload: unknown) => act(() => { listeners[name]({ payload }); });
const mcpWrite = (content: string) =>
  mcp("mcp:write_document", { document_id: "doc-a", content, window_label: "main" });

function doc(id: string, content: string, path: string | null, isModified: boolean): Document {
  return { id, path, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}

function resetStores(aContent = "BASE", aPath: string | null = A_PATH): void {
  useDocumentStore.setState({
    documents: [doc("doc-a", aContent, aPath, true), doc("doc-b", "OTHER", null, false)],
    activeDocumentId: "doc-a",
  });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "source" });
  useTOCStore.setState(TOC_INITIAL, true);
}

function fresh(): void {
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  for (const k of Object.keys(listeners)) delete listeners[k];
  resetStores();
}

async function mountApi(withMcp = false): Promise<{ api: Api; unmount: () => void }> {
  const { result, unmount } = renderHook(() => {
    if (withMcp) useMcpEvents();
    return useDocument();
  });
  if (withMcp) {
    await waitFor(() => {
      expect(listeners["mcp:write_document"]).toBeDefined();
      expect(listeners["mcp:insert_content"]).toBeDefined();
    });
  }
  return { api: result.current, unmount };
}

/** The in-flight save. Boxed: an async function returning a bare Promise would adopt it. */
type InFlight = { p: Promise<unknown> };

/** §1.6 step 1: start the save and wait until `cmd` is held. */
async function start(run: () => Promise<unknown>, cmd: string): Promise<InFlight> {
  let p!: Promise<unknown>;
  await act(async () => {
    p = run();
    await held.whenCalled(cmd);
  });
  return { p };
}

/** §1.6 steps 3-4: release the held call, await the save, then settle. */
async function finish(save: InFlight, cmd: string, value: unknown): Promise<unknown> {
  let out: unknown;
  await act(async () => {
    held.release(cmd, value);
    out = await save.p;
  });
  await settle();
  return out;
}

beforeEach(() => {
  fresh();
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(() => {
  held.assertDrained();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D19 red — an edit during the save's await survives it (L-H1, L-H2)", () => {
  it("R-src-save: source ⌘S, edit while save_file is pending", async () => {
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    await write("doc-a", "BASE+NEW");
    await finish(p, "save_file", ok(A_PATH));
    expect(docA()).toMatchObject({ content: "BASE+NEW", isModified: true, lastSaved: SAVED_AT, path: A_PATH });
    expect(held.calls("save_file")[0].content).toBe("BASE");
  });

  it("R-src-saveas-routed: untitled ⌘S, edit while save_file_dialog is pending", async () => {
    resetStores("BASE", null);
    held.hold("save_file_dialog");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file_dialog");
    await write("doc-a", "BASE+NEW");
    await finish(p, "save_file_dialog", ok(DIALOG_PATH));
    expect(docA()).toMatchObject({ content: "BASE+NEW", isModified: true, path: DIALOG_PATH, lastSaved: SAVED_AT });
    expect(held.calls("save_file")).toEqual([]);
    const edited = logMock().mock.calls.filter(
      ([e]) => e.event === "file.save" && (e.context as { editedDuringSave?: unknown } | undefined)?.editedDuringSave === true,
    );
    expect(edited).toHaveLength(1);
    expect(draftsFor("doc-a")).toEqual([]);
  });

  it("R-src-saveas-direct: saveActiveDocumentAs(), edit while save_file_dialog is pending", async () => {
    held.hold("save_file_dialog");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocumentAs(), "save_file_dialog");
    await write("doc-a", "BASE+NEW");
    await finish(p, "save_file_dialog", ok(DIALOG_PATH));
    expect(docA()).toMatchObject({ content: "BASE+NEW", isModified: true, path: DIALOG_PATH, lastSaved: SAVED_AT });
  });

  it("R-prefs-window: edit while get_preferences (the first await) is pending", async () => {
    held.hold("get_preferences");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "get_preferences");
    await write("doc-a", "BASE+NEW");
    await finish(p, "get_preferences", { markdown: { autoReformatTablesOnSave: false } });
    const payload = held.calls("save_file")[0].content;
    expect(docA()!.content).toBe("BASE+NEW");
    expect(docA()!.isModified).toBe(payload !== "BASE+NEW");
    expect(draftsFor("doc-a")).toHaveLength(payload === "BASE+NEW" ? 1 : 0);
  });

  it("R-draft: an edit during the await keeps the draft", async () => {
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    await write("doc-a", "BASE+NEW");
    await finish(p, "save_file", ok(A_PATH));
    expect(draftsFor("doc-a")).toEqual([]);
    expect(docA()!.isModified).toBe(true);
  });

  it("R-closed: a document closed during the save is not resurrected (L-H3)", async () => {
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    await act(async () => { await api.closeDocumentById("doc-a", true); });
    const afterClose = useDocumentStore.getState().documents;
    const logsBefore = logMock().mock.calls.length;
    await finish(p, "save_file", ok(A_PATH));
    const state = useDocumentStore.getState();
    expect(state.documents).toBe(afterClose);
    expect(docA()).toBeUndefined();
    expect(state.activeDocumentId).toBe("doc-b");
    expect(draftsFor("doc-a")).toEqual([]);
    const tabOpens = logMock().mock.calls.slice(logsBefore).filter(([e]) => e.event === "tab.open");
    expect(tabOpens).toEqual([]);
  });

  it("R-reopened-old: a same-id reopen with other disk content keeps that content", async () => {
    const initial = docA()!;
    held.reply("open_file", () => ({
      document: { ...initial, content: "OLD", isModified: false, lastSaved: null },
      recoveredDraft: null,
    }));
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    let reopenReturn: unknown;
    await act(async () => {
      await api.closeDocumentById("doc-a", true);
      reopenReturn = await api.openDocumentFromPath(A_PATH);
    });
    // REOPEN-PRECONDITION("OLD"): the setup reached "reopened under the same id".
    expect(reopenReturn, "REOPEN-PRECONDITION: reopen returned null").not.toBeNull();
    expect(docA(), "REOPEN-PRECONDITION: store").toMatchObject({ content: "OLD", lastSaved: null });
    expect(docAOf(useDocumentStore.getState().documents), "REOPEN-PRECONDITION: tabs").toHaveLength(1);
    expect(held.calls("open_file"), "REOPEN-PRECONDITION: open_file").toHaveLength(1);
    await finish(p, "save_file", ok(A_PATH));
    expect(docA()).toMatchObject({ content: "OLD", lastSaved: SAVED_AT });
    expect(docAOf(useDocumentStore.getState().documents)).toHaveLength(1);
    expect(draftsFor("doc-a")).toEqual([]);
  });

  it("R-reformat: disk gets the formatted snapshot, the store keeps the newer text dirty", async () => {
    resetStores(T0);
    held.reply("get_preferences", () => ({ markdown: { autoReformatTablesOnSave: true } }));
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    await write("doc-a", T0 + "\nNEW\n");
    await finish(p, "save_file", ok(A_PATH));
    const P = held.calls("save_file")[0].content as string;
    expect(P).not.toBe(T0);
    expect(P).toContain("| a   | b   |");
    expect(docA()!.content).toBe(T0 + "\nNEW\n");
    expect(docA()!.isModified).toBe(true);
    expect(draftsFor("doc-a")).toEqual([]);
  });

  const MCP_ROWS = [
    {
      row: "W",
      event: "mcp:write_document",
      payload: { document_id: "doc-a", content: "MCP-REPLACED", window_label: "main" },
      expected: "MCP-REPLACED",
    },
    {
      row: "I",
      event: "mcp:insert_content",
      payload: { document_id: "doc-a", text: "+MCP", position: "end", window_label: "main" },
      expected: "BASE+MCP",
    },
  ];

  it.each(MCP_ROWS)("R-mcp-writer row $row: an MCP write during the await survives", async (r) => {
    held.hold("save_file");
    const { api } = await mountApi(true);
    const p = await start(() => api.saveActiveDocument(), "save_file");
    await mcp(r.event, r.payload);
    await finish(p, "save_file", ok(A_PATH));
    expect(docA()!.content, r.row).toBe(r.expected);
    expect(docA()!.isModified, r.row).toBe(true);
    expect(draftsFor("doc-a"), r.row).toEqual([]);
  });

  it("R-two-writers: source then MCP during the await, the last write wins", async () => {
    held.hold("save_file");
    const { api } = await mountApi(true);
    const p = await start(() => api.saveActiveDocument(), "save_file");
    await write("doc-a", "BASE+S");
    await mcpWrite("MCP-LAST");
    await finish(p, "save_file", ok(A_PATH));
    expect(docA()!.content).toBe("MCP-LAST");
    expect(docA()!.isModified).toBe(true);
    expect(draftsFor("doc-a")).toEqual([]);
  });

  it("R-performSave-dirty: 'Saved' toast and recent files, but the edited doc stays dirty", async () => {
    held.hold("save_file");
    const { api } = await mountApi();
    const showToast = vi.fn();
    const updateRecentFiles = vi.fn();
    const deps = { markSaveInProgress: vi.fn(), saveActiveDocument: api.saveActiveDocument, updateRecentFiles, showToast };
    const p = await start(() => performSave(undefined, deps), "save_file");
    await write("doc-a", "BASE+NEW");
    await finish(p, "save_file", ok(A_PATH));
    expect(showToast.mock.calls).toEqual([["Saved"]]);
    expect(updateRecentFiles.mock.calls).toEqual([[A_PATH]]);
    expect(docA()).toMatchObject({ content: "BASE+NEW", isModified: true });
  });
});

describe("D19 guards — pass before and after the fix", () => {
  it("R-baseline: no writer, the save applies and deletes the draft", async () => {
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    await finish(p, "save_file", ok(A_PATH));
    expect(docA()).toMatchObject({ content: "BASE", isModified: false, path: A_PATH, lastSaved: SAVED_AT });
    expect(held.calls("delete_draft")).toEqual([{ documentId: "doc-a" }]);
  });

  it("R-switched: a tab switch during the await changes nothing but the saved doc", async () => {
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    act(() => { useDocumentStore.getState().setActiveDocumentId("doc-b"); });
    const bBefore = structuredClone(docB());
    await finish(p, "save_file", ok(A_PATH));
    expect(docA()).toMatchObject({ content: "BASE", isModified: false, path: A_PATH, lastSaved: SAVED_AT });
    expect(docB()).toEqual(bBefore);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
    expect(draftsFor("doc-a")).toHaveLength(1);
  });

  it("R-other-doc-edit: an edit to another document does not block the save", async () => {
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    await write("doc-b", "OTHER+X");
    await finish(p, "save_file", ok(A_PATH));
    expect(docA()).toMatchObject({ content: "BASE", isModified: false, lastSaved: SAVED_AT });
    expect(docB()).toMatchObject({ content: "OTHER+X", isModified: true });
    expect(draftsFor("doc-a")).toHaveLength(1);
    expect(draftsFor("doc-b")).toEqual([]);
  });

  it("R-reformat-applied: no race, the store takes the formatted payload and goes clean", async () => {
    resetStores(T0);
    held.reply("get_preferences", () => ({ markdown: { autoReformatTablesOnSave: true } }));
    const { api } = await mountApi();
    await act(async () => { await api.saveActiveDocument(); });
    await settle();
    const P = held.calls("save_file")[0].content;
    expect(P).not.toBe(T0);
    expect(docA()!.content).toBe(P);
    expect(docA()!.isModified).toBe(false);
    expect(draftsFor("doc-a")).toHaveLength(1);
  });

  it("R-src-saveas-routed-nowriter: the routed Save As applies exactly once", async () => {
    resetStores("BASE", null);
    held.hold("save_file_dialog");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file_dialog");
    await finish(p, "save_file_dialog", ok(DIALOG_PATH));
    expect(held.calls("delete_draft")).toEqual([{ documentId: "doc-a" }]);
    expect(docA()).toMatchObject({ content: "BASE", isModified: false, path: DIALOG_PATH, lastSaved: SAVED_AT });
    expect(held.calls("save_file_dialog")).toHaveLength(1);
  });

  it("R-reopened-same: a same-id reopen with the snapshot's content is treated as present", async () => {
    const initial = docA()!;
    held.reply("open_file", () => ({
      document: { ...initial, content: "BASE", isModified: false, lastSaved: null },
      recoveredDraft: null,
    }));
    held.hold("save_file");
    const { api } = await mountApi();
    const p = await start(() => api.saveActiveDocument(), "save_file");
    let reopenReturn: unknown;
    await act(async () => {
      await api.closeDocumentById("doc-a", true);
      reopenReturn = await api.openDocumentFromPath(A_PATH);
    });
    // REOPEN-PRECONDITION("BASE"): the setup reached "reopened under the same id".
    expect(reopenReturn, "REOPEN-PRECONDITION: reopen returned null").not.toBeNull();
    expect(docA(), "REOPEN-PRECONDITION: store").toMatchObject({ content: "BASE", lastSaved: null });
    expect(docAOf(useDocumentStore.getState().documents), "REOPEN-PRECONDITION: tabs").toHaveLength(1);
    expect(held.calls("open_file"), "REOPEN-PRECONDITION: open_file").toHaveLength(1);
    await finish(p, "save_file", ok(A_PATH));
    expect(docA()).toMatchObject({ content: "BASE", isModified: false, lastSaved: SAVED_AT });
    expect(docAOf(useDocumentStore.getState().documents)).toHaveLength(1);
    expect(held.calls("delete_draft")).toEqual([{ documentId: "doc-a" }]);
  });
});

type Entry = { name: string; cmd: string; path: string | null; direct: boolean; expectedPath: string };
const ENTRIES: Entry[] = [
  { name: "save(path)@get_preferences", cmd: "get_preferences", path: A_PATH, direct: false, expectedPath: A_PATH },
  { name: "save(path)@save_file", cmd: "save_file", path: A_PATH, direct: false, expectedPath: A_PATH },
  { name: "save(untitled)@save_file_dialog", cmd: "save_file_dialog", path: null, direct: false, expectedPath: DIALOG_PATH },
  { name: "saveAs(direct)@save_file_dialog", cmd: "save_file_dialog", path: A_PATH, direct: true, expectedPath: DIALOG_PATH },
];
const WRITERS = ["none", "src", "mcp"] as const;
const RELEASE: Record<string, unknown> = {
  get_preferences: { markdown: { autoReformatTablesOnSave: false } },
  save_file: ok(A_PATH),
  save_file_dialog: ok(DIALOG_PATH),
};

describe("D19 R-law-table — L-H1…L-H5 over entry × writer × closedDuring (S5)", () => {
  it("R-law-table: every row keeps the invariants", async () => {
    const hitEntries = new Set<string>();
    const antecedent = new Set<boolean>();
    let rows = 0;
    for (const entry of ENTRIES) {
      for (const writer of WRITERS) {
        for (const closed of [false, true]) {
          const row = `entry=${entry.name} writer=${writer} closed=${closed}`;
          fresh();
          resetStores("BASE", entry.path);
          held.hold(entry.cmd);
          const { api, unmount } = await mountApi(true);
          const run = () => (entry.direct ? api.saveActiveDocumentAs() : api.saveActiveDocument());
          const p = await start(run, entry.cmd);
          const writerText = writer === "src" ? "W-SRC" : writer === "mcp" ? "W-MCP" : null;
          if (writer === "src") await write("doc-a", "W-SRC");
          if (writer === "mcp") await mcpWrite("W-MCP");
          if (closed) await act(async () => { await api.closeDocumentById("doc-a", true); });
          const beforeRelease = useDocumentStore.getState().documents;
          const bBefore = structuredClone(docB());
          await finish(p, entry.cmd, RELEASE[entry.cmd]);

          const ipc = entry.cmd === "get_preferences" ? "save_file" : entry.cmd;
          const payload = held.calls(ipc)[0]?.content;
          const a = docA();
          if (a) {
            antecedent.add(a.isModified === false);
            if (a.isModified === false) expect(a.content, `${row} (I1)`).toBe(payload);
          }
          if (writerText && !closed) expect(a?.content, `${row} (I2)`).toBe(writerText);
          if (!writerText && !closed) {
            expect(a, `${row} (I3)`).toMatchObject({
              isModified: false,
              content: payload,
              lastSaved: SAVED_AT,
              path: entry.expectedPath,
            });
          }
          if (closed) {
            expect(a, `${row} (I4) absent`).toBeUndefined();
            expect(useDocumentStore.getState().documents, `${row} (I4) same ref`).toBe(beforeRelease);
          }
          const expectDraft = !writerText && !closed;
          expect(draftsFor("doc-a"), `${row} (I5)`).toHaveLength(expectDraft ? 1 : 0);
          expect(docB(), `${row} (I6)`).toEqual(bBefore);

          hitEntries.add(entry.name);
          rows += 1;
          unmount();
          held.assertDrained();
        }
      }
    }
    expect(rows, "non-vacuity: 24 rows").toBe(24);
    expect(hitEntries.size, "non-vacuity: every entry hit").toBe(ENTRIES.length);
    expect(antecedent, "non-vacuity: (I1) antecedent both ways").toEqual(new Set([true, false]));
  });
});
