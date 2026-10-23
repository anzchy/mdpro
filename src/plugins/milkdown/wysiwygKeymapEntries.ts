/**
 * Purpose: applied WYSIWYG keys for D255-WI-3b commands after M1b.
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
import { appliedMilkdownKey, defaultAppliedShortcuts } from "../../commands/appliedKeymap";
import type { AppliedShortcuts } from "../../types/keyboardShortcuts";
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

/** Configurable WYSIWYG entries use only the run's applied bindings. */
export function wysiwygEntries(
  isMac: boolean,
  applied: AppliedShortcuts | null = defaultAppliedShortcuts(isMac ? "macos" : "linux"),
): Record<string, Entry> {
  const platform = isMac ? "macos" : "linux";
  const bind = (field: Parameters<typeof appliedMilkdownKey>[1], command: Entry["command"]): Entry | null => {
    const shortcuts = appliedMilkdownKey(applied, field, platform);
    return shortcuts ? { shortcuts, command } : null;
  };
  const imageKey = appliedMilkdownKey(applied, "formatImage", platform);
  const imageEntry: Record<string, Entry> = imageKey ? {
    image: {
      shortcuts: imageKey,
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
  const candidates = {
    increaseHeading: bind("paragraphIncreaseHeading", () => logged("paragraph.increaseHeading", makeHeadingLevelCommand("increase"))),
    decreaseHeading: bind("paragraphDecreaseHeading", () => logged("paragraph.decreaseHeading", makeHeadingLevelCommand("decrease"))),
    selectWord: bind("editSelectWord", () => logged("edit.selectWord", selectWordCommand())),
    selectLine: bind("editSelectLine", () => logged("edit.selectLine", selectLineCommand())),
    clearFormat: bind("formatClearFormat", () => logged("format.clearFormat", clearFormatCommand())),
    underline: bind("formatUnderline", () => logged("format.underline", underlineCommand())),
    ...imageEntry,
  };
  return Object.fromEntries(Object.entries(candidates).filter(([, entry]) => entry !== null)) as Record<string, Entry>;
}
