/**
 * SettingsDialog Component
 *
 * Purpose: the Settings modal — category navigation, focus trap, and the
 * per-open MCP config (`mcp` preferences group) for the Integrations page.
 *
 * Key decisions:
 * - Every open starts with the MCP config unloaded and bumps a generation;
 *   anything settling from an earlier open is dropped (F3, MCP-FIX-C1).
 * - One MCP write at a time: `beginMcpWrite` grants a lease used both by the
 *   whole-group `setPreferences` writes and by the live server switch
 *   (ADR-0040, `useMcpServerSwitch`).
 * - Every open lands on General, reset during render: the dialog stays mounted
 *   while closed, and a stale About would mount and re-run its check (D166).
 *
 * @coordinates-with src/components/common/IntegrationsSettings.tsx — consumes mcpConfig and the lease
 * @coordinates-with src/hooks/useMcpServerSwitch.ts — McpWriteLease contract
 * @module components/common/SettingsDialog
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useThemeStore } from "../../stores/themeStore";
import { loggingService } from "../../services/loggingService";
import { preferencesService } from "../../services/preferencesService";
import type { McpConfig } from "../../types/preferences";
import type { McpWriteLease } from "../../hooks/useMcpServerSwitch";
import { IntegrationsSettings } from "./IntegrationsSettings";
import { GeneralSettings } from "./settings/GeneralSettings";
import { EditorSettings } from "./settings/EditorSettings";
import { MarkdownSettings } from "./settings/MarkdownSettings";
import { ImageSettings } from "./settings/ImageSettings";
import { ExportSettings } from "./settings/ExportSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { AdvancedSettings } from "./settings/AdvancedSettings";
import { KeyboardShortcutsSettings } from "./settings/KeyboardShortcutsSettings";
import { AboutSettings } from "./settings/AboutSettings";

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
  { id: "about", label: "About", icon: "ℹ️" },
];

const MCP_LOAD_EVENT = "ui.settings.mcp.load";
const MCP_SAVE_EVENT = "ui.settings.mcp.save";

/** Enum-only log for an MCP write that was refused or failed. */
function logMcpSave(status: "cancel" | "fail", context: Record<string, string>): void {
  loggingService.logEventSync({
    level: status === "fail" ? "warn" : "info",
    event: MCP_SAVE_EVENT,
    status,
    actionId: loggingService.generateActionId(),
    context,
  });
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [activePage, setActivePage] = useState("general");
  const [seenOpen, setSeenOpen] = useState(open);
  // Reset before any page mounts; the open effect ran one render late (D166).
  if (seenOpen !== open) { setSeenOpen(open); if (open) setActivePage("general"); }
  // The `mcp` group loaded in THIS open; null until it loads (F3, ADR-0039).
  // Never seeded from the default config: the backend replaces the group
  // wholesale, so a pre-hydration toggle would write defaults over disk.
  const [mcpConfig, setMcpConfig] = useState<McpConfig | null>(null);
  const [mcpLoadFailed, setMcpLoadFailed] = useState(false);
  const mcpLoadGenRef = useRef(0);
  // One MCP write at a time — the settings writes here and the live server
  // switch (ADR-0040, via `beginMcpWrite`) (MCP-FIX-C1); the ref is the synchronous guard.
  const [mcpSaving, setMcpSaving] = useState(false);
  const mcpSavingRef = useRef(false);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const firstNavRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save and restore focus on open/close
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setTimeout(() => firstNavRef.current?.focus(), 50);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [open]);

  // Focus trap: keep keyboard focus inside the dialog while it is open
  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      loggingService.logDialogAction("settings.dialog.escape", "cancel");
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onClose]);

  // Load MCP config for integrations page. Every open starts unhydrated (D-5)
  // and bumps the generation; any reply, rollback, or write completion from an
  // earlier open is dropped by the `gen` check (MCP-FIX-C1).
  useEffect(() => {
    if (!open) return;
    const gen = ++mcpLoadGenRef.current;
    mcpSavingRef.current = false;
    setMcpConfig(null);
    setMcpLoadFailed(false);
    setMcpSaving(false);
    void preferencesService.getPreferences("settings_dialog")
      .then((p) => {
        if (gen !== mcpLoadGenRef.current) return;
        if (p.mcp) setMcpConfig(p.mcp);
        else setMcpLoadFailed(true);
      })
      .catch(() => {
        if (gen !== mcpLoadGenRef.current) return;
        setMcpLoadFailed(true);
        // Enum-only: the rejection text can carry filesystem paths.
        loggingService.logEventSync({
          level: "error",
          event: MCP_LOAD_EVENT,
          status: "fail",
          actionId: loggingService.generateActionId(),
          context: { reason: "invoke_rejected" },
        });
      });
  }, [open]);

  /**
   * Grant the one MCP write allowed at a time, or `null` (logged as a cancel).
   * Not hydrated: writing now would replace the stored group (F3). A write
   * already in flight: a second one could be rolled back under the first.
   * Every lease method is a no-op once a later open bumped the generation.
   */
  const beginMcpWrite = (): McpWriteLease | null => {
    const prev = mcpConfig;
    if (prev === null || mcpSavingRef.current) {
      logMcpSave("cancel", { reason: prev === null ? "not_loaded" : "write_pending" });
      return null;
    }
    const gen = mcpLoadGenRef.current;
    const isCurrent = () => gen === mcpLoadGenRef.current;
    mcpSavingRef.current = true;
    setMcpSaving(true);
    return {
      previous: prev,
      isCurrent,
      setConfig: (config) => {
        if (isCurrent()) setMcpConfig(config);
      },
      release: () => {
        if (!isCurrent()) return;
        mcpSavingRef.current = false;
        setMcpSaving(false);
      },
    };
  };

  /** `startOnLaunch` / `autoApproveEdits`: optimistic whole-group write, rolled back on failure. */
  const handleMcpConfigChange = async (config: McpConfig) => {
    const lease = beginMcpWrite();
    if (lease === null) return;
    lease.setConfig(config);
    try {
      await preferencesService.setPreferences({ mcp: config });
    } catch {
      lease.setConfig(lease.previous);
      logMcpSave("fail", { rollback: lease.isCurrent() ? "applied" : "skipped_stale_open" });
    } finally {
      lease.release();
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
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className={`settings-dialog theme-${resolvedTheme}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
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
                mcpConfigFailed={mcpLoadFailed}
                mcpSaving={mcpSaving}
                onMcpConfigChange={handleMcpConfigChange}
                beginMcpWrite={beginMcpWrite}
              />
            )}
            {activePage === "export" && <ExportSettings />}
            {activePage === "appearance" && <AppearanceSettings />}
            {activePage === "keyboard-shortcuts" && (
              <KeyboardShortcutsSettings onClose={onClose} />
            )}
            {activePage === "advanced" && <AdvancedSettings />}
            {activePage === "about" && <AboutSettings />}
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
