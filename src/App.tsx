import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DevToolbar } from "./components/DevToolbar";
import { SplitView } from "./components/Editor/SplitView";
import { MilkdownEditor } from "./components/Editor/MilkdownEditor";
import { NoDocumentEditorColumn } from "./components/Editor/NoDocumentEditorColumn";
import { TOCSidebarContainer } from "./components/Sidebar";
import { BottomTabs } from "./components/BottomTabs";
import { useTOC } from "./hooks/useTOC";
import { AppDialogs } from "./components/AppDialogs";
import type { RecreateChoice, RecreateRequest } from "./components/common/RecreateFileDialog";
import { saveAfterIgnoredDeletionChoice } from "./services/documentSave";
import { LoadingSpinner } from "./components/common/LoadingSpinner";
import { Toast } from "./components/common/Toast";
import { supersedeRetry, useDocument } from "./hooks/useDocument";
import { useAutoSave } from "./hooks/useAutoSave";
import { useEditor } from "./hooks/useEditor";
import { useExternalChangePrompt } from "./hooks/useExternalChangePrompt";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useMenuEvents } from "./hooks/useMenuEvents";
import { useTheme } from "./hooks/useTheme";
import { useQuitGuard } from "./hooks/useQuitGuard";
import { useWindowCloseGuard } from "./hooks/useWindowCloseGuard";
import { closeWindowIfLastTabClosed } from "./utils/lastTabClose";
import { useMcpSync } from "./hooks/useMcpSync";
import { useOpenInWindow } from "./hooks/useOpenInWindow";
import { useMcpEvents } from "./hooks/useMcpEvents";
import { useLinkInsertBinding } from "./hooks/useLinkInsertBinding";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { useRecentFilesMenuRefresh } from "./hooks/useRecentFilesMenuRefresh";
import { useSidebarPreference } from "./hooks/useSidebarPreference";
import { useOpenUrlParam } from "./hooks/useOpenUrlParam";
import { useOpenPaths } from "./hooks/useOpenPaths";
import { useFileOpenEvent } from "./hooks/useFileOpenEvent";
import { useStartupDrafts } from "./hooks/useStartupDrafts";
import { useLastViewModePersistence } from "./hooks/useLastViewModePersistence";
import { exportService } from "./services/exportService";
import { preferencesService } from "./services/preferencesService";
import { applyEditorPref, applyCodeTheme, applyAutoPair } from "./components/common/settings/editorPrefApply";
import { loggingService } from "./services/loggingService";
import { windowService } from "./services/windowService";
import { buildImageMarkdown } from "./services/imageService";
import { performRecreateChoice, performSave } from "./services/saveService";
import { applyWindowState } from "./services/windowStateApplier";
import type { Document } from "./types/document";
import {
  activeDocumentAfterFlush,
  decideCloseRequest,
} from "./utils/dataLossGuards";
import { buildLargeDocumentDegradeLog } from "./utils/largeDocumentDegradeLog";
import { decideLargeDocumentGuard } from "./utils/largeDocumentGuard";
import { buildSourceTablesWithheldLog } from "./utils/sourceTableWithheldLog";
import { shouldEvaluateGuard, sourceTableVerdictOf } from "./utils/sourceTableVerdict";
import type { ViewMode } from "./types/editor";
import type { KeyboardShortcuts } from "./types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "./types/preferences";
import { useDocumentStore } from "./stores/documentStore";
import { isSourceTablesWithheld, useEditorStore, userViewModeCommands } from "./stores/editorStore";
import { useMilkdownEditorStore } from "./stores/milkdownEditorStore";
import { useToastStore } from "./stores/toastStore";
import { useThemeStore } from "./stores/themeStore";
import { dispatchTableActionFromKeyboard } from "./plugins/milkdown/table/contextMenu";
import { dispatchSourceTableAction } from "./plugins/codemirror/sourceTableContextMenu";
import type { TableShortcutAction } from "./hooks/useKeyboardShortcuts";
import { migrateViewMode } from "./utils/viewModeUtils";
import { quitDialogModel } from "./utils/quitDialogModel";
import { encodingReopenOutcome } from "./utils/openWriteGuard";
import { encodingRetryRefusalToast } from "./components/common/encodingDialogCopy";
import { OPEN_FAILED_MESSAGE } from "./utils/openFailure";
import { recoverDraft, discardRecoveryDraft } from "./services/draftService";
import { draftRecoveryOutcome, type DraftActionOutcome } from "./utils/draftRecoveryOutcome";
import { applyRecoveredDocument } from "./utils/recoverIntoOpenTab";
import { currentWindowLabel } from "./utils/currentWindowLabel";
import { captureToken, confirmDocumentClose, saveIfCurrent } from "./utils/menuTargetToken";
import type { HighlightRequest, MenuTargetToken } from "./utils/menuTargetToken";
import { triggerTableInsert } from "./utils/tableInsertTrigger";

