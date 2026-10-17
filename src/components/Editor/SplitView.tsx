import { useRef } from "react";
import { useDocumentStore } from "../../stores/documentStore";
import { useEditorStore } from "../../stores/editorStore";
import type { HighlightRequest } from "../../utils/menuTargetToken";
import { Editor } from "./Editor";
import { LinkInsertModal } from "./LinkInsertModal";
import { SourceTableContextMenu } from "./SourceTableContextMenu";

interface SplitViewProps {
  markdown: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** Passed through to the Source editor (D261: carries the menu-target token). */
  highlightRequest?: HighlightRequest;
}

export function SplitView({
  markdown,
  onChange,
  readOnly = false,
  highlightRequest,
}: SplitViewProps) {
  // D203: one CodeMirror view per document. Sharing one view across tabs let
  // @uiw/react-codemirror swap `value` in as an undoable change (⌘Z then wrote the
  // previous tab's text into the active document) and defer the swap while the user
  // was typing (the next keystroke wrote the old tab's text into the new document).
  // Keying by document id remounts the editor, with a fresh history, on every switch.
  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);
  // Read while the outgoing view still exists: a switch made with the Source editor
  // focused hands focus to the incoming view, as the shared view kept it before.
  const focusCarry = useRef({ id: activeDocumentId, focus: false });
  if (focusCarry.current.id !== activeDocumentId) {
    focusCarry.current = {
      id: activeDocumentId,
      focus: useEditorStore.getState().editorView?.hasFocus ?? false,
    };
  }
  return (
    <div className="split-view">
      <div id="source-container" className="split-pane full-pane">
        <Editor
          key={activeDocumentId ?? "none"}
          value={markdown}
          focusOnMount={focusCarry.current.focus}
          onChange={onChange}
          readOnly={readOnly}
          highlightRequest={highlightRequest}
        />
      </div>
      {/* Mounted alongside Editor — listens on #source-container for
          right-clicks inside markdown tables (Phase 2 WI-2.4). Mirror
          of MilkdownEditor's <TableContextMenu />. */}
      <SourceTableContextMenu />
      {/* ⌘K URL input for Source mode (D55) — the same modal MilkdownEditor
          mounts; window.prompt never shows in the packaged app. */}
      <LinkInsertModal />
    </div>
  );
}
