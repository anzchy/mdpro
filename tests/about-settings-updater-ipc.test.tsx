/**
 * About → Updates through the real @tauri-apps/plugin-updater JS (WI-1 case A6).
 *
 * Only `window.__TAURI_INTERNALS__` is mocked, via `mockIPC`: `check()` runs the
 * plugin's own code and `invoke('plugin:updater|check')` rejects the way Tauri
 * does — with the plugin error serialised to a plain string (plugin 2.9.0
 * `error.rs` serialises `Error` via `serialize_str(self.to_string())`). A plugin
 * JS upgrade that wraps or reshapes the rejection breaks this test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

import { AboutSettings } from "../src/components/common/settings/AboutSettings";
import { useUpdaterStore } from "../src/stores/updaterStore";

const REAL_EMPTY_ENDPOINTS = "Updater does not have any endpoints set.";

beforeEach(() => {
  useUpdaterStore.setState({ cachedResult: null });
});

afterEach(() => {
  clearMocks();
});

describe("AboutSettings — real updater plugin JS over mocked IPC", () => {
  it("A6: the plugin's empty-endpoints rejection shows the disabled text", async () => {
    const commands: string[] = [];
    mockIPC((cmd) => {
      commands.push(cmd);
      if (cmd === "plugin:updater|check") throw REAL_EMPTY_ENDPOINTS;
      if (cmd === "get_app_version") return "1.2.3";
      return undefined;
    });

    render(<AboutSettings />);

    expect(await screen.findByText("Automatic updates coming soon.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't reach the update server/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Check Again" })).toBeNull();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "updates-disabled" });
    expect(commands).toContain("plugin:updater|check");
  });
});
