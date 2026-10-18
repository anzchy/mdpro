/**
 * useSettingsWriter
 *
 * Purpose: one serialized writer per Settings page (WI-4.3b round 2, PR #508
 * F508-1..4). A change shows at once, its save waits for every earlier save on
 * the page, and a failed save rolls back to the value the backend last
 * confirmed, never to a snapshot that was itself only optimistic.
 *
 * Pipeline: write(patch) → show patch + claim its keys → queue →
 *   (when sent) save(confirmed ⊕ unsaved edits ⊕ patch)
 *     → success: confirmed = that value
 *     → failure: keys this write still holds back to confirmed
 *       (or, with `rollback: false`, kept shown as unsaved edits)
 *
 * Key decisions:
 * - The value a save sends is built when it is *sent*, from the confirmed value
 *   plus that write's own patch. A sibling write that failed earlier in the
 *   queue therefore never rides along in a later, successful one.
 * - Unsaved edits do ride along: a key shown through `edit` (typing inside a
 *   debounce window) is the user's current choice, so a toggle sent meanwhile
 *   carries it rather than the older saved value (Export WI1-A, Image twin).
 * - A text field's write passes `rollback: false`: on failure the typed text
 *   stays shown, as an unsaved edit, and the service's toast is the signal
 *   (Export WI1-J, Image WI2-I). Switches and selects roll back (DESIGN.md § States).
 * - Every write or edit claims the keys it touches. A failed write rolls back
 *   only the keys it still holds; a newer edit to the same key (typing, a
 *   second toggle) is the user's latest intent and stays shown.
 * - Closing the page drops its queued, not-yet-sent writes: discard, don't
 *   flush, as the debounced text fields already do. Sending them later would
 *   put an old instance's write over a newer one's after Settings is reopened
 *   (PR #508 N1). The write already in flight cannot be recalled; its late
 *   result still reaches the live app (`onConfirm`, and `apply` back to the
 *   confirmed value for every key the page left unsaved), but only while no
 *   newer instance of the same `group` is mounted. A newer instance read the
 *   saved value itself and owns the live app from then on.
 * - Failure signalling stays with the save function (`preferencesService`,
 *   `loggingService` raise the one toast); the hook adds no second signal.
 *
 * @coordinates-with src/components/common/settings/{General,Editor,Appearance,Markdown,Image,Export,Advanced}Settings.tsx
 * @module components/common/settings/useSettingsWriter
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Latest mount per `group`, so a closed instance can tell it was replaced. */
const latestMount = new Map<string, number>();
let mountSeq = 0;

export interface SettingsWriterOptions<S extends object> {
  /** The preferences group this page writes; instances of one page share it. */
  group?: string;
  /** Persist `next` (the confirmed value plus `patch`); reject on failure. */
  save: (next: S, patch: Partial<S>) => Promise<unknown>;
  /** Side effect for each key whose shown value changes (optimistic or rollback). */
  apply?: (key: keyof S, value: S[keyof S]) => void;
  /** Called with each value the backend confirmed. */
  onConfirm?: (confirmed: S) => void;
}

export interface SettingsWriter<S extends object> {
  /** The value to render; null until `load`. */
  value: S | null;
  /** Seed the shown and confirmed value from a successful read. */
  load: (slice: S) => void;
  /** Show and claim a change without saving it yet (e.g. while typing). */
  edit: (patch: Partial<S>) => void;
  /** Show and claim a change, and queue its save. Resolves true when it saved. */
  write: (patch: Partial<S>, opts?: { rollback?: boolean }) => Promise<boolean>;
  /** The shown value, readable synchronously (timers, after an await). */
  current: () => S | null;
  /** True while a write is queued or in flight, or an edit is unsaved. */
  busy: () => boolean;
}

