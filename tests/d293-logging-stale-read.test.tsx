/** D293: a startup logging read cannot undo a later confirmed write. */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { AdvancedSettings } from "../src/components/common/settings/AdvancedSettings";
import { shownValue, resetSettingsWriterRegistry } from "../src/components/common/settings/settingsWriterRegistry";
import { loggingService } from "../src/services/loggingService";
import { useLoggingStore } from "../src/stores/loggingStore";

type Settings = { enabled: boolean; level: "info" };
const old: Settings = { enabled: true, level: "info" };
let disk: Settings;
let rustCache: Settings;
let releaseHydrate: () => void;

beforeEach(() => {
  disk = { ...old };
  rustCache = { ...old };
  releaseHydrate = () => {};
  useLoggingStore.setState({ ...old });
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string, args?: { group: string; patch: Partial<Settings> }) => {
    if (command === "get_logging_settings") {
      const snapshot = { ...disk };
      return new Promise((resolve) => { releaseHydrate = () => resolve(snapshot); });
    }
    if (command === "patch_settings_group" && args) {
      expect(args.group).toBe("logging");
      disk = { ...disk, ...args.patch };
      rustCache = { ...disk };
      return Promise.resolve({ ...disk });
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  cleanup();
  resetSettingsWriterRegistry();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function turnOff(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("switch", { name: "Enable Logging" }));
  await settle();
  expect(disk.enabled).toBe(false);
  expect(useLoggingStore.getState().enabled).toBe(false);
}

describe("D293 logging hydration generation", () => {
  it("drops a read started before a confirmed write after the queue drains", async () => {
    const user = userEvent.setup();
    const hydrating = loggingService.hydrateSettings();
    render(<AdvancedSettings />);
    await turnOff(user);
    releaseHydrate();
    await act(async () => { await hydrating; });
    await settle();

    expect(disk.enabled).toBe(false);
    expect(rustCache.enabled).toBe(false);
    expect(useLoggingStore.getState().enabled).toBe(false);
    expect(shownValue<Settings>("logging")?.enabled).toBe(false);
    expect(screen.getByRole("switch", { name: "Enable Logging" })).toHaveAttribute("aria-checked", "false");
  });

  it("drops the stale read while Advanced is closed and seeds a later mount from the confirmed value", async () => {
    const user = userEvent.setup();
    const hydrating = loggingService.hydrateSettings();
    const page = render(<AdvancedSettings />);
    await turnOff(user);
    page.unmount();
    releaseHydrate();
    await act(async () => { await hydrating; });
    render(<AdvancedSettings />);
    await settle();

    expect(disk.enabled).toBe(false);
    expect(rustCache.enabled).toBe(false);
    expect(useLoggingStore.getState().enabled).toBe(false);
    expect(shownValue<Settings>("logging")?.enabled).toBe(false);
    expect(screen.getByRole("switch", { name: "Enable Logging" })).toHaveAttribute("aria-checked", "false");
  });
});

it("applies a logging read started after a rejected write", async () => {
  invokeMock.mockImplementation((command: string) => {
    if (command === "patch_settings_group") return Promise.reject(new Error("save rejected"));
    if (command === "get_logging_settings") return Promise.resolve({ ...old });
    return Promise.resolve(undefined);
  });

  await expect(loggingService.patchLoggingSettings({ enabled: false }, old)).rejects.toThrow("save rejected");
  useLoggingStore.setState({ enabled: false, level: "info" });
  await loggingService.hydrateSettings();
  expect(useLoggingStore.getState().enabled).toBe(true);
});
