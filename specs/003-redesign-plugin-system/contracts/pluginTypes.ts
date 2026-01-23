/**
 * Plugin System Type Contracts
 *
 * This file defines the TypeScript interfaces for the mdpro plugin system.
 * These are CONTRACT DEFINITIONS for planning - actual implementation may vary.
 *
 * Feature: 003-redesign-plugin-system
 * Date: 2025-01-21
 */

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Editor } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/utils";
import type { StoreApi } from "zustand";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Editor modes supported by the plugin system
 */
export type EditorMode = "codemirror" | "milkdown";

/**
 * Plugin runtime state
 */
export type PluginState = "pending" | "active" | "inactive" | "error";

// ============================================================================
// Plugin Definition
// ============================================================================

/**
 * Base plugin configuration
 */
export interface PluginConfig {
  /** Whether the plugin is enabled (default: true) */
  enabled: boolean;
  /** Override default priority (higher = loads first) */
  priority?: number;
  /** Plugin-specific options */
  options?: Record<string, unknown>;
}

/**
 * Shared context provided to plugins during initialization
 */
export interface EditorContext {
  /** CodeMirror editor view (null if in Milkdown mode) */
  codemirrorView: EditorView | null;
  /** Milkdown editor instance (null if in CodeMirror mode) */
  milkdownEditor: Editor | null;
  /** Current active editor mode */
  currentMode: EditorMode;
  /** Execute a registered command by name */
  dispatchCommand: (commandName: string, args?: unknown) => void;
  /** Access a Zustand store */
  getStore: <T>(store: StoreApi<T>) => T;
}

/**
 * Main plugin interface - all plugins must implement this
 */
export interface MdproPlugin<TConfig extends PluginConfig = PluginConfig> {
  /** Unique identifier (lowercase, alphanumeric, hyphens) */
  readonly name: string;

  /** Human-readable name for logging/debugging */
  readonly displayName: string;

  /** Which editor modes this plugin supports */
  readonly supportedModes: EditorMode[];

  /** Loading priority (higher = loads first, default: 50) */
  readonly priority: number;

  /** Default configuration for this plugin */
  readonly defaultConfig: TConfig;

  /**
   * Factory function returning CodeMirror extension(s)
   * Called when editor mode is 'codemirror' and plugin is enabled
   * @returns Extension or array of Extensions
   */
  codemirrorExtension?: (config: TConfig) => Extension | Extension[];

  /**
   * Factory function returning Milkdown plugin
   * Called when editor mode is 'milkdown' and plugin is enabled
   * @returns Milkdown plugin created with $prose() or similar
   */
  milkdownPlugin?: (config: TConfig) => MilkdownPlugin;

  /**
   * Lifecycle hook called when editor mounts
   * @param context Shared editor context
   */
  init?: (context: EditorContext, config: TConfig) => void;

  /**
   * Lifecycle hook called when editor unmounts
   * Perform cleanup here (remove event listeners, etc.)
   */
  destroy?: () => void;
}

// ============================================================================
// Plugin Registry
// ============================================================================

/**
 * Runtime state for a registered plugin
 */
export interface RegisteredPlugin<TConfig extends PluginConfig = PluginConfig> {
  /** The plugin definition */
  plugin: MdproPlugin<TConfig>;
  /** Current runtime state */
  state: PluginState;
  /** Error if initialization failed */
  error: Error | null;
  /** User configuration overrides */
  configOverrides: Partial<TConfig>;
  /** Resolved configuration (defaults + overrides) */
  resolvedConfig: TConfig;
}

/**
 * Global plugin configuration (all plugins)
 */
export interface MdproPluginConfig {
  [pluginName: string]: Partial<PluginConfig> | undefined;
}

/**
 * Plugin registry interface
 */
export interface PluginRegistry {
  /** All registered plugins by name */
  readonly plugins: ReadonlyMap<string, RegisteredPlugin>;

  /** Currently active plugin names */
  readonly activePlugins: ReadonlySet<string>;

  /** Current editor context */
  readonly editorContext: EditorContext | null;

  /**
   * Register a plugin with the registry
   * @param plugin Plugin definition
   * @param configOverrides Optional configuration overrides
   */
  register<TConfig extends PluginConfig>(
    plugin: MdproPlugin<TConfig>,
    configOverrides?: Partial<TConfig>
  ): void;

  /**
   * Unregister a plugin by name
   * @param pluginName Plugin name to remove
   */
  unregister(pluginName: string): void;

  /**
   * Initialize the registry with editor context
   * Called when editor mounts
   * @param context Editor context
   */
  initialize(context: EditorContext): void;

  /**
   * Cleanup all plugins
   * Called when editor unmounts
   */
  cleanup(): void;

  /**
   * Get all CodeMirror extensions from enabled plugins
   * @returns Array of Extensions
   */
  getCodemirrorExtensions(): Extension[];

  /**
   * Get all Milkdown plugins from enabled plugins
   * @returns Array of MilkdownPlugins
   */
  getMilkdownPlugins(): MilkdownPlugin[];

  /**
   * Handle editor mode change
   * @param newMode New editor mode
   */
  onModeChange(newMode: EditorMode): void;

  /**
   * Check if a plugin is enabled and active
   * @param pluginName Plugin name
   */
  isPluginActive(pluginName: string): boolean;

  /**
   * Enable or disable a plugin at runtime
   * @param pluginName Plugin name
   * @param enabled Whether to enable
   */
  setPluginEnabled(pluginName: string, enabled: boolean): void;

  /**
   * Update plugin configuration
   * @param pluginName Plugin name
   * @param config Partial config to merge
   */
  updatePluginConfig(pluginName: string, config: Partial<PluginConfig>): void;
}

// ============================================================================
// Plugin Factory Helpers
// ============================================================================

/**
 * Options for creating a plugin
 */
export interface CreatePluginOptions<TConfig extends PluginConfig> {
  name: string;
  displayName: string;
  supportedModes: EditorMode[];
  priority?: number;
  defaultConfig: TConfig;
  codemirrorExtension?: (config: TConfig) => Extension | Extension[];
  milkdownPlugin?: (config: TConfig) => MilkdownPlugin;
  init?: (context: EditorContext, config: TConfig) => void;
  destroy?: () => void;
}

/**
 * Helper function to create a plugin with type safety
 * @param options Plugin options
 * @returns Plugin definition
 */
export function createPlugin<TConfig extends PluginConfig>(
  options: CreatePluginOptions<TConfig>
): MdproPlugin<TConfig> {
  return {
    name: options.name,
    displayName: options.displayName,
    supportedModes: options.supportedModes,
    priority: options.priority ?? 50,
    defaultConfig: options.defaultConfig,
    codemirrorExtension: options.codemirrorExtension,
    milkdownPlugin: options.milkdownPlugin,
    init: options.init,
    destroy: options.destroy,
  };
}
