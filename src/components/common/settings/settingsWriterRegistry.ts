/**
 * settingsWriterRegistry
 *
 * Purpose: one serialized settings writer per preferences group, held at module
 * level so it outlives the Settings dialog (WI-4.3b round 4, PR #508 N1 class
 * and the N2 reject variant). Closing Settings unmounts every page; the group's
 * queue, its shown value and its confirmed value stay here until every write
 * has settled, so nothing queued is dropped and a reopened page shows the live
 * value instead of an older read.
 *
 * Pipeline: write(patch) → show patch + claim its keys → queue →
 *   (when sent) save(confirmed ⊕ unsaved edits ⊕ patch)
 *     → success: confirmed = backend result, onConfirm
 *     → failure: keys this write still holds back to confirmed
 *       (or, with `rollback: false`, kept shown as unsaved edits)
 *   → the queue drains with no page mounted: the live app is reconciled to the
 *     confirmed value and the group is forgotten (the next mount reads afresh)
 *
 * Key decisions:
 * - A save is built when it is *sent* (confirmed ⊕ unsaved edits ⊕ its patch),
 *   so a sibling that failed earlier never rides along. Every write or edit
 *   claims its keys; a failed write rolls back only the keys it still holds.
 * - `load` accepts only a read ticket still current when its reply arrives.
 * - Closing the last page discards unsaved edits (typing inside a debounce
 *   window), as the pages' own timers already do; accepted writes are never
 *   dropped.
 * - A pending save waits for its real result; a never-settling call keeps the
 *   group queue pending. Each accepted write keeps its accepting mount's save.
 *
 * @coordinates-with src/components/common/settings/useSettingsWriter.ts
 * @module components/common/settings/settingsWriterRegistry
 */

export type GroupKey = string | symbol;

export interface GroupHandlers<S extends object> {
  save: (next: S, patch: Partial<S>) => Promise<unknown>;
  apply: (key: keyof S, value: S[keyof S]) => void;
  onConfirm: (confirmed: S) => void;
}

interface Claim {
  token: number;
  unsaved: boolean;
}

interface Group<S extends object> {
  shown: S | null;
  confirmed: S | null;
  claims: Map<keyof S, Claim>;
  lastClaim: number;
  queue: Promise<unknown>;
  pending: number;
  mounts: number;
  handlers: GroupHandlers<S>;
}

const groups = new Map<GroupKey, Group<object>>();
const listeners = new Map<GroupKey, Set<() => void>>();
const versions = new Map<GroupKey, number>();

function notify(key: GroupKey): void {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  for (const listener of listeners.get(key) ?? []) listener();
}

function find<S extends object>(key: GroupKey): Group<S> | undefined {
  return groups.get(key) as Group<S> | undefined;
}

function ensure<S extends object>(key: GroupKey, handlers: GroupHandlers<S>): Group<S> {
  const existing = find<S>(key);
  if (existing) return existing;
  const group: Group<S> = {
    shown: null, confirmed: null, claims: new Map(), lastClaim: 0,
    queue: Promise.resolve(), pending: 0, mounts: 0, handlers,
  };
  groups.set(key, group as unknown as Group<object>);
  return group;
}

