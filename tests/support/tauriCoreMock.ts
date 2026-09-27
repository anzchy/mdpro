/**
 * Shared `@tauri-apps/api/core` mock module for tests.
 *
 * Purpose: one factory every test uses to mock `@tauri-apps/api/core`, so each
 * mocked module exports `isTauri` as well as `invoke`. Since ADR-0031 step 5b
 * production code decides Tauri-vs-browser with `isTauri()` (read on every call),
 * and a mock without it throws "No isTauri export is defined" at first use.
 *
 * Key decisions:
 *   - `isTauri` defaults to `false` (browser mode). A test that needs the Tauri
 *     branch opts in, either with `createTauriCoreMock({ isTauri: true })` or by
 *     calling `vi.mocked(isTauri).mockReturnValue(true)` in the test.
 *   - `isTauri` is a `vi.fn(impl)`, so the repo-wide `restoreMocks: true` puts
 *     it back to the constructed default before every test. A per-test flip
 *     cannot leak into the next test.
 *   - `invoke` is forwarded as given. Omitting it yields a bare `vi.fn()`.
 *   - `vi.mock` factories are hoisted above imports, so callers reach this
 *     module with a dynamic import inside the factory:
 *     `vi.mock("@tauri-apps/api/core", async () =>
 *        (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }))`
 *     (`invoke` there must itself come from `vi.hoisted`).
 *
 * @coordinates-with tests/tauri-core-mock-helper.test.ts — H1–H3 pin this contract
 * @coordinates-with src/services/preferencesService.ts — the `isTauri()` consumer
 */
import { vi } from "vitest";

export interface TauriCoreMockOptions {
  /** Value `isTauri()` returns until a test overrides it. Default: false. */
  isTauri?: boolean;
  /** The `invoke` the mocked module exports. Default: a bare `vi.fn()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors each test's own invoke signature
  invoke?: (...args: any[]) => unknown;
}

const DEFAULT_IS_TAURI = false;

export function createTauriCoreMock(options: TauriCoreMockOptions = {}) {
  const tauri = options.isTauri ?? DEFAULT_IS_TAURI;
  return {
    invoke: options.invoke ?? vi.fn(),
    isTauri: vi.fn(() => tauri),
  };
}
