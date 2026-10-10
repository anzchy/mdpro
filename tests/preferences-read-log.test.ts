// @vitest-environment node
/**
 * D24 WI-4 (ADR-0032 GA-12) — `preferences.read` log with an enum purpose and
 * outcome. Matrix `.claude/tdd-guardian/tests-20261007-171405.md` PRL-01..PRL-04.
 * PRL-05 lives in `preferences-read-log-hook.test.ts` (jsdom, harness);
 * PRL-06..PRL-08 in `preferences-read-purpose-call-site.test.ts` (source text).
 *
 * Law: every Tauri-branch read emits exactly one `preferences.read` entry whose
 * context is drawn only from closed enums — keys ⊆ {purpose, outcome, reason},
 * `purpose` one of the 12 literals, `outcome` ok|failed, `reason`
 * `invoke_rejected` — and never carries a preference value or error text. The
 * browser branch emits nothing (zero `invoke` of any command).
 *
 * Node environment: the service, the logging store and the toast store load
 * without the DOM (no DOMPurify, no `window` read on these paths).
 *
 * Mocked: only `@tauri-apps/api/core` (no Rust backend under node). The
 * service, `loggingService` and the stores are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { isTauri } from "@tauri-apps/api/core";
import * as preferencesModule from "../src/services/preferencesService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { makePreferences } from "./support/preferenceFixtures";

const { preferencesService } = preferencesModule;

/** Hard-coded on purpose: a shortened enum in `src` must fail, not narrow the domain. */
const PURPOSES = [
  "app_hydrate",
  "view_mode_startup_settle",
  "view_mode_restore_on_close",
  "save_reformat_check",
  "settings_dialog",
  "settings_appearance",
  "settings_general",
  "settings_markdown",
  "settings_editor",
  "settings_export",
  "settings_image",
  "settings_shortcuts",
] as const;
type Purpose = (typeof PURPOSES)[number];

const MARKERS = ["SECRET", "secret.md"];

interface LogPayload {
  level: string;
  event: string;
  status?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Call the service with a purpose without depending on its compile-time signature. */
const read = (purpose: Purpose) =>
  (preferencesService.getPreferences as (p: Purpose) => Promise<unknown>)(purpose);

function logPayloads(): LogPayload[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: LogPayload }).payload);
}

const readEntries = () => logPayloads().filter((p) => p.event === "preferences.read");

const nonLogCalls = () => invokeMock.mock.calls.filter(([cmd]) => cmd !== "log_event");

function markerPreferences() {
  const prefs = makePreferences({ recentFiles: ["/Users/x/secret.md"] });
  prefs.export.defaultFolder = "/Users/x/SECRET";
  return prefs;
}

function resolveGetWith(value: unknown): void {
  invokeMock.mockImplementation(async (cmd: unknown) => {
    if (cmd === "get_preferences") return value;
    return null;
  });
}

function rejectGetWith(err: unknown): void {
  invokeMock.mockImplementation(async (cmd: unknown) => {
    if (cmd === "get_preferences") throw err;
    return null;
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

describe("PRL-01: a successful Tauri read logs one exact ok entry", () => {
  it.each(PURPOSES)("%s", async (purpose) => {
    const reply = makePreferences();
    resolveGetWith(reply);

    const result = await read(purpose);

    expect(result).toEqual(makePreferences());
    const entries = readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].context).toEqual({ purpose, outcome: "ok" });
    expect(entries[0].level).toBe("info");
    expect(nonLogCalls()).toEqual([["get_preferences", {}]]);
  });
});

describe("PRL-02: a rejected read logs one warn entry and rethrows the same error", () => {
  it.each(["app_hydrate", "view_mode_restore_on_close"] as const)("%s", async (purpose) => {
    const err = new Error("SECRET /Users/x/secret.md");
    rejectGetWith(err);

    await expect(read(purpose)).rejects.toBe(err);

    const entries = readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("warn");
    expect(entries[0].context).toEqual({ purpose, outcome: "failed", reason: "invoke_rejected" });
    expect(entries.filter((e) => e.context?.outcome === "ok")).toHaveLength(0);
    expect(logPayloads().filter((e) => e.level === "error")).toHaveLength(0);
    const serialized = JSON.stringify(entries[0]);
    for (const marker of MARKERS) expect(serialized).not.toContain(marker);
  });
});

describe("PRL-03: the browser branch makes no IPC and returns defaults", () => {
  it("zero invoke calls of any command, browserDefaults() values returned", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    const a = (await read("app_hydrate")) as { autoSaveInterval: number; themeMode: string };
    const b = (await read("settings_general")) as { autoSaveInterval: number; themeMode: string };

    expect(a.autoSaveInterval).toBe(30);
    expect(a.themeMode).toBe("system");
    expect(b.autoSaveInterval).toBe(30);
    expect(b.themeMode).toBe("system");
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });
});

describe("PRL-04: privacy and closed-enum invariant over every purpose × outcome", () => {
  it("24 rows: one entry, enum-only context, no marker anywhere in the entry", async () => {
    const ALLOWED_KEYS = new Set(["purpose", "outcome", "reason"]);
    const failures: string[] = [];
    let rows = 0;

    for (const purpose of PURPOSES) {
      for (const outcome of ["ok", "failed"] as const) {
        rows += 1;
        invokeMock.mockReset();
        if (outcome === "ok") resolveGetWith(markerPreferences());
        else rejectGetWith(new Error("SECRET /Users/x/secret.md"));

        try {
          await read(purpose);
        } catch {
          // failed rows reject by contract (PRL-02 pins the identity)
        }

        const tag = `${purpose}/${outcome}`;
        const entries = readEntries();
        if (entries.length !== 1) {
          failures.push(`${tag}: ${entries.length} preferences.read entries`);
          continue;
        }
        const entry = entries[0];
        const ctx = entry.context ?? {};
        const extra = Object.keys(ctx).filter((k) => !ALLOWED_KEYS.has(k));
        if (extra.length > 0) failures.push(`${tag}: extra context keys ${extra.join(",")}`);
        if (ctx.purpose !== purpose) failures.push(`${tag}: purpose ${String(ctx.purpose)}`);
        if (ctx.outcome !== outcome) failures.push(`${tag}: outcome ${String(ctx.outcome)}`);
        if (outcome === "ok" && "reason" in ctx) failures.push(`${tag}: reason on an ok row`);
        if (outcome === "failed" && ctx.reason !== "invoke_rejected") {
          failures.push(`${tag}: reason ${String(ctx.reason)}`);
        }
        const serialized = JSON.stringify(entry);
        for (const marker of MARKERS) {
          if (serialized.includes(marker)) failures.push(`${tag}: entry contains ${marker}`);
        }
      }
    }

    expect(rows).toBe(24);
    expect(failures).toEqual([]);
  });
});
