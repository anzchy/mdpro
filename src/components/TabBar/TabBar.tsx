import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { Tab } from "./Tab";
import type { Tab as TabType } from "../../stores/tabStore";

export interface TabBarProps {
  /** All tabs to display */
  tabs: TabType[];
  /** Currently active tab ID */
  activeTabId: string | null;
  /** Position of the tab bar */
  position?: "top" | "bottom";
  /** Handler for tab click (switch) */
  onTabClick: (tabId: string) => void;
  /** Handler for tab close */
  onTabClose: (tabId: string) => void;
  /** Handler for new tab button click */
  onNewTab: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  position = "top",
  onTabClick,
  onTabClose,
  onNewTab,
}: TabBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (scrollContainerRef.current) {
      // Convert vertical scroll to horizontal
      scrollContainerRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  const handleNewTabClick = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      onNewTab();
    },
    [onNewTab]
  );

  return (
    <div
      className={`tab-bar tab-bar--${position}`}
      role="tablist"
      aria-label="Open documents"
    >
      <div
        className="tab-bar__scroll-container"
        ref={scrollContainerRef}
        onWheel={handleWheel}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            title={tab.title}
            isActive={tab.id === activeTabId}
            isDirty={tab.isDirty}
            isPinned={tab.isPinned}
            onClick={() => onTabClick(tab.id)}
            onClose={() => onTabClose(tab.id)}
            onMiddleClick={() => onTabClose(tab.id)}
          />
        ))}
      </div>
      <button
        className="tab-bar__new-tab"
        onClick={handleNewTabClick}
        aria-label="New document"
        title="New document"
      >
        +
      </button>
    </div>
  );
}
