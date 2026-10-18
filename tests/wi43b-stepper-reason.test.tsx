/**
 * WI-4.3b: a disabled stepper button says why (rule 30 rule 4; DESIGN.md
 * § States › Disabled). Copy chosen by the user 2026-10-18:
 * 「"Smallest size is 12px" (Recommended)」.
 *
 * At a bound, Editor's Font Size row shows the reason as its description, and
 * the disabled − or + takes it as its accessible description. Between the
 * bounds there is no reason line.
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { preferencesService } from "../src/services/preferencesService";
import { LOADED, installBoundary, renderPanel } from "./support/settingsRowSites";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MIN_REASON = "Smallest size is 12px";
const MAX_REASON = "Largest size is 24px";

async function editorAt(fontSize: number) {
  const boundary = installBoundary();
  const prefs = structuredClone(LOADED);
  prefs.editor = { ...prefs.editor, fontSize };
  vi.mocked(preferencesService.getPreferences).mockResolvedValue(prefs);
  await renderPanel("editor", boundary, "Font Family");
}

function rowLabelOf(text: string): Element | null {
  return screen.getByText(text).closest(".settings-row-label");
}

describe("WI-4.3b: the Font Size stepper's disabled reason", () => {
  it("at the smallest size, − is disabled and described by the visible reason", async () => {
    await editorAt(12);
    const dec = screen.getByRole("button", { name: "Decrease" });
    expect(dec).toBeDisabled();
    expect(dec).toHaveAccessibleDescription(MIN_REASON);
    expect(rowLabelOf(MIN_REASON)).toBe(screen.getByRole("heading", { name: "Font Size" }).closest(".settings-row-label"));
  });

  it("at the largest size, + is disabled and described by the visible reason", async () => {
    await editorAt(24);
    const inc = screen.getByRole("button", { name: "Increase" });
    expect(inc).toBeDisabled();
    expect(inc).toHaveAccessibleDescription(MAX_REASON);
    expect(rowLabelOf(MAX_REASON)).not.toBeNull();
  });

  it("between the bounds there is no reason line and no description", async () => {
    await editorAt(16);
    expect(screen.queryByText(MIN_REASON)).toBeNull();
    expect(screen.queryByText(MAX_REASON)).toBeNull();
    expect(screen.getByRole("button", { name: "Decrease" })).not.toHaveAccessibleDescription();
  });

  it("stepping down to the bound shows the reason at once", async () => {
    const user = userEvent.setup();
    await editorAt(13);
    expect(screen.queryByText(MIN_REASON)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Decrease" }));
    expect(screen.getByText(MIN_REASON)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decrease" })).toHaveAccessibleDescription(MIN_REASON);
  });
});
