import { create } from "zustand";

import { loggingService } from "../services/loggingService";
import { asHeadingKey } from "../types/toc";
import type { HeadingKey, ParsedTOCEntry, TOCEntry } from "../types/toc";
import { coordinateHeadingKeys } from "../utils/headingCoordination";
import { evictDocument, pruneCollapsed, swapDocument } from "./tocCoordination";
import type { DocumentTOCState } from "./tocCoordination";

export type { DocumentTOCState } from "./tocCoordination";
// Re-exported, not re-implemented: moved to `./tocHierarchy` when WI-3.5.5 pushed this
// file past rule 50 §6's 300-line cap. Importers keep this path.
export { buildTOCHierarchy } from "./tocHierarchy";

/**
 * TOC store state interface.
 *
 * The flat fields (`entries` / `collapsedIds` / `activeEntryId`) are the storage for the
 * **current** document; `byDocument` archives every *other* document. That split keeps
 * the public surface — and therefore every prop down to `TOCSidebar` — unchanged, and
 * lets `collapsedIds` keep reference identity across a re-parse that prunes nothing.
 *
 * `isVisible` is deliberately **NOT** document-scoped: whether the TOC sidebar is open
 * is a UI preference belonging to the window, not a property of a document. Moving it
 * into the per-document triple would make the sidebar flicker shut on every tab switch.
 * Do not "fix" it.
 *
 * Invariant this shape buys its benefits with: the flat triple always describes
 * `documentId`. Only `setEntries` and `resetCoordination` may write it, and each writes
 * all of it. An action that updates one field without the other silently breaks
 * isolation — which is why `resetCoordination` also drops `documentId` to `null`
 * instead of leaving an emptied triple attributed to a live document.
 */
interface TOCState {
  /** All TOC entries for current document */
  entries: TOCEntry[];

  /** Which document `entries` / `collapsedIds` / `activeEntryId` describe */
  documentId: string | null;

  /** Currently active (highlighted) entry, by coordination key */
  activeEntryId: HeadingKey | null;

  /** Whether TOC view is visible in sidebar — a UI preference, never document-scoped */
  isVisible: boolean;

  /** Collapsed entries, by coordination key (never by anchor slug) */
  collapsedIds: Set<HeadingKey>;

  /** Archived state of every document that is **not** the current one */
  byDocument: Map<string, DocumentTOCState>;
}

interface TOCStoreActions {
  /**
   * Replace the current document's TOC entries; the store mints or reuses one
   * `HeadingKey` per entry.
   *
   * `documentId` is an explicit parameter and not read from `documentStore`: it pairs
   * the headings with the document they were parsed from at the caller's render, so a
   * debounced parse that lands after a tab switch cannot attribute one document's
   * headings to another.
   */
  setEntries: (entries: ParsedTOCEntry[], documentId: string | null) => void;

  /** Set the active entry (highlighted in TOC) */
  setActiveEntry: (key: HeadingKey | null) => void;

  /** Toggle TOC visibility in sidebar */
  toggleVisibility: () => void;

  /** Set TOC visibility explicitly */
  setVisibility: (visible: boolean) => void;

  /** Toggle collapsed state of an entry */
  toggleCollapsed: (key: HeadingKey) => void;

  /** Navigate to a specific entry (will be handled by hook) */
  navigateToEntry: (key: HeadingKey) => void;

  /**
   * Annihilate coordination state for one document — RESET clause (b) of the
   * `headingKey` contract in `src/types/toc.ts`. A *wholesale content replacement* voids
   * every heading identity the previous revision minted, so nothing may be carried over:
   * guessing and handing one heading's collapse state to another is worse than losing
   * it, because the user cannot see that it happened.
   *
   * Clears the flat triple (and drops `documentId` to `null`) when `documentId` is the
   * current document; evicts `documentId` from the archive in every case. Safe to call
   * with an id the store has never seen.
   *
   * **The callers.** Six wholesale replacement sites — `openWriteGuard.ts`
   * `commitOpenedDocument` (the one write for `useDocument.ts` `openDocumentFromPath`,
   * `openDocumentFromDialog` and `openDocumentWithEncoding`, D20 / ADR-0028 decision 4;
   * it resets only when the target is clean — a dirty tab is focused, not replaced);
   * `useDocument.ts` `createDocument`, `upsertAndActivateDocument` (draft recovery, dev
   * open) and `replaceDocument` (file reload, incl. the external file-watcher route);
   * plus `useMcpEvents.ts` `handleWriteDocument` and `handleCreateDocument`. The open
   * paths count because `Document.id` is a hash of the path and `upsertDocument`
   * replaces in place, so re-opening an open file swaps the buffer under an unchanged
   * id. Two more callers evict without resetting live state — `useDocument.ts`
   * `closeActiveDocument` and `closeDocumentById` — which bounds `byDocument` across a
   * long session and stops close→reopen of the same path inheriting a stale outline.
   *
   * **Do NOT call this from `saveActiveDocument` or `saveActiveDocumentAs`.** Both reach
   * `upsertDocument` and so look like replacements, but they spread `...activeDocument`
   * and change only `path` / `isModified` / `lastSaved` — plus, for ⌘S with the opt-in
   * table autoformat, table rows, which never touch a heading line. Resetting there
   * would wipe the user's collapse state on every save. The keystroke path
   * (`updateActiveDocumentContent`), MCP `insert_content`, MCP `table_action` and both
   * `App.handleImageDrop` branches are ordinary edits for the same reason.
   *
   * `tests/wholesale-path-partition.test.ts` re-derives that partition from `src/` on
   * every run, so a new caller fails the suite until someone classifies it.
   */
  resetCoordination: (documentId: string | null) => void;
}

