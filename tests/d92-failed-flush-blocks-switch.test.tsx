/**
 * D92 (BLOCK, data loss) — a failed WYSIWYG flush must refuse the transition.
 *
 * Before the fix, a tab switch (`documentStore.setActiveDocumentId`) and leaving
 * WYSIWYG (`editorStore.setViewMode` / `cycleViewMode`) ignored a `failed` flush and
 * went ahead: the Milkdown editor unmounted, its destroy flush failed too, and the
 * document came back from the stale store content — every edit since the last good
 * write was lost with a warn log only.
 *
 * Real `MilkdownEditor`, real edit-sync plugin, real serializer, real stores, real
 * `useDocument`. The failure is injected at the serializer boundary: a bullet list
 * whose only item has no content makes the real markdown serializer throw. (This
 * suite first used a table whose header row has no cells, the shape the D90 drop
 * left behind; D100 made the editor repair that shape on every transaction.)
 * Deleting that list heals the serializer. Only process boundaries are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
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
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useDocument } from "../src/hooks/useDocument";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore, userViewModeCommands } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
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
/** Literal copy (not imported) so this file runs, and fails, before the constants exist. */
const TAB_SWITCH_FLUSH_FAILED_TOAST = "Editor changes could not be captured; stayed on this document";
const VIEW_MODE_FLUSH_FAILED_TOAST = "Editor changes could not be captured; stayed in WYSIWYG";
const PAST_EDIT_SYNC_DELAY_MS = 300;

type DocumentApi = ReturnType<typeof useDocument>;
let api: DocumentApi | null = null;
function Probe() {
  api = useDocument();
  return null;
}

let unmountEditor: (() => void) | null = null;

async function mountEditor(): Promise<Editor> {
  const { instance, unmount } = await mountAndWait(
    <>
      <MilkdownEditor />
      <Probe />
    </>,
  );
  unmountEditor = unmount;
  return instance;
}

/** Append a bullet list whose only item is empty: the real serializer throws on it. */
function breakSerializer(instance: Editor): void {
  const view = viewOf(instance);
  const s = view.state.schema;
  const list = s.nodes.bullet_list.create(null, [s.nodes.list_item.create(null, [])]);
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, list));
}

