/**
 * D43 WI-4 — `useRecentFiles` shows the session list Rust owns.
 *
 * Cases SS-01 … SS-09 and SS-17 … SS-21 of
 * `.claude/tdd-guardian/tests-20261007-143049.md`. SS-10 is the unchanged
 * run of the three existing recent-files suites. SS-11 … SS-16 and the write
 * assertions of SS-17 are WI-5 (persist the Rust list) and live in that work
 * item's file.
 *
 * Request model pinned here:
 * - Every `seed` and `record` takes the next id from one per-instance counter.
 * - A reply to the latest request: non-null becomes the display and the base
 *   for later local pushes; null or a rejection keeps the local list.
 * - A superseded reply is discarded.
 * - The hook sends `viewMode: null`; only the refresh hook sends a mode.
 * - `hydrate(undefined)` sends `stored: []`; only `fail()` sends `null`.
 *
 * **Laws.**
 * - (Latest-request-wins, SS-05) after all replies settle in any order, the
 *   display equals the latest-sent request's non-null reply, else the local list.
 * - (Delta-only, SS-09) no op carries the window's list.
 *
 * **Mocked:** only `@tauri-apps/api/core`. The hook, services, logging store,
 * pure utils and the session fake's model (real `pushRecent` / `mergePending`)
 * are real.
 */
import { isDeepStrictEqual } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook, type RenderHookResult } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useRecentFiles } from "../src/hooks/useRecentFiles";
import { useRecentFilesMenuRefresh } from "../src/hooks/useRecentFilesMenuRefresh";
import { mergePending, pushRecent } from "../src/utils/recentFiles";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { ViewMode } from "../src/types/editor";
import {
  assertWireShape,
  createSessionFake,
  SYNC_COMMAND,
  type SessionFake,
  type SyncArgs,
} from "./support/recentSessionFake";

type HookResult = RenderHookResult<ReturnType<typeof useRecentFiles>, unknown>["result"];

function api(result: HookResult) {
  const r = result.current;
  return {
    recentFiles: r.recentFiles,
    update: r.updateRecentFiles,
    hydrate: r.hydrateRecentFiles,
    fail: r.failRecentFilesHydration,
  };
}

function writes() {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "set_preferences")
    .map(([, payload]) => payload);
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Route sync calls through `fake`; everything else answers null. */
function serve(fake: SessionFake) {
  invokeMock.mockImplementation(async (cmd: unknown, args: unknown) =>
    cmd === SYNC_COMMAND ? fake.handle(args) : null,
  );
}

/** Answer `reply` only when the op deep-equals `op`; reject anything else. */
function answerOnly(op: unknown, reply: string[], other: (a: SyncArgs) => unknown = () => null) {
  invokeMock.mockImplementation(async (cmd: unknown, raw: unknown) => {
    if (cmd !== SYNC_COMMAND) return null;
    const args = assertWireShape(raw);
    if (args.op.kind === (op as { kind: string }).kind) {
      expect(args.op).toEqual(op);
      return [...reply];
    }
    return other(args);
  });
}

interface Held {
  args: SyncArgs;
  resolve: (v: unknown) => void;
}

/** Hold every sync call on its own deferred, in send order. */
function holdSync(): Held[] {
  const queue: Held[] = [];
  invokeMock.mockImplementation((cmd: unknown, raw: unknown) => {
    if (cmd !== SYNC_COMMAND) return Promise.resolve(null);
    const args = assertWireShape(raw);
    return new Promise((resolve) => queue.push({ args, resolve }));
  });
  return queue;
}

