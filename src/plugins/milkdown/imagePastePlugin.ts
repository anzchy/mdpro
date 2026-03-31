/**
 * Image Paste Plugin for Milkdown/ProseMirror
 *
 * Intercepts paste events containing images, validates them,
 * uploads via Rust backend, and inserts ProseMirror image nodes.
 */

import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
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
import { loggingService } from "../../services/loggingService";
import { createPlugin } from "../core/pluginTypes";

export const imagePastePluginKey = new PluginKey("imagePaste");

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

// --- Placeholder decoration state ---

interface PlaceholderState {
  decorations: DecorationSet;
}

function createPlaceholderWidget(id: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "image-paste-placeholder";
  el.setAttribute("data-placeholder-id", id);
  el.textContent = "Uploading image…";
  return el;
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
      }
      if (!view.isDestroyed) {
        insertImageNode(view, result.relativePath, pastePos);
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

// --- ProseMirror helpers ---

function addPlaceholders(
  view: EditorView,
  pos: number,
  ids: string[],
): void {
  const { state, dispatch } = view;
  // Place all placeholders at the same position (they stack visually)
  const decorations = ids.map((id) =>
    Decoration.widget(pos, () => createPlaceholderWidget(id), {
      key: id,
    }),
  );

  const existing =
    imagePastePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
  const next = existing.add(state.doc, decorations);

  dispatch(
    state.tr.setMeta(imagePastePluginKey, { decorations: next }),
  );
}

function removePlaceholders(
  view: EditorView,
  ids: string[],
): void {
  const { state, dispatch } = view;
  const existing =
    imagePastePluginKey.getState(state)?.decorations ?? DecorationSet.empty;

  const toRemove = existing.find().filter((d: Decoration) => {
    const el = (d as Decoration & { spec?: { key?: string } }).spec?.key;
    return el && ids.includes(el);
  });

  if (toRemove.length > 0) {
    const next = existing.remove(toRemove);
    dispatch(
      state.tr.setMeta(imagePastePluginKey, { decorations: next }),
    );
  }
}

function insertImageNode(
  view: EditorView,
  src: string,
  pos: number,
): void {
  const { state, dispatch } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return;

  const node = imageType.create({ src, alt: "" });
  dispatch(state.tr.insert(pos, node));
}

function insertImageNodes(
  view: EditorView,
  srcs: string[],
  pos: number,
): void {
  const { state, dispatch } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return;

  const tr = state.tr;

  let offset = 0;
  for (const src of srcs) {
    const node = imageType.create({ src, alt: "" });
    tr.insert(pos + offset, node);
    offset += node.nodeSize;
  }

  dispatch(tr);
}

// --- Logging helpers ---

function logStart(file: File, documentPath: string): void {
  loggingService.logEventSync({
    level: "info",
    event: "image.paste.start",
    status: "start",
    actionId: loggingService.generateActionId(),
    context: {
      filename: file.name,
      format: file.type,
      sizeBytes: file.size,
      documentPath,
    },
  });
}

function logSuccess(file: File, documentPath: string, durationMs: number): void {
  loggingService.logEventSync({
    level: "info",
    event: "image.paste.success",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: { filename: file.name, format: file.type, sizeBytes: file.size, documentPath },
    durationMs,
  });
}

function logFail(file: File, documentPath: string, error: string): void {
  loggingService.logEventSync({
    level: "error",
    event: "image.paste.fail",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { filename: file.name, format: file.type, sizeBytes: file.size, documentPath },
    error,
  });
}

function logReject(file: File, reason: string, documentPath: string): void {
  loggingService.logEventSync({
    level: "warn",
    event: "image.paste.reject",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { filename: file.name, format: file.type, sizeBytes: file.size, documentPath, reason },
  });
}

function logBatchStart(count: number, documentPath: string): void {
  loggingService.logEventSync({
    level: "info",
    event: "image.paste.batch.start",
    status: "start",
    actionId: loggingService.generateActionId(),
    context: { count, documentPath },
  });
}

function logBatchEnd(
  count: number,
  documentPath: string,
  successCount: number,
  failureCount: number,
  durationMs: number,
): void {
  loggingService.logEventSync({
    level: successCount > 0 ? "info" : "error",
    event: "image.paste.batch.end",
    status: failureCount === 0 ? "success" : "fail",
    actionId: loggingService.generateActionId(),
    context: { count, successCount, failureCount, documentPath },
    durationMs,
  });
}

function logBatchFail(count: number, documentPath: string, error: string): void {
  loggingService.logEventSync({
    level: "error",
    event: "image.paste.batch.fail",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { count, documentPath },
    error,
  });
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
