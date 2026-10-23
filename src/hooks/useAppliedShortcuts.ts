import { useEffect, useState } from "react";
import { preferencesService } from "../services/preferencesService";
import { installAppliedShortcuts } from "../commands/appliedKeymap";
import type { AppliedShortcuts } from "../types/keyboardShortcuts";
import { loggingService } from "../services/loggingService";

/** The immutable shortcut set installed at launch. Null fails closed until IPC succeeds. */
export function useAppliedShortcuts(): { snapshot: AppliedShortcuts | null; error: boolean } {
  const [snapshot, setSnapshot] = useState<AppliedShortcuts | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    const actionId = loggingService.generateActionId();
    loggingService.logEventSync({ level: "info", event: "ui.shortcuts.load", status: "start", actionId });
    installAppliedShortcuts(null);
    void preferencesService.getAppliedShortcuts().then((loaded) => {
      if (!mounted) return;
      installAppliedShortcuts(loaded);
      setSnapshot(loaded);
      loggingService.logEventSync({ level: "info", event: "ui.shortcuts.load", status: "success", actionId });
    }).catch(() => {
      if (!mounted) return;
      installAppliedShortcuts(null);
      setError(true);
      loggingService.logEventSync({ level: "error", event: "ui.shortcuts.load", status: "fail", actionId });
    });
    return () => { mounted = false; installAppliedShortcuts(null); };
  }, []);
  return { snapshot, error };
}
