/**
 * D21 — no false `ui.toc.resolve.mismatch` before `.ProseMirror` mounts. Matrix: WI-1 of
 * `.claude/tdd-guardian/tests-20260927-104500.md` (R-D21-1…R-D21-4).
 *
 * Release log: every Source→WYSIWYG switch warned once with `domCount: 0`, because the
 * spy's initial pass runs before `@milkdown/react` inserts `.ProseMirror`. The rule under
 * test: no `.ProseMirror` in the container ⇒ no report, whether the pass is initial or a
 * re-arm; such a pass neither warns nor moves the D7 signature. A pass that has
 * `.ProseMirror` still warns once per changed `(entryCount, domCount)` signature.
 *
 * Real: `useTOC` → `useWysiwygScrollSpy` → `reportResolveMismatch`, jsdom DOM and its
 * `MutationObserver`. Scripted: layout (`scriptedScrollGeometry`), rAF (fake timers), the
 * ResizeObserver (R-D21-3's positive guard), and the log sink (a no-op spy).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import type { TOCEntry } from "../src/types/toc";
import { mountMilkdownDom } from "./helpers/milkdownHeadingDom";
import { mismatchLogsOf } from "./helpers/navigationLandingHarness";
import { installResizeObserverDouble } from "./helpers/resizeObserverDouble";
import type { ScriptedHeading } from "./helpers/scriptedScrollGeometry";
import {
  active, entries, expectDistinctKeys, flushMutations, installIoDetector, mountContainer,
  mountSurface, renderSpy, replaceScriptedHeading, resetTocStore, scrollHeadingTo, tick,
} from "./helpers/wysiwygSpyHarness";

const THREE_CONTENT = "# Alpha\n\n## Beta\n\n## Gamma";
const SCRIPTED: ScriptedHeading[] = [
  { level: 1, text: "Alpha", height: 48, bodyHeight: 400 },
  { level: 2, text: "Beta", height: 40, bodyHeight: 400 },
  { level: 2, text: "Gamma", height: 40, bodyHeight: 800 },
];

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

const logs = () => mismatchLogsOf(logSpy.mock.calls);
const sigs = () =>
  logs().map((p) => {
    const c = p.context as { entryCount: number; domCount: number };
    return { entryCount: c.entryCount, domCount: c.domCount };
  });

/** `@milkdown/react`'s mount: one `.ProseMirror` with its headings, in ONE insert. */
function insertProseMirror(container: HTMLElement, texts: readonly string[]): HTMLElement {
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  for (const text of texts) {
    const h = document.createElement("h2");
    h.textContent = text;
    pm.appendChild(h);
  }
  container.appendChild(pm);
  return pm;
}

function removeProseMirror(container: HTMLElement): void {
  container.querySelector(".ProseMirror")?.remove();
}

