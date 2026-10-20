/** Source editor adapters for M3b's menu command dispatcher. */
import { cursorDocEnd, cursorDocStart, indentLess, indentMore } from "@codemirror/commands";
import { findNext, findPrevious, openSearchPanel, selectNextOccurrence } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import {
  decreaseHeadingCommand,
  increaseHeadingCommand,
  makeHeadingCommand,
} from "../plugins/codemirror/headingPlugin";
import { highlightCommand } from "../plugins/codemirror/highlightPlugin";
import { insertLinkCommand } from "../plugins/codemirror/linkPlugin";
import { dispatchSourceTableAction } from "../plugins/codemirror/sourceTableContextMenu";
import type { TableActionId } from "../plugins/milkdown/table/actionDescriptors";
import { isSourceTablesWithheld, useEditorStore } from "../stores/editorStore";
import { useDocumentStore } from "../stores/documentStore";
import { useLinkInsertStore } from "../stores/linkInsertStore";
import type { MenuTargetToken } from "./menuTargetToken";
import type { EditorMenuResult } from "./editorMenuCommands";

const TABLE_ACTIONS: Readonly<Record<string, TableActionId>> = {
  "table.insertRowAbove": "insert_row_before",
  "table.insertRowBelow": "insert_row_after",
  "table.insertColumnLeft": "insert_column_before",
  "table.insertColumnRight": "insert_column_after",
  "table.deleteRow": "delete_row",
  "table.deleteColumn": "delete_column",
};

export function tableActionForId(id: string): TableActionId | undefined {
  return TABLE_ACTIONS[id];
}

const applied: EditorMenuResult = { status: "applied" };
const refused = (reason: EditorMenuResult["reason"]): EditorMenuResult => ({ status: "refused", reason });

function runEffect(view: EditorView, command: (view: EditorView) => boolean): EditorMenuResult {
  const beforeDoc = view.state.doc;
  const beforeSelection = view.state.selection;
  const ran = command(view);
  return ran && (!view.state.doc.eq(beforeDoc) || !view.state.selection.eq(beforeSelection))
    ? applied : refused("no_change");
}

function moveSearch(view: EditorView, direction: "next" | "previous"): EditorMenuResult {
  const before = view.state.selection;
  const ran = direction === "next" ? findNext(view) : findPrevious(view);
  return ran && !view.state.selection.eq(before) ? applied : refused("no_change");
}

/** Run against the live CodeMirror view, never a saved closure or keydown. */
export function runSourceEditorMenuCommand(
  id: string,
  view: EditorView,
  token: MenuTargetToken,
  actionId: string,
): EditorMenuResult {
  if (!view.dom.isConnected) return refused("missing_view");
  if (view.state.readOnly) return refused("read_only");

  const heading = /^paragraph\.heading([1-6])$/.exec(id);
  if (heading) return runEffect(view, makeHeadingCommand(Number(heading[1])));
  const tableAction = tableActionForId(id);
  if (tableAction) {
    if (isSourceTablesWithheld(useEditorStore.getState(), useDocumentStore.getState().activeDocumentId)) {
      return refused("unavailable");
    }
    return dispatchSourceTableAction(view, tableAction, view.state.selection.main.head)
      ? applied : refused("outside_table");
  }

  switch (id) {
    case "paragraph.paragraph":
      return runEffect(view, makeHeadingCommand(0));
    case "paragraph.increaseHeading":
      return runEffect(view, increaseHeadingCommand);
    case "paragraph.decreaseHeading":
      return runEffect(view, decreaseHeadingCommand);
    case "paragraph.indent":
      return runEffect(view, indentMore);
    case "paragraph.outdent":
      return runEffect(view, indentLess);
    case "format.hyperlink":
      if (useLinkInsertStore.getState().pendingCallback) return refused("modal_open");
      return insertLinkCommand(view, { source: "menu", token, actionId })
        ? { status: "opened" } : refused("no_change");
    case "format.highlight":
      return runEffect(view, highlightCommand);
    case "edit.selectWord":
      return runEffect(view, selectNextOccurrence);
    case "edit.find":
      return openSearchPanel(view) ? { status: "opened" } : refused("no_change");
    case "edit.findNext":
      return moveSearch(view, "next");
    case "edit.findPrevious":
      return moveSearch(view, "previous");
    case "edit.jumpToTop":
      return runEffect(view, cursorDocStart);
    case "edit.jumpToBottom":
      return runEffect(view, cursorDocEnd);
    default:
      return refused("unsupported");
  }
}
