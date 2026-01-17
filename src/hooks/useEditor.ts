import { useEditorStore } from "../stores/editorStore";

export function useEditor() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const showSidebar = useEditorStore((state) => state.showSidebar);
  const toggleSidebar = useEditorStore((state) => state.toggleSidebar);
  const setShowSidebar = useEditorStore((state) => state.setShowSidebar);
  const isFocused = useEditorStore((state) => state.isFocused);
  const setFocus = useEditorStore((state) => state.setFocus);

  return {
    viewMode,
    setViewMode,
    showSidebar,
    toggleSidebar,
    setShowSidebar,
    isFocused,
    setFocus,
  };
}
