import { createPlugin, type PluginConfig } from "../core/pluginTypes";

export type SpellCheckOptions = {
  language: string;
};

export const spellCheckPlugin = createPlugin<SpellCheckOptions>({
  name: "spell-check",
  displayName: "Spell Check (Stub)",
  supportedModes: ["codemirror"],
  priority: 5,
  defaultConfig: {
    enabled: false,
    options: {
      language: "en-US",
    },
  } as PluginConfig<SpellCheckOptions>,
  codemirrorExtension: () => [],
  init: (_context, config) => {
    console.info(
      `[mdpro] Spell check plugin stub enabled (language=${config.options?.language ?? "en-US"}). TODO: integrate dictionary backend.`,
    );
  },
});
