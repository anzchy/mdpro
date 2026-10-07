/**
 * D25 issue 1 (ADR-0042 issue 1) — with a corrupt settings file, the locked
 * "Enable MCP Server" switch must not read Off beside a Running badge, and the
 * panel must carry exactly one note (rule 30.5).
 *
 * Behaviour decided 2026-10-07:
 * 1. While the saved value is unknown (`mcpConfig === null`), the server switch
 *    mirrors the live phase: checked iff `running` or `starting`; unchecked for
 *    `stopping` / `failed` / `disabled` / no status. It stays disabled.
 *    A loaded config keeps its own `serverEnabled`.
 * 2. Config load failed + status `configured: "unreadable"` → the lock-reason
 *    paragraph is not rendered; the status note is the only note, and the
 *    toggles are described by it (rule 30.4). Every other lock keeps the
 *    paragraph.
 *
 * Real `SettingsDialog` → `IntegrationsSettings` → `McpServerStatus` chain; the
 * only mock is the IPC boundary `@tauri-apps/api/core`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { SettingsDialog } from "../src/components/common/SettingsDialog";
import type { McpPhase, McpStatus } from "../src/services/mcpService";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { McpConfig } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";

const SERVER = /Enable MCP Server/i;
const TOGGLES = [SERVER, /Start on launch/i, /Auto-approve edits/i];
/** Written from the spec text, not imported, so the assertion is independent. */
const UNREADABLE_NOTE = "Settings file unreadable — fix it to change this setting";
const LOAD_FAILED_REASON = /MCP settings couldn't be loaded/;
const noop = () => {};

let statusReply: McpStatus | Error;
let prefsReply: McpConfig | Error;

function status(partial: Partial<McpStatus>): McpStatus {
  return { running: true, port: 55045, binaryPath: "b", phase: "running", error: null, configured: "enabled", ...partial };
}

async function route(cmd: unknown): Promise<unknown> {
  switch (cmd) {
    case "mcp_get_status":
      if (statusReply instanceof Error) throw statusReply;
      return { ...statusReply };
    case "mcp_get_installations":
      return [];
    case "get_preferences":
      if (prefsReply instanceof Error) throw prefsReply;
      return makePreferences({ mcp: prefsReply });
    default:
      return null;
  }
}

async function openIntegrations() {
  const user = userEvent.setup();
  render(<SettingsDialog open onClose={noop} />);
  await user.click(screen.getByRole("button", { name: "Integrations" }));
  return screen.findByRole("checkbox", { name: SERVER });
}

function panel(): HTMLElement {
  const el = document.querySelector(".settings-integrations");
  if (!(el instanceof HTMLElement)) throw new Error("integrations panel not rendered");
  return el;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The text of every element the control's aria-describedby names. */
function describedText(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(route);
  statusReply = status({});
  prefsReply = new Error("corrupt config.json");
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
});

describe("D25-1 corrupt config: the switch mirrors the server and one note is shown", () => {
  it("running + unreadable: switch checked and disabled, one unreadable note, no lock paragraph", async () => {
    statusReply = status({ phase: "running", configured: "unreadable" });
    const server = await openIntegrations();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Running"));
    await waitFor(() => expect(server).toBeChecked());

    expect(server).toBeDisabled();
    expect(countOccurrences(panel().textContent ?? "", UNREADABLE_NOTE)).toBe(1);
    expect(screen.queryByText(LOAD_FAILED_REASON)).toBeNull();
    for (const name of TOGGLES) {
      const toggle = screen.getByRole("checkbox", { name });
      expect(toggle).toBeDisabled();
      expect(describedText(toggle)).toBe(UNREADABLE_NOTE);
    }
  });

  it("disabled + unreadable: switch unchecked and disabled, one unreadable note, no lock paragraph", async () => {
    statusReply = status({ running: false, port: null, phase: "disabled", configured: "unreadable" });
    const server = await openIntegrations();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Off"));

    expect(server).not.toBeChecked();
    expect(server).toBeDisabled();
    expect(countOccurrences(panel().textContent ?? "", UNREADABLE_NOTE)).toBe(1);
    expect(screen.queryByText(LOAD_FAILED_REASON)).toBeNull();
    expect(describedText(server)).toBe(UNREADABLE_NOTE);
  });

  const PHASES: Array<{ phase: McpPhase; badge: string; checked: boolean }> = [
    { phase: "starting", badge: "Starting", checked: true },
    { phase: "failed", badge: "Failed to start", checked: false },
    { phase: "stopping", badge: "Stopping", checked: false },
  ];

  it.each(PHASES)("$phase + unreadable: switch checked=$checked", async ({ phase, badge, checked }) => {
    statusReply = status({ phase, running: phase !== "failed", configured: "unreadable" });
    const server = await openIntegrations();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(badge));
    if (checked) await waitFor(() => expect(server).toBeChecked());

    expect(server.checked).toBe(checked);
    expect(server).toBeDisabled();
    expect(countOccurrences(panel().textContent ?? "", UNREADABLE_NOTE)).toBe(1);
    expect(screen.queryByText(LOAD_FAILED_REASON)).toBeNull();
  });

  it("config failed + status fetch failed: switch unchecked, lock paragraph still shown and describes it", async () => {
    statusReply = new Error("status down");
    const server = await openIntegrations();
    await screen.findByText(LOAD_FAILED_REASON);

    expect(server).not.toBeChecked();
    expect(server).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(UNREADABLE_NOTE)).toBeNull();
    expect(describedText(server)).toMatch(LOAD_FAILED_REASON);
  });

  it.each([
    { phase: "running" as const, badge: "Running", checked: true },
    { phase: "disabled" as const, badge: "Off", checked: false },
  ])(
    "config failed + configured enabled ($phase): lock paragraph kept, no unreadable note, switch mirrors phase",
    async ({ phase, badge, checked }) => {
      statusReply = status({ phase, running: phase === "running", configured: "enabled" });
      const server = await openIntegrations();
      await screen.findByText(LOAD_FAILED_REASON);
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(badge));
      if (checked) await waitFor(() => expect(server).toBeChecked());

      expect(server.checked).toBe(checked);
      expect(server).toBeDisabled();
      expect(screen.queryByText(UNREADABLE_NOTE)).toBeNull();
      expect(describedText(server)).toMatch(LOAD_FAILED_REASON);
    },
  );

  it("loaded config serverEnabled:false + running: the saved value wins, switch unchecked and enabled", async () => {
    prefsReply = { serverEnabled: false, startOnLaunch: false, autoApproveEdits: false };
    statusReply = status({ phase: "running", configured: "disabled" });
    const server = await openIntegrations();
    await waitFor(() => expect(server).toBeEnabled());

    expect(server).not.toBeChecked();
    expect(screen.queryByText(LOAD_FAILED_REASON)).toBeNull();
    expect(server).not.toHaveAttribute("aria-describedby");
  });
});
