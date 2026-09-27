/**
 * D21 — the Source→WYSIWYG switch through the REAL `MilkdownEditor`: no false
 * `ui.toc.resolve.mismatch` while `@milkdown/react` has not yet inserted `.ProseMirror`.
 *
 * The sibling `use-wysiwyg-scroll-spy-d21.test.ts` scripts the late mount (one hand-built
 * `.ProseMirror` insert). This file removes that assumption: the mount order is whatever
 * the real editor does, wired the way `App.tsx` wires it — `useTOC` in the parent with
 * `containerId: viewMode === "wysiwyg" ? "milkdown-container" : "source-container"`, and
 * `<MilkdownEditor />` rendered as a child only in WYSIWYG.
 *
 * Observed at the process boundary: the real `loggingService.logEventSync` runs and the
 * warning is read off the mocked `invoke("log_event", { payload })`, not a spy on the
 * logging module. Mocked: `@tauri-apps/api/{core,event,window}` and jsdom's missing
 * `IntersectionObserver`. Source mode renders a bare `#source-container` (no CodeMirror):
 * with no `editorView` the source spy attaches nothing, and it is not under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null as unknown),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: invokeMock,
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useTOC } from "../src/hooks/useTOC";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useTOCStore } from "../src/stores/tocStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { makeDoc, resetStores, sleep } from "./helpers/milkdownEditorHarness";

const CONTENT = "# Alpha\n\n## Beta\n\n## Gamma\n\nBody text.";
const HEADING_COUNT = 3;
const PARSE_SETTLE_MS = 450; // useTOC's 300ms parse debounce, plus margin
const EDITOR_SETTLE_MS = 400; // re-arm rAF + any late Milkdown DOM work
const MOUNT_TIMEOUT_MS = 5000;
const CASE_TIMEOUT_MS = 20_000;

/** `App.tsx`'s wiring, reduced to the TOC and the editor surface. */
function Shell() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const doc = useDocumentStore((s) => s.documents.find((d) => d.id === s.activeDocumentId));
  useTOC({
    content: doc?.content ?? "",
    documentId: doc?.id ?? null,
    containerId: viewMode === "wysiwyg" ? "milkdown-container" : "source-container",
    viewMode,
  });
  return viewMode === "wysiwyg" ? <MilkdownEditor /> : <div id="source-container" />;
}

/** Every `log_event` payload that crossed the Tauri boundary. */
function loggedEvents(): Array<{ event: string; context?: Record<string, unknown> }> {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: { event: string; context?: Record<string, unknown> } }).payload);
}

const mismatchEvents = () => loggedEvents().filter((p) => p.event === "ui.toc.resolve.mismatch");

let unmount: (() => void) | null = null;

beforeEach(() => {
  installIntersectionObserverDouble();
  invokeMock.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
  resetStores([makeDoc("doc-a", CONTENT, "/tmp/a.md")]);
  useEditorStore.setState({ viewMode: "source" });
});

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

describe("D21 — real MilkdownEditor mount order", () => {
  it(
    "R-D21-5: Source→WYSIWYG on a matching document logs no ui.toc.resolve.mismatch at the invoke boundary",
    async () => {
      ({ unmount } = render(<Shell />));
      await sleep(PARSE_SETTLE_MS);
      // Precondition: the outline is parsed before the switch, so the spy's initial pass
      // has entries to resolve (the state that warned before D21).
      expect(useTOCStore.getState().entries).toHaveLength(HEADING_COUNT);
      expect(document.getElementById("milkdown-container")).toBeNull();

      act(() => useEditorStore.setState({ viewMode: "wysiwyg" }));

      await waitFor(
        () => {
          const pm = document.querySelector("#milkdown-container .ProseMirror");
          expect(pm).not.toBeNull();
          expect(pm!.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(HEADING_COUNT);
        },
        { timeout: MOUNT_TIMEOUT_MS },
      );
      await sleep(EDITOR_SETTLE_MS);

      // Positive guard: the observation channel is live — the real logging service reached
      // the mocked invoke during this run.
      expect(loggedEvents().length).toBeGreaterThan(0);
      expect(mismatchEvents()).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );
});
