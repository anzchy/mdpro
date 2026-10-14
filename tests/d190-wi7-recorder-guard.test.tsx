/**
 * D190-WI-7, audit b100 Medium 1: while Settings → Keyboard Shortcuts is
 * recording a binding, the chord being recorded must not also run its
 * command. The recorder and `useKeyboardShortcuts` both listened on `window`
 * in the bubble phase, so the recorder's `stopPropagation` could not stop the
 * hook: recording Ctrl+Shift+N on Windows opened a new window, and recording
 * Ctrl+S saved.
 *
 * Only the recorder is guarded (delegator ruling): D165 deliberately lets
 * save, export and view actions run behind an open modal, so "a modal is
 * open" is not the condition.
 *
 * Real component, real hook, jsdom's platform (not "Mac", so off-Mac).
 * Mock boundary: `@tauri-apps/api/core` and the preferences service read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);
vi.mock("../src/services/preferencesService", async () => {
  const { DEFAULT_KEYBOARD_SHORTCUTS } = await import("../src/types/preferences");
  return {
    preferencesService: {
      getPreferences: vi.fn(async () => ({ keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS } })),
      setPreferences: vi.fn(async () => {}),
    },
  };
});

import { KeyboardShortcutsSettings } from "../src/components/common/settings/KeyboardShortcutsSettings";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";

afterEach(cleanup);

async function setup() {
  const onSave = vi.fn();
  const onNewWindow = vi.fn();
  renderHook(() => useKeyboardShortcuts({ onSave, onNewWindow }));
  render(<KeyboardShortcutsSettings onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText("New Window")).toBeTruthy());
  return { onSave, onNewWindow, user: userEvent.setup() };
}

function rowButton(label: string): HTMLElement {
  const row = screen.getByText(label).closest(".shortcut-row");
  const button = row?.querySelector("button");
  if (!(button instanceof HTMLElement)) throw new Error(`no button for ${label}`);
  return button;
}

describe("D190-WI-7 the shortcut recorder owns the keys it is recording", () => {
  it("g1 recording Ctrl+Shift+N stores it and does not open a window", async () => {
    const { onNewWindow, user } = await setup();
    await user.click(rowButton("New Window"));
    expect(rowButton("New Window").textContent).toBe("Press keys...");

    await user.keyboard("{Control>}{Shift>}N{/Shift}{/Control}");

    expect(onNewWindow).not.toHaveBeenCalled();
    expect(rowButton("New Window").textContent).toBe("Ctrl+Shift+N");
  });

  it("g2 recording Ctrl+S does not save", async () => {
    const { onSave, user } = await setup();
    await user.click(rowButton("Save"));
    await user.keyboard("{Control>}s{/Control}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("g3 once the recorder is done, the same chord runs its command again", async () => {
    const { onSave, user } = await setup();
    await user.click(rowButton("Save"));
    await user.keyboard("{Control>}s{/Control}");
    await user.keyboard("{Control>}s{/Control}");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("g4 Escape while recording cancels the recording without recording Escape", async () => {
    const { user } = await setup();
    await user.click(rowButton("Save"));
    await user.keyboard("{Escape}");
    expect(rowButton("Save").textContent).toBe("Ctrl+S");
  });
});
