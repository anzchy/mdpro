import { useCallback, type MouseEvent } from "react";

export interface TabProps {
  /** Unique tab ID */
  id: string;
  /** Tab display title */
  title: string;
  /** Whether the tab is currently active */
  isActive: boolean;
  /** Whether the tab has unsaved changes */
  isDirty: boolean;
  /** Whether the tab is pinned */
  isPinned: boolean;
  /** Handler for tab click (switch) */
  onClick: () => void;
  /** Handler for close button click */
  onClose: () => void;
  /** Handler for middle-click to close */
  onMiddleClick?: () => void;
}

export function Tab({
  id,
  title,
  isActive,
  isDirty,
  isPinned,
  onClick,
  onClose,
  onMiddleClick,
}: TabProps) {
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      // Middle-click to close
      if (e.button === 1 && onMiddleClick) {
        e.preventDefault();
        onMiddleClick();
      }
    },
    [onMiddleClick]
  );

  const handleCloseClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  return (
    <div
      className={`tab ${isActive ? "tab--active" : ""} ${isDirty ? "tab--dirty" : ""} ${isPinned ? "tab--pinned" : ""}`}
      onClick={onClick}
      onMouseDown={handleMouseDown}
      data-tab-id={id}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
    >
      <span className="tab__title" title={title}>
        {title}
      </span>
      {!isPinned && (
        <button
          className="tab__close"
          onClick={handleCloseClick}
          aria-label={`Close ${title}`}
          tabIndex={-1}
        >
          {isDirty ? (
            <span className="tab__dirty-indicator" aria-label="Unsaved changes">
              ●
            </span>
          ) : (
            <span className="tab__close-icon">×</span>
          )}
        </button>
      )}
      {isPinned && (
        <span className="tab__pin-indicator" aria-label="Pinned">
          📌
        </span>
      )}
    </div>
  );
}
