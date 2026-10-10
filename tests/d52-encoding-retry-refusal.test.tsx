/**
 * D52 (ADR-0057 decision 3) — a refused UTF-16 retry from the encoding dialog.
 *
 * Rust refuses an implausible UTF-16 retry with `FileError::EncodingError`, the
 * same shape as the first failed open (src-tauri/src/commands/file_encoding_hint_tests.rs).
 *
 * - RR-1 `encodingRetryRefusalToast` maps that rejection to the refusal copy and
 *   any other rejection to null (the caller's generic toast).
 * - RR-2 App.tsx `handleEncodingSelect` shows it (source contract: App cannot be
 *   rendered in jsdom, same precedent as d20-encoding-refusal-message C-3).
 * - RR-3 safety, through the real hook and stores: the refused retry rejects, adds
 *   no document, marks nothing UTF-16, writes no draft, and keeps the encoding
 *   issue so the dialog stays up for the other byte order or Cancel.
 *
 * Mock boundary: `@tauri-apps/api/{core,event,window}` and `loggingService`.
 */
import { act, renderHook } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logDialogAction: vi.fn(),
    logButtonClick: vi.fn(),
  },
}));

import {
  ENCODING_DIALOG_COPY,
  encodingRetryRefusalToast,
} from "../src/components/common/encodingDialogCopy";
import { useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import type { Document } from "../src/types/document";

const GBK_PATH = "/x/gb.md";
const refusal = { EncodingError: { path: GBK_PATH, detected: "unknown" } };

describe("RR-1 encodingRetryRefusalToast", () => {
  it("maps an EncodingError rejection to the refusal copy", () => {
    expect(encodingRetryRefusalToast(refusal)).toBe(ENCODING_DIALOG_COPY.refusedToast);
  });

  it.each([
    ["IoError", { IoError: { message: "boom" } }],
    ["PermissionDenied", { PermissionDenied: { path: GBK_PATH } }],
    ["Error", new Error("network")],
    ["string", "EncodingError"],
    ["null", null],
  ])("returns null for %s, so the generic toast stays", (_label, error) => {
    expect(encodingRetryRefusalToast(error)).toBeNull();
  });
});

describe("RR-2 App.tsx handleEncodingSelect shows the refusal toast (source contract)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf-8");
  const start = src.indexOf("const handleEncodingSelect");
  const end = src.indexOf("useCallback(", src.indexOf("useCallback(", start) + 1);
  const slice = start >= 0 && end > start ? src.slice(start, end) : "";
  const catchBlock = slice.slice(slice.indexOf("} catch"));

  it("the catch binds the rejection and asks for the refusal toast", () => {
    expect(slice.length).toBeGreaterThan(0);
    expect(catchBlock).toMatch(/\} catch \((\w+)\) \{/);
    const name = catchBlock.match(/\} catch \((\w+)\) \{/)?.[1] ?? "";
    expect(catchBlock).toContain(`encodingRetryRefusalToast(${name})`);
  });

  it("a failed retry does not clear the encoding issue", () => {
    const catchBody = catchBlock.slice(0, catchBlock.indexOf("} finally"));
    expect(catchBody.length).toBeGreaterThan(0);
    expect(catchBody).not.toContain("clearEncodingIssue");
  });
});

function doc(id: string, p: string | null): Document {
  return { id, path: p, content: "B", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}

describe("RR-3 a refused retry changes nothing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useDocumentStore.setState({ documents: [doc("doc-b", null)], activeDocumentId: "doc-b" });
    useEditorStore.setState({ activeDocumentId: "doc-b", viewMode: "source" });
  });

  it.each(["UTF-16LE", "UTF-16BE"])("%s retry: rejects; no tab, no UTF-16 doc, no draft; issue kept", async (encoding) => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "open_file_dialog" || cmd === "open_file") throw refusal;
      return null;
    });
    const { result, unmount } = renderHook(() => useDocument());

    await act(async () => { await result.current.openDocumentFromDialog(); });
    expect(result.current.encodingIssue).toEqual({ path: GBK_PATH, detected: "unknown" });
    const before = structuredClone(useDocumentStore.getState().documents);

    let caught: unknown = null;
    await act(async () => {
      await result.current.openDocumentWithEncoding(GBK_PATH, encoding).catch((e: unknown) => { caught = e; });
    });

    expect(caught).toEqual(refusal);
    expect(encodingRetryRefusalToast(caught)).toBe(ENCODING_DIALOG_COPY.refusedToast);
    const after = useDocumentStore.getState().documents;
    expect(after).toEqual(before);
    expect(after.some((d) => d.encoding.toUpperCase().startsWith("UTF-16"))).toBe(false);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
    const cmds = invokeMock.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("open_file");
    expect(cmds).not.toContain("save_draft");
    expect(cmds).not.toContain("save_file");
    expect(result.current.encodingIssue).toEqual({ path: GBK_PATH, detected: "unknown" });
    unmount();
  });
});