export function useSettingsWriter<S extends object>(options: SettingsWriterOptions<S>): SettingsWriter<S> {
  const [value, setValue] = useState<S | null>(null);
  const optionsRef = useRef(options);
  const shown = useRef<S | null>(null);
  const confirmed = useRef<S | null>(null);
  /** Per key: the latest claim, and whether it is an unsaved edit to carry along. */
  const claims = useRef(new Map<keyof S, { token: number; unsaved: boolean }>());
  const lastClaim = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const mountId = useRef(0);
  const pending = useRef(0);

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    mounted.current = true;
    mountSeq += 1;
    mountId.current = mountSeq;
    const { group } = optionsRef.current;
    if (group !== undefined) latestMount.set(group, mountSeq);
    return () => {
      mounted.current = false;
    };
  }, []);

  /** No newer instance of this page's group has mounted since this one. */
  const isLatest = () => {
    const { group } = optionsRef.current;
    return group === undefined || latestMount.get(group) === mountId.current;
  };

  /** After close: bring the live app back to the confirmed value for every key left unsaved. */
  const reconcileClosed = () => {
    const base = confirmed.current;
    const now = shown.current;
    if (base === null || now === null) return;
    for (const key of Object.keys(base) as (keyof S)[]) {
      if (now[key] !== base[key]) optionsRef.current.apply?.(key, base[key]);
    }
  };

  const show = (next: S) => {
    shown.current = next;
    if (mounted.current) setValue(next);
  };

  const showPatch = (patch: Partial<S>) => {
    const prev = shown.current;
    if (prev === null) return;
    const next = { ...prev, ...patch };
    show(next);
    for (const key of Object.keys(patch) as (keyof S)[]) {
      if (prev[key] !== next[key]) optionsRef.current.apply?.(key, next[key]);
    }
  };

  const claim = (patch: Partial<S>, unsaved: boolean): number => {
    lastClaim.current += 1;
    for (const key of Object.keys(patch) as (keyof S)[]) {
      claims.current.set(key, { token: lastClaim.current, unsaved });
    }
    return lastClaim.current;
  };

  /** Keys whose latest claim is `token`, i.e. no later edit or write took them. */
  const heldBy = (patch: Partial<S>, token: number): (keyof S)[] =>
    (Object.keys(patch) as (keyof S)[]).filter((key) => claims.current.get(key)?.token === token);

  /** Unsaved edits, at their shown values, to carry in the next save. */
  const unsavedEdits = (): Partial<S> => {
    const edits: Partial<S> = {};
    const now = shown.current;
    if (now === null) return edits;
    for (const [key, c] of claims.current) if (c.unsaved) edits[key] = now[key];
    return edits;
  };

  const rollback = (patch: Partial<S>, token: number) => {
    const base = confirmed.current;
    if (base === null) return;
    const restore: Partial<S> = {};
    for (const key of heldBy(patch, token)) restore[key] = base[key];
    if (Object.keys(restore).length > 0) showPatch(restore);
  };

  const load = (slice: S) => {
    confirmed.current = slice;
    show(slice);
  };

  const edit = (patch: Partial<S>) => {
    if (shown.current === null) return;
    claim(patch, true);
    showPatch(patch);
  };

  const write = (patch: Partial<S>, opts: { rollback?: boolean } = {}): Promise<boolean> => {
    if (shown.current === null || confirmed.current === null) return Promise.resolve(false);
    const token = claim(patch, false);
    showPatch(patch);
    pending.current += 1;
    const send = async (): Promise<boolean> => {
      try {
        return await sendOnce();
      } finally {
        pending.current -= 1;
      }
    };
    const sendOnce = async (): Promise<boolean> => {
      // Closed before its turn: dropped, never sent (N1).
      if (!mounted.current) return false;
      const base = confirmed.current;
      if (base === null) return false;
      const carried = unsavedEdits();
      const next = { ...base, ...carried, ...patch };
      let saved = true;
      try {
        await optionsRef.current.save(next, patch);
      } catch {
        saved = false;
      }
      if (!mounted.current) {
        // Closed while in flight: the backend's answer is still the truth, but
        // only reaches the live app if no newer instance has taken over.
        if (saved) confirmed.current = next;
        if (isLatest()) {
          if (saved) optionsRef.current.onConfirm?.(next);
          reconcileClosed();
        }
        return saved;
      }
      if (!saved) {
        if (opts.rollback === false) {
          for (const key of heldBy(patch, token)) claims.current.set(key, { token, unsaved: true });
        } else {
          rollback(patch, token);
        }
        return false;
      }
      // Carried edits are saved now; one the user changed again stays unsaved.
      for (const key of Object.keys(carried) as (keyof S)[]) {
        const c = claims.current.get(key);
        if (c?.unsaved && shown.current?.[key] === next[key]) claims.current.set(key, { ...c, unsaved: false });
      }
      confirmed.current = next;
      optionsRef.current.onConfirm?.(next);
      return true;
    };
    const result = queue.current.then(send);
    queue.current = result.catch(() => false);
    return result;
  };

  const busy = () =>
    pending.current > 0 || [...claims.current.values()].some((c) => c.unsaved);

  return { value, load, edit, write, current: () => shown.current, busy };
}
