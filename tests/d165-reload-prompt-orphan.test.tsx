/**
 * D165 (defence) — the external-change prompt belongs to the document it was raised
 * for, and goes away when that document closes by any path.
 *
 * The modal guard (`d165-modal-blocks-tab-actions.test.tsx`) stops ⌘W / the menu,
 * but a document can still close behind the prompt by a path that never meets
 * that guard (a programmatic `closeDocument`, e.g. an MCP-driven or window-level
 * close). On device the prompt then stayed up with no document behind it (F3).
 *
 * Pinned here, with the real `documentStore` and the real `ReloadDialog`:
 *   - the prompt raised for document `a` survives closing another document;
 *   - closing `a` removes the prompt, calls the owner's `onWithdrawn` once (App passes
 *     the file watcher's `clearEvent`) and logs `ui.dialog.cancel`
 *     `controlId: "dialog.reload.withdraw"`, `reason: "document-closed"`;
 *   - so no Reload button is left to press for a closed document;
 *   - Ignore still dismisses without withdrawing.
 *
 * Mock boundary: `@tauri-apps/api/core` invoke (log capture) only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { logs } = vi.hoisted(() => ({
  logs: [] as Array<{ event?: string; status?: string; context?: Record<string, unknown> }>,
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") logs.push((args.payload as (typeof logs)[number] | undefined) ?? {});
    return null;
  },
}));

import { ReloadDialog } from "../src/components/common/ReloadDialog";
import { useReloadPrompt } from "../src/hooks/useReloadPrompt";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { Document } from "../src/types/document";

function doc(id: string): Document {
  return { id, path: `/x/${id}.md`, content: "", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 0 };
}

const calls: string[] = [];
let api: ReturnType<typeof useReloadPrompt> | null = null;

function Host() {
  const prompt = useReloadPrompt(() => void calls.push("withdrawn"));
  api = prompt;
  return (
    <ReloadDialog
      open={Boolean(prompt.reloadMessage)}
      message={prompt.reloadMessage ?? ""}
      onReload={() => void calls.push("reload")}
      onIgnore={prompt.dismissReload}
    />
  );
}

const withdrawLines = () => logs.filter((l) => l.context?.controlId === "dialog.reload.withdraw");
const dialog = () => screen.queryByRole("dialog", { name: "Reload file" });
const close = (id: string) => act(() => useDocumentStore.getState().closeDocument(id));

beforeEach(() => {
  logs.length = 0;
  calls.length = 0;
  api = null;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [doc("a"), doc("b")], activeDocumentId: "a" });
});

describe("D165 — the reload prompt is withdrawn when its document closes", () => {
  it("survives closing another document, and is withdrawn (once, logged) when its own closes", () => {
    render(<Host />);
    act(() => api?.raiseReload("a.md changed on disk", "a"));
    expect(dialog()).not.toBeNull();

    close("b");
    expect(dialog()).not.toBeNull();
    expect(calls).toEqual([]);

    close("a");
    expect(dialog()).toBeNull();
    expect(api?.reloadMessage).toBeNull();
    expect(calls).toEqual(["withdrawn"]);
    expect(withdrawLines()).toHaveLength(1);
    expect(withdrawLines()[0]).toMatchObject({
      event: "ui.dialog.cancel",
      context: { controlId: "dialog.reload.withdraw", reason: "document-closed", documentId: "a" },
    });
  });

  it("leaves no Reload button for a closed document", () => {
    render(<Host />);
    act(() => api?.raiseReload("a.md changed on disk", "a"));
    close("a");
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(calls).not.toContain("reload");
  });

  it("Ignore dismisses without a withdraw line or callback", async () => {
    const user = userEvent.setup();
    render(<Host />);
    act(() => api?.raiseReload("a.md changed on disk", "a"));

    await user.click(screen.getByRole("button", { name: "Ignore" }));

    expect(dialog()).toBeNull();
    expect(calls).toEqual([]);
    expect(withdrawLines()).toEqual([]);
    close("a");
    expect(calls).toEqual([]);
  });

  it("a re-raise for the same document keeps the newest message", () => {
    render(<Host />);
    act(() => api?.raiseReload("first", "a"));
    act(() => api?.raiseReload("second", "a"));
    expect(screen.getByText("second")).toBeTruthy();
  });
});
