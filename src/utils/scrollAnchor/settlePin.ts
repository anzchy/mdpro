/**
 * Purpose: the WYSIWYG layout-settle pin (D22). After a caller has written `scrollTop` to
 * put a target on the anchor line (an outline click, a mode-switch restore), keep it
 * there while layout above it is still settling — images decoding after the write grow
 * the document under a fixed `scrollTop` and would otherwise carry the target away.
 * `pinDuringLayoutSettle` re-runs the caller's own `reapply()` on every layout trigger,
 * for a bounded window, and stands down the moment `scrollTop` stops being its own.
 *
 * Key decisions:
 *   - **Pin, not reserve.** The permanent fix is reserving image dimensions at render
 *     (`width`/`height` from intrinsic size), which needs a Rust image-size IPC. Until
 *     then the pin corrects after the fact; images that finish loading after the window
 *     are the accepted residual defect.
 *   - **Only while `scrollTop` is ours.** `lastWritten` is read back from the scroller
 *     after every write (arm and each re-pin), so engine flooring and clamping are
 *     captured. Any `scroll` event, or any trigger, that finds `scrollTop !== lastWritten`
 *     ends the pin as `user-scroll`, and no write ever follows — not even at the deadline.
 *     The pin's own write may fire `scroll` synchronously (the test fixtures), before
 *     `lastWritten` is updated — a `writing` flag keeps that event from cancelling it — or
 *     on the next frame (WebKit), after `lastWritten` is updated, when it passes the
 *     equality check. Both paths are safe.
 *   - **ResizeObserver primary, `load` fallback.** A `ResizeObserver` on `observed`
 *     (`.ProseMirror`) runs after layout and before paint, so a re-pin shows no jump; it
 *     is feature-detected like `useWysiwygScrollSpy`. A capture-phase `load` listener on
 *     the scroller (image `load` does not bubble) is the fallback, gated by `loadFilter`;
 *     the filter never applies to the ResizeObserver path. A re-pin that moved nothing
 *     writes nothing (the caller's write is same-value), so extra triggers are free.
 *   - **Bounded window, measured from arm.** `windowMs` (default `SETTLE_PIN_WINDOW_MS`);
 *     triggers do not extend it. At the deadline one final re-pin runs if still pinned,
 *     then everything is torn down.
 *   - **One pin per scroller** (module `WeakMap`): arming disposes the previous pin on
 *     that scroller as `replaced`. Pins on different scrollers are independent.
 *   - **Exits**: `expired`, `user-scroll`, `replaced`, `detached` (scroller disconnected at
 *     a trigger, or `reapply()` returned false / threw), `disposed`. `detached` also covers
 *     the caller's target no longer resolving (e.g. an edit changed the block count). Every
 *     exit disconnects the observer, removes both listeners and clears the timer. Never throws.
 *   - **One `editor.scroll_anchor.settle` log per window**, at the exit, with enums and
 *     integer counts only. `triggers` = triggers handled while pinned (a trigger that
 *     detects user-scroll or detachment, or a `load` the filter rejects, is not counted);
 *     `repins` = `reapply()` calls, including no-ops and the final re-pin.
 *   - A real `ResizeObserver` delivers an initial callback after `observe()`; with the
 *     layout unchanged that is a counted, no-op re-pin.
 *
 * Callers: `scrollHeadingToAnchor` (milkdown.ts, outline clicks, source `"toc"`, D22 WI-3)
 * and `useMilkdownScrollRestore` (mode-switch restore, source `"restore"`, D22 WI-4). It
 * lives in its own module because the restore tests mock `./milkdown` wholesale.
 *
 * @module src/utils/scrollAnchor/settlePin
 * @coordinates-with src/services/loggingService.ts (`logEventSync`)
 * @coordinates-with src/utils/scrollAnchor/milkdown.ts (`scrollHeadingToAnchor`, a caller)
 * @coordinates-with src/hooks/useMilkdownScrollRestore.ts (a caller)
 * @coordinates-with src/hooks/useWysiwygScrollSpy.ts (same ResizeObserver feature detect)
 */
import { loggingService } from "../../services/loggingService";

/** Default settle window, from arm. Adjustable assumption; confirm on a real device. */
export const SETTLE_PIN_WINDOW_MS = 1500;
export const SETTLE_LOG_EVENT = "editor.scroll_anchor.settle";

