import { useEffect, useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";

export interface FileChangedEvent {
  path: string;
  changeType: "modified" | "deleted" | "renamed";
  newPath?: string;
  timestamp: number;
}

// Suppress window in ms after a save operation
const SAVE_SUPPRESS_WINDOW_MS = 3000;

export function useFileWatcher(activePath: string | null) {
  const [event, setEvent] = useState<FileChangedEvent | null>(null);
  const lastSaveTimestampRef = useRef<number>(0);

  // Call this when saving to suppress the next file change event
  const markSaveInProgress = useCallback(() => {
    lastSaveTimestampRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!activePath) return;
    let unlisten: (() => void) | null = null;

    listen<FileChangedEvent>("file:changed", (payload) => {
      if (payload.payload.path !== activePath) return;

      // Suppress external change events shortly after we saved
      const timeSinceSave = Date.now() - lastSaveTimestampRef.current;
      if (timeSinceSave < SAVE_SUPPRESS_WINDOW_MS) {
        // This is likely our own save, ignore it
        return;
      }

      setEvent(payload.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Ignore if events are not supported.
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [activePath]);

  return {
    event,
    clearEvent: () => setEvent(null),
    markSaveInProgress,
  };
}
