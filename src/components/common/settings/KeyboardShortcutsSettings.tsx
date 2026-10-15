import { useState, useEffect, useCallback, useMemo } from "react";
import type { KeyboardShortcuts } from "../../../types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { loggingService } from "../../../services/loggingService";
import { displayedShortcut, isMacPlatform, recordedShortcut } from "../../../utils/platformLabels";

interface KeyboardShortcutsSettingsProps {
  onClose: () => void;
}

interface ShortcutCategory {
  name: string;
  shortcuts: Array<{
    key: keyof KeyboardShortcuts;
    label: string;
  }>;
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: "File",
    shortcuts: [
      { key: "fileNew", label: "New" },
      { key: "fileNewWindow", label: "New Window" },
      { key: "fileOpen", label: "Open" },
      { key: "fileSave", label: "Save" },
      { key: "fileSaveAs", label: "Save As" },
      { key: "fileClose", label: "Close" },
      { key: "filePreferences", label: "Preferences" },
    ],
  },
  {
    name: "Edit",
    shortcuts: [
      { key: "editCopyAsMarkdown", label: "Copy As Markdown" },
      { key: "editPasteAsPlainText", label: "Paste As Plain Text" },
      { key: "editSelectLine", label: "Select Line" },
      { key: "editSelectWord", label: "Select Word" },
      { key: "editDeleteWord", label: "Delete Word" },
      { key: "editJumpToTop", label: "Jump to Top" },
      { key: "editJumpToBottom", label: "Jump to Bottom" },
      { key: "editFind", label: "Find" },
      { key: "editFindNext", label: "Find Next" },
      { key: "editFindPrevious", label: "Find Previous" },
      { key: "editReplace", label: "Replace" },
    ],
  },
  {
    name: "Paragraph",
    shortcuts: [
      { key: "paragraphHeading1", label: "Heading 1" },
      { key: "paragraphHeading2", label: "Heading 2" },
      { key: "paragraphHeading3", label: "Heading 3" },
      { key: "paragraphHeading4", label: "Heading 4" },
      { key: "paragraphHeading5", label: "Heading 5" },
      { key: "paragraphHeading6", label: "Heading 6" },
      { key: "paragraphParagraph", label: "Paragraph" },
      { key: "paragraphIncreaseHeading", label: "Increase Heading" },
      { key: "paragraphDecreaseHeading", label: "Decrease Heading" },
      { key: "paragraphTable", label: "Table" },
      { key: "paragraphCodeFences", label: "Code Fences" },
      { key: "paragraphMathBlock", label: "Math Block" },
      { key: "paragraphQuote", label: "Quote" },
      { key: "paragraphOrderedList", label: "Ordered List" },
      { key: "paragraphUnorderedList", label: "Unordered List" },
      { key: "paragraphIndent", label: "Indent" },
      { key: "paragraphOutdent", label: "Outdent" },
    ],
  },
  {
    name: "Format",
    shortcuts: [
      { key: "formatStrong", label: "Bold" },
      { key: "formatEmphasis", label: "Italic" },
      { key: "formatUnderline", label: "Underline" },
      { key: "formatCode", label: "Code" },
      { key: "formatStrike", label: "Strikethrough" },
      { key: "formatHyperlink", label: "Hyperlink" },
      { key: "formatImage", label: "Image" },
      { key: "formatClearFormat", label: "Clear Format" },
    ],
  },
  {
    name: "View",
    shortcuts: [
      { key: "viewSource", label: "Source" },
      { key: "viewWysiwyg", label: "WYSIWYG" },
      { key: "viewToggleSidebar", label: "Toggle Sidebar" },
      { key: "viewCycleViewMode", label: "Cycle View Mode" },
      { key: "viewToggleFullscreen", label: "Toggle Fullscreen" },
      { key: "viewSwitchDocuments", label: "Switch Documents" },
    ],
  },
];

