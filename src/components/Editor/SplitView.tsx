import { Editor } from "./Editor";
import { LinkInsertModal } from "./LinkInsertModal";
import { SourceTableContextMenu } from "./SourceTableContextMenu";

interface SplitViewProps {
  markdown: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  highlightRequest?: number;
}

export function SplitView({
  markdown,
  onChange,
  readOnly = false,
  highlightRequest,
}: SplitViewProps) {
  return (
    <div className="split-view">
      <div id="source-container" className="split-pane full-pane">
        <Editor
          value={markdown}
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
