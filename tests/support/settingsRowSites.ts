/**
 * WI-4.3a: every settings panel with rows, every row's title and control role,
 * and every replaced checkbox site with the preference write it must still make.
 *
 * The suites own `vi.mock("@tauri-apps/api/core")`; this module renders the
 * panels against spies on the service boundary (`preferencesService`,
 * `loggingService.setLoggingSettings`, `mcpService`) and reads what they were
 * asked to write.
 */
import { vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement, useState, type ComponentType } from "react";
import { AdvancedSettings } from "../../src/components/common/settings/AdvancedSettings";
import { AppearanceSettings } from "../../src/components/common/settings/AppearanceSettings";
import { EditorSettings } from "../../src/components/common/settings/EditorSettings";
import { ExportSettings } from "../../src/components/common/settings/ExportSettings";
import { GeneralSettings } from "../../src/components/common/settings/GeneralSettings";
import { ImageSettings } from "../../src/components/common/settings/ImageSettings";
import { MarkdownSettings } from "../../src/components/common/settings/MarkdownSettings";
import { IntegrationsSettings } from "../../src/components/common/IntegrationsSettings";
import type { McpWriteLease } from "../../src/hooks/useMcpServerSwitch";
import { loggingService } from "../../src/services/loggingService";
import { mcpService, type McpStatus } from "../../src/services/mcpService";
import { preferencesService } from "../../src/services/preferencesService";
import { useLoggingStore } from "../../src/stores/loggingStore";
import type { McpConfig, UserPreferences } from "../../src/types/preferences";
import { makePreferences } from "./preferenceFixtures";

export type PanelId =
  | "general" | "editor" | "markdown" | "image" | "export" | "appearance" | "advanced" | "integrations";

/** The loaded preferences every panel starts from; every boolean is false. */
export const LOADED: UserPreferences = (() => {
  const p = makePreferences();
  p.editor = { ...p.editor, wordWrap: false };
  p.markdown = { ...p.markdown, autoPair: false, autoReformatTablesOnSave: false };
  p.image = { ...p.image, copyExternalImages: false };
  p.export = { ...p.export, htmlIncludeStyles: false };
  return p;
})();

export const MCP_LOADED: McpConfig = {
  ...LOADED.mcp,
  serverEnabled: false,
  startOnLaunch: false,
  autoApproveEdits: false,
};

const STATUS: McpStatus = {
  running: false, port: null, binaryPath: "/bin/mdpro_mcp", phase: "disabled", error: null, configured: "disabled",
};

/** Every write the boundary was asked to make since `installBoundary`. */
export interface Boundary {
  setPreferences: ReturnType<typeof vi.fn>;
  setLoggingSettings: ReturnType<typeof vi.fn>;
  setServerEnabled: ReturnType<typeof vi.fn>;
  onMcpConfigChange: ReturnType<typeof vi.fn>;
}

export function installBoundary(): Boundary {
  vi.spyOn(preferencesService, "getPreferences").mockImplementation(async () => structuredClone(LOADED));
  const setPreferences = vi.fn(async (p: Partial<UserPreferences>) => ({ ...LOADED, ...p }));
  vi.spyOn(preferencesService, "setPreferences").mockImplementation(setPreferences);
  const setLoggingSettings = vi.fn(async (s: { enabled: boolean; level: string }) => s);
  vi.spyOn(loggingService, "setLoggingSettings").mockImplementation(setLoggingSettings as never);
  vi.spyOn(mcpService, "getStatus").mockResolvedValue(STATUS);
  vi.spyOn(mcpService, "getInstallations").mockResolvedValue([]);
  const setServerEnabled = vi.fn(async (enabled: boolean): Promise<McpStatus> => ({
    ...STATUS, running: enabled, phase: enabled ? "running" : "disabled", configured: enabled ? "enabled" : "disabled",
  }));
  vi.spyOn(mcpService, "setServerEnabled").mockImplementation(setServerEnabled);
  useLoggingStore.setState({ enabled: false, level: "info" });
  return { setPreferences, setLoggingSettings, setServerEnabled, onMcpConfigChange: vi.fn(async () => undefined) };
}

function lease(): McpWriteLease {
  return { previous: MCP_LOADED, setConfig: () => {}, isCurrent: () => true, release: () => {} };
}

type IntegrationsProps = Parameters<typeof IntegrationsSettings>[0];

/**
 * Holds `mcpConfig` the way `SettingsDialog` does: a lease's `setConfig` and a
 * settled `onMcpConfigChange` both become the value shown, so a switch reads
 * back what it wrote.
 */
function McpOwner(props: IntegrationsProps) {
  const [config, setConfig] = useState<McpConfig | null>(props.mcpConfig);
  return createElement(IntegrationsSettings, {
    ...props,
    mcpConfig: config,
    onMcpConfigChange: async (next: McpConfig) => {
      await props.onMcpConfigChange(next);
      setConfig(next);
    },
    beginMcpWrite: () => {
      const granted = props.beginMcpWrite();
      return granted && { ...granted, previous: config ?? granted.previous, setConfig };
    },
  });
}

