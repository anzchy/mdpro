/**
 * WI-6 (ADR-0039) — the pure Settings view of the MCP server status.
 *
 * Cases VW-01 … VW-04 of `.claude/tdd-guardian/tests-20260926-235500.md`.
 *
 * Laws:
 * 1. At most one note (structural: `note` is a single value).
 * 2. The badge is a function of `launch` alone.
 * 3. The restart note depends only on `(launch, configured)`, never the toggle.
 * 4. Precedence: `unreadable` > `notSaved` > `restartPending`.
 *
 * VW-01's expected table is written out literally rather than computed, so it
 * cannot share a bug with the implementation.
 */
import { describe, expect, it } from "vitest";

import type { McpConfigured, McpLaunch } from "../src/services/mcpService";
import { mcpStatusView, type McpBadge, type McpNote } from "../src/utils/mcpStatusView";

const LAUNCHES: McpLaunch[] = ["starting", "running", "failed", "disabled"];
const CONFIGUREDS: McpConfigured[] = ["enabled", "disabled", "unreadable"];
const TOGGLES: Array<boolean | null> = [null, true, false];

type Row = [McpLaunch | null, McpConfigured | null, boolean | null, McpBadge, McpNote];

function status(launch: McpLaunch | null, configured: McpConfigured | null) {
  return launch === null || configured === null ? null : { launch, configured };
}

// prettier-ignore
const TABLE: Row[] = [
  // status === null
  [null, null, null,  "none", "none"],
  [null, null, true,  "none", "none"],
  [null, null, false, "none", "none"],
  // launch: running
  ["running", "enabled",    null,  "running", "none"],
  ["running", "enabled",    true,  "running", "none"],
  ["running", "enabled",    false, "running", "notSaved"],
  ["running", "disabled",   null,  "running", "restartPending"],
  ["running", "disabled",   true,  "running", "notSaved"],
  ["running", "disabled",   false, "running", "restartPending"],
  ["running", "unreadable", null,  "running", "unreadable"],
  ["running", "unreadable", true,  "running", "unreadable"],
  ["running", "unreadable", false, "running", "unreadable"],
  // launch: starting
  ["starting", "enabled",    null,  "starting", "none"],
  ["starting", "enabled",    true,  "starting", "none"],
  ["starting", "enabled",    false, "starting", "notSaved"],
  ["starting", "disabled",   null,  "starting", "restartPending"],
  ["starting", "disabled",   true,  "starting", "notSaved"],
  ["starting", "disabled",   false, "starting", "restartPending"],
  ["starting", "unreadable", null,  "starting", "unreadable"],
  ["starting", "unreadable", true,  "starting", "unreadable"],
  ["starting", "unreadable", false, "starting", "unreadable"],
  // launch: failed
  ["failed", "enabled",    null,  "failed", "none"],
  ["failed", "enabled",    true,  "failed", "none"],
  ["failed", "enabled",    false, "failed", "notSaved"],
  ["failed", "disabled",   null,  "failed", "restartPending"],
  ["failed", "disabled",   true,  "failed", "notSaved"],
  ["failed", "disabled",   false, "failed", "restartPending"],
  ["failed", "unreadable", null,  "failed", "unreadable"],
  ["failed", "unreadable", true,  "failed", "unreadable"],
  ["failed", "unreadable", false, "failed", "unreadable"],
  // launch: disabled
  ["disabled", "enabled",    null,  "off", "restartPending"],
  ["disabled", "enabled",    true,  "off", "restartPending"],
  ["disabled", "enabled",    false, "off", "notSaved"],
  ["disabled", "disabled",   null,  "off", "none"],
  ["disabled", "disabled",   true,  "off", "notSaved"],
  ["disabled", "disabled",   false, "off", "none"],
  ["disabled", "unreadable", null,  "off", "unreadable"],
  ["disabled", "unreadable", true,  "off", "unreadable"],
  ["disabled", "unreadable", false, "off", "unreadable"],
];

