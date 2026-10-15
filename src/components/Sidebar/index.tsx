import type { HeadingKey, TOCEntry } from "../../types/toc";
import { SIDEBAR_ELEMENT_ID, type SidebarResizeSource } from "../../utils/sidebarWidth";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { TOCSidebar } from "./TOCSidebar";


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
  sidebarWidth,
  onSidebarResize,
}: TOCSidebarContainerProps) {
  return (
    <aside className="sidebar" id={SIDEBAR_ELEMENT_ID}>
      {/* Traffic-lights zone: an empty window drag region. No header or mode
          badge (D223); the outline's nav keeps its accessible name. */}
      <div className="sidebar-traffic-area" data-tauri-drag-region />
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
