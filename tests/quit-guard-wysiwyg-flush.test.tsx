/**
 * D16 WI-7 / WI7-W1, WI7-W2 — the quit check through the REAL editor.
 *
 * A quit arriving inside the edit-sync delay is the data-loss case D15 exists
 * for: the keystroke lives only in ProseMirror until the flush runs, so a quit
 * check that reads documentStore first answers `clean` and the coordinator
 * quits over it. Real Milkdown, real serializer, real stores; only
 * `@tauri-apps/api/{core,event,window}` and `loggingService` are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Cb = (event: { payload: unknown }) => void;

const { bus, core } = vi.hoisted(() => ({
  bus: { listeners: new Map<string, Set<Cb>>() },
  core: { replies: [] as Array<{ cmd: string; args: Record<string, unknown> }> },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.replies.push({ cmd, args: { ...args } });
    return null;
  }),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: Cb) => {
    const set = bus.listeners.get(name) ?? new Set<Cb>();
    set.add(cb);
    bus.listeners.set(name, set);
    return () => {
      set.delete(cb);
    };
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

import type { Editor } from "@milkdown/kit/core";
import { useQuitGuard } from "../src/hooks/useQuitGuard";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import {
  docById,
  makeDoc,
  mountAndWait,
  resetStores,
  typeAtEnd,
  typeHistoryless,
} from "./helpers/milkdownEditorHarness";

const REQUESTED = "app:quit-requested";
const CASE_TIMEOUT_MS = 20_000;

const quitReplies = () => core.replies.filter((r) => r.cmd === "quit_guard_reply");

let unmountEditor: (() => void) | null = null;

installIntersectionObserverDouble();

beforeEach(() => {
  bus.listeners.clear();
  core.replies.length = 0;
  vi.clearAllMocks();
  resetStores([makeDoc("doc-a", "Hello world", "/tmp/a.md")]);
});

afterEach(() => {
  unmountEditor?.();
  unmountEditor = null;
});

async function mountEditor(): Promise<Editor> {
  const mounted = await mountAndWait();
  unmountEditor = mounted.unmount;
  return mounted.instance;
}

async function deliverRequested(requestId: number): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.listeners.get(REQUESTED) ?? [])]) cb({ payload: { requestId } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("quit check through the real WYSIWYG editor", () => {
  it(
    "WI7-W1: a token typed inside the edit-sync delay makes the quit check answer `dirty`",
    async () => {
      const instance = await mountEditor();
      const { result } = renderHook(() => useQuitGuard());
      await act(async () => {
        await Promise.resolve();
      });

      // No sleep: the quit arrives while the edit is still only in ProseMirror.
      await act(async () => {
        typeAtEnd(instance, "Q");
      });
      await deliverRequested(11);

      expect(quitReplies()[0]?.args).toMatchObject({ requestId: 11, answer: "dirty" });
      expect(docById("doc-a")?.content).toContain("Q");
      expect(result.current.quitPrompt).toBeNull();
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "WI7-W2: a pending history-less edit counts as dirty too",
    async () => {
      const instance = await mountEditor();
      renderHook(() => useQuitGuard());
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        typeHistoryless(instance, "PROG");
      });
      await deliverRequested(12);

      expect(quitReplies()[0]?.args).toMatchObject({ requestId: 12, answer: "dirty" });
    },
    CASE_TIMEOUT_MS,
  );
});
