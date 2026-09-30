/**
 * D10(c) — the cursor reported to the MCP shadow store.
 *
 * `useMcpSync` sent a hardcoded `0` as every document's cursor, while
 * `useMcpEvents` applied an insert at the live caret. So an MCP client asking
 * to insert "at the cursor" got the text at the top of the document in the
 * shadow store and at the caret in the editor — one request landing in two
 * places. See ADR-0021.
 *
 * On red/green honesty: the first block specifies a NEW module, so there was
 * no earlier version of it to fail. The red that matters is
 * `t_sync_reports_the_live_caret` in the second block, which fails against the
 * hardcoded `0` and is the actual regression case.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolveMcpCursor } from "../src/utils/mcpCursor";

const syncDocuments = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/services/mcpService", () => ({
  mcpService: {
    syncDocuments: (...args: unknown[]) => syncDocuments(...args),
  },
  syncDocuments: (...args: unknown[]) => syncDocuments(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

describe("resolveMcpCursor", () => {
  it("c1: reports the live caret for the active document", () => {
    expect(resolveMcpCursor("hello world", true, 7)).toBe(7);
  });

  it("c2: a caret at the very start is not confused with having no editor", () => {
    // Both answer 0, but for different reasons, and a later change that makes
    // the no-editor case answer something else must not take this one with it.
    expect(resolveMcpCursor("hello", true, 0)).toBe(0);
  });

  it("c3: reports 0 when there is no live editor", () => {
    // This is WYSIWYG today: only the CodeMirror source editor ever calls
    // setEditorView, so the store holds null and there is no caret to read.
    // Both sides then agree on 0 — which is the guarantee this module makes.
    // That the WYSIWYG caret is unreachable at all is a separate open gap.
    expect(resolveMcpCursor("hello", true, undefined)).toBe(0);
  });

  it("c4: an inactive document reports end of document, never a caret", () => {
    // The caret belongs to whichever document is focused. Applying it to a
    // different document is the cross-document corruption useMcpEvents already
    // guarded against; passing one in here must not defeat that.
    expect(resolveMcpCursor("hello", false, 2)).toBe(5);
    expect(resolveMcpCursor("hello", false, undefined)).toBe(5);
  });

  it("c5: a caret past the end of the reported content is clamped", () => {
    // The store's content can lag the editor by a render.
    expect(resolveMcpCursor("hi", true, 99)).toBe(2);
  });

  it("c6: empty content answers 0 whatever the caret says", () => {
    expect(resolveMcpCursor("", true, 4)).toBe(0);
    expect(resolveMcpCursor("", false, undefined)).toBe(0);
  });

  it("c7: the unit is UTF-16 code units, matching ADR-0021", () => {
    // "😀" is one Unicode scalar and TWO UTF-16 code units. A scalar-based
    // implementation would answer 4 here. JS `.length` and CodeMirror
    // positions are both already UTF-16, so this side converts nothing — the
    // Rust side is the one that does, per ADR-0021.
    expect("😀abc".length).toBe(5);
    expect(resolveMcpCursor("😀abc", false, undefined)).toBe(5);
  });
});

describe("useMcpSync reports the resolved cursor", () => {
  beforeEach(() => {
    syncDocuments.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeDoc(id: string, content: string) {
    return {
      id,
      path: `/tmp/${id}.md`,
      content,
      encoding: "utf-8",
      lineEnding: "lf",
      isModified: false,
      lastSaved: null,
    };
  }

  async function syncOnce(caretHead: number | undefined) {
    const { renderHook, act } = await import("@testing-library/react");
    const { useDocumentStore } = await import("../src/stores/documentStore");
    const { useEditorStore } = await import("../src/stores/editorStore");
    const { useMcpSync } = await import("../src/hooks/useMcpSync");

    useDocumentStore.setState({
      documents: [makeDoc("doc-1", "hello world"), makeDoc("doc-2", "second")] as never,
      activeDocumentId: "doc-1",
    });

    useEditorStore.setState({
      editorView:
        caretHead === undefined
          ? null
          : ({ state: { selection: { main: { head: caretHead } } } } as never),
    });

    const { result } = renderHook(() => useMcpSync());
    await act(async () => {
      result.current.syncNow();
      await Promise.resolve();
    });

    const calls = syncDocuments.mock.calls;
    const payload = calls[calls.length - 1]?.[0] as
      | { documents: Array<{ id: string; cursor: number }> }
      | undefined;
    expect(payload, "syncDocuments was never called").toBeDefined();
    return payload!.documents;
  }

  it("t_sync_reports_the_live_caret: the active document carries the caret, not 0", async () => {
    // REGRESSION — D10(c). getCursorPosition() returned a hardcoded 0 with the
    // comment "cursor position is tracked separately". It was not tracked
    // anywhere; InsertPosition::Cursor therefore resolved to offset 0 in Rust
    // while the editor inserted at the caret.
    const docs = await syncOnce(6);

    expect(docs.find((d) => d.id === "doc-1")!.cursor).toBe(6);
  });

  it("the inactive document carries end-of-document, not the other document's caret", async () => {
    const docs = await syncOnce(6);

    expect(docs.find((d) => d.id === "doc-2")!.cursor).toBe("second".length);
  });

  it("with no live editor the active document reports 0", async () => {
    // WYSIWYG. Recorded rather than asserted away: both sides agree, and both
    // are at the top of the document.
    const docs = await syncOnce(undefined);

    expect(docs.find((d) => d.id === "doc-1")!.cursor).toBe(0);
  });
});

describe("both sides of the MCP boundary share one resolver", () => {
  // The two hooks agreeing is the whole point of D10(c). Two matching
  // if-statements agree today and drift tomorrow; one shared function cannot.
  // This is a source-text assertion for the same reason
  // tests/large-document-guard-call-site.test.ts is one — the property under
  // test is *where the code lives*, which no behavioural test can see.
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf-8");

  it("useMcpSync resolves the cursor through the shared helper", () => {
    const src = read("../src/hooks/useMcpSync.ts");

    expect(src).toContain("resolveMcpCursor");
    expect(src, "the hardcoded cursor must be gone, not merely shadowed").not.toMatch(
      /cursor position is tracked separately/
    );
  });

  // The insert handler moved from useMcpEvents.ts to mcpInsertContent.ts
  // (D35 WI-3, 2026-09-30); the property is unchanged, only its file is.
  it("the MCP insert handler resolves the cursor through the same helper", () => {
    const src = read("../src/hooks/mcpInsertContent.ts");

    expect(src).toContain("resolveMcpCursor");
    for (const file of ["../src/hooks/mcpInsertContent.ts", "../src/hooks/useMcpEvents.ts"]) {
      expect(
        read(file),
        `${file}: the inline cursor ternary must be replaced, not duplicated alongside the helper`
      ).not.toMatch(/isActiveDoc \? \(currentEditorView\?\.state\.selection\.main\.head/);
    }
  });
});
