/**
 * D97 — the tab-strip × must not silently drop WYSIWYG content the store lacks.
 *
 * `BottomTabs.handleClose` prompts only when `doc.isModified` is already true; it does
 * not flush first (⌘W goes through `activeDocumentAfterFlush`). The question is whether
 * a failed WYSIWYG flush can leave unflushed editor content behind a clean
 * (`isModified === false`) document, so × closes it without a prompt.
 *
 * Real `MilkdownEditor`, real edit-sync plugin, real serializer, real stores, real
 * `useDocument`, real `BottomTabs` wired exactly as `src/App.tsx` wires it
 * (`onClose={closeDocumentById}`). The serializer failure is the real one from D92: a
 * table whose header row has no cells makes the markdown serializer throw. Only
 * process boundaries (`@tauri-apps/api/*`, the logging sink) are mocked.
 *
 * Every case asserts the SAFE behaviour: clicking × either shows the "Unsaved
 * changes" prompt or leaves the document open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { saveHold } = vi.hoisted(() => ({
  saveHold: { release: null as null | ((v: unknown) => void), called: false },
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "save_file") {
      saveHold.called = true;
      return new Promise((resolve) => {
        saveHold.release = resolve;
      });
    }
    if (cmd === "close_document") return { success: true, documentId: args?.documentId };
    return null;
  }),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Editor } from "@milkdown/kit/core";
import { serializerCtx } from "@milkdown/kit/core";
import type { Transaction } from "@milkdown/kit/prose/state";
import { BottomTabs } from "../src/components/BottomTabs/BottomTabs";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useToastStore } from "../src/stores/toastStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import {
  docById,
  makeDoc,
  mountAndWait,
  resetStores,
  sleep,
  typeAtEnd,
  viewOf,
} from "./helpers/milkdownEditorHarness";

const LONG_CASE_MS = 60_000;
const PAST_EDIT_SYNC_DELAY_MS = 300;
const SAVED_AT = 1_700_000_000_000;
const A_PATH = "/tmp/a.md";
const B_PATH = "/tmp/b.md";

type DocumentApi = ReturnType<typeof useDocument>;
let api: DocumentApi | null = null;

/** The App.tsx wiring of the tab strip: real `useDocument`, real `BottomTabs`. */
function TabStrip() {
  const docApi = useDocument();
  api = docApi;
  return (
    <BottomTabs
      documents={docApi.documents}
      activeDocumentId={docApi.activeDocument?.id ?? null}
      onSelect={docApi.setActiveDocumentById}
      onClose={docApi.closeDocumentById}
      onNewDocument={docApi.createDocument}
    />
  );
}

let unmountEditor: (() => void) | null = null;

async function mountEditorAndTabs(): Promise<Editor> {
  const { instance, unmount } = await mountAndWait(
    <>
      <MilkdownEditor />
      <TabStrip />
    </>,
  );
  unmountEditor = unmount;
  return instance;
}

/** A transaction appending a table whose header row has no cells (serializer throws). */
function breakingTr(instance: Editor): Transaction {
  const view = viewOf(instance);
  const s = view.state.schema;
  const cell = s.nodes.table_cell.create(null, s.nodes.paragraph.create(null, s.text("LOSTCELL")));
  const table = s.nodes.table.create(null, [
    s.nodes.table_header_row.create(null, []),
    s.nodes.table_row.create(null, [cell]),
  ]);
  return view.state.tr.insert(view.state.doc.content.size, table);
}

function serializerThrows(instance: Editor): boolean {
  const serialize = instance.action((ctx) => ctx.get(serializerCtx));
  try {
    serialize(viewOf(instance).state.doc);
    return false;
  } catch {
    return true;
  }
}

/** Click the × of the tab whose file name is `name`. */
async function clickTabClose(name: string): Promise<void> {
  const tab = screen.getByRole("button", { name: new RegExp(name.replace(".", "\\.")) });
  const closeX = within(tab).getByRole("button", { name: "×" });
  await act(async () => {
    await userEvent.click(closeX);
  });
  await sleep(50);
}

const unsavedPrompt = () => screen.queryByRole("dialog", { name: "Unsaved changes" });
const docAStillOpen = () => docById("doc-a") !== undefined;

