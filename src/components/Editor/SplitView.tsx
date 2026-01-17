import { useRef, useState } from "react";
import { Editor } from "./Editor";
import { Preview } from "../Preview/Preview";
import { useScrollSync } from "../../hooks/useScrollSync";
import type { ViewMode } from "../../types/editor";

interface SplitViewProps {
  markdown: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  viewMode?: ViewMode;
  highlightRequest?: number;
}

export function SplitView({
  markdown,
  onChange,
  readOnly = false,
  viewMode = "split",
  highlightRequest,
}: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(50);

  useScrollSync(editorRef, previewRef, viewMode === "split");

  const startDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const offset = moveEvent.clientX - containerRect.left;
      const ratio = (offset / containerRect.width) * 100;
      const clamped = Math.min(70, Math.max(30, ratio));
      setSplitRatio(clamped);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  if (viewMode === "editor-only") {
    return (
      <div className="split-view" ref={containerRef}>
        <div className="split-pane" style={{ width: "100%" }}>
          <div className="pane-title">Editor</div>
          <div className="pane-content" ref={editorRef}>
            <Editor
              value={markdown}
              onChange={onChange}
              readOnly={readOnly}
              highlightRequest={highlightRequest}
            />
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === "preview-only") {
    return (
      <div className="split-view" ref={containerRef}>
        <div className="split-pane" style={{ width: "100%" }}>
          <div className="pane-title">Preview</div>
          <div className="pane-content preview-scroll" ref={previewRef}>
            <Preview markdown={markdown} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="split-view" ref={containerRef}>
      <div className="split-pane" style={{ width: `${splitRatio}%` }}>
        <div className="pane-title">Editor</div>
        <div className="pane-content" ref={editorRef}>
          <Editor
            value={markdown}
            onChange={onChange}
            readOnly={readOnly}
            highlightRequest={highlightRequest}
          />
        </div>
      </div>
      <div className="split-divider" onMouseDown={startDrag} />
      <div className="split-pane" style={{ width: `${100 - splitRatio}%` }}>
        <div className="pane-title">Preview</div>
        <div className="pane-content preview-scroll" ref={previewRef}>
          <Preview markdown={markdown} />
        </div>
      </div>
    </div>
  );
}
