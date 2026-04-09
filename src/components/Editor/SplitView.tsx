import { Editor } from "./Editor";

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
    </div>
  );
}
