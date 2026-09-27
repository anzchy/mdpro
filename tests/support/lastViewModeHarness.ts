/**
 * Purpose: shared harness for the WI-2 hook cases (LVH-01 … LVH-09,
 * `.claude/tdd-guardian/tests-20260926-221500.md` revision 3): a stateful
 * backend fake behind `invoke`, and a harness component that feeds
 * `useLastViewModePersistence` and records one `(viewMode, activeDocId)` pair
 * per commit.
 *
 * The test file owns the `vi.mock` of `@tauri-apps/api/core` (built on
 * `tests/support/tauriCoreMock.ts`) and routes it to `answer`; this module only
 * supplies the fake and the harness. `resetCase` turns the `isTauri` spy on so
 * the real `preferencesService` takes its Tauri branch.
 *
 * Key decisions:
 * - `get_preferences` returns a controllable deferred, resolved with a clone
 *   of `disk` taken at resolution time (or of a snapshot passed to
 *   `resolveReadWith`); with `readError` set it rejects at once.
 * - `set_preferences` does `Object.assign(disk, payload.preferences)`, the
 *   top-level whole-key replace `merge_preferences` does.
 * - `activeDocument` is memoized on `docId`, so its identity changes only when
 *   `docId` changes, as in the real store.
 * - The commit recorder is a no-deps `useLayoutEffect`, which runs exactly
 *   once per commit of the harness component.
 */
import { useLayoutEffect, useMemo } from "react";
import { vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { useLastViewModePersistence } from "../../src/hooks/useLastViewModePersistence";
import { useEditorStore } from "../../src/stores/editorStore";
import { useLoggingStore } from "../../src/stores/loggingStore";
import type { Document } from "../../src/types/document";
import type { ViewMode } from "../../src/types/editor";
import type { UserPreferences } from "../../src/types/preferences";
import { makePreferences } from "./preferenceFixtures";

interface PendingRead {
  /** Resolves with `snapshot`, or with a clone of `disk` taken now. */
  resolve: (snapshot?: UserPreferences) => void;
}

export const backend = {
  disk: makePreferences() as UserPreferences,
  calls: [] as Array<[string, unknown]>,
  pending: [] as PendingRead[],
  readError: null as Error | null,
};

/** One `(viewMode, activeDocId)` pair per commit of the harness component. */
export const commits: Array<[ViewMode, string | null]> = [];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The `invoke` fake. Records every call, then answers like the backend. */
export async function answer(cmd: unknown, args: unknown): Promise<unknown> {
  backend.calls.push([String(cmd), args]);
  if (cmd === "get_preferences") {
    if (backend.readError) throw backend.readError;
    return new Promise((resolve) => {
      backend.pending.push({ resolve: (snap) => resolve(clone(snap ?? backend.disk)) });
    });
  }
  if (cmd === "set_preferences") {
    const { preferences } = args as { preferences: Partial<UserPreferences> };
    Object.assign(backend.disk, preferences);
    return clone(backend.disk);
  }
  return null;
}

/** Per-case reset: fresh disk, no calls, store on its default, logging on. */
export function resetCase(disk: UserPreferences = makePreferences()): void {
  backend.disk = disk;
  backend.calls.length = 0;
  backend.pending.length = 0;
  backend.readError = null;
  commits.length = 0;
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useEditorStore.setState({ viewMode: "wysiwyg" });
}

/**
 * Per-case teardown. Nothing to undo since ADR-0031 step 5b: the `isTauri` spy
 * set in `resetCase` is restored by vitest's `restoreMocks`.
 */
export function teardownCase(): void {}

export const callsFor = (cmd: string) => backend.calls.filter(([c]) => c === cmd);

/** The recorded `set_preferences` payloads that carry a `lastViewMode` key. */
export const lastViewModeWrites = () =>
  callsFor("set_preferences")
    .map(([, payload]) => payload as { preferences: Partial<UserPreferences> })
    .filter((p) => "lastViewMode" in p.preferences);

export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Resolve the most recent pending `get_preferences` (or the one at `index`). */
export async function resolveRead(index = backend.pending.length - 1): Promise<void> {
  const read = backend.pending[index];
  if (!read) throw new Error(`no pending get_preferences at index ${index}`);
  await act(async () => {
    read.resolve();
  });
  await flush();
}

/** Resolve the most recent pending read with a fixed snapshot (the disk as it was when read). */
export async function resolveReadWith(snapshot: UserPreferences): Promise<void> {
  const read = backend.pending[backend.pending.length - 1];
  if (!read) throw new Error("no pending get_preferences");
  await act(async () => {
    read.resolve(snapshot);
  });
  await flush();
}

/** A user or launch-path view-mode change through the real store. */
export function setMode(mode: ViewMode): void {
  act(() => {
    useEditorStore.getState().setViewMode(mode);
  });
}

export const storeMode = () => useEditorStore.getState().viewMode;

export interface HarnessProps {
  loaded: boolean;
  launched: boolean;
  hasDoc: boolean;
  docId?: string;
  /** LVH-09 only: drives the hook's `viewMode` parameter instead of the store. */
  viewMode?: ViewMode;
}

function doc(id: string, path: string): Document {
  return {
    id,
    path,
    content: `content of ${id}`,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

function useHarness(props: HarnessProps): void {
  const storeViewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const docId = props.docId ?? "d1";
  const memoDoc = useMemo(() => doc(docId, `/tmp/${docId}.md`), [docId]);
  const activeDocument = props.hasDoc ? memoDoc : null;
  const viewMode = props.viewMode ?? storeViewMode;

  useLastViewModePersistence({
    preferencesLoaded: props.loaded,
    launchPathsComplete: props.launched,
    activeDocument,
    viewMode,
    setViewMode,
  });

  useLayoutEffect(() => {
    commits.push([viewMode, activeDocument?.id ?? null]);
  });
}

export function mountHarness(initialProps: HarnessProps) {
  return renderHook((p: HarnessProps) => useHarness(p), { initialProps });
}

/** Collapse consecutive identical `(viewMode, activeDocId)` pairs. */
export function dedupeConsecutive(
  pairs: Array<[ViewMode, string | null]>,
): Array<[ViewMode, string | null]> {
  return pairs.filter(
    (p, i) => i === 0 || p[0] !== pairs[i - 1][0] || p[1] !== pairs[i - 1][1],
  );
}
