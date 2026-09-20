/**
 * Purpose: matrix §3 **case V-8b** — the acceptance criterion of plan amendment **A-2**:
 * `src/hooks/useTOC.ts`'s source-mode navigate path must **import**
 * `SPY_ANCHOR_OFFSET_PX` rather than re-declare the literal `40`.
 *
 * ---------------------------------------------------------------------------
 * Why this is a whole file for one assertion
 * ---------------------------------------------------------------------------
 * `vi.mock` is **file-scoped**. V-8 (in `tests/codemirror-viewport-line.test.ts`) asserts
 * the dispatched `yMargin` equals the *real* constant; this case asserts it *tracks* the
 * constant by overriding it to `137`. Both in one file and the mock would poison V-8.
 *
 * ---------------------------------------------------------------------------
 * Why V-8 alone is not enough — the bug A-2 exists to prevent
 * ---------------------------------------------------------------------------
 * V-8 passes against a hardcoded `yMargin: 40`, because the literal and the constant
 * happen to agree today. Two copies of 40 that must agree **is** the defect: the spy
 * samples at `rect.top + SPY_ANCHOR_OFFSET_PX`, the navigate scrolls the heading to
 * `yMargin` from the top, and the scroll the navigate itself causes re-fires the spy. If
 * the two numbers ever drift, a click snaps the highlight away from the entry the user
 * just clicked — the exact failure amendment A-1 was written to prevent. **This is the
 * only assertion in the matrix that can fail while `useTOC.ts` keeps the literal.**
 *
 * Mock boundary: the constants module, **deliberately**. The mock target *is* the
 * acceptance criterion, not a collaborator being stubbed out of the way. Paired
 * integration test: n/a — there is no browser behaviour here, only a wiring fact.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { StateEffect, StateEffectType, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

vi.mock("../src/utils/codemirrorViewportLine", async (importActual) => {
  const actual =
    await importActual<typeof import("../src/utils/codemirrorViewportLine")>();
  return { ...actual, SPY_ANCHOR_OFFSET_PX: 137 };
});

import { useTOC } from "../src/hooks/useTOC";
import { useTOCStore } from "../src/stores/tocStore";
import { useEditorStore } from "../src/stores/editorStore";
import type { HeadingKey, TOCEntry } from "../src/types/toc";
import { captureScrollReceivers } from "./helpers/scrollReceiver";

interface ScrollTargetLike {
  range: { from: number; to: number };
  y: string;
  yMargin: number;
}

const SCROLL_EFFECT_TYPE = (
  EditorView.scrollIntoView(0) as unknown as { type: StateEffectType<ScrollTargetLike> }
).type;

const SOURCE_CONTAINER_ID = "source-container";
const MOCKED_OFFSET = 137;
const realSetEntries = useTOCStore.getState().setEntries;

describe("§3 V-8b: the navigate path imports the anchor constant", () => {
  let captured: Transaction[] = [];
  let views: EditorView[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    captured = [];
    views = [];
    captureScrollReceivers();
    useTOCStore.setState({
      entries: [],
      documentId: null,
      activeEntryId: null,
      isVisible: false,
      collapsedIds: new Set<HeadingKey>(),
      byDocument: new Map(),
      setEntries: realSetEntries,
    });
    useEditorStore.setState({ editorView: null });
  });

  afterEach(() => {
    for (const view of views) view.destroy();
    views = [];
    document.getElementById(SOURCE_CONTAINER_ID)?.remove();
    useEditorStore.setState({ editorView: null });
    vi.useRealTimers();
  });

  it("V-8b: overriding SPY_ANCHOR_OFFSET_PX changes the dispatched yMargin", async () => {
    // Wrong-reason guard: prove the module mock is actually in effect. Without this the
    // case could pass vacuously if the mock path ever stopped matching.
    const mod = await import("../src/utils/codemirrorViewportLine");
    expect(mod.SPY_ANCHOR_OFFSET_PX, "V-8b: the module mock must be live").toBe(
      MOCKED_OFFSET,
    );

    const container = document.createElement("div");
    container.id = SOURCE_CONTAINER_ID;
    document.body.appendChild(container);

    const content = "# One\n\nbody\n\n## Two\n\nmore body\n\n# Three";
    const view = new EditorView({
      state: EditorState.create({ doc: content }),
      dispatch: (tr, self) => {
        captured.push(tr);
        self.update([tr]);
      },
    });
    views.push(view);
    useEditorStore.setState({ editorView: view });

    const { result } = renderHook(() =>
      useTOC({
        content,
        documentId: "doc-v8b",
        containerId: SOURCE_CONTAINER_ID,
        viewMode: "source",
        enableSpyScrolling: false,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const list: TOCEntry[] = useTOCStore.getState().entries;
    expect(list).toHaveLength(3);
    expect(new Set(list.map((e) => e.key)).size, "V-8b: H2").toBe(list.length);

    act(() => {
      result.current.navigateToEntry(list[0].key);
    });

    const targets = captured.flatMap((tr) =>
      tr.effects
        .filter((e: StateEffect<unknown>): e is StateEffect<ScrollTargetLike> =>
          e.is(SCROLL_EFFECT_TYPE),
        )
        .map((e) => e.value),
    );
    expect(targets, "V-8b: exactly one scroll effect").toHaveLength(1);
    // Fails while `useTOC.ts` keeps `yMargin: 40`.
    expect(targets[0].yMargin).toBe(MOCKED_OFFSET);
  });
});
