import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface FileChangedEvent {
  path: string;
  changeType: "modified" | "deleted" | "renamed";
  newPath?: string;
  timestamp: number;
}

export function useFileWatcher(activePath: string | null) {
  const [event, setEvent] = useState<FileChangedEvent | null>(null);

  useEffect(() => {
    if (!activePath) return;
    let unlisten: (() => void) | null = null;

    listen<FileChangedEvent>("file:changed", (payload) => {
      if (payload.payload.path !== activePath) return;
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
  };
}
