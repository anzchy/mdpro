import { useEffect } from "react";
import type { RefObject } from "react";

export function useScrollSync(
  editorRef: RefObject<HTMLElement | null>,
  previewRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const editorHost = editorRef.current;
    const previewHost = previewRef.current;
    if (!editorHost || !previewHost) return;

    const editorScroller = editorHost.querySelector<HTMLElement>(".cm-scroller");
    if (!editorScroller) return;

    let syncing = false;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      if (syncing) return;
      syncing = true;
      const maxSource = source.scrollHeight - source.clientHeight || 1;
      const maxTarget = target.scrollHeight - target.clientHeight || 1;
      const ratio = source.scrollTop / maxSource;
      target.scrollTop = ratio * maxTarget;
      requestAnimationFrame(() => {
        syncing = false;
      });
    };

    const handleEditorScroll = () => syncScroll(editorScroller, previewHost);
    const handlePreviewScroll = () => syncScroll(previewHost, editorScroller);

    editorScroller.addEventListener("scroll", handleEditorScroll);
    previewHost.addEventListener("scroll", handlePreviewScroll);

    return () => {
      editorScroller.removeEventListener("scroll", handleEditorScroll);
      previewHost.removeEventListener("scroll", handlePreviewScroll);
    };
  }, [editorRef, previewRef]);
}
