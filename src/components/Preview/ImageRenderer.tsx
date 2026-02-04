import { useEffect } from "react";
import type { RefObject } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

const FALLBACK_SVG =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='120'>" +
      "<rect width='100%' height='100%' fill='#f8fafc'/>" +
      "<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#94a3b8' font-family='sans-serif' font-size='14'>" +
      "Image failed to load" +
      "</text>" +
      "</svg>",
  );

interface ImageRendererProps {
  containerRef: RefObject<HTMLElement | null>;
  html: string;
  documentPath?: string | null;
}

function isRemoteUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:");
}

function isAssetUrl(src: string): boolean {
  return src.startsWith("asset://") || src.startsWith("tauri://");
}

function resolveImagePath(src: string, documentPath: string | null): string {
  // Already a remote URL or data URL
  if (isRemoteUrl(src) || isAssetUrl(src)) {
    return src;
  }

  // Absolute path starting with /
  if (src.startsWith("/")) {
    try {
      return convertFileSrc(src);
    } catch {
      return src;
    }
  }

  // Relative path - resolve against document directory
  if (documentPath) {
    const docDir = documentPath.substring(0, documentPath.lastIndexOf("/"));
    let resolvedPath: string;

    if (src.startsWith("./")) {
      resolvedPath = `${docDir}/${src.substring(2)}`;
    } else if (src.startsWith("../")) {
      // Handle parent directory references
      const parts = docDir.split("/");
      let srcParts = src.split("/");
      while (srcParts[0] === "..") {
        parts.pop();
        srcParts = srcParts.slice(1);
      }
      resolvedPath = `${parts.join("/")}/${srcParts.join("/")}`;
    } else {
      resolvedPath = `${docDir}/${src}`;
    }

    try {
      return convertFileSrc(resolvedPath);
    } catch {
      return src;
    }
  }

  return src;
}

export function ImageRenderer({ containerRef, html, documentPath }: ImageRendererProps) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));

    // Convert local paths to Tauri asset URLs
    images.forEach((img) => {
      const originalSrc = img.getAttribute("src") || "";
      if (img.dataset.srcConverted === "true") return;

      if (!isRemoteUrl(originalSrc) && !isAssetUrl(originalSrc)) {
        const resolvedSrc = resolveImagePath(originalSrc, documentPath ?? null);
        if (resolvedSrc !== originalSrc) {
          img.dataset.originalSrc = originalSrc;
          img.src = resolvedSrc;
        }
      }
      img.dataset.srcConverted = "true";
    });

    const handleError = (event: Event) => {
      const img = event.currentTarget as HTMLImageElement;
      if (img.dataset.fallbackApplied === "true") return;
      img.dataset.fallbackApplied = "true";
      img.src = FALLBACK_SVG;
      img.alt = img.alt || "Image failed to load";
      img.classList.add("preview-image--error");
    };

    images.forEach((img) => img.addEventListener("error", handleError));

    return () => {
      images.forEach((img) => img.removeEventListener("error", handleError));
    };
  }, [containerRef, html, documentPath]);

  return null;
}