async function settle(held: Held, reply: unknown) {
  await act(async () => {
    held.resolve(reply);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
});

describe("useRecentFiles — session sync (D43 WI-4)", () => {
  it("SS-01 hydrate sends seed{stored, pendingNewestFirst} and shows the returned list", async () => {
    const reply = ["/b.md", "/a.md", "/x.md", "/s1.md"];
    invokeMock.mockImplementation(async (cmd: unknown, raw: unknown) => {
      if (cmd !== SYNC_COMMAND) return null;
      const args = assertWireShape(raw);
      const want = { kind: "seed", stored: ["/s1.md"], pendingNewestFirst: ["/b.md", "/a.md"] };
      if (!isDeepStrictEqual(args.op, want) || args.viewMode !== null) {
        throw new Error("unexpected op");
      }
      return [...reply];
    });
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    act(() => api(result).update("/b.md"));
    act(() => api(result).hydrate(["/s1.md"]));
    await flush();
    expect(api(result).recentFiles).toEqual(reply);
  });

  it("SS-02 fail() sends stored:null with the pending buffer and writes nothing", async () => {
    answerOnly({ kind: "seed", stored: null, pendingNewestFirst: ["/a.md"] }, ["/a.md", "/d.md"]);
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    act(() => api(result).fail());
    await flush();
    expect(api(result).recentFiles).toEqual(["/a.md", "/d.md"]);
    expect(writes()).toEqual([]);
    const seed = invokeMock.mock.calls.find(([cmd]) => cmd === SYNC_COMMAND)?.[1] as SyncArgs;
    expect(Object.prototype.hasOwnProperty.call(seed.op, "stored")).toBe(true);
    expect((seed.op as { stored: unknown }).stored).toBeNull();
  });

  it("SS-03 pre-hydration updates do not sync; the buffer travels in the seed", async () => {
    invokeMock.mockImplementation(async (cmd: unknown, raw: unknown) => {
      if (cmd !== SYNC_COMMAND) return null;
      const args = assertWireShape(raw);
      return args.op.kind === "record" ? ["/zzz.md"] : null;
    });
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    await flush();
    expect(api(result).recentFiles).toEqual(["/a.md"]);
    expect(writes()).toEqual([]);
    act(() => api(result).hydrate([]));
    await flush();
    expect(api(result).recentFiles).toEqual(["/a.md"]);
  });

  it("SS-04 out-of-order replies: the later request's reply wins", async () => {
    const q = holdSync();
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate([]));
    expect(q).toHaveLength(1);
    await settle(q[0], null);
    act(() => api(result).update("/c.md"));
    act(() => api(result).update("/d.md"));
    expect(q).toHaveLength(3);
    await settle(q[2], ["/d.md", "/c.md", "/r.md"]);
    await settle(q[1], ["/c.md", "/r.md"]);
    expect(api(result).recentFiles).toEqual(["/d.md", "/c.md", "/r.md"]);
  });

  it("SS-05 property: latest-request-wins over every arrival permutation, seed included", async () => {
    const seed = 0xd430005;
    const rand = mulberry32(seed);
    const alphabet = ["/s/a.md", "/s/b.md", "/b0.md", "/u1.md"];
    for (const n of [2, 3, 4]) {
      const ids = Array.from({ length: n }, (_, i) => i);
      for (const perm of permutations(ids)) {
        const masks = [
          ids.map(() => rand() < 0.25),
          ids.map(() => false),
          ids.map((i) => i !== 0),
        ];
        for (const nullMask of masks) {
          const pre = ["/b0.md", "/b1.md"].slice(0, Math.floor(rand() * 3));
          const stored = Array.from(
            { length: Math.floor(rand() * 4) },
            () => alphabet[Math.floor(rand() * alphabet.length)],
          );
          const updates = ids.slice(1).map((i) => `/u${i}.md`);
          const tag = `seed=${seed} n=${n} perm=${perm} nulls=${nullMask} pre=${pre} stored=${JSON.stringify(stored)}`;
          invokeMock.mockReset();
          const q = holdSync();
          const { result, unmount } = renderHook(() => useRecentFiles());
          for (const p of pre) act(() => api(result).update(p));
          act(() => api(result).hydrate(stored));
          for (const u of updates) act(() => api(result).update(u));
          expect(q.length, `sent ${tag}`).toBe(n);
          const replies = ids.map((i) => (nullMask[i] ? null : [`/resp${i}.md`]));
          for (const i of perm) await settle(q[i], replies[i]);
          const last = replies[n - 1];
          const local = updates.reduce(pushRecent, mergePending(stored, [...pre].reverse()));
          expect(api(result).recentFiles, `final ${tag}`).toEqual(last ?? local);
          unmount();
        }
      }
    }
  });

  it("SS-06 a null reply keeps the local list and persists it", async () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate(["/s1.md"]));
    act(() => api(result).update("/a.md"));
    await flush();
    expect(api(result).recentFiles).toEqual(["/a.md", "/s1.md"]);
    expect(writes()).toEqual([{ preferences: { recentFiles: ["/a.md", "/s1.md"] } }]);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === SYNC_COMMAND)).toHaveLength(2);
  });

  it("SS-07 a rejected sync keeps the local list and raises no unhandled rejection", async () => {
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === SYNC_COMMAND) throw new Error("ipc down");
      return null;
    });
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate(["/s1.md"]));
    act(() => api(result).update("/a.md"));
    await flush();
    await flush();
    expect(api(result).recentFiles).toEqual(["/a.md", "/s1.md"]);
    expect(writes()).toEqual([{ preferences: { recentFiles: ["/a.md", "/s1.md"] } }]);
    expect(unhandled).toEqual([]);
  });

  it("SS-08 two windows share one session (multi-window D43 witness)", async () => {
    const fake = createSessionFake();
    serve(fake);
    const a = renderHook(() => useRecentFiles());
    const b = renderHook(() => useRecentFiles());
    act(() => api(a.result).hydrate(["/d.md", "/c.md", "/b.md"]));
    await flush();
    act(() => api(a.result).update("/e.md"));
    await flush();
    act(() => api(b.result).fail());
    await flush();
    act(() => api(b.result).update("/a.md"));
    await flush();
    expect(api(b.result).recentFiles).toEqual(["/a.md", "/e.md", "/d.md", "/c.md", "/b.md"]);
    act(() => api(a.result).update("/f.md"));
    await flush();
    expect(api(a.result).recentFiles).toEqual([
      "/f.md",
      "/a.md",
      "/e.md",
      "/d.md",
      "/c.md",
      "/b.md",
    ]);
  });

  it("SS-09 property: the display tracks the session model across two-window interleavings", async () => {
    const seed = 0xd430009;
    const rand = mulberry32(seed);
    const paths = ["/p1.md", "/p2.md", "/p3.md", "/p4.md", "/p5.md", "/p6.md"];
    const pickPath = () => (rand() < 0.125 ? "" : paths[Math.floor(rand() * paths.length)]);
    type Step = { t: "update"; path: string } | { t: "hydrate"; stored: string[] } | { t: "fail" };

    for (let s = 0; s < 150; s += 1) {
      invokeMock.mockReset();
      const fake = createSessionFake();
      serve(fake);
      const hooks = [0, 1].map(() => {
        const pre = Array.from({ length: Math.floor(rand() * 3) }, pickPath);
        const stored = Array.from({ length: Math.floor(rand() * 5) }, pickPath).filter(Boolean);
        const seedStep: Step = rand() < 1 / 3 ? { t: "fail" } : { t: "hydrate", stored };
        const post = Array.from({ length: Math.floor(rand() * 5) }, pickPath);
        const script: Step[] = [
          ...pre.map((path): Step => ({ t: "update", path })),
          seedStep,
          ...post.map((path): Step => ({ t: "update", path })),
        ];
        return { pre, seedStep, script, hydrated: false, seeds: 0, r: renderHook(() => useRecentFiles()) };
      });

      while (hooks.some((h) => h.script.length > 0)) {
        const live = hooks.filter((h) => h.script.length > 0);
        const h = live[Math.floor(rand() * live.length)];
        const step = h.script.shift() as Step;
        const tag = `seed=${seed} scenario=${s} step=${JSON.stringify(step)}`;
        const before = fake.calls.length;
        act(() => {
          if (step.t === "update") api(h.r.result).update(step.path);
          else if (step.t === "hydrate") api(h.r.result).hydrate(step.stored);
          else api(h.r.result).fail();
        });
        await flush();
        const sent = fake.calls.slice(before);
        const expectsCall = step.t !== "update" || (h.hydrated && step.path !== "");
        if (step.t !== "update") h.hydrated = true;
        expect(sent.length, `calls ${tag}`).toBe(expectsCall ? 1 : 0);
        if (!expectsCall) continue;
        const { op } = sent[0];
        expect(api(h.r.result).recentFiles, `display ${tag}`).toEqual(fake.lastAnswer);
        if (op.kind === "record") {
          expect(Object.keys(op).sort(), `record keys ${tag}`).toEqual(["kind", "path"]);
          expect(op.path, `record path ${tag}`).not.toBe("");
        } else if (op.kind === "seed") {
          h.seeds += 1;
          expect(op.pendingNewestFirst, `pending ${tag}`).toEqual(
            h.pre.filter(Boolean).reverse(),
          );
          expect(op.stored, `stored ${tag}`).toEqual(
            step.t === "hydrate" ? step.stored : null,
          );
        }
      }
      for (const h of hooks) {
        expect(h.seeds, `one seed per hook seed=${seed} scenario=${s}`).toBe(1);
        h.r.unmount();
      }
    }
  });

  it("SS-17 a late seed reply loses to a later record (display; writes are WI-5)", async () => {
    const q = holdSync();
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/p.md"));
    act(() => api(result).hydrate(["/s1.md"]));
    act(() => api(result).update("/a.md"));
    expect(q.map((h) => h.args.op.kind)).toEqual(["seed", "record"]);
    await settle(q[1], ["/a.md", "/p.md", "/x.md", "/s1.md"]);
    await settle(q[0], ["/p.md", "/x.md", "/s1.md"]);
    expect(api(result).recentFiles).toEqual(["/a.md", "/p.md", "/x.md", "/s1.md"]);
  });

  it("SS-18 a non-null reply becomes the base for the next local push", async () => {
    answerOnly({ kind: "seed", stored: ["/s1.md"], pendingNewestFirst: [] }, ["/x.md", "/s1.md"]);
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate(["/s1.md"]));
    await flush();
    act(() => api(result).update("/a.md"));
    await flush();
    expect(api(result).recentFiles).toEqual(["/a.md", "/x.md", "/s1.md"]);
    expect(writes()).toEqual([{ preferences: { recentFiles: ["/a.md", "/x.md", "/s1.md"] } }]);
  });

  it("SS-19 hydrate(undefined) sends stored: [], not null", async () => {
    invokeMock.mockImplementation(async (cmd: unknown, raw: unknown) => {
      if (cmd !== SYNC_COMMAND) return null;
      const args = assertWireShape(raw);
      if (!isDeepStrictEqual(args.op, { kind: "seed", stored: [], pendingNewestFirst: [] })) {
        throw new Error("unexpected op");
      }
      return ["/ok.md"];
    });
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate(undefined));
    await flush();
    expect(api(result).recentFiles).toEqual(["/ok.md"]);
    expect(writes()).toEqual([]);
  });

  it("SS-20 the hook sends viewMode null; only the refresh hook sends the mode, and it is remembered", async () => {
    const fake = createSessionFake();
    serve(fake);
    const { result, rerender } = renderHook(
      ({ mode }: { mode: ViewMode }) => ({ rf: useRecentFiles(), _: useRecentFilesMenuRefresh(mode) }),
      { initialProps: { mode: "wysiwyg" as ViewMode } },
    );
    await flush();
    act(() => result.current.rf.updateRecentFiles("/p.md"));
    act(() => result.current.rf.hydrateRecentFiles(["/s1.md"]));
    await flush();
    act(() => result.current.rf.updateRecentFiles("/a.md"));
    await flush();
    expect(result.current.rf.recentFiles).toEqual(fake.session);
    expect(fake.session).toEqual(["/a.md", "/p.md", "/s1.md"]);
    rerender({ mode: "source" });
    await flush();
    act(() => result.current.rf.updateRecentFiles("/b.md"));
    await flush();
    expect(fake.installModes).toEqual(["wysiwyg", "wysiwyg", "wysiwyg", "source", "source"]);
    expect(fake.menuViewMode).toBe("source");
  });

  it("SS-21 a superseded reply is not the base for the next push", async () => {
    const q = holdSync();
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate([]));
    expect(q).toHaveLength(1);
    await settle(q[0], null);
    act(() => api(result).update("/c.md"));
    act(() => api(result).update("/d.md"));
    await settle(q[2], ["/d.md", "/c.md", "/r.md"]);
    await settle(q[1], ["/c.md", "/r.md"]);
    act(() => api(result).update("/e.md"));
    await settle(q[3], null);
    expect(api(result).recentFiles).toEqual(["/e.md", "/d.md", "/c.md", "/r.md"]);
    expect(writes().at(-1)).toEqual({
      preferences: { recentFiles: ["/e.md", "/d.md", "/c.md", "/r.md"] },
    });
  });
});
