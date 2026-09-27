/**
 * @module milkdown-find-scroller.test
 * Purpose: pin `findMilkdownScrollerIn(container)` (D17 WI-2) — the view-less
 * lookup of the WYSIWYG scroller. F-1 is the DOM-shape table; F-2 proves it
 * agrees with `resolveMilkdownScroller(view)` on a real Milkdown mount across
 * create → destroy → re-create.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn() }));

import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { findMilkdownScrollerIn, resolveMilkdownScroller } from "../src/utils/scrollAnchor/milkdown";

afterEach(() => {
  document.body.innerHTML = "";
});

function el(tag: string, className?: string, ...children: HTMLElement[]): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) node.appendChild(child);
  return node;
}

function containerOf(...children: HTMLElement[]): HTMLElement {
  const container = el("div", undefined, ...children);
  container.id = "milkdown-container";
  return container;
}

describe("F-1 findMilkdownScrollerIn shape table", () => {
  it("(a) container > div > div.milkdown > .ProseMirror → that div.milkdown", () => {
    const scroller = el("div", "milkdown", el("div", "ProseMirror"));
    const container = containerOf(el("div", undefined, scroller));
    document.body.appendChild(container);
    expect(findMilkdownScrollerIn(container)).toBe(scroller);
  });

  it("(b) no .ProseMirror → null", () => {
    const container = containerOf(el("div", undefined, el("div", "milkdown")));
    document.body.appendChild(container);
    expect(findMilkdownScrollerIn(container)).toBeNull();
  });

  it("(c) .ProseMirror directly in the container → null (no fallback to the container)", () => {
    const container = containerOf(el("div", "ProseMirror"));
    document.body.appendChild(container);
    expect(findMilkdownScrollerIn(container)).toBeNull();
  });

  it("(d) parent of .ProseMirror lacks .milkdown, stray .milkdown elsewhere → null", () => {
    const stray = el("div", "milkdown");
    const container = containerOf(stray, el("div", "wrapper", el("div", "ProseMirror")));
    document.body.appendChild(container);
    expect(findMilkdownScrollerIn(container)).toBeNull();
  });

  it("(e) a detached container follows the shape rules without throwing", () => {
    const scroller = el("div", "milkdown", el("div", "ProseMirror"));
    const good = containerOf(el("div", undefined, scroller));
    const bad = containerOf(el("div", "ProseMirror"));
    expect(good.isConnected).toBe(false);
    expect(() => findMilkdownScrollerIn(good)).not.toThrow();
    expect(findMilkdownScrollerIn(good)).toBe(scroller);
    expect(findMilkdownScrollerIn(bad)).toBeNull();
  });
});

describe("F-2 agreement with resolveMilkdownScroller on a real Milkdown mount", () => {
  async function create(root: HTMLElement): Promise<Editor> {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, "# Title\n\npara\n\n## Two\n");
      })
      .use(commonmark)
      .create();
  }

  it("holds across create → destroy → re-create", async () => {
    const root = document.createElement("div");
    const container = containerOf(root);
    document.body.appendChild(container);

    const first = await create(root);
    const firstView = first.action((ctx) => ctx.get(editorViewCtx));
    const firstScroller = findMilkdownScrollerIn(container);
    expect(firstScroller).not.toBeNull();
    expect(firstScroller).toBe(resolveMilkdownScroller(firstView));

    await first.destroy();
    expect(findMilkdownScrollerIn(container)).toBeNull();

    const second = await create(root);
    const secondView = second.action((ctx) => ctx.get(editorViewCtx));
    const secondScroller = findMilkdownScrollerIn(container);
    expect(secondScroller).not.toBeNull();
    expect(secondScroller).toBe(resolveMilkdownScroller(secondView));
    expect(secondScroller).not.toBe(firstScroller);

    await second.destroy();
  });
});
