/**
 * M7 audit round 1, Medium (a), on the page: the Windows Find row shows
 * D19's "WYSIWYG: browser find bar" from the real command table; macOS
 * shows "Source only". Mock boundary: `@tauri-apps/api/core` only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";

const invoke = vi.hoisted(() => async (cmd: string): Promise<unknown> => {
  if (cmd === "get_preferences") {
    const { DEFAULT_KEYBOARD_SHORTCUTS: d } = await import("../src/types/preferences");
    return { keyboardShortcutsVersion: 1, keyboardShortcuts: { ...d } };
  }
  return null;
});

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true, invoke }),
);

import { KeyboardShortcutsSettings } from "../src/components/common/settings/KeyboardShortcutsSettings";

afterEach(() => {
  cleanup();
  delete (navigator as unknown as { platform?: string }).platform;
});

async function capabilityOfFind(platform: string): Promise<string | null> {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
  render(<KeyboardShortcutsSettings onClose={() => {}} />);
  await screen.findByText("Keyboard Shortcuts");
  const row = (await screen.findByText("Find", { selector: ".shortcut-label" })).closest(".shortcut-row");
  return row?.querySelector(".shortcut-capability")?.textContent ?? null;
}

describe("M7 (a) the Find row's capability line", () => {
  it("w1 Windows: WYSIWYG: browser find bar", async () => {
    expect(Object.keys(DEFAULT_KEYBOARD_SHORTCUTS)).toContain("editFind");
    expect(await capabilityOfFind("Win32")).toBe("WYSIWYG: browser find bar");
  });

  it("w2 macOS: Source only", async () => {
    expect(await capabilityOfFind("MacIntel")).toBe("Source only");
  });
});