export type SettlePinSource = "toc" | "restore";
export type SettlePinOutcome = "expired" | "user-scroll" | "replaced" | "detached" | "disposed";

export interface SettlePinOptions {
  /** The element that scrolls (`div.milkdown`). */
  scroller: HTMLElement;
  /** The element whose size changes as layout settles (`.ProseMirror`). */
  observed: Element;
  /** The caller's own landing write; false means the target is gone (ends the pin). */
  reapply: () => boolean;
  source: SettlePinSource;
  /** Gates the `load` fallback only; receives the element that loaded. */
  loadFilter?: (target: Element) => boolean;
  /** Window length from arm, ms. Default `SETTLE_PIN_WINDOW_MS`. */
  windowMs?: number;
}

const activePins = new WeakMap<HTMLElement, (outcome: SettlePinOutcome) => void>();

function logSettle(
  source: SettlePinSource,
  outcome: SettlePinOutcome,
  repins: number,
  triggers: number,
): void {
  try {
    loggingService.logEventSync({
      level: "info",
      event: SETTLE_LOG_EVENT,
      status: outcome === "expired" ? "success" : "cancel",
      actionId: loggingService.generateActionId(),
      context: { surface: "wysiwyg", source, outcome, repins, triggers },
    });
  } catch {
    // Logging must never break scrolling.
  }
}

/**
 * Keep the caller's target pinned while layout settles. Call right AFTER the caller's
 * first write. Returns an idempotent dispose (outcome `disposed` if still pinned).
 */
export function pinDuringLayoutSettle(options: SettlePinOptions): () => void {
  const { scroller, observed, reapply, source, loadFilter } = options;
  const windowMs = options.windowMs ?? SETTLE_PIN_WINDOW_MS;

  let done = false;
  let writing = false;
  let lastWritten = 0;
  let repins = 0;
  let triggers = 0;
  let observer: ResizeObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const teardownObserver = () => {
    try {
      observer?.disconnect();
    } catch {
      // A broken observer has nothing left to release.
    }
    observer = null;
  };

  const teardown = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    scroller.removeEventListener("scroll", onScroll);
    scroller.removeEventListener("load", onLoad, true);
    teardownObserver();
    if (activePins.get(scroller) === stop) activePins.delete(scroller);
  };

  function stop(outcome: SettlePinOutcome): void {
    if (done) return;
    done = true;
    try {
      teardown();
    } catch {
      // Teardown is best-effort; the `done` flag already silences every handler.
    }
    logSettle(source, outcome, repins, triggers);
  }

  /** True while the pin may act; otherwise ends it (detached / user-scroll). */
  const stillOurs = (): boolean => {
    if (!scroller.isConnected) stop("detached");
    else if (scroller.scrollTop !== lastWritten) stop("user-scroll");
    return !done;
  };

  const repin = () => {
    repins += 1;
    let ok = false;
    writing = true;
    try {
      ok = reapply();
    } catch {
      ok = false;
    } finally {
      writing = false;
    }
    if (ok) lastWritten = scroller.scrollTop;
    else stop("detached");
  };

  const onTrigger = () => {
    try {
      if (done || !stillOurs()) return;
      triggers += 1;
      repin();
    } catch {
      stop("detached");
    }
  };

  function onLoad(event: Event): void {
    if (done) return;
    const target = event.target;
    if (loadFilter) {
      let accepted = false;
      try {
        accepted = target instanceof Element && loadFilter(target);
      } catch {
        accepted = false;
      }
      if (!accepted) return;
    }
    onTrigger();
  }

  function onScroll(): void {
    try {
      if (done || writing) return;
      if (scroller.scrollTop !== lastWritten) stop("user-scroll");
    } catch {
      stop("detached");
    }
  }

  const onDeadline = () => {
    timer = null;
    try {
      if (done || !stillOurs()) return;
      repin();
      stop("expired");
    } catch {
      stop("detached");
    }
  };

  try {
    activePins.get(scroller)?.("replaced");
    activePins.set(scroller, stop);
    lastWritten = scroller.scrollTop;
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("load", onLoad, true);
    if (typeof ResizeObserver === "function") {
      try {
        observer = new ResizeObserver(onTrigger);
        observer.observe(observed);
      } catch {
        teardownObserver(); // `load` remains as the trigger
      }
    }
    timer = setTimeout(onDeadline, windowMs);
    if (!scroller.isConnected) stop("detached");
  } catch {
    stop("detached");
  }

  return () => stop("disposed");
}
