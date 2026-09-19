import { useCallback, type MouseEvent } from "react";
import type { HeadingKey, TOCEntry } from "../../types/toc";

interface TOCSidebarProps {
  /** Hierarchical TOC entries */
  entries: TOCEntry[];
  /** Currently active entry, by coordination key */
  activeEntryId: HeadingKey | null;
  /** Collapsed entries, by coordination key */
  collapsedIds: Set<HeadingKey>;
  /** Handler for entry click (navigation) */
  onEntryClick: (key: HeadingKey) => void;
  /** Handler for collapse toggle */
  onToggleCollapse: (key: HeadingKey) => void;
}

interface TOCEntryItemProps {
  entry: TOCEntry;
  activeEntryId: HeadingKey | null;
  collapsedIds: Set<HeadingKey>;
  onEntryClick: (key: HeadingKey) => void;
  onToggleCollapse: (key: HeadingKey) => void;
  depth: number;
}

function TOCEntryItem({
  entry,
  activeEntryId,
  collapsedIds,
  onEntryClick,
  onToggleCollapse,
  depth,
}: TOCEntryItemProps) {
  // Active and collapsed state hang off the coordination key, never the anchor slug —
  // the slug changes on rename, which would silently drop the state.
  const isActive = entry.key === activeEntryId;
  const isCollapsed = collapsedIds.has(entry.key);
  const hasChildren = entry.children.length > 0;

  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      onEntryClick(entry.key);
    },
    [entry.key, onEntryClick]
  );

  const handleCollapseClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onToggleCollapse(entry.key);
    },
    [entry.key, onToggleCollapse]
  );

  return (
    <li className="toc-entry" data-level={entry.level}>
      <div
        className={`toc-entry__content ${isActive ? "toc-entry__content--active" : ""}`}
        style={{ paddingLeft: `${(depth) * 12 + 8}px` }}
      >
        {hasChildren && (
          <button
            className={`toc-entry__collapse ${isCollapsed ? "toc-entry__collapse--collapsed" : ""}`}
            onClick={handleCollapseClick}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            aria-expanded={!isCollapsed}
          >
            <span className="toc-entry__collapse-icon">
              {isCollapsed ? "▸" : "▾"}
            </span>
          </button>
        )}
        {!hasChildren && <span className="toc-entry__spacer" />}
        <a
          href={`#${entry.anchorSlug}`}
          className="toc-entry__link"
          onClick={handleClick}
          title={entry.text}
        >
          <span className="toc-entry__text">{entry.text}</span>
        </a>
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="toc-entry__children">
          {entry.children.map((child) => (
            <TOCEntryItem
              key={child.key}
              entry={child}
              activeEntryId={activeEntryId}
              collapsedIds={collapsedIds}
              onEntryClick={onEntryClick}
              onToggleCollapse={onToggleCollapse}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TOCSidebar({
  entries,
  activeEntryId,
  collapsedIds,
  onEntryClick,
  onToggleCollapse,
}: TOCSidebarProps) {
  if (entries.length === 0) {
    return (
      <div className="toc-sidebar toc-sidebar--empty">
        <div className="toc-sidebar__empty-message">
          No headings found in this document.
        </div>
      </div>
    );
  }

  return (
    <nav className="toc-sidebar" aria-label="Table of Contents">
      <ul className="toc-sidebar__list">
        {entries.map((entry) => (
          <TOCEntryItem
            key={entry.key}
            entry={entry}
            activeEntryId={activeEntryId}
            collapsedIds={collapsedIds}
            onEntryClick={onEntryClick}
            onToggleCollapse={onToggleCollapse}
            depth={0}
          />
        ))}
      </ul>
    </nav>
  );
}
