/**
 * Purpose: make a test file marked `// @vitest-environment node` fail loudly when
 * first-party code (anything under `src/` or `tests/`) touches a DOM global, instead
 * of passing vacuously on a code path the app never takes (ADR-0049).
 *
 * Most DOM use under node already throws `ReferenceError`. Two cases do not:
 * - **Node ships a few browser globals.** Node 22 has `navigator` (its `platform` is
 *   `"darwin"`, so `/Mac/i.test(navigator.platform)` is silently false) and later
 *   versions add `localStorage`. A test reading them passes on a non-browser value.
 * - **`typeof window` probes.** `typeof document === "undefined" ? a : b` never
 *   throws; under node it quietly takes the branch the app never runs.
 *
 * Pipeline: `tests/setup.ts` calls `installNodeEnvironmentGuard()` only when the file
 * runs without a DOM → each name in `GUARDED_GLOBALS` becomes an accessor on
 * `globalThis` → a read whose immediate caller is first-party is recorded and thrown;
 * any other caller (vitest, React, zustand probing their environment) gets the
 * original value → `afterAll` calls `assertNoNodeEnvironmentViolations()`, so a
 * violation swallowed by a `try/catch` in the code under test still fails the file.
 *
 * Key decisions:
 * - **Judge by the immediate caller, not the whole stack.** A library probing
 *   `typeof window` from inside a first-party call is the library's business; only
 *   the frame that performs the read decides.
 * - **Accessors, not deletion.** Deleting `navigator` would also break libraries that
 *   legitimately read it under node; the accessor keeps their view unchanged.
 *
 * @coordinates-with tests/setup.ts — installs, asserts and uninstalls per file.
 * @coordinates-with vitest.config.ts — jsdom stays the default environment.
 */

/** Browser globals a node-environment file must not reach from first-party code. */
export const GUARDED_GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "self",
  "HTMLElement",
  "Element",
  "Node",
  "DOMParser",
  "getComputedStyle",
  "getSelection",
  "matchMedia",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "KeyboardEvent",
  "MouseEvent",
] as const;

const GUARD_FILE = "/tests/helpers/nodeEnvironmentGuard.ts";
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const FIRST_PARTY_ROOTS = [`${REPO_ROOT}src/`, `${REPO_ROOT}tests/`];

const saved = new Map<string, PropertyDescriptor | undefined>();
const violations: string[] = [];

/** The stack frame that performed the guarded read, skipping the guard's own frames. */
function callerFrame(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(1);
  return lines.find((line) => !line.includes(GUARD_FILE))?.trim() ?? "";
}

function isFirstParty(frame: string): boolean {
  return !frame.includes("/node_modules/") && FIRST_PARTY_ROOTS.some((root) => frame.includes(root));
}

function originalValue(name: string): unknown {
  const descriptor = saved.get(name);
  if (!descriptor) return undefined;
  return descriptor.get ? descriptor.get.call(globalThis) : descriptor.value;
}

/** Trap every guarded global on `globalThis`. Idempotent. */
export function installNodeEnvironmentGuard(): void {
  if (saved.size > 0) return;
  for (const name of GUARDED_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        const frame = callerFrame();
        if (!isFirstParty(frame)) return originalValue(name);
        const message =
          `[node-env guard] global \`${name}\` read ${frame} in a file marked ` +
          "`// @vitest-environment node`. Remove the marker so the file runs under " +
          "jsdom (docs/adr/0049-*).";
        violations.push(message);
        throw new Error(message);
      },
      // `vi.stubGlobal` and plain assignment replace the accessor with the stub.
      set(value: unknown) {
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
      },
    });
  }
}

/** Throw if any first-party code read a guarded global since install. */
export function assertNoNodeEnvironmentViolations(): void {
  if (violations.length === 0) return;
  const found = violations.splice(0);
  throw new Error(`${found.length} DOM global read(s) in a node-environment file:\n${found.join("\n")}`);
}

/** Restore every guarded global's original descriptor. */
export function uninstallNodeEnvironmentGuard(): void {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  saved.clear();
  violations.length = 0;
}
