/**
 * WI-4.3b round 3 (PR #508, N2): Advanced opened before the logging settings
 * hydrate.
 *
 * `App.tsx` awaits `loggingService.hydrateSettings()` at start, and Settings
 * can be open before it lands. The writer must track the store until the first
 * write, so changing only Log Level after hydration sends the hydrated
 * `enabled`, not the store's initial one.
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
import { loggingService } from "../src/services/loggingService";
import { useLoggingStore } from "../src/stores/loggingStore";

interface Settings {
  enabled: boolean;
  level: string;
}

const HYDRATED: Settings = { enabled: false, level: "warn" };
let sent: Partial<Settings>[] = [];
let releaseHydrate: () => void = () => {};

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
      return Promise.resolve({ ...HYDRATED, ...args.patch });
    }
    return Promise.resolve(undefined);
  });
  // The store's initial value, before App hydrates it.
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  cleanup();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

describe("N2: Advanced mounted before hydrateSettings lands", () => {
  it("shows the hydrated values, and a Log Level change sends the hydrated enabled", async () => {
    const user = userEvent.setup();
    render(<AdvancedSettings />);
    const hydrating = loggingService.hydrateSettings();
    await settle();
    releaseHydrate();
    await act(async () => {
      await hydrating;
    });
    await settle();

    const sw = screen.getByRole("switch", { name: "Enable Logging" });
    const select = screen.getByRole("combobox", { name: "Log Level" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(select).toHaveValue("warn");

    await user.selectOptions(select, "error");
    await settle();
    expect(sent).toEqual([{ level: "error" }]);
    expect(useLoggingStore.getState()).toMatchObject({ enabled: false, level: "error" });
  });
});
