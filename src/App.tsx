import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SplitView } from "./components/Editor/SplitView";
import { WysiwygView } from "./components/Editor/WysiwygView";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { Toolbar } from "./components/Toolbar/Toolbar";
import { ConfirmDialog } from "./components/common/ConfirmDialog";
import { RecoveryDialog } from "./components/common/RecoveryDialog";
import { ReloadDialog } from "./components/common/ReloadDialog";
import { EncodingDialog } from "./components/common/EncodingDialog";
import { LoadingSpinner } from "./components/common/LoadingSpinner";
import { Toast } from "./components/common/Toast";
import { useDocument } from "./hooks/useDocument";
import { useAutoSave } from "./hooks/useAutoSave";
import { useEditor } from "./hooks/useEditor";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useMenuEvents } from "./hooks/useMenuEvents";
import { useTheme } from "./hooks/useTheme";
import { exportService } from "./services/exportService";
import { preferencesService } from "./services/preferencesService";
import { fileService } from "./services/fileService";
import type { Document } from "./types/document";
import type { WindowState } from "./types/preferences";
import { useDocumentStore } from "./stores/documentStore";

type PendingClose = "document" | "window" | null;

interface DraftMetadata {
  id: string;
  originalPath: string | null;
  lastModified: string;
  recovered: boolean;
  title: string;
}

interface RecoverResult {
  content: string;
  originalPath: string | null;
  title: string;
}

