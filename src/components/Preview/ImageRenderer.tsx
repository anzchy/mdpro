import { useEffect } from "react";
import type { RefObject } from "react";

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
  containerRef: RefObject<HTMLElement>;
  html: string;
}

export function ImageRenderer({ containerRef, html }: ImageRendererProps) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));

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
  }, [containerRef, html]);

  return null;
}
