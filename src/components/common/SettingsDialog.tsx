import { useState, useEffect, useCallback } from "react";
import type { KeyboardShortcuts } from "../../types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../../types/preferences";

interface SettingsDialogProps {
  open: boolean;
  shortcuts: KeyboardShortcuts;
  onSave: (shortcuts: KeyboardShortcuts) => void;
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

export function SettingsDialog({
  open,
  shortcuts,
  onSave,
  onClose,
}: SettingsDialogProps) {
  const [localShortcuts, setLocalShortcuts] = useState<KeyboardShortcuts>(shortcuts);
  const [editingKey, setEditingKey] = useState<keyof KeyboardShortcuts | null>(null);
  const [activeCategory, setActiveCategory] = useState(0);

  useEffect(() => {
    setLocalShortcuts(shortcuts);
  }, [shortcuts]);

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

      // Get the key name
      let keyName = event.key;
      if (keyName === " ") keyName = "Space";
      else if (keyName === "ArrowUp") keyName = "Up";
      else if (keyName === "ArrowDown") keyName = "Down";
      else if (keyName === "ArrowLeft") keyName = "Left";
      else if (keyName === "ArrowRight") keyName = "Right";
      else if (keyName.length === 1) keyName = keyName.toUpperCase();

      // Ignore modifier-only presses
      if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) {
        return;
      }

      parts.push(keyName);
      const shortcut = parts.join("+");

      setLocalShortcuts((prev) => ({
        ...prev,
        [editingKey]: shortcut,
      }));
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
    setLocalShortcuts(DEFAULT_KEYBOARD_SHORTCUTS);
  };

  const handleSave = () => {
    onSave(localShortcuts);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="settings-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-sidebar">
            <div className="settings-sidebar-title">Keyboard Shortcuts</div>
            {SHORTCUT_CATEGORIES.map((category, index) => (
              <button
                key={category.name}
                className={`settings-category-btn ${activeCategory === index ? "is-active" : ""}`}
                onClick={() => setActiveCategory(index)}
              >
                {category.name}
              </button>
            ))}
          </div>

          <div className="settings-main">
            <div className="shortcuts-list">
              {SHORTCUT_CATEGORIES[activeCategory].shortcuts.map((item) => (
                <div key={item.key} className="shortcut-row">
                  <span className="shortcut-label">{item.label}</span>
                  <button
                    className={`shortcut-value ${editingKey === item.key ? "is-editing" : ""}`}
                    onClick={() => setEditingKey(item.key)}
                  >
                    {editingKey === item.key
                      ? "Press keys..."
                      : localShortcuts[item.key]}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="toolbar-button" onClick={handleReset}>
            Reset to Defaults
          </button>
          <div className="settings-footer-right">
            <button className="toolbar-button" onClick={onClose}>
              Cancel
            </button>
            <button className="toolbar-button primary" onClick={handleSave}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
