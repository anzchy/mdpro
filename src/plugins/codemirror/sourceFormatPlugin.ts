/**
 * Purpose: bind the applied Source format shortcuts ahead of CodeMirror defaults.
 *
 * @coordinates-with sourceFormatCommands.ts
 * @coordinates-with ../../commands/editorOwnedChords.ts
 */
import { indentLess, indentMore, selectLine } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { keymap, type EditorView, type KeyBinding } from "@codemirror/view";
import { loggingService } from "../../services/loggingService";
import { isMacPlatform } from "../../utils/platformLabels";
import { startEditorImageInsert } from "../../utils/editorImageInsert";
import { currentWindowLabel } from "../../utils/currentWindowLabel";
import { captureToken } from "../../utils/menuTargetToken";
import { appliedKey, currentAppliedShortcuts, defaultAppliedShortcuts } from "../../commands/appliedKeymap";
import type { AppliedShortcuts } from "../../types/keyboardShortcuts";
import type { KeyboardShortcuts } from "../../types/preferences";
import { createPlugin } from "../core/pluginTypes";
import {
  codeCommand, codeFencesCommand, deleteWordCommand, emphasisCommand, mathBlockCommand,
  orderedListCommand, quoteCommand, strikeCommand, strongCommand, unorderedListCommand,
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
  quote: logged("paragraph.quote", quoteCommand),
  indent: logged("paragraph.indent", indentMore),
  outdent: logged("paragraph.outdent", indentLess),
  selectLine: logged("edit.selectLine", selectLine),
  deleteWord: logged("edit.deleteWord", deleteWordCommand),
} as const;

/** Bind the Source commands supplied by this run's applied v2 snapshot. */
export function sourceFormatKeymap(
  isMac: boolean,
  applied: AppliedShortcuts | null = defaultAppliedShortcuts(isMac ? "macos" : "linux"),
): readonly KeyBinding[] {
  const platform = isMac ? "macos" : "linux";
  const rows: Array<[keyof KeyboardShortcuts, SourceCommand]> = [
    ["formatStrong", sourceFormatRunners.strong], ["formatEmphasis", sourceFormatRunners.emphasis],
    ["formatCode", sourceFormatRunners.code], ["formatStrike", sourceFormatRunners.strike],
    ["formatUnderline", sourceFormatRunners.underline], ["formatImage", sourceFormatRunners.image],
    ["paragraphCodeFences", sourceFormatRunners.codeFences],
    ["paragraphMathBlock", sourceFormatRunners.mathBlock],
    ["paragraphOrderedList", sourceFormatRunners.orderedList],
    ["paragraphUnorderedList", sourceFormatRunners.unorderedList],
    ["paragraphQuote", sourceFormatRunners.quote],
    ["paragraphIndent", sourceFormatRunners.indent],
    ["paragraphOutdent", sourceFormatRunners.outdent],
    ["editSelectLine", sourceFormatRunners.selectLine], ["editDeleteWord", sourceFormatRunners.deleteWord],
  ];
  return rows.flatMap(([field, run]) => {
    const key = appliedKey(applied, field, platform);
    return key ? [{ key, run }] : [];
  });
}

export const sourceFormatPlugin = createPlugin({
  name: "source-format",
  displayName: "Source Formatting",
  supportedModes: ["codemirror"],
  priority: 100,
  defaultConfig: { enabled: true },
  codemirrorExtension: () => Prec.highest(keymap.of(sourceFormatKeymap(isMacPlatform(), currentAppliedShortcuts()))),
});
