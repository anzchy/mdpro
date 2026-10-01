/**
 * D40 P6 — a write-guard refusal in the mounted Source editor falls through to
 * the wrapper's default indent instead of swallowing Tab.
 *
 * Plan: `.claude/tdd-guardian/plan-20261001-231949.md`; matrix:
 * `.claude/tdd-guardian/tests-20261001-231949.md` (case P6).
 *
 * Own-module mock exception (policy-core rule 4): `tableWriteGuard` is mocked as a
 * PASSTHROUGH with a single forced refusal, because no real document passes the
 * `getTableContext` gate and then fails `refuseTableWrite` (module header,
 * `src/utils/tableWriteGuard.ts`). The real-guard pair is
 * `tests/table-write-guard.test.ts` "falls back to the default Tab handler and
 * writes nothing". Kept in its own file because `vi.mock` is file-scoped and the
 * D40 RED file must carry no own-module mocks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../src/utils/tableWriteGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableWriteGuard")>();
  return { ...actual, guardTableWrite: vi.fn(actual.guardTableWrite) };
});

import { cleanup, render } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { getIndentUnit } from "@codemirror/language";
import { Editor } from "../src/components/Editor/Editor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { guardTableWrite } from "../src/utils/tableWriteGuard";
import { D12_FIXTURES } from "./support/tableSpanOracle";

const { T3 } = D12_FIXTURES;
const T3_LINE1_INDENTED = "    | a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n";
const DOC_ID = "doc-1";

let unmountEditor: (() => void) | null = null;

function mountEditor(doc: string): EditorView {
  useDocumentStore.setState({ activeDocumentId: DOC_ID });
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {} });
  unmountEditor = render(<Editor value={doc} onChange={vi.fn()} />).unmount;
  const view = useEditorStore.getState().editorView;
  // Harness preconditions, kept apart from the behaviour assertion.
  expect(view).not.toBeNull();
  expect(view!.state.doc.toString()).toBe(doc);
  expect(getIndentUnit(view!.state)).toBe(4);
  expect(view!.state.facet(EditorView.editable)).toBe(true);
  return view!;
}

afterEach(() => {
  unmountEditor?.();
  unmountEditor = null;
  cleanup();
  vi.mocked(guardTableWrite).mockReset();
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {} });
  useDocumentStore.setState({ activeDocumentId: null });
});

describe("D40 — table Tab write-guard refusal", () => {
  it("P6: a write-guard refusal falls through to indent", () => {
    const view = mountEditor(T3);
    view.dispatch({ selection: EditorSelection.cursor(2) });
    vi.mocked(guardTableWrite).mockReturnValueOnce(false);

    const handled = runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: false }),
      "editor",
    );

    expect({
      handled,
      head: view.state.selection.main.head,
      doc: view.state.doc.toString(),
    }).toEqual({ handled: true, head: 6, doc: T3_LINE1_INDENTED });
    // L6 supplement only: the refusal, not the gate, caused the fall-through.
    expect(vi.mocked(guardTableWrite)).toHaveBeenCalledWith(
      expect.objectContaining({ start: 0 }),
      "source.tab_nav",
    );
  });
});
