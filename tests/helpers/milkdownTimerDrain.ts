/**
 * Purpose: stop Milkdown ctx-timer timeouts from firing after a test file's jsdom
 * environment is torn down.
 *
 * `@milkdown/ctx` `Timer.start` (lib/index.js, `#waitTimeout`) schedules a
 * `setTimeout(…, type.timeout)` (3000 ms by default) for every timer and never clears
 * it, even when the timer resolves. Its callback calls the bare global
 * `removeEventListener`. A file that creates an editor in its last ~3 s leaves those
 * timeouts armed; when the worker outlives the environment (coverage collection keeps
 * it alive) they fire into a global with no `removeEventListener` and vitest reports
 * "ReferenceError: removeEventListener is not defined … caught after test environment
 * was torn down", exiting 1 although every test passed.
 *
 * Pipeline: `tests/setup.ts` calls `installMilkdownTimerDrain()` per file → the wrapped
 * `setTimeout` tracks only Milkdown timer timeouts → `afterAll` calls
 * `cancelPendingMilkdownTimeouts()` then `uninstallMilkdownTimerDrain()`.
 *
 * Key decisions:
 * - **Identify by callback, not by stack.** Milkdown's timeout callback is
 *   `() => { ifTimeout(); }`; matching its source is cheap for every `setTimeout` call.
 *   A non-matching call passes straight through, unchanged.
 * - **Cancel only at file end.** A resolved timer's timeout does nothing useful; a
 *   pending one would reject a promise nobody is awaiting any more.
 */

type TimeoutId = ReturnType<typeof setTimeout>;

const MILKDOWN_TIMEOUT_MARKER = "ifTimeout()";

const pending = new Set<TimeoutId>();
let original: typeof setTimeout | null = null;

function isMilkdownTimeout(handler: unknown): handler is () => void {
  return typeof handler === "function" && handler.toString().includes(MILKDOWN_TIMEOUT_MARKER);
}

/** Wrap `globalThis.setTimeout` so Milkdown timer timeouts are tracked. Idempotent. */
export function installMilkdownTimerDrain(): void {
  if (original) return;
  const base = globalThis.setTimeout;
  original = base;
  const wrapped = function (handler: unknown, timeout?: number, ...args: unknown[]) {
    if (!isMilkdownTimeout(handler)) {
      return (base as (...a: unknown[]) => TimeoutId)(handler, timeout, ...args);
    }
    const id: TimeoutId = base(() => {
      pending.delete(id);
      handler();
    }, timeout);
    pending.add(id);
    return id;
  };
  // Keep Node's own properties (e.g. `util.promisify.custom`) on the wrapper.
  for (const key of Reflect.ownKeys(base)) {
    if (key === "length" || key === "name" || key === "prototype") continue;
    const descriptor = Object.getOwnPropertyDescriptor(base, key);
    if (descriptor) Object.defineProperty(wrapped, key, descriptor);
  }
  globalThis.setTimeout = wrapped as unknown as typeof setTimeout;
}

/** How many Milkdown timer timeouts are still armed. */
export function pendingMilkdownTimeouts(): number {
  return pending.size;
}

/** Clear every armed Milkdown timer timeout; returns how many were cleared. */
export function cancelPendingMilkdownTimeouts(): number {
  const count = pending.size;
  for (const id of pending) clearTimeout(id);
  pending.clear();
  return count;
}

/** Put the original `setTimeout` back (only if the wrapper is still installed). */
export function uninstallMilkdownTimerDrain(): void {
  if (!original) return;
  globalThis.setTimeout = original;
  original = null;
}