export function subscribe(key: GroupKey, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Changes whenever the group's shown value or busy state does. */
export function version(key: GroupKey): number {
  return versions.get(key) ?? 0;
}

export function shownValue<S extends object>(key: GroupKey): S | null {
  return find<S>(key)?.shown ?? null;
}

/** True while a write is queued or in flight, or an edit is unsaved. */
export function isBusy(key: GroupKey): boolean {
  const group = find(key);
  if (!group) return false;
  return group.pending > 0 || [...group.claims.values()].some((c) => c.unsaved);
}

export function mount<S extends object>(key: GroupKey, handlers: GroupHandlers<S>): void {
  const group = ensure(key, handlers);
  group.handlers = handlers;
  group.mounts += 1;
}

export function unmount(key: GroupKey): void {
  const group = find(key);
  if (!group) return;
  group.mounts = Math.max(0, group.mounts - 1);
  if (group.mounts > 0) return;
  discardUnsaved(group);
  if (group.pending === 0) forget(key, group);
  notify(key);
}

function showPatch<S extends object>(group: Group<S>, patch: Partial<S>): void {
  const prev = group.shown;
  if (prev === null) return;
  const next = { ...prev, ...patch };
  group.shown = next;
  for (const k of Object.keys(patch) as (keyof S)[]) {
    if (prev[k] !== next[k]) group.handlers.apply(k, next[k]);
  }
}

function claim<S extends object>(group: Group<S>, patch: Partial<S>, unsaved: boolean): number {
  group.lastClaim += 1;
  for (const k of Object.keys(patch) as (keyof S)[]) group.claims.set(k, { token: group.lastClaim, unsaved });
  return group.lastClaim;
}

function heldBy<S extends object>(group: Group<S>, patch: Partial<S>, token: number): (keyof S)[] {
  return (Object.keys(patch) as (keyof S)[]).filter((k) => group.claims.get(k)?.token === token);
}

function unsavedEdits<S extends object>(group: Group<S>): Partial<S> {
  const edits: Partial<S> = {};
  const now = group.shown;
  if (now === null) return edits;
  for (const [k, c] of group.claims) if (c.unsaved) edits[k] = now[k];
  return edits;
}

function discardUnsaved<S extends object>(group: Group<S>): void {
  const base = group.confirmed;
  if (base === null) return;
  const restore: Partial<S> = {};
  for (const [k, c] of group.claims) {
    if (!c.unsaved) continue;
    restore[k] = base[k];
    group.claims.delete(k);
  }
  showPatch(group, restore);
}

/** No page left and nothing in flight: bring the live app to the saved value, then drop the group. */
function forget<S extends object>(key: GroupKey, group: Group<S>): void {
  const base = group.confirmed;
  const now = group.shown;
  if (base !== null && now !== null) {
    for (const k of Object.keys(base) as (keyof S)[]) {
      if (now[k] !== base[k]) group.handlers.apply(k, base[k]);
    }
  }
  groups.delete(key);
}

/** Capture at read start; a write or group replacement invalidates this ticket. */
export function readTicket(key: GroupKey): number {
  return version(key);
}

/** Seed from a read only while its start ticket is current and the group is idle. */
export function load<S extends object>(key: GroupKey, slice: S, ticket = readTicket(key)): void {
  const group = find<S>(key);
  if (!group || isBusy(key) || ticket !== version(key)) return;
  group.confirmed = slice;
  group.shown = slice;
  notify(key);
}

/** Show and claim a change without saving it yet (e.g. while typing). */
export function edit<S extends object>(key: GroupKey, patch: Partial<S>): void {
  const group = find<S>(key);
  if (!group || group.shown === null) return;
  claim(group, patch, true);
  showPatch(group, patch);
  notify(key);
}

/** Show and claim a change, and queue its save. Resolves true when it saved. */
export function write<S extends object>(
  key: GroupKey,
  patch: Partial<S>,
  opts: { rollback?: boolean } = {},
): Promise<boolean> {
  const group = find<S>(key);
  if (!group || group.shown === null || group.confirmed === null) return Promise.resolve(false);
  const acceptedHandlers = group.handlers;
  const token = claim(group, patch, false);
  showPatch(group, patch);
  group.pending += 1;
  notify(key);

  const sendOnce = async (): Promise<boolean> => {
    const base = group.confirmed;
    if (base === null) return false;
    const carried = unsavedEdits(group);
    const next = { ...base, ...carried, ...patch };
    let saved: unknown;
    try {
      saved = await acceptedHandlers.save(next, { ...carried, ...patch });
    } catch {
      if (opts.rollback === false) {
        for (const k of heldBy(group, patch, token)) group.claims.set(k, { token, unsaved: true });
      } else {
        // `base` is still the confirmed value: writes run one at a time, and
        // `load` is ignored while this one is pending.
        const restore: Partial<S> = {};
        for (const k of heldBy(group, patch, token)) restore[k] = base[k];
        showPatch(group, restore);
      }
      return false;
    }
    const returned = saved && typeof saved === "object" ? saved as Partial<S> : null;
    const confirmed = { ...next };
    if (returned) {
      for (const k of Object.keys(confirmed) as (keyof S)[]) {
        if (k in returned) confirmed[k] = returned[k] as S[keyof S];
      }
    }
    // Carried edits are saved now; one the user changed again stays unsaved.
    for (const k of Object.keys(carried) as (keyof S)[]) {
      const c = group.claims.get(k);
      if (c?.unsaved && group.shown?.[k] === next[k]) group.claims.set(k, { ...c, unsaved: false });
    }
    group.confirmed = confirmed;
    const reconcile: Partial<S> = {};
    for (const k of Object.keys(confirmed) as (keyof S)[]) {
      if ((group.claims.get(k)?.token ?? 0) <= token && group.shown?.[k] !== confirmed[k]) {
        reconcile[k] = confirmed[k];
      }
    }
    showPatch(group, reconcile);
    group.handlers.onConfirm(confirmed);
    return true;
  };

  const send = async (): Promise<boolean> => {
    try {
      return await sendOnce();
    } finally {
      group.pending -= 1;
      if (group.mounts === 0) {
        // A rollback-off failure after close leaves typing nobody can see; discard it.
        discardUnsaved(group);
        if (group.pending === 0 && groups.get(key) === (group as unknown as Group<object>)) forget(key, group);
      }
      notify(key);
    }
  };
  const result = group.queue.then(send);
  group.queue = result.catch(() => false);
  return result;
}

/** Tests only: forget every group. */
export function resetSettingsWriterRegistry(): void {
  groups.clear();
  versions.clear();
}
