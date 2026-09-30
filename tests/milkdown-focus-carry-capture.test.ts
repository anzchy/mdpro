/**
 * D37 WI-3 — CAP-1..CAP-4: capture (`snapshotFocusedEditor`) and its wiring into
 * `prepareWholesaleReplace` (snapshot before `reloadEditor`, arm at the post-reload
 * generation, carry forward when the snapshot is null).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md`, §"Unit: capture", plus
 * CAP-4 from "Adversary round 2 — resolutions".
 *
 * A real `MilkdownEditor` is mounted through the store (`milkdownEditorHarness`). Only
 * process boundaries are mocked: `@tauri-apps/api/{core,event,window}`, `loggingService`,
 * and jsdom's missing `IntersectionObserver`.
 *
 * Each table row is applied, measured and reverted in one synchronous block, so React
 * never renders mid-table; `pmEl()` is asserted unchanged afterwards to prove it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import type { Mock } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import {
  armFocusCarry,
  consumeFocusCarry,
  resetFocusCarry,
  snapshotFocusedEditor,
} from "../src/utils/milkdownFocusCarry";
import { prepareWholesaleReplace } from "../src/utils/wholesaleReplace";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { makeDoc, mountAndWait, resetStores, sleep, viewOf } from "./helpers/milkdownEditorHarness";
import { gen, placeCaret, pmEl, restoreLogs } from "./helpers/focusCarryD37Fixture";

const CASE_TIMEOUT_MS = 20_000;
const TABLE_ROWS = 16;
/** Between "Hello " and "world" in "Hello world". */
const CARET = 7;
const RANGE_ANCHOR = 3;
const RANGE_HEAD = 8;
const SENTINEL_HEAD = 2;

const logSpy = loggingService.logEventSync as Mock;
let unmountEditor: (() => void) | null = null;

interface Row {
  active: boolean;
  wysiwyg: boolean;
  registered: boolean;
  focused: boolean;
}

const rowOf = (mask: number): Row => ({
  active: (mask & 1) !== 0,
  wysiwyg: (mask & 2) !== 0,
  registered: (mask & 4) !== 0,
  focused: (mask & 8) !== 0,
});

/** Set the four guard inputs; asserts the focus precondition untagged (harness). */
function applyRow(view: EditorView, row: Row, realGetter: () => unknown): void {
  useDocumentStore.setState({ activeDocumentId: row.active ? "doc-a" : "doc-b" });
  useEditorStore.setState({ viewMode: row.wysiwyg ? "wysiwyg" : "source" });
  useMilkdownEditorStore.setState({ getEditor: row.registered ? realGetter : () => null });
  if (row.focused) view.focus();
  else view.dom.blur();
  expect(view.hasFocus(), "harness: focus precondition").toBe(row.focused);
}

function revertRow(view: EditorView, realGetter: () => unknown): void {
  applyRow(view, { active: true, wysiwyg: true, registered: true, focused: true }, realGetter);
}

async function mountFocused(): Promise<{ view: EditorView; realGetter: () => unknown }> {
  const mounted = await mountAndWait();
  unmountEditor = mounted.unmount;
  const view = viewOf(mounted.instance);
  placeCaret(view, CARET);
  expect(view.hasFocus(), "harness: the view has focus").toBe(true);
  return { view, realGetter: useMilkdownEditorStore.getState().getEditor };
}

