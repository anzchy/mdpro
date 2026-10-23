import { useEffect, useMemo, useState } from "react";
import { FIELD_LABELS } from "../components/common/settings/shortcuts/shortcutGroups";
import { loggingService } from "../services/loggingService";
import type { AppliedShortcuts } from "../types/keyboardShortcuts";
import type { KeyboardShortcuts } from "../types/preferences";
import { rowByPrefField } from "../commands/commandTable";
import { isMacPlatform } from "../utils/platformLabels";

/** One launch notice for conflicts in the applied shortcut snapshot. */
export function useShortcutConflictNotice(applied: AppliedShortcuts | null, saved: KeyboardShortcuts | null) {
  const [dismissed, setDismissed] = useState(false);
  const message = useMemo(() => {
    if (!applied || !saved || dismissed) return null;
    const fields = (Object.keys(applied.bindings) as Array<keyof KeyboardShortcuts>)
      .filter((field) => {
        const binding = applied.bindings[field];
        return binding.state === "suppressed" && binding.reason !== "unavailable";
      });
    if (fields.length === 0) return null;
    const platform = isMacPlatform() ? "macos" : "linux";
    const names = fields.map((field) => {
      const binding = applied.bindings[field];
      const chord = binding.state === "suppressed" && binding.reason === "yieldedToCustom"
        ? rowByPrefField(field)?.key[platform].defaults.v2 ?? saved[field]
        : saved[field];
      return `${FIELD_LABELS[field]} (${chord})`;
    }).join(", ");
    return `${names} ${fields.length === 1 ? "is" : "are"} suppressed for this run. Open Keyboard Shortcuts to repair the saved keys; changes apply after restart.`;
  }, [applied, saved, dismissed]);
  useEffect(() => {
    if (message) loggingService.logUiEvent("ui.shortcut-conflict.shown", { status: "success" });
  }, [message]);
  return { message, dismiss: () => setDismissed(true) };
}
