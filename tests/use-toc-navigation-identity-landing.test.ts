/**
 * WI-3.6.2 §5 (part 1 of 2) — `useTOC#scrollToHeading` (WYSIWYG branch) addresses the DOM
 * through `resolveHeadingElements`, asserted on WHERE the scroller lands: R1, N-L1, N-2,
 * N-8(a/b), N-4. Part 2 (N-3, N-5, N-6, N-7) is
 * `tests/use-toc-navigation-identity-landing-guards.test.ts`.
 *
 * Moved out of `tests/use-toc-navigation-identity.test.ts` and migrated in D17 WI-5
 * (`.claude/tdd-guardian/tests-20260922-210708.md`, "Migration of existing cases", §5).
 * Stated reason (rule 12): *WYSIWYG navigation lands at heading top −
 * SPY_ANCHOR_OFFSET_PX, instant (decision log, N-W5; ADR-0026); the implementation need
 * not call `scrollIntoView`, so landing is asserted on `scrollTop`.* The `{behavior,
 * block}` options assertion R1 carried is dropped.
 *
 * Element identity is proved by DISTINCT content offsets on a `scriptedScrollGeometry`
 * surface (`landing(i)` in `tests/helpers/navigationLandingHarness.ts`). `scrollTop` starts
 * at a non-zero preset, so navigating to a landing of 0 is a visible move.
 * The WYSIWYG-landing law itself (N-W1…N-W6) is `use-toc-navigation-wysiwyg-landing.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import { SPY_ANCHOR_OFFSET_PX as ANCHOR } from "../src/utils/codemirrorViewportLine";
import { resolveHeadingElements } from "../src/utils/tocElementResolution";
import {
  appendModalTitle, landing, mismatchLogsOf, PRESET_SCROLL_TOP, setupNavigation,
  type NavSpec,
} from "./helpers/navigationLandingHarness";
import {
  active, entries, expectDistinctKeys, installIoDetector, resetTocStore, scrollAndFrame,
  scrollHeadingTo,
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

const INTRO_TWICE: NavSpec[] = [
  { level: 1, text: "Intro", id: "intro" }, // measured
  { level: 1, text: "Intro", id: "intro-#2" }, // measured
];
const INTRO_TWICE_CONTENT = "# Intro\n\n# Intro";

describe("§5 useTOC#scrollToHeading — WYSIWYG landing", () => {
  it("R1: REGRESSION — the n-th duplicate lands at the n-th element", () => {
    const { surface, navigate } = setupNavigation(INTRO_TWICE, INTRO_TWICE_CONTENT);
    const list = entries();
    expect(list).toHaveLength(2);
    expectDistinctKeys("R1");
    // Wrong-reason guard: a jsdom without CSS.escape would make HEAD throw.
    expect(typeof CSS?.escape).toBe("function");
    expect(landing(surface, 1)).not.toBe(landing(surface, 0));

    navigate(list[1].key);
    expect(surface.scroller.scrollTop).toBe(landing(surface, 1));
    expect(active()).toBe(list[1].key);

    navigate(list[0].key);
    expect(surface.scroller.scrollTop).toBe(landing(surface, 0));
    expect(active()).toBe(list[0].key);
  });

  it("N-L1: LAW injectivity through the hook — 5 identical headings, 5 distinct landings", () => {
    // ids: `intro`, `intro-#2` measured; `-#3`…`-#5` DERIVED from the measured scheme.
    const specs: NavSpec[] = [1, 2, 3, 4, 5].map((n) => ({
      level: 1,
      text: "Intro",
      id: n === 1 ? "intro" : `intro-#${n}`,
    }));
    const { surface, navigate } = setupNavigation(specs, Array(5).fill("# Intro").join("\n\n"));
    const list = entries();
    expect(list).toHaveLength(5);
    expectDistinctKeys("N-L1");

    const landed = list.map((entry) => {
      navigate(entry.key);
      return surface.scroller.scrollTop;
    });
    expect(new Set(landed).size).toBe(5);
    // Order, not merely distinctness: a permutation satisfies distinctness alone.
    expect(landed).toEqual(list.map((_, i) => landing(surface, i)));
  });

  it("N-2: punctuation document — every entry lands at its own element", () => {
    // `hello,-world!`, `q&a`, `foo_bar` measured; `api-reference-(v2)` and `🎉` DERIVED.
    const specs: NavSpec[] = [
      { level: 1, text: "Hello, World!", id: "hello,-world!" },
      { level: 1, text: "Q&A", id: "q&a" },
      { level: 1, text: "foo_bar", id: "foo_bar" },
      { level: 1, text: "API Reference (v2)", id: "api-reference-(v2)" },
      { level: 1, text: "🎉", id: "🎉" },
    ];
    const { surface, navigate } = setupNavigation(specs, specs.map((s) => `# ${s.text}`).join("\n\n"));
    const list = entries();
    expect(list).toHaveLength(5);
    expectDistinctKeys("N-2");
    // Wrong-reason guard: the case must not pass by the two namespaces agreeing.
    const divergences = list.filter((e, i) => (e.anchorSlug as string) !== surface.headings[i].id);
    expect(divergences.length).toBeGreaterThanOrEqual(4);

    const landed = list.map((entry) => {
      navigate(entry.key);
      return surface.scroller.scrollTop;
    });
    expect(landed).toEqual(list.map((_, i) => landing(surface, i)));
  });

  const collisions: Array<[string, NavSpec[], string]> = [
    // `foo_bar` measured; `foo-bar` DERIVED (whitespace→hyphen) — §0.5's two added rows.
    [
      "N-8(a) foo_bar / foo bar",
      [{ level: 1, text: "foo_bar", id: "foo_bar" }, { level: 1, text: "foo bar", id: "foo-bar" }],
      "# foo_bar\n\n# foo bar",
    ],
    // The same collision by the empty-base route (DERIVED).
    [
      "N-8(b) 🎉 / Heading",
      [{ level: 1, text: "🎉", id: "🎉" }, { level: 1, text: "Heading", id: "heading" }],
      "# 🎉\n\n# Heading",
    ],
  ];
  for (const [name, specs, content] of collisions) {
    it(`${name}: an id/slug collision lands at the entry's own element, and the spy keys it`, () => {
      const { container, surface, navigate } = setupNavigation(specs, content);
      const list = entries();
      expect(list).toHaveLength(2);
      expectDistinctKeys(name);
      // LOAD-BEARING wrong-reason guard: if Milkdown's id generator ever changes, the
      // collision disappears and this case must fail loudly rather than pass vacuously.
      expect(list[0].anchorSlug as string).toBe(surface.headings[1].id);
      expect(surface.scroller.scrollTop).toBe(PRESET_SCROLL_TOP);

      navigate(list[0].key);
      expect(surface.scroller.scrollTop).toBe(landing(surface, 0));
      expect(surface.scroller.scrollTop).not.toBe(landing(surface, 1));
      expect([...resolveHeadingElements(list, container).byKey.values()]).toEqual(surface.headings);

      // Site 3, through the hook: an id fast path in the spy would mis-key the highlight
      // (the observe-loop arm of the original N-8, now the frame's resolved list).
      scrollHeadingTo(surface, 1, ANCHOR);
      expect(active(), "heading 1 at the anchor").toBe(list[1].key);
      scrollAndFrame(surface, 0);
      expect(active(), "heading 0 at the top").toBe(list[0].key);
    });
  }

  it("N-4: modal hazard with .ProseMirror PRESENT — lands at the <h1>, never the modal title", () => {
    const MODAL_OFFSET = 600;
    const { surface, navigate } = setupNavigation([{ level: 1, text: "Doc", id: "doc" }], "# Doc", {
      bodyHeight: 1400,
      beforeRender: (container, s) => {
        appendModalTitle(container, s, "Insert Link", MODAL_OFFSET);
      },
    });
    const list = entries();
    expect(list).toHaveLength(1);
    expect(MODAL_OFFSET - ANCHOR, "fixture: the modal's landing is reachable").toBeLessThan(
      surface.maxScrollTop(),
    );

    navigate(list[0].key);
    expect(surface.scroller.scrollTop).toBe(landing(surface, 0));
    expect(surface.scroller.scrollTop).not.toBe(MODAL_OFFSET - ANCHOR);
    expect(surface.scroller.scrollTop).not.toBe(MODAL_OFFSET);
    // Counting container-wide headings for the mismatch signature while resolving
    // inside .ProseMirror would log on every pass whenever a modal is open.
    expect(mismatchLogs()).toHaveLength(0);
  });
});
