import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

const { pending } = vi.hoisted(() => ({
  pending: { resolve: null as null | ((value: unknown) => void) },
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({
    isTauri: true,
    invoke: async (command: string) => {
      if (command === "get_preferences") return new Promise((resolve) => { pending.resolve = resolve; });
      if (command === "get_logging_settings") return { enabled: true, level: "info" };
      if (command === "get_launch_paths" || command === "list_drafts") return [];
      return null;
    },
  }),
);
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main", setTitle: async () => {}, onCloseRequested: async () => () => {}, listen: async () => () => {} }),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import App from "../src/App";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { makePreferences } from "./support/preferenceFixtures";

const rust = readFileSync(resolve("src-tauri/src/services/control_channel/page.rs"), "utf8");
const source = rust.match(/const PROBE: &str = r##"([\s\S]*?)"##;/)?.[1];
function probe() {
  if (!source) throw new Error("probe script missing");
  return (window.eval(`(${source})`) as (args: object) => { ready: boolean; mode: string | null; activeDocument: string | null; dirty: boolean | null })({});
}

beforeEach(() => {
  pending.resolve = null;
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useEditorStore.setState({ viewMode: "source", editorView: null });
});
afterEach(() => { pending.resolve?.(makePreferences()); });

describe("App probe readiness", () => {
  it("stays busy while preferences are pending, then exposes the loaded shell", async () => {
    const view = render(<App />);
    await waitFor(() => expect(pending.resolve).not.toBeNull());
    const shell = view.container.querySelector(".app-shell");
    expect(shell).toHaveAttribute("aria-busy", "true");
    expect(probe()).toMatchObject({ ready: false, mode: null, activeDocument: null, dirty: null });

    await act(async () => { pending.resolve!(makePreferences({ defaultViewMode: "source" })); });
    await waitFor(() => expect(shell).toHaveAttribute("aria-busy", "false"));
    expect(probe()).toMatchObject({ ready: true, mode: "source", activeDocument: null, dirty: null });
    await act(async () => { useEditorStore.setState({ viewMode: "wysiwyg" }); });
    expect(probe().mode).toBe("wysiwyg");
    await act(async () => { useEditorStore.setState({ viewMode: "source" }); });
    expect(probe().mode).toBe("source");
    view.unmount();
  });
});
