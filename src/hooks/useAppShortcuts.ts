/** Keep the startup shortcut snapshot and its UI notice in one App hook. */
import { useMemo } from "react";
import { appliedStoredShortcuts } from "../commands/appliedKeymap";
import { useAppliedShortcuts } from "./useAppliedShortcuts";
import { useShortcutConflictNotice } from "./useShortcutConflictNotice";
import type { KeyboardShortcuts } from "../types/preferences";

export function useAppShortcuts(startupValues: KeyboardShortcuts | null) {
  const { snapshot, error } = useAppliedShortcuts();
  const { message, dismiss } = useShortcutConflictNotice(snapshot, startupValues);
  const keyboardShortcuts = useMemo(
    () => snapshot ? appliedStoredShortcuts(snapshot) : null,
    [snapshot],
  );
  return {
    appliedShortcuts: snapshot,
    appliedShortcutsError: error,
    keyboardShortcuts,
    shortcutConflictMessage: message,
    dismissShortcutConflict: dismiss,
  };
}
