import { useEffect } from "react";
import type { RefObject } from "react";
import { resolveImageSrc, isRemoteUrl, isAssetUrl } from "../../services/imagePathUtils";

/** Build a fallback SVG data URI using the current theme's CSS custom properties. */
function buildFallbackSvg(): string {
  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue("--color-preview-bg").trim() || "#f8fafc";
  const text = style.getPropertyValue("--color-muted").trim() || "#94a3b8";
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='120'>` +
        `<rect width='100%' height='100%' fill='${bg}'/>` +
        `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='${text}' font-family='sans-serif' font-size='14'>` +
        "Image failed to load" +
        "</text>" +
        "</svg>",
    )
  );
}

interface ImageRendererProps {
  containerRef: RefObject<HTMLElement | null>;
  html: string;
  documentPath?: string | null;
}


export function ImageRenderer({ containerRef, html, documentPath }: ImageRendererProps) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));

    // Convert local paths to Tauri asset URLs.
    // Only mark srcConverted after a successful rewrite so that images with
    // relative paths are retried when documentPath becomes available later.
    images.forEach((img) => {
      const originalSrc = img.getAttribute("src") || "";
      if (img.dataset.srcConverted === "true") return;

      if (isRemoteUrl(originalSrc) || isAssetUrl(originalSrc)) {
        // Already a valid URL — no conversion needed
        img.dataset.srcConverted = "true";
        return;
      }

      const resolvedSrc = resolveImageSrc(originalSrc, documentPath ?? null);
      if (resolvedSrc !== originalSrc) {
        img.dataset.originalSrc = originalSrc;
        img.src = resolvedSrc;
        img.dataset.srcConverted = "true";
      }
      // If no conversion happened (e.g. documentPath not yet available),
      // leave srcConverted unset so the effect retries on the next render.
    });

    const handleError = (event: Event) => {
      const img = event.currentTarget as HTMLImageElement;
      if (img.dataset.fallbackApplied === "true") return;
      img.dataset.fallbackApplied = "true";
      img.src = buildFallbackSvg();
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
