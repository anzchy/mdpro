import { useEditorStore } from "../stores/editorStore";

/**
 * One selector per editor-store field App reads. `setViewMode` is the store's
 * own action, so its default intent is programmatic; explicit user commands go
 * through the store's user-command adapter instead. The raw `cycleViewMode` is
 * deliberately not exposed: every cycle App issues is a user command. `userViewModeChoice` is a reactive
 * subscription (a new object per user command, even when the mode does not
 * change), which `useLastViewModePersistence` needs to see every choice
 * (ADR-0053, D24 WI-3).
 */
export function useEditor() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const userViewModeChoice = useEditorStore((state) => state.userViewModeChoice);
  const showSidebar = useEditorStore((state) => state.showSidebar);
  const isFocused = useEditorStore((state) => state.isFocused);
  const setFocus = useEditorStore((state) => state.setFocus);

  return {
    viewMode,
    setViewMode,
    userViewModeChoice,
    showSidebar,
    isFocused,
    setFocus,
  };
}
