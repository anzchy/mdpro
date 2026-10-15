/**
 * Purpose: the one fixed sidebar toggle, first in the bottom tab bar (D189,
 * ADR-0088 decision 1). It stays in place in both states and swaps its icon
 * and name, so a second click undoes the first.
 *
 * Key decisions:
 * - `onToggle` is called with no arguments: the hook's `toggle` reads its
 *   first argument as an action id, and a click event is not one.
 * - `aria-controls` is set only while the sidebar is mounted, so it never
 *   names a missing element.
 * - Logs `ui.sidebar.toggle` `{ source: "button", to }`, so button use can be
 *   told apart from the menu and the shortcut; the write is logged by
 *   `preferencesService`.
 * - Icons are inline SVG drawn to DESIGN.md's set (24 viewBox, 1.75 stroke,
 *   round caps and joins, `currentColor`): lucide's `panel-left-close` and
 *   `panel-left` geometry, no icon dependency.
 *
 * @coordinates-with src/components/BottomTabs/BottomTabs.tsx
 * @coordinates-with src/hooks/useSidebarPreference.ts
 * @coordinates-with src/utils/platformLabels.ts
 */
import { loggingService } from "../../services/loggingService";
import { isMacPlatform, sidebarToggleLabel } from "../../utils/platformLabels";
import { SIDEBAR_ELEMENT_ID } from "../../utils/sidebarWidth";

interface SidebarToggleButtonProps {
  /** Whether the sidebar is shown now. */
  shown: boolean;
  onToggle: () => void;
}

const ICON_SIZE = 16;

function PanelIcon({ shown }: { shown: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      {shown ? <path d="m16 15-3-3 3-3" /> : null}
    </svg>
  );
}

export function SidebarToggleButton({ shown, onToggle }: SidebarToggleButtonProps) {
  const label = sidebarToggleLabel(shown, isMacPlatform());
  const handleClick = () => {
    loggingService.logUiEvent("ui.sidebar.toggle", {
      source: "button",
      to: shown ? "hidden" : "shown",
    });
    onToggle();
  };
  return (
    <button
      type="button"
      className="bottom-tabs__sidebar-toggle"
      aria-label={label}
      title={label}
      aria-expanded={shown}
      aria-controls={shown ? SIDEBAR_ELEMENT_ID : undefined}
      onClick={handleClick}
    >
      <PanelIcon shown={shown} />
    </button>
  );
}
