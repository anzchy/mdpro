import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { markdownExtension } from "./extensions/markdown";
import { syntaxHighlightingExtension } from "./extensions/syntax";
import { useEditorStore } from "../../stores/editorStore";
import { pluginRegistry } from "../../plugins";
import { highlightCommand } from "../../plugins/codemirror/highlightPlugin";

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
  const initializedRef = useRef(false);
  const setEditorView = useEditorStore((state) => state.setEditorView);
  const pluginExtensions = useMemo(() => pluginRegistry.getCodemirrorExtensions(), []);
  const pluginEventExtension = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          pluginRegistry.emitEvent("docChange", { mode: "codemirror" });
        }
        if (update.selectionSet) {
          pluginRegistry.emitEvent("selectionChange", { mode: "codemirror" });
        }
        if (update.focusChanged) {
          pluginRegistry.emitEvent("focusChange", {
            mode: "codemirror",
            focused: update.view.hasFocus,
          });
        }
      }),
    [],
  );

  useEffect(() => {
    if (highlightRequest === undefined) return;
    if (viewRef.current) {
      highlightCommand(viewRef.current);
    }
  }, [highlightRequest]);

  useEffect(() => {
    return () => {
      setEditorView(null);
      if (initializedRef.current) {
        pluginRegistry.cleanup();
        initializedRef.current = false;
      }
    };
  }, [setEditorView]);

  return (
    <div className="editor-shell">
      <CodeMirror
        value={value}
        height="100%"
        extensions={[
          markdownExtension,
          syntaxHighlightingExtension,
          pluginEventExtension,
          ...pluginExtensions,
          keymap.of([
            { key: "Mod-z", run: undo },
            { key: "Mod-Shift-z", run: redo },
            { key: "Mod-y", run: redo },
          ]),
        ]}
        onChange={(nextValue) => {
          if (!readOnly) {
            onChange(nextValue);
          }
        }}
        onCreateEditor={(view) => {
          viewRef.current = view;
          setEditorView(view);
          pluginRegistry.setCodemirrorView(view);
          if (!initializedRef.current) {
            pluginRegistry.initialize({ currentMode: "codemirror", codemirrorView: view });
            initializedRef.current = true;
          } else {
            pluginRegistry.onModeChange("codemirror");
          }
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
