/**
 * ADR-0031 step 5b, WI-6 (DEC-1 Option A) — case N5 of
 * `.claude/tdd-guardian/tests-20260927-031000.md`.
 *
 * **Law (one signal per event, at every instant — rule 30.5).** From the click
 * until the post-write status refresh settles, the MCP status note is never
 * "Changed elsewhere". It is sampled at P0 (write pending), P1 (write settled,
 * refresh gated) and P2 (refresh settled) over five enumerated scenarios.
 *
 * Kills: setting `pendingToggle` before the write (rows B, C red at P0); fixing
 * SettingsDialog alone (row B red at P1); gating `restartPending` too (row D
 * red at P0).
 *
 * **Mocked:** only `@tauri-apps/api/core` — `invoke` through `mcpRoute` with its
 * `setGate` and `statusGate`, and the `isTauri` spy set true.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { SettingsDialog } from "../src/components/common/SettingsDialog";
import type { McpLaunch } from "../src/services/mcpService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import { mcp, mcpRoute, mcpStatus, resetMcp } from "./support/mcpSettingsHarness";
import { deferred } from "./support/windowSaveHarness";

const SERVER = /Enable MCP Server/i;
const CHANGED_ELSEWHERE = /Changed elsewhere — reopen Settings to see the saved value/;
const RESTART = /restart/i;
const SAVE_FAILED_TOAST = "Failed to save preferences";
const noop = () => {};

type Configured = "enabled" | "disabled";
type Phase = "P0" | "P1" | "P2";
interface Row {
  name: string;
  prefsServer: boolean;
  initial: [McpLaunch, Configured];
  write: "ok" | "reject";
  post: [McpLaunch, Configured];
  /** Row E: run row B to P2 first, then sample the second click. */
  secondClick?: boolean;
  expect: (phase: Phase, region: HTMLElement, toasts: string[]) => void;
}

function status([launch, configured]: [McpLaunch, Configured]) {
  const running = launch !== "disabled";
  return mcpStatus({ launch, configured, running, port: running ? 55045 : null });
}

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command).length;
}

function region() {
  return screen.getByRole("status");
}

const noChanged = (r: HTMLElement) => expect(within(r).queryByText(/Changed elsewhere/)).toBeNull();

const ROWS: Row[] = [
  {
    name: "A success, disk agrees, restart arises",
    prefsServer: false, initial: ["disabled", "disabled"], write: "ok", post: ["disabled", "enabled"],
    expect: (phase, r, toasts) => {
      noChanged(r);
      if (phase === "P2") expect(r).toHaveTextContent(RESTART);
      else expect(r).not.toHaveTextContent(RESTART);
      expect(toasts).toEqual([]);
    },
  },
  {
    name: "B success, disk disagrees",
    prefsServer: false, initial: ["disabled", "disabled"], write: "ok", post: ["disabled", "disabled"],
    expect: (phase, r, toasts) => {
      if (phase === "P2") expect(within(r).getByText(CHANGED_ELSEWHERE)).toBeInTheDocument();
      else noChanged(r);
      expect(toasts).toEqual([]);
    },
  },
  {
    name: "C reject",
    prefsServer: true, initial: ["running", "enabled"], write: "reject", post: ["running", "enabled"],
    expect: (phase, r, toasts) => {
      noChanged(r);
      expect(within(r).queryByText(/Not saved/)).toBeNull();
      expect(toasts).toEqual(phase === "P0" ? [] : [SAVE_FAILED_TOAST]);
      if (phase === "P2") expect(r.textContent).toBe("Running");
      const noteShown = within(r).queryByText(/Not saved|Changed elsewhere|restart/i) !== null;
      expect(toasts.length > 0 && noteShown, "toast and note never both shown").toBe(false);
    },
  },
  {
    name: "D pre-existing restart (UI-01 state)",
    prefsServer: false, initial: ["running", "disabled"], write: "ok", post: ["running", "enabled"],
    expect: (phase, r, toasts) => {
      noChanged(r);
      if (phase === "P2") expect(r.textContent).toBe("Running");
      else expect(r).toHaveTextContent(RESTART);
      expect(toasts).toEqual([]);
    },
  },
  {
    name: "E second click after a legitimate notSaved",
    prefsServer: false, initial: ["disabled", "disabled"], write: "ok", post: ["disabled", "disabled"],
    secondClick: true,
    expect: (phase, r, toasts) => {
      noChanged(r);
      if (phase === "P2") expect(r.textContent).toBe("Off");
      expect(toasts).toEqual([]);
    },
  },
];

