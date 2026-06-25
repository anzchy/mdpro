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

const FRONTEND_DEBOUNCE_MS = 300;

export function useFileWatcher(activePath: string | null) {
  const [event, setEvent] = useState<FileChangedEvent | null>(null);
  const lastSaveTimestampRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Call this when saving to suppress the next file change event
  const markSaveInProgress = useCallback(() => {
    lastSaveTimestampRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!activePath) return;
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    listen<FileChangedEvent>("file:changed", (payload) => {
      if (cancelled) return;
      if (payload.payload.path !== activePath) return;

      // Suppress external change events shortly after we saved
      const timeSinceSave = Date.now() - lastSaveTimestampRef.current;
      if (timeSinceSave < SAVE_SUPPRESS_WINDOW_MS) {
        return;
      }

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setEvent(payload.payload);
      }, FRONTEND_DEBOUNCE_MS);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlistenFn = fn;
        }
      })
      .catch(() => {
        // Ignore if events are not supported.
      });

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      unlistenFn?.();
    };
  }, [activePath]);

  return {
    event,
    clearEvent: () => setEvent(null),
    markSaveInProgress,
  };
}
