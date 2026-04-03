/**
 * useMilkdownImages — resolve local image src attributes in the Milkdown editor.
 *
 * Purpose: After Milkdown renders content, scan all <img> elements and convert
 * relative/absolute local paths to Tauri asset:// URLs so images display correctly.
 * Handles both macOS/Linux and Windows path formats via resolveImageSrc.
 *
 * @coordinates-with imagePastePlugin.ts — calls resolveImagesInContainer directly
 *   after each in-session paste so newly inserted images are resolved immediately
 *   (fixes #375).
 */

import { useEffect } from "react";
import type { UseEditorReturn } from "@milkdown/react";
import { resolveImageSrc, isRemoteUrl, isAssetUrl } from "../services/imagePathUtils";
import { loggingService } from "../services/loggingService";

/**
 * Scans all <img> elements inside #milkdown-container and resolves any
 * unresolved local src paths to Tauri asset:// URLs.
 *
 * Exported so imagePastePlugin can call it imperatively after inserting a
 * ProseMirror image node, giving immediate rendering without a mode switch.
 *
 * @param documentPath - Absolute path of the open document (for relative→absolute).
 */
export function resolveImagesInContainer(documentPath: string | null): void {
  const container = document.getElementById("milkdown-container");
  if (!container) return;

  const images = container.querySelectorAll("img");
  images.forEach((img) => {
    const originalSrc = img.getAttribute("src");
    if (!originalSrc) return;

    if (isAssetUrl(originalSrc) || (isRemoteUrl(originalSrc) && !originalSrc.startsWith("data:"))) {
      return;
    }

    const resolvedSrc = resolveImageSrc(originalSrc, documentPath);
    if (resolvedSrc !== originalSrc) {
      img.setAttribute("src", resolvedSrc);
      loggingService.logEventSync({
        level: "info",
        event: "editor.milkdown.image.resolve",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: { originalSrc, resolvedSrc, documentPath },
      });
    }
  });
}

/**
 * Resolves image src attributes inside the Milkdown container after render.
 *
 * @param editor - The Milkdown editor instance returned by useEditor.
 * @param documentPath - Absolute path of the open document (for relative path resolution).
 * @param activeDocumentId - Active document ID; changing it triggers re-resolution.
 */
export function useMilkdownImages(
  editor: UseEditorReturn,
  documentPath: string | null,
  activeDocumentId: string | null | undefined,
): void {
  useEffect(() => {
    if (editor.loading) return;

    // 100 ms delay gives the Milkdown/ProseMirror DOM time to settle on initial
    // mount. For in-session paste, imagePastePlugin calls resolveImagesInContainer
    // directly (synchronously after dispatch) so no delay is needed there.
    const timer = setTimeout(() => resolveImagesInContainer(documentPath), 100);

    return () => clearTimeout(timer);
  }, [editor.loading, documentPath, activeDocumentId]);
}