/**
 * What an open ConfirmDialog is about. Only `"document"` originates here now —
 * the OS window-close request is owned by `useWindowCloseGuard` (D16 WI-6),
 * which exposes its own `pendingClose`.
 */
type PendingClose = "document" | "window" | null;

function App() {
  const {
    activeDocument,
    activeDocumentTitle,
    openDocumentFromDialog,
    openPathOutcome,
    openDocumentWithEncoding,
    createDocument,
    updateActiveDocumentContent,
    saveActiveDocument,
    saveActiveDocumentAs,
    switchToMostRecentDocument,
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
  const { viewMode, setViewMode, showSidebar, userViewModeChoice } = useEditor();
  // Sole writer of showSidebar outside the store; buffers pre-hydration toggles (ADR-0031 5b, WI-5).
  const sidebarPreference = useSidebarPreference();
  const sidebarWidth = useEditorStore((s) => s.sidebarWidth);
  const { mode: themeMode, resolvedTheme, applyThemeMode, setThemeMode } = useTheme();
  const [highlightRequest, setHighlightRequest] = useState<HighlightRequest | undefined>(undefined);
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);
  // Decision 1A: autoSaveInterval lives in editorStore so GeneralSettings can update it reactively.
  const autoSaveInterval = useEditorStore((s) => s.autoSaveInterval);
  const setAutoSaveInterval = useEditorStore((s) => s.setAutoSaveInterval);
  const { updateRecentFiles, hydrateRecentFiles, failRecentFilesHydration } = useRecentFiles();
  // Recovery drafts listed at startup (old ones pruned first).
  const [drafts, setDrafts] = useStartupDrafts();
  const toastMessage = useToastStore((s) => s.message);
  const showToast = useToastStore((s) => s.showToast);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialPage, setSettingsInitialPage] = useState<"general" | "keyboard-shortcuts">("general");
  const [recreateRequest, setRecreateRequest] = useState<RecreateRequest | null>(null);
  const [defaultViewMode, setDefaultViewMode] = useState<ViewMode>("wysiwyg");
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcuts>(DEFAULT_KEYBOARD_SHORTCUTS);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [launchPathsComplete, setLaunchPathsComplete] = useState(false);
  const closeTargetRef = useRef<PendingClose>(null);
  // D261: the menu-target token of the close that opened the prompt; Discard closes only while it is current.
  const closeTokenRef = useRef<MenuTargetToken | null>(null);
  const openDialogLockRef = useRef(false);
  const openDialogCooldownRef = useRef(0);
  const launchPathsRetryRef = useRef(0);
  const encodingRetryRef = useRef<AbortController | null>(null); // D121: the pending encoding retry
  // External changes to any open document: watcher, prompt, Reload / Ignore (D171).
  const { reloadMessage, handleReloadFile, handleIgnoreReload } = useExternalChangePrompt({
    activeDocument,
    replaceDocument,
    showToast,
    setBusyLabel,
  });

  useAutoSave(autoSaveInterval);

  // The OS window-close guard: one subscription for the life of the window, the
  // window-state/geometry save, and the confirm latch (D16 WI-6). A cancelled
  // prompt re-registers this window for routing (ADR-0033); `useMcpSync` runs
  // below, so its `forceSync` is reached through a ref.
  const forceMcpSyncRef = useRef<() => Promise<void>>(async () => {});
  const windowCloseGuard = useWindowCloseGuard({ onCloseCancelled: () => void forceMcpSyncRef.current() });

  // The D16 app-quit guard: answers Rust's two quit questions and raises
  // `quitPrompt` when this window has to ask the user (ADR-0025).
  const quitGuard = useQuitGuard();
  // Which prompt the one ConfirmDialog is currently about. A quit outranks an
  // open ⌘W or window-close dialog; the rule itself lives in quitDialogModel.
  const confirmDialog = quitDialogModel({
    pendingClose: pendingClose ?? windowCloseGuard.pendingClose,
    quitPrompt: quitGuard.quitPrompt,
  });
  const quitPromptRef = useRef(quitGuard.quitPrompt); // D253 (ADR-0112): emptied secondary windows close, never mid-quit
  quitPromptRef.current = quitGuard.quitPrompt;
  const closeWindowIfEmptied = useCallback(
    () => void closeWindowIfLastTabClosed({ requestWindowClose: windowCloseGuard.requestWindowClose, quitInProgress: quitPromptRef.current !== null }),
    [windowCloseGuard.requestWindowClose],
  );
  const closeTabById = useCallback(
    (id: string, discardChanges: boolean) => closeDocumentById(id, discardChanges).then(closeWindowIfEmptied),
    [closeDocumentById, closeWindowIfEmptied],
  );

  // MCP hooks for Claude Code / Codex CLI integration. The sync also feeds
  // external-open routing, gated on this window's listener (ADR-0033).
  const openInWindow = useOpenInWindow({ openPathOutcome });
  const mcpSync = useMcpSync({ routable: openInWindow.routable });
  useEffect(() => {
    forceMcpSyncRef.current = mcpSync.forceSync;
  }, [mcpSync.forceSync]);
  useMcpEvents();
  // ⌘K link request: cancel it when its document or view mode changes (D73).
  useLinkInsertBinding();

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

  // The Open Recent menu holds the session list Rust owns (D43); this window
  // only sends a refresh on a view-mode change, never its own list.
  const reportThemeToMenu = useRecentFilesMenuRefresh(viewMode, undefined, documents.length);
  useEffect(() => { reportThemeToMenu(); }, [themeMode, reportThemeToMenu]);

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
        // Hydrate logging from its own source (loggingService →
        // get_logging_settings), not from the preference object. Since ADR-0031
        // step 5b `preferencesService` picks its branch with `isTauri()`, so the
        // desktop app reads real `get_preferences` — but logging still has one
        // owner. Placed first in the try so no earlier await can throw past it;
        // safe because hydrateSettings never rejects and needs no preferences.
        await loggingService.hydrateSettings();
        const prefs = await preferencesService.getPreferences("app_hydrate");
        if (!mounted) return;
        // Don't set viewMode here - defer until launch paths are complete
        // to avoid race condition with Finder/CLI file opens
        setDefaultViewMode(migrateViewMode(prefs.defaultViewMode));
        sidebarPreference.hydrate(prefs.showSidebar);
        sidebarPreference.hydrateWidth(prefs.sidebarWidth);
        setAutoSaveInterval(prefs.autoSaveInterval);
        hydrateRecentFiles(prefs.recentFiles);
        if (prefs.keyboardShortcuts) {
          setKeyboardShortcuts({ ...DEFAULT_KEYBOARD_SHORTCUTS, ...prefs.keyboardShortcuts });
        }
        await applyWindowState(prefs.windowState);
        // Apply-only. Hydration must never write the value it just read: that is
        // a redundant write every launch, and across two windows a
        // last-writer-wins clobber of a theme the user just chose elsewhere.
        // User-initiated changes still persist, through the persisting setter
        // the Theme menu is wired to.
        applyThemeMode(prefs.themeMode);
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
        // Ignore preference loading errors in web preview. Recent files keep
        // any pre-hydration opens in memory without writing (ADR-0031 5a, A2);
        // the sidebar keeps any pre-hydration toggle the same way (5b, WI-5).
        if (mounted) {
          failRecentFilesHydration();
          sidebarPreference.fail();
        }
      } finally {
        if (mounted) setPreferencesLoaded(true);
      }
    };
    void loadPreferences();
    return () => {
      mounted = false;
    };
  }, [
    applyThemeMode,
    failRecentFilesHydration,
    hydrateRecentFiles,
    setAutoSaveInterval,
    setDefaultViewMode,
    sidebarPreference,
  ]);

  // Persist explicit user view-mode choices only (ADR-0053); held until the stored value is read (ADR-0031 5a).
  useLastViewModePersistence({
    preferencesLoaded,
    launchPathsComplete,
    activeDocument,
    viewMode,
    userViewModeChoice,
  });

  // `?open=` for secondary windows; waits for hydration, runs once (ADR-0031 5a, WI-1).
  useOpenUrlParam({
    preferencesLoaded,
    defaultViewMode,
    openPathOutcome,
    setViewMode,
    updateRecentFiles,
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(resolvedTheme === "dark" ? "theme-dark" : "theme-light");
  }, [resolvedTheme]);

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
      showToast(OPEN_FAILED_MESSAGE);
    } finally {
      setBusyLabel(null);
      openDialogLockRef.current = false;
    }
  }, [openDocumentFromDialog, showToast, updateRecentFiles]);

  // By-path opens and the drop's open loop (D95 / D125): recent file for every open,
  // view-mode follow-up only for an activated one.
  const { handleOpenPath, openPaths, openDroppedMarkdown } = useOpenPaths({
    openPathOutcome,
    updateRecentFiles,
    setBusyLabel,
    defaultViewMode,
    setViewMode,
  });

  const handleOpenRecent = useCallback(
    async (path: string, actionId?: string) => {
      await handleOpenPath(path, actionId);
    },
    [handleOpenPath],
  );

  const handleSave = useCallback(async (actionId?: string) => {
    await performSave(actionId, { saveActiveDocument, updateRecentFiles, showToast, onRecreateRequired: setRecreateRequest });
  }, [saveActiveDocument, showToast, updateRecentFiles]);

  const handleSaveAs = useCallback(async (actionId?: string) => {
    await performSave(actionId, { saveActiveDocument: saveActiveDocumentAs, updateRecentFiles, showToast });
  }, [saveActiveDocumentAs, showToast, updateRecentFiles]);

  const handleRecreateChoice = useCallback(async (choice: RecreateChoice) => {
    const request = recreateRequest;
    if (!request) return;
    setRecreateRequest(null);
    await performRecreateChoice(request, choice, {
      saveDecision: (decision) => saveAfterIgnoredDeletionChoice(request, decision, request.actionId),
      updateRecentFiles,
      showToast,
    });
  }, [recreateRequest, showToast, updateRecentFiles]);

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

  const handleOpenSettings = useCallback((_actionId?: string, pageOrToken?: unknown) => {
    setSettingsInitialPage(pageOrToken === "keyboard-shortcuts" ? "keyboard-shortcuts" : "general");
    setSettingsOpen(true);
  }, []);

  const applyDraftOutcome = useCallback(
    (draftId: string, input: DraftActionOutcome) => {
      const { dropRow, upsert, toast, allowKeep } = draftRecoveryOutcome(draftId, input);
      // D146: into the open clean tab of the same path, else its own tab.
      if (upsert) {
        void applyRecoveredDocument(draftId, upsert, {
          upsertAndActivate: upsertAndActivateDocument,
          showToast,
        }, input.action === "recover" && input.outcome.kind === "ok" ? input.outcome.result : undefined)
          .then((placed) => {
            if (placed !== "failed") setDrafts((prev) => prev.filter((draft) => draft.id !== draftId));
          });
        return;
      }
      if (dropRow) setDrafts((prev) => prev.filter((draft) => draft.id !== draftId));
      if (allowKeep) setDrafts((prev) => prev.map((draft) => draft.id === draftId ? { ...draft, inUseRefused: true } : draft));
      if (toast) showToast(toast);
    },
    [showToast, upsertAndActivateDocument],
  );

  const handleRecoverDraft = useCallback(async (draftId: string) => {
    applyDraftOutcome(draftId, { action: "recover", outcome: await recoverDraft(draftId) });
  }, [applyDraftOutcome]);

  const handleDiscardDraft = useCallback(async (draftId: string) => {
    applyDraftOutcome(draftId, { action: "discard", outcome: await discardRecoveryDraft(draftId) });
  }, [applyDraftOutcome]);

  const handleEncodingSelect = useCallback(
    async (encoding: string) => {
      if (!encodingIssue?.path) return;
      setBusyLabel("Opening file...");
      try {
        const { toast, recentPath, clearIssue } = encodingReopenOutcome(
          await openDocumentWithEncoding(encodingIssue.path, encoding, undefined, supersedeRetry(encodingRetryRef)),
        );
        if (recentPath) updateRecentFiles(recentPath);
        if (toast) showToast(toast);
        if (clearIssue) clearEncodingIssue();
      } catch (error) {
        // D52: a refused UTF-16 retry keeps the dialog open (the issue is not
        // cleared), so the user can try the other byte order or Cancel.
        const refusal = encodingRetryRefusalToast(error);
        if (refusal) showToast(refusal);
        else showToast("Failed to open with selected encoding");
      } finally {
        setBusyLabel(null);
      }
    },
    [clearEncodingIssue, encodingIssue, openDocumentWithEncoding, showToast, updateRecentFiles],
  );
  // D121: Cancel / Esc / backdrop all land here; a pending retry must not commit after it.
  const handleEncodingCancel = useCallback(() => {
    encodingRetryRef.current?.abort();
    clearEncodingIssue();
  }, [clearEncodingIssue]);

  const openNewWindow = useCallback(
    async (openPath?: string, notifyOnError = true) => {
      try {
        const { windowService } = await import("./services/windowService");
        // `null`: a pending quit refused the window (D74) — already logged,
        // and not an error worth a toast.
        return (await windowService.createWindow(openPath)) !== null;
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

      // Always open dropped files in the current window (no extra untitled window);
      // the default view mode applies once, after the first activated open (D51, D95).
      await openDroppedMarkdown(mdPaths);
    },
    [handleImageDrop, openDroppedMarkdown],
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
    // A quit prompt took the dialog over, so the answer is the quit's. Clearing
    // the close prompt it displaced keeps that dialog from reappearing behind it.
    if (confirmDialog.target === "quit") {
      if (confirmDialog.clearsPendingClose) {
        setPendingClose(null);
        closeTargetRef.current = null;
        closeTokenRef.current = null;
        windowCloseGuard.cancelClose();
      }
      quitGuard.confirmQuit();
      return;
    }

    const target = closeTargetRef.current;
    const storedToken = closeTokenRef.current;
    setPendingClose(null);
    closeTargetRef.current = null;
    closeTokenRef.current = null;

    // A window-close prompt is the guard hook's: it holds the latch, the window
    // handle and the state save (D16 WI-6).
    if (windowCloseGuard.pendingClose === "window") {
      await windowCloseGuard.confirmClose();
      return;
    }
    // D261: closes the prompted document only if the stored token is still current.
    if (target === "document") {
      if (await confirmDocumentClose(storedToken, closeActiveDocument)) closeWindowIfEmptied();
    }
  };

  const handleCancelClose = () => {
    setPendingClose(null);
    closeTargetRef.current = null;
    closeTokenRef.current = null;
    windowCloseGuard.cancelClose();
    if (confirmDialog.target === "quit") quitGuard.cancelQuit();
  };

  // ⌘W passes no token, so one is captured when the prompt opens (D261).
  const handleCloseRequest = useCallback((_actionId?: string, token?: MenuTargetToken) => {
    const decision = decideCloseRequest(activeDocumentAfterFlush()); // D15: flushed, fresh
    if (decision === "prompt") {
      closeTargetRef.current = "document";
      closeTokenRef.current = token ?? captureToken(currentWindowLabel());
      setPendingClose("document");
    } else if (decision === "close") {
      void closeActiveDocument(true).then(closeWindowIfEmptied);
    } else {
      closeWindowIfEmptied(); // "noop": no active document; an empty secondary window closes (D253)
    }
  }, [closeActiveDocument, closeWindowIfEmptied]);

  // ⌘⌥T and Format → Insert Table share one flow: triggerTableInsert
  // (utils/tableInsertTrigger) opens TableInsertModal via
  // tableInsertStore.requestInsert, and its submit inserts only while the
  // token is current (D261). The keyboard path mints its token at open.

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
    onNewWindow: () => void openNewWindow(),
    onHighlight: () => {
      const token = captureToken(currentWindowLabel());
      setHighlightRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1, token }));
    },
    onExportHtml: (actionId) => void handleExportHtml(actionId),
    onOpen: (actionId) => void handleOpenDialog(actionId),
    onSave: (actionId) => void handleSave(actionId),
    onSaveAs: (actionId) => void handleSaveAs(actionId),
    onClose: handleCloseRequest,
    onToggleSidebar: sidebarPreference.toggle,
    onToggleFullscreen: (actionId) => void windowService.toggleFullscreenWithFeedback(showToast, actionId),
    onCycleViewMode: userViewModeCommands.cycle,
    onOpenPreferences: handleOpenSettings,
    onInsertTable: () => triggerTableInsert(),
    onTableAction: handleTableShortcut,
    shortcuts: keyboardShortcuts,
  });

  useMenuEvents({
    onNew: () => void createDocument(),
    onNewWindow: () => void openNewWindow(),
    onOpen: (actionId) => void handleOpenDialog(actionId),
    onSave: (actionId, token) => void saveIfCurrent(token, actionId, () => handleSave(actionId)),
    onSaveAs: (actionId, token) => void saveIfCurrent(token, actionId, () => handleSaveAs(actionId)),
    onClose: handleCloseRequest,
    onExportHtml: (actionId) => void handleExportHtml(actionId),
    onOpenRecent: handleOpenRecent,
    onToggleSidebar: sidebarPreference.toggle,
    onHighlight: (_actionId, receipt) => {
      const token = receipt ?? captureToken(currentWindowLabel());
      setHighlightRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1, token }));
    },
    onInsertTable: (_actionId, token) => triggerTableInsert(token),
    onViewModeChange: userViewModeCommands.set,
    onCycleViewMode: userViewModeCommands.cycle,
    onSwitchDocuments: switchToMostRecentDocument,
    onToggleFullscreen: (actionId) => void windowService.toggleFullscreenWithFeedback(showToast, actionId),
    onThemeModeChange: (mode) => {
      if (useThemeStore.getState().mode !== mode) void setThemeMode(mode);
    },
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
        // When opening from Finder/command line, use default view mode from preferences.
        // Switching before the open is safe here: at cold launch there is no current
        // document for the switch to reload (unlike drop / Finder-while-running, D51).
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

  // A second launch with a path while running (single instance): Rust sends
  // `file:open` to this one window (D279).
  useFileOpenEvent({ defaultViewMode, openPaths, setViewMode });

  return (
    <div
      className={`app-shell${showSidebar ? "" : " no-sidebar"}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DevToolbar
        onOpenFile={handleDevOpenFile}
      />
            {showSidebar ? (
        <TOCSidebarContainer
          tocEntries={tocHierarchy}
          activeTocEntryId={activeTocEntryId}
          collapsedTocIds={collapsedTocIds}
          onTocEntryClick={navigateToTocEntry}
          onTocToggleCollapse={toggleTocCollapsed}
          sidebarWidth={sidebarWidth}
          onSidebarResize={sidebarPreference.resize}
        />
      ) : null}
      <div className="main">
        {/* When the sidebar is hidden, the main area needs its own traffic-lights
            zone, an empty drag region (D223: no mode badge). When it is shown,
            the sidebar's .sidebar-traffic-area is the drag region. */}
        {!showSidebar ? <div className="main-traffic-area" data-tauri-drag-region /> : null}
        {busyLabel ? (
          <div className="busy-indicator">
            <LoadingSpinner label={busyLabel} />
          </div>
        ) : null}
        <section className="workspace">
          {!activeDocument ? (
            <NoDocumentEditorColumn />
          ) : viewMode === "wysiwyg" ? (
            <MilkdownEditor highlightRequest={highlightRequest} />
          ) : (
            <SplitView
              markdown={activeDocument.content}
              onChange={updateActiveDocumentContent}
              highlightRequest={highlightRequest}
            />
          )}
        </section>
      </div>

      <BottomTabs
        documents={documents}
        activeDocumentId={activeDocument?.id ?? null}
        onSelect={setActiveDocumentById}
        onClose={closeTabById}
        onNewDocument={createDocument}
        sidebarShown={showSidebar}
        onToggleSidebar={sidebarPreference.toggle}
        sidebarToggleShortcut={keyboardShortcuts.viewToggleSidebar}
      />

      {/* The App-level dialogs, incl. this window's ADR-0042 MCP prompt (D42 WI-3). */}
      <AppDialogs
        drafts={drafts}
        onRecoverDraft={handleRecoverDraft}
        onDiscardDraft={handleDiscardDraft}
        reloadMessage={reloadMessage}
        onReload={handleReloadFile}
        onIgnoreReload={handleIgnoreReload}
        recreateRequest={recreateRequest}
        onRecreateChoice={(choice) => void handleRecreateChoice(choice)}
        encodingIssue={encodingIssue}
        onEncodingSelect={handleEncodingSelect}
        onEncodingCancel={handleEncodingCancel}
        confirmDialog={confirmDialog}
        onConfirmClose={handleConfirmClose}
        onCancelClose={handleCancelClose}
        settingsOpen={settingsOpen}
        settingsInitialPage={settingsInitialPage}
        onSettingsClose={() => setSettingsOpen(false)}
      />
      <Toast message={toastMessage ?? ""} visible={Boolean(toastMessage)} />
    </div>
  );
}

export default App;
