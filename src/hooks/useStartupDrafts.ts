/**
 * Purpose: the recovery drafts this window offers at startup. On mount it prunes old
 * drafts, then lists what is left; the list feeds the draft-recovery dialog.
 *
 * Pipeline: mount → `invoke("cleanup_old_drafts")` (best-effort) →
 * `invoke("list_drafts")` → `drafts` state. The setter is returned so App can drop a
 * row once a draft is recovered or discarded.
 *
 * Key decisions:
 * - **Cleanup and listing fail independently.** A failed cleanup must not stop the
 *   listing; stale drafts may linger until the next launch. A failed listing leaves
 *   the list empty (web preview has no backend).
 * - **Runs once per mount, with a `mounted` flag,** so a late answer never sets state
 *   on an unmounted window.
 *
 * @coordinates-with src/App.tsx — passes `drafts` to AppDialogs, drops recovered rows
 * @coordinates-with src/services/draftService.ts — DraftMetadata
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { DraftMetadata } from "../services/draftService";

export function useStartupDrafts(): [DraftMetadata[], Dispatch<SetStateAction<DraftMetadata[]>>] {
  const [drafts, setDrafts] = useState<DraftMetadata[]>([]);

  useEffect(() => {
    let mounted = true;
    const loadDrafts = async () => {
      // Run cleanup independently so a failure does not prevent draft listing.
      try {
        await invoke("cleanup_old_drafts", {});
      } catch {
        // Best-effort — stale drafts may linger until next launch.
      }
      try {
        const found = await invoke<DraftMetadata[]>("list_drafts", {});
        if (mounted) setDrafts(found);
      } catch {
        // Ignore draft loading errors.
      }
    };
    void loadDrafts();
    return () => {
      mounted = false;
    };
  }, []);

  return [drafts, setDrafts];
}
