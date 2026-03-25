/**
 * Cross-platform image path utilities.
 *
 * Purpose: Resolve image paths for both rendering (asset:// URLs) and
 * Markdown insertion (relative path strings). Handles macOS/Linux ("/")
 * and Windows ("\\" / drive-letter) path formats uniformly.
 *
 * Used by:
 *   - src/components/Preview/ImageRenderer.tsx  (Preview mode)
 *   - src/hooks/useMilkdownImages.ts            (WYSIWYG mode)
 *   - src/services/imageService.ts              (drag-drop insertion, re-exports)
 */

import { convertFileSrc } from "@tauri-apps/api/core";

/** Normalize backslashes to forward slashes for cross-platform path handling. */
export function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Returns true for http/https/data: URLs — should be used as-is. */
export function isRemoteUrl(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:")
  );
}

/** Returns true for asset:// or tauri:// URLs already served by Tauri. */
export function isAssetUrl(src: string): boolean {
  return src.startsWith("asset://") || src.startsWith("tauri://");
}

/** Returns true for Windows absolute paths like "C:/" or "C:\". */
export function isWindowsAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * Resolve an image src attribute to a Tauri asset:// URL.
 *
 * Handles:
 *   - Remote/data/asset URLs → returned unchanged
 *   - Absolute paths (Unix "/…" or Windows "C:\…") → via convertFileSrc
 *   - Relative paths (./…, ../…, bare) → resolved against the document directory
 *
 * Works on macOS, Linux, and Windows by normalizing separators before processing.
 */
export function resolveImageSrc(
  src: string,
  documentPath: string | null,
): string {
  if (isRemoteUrl(src) || isAssetUrl(src)) return src;

  const normalizedSrc = normalizeSeparators(src);
  const normalizedDocPath = documentPath ? normalizeSeparators(documentPath) : null;

  // Absolute path — Unix ("/…") or Windows ("C:/…")
  if (normalizedSrc.startsWith("/") || isWindowsAbsolutePath(normalizedSrc)) {
    try {
      return convertFileSrc(normalizedSrc);
    } catch {
      return src;
    }
  }

  // Relative path — resolve against document directory
  if (normalizedDocPath) {
    const lastSlash = normalizedDocPath.lastIndexOf("/");
    const docDir = lastSlash >= 0 ? normalizedDocPath.substring(0, lastSlash) : "";
    let resolvedPath: string;

    if (normalizedSrc.startsWith("./")) {
      resolvedPath = docDir
        ? `${docDir}/${normalizedSrc.substring(2)}`
        : normalizedSrc.substring(2);
    } else if (normalizedSrc.startsWith("../")) {
      const parts = docDir ? docDir.split("/") : [];
      let srcParts = normalizedSrc.split("/");
      while (srcParts[0] === ".." && parts.length > 0) {
        parts.pop();
        srcParts = srcParts.slice(1);
      }
      resolvedPath =
        parts.length > 0
          ? `${parts.join("/")}/${srcParts.join("/")}`
          : srcParts.join("/");
    } else {
      resolvedPath = docDir ? `${docDir}/${normalizedSrc}` : normalizedSrc;
    }

    try {
      return convertFileSrc(resolvedPath);
    } catch {
      return src;
    }
  }

  return src;
}

// ---------------------------------------------------------------------------
// Drag-drop image insertion helpers (issue #12, cross-platform fix issue #41)
// ---------------------------------------------------------------------------

/**
 * Compute a relative path from the document's directory to the image file.
 *
 * Returns null when docPath is null or imagePath is empty.
 *
 * On Windows (both paths have drive letters):
 *   - Uses case-insensitive segment comparison.
 *   - Returns the normalized absolute path when image and doc are on different drives.
 */
export function resolveImageInsertPath(
  imagePath: string,
  docPath: string | null,
): string | null {
  if (!imagePath || !docPath) return null;

  const normalizedImagePath = imagePath.replace(/\\/g, "/");
  const normalizedDocPath = docPath.replace(/\\/g, "/");

  const lastSlash = normalizedDocPath.lastIndexOf("/");
  const docDir = lastSlash >= 0 ? normalizedDocPath.substring(0, lastSlash) : "";

  const docParts = docDir === "" ? [] : docDir.split("/");
  const imgParts = normalizedImagePath.split("/");

  const docDrive = docParts.length > 0 && /^[a-zA-Z]:$/.test(docParts[0])
    ? docParts[0].toLowerCase()
    : null;
  const imgDrive = imgParts.length > 0 && /^[a-zA-Z]:$/.test(imgParts[0])
    ? imgParts[0].toLowerCase()
    : null;

  if (docDrive !== null && imgDrive !== null && docDrive !== imgDrive) {
    return normalizedImagePath;
  }

  const windowsPaths = docDrive !== null && imgDrive !== null;
  let common = 0;
  const minLen = Math.min(docParts.length, imgParts.length);
  while (common < minLen) {
    const match = windowsPaths
      ? docParts[common].toLowerCase() === imgParts[common].toLowerCase()
      : docParts[common] === imgParts[common];
    if (!match) break;
    common++;
  }

  const upCount = docParts.length - common;
  const downParts = imgParts.slice(common);
  const rel = [...Array(upCount).fill(".."), ...downParts].join("/");
  return upCount === 0 ? `./${rel}` : rel;
}

/**
 * Build a Markdown image reference for a dragged image file.
 *
 * Returns null when docPath is null or imagePath is empty.
 * Alt text is the filename without extension; special chars are escaped.
 */
export function buildImageMarkdown(
  imagePath: string,
  docPath: string | null,
): string | null {
  if (!imagePath || !docPath) return null;

  const relPath = resolveImageInsertPath(imagePath, docPath);
  if (!relPath) return null;

  const filename = imagePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dotIdx = filename.lastIndexOf(".");
  const altText = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;

  const safeAlt = altText.replace(/[\[\]]/g, "\\$&");
  const safePath = /[() [\]]/.test(relPath) ? `<${relPath}>` : relPath;

  return `![${safeAlt}](${safePath})`;
}

/** Format bytes to human-readable string (e.g. "1.25 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
