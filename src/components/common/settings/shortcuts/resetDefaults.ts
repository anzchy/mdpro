/**
 * Purpose: what Settings › Keyboard Shortcuts' Reset restores: each
 * configurable field's command-table default on the platform at the stored
 * defaults version, `<unassigned>` and `<system>` included (plan § 6 M7).
 * It replaces the v1-only `DEFAULT_KEYBOARD_SHORTCUTS`, so M1b's v2 needs no
 * change here.
 *
 * @coordinates-with src/commands/commandTable.ts — rowByPrefField
 */
import { rowByPrefField } from "../../../../commands/commandTable";
import type { Platform } from "../../../../commands/commandTable.types";
import { DEFAULT_KEYBOARD_SHORTCUTS, type KeyboardShortcuts } from "../../../../types/preferences";

export function resetDefaults(platform: Platform, version: number): KeyboardShortcuts {
  const ver = version >= 2 ? "v2" : "v1";
  const out: KeyboardShortcuts = { ...DEFAULT_KEYBOARD_SHORTCUTS };
  for (const field of Object.keys(DEFAULT_KEYBOARD_SHORTCUTS) as (keyof KeyboardShortcuts)[]) {
    const key = rowByPrefField(field)?.key[platform];
    if (key?.kind !== "configurable") throw new Error(`no configurable row for ${field}`);
    out[field] = key.defaults[ver];
  }
  return out;
}
