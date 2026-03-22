import type { Extension } from "@codemirror/state";
import type { EditorView as CodeMirrorView } from "@codemirror/view";
import type { EditorView as MilkdownView } from "@milkdown/kit/prose/view";
import type {
  EditorContext,
  EditorEventEmitter,
  EditorEventMap,
  EditorEventName,
  MdproPlugin,
  MdproPluginConfig,
  PluginConfig,
  PluginState,
} from "./pluginTypes";
import { defaultPluginConfig } from "./pluginConfig";

const PLUGIN_NAME_PATTERN = /^[a-z0-9-]+$/;

type PluginOptions = Record<string, unknown>;

type PluginRegistration = {
  plugin: MdproPlugin<PluginOptions>;
  config: PluginConfig<PluginOptions>;
  state: PluginState;
  registeredAt: number;
  error?: Error;
};

type EventHandlers = {
  [K in EditorEventName]: Set<(payload: EditorEventMap[K]) => void>;
};

const createEventEmitter = (): EditorEventEmitter => {
  const handlers: EventHandlers = {
    docChange: new Set(),
    selectionChange: new Set(),
    focusChange: new Set(),
  };

  return {
    on: (event, handler) => {
      const eventHandlers = handlers[event] as Set<
        (payload: EditorEventMap[typeof event]) => void
      >;
      eventHandlers.add(handler as (payload: EditorEventMap[typeof event]) => void);
      return () => {
        eventHandlers.delete(handler as (payload: EditorEventMap[typeof event]) => void);
      };
    },
    emit: (event, payload) => {
      const eventHandlers = handlers[event] as Set<
        (payload: EditorEventMap[typeof event]) => void
      >;
      eventHandlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[mdpro] Event handler for "${event}" threw:`, err);
        }
      });
    },
  };
};

const mergePluginConfig = <TOptions extends PluginOptions>(
  base: PluginConfig<TOptions>,
  override?: PluginConfig<TOptions>,
  explicit?: PluginConfig<TOptions>,
): PluginConfig<TOptions> => {
  const mergedOptions = {
    ...(base.options ?? {}),
    ...(override?.options ?? {}),
    ...(explicit?.options ?? {}),
  };

  return {
    ...base,
    ...override,
    ...explicit,
    options: Object.keys(mergedOptions).length
      ? (mergedOptions as TOptions)
      : base.options,
  };
};

const validatePluginName = (name: string) =>
  PLUGIN_NAME_PATTERN.test(name) && name.length > 0;

const validatePluginConfig = (name: string, config: PluginConfig) => {
  if (typeof config.enabled !== "boolean") {
    console.warn(
      `[mdpro] Plugin "${name}" has invalid config: enabled must be boolean`,
    );
  }
  if (config.priority !== undefined && typeof config.priority !== "number") {
    console.warn(
      `[mdpro] Plugin "${name}" has invalid config: priority must be number`,
    );
  }
  if (config.options !== undefined && typeof config.options !== "object") {
    console.warn(
      `[mdpro] Plugin "${name}" has invalid config: options must be object`,
    );
  }
};

export class PluginRegistry {
  private plugins = new Map<string, PluginRegistration>();
  private activePlugins = new Set<string>();
  private codemirrorView: CodeMirrorView | null = null;
  private milkdownView: MilkdownView | null = null;
  private currentMode: EditorContext["currentMode"] = "codemirror";
  private events = createEventEmitter();
  private config: MdproPluginConfig;
  private missingConfigReported = false;

  constructor(config: MdproPluginConfig = {}) {
    this.config = config;
  }

  register<TOptions extends PluginOptions = PluginOptions>(
    plugin: MdproPlugin<TOptions>,
    overrides?: PluginConfig<TOptions>,
  ) {
    if (!validatePluginName(plugin.name)) {
      console.error(
        `[mdpro] Plugin name "${plugin.name}" is invalid. Use lowercase letters, numbers, and hyphens.`,
      );
      return;
    }

    if (this.plugins.has(plugin.name)) {
      console.error(`[mdpro] Plugin "${plugin.name}" is already registered.`);
      return;
    }

    const baseConfig: PluginConfig<TOptions> = {
      priority: plugin.priority,
      options: {} as TOptions,
      ...plugin.defaultConfig,
    };

    const normalizedBaseConfig: PluginConfig<TOptions> = {
      ...baseConfig,
      enabled: baseConfig.enabled ?? true,
    };

    const mergedConfig = mergePluginConfig<TOptions>(
      normalizedBaseConfig,
      this.config[plugin.name] as PluginConfig<TOptions> | undefined,
      overrides,
    );

    validatePluginConfig(plugin.name, mergedConfig);

    this.plugins.set(plugin.name, {
      plugin: plugin as MdproPlugin<PluginOptions>,
      config: mergedConfig as PluginConfig<PluginOptions>,
      state: "pending",
      registeredAt: Date.now(),
    });
  }

  unregister(name: string) {
    const entry = this.plugins.get(name);
    if (!entry) return;

    if (this.activePlugins.has(name)) {
      this.safeDestroy(entry);
      this.activePlugins.delete(name);
    }

    this.plugins.delete(name);
  }

  initialize(context: {
    currentMode: EditorContext["currentMode"];
    codemirrorView?: CodeMirrorView | null;
    milkdownView?: MilkdownView | null;
  }) {
    if (!this.missingConfigReported) {
      this.reportMissingConfigEntries();
      this.missingConfigReported = true;
    }

    this.currentMode = context.currentMode;
    if (context.codemirrorView !== undefined) {
      this.codemirrorView = context.codemirrorView;
    }
    if (context.milkdownView !== undefined) {
      this.milkdownView = context.milkdownView;
    }

    const entries = this.getSortedPlugins();
    if (import.meta.env?.DEV) {
      const order = entries.map((entry) => entry.plugin.name).join(", ");
      console.log(`[mdpro] Plugin load order (${this.currentMode}): ${order}`);
    }

    entries.forEach((entry) => {
      const { plugin, config } = entry;
      if (!config.enabled) {
        entry.state = "inactive";
        return;
      }
      if (!plugin.supportedModes.includes(this.currentMode)) {
        entry.state = "inactive";
        return;
      }

      const contextSnapshot = this.getContext();
      try {
        plugin.init?.(contextSnapshot, config);
        entry.state = "active";
        this.activePlugins.add(plugin.name);
      } catch (error) {
        entry.state = "error";
        entry.error = error instanceof Error ? error : new Error(String(error));
        console.error(
          `[mdpro] Plugin "${plugin.name}" failed to initialize: ${entry.error.message}`,
        );
      }
    });
  }

  cleanup() {
    const entries = this.getSortedPlugins().reverse();
    entries.forEach((entry) => {
      if (entry.state === "active") {
        this.safeDestroy(entry);
      }
      entry.state = "pending";
    });

    this.activePlugins.clear();
    this.codemirrorView = null;
    this.milkdownView = null;
  }

  onModeChange(nextMode: EditorContext["currentMode"]) {
    this.currentMode = nextMode;

    this.plugins.forEach((entry) => {
      const { plugin, config } = entry;
      if (!config.enabled) {
        entry.state = "inactive";
        return;
      }

      const supportsMode = plugin.supportedModes.includes(nextMode);
      if (supportsMode && entry.state !== "active") {
        try {
          plugin.init?.(this.getContext(), config);
          entry.state = "active";
          this.activePlugins.add(plugin.name);
        } catch (error) {
          entry.state = "error";
          entry.error = error instanceof Error ? error : new Error(String(error));
          console.error(
            `[mdpro] Plugin "${plugin.name}" failed to initialize: ${entry.error.message}`,
          );
        }
        return;
      }

      if (!supportsMode && entry.state === "active") {
        this.safeDestroy(entry);
        entry.state = "inactive";
        this.activePlugins.delete(plugin.name);
      }
    });
  }

  getCodemirrorExtensions(): Extension[] {
    const context = this.getContext();
    const extensions: Extension[] = [];

    this.getSortedPlugins().forEach((entry) => {
      const { plugin, config } = entry;
      if (!config.enabled) return;
      if (!plugin.supportedModes.includes("codemirror")) return;
      if (!plugin.codemirrorExtension) return;

      try {
        const result = plugin.codemirrorExtension(config, context);
        if (Array.isArray(result)) {
          extensions.push(...result);
        } else if (result) {
          extensions.push(result);
        }
      } catch (error) {
        console.error(
          `[mdpro] Plugin "${plugin.name}" codemirrorExtension threw: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    return extensions;
  }

  getMilkdownPlugins(): unknown[] {
    const context = this.getContext();
    const plugins: unknown[] = [];

    this.getSortedPlugins().forEach((entry) => {
      const { plugin, config } = entry;
      if (!config.enabled) return;
      if (!plugin.supportedModes.includes("milkdown")) return;
      if (!plugin.milkdownPlugin) return;

      try {
        const result = plugin.milkdownPlugin(config, context);
        if (result) plugins.push(result);
      } catch (error) {
        console.error(
          `[mdpro] Plugin "${plugin.name}" milkdownPlugin threw: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    return plugins;
  }

  isPluginActive(name: string) {
    const entry = this.plugins.get(name);
    if (!entry) return false;
    return entry.config.enabled && entry.state === "active";
  }

  setPluginEnabled(name: string, enabled: boolean) {
    const entry = this.plugins.get(name);
    if (!entry) return;

    entry.config = {
      ...entry.config,
      enabled,
    };

    if (!enabled && entry.state === "active") {
      this.safeDestroy(entry);
      entry.state = "inactive";
      this.activePlugins.delete(name);
      return;
    }

    if (enabled && entry.state !== "active") {
      this.safeInit(entry);
    }
  }

  updatePluginConfig(name: string, updates: PluginConfig, reload = true) {
    const entry = this.plugins.get(name);
    if (!entry) return;

    entry.config = mergePluginConfig(entry.config, updates);
    validatePluginConfig(name, entry.config);

    if (reload && entry.state === "active") {
      this.safeDestroy(entry);
      this.safeInit(entry);
    }
  }

  setCodemirrorView(view: CodeMirrorView | null) {
    this.codemirrorView = view;
  }

  setMilkdownView(view: MilkdownView | null) {
    this.milkdownView = view;
  }

  getContext(): EditorContext {
    return {
      currentMode: this.currentMode,
      codemirror: {
        getView: () => this.codemirrorView,
        getState: () => this.codemirrorView?.state ?? null,
        dispatch: (transaction) => {
          if (this.codemirrorView) {
            this.codemirrorView.dispatch(transaction);
          }
        },
      },
      milkdown: {
        getView: () => this.milkdownView,
        getState: () => this.milkdownView?.state ?? null,
        dispatch: (transaction) => {
          if (this.milkdownView) {
            this.milkdownView.dispatch(transaction);
          }
        },
      },
      events: this.events,
    };
  }

  emitEvent<TEvent extends EditorEventName>(
    event: TEvent,
    payload: EditorEventMap[TEvent],
  ) {
    this.events.emit(event, payload);
  }

  private safeInit(entry: PluginRegistration) {
    const { plugin, config } = entry;
    if (!config.enabled || !plugin.supportedModes.includes(this.currentMode)) {
      entry.state = "inactive";
      return;
    }

    try {
      plugin.init?.(this.getContext(), config);
      entry.state = "active";
      this.activePlugins.add(plugin.name);
    } catch (error) {
      entry.state = "error";
      entry.error = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[mdpro] Plugin "${plugin.name}" failed to initialize: ${entry.error.message}`,
      );
    }
  }

  private safeDestroy(entry: PluginRegistration) {
    try {
      entry.plugin.destroy?.(this.getContext(), entry.config);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `[mdpro] Plugin "${entry.plugin.name}" failed to cleanup: ${errorMessage}`,
      );
    }
  }

  private getSortedPlugins() {
    return Array.from(this.plugins.values()).sort((a, b) => {
      const priorityA = a.config.priority ?? a.plugin.priority ?? 0;
      const priorityB = b.config.priority ?? b.plugin.priority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;
      return a.registeredAt - b.registeredAt;
    });
  }

  private reportMissingConfigEntries() {
    const registered = new Set(this.plugins.keys());
    Object.keys(this.config).forEach((name) => {
      if (!registered.has(name)) {
        console.error(
          `[mdpro] Plugin config references missing plugin "${name}"`,
        );
      }
    });
  }
}

export const pluginRegistry = new PluginRegistry(defaultPluginConfig);
