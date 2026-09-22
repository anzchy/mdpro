/**
 * @module useMilkdownDebugLogging
 * Purpose: the two diagnostic log effects of the WYSIWYG editor — the mount
 * log (`editor.milkdown.mount`) and the 500ms DOM-structure check
 * (`editor.milkdown.dom.check`). Moved verbatim out of MilkdownEditor.tsx
 * (WI-8) to keep that component under the 300-line guideline; behaviour,
 * event names, payloads and effect deps are unchanged.
 *
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx
 */

import { useEffect } from "react";
import { loggingService } from "../services/loggingService";

export function useMilkdownDebugLogging(
  activeDocumentId: string | null,
  initialMarkdownLength: number,
): void {
  // Log when MilkdownEditor mounts/updates for debugging
  useEffect(() => {
    loggingService.logEventSync({
      level: "info",
      event: "editor.milkdown.mount",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: {
        documentId: activeDocumentId,
        hasContent: initialMarkdownLength > 0,
        contentLength: initialMarkdownLength,
      },
    });
  }, [activeDocumentId, initialMarkdownLength]);

  // Check DOM structure after editor mounts to debug rendering issues
  useEffect(() => {
    const timer = setTimeout(() => {
      const root = document.querySelector(".milkdown-editor");
      const milkdownRoot = root?.querySelector("[data-milkdown-root]");
      const prosemirror = root?.querySelector(".ProseMirror");

      loggingService.logEventSync({
        level: "info",
        event: "editor.milkdown.dom.check",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          hasRoot: !!root,
          hasMilkdownRoot: !!milkdownRoot,
          hasProseMirror: !!prosemirror,
          proseMirrorChildCount: prosemirror?.childNodes.length ?? 0,
          proseMirrorInnerHTMLLength: prosemirror?.innerHTML?.length ?? 0,
        },
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [activeDocumentId]);
}
