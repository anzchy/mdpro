/**
 * D22 WI-3 — guards on the click-path settle pin: a replaced heading is not chased, a
 * static layout writes nothing, the `scrollIntoView` fallback arms nothing, a throwing
 * ResizeObserver is absorbed inside settlePin, and a non-image `load` (no `loadFilter` on
 * this path) is a harmless re-pin. Cases S-06 to S-08 of
 * `.claude/tdd-guardian/tests-20260927-112500.md`, plus review M-3.
 *
 * Boundaries: the growable geometry fixture, `ResizeObserverDouble`, fake timers, and
 * `@tauri-apps/api/core` (the real logger runs; payloads are read off `invoke`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null as unknown),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: invokeMock,
}));

import { useLoggingStore } from "../src/stores/loggingStore";
import { scrollHeadingToAnchor } from "../src/utils/scrollAnchor/milkdown";
import { mountGrowableSurface, type GrowableSurface } from "./helpers/growableScrollGeometry";
import {
  installResizeObserverDouble,
  type ResizeObserverRegistry,
} from "./helpers/resizeObserverDouble";
import { g12, landing, loadOn, settleLogs, W } from "./helpers/settlePinHarness";
import { makeHeadings, mountContainer, replaceScriptedHeading } from "./helpers/wysiwygSpyHarness";

let ro: ResizeObserverRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  ro = installResizeObserverDouble();
  invokeMock.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function containerOf(s: GrowableSurface): HTMLElement {
  const container = s.wrapper.parentElement;
  if (!container) throw new Error("surface has no container");
  return container;
}

describe("scrollHeadingToAnchor + settle pin — guards (WI-3)", () => {
  it("S-06 heading replaced mid-window — stops, does not chase", () => {
    const s = g12((i) => (i === 11 ? 1000 : 0));
    expect(scrollHeadingToAnchor(containerOf(s), s.headings[5])).toBe(true);
    expect(s.scroller.scrollTop).toBe(220);
    const { staleReads } = replaceScriptedHeading(s, 5);

    s.growBody(1, 400);
    expect(() => ro.fire()).not.toThrow();
    vi.advanceTimersByTime(W);
    expect(s.scroller.scrollTop).toBe(220);
    expect(vi.getTimerCount()).toBe(0);
    expect(staleReads(), "the detached heading is never measured").toBe(0);

    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "detached", triggers: 1, repins: 1 });
  });

  it("S-07 static layout — the pin writes nothing (idempotence)", () => {
    const container = mountContainer();
    const s = mountGrowableSurface(container, { headings: makeHeadings(8, () => 300) });
    s.setScrollTopSilently(137);
    expect(scrollHeadingToAnchor(container, s.headings[3])).toBe(true);
    expect(s.scroller.scrollTop).toBe(1016);

    let scrolls = 0;
    s.scroller.addEventListener("scroll", () => (scrolls += 1));
    ro.fire();
    ro.fire();
    ro.fire();
    loadOn(s.addImage(1));
    vi.advanceTimersByTime(W);
    expect(s.scroller.scrollTop).toBe(1016);
    expect(scrolls, "no scroll event after the click").toBe(0);

    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({
      outcome: "expired",
      triggers: 4,
      repins: 5,
      source: "toc",
    });
  });

  it("S-08a the scrollIntoView fallback arms nothing", () => {
    const container = mountContainer();
    const heading = document.createElement("h2");
    heading.textContent = "Lonely";
    heading.scrollIntoView = vi.fn();
    container.appendChild(heading); // no .ProseMirror → no Milkdown scroller

    expect(scrollHeadingToAnchor(container, heading)).toBe(true);
    expect(heading.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(W);
    expect(settleLogs(invokeMock)).toHaveLength(0);
  });

  // Relabelled per review T-6: settlePin catches the constructor throw itself, so this proves
  // that absorption (and the load fallback), not a try/catch in scrollHeadingToAnchor.
  it("S-08b a throwing ResizeObserver constructor is absorbed inside settlePin; the click returns true and lands, load still re-pins", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor() {
          throw new Error("x");
        }
      },
    );
    const s = g12((i) => (i === 11 ? 1000 : 0));
    const img = s.addImage(1);
    let result: boolean | undefined;
    expect(() => {
      result = scrollHeadingToAnchor(containerOf(s), s.headings[5]);
    }).not.toThrow();
    expect(result).toBe(true);
    expect(s.scroller.scrollTop).toBe(landing(s, 5));

    s.growBody(1, 400);
    loadOn(img);
    expect(s.scroller.scrollTop).toBe(landing(s, 5));
    expect(s.relTop(5)).toBe(40);
  });

  it("M-3 a non-image load on the click path is a harmless no-op re-pin", () => {
    const s = g12((i) => (i === 11 ? 1000 : 0));
    expect(scrollHeadingToAnchor(containerOf(s), s.headings[5])).toBe(true);
    const landed = s.scroller.scrollTop;
    expect(landed).toBe(landing(s, 5));

    const media = document.createElement("video"); // not an <img>; no loadFilter on "toc"
    s.scroller.appendChild(media);
    loadOn(media);
    expect(s.scroller.scrollTop).toBe(landed);
    expect(s.relTop(5)).toBe(40);

    vi.advanceTimersByTime(W);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "expired", source: "toc", triggers: 1 });
  });
});
