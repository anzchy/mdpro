/**
 * ADR-0040 WI-9 — the `McpServerStatus` region renders the view model.
 *
 * Cases U-5 and U-6 of `.claude/tdd-guardian/tests-20260927-185126.md`. The
 * component is rendered directly with `status` and `switchResult`; the logic is
 * `mcpStatusView`'s (U-3), so these cases pin only the copy and the null
 * rendering (rules 30.2, 30.3, 30.5).
 *
 * The earlier SettingsDialog-driven cases of this file (ADR-0039 UI-01 … N2)
 * moved to `tests/settings-dialog-mcp-status-region.test.tsx`.
 *
 * Copy is written out literally from the plan, not imported, so the
 * assertions are not tautological. No mocks.
 */
import { describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { McpServerStatus } from "../src/components/common/McpServerStatus";
import {
  MCP_CONFIGURED_STATES,
  MCP_PHASES,
  type McpStatus,
} from "../src/services/mcpService";
import type { McpSwitchResult } from "../src/utils/mcpStatusView";

const SAVED_ON_BUT_FAILED = "Saved as on — couldn't start";
const UNREADABLE = "Settings file unreadable — fix it to change this setting";
const CHANGED_ELSEWHERE = "Changed elsewhere — reopen Settings to see the saved value";
const NOTE_COPIES = [SAVED_ON_BUT_FAILED, UNREADABLE, CHANGED_ELSEWHERE];

const SWITCH_RESULTS: McpSwitchResult[] = [
  null,
  { kind: "ok", enabled: true },
  { kind: "ok", enabled: false },
  { kind: "refused", error: "config_unreadable" },
  { kind: "refused", error: "persist_failed" },
  { kind: "refused", error: "exiting" },
  { kind: "refused", error: "status_unavailable" },
  { kind: "refused", error: "unknown" },
];

function status(partial: Partial<McpStatus>): McpStatus {
  return { running: true, port: 55045, binaryPath: "b", phase: "running", error: null, configured: "enabled", ...partial };
}

describe("U-5 the status region text over the notable states", () => {
  it("U-5a failed + configured enabled shows Failed to start and the saved-on note", () => {
    render(<McpServerStatus status={status({ phase: "failed", error: "bind_in_use" })} switchResult={null} />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("Failed to start");
    expect(region).toHaveTextContent(SAVED_ON_BUT_FAILED);
  });

  it("U-5b stopping shows the Stopping badge", () => {
    render(<McpServerStatus status={status({ phase: "stopping" })} switchResult={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Stopping");
  });

  it("U-5c disabled + configured unreadable shows the unreadable copy", () => {
    render(
      <McpServerStatus
        status={status({ phase: "disabled", running: false, port: null, configured: "unreadable" })}
        switchResult={null}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(UNREADABLE);
  });

  it("U-5d running + a switch refused with config_unreadable shows the unreadable copy", () => {
    render(
      <McpServerStatus
        status={status({ phase: "running", configured: "enabled" })}
        switchResult={{ kind: "refused", error: "config_unreadable" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(UNREADABLE);
  });

  it("U-5e status === null renders no status region", () => {
    render(<McpServerStatus status={null} switchResult={{ kind: "ok", enabled: true }} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("U-6 no rendered state mentions a restart, a path or a token", () => {
  it("U-6 all 120 rows: no restart / slash / token text, and at most one note", () => {
    let rows = 0;
    for (const phase of MCP_PHASES) {
      for (const configured of MCP_CONFIGURED_STATES) {
        for (const sr of SWITCH_RESULTS) {
          const tag = `${phase}/${configured}/${JSON.stringify(sr)}`;
          const junk = { ...status({ phase, configured, binaryPath: "/Applications/mdpro.app/x" }), token: "deadbeef" };
          render(<McpServerStatus status={junk} switchResult={sr} />);
          const region = screen.getByRole("status");
          const text = region.textContent ?? "";
          expect(text, tag).not.toMatch(/restart/i);
          expect(text, tag).not.toMatch(/\//);
          expect(text, tag).not.toMatch(/deadbeef/);
          const notes = NOTE_COPIES.flatMap((copy) => within(region).queryAllByText(copy, { exact: false }));
          expect(notes.length, tag).toBeLessThanOrEqual(1);
          cleanup();
          rows += 1;
        }
      }
    }
    expect(rows).toBe(120);
  });
});
