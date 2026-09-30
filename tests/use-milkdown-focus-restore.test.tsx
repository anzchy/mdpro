/**
 * D37 WI-4 — FR-1..FR-5: `useMilkdownFocusRestore`, the hook that consumes the focus
 * carry record once the rebuilt Milkdown editor has loaded.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-233000.md`, §"Unit:
 * src/hooks/useMilkdownFocusRestore.ts (WI-4)". Law: at most one restore per armed
 * record, and never while focus is elsewhere.
 *
 * Real Milkdown editors (created under real timers; fake timers take over where a case
 * needs them) and real stores. The hook's `editor` argument is `{loading, get}`, the
 * shape `useEditor` returns; `loading` is a controlled input because a real Milkdown
 * editor cannot be held loading. Mocked: `loggingService` (the JSONL sink) only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Mock } from "vitest";
import { renderHook } from "@testing-library/react";
import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import type { EditorView } from "@milkdown/kit/prose/view";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import {
  useMilkdownFocusRestore,
  type MilkdownEditorHandle,
} from "../src/hooks/useMilkdownFocusRestore";
import {
  armFocusCarry,
  FOCUS_CARRY_TTL_MS,
  resetFocusCarry,
} from "../src/utils/milkdownFocusCarry";
import { countOutcome, restoreLogs } from "./helpers/focusCarryD37Fixture";

const logSpy = loggingService.logEventSync as Mock;
/** Old "Hello world", caret between "Hello " and "world". */
const OLD_HEAD = 7;
/** The same place in "MCP Hello world" (4 characters inserted before it). */
const MAPPED_HEAD = 11;
const SLOW_LOAD_MS = 1500;

let editors: Editor[] = [];

async function makeEditor(markdown: string): Promise<Editor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .create();
  editors.push(editor);
  return editor;
}

const viewOf = (editor: Editor): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));

interface Props {
  loading: boolean;
  generation: number;
}

/** Arm a doc-a record (old doc "Hello world", head 7) and build the rebuilt editor. */
async function setup(recordGeneration: number): Promise<{ next: Editor; view: EditorView }> {
  const old = await makeEditor("Hello world");
  const next = await makeEditor("MCP Hello world");
  armFocusCarry(
    { documentId: "doc-a", head: OLD_HEAD, oldDoc: viewOf(old).state.doc },
    "mcp-insert",
    recordGeneration,
  );
  return { next, view: viewOf(next) };
}

function renderRestore(next: Editor, initial: Props) {
  return renderHook(
    (p: Props) => {
      const handle = { loading: p.loading, get: () => next } as unknown as MilkdownEditorHandle;
      useMilkdownFocusRestore(handle, "doc-a", p.generation);
    },
    { initialProps: initial },
  );
}

beforeEach(() => {
  resetFocusCarry();
  editors = [];
  useDocumentStore.setState({ activeDocumentId: "doc-a" });
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useMilkdownEditorStore.setState({ editorGenerations: {} });
  (document.activeElement as HTMLElement | null)?.blur?.();
});

afterEach(async () => {
  vi.useRealTimers();
  resetFocusCarry();
  for (const editor of editors) await editor.destroy().catch(() => {});
  document.body.innerHTML = "";
});

describe("useMilkdownFocusRestore (D37 WI-4)", () => {
  it("FR-1 the generation comes from the prop, not the store", async () => {
    useMilkdownEditorStore.setState({ editorGenerations: { "doc-a": 2 } });
    const { next, view } = await setup(2);
    const { rerender } = renderRestore(next, { loading: false, generation: 1 });
    expect(view.hasFocus(), "the stale gen-1 inner does not restore").toBe(false);
    expect(countOutcome(logSpy, "restored")).toBe(0);

    rerender({ loading: false, generation: 2 });
    expect(view.hasFocus(), "the gen-2 inner restores").toBe(true);
    expect(view.state.selection.head).toBe(MAPPED_HEAD);
    expect(countOutcome(logSpy, "restored")).toBe(1);
  });

  it("FR-2 a slow load beyond 1000 ms still restores (O1)", async () => {
    const old = await makeEditor("Hello world");
    const next = await makeEditor("MCP Hello world");
    vi.useFakeTimers();
    armFocusCarry(
      { documentId: "doc-a", head: OLD_HEAD, oldDoc: viewOf(old).state.doc },
      "mcp-insert",
      1,
    );
    const { rerender } = renderRestore(next, { loading: true, generation: 1 });
    vi.advanceTimersByTime(SLOW_LOAD_MS);
    rerender({ loading: false, generation: 1 });
    const view = viewOf(next);
    expect(view.hasFocus()).toBe(true);
    expect(view.state.selection.head).toBe(MAPPED_HEAD);
    expect(countOutcome(logSpy, "restored")).toBe(1);
  });

  it("FR-3 bounded wait: a mount that never loads expires", async () => {
    const old = await makeEditor("Hello world");
    const next = await makeEditor("MCP Hello world");
    vi.useFakeTimers();
    armFocusCarry(
      { documentId: "doc-a", head: OLD_HEAD, oldDoc: viewOf(old).state.doc },
      "mcp-insert",
      1,
    );
    const view = viewOf(next);
    const headBefore = view.state.selection.head;
    const { rerender } = renderRestore(next, { loading: true, generation: 1 });
    vi.advanceTimersByTime(FOCUS_CARRY_TTL_MS + 1);
    rerender({ loading: false, generation: 1 });
    expect(document.activeElement).toBe(document.body);
    expect(view.state.selection.head).toBe(headBefore);
    expect(countOutcome(logSpy, "skipped:expired")).toBe(1);
    expect(countOutcome(logSpy, "restored")).toBe(0);
  });

  it("FR-4 effect re-runs do not restore twice (S5)", async () => {
    const { next, view } = await setup(1);
    const { rerender } = renderRestore(next, { loading: false, generation: 1 });
    expect(view.hasFocus(), "precondition: the first load restored").toBe(true);
    (view.dom as HTMLElement).blur();
    expect(view.hasFocus()).toBe(false);

    rerender({ loading: true, generation: 1 });
    rerender({ loading: false, generation: 1 });
    expect(view.hasFocus(), "a re-run does not restore again").toBe(false);
    expect(countOutcome(logSpy, "restored")).toBe(1);
  });

  it("FR-5 an error inside the restore logs skipped:error and does not throw", async () => {
    const { next } = await setup(1);
    await next.destroy();
    // Precondition: the real destroyed-editor path throws, so no Milkdown stub is needed.
    expect(() => viewOf(next)).toThrow();

    expect(() => renderRestore(next, { loading: false, generation: 1 })).not.toThrow();
    const errors = restoreLogs(logSpy).filter((e) => e.context?.outcome === "skipped:error");
    expect(errors).toHaveLength(1);
    const context = errors[0].context!;
    expect(Object.keys(context)).not.toContain("stack");
    expect(JSON.stringify(context)).not.toMatch(/Hello|MCP /);
    expect(countOutcome(logSpy, "restored")).toBe(0);
  });
});
