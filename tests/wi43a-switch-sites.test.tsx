/**
 * WI-4.3a CRITICAL regression: every checkbox `ToggleSwitch` replaced still
 * writes the same preference key and value it wrote before.
 *
 * Table-driven over `SWITCH_SITES` (tests/support/settingsRowSites.ts). Each
 * case starts from a fixture where every boolean is false, turns one switch on
 * by click, and compares the one write that crossed the service boundary with
 * the write the old checkbox made. A switch that renders but writes the wrong
 * group, the wrong key or a partial group fails here, not just a missing role.
 *
 * Mock boundary: `@tauri-apps/api/core` (no transport) and spies on
 * `preferencesService`, `loggingService.setLoggingSettings` and `mcpService`.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { SWITCH_SITES, installBoundary, renderPanel } from "./support/settingsRowSites";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WI-4.3a: each replaced checkbox writes what it wrote before", () => {
  it("covers all nine sites: three Integrations toggles and six native checkboxes", () => {
    expect(SWITCH_SITES).toHaveLength(9);
  });

  it.each(SWITCH_SITES.map((s) => [s.panel, s.title, s] as const))(
    "%s › %s",
    async (_panel, title, site) => {
      const user = userEvent.setup();
      const boundary = installBoundary();
      await renderPanel(site.panel, boundary, title);
      const sw = screen.getByRole("switch", { name: title });
      expect(sw).toHaveAttribute("aria-checked", "false");

      await user.click(sw);

      await waitFor(() => expect(site.write(boundary)).toEqual([site.expected]));
      expect(sw).toHaveAttribute("aria-checked", "true");
    },
  );
});
