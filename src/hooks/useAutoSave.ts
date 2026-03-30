import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../stores/documentStore";

const extractTitle = (content: string) => {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
};

export function useAutoSave(autoSaveInterval: number) {
  const { documents, activeDocumentId } = useDocumentStore();
  const lastSaveRef = useRef<number>(0);

  useEffect(() => {
    const activeDocument = documents.find((doc) => doc.id === activeDocumentId) ?? null;
    if (!activeDocument || !activeDocument.isModified) return;
    if (autoSaveInterval <= 0) return; // 0 = disabled

    const intervalMs = Math.max(autoSaveInterval * 1000, 5000);
    const interval = window.setInterval(async () => {
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
      } catch {
        // Ignore autosave errors for now.
      }
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [activeDocumentId, autoSaveInterval, documents]);
}
