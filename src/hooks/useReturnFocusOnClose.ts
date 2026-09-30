/**
 * Purpose: give keyboard focus back to whatever held it when a dialog opened, once that
 * dialog closes (D37 WI-6, the O2 fix). Without it, closing a dialog whose buttons had
 * focus drops focus to `<body>`, and the next keystrokes go nowhere. D34 will adopt this
 * hook for `ConfirmDialog.tsx`, which has the same gap.
 *
 * Pipeline: first render → save `document.activeElement` (the prior element) · unmount
 * (every dismissal path: button, Escape, backdrop, an external resolve) → if focus is
 * inside the closing container or on body/null: focus the first saved prior element
 * that is still connected (`preventScroll`), else `fallback()`'s element · otherwise
 * leave focus alone.
 *
 * Key decisions:
 * - **Captured at render, not in an effect**: a lazy `useState` initializer runs before
 *   commit, so it sees focus before the dialog's `autoFocus` child takes it (RF-1).
 * - **Unmount-based, via a layout-effect cleanup**: it runs while the container is still
 *   in the document and before the next dialog's `autoFocus`, so the return is
 *   synchronous with the close (Approve → focus back → only then the MCP write lands).
 * - **Queued dialogs inherit** (F6): when the prior element is inside another open
 *   container of this hook (the previous prompt being swapped out by `key`), the new
 *   instance also saves that container's own priors, and the first one still connected
 *   at close wins. A container that stays open keeps focus (RF-10).
 * - **Never steals** (RF-4): focus that moved outside the container is left alone, and
 *   the fallback is not even called.
 * - **Fallback only when a prior element existed but is gone** (RF-9): opened from body →
 *   nothing to return to, so nothing is focused.
 * - **Never throws**: a throwing fallback or focus call is contained.
 *
 * @module hooks/useReturnFocusOnClose
 * @coordinates-with src/components/common/McpWriteConfirmDialog.tsx — the first adopter
 * @coordinates-with src/utils/focusActiveMilkdownAtEnd.ts — that dialog's fallback
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** A getter for the element to focus when every saved prior element is gone. */
export type FocusFallback = () => HTMLElement | null | undefined;

interface OpenContainer {
  container: HTMLElement;
  priors: readonly HTMLElement[];
}

/** Every mounted instance's container and priors (for the queued-dialog inheritance). */
const openContainers = new Set<OpenContainer>();

function capturePriors(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return [];
  const owner = [...openContainers].find((entry) => entry.container.contains(active));
  return owner ? [active, ...owner.priors] : [active];
}

function focusOrBodyIn(container: HTMLElement): boolean {
  const active = document.activeElement;
  return !active || active === document.body || container.contains(active);
}

function returnFocus(container: HTMLElement, priors: readonly HTMLElement[], fallback?: FocusFallback): void {
  if (priors.length === 0 || !focusOrBodyIn(container)) return;
  try {
    const target = priors.find((el) => el.isConnected) ?? fallback?.() ?? null;
    target?.focus({ preventScroll: true });
  } catch {
    // Never throw from an unmount: a failed return leaves focus where it is.
  }
}

/**
 * Return focus to the element that held it when this component mounted, on unmount.
 * `containerRef` is the dialog's own element; `fallback` supplies a target when the
 * saved element has been disconnected meanwhile.
 */
export function useReturnFocusOnClose(
  containerRef: RefObject<HTMLElement | null>,
  fallback?: FocusFallback,
): void {
  const [priors] = useState(capturePriors);
  const fallbackRef = useRef(fallback);

  useLayoutEffect(() => {
    fallbackRef.current = fallback;
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const entry: OpenContainer = { container, priors };
    openContainers.add(entry);
    return () => {
      openContainers.delete(entry);
      returnFocus(container, priors, fallbackRef.current);
    };
  }, [containerRef, priors]);
}
