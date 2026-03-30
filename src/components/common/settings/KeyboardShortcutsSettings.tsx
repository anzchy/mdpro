import { useState, useEffect, useCallback } from "react";
import type { KeyboardShortcuts } from "../../../types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { loggingService } from "../../../services/loggingService";

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
      { key: "fileOpenQuickly", label: "Open Quickly" },
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

  useEffect(() => {
    void preferencesService.getPreferences().then((p) => {
      const merged = { ...DEFAULT_KEYBOARD_SHORTCUTS, ...p.keyboardShortcuts };
      setSavedShortcuts(merged);
      setLocalShortcuts(merged);
    });
  }, []);

  const handleKeyCapture = useCallback(
    (event: KeyboardEvent) => {
      if (!editingKey) return;

      event.preventDefault();
      event.stopPropagation();

      const parts: string[] = [];
      if (event.metaKey) parts.push("Cmd");
      if (event.ctrlKey) parts.push("Ctrl");
      if (event.altKey) parts.push("Option");
      if (event.shiftKey) parts.push("Shift");

      let keyName = event.key;
      if (keyName === " ") keyName = "Space";
      else if (keyName === "ArrowUp") keyName = "Up";
      else if (keyName === "ArrowDown") keyName = "Down";
      else if (keyName === "ArrowLeft") keyName = "Left";
      else if (keyName === "ArrowRight") keyName = "Right";
      else if (keyName.length === 1) keyName = keyName.toUpperCase();

      if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;

      parts.push(keyName);
      const shortcut = parts.join("+");

      setLocalShortcuts((prev) => (prev ? { ...prev, [editingKey]: shortcut } : prev));
      setIsDirty(true);
      setEditingKey(null);
    },
    [editingKey],
  );

  useEffect(() => {
    if (editingKey) {
      window.addEventListener("keydown", handleKeyCapture);
      return () => window.removeEventListener("keydown", handleKeyCapture);
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
  };

  const handleSave = async () => {
    if (!localShortcuts) return;
    loggingService.logButtonClick("settings.shortcuts.save");
    try {
      await preferencesService.setPreferences({ keyboardShortcuts: localShortcuts });
      setSavedShortcuts(localShortcuts);
      setIsDirty(false);
      onClose();
    } catch {
      loggingService.logUiEvent("ui.settings.shortcuts.save", { status: "fail" });
    }
  };

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

      {isDirty && (
        <div className="settings-dirty-banner" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>Unsaved shortcut changes</span>
          <button onClick={handleDiscard}>Discard</button>
          <button
            className="toolbar-button primary"
            style={{ marginLeft: "auto" }}
            onClick={() => void handleSave()}
          >
            Save
          </button>
        </div>
      )}

      {SHORTCUT_CATEGORIES.map((category) => (
        <section key={category.name} className="shortcuts-section">
          <h4>{category.name}</h4>
          <div className="shortcuts-list">
            {category.shortcuts.map((item) => (
              <div key={item.key} className="shortcut-row">
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
                  {editingKey === item.key ? "Press keys..." : localShortcuts[item.key]}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
