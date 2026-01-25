import { useState, useEffect, useCallback } from "react";
import type { KeyboardShortcuts } from "../../types/preferences";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../../types/preferences";
import type { ViewMode } from "../../types/editor";
import { useThemeStore } from "../../stores/themeStore";

interface SettingsDialogProps {
  open: boolean;
  shortcuts: KeyboardShortcuts;
  defaultViewMode: ViewMode;
  onSave: (shortcuts: KeyboardShortcuts) => void;
  onDefaultViewModeChange: (mode: ViewMode) => void;
  onClose: () => void;
}

interface ShortcutCategory {
  name: string;
  shortcuts: Array<{
    key: keyof KeyboardShortcuts;
    label: string;
  }>;
}

interface SettingsPage {
  id: string;
  label: string;
  description: string;
  placeholderItems: string[];
}

const SETTINGS_PAGES: SettingsPage[] = [
  {
    id: "general",
    label: "General",
    description: "App behavior, language, and startup preferences.",
    placeholderItems: ["Default view mode", "Autosave frequency", "Language"],
  },
  {
    id: "editor",
    label: "Editor",
    description: "Editor defaults, typography, and editing behaviors.",
    placeholderItems: ["Font size", "Line height", "Caret width"],
  },
  {
    id: "markdown",
    label: "Markdown",
    description: "Markdown syntax preferences and extensions.",
    placeholderItems: ["Auto pair", "GFM tables", "Footnotes"],
  },
  {
    id: "image",
    label: "Image",
    description: "Image handling and paste behavior.",
    placeholderItems: ["Default save location", "Compression", "Retina export"],
  },
  {
    id: "export",
    label: "Export",
    description: "Export formats and output settings.",
    placeholderItems: ["Default export folder", "PDF preset", "HTML styles"],
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Themes, layout density, and UI styling.",
    placeholderItems: ["Theme", "Sidebar density", "Accent color"],
  },
  {
    id: "keyboard-shortcuts",
    label: "Keyboard Shortcuts",
    description: "Customize shortcuts across the app.",
    placeholderItems: [],
  },
];

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

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "editor-only", label: "Editor" },
  { value: "preview-only", label: "Preview" },
  { value: "split", label: "Split" },
  { value: "wysiwyg", label: "WYSIWYG" },
];

export function SettingsDialog({
  open,
  shortcuts,
  defaultViewMode,
  onSave,
  onDefaultViewModeChange,
  onClose,
}: SettingsDialogProps) {
  const [localShortcuts, setLocalShortcuts] = useState<KeyboardShortcuts>(shortcuts);
  const [editingKey, setEditingKey] = useState<keyof KeyboardShortcuts | null>(null);
  const [activePage, setActivePage] = useState("general");
  const [searchTerm, setSearchTerm] = useState("");
  const { resolvedTheme } = useThemeStore();

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

  const filteredPages = SETTINGS_PAGES.filter((page) =>
    page.label.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const currentPage =
    SETTINGS_PAGES.find((page) => page.id === activePage) ?? SETTINGS_PAGES[0];

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className={`settings-dialog theme-${resolvedTheme}`}
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
            <input
              className="settings-search"
              type="search"
              placeholder="Search..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <div className="settings-sidebar-title">Settings</div>
            {filteredPages.map((page) => (
              <button
                key={page.id}
                className={`settings-category-btn ${
                  activePage === page.id ? "is-active" : ""
                }`}
                onClick={() => setActivePage(page.id)}
              >
                {page.label}
              </button>
            ))}
          </div>

          <div className="settings-main">
            {currentPage.id === "keyboard-shortcuts" ? (
              <div className="shortcuts-layout">
                <div className="shortcuts-header">
                  <h3>Keyboard Shortcuts</h3>
                  <p>Group shortcuts by intent instead of separate menu pages.</p>
                </div>
                {SHORTCUT_CATEGORIES.map((category) => (
                  <section key={category.name} className="shortcuts-section">
                    <h4>{category.name}</h4>
                    <div className="shortcuts-list">
                      {category.shortcuts.map((item) => (
                        <div key={item.key} className="shortcut-row">
                          <span className="shortcut-label">{item.label}</span>
                          <button
                            className={`shortcut-value ${
                              editingKey === item.key ? "is-editing" : ""
                            }`}
                            onClick={() => setEditingKey(item.key)}
                          >
                            {editingKey === item.key
                              ? "Press keys..."
                              : localShortcuts[item.key]}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : currentPage.id === "general" ? (
              <div className="settings-general">
                <h3>General</h3>
                <p>App behavior, language, and startup preferences.</p>
                <div className="settings-form">
                  <div className="settings-form-row">
                    <label htmlFor="default-view-mode">Default View Mode</label>
                    <select
                      id="default-view-mode"
                      className="settings-select"
                      value={defaultViewMode}
                      onChange={(e) => onDefaultViewModeChange(e.target.value as ViewMode)}
                    >
                      {VIEW_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="settings-form-hint">
                    New documents will open in this view mode.
                  </p>
                </div>
              </div>
            ) : (
              <div className="settings-placeholder">
                <h3>{currentPage.label}</h3>
                <p>{currentPage.description}</p>
                <div className="settings-placeholder-grid">
                  {currentPage.placeholderItems.map((item) => (
                    <div key={item} className="settings-placeholder-card">
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <div className="settings-placeholder-note">
                  Placeholder layout aligned with Typora-style settings sections.
                </div>
              </div>
            )}
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
