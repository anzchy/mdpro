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
 */
export async function performSave(
  actionId: string | undefined,
  deps: SaveDeps,
): Promise<void> {
  deps.markSaveInProgress();
  const result = await deps.saveActiveDocument(actionId);
  if (result?.path) deps.updateRecentFiles(result.path);
  if (result?.success) deps.showToast("Saved");
}
