/** Purpose: exercise Help through App's real menu listener and dialog state. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";

const { listeners, logs } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "log_event") { logs.push(args.payload as Record<string, unknown>); return null; }
    if (command === "get_logging_settings") return { enabled: true, level: "info" };
    if (command === "list_drafts" || command === "get_launch_paths") return [];
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main", setTitle: async () => {}, onCloseRequested: async () => () => {},
    listen: async (name: string, listener: (event: { payload: unknown }) => void) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    },
  }),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import App from "../src/App";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";

beforeEach(() => {
  listeners.clear(); logs.length = 0;
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
  useLoggingStore.setState({ enabled: true, level: "info" });
});
afterEach(() => { listeners.clear(); logs.length = 0; });

async function deliver(action: string, value?: string, target = "main") {
  await waitFor(() => expect(listeners.has("menu:action")).toBe(true));
  await act(async () => {
    listeners.get("menu:action")!({ payload: { action, value, target } });
  });
}

async function expectPage(name: "General" | "Keyboard Shortcuts") {
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  expect(within(dialog).getByRole("button", { name })).toHaveClass("is-active");
  expect(await within(dialog).findByRole("heading", { name })).toBeInTheDocument();
}

describe("M4 Help in the real App", () => {
  it("opens Keyboard Shortcuts repeatedly, while ordinary Settings opens General", async () => {
    render(<App />);
    await deliver("file.preferences", "keyboard-shortcuts");
    await expectPage("Keyboard Shortcuts");
    await act(async () => { screen.getByRole("button", { name: "×" }).click(); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    await deliver("file.preferences", "keyboard-shortcuts");
    await expectPage("Keyboard Shortcuts");
    await act(async () => { screen.getByRole("button", { name: "×" }).click(); });
    await deliver("file.preferences");
    await expectPage("General");
  });

  it("keeps the existing modal and refuses Help once, then opens in the target window", async () => {
    render(<App />);
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    await deliver("file.preferences", "keyboard-shortcuts");
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(logs.filter((line) => line.event === "ui.dialog.open" && line.status === "cancel"
      && (line.context as { reason?: string })?.reason === "modal-open")).toHaveLength(1);
    modal.remove();
    await deliver("file.preferences", "keyboard-shortcuts", "other");
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    await deliver("file.preferences", "keyboard-shortcuts");
    await expectPage("Keyboard Shortcuts");
  });
});
