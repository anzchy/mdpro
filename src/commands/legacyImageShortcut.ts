/**
 * Purpose: read-time interpretation of the legacy Image default across platforms.
 * The stored preference is never migrated by this helper.
 * @coordinates-with bindingConflicts.ts
 * @coordinates-with ../components/common/settings/KeyboardShortcutsSettings.tsx
 */
import type { Platform } from "./commandTable.types";

const LEGACY_IMAGE_DEFAULT = "Cmd+Ctrl+I";
const KEYLESS = "<unassigned>";

/** Empty means the platform default; only an explicit different chord is custom. */
export function effectiveImageShortcut(platform: Platform, stored: string): string {
  if (stored === "") return platform === "macos" ? LEGACY_IMAGE_DEFAULT : KEYLESS;
  if (platform !== "macos" && stored === LEGACY_IMAGE_DEFAULT) return KEYLESS;
  return stored;
}
