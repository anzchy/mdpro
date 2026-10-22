/**
 * Purpose: current v1 WYSIWYG keys for D255-WI-3b commands.
 * @coordinates-with typoraKeymapPlugin.ts
 * @coordinates-with ../../utils/editorImageInsert.ts
 */
import type { Editor } from "@milkdown/kit/core";
import type { Command } from "@milkdown/kit/prose/state";
import { loggingService } from "../../services/loggingService";
import { useMilkdownEditorStore } from "../../stores/milkdownEditorStore";
import { currentWindowLabel } from "../../utils/currentWindowLabel";
import { startEditorImageInsert } from "../../utils/editorImageInsert";
import { captureToken } from "../../utils/menuTargetToken";
import {
  clearFormatCommand, makeHeadingLevelCommand, selectLineCommand, selectWordCommand, underlineCommand,
} from "./wysiwygFormatCommands";

type Entry = { shortcuts: string; command: () => Command };

function logged(id: string, command: Command): Command {
  return (state, dispatch, view) => {
    const changed = command(state, dispatch, view);
    loggingService.logEventSync({
      level: "info", event: "ui.editor.command", status: changed ? "success" : "cancel",
      actionId: loggingService.generateActionId(),
      context: { command: id, mode: "wysiwyg", via: "key" },
    });
    return true;
  };
}

/** Keymap entries bind literal v1 keys; M1b will supply applied-set bindings. */
export function wysiwygV1Entries(isMac: boolean): Record<string, Entry> {
  const image: Record<string, Entry> = isMac ? {
    image: {
      shortcuts: "Mod-Ctrl-i",
      command: () => (_state, _dispatch, view) => {
        const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
        const actionId = loggingService.generateActionId();
        const changed = Boolean(view && editor && startEditorImageInsert(
          { mode: "wysiwyg", view, editor }, captureToken(currentWindowLabel()), actionId,
        ).status === "opened");
        loggingService.logEventSync({
          level: "info", event: "ui.editor.command", status: changed ? "success" : "cancel",
          actionId, context: { command: "format.image", mode: "wysiwyg", via: "key" },
        });
        return true;
      },
    },
  } : {};
  return {
    increaseHeading: { shortcuts: "Mod-=", command: () => logged("paragraph.increaseHeading", makeHeadingLevelCommand("increase")) },
    decreaseHeading: { shortcuts: "Mod--", command: () => logged("paragraph.decreaseHeading", makeHeadingLevelCommand("decrease")) },
    selectWord: { shortcuts: "Mod-d", command: () => logged("edit.selectWord", selectWordCommand()) },
    selectLine: { shortcuts: "Mod-l", command: () => logged("edit.selectLine", selectLineCommand()) },
    clearFormat: { shortcuts: "Mod-\\", command: () => logged("format.clearFormat", clearFormatCommand()) },
    underline: { shortcuts: "Mod-u", command: () => logged("format.underline", underlineCommand()) },
    ...image,
  };
}
