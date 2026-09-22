import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DevToolbar } from "./components/DevToolbar";
import { SplitView } from "./components/Editor/SplitView";
import { MilkdownEditor } from "./components/Editor/MilkdownEditor";
import { TOCSidebarContainer, getViewModeLabel } from "./components/Sidebar";
import { BottomTabs } from "./components/BottomTabs";
import { useTOC } from "./hooks/useTOC";
import { ConfirmDialog } from "./components/common/ConfirmDialog";
import { SettingsDialog } from "./components/common/SettingsDialog";
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
import { useMcpSync } from "./hooks/useMcpSync";
import { useMcpEvents } from "./hooks/useMcpEvents";
import { exportService } from "./services/exportService";
import { preferencesService } from "./services/preferencesService";
import { applyEditorPref, applyCodeTheme, applyAutoPair } from "./components/common/settings/editorPrefApply";
import { fileService } from "./services/fileService";
import { loggingService } from "./services/loggingService";
import { buildImageMarkdown } from "./services/imageService";
import { performSave } from "./services/saveService";
import type { Document } from "./types/document";
import {
  activeDocumentAfterFlush,
  decideCloseRequest,
  decideFileChange,
  decideWindowClose,
  hasUnsavedChangesAfterFlush,
} from "./utils/dataLossGuards";
import { buildLargeDocumentDegradeLog } from "./utils/largeDocumentDegradeLog";
import { decideLargeDocumentGuard } from "./utils/largeDocumentGuard";
import { buildSourceTablesWithheldLog } from "./utils/sourceTableWithheldLog";
import { shouldEvaluateGuard, sourceTableVerdictOf } from "./utils/sourceTableVerdict";
import type { ViewMode } from "./types/editor";
import type { KeyboardShortcuts, WindowState } from "./types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "./types/preferences";
import { useDocumentStore } from "./stores/documentStore";
import { isSourceTablesWithheld, useEditorStore } from "./stores/editorStore";
import { useMilkdownEditorStore } from "./stores/milkdownEditorStore";
import { useTableInsertStore } from "./stores/tableInsertStore";
import { useToastStore } from "./stores/toastStore";
import { runInsertTable } from "./plugins/milkdown/table/insertTable";
import { dispatchTableActionFromKeyboard } from "./plugins/milkdown/table/contextMenu";
import { dispatchSourceTableAction } from "./plugins/codemirror/sourceTableContextMenu";
import type { TableShortcutAction } from "./hooks/useKeyboardShortcuts";
import { migrateViewMode } from "./utils/viewModeUtils";

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
  const { viewMode, setViewMode, cycleViewMode, showSidebar, toggleSidebar, setShowSidebar } = useEditor();
  const { resolvedTheme, setThemeMode } = useTheme();
  const [highlightRequest, setHighlightRequest] = useState<number | undefined>(undefined);
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);
  // Decision 1A: autoSaveInterval lives in editorStore so GeneralSettings can update it reactively.
  const autoSaveInterval = useEditorStore((s) => s.autoSaveInterval);
  const setAutoSaveInterval = useEditorStore((s) => s.setAutoSaveInterval);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DraftMetadata[]>([]);
  const [reloadMessage, setReloadMessage] = useState<string | null>(null);
  const toastMessage = useToastStore((s) => s.message);
  const showToast = useToastStore((s) => s.showToast);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultViewMode, setDefaultViewMode] = useState<ViewMode>("wysiwyg");
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcuts>(DEFAULT_KEYBOARD_SHORTCUTS);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [launchPathsComplete, setLaunchPathsComplete] = useState(false);
  const closeTargetRef = useRef<PendingClose>(null);
  const appWindowRef = useRef<{ close: () => void } | null>(null);
  const openDialogLockRef = useRef(false);
  const allowWindowCloseRef = useRef(false);
  const openDialogCooldownRef = useRef(0);
  const launchPathsRetryRef = useRef(0);
  const { event: fileChangeEvent, clearEvent, markSaveInProgress } = useFileWatcher(
    activeDocument?.path ?? null,
  );

  useAutoSave(autoSaveInterval);

  // MCP hooks for Claude Code / Codex CLI integration
  useMcpSync();
  useMcpEvents();

  // TOC hook for sidebar Table of Contents
  const {
    hierarchy: tocHierarchy,
    activeEntryId: activeTocEntryId,
    collapsedIds: collapsedTocIds,
    navigateToEntry: navigateToTocEntry,
    toggleCollapsed: toggleTocCollapsed,
  } = useTOC({
    content: activeDocument?.content ?? "",
    documentId: activeDocument?.id ?? null,
    containerId: viewMode === "wysiwyg" ? "milkdown-container" : "source-container",
    // `viewMode` alone decides the spy mechanism now — `useTOC` routes on it via
    // `resolveSpyMode`. This call site used to also pass a spy master switch computed
    // as `viewMode !== "source"`, which turned the outline highlight off in Source mode
    // because the only mechanism then was a DOM observer with nothing to observe.
    viewMode,
  });

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
    invoke("set_recent_files_menu", { recentFiles, viewMode }).catch(() => {
      // Ignore if running outside Tauri or menu is unavailable.
    });
  }, [recentFiles, viewMode]);

  const handleToggleSidebar = useCallback((_actionId?: string) => {
    // Read current value from store state to avoid stale closure on rapid calls
    const next = !useEditorStore.getState().showSidebar;
    toggleSidebar();
    void preferencesService.setPreferences({ showSidebar: next });
  }, [toggleSidebar]);



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

      // Save per-file geometry if document has a path (T038)
      if (activeDocument?.path) {
        const { windowService } = await import("./services/windowService");
        await windowService.saveWindowGeometry(activeDocument.path, {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
        });
      }
    } catch {
      // Ignore persistence errors in web preview.
    }
  }, [activeDocument]);

  // Keep window title static — filename removed per #374
  useEffect(() => {
    const setStaticTitle = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTitle("mdpro");
        document.title = "mdpro";
      } catch {
        document.title = "mdpro";
      }
    };
    void setStaticTitle();
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadPreferences = async () => {
      try {
        // Hydrate logging from its real source (loggingService) rather than
        // from the preference object, which in the shipping desktop app is a
        // browser-mode constant that never reached Rust and so silently left
        // logging on a default. Placed first in the try so no earlier await
        // can throw past it; safe here because hydrateSettings never rejects
        // and does not depend on the loaded preferences.
        await loggingService.hydrateSettings();
        const prefs = await preferencesService.getPreferences();
        if (!mounted) return;
        // Don't set viewMode here - defer until launch paths are complete
        // to avoid race condition with Finder/CLI file opens
        setDefaultViewMode(migrateViewMode(prefs.defaultViewMode));
        setShowSidebar(prefs.showSidebar);
        setAutoSaveInterval(prefs.autoSaveInterval);
        setRecentFiles(prefs.recentFiles ?? []);
        if (prefs.keyboardShortcuts) {
          setKeyboardShortcuts({ ...DEFAULT_KEYBOARD_SHORTCUTS, ...prefs.keyboardShortcuts });
        }
        await applyWindowState(prefs.windowState);
        await setThemeMode(prefs.themeMode);
        // Decision 2A: apply saved editor prefs to CSS vars + CM Compartments on startup.
        // Editor may not be mounted yet — applyEditorPref guards against null editorView.
        if (prefs.editor) {
          const editorPrefs = prefs.editor;
          (Object.keys(editorPrefs) as Array<keyof typeof editorPrefs>).forEach((key) => {
            applyEditorPref(key, editorPrefs[key]);
          });
        }
        if (prefs.appearance) {
          applyCodeTheme(prefs.appearance.codeTheme);
        }
        if (prefs.markdown) {
          applyAutoPair(prefs.markdown.autoPair);
        }
      } catch {
        // Ignore preference loading errors in web preview.
      } finally {
        if (mounted) setPreferencesLoaded(true);
      }
    };
    void loadPreferences();
    return () => {
      mounted = false;
    };
  }, [
    applyWindowState,
    setAutoSaveInterval,
    setDefaultViewMode,
    setRecentFiles,
    setShowSidebar,
    setThemeMode,
  ]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    void preferencesService.setPreferences({ lastViewMode: viewMode });
  }, [preferencesLoaded, viewMode]);

  // Apply preferred viewMode after launch paths have been processed
  // This prevents race condition where viewMode changes to wysiwyg before documents load
  useEffect(() => {
    if (!launchPathsComplete || !preferencesLoaded) return;
    if (activeDocument) return;
    // No document loaded, apply user's preferred viewMode (with migration for old stored values)
    const applyPreferredViewMode = async () => {
      try {
        const prefs = await preferencesService.getPreferences();
        setViewMode(migrateViewMode(prefs.lastViewMode ?? prefs.defaultViewMode));
      } catch {
        // Ignore errors
      }
    };
    void applyPreferredViewMode();
  }, [launchPathsComplete, preferencesLoaded, activeDocument, setViewMode]);

  // Handle ?open= URL parameter (for new windows opened via Finder/drag-drop)
  useEffect(() => {
    const checkUrlParam = async () => {
      const params = new URLSearchParams(window.location.search);
      const openPath = params.get("open");

      // Get window label for logging
      let windowLabel = "unknown";
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        windowLabel = getCurrentWindow().label;
      } catch {
        // Ignore
      }

      // Log URL parameter check for debugging (info level to ensure visibility)
      // Note: only log whether a param is present, not the full URL or path (privacy)
      loggingService.logEventSync({
        level: "info",
        event: "app.url_param_check",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          windowLabel,
          hasOpenParam: !!openPath,
        },
      });

      if (openPath) {
        const actionId = loggingService.generateActionId();
        const fileBasename = openPath.split("/").pop() ?? openPath;
        loggingService.logEventSync({
          level: "info",
          event: "file.open.url_param",
          status: "start",
          actionId,
          context: { windowLabel, fileBasename },
        });

        // Use default view mode from preferences for externally opened files
        setViewMode(defaultViewMode);
        const doc = await openDocumentFromPath(openPath, actionId);
        loggingService.logEventSync({
          level: doc ? "info" : "error",
          event: "file.open.url_param",
          status: doc ? "success" : "fail",
          actionId,
          context: {
            windowLabel,
            fileBasename,
            documentId: doc?.id || null,
            hasContent: doc ? doc.content.length > 0 : false,
          },
          error: doc ? undefined : "openDocumentFromPath returned null",
        });
        if (doc?.path) {
          updateRecentFiles(doc.path);
        }
        // Clean up the URL to prevent re-opening on refresh
        window.history.replaceState({}, "", window.location.pathname);
      }
    };
    void checkUrlParam();
  }, [defaultViewMode, openDocumentFromPath, setViewMode, updateRecentFiles]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupWindowListener = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        appWindowRef.current = currentWindow;
        unlisten = await currentWindow.onCloseRequested(async (event) => {
          const windowLabel = currentWindow.label;
          // D15: flush pending WYSIWYG edits, then decide on fresh any-tab-modified state.
          const decision = decideWindowClose({
            allowWindowClose: allowWindowCloseRef.current,
            hasUnsavedChanges: hasUnsavedChangesAfterFlush(),
          });
          loggingService.logEventSync({
            level: "info",
            event: "window.close_requested",
            status: "start",
            actionId: loggingService.generateActionId(),
            context: { windowLabel, decision, allowWindowClose: allowWindowCloseRef.current },
          });

          if (decision === "allow") {
            // State already saved by handleConfirmClose; allow the close through
            allowWindowCloseRef.current = false;
            loggingService.logEventSync({
              level: "info",
              event: "window.close_requested",
              status: "success",
              actionId: loggingService.generateActionId(),
              context: { windowLabel, action: "allowed_close" },
            });
            return;
          }
          // Prevent close in all other cases until we finish async work
          event.preventDefault();
          if (decision === "prompt") {
            closeTargetRef.current = "window";
            setPendingClose("window");
            loggingService.logEventSync({
              level: "info",
              event: "window.close_requested",
              status: "cancel",
              actionId: loggingService.generateActionId(),
              context: { windowLabel, action: "prevented_showing_dialog" },
            });
          } else {
            // No unsaved changes — save state then allow close
            await saveWindowState();
            allowWindowCloseRef.current = true;
            void currentWindow.close();
            loggingService.logEventSync({
              level: "info",
              event: "window.close_requested",
              status: "success",
              actionId: loggingService.generateActionId(),
              context: { windowLabel, action: "no_unsaved_closing" },
            });
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
      // Run cleanup independently so a failure does not prevent draft listing.
      try {
        await invoke("cleanup_old_drafts", {});
      } catch {
        // Best-effort — stale drafts may linger until next launch.
      }
      try {
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
    if (!activeDocument) return;
    const decision = decideFileChange(fileChangeEvent, activeDocument);
    switch (decision.action) {
      case "ignore":
        return;
      case "rename":
        updateDocumentPath(activeDocument.id, decision.newPath);
        clearEvent();
        return;
      case "deleted-prompt":
        // Surface a prompt; do NOT reload (would clobber in-editor edits).
        setReloadMessage(decision.message);
        return;
      case "reload-prompt":
        // Surface a prompt; reload is user-initiated via handleReloadFile.
        setReloadMessage(decision.message);
        return;
    }
  }, [activeDocument, clearEvent, fileChangeEvent, updateDocumentPath]);

  useEffect(() => {
    if (largeFileWarning) {
      showToast(largeFileWarning);
      clearLargeFileWarning();
    }
  }, [clearLargeFileWarning, largeFileWarning, showToast]);

  useEffect(() => {
    if (!activeDocument) return;
    // ADR-0022 / plan A1: in Source the guard runs once per document per
    // session, not per keystroke. The verdict is recorded before the switch so
    // the allow arm stays empty (C9); the store is read via getState() so the
    // dependency array is unchanged (C3).
    if (!shouldEvaluateGuard(viewMode, activeDocument.id, useEditorStore.getState())) return;
    const decision = decideLargeDocumentGuard({
      viewMode,
      content: activeDocument.content,
    });
    const verdict = sourceTableVerdictOf(viewMode, decision);
    const firstVerdict =
      verdict !== null && useEditorStore.getState().recordSourceTableVerdict(activeDocument.id, verdict);
    switch (decision.action) {
      case "allow":
        return;
      case "degrade-to-source":
        // The degrade used to leave no trace at all, which made "why did it
        // open in Source mode?" unanswerable from ~/.mdpro/mdpro.log. Logged
        // before the toast so the record survives a toast the user never saw.
        // The payload's contents are asserted in
        // tests/large-document-degrade-log.test.ts; only the wiring is here.
        loggingService.logEventSync(
          buildLargeDocumentDegradeLog(decision, loggingService.generateActionId(), activeDocument.id),
        );
        showToast(decision.message);
        setViewMode("source");
        return;
      case "withhold-table-extensions":
        if (!firstVerdict) return;
        // Source only: the table tools are withheld by Editor and the context
        // menu reading the recorded verdict; the mode never changes here. One
        // log line and one toast per document, logged first as above.
        loggingService.logEventSync(
          buildSourceTablesWithheldLog(decision, loggingService.generateActionId(), activeDocument.id),
        );
        showToast(decision.message);
        return;
    }
    // Every arm returns, so `decision` is `never` here. A new action added to
    // LargeDocumentGuardDecision fails to compile at this line rather than
    // being silently dropped. A bare `switch` does NOT enforce exhaustiveness
    // on its own — measured against this repo's tsc, not assumed. Rule 60
    // § "Enum and Union Completeness". Pinned by C11.
    decision satisfies never;
  }, [activeDocument, setViewMode, showToast, viewMode]);

  const handleOpenDialog = useCallback(async (actionId?: string) => {
    if (openDialogLockRef.current) return;
    if (Date.now() < openDialogCooldownRef.current) return;
    openDialogLockRef.current = true;
    setBusyLabel("Opening file...");
    try {
      const doc = await openDocumentFromDialog(actionId);
      if (doc?.path) {
        updateRecentFiles(doc.path);
      } else if (!doc) {
        // File dialog was cancelled or an error occurred
        openDialogCooldownRef.current = Date.now() + 500;
      }
    } catch {
      showToast("Failed to open file");
    } finally {
      setBusyLabel(null);
      openDialogLockRef.current = false;
    }
  }, [openDocumentFromDialog, showToast, updateRecentFiles]);

  const handleOpenPath = useCallback(
    async (path: string, actionId?: string) => {
      setBusyLabel("Opening file...");
      try {
        const doc = await openDocumentFromPath(path, actionId);
        if (doc?.path) {
          updateRecentFiles(doc.path);
        }
        return doc;
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
    async (path: string, actionId?: string) => {
      await handleOpenPath(path, actionId);
    },
    [handleOpenPath],
  );

  const handleSave = useCallback(async (actionId?: string) => {
    await performSave(actionId, { markSaveInProgress, saveActiveDocument, updateRecentFiles, showToast });
  }, [markSaveInProgress, saveActiveDocument, showToast, updateRecentFiles]);

  const handleExportHtml = useCallback(async (_actionId?: string) => {
    if (!activeDocument) return;
    setBusyLabel("Exporting HTML...");
    try {
      const title = activeDocumentTitle || "mdpro";
      // Use the math-aware export path: KaTeX is pre-rendered so the exported
      // file displays math with zero JS (WI-1.1). Re-sanitized server-side.
      const result = await exportService.exportRenderedHtml(
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

  const handleOpenSettings = useCallback((_actionId?: string) => {
    setSettingsOpen(true);
  }, []);

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
          lineEnding: "lf",
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

  const shouldHandleWindowEvent = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      const isFocused = await currentWindow.isFocused();
      return isFocused;
    } catch {
      return true;
    }
  }, []);

  const openNewWindow = useCallback(
    async (openPath?: string, notifyOnError = true) => {
      try {
        const { windowService } = await import("./services/windowService");
        await windowService.createWindow(openPath);
        return true;
      } catch {
        if (notifyOnError) {
          showToast("Failed to open new window");
        }
        return false;
      }
    },
    [showToast],
  );

  const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

  /**
   * Insert one or more dragged image files as Markdown image references at the
   * current cursor position (source / split mode) or appended to the document
   * content (WYSIWYG mode). Requires an active document with a saved path so
   * that a relative path can be computed.
   */
  const handleImageDrop = useCallback(
    (imagePaths: string[]) => {
      const docPath = useDocumentStore.getState().getActiveDocument()?.path ?? null;

      if (!docPath) {
        showToast("Open a document first to insert images");
        loggingService.logEventSync({
          level: "warn",
          event: "image.drop",
          status: "cancel",
          actionId: loggingService.generateActionId(),
          context: { reason: "no_active_document", fileCount: imagePaths.length },
        });
        return;
      }

      const markdownLines = imagePaths
        .map((p) => buildImageMarkdown(p, docPath))
        .filter((line): line is string => line !== null);

      if (markdownLines.length === 0) return;

      const insertText = markdownLines.join("\n");

      const currentViewMode = useEditorStore.getState().viewMode;

      if (currentViewMode === "wysiwyg") {
        // WYSIWYG (Milkdown): append to document content and let the editor re-render
        const currentDoc = useDocumentStore.getState().getActiveDocument();
        if (!currentDoc) return;
        const separator = currentDoc.content.endsWith("\n") || currentDoc.content === "" ? "" : "\n";
        const nextContent = currentDoc.content + separator + insertText + "\n";
        const { updateDocumentContent } = useDocumentStore.getState();
        updateDocumentContent(currentDoc.id, nextContent);
      } else {
        // Source / split mode: insert via CodeMirror transaction at cursor
        const editorView = useEditorStore.getState().editorView;
        if (editorView) {
          const { state, dispatch } = editorView;
          const from = state.selection.main.from;
          // Ensure we start on a new line
          const before = state.doc.sliceString(Math.max(0, from - 1), from);
          const prefix = from > 0 && before !== "\n" ? "\n" : "";
          dispatch(
            state.update({
              changes: { from, insert: prefix + insertText + "\n" },
              selection: { anchor: from + prefix.length + insertText.length + 1 },
            }),
          );
        } else {
          // Fallback: append to document content (editor view not yet mounted)
          const currentDoc = useDocumentStore.getState().getActiveDocument();
          if (!currentDoc) return;
          const separator = currentDoc.content.endsWith("\n") || currentDoc.content === "" ? "" : "\n";
          const nextContent = currentDoc.content + separator + insertText + "\n";
          const { updateDocumentContent } = useDocumentStore.getState();
          updateDocumentContent(currentDoc.id, nextContent);
        }
      }

      loggingService.logEventSync({
        level: "info",
        event: "image.drop",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          fileCount: imagePaths.length,
          insertedCount: markdownLines.length,
          viewMode: currentViewMode,
          docPath,
        },
      });

      showToast(
        markdownLines.length === 1
          ? "Image inserted"
          : `${markdownLines.length} images inserted`,
      );
    },
    [showToast],
  );

  // Handle files dropped via Tauri's drag-drop
  const handleFileDrop = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;

      // Partition dropped files into markdown files and image files
      const mdPaths: string[] = [];
      const imgPaths: string[] = [];
      for (const p of paths) {
        const ext = p.split(".").pop()?.toLowerCase() ?? "";
        if (ext === "md" || ext === "markdown") {
          mdPaths.push(p);
        } else if (IMAGE_EXTENSIONS.has(ext)) {
          imgPaths.push(p);
        }
      }

      // Route image drops to the image-insert handler
      if (imgPaths.length > 0) {
        handleImageDrop(imgPaths);
      }

      if (mdPaths.length === 0) {
        if (imgPaths.length === 0) {
          loggingService.logEventSync({
            level: "warn",
            event: "file.open.drop",
            status: "cancel",
            actionId: loggingService.generateActionId(),
            context: {
              reason: "unsupported_extension",
              fileCount: paths.length,
              dropTarget: "window",
            },
          });
        }
        return;
      }

      // Always open dropped files in the current window (no extra untitled window).
      setViewMode(defaultViewMode);
      for (const filePath of mdPaths) {
        const actionId = loggingService.generateActionId();
        loggingService.logEventSync({
          level: "info",
          event: "file.open.drop",
          status: "start",
          actionId,
          context: {
            filePath,
            fileCount: mdPaths.length,
            dropTarget: "window",
          },
        });
        const doc = await handleOpenPath(filePath, actionId);
        loggingService.logEventSync({
          level: doc ? "info" : "error",
          event: "file.open.drop",
          status: doc ? "success" : "fail",
          actionId,
          context: { filePath, openedInNewWindow: false },
          error: doc ? undefined : "open failed",
        });
      }
    },
    [defaultViewMode, handleImageDrop, handleOpenPath, setViewMode],
  );

  // Set up Tauri drag-drop event listener
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupDragDrop = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        unlisten = await currentWindow.onDragDropEvent((event) => {
          if (event.payload.type === "drop") {
            const paths = event.payload.paths;
            void handleFileDrop(paths);
          }
        });
      } catch {
        // Drag-drop not available in web preview
      }
    };

    setupDragDrop();
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleFileDrop]);

  // Handler for DevToolbar (browser-only file open)
  const handleDevOpenFile = useCallback(
    (content: string, fileName: string) => {
      loggingService.logEventSync({ level: "debug", event: "dev.file.open", status: "start", context: { fileName, contentLength: content.length } });
      const document: Document = {
        id: `dev-${Date.now()}`,
        path: fileName,
        content,
        encoding: "UTF-8",
        lineEnding: "lf",
        isModified: false,
        lastSaved: null,
        fileSize: content.length,
      };
      upsertAndActivateDocument(document);
    },
    [upsertAndActivateDocument],
  );

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

  const handleCloseRequest = useCallback((_actionId?: string) => {
    const decision = decideCloseRequest(activeDocumentAfterFlush()); // D15: flushed, fresh
    if (decision === "prompt") {
      closeTargetRef.current = "document";
      setPendingClose("document");
    } else if (decision === "close") {
      void closeActiveDocument(true);
    }
    // "noop" — no active document
  }, [closeActiveDocument]);

  // Both ⌘⌥T (useKeyboardShortcuts) and Format → Insert Table (useMenuEvents)
  // dispatch through the same flow: open TableInsertModal via
  // tableInsertStore.requestInsert, with the modal's submit callback
  // resolving the live Milkdown editor and running insertTableCommand.
  // Extract once so the menu and the shortcut behave identically.
  const triggerTableInsert = useCallback(() => {
    // Audit fix M11: gate on WYSIWYG viewMode. Source mode renders
    // CodeMirror, not Milkdown, so the modal would only fail on submit
    // (no Milkdown editor to dispatch into). Phase 2 WI-2.3 will add
    // the source-mode insertion path; until then, no-op outside WYSIWYG.
    const currentViewMode = useEditorStore.getState().viewMode;
    if (currentViewMode === "source") {
      // Toast + log so the user gets feedback that the shortcut/menu is
      // intentionally inert in source mode.
      useToastStore.getState().showToast("Insert Table is available in WYSIWYG mode");
      return;
    }
    if (useTableInsertStore.getState().pendingCallback) {
      // Defensive: clear any stale pending callback from a previous open.
      useTableInsertStore.getState().clearPending();
    }
    useTableInsertStore.getState().requestInsert((rows, cols) => {
      const editor = useMilkdownEditorStore.getState().getEditor();
      if (!editor) return false;
      return runInsertTable(editor as Parameters<typeof runInsertTable>[0], rows, cols);
    });
  }, []);

  // Phase 1.5 follow-up — keyboard shortcuts for in-table actions.
  // Routes the shortcut to the right dispatcher based on the active
  // viewMode; falls through to a no-op when the cursor isn't inside
  // a table so the shortcut is harmless outside.
  const handleTableShortcut = useCallback(
    (id: TableShortcutAction) => {
      const viewMode = useEditorStore.getState().viewMode;
      if (viewMode === "wysiwyg") {
        const editor = useMilkdownEditorStore.getState().getEditor();
        if (!editor) return;
        dispatchTableActionFromKeyboard(
          editor as Parameters<typeof dispatchTableActionFromKeyboard>[0],
          id,
        );
      } else {
        // ADR-0022: the table tools are off for a withheld Source document.
        if (isSourceTablesWithheld(useEditorStore.getState(), useDocumentStore.getState().activeDocumentId)) return;
        const cmView = useEditorStore.getState().editorView;
        if (!cmView) return;
        dispatchSourceTableAction(cmView, id, cmView.state.selection.main.head);
      }
    },
    [],
  );

  useKeyboardShortcuts({
    onNew: () => void createDocument(),
    onHighlight: () => setHighlightRequest((prev) => (prev ?? 0) + 1),
    onExportHtml: (actionId) => void handleExportHtml(actionId),
    onOpen: (actionId) => void handleOpenDialog(actionId),
    onSave: (actionId) => void handleSave(actionId),
    onClose: handleCloseRequest,
    onToggleSidebar: handleToggleSidebar,
    onCycleViewMode: cycleViewMode,
    onOpenPreferences: handleOpenSettings,
    onInsertTable: triggerTableInsert,
    onTableAction: handleTableShortcut,
    shortcuts: keyboardShortcuts,
  });

  useMenuEvents({
    onNew: () => void createDocument(),
    onNewWindow: () => void openNewWindow(),
    onOpen: (actionId) => void handleOpenDialog(actionId),
    onSave: (actionId) => void handleSave(actionId),
    onClose: handleCloseRequest,
    onExportHtml: (actionId) => void handleExportHtml(actionId),
    onOpenRecent: handleOpenRecent,
    onToggleSidebar: handleToggleSidebar,
    onHighlight: () => setHighlightRequest((prev) => (prev ?? 0) + 1),
    onInsertTable: triggerTableInsert,
    onViewModeChange: setViewMode,
    onCycleViewMode: cycleViewMode,
    onThemeModeChange: (mode) => void setThemeMode(mode),
    onOpenPreferences: handleOpenSettings,
  });

  useEffect(() => {
    // Wait for preferences to load before processing launch paths
    // This ensures defaultViewMode has the correct value from user preferences
    if (!preferencesLoaded) return;

    const checkLaunchPaths = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const windowLabel = getCurrentWindow().label;

        const paths = await invoke<string[]>("get_launch_paths");

        loggingService.logEventSync({
          level: "debug",
          event: "app.launch_paths_check",
          status: "success",
          actionId: loggingService.generateActionId(),
          context: {
            windowLabel,
            pathCount: paths?.length || 0,
            paths: paths || [],
            defaultViewMode,
          },
        });

        if (!paths || paths.length === 0) {
          if (launchPathsRetryRef.current < 1) {
            launchPathsRetryRef.current += 1;
            window.setTimeout(() => {
              void checkLaunchPaths();
            }, 300);
          } else {
            // No launch paths after retry, mark complete
            setLaunchPathsComplete(true);
          }
          return;
        }
        // When opening from Finder/command line, use default view mode from preferences
        setViewMode(defaultViewMode);
        await openPaths(paths);
        setLaunchPathsComplete(true);
      } catch {
        // Ignore if running outside Tauri, mark complete
        setLaunchPathsComplete(true);
      }
    };
    void checkLaunchPaths();
  }, [defaultViewMode, openPaths, preferencesLoaded, setViewMode]);

  const handleFileOpenEvent = useCallback(
    async (paths: string[]) => {
      if (!paths || paths.length === 0) return;
      const canHandle = await shouldHandleWindowEvent();
      if (!canHandle) return;
      // When opening from Finder while app is running, use default view mode from preferences
      setViewMode(defaultViewMode);
      void openPaths(paths);
    },
    [defaultViewMode, openPaths, setViewMode, shouldHandleWindowEvent],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<string[]>("file:open", (event) => {
      void handleFileOpenEvent(event.payload);
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
  }, [handleFileOpenEvent]);

  return (
    <div className={`app-shell${showSidebar ? "" : " no-sidebar"}`}>
      <DevToolbar
        onOpenFile={handleDevOpenFile}
        onNewDocument={createDocument}
        onOpenDialog={handleOpenDialog}
      />
            {showSidebar ? (
        <TOCSidebarContainer
          tocEntries={tocHierarchy}
          activeTocEntryId={activeTocEntryId}
          collapsedTocIds={collapsedTocIds}
          onTocEntryClick={navigateToTocEntry}
          onTocToggleCollapse={toggleTocCollapsed}
          viewMode={viewMode}
        />
      ) : null}
      <div className="main">
        {/* When sidebar is hidden, the main area needs its own traffic-lights zone
            (drag affordance + mode badge). When sidebar is visible, the sidebar's
            .sidebar-traffic-area provides the drag region and badge. */}
        {!showSidebar ? (
          <div className="main-traffic-area" data-tauri-drag-region>
            <span className="sidebar-mode-label" data-tauri-drag-region="false">{getViewModeLabel(viewMode)}</span>
          </div>
        ) : null}
        {busyLabel ? (
          <div className="busy-indicator">
            <LoadingSpinner label={busyLabel} />
          </div>
        ) : null}
        <section className="workspace">
          {viewMode === "wysiwyg" ? (
            <MilkdownEditor highlightRequest={highlightRequest} />
          ) : (
            <SplitView
              markdown={activeDocument?.content ?? ""}
              onChange={updateActiveDocumentContent}
              readOnly={!activeDocument}
              highlightRequest={highlightRequest}
            />
          )}
        </section>
      </div>

      <BottomTabs
        documents={documents}
        activeDocumentId={activeDocument?.id ?? null}
        onSelect={setActiveDocumentById}
        onClose={closeDocumentById}
        onNewDocument={createDocument}
      />

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
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <Toast message={toastMessage ?? ""} visible={Boolean(toastMessage)} />
    </div>
  );
}

export default App;
