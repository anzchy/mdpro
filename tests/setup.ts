import { afterAll, afterEach } from "vitest";
import {
  cancelPendingMilkdownTimeouts,
  installMilkdownTimerDrain,
  uninstallMilkdownTimerDrain,
} from "./helpers/milkdownTimerDrain";
import {
  assertNoNodeEnvironmentViolations,
  installNodeEnvironmentGuard,
  uninstallNodeEnvironmentGuard,
} from "./helpers/nodeEnvironmentGuard";

/*
 * jsdom is the default environment; a file opts into node with a first-line
 * `// @vitest-environment node` (ADR-0049). Decide once, before any guard
 * below redefines the DOM globals this check reads.
 */
const hasDom = typeof document !== "undefined";

/*
 * Every Milkdown ctx timer arms a 3 s timeout that is never cleared and calls the bare
 * global `removeEventListener`. Cancel the ones still armed when the file ends, so they
 * cannot fire after jsdom is torn down (see tests/helpers/milkdownTimerDrain.ts).
 */
installMilkdownTimerDrain();
afterAll(() => {
  cancelPendingMilkdownTimeouts();
  uninstallMilkdownTimerDrain();
});

if (hasDom) {
  /*
   * `clearMocks` / `restoreMocks` in vitest.config.ts reset mock state but never
   * touch the DOM. Without an explicit unmount, a component rendered by one test
   * stays in document.body for every test after it, so a `getByRole` query that
   * should find one element finds two and the failure surfaces in an unrelated
   * test. Unmount between tests rather than relying on query specificity.
   * Imported only under jsdom: a node-environment file has nothing to unmount.
   */
  const { cleanup } = await import("@testing-library/react");
  await import("@testing-library/jest-dom/vitest");
  afterEach(() => {
    cleanup();
  });
} else {
  /*
   * A node-environment file must not reach the DOM. Most reads already throw
   * ReferenceError; the guard catches the ones that would pass vacuously —
   * Node's own `navigator`, and `typeof window` probes in src/.
   */
  installNodeEnvironmentGuard();
  afterAll(() => {
    try {
      assertNoNodeEnvironmentViolations();
    } finally {
      uninstallNodeEnvironmentGuard();
    }
  });
}
