/**
 * WI-4.3b round 2 (PR #508): overlapping settings writes.
 *
 * Each case puts two writes in flight and resolves or rejects them in a set
 * order, then asserts the UI shows the value the backend last confirmed.
 *
 * - F508-2: a control changed twice, with both writes rejected, ends at its
 *   saved value on every page that writes preferences.
 * - F508-3: Shortcuts' Save is busy while saving, and a save that completes
 *   after a newer edit neither closes the dialog nor loses the edit.
 * - F508-4: while one Integrations action runs, no client can start another.
 *
 * F508-1 (Advanced) is in wi43b-overlap-logging.test.tsx, which mocks
 * `invoke` itself so the real `loggingService` and its toast run.
 *
 * Mock boundary: `@tauri-apps/api/core` and spies on the services
 * (settingsRowSites.installBoundary).
 */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { IntegrationsSettings } from "../src/components/common/IntegrationsSettings";
import { mcpService, type McpInstallation } from "../src/services/mcpService";
import { preferencesService } from "../src/services/preferencesService";
import { MCP_LOADED, installBoundary } from "./support/settingsRowSites";
import { SAVE_SITES, renderStatePage, stubAppliedShortcuts } from "./support/settingsStatePages";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

interface Held {
  resolve: () => void;
  reject: () => void;
}

/** Makes `fn` hold every call until the test resolves or rejects it. */
function hold(fn: (...args: never[]) => Promise<unknown>): Held[] {
  const held: Held[] = [];
  vi.mocked(fn).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        held.push({ resolve: () => resolve(undefined), reject: () => reject(new Error("write failed")) });
      }),
  );
  return held;
}

describe("F508-2: a control changed twice, both writes rejected, ends at its saved value", () => {
  it.each(SAVE_SITES.map((s) => [s.page, s.name, s] as const))("%s › %s", async (_page, name, site) => {
    const user = userEvent.setup();
    installBoundary();
    const held = hold(preferencesService.setPreferences);
    renderStatePage(site.page);
    const control = await screen.findByRole(site.role, { name });

    if (site.role === "switch") {
      await user.click(control);
      await user.click(control);
    } else {
      await user.selectOptions(control, site.next ?? "");
      await user.selectOptions(control, site.saved);
    }
    await settle();
    // One write at a time: the second waits for the first to settle.
    expect(held).toHaveLength(1);

    held[0].reject();
    await settle();
    expect(held).toHaveLength(2);
    held[1].reject();
    await settle();

    if (site.role === "switch") expect(control).toHaveAttribute("aria-checked", site.saved);
    else expect(control).toHaveValue(site.saved);
  });
});

describe("F508-3: Shortcuts save while editing", () => {
  // The recorder takes ⌘ chords on macOS only.
  afterEach(() => {
    delete (navigator as unknown as { platform?: string }).platform;
  });

  it("Save is busy while saving, and a save that lands after a newer edit keeps the dialog and the edit", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    installBoundary();
    stubAppliedShortcuts();
    const held = hold(preferencesService.setPreferences);
    const onClose = vi.fn();
    const { container } = renderStatePage("shortcuts", onClose);

    await user.click(await screen.findByRole("button", { name: "Reset to Defaults" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const busy = screen.getByRole("button", { name: "Saving…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(held).toHaveLength(1);

    // A newer edit while the first save is in flight.
    const recorder = container.querySelector(".shortcut-row button");
    if (!(recorder instanceof HTMLElement)) throw new Error("no shortcut row");
    await user.click(recorder);
    await user.keyboard("{Meta>}{Alt>}j{/Alt}{/Meta}");

    held[0].resolve();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved shortcut changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(held).toHaveLength(2);
    const [[first], [second]] = vi.mocked(preferencesService.setPreferences).mock.calls;
    expect(second.keyboardShortcuts).not.toEqual(first.keyboardShortcuts);
    held[1].resolve();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("F508-4: one Integrations action at a time", () => {
  const INSTALLED: McpInstallation = { client: "claude_code", installed: true, configPath: "/u/.claude.json" };
  const MISSING: McpInstallation = { client: "codex_cli", installed: false, configPath: "/u/.codex/config.toml" };
  const row = (name: string) => within(screen.getByText(name).closest(".mcp-client-row") as HTMLElement);

  it("while one client's action runs, every other client's actions are disabled, and they return after", async () => {
    const user = userEvent.setup();
    installBoundary();
    vi.mocked(mcpService.getInstallations).mockResolvedValue([INSTALLED, MISSING]);
    const installs = hold(vi.spyOn(mcpService, "installConfig") as unknown as (...a: never[]) => Promise<unknown>);
    const removes = vi.spyOn(mcpService, "removeConfig").mockResolvedValue(undefined as never);
    render(createElement(IntegrationsSettings, {
      mcpConfig: MCP_LOADED,
      mcpConfigFailed: false,
      mcpSaving: false,
      onMcpConfigChange: async () => {},
      beginMcpWrite: () => null,
    }));
    await screen.findByRole("button", { name: "Install" });

    await user.click(row("Claude Code").getByRole("button", { name: "Update" }));
    expect(row("Claude Code").getByRole("button", { name: "Updating…" })).toBeDisabled();
    const install = row("Codex CLI").getByRole("button", { name: "Install" });
    expect(install).toBeDisabled();
    await user.click(install);
    expect(installs).toHaveLength(1);
    expect(removes).not.toHaveBeenCalled();

    installs[0].resolve();
    await waitFor(() => expect(row("Codex CLI").getByRole("button", { name: "Install" })).toBeEnabled());
    expect(row("Claude Code").getByRole("button", { name: "Remove" })).toBeEnabled();
  });
});
