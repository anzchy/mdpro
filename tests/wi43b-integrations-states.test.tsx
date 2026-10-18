/**
 * WI-4.3b: Settings › Integrations states (DESIGN.md § States › Settings).
 *
 * - Pending status read: one busy "Loading…" line.
 * - Empty: the client list says "No MCP clients detected"; Test Connection is
 *   the refresh.
 * - Partial: a failed installations read with a resolved status keeps the
 *   status and toggles, and puts the shared failure line where the list was.
 * - A failed status read shows its own line, never the raw message.
 * - Busy labels: the running action reads "Installing…", "Updating…" or
 *   "Removing…", and only that button (rule 30 rule 4).
 *
 * Mock boundary: `@tauri-apps/api/core` and spies on `mcpService` /
 * `preferencesService` (settingsRowSites.installBoundary).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { IntegrationsSettings } from "../src/components/common/IntegrationsSettings";
import { mcpService, type McpInstallation } from "../src/services/mcpService";
import { MCP_LOADED, installBoundary } from "./support/settingsRowSites";
import { LOAD_FAILED, SECRET } from "./support/settingsStatePages";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STATUS_FAILED = "Failed to load MCP status";

function renderIntegrations() {
  return render(createElement(IntegrationsSettings, {
    mcpConfig: MCP_LOADED,
    mcpConfigFailed: false,
    mcpSaving: false,
    onMcpConfigChange: async () => {},
    beginMcpWrite: () => null,
  }));
}

const INSTALLED: McpInstallation = { client: "claude_code", installed: true, configPath: "/u/.claude.json" };
const MISSING: McpInstallation = { client: "codex_cli", installed: false, configPath: "/u/.codex/config.toml" };

describe("WI-4.3b: Integrations states", () => {
  it("a pending status read shows one busy Loading… line", () => {
    installBoundary();
    vi.mocked(mcpService.getStatus).mockImplementation(() => new Promise(() => {}));
    const { container } = renderIntegrations();
    const busy = [...container.querySelectorAll('[aria-busy="true"]')];
    expect(busy).toHaveLength(1);
    expect(busy[0].textContent).toBe("Loading…");
  });

  it("an empty client list says No MCP clients detected, beside Test Connection", async () => {
    installBoundary();
    renderIntegrations();
    expect(await screen.findByText("No MCP clients detected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Test Connection/ })).toBeInTheDocument();
  });

  it("a failed installations read keeps the status and toggles, with the failure line in the list's place", async () => {
    installBoundary();
    vi.mocked(mcpService.getInstallations).mockRejectedValue(new Error(SECRET));
    const { container } = renderIntegrations();
    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable MCP Server" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(STATUS_FAILED)).toBeNull();
    expect(screen.queryByText("No MCP clients detected")).toBeNull();
    expect(container.textContent).not.toContain("EACCES");
  });

  it("a failed status read shows its own line, not the raw message", async () => {
    installBoundary();
    vi.mocked(mcpService.getStatus).mockRejectedValue(new Error(SECRET));
    vi.mocked(mcpService.getInstallations).mockResolvedValue([INSTALLED]);
    const { container } = renderIntegrations();
    expect(await screen.findByText(STATUS_FAILED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("EACCES");
  });
});

describe("WI-4.3b: Integrations busy labels", () => {
  async function setup() {
    const user = userEvent.setup();
    installBoundary();
    vi.mocked(mcpService.getInstallations).mockResolvedValue([INSTALLED, MISSING]);
    vi.spyOn(mcpService, "installConfig").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(mcpService, "removeConfig").mockImplementation(() => new Promise(() => {}));
    renderIntegrations();
    await screen.findByRole("button", { name: "Install" });
    return user;
  }
  const row = (name: string) => screen.getByText(name).closest(".mcp-client-row") as HTMLElement;

  it("Update reads Updating… while Remove keeps its name", async () => {
    const user = await setup();
    await user.click(screen.getByRole("button", { name: "Update" }));
    const r = within(row("Claude Code"));
    expect(r.getByRole("button", { name: "Updating…" })).toBeDisabled();
    expect(r.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("Remove reads Removing… while Update keeps its name", async () => {
    const user = await setup();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    const r = within(row("Claude Code"));
    expect(r.getByRole("button", { name: "Removing…" })).toBeDisabled();
    expect(r.getByRole("button", { name: "Update" })).toBeDisabled();
  });

  it("Install reads Installing…", async () => {
    const user = await setup();
    await user.click(screen.getByRole("button", { name: "Install" }));
    expect(within(row("Codex CLI")).getByRole("button", { name: "Installing…" })).toBeDisabled();
    expect(screen.queryByText("...")).toBeNull();
  });
});