export function KeyboardShortcutsSettings({ onClose }: KeyboardShortcutsSettingsProps) {
  const [savedShortcuts, setSavedShortcuts] = useState<KeyboardShortcuts | null>(null);
  const [localShortcuts, setLocalShortcuts] = useState<KeyboardShortcuts | null>(null);
  const [editingKey, setEditingKey] = useState<keyof KeyboardShortcuts | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences("settings_shortcuts")
      .then((p) => {
        if (cancelled) return;
        const merged = { ...DEFAULT_KEYBOARD_SHORTCUTS, ...p.keyboardShortcuts };
        setSavedShortcuts(merged);
        setLocalShortcuts(merged);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Failed to load shortcuts");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Shortcut string → list of action keys that share it (only entries with length > 1). */
  const conflicts = useMemo<Map<string, (keyof KeyboardShortcuts)[]>>(() => {
    if (!localShortcuts) return new Map();
    const seen = new Map<string, (keyof KeyboardShortcuts)[]>();
    for (const [k, v] of Object.entries(localShortcuts)) {
      const list = seen.get(v) ?? [];
      list.push(k as keyof KeyboardShortcuts);
      seen.set(v, list);
    }
    return new Map([...seen.entries()].filter(([, keys]) => keys.length > 1));
  }, [localShortcuts]);

  const handleKeyCapture = useCallback(
    (event: KeyboardEvent) => {
      if (!editingKey) return;

      event.preventDefault();
      event.stopPropagation();

      // Escape cancels the current edit without recording a shortcut.
      if (event.key === "Escape") {
        setEditingKey(null);
        return;
      }

      // Lone modifiers, dead keys, bare keys and (off-Mac) the Windows key
      // keep the recorder waiting.
      const shortcut = recordedShortcut(event, isMacPlatform());
      if (shortcut === null) return;

      setLocalShortcuts((prev) => (prev ? { ...prev, [editingKey]: shortcut } : prev));
      setIsDirty(true);
      setEditingKey(null);
    },
    [editingKey],
  );

  // Capture phase: the recorder sees the key before `useKeyboardShortcuts`'
  // bubble-phase window listener, and its stopPropagation keeps the chord
  // being recorded from also running its command (D190-WI-7, audit b100).
  useEffect(() => {
    if (editingKey) {
      window.addEventListener("keydown", handleKeyCapture, true);
      return () => window.removeEventListener("keydown", handleKeyCapture, true);
    }
  }, [editingKey, handleKeyCapture]);

  const handleReset = () => {
    loggingService.logButtonClick("settings.shortcuts.reset");
    setLocalShortcuts(DEFAULT_KEYBOARD_SHORTCUTS);
    setIsDirty(true);
  };

  const handleDiscard = () => {
    setLocalShortcuts(savedShortcuts);
    setIsDirty(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!localShortcuts) return;
    loggingService.logButtonClick("settings.shortcuts.save");
    setSaveError(null);
    try {
      await preferencesService.setPreferences({ keyboardShortcuts: localShortcuts });
      setSavedShortcuts(localShortcuts);
      setIsDirty(false);
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save shortcuts");
      loggingService.logUiEvent("ui.settings.shortcuts.save", { status: "fail" });
    }
  };

  if (loadError) {
    return (
      <div className="shortcuts-layout">
        <p className="settings-error">{loadError}</p>
      </div>
    );
  }

  if (!localShortcuts) {
    return (
      <div className="shortcuts-layout">
        <p style={{ color: "var(--color-muted)" }}>Loading shortcuts…</p>
      </div>
    );
  }

  return (
    <div className="shortcuts-layout">
      <div className="shortcuts-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3>Keyboard Shortcuts</h3>
            <p>Customize shortcuts across the app.</p>
          </div>
          <button className="toolbar-button" onClick={handleReset}>
            Reset to Defaults
          </button>
        </div>
      </div>

      {saveError && <p className="settings-error">{saveError}</p>}

      {isDirty && (
        <div className="settings-dirty-banner" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>Unsaved shortcut changes</span>
          <button className="settings-dirty-banner__discard" onClick={handleDiscard}>
            Discard
          </button>
          <button
            className="toolbar-button primary"
            style={{ marginLeft: "auto" }}
            onClick={() => void handleSave()}
          >
            Save
          </button>
        </div>
      )}

      {conflicts.size > 0 && (
        <div className="settings-error" role="alert">
          Conflicting shortcuts detected — duplicate assignments are highlighted below.
        </div>
      )}

      {SHORTCUT_CATEGORIES.map((category) => (
        <section key={category.name} className="shortcuts-section">
          <h4>{category.name}</h4>
          <div className="shortcuts-list">
            {category.shortcuts.map((item) => {
              const shortcutValue = localShortcuts[item.key];
              const isConflict = conflicts.has(shortcutValue);
              return (
                <div key={item.key} className={`shortcut-row${isConflict ? " has-conflict" : ""}`}>
                  <span className="shortcut-label">{item.label}</span>
                  <button
                    className={`shortcut-value ${editingKey === item.key ? "is-editing" : ""}`}
                    onClick={() => {
                      loggingService.logButtonClick(
                        `settings.shortcuts.edit.${String(item.key)}`,
                      );
                      setEditingKey(item.key);
                    }}
                  >
                    {editingKey === item.key
                      ? "Press keys..."
                      : displayedShortcut(item.key, shortcutValue, isMacPlatform())}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
