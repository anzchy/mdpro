/**
 * About → Updates through the real @tauri-apps/plugin-updater JS (WI-1 case A6).
 *
 * Only `window.__TAURI_INTERNALS__` is mocked, via `mockIPC`: `check()` runs the
 * plugin's own code and `invoke('plugin:updater|check')` rejects the way Tauri
 * does — with the plugin error serialised to a plain string (plugin 2.9.0
 * `error.rs` serialises `Error` via `serialize_str(self.to_string())`). A plugin
 * JS upgrade that wraps or reshapes the rejection breaks this test. A9
 * (plan-20261010-093842 WI-1): a rejection that merely mentions "empty" is a
 * real failure through the same real plugin path. A6b (WI-2, matrix L4): the
 * disabled outcome reaches `log_event` through the real loggingService and the
 * real `invoke`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

import { AboutSettings } from "../src/components/common/settings/AboutSettings";
import { useUpdaterStore } from "../src/stores/updaterStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const REAL_EMPTY_ENDPOINTS = "Updater does not have any endpoints set.";

beforeEach(() => {
  useUpdaterStore.setState({ cachedResult: null });
  useLoggingStore.setState({ enabled: true, level: "info" });
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

  it("A9: a plugin rejection mentioning \"empty\" shows the error pane", async () => {
    mockIPC((cmd) => {
      if (cmd === "plugin:updater|check") throw "error decoding response body: empty";
      if (cmd === "get_app_version") return "1.2.3";
      return undefined;
    });

    render(<AboutSettings />);

    expect(await screen.findByText(/Couldn't reach the update server/)).toBeInTheDocument();
    expect(screen.queryByText("Automatic updates coming soon.")).toBeNull();
    expect(screen.getByRole("button", { name: "Check Again" })).toBeEnabled();
    expect(useUpdaterStore.getState().cachedResult?.phase).toBe("error");
  });

  it("A6b: the disabled outcome reaches log_event through the real loggingService", async () => {
    type Payload = { event: string; status: string; level: string; context?: Record<string, unknown> };
    const logged: Payload[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "log_event") logged.push((args as { payload: Payload }).payload);
      if (cmd === "plugin:updater|check") throw REAL_EMPTY_ENDPOINTS;
      if (cmd === "get_app_version") return "1.2.3";
      return undefined;
    });

    render(<AboutSettings />);

    expect(await screen.findByText("Automatic updates coming soon.")).toBeInTheDocument();
    await waitFor(() =>
      expect(logged.filter((p) => p.event === "ui.about.update_check")).toHaveLength(2),
    );
    const checks = logged.filter((p) => p.event === "ui.about.update_check");
    expect(checks.map((p) => p.status)).toEqual(["start", "success"]);
    expect(checks[1].context?.outcome).toBe("updates-disabled");
    expect(checks[1].context?.error).toBe(REAL_EMPTY_ENDPOINTS);
    expect(checks.some((p) => p.status === "fail")).toBe(false);
  });
});
