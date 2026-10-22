/**
 * Purpose: a REAL Milkdown editor (mdpro's commonmark preset + gfm and the ADR-0091
 * empty-paragraph edge serializer, as MilkdownEditor.tsx registers them)
 * mounted in jsdom, with its block geometry scripted from a per-block height table that
 * can grow after the first scroll write (D22 WI-1). Modelled on the adapter rig in
 * `tests/scroll-anchor-correspondence.test.ts` (which stays unedited); contract: WI-1 of
 * `.claude/tdd-guardian/tests-20260927-112500.md`. Log-free: callers mock only
 * `@tauri-apps/api/*`, as `tests/use-wysiwyg-scroll-spy-d21-milkdown.test.tsx` does.
 *
 * Geometry (top-level block k = the k-th child of `view.state.doc`):
 * - Block k's content offset is `Σ_{j<k} (height(j) + margin)`; `scrollHeight` is the same
 *   sum over every block (live getter on the scroller and on the rig).
 * - Scroller (`div.milkdown`, the parent of `view.dom`) rect top = `rootTop`, height =
 *   `viewHeight` (= `clientHeight`). `view.dom` rect top = `rootTop − scrollTop`.
 * - Block k's rect: top `rootTop + offset(k) − scrollTop`, height `height(k)`, read live.
 * - Every content `<img>` inside block k reports block k's rect (an image paragraph is as
 *   tall as its image). ProseMirror's `img.ProseMirror-separator` is not a content image:
 *   `images(k)` excludes it and it keeps jsdom's zero rect.
 * - The scripted readers are installed on the elements `view.nodeDOM` returns at mount.
 *   If ProseMirror re-renders a block, call `rescript()` to script the new elements.
 *
 * Growth rule — `growBlock(k, px)` (px ≥ 0, finite): block k's height grows by `px`, so
 * blocks k+1 and later move down by `px`. `scrollTop` is NOT changed and NO `scroll`
 * event is dispatched — WebKit without scroll anchoring.
 *
 * Scroll writes: the `scrollTop` setter clamps to `[0, maxScrollTop()]` (the current limit)
 * and dispatches ONE `scroll` event synchronously, inside the write, only when the clamped
 * value changed — the same rule as `growableScrollGeometry` (F4). `scrollTo({ top })` writes
 * the same way. `setScrollTopSilently` presets the position with no event.
 *
 * Mount with real timers (Milkdown's create is async); fake timers may take over after.
 */
import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { underlineMarkPlugin } from "../../src/plugins/milkdown/underlineMarkPlugin";
import { typoraKeymapMilkdownPlugin } from "../../src/plugins/milkdown/typoraKeymapPlugin";
import type { EditorView } from "@milkdown/kit/prose/view";
import { mdproCommonmark } from "../../src/plugins/milkdown/commonmarkPreset";
import { emptyParagraphEdgeSerializerPlugins } from "../../src/plugins/milkdown/emptyParagraph";

export interface MilkdownRigOptions {
  /** Height of each top-level block, px. Its length must equal the doc's childCount. */
  heights: readonly number[];
  /** Gap below every block, px. Default 20. */
  margin?: number;
  /** Viewport y of the scroller's top edge. Default 90. */
  rootTop?: number;
  /** Scroller `clientHeight`. Default 600. */
  viewHeight?: number;
  /** Where to mount; default a fresh div appended to `document.body`. */
  container?: HTMLElement;
}

export interface MilkdownRig {
  editor: Editor;
  view: EditorView;
  /** The `div.milkdown` around `view.dom`. */
  scroller: HTMLElement;
  /** Live content height. */
  readonly scrollHeight: number;
  /** Block k's current rect (uncounted peek; the same value its element reports). */
  blockRect(k: number): DOMRect;
  /** The DOM element ProseMirror renders for top-level block k. */
  blockElement(k: number): HTMLElement;
  /** The content `<img>` elements inside block k (never `img.ProseMirror-separator`). */
  images(k: number): HTMLImageElement[];
  /** Grow block k by px: later blocks move down; no scrollTop write, no scroll event. */
  growBlock(k: number, px: number): void;
  maxScrollTop(): number;
  /** A scrollTop write (clamped; one synchronous scroll event when it changed). */
  setScrollTop(value: number): void;
  setScrollTopSilently(value: number): void;
  /** Re-install the scripted readers on the current block and image elements. */
  rescript(): void;
  destroy(): Promise<void>;
}

