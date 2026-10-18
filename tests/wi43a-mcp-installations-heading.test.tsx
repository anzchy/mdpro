/**
 * WI-4.3a fix (audit round 1, Fable M): the Integrations "Install MCP
 * Configuration" heading (`McpClientList`) lost its style when
 * `.settings-integrations h4` was deleted, because that panel-wide rule would
 * also have reached the new row titles. Its replacement is scoped to the client
 * list: it styles that heading with tokens and reaches no `.settings-row-label h4`.
 */
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAppCssNonTheme } from "../src/test/appCss";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { firstTitle, installBoundary, renderPanel } from "./support/settingsRowSites";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SELECTOR = ".mcp-installations > h4";

function declarations(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return new Map(
    body.split(";").map((d) => d.split(":").map((s) => s.trim())).filter(([p, v]) => p && v).map(([p, v]) => [p, v]),
  );
}

describe("WI-4.3a: the Install MCP Configuration heading keeps its style", () => {
  it("is styled by a rule scoped to the client list, with tokens", () => {
    const d = declarations(readAppCssNonTheme(), SELECTOR);
    expect(d.get("font-size")).toBe("var(--font-size-ui-lg)");
    expect(d.get("font-weight")).toBe("600");
    expect(d.get("margin")).toBe("0 0 8px 0");
  });

  it("reaches that heading and no row title", async () => {
    const { container } = await renderPanel("integrations", installBoundary(), firstTitle("integrations"));
    const reached = [...container.querySelectorAll(SELECTOR)].map((h) => h.textContent);
    expect(reached).toEqual(["Install MCP Configuration"]);
    const titles = [...container.querySelectorAll(".settings-row-label h4")];
    expect(titles).toHaveLength(3);
    expect(titles.filter((t) => t.matches(SELECTOR))).toEqual([]);
  });
});
