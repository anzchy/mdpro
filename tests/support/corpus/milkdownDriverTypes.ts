/** Internal Milkdown runtime stays behind the engine-neutral CorpusDriver contract. */
import type { Editor } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { ViewMode } from './types.ts';
export interface MilkdownDriverRuntime {
  caseId: string;
  editor(): Editor;
  view(): EditorView;
  modeSwitch(to: ViewMode): Promise<void>;
  mode(): ViewMode;
}
