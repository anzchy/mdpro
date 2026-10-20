/**
 * WI-4.3b round 4 (PR #508, N2 reject variant): hydrateSettings lands while a
 * Log Level write is in flight, and that write is rejected.
 *
 * The page skips the store's change while its group is writing; once the
 * group is idle again it must pick the hydrated values up, so the next write
 * is built on them and not on the store's pre-hydration value.
 *
 * Mock boundary: `@tauri-apps/api/core#invoke` only; `loggingService`
 * (including the real `hydrateSettings`), the store and the component are real.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { AdvancedSettings } from "../src/components/common/settings/AdvancedSettings";
import { resetSettingsWriterRegistry } from "../src/components/common/settings/settingsWriterRegistry";
import { loggingService } from "../src/services/loggingService";
import { useLoggingStore } from "../src/stores/loggingStore";

interface Settings {
  enabled: boolean;
  level: string;
}

const HYDRATED: Settings = { enabled: false, level: "warn" };
let sent: Partial<Settings>[] = [];
let releaseHydrate: () => void = () => {};
let rejectFirstWrite: () => void = () => {};

beforeEach(() => {
  sent = [];
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string, args?: { group: string; patch: Partial<Settings> }) => {
    if (command === "get_logging_settings") {
      return new Promise((resolve) => {
        releaseHydrate = () => resolve({ ...HYDRATED });
      });
    }
    if (command === "patch_settings_group" && args) {
      expect(args.group).toBe("logging");
      sent.push(args.patch);
      if (sent.length === 1) {
        return new Promise((_resolve, reject) => {
          rejectFirstWrite = () => reject(new Error("write failed"));
        });
      }
      return Promise.resolve({ ...HYDRATED, ...args.patch });
    }
    return Promise.resolve(undefined);
  });
  // The store's initial value, before App hydrates it.
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  cleanup();
  resetSettingsWriterRegistry();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

describe("N2: hydrateSettings lands under a write that is then rejected", () => {
  it("shows the hydrated values once the write fails, and the next write is built on them", async () => {
    const user = userEvent.setup();
    render(<AdvancedSettings />);
    const hydrating = loggingService.hydrateSettings();
    const select = screen.getByRole("combobox", { name: "Log Level" });
    await user.selectOptions(select, "error");
    await settle();
    expect(sent).toEqual([{ level: "error" }]);

    releaseHydrate();
    await act(async () => {
      await hydrating;
    });
    await settle();
    rejectFirstWrite();
    await settle();

    const sw = screen.getByRole("switch", { name: "Enable Logging" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(select).toHaveValue("warn");

    await user.selectOptions(select, "debug");
    await settle();
    expect(sent[1]).toEqual({ level: "debug" });
  });
});
