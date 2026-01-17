import { useEffect, useRef } from "react";
import { usePreview } from "../../hooks/usePreview";
import { ImageRenderer } from "./ImageRenderer";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import "./styles/preview.css";

interface PreviewProps {
  markdown: string;
}

export function Preview({ markdown }: PreviewProps) {
  const { html, isRendering } = usePreview(markdown, 100);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const blocks = container.querySelectorAll<HTMLElement>("pre code");
    blocks.forEach((block) => {
      hljs.highlightElement(block);
    });
  }, [html]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      if (!link || !(link instanceof HTMLAnchorElement)) return;
      if (!link.href) return;
      event.preventDefault();
      const href = link.href;
      import("@tauri-apps/plugin-opener")
        .then(({ open }) => open(href))
        .catch(() => window.open(href, "_blank", "noopener,noreferrer"));
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [html]);

  return (
    <div className="preview-body">
      {isRendering ? <div className="preview-loading">Rendering…</div> : null}
      <div
        className="preview-content"
        ref={containerRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <ImageRenderer containerRef={containerRef} html={html} />
    </div>
  );
}
