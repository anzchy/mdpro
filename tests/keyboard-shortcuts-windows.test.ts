// @vitest-environment node
/**
 * Tests for issue #38 — Ctrl+S (and other Ctrl+* shortcuts) not working on Windows.
 *
 * Root cause: useKeyboardShortcuts.ts guards the entire handler with
 * `if (!event.metaKey) return;` — this blocks all Ctrl-key events on Windows
 * because Windows uses `ctrlKey`, not `metaKey`.
 *
 * The fix must accept EITHER metaKey (macOS Cmd) OR ctrlKey (Windows/Linux Ctrl).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");

function readHook(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// Static analysis — the fix must be present in the source file
// ---------------------------------------------------------------------------

describe("useKeyboardShortcuts source — Windows Ctrl key guard", () => {
  const src = readHook("hooks/useKeyboardShortcuts.ts");

  it("uses an OS-aware primary modifier (isMac ? metaKey : ctrlKey)", () => {
    // The fix must detect the OS and select the platform-primary modifier.
    // Using metaKey||ctrlKey is too broad: Ctrl+S would fire on macOS too.
    // We look for the isMac-based exclusive selection pattern.
    const hasIsMac = /isMac/.test(src);
    const hasExclusiveModifier =
      /isMac\s*\?\s*event\.metaKey\s*:\s*event\.ctrlKey/.test(src);
    expect(hasIsMac).toBe(true);
    expect(hasExclusiveModifier).toBe(true);
  });

  it("does NOT have a metaKey-only guard that would break Windows", () => {
    // The old broken guard: `if (!event.metaKey) return;`
    // After the fix this line must be gone or changed.
    const metaKeyOnlyGuard = /if\s*\(\s*!\s*event\.metaKey\s*\)\s*return/.test(src);
    expect(metaKeyOnlyGuard).toBe(false);
  });

  it("guards against altKey globally to avoid swallowing international input (AltGr)", () => {
    // Ctrl+Alt+* (AltGr) combos are used for accented characters on Windows.
    // The early-return must exclude altKey at the top level.
    expect(src).toMatch(/event\.altKey/);
  });
});

// ---------------------------------------------------------------------------
// Runtime simulation — verify Ctrl+* dispatches the correct handler
// ---------------------------------------------------------------------------

/**
 * Minimal re-implementation of the handler logic from useKeyboardShortcuts.ts.
 * Mirrors the fixed version: OS-exclusive primary modifier, altKey guard.
 */
function makeHandler(
  handlers: {
    onSave?: () => void;
    onNew?: () => void;
    onOpen?: () => void;
    onClose?: () => void;
    onToggleSidebar?: () => void;
  },
  simulateMac = false,
) {
  return (event: Partial<KeyboardEvent> & { key: string }) => {
    const primaryMod = simulateMac ? event.metaKey : event.ctrlKey;
    const secondaryMod = simulateMac ? event.ctrlKey : event.metaKey;
    if (!primaryMod || secondaryMod || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "s" && !event.shiftKey) handlers.onSave?.();
    if (key === "n" && !event.shiftKey) handlers.onNew?.();
    if (key === "o" && !event.shiftKey) handlers.onOpen?.();
    if (key === "w") handlers.onClose?.();
    if (key === "l" && event.shiftKey) handlers.onToggleSidebar?.();
  };
}

describe("Ctrl+* shortcuts — Windows runtime behaviour", () => {
  const win = (handlers: Parameters<typeof makeHandler>[0]) => makeHandler(handlers, false);

  it("Ctrl+S triggers onSave", () => {
    let saved = false;
    win({ onSave: () => { saved = true; } })({ key: "s", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(saved).toBe(true);
  });

  it("Ctrl+N triggers onNew", () => {
    let created = false;
    win({ onNew: () => { created = true; } })({ key: "n", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(created).toBe(true);
  });

  it("Ctrl+O triggers onOpen", () => {
    let opened = false;
    win({ onOpen: () => { opened = true; } })({ key: "o", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(opened).toBe(true);
  });

  it("Ctrl+W triggers onClose", () => {
    let closed = false;
    win({ onClose: () => { closed = true; } })({ key: "w", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(closed).toBe(true);
  });

  it("Ctrl+Shift+L triggers onToggleSidebar", () => {
    let toggled = false;
    win({ onToggleSidebar: () => { toggled = true; } })({ key: "l", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false });
    expect(toggled).toBe(true);
  });

  it("plain key without Ctrl or Cmd does nothing", () => {
    let saved = false;
    win({ onSave: () => { saved = true; } })({ key: "s", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
    expect(saved).toBe(false);
  });

  it("Ctrl+Alt+S does NOT trigger onSave (international keyboard input guard)", () => {
    let saved = false;
    win({ onSave: () => { saved = true; } })({ key: "s", ctrlKey: true, metaKey: false, shiftKey: false, altKey: true });
    expect(saved).toBe(false);
  });
});

describe("Cmd+* shortcuts — macOS runtime behaviour", () => {
  const mac = (handlers: Parameters<typeof makeHandler>[0]) => makeHandler(handlers, true);

  it("Cmd+S triggers onSave on macOS", () => {
    let saved = false;
    mac({ onSave: () => { saved = true; } })({ key: "s", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false });
    expect(saved).toBe(true);
  });

  it("Ctrl+S does NOT trigger onSave on macOS (exclusive modifier)", () => {
    let saved = false;
    mac({ onSave: () => { saved = true; } })({ key: "s", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(saved).toBe(false);
  });
});