describe("VW-01 full table", () => {
  it("VW-01 covers 39 rows", () => {
    expect(TABLE).toHaveLength(39);
  });

  it.each(TABLE)("VW-01 (%s, %s, %s) -> {%s, %s}", (launch, configured, toggle, badge, note) => {
    expect(mcpStatusView(status(launch, configured), toggle)).toEqual({ badge, note });
  });

  it("VW-01 named adversary rows", () => {
    expect(mcpStatusView({ launch: "running", configured: "enabled" }, null)).toEqual({ badge: "running", note: "none" });
    expect(mcpStatusView({ launch: "disabled", configured: "disabled" }, null)).toEqual({ badge: "off", note: "none" });
    expect(mcpStatusView({ launch: "running", configured: "disabled" }, null)).toEqual({ badge: "running", note: "restartPending" });
    expect(mcpStatusView({ launch: "disabled", configured: "enabled" }, null)).toEqual({ badge: "off", note: "restartPending" });
    expect(mcpStatusView({ launch: "failed", configured: "disabled" }, null)).toEqual({ badge: "failed", note: "restartPending" });
    expect(mcpStatusView({ launch: "failed", configured: "enabled" }, null)).toEqual({ badge: "failed", note: "none" });
    expect(mcpStatusView({ launch: "disabled", configured: "disabled" }, true)).toEqual({ badge: "off", note: "notSaved" });
    expect(mcpStatusView({ launch: "running", configured: "unreadable" }, false)).toEqual({ badge: "running", note: "unreadable" });
  });
});

describe("VW-02 metamorphic: the toggle never changes the badge", () => {
  const statuses = [null, ...LAUNCHES.flatMap((l) => CONFIGUREDS.map((c) => ({ launch: l, configured: c })))];

  it("VW-02 enumerates 13 statuses", () => {
    expect(statuses).toHaveLength(13);
  });

  it.each(statuses.map((s) => [s] as const))("VW-02 badge is toggle-invariant for %o", (s) => {
    const badges = TOGGLES.map((t) => mcpStatusView(s, t).badge);
    expect(new Set(badges).size).toBe(1);
    expect(badges[0]).toBe(s === null ? "none" : s.launch === "disabled" ? "off" : s.launch);
  });
});

describe("VW-03 metamorphic: the restart note ignores an agreeing toggle", () => {
  it("VW-03 note(null) equals note(toggle agreeing with disk) in all 8 pairs; restart in exactly 4", () => {
    let restartCount = 0;
    let pairs = 0;
    for (const launch of LAUNCHES) {
      for (const configured of ["enabled", "disabled"] as const) {
        const s = { launch, configured };
        const a = mcpStatusView(s, null).note;
        const b = mcpStatusView(s, configured === "enabled").note;
        expect(b, `${launch}/${configured}`).toBe(a);
        const shouldRestart = (configured === "enabled") !== (launch !== "disabled");
        expect(a === "restartPending", `${launch}/${configured}`).toBe(shouldRestart);
        if (a === "restartPending") restartCount += 1;
        pairs += 1;
      }
    }
    expect(pairs).toBe(8);
    expect(restartCount).toBe(4);
  });
});

describe("VW-04 metamorphic: unreadable dominates", () => {
  it("VW-04 replacing configured with unreadable always yields the unreadable note", () => {
    let checked = 0;
    for (const launch of LAUNCHES) {
      for (const toggle of TOGGLES) {
        for (const from of ["enabled", "disabled"] as const) {
          const before = mcpStatusView({ launch, configured: from }, toggle);
          const after = mcpStatusView({ launch, configured: "unreadable" }, toggle);
          expect(after.note, `${launch}/${String(toggle)}/${from}`).toBe("unreadable");
          expect(after.badge).toBe(before.badge);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(24);
  });
});

describe("N3 (ADR-0031 5b, WI-6) the notSaved biconditional over the full domain", () => {
  it("N3 note is notSaved exactly when status is readable, a toggle is pending, and it differs from disk", () => {
    const statuses = [null, ...LAUNCHES.flatMap((l) => CONFIGUREDS.map((c) => ({ launch: l, configured: c })))];
    const rows = statuses.flatMap((s) => TOGGLES.map((t) => ({ s, t })));
    expect(rows).toHaveLength(39);
    for (const { s, t } of rows) {
      const tag = `${JSON.stringify(s)} toggle=${String(t)}`;
      const predicate =
        s !== null && s.configured !== "unreadable" && t !== null && t !== (s.configured === "enabled");
      const note = mcpStatusView(s, t).note;
      expect(note === "notSaved", tag).toBe(predicate);
      if (s !== null && s.configured === "unreadable") expect(note, tag).not.toBe("notSaved");
    }
  });
});
