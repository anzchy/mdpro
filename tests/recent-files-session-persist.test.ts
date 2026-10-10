/**
 * D43 WI-5 — `useRecentFiles` saves the list Rust returned, not the window's
 * stale local list.
 *
 * Cases SS-11 … SS-16, the write assertions of SS-17, and the added witness
 * SS-16w of `.claude/tdd-guardian/tests-20261007-143049.md`. The display-side
 * cases (SS-01 … SS-09, SS-17 … SS-21) live in
 * `tests/recent-files-session-sync.test.ts`; SS-10 is the unchanged run of the
 * existing recent-files suites (RH-06 and RH-10 pin one write per update under
 * `null` replies).
 *
 * **Laws.**
 * - (No-stale-write) every `set_preferences` payload is either the reply to the
 *   latest-sent request at its arrival, or the call-time local list for a
 *   `null` reply. A superseded non-null reply, the seed's included, is never
 *   written.
 * - (Last write = display) when the latest request's reply is non-null, the
 *   last write deep-equals the final `recentFiles`.
 * - (A2 retained) a failed hydration writes nothing, and hydration with an
 *   empty buffer writes nothing.
 *
 * **Mocked:** only `@tauri-apps/api/core`. The hook, services, logging store and
 * pure utils are real.
 */
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
import { mergePending, pushRecent } from "../src/utils/recentFiles";
import { useLoggingStore } from "../src/stores/loggingStore";
import { assertWireShape, SYNC_COMMAND, type SyncArgs } from "./support/recentSessionFake";

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

const w = (list: string[]) => ({ preferences: { recentFiles: list } });

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

