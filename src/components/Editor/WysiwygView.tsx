import { useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { markdownExtension } from "./extensions/markdown";
import { syntaxHighlightingExtension } from "./extensions/syntax";
import { highlightCommand } from "./extensions/highlight";
import { wysiwygExtension } from "./extensions/wysiwyg";

interface WysiwygViewProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  highlightRequest?: number;
}

export function WysiwygView({
  value,
  onChange,
  readOnly = false,
  highlightRequest,
}: WysiwygViewProps) {
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
          wysiwygExtension,
          keymap.of([
            { key: "Mod-z", run: undo },
            { key: "Mod-Shift-z", run: redo },
            { key: "Mod-y", run: redo },
            { key: "Mod-Shift-h", run: highlightCommand },
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
