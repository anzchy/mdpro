// @vitest-environment node
/**
 * M1a WI-4 (ADR-0114) — `preferencesService.getAppliedShortcuts()`, the TS
 * wrapper of `get_applied_shortcuts`. Cases T1, T2, T3 and T6 of
 * `.claude/tdd-guardian/tests-20261016-202016.md`; T4 and T5 (the contract
 * fixture) live in `preferences-contract-parity.test.ts`.
 *
 * Law: in browser mode the result's binding keys equal the keys of
 * `DEFAULT_KEYBOARD_SHORTCUTS`, each bound to its default chord, and every call
 * returns a fresh object. Logs are enum-only.
 *
 * Mocked: only `@tauri-apps/api/core` (no Rust backend under node). The mocked
 * reply is the committed contract fixture's `applied`, which the Rust half
 * (`applied_shortcuts_tests.rs::a7_a8_…`) holds the real serialiser to. The
 * service, `loggingService` and the stores are real.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { isTauri } from "@tauri-apps/api/core";
import { preferencesService } from "../src/services/preferencesService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useToastStore } from "../src/stores/toastStore";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";

const READ_EVENT = "preferences.shortcuts.applied.read";

interface LogPayload {
  level: string;
  event: string;
  status?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

function readAppliedFixture(): Record<string, unknown> {
  const testPath = expect.getState().testPath;
  expect(testPath).toBeTruthy();
  const path = resolve(dirname(testPath as string), "fixtures/applied-shortcuts-contract.json");
  const fixture = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return fixture.applied as Record<string, unknown>;
}

function logPayloads(): LogPayload[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: LogPayload }).payload);
}

const readEntries = () => logPayloads().filter((p) => p.event === READ_EVENT);
const nonLogCalls = () => invokeMock.mock.calls.filter(([cmd]) => cmd !== "log_event");

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useToastStore.setState({ message: null });
});

describe("T1: the Tauri branch passes the backend reply through", () => {
  it("returns the reply unchanged and logs one enum-only success", async () => {
    const applied = readAppliedFixture();
    invokeMock.mockImplementation(async (cmd: unknown) =>
      cmd === "get_applied_shortcuts" ? structuredClone(applied) : null,
    );

    const result = await preferencesService.getAppliedShortcuts();

    expect(result).toEqual(applied);
    const entries = readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("success");
    const ctx = entries[0].context ?? {};
    expect(Object.keys(ctx).every((k) => ["outcome", "reason"].includes(k))).toBe(true);
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain("Cmd");
    expect(serialized).not.toContain("<");
    // Supplement only: the command name is the contract.
    expect(nonLogCalls().map(([cmd]) => cmd)).toEqual(["get_applied_shortcuts"]);
  });
});

describe("T2: an IPC rejection is rethrown and logged, with no toast", () => {
  it("rejects with the same error, logs fail with invoke_rejected", async () => {
    const err = new Error("/Users/x/secret");
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === "get_applied_shortcuts") throw err;
      return null;
    });

    await expect(preferencesService.getAppliedShortcuts()).rejects.toBe(err);

    const entries = readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("fail");
    expect(entries[0].context).toEqual({ outcome: "failed", reason: "invoke_rejected" });
    expect(JSON.stringify(entries[0])).not.toContain("secret");
    expect(useToastStore.getState().message).toBeNull();
  });
});

describe("T3: browser mode builds bindings from the defaults without IPC", () => {
  it("one bound entry per DEFAULT_KEYBOARD_SHORTCUTS key, version 1, source loaded", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    const result = await preferencesService.getAppliedShortcuts();

    expect(invokeMock).toHaveBeenCalledTimes(0);
    const defaults = DEFAULT_KEYBOARD_SHORTCUTS as unknown as Record<string, string>;
    const bindings = result.bindings as Record<string, unknown>;
    expect(Object.keys(bindings).sort()).toEqual(Object.keys(defaults).sort());
    expect(Object.keys(defaults)).toHaveLength(58);
    for (const [k, chord] of Object.entries(defaults)) {
      expect(bindings[k], k).toEqual({ state: "bound", chord });
    }
    expect(result.keyboardShortcutsVersion).toBe(1);
    expect(result.source).toBe("loaded");
  });
});

describe("T6: browser mode returns a fresh copy each call", () => {
  it("mutating one result does not reach the next", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    const r1 = await preferencesService.getAppliedShortcuts();
    r1.bindings.fileSave = { state: "unassigned" };
    const r2 = await preferencesService.getAppliedShortcuts();

    expect(r2.bindings.fileSave).toEqual({ state: "bound", chord: "Cmd+S" });
    expect(r2).not.toBe(r1);
  });
});
