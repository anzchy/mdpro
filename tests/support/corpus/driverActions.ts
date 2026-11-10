/** Execute corpus actions through production commands and the live clipboard pipeline. */
import { commandsCtx } from '@milkdown/kit/core';
import { toggleInlineCodeCommand, wrapInBulletListCommand, wrapInOrderedListCommand } from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { closeHistory, undo } from '@milkdown/kit/prose/history';
import { TextSelection } from '@milkdown/kit/prose/state';
import { CellSelection } from '@milkdown/kit/prose/tables';
import { makeBoldCommand, makeItalicCommand } from '../../../src/plugins/milkdown/typoraCommandFactories';
import { clearFormatCommand, underlineCommand } from '../../../src/plugins/milkdown/wysiwygFormatCommands';
import { milkdownHighlightCommand } from '../../../src/plugins/milkdown/milkdownHighlightCommand';
import { convertListKind } from '../../../src/plugins/milkdown/listKindCommand';
import { dispatchTableActionFromKeyboard } from '../../../src/plugins/milkdown/table/contextMenu';
import { openFind, replaceFind, setFindOptions, setFindQuery } from '../../../src/plugins/milkdown/find/findPlugin';
import type { Caret, CorpusAction, TextSelection as TextAnchor } from './types.ts';
import type { MilkdownDriverRuntime } from './milkdownDriverTypes.ts';
import { resolveCellAnchor, resolveCellRange, resolveTextAnchor } from './driverAnchors.ts';
import { actionErrors } from './metadataActions.ts';

function selectText(runtime: MilkdownDriverRuntime, anchor: TextAnchor, caret = false): void {
  const { from, to } = resolveTextAnchor(runtime, anchor, caret);
  const view = runtime.view();
  const start = caret ? (anchor as Caret).edge === 'before' ? from : to : from;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, caret ? start : to)).setMeta('addToHistory', false));
}
function paste(runtime: MilkdownDriverRuntime, action: Extract<CorpusAction, { kind: 'paste' }>): void {
  const view = runtime.view();
  if ('cells' in action.at) {
    const { from, to } = resolveCellRange(runtime, action.at);
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, from, to)).setMeta('addToHistory', false));
  } else selectText(runtime, action.at, true);
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    getData: (kind: string) => kind === 'text/html' ? action.html ?? '' : kind === 'text/plain' ? action.text ?? '' : '',
    types: [...(action.html === undefined ? [] : ['text/html']), ...(action.text === undefined ? [] : ['text/plain'])],
    files: [], items: [],
  } });
  view.dom.dispatchEvent(event);
}
/** Validate anchors first, then isolate each mutating action as one production history step. */
export async function runDriverAction(runtime: MilkdownDriverRuntime, action: CorpusAction): Promise<void> {
  const errors = actionErrors(action);
  if (errors.length) throw new Error(`${runtime.caseId}: anchor/action ${errors.join(', ')}`);
  if (action.kind === 'modeSwitch') { await runtime.modeSwitch(action.to); return; }
  if (action.kind === 'activateLink') throw new Error(`${runtime.caseId}: activateLink must use the driver click observer`);
  const view = runtime.view(), dispatch = (tr: Parameters<typeof view.dispatch>[0]) => view.dispatch(tr);
  const preset = (key: typeof toggleInlineCodeCommand.key) => runtime.editor().action(ctx => ctx.get(commandsCtx).call(key));
  switch (action.kind) {
    case 'type':
      selectText(runtime, action.at, true);
      view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
      for (const [index, part] of action.text.split('\n').entries()) {
        if (index) {
          const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
          view.dom.dispatchEvent(enter);
          if (!enter.defaultPrevented) throw new Error(`${runtime.caseId}: production Enter command declined`);
        }
        if (part) view.dispatch(view.state.tr.insertText(part));
      }
      break;
    case 'delete':
      selectText(runtime, action.range); view.dispatch(closeHistory(view.state.tr).deleteSelection()); break;
    case 'toggleMark': {
      selectText(runtime, action.range);
      view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
      switch (action.mark) {
        case 'strong': makeBoldCommand()(view.state, dispatch, view); break;
        case 'emphasis': makeItalicCommand()(view.state, dispatch, view); break;
        case 'code': preset(toggleInlineCodeCommand.key); break;
        case 'strike': preset(toggleStrikethroughCommand.key); break;
        case 'highlight': milkdownHighlightCommand(view); break;
        case 'underline': underlineCommand()(view.state, dispatch, view); break;
      }
      break;
    }
    case 'clearFormat':
      selectText(runtime, action.range); view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
      clearFormatCommand()(view.state, dispatch, view); break;
    case 'setListKind': {
      selectText(runtime, action.at, true);
      const kind = action.to === 'bullet' ? 'bullet_list' : 'ordered_list';
      if (convertListKind(view.state, dispatch, kind) === null) preset(kind === 'bullet_list' ? wrapInBulletListCommand.key : wrapInOrderedListCommand.key);
      break;
    }
    case 'paste': paste(runtime, action); break;
    case 'undo': undo(view.state, dispatch); return;
    case 'insertTableRow': case 'insertTableColumn': {
      const pos = resolveCellAnchor(runtime, action.at);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))).setMeta('addToHistory', false));
      const id = action.kind === 'insertTableRow'
        ? action.side === 'above' ? 'insert_row_before' : 'insert_row_after'
        : action.side === 'left' ? 'insert_column_before' : 'insert_column_after';
      if (!dispatchTableActionFromKeyboard(runtime.editor(), id)) throw new Error(`${runtime.caseId}: table action refused`);
      break;
    }
    case 'find': case 'replace':
      openFind(view, action.kind === 'replace');
      setFindQuery(view, action.query);
      setFindOptions(view, { caseSensitive: action.caseSensitive, wholeWord: action.wholeWord });
      if (action.kind === 'replace') replaceFind(view, action.with, action.all);
      return;
    default: { const exhaustive: never = action; throw new Error(`${runtime.caseId}: unsupported action ${String(exhaustive)}`); }
  }
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
}
