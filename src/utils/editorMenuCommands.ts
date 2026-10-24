/**
 * Purpose: run M3b editor menu commands on the currently mounted editor.
 * Exact ID, route and mode availability are checked by editorMenuActionTable;
 * this module performs the real command and reports an effect or refusal.
 * Opposite-kind lists convert their containing list in one undo step.
 *
 * @coordinates-with ../hooks/editorMenuActionTable.ts
 * @coordinates-with editorMenuSourceCommands.ts
 */
import { commandsCtx, editorViewCtx, type Editor } from "@milkdown/kit/core";
import {
  createCodeBlockCommand,
  liftListItemCommand,
  sinkListItemCommand,
  toggleInlineCodeCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type { Command, Selection } from "@milkdown/kit/prose/state";
import { Selection as ProseSelection } from "@milkdown/kit/prose/state";
import type { EditorView as MilkdownView } from "@milkdown/kit/prose/view";
import { milkdownHighlightCommand } from "../plugins/milkdown/milkdownHighlightCommand";
import { getFindState, moveFind, openFind } from "../plugins/milkdown/find/findPlugin";
import { makeCodeBlockIndentCommand } from "../plugins/milkdown/codeBlockIndentCommand";
import { convertListKind } from "../plugins/milkdown/listKindCommand";
import { dispatchTableActionFromKeyboard } from "../plugins/milkdown/table/contextMenu";
import {
  makeBoldCommand,
  makeHeadingCommand,
  makeItalicCommand,
  makeParagraphCommand,
} from "../plugins/milkdown/typoraCommandFactories";
import { makeTyporaLinkCommand } from "../plugins/milkdown/typoraLinkCommand";
import { clearFormatCommand, makeHeadingLevelCommand, selectLineCommand, selectWordCommand, underlineCommand } from "../plugins/milkdown/wysiwygFormatCommands";
import { useEditorStore } from "../stores/editorStore";
import { useLinkInsertStore } from "../stores/linkInsertStore";
import { useMilkdownEditorStore } from "../stores/milkdownEditorStore";
import { useTableInsertStore } from "../stores/tableInsertStore";
import { loggingService } from "../services/loggingService";
import { runSourceEditorMenuCommand, tableActionForId } from "./editorMenuSourceCommands";
import { startEditorImageInsert } from "./editorImageInsert";
import { triggerTableInsert } from "./tableInsertTrigger";
import type { MenuTargetToken } from "./menuTargetToken";

export type EditorMenuReason =
  | "missing_view" | "read_only" | "composing" | "no_change"
  | "unsupported" | "outside_table" | "unavailable" | "modal_open";

export interface EditorMenuResult {
  status: "applied" | "opened" | "refused";
  reason?: EditorMenuReason;
}

const applied: EditorMenuResult = { status: "applied" };
const refused = (reason: EditorMenuReason): EditorMenuResult => ({ status: "refused", reason });

/** Read the live Zustand state for every click, never a listener closure. */
export function runEditorMenuCommand(id: string, token: MenuTargetToken, actionId: string): EditorMenuResult {
  const state = useEditorStore.getState();
  if (state.viewMode === "source") {
    return state.editorView
      ? runSourceEditorMenuCommand(id, state.editorView, token, actionId)
      : refused("missing_view");
  }
  const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
  if (!editor || typeof editor.action !== "function") return refused("missing_view");
  let view: MilkdownView;
  try {
    view = editor.action((ctx) => ctx.get(editorViewCtx));
  } catch {
    return refused("missing_view");
  }
  if (!view || view.isDestroyed || !view.dom.isConnected) return refused("missing_view");
  if (!view.editable) return refused("read_only");
  if (view.composing) return refused("composing");
  try {
    return runMilkdownCommand(id, editor, view, token, actionId);
  } catch {
    return refused("unsupported");
  }
}

function runProse(view: MilkdownView, command: Command): EditorMenuResult {
  return command(view.state, (tr) => view.dispatch(tr), view) ? applied : refused("no_change");
}

function runPreset(editor: Editor, key: typeof createCodeBlockCommand.key): EditorMenuResult {
  return editor.action((ctx) => ctx.get(commandsCtx).call(key)) ? applied : refused("no_change");
}

function runListKind(editor: Editor, view: MilkdownView, kind: "bullet_list" | "ordered_list"): EditorMenuResult {
  const converted = convertListKind(view.state, (tr) => view.dispatch(tr), kind);
  if (converted !== null) return converted ? applied : refused("no_change");
  return runPreset(editor, kind === "bullet_list" ? wrapInBulletListCommand.key : wrapInOrderedListCommand.key);
}

function moveSelection(view: MilkdownView, end: "top" | "bottom"): EditorMenuResult {
  const next: Selection = end === "top"
    ? ProseSelection.atStart(view.state.doc)
    : ProseSelection.atEnd(view.state.doc);
  if (next.eq(view.state.selection)) return refused("no_change");
  view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
  return applied;
}

function runMilkdownCommand(
  id: string,
  editor: Editor,
  view: MilkdownView,
  token: MenuTargetToken,
  actionId: string,
): EditorMenuResult {
  const heading = /^paragraph\.heading([1-6])$/.exec(id);
  if (heading) return runProse(view, makeHeadingCommand(Number(heading[1])));
  const tableAction = tableActionForId(id);
  if (tableAction) return dispatchTableActionFromKeyboard(editor, tableAction)
    ? applied : refused("outside_table");

  switch (id) {
    case "paragraph.increaseHeading":
      return runProse(view, makeHeadingLevelCommand("increase"));
    case "paragraph.decreaseHeading":
      return runProse(view, makeHeadingLevelCommand("decrease"));
    case "edit.selectWord":
      return runProse(view, selectWordCommand());
    case "edit.selectLine":
      return runProse(view, selectLineCommand());
    case "format.clearFormat":
      return runProse(view, clearFormatCommand());
    case "format.underline":
      return runProse(view, underlineCommand());
    case "format.image":
      return startEditorImageInsert({ mode: "wysiwyg", view, editor }, token, actionId);
    case "paragraph.paragraph":
      return runProse(view, makeParagraphCommand());
    case "paragraph.table": {
      triggerTableInsert(token);
      const pending = useTableInsertStore.getState().pendingCallback as
        ((rows: number, cols: number) => boolean | void) | null;
      if (!pending) return refused("no_change");
      useTableInsertStore.getState().requestInsert((rows, cols): boolean | void => {
        if (useEditorStore.getState().viewMode !== "wysiwyg") {
          loggingService.logEventSync({
            level: "info", event: "ui.menu.select", status: "cancel", actionId,
            context: { windowLabel: token.windowLabel, reason: "stale", stage: "table_submit" },
          });
          useTableInsertStore.getState().clearPending();
          return;
        }
        return pending(rows, cols);
      });
      return { status: "opened" };
    }
    case "paragraph.codeFences":
      return runPreset(editor, createCodeBlockCommand.key);
    case "paragraph.quote":
      return runPreset(editor, wrapInBlockquoteCommand.key);
    case "paragraph.orderedList":
      return runListKind(editor, view, "ordered_list");
    case "paragraph.unorderedList":
      return runListKind(editor, view, "bullet_list");
    case "paragraph.indent":
      return runProse(view, makeCodeBlockIndentCommand("indent")).status === "applied"
        ? applied : runPreset(editor, sinkListItemCommand.key);
    case "paragraph.outdent":
      return runProse(view, makeCodeBlockIndentCommand("outdent")).status === "applied"
        ? applied : runPreset(editor, liftListItemCommand.key);
    case "format.strong":
      return runProse(view, makeBoldCommand());
    case "format.emphasis":
      return runProse(view, makeItalicCommand());
    case "format.code":
      return runPreset(editor, toggleInlineCodeCommand.key);
    case "format.strike":
      return runPreset(editor, toggleStrikethroughCommand.key);
    case "format.hyperlink": {
      if (useLinkInsertStore.getState().pendingCallback) return refused("modal_open");
      makeTyporaLinkCommand({ source: "menu", token, actionId })(view.state, (tr) => view.dispatch(tr), view);
      return useLinkInsertStore.getState().pendingCallback ? { status: "opened" } : refused("no_change");
    }
    case "format.highlight":
      return milkdownHighlightCommand(view) ? applied : refused("no_change");
    case "edit.jumpToTop":
      return moveSelection(view, "top");
    case "edit.jumpToBottom":
      return moveSelection(view, "bottom");
    case "edit.find":
      openFind(view, false);
      return getFindState(view.state).open ? { status: "opened" } : refused("no_change");
    case "edit.replace":
      openFind(view, true);
      return getFindState(view.state).replacing ? { status: "opened" } : refused("no_change");
    case "edit.findNext":
      return moveFind(view, 1) ? applied : refused("no_change");
    case "edit.findPrevious":
      return moveFind(view, -1) ? applied : refused("no_change");
    default:
      return refused("unsupported");
  }
}