beforeEach(() => {
  api = null;
  unmountEditor = null;
  saveHold.release = null;
  saveHold.called = false;
  installIntersectionObserverDouble();
  resetStores([makeDoc("doc-a", "Hello world", A_PATH), makeDoc("doc-b", "Other", B_PATH)]);
  useEditorStore.setState({
    activeDocumentId: "doc-a",
    viewMode: "wysiwyg",
    userViewModeChoice: { seq: 0, mode: "wysiwyg" },
  });
  useToastStore.getState().clearToast();
});

afterEach(async () => {
  if (unmountEditor) {
    unmountEditor();
    await sleep(100);
  }
  useToastStore.getState().clearToast();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D97 path A — a user edit that breaks the serializer on a clean document", () => {
  it(
    "D97-A1 the breaking user edit marks the document dirty, so × prompts and the document stays open",
    async () => {
      const instance = await mountEditorAndTabs();
      expect(docById("doc-a")!.isModified).toBe(false);

      await act(async () => {
        viewOf(instance).dispatch(breakingTr(instance)); // history-carrying = user edit
      });
      await sleep(PAST_EDIT_SYNC_DELAY_MS); // the debounce write fails
      expect(serializerThrows(instance)).toBe(true);
      expect(docById("doc-a")!.content).toBe("Hello world"); // store never got it
      expect(docById("doc-a")!.isModified).toBe(true);

      await clickTabClose("a.md");

      expect(unsavedPrompt()).not.toBeNull();
      expect(docAStillOpen()).toBe(true);
      expect(viewOf(instance).state.doc.textContent).toContain("LOSTCELL");
    },
    LONG_CASE_MS,
  );

  it(
    "D97-A2 a breaking edit made while a save is in flight keeps the document dirty after the save lands, so × prompts",
    async () => {
      const instance = await mountEditorAndTabs();
      await act(async () => {
        typeAtEnd(instance, "EDIT1");
      });
      let savePromise: Promise<unknown> | null = null;
      await act(async () => {
        savePromise = api!.saveActiveDocument();
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(saveHold.called).toBe(true));
      expect(docById("doc-a")!.content).toContain("EDIT1");

      // The user edits during the save's await: no clean→dirty edge (already dirty).
      await act(async () => {
        viewOf(instance).dispatch(breakingTr(instance));
      });
      expect(serializerThrows(instance)).toBe(true);

      await act(async () => {
        saveHold.release!({ success: true, path: A_PATH, savedAt: SAVED_AT });
        await savePromise;
      });
      await sleep(PAST_EDIT_SYNC_DELAY_MS);
      expect(docById("doc-a")!.isModified).toBe(true);

      await clickTabClose("a.md");

      expect(unsavedPrompt()).not.toBeNull();
      expect(docAStillOpen()).toBe(true);
    },
    LONG_CASE_MS,
  );
});

describe("D97 path B — a history-less (non-user) change that breaks the serializer", () => {
  it(
    "D97-B1 a history-less transaction inserting the serializer-breaking table still dirties the document (prosemirror-tables' fix-tables append is history-carrying), so × prompts",
    async () => {
      const instance = await mountEditorAndTabs();
      expect(docById("doc-a")!.isModified).toBe(false);

      // Tag the breaking insert as non-user. The table plugin's `fixTables`
      // appendTransaction still rewrites the malformed table in the same batch, and that
      // appended transaction carries no `addToHistory: false`, so edit-sync's batch
      // classification (plugin.ts: any history-carrying doc change) sees a user edit.
      await act(async () => {
        viewOf(instance).dispatch(breakingTr(instance).setMeta("addToHistory", false));
      });
      await sleep(PAST_EDIT_SYNC_DELAY_MS); // the debounce write fails
      expect(serializerThrows(instance)).toBe(true);
      expect(docById("doc-a")!.content).toBe("Hello world");
      expect(docById("doc-a")!.isModified).toBe(true);

      await clickTabClose("a.md");

      expect(unsavedPrompt()).not.toBeNull();
      expect(docAStillOpen()).toBe(true);
      expect(viewOf(instance).state.doc.textContent).toContain("LOSTCELL");
    },
    LONG_CASE_MS,
  );
});
