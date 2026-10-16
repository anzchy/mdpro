/**
 * @module d260-settings-dialog-rail.test
 * Purpose: D260-WI-1, unit `SettingsDialog`. The rail is flat, each row is its
 * label plus one hidden outline glyph (no emoji), and there is no footer: the
 * header × and Esc are the only ways the dialog closes itself (DESIGN.md
 * § Settings dialog, § Settings rail).
 *
 * Specification: `.claude/tdd-guardian/tests-20261016-142610.md`, D1-D6.
 * Laws: the rail is a bijection onto the prototype's NAV, in order (D1);
 * exactly one row is current and it is the last one clicked, re-clicks
 * included (D5); Tab and Shift+Tab never leave the dialog (D6).
 *
 * Mock boundary: `@tauri-apps/api/core` `invoke` (as in app-dialogs.test.tsx;
 * `log_event` is captured, the Settings loads return fixtures) and the
 * updater/process plugins the About page reaches. `loggingService` and the
 * stores are real. Paired real path: `services/logger.rs` `mod tests`, and
 * device check D260-dev-1.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROTOTYPE_LUCIDE, PROTOTYPE_NAV, geometry, parseLucide } from "./support/settingsRailPrototype";

type LogPayload = { event?: string; context?: Record<string, unknown>; [key: string]: unknown };

const { logs } = vi.hoisted(() => ({ logs: [] as LogPayload[] }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case "log_event":
        logs.push((args.payload as LogPayload | undefined) ?? {});
        return null;
      case "get_preferences":
        return (await import("./support/preferenceFixtures")).makePreferences();
      case "mcp_get_status":
        return { running: false, port: null, binaryPath: "b", phase: "disabled", error: null, configured: "disabled" };
      case "mcp_get_installations":
        return [];
      default:
        return null;
    }
  },
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { SettingsDialog } from "../src/components/common/SettingsDialog";
import { useLoggingStore } from "../src/stores/loggingStore";

/** Characters the old rail drew (and any other pictograph). */
const PICTOGRAPH = /[\p{Extended_Pictographic}️]/u;

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

const controlIds = (event: string) => logs.filter((p) => p.event === event).map((p) => p.context?.controlId);

async function openDialog() {
  const onClose = vi.fn();
  render(<SettingsDialog open onClose={onClose} />);
  await settle();
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  const sidebar = dialog.querySelector(".settings-sidebar") as HTMLElement;
  expect(sidebar).not.toBeNull();
  return { onClose, dialog, sidebar, rail: () => Array.from(sidebar.querySelectorAll("button")) };
}

beforeEach(() => {
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("D260: the Settings rail", () => {
  it("D1: each rail button is its exact label plus one hidden glyph with that page's geometry, no emoji", async () => {
    const { sidebar, rail } = await openDialog();
    const buttons = rail();
    expect(buttons).toHaveLength(PROTOTYPE_NAV.length);
    PROTOTYPE_NAV.forEach(([id, label], i) => {
      expect(within(sidebar).getByRole("button", { name: label })).toBe(buttons[i]);
      const svgs = buttons[i].querySelectorAll("svg");
      expect(svgs, `${id} has one svg`).toHaveLength(1);
      expect(svgs[0].getAttribute("aria-hidden")).toBe("true");
      expect(geometry(svgs[0])).toEqual(parseLucide(PROTOTYPE_LUCIDE[id]));
      expect(buttons[i].textContent).toBe(label);
      expect(PICTOGRAPH.test(buttons[i].textContent ?? "")).toBe(false);
    });
  });

  it("D2: no footer and no 'Close' button; the header × is the only close control", async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    expect(dialog.querySelector(".settings-footer")).toBeNull();
    const header = dialog.querySelector(".settings-header") as HTMLElement;
    const headerButtons = header.querySelectorAll("button");
    expect(headerButtons).toHaveLength(1);
    expect(headerButtons[0].textContent).toBe("×");
    // querySelectorAll, not getAllByRole, so a hidden button still counts.
    const outsidePane = Array.from(dialog.querySelectorAll("button")).filter((b) => !b.closest(".settings-main"));
    expect(outsidePane).toHaveLength(1 + PROTOTYPE_NAV.length);
  });

  it("D3: the header × closes once and logs settings.close once", async () => {
    const user = userEvent.setup();
    const { onClose, dialog } = await openDialog();
    await user.click(within(dialog.querySelector(".settings-header") as HTMLElement).getByRole("button", { name: "×" }));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(controlIds("ui.button.click").filter((c) => c === "settings.close")).toHaveLength(1);
  });

  it("D4: Escape closes once and logs ui.dialog.cancel / settings.dialog.escape", async () => {
    const user = userEvent.setup();
    const { onClose, rail } = await openDialog();
    act(() => rail()[0].focus());
    await user.keyboard("{Escape}");
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(controlIds("ui.dialog.cancel")).toEqual(["settings.dialog.escape"]);
  });

  it("D5: exactly one row is current, and it is the one last clicked", async () => {
    const user = userEvent.setup();
    const { sidebar, rail } = await openDialog();
    const labelOf = new Map(PROTOTYPE_NAV.map(([id, label]) => [id, label]));
    const sequence = [
      "editor", "about", "about", "integrations", "general", "keyboard-shortcuts",
      "markdown", "image", "export", "appearance", "advanced", "general",
    ];
    for (const id of sequence) {
      const target = within(sidebar).getByRole("button", { name: labelOf.get(id) });
      await user.click(target);
      await settle();
      const active = rail().filter((b) => b.classList.contains("is-active"));
      expect(active, `after clicking ${id}`).toEqual([target]);
    }
  });

  it("D6: Tab and Shift+Tab keep focus inside the dialog, and reach the header ×", async () => {
    const user = userEvent.setup();
    const { dialog, rail } = await openDialog();
    const close = (dialog.querySelector(".settings-header") as HTMLElement).querySelector("button") as HTMLElement;
    act(() => rail()[0].focus());
    let reachedClose = false;
    for (let i = 0; i < 40; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `Tab ${i + 1}`).toBe(true);
      if (document.activeElement === close) reachedClose = true;
    }
    expect(reachedClose).toBe(true);

    act(() => close.focus());
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(close);
  });
});
