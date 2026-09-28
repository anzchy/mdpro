/**
 * MCP-FIX-C2 (ADR-0039, rule 30.2 render-if-nonzero) — the "Listening on"
 * server-info block appears only when a port is bound.
 *
 * With the launch disabled, failed, or still starting, `mcp_get_status` returns
 * `port: null`; rendering `Listening on localhost:—` and "Port auto-assigned"
 * then claims a listener that does not exist.
 *
 * Renders the real SettingsDialog → IntegrationsSettings chain; the only mock is
 * `@tauri-apps/api/core#invoke` (route in `tests/support/mcpSettingsHarness.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { SettingsDialog } from "../src/components/common/SettingsDialog";
import type { McpPhase } from "../src/services/mcpService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { mcp, mcpRoute, mcpStatus, resetMcp } from "./support/mcpSettingsHarness";

const BOUND_PORT = 55045;
const noop = () => {};

async function openIntegrations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Integrations" }));
  await screen.findByRole("checkbox", { name: /Enable MCP Server/i });
  await screen.findByRole("status");
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(mcpRoute);
  resetMcp();
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
});

describe("MCP-FIX-C2 server info renders only with a bound port", () => {
  it.each<McpPhase>(["disabled", "failed", "starting"])(
    "C2-01 launch %s with no port shows no Listening-on row and no port hint",
    async (phase) => {
      const user = userEvent.setup();
      mcp.status = mcpStatus({ running: false, port: null, phase, configured: "enabled" });
      render(<SettingsDialog open onClose={noop} />);
      await openIntegrations(user);

      expect(screen.queryByText(/Listening on/i)).toBeNull();
      expect(screen.queryByText(/localhost:/)).toBeNull();
      expect(screen.queryByText(/Port auto-assigned/i)).toBeNull();
      expect(screen.queryByTitle("Copy to clipboard")).toBeNull();
    },
  );

  it("C2-02 launch running with a port shows the Listening-on row with that port", async () => {
    const user = userEvent.setup();
    mcp.status = mcpStatus({ running: true, port: BOUND_PORT, phase: "running", configured: "enabled" });
    render(<SettingsDialog open onClose={noop} />);
    await openIntegrations(user);

    expect(screen.getByText("Listening on")).toBeInTheDocument();
    expect(screen.getByText(`localhost:${BOUND_PORT}`)).toBeInTheDocument();
    expect(screen.getByText(/Port auto-assigned/i)).toBeInTheDocument();
    expect(screen.getByTitle("Copy to clipboard")).toBeInTheDocument();
  });
});
