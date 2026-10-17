/**
 * Purpose: ADR-0114 K5's reserved chords per platform, which no editor-command
 * default may take, and K3's named exceptions. Data only; in M1a production
 * reads it only through Settings' conflict check (M1A-WI-10).
 *
 * @coordinates-with src/commands/commandTable.ts — the defaults K5 is checked on
 */
import type { CommandId, PerPlatform } from "./commandTable.types";

/**
 * macOS: the system and app-menu chords K5 lists. Windows / Linux: Alt+F4.
 * K5's Win-key chords are not listed: the stored grammar has no Win modifier,
 * so no stored default can name one.
 */
const OFF_MAC: readonly string[] = ["Option+F4"];

export const RESERVED_CHORDS: PerPlatform<readonly string[]> = {
  macos: [
    "Cmd+Option+H", "Cmd+M", "Cmd+Q", "Cmd+Option+Q", "Cmd+Ctrl+F", "Cmd+`",
    "Cmd+Tab", "Cmd+Space", "Cmd+Shift+Q", "Cmd+Shift+3", "Cmd+Shift+4", "Cmd+Shift+5",
  ],
  windows: OFF_MAC,
  linux: OFF_MAC,
};

/** K3: commands allowed to keep a reserved chord by name. None. */
export const K3_EXCEPTIONS: readonly CommandId[] = [];
