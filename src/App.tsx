import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { SplitView } from "./components/Editor/SplitView";
import { WysiwygView } from "./components/Editor/WysiwygView";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { Toolbar } from "./components/Toolbar/Toolbar";
import { ConfirmDialog } from "./components/common/ConfirmDialog";
import { useDocument } from "./hooks/useDocument";
import { useEditor } from "./hooks/useEditor";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useTheme } from "./hooks/useTheme";
import { preferencesService } from "./services/preferencesService";

type PendingClose = "document" | "window" | null;

function App() {
  const {
    activeDocument,
    activeDocumentTitle,
    openDocumentFromDialog,
    openDocumentFromPath,
    createDocument,
    updateActiveDocumentContent,
    saveActiveDocument,
    closeActiveDocument,
    documents,
    setActiveDocumentById,
    closeDocumentById,
  } = useDocument();
  const { viewMode, setViewMode, showSidebar, toggleSidebar, setShowSidebar } = useEditor();
  const { mode: themeMode, resolvedTheme, setThemeMode, cycleThemeMode } = useTheme();
  const [highlightRequest, setHighlightRequest] = useState(0);
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);
  const closeTargetRef = useRef<PendingClose>(null);
  const appWindowRef = useRef<{ close: () => void } | null>(null);
  const hasUnsavedRef = useRef(false);

  const hasUnsavedChanges = Boolean(activeDocument?.isModified);
  hasUnsavedRef.current = hasUnsavedChanges;

  useEffect(() => {
    const baseTitle = activeDocumentTitle;
    const suffix = hasUnsavedChanges ? " •" : "";
    document.title =
      baseTitle === "mdpro" ? "mdpro" : `${baseTitle}${suffix} — mdpro`;
  }, [activeDocumentTitle, hasUnsavedChanges]);

  useEffect(() => {
    let mounted = true;
    const loadPreferences = async () => {
      try {
        const prefs = await preferencesService.getPreferences();
        if (!mounted) return;
        setViewMode(prefs.defaultViewMode);
        setShowSidebar(prefs.showSidebar);
        await setThemeMode(prefs.themeMode);
      } catch {
        // Ignore preference loading errors in web preview.
      }
    };
    void loadPreferences();
    return () => {
      mounted = false;
    };
  }, [setShowSidebar, setThemeMode, setViewMode]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupWindowListener = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        appWindowRef.current = currentWindow;
        unlisten = await currentWindow.onCloseRequested((event) => {
          if (hasUnsavedRef.current) {
            event.preventDefault();
            closeTargetRef.current = "window";
            setPendingClose("window");
          }
        });
      } catch {
        // Window API not available (web preview). Fall back to default behavior.
      }
    };

    setupWindowListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(resolvedTheme === "dark" ? "theme-dark" : "theme-light");
  }, [resolvedTheme]);

  useKeyboardShortcuts({
    onNew: () => void createDocument(),
    onHighlight: () => setHighlightRequest((prev) => prev + 1),
    onOpen: () => void openDocumentFromDialog(),
    onSave: () => void saveActiveDocument(),
    onClose: () => {
      if (!activeDocument) return;
      if (activeDocument.isModified) {
        closeTargetRef.current = "document";
        setPendingClose("document");
      } else {
        void closeActiveDocument(true);
      }
    },
  });

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] as File & { path?: string };
    if (file?.path) {
      void openDocumentFromPath(file.path);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleConfirmClose = async () => {
    const target = closeTargetRef.current;
    setPendingClose(null);
    closeTargetRef.current = null;

    if (target === "window") {
      appWindowRef.current?.close();
      return;
    }
    if (target === "document") {
      await closeActiveDocument(true);
    }
  };

  const handleCancelClose = () => {
    setPendingClose(null);
    closeTargetRef.current = null;
  };

  return (
    <div
      className={`app-shell${showSidebar ? "" : " no-sidebar"}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {showSidebar ? (
        <Sidebar
          documents={documents}
          activeDocumentId={activeDocument?.id ?? null}
          onSelect={setActiveDocumentById}
          onClose={closeDocumentById}
        />
      ) : null}
      <div className="main">
        <Toolbar
          title={activeDocumentTitle}
          isModified={hasUnsavedChanges}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onNew={() => void createDocument()}
          onOpen={() => void openDocumentFromDialog()}
          onSave={() => void saveActiveDocument()}
          onHighlight={() => setHighlightRequest((prev) => prev + 1)}
          showSidebar={showSidebar}
          onToggleSidebar={toggleSidebar}
          themeMode={themeMode}
          onThemeToggle={cycleThemeMode}
        />
        <section className="workspace">
          {viewMode === "wysiwyg" ? (
            <WysiwygView
              value={activeDocument?.content ?? ""}
              onChange={updateActiveDocumentContent}
              readOnly={!activeDocument}
              highlightRequest={highlightRequest}
            />
          ) : (
            <SplitView
              markdown={activeDocument?.content ?? ""}
              onChange={updateActiveDocumentContent}
              readOnly={!activeDocument}
              viewMode={viewMode}
              highlightRequest={highlightRequest}
            />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pendingClose !== null}
        title="Unsaved changes"
        message="You have unsaved changes. Close without saving?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={handleConfirmClose}
        onCancel={handleCancelClose}
      />
    </div>
  );
}

export default App;
