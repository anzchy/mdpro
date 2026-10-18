/**
 * @module hooks/useFileOpenEvent
 * Purpose: Subscribe this window to `file:open`, which Rust sends to exactly
 * one window (D279: the focused, else last-focused, else lowest live label;
 * `services/open_route`), and open each delivered path list through App's
 * `openPaths`. The default view mode is applied once per event, after the
 * first file that opened and became active (D51 / D95), through an
 * `onFirstSuccess` latch made per event.
 *
 * Key decisions:
 *   - Subscribe through `getCurrentWindow().listen`, never the global `listen`
 *     of `@tauri-apps/api/event`: a global (`Any`) listener hears every
 *     targeted emit, so every window would open the same files (D279).
 *   - No focus question. The old `shouldHandleWindowEvent` asked `isFocused()`
 *     and failed open (`catch → true`), and refused the open when another app
 *     was frontmost. Rust has already chosen the window.
 *   - The `listen` call stays literal (`getCurrentWindow().listen<…>("file:open"`)
 *     so tests/d279-file-open-window-listener-source.test.ts can pin it.
 *   - A synchronous throw from `listen` becomes a rejection, and a rejection
 *     (outside Tauri, `pnpm dev`) is swallowed: no file-open events, nothing else.
 *   - A `cancelled` flag makes a `listen()` that resolves after cleanup call its
 *     unlisten at once, and stops an event delivered in that gap, so a re-render
 *     with a new `defaultViewMode` never leaves two live subscriptions (the
 *     same shape as `useMenuEvents.ts`, D31).
 *   - No logging: the open pipeline (`openPaths`) logs each `file.open.*`, and
 *     the App listener this replaces logged nothing of its own.
 *
 * @coordinates-with src-tauri/src/services/open_route/execute.rs — sends the broadcast group to one window
 * @coordinates-with src/App.tsx — calls this hook once with the store setter
 * @coordinates-with src/hooks/useOpenPaths.ts — openPaths, which runs `onOpened` per activated open
 * @coordinates-with src/utils/onFirstSuccess.ts — the per-event latch
 */
import { useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onFirstSuccess } from "../utils/onFirstSuccess";
import type { ViewMode } from "../types/editor";

export interface UseFileOpenEventOptions {
  /** The preference applied after the first successful open of each event. */
  defaultViewMode: ViewMode;
  /** App's by-path open; calls `onOpened` after each file that opened and became active. */
  openPaths: (paths: string[], onOpened?: () => void) => Promise<void>;
  /** The store's programmatic setter, never the user adapter (D24). */
  setViewMode: (mode: ViewMode) => void;
}

function listenOnThisWindow(onPaths: (paths: string[] | null) => void): Promise<() => void> {
  try {
    return getCurrentWindow().listen<string[]>("file:open", (event) => onPaths(event.payload));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function useFileOpenEvent({ defaultViewMode, openPaths, setViewMode }: UseFileOpenEventOptions): void {
  const handleFileOpenEvent = useCallback(
    (paths: string[] | null) => {
      if (!paths || paths.length === 0) return;
      // When a second launch opens a file while the app is running, the default view mode
      // from preferences applies once a file has opened; if every open fails, the
      // current document keeps its mode (D51).
      void openPaths(paths, onFirstSuccess(() => setViewMode(defaultViewMode)));
    },
    [defaultViewMode, openPaths, setViewMode],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listenOnThisWindow((paths) => {
      // Delivered between a late resolve and its unlisten: this subscription is gone.
      if (cancelled) return;
      handleFileOpenEvent(paths);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Running outside Tauri: no file-open events.
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [handleFileOpenEvent]);
}