/** Answer sync calls by op kind; everything else answers null. */
function answerByKind(replies: Partial<Record<"seed" | "record", unknown>>) {
  invokeMock.mockImplementation(async (cmd: unknown, raw: unknown) => {
    if (cmd !== SYNC_COMMAND) return null;
    const args = assertWireShape(raw);
    const reply = replies[args.op.kind as "seed" | "record"];
    return Array.isArray(reply) ? [...reply] : (reply ?? null);
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

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

afterEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("useRecentFiles — persist the session list Rust returned (D43 WI-5)", () => {
  it("SS-11 a post-hydration write saves the list Rust returned", async () => {
    answerByKind({ seed: null, record: ["/a.md", "/z.md", "/s1.md"] });
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate(["/s1.md"]));
    act(() => api(result).update("/a.md"));
    await flush();
    expect(writes()).toEqual([w(["/a.md", "/z.md", "/s1.md"])]);
    expect(api(result).recentFiles).toEqual(["/a.md", "/z.md", "/s1.md"]);
  });

  it("SS-12 hydration with a non-empty buffer writes the seed reply once", async () => {
    answerByKind({ seed: ["/a.md", "/x.md", "/s1.md"] });
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/a.md"));
    act(() => api(result).hydrate(["/s1.md"]));
    await flush();
    expect(writes()).toEqual([w(["/a.md", "/x.md", "/s1.md"])]);
    expect(api(result).recentFiles).toEqual(["/a.md", "/x.md", "/s1.md"]);
  });

  it("SS-13 hydration with an empty buffer writes nothing, even when Rust returns more", async () => {
    answerByKind({ seed: ["/x.md", "/s1.md"] });
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate(["/s1.md"]));
    await flush();
    expect(writes()).toEqual([]);
    expect(api(result).recentFiles).toEqual(["/x.md", "/s1.md"]);
  });

  it("SS-14 a failed hydration writes nothing; the next update writes the Rust list", async () => {
    answerByKind({ seed: ["/d.md"], record: ["/a.md", "/d.md"] });
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).fail());
    await flush();
    expect(writes()).toEqual([]);
    act(() => api(result).update("/a.md"));
    await flush();
    expect(writes()).toEqual([w(["/a.md", "/d.md"])]);
  });

  it("SS-15 a superseded reply is never written", async () => {
    const q = holdSync();
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).hydrate([]));
    await settle(q[0], null);
    act(() => api(result).update("/c.md"));
    act(() => api(result).update("/d.md"));
    expect(q).toHaveLength(3);
    await settle(q[2], ["/d.md", "/c.md", "/r.md"]);
    await settle(q[1], ["/c.md", "/r.md"]);
    expect(writes()).toEqual([w(["/d.md", "/c.md", "/r.md"])]);
    expect(api(result).recentFiles).toEqual(["/d.md", "/c.md", "/r.md"]);
  });

  it("SS-16w a stale null reply arriving after the latest non-null reply does not overwrite it", async () => {
    const q = holdSync();
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/p.md"));
    act(() => api(result).hydrate(["/s1.md"]));
    act(() => api(result).update("/a.md"));
    await settle(q[1], ["/a.md", "/p.md", "/x.md", "/s1.md"]);
    await settle(q[0], null);
    expect(writes()).toEqual([w(["/a.md", "/p.md", "/x.md", "/s1.md"])]);
    expect(api(result).recentFiles).toEqual(["/a.md", "/p.md", "/x.md", "/s1.md"]);
  });

  it("SS-16 property: no stale write, and the last write equals the display", async () => {
    const seed = 0xd430016;
    const rand = mulberry32(seed);
    const alphabet = ["/s/a.md", "/s/b.md", "/b0.md", "/u1.md"];
    for (const n of [2, 3, 4]) {
      const ids = Array.from({ length: n }, (_, i) => i);
      for (const perm of permutations(ids)) {
        const masks = [ids.map(() => rand() < 0.25), ids.map(() => false), ids.map((i) => i !== 0)];
        for (const nullMask of masks) {
          const pre = rand() < 0.5 ? ["/b0.md", "/b1.md"].slice(0, 1 + Math.floor(rand() * 2)) : [];
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
          expect(writes(), `no write on send ${tag}`).toEqual([]);

          // Call-time local lists: every request is sent before any reply, so
          // no adoption happens between sends.
          const base = mergePending(stored, [...pre].reverse());
          const local = ids.map((i) => updates.slice(0, i).reduce(pushRecent, base));
          const writesAllowed = ids.map((i) => i > 0 || pre.length > 0);
          const replies = ids.map((i) => (nullMask[i] ? null : [`/resp${i}.md`]));

          for (const i of perm) {
            const before = writes().length;
            await settle(q[i], replies[i]);
            const fresh = writes().slice(before);
            const reply = replies[i];
            const allowed =
              !writesAllowed[i] ? [] : reply === null ? [local[i]] : i === n - 1 ? [reply] : [];
            expect(fresh.length, `at most one write per reply ${tag} i=${i}`).toBeLessThanOrEqual(1);
            for (const payload of fresh) {
              expect(allowed.map(w), `write on reply ${i} ${tag}`).toContainEqual(payload);
            }
            if (reply !== null && i === n - 1 && writesAllowed[i]) {
              expect(fresh, `latest reply written ${tag}`).toEqual([w(reply)]);
            }
          }

          const all = writes();
          for (const i of ids.slice(0, -1)) {
            const r = replies[i];
            if (r !== null) expect(all, `superseded ${i} never written ${tag}`).not.toContainEqual(w(r));
          }
          if (replies[n - 1] !== null) {
            expect(all.at(-1), `last write equals display ${tag}`).toEqual(w(api(result).recentFiles));
          }
          unmount();
        }
      }
    }
  });

  it("SS-17 (writes) a late seed reply is never written; the last write is the record's reply", async () => {
    const q = holdSync();
    const { result } = renderHook(() => useRecentFiles());
    act(() => api(result).update("/p.md"));
    act(() => api(result).hydrate(["/s1.md"]));
    act(() => api(result).update("/a.md"));
    expect(q.map((h) => h.args.op.kind)).toEqual(["seed", "record"]);
    await settle(q[1], ["/a.md", "/p.md", "/x.md", "/s1.md"]);
    await settle(q[0], ["/p.md", "/x.md", "/s1.md"]);
    const all = writes();
    expect(all.at(-1)).toEqual(w(["/a.md", "/p.md", "/x.md", "/s1.md"]));
    expect(all).not.toContainEqual(w(["/p.md", "/x.md", "/s1.md"]));
    expect(api(result).recentFiles).toEqual(["/a.md", "/p.md", "/x.md", "/s1.md"]);
  });
});
