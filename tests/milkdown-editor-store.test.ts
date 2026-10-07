// @vitest-environment node
/**
 * @module milkdown-editor-store.test
 * Purpose: Verify the Milkdown editor instance is exposed via a small
 * Zustand store so app-level callbacks (e.g. the ⌘⌥T table insert
 * shortcut wired in App.tsx) can dispatch into the active editor.
 *
 * Strategy: store contract test (mirrors tests/tableInsertStore.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Boundary mock: a throwing flusher is logged; the logger reaches Tauri IPC.
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";

describe("useMilkdownEditorStore", () => {
  beforeEach(() => {
    useMilkdownEditorStore.setState({ getEditor: () => null });
  });

  it("starts with a getEditor function that returns null", () => {
    expect(typeof useMilkdownEditorStore.getState().getEditor).toBe("function");
    expect(useMilkdownEditorStore.getState().getEditor()).toBeNull();
  });

  it("registerEditor stores a getter that returns the registered editor", () => {
    const fakeEditor = { id: "editor-1" };
    useMilkdownEditorStore.getState().registerEditor(() => fakeEditor as unknown);

    expect(useMilkdownEditorStore.getState().getEditor()).toBe(fakeEditor);
  });

  it("unregisterEditor restores the null getter", () => {
    const fakeEditor = { id: "editor-2" };
    useMilkdownEditorStore.getState().registerEditor(() => fakeEditor as unknown);
    useMilkdownEditorStore.getState().unregisterEditor();

    expect(useMilkdownEditorStore.getState().getEditor()).toBeNull();
  });

  it("registerEditor returns a cleanup that only clears when its getter is still active (audit fix H6/M2)", () => {
    const editorA = { id: "A" };
    const editorB = { id: "B" };
    const getterA = () => editorA as unknown;
    const getterB = () => editorB as unknown;

    const cleanupA = useMilkdownEditorStore.getState().registerEditor(getterA);
    expect(useMilkdownEditorStore.getState().getEditor()).toBe(editorA);

    // A new editor mounts before A's cleanup ran (out-of-order remount).
    useMilkdownEditorStore.getState().registerEditor(getterB);
    expect(useMilkdownEditorStore.getState().getEditor()).toBe(editorB);

    // A's stale cleanup fires — must NOT clear B's getter.
    cleanupA();
    expect(useMilkdownEditorStore.getState().getEditor()).toBe(editorB);
  });

  it("registerEditor cleanup clears the slot when no newer registration exists", () => {
    const fakeEditor = { id: "lone" };
    const cleanup = useMilkdownEditorStore
      .getState()
      .registerEditor(() => fakeEditor as unknown);

    expect(useMilkdownEditorStore.getState().getEditor()).toBe(fakeEditor);
    cleanup();
    expect(useMilkdownEditorStore.getState().getEditor()).toBeNull();
  });

  it("the getter is called fresh each time (returns the current editor instance)", () => {
    let current: unknown = { id: "first" };
    useMilkdownEditorStore.getState().registerEditor(() => current);

    expect(useMilkdownEditorStore.getState().getEditor()).toEqual({ id: "first" });

    current = { id: "second" };
    expect(useMilkdownEditorStore.getState().getEditor()).toEqual({ id: "second" });
  });
});

// ---------------------------------------------------------------------------
// D15 WI-2 — flusher registry (matrix `tests-20260922-163219.md` R1-R4).
// Registry presence is read straight from state (`flushers`, matrix §0.8), never
// inferred from a flushPendingEdits result.
// ---------------------------------------------------------------------------

type FlushStatus = "written" | "clean" | "failed" | "destroyed";

function hasFlusher(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    useMilkdownEditorStore.getState().flushers,
    id,
  );
}

describe("useMilkdownEditorStore — flusher registry (D15 WI-2)", () => {
  beforeEach(() => {
    useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  });

  it("R1 no flusher registered gives clean", () => {
    let result: unknown;
    expect(() => {
      result = useMilkdownEditorStore.getState().flushPendingEdits("save");
    }).not.toThrow();
    expect(result).toEqual({ status: "clean" });
  });

  it("R2 the registered flusher receives the reason and its result is returned", () => {
    const f = vi.fn((_reason: string) => ({ status: "written" as const }));
    useMilkdownEditorStore.getState().registerFlusher("doc-a", f);

    const result = useMilkdownEditorStore.getState().flushPendingEdits("view-mode");

    expect(result).toEqual({ status: "written" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith("view-mode");
  });

  it("R3 cleanup ownership holds across every interleaving (L-R1)", () => {
    type Op = "regA" | "regB" | "cleanA" | "cleanB";
    const base: Op[][] = [];
    const ops: Op[] = ["regA", "regB", "cleanA", "cleanB"];
    const permute = (prefix: Op[], rest: Op[]) => {
      if (rest.length === 0) {
        base.push(prefix);
        return;
      }
      rest.forEach((op, i) => permute([...prefix, op], rest.filter((_, j) => j !== i)));
    };
    permute([], ops);
    const valid = base.filter(
      (seq) =>
        seq.indexOf("regA") < seq.indexOf("cleanA") &&
        seq.indexOf("regB") < seq.indexOf("cleanB"),
    );
    expect(valid).toHaveLength(6);

    // Insert a duplicate cleanA at every position after the first cleanA.
    const sequences: Op[][] = [];
    for (const seq of valid) {
      sequences.push(seq);
      const first = seq.indexOf("cleanA");
      for (let pos = first + 1; pos <= seq.length; pos++) {
        sequences.push([...seq.slice(0, pos), "cleanA", ...seq.slice(pos)]);
      }
    }

    const endings = new Set<string>();
    for (const seq of sequences) {
      useMilkdownEditorStore.setState({ flushers: {} });
      const calls: string[] = [];
      const flusherA = (_r: string) => {
        calls.push("A");
        return { status: "written" as const };
      };
      const flusherB = (_r: string) => {
        calls.push("B");
        return { status: "written" as const };
      };
      const cleanups: Partial<Record<"A" | "B", () => void>> = {};
      // Model: the live registration is the most recent one not yet cleaned.
      const modelStack: Array<"A" | "B"> = [];

      for (const op of seq) {
        const store = useMilkdownEditorStore.getState();
        if (op === "regA") {
          cleanups.A = store.registerFlusher("doc-a", flusherA);
          modelStack.push("A");
        } else if (op === "regB") {
          cleanups.B = store.registerFlusher("doc-a", flusherB);
          modelStack.push("B");
        } else if (op === "cleanA") {
          cleanups.A!();
          const i = modelStack.indexOf("A");
          if (i >= 0) modelStack.splice(i, 1);
        } else {
          cleanups.B!();
          const i = modelStack.indexOf("B");
          if (i >= 0) modelStack.splice(i, 1);
        }
      }

      const expected = modelStack.length ? modelStack[modelStack.length - 1] : null;
      endings.add(expected ?? "none");
      const label = `sequence=${seq.join(",")}`;
      expect(hasFlusher("doc-a"), label).toBe(expected !== null);
      const result = useMilkdownEditorStore.getState().flushPendingEdits("save");
      expect(calls, label).toEqual(expected ? [expected] : []);
      expect(result, label).toEqual({ status: expected ? "written" : "clean" });
    }

    // The 6 base orders (plus duplicates) all end with both cleanups run; the
    // non-vacuity guard needs endings where A or B is still live, so replay the
    // prefixes that stop before the last cleanup.
    for (const seq of valid) {
      for (let cut = 1; cut < seq.length; cut++) {
        useMilkdownEditorStore.setState({ flushers: {} });
        const calls: string[] = [];
        const cleanups: Partial<Record<"A" | "B", () => void>> = {};
        const modelStack: Array<"A" | "B"> = [];
        for (const op of seq.slice(0, cut)) {
          const store = useMilkdownEditorStore.getState();
          const who = op.endsWith("A") ? "A" : "B";
          if (op.startsWith("reg")) {
            cleanups[who] = store.registerFlusher("doc-a", (_r) => {
              calls.push(who);
              return { status: "written" };
            });
            modelStack.push(who);
          } else {
            cleanups[who]!();
            cleanups[who]!(); // idempotent
            const i = modelStack.indexOf(who);
            if (i >= 0) modelStack.splice(i, 1);
          }
        }
        const expected = modelStack.length ? modelStack[modelStack.length - 1] : null;
        endings.add(expected ?? "none");
        const label = `prefix=${seq.slice(0, cut).join(",")}`;
        expect(hasFlusher("doc-a"), label).toBe(expected !== null);
        useMilkdownEditorStore.getState().flushPendingEdits("save");
        expect(calls, label).toEqual(expected ? [expected] : []);
      }
    }
    expect(endings).toEqual(new Set(["A", "B", "none"]));
  });

  it("R4 aggregation across documents: failure dominance, destroyed counts as clean (L-R2)", () => {
    type Outcome = FlushStatus | "throws";
    const domain: Outcome[] = ["clean", "written", "failed", "destroyed", "throws"];
    const rank = (o: Outcome) =>
      o === "failed" || o === "throws" ? 2 : o === "written" ? 1 : 0;
    const expectedOf = (a: Outcome, b: Outcome) =>
      (["clean", "written", "failed"] as const)[Math.max(rank(a), rank(b))];

    const seen = new Set<string>();
    for (const a of domain) {
      for (const b of domain) {
        useMilkdownEditorStore.setState({ flushers: {} });
        const make = (o: Outcome) =>
          vi.fn((_reason: string) => {
            if (o === "throws") throw new Error("serializer exploded");
            return { status: o };
          });
        const fa = make(a);
        const fb = make(b);
        useMilkdownEditorStore.getState().registerFlusher("doc-a", fa);
        useMilkdownEditorStore.getState().registerFlusher("doc-b", fb);

        const row = `row=(${a}, ${b})`;
        let result: { status: string } | undefined;
        expect(() => {
          result = useMilkdownEditorStore.getState().flushPendingEdits("save");
        }, row).not.toThrow();
        const expected = expectedOf(a, b);
        seen.add(expected);
        expect(result, row).toEqual({ status: expected });
        expect(result?.status, row).not.toBe("destroyed");
        expect(fa, row).toHaveBeenCalledTimes(1);
        expect(fb, row).toHaveBeenCalledTimes(1);
      }
    }
    expect(seen).toEqual(new Set(["clean", "written", "failed"]));
  });
});
