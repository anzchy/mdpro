// @vitest-environment node
/**
 * D27-WI-4 — the typed draft-recovery service (`src/services/draftService.ts`).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260926-170000.md` cases f1–f5.
 * `@tauri-apps/api/core#invoke` is the only mock (the IPC boundary); `loggingService` and
 * `useLoggingStore` are real, so every log line is a recorded `invoke("log_event")`.
 * Paired real paths: Rust g2 (wire shapes), g14, c9 (registration), device checks d3/d4.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  classifyDraftError,
  discardRecoveryDraft,
  recoverDraft,
} from "../src/services/draftService";
import { useLoggingStore } from "../src/stores/loggingStore";
import { createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";

let held: HeldInvoke;

beforeEach(() => {
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  useLoggingStore.setState({ enabled: true, level: "info" });
});

const IN_USE = { kind: "gone", reason: "in_use" };
const NOT_FOUND = { kind: "gone", reason: "not_found" };
const ERROR = { kind: "error" };

const F1_TABLE: Array<[string, unknown, unknown]> = [
  ["OwnedByLiveWindow string", "OwnedByLiveWindow", IN_USE],
  ["OpenInWindow string", "OpenInWindow", IN_USE],
  ["NotFound object", { NotFound: { document_id: "x" } }, NOT_FOUND],
  ["IoError whose message says OpenInWindow", { IoError: { message: "OpenInWindow" } }, ERROR],
  ["ParseError", { ParseError: { message: "m" } }, ERROR],
  ["bare NotFound string", "NotFound", ERROR],
  ["lower-cased openinwindow", "openinwindow", ERROR],
  ["leading-space OpenInWindow", " OpenInWindow", ERROR],
  ["OpenInWindow as an object key", { OpenInWindow: {} }, ERROR],
  ["Error instance with OpenInWindow message", new Error("OpenInWindow"), ERROR],
  ["unregistered-command string", "command discard_recovery_draft not found", ERROR],
  ["null", null, ERROR],
  ["undefined", undefined, ERROR],
  ["number", 42, ERROR],
];

describe("f1: classifyDraftError over exact wire shapes and near-misses", () => {
  it.each(F1_TABLE)("%s", (_label, input, expected) => {
    expect(classifyDraftError(input)).toEqual(expected);
  });
});

describe("f2: recoverDraft maps each invoke result to an outcome", () => {
  const RESULT = { content: "C", originalPath: "/tmp/a.md", title: "T" };
  const cases: Array<[string, () => unknown, unknown]> = [
    ["resolve", () => RESULT, { kind: "ok", result: RESULT }],
    ["OpenInWindow", () => Promise.reject("OpenInWindow"), IN_USE],
    ["OwnedByLiveWindow", () => Promise.reject("OwnedByLiveWindow"), IN_USE],
    ["NotFound", () => Promise.reject({ NotFound: { document_id: "d" } }), NOT_FOUND],
    ["IoError", () => Promise.reject({ IoError: { message: "m" } }), ERROR],
  ];

  it.each(cases)("%s", async (_label, reply, expected) => {
    held.reply("recover_draft", reply);
    await expect(recoverDraft("d")).resolves.toEqual(expected);
    expect(held.calls("recover_draft")).toEqual([{ documentId: "d" }]);
  });
});

describe("f3: discardRecoveryDraft calls the guarded command only", () => {
  const cases: Array<[string, () => unknown, unknown]> = [
    ["Ok(true)", () => true, { kind: "ok" }],
    ["Ok(false) — nothing to delete", () => false, { kind: "ok" }],
    ["OwnedByLiveWindow", () => Promise.reject("OwnedByLiveWindow"), IN_USE],
    ["IoError", () => Promise.reject({ IoError: { message: "m" } }), ERROR],
  ];

  it.each(cases)("%s", async (_label, reply, expected) => {
    held.reply("discard_recovery_draft", reply);
    await expect(discardRecoveryDraft("d")).resolves.toEqual(expected);
    expect(held.calls("discard_recovery_draft")).toEqual([{ documentId: "d" }]);
    expect(held.calls("delete_draft")).toEqual([]);
  });
});

describe("f4: total and redacted — one outcome-only log per call", () => {
  const SENTINEL_ID = "SENTINEL-ID-7f3";
  const SENTINEL_PATH = "/Users/SENTINEL/p.md";
  const rejections: unknown[] = [
    ...F1_TABLE.map(([, input]) => input),
    { NotFound: { document_id: SENTINEL_ID } },
    { IoError: { message: SENTINEL_PATH } },
    { ParseError: { message: SENTINEL_PATH } },
    new Error(SENTINEL_PATH),
    SENTINEL_PATH,
  ];
  type Run = [string, "recover" | "discard", () => unknown];
  const runs: Run[] = [];
  for (const action of ["recover", "discard"] as const) {
    runs.push([
      `${action} success`,
      action,
      action === "recover"
        ? () => ({ content: "SENTINEL", originalPath: SENTINEL_PATH, title: "SENTINEL" })
        : () => true,
    ]);
    rejections.forEach((r, i) => {
      runs.push([`${action} rejection #${i}`, action, () => Promise.reject(r)]);
    });
  }

  it.each(runs)("%s", async (_label, action, reply) => {
    const cmd = action === "recover" ? "recover_draft" : "discard_recovery_draft";
    held.reply(cmd, reply);
    const call = action === "recover" ? recoverDraft(SENTINEL_ID) : discardRecoveryDraft(SENTINEL_ID);
    await expect(call).resolves.toBeDefined();

    const logs = held
      .calls("log_event")
      .map((a) => a.payload as { event: string; context: Record<string, unknown> })
      .filter((p) => p.event === "file.draft.recover" || p.event === "file.draft.discard");
    expect(logs).toHaveLength(1);
    const [payload] = logs;
    expect(payload.event).toBe(`file.draft.${action}`);
    expect(Object.keys(payload.context)).toEqual(["outcome"]);
    expect(["ok", "in_use", "not_found", "error"]).toContain(payload.context.outcome);
    expect(JSON.stringify(payload)).not.toContain("SENTINEL");
  });
});

describe("f5: a failing log_event does not change the outcome", () => {
  it("resolves to gone/in_use with no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      held.reply("log_event", () => Promise.reject(new Error("x")));
      held.reply("recover_draft", () => Promise.reject("OpenInWindow"));
      await expect(recoverDraft("d")).resolves.toEqual(IN_USE);
      await new Promise((r) => setTimeout(r, 0));
      expect(held.calls("log_event").length).toBeGreaterThan(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
