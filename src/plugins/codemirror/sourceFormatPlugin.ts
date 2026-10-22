/**
 * Purpose: bind the current v1 Source shortcuts ahead of CodeMirror defaults.
 * M1b will replace these literals with the applied shortcut set.
 *
 * @coordinates-with sourceFormatCommands.ts
 * @coordinates-with ../../commands/editorOwnedChords.ts
 */
import { selectLine } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { keymap, type EditorView, type KeyBinding } from "@codemirror/view";
import { loggingService } from "../../services/loggingService";
import { isMacPlatform } from "../../utils/platformLabels";
import { startEditorImageInsert } from "../../utils/editorImageInsert";
import { currentWindowLabel } from "../../utils/currentWindowLabel";
import { captureToken } from "../../utils/menuTargetToken";
import { createPlugin } from "../core/pluginTypes";
import {
  codeCommand, codeFencesCommand, deleteWordCommand, emphasisCommand, mathBlockCommand,
  orderedListCommand, strikeCommand, strongCommand, unorderedListCommand,
  underlineCommand,
} from "./sourceFormatCommands";

type SourceCommand = (view: EditorView) => boolean;

function logged(id: string, command: SourceCommand): SourceCommand {
  return (view) => {
    const changed = command(view);
    loggingService.logEventSync({
      level: "info", event: "ui.editor.command", status: changed ? "success" : "cancel",
      actionId: loggingService.generateActionId(),
      context: { command: id, mode: "source", via: "key" },
    });
    // Own the v1 chord even when formatting refuses. Falling through would let
    // CodeMirror's default Mod-i change a multiline selection after refusal.
    return true;
  };
}

/** Stable identities let the inventory prove each composed key's command. */
export const sourceFormatRunners = {
  strong: logged("format.strong", strongCommand),
  emphasis: logged("format.emphasis", emphasisCommand),
  code: logged("format.code", codeCommand),
  strike: logged("format.strike", strikeCommand),
  underline: logged("format.underline", underlineCommand),
  image: (view: EditorView) => {
    const actionId = loggingService.generateActionId();
    const result = startEditorImageInsert({ mode: "source", view }, captureToken(currentWindowLabel()), actionId);
    loggingService.logEventSync({
      level: "info", event: "ui.editor.command", status: result.status === "opened" ? "start" : "cancel",
      actionId, context: { command: "format.image", mode: "source", via: "key" },
    });
    return true;
  },
  codeFences: logged("paragraph.codeFences", codeFencesCommand),
  mathBlock: logged("paragraph.mathBlock", mathBlockCommand),
  orderedList: logged("paragraph.orderedList", orderedListCommand),
  unorderedList: logged("paragraph.unorderedList", unorderedListCommand),
  selectLine: logged("edit.selectLine", selectLine),
  deleteWord: logged("edit.deleteWord", deleteWordCommand),
} as const;

/** Today's v1 keymap; Quote intentionally has no v1 key. */
export function sourceFormatKeymap(isMac: boolean): readonly KeyBinding[] {
  const primary = isMac ? "Mod" : "Ctrl";
  return [
    { key: `${primary}-b`, run: sourceFormatRunners.strong },
    { key: `${primary}-i`, run: sourceFormatRunners.emphasis },
    { key: `${primary}-Shift-\``, run: sourceFormatRunners.code },
    { key: isMac ? "Ctrl-Shift-\`" : "Alt-Shift-5", run: sourceFormatRunners.strike },
    { key: `${primary}-u`, run: sourceFormatRunners.underline },
    ...(isMac ? [{ key: "Mod-Ctrl-i", run: sourceFormatRunners.image }] : []),
    { key: `${primary}-Alt-c`, run: sourceFormatRunners.codeFences },
    { key: `${primary}-Alt-b`, run: sourceFormatRunners.mathBlock },
    { key: `${primary}-Alt-o`, run: sourceFormatRunners.orderedList },
    { key: `${primary}-Alt-u`, run: sourceFormatRunners.unorderedList },
    { key: `${primary}-l`, run: sourceFormatRunners.selectLine },
    { key: `${primary}-Shift-d`, run: sourceFormatRunners.deleteWord },
  ];
}

export const sourceFormatPlugin = createPlugin({
  name: "source-format",
  displayName: "Source Formatting",
  supportedModes: ["codemirror"],
  priority: 100,
  defaultConfig: { enabled: true },
  codemirrorExtension: () => Prec.highest(keymap.of(sourceFormatKeymap(isMacPlatform()))),
});