beforeEach(() => {
  installIntersectionObserverDouble();
  resetFocusCarry();
  resetStores([makeDoc("doc-a", "Hello world", "/tmp/a.md"), makeDoc("doc-b", "Other")]);
  useEditorStore.setState({ editorView: null });
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(async () => {
  resetFocusCarry();
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D37 focus capture", { timeout: CASE_TIMEOUT_MS }, () => {
  it("CAP-1 a snapshot exists only when active, wysiwyg, registered and focused", async () => {
    const { view, realGetter } = await mountFocused();
    const pm = pmEl();
    logSpy.mockClear();
    const got: boolean[] = [];
    for (let mask = 0; mask < TABLE_ROWS; mask++) {
      applyRow(view, rowOf(mask), realGetter);
      const s = snapshotFocusedEditor("doc-a");
      got.push(s !== null);
      if (s) {
        expect(s.oldDoc).toBe(view.state.doc);
        expect(s.head).toBe(view.state.selection.head);
        expect(s.documentId).toBe("doc-a");
      }
      revertRow(view, realGetter);
    }
    const expected = Array.from({ length: TABLE_ROWS }, (_, m) => m === TABLE_ROWS - 1);
    expect(got).toEqual(expected);
    expect(pmEl(), "harness: no render during the table").toBe(pm);
    expect(restoreLogs(logSpy)).toEqual([]);
  });

  it("CAP-2 a range selection collapses to its head", async () => {
    const { view } = await mountFocused();
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, RANGE_ANCHOR, RANGE_HEAD))
        .setMeta("addToHistory", false),
    );
    expect(snapshotFocusedEditor("doc-a")?.head).toBe(RANGE_HEAD);
  });

  it("CAP-3 prepareWholesaleReplace arms at the post-reload generation with the pre-replace doc", async () => {
    const { view } = await mountFocused();
    const gen0Doc = view.state.doc;
    logSpy.mockClear();
    prepareWholesaleReplace("doc-a", "mcp-write");
    prepareWholesaleReplace("doc-a", "mcp-write");
    expect(gen("doc-a")).toBe(2);
    expect(consumeFocusCarry("doc-a", 1)).toBeNull();
    const r = consumeFocusCarry("doc-a", 2);
    expect(r?.oldDoc).toBe(gen0Doc);
    expect(r?.head).toBe(CARET);
    expect(r?.reason).toBe("mcp-write");
    expect(r?.generation).toBe(2);
    const reloads = logSpy.mock.calls
      .map((c) => c[0] as { event: string; context?: unknown })
      .filter((e) => e.event === "editor.milkdown.reload")
      .map((e) => e.context);
    expect(reloads).toEqual([
      { reason: "mcp-write", documentId: "doc-a", generation: 1, droppedPendingEdit: false },
      { reason: "mcp-write", documentId: "doc-a", generation: 2, droppedPendingEdit: false },
    ]);
    expect(restoreLogs(logSpy).map((e) => [e.context?.outcome, e.context?.generation])).toEqual([
      ["skipped:superseded", 1],
    ]);
  });

  it("CAP-4 prepareWholesaleReplace carries a live record forward only when active, wysiwyg and no snapshot", async () => {
    const { view, realGetter } = await mountFocused();
    const pm = pmEl();
    const sentinel = view.state.doc.type.create(view.state.doc.attrs, view.state.doc.content);
    expect(sentinel, "harness: sentinel is a distinct node").not.toBe(view.state.doc);
    const got: string[] = [];
    for (let mask = 0; mask < TABLE_ROWS; mask++) {
      const row = rowOf(mask);
      const g = gen("doc-a");
      resetFocusCarry();
      applyRow(view, row, realGetter);
      armFocusCarry({ documentId: "doc-a", head: SENTINEL_HEAD, oldDoc: sentinel }, "mcp-insert", g);
      prepareWholesaleReplace("doc-a", "mcp-insert");
      const liveDoc = view.state.doc;
      revertRow(view, realGetter);
      const atOld = consumeFocusCarry("doc-a", g);
      const atNew = consumeFocusCarry("doc-a", g + 1);
      if (atOld?.oldDoc === sentinel && atNew === null) got.push("untouched");
      else if (atOld === null && atNew?.oldDoc === sentinel && atNew.head === SENTINEL_HEAD) {
        got.push("carried");
      } else if (atOld === null && atNew?.oldDoc === liveDoc) got.push("fresh");
      else got.push("other");
    }
    const expected = Array.from({ length: TABLE_ROWS }, (_, m) => {
      const r = rowOf(m);
      if (!r.active || !r.wysiwyg) return "untouched";
      return r.registered && r.focused ? "fresh" : "carried";
    });
    expect(got).toEqual(expected);
    expect(pmEl(), "harness: no render during the table").toBe(pm);
  });
});
