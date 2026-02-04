import type { TOCEntry } from "../../stores/tocStore";
import { TOCSidebar } from "./TOCSidebar";

export type SidebarView = "files" | "toc";

interface TOCSidebarContainerProps {
  /** TOC entries */
  tocEntries: TOCEntry[];
  /** Active TOC entry ID */
  activeTocEntryId: string | null;
  /** Collapsed TOC entry IDs */
  collapsedTocIds: Set<string>;
  /** Handler for TOC entry click */
  onTocEntryClick: (id: string) => void;
  /** Handler for TOC collapse toggle */
  onTocToggleCollapse: (id: string) => void;
}

export function TOCSidebarContainer({
  tocEntries,
  activeTocEntryId,
  collapsedTocIds,
  onTocEntryClick,
  onTocToggleCollapse,
}: TOCSidebarContainerProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">Table of Contents</div>
      <TOCSidebar
        entries={tocEntries}
        activeEntryId={activeTocEntryId}
        collapsedIds={collapsedTocIds}
        onEntryClick={onTocEntryClick}
        onToggleCollapse={onTocToggleCollapse}
      />
    </aside>
  );
}

// Re-export components
export { Sidebar } from "./Sidebar";
export { TOCSidebar } from "./TOCSidebar";
