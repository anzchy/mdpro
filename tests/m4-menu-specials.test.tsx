/** Purpose: M4 Help deep link and repeated Settings page selection. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { dispatchMenuAction } from "../src/hooks/menuActionTable";
import { syncRecentFilesMenu } from "../src/services/recentFilesMenuService";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { SettingsDialog } from "../src/components/common/SettingsDialog";

const WithPage = SettingsDialog as ComponentType<{
  open: boolean;
  onClose: () => void;
  initialPage?: "general" | "keyboard-shortcuts";
}>;

afterEach(() => { document.body.innerHTML = ""; });

describe("M4 Help and Settings", () => {
  it("passes Keyboard Shortcuts only for the Help deep link", async () => {
    const pages: string[] = [];
    const actionIds: string[] = [];
    const view = render(<WithPage open={false} onClose={() => {}} initialPage="general" />);
    const handlers = {
      onOpenPreferences: (actionId: string, page?: string) => {
        actionIds.push(actionId);
        pages.push(page ?? "general");
        view.rerender(<WithPage open onClose={() => {}} initialPage={page === "keyboard-shortcuts" ? "keyboard-shortcuts" : "general"} />);
      },
    };
    dispatchMenuAction(
      { action: "file.preferences", value: "keyboard-shortcuts" },
      handlers,
      () => "m4-help-action",
    );
    expect(screen.getByRole("button", { name: "Keyboard Shortcuts" })).toHaveClass("is-active");
    expect(await screen.findByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    view.rerender(<WithPage open={false} onClose={() => {}} initialPage="keyboard-shortcuts" />);
    dispatchMenuAction({ action: "file.preferences" }, handlers, () => "m4-settings-action");
    expect(pages).toEqual(["keyboard-shortcuts", "general"]);
    expect(actionIds).toEqual(["m4-help-action", "m4-settings-action"]);
    expect(screen.getByRole("button", { name: "General" })).toHaveClass("is-active");
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
  });

  it("refuses Help while another modal owns the window, then opens once", () => {
    const pages: string[] = [];
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    const handlers = { onOpenPreferences: (_actionId: string, page?: string) => { pages.push(page ?? "general"); } };
    dispatchMenuAction(
      { action: "file.preferences", value: "keyboard-shortcuts" },
      handlers, () => "blocked-help",
    );
    expect(pages).toEqual([]);
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    modal.remove();
    dispatchMenuAction(
      { action: "file.preferences", value: "keyboard-shortcuts" },
      handlers, () => "allowed-help",
    );
    expect(pages).toEqual(["keyboard-shortcuts"]);
  });

  it("reopens on each invocation's page, including Help after ordinary Settings", async () => {
    const view = render(<WithPage open={false} onClose={() => {}} initialPage="general" />);
    const open = async (page: "general" | "keyboard-shortcuts") => {
      view.rerender(<WithPage open onClose={() => {}} initialPage={page} />);
      const active = page === "general" ? "General" : "Keyboard Shortcuts";
      expect(screen.getByRole("button", { name: active })).toHaveClass("is-active");
      expect(await screen.findByRole("heading", { name: active })).toBeInTheDocument();
      view.rerender(<WithPage open={false} onClose={() => {}} initialPage={page} />);
    };
    await open("keyboard-shortcuts");
    await open("keyboard-shortcuts");
    await open("general");
    await open("keyboard-shortcuts");
  });

  it("includes a confirmed theme mode only when the existing report supplies one", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue([]);
    await syncRecentFilesMenu({ kind: "refresh" }, "wysiwyg", "dark");
    expect(invoke).toHaveBeenCalledWith("sync_recent_files_menu", {
      op: { kind: "refresh" }, viewMode: "wysiwyg", themeMode: "dark",
    });
    vi.mocked(invoke).mockResolvedValue(["/confirmed.md"]);
    const list = await syncRecentFilesMenu({ kind: "refresh" }, "wysiwyg", "dark");
    expect(list).toEqual(["/confirmed.md"]);
  });
});
