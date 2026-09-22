/**
 * X7 (WI-4, plan-20260922-113723): `useSourceTablesWithheld()` is the
 * subscribing boolean Editor.tsx feeds into its extensions memo.
 *
 * Why a subscription and not a `getState()` read: App's guard effect records
 * the Source verdict AFTER Editor has mounted (effects run after children), so
 * a read with no subscription would never reconfigure the memo and the table
 * extensions would stay installed on a withheld document.
 *
 * Law: after every committed store change, the hook's value equals
 * `isSourceTablesWithheld(editorState, documentStore.activeDocumentId)`, and it
 * renders once per change to the active id or to that id's withheld-ness, and
 * never for an unrelated write.
 *
 * Switching uses `setActiveDocumentId`, not `setActiveDocument`, which returns
 * early for ids missing from `documents` and would make a switch a no-op.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useEditorStore } from "../src/stores/editorStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useSourceTablesWithheld } from "../src/hooks/useSourceTablesWithheld";

beforeEach(() => {
  useEditorStore.setState({ sourceTableVerdicts: {} });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("X7: useSourceTablesWithheld follows the verdict and the active document", () => {
  it("tracks a post-mount verdict, unrelated writes, switches, and an 'allowed' verdict", () => {
    useDocumentStore.getState().setActiveDocumentId("doc-A");

    let renders = 0;
    const values: boolean[] = [];
    const { result } = renderHook(() => {
      renders++;
      return useSourceTablesWithheld();
    });

    // 1. mount, no verdict.
    values.push(result.current);

    // 2. the verdict lands after mount (App's effect order in production).
    act(() => {
      useEditorStore.getState().recordSourceTableVerdict("doc-A", "withheld");
    });
    values.push(result.current);

    // 2b. three writes that touch neither the active id nor its verdict.
    const deltas: number[] = [];
    const measure = (write: () => void) => {
      const before = renders;
      act(write);
      deltas.push(renders - before);
    };
    measure(() => {
      useEditorStore.getState().recordSourceTableVerdict("doc-X", "withheld");
    });
    measure(() => {
      useEditorStore.getState().setActiveDocumentId("doc-Q");
    });
    measure(() => {
      useDocumentStore.setState({ documents: [...useDocumentStore.getState().documents] });
    });

    // 3. switch to a document with no verdict.
    act(() => {
      useDocumentStore.getState().setActiveDocumentId("doc-B");
    });
    values.push(result.current);

    // 4. switch back.
    act(() => {
      useDocumentStore.getState().setActiveDocumentId("doc-A");
    });
    values.push(result.current);

    // 5. an "allowed" verdict must not read as withheld.
    act(() => {
      useEditorStore.getState().recordSourceTableVerdict("doc-C", "allowed");
    });
    act(() => {
      useDocumentStore.getState().setActiveDocumentId("doc-C");
    });
    values.push(result.current);

    expect(values).toEqual([false, true, false, true, false]);
    expect(deltas).toEqual([0, 0, 0]);
    expect(renders).toBe(5);
  });
});