function App() {
  const {
    activeDocument,
    activeDocumentTitle,
    openDocumentFromDialog,
    openDocumentFromPath,
    openDocumentWithEncoding,
    createDocument,
    updateActiveDocumentContent,
    saveActiveDocument,
    closeActiveDocument,
    documents,
    setActiveDocumentById,
    closeDocumentById,
    upsertAndActivateDocument,
    replaceDocument,
    largeFileWarning,
    clearLargeFileWarning,
    encodingIssue,
    clearEncodingIssue,
  } = useDocument();
  const updateDocumentPath = useDocumentStore((state) => state.updateDocumentPath);
  const { viewMode, setViewMode, showSidebar, toggleSidebar, setShowSidebar } = useEditor();
  const { resolvedTheme, setThemeMode } = useTheme();
  const [highlightRequest, setHighlightRequest] = useState(0);
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);
  const [autoSaveInterval, setAutoSaveInterval] = useState(30);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DraftMetadata[]>([]);
  const [reloadMessage, setReloadMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const closeTargetRef = useRef<PendingClose>(null);
  const appWindowRef = useRef<{ close: () => void } | null>(null);
  const hasUnsavedRef = useRef(false);
  const openDialogLockRef = useRef(false);
  const allowWindowCloseRef = useRef(false);
  const openDialogCooldownRef = useRef(0);
  const { event: fileChangeEvent, clearEvent } = useFileWatcher(
    activeDocument?.path ?? null,
  );

  const hasUnsavedChanges = Boolean(activeDocument?.isModified);
  hasUnsavedRef.current = hasUnsavedChanges;

  useAutoSave(autoSaveInterval);

  const updateRecentFiles = useCallback(
    (path: string) => {
      if (!path) return;
      setRecentFiles((prev) => {
        const next = [path, ...prev.filter((item) => item !== path)].slice(0, 10);
        void preferencesService.setPreferences({ recentFiles: next });
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    invoke("set_recent_files_menu", { recentFiles }).catch(() => {
      // Ignore if running outside Tauri or menu is unavailable.
    });
  }, [recentFiles]);

  const handleToggleSidebar = useCallback(() => {
    const next = !showSidebar;
    toggleSidebar();
    void preferencesService.setPreferences({ showSidebar: next });
  }, [showSidebar, toggleSidebar]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const applyWindowState = useCallback(async (state: WindowState) => {
    try {
      const { getCurrentWindow, LogicalPosition, LogicalSize } = await import(
        "@tauri-apps/api/window"
      );
      const currentWindow = getCurrentWindow();
      if (state.isMaximized) {
        await currentWindow.maximize();
      } else {
        await currentWindow.setSize(new LogicalSize(state.width, state.height));
        await currentWindow.setPosition(new LogicalPosition(state.x, state.y));
      }
    } catch {
      // Ignore if window API is not available.
    }
  }, []);

  const saveWindowState = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      const size = await currentWindow.innerSize();
      const position = await currentWindow.outerPosition();
      const isMaximized = await currentWindow.isMaximized();
      await preferencesService.saveWindowState({
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        isMaximized,
      });
    } catch {
      // Ignore persistence errors in web preview.
    }
  }, []);

  useEffect(() => {
    const baseTitle = activeDocumentTitle;
    const suffix = hasUnsavedChanges ? " *" : "";
    document.title =
      baseTitle === "mdpro" ? "mdpro" : `${baseTitle}${suffix} - mdpro`;
  }, [activeDocumentTitle, hasUnsavedChanges]);

  useEffect(() => {
    let mounted = true;
    const loadPreferences = async () => {
      try {
        const prefs = await preferencesService.getPreferences();
        if (!mounted) return;
        setViewMode(prefs.defaultViewMode);
        setShowSidebar(prefs.showSidebar);
        setAutoSaveInterval(prefs.autoSaveInterval);
        setRecentFiles(prefs.recentFiles ?? []);
        await applyWindowState(prefs.windowState);
        await setThemeMode(prefs.themeMode);
      } catch {
        // Ignore preference loading errors in web preview.
      }
    };
    void loadPreferences();
    return () => {
      mounted = false;
    };
  }, [applyWindowState, setShowSidebar, setThemeMode, setViewMode]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupWindowListener = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        appWindowRef.current = currentWindow;
        unlisten = await currentWindow.onCloseRequested((event) => {
          void saveWindowState();
          if (allowWindowCloseRef.current) {
            allowWindowCloseRef.current = false;
            return;
          }
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
  }, [saveWindowState]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(resolvedTheme === "dark" ? "theme-dark" : "theme-light");
  }, [resolvedTheme]);

  useEffect(() => {
    let mounted = true;
    const loadDrafts = async () => {
      try {
        await invoke("cleanup_old_drafts", {});
        const found = await invoke<DraftMetadata[]>("list_drafts", {});
        if (mounted) setDrafts(found);
      } catch {
        // Ignore draft loading errors.
      }
    };
    void loadDrafts();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!fileChangeEvent || !activeDocument) return;
    if (fileChangeEvent.changeType === "renamed" && fileChangeEvent.newPath) {
      updateDocumentPath(activeDocument.id, fileChangeEvent.newPath);
      clearEvent();
      return;
    }
    if (fileChangeEvent.changeType === "deleted") {
      setReloadMessage("File was deleted externally. Save to a new location if needed.");
      return;
    }
    setReloadMessage("File was modified externally. Reload to update content?");
  }, [activeDocument, clearEvent, fileChangeEvent, updateDocumentPath]);

  useEffect(() => {
    if (largeFileWarning) {
      showToast(largeFileWarning);
      clearLargeFileWarning();
    }
  }, [clearLargeFileWarning, largeFileWarning, showToast]);

  const handleOpenDialog = useCallback(async () => {
    if (openDialogLockRef.current) return;
    if (Date.now() < openDialogCooldownRef.current) return;
    openDialogLockRef.current = true;
    setBusyLabel("Opening file...");
    try {
      const doc = await openDocumentFromDialog();
      if (doc?.path) {
        updateRecentFiles(doc.path);
      } else {
        openDialogCooldownRef.current = Date.now() + 500;
      }
    } finally {
      setBusyLabel(null);
      openDialogLockRef.current = false;
    }
  }, [openDocumentFromDialog, updateRecentFiles]);

  const handleOpenPath = useCallback(
    async (path: string) => {
      setBusyLabel("Opening file...");
      try {
        const doc = await openDocumentFromPath(path);
        if (doc?.path) {
          updateRecentFiles(doc.path);
        }
      } finally {
        setBusyLabel(null);
      }
    },
    [openDocumentFromPath, updateRecentFiles],
  );

  const openPaths = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        try {
          const doc = await openDocumentFromPath(path);
          if (doc?.path) {
            updateRecentFiles(doc.path);
          }
        } catch {
          // Ignore launch open errors.
        }
      }
    },
    [openDocumentFromPath, updateRecentFiles],
  );

  const handleOpenRecent = useCallback(
    async (path: string) => {
      await handleOpenPath(path);
    },
    [handleOpenPath],
  );

  const handleSave = useCallback(async () => {
    setBusyLabel("Saving...");
    try {
      const result = await saveActiveDocument();
      if (result?.path) {
        updateRecentFiles(result.path);
      }
      if (result?.success) {
        showToast("Saved");
      }
    } finally {
      setBusyLabel(null);
    }
  }, [saveActiveDocument, showToast, updateRecentFiles]);

  const handleExportHtml = useCallback(async () => {
    if (!activeDocument) return;
    setBusyLabel("Exporting HTML...");
    try {
      const title = activeDocumentTitle || "mdpro";
      const result = await exportService.exportHtml(
        activeDocument.content,
        title,
        resolvedTheme,
      );
      if (result?.success) {
        showToast(`Exported HTML to ${result.path}`);
      }
    } catch {
      showToast("Export failed");
    } finally {
      setBusyLabel(null);
    }
  }, [activeDocument, activeDocumentTitle, resolvedTheme, showToast]);

  const handleReloadFile = useCallback(async () => {
    if (!fileChangeEvent?.path) return;
    setBusyLabel("Reloading...");
    try {
      const doc = await fileService.reloadFile(fileChangeEvent.path);
      replaceDocument(doc as Document);
      showToast("File reloaded");
    } catch {
      showToast("Reload failed");
    } finally {
      setBusyLabel(null);
      clearEvent();
      setReloadMessage(null);
    }
  }, [clearEvent, fileChangeEvent, replaceDocument, showToast]);

  const handleIgnoreReload = useCallback(() => {
    clearEvent();
    setReloadMessage(null);
  }, [clearEvent]);

  const handleRecoverDraft = useCallback(
    async (draftId: string) => {
      try {
        const result = await invoke<RecoverResult>("recover_draft", { documentId: draftId });
        const document: Document = {
          id: draftId,
          path: result.originalPath,
          content: result.content,
          encoding: "UTF-8",
          isModified: true,
          lastSaved: null,
          fileSize: null,
        };
        upsertAndActivateDocument(document);
        setDrafts((prev) => prev.filter((draft) => draft.id !== draftId));
      } catch {
        showToast("Failed to recover draft");
      }
    },
    [showToast, upsertAndActivateDocument],
  );

  const handleDiscardDraft = useCallback(async (draftId: string) => {
    try {
      await invoke("delete_draft", { documentId: draftId });
      setDrafts((prev) => prev.filter((draft) => draft.id !== draftId));
    } catch {
      showToast("Failed to discard draft");
    }
  }, [showToast]);

  const handleEncodingSelect = useCallback(
    async (encoding: string) => {
      if (!encodingIssue?.path) return;
      setBusyLabel("Opening file...");
      try {
        const doc = await openDocumentWithEncoding(encodingIssue.path, encoding);
        if (doc?.path) {
          updateRecentFiles(doc.path);
        }
        clearEncodingIssue();
      } catch {
        showToast("Failed to open with selected encoding");
      } finally {
        setBusyLabel(null);
      }
    },
    [
      clearEncodingIssue,
      encodingIssue,
      openDocumentWithEncoding,
      showToast,
      updateRecentFiles,
    ],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] as File & { path?: string };
    if (file?.path) {
      void handleOpenPath(file.path);
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
      await saveWindowState();
      allowWindowCloseRef.current = true;
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

  const handleCloseRequest = useCallback(() => {
    if (!activeDocument) return;
    if (activeDocument.isModified) {
      closeTargetRef.current = "document";
      setPendingClose("document");
    } else {
      void closeActiveDocument(true);
    }
  }, [activeDocument, closeActiveDocument]);

  useKeyboardShortcuts({
    onNew: () => void createDocument(),
    onHighlight: () => setHighlightRequest((prev) => prev + 1),
    onOpen: () => void handleOpenDialog(),
    onSave: () => void handleSave(),
    onClose: handleCloseRequest,
    onToggleSidebar: handleToggleSidebar,
  });

  useMenuEvents({
    onNew: () => void createDocument(),
    onOpen: () => void handleOpenDialog(),
    onSave: () => void handleSave(),
    onClose: handleCloseRequest,
    onExportHtml: () => void handleExportHtml(),
    onOpenRecent: handleOpenRecent,
    onToggleSidebar: handleToggleSidebar,
    onHighlight: () => setHighlightRequest((prev) => prev + 1),
    onViewModeChange: setViewMode,
    onThemeModeChange: (mode) => void setThemeMode(mode),
  });

  useEffect(() => {
    invoke<string[]>("get_launch_paths")
      .then((paths) => {
        if (!paths || paths.length === 0) return;
        void openPaths(paths);
      })
      .catch(() => {
        // Ignore if running outside Tauri.
      });
  }, [openPaths]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<string[]>("file:open", (event) => {
      if (!event.payload || event.payload.length === 0) return;
      void openPaths(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Ignore if running outside Tauri.
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, [openPaths]);

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
        />
        {busyLabel ? (
          <div className="busy-indicator">
            <LoadingSpinner label={busyLabel} />
          </div>
        ) : null}
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

      <RecoveryDialog
        drafts={drafts}
        onRecover={handleRecoverDraft}
        onDiscard={handleDiscardDraft}
      />
      <ReloadDialog
        open={Boolean(reloadMessage)}
        message={reloadMessage ?? ""}
        onReload={handleReloadFile}
        onIgnore={handleIgnoreReload}
      />
      <EncodingDialog
        open={Boolean(encodingIssue)}
        path={encodingIssue?.path ?? ""}
        detected={encodingIssue?.detected ?? "unknown"}
        onSelect={handleEncodingSelect}
        onCancel={clearEncodingIssue}
      />
      <ConfirmDialog
        open={pendingClose !== null}
        title="Unsaved changes"
        message="You have unsaved changes. Close without saving?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={handleConfirmClose}
        onCancel={handleCancelClose}
      />
      <Toast message={toastMessage ?? ""} visible={Boolean(toastMessage)} />
    </div>
  );
}

export default App;
