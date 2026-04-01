import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../stores/documentStore";
import { loggingService } from "../services/loggingService";

const extractTitle = (content: string) => {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
};

export function useAutoSave(autoSaveInterval: number) {
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId);
  const lastSaveRef = useRef<number>(0);

  useEffect(() => {
    if (!activeDocumentId) return;
    if (autoSaveInterval <= 0) return; // 0 = disabled

    const intervalMs = Math.max(autoSaveInterval * 1000, 5000);
    const interval = window.setInterval(async () => {
      const { documents } = useDocumentStore.getState();
      const activeDocument = documents.find((doc) => doc.id === activeDocumentId) ?? null;
      if (!activeDocument || !activeDocument.isModified) return;

      const now = Date.now();
      if (now - lastSaveRef.current < intervalMs - 5000) {
        return;
      }

      try {
        await invoke("save_draft", {
          documentId: activeDocument.id,
          content: activeDocument.content,
          originalPath: activeDocument.path,
          title: extractTitle(activeDocument.content),
        });
        lastSaveRef.current = now;
      } catch (err) {
        loggingService.logEventSync({
          level: 'warn',
          event: 'draft.auto_save',
          status: 'fail',
          context: { documentId: activeDocument.id, error: err instanceof Error ? err.message : String(err) },
        });
      }
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [activeDocumentId, autoSaveInterval]);
}
