/**
 * D261-WI-1c: `src/stores/editorGeneration.ts`, the counter a menu-target token
 * pins. It must move whenever the editor a token was captured against might no
 * longer be the editor in front of the user, and never otherwise.
 *
 * Law (S5): the generation never decreases, and over any event sequence its
 * delta equals the number of events that change the identity of one of
 * `documentStore.activeDocumentId`, `editorStore.editorView` or the Milkdown
 * getter in `milkdownEditorStore`. Teardown (a view set to null, an unregister)
 * is an identity change and bumps (delegator ruling, 2026-10-17). Content,
 * selection, view-mode and same-identity events add zero.
 *
 * Tests read deltas, never absolute values: no reset seam in production.
 *
 * Mock boundary: `@tauri-apps/api/core` only (the stores log through `invoke`).
 * The three stores are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: async () => null }),
);

import { getEditorGeneration } from "../src/stores/editorGeneration";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { applyGenEvent, GEN_EVENTS, newView, seedStores, type Shadow } from "./support/editorGenerationDomain";
import { genSequence, mulberry32 } from "./support/seededSequences";

let shadow: Shadow;

beforeEach(() => {
  shadow = seedStores();
});

/** The generation delta `step` causes. */
const delta = (step: () => void): number => {
  const before = getEditorGeneration();
  step();
  return getEditorGeneration() - before;
};

describe("editorGeneration: each bump-class event adds exactly one (S2)", () => {
  it("a switch to another open document", () => {
    expect(delta(() => useDocumentStore.getState().setActiveDocument("d2"))).toBe(1);
  });

  it("a new CodeMirror view, then its teardown to null", () => {
    expect(delta(() => useEditorStore.getState().setEditorView(newView()))).toBe(1);
    expect(delta(() => useEditorStore.getState().setEditorView(null))).toBe(1);
  });

  it("a Milkdown getter registered, then unregistered", () => {
    expect(delta(() => void useMilkdownEditorStore.getState().registerEditor(() => "editor"))).toBe(1);
    expect(delta(() => useMilkdownEditorStore.getState().unregisterEditor())).toBe(1);
  });

  it("a registration's own cleanup is a teardown and bumps", () => {
    const cleanup = useMilkdownEditorStore.getState().registerEditor(() => "editor");
    expect(delta(cleanup)).toBe(1);
  });

  it("a switch whose activeDocumentId is set directly (setState) bumps too", () => {
    expect(delta(() => useDocumentStore.setState({ activeDocumentId: "d2" }))).toBe(1);
    expect(delta(() => useDocumentStore.setState({ activeDocumentId: null }))).toBe(1);
  });

  it("each of the three steps in a row adds one each", () => {
    const before = getEditorGeneration();
    useDocumentStore.getState().setActiveDocument("d2");
    expect(getEditorGeneration() - before).toBe(1);
    useEditorStore.getState().setEditorView(newView());
    expect(getEditorGeneration() - before).toBe(2);
    useMilkdownEditorStore.getState().registerEditor(() => "editor");
    expect(getEditorGeneration() - before).toBe(3);
  });
});

describe("editorGeneration: content, selection and same-identity events add zero (S3)", () => {
  it("typing into the active document", () => {
    expect(delta(() => useDocumentStore.getState().updateDocumentContent("d1", "x"))).toBe(0);
  });

  it("cursor and selection updates", () => {
    expect(delta(() => useEditorStore.getState().setCursor({ line: 3, column: 4 }))).toBe(0);
    expect(
      delta(() =>
        useEditorStore.getState().setSelection({ anchor: { line: 0, column: 0 }, head: { line: 0, column: 2 } }),
      ),
    ).toBe(0);
  });

  it("re-activating the active document", () => {
    expect(delta(() => useDocumentStore.getState().setActiveDocument("d1"))).toBe(0);
  });

  it("setting the same view twice: the second adds zero", () => {
    const view = newView();
    expect(delta(() => useEditorStore.getState().setEditorView(view))).toBe(1);
    expect(delta(() => useEditorStore.getState().setEditorView(view))).toBe(0);
  });

  it("registering the same getter instance twice: the second adds zero", () => {
    const getter = () => "editor";
    expect(delta(() => void useMilkdownEditorStore.getState().registerEditor(getter))).toBe(1);
    expect(delta(() => void useMilkdownEditorStore.getState().registerEditor(getter))).toBe(0);
  });

  it("unregistering when nothing is registered, and null over null", () => {
    expect(delta(() => useMilkdownEditorStore.getState().unregisterEditor())).toBe(0);
    expect(delta(() => useEditorStore.getState().setEditorView(null))).toBe(0);
  });

  it("a view-mode change and a sidebar toggle", () => {
    expect(delta(() => useEditorStore.getState().setViewMode("source"))).toBe(0);
    expect(delta(() => useEditorStore.getState().toggleSidebar())).toBe(0);
  });

  it("a flusher registration and an editor reload (not the getter)", () => {
    expect(
      delta(() => void useMilkdownEditorStore.getState().registerFlusher("d1", () => ({ status: "clean" }))),
    ).toBe(0);
    expect(delta(() => useMilkdownEditorStore.getState().reloadEditor("d1", "test"))).toBe(0);
  });
});

describe("editorGeneration: monotonic and counting over seeded sequences (S5)", () => {
  it("seeds 1-200: never decreases, and the delta equals the shadow model's bump count", () => {
    for (let seed = 1; seed <= 200; seed++) {
      shadow = seedStores();
      const seq = genSequence(mulberry32(seed), GEN_EVENTS, 25);
      const start = getEditorGeneration();
      let previous = start;
      let expected = 0;
      seq.forEach((event, i) => {
        expected += applyGenEvent(event, shadow);
        const now = getEditorGeneration();
        expect(now, `seed ${seed} step ${i} (${event}) decreased: ${JSON.stringify(seq)}`).toBeGreaterThanOrEqual(
          previous,
        );
        previous = now;
      });
      expect(getEditorGeneration() - start, `seed ${seed}: ${JSON.stringify(seq)}`).toBe(expected);
    }
  });
});
