import { useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { markdownExtension } from "./extensions/markdown";
import { syntaxHighlightingExtension } from "./extensions/syntax";
import { highlightCommand } from "./extensions/highlight";
import {
  heading1Command,
  heading2Command,
  heading3Command,
  heading4Command,
  heading5Command,
  heading6Command,
  paragraphCommand,
  increaseHeadingCommand,
  decreaseHeadingCommand,
} from "./extensions/heading";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  highlightRequest?: number;
}

export function Editor({
  value,
  onChange,
  readOnly = false,
  highlightRequest,
}: EditorProps) {
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (highlightRequest === undefined) return;
    if (viewRef.current) {
      highlightCommand(viewRef.current);
    }
  }, [highlightRequest]);

  return (
    <div className="editor-shell">
      <CodeMirror
        value={value}
        height="100%"
        extensions={[
          markdownExtension,
          syntaxHighlightingExtension,
          keymap.of([
            { key: "Mod-z", run: undo },
            { key: "Mod-Shift-z", run: redo },
            { key: "Mod-y", run: redo },
            { key: "Mod-Shift-h", run: highlightCommand },
            // Heading shortcuts (Typora-style)
            { key: "Mod-1", run: heading1Command },
            { key: "Mod-2", run: heading2Command },
            { key: "Mod-3", run: heading3Command },
            { key: "Mod-4", run: heading4Command },
            { key: "Mod-5", run: heading5Command },
            { key: "Mod-6", run: heading6Command },
            { key: "Mod-0", run: paragraphCommand },
            { key: "Mod-=", run: increaseHeadingCommand },
            { key: "Mod--", run: decreaseHeadingCommand },
          ]),
        ]}
        onChange={(nextValue) => {
          if (!readOnly) {
            onChange(nextValue);
          }
        }}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        editable={!readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
        }}
      />
    </div>
  );
}
