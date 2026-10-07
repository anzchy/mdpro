// @vitest-environment node
/**
 * ADR-0040 — the pure Settings view of the MCP server status.
 *
 * Rewritten by WI-9 (cases U-3, U-4 of
 * `.claude/tdd-guardian/tests-20260927-185126.md`). The ADR-0039 cases VW-01 …
 * N3 were removed with the note they pinned: ADR-0040 decision 5 makes the
 * switch take effect live, so the "takes effect after restart" note no longer
 * exists, and the second input is now the last switch result rather than a
 * pending toggle. U-3's cross-product subsumes their notSaved and unreadable
 * rows. W-6 (WI-4) is kept, with the new second argument.
 *
 * Laws:
 * 1. Badge independence: the badge depends only on `phase`.
 * 2. Precedence: `unreadable` > `savedOnButFailed` > `notSaved` > `none`.
 * 3. Null: `status === null` gives `{ none, none }`.
 *
 * The oracle below is written by hand from the matrix, not imported, so it
 * cannot share a bug with the implementation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MCP_CONFIGURED_STATES,
  MCP_PHASES,
  type McpConfigured,
  type McpPhase,
} from "../src/services/mcpService";
import {
  mcpStatusView,
  type McpBadge,
  type McpNote,
  type McpSwitchResult,
} from "../src/utils/mcpStatusView";

/** The eight switch results of U-3. */
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

function badgeOf(phase: McpPhase): McpBadge {
  switch (phase) {
    case "disabled": return "off";
    case "starting": return "starting";
    case "running": return "running";
    case "stopping": return "stopping";
    case "failed": return "failed";
  }
}

function noteOf(configured: McpConfigured, phase: McpPhase, sr: McpSwitchResult): McpNote {
  if (configured === "unreadable" || (sr?.kind === "refused" && sr.error === "config_unreadable")) {
    return "unreadable";
  }
  if (configured === "enabled" && phase === "failed") return "savedOnButFailed";
  if (sr?.kind === "ok" && sr.enabled !== (configured === "enabled")) return "notSaved";
  return "none";
}

interface Row {
  phase: McpPhase;
  configured: McpConfigured;
  sr: McpSwitchResult;
}

const ROWS: Row[] = MCP_PHASES.flatMap((phase) =>
  MCP_CONFIGURED_STATES.flatMap((configured) => SWITCH_RESULTS.map((sr) => ({ phase, configured, sr }))),
);

const tag = (r: Row) => `${r.phase}/${r.configured}/${JSON.stringify(r.sr)}`;

describe("U-3 the full cross-product against a hand-written oracle", () => {
  it("U-3 the domain is 5 × 3 × 8 = 120 rows", () => {
    expect(MCP_PHASES).toHaveLength(5);
    expect(MCP_CONFIGURED_STATES).toHaveLength(3);
    expect(SWITCH_RESULTS).toHaveLength(8);
    expect(ROWS).toHaveLength(120);
  });

  it("U-3 every row equals the oracle", () => {
    let rows = 0;
    for (const r of ROWS) {
      const got = mcpStatusView({ phase: r.phase, configured: r.configured }, r.sr);
      expect(got, tag(r)).toEqual({ badge: badgeOf(r.phase), note: noteOf(r.configured, r.phase, r.sr) });
      rows += 1;
    }
    expect(rows).toBe(120);
  });

  it("U-3 badge independence: the badge is badgeOf(phase) on every row", () => {
    for (const r of ROWS) {
      expect(mcpStatusView({ phase: r.phase, configured: r.configured }, r.sr).badge, tag(r)).toBe(badgeOf(r.phase));
    }
  });

  it("U-3 status === null gives {none, none} for every switch result", () => {
    for (const sr of SWITCH_RESULTS) {
      expect(mcpStatusView(null, sr), JSON.stringify(sr)).toEqual({ badge: "none", note: "none" });
    }
  });

  it("U-3 named rows: saved-on-but-failed is distinct from an unsaved toggle", () => {
    expect(mcpStatusView({ phase: "failed", configured: "enabled" }, null)).toEqual({
      badge: "failed",
      note: "savedOnButFailed",
    });
    expect(mcpStatusView({ phase: "disabled", configured: "disabled" }, { kind: "ok", enabled: true })).toEqual({
      badge: "off",
      note: "notSaved",
    });
    expect(
      mcpStatusView({ phase: "failed", configured: "enabled" }, { kind: "refused", error: "config_unreadable" }),
    ).toEqual({ badge: "failed", note: "unreadable" });
    expect(
      mcpStatusView({ phase: "running", configured: "disabled" }, { kind: "refused", error: "status_unavailable" }),
    ).toEqual({ badge: "running", note: "none" });
  });
});

describe("U-4 the restart note is gone from the type and the code", () => {
  // Built by concatenation so this file is not itself a hit for the G-2 grep.
  const RESTART_NOTE = "restart" + "Pending";
  const RESTART_COPY = "MCP_RESTART" + "_COPY";

  it("U-4 no row of U-3 returns the restart note", () => {
    for (const r of ROWS) {
      const { note } = mcpStatusView({ phase: r.phase, configured: r.configured }, r.sr);
      expect(note, tag(r)).not.toBe(RESTART_NOTE);
    }
  });

  it.each([["src/utils/mcpStatusView.ts"], ["src/components/common/McpServerStatus.tsx"]])(
    "U-4 %s names neither the restart note nor its copy",
    (file) => {
      const src = readFileSync(resolve(__dirname, "..", file), "utf8");
      expect(src).not.toContain(RESTART_NOTE);
      expect(src).not.toContain(RESTART_COPY);
    },
  );
});

describe("W-6 (ADR-0040 WI-4) the badge is a total function of phase", () => {
  // Hand-written; `configured` held fixed at "enabled".
  const EXPECTED: Record<McpPhase, McpBadge> = {
    disabled: "off",
    starting: "starting",
    running: "running",
    stopping: "stopping",
    failed: "failed",
  };

  it("W-6 covers every MCP_PHASES value, and nothing else", () => {
    expect([...MCP_PHASES].sort()).toEqual(Object.keys(EXPECTED).sort());
    let rows = 0;
    for (const phase of MCP_PHASES) {
      expect(mcpStatusView({ phase, configured: "enabled" }, null).badge, phase).toBe(EXPECTED[phase]);
      rows += 1;
    }
    expect(rows).toBe(MCP_PHASES.length);
    expect(rows).toBe(5);
  });

  it("W-6 stopping shows the stopping badge", () => {
    expect(mcpStatusView({ phase: "stopping", configured: "enabled" }, null).badge).toBe("stopping");
  });
});
