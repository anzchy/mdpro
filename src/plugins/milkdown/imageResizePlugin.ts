import type { EditorView } from "@milkdown/kit/prose/view";

const WIDTH_MARKER_RE = /(?:^|\s)\{mdpro-width=(\d{1,3})%\}\s*$/;

type ImageNodeLike = {
  type: { name: string };
  attrs: {
    src?: string;
    alt?: string;
    title?: string;
  };
};

export function normalizeImageWidthPercent(value: string | number): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(value.trim().replace(/%$/, ""));
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 200) return null;
  return rounded;
}

export function getImageWidthPercentFromTitle(title: string | null | undefined): number | null {
  const match = (title ?? "").match(WIDTH_MARKER_RE);
  if (!match) return null;
  return normalizeImageWidthPercent(match[1]);
}

export function stripImageWidthMarker(title: string | null | undefined): string {
  return (title ?? "").replace(WIDTH_MARKER_RE, "").trim();
}

export function writeImageWidthMarker(
  title: string | null | undefined,
  percent: number | null,
): string {
  const cleanTitle = stripImageWidthMarker(title);
  if (percent === null) return cleanTitle;

  const normalized = normalizeImageWidthPercent(percent);
  if (normalized === null) return cleanTitle;

  const marker = `{mdpro-width=${normalized}%}`;
  return cleanTitle ? `${cleanTitle} ${marker}` : marker;
}

export function getImageResizeDomAttrs(node: ImageNodeLike): Record<string, string> {
  const percent = getImageWidthPercentFromTitle(node.attrs.title);
  const cleanTitle = stripImageWidthMarker(node.attrs.title);
  const attrs: Record<string, string> = {};

  if (cleanTitle) attrs.title = cleanTitle;
  if (percent !== null) {
    attrs["data-mdpro-image-width"] = `${percent}`;
    attrs.style = `width: ${percent}%; max-width: none; height: auto;`;
  }
  return attrs;
}

/**
 * Rewrite rendered HTML so that <img> elements carrying the mdpro width
 * marker in their title attribute are converted to inline width styles —
 * keeping preview and exported HTML consistent with the editor while
 * preventing the marker from leaking into image tooltips.
 *
 * The input is treated as an HTML fragment (markdown-rendered body content);
 * the result is also a fragment. Do not pass full `<html>` documents.
 */
export function applyImageWidthMarkerToHtml(html: string): string {
  if (!html.includes("{mdpro-width=")) return html;
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let mutated = false;

  doc.querySelectorAll("img[title]").forEach((img) => {
    const title = img.getAttribute("title");
    const percent = getImageWidthPercentFromTitle(title);
    if (percent === null) return;

    const cleanTitle = stripImageWidthMarker(title);
    if (cleanTitle) {
      img.setAttribute("title", cleanTitle);
    } else {
      img.removeAttribute("title");
    }
    img.setAttribute("data-mdpro-image-width", String(percent));
    img.setAttribute(
      "style",
      `width: ${percent}%; max-width: none; height: auto;`,
    );
    mutated = true;
  });

  return mutated ? doc.body.innerHTML : html;
}

export function findImageNodePosition(view: EditorView, image: HTMLImageElement): number | null {
  // Prefer ProseMirror's bias arg (-1 = before the DOM node) which lands on
  // the image node when the click target is the <img> element itself. Every
  // posAtDOM call is guarded — it throws on detached DOM during teardown.
  const candidates: number[] = [];
  const tryPos = (bias?: number) => {
    try {
      candidates.push(bias === undefined ? view.posAtDOM(image, 0) : view.posAtDOM(image, 0, bias));
    } catch {
      /* detached DOM — skip */
    }
  };
  tryPos(-1);
  tryPos();

  if (candidates.length === 0) return null;

  const base = candidates[candidates.length - 1];
  candidates.push(base - 1, base + 1);

  const seen = new Set<number>();
  for (const pos of candidates) {
    if (pos < 0 || seen.has(pos)) continue;
    seen.add(pos);
    const node = view.state.doc.nodeAt(pos) as ImageNodeLike | null;
    if (node?.type.name === "image") return pos;
  }

  return null;
}

export function getImageWidthPercentAtPos(view: EditorView, pos: number): number | null {
  const node = view.state.doc.nodeAt(pos) as ImageNodeLike | null;
  if (node?.type.name !== "image") return null;
  return getImageWidthPercentFromTitle(node.attrs.title);
}

export function setImageWidthPercentAtPos(
  view: EditorView,
  pos: number,
  percent: number | null,
): boolean {
  const node = view.state.doc.nodeAt(pos) as ImageNodeLike | null;
  if (node?.type.name !== "image") return false;

  const title = writeImageWidthMarker(node.attrs.title, percent);
  view.dispatch(
    view.state.tr
      .setNodeMarkup(pos, undefined, { ...node.attrs, title })
      .scrollIntoView(),
  );
  return true;
}