/** Click once and walk P0 → P1 → P2, calling `sample` at each. */
async function clickThrough(
  user: ReturnType<typeof userEvent.setup>,
  row: Row,
  sample: (phase: Phase) => void,
) {
  const write = deferred();
  const refresh = deferred();
  const setBase = callsFor("set_preferences");
  const statusBase = callsFor("mcp_get_status");
  mcp.setGate = write;
  mcp.statusGate = refresh;
  mcp.setReplies = [row.write];

  await user.click(screen.getByRole("checkbox", { name: SERVER }));
  await waitFor(() => expect(callsFor("set_preferences")).toBe(setBase + 1));
  expect(callsFor("mcp_get_status")).toBe(statusBase);
  sample("P0");

  mcp.status = status(row.post);
  write.resolve();
  await waitFor(() => expect(callsFor("mcp_get_status")).toBe(statusBase + 1));
  expect(callsFor("set_preferences")).toBe(setBase + 1);
  sample("P1");

  refresh.resolve();
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
  expect(callsFor("mcp_get_status")).toBe(statusBase + 1);
  sample("P2");
  mcp.setGate = null;
  mcp.statusGate = null;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(mcpRoute);
  resetMcp();
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: false, level: "info" });
  useToastStore.getState().clearToast();
});

describe("N5 the note is never Changed elsewhere from the click until the post-write refresh settles", () => {
  it("N5 domain: the rows the kills depend on are present and distinct", () => {
    const written = (row: Row): Configured => (row.prefsServer ? "disabled" : "enabled");
    const agrees = (row: Row) => row.write === "ok" && row.post[1] === written(row);
    const disagrees = (row: Row) => row.write === "ok" && row.post[1] !== written(row);
    const restartBefore = (row: Row) => row.initial[0] === "running" && row.initial[1] === "disabled";

    const keys = ROWS.map((r) => JSON.stringify([r.prefsServer, r.initial, r.write, r.post, !!r.secondClick]));
    expect(new Set(keys).size, "scenarios pairwise distinct").toBe(ROWS.length);
    expect(ROWS.filter(agrees).length, "a success the disk agrees with (A)").toBeGreaterThan(0);
    expect(ROWS.filter(disagrees).length, "a success the disk contradicts (B)").toBeGreaterThan(0);
    expect(ROWS.filter((r) => r.write === "reject").length, "a rejected write (C)").toBeGreaterThan(0);
    expect(ROWS.filter(restartBefore).length, "a pre-existing restart (D)").toBeGreaterThan(0);
    expect(ROWS.filter((r) => r.secondClick).length, "a second click (E)").toBeGreaterThan(0);
    // Row E replays ROWS[1] as its first click and then expects Changed elsewhere,
    // so ROWS[1] must be a disk-disagrees success.
    expect(disagrees(ROWS[1]) && !ROWS[1].secondClick, "ROWS[1] is the B precondition").toBe(true);
  });

  it.each(ROWS)("N5 row $name", async (row) => {
    const user = userEvent.setup();
    mcp.prefsMcp = { serverEnabled: row.prefsServer, startOnLaunch: false, autoApproveEdits: false };
    mcp.status = status(row.initial);
    render(<SettingsDialog open onClose={noop} />);
    await user.click(screen.getByRole("button", { name: "Integrations" }));
    const server = await screen.findByRole("checkbox", { name: SERVER });
    await waitFor(() => expect(server).toBeEnabled());
    await waitFor(() => expect(region()).toBeInTheDocument());

    if (row.secondClick) {
      await clickThrough(user, ROWS[1], () => undefined);
      expect(within(region()).getByText(CHANGED_ELSEWHERE)).toBeInTheDocument();
    }

    const toasts: string[] = [];
    const stop = useToastStore.subscribe((s) => {
      if (s.message !== null) toasts.push(s.message);
    });
    const samples: Phase[] = [];
    try {
      await clickThrough(user, row, (phase) => {
        samples.push(phase);
        row.expect(phase, region(), toasts);
      });
    } finally {
      stop();
    }
    expect(samples).toEqual(["P0", "P1", "P2"]);
  });
});
