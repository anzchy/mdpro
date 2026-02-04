import { create } from "zustand";

/**
 * Represents a heading in the Table of Contents
 */
export interface TOCEntry {
  /** Unique identifier (generated anchor ID) */
  id: string;

  /** Heading level (1-6 for H1-H6) */
  level: 1 | 2 | 3 | 4 | 5 | 6;

  /** Heading text content */
  text: string;

  /** Line number in document (1-indexed) */
  lineNumber: number;

  /** Character offset from document start */
  offset: number;

  /** Whether this entry is currently in viewport (spy scrolling) */
  isActive: boolean;

  /** Child entries (for hierarchical display) */
  children: TOCEntry[];
}

/**
 * TOC store state interface
 */
interface TOCState {
  /** All TOC entries for current document */
  entries: TOCEntry[];

  /** Currently active (highlighted) entry ID */
  activeEntryId: string | null;

  /** Whether TOC view is visible in sidebar */
  isVisible: boolean;

  /** Collapsed entry IDs (for collapsible sections) */
  collapsedIds: Set<string>;
}

interface TOCStoreActions {
  /** Set all TOC entries */
  setEntries: (entries: TOCEntry[]) => void;

  /** Set the active entry (highlighted in TOC) */
  setActiveEntry: (id: string | null) => void;

  /** Toggle TOC visibility in sidebar */
  toggleVisibility: () => void;

  /** Set TOC visibility explicitly */
  setVisibility: (visible: boolean) => void;

  /** Toggle collapsed state of an entry */
  toggleCollapsed: (id: string) => void;

  /** Navigate to a specific entry (will be handled by hook) */
  navigateToEntry: (id: string) => void;

  /** Clear all entries (e.g., when document changes) */
  clearEntries: () => void;
}

type TOCStore = TOCState & TOCStoreActions;

// Navigation callback - set by useTOC hook
let navigationCallback: ((id: string) => void) | null = null;

export const setNavigationCallback = (callback: (id: string) => void) => {
  navigationCallback = callback;
};

export const useTOCStore = create<TOCStore>((set) => ({
  // Initial state
  entries: [],
  activeEntryId: null,
  isVisible: false,
  collapsedIds: new Set<string>(),

  // Actions
  setEntries: (entries) => set({ entries }),

  setActiveEntry: (id) => set({ activeEntryId: id }),

  toggleVisibility: () => set((state) => ({ isVisible: !state.isVisible })),

  setVisibility: (visible) => set({ isVisible: visible }),

  toggleCollapsed: (id) =>
    set((state) => {
      const newCollapsedIds = new Set(state.collapsedIds);
      if (newCollapsedIds.has(id)) {
        newCollapsedIds.delete(id);
      } else {
        newCollapsedIds.add(id);
      }
      return { collapsedIds: newCollapsedIds };
    }),

  navigateToEntry: (id) => {
    if (navigationCallback) {
      navigationCallback(id);
    }
  },

  clearEntries: () => set({ entries: [], activeEntryId: null }),
}));

/**
 * Generate anchor ID from heading text
 * Handles duplicates with numeric suffix
 */
export function generateAnchorId(
  text: string,
  existingIds: Set<string>
): string {
  // Base ID: lowercase, replace spaces with hyphens, remove special chars
  let baseId = text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");

  // Handle empty IDs
  if (!baseId) {
    baseId = "heading";
  }

  // Handle duplicates with numeric suffix
  let id = baseId;
  let counter = 1;
  while (existingIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter++;
  }

  return id;
}

/**
 * Build hierarchical TOC structure from flat entries
 */
export function buildTOCHierarchy(flatEntries: TOCEntry[]): TOCEntry[] {
  if (flatEntries.length === 0) return [];

  const result: TOCEntry[] = [];
  const stack: TOCEntry[] = [];

  for (const entry of flatEntries) {
    const newEntry: TOCEntry = { ...entry, children: [] };

    // Pop entries from stack that are at same or higher level
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Top-level entry
      result.push(newEntry);
    } else {
      // Child of the last entry on stack
      stack[stack.length - 1].children.push(newEntry);
    }

    stack.push(newEntry);
  }

  return result;
}
