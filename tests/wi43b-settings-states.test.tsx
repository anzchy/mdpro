/**
 * WI-4.3b: the three settings states, table-driven over every page that reads
 * preferences (DESIGN.md § States › Settings; rule 30 rules 3 and 5).
 *
 * - Pending load: one busy "Loading…" line, with no inline style.
 * - Rejected load: the one shared failure line, never the raw rejection text.
 * - Rejected save: no inline error; the control returns to its saved value.
 *   The `preferencesService` toast is the only signal, and it is the service's
 *   job, so it is not asserted here.
 * - Shortcuts: a rejected save keeps the unsaved banner and the dialog open.
 *
 * Mock boundary: `@tauri-apps/api/core` and spies on `preferencesService`.
 */
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { preferencesService } from "../src/services/preferencesService";
import { installBoundary } from "./support/settingsRowSites";
import {
  LOAD_FAILED, LOAD_PAGES, SAVE_SITES, SECRET, renderStatePage, stubAppliedShortcuts,
} from "./support/settingsStatePages";
import { collectionCases } from "./support/collectionCases";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

describe("WI-4.3b: a pending load shows one busy Loading… line", () => {
  it.each(collectionCases("tests/wi43b-settings-states.test.tsx:38", LOAD_PAGES))("%s", (page) => {
    installBoundary();
    stubAppliedShortcuts();
    vi.mocked(preferencesService.getPreferences).mockImplementation(() => new Promise(() => {}));
    const { container } = renderStatePage(page);
    const busy = [...container.querySelectorAll('[aria-busy="true"]')];
    expect(busy).toHaveLength(1);
    expect(busy[0].textContent).toBe("Loading…");
    expect(busy[0]).not.toHaveAttribute("style");
  });
});

describe("WI-4.3b: a rejected load shows the shared failure line, not the raw message", () => {
  it.each(collectionCases("tests/wi43b-settings-states.test.tsx:51", LOAD_PAGES))("%s", async (page) => {
    installBoundary();
    stubAppliedShortcuts();
    vi.mocked(preferencesService.getPreferences).mockRejectedValue(new Error(SECRET));
    const { container } = renderStatePage(page);
    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();
    expect(container.textContent).not.toContain("EACCES");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe("WI-4.3b: a rejected save leaves no inline error and rolls the control back", () => {
  it.each(collectionCases("tests/wi43b-settings-states.test.tsx:63", SAVE_SITES.map((s) => [s.page, s.name, s] as const)))("%s › %s", async (_page, name, site) => {
    const user = userEvent.setup();
    installBoundary();
    vi.mocked(preferencesService.setPreferences).mockRejectedValue(new Error(SECRET));
    const { container } = renderStatePage(site.page);
    const control = await screen.findByRole(site.role, { name });

    if (site.role === "switch") await user.click(control);
    else await user.selectOptions(control, site.next ?? "");

    await waitFor(() => expect(preferencesService.setPreferences).toHaveBeenCalled());
    await settle();
    if (site.role === "switch") expect(control).toHaveAttribute("aria-checked", site.saved);
    else expect(control).toHaveValue(site.saved);
    expect(container.textContent).not.toContain("EACCES");
    expect(container.querySelector(".settings-error")).toBeNull();
  });

  it("shortcuts › a rejected Save keeps the unsaved banner and the dialog open, with no inline error", async () => {
    const user = userEvent.setup();
    installBoundary();
    stubAppliedShortcuts();
    vi.mocked(preferencesService.setPreferences).mockRejectedValue(new Error(SECRET));
    const onClose = vi.fn();
    const { container } = renderStatePage("shortcuts", onClose);

    await user.click(await screen.findByRole("button", { name: "Reset to Defaults" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(preferencesService.setPreferences).toHaveBeenCalled());
    await settle();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved shortcut changes")).toBeInTheDocument();
    expect(container.textContent).not.toContain("EACCES");
    expect(container.querySelector(".settings-error")).toBeNull();
  });
});
