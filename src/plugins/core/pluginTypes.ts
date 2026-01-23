import type { Extension, Transaction, TransactionSpec, EditorState as CodeMirrorState } from "@codemirror/state";
import type { EditorView as CodeMirrorView } from "@codemirror/view";
import type { EditorView as MilkdownView } from "@milkdown/kit/prose/view";
import type { EditorState as MilkdownState, Transaction as MilkdownTransaction } from "@milkdown/kit/prose/state";

export type EditorMode = "codemirror" | "milkdown";

export type PluginState = "pending" | "active" | "inactive" | "error";

export interface PluginConfig<TOptions extends Record<string, unknown> = Record<string, unknown>> {
  enabled: boolean;
  priority?: number;
  options?: TOptions;
}

export interface EditorEventMap {
  docChange: {
    mode: EditorMode;
  };
  selectionChange: {
    mode: EditorMode;
  };
  focusChange: {
    mode: EditorMode;
    focused: boolean;
  };
}

export type EditorEventName = keyof EditorEventMap;

export type EditorEventHandler<TEvent extends EditorEventName> = (
  payload: EditorEventMap[TEvent],
) => void;

export interface EditorEventEmitter {
  on: <TEvent extends EditorEventName>(
    event: TEvent,
    handler: EditorEventHandler<TEvent>,
  ) => () => void;
  emit: <TEvent extends EditorEventName>(
    event: TEvent,
    payload: EditorEventMap[TEvent],
  ) => void;
}

export interface EditorApi<TView, TState, TTransaction> {
  getView: () => TView | null;
  getState: () => TState | null;
  dispatch: (transaction: TTransaction) => void;
}

export interface EditorContext {
  currentMode: EditorMode;
  codemirror: EditorApi<
    CodeMirrorView,
    CodeMirrorState,
    Transaction | TransactionSpec
  >;
  milkdown: EditorApi<MilkdownView, MilkdownState, MilkdownTransaction>;
  events: EditorEventEmitter;
}

export interface MdproPlugin<TOptions extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  displayName: string;
  supportedModes: EditorMode[];
  priority: number;
  defaultConfig: PluginConfig<TOptions>;
  codemirrorExtension?: (
    config: PluginConfig<TOptions>,
    context: EditorContext,
  ) => Extension | Extension[];
  milkdownPlugin?: (
    config: PluginConfig<TOptions>,
    context: EditorContext,
  ) => unknown;
  init?: (context: EditorContext, config: PluginConfig<TOptions>) => void;
  destroy?: (context: EditorContext, config: PluginConfig<TOptions>) => void;
}

export type MdproPluginConfig = Record<string, PluginConfig>;

export const createPlugin = <
  TOptions extends Record<string, unknown> = Record<string, unknown>,
>(
  plugin: MdproPlugin<TOptions>,
) => plugin;
