import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/*
 * `clearMocks` / `restoreMocks` in vitest.config.ts reset mock state but never
 * touch the DOM. Without an explicit unmount, a component rendered by one test
 * stays in document.body for every test after it, so a `getByRole` query that
 * should find one element finds two and the failure surfaces in an unrelated
 * test. Unmount between tests rather than relying on query specificity.
 */
afterEach(() => {
  cleanup();
});
