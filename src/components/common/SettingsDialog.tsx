import { useState, useEffect, useRef } from "react";
import type { McpConfig } from "../../types/preferences";
import { DEFAULT_MCP_CONFIG } from "../../types/preferences";
import { useThemeStore } from "../../stores/themeStore";
import { loggingService } from "../../services/loggingService";
import { preferencesService } from "../../services/preferencesService";
import { IntegrationsSettings } from "./IntegrationsSettings";
import { GeneralSettings } from "./settings/GeneralSettings";
import { EditorSettings } from "./settings/EditorSettings";
import { MarkdownSettings } from "./settings/MarkdownSettings";
import { ImageSettings } from "./settings/ImageSettings";
import { ExportSettings } from "./settings/ExportSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { AdvancedSettings } from "./settings/AdvancedSettings";
import { KeyboardShortcutsSettings } from "./settings/KeyboardShortcutsSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "General", icon: "⚙️" },
  { id: "editor", label: "Editor", icon: "✏️" },
  { id: "markdown", label: "Markdown", icon: "📝" },
  { id: "image", label: "Image", icon: "🖼️" },
  { id: "integrations", label: "Integrations", icon: "🔗" },
  { id: "export", label: "Export", icon: "📤" },
  { id: "appearance", label: "Appearance", icon: "🎨" },
  { id: "keyboard-shortcuts", label: "Keyboard Shortcuts", icon: "⌨️" },
  { id: "advanced", label: "Advanced", icon: "🔧" },
];

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [activePage, setActivePage] = useState("general");
  const [mcpConfig, setMcpConfig] = useState<McpConfig>(DEFAULT_MCP_CONFIG);
  const { resolvedTheme } = useThemeStore();
  const firstNavRef = useRef<HTMLButtonElement>(null);

  // Focus first nav item when dialog opens
  useEffect(() => {
    if (open) {
      setActivePage("general");
      setTimeout(() => firstNavRef.current?.focus(), 50);
    }
  }, [open]);

  // Load MCP config for integrations page
  useEffect(() => {
    if (open) {
      void preferencesService.getPreferences().then((p) => {
        if (p.mcp) setMcpConfig(p.mcp);
      });
    }
  }, [open]);

  const handleMcpConfigChange = async (config: McpConfig) => {
    setMcpConfig(config);
    try {
      await preferencesService.setPreferences({ mcp: config });
    } catch {
      loggingService.logUiEvent("ui.settings.mcp.save", { status: "fail" });
    }
  };

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={() => {
        loggingService.logDialogAction("settings.dialog.backdrop", "cancel");
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          loggingService.logDialogAction("settings.dialog.escape", "cancel");
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-labelledby="settings-dialog-title"
        className={`settings-dialog theme-${resolvedTheme}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2 id="settings-dialog-title" className="settings-title">Settings</h2>
          <button
            className="settings-close"
            onClick={() => {
              loggingService.logButtonClick("settings.close");
              onClose();
            }}
          >
            &times;
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-sidebar">
            {NAV_ITEMS.map((item, index) => (
              <button
                key={item.id}
                ref={index === 0 ? firstNavRef : undefined}
                className={`settings-category-btn ${activePage === item.id ? "is-active" : ""}`}
                onClick={() => {
                  loggingService.logButtonClick(`settings.category.${item.id}`);
                  setActivePage(item.id);
                }}
              >
                <span aria-hidden="true" className="settings-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          <div className="settings-main">
            {activePage === "general" && <GeneralSettings />}
            {activePage === "editor" && <EditorSettings />}
            {activePage === "markdown" && <MarkdownSettings />}
            {activePage === "image" && <ImageSettings />}
            {activePage === "integrations" && (
              <IntegrationsSettings
                mcpConfig={mcpConfig}
                onMcpConfigChange={(cfg) => void handleMcpConfigChange(cfg)}
              />
            )}
            {activePage === "export" && <ExportSettings />}
            {activePage === "appearance" && <AppearanceSettings />}
            {activePage === "keyboard-shortcuts" && (
              <KeyboardShortcutsSettings onClose={onClose} />
            )}
            {activePage === "advanced" && <AdvancedSettings />}
          </div>
        </div>

        <div className="settings-footer">
          <div className="settings-footer-right">
            <button
              className="toolbar-button"
              onClick={() => {
                loggingService.logButtonClick("settings.close");
                onClose();
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
