/**
 * D190-WI-7 (W7): what mdpro shows on Windows and Linux.
 *
 * The stored shortcut strings are platform-neutral: "Cmd" is the primary
 * modifier (⌘ on macOS, Ctrl elsewhere) and "Option" is Alt, which is how
 * `useKeyboardShortcuts.matchesShortcut` reads them. Settings showed them raw,
 * so a Windows user saw "Cmd+S". The recorder wrote "Cmd" for the Windows key,
 * which never triggers a shortcut there, and "Ctrl" for Ctrl.
 *
 * Also pinned here: the off-Mac display of the three entries ADR-0096 moved
 * (Source, WYSIWYG, strikethrough), the New Document tooltip, the log-file
 * hint, and the recovery dialog's draft time (the raw RFC 3339 string before).
 */
import { describe, expect, it } from "vitest";
import {
  displayedShortcut,
  draftTimeLabel,
  logFileHint,
  newDocumentTooltip,
  recordedShortcut,
  shortcutLabel,
  type RecordedKey,
} from "../src/utils/platformLabels";

const key = (k: string, mods: Partial<RecordedKey> = {}): RecordedKey => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("D190-WI-7 shortcut labels", () => {
  it("l1 off-Mac, Cmd shows as Ctrl and Option as Alt", () => {
    expect(shortcutLabel("Cmd+S", false)).toBe("Ctrl+S");
    expect(shortcutLabel("Cmd+Option+T", false)).toBe("Ctrl+Alt+T");
    expect(shortcutLabel("Cmd+Shift+L", false)).toBe("Ctrl+Shift+L");
  });

  it("l2 off-Mac, Cmd+Ctrl collapses to one Ctrl, as matchesShortcut reads it", () => {
    expect(shortcutLabel("Cmd+Ctrl+I", false)).toBe("Ctrl+I");
    expect(shortcutLabel("Ctrl+Shift+`", false)).toBe("Ctrl+Shift+`");
  });

  it("l3 macOS labels are the stored strings, unchanged", () => {
    for (const s of ["Cmd+S", "Cmd+Option+T", "Cmd+Ctrl+I", "Ctrl+2"]) {
      expect(shortcutLabel(s, true)).toBe(s);
    }
  });

  it("l4 off-Mac, Source and WYSIWYG at their defaults show the Ctrl+/ toggle (ADR-0096)", () => {
    expect(displayedShortcut("viewSource", "Ctrl+2", false)).toBe("Ctrl+/ (toggle)");
    expect(displayedShortcut("viewWysiwyg", "Ctrl+4", false)).toBe("Ctrl+/ (toggle)");
  });

  it("l5 off-Mac, strikethrough at its default shows Alt+Shift+5 (ADR-0096)", () => {
    expect(displayedShortcut("formatStrike", "Ctrl+Shift+`", false)).toBe("Alt+Shift+5");
  });

  it("l6 a customised value shows its own label, and macOS shows defaults as stored", () => {
    expect(displayedShortcut("viewSource", "Cmd+Option+S", false)).toBe("Ctrl+Alt+S");
    expect(displayedShortcut("viewSource", "Ctrl+2", true)).toBe("Ctrl+2");
    expect(displayedShortcut("formatStrike", "Ctrl+Shift+`", true)).toBe("Ctrl+Shift+`");
    expect(displayedShortcut("fileSave", "Cmd+S", false)).toBe("Ctrl+S");
  });
});

describe("D190-WI-7 the recorder", () => {
  it("r1 off-Mac, Ctrl records as the primary modifier Cmd and Alt as Option", () => {
    expect(recordedShortcut(key("s", { ctrlKey: true }), false)).toBe("Cmd+S");
    expect(recordedShortcut(key("t", { ctrlKey: true, altKey: true }), false)).toBe("Cmd+Option+T");
    expect(recordedShortcut(key("N", { ctrlKey: true, shiftKey: true }), false)).toBe("Cmd+Shift+N");
  });

  it("r2 off-Mac, a chord with the Windows key is not recorded", () => {
    expect(recordedShortcut(key("s", { metaKey: true }), false)).toBeNull();
    expect(recordedShortcut(key("s", { metaKey: true, ctrlKey: true }), false)).toBeNull();
  });

  it("r3 macOS keeps Cmd for ⌘ and Ctrl for ⌃", () => {
    expect(recordedShortcut(key("s", { metaKey: true }), true)).toBe("Cmd+S");
    expect(recordedShortcut(key("s", { ctrlKey: true }), true)).toBe("Ctrl+S");
    expect(recordedShortcut(key("i", { metaKey: true, ctrlKey: true }), true)).toBe("Cmd+Ctrl+I");
  });

  it("r4 a recorded off-Mac chord shows as the keys the user pressed", () => {
    const stored = recordedShortcut(key("t", { ctrlKey: true, altKey: true }), false);
    expect(shortcutLabel(stored ?? "", false)).toBe("Ctrl+Alt+T");
  });

  it("r5 bare keys and lone modifiers keep waiting on both platforms", () => {
    for (const isMac of [true, false]) {
      expect(recordedShortcut(key("s"), isMac)).toBeNull();
      expect(recordedShortcut(key("Control", { ctrlKey: true }), isMac)).toBeNull();
    }
  });
});

describe("D190-WI-7 hints", () => {
  it("h1 the New Document tooltip names Ctrl+N off-Mac and ⌘N on macOS", () => {
    expect(newDocumentTooltip(false)).toBe("New Document (Ctrl+N)");
    expect(newDocumentTooltip(true)).toBe("New Document (⌘N)");
  });

  it("h2 the log-file hint names the Windows path on Windows", () => {
    expect(logFileHint(true)).toBe("Write structured logs to %USERPROFILE%\\.mdpro\\mdpro.log");
    expect(logFileHint(false)).toBe("Write structured logs to ~/.mdpro/mdpro.log");
  });

  it("h3 a draft time shows in local time, not as the raw RFC 3339 string", () => {
    const iso = "2026-10-14T09:30:00Z";
    expect(draftTimeLabel(iso)).toBe(new Date(iso).toLocaleString());
    expect(draftTimeLabel(iso)).not.toBe(iso);
  });

  it("h4 an unparseable draft time is shown as it came", () => {
    expect(draftTimeLabel("not a time")).toBe("not a time");
  });
});
