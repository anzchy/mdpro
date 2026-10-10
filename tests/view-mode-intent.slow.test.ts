/**
 * D24 WI-1, slow tier (ADR-0050) — VMI-06s: the counting and agreement laws of
 * `tests/view-mode-intent.test.ts` VMI-06, extended to every command sequence
 * of length 0..6 (55,987 sequences). The domain, model and checks are shared
 * through `tests/support/viewModeCommandSequences.ts`, never copied.
 *
 * jsdom, not node (ADR-0049): the editor store's import graph loads
 * `sanitizerPolicy.ts`, whose module-level `DOMPurify.addHook` needs a window.
 *
 * Logging is disabled to keep the sweep fast; VMI-04 covers the log payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => null) }));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: ipc.invoke, isTauri: true }),
);

import { useLoggingStore } from "../src/stores/loggingStore";
import { allCommandSequences, checkViewModeLaws } from "./support/viewModeCommandSequences";

beforeEach(() => {
  useLoggingStore.setState({ enabled: false });
});

describe("VMI-06s counting and agreement law, every sequence of length <= 6", () => {
  const sequences = allCommandSequences(6);

  it("enumerates 55,987 sequences", () => {
    expect(sequences).toHaveLength(1 + 6 + 36 + 216 + 1296 + 7776 + 46656);
  });

  it("holds after every prefix with the default programmatic intent", () => {
    expect(checkViewModeLaws(sequences, { explicitProgrammatic: false })).toEqual([]);
  });

  it("holds after every prefix with an explicit 'programmatic' intent", () => {
    expect(checkViewModeLaws(sequences, { explicitProgrammatic: true })).toEqual([]);
  });
});
