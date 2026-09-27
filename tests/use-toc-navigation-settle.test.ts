/**
 * D22 WI-3 — through `useTOC`: an outline click in WYSIWYG mode keeps the heading on the
 * anchor line while images settle, and the spy then highlights the clicked entry.
 * Cases S-09 and S-10 of `.claude/tdd-guardian/tests-20260927-112500.md`.
 *
 * Setup is `tests/use-toc-navigation-wysiwyg-landing.test.ts`'s, with the growable
 * fixture in place of `mountSurface`. Real: `useTOC`, `tocStore`, `useWysiwygScrollSpy`,
 * `scrollHeadingToAnchor` and the settle pin. Boundaries: geometry, `ResizeObserverDouble`
 * (the spy's observer gets the same `fire()`), fake timers, and `@tauri-apps/api/core`
 * (the real logger runs; its `invoke` is the boundary, as in the other settle suites).
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null as unknown),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: invokeMock,
}));

import type { HeadingKey } from "../src/types/toc";
import { mountGrowableSurface } from "./helpers/growableScrollGeometry";
import {
  installResizeObserverDouble,
  type ResizeObserverRegistry,
} from "./helpers/resizeObserverDouble";
import type { ScriptedHeading } from "./helpers/scriptedScrollGeometry";
import { loadOn } from "./helpers/settlePinHarness";
import {
  active, contentOf, expectDistinctKeys, frame, installIoDetector, keyAt, makeHeadings,
  mountContainer, renderSpy, resetTocStore, tick,
} from "./helpers/wysiwygSpyHarness";

let ro: ResizeObserverRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  installIoDetector();
  ro = installResizeObserverDouble();
  invokeMock.mockClear();
  resetTocStore();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function setup(dom: ScriptedHeading[], withImages = false) {
  const container = mountContainer();
  const surface = mountGrowableSurface(container, { headings: dom, rootTop: 90, viewHeight: 660 });
  const images = withImages ? dom.map((_, i) => surface.addImage(i)) : [];
  const { result } = renderSpy({ content: contentOf(dom), documentId: "doc-a" });
  tick(300);
  expectDistinctKeys("setup", dom.length);
  const navigate = (key: HeadingKey) => act(() => result.current.navigateToEntry(key));
  return { surface, images, navigate };
}

describe("useTOC navigation + settle pin (WI-3)", () => {
  it("S-09 navigate, growth, trigger: the heading is on the line and highlighted", () => {
    const { surface, navigate } = setup(makeHeadings(12, (i) => (i === 11 ? 1000 : 0)));
    navigate(keyAt(5)!);
    expect(surface.relTop(5), "fixture guard: landed").toBe(40);
    frame();
    expect(active()).toBe(keyAt(5));

    surface.growBody(1, 400);
    surface.growBody(2, 400);
    surface.growBody(3, 400);
    ro.fire();
    frame();
    expect(surface.relTop(5)).toBe(40);
    expect(active()).toBe(keyAt(5));
  });

  it("S-10 H09 on a short document, then a load below it", () => {
    const { surface, images, navigate } = setup(makeHeadings(12, () => 0), true);
    expect(surface.maxScrollTop()).toBe(0); // fixture guard: H09 is limited
    navigate(keyAt(9)!);
    frame();
    expect(active()).toBe(keyAt(9));

    for (let i = 0; i <= 7; i++) surface.growBody(i, 400);
    surface.growBody(11, 1000);
    loadOn(images[11]);
    frame();
    expect(surface.relTop(9)).toBe(40);
    expect(active()).toBe(keyAt(9));
  });
});