type TOCStore = TOCState & TOCStoreActions;

// Navigation callback - set by useTOC hook
let navigationCallback: ((key: HeadingKey) => void) | null = null;

export const setNavigationCallback = (callback: (key: HeadingKey) => void) => {
  navigationCallback = callback;
};

/**
 * Monotone key sequence. Store-owned and deliberately never reset — not per document,
 * not per archive round-trip: a key handed out once must never be handed out again, or
 * state from a retired heading could land on a new one. Document isolation is
 * structural (the per-document archive); this makes it belt-and-braces, because two
 * documents cannot collide even if the archive were bypassed. Opaque by construction —
 * nothing may parse it or order by it.
 */
let keySequence = 0;

function mintHeadingKey(): HeadingKey {
  keySequence += 1;
  return asHeadingKey(`hk-${keySequence}`);
}

export const useTOCStore = create<TOCStore>((set) => ({
  // Initial state
  entries: [],
  documentId: null,
  activeEntryId: null,
  isVisible: false,
  collapsedIds: new Set<HeadingKey>(),
  byDocument: new Map<string, DocumentTOCState>(),

  // Actions
  setEntries: (entries, documentId) =>
    set((state) => {
      const switching = documentId !== state.documentId;
      const swap = switching
        ? swapDocument(
            {
              documentId: state.documentId,
              headings: state.entries,
              collapsed: state.collapsedIds,
              active: state.activeEntryId,
            },
            state.byDocument,
            documentId,
          )
        : null;

      const byDocument = swap ? swap.byDocument : state.byDocument;
      const previousHeadings = swap ? swap.loaded.headings : state.entries;
      const carriedCollapsed = swap ? swap.loaded.collapsed : state.collapsedIds;
      const carriedActive = swap ? swap.loaded.active : state.activeEntryId;

      // No document, no coordination: nothing may be attributed to a heading list that
      // belongs to no document, and no archive entry is created under a null id.
      if (documentId === null) {
        return {
          entries: [],
          documentId: null,
          collapsedIds: carriedCollapsed.size === 0 ? carriedCollapsed : new Set<HeadingKey>(),
          activeEntryId: null,
          byDocument,
        };
      }

      const keys = coordinateHeadingKeys(previousHeadings, entries, mintHeadingKey);
      // Positions come from the new revision, always. The matcher reuses the key and
      // nothing else — inheriting `lineNumber` / `offset` would make a stale position
      // masquerade as an identity, which `src/types/toc.ts` forbids.
      const nextEntries: TOCEntry[] = entries.map((entry, index) => ({
        ...entry,
        key: keys[index],
        children: [],
      }));

      const present = new Set<HeadingKey>(keys);
      return {
        entries: nextEntries,
        documentId,
        collapsedIds: pruneCollapsed(carriedCollapsed, present),
        activeEntryId:
          carriedActive !== null && present.has(carriedActive) ? carriedActive : null,
        byDocument,
      };
    }),

  setActiveEntry: (key) => set({ activeEntryId: key }),

  toggleVisibility: () => set((state) => ({ isVisible: !state.isVisible })),

  setVisibility: (visible) => set({ isVisible: visible }),

  toggleCollapsed: (key) =>
    set((state) => {
      const newCollapsedIds = new Set(state.collapsedIds);
      if (newCollapsedIds.has(key)) {
        newCollapsedIds.delete(key);
      } else {
        newCollapsedIds.add(key);
      }
      return { collapsedIds: newCollapsedIds };
    }),

  navigateToEntry: (key) => {
    if (navigationCallback) {
      navigationCallback(key);
    }
  },

  resetCoordination: (documentId) => {
    // One log line per reset, and deliberately none in `setEntries`: the reset is rare
    // and it is the path that destroys user state, so it is the one worth a trail. A
    // line per keystroke would flood ~/.mdpro/mdpro.log (same reasoning tocService
    // already records for the parse path). Emitted outside `set` so a re-entrant
    // updater cannot double-count it.
    loggingService.logEventSync({
      level: "info",
      event: "ui.toc.coordination.reset",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { documentId },
    });
    set((state) => {
      const byDocument = evictDocument(state.byDocument, documentId);
      if (documentId !== state.documentId) return { byDocument };
      return {
        entries: [],
        documentId: null,
        activeEntryId: null,
        collapsedIds: new Set<HeadingKey>(),
        byDocument,
      };
    });
  },
}));