const PANELS: Record<Exclude<PanelId, "integrations">, ComponentType> = {
  general: GeneralSettings,
  editor: EditorSettings,
  markdown: MarkdownSettings,
  image: ImageSettings,
  export: ExportSettings,
  appearance: AppearanceSettings,
  advanced: AdvancedSettings,
};

/** Render one panel and wait until its first row title is on screen. */
export async function renderPanel(id: PanelId, boundary: Boundary, firstTitle: string) {
  const view = id === "integrations"
    ? render(createElement(McpOwner, {
      mcpConfig: MCP_LOADED,
      mcpConfigFailed: false,
      mcpSaving: false,
      onMcpConfigChange: boundary.onMcpConfigChange,
      beginMcpWrite: lease,
    }))
    : render(createElement(PANELS[id]));
  await screen.findByRole("heading", { level: 4, name: firstTitle });
  return view;
}

/** Every settings row, its title and the role its control takes the title as its name. */
export const ROWS: readonly { panel: PanelId; title: string; role: string }[] = [
  { panel: "general", title: "Default View Mode", role: "combobox" },
  { panel: "general", title: "Auto-save Interval", role: "combobox" },
  { panel: "editor", title: "Font Family", role: "combobox" },
  { panel: "editor", title: "Font Size", role: "group" },
  { panel: "editor", title: "Line Height", role: "combobox" },
  { panel: "editor", title: "Content Width", role: "combobox" },
  { panel: "editor", title: "Tab Size", role: "combobox" },
  { panel: "editor", title: "Word Wrap", role: "switch" },
  { panel: "markdown", title: "Auto-pair Brackets & Quotes", role: "switch" },
  { panel: "markdown", title: "Auto-Reformat Tables on Save", role: "switch" },
  { panel: "image", title: "Image Folder", role: "textbox" },
  { panel: "image", title: "Copy Images to Folder on Paste", role: "switch" },
  { panel: "export", title: "Default Export Folder", role: "textbox" },
  { panel: "export", title: "Include Styles in HTML Export", role: "switch" },
  { panel: "appearance", title: "Code Block Theme", role: "combobox" },
  { panel: "advanced", title: "Enable Logging", role: "switch" },
  { panel: "advanced", title: "Log Level", role: "combobox" },
  { panel: "integrations", title: "Enable MCP Server", role: "switch" },
  { panel: "integrations", title: "Start on launch", role: "switch" },
  { panel: "integrations", title: "Auto-approve edits", role: "switch" },
];

export const PANEL_IDS: readonly PanelId[] = [...new Set(ROWS.map((r) => r.panel))];

export function firstTitle(panel: PanelId): string {
  const row = ROWS.find((r) => r.panel === panel);
  if (!row) throw new Error(`no rows for ${panel}`);
  return row.title;
}

/**
 * Every checkbox the switch replaced, and the write it made before WI-4.3a:
 * turning it on from the all-false fixture. `write` reads that call back off
 * the boundary; `expected` is the call the old checkbox made.
 */
export const SWITCH_SITES: readonly {
  panel: PanelId;
  title: string;
  write: (b: Boundary) => unknown[][];
  expected: unknown[];
}[] = [
  { panel: "editor", title: "Word Wrap", write: (b) => b.setPreferences.mock.calls,
    expected: [{ editor: { ...LOADED.editor, wordWrap: true } }] },
  { panel: "markdown", title: "Auto-pair Brackets & Quotes", write: (b) => b.setPreferences.mock.calls,
    expected: [{ markdown: { ...LOADED.markdown, autoPair: true } }] },
  { panel: "markdown", title: "Auto-Reformat Tables on Save", write: (b) => b.setPreferences.mock.calls,
    expected: [{ markdown: { ...LOADED.markdown, autoReformatTablesOnSave: true } }] },
  { panel: "image", title: "Copy Images to Folder on Paste", write: (b) => b.setPreferences.mock.calls,
    expected: [{ image: { ...LOADED.image, copyExternalImages: true } }] },
  { panel: "export", title: "Include Styles in HTML Export", write: (b) => b.setPreferences.mock.calls,
    expected: [{ export: { ...LOADED.export, htmlIncludeStyles: true } }] },
  { panel: "advanced", title: "Enable Logging", write: (b) => b.setLoggingSettings.mock.calls,
    expected: [{ enabled: true, level: "info" }] },
  { panel: "integrations", title: "Enable MCP Server", write: (b) => b.setServerEnabled.mock.calls,
    expected: [true] },
  { panel: "integrations", title: "Start on launch", write: (b) => b.onMcpConfigChange.mock.calls,
    expected: [{ ...MCP_LOADED, startOnLaunch: true }] },
  { panel: "integrations", title: "Auto-approve edits", write: (b) => b.onMcpConfigChange.mock.calls,
    expected: [{ ...MCP_LOADED, autoApproveEdits: true }] },
];
