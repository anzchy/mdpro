/**
 * WI-3.6.2 §5 (part 2 of 2) — the no-op and idempotence cases of `useTOC#scrollToHeading`
 * (WYSIWYG branch), asserted on `scrollTop`: N-3, N-5, N-6, N-7. Part 1 (R1, N-L1, N-2,
 * N-8, N-4) is `tests/use-toc-navigation-identity-landing.test.ts`; its header carries the
 * D17 WI-5 migration reason, which applies here verbatim.
 *
 * Vacuous-pass fix (matrix §5 migration table): before WI-5 these no-op cases asserted
 * `receivers.length === 0`, which any implementation that stops calling `scrollIntoView`
 * satisfies. Each no-op now starts from a non-zero `scrollTop` and carries a POSITIVE guard
 * on the same fixture that does move it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import { SPY_ANCHOR_OFFSET_PX as ANCHOR } from "../src/utils/codemirrorViewportLine";
import {
  appendModalTitle, landing, mismatchLogsOf, PRESET_SCROLL_TOP, setProseMirror, setupNavigation,
} from "./helpers/navigationLandingHarness";
import {
  active, entries, expectDistinctKeys, frame, installIoDetector, recordWrites, resetTocStore,
} from "./helpers/wysiwygSpyHarness";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  installIoDetector();
  logSpy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
  resetTocStore();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const mismatchLogs = () => mismatchLogsOf(logSpy.mock.calls);

describe("§5 useTOC#scrollToHeading — WYSIWYG no-ops and idempotence", () => {
  it("N-3: modal hazard with .ProseMirror ABSENT — scrollTop and key unchanged", () => {
    let modalTitle: HTMLElement | null = null;
    const { container, surface, navigate } = setupNavigation(
      [{ level: 3, text: "Insert Link" }],
      "### Insert Link",
      {
        bodyHeight: 1400,
        beforeRender: (c, s) => {
          setProseMirror(s, false);
          modalTitle = appendModalTitle(c, s, "Insert Link", 900);
        },
      },
    );
    const list = entries();
    expect(list).toHaveLength(1);
    // Wrong-reason guards: the modal heading really is inside the container, and its
    // text really does match the entry, so "no scroll" is not trivially true.
    expect(container.contains(modalTitle)).toBe(true);
    expect(modalTitle!.textContent).toBe(list[0].text);

    navigate(list[0].key);
    expect(surface.scroller.scrollTop).toBe(PRESET_SCROLL_TOP);
    expect(active()).toBeNull();
    expect(mismatchLogs()).toHaveLength(1);

    // Positive guard: the same fixture with `.ProseMirror` present moves `scrollTop`.
    setProseMirror(surface, true);
    navigate(list[0].key);
    expect(surface.scroller.scrollTop).toBe(landing(surface, 0));
    expect(surface.scroller.scrollTop).not.toBe(PRESET_SCROLL_TOP);
  });

  it("N-5: tier 3 — no .ProseMirror is a no-op, and the log fires exactly once", () => {
    const { surface, navigate, rerender } = setupNavigation(
      [{ level: 1, text: "A" }, { level: 1, text: "B" }],
      "# A\n\n# B",
      { beforeRender: (_c, s) => setProseMirror(s, false) },
    );
    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys("N-5");

    navigate(list[0].key);
    navigate(list[1].key);
    rerender({ content: "# A\n\n# B", documentId: "doc-a", viewMode: "wysiwyg" });
    navigate(list[0].key);
    navigate(list[1].key);

    expect(surface.scroller.scrollTop).toBe(PRESET_SCROLL_TOP);
    expect(active()).toBeNull();
    const logs = mismatchLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("warn");
    expect(logs[0].status).toBe("fail");
    expect(logs[0].context).toEqual({ documentId: "doc-a", entryCount: 2, domCount: 0, resolvedCount: 0 });

    // Positive guard, as in N-3.
    setProseMirror(surface, true);
    navigate(list[1].key);
    expect(surface.scroller.scrollTop).toBe(landing(surface, 1));
  });

  it("N-6: LAW idempotence — three navigations, one landing, no store write after the first", () => {
    const { surface, navigate } = setupNavigation(
      [{ level: 1, text: "Intro", id: "intro" }, { level: 1, text: "Intro", id: "intro-#2" }],
      "# Intro\n\n# Intro",
    );
    const before = surface.proseMirror.innerHTML;
    const list = entries();
    expectDistinctKeys("N-6");

    const rec = recordWrites();
    const landed: number[] = [];
    const writesAfter: number[] = [];
    for (let i = 0; i < 3; i++) {
      navigate(list[1].key);
      frame();
      landed.push(surface.scroller.scrollTop);
      writesAfter.push(rec.writes.length);
      expect(active(), `navigation ${i + 1}`).toBe(list[1].key);
    }
    rec.stop();

    expect(landed).toEqual([landing(surface, 1), landing(surface, 1), landing(surface, 1)]);
    expect(writesAfter[0], "the first navigation writes").toBeGreaterThan(0);
    expect(writesAfter[2], "no write after the first").toBe(writesAfter[0]);
    // D2 — nothing is written to the DOM.
    expect(surface.proseMirror.innerHTML).toBe(before);
  });

  it("N-7: partially resolved document — the unresolved entry is a no-op, resolution is fresh", () => {
    const { surface, navigate } = setupNavigation(
      [{ level: 1, text: "Intro", id: "intro" }, { level: 1, text: "Tail", id: "tail" }],
      "# Intro\n\n# Intro\n\n# Tail",
      // Spy off: nothing but navigation itself can resolve or move anything.
      { spy: false },
    );
    const list = entries();
    expect(list).toHaveLength(3);
    expectDistinctKeys("N-7");
    // Wrong-reason guard: entry 1's text IS present in the DOM.
    expect(surface.headings[0].textContent).toBe("Intro");
    expect(list[1].text).toBe("Intro");

    // Part A
    navigate(list[2].key);
    expect(surface.scroller.scrollTop, "positive guard: entry 2 lands").toBe(landing(surface, 1));
    const activeBefore = active();
    navigate(list[1].key);
    expect(surface.scroller.scrollTop, "unresolved → unchanged").toBe(landing(surface, 1));
    expect(active()).toBe(activeBefore);
    navigate(list[0].key);
    expect(surface.scroller.scrollTop).toBe(landing(surface, 0));

    // Part B — heading 0 replaced by a new element at a DIFFERENT offset, no re-render.
    const NEW_OFFSET = 400;
    const original = surface.headings[0];
    const fresh = document.createElement("h1");
    fresh.textContent = "Intro";
    fresh.getBoundingClientRect = () => {
      const top = surface.rootTop + NEW_OFFSET - surface.scroller.scrollTop;
      return { top, bottom: top + 40, height: 40, left: 0, right: 0, width: 0, x: 0, y: top } as DOMRect;
    };
    original.replaceWith(fresh);
    expect(document.contains(fresh)).toBe(true);
    expect(NEW_OFFSET - ANCHOR).not.toBe(landing(surface, 0));

    navigate(list[0].key);
    expect(surface.scroller.scrollTop).toBe(NEW_OFFSET - ANCHOR);
  });
});