/** Delete every bullet list again: the serializer is healthy afterwards. */
function healSerializer(instance: Editor): void {
  const view = viewOf(instance);
  const ranges: Array<[number, number]> = [];
  view.state.doc.forEach((node, offset) => {
    if (node.type.name === "bullet_list") ranges.push([offset, offset + node.nodeSize]);
  });
  let tr = view.state.tr;
  for (const [from, to] of ranges.reverse()) tr = tr.delete(from, to);
  view.dispatch(tr);
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

/** A user edit at the very start of the first paragraph (typed after the break). */
function typeAtStart(instance: Editor, text: string): void {
  const view = viewOf(instance);
  view.dispatch(view.state.tr.insertText(text, 1));
}

const editorText = (instance: Editor) => viewOf(instance).state.doc.textContent;
const activeIds = () => [
  useDocumentStore.getState().activeDocumentId,
  useEditorStore.getState().activeDocumentId,
];

type LogPayload = { level: string; event: string; status: string; context?: Record<string, unknown> };
const logs = (event: string, status: string): LogPayload[] =>
  vi
    .mocked(loggingService.logEventSync)
    .mock.calls.map(([p]) => p as LogPayload)
    .filter((p) => p.event === event && p.status === status);

/** Edit, break the serializer, edit again: two unsaved edits the store never got. */
async function editIntoFailure(instance: Editor): Promise<void> {
  await act(async () => {
    typeAtEnd(instance, "EDIT1");
    breakSerializer(instance);
    typeAtStart(instance, "LATER");
  });
  expect(serializerThrows(instance)).toBe(true);
}

beforeEach(() => {
  api = null;
  unmountEditor = null;
  installIntersectionObserverDouble();
  resetStores([makeDoc("doc-a", "Hello world"), makeDoc("doc-b", "Other")]);
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

describe("D92 — a failed flush refuses the tab switch", () => {
  it(
    "D92-T1 switching tabs with a failing serializer stays on the document, keeps the edits, and the switch succeeds once healed",
    async () => {
      const instance = await mountEditor();
      await editIntoFailure(instance);

      await act(async () => {
        api!.setActiveDocumentById("doc-b");
      });

      // Refused: both stores still name doc-a, the same editor is still mounted.
      expect(activeIds()).toEqual(["doc-a", "doc-a"]);
      expect(useMilkdownEditorStore.getState().getEditor()).toBe(instance);
      expect(document.querySelector(".ProseMirror")).not.toBeNull();
      expect(editorText(instance)).toContain("EDIT1");
      expect(editorText(instance)).toContain("LATER");
      // The store was never handed stale-over-fresh content.
      expect(docById("doc-a")!.content).toBe("Hello world");
      expect(useToastStore.getState().message).toBe(TAB_SWITCH_FLUSH_FAILED_TOAST);
      const refusals = logs("tab.switch", "fail");
      expect(refusals).toHaveLength(1);
      expect(refusals[0].level).toBe("warn");
      expect(refusals[0].context).toMatchObject({
        cause: "flush-failed",
        fromDocumentId: "doc-a",
        toDocumentId: "doc-b",
      });
      expect(logs("tab.switch", "success")).toHaveLength(0);

      // The debounce timer fires (and fails) without moving anything.
      await sleep(PAST_EDIT_SYNC_DELAY_MS);
      expect(activeIds()).toEqual(["doc-a", "doc-a"]);
      expect(useMilkdownEditorStore.getState().getEditor()).toBe(instance);

      // Heal the serializer: the next switch flushes every edit, then switches.
      await act(async () => {
        healSerializer(instance);
      });
      expect(serializerThrows(instance)).toBe(false);
      await act(async () => {
        api!.setActiveDocumentById("doc-b");
      });
      expect(activeIds()).toEqual(["doc-b", "doc-b"]);
      expect(docById("doc-a")!.content).toContain("EDIT1");
      expect(docById("doc-a")!.content).toContain("LATER");
      expect(docById("doc-a")!.isModified).toBe(true);
    },
    LONG_CASE_MS,
  );

  it(
    "D92-T2 control: a healthy editor switches tabs and its edit reaches the store, no toast",
    async () => {
      const instance = await mountEditor();
      await act(async () => {
        typeAtEnd(instance, "FINE");
        api!.setActiveDocumentById("doc-b");
      });
      expect(activeIds()).toEqual(["doc-b", "doc-b"]);
      expect(docById("doc-a")!.content).toContain("FINE");
      expect(useToastStore.getState().message).toBeNull();
      expect(logs("tab.switch", "fail")).toHaveLength(0);
    },
    LONG_CASE_MS,
  );
});

describe("D92 — a failed flush refuses leaving WYSIWYG", () => {
  it(
    "D92-V1 ⌃2 / cycle / a programmatic switch all stay in WYSIWYG with the edits; healed, ⌃2 flushes them into the store",
    async () => {
      const instance = await mountEditor();
      await editIntoFailure(instance);
      const choiceBefore = useEditorStore.getState().userViewModeChoice;

      await act(async () => {
        userViewModeCommands.set("source"); // ⌃2
      });
      expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
      expect(useEditorStore.getState().userViewModeChoice).toBe(choiceBefore);
      expect(useToastStore.getState().message).toBe(VIEW_MODE_FLUSH_FAILED_TOAST);

      await act(async () => {
        userViewModeCommands.cycle();
      });
      expect(useEditorStore.getState().viewMode).toBe("wysiwyg");

      // The large-document degrade's programmatic switch: refused once, no retry.
      await act(async () => {
        useEditorStore.getState().setViewMode("source");
      });
      expect(useEditorStore.getState().viewMode).toBe("wysiwyg");

      const refusals = logs("view.mode.change", "fail");
      expect(refusals).toHaveLength(3);
      for (const r of refusals) {
        expect(r.level).toBe("warn");
        expect(r.context).toMatchObject({ cause: "flush-failed", fromMode: "wysiwyg", toMode: "source" });
      }
      expect(refusals.map((r) => r.context?.source)).toEqual([
        "setViewMode",
        "cycleViewMode",
        "setViewMode",
      ]);
      expect(refusals.map((r) => r.context?.intent)).toEqual(["user", "user", "programmatic"]);
      expect(logs("view.mode.change", "success")).toHaveLength(0);

      expect(useMilkdownEditorStore.getState().getEditor()).toBe(instance);
      expect(editorText(instance)).toContain("EDIT1");
      expect(editorText(instance)).toContain("LATER");
      expect(docById("doc-a")!.content).toBe("Hello world");
      expect(activeIds()).toEqual(["doc-a", "doc-a"]);

      await act(async () => {
        healSerializer(instance);
      });
      await act(async () => {
        userViewModeCommands.set("source");
      });
      expect(useEditorStore.getState().viewMode).toBe("source");
      expect(docById("doc-a")!.content).toContain("EDIT1");
      expect(docById("doc-a")!.content).toContain("LATER");
    },
    LONG_CASE_MS,
  );

  it(
    "D92-V2 control: a healthy editor leaves WYSIWYG and its edit reaches the store, no toast",
    async () => {
      const instance = await mountEditor();
      await act(async () => {
        typeAtEnd(instance, "FINE");
        userViewModeCommands.set("source");
      });
      expect(useEditorStore.getState().viewMode).toBe("source");
      expect(docById("doc-a")!.content).toContain("FINE");
      expect(useToastStore.getState().message).toBeNull();
      expect(logs("view.mode.change", "fail")).toHaveLength(0);
    },
    LONG_CASE_MS,
  );
});
