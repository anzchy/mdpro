import './imagePastePlugin.css';

/**
 * Image Paste Plugin for Milkdown/ProseMirror
 *
 * Intercepts paste events containing images, validates them,
 * uploads via Rust backend, and inserts ProseMirror image nodes.
 */

import { Plugin } from "@milkdown/kit/prose/state";
import { DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  uploadImage,
  uploadImagesBatch,
  fileToBase64,
  generateUniqueFilename,
  formatBytes,
} from "../../services/imageService";
import type { ImageUploadItem } from "../../services/imageService";
import { useToastStore } from "../../stores/toastStore";
import { useDocumentStore } from "../../stores/documentStore";
import { createPlugin } from "../core/pluginTypes";
import { resolveImagesInContainer } from "../../hooks/useMilkdownImages";
import {
  logStart,
  logSuccess,
  logFail,
  logReject,
  logBatchStart,
  logBatchEnd,
  logBatchFail,
} from "./imagePasteLogging";
import {
  imagePastePluginKey,
  addPlaceholders,
  removePlaceholders,
  insertImageNode,
  insertImageNodes,
} from "./imagePasteDecorations";
import type { PlaceholderState } from "./imagePasteDecorations";

export { imagePastePluginKey };

const SUPPORTED_TYPES = ["image/png", "image/jpeg"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// --- Exported validation helpers (for testing) ---

export function isSupportedImageType(type: string): boolean {
  return SUPPORTED_TYPES.includes(type);
}

export function validateImageSize(sizeBytes: number): boolean {
  return sizeBytes <= MAX_SIZE_BYTES;
}

export function getImageExtension(type: string): string {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  return "png";
}

function getDocumentPath(): string | null {
  const state = useDocumentStore.getState();
  const doc = state.documents.find((d) => d.id === state.activeDocumentId);
  return doc?.path ?? null;
}

function showToast(message: string): void {
  useToastStore.getState().showToast(message);
}

// --- Core paste handler ---

/** @internal Exported for unit testing only. */
export async function handleImageFiles(
  files: File[],
  view: EditorView,
): Promise<void> {
  const documentPath = getDocumentPath();

  if (!documentPath) {
    showToast("Save the document before pasting images");
    return;
  }

  // Validate all files
  const validFiles: File[] = [];
  const rejections: string[] = [];

  for (const file of files) {
    if (!isSupportedImageType(file.type)) {
      rejections.push(`${file.name || "image"}: unsupported format (use PNG or JPEG)`);
      logReject(file, "unsupported-format", documentPath);
      continue;
    }
    if (!validateImageSize(file.size)) {
      rejections.push(
        `${file.name || "image"}: too large (${formatBytes(file.size)}). Max 5 MB`,
      );
      logReject(file, "too-large", documentPath);
      continue;
    }
    validFiles.push(file);
  }

  if (rejections.length > 0 && validFiles.length === 0) {
    showToast(rejections.join(". "));
    return;
  }

  if (validFiles.length === 0) return;

  // Capture cursor position at paste time
  const pastePos = view.state.selection.from;

  // Add placeholders — all at the same position
  const placeholderIds = validFiles.map(
    (_, i) => `img-placeholder-${Date.now()}-${i}`,
  );
  addPlaceholders(view, pastePos, placeholderIds);

  const startTime = Date.now();

  if (validFiles.length === 1) {
    // Single image upload
    const file = validFiles[0];
    const filename = generateUniqueFilename(
      file.name || `paste.${getImageExtension(file.type)}`,
    );

    logStart(file, documentPath);

    try {
      const base64 = await fileToBase64(file);
      const result = await uploadImage(documentPath, base64, filename);

      if (!view.isDestroyed) {
        removePlaceholders(view, placeholderIds);
        insertImageNode(view, result.relativePath, pastePos);
        // Resolve the newly inserted image's src to an asset:// URL after
        // ProseMirror has settled the DOM (queueMicrotask guarantees this
        // runs after the current synchronous dispatch; fixes #375).
        queueMicrotask(() => resolveImagesInContainer(documentPath));
      }

      logSuccess(file, documentPath, Date.now() - startTime);
      if (rejections.length > 0) {
        showToast(`Image pasted (${rejections.length} skipped)`);
      } else {
        showToast("Image pasted");
      }
    } catch (err) {
      if (!view.isDestroyed) {
        removePlaceholders(view, placeholderIds);
      }
      const message = err instanceof Error ? err.message : String(err);
      logFail(file, documentPath, message);
      showToast(`Failed to paste image: ${message}`);
    }
  } else {
    // Batch upload
    logBatchStart(validFiles.length, documentPath);

    try {
      const items: ImageUploadItem[] = await Promise.all(
        validFiles.map(async (file) => {
          const base64 = await fileToBase64(file);
          const filename = generateUniqueFilename(
            file.name || `paste.${getImageExtension(file.type)}`,
          );
          return { data: base64, filename };
        }),
      );

      const batchResult = await uploadImagesBatch(documentPath, items);

      if (!view.isDestroyed) {
        removePlaceholders(view, placeholderIds);
      }

      // Collect successful image paths
      const relativePaths: string[] = [];
      for (const result of batchResult.results) {
        if ("error" in result) continue;
        relativePaths.push(result.relativePath);
      }

      if (!view.isDestroyed && relativePaths.length > 0) {
        insertImageNodes(view, relativePaths, pastePos);
        // Resolve all newly inserted images after DOM settles (fixes #375)
        queueMicrotask(() => resolveImagesInContainer(documentPath));
      }

      const duration = Date.now() - startTime;
      const parts: string[] = [];
      if (batchResult.successCount > 0) {
        parts.push(`${batchResult.successCount} image${batchResult.successCount > 1 ? "s" : ""} pasted`);
      }
      if (batchResult.failureCount > 0) {
        parts.push(`${batchResult.failureCount} failed`);
      }
      if (rejections.length > 0) {
        parts.push(`${rejections.length} skipped`);
      }
      showToast(parts.join(", "));

      logBatchEnd(validFiles.length, documentPath, batchResult.successCount, batchResult.failureCount, duration);
    } catch (err) {
      if (!view.isDestroyed) {
        removePlaceholders(view, placeholderIds);
      }
      const message = err instanceof Error ? err.message : String(err);
      logBatchFail(validFiles.length, documentPath, message);
      showToast(`Failed to paste images: ${message}`);
    }
  }
}

// --- ProseMirror plugin ---

const imagePasteProseMirrorPlugin = new Plugin<PlaceholderState>({
  key: imagePastePluginKey,
  state: {
    init(): PlaceholderState {
      return { decorations: DecorationSet.empty };
    },
    apply(tr, prev): PlaceholderState {
      const meta = tr.getMeta(imagePastePluginKey) as PlaceholderState | undefined;
      if (meta) return meta;
      // Map decorations through document changes
      return { decorations: prev.decorations.map(tr.mapping, tr.doc) };
    },
  },
  props: {
    decorations(state) {
      return imagePastePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
    },
    handlePaste(view, event) {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;

      const imageFiles: File[] = [];
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return false;

      // Prevent default paste behavior for images
      event.preventDefault();

      void handleImageFiles(imageFiles, view);

      return true;
    },
  },
});

// --- Milkdown plugin wrapper ---

export const imagePasteMilkdownPlugin = $prose(() => imagePasteProseMirrorPlugin);

// --- Exported mdpro plugin definition ---

export const imagePastePlugin = createPlugin({
  name: "image-paste",
  displayName: "Image Paste",
  supportedModes: ["milkdown"],
  priority: 70,
  defaultConfig: { enabled: true },
  milkdownPlugin: () => imagePasteMilkdownPlugin,
});