const DEFAULT_MARGIN = 20;
const DEFAULT_ROOT_TOP = 90;
const DEFAULT_VIEW_HEIGHT = 600;
const WIDTH = 700;
/** Content images only: ProseMirror appends an `img.ProseMirror-separator` after a
 * textblock ending in an inline image (a cursor hack, not content). */
const CONTENT_IMAGE_SELECTOR = "img:not(.ProseMirror-separator)";

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: WIDTH, width: WIDTH, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

export async function mountScriptedMilkdownRig(
  markdown: string,
  options: MilkdownRigOptions,
): Promise<MilkdownRig> {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const rootTop = options.rootTop ?? DEFAULT_ROOT_TOP;
  const viewHeight = options.viewHeight ?? DEFAULT_VIEW_HEIGHT;
  const root = options.container ?? document.body.appendChild(document.createElement("div"));

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(mdproCommonmark)
    .use(gfm)
    .use(history)
    .use(underlineMarkPlugin)
    .use(typoraKeymapMilkdownPlugin)
    .use(emptyParagraphEdgeSerializerPlugins)
    .create();
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const scroller = view.dom.parentElement;
  if (!scroller || !scroller.classList.contains("milkdown")) {
    await editor.destroy();
    throw new Error("scriptedMilkdownRig: view.dom has no div.milkdown parent");
  }
  const count = view.state.doc.childCount;
  if (options.heights.length !== count) {
    await editor.destroy();
    throw new Error(`scriptedMilkdownRig: ${options.heights.length} heights for ${count} blocks`);
  }

  const heights = [...options.heights];
  const offset = (k: number) => {
    let y = 0;
    for (let j = 0; j < k; j++) y += heights[j] + margin;
    return y;
  };
  const scrollHeight = () => offset(count);
  const maxScrollTop = () => Math.max(0, scrollHeight() - viewHeight);
  const clamp = (v: number) => Math.max(0, Math.min(v, maxScrollTop()));

  let scrollTop = 0;
  const write = (value: number) => {
    const next = clamp(value);
    if (next === scrollTop) return;
    scrollTop = next;
    scroller.dispatchEvent(new Event("scroll"));
  };
  Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrollTop, set: write });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => viewHeight });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: scrollHeight });
  scroller.scrollTo = ((arg?: ScrollToOptions | number, y?: number) => {
    write(typeof arg === "number" ? (y ?? scrollTop) : (arg?.top ?? scrollTop));
  }) as HTMLElement["scrollTo"];
  scroller.getBoundingClientRect = () => rect(rootTop, viewHeight);
  view.dom.getBoundingClientRect = () => rect(rootTop - scrollTop, scrollHeight());

  const checkIndex = (k: number, what: string) => {
    if (!Number.isInteger(k) || k < 0 || k >= count) {
      throw new Error(`${what}: no block ${k} (have ${count})`);
    }
  };
  const blockRect = (k: number) => {
    checkIndex(k, "blockRect");
    return rect(rootTop + offset(k) - scrollTop, heights[k]);
  };
  const blockElement = (k: number) => {
    checkIndex(k, "blockElement");
    let found: HTMLElement | null = null;
    let i = 0;
    view.state.doc.forEach((_node, pos) => {
      if (i++ === k) found = view.nodeDOM(pos) as HTMLElement | null;
    });
    if (!found) throw new Error(`blockElement: block ${k} has no DOM`);
    return found as HTMLElement;
  };
  const images = (k: number) =>
    Array.from(blockElement(k).querySelectorAll<HTMLImageElement>(CONTENT_IMAGE_SELECTOR));

  const rescript = () => {
    for (let k = 0; k < count; k++) {
      const reader = () => blockRect(k);
      blockElement(k).getBoundingClientRect = reader;
      for (const img of images(k)) img.getBoundingClientRect = reader;
    }
  };
  rescript();

  return {
    editor,
    view,
    scroller,
    get scrollHeight() {
      return scrollHeight();
    },
    blockRect,
    blockElement,
    images,
    growBlock: (k, px) => {
      checkIndex(k, "growBlock");
      if (!Number.isFinite(px) || px < 0) throw new Error(`growBlock: px must be ≥ 0, got ${px}`);
      heights[k] += px; // no scrollTop write, no scroll event
    },
    maxScrollTop,
    setScrollTop: write,
    setScrollTopSilently: (v) => {
      scrollTop = clamp(v);
    },
    rescript,
    destroy: async () => {
      await editor.destroy();
    },
  };
}
