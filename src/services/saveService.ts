/**
 * Purpose: Core save logic for handleSave, extracted from App.tsx.
 *
 * Extracted so it can be unit-tested without mounting the App component (#377).
 * The save path intentionally omits the busy-indicator lifecycle — toggling
 * that overlay causes a visible layout shift (blink) on Cmd+S. Local saves
 * complete fast enough that no progress indicator is needed; the "Saved" toast
 * is sufficient feedback.
 */

/** Dependencies injected by handleSave — separated for unit-testability. */
export interface SaveDeps {
  markSaveInProgress: () => void;
  saveActiveDocument: (
    id?: string,
  ) => Promise<{ path?: string | null; success?: boolean } | null | undefined>;
  updateRecentFiles: (path: string) => void;
  showToast: (message: string) => void;
}

/**
 * Execute a document save without mounting the busy overlay.
 *
 * Toggling the busy overlay on save causes a layout shift (blink) because the
 * border-bottom on `.busy-indicator` shifts the workspace down then up within
 * ~10–50 ms. Local saves don't need a progress indicator; the "Saved" toast
 * is sufficient.
 *
 * Also owns the save-side flush (D15): `flushActiveDocumentForSave` pushes pending
 * WYSIWYG edits into documentStore and returns the fresh active document, so the
 * bytes handed to `save_file` / `save_file_dialog` never come from a render
 * closure. A failed flush throws, which `performSave` surfaces as "Save failed:"
 * and which leaves the document dirty (rule 60: never save stale content silently).
 *
 * @coordinates-with src/hooks/useDocument.ts — saveActiveDocument / saveActiveDocumentAs
 * @coordinates-with src/stores/milkdownEditorStore.ts — flushPendingEdits
 */

import { useDocumentStore } from "../stores/documentStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import type { Document } from "../types/document";
import { loggingService } from "./loggingService";

/**
 * Flush pending WYSIWYG edits, then read the active document from the store.
 * Throws when the flush failed: saving would write content older than the editor.
 */
export function flushActiveDocumentForSave(actionId?: string): Document | null {
  const { status } = useMilkdownEditorStore.getState().flushPendingEdits("save");
  const doc = useDocumentStore.getState().getActiveDocument() ?? null;
  if (status === "failed") {
    loggingService.logEventSync({
      level: "error",
      event: "file.save",
      status: "fail",
      actionId: actionId ?? loggingService.generateActionId(),
      context: { documentId: doc?.id ?? null, cause: "flush-failed" },
    });
    throw new Error("editor changes could not be captured; the document was not saved");
  }
  return doc;
}
export async function performSave(
  actionId: string | undefined,
  deps: SaveDeps,
): Promise<void> {
  deps.markSaveInProgress();
  try {
    const result = await deps.saveActiveDocument(actionId);
    if (result?.path) deps.updateRecentFiles(result.path);
    if (result?.success) deps.showToast("Saved");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.showToast(`Save failed: ${message}`);
  }
}
