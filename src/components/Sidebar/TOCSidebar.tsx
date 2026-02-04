import { useCallback, type MouseEvent } from "react";
import type { TOCEntry } from "../../stores/tocStore";

interface TOCSidebarProps {
  /** Hierarchical TOC entries */
  entries: TOCEntry[];
  /** Currently active entry ID */
  activeEntryId: string | null;
  /** Collapsed entry IDs */
  collapsedIds: Set<string>;
  /** Handler for entry click (navigation) */
  onEntryClick: (id: string) => void;
  /** Handler for collapse toggle */
  onToggleCollapse: (id: string) => void;
}

interface TOCEntryItemProps {
  entry: TOCEntry;
  activeEntryId: string | null;
  collapsedIds: Set<string>;
  onEntryClick: (id: string) => void;
  onToggleCollapse: (id: string) => void;
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
  const isActive = entry.id === activeEntryId;
  const isCollapsed = collapsedIds.has(entry.id);
  const hasChildren = entry.children.length > 0;

  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      onEntryClick(entry.id);
    },
    [entry.id, onEntryClick]
  );

  const handleCollapseClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onToggleCollapse(entry.id);
    },
    [entry.id, onToggleCollapse]
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
          href={`#${entry.id}`}
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
              key={child.id}
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
            key={entry.id}
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
