import type { ViewMode } from "../types/editor";

/**
 * Migrate stored view mode strings from the old 4-mode model to the new 2-mode model.
 *
 * Migration map:
 *   "split"        → "wysiwyg"
 *   "preview-only" → "wysiwyg"
 *   "editor-only"  → "source"
 *   "wysiwyg"      → "wysiwyg"
 *   "source"       → "source"
 *   null/undefined/unknown → "wysiwyg" (default)
 */
export function migrateViewMode(mode: string | null | undefined): ViewMode {
  if (mode === "wysiwyg") return "wysiwyg";
  if (mode === "source" || mode === "editor-only") return "source";
  // "split", "preview-only", null, undefined, unknown → wysiwyg
  return "wysiwyg";
}
