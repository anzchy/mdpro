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
 * SettingsDialog alone (row B red at P1).
 *
 * ADR-0040 migration (WI-9, decision 5): the switch takes effect live, so the
 * "takes effect after restart" note was removed. Rows A and D, which pinned
 * that note appearing (A at P2) or persisting (D at P0/P1), now pin that it
 * never appears. Their scenarios are unchanged.
 *
 * ADR-0040 migration (WI-10): the server toggle calls `mcp_set_server_enabled`,
 * whose reply carries the status — there is no post-write refresh any more, so
 * P1 ("write settled, refresh gated") no longer exists. The law is sampled at
 * P0 (switch pending) and P2 (switch settled); a row's `write` is the switch
 * outcome ("reject" = `persist_failed`) and `post` is the status it returns.
 * Each row's expectations are unchanged.
 *
 * **Mocked:** only `@tauri-apps/api/core` — `invoke` through `mcpRoute` with its
 * `switchGate`, and the `isTauri` spy set true.
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
import type { McpPhase } from "../src/services/mcpService";
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
// ADR-0040 migration: P1 (the refresh step) is gone.
type Phase = "P0" | "P2";
interface Row {
  name: string;
  prefsServer: boolean;
  initial: [McpPhase, Configured];
  write: "ok" | "reject";
  post: [McpPhase, Configured];
  /** Row E: run row B to P2 first, then sample the second click. */
  secondClick?: boolean;
  expect: (phase: Phase, region: HTMLElement, toasts: string[]) => void;
}

function status([phase, configured]: [McpPhase, Configured]) {
  const running = phase !== "disabled";
  return mcpStatus({ phase, configured, running, port: running ? 55045 : null });
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
    name: "A success, disk agrees, no restart note (ADR-0040)",
    prefsServer: false, initial: ["disabled", "disabled"], write: "ok", post: ["disabled", "enabled"],
    expect: (_phase, r, toasts) => {
      noChanged(r);
      // ADR-0040 migration: was "RESTART at P2"; the restart note no longer exists.
      expect(r).not.toHaveTextContent(RESTART);
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
    name: "D disk/phase disagreement before the click (UI-01 state)",
    prefsServer: false, initial: ["running", "disabled"], write: "ok", post: ["running", "enabled"],
    expect: (_phase, r, toasts) => {
      noChanged(r);
      // ADR-0040 migration: was "RESTART at P0/P1"; the badge alone at every phase.
      expect(r.textContent).toBe("Running");
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

/** Click once and walk P0 → P2, calling `sample` at each. */
async function clickThrough(
  user: ReturnType<typeof userEvent.setup>,
  row: Row,
  sample: (phase: Phase) => void,
) {
  const write = deferred();
  const switchBase = callsFor("mcp_set_server_enabled");
  const statusBase = callsFor("mcp_get_status");
  // ADR-0040 migration: the gated write is the switch; its reply is the row's post status.
  mcp.switchGate = write;
  mcp.switchReplies = [row.write === "ok" ? status(row.post) : { reject: "persist_failed" }];

  await user.click(screen.getByRole("checkbox", { name: SERVER }));
  await waitFor(() => expect(callsFor("mcp_set_server_enabled")).toBe(switchBase + 1));
  expect(callsFor("mcp_get_status")).toBe(statusBase);
  sample("P0");

  write.resolve();
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
  // ADR-0040 migration: was statusBase + 1 (the refresh); the reply carries the status now.
  expect(callsFor("mcp_get_status")).toBe(statusBase);
  expect(callsFor("mcp_set_server_enabled")).toBe(switchBase + 1);
  sample("P2");
  mcp.switchGate = null;
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
    // ADR-0040 migration: was ["P0", "P1", "P2"].
    expect(samples).toEqual(["P0", "P2"]);
  });
});
