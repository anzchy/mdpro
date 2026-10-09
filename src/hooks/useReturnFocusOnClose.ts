/**
 * Purpose: give keyboard focus back to whatever held it when a dialog opened, once that
 * dialog closes (D37 WI-6, the O2 fix). Without it, closing a dialog whose buttons had
 * focus drops focus to `<body>`, and the next keystrokes go nowhere. `ConfirmDialog.tsx`
 * has the same gap; D34 did not adopt this hook there (D34 changed only its Escape
 * handling), so that focus return stays deferred.
 *
 * Pipeline: first render → save `document.activeElement` (the prior element) · unmount
 * (every dismissal path: button, Escape, backdrop, an external resolve) → if focus is
 * inside the closing container or on body/null: focus the first saved prior element
 * that is still connected (`preventScroll`), else `fallback()`'s element · otherwise
 * leave focus alone.
 *
 * Key decisions:
 * - **Captured at render, not in an effect**: a lazy `useState` initializer runs before
 *   commit, so it sees focus before the dialog's initial-focus layout effect takes it (RF-1).
 * - **Unmount-based, via a layout-effect cleanup**: it runs while the container is still
 *   in the document and before the next dialog's initial-focus layout effect, so the return is
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
 * - **Queryable and redirectable** (D38, ADR-0060):`pendingReturnTarget` tells the D37 focus capture
 *   where an open container holding focus will return it; `redirectReturnFocus` lets the
 *   rebuilt editor's restore make its new `view.dom` that container's first target, so a
 *   queued prompt closes onto the rebuilt view instead of the end fallback.
 * - **A prompt that opened after the capture** (D38R, ADR-0061, amends ADR-0060): Rust
 *   shows one prompt at a time, so an approved write can land while focus is back on the
 *   old editor, before the next prompt exists. That prompt then saves the old view (gone
 *   once the rebuild commits) or nothing (opened from body). `wouldReturnIntoGone` lets
 *   the restore recognise it — no saved target still connected, and what was saved is
 *   the old view or nothing — so the redirect steals nothing. `describeReturnFocus`
 *   supplies the content-free `active` / `promptTarget` categories for its log lines.
 *
 * @module hooks/useReturnFocusOnClose
 * @coordinates-with src/components/common/McpWriteConfirmDialog.tsx — the first adopter
 * @coordinates-with src/utils/focusActiveMilkdownAtEnd.ts — that dialog's fallback
 * @coordinates-with src/utils/milkdownFocusCarry.ts — capture reads `pendingReturnTarget` (D38)
 * @coordinates-with src/hooks/useMilkdownFocusRestore.ts — restore calls `redirectReturnFocus` (D38),
 *   `wouldReturnIntoGone` and `describeReturnFocus` (D38R)
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** A getter for the element to focus when every saved prior element is gone. */
export type FocusFallback = () => HTMLElement | null | undefined;

interface OpenContainer {
  container: HTMLElement;
  /** Return targets, first connected wins; `redirectReturnFocus` prepends to it. */
  priors: readonly HTMLElement[];
}

/** Every mounted instance's container and priors (for the queued-dialog inheritance). */
const openContainers = new Set<OpenContainer>();

function ownerOf(el: Element | null): OpenContainer | undefined {
  if (!el) return undefined;
  return [...openContainers].find((entry) => entry.container.contains(el));
}

function capturePriors(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return [];
  const owner = ownerOf(active);
  return owner ? [active, ...owner.priors] : [active];
}

/**
 * Where the open container holding `el` would return focus if it closed now: its first
 * still-connected saved element, or null (no such container, or every target is gone).
 */
export function pendingReturnTarget(el: Element | null): HTMLElement | null {
  return ownerOf(el)?.priors.find((prior) => prior.isConnected) ?? null;
}

/**
 * Make `target` the first return target of the open container holding `el` (later
 * queued containers inherit it). False, changing nothing, when no open container holds `el`.
 */
export function redirectReturnFocus(el: Element | null, target: HTMLElement): boolean {
  const owner = ownerOf(el);
  if (!owner) return false;
  owner.priors = [target, ...owner.priors];
  return true;
}

/**
 * D38R (ADR-0061): true when an open container holds `el`, none of its saved priors is
 * still connected, and its priors are empty (opened from body) or include `oldDom` (it
 * was opened from the editor view a rebuild has since removed). Handing such a container
 * the rebuilt view steals nothing: closing it would otherwise focus nothing, or take the
 * end fallback. A connected prior anywhere, or a lost unrelated target, keeps it false.
 */
export function wouldReturnIntoGone(el: Element | null, oldDom: Element): boolean {
  const owner = ownerOf(el);
  if (!owner || owner.priors.some((prior) => prior.isConnected)) return false;
  return owner.priors.length === 0 || savedIn(owner, oldDom);
}

function savedIn(owner: OpenContainer, el: Element): boolean {
  return (owner.priors as readonly Element[]).includes(el);
}

/** Log category of the focus holder (rule 20: categories only, never content). */
export type ActiveFocusKind = "editor" | "prompt" | "body" | "other";
/** Log category of where the container holding focus would return it. */
export type PromptTargetKind = "none" | "empty" | "old-editor" | "live" | "gone" | "other";

const EDITOR_SELECTOR = ".ProseMirror, .cm-editor";

/**
 * Diagnostic categories for the D38 restore log lines: what holds focus, and where the
 * open container holding it (if any) would return focus — into `liveDom` (the rebuilt
 * view), elsewhere, to nothing it ever had (`empty`), or to a target now gone (`old-editor`
 * when that was `oldDom`).
 */
export function describeReturnFocus(
  el: Element | null,
  oldDom: Element,
  liveDom: Element,
): { active: ActiveFocusKind; promptTarget: PromptTargetKind } {
  const owner = ownerOf(el);
  const active: ActiveFocusKind =
    !el || el === document.body ? "body" : owner ? "prompt" : el.closest(EDITOR_SELECTOR) ? "editor" : "other";
  if (!owner) return { active, promptTarget: "none" };
  if (owner.priors.length === 0) return { active, promptTarget: "empty" };
  const live = owner.priors.find((prior) => prior.isConnected);
  if (live) return { active, promptTarget: liveDom.contains(live) ? "live" : "other" };
  return { active, promptTarget: savedIn(owner, oldDom) ? "old-editor" : "gone" };
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
      returnFocus(container, entry.priors, fallbackRef.current);
    };
  }, [containerRef, priors]);
}
