import type { HeadingKey, TOCEntry } from "../../types/toc";
import type { ViewMode } from "../../types/editor";
import { SIDEBAR_ELEMENT_ID, type SidebarResizeSource } from "../../utils/sidebarWidth";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { TOCSidebar } from "./TOCSidebar";

export function getViewModeLabel(mode: ViewMode): string {
  switch (mode) {
    case "wysiwyg": return "WYSIWYG";
    case "source": return "SOURCE";
  }
}

interface TOCSidebarContainerProps {
  /** TOC entries */
  tocEntries: TOCEntry[];
  /** Active TOC entry, by coordination key */
  activeTocEntryId: HeadingKey | null;
  /** Collapsed TOC entries, by coordination key */
  collapsedTocIds: Set<HeadingKey>;
  /** Handler for TOC entry click */
  onTocEntryClick: (key: HeadingKey) => void;
  /** Handler for TOC collapse toggle */
  onTocToggleCollapse: (key: HeadingKey) => void;
  /** Current editor view mode — shown in the traffic-lights area */
  viewMode: ViewMode;
  /** Stored sidebar width, for the resize handle (D189) */
  sidebarWidth: number;
  /** Called once per settled resize */
  onSidebarResize: (width: number, source: SidebarResizeSource) => void;
}

export function TOCSidebarContainer({
  tocEntries,
  activeTocEntryId,
  collapsedTocIds,
  onTocEntryClick,
  onTocToggleCollapse,
  viewMode,
  sidebarWidth,
  onSidebarResize,
}: TOCSidebarContainerProps) {
  return (
    <aside className="sidebar" id={SIDEBAR_ELEMENT_ID}>
      {/* Traffic-lights zone: drag region + view-mode badge */}
      <div className="sidebar-traffic-area" data-tauri-drag-region>
        <span className="sidebar-mode-label" data-tauri-drag-region="false">{getViewModeLabel(viewMode)}</span>
      </div>
      <div className="sidebar-header">Table of Contents</div>
      <TOCSidebar
        entries={tocEntries}
        activeEntryId={activeTocEntryId}
        collapsedIds={collapsedTocIds}
        onEntryClick={onTocEntryClick}
        onToggleCollapse={onTocToggleCollapse}
      />
      <SidebarResizeHandle width={sidebarWidth} onCommit={onSidebarResize} />
    </aside>
  );
}

// Re-export components
export { TOCSidebar } from "./TOCSidebar";
