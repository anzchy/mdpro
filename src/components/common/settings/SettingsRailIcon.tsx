/**
 * SettingsRailIcon Component
 *
 * Purpose: the Settings rail's page glyphs (D260): one inline outline SVG per
 * Settings page, drawn on Lucide's geometry (ISC) plus an M↓ badge and four
 * dots drawn to match.
 *
 * Key decisions:
 * - Outline contract of DESIGN.md § Icons: 24 viewBox, 1.75 stroke, round caps
 *   and joins, `currentColor`, no fill. The rail exceptions (§ Icons > Settings
 *   rail exceptions) hold: 19px, set by width/height rather than CSS, and the
 *   glyph takes the row label's colour, so no CSS colours it.
 * - Decorative: `aria-hidden`, so a row's accessible name is its label alone.
 * - `GLYPHS` is keyed by `SettingsPageId`, so a page without a glyph fails `tsc`.
 * - Inline, no icon dependency (plan A7). Geometry source of truth:
 *   design/prototypes/011-d260-settings-rail.html `LUCIDE`.
 *
 * @coordinates-with src/components/common/SettingsDialog.tsx — renders one per rail row
 * @module components/common/settings/SettingsRailIcon
 */
import type { ReactElement } from "react";

/** Every Settings page id; the rail and its icon map are keyed by it. */
export type SettingsPageId =
  | "general"
  | "editor"
  | "markdown"
  | "image"
  | "integrations"
  | "export"
  | "appearance"
  | "keyboard-shortcuts"
  | "advanced"
  | "about";

/** The rail glyph's edge in px (DESIGN.md § Settings rail: a 19px outline icon). */
const RAIL_ICON_SIZE = 19;

const GLYPHS: Record<SettingsPageId, ReactElement> = {
  // file-text
  general: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  // pencil
  editor: (
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>
  ),
  // M↓ badge
  markdown: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 15V9l2.5 3L11 9v6" />
      <path d="M16.5 9v6" />
      <path d="m14 12.5 2.5 2.5 2.5-2.5" />
    </>
  ),
  // image
  image: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
  // plug
  integrations: (
    <>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </>
  ),
  // share
  export: (
    <>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M16 6 12 2 8 6" />
      <path d="M12 2v13" />
    </>
  ),
  // paint-bucket
  appearance: (
    <>
      <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" />
      <path d="m5 2 5 5" />
      <path d="M2 13h15" />
      <path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" />
    </>
  ),
  // keyboard
  "keyboard-shortcuts": (
    <>
      <path d="M10 8h.01" />
      <path d="M12 12h.01" />
      <path d="M14 8h.01" />
      <path d="M16 12h.01" />
      <path d="M18 8h.01" />
      <path d="M6 8h.01" />
      <path d="M7 16h10" />
      <path d="M8 12h.01" />
      <rect width="20" height="16" x="2" y="4" rx="2" />
    </>
  ),
  // four dots
  advanced: (
    <>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="7" r="2.5" />
      <circle cx="7" cy="17" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>
  ),
  // info
  about: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
};

interface SettingsRailIconProps {
  id: SettingsPageId;
}

/** The decorative outline glyph for Settings page `id`. */
export function SettingsRailIcon({ id }: SettingsRailIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={RAIL_ICON_SIZE}
      height={RAIL_ICON_SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[id]}
    </svg>
  );
}
