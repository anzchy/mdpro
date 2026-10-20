/**
 * WI-4.3b (taking WI-4.13's logging slice): a failed logging-settings write is
 * no longer silent.
 *
 * Before: `setLoggingSettings` mapped an IPC rejection to the settings it was
 * asked to write, so a failed write looked saved and Advanced's catch never
 * ran. Now the write rejects, raises the one save toast, and Advanced keeps
 * the saved value with no inline error (rule 30 rule 5).
 *
 * Mock boundary: `@tauri-apps/api/core#invoke` only; `loggingService`, the
 * stores and the component are real.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { AdvancedSettings } from "../src/components/common/settings/AdvancedSettings";
import { loggingService } from "../src/services/loggingService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";

const SECRET = "EACCES: permission denied, open '/Users/someone/.mdpro/config.json'";
const SAVE_FAILED_TOAST = "Failed to save preferences";

let toasts: string[] = [];
let stopToasts: () => void = () => {};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "set_logging_settings" || command === "patch_settings_group") throw new Error(SECRET);
    return undefined;
  });
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.setState({ message: null });
  toasts = [];
  stopToasts = useToastStore.subscribe((s) => {
    if (s.message !== null) toasts.push(s.message);
  });
});

afterEach(() => {
  stopToasts();
  cleanup();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

describe("WI-4.3b: setLoggingSettings", () => {
  it("rejects when the write fails, and raises the save toast once", async () => {
    await expect(loggingService.setLoggingSettings({ enabled: true, level: "info" })).rejects.toThrow();
    expect(toasts).toEqual([SAVE_FAILED_TOAST]);
  });

  it("resolves with the backend's value when the write lands", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "set_logging_settings" ? { enabled: true, level: "warn" } : undefined);
    await expect(loggingService.setLoggingSettings({ enabled: true, level: "info" }))
      .resolves.toEqual({ enabled: true, level: "warn" });
    expect(toasts).toEqual([]);
  });
});

describe("WI-4.3b: Advanced on a rejected logging save", () => {
  it("the switch keeps its saved value, with one toast and no inline error", async () => {
    const user = userEvent.setup();
    const { container } = render(<AdvancedSettings />);
    const sw = screen.getByRole("switch", { name: "Enable Logging" });
    await user.click(sw);
    await waitFor(() => expect(invokeMock.mock.calls.some(([c]) => c === "patch_settings_group")).toBe(true));
    await settle();
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(useLoggingStore.getState().enabled).toBe(false);
    expect(toasts).toEqual([SAVE_FAILED_TOAST]);
    expect(container.querySelector(".settings-error")).toBeNull();
    expect(container.textContent).not.toContain("EACCES");
  });

  it("the Log Level select keeps its saved value, with one toast and no inline error", async () => {
    const user = userEvent.setup();
    const { container } = render(<AdvancedSettings />);
    const select = screen.getByRole("combobox", { name: "Log Level" });
    await user.selectOptions(select, "error");
    await waitFor(() => expect(invokeMock.mock.calls.some(([c]) => c === "patch_settings_group")).toBe(true));
    await settle();
    expect(select).toHaveValue("info");
    expect(toasts).toEqual([SAVE_FAILED_TOAST]);
    expect(container.querySelector(".settings-error")).toBeNull();
  });
});
