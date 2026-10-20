/**
 * useSettingsWriter
 *
 * Purpose: a Settings page's view of its group's serialized writer (WI-4.3b,
 * PR #508). A change shows at once, its save waits for every earlier save in
 * the group, and a failed save rolls back to the value the backend last
 * confirmed, never to a snapshot that was itself only optimistic.
 *
 * Pipeline: page → this hook → settingsWriterRegistry (one queue per `group`,
 *   at module level) → save(confirmed ⊕ unsaved edits ⊕ patch) → the hook
 *   re-renders from the registry (useSyncExternalStore)
 *
 * Key decisions:
 * - The writer lives in the registry, not in the component (round 4, the N1
 *   class). Closing Settings no longer drops queued writes or orphans one in
 *   flight: every accepted write is sent in order, its result reaches the live
 *   app, and a page reopened meanwhile shows the live value. See the registry
 *   header for the queue's rules.
 * - Unsaved edits ride along: a key shown through `edit` (typing inside a
 *   debounce window) is the user's current choice, so a toggle sent meanwhile
 *   carries it (Export WI1-A, Image twin). Closing the page discards them.
 * - A text field's write passes `rollback: false`: on failure the typed text
 *   stays shown, as an unsaved edit, and the service's toast is the signal
 *   (Export WI1-J, Image WI2-I). Switches and selects roll back (DESIGN.md § States).
 * - A closed instance accepts nothing: `write`, `edit` and `load` from it are
 *   no-ops, so a callback that outlives the page (a folder picker) cannot
 *   start a write nobody can see.
 * - Failure signalling stays with the save function (`preferencesService`,
 *   `loggingService` raise the one toast). A pending save stays pending.
 * - Without a `group` the writer is private to this instance (hook tests).
 *
 * @coordinates-with src/components/common/settings/settingsWriterRegistry.ts
 * @coordinates-with src/components/common/settings/{General,Editor,Appearance,Markdown,Image,Export,Advanced}Settings.tsx
 * @module components/common/settings/useSettingsWriter
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import * as registry from "./settingsWriterRegistry";
import type { GroupHandlers } from "./settingsWriterRegistry";

export interface SettingsWriterOptions<S extends object> {
  /** The preferences group this page writes; every instance of the page shares it. */
  group?: string;
  /** Persist `next` (the confirmed value plus `patch`); reject on failure. */
  save: (next: S, patch: Partial<S>) => Promise<unknown>;
  /** Side effect for each key whose shown value changes (optimistic or rollback). */
  apply?: (key: keyof S, value: S[keyof S]) => void;
  /** Called with each value the backend confirmed. */
  onConfirm?: (confirmed: S) => void;
}

export interface SettingsWriter<S extends object> {
  /** The value to render; null until loaded. */
  value: S | null;
  /** Seed the shown and confirmed value from a successful read (ignored while the group is busy). */
  load: (slice: S, ticket?: number) => void;
  /** Capture when the read starts, before awaiting the service. */
  readTicket: () => number;
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
  const optionsRef = useRef(options);
  const [privateKey] = useState(() => Symbol("settings-writer"));
  const key: registry.GroupKey = options.group ?? privateKey;
  const mounted = useRef(false);

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  // Forwarders, so the registry always calls this instance's latest options.
  const [handlers] = useState<GroupHandlers<S>>(() => ({
    save: (next, patch) => optionsRef.current.save(next, patch),
    apply: (k, v) => optionsRef.current.apply?.(k, v),
    onConfirm: (confirmed) => optionsRef.current.onConfirm?.(confirmed),
  }));

  useEffect(() => {
    mounted.current = true;
    registry.mount(key, handlers);
    return () => {
      mounted.current = false;
      registry.unmount(key);
    };
  }, [key, handlers]);

  const subscribe = useCallback((listener: () => void) => registry.subscribe(key, listener), [key]);
  useSyncExternalStore(subscribe, () => registry.version(key));

  return {
    value: registry.shownValue<S>(key),
    load: (slice, ticket) => {
      if (mounted.current) registry.load(key, slice, ticket);
    },
    readTicket: () => registry.readTicket(key),
    edit: (patch) => {
      if (mounted.current) registry.edit(key, patch);
    },
    write: (patch, opts) => (mounted.current ? registry.write(key, patch, opts) : Promise.resolve(false)),
    current: () => registry.shownValue<S>(key),
    busy: () => registry.isBusy(key),
  };
}
