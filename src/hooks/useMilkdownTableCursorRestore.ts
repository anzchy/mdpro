/**
 * @module useMilkdownTableCursorRestore
 * Purpose: When arriving in WYSIWYG mode after a mode toggle, place
 * the cursor in the cell captured on the source side (Phase 2 WI-2.6).
 * Extracted from MilkdownEditor.tsx (audit M7) to keep that file
 * under the 300-line guideline.
 *
 * Audit-fix M2: scope consume to the active document so a re-mount
 * after a doc-switch can't steal a stale capture.
 *
 * Audit-fix M3: deps are `[editor.loading, activeDocumentId]` — `editor`
 * itself is excluded because Milkdown's `useEditor` returns a new
 * wrapper on every render and would re-fire this effect even when
 * `loading` hasn't actually changed.
 *
 * @coordinates-with src/utils/cursorSync/table.ts
 * @coordinates-with src/utils/cursorSync/tableMilkdown.ts
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 */

import { useEffect } from "react";
import type { useEditor } from "@milkdown/react";
import { consumePendingTableCell } from "../utils/cursorSync/table";
import { restoreCellInMilkdownEditor } from "../utils/cursorSync/tableMilkdown";

type MilkdownEditorReturn = ReturnType<typeof useEditor>;

export function useMilkdownTableCursorRestore(
  editor: MilkdownEditorReturn,
  activeDocumentId: string | null,
): void {
  useEffect(() => {
    if (editor.loading) return;
    const instance = editor.get();
    if (!instance) return;
    const pending = consumePendingTableCell(activeDocumentId);
    if (!pending) return;
    restoreCellInMilkdownEditor(instance, pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.loading, activeDocumentId]);
}
