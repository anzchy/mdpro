/**
 * D35 — the insert law by exhaustive enumeration (D35-L), and the hook wrapper (D35-HOOK).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-172500.md` (Revision 2). Split from
 * `mcp-insert-wysiwyg-d35.test.ts` only to keep each file under 300 lines.
 *
 * D35-L: fast-check is not a dependency, so the law is asserted over the full Cartesian
 * product of a bounded domain (4 × 2 × 9 × 5 = 360 combinations), with a full store and
 * registry reset per combination. Every `processInsertContentEvent` call is synchronous
 * (ground rule 0.7). D35-HOOK is the only case here that awaits, and it never calls
 * `processInsertContentEvent` directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  labelReads: 0,
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
    hoisted.listeners.set(name, cb);
    return () => hoisted.listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    hoisted.labelReads += 1;
    return { label: "win-2" };
  },
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: () => undefined,
    logEvent: async () => undefined,
    generateActionId: () => "test-action-id",
  },
}));

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { processInsertContentEvent } from "../src/hooks/mcpInsertContent";
import type { InsertPosition } from "../src/hooks/mcpInsertContent";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { content, deps, evt, gen, pending, resetFixture } from "./helpers/mcpInsertD35Fixture";

type Mode = "wysiwyg" | "wysiwyg+pending" | "source+view" | "source+null" | "non-active";

const PRES = ["", "a", "# H\n\npara\n", "line1\nline2"];
const TEXTS = ["X", "multi\nline"];
const MODES: Mode[] = ["wysiwyg", "wysiwyg+pending", "source+view", "source+null", "non-active"];
const EDITED = " edited";

const positionsFor = (len: number): InsertPosition[] => [
  "start", "end", "cursor", 0, 1, Math.floor(len / 2), len, len + 1, len + 5,
];

let view: EditorView | null = null;

beforeEach(() => {
  resetFixture();
  hoisted.listeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
  view?.destroy();
  view = null;
});

/** Arrange one combination; returns the caret head for source+view, else undefined. */
function arrange(pre: string, mode: Mode): number | undefined {
  view?.destroy();
  view = null;
  resetFixture(pre, mode === "non-active" ? "doc-b" : "doc-a");
  if (mode === "wysiwyg+pending") pending("doc-a", () => pre + EDITED);
  if (mode === "source+null") useEditorStore.setState({ viewMode: "source", editorView: null });
  if (mode === "source+view") {
    const head = Math.min(2, pre.length);
    view = new EditorView({
      state: EditorState.create({ doc: pre, selection: { anchor: head } }),
      parent: document.body,
    });
    useEditorStore.setState({ viewMode: "source", editorView: view });
    return head;
  }
  return undefined;
}

/** The independent offset oracle; null means "any offset" (the WYSIWYG cursor gap). */
function oracle(position: InsertPosition, post: string, mode: Mode, head?: number): number | null {
  if (position === "start") return 0;
  if (position === "end") return post.length;
  if (typeof position === "number") return Math.min(position, post.length);
  if (mode === "non-active") return post.length;
  if (mode === "source+view") return Math.max(0, Math.min(head ?? 0, post.length));
  if (mode === "source+null") return 0;
  return null;
}

const spliceHolds = (after: string, post: string, text: string, off: number): boolean =>
  after.slice(0, off) + after.slice(off + text.length) === post &&
  after.slice(off, off + text.length) === text;

describe("D35-L the insert law over a bounded domain", () => {
  it("conservation, round-trip, rebuild iff WYSIWYG-active, isolation — all 360 combinations", () => {
    vi.useFakeTimers();
    let combinations = 0;
    for (const pre of PRES) {
      for (const text of TEXTS) {
        for (const position of positionsFor(pre.length)) {
          for (const mode of MODES) {
            const tuple = JSON.stringify({ pre, text, position, mode });
            const head = arrange(pre, mode);
            const post = pre + (mode === "wysiwyg+pending" ? EDITED : "");

            processInsertContentEvent(evt(text, position), deps);

            const after = content("doc-a") ?? "";
            expect(after.length, `L1 ${tuple}`).toBe(post.length + text.length);
            const off = oracle(position, post, mode, head);
            if (off === null) {
              const some = Array.from({ length: post.length + 1 }, (_, i) => i)
                .some((i) => spliceHolds(after, post, text, i));
              expect(some, `L2 (∃ off) ${tuple}: ${JSON.stringify(after)}`).toBe(true);
            } else {
              expect(spliceHolds(after, post, text, off), `L2 off=${off} ${tuple}: ${JSON.stringify(after)}`).toBe(true);
            }
            const wysiwygActive = mode === "wysiwyg" || mode === "wysiwyg+pending";
            expect(gen("doc-a"), `L3 ${tuple}`).toBe(wysiwygActive ? 1 : 0);
            expect(content("doc-b"), `L4 content ${tuple}`).toBe("Other");
            expect(gen("doc-b"), `L4 generation ${tuple}`).toBe(0);
            if (mode === "source+view") {
              expect(view!.state.doc.toString(), `view ${tuple}`).toBe(after);
            }
            combinations += 1;
          }
        }
      }
    }
    expect(combinations).toBe(360);
  });
});

describe("D35-HOOK the wrapper forwards the window label the hook resolved", () => {
  it("ignores 'main' and processes 'win-2' when the window is win-2", async () => {
    hoisted.labelReads = 0;
    renderHook(() => useMcpEvents());
    await act(async () => {});
    await waitFor(() => {
      expect(hoisted.listeners.get("mcp:insert_content")).toBeTypeOf("function");
      expect(hoisted.labelReads).toBeGreaterThan(0);
    });
    const emit = hoisted.listeners.get("mcp:insert_content")!;
    await act(async () => emit({ payload: evt("[T]", "end", { window_label: "main" }) }));
    expect(content("doc-a")).toBe("Hello world");
    expect(gen("doc-a")).toBe(0);
    await act(async () => emit({ payload: evt("[T]", "end", { window_label: "win-2" }) }));
    expect(content("doc-a")).toBe("Hello world[T]");
    expect(gen("doc-a")).toBe(1);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-a");
  });
});
