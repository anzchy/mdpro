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
 * - Unmounting does not cancel the queue: every write already queued is sent
 *   once, so closing Settings loses no change the user made. Only React state
 *   stops updating; `apply` and `onConfirm` still run, because they reach the
 *   live app (theme, editor, logging store), which must end at the saved value.
 * - Failure signalling stays with the save function (`preferencesService`,
 *   `loggingService` raise the one toast); the hook adds no second signal.
 *
 * @coordinates-with src/components/common/settings/{General,Editor,Appearance,Markdown,Image,Export,Advanced}Settings.tsx
 * @module components/common/settings/useSettingsWriter
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface SettingsWriterOptions<S extends object> {
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

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    const send = async (): Promise<boolean> => {
      const base = confirmed.current;
      if (base === null) return false;
      const carried = unsavedEdits();
      const next = { ...base, ...carried, ...patch };
      try {
        await optionsRef.current.save(next, patch);
      } catch {
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

  return { value, load, edit, write, current: () => shown.current };
}