describe("D21 — no .ProseMirror in the container ⇒ no mismatch report", () => {
  it("R-D21-1: Source→WYSIWYG over an empty container logs nothing; the late surface still drives the highlight", async () => {
    const container = mountContainer();
    const { rerender } = renderSpy({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "source" });
    tick(300);
    expectDistinctKeys("R-D21-1", 3);
    const before = entries();

    rerender({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    expect(entries()).toBe(before); // identity guard: nothing but the DOM can re-arm
    expect(logs()).toEqual([]);

    const surface = mountSurface(container, { headings: SCRIPTED });
    await flushMutations();
    scrollHeadingTo(surface, 2, 10);

    expect(logs()).toEqual([]);
    expect(active()).toBe(entries()[2].key); // positive guard: the spy really armed
  });

  it("R-D21-2: D7 still fires after a late mount — once per signature, exact payload", async () => {
    const container = mountContainer();
    renderSpy({ content: THREE_CONTENT, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    expect(sigs()).toEqual([]);

    const surface = mountSurface(container, {
      headings: [...SCRIPTED, { level: 2, text: "Extra", height: 40, bodyHeight: 400 }],
    });
    await flushMutations();
    const first = logs();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ level: "warn", status: "fail" });
    expect(typeof first[0].actionId).toBe("string");
    expect(first[0].context).toEqual({ documentId: "doc-a", entryCount: 3, domCount: 4, resolvedCount: 3 });

    replaceScriptedHeading(surface, 1); // new element, same 3:4 signature
    await flushMutations();
    expect(logs()).toHaveLength(1);
  });

  it("R-D21-3: LAW — absent-.ProseMirror passes are transparent to edge-triggered emission", async () => {
    const ro = installResizeObserverDouble();
    const M = ["Alpha", "Beta", "Gamma"];
    const A = [...M, "Extra"];
    const B = [...A, "Extra2"];
    const container = mountContainer();
    const props = { content: THREE_CONTENT, documentId: "doc-a" };
    const { rerender } = renderSpy({ ...props, viewMode: "source" });
    tick(300);
    expectDistinctKeys("R-D21-3", 3);
    const list: TOCEntry[] = entries();

    const mode = (viewMode: "source" | "wysiwyg") => {
      rerender({ ...props, viewMode });
      tick(300);
    };
    const swap = async (dom: string[] | null) => {
      removeProseMirror(container);
      await flushMutations(); // flush BETWEEN remove and insert: the absent re-arm runs
      if (dom) insertProseMirror(container, dom);
      await flushMutations();
    };
    const cycle = (dom: string[]) => async () => {
      mode("source");
      removeProseMirror(container);
      await flushMutations();
      mode("wysiwyg");
      insertProseMirror(container, dom);
      await flushMutations();
    };
    type Step = { run: () => Promise<void> | void; pm: boolean; wysiwyg: boolean; dom?: string[] };
    const STEPS: Step[] = [
      { run: () => mode("wysiwyg"), pm: false, wysiwyg: true }, // 1
      { run: async () => { insertProseMirror(container, M); await flushMutations(); }, pm: true, wysiwyg: true, dom: M }, // 2
      { run: () => swap(null), pm: false, wysiwyg: true }, // 3
      { run: async () => { insertProseMirror(container, A); await flushMutations(); }, pm: true, wysiwyg: true, dom: A }, // 4
      { run: async () => { mode("source"); removeProseMirror(container); await flushMutations(); }, pm: false, wysiwyg: false }, // 5
      { run: () => mode("wysiwyg"), pm: false, wysiwyg: true }, // 6
      { run: async () => { insertProseMirror(container, A); await flushMutations(); }, pm: true, wysiwyg: true, dom: A }, // 7
      { run: cycle(A), pm: true, wysiwyg: true, dom: A }, // 8 (5–7 again)
      { run: async () => { mode("source"); removeProseMirror(container); insertProseMirror(container, B); await flushMutations(); }, pm: true, wysiwyg: false, dom: B }, // 9
      { run: () => mode("wysiwyg"), pm: true, wysiwyg: true, dom: B }, // 10: initial pass, present
      { run: cycle(B), pm: true, wysiwyg: true, dom: B }, // 11
      { run: () => swap(M), pm: true, wysiwyg: true, dom: M }, // 12
      { run: () => swap(B), pm: true, wysiwyg: true, dom: B }, // 13
    ];

    // The expectation, computed from the table (not a literal): keep present WYSIWYG
    // states; emit on a mismatch whose signature differs from the previous kept one.
    const expected: Array<{ entryCount: number; domCount: number }> = [];
    let previous: number | null = null;
    const expectAfter = (s: Step) => {
      if (!s.wysiwyg || !s.pm || !s.dom) return;
      const d = s.dom.length;
      if (d !== 3 && d !== previous) expected.push({ entryCount: 3, domCount: d });
      previous = d;
    };

    for (const [i, s] of STEPS.entries()) {
      await s.run();
      expectAfter(s);
      expect(entries(), `step ${i + 1}: entries identity`).toBe(list);
      expect(sigs().length, `step ${i + 1}: running count`).toBe(expected.length);
    }

    // Step 14: a re-arm TEARDOWN between two identical mismatches (B, absent, B).
    const oldPm = container.querySelector(".ProseMirror");
    expect(ro.observed().has(oldPm!), "step 14: B's surface observed before").toBe(true);
    removeProseMirror(container);
    await flushMutations();
    // Positive guard: the absent re-arm really ran (it re-targeted the size watch).
    expect(ro.observed().has(oldPm!), "step 14: absent re-arm ran").toBe(false);
    const newPm = insertProseMirror(container, B);
    await flushMutations();
    expect(ro.observed().has(newPm), "step 14: present re-arm ran").toBe(true);
    expectAfter({ run: () => {}, pm: true, wysiwyg: true, dom: B });

    expect(expected.length).toBeGreaterThanOrEqual(3); // non-vacuity
    expect(sigs(), "step 14: running count").toHaveLength(3);
    expect(sigs()).toEqual(expected);
  });

  it("R-D21-4: the predicate is the container's .ProseMirror — empty one warns, stray one outside does not count", () => {
    const content = "# Alpha\n\n## Beta";
    // (a) An empty `.ProseMirror` is mounted: a real count disagreement, still reported.
    mountMilkdownDom([], { withProseMirror: true });
    const a = renderSpy({ content, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    const la = logs();
    expect(la).toHaveLength(1);
    expect(la[0].context).toEqual({ documentId: "doc-a", entryCount: 2, domCount: 0, resolvedCount: 0 });

    // (b) A `.ProseMirror` outside the container is not the surface.
    a.unmount();
    document.body.innerHTML = "";
    resetTocStore();
    logSpy.mockClear();
    const stray = document.createElement("div");
    stray.className = "ProseMirror";
    stray.innerHTML = "<h2>Stray</h2>";
    document.body.appendChild(stray);
    mountContainer();
    renderSpy({ content, documentId: "doc-a", viewMode: "wysiwyg" });
    tick(300);
    expect(sigs()).toEqual([]);
  });
});
