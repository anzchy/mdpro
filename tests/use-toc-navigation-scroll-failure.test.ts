/**
 * D17 final review — a WYSIWYG click whose scroll fails must not move the highlight.
 *
 * `scrollHeadingToAnchor` catches and reports false; `useTOC` then leaves
 * `activeEntryId` alone (the view did not move, so the old entry is still the truthful
 * one) and logs exactly one `ui.toc.navigate` warn carrying only ids and an index —
 * never heading text or any other document content.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import {
  active, contentOf, expectDistinctKeys, installIoDetector, keyAt, makeHeadings,
  mountContainer, mountSurface, renderSpy, resetTocStore, tick,
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
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function warnPayloads(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .map((call: unknown[]) => call[0] as Record<string, unknown>)
    .filter((p: Record<string, unknown>) => p.level === "warn");
}

describe("WYSIWYG navigation when the scroll throws", () => {
  it("leaves activeEntryId unchanged and logs exactly one content-free warn", () => {
    const dom = makeHeadings(8);
    const container = mountContainer();
    const surface = mountSurface(container, { headings: dom });
    const { result } = renderSpy({ content: contentOf(dom), documentId: "doc-a" });
    tick(300);
    expectDistinctKeys("setup", dom.length);
    const before = active();
    expect(before, "fixture: arm-time key").toBe(keyAt(0));
    surface.scroller.scrollTo = (() => {
      throw new Error("scrollTo failed");
    }) as HTMLElement["scrollTo"];
    logSpy.mockClear();

    act(() => result.current.navigateToEntry(keyAt(5)!));

    expect(active(), "no highlight move on a failed scroll").toBe(before);
    const warns = warnPayloads();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      level: "warn",
      event: "ui.toc.navigate",
      status: "fail",
      context: { documentId: "doc-a", entryIndex: 5, entryKey: keyAt(5) },
    });
    expect(JSON.stringify(warns[0]), "no heading text in the log").not.toContain("Section");
  });
});
