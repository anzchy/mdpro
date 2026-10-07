// @vitest-environment node
/**
 * ADR-0035 A5 / WI-8 — the pure halves of `src/utils/quitGuardHandlers.ts`:
 * payload parsing (`quitEventOf`), the round latch helpers (`sameRound`,
 * `raiseRound`), and the round field of the `app.quit.backstop` log.
 *
 * Law:
 * - Parse: `quitEventOf` never throws; it returns null exactly when the payload
 *   is not an object or its `requestId` is not a finite number; otherwise it
 *   returns `{requestId}` plus `round` exactly when the round is a non-negative
 *   integer, and parsing its own output is the identity.
 * - High-water mark: folding same-request rounds with `raiseRound` yields the
 *   maximum; one step is idempotent; another request always replaces; a
 *   round-less event never lowers a same-request mark that has a round (QH-8).
 * - `sameRound` is reflexive and symmetric on non-null events.
 * - A round-less backstop logs `round: null` (the key present, strictly null).
 *
 * The properties are hand-rolled over a seeded PRNG (no fast-check dependency),
 * so every run explores the same few hundred cases and a failure reproduces.
 *
 * Mocked: `@tauri-apps/api/core` and `loggingService` only. Stores are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { core } = vi.hoisted(() => ({
  core: {
    calls: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
    draftErrors: new Set<string>(),
  },
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.calls.push({ cmd, args: { ...args } });
    if (cmd === "save_draft" && core.draftErrors.has(String(args.documentId))) {
      throw new Error("save_draft rejected");
    }
    return null;
  }),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { takeDiscardSnapshot } from "../src/utils/quitDiscardSnapshot";
import {
  quitEventOf,
  raiseRound,
  runQuitBackstop,
  sameRound,
  type QuitEvent,
} from "../src/utils/quitGuardHandlers";

const SEED = 0x5eed_0035;
const CASES = 400;

/** mulberry32: a small deterministic PRNG in [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ABSENT = Symbol("absent");

/** A numeric-ish field value: valid integers mixed with every invalid shape. */
function fieldValue(rand: () => number): unknown {
  const pool: unknown[] = [
    0,
    1,
    Math.floor(rand() * 1000),
    -1 - Math.floor(rand() * 50),
    rand() * 10 + 0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    String(Math.floor(rand() * 9)),
    null,
    true,
    {},
    ABSENT,
  ];
  return pool[Math.floor(rand() * pool.length)];
}

function makePayload(rand: () => number): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const requestId = fieldValue(rand);
  const round = fieldValue(rand);
  if (requestId !== ABSENT) payload.requestId = requestId;
  if (round !== ABSENT) payload.round = round;
  if (rand() < 0.2) payload.extra = "ignored";
  return payload;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isValidRound = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

function makeDoc(id: string, isModified: boolean, content = ""): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified,
    lastSaved: null,
    fileSize: null,
  };
}

beforeEach(() => {
  core.calls.length = 0;
  core.draftErrors.clear();
  vi.clearAllMocks();
  useMilkdownEditorStore.setState({ flushers: {} });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("quitEventOf — payload parsing", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a string", "x"],
    ["a boolean", true],
  ])("QH-1: %s is not a quit event and does not throw", (_label, payload) => {
    let parsed: QuitEvent | null | "unset" = "unset";
    expect(() => {
      parsed = quitEventOf(payload);
    }).not.toThrow();
    expect(parsed).toBeNull();
  });

  it("QH-2 (property, seeded): the result is null, {requestId}, or {requestId, round} exactly as the input decides", () => {
    const rand = prng(SEED);
    for (let i = 0; i < CASES; i += 1) {
      const payload = makePayload(rand);
      const label = `case ${i}: ${String(payload.requestId)} / ${String(payload.round)}`;
      const parsed = quitEventOf(payload);

      if (!isFiniteNumber(payload.requestId)) {
        expect(parsed, label).toBeNull();
        continue;
      }
      expect(parsed, label).not.toBeNull();
      const event = parsed as QuitEvent;
      expect(event.requestId, label).toBe(payload.requestId);
      if (isValidRound(payload.round)) {
        expect(Object.keys(event).sort(), label).toStrictEqual(["requestId", "round"]);
        expect(event.round, label).toBe(payload.round);
      } else {
        expect(Object.keys(event), label).toStrictEqual(["requestId"]);
        expect(Object.hasOwn(event, "round"), label).toBe(false);
      }
      // Parsing is a projection: its own output parses to itself.
      expect(quitEventOf(event), label).toStrictEqual(event);
    }
  });
});

describe("raiseRound / sameRound — the round latch", () => {
  it("QH-3: a lower round for the same request keeps the higher one", () => {
    expect(raiseRound({ requestId: 1, round: 3 }, { requestId: 1, round: 1 })).toStrictEqual({
      requestId: 1,
      round: 3,
    });
  });

  it("QH-4 (property, seeded): folding same-request rounds gives the max, one step is idempotent", () => {
    const rand = prng(SEED + 1);
    for (let i = 0; i < CASES; i += 1) {
      const requestId = Math.floor(rand() * 5);
      const length = 1 + Math.floor(rand() * 8);
      const rounds = Array.from({ length }, () => Math.floor(rand() * 10));
      let highest: QuitEvent | null = null;
      for (const round of rounds) {
        const event = { requestId, round };
        const next = raiseRound(highest, event);
        expect(raiseRound(next, event), `case ${i}: idempotent`).toStrictEqual(next);
        highest = next;
      }
      expect(highest, `case ${i}: ${rounds.join(",")}`).toStrictEqual({
        requestId,
        round: Math.max(...rounds),
      });
    }
  });

  it("QH-5 (property, seeded): an event for a different request always replaces", () => {
    const rand = prng(SEED + 2);
    for (let i = 0; i < CASES; i += 1) {
      const highest = { requestId: Math.floor(rand() * 5), round: Math.floor(rand() * 10) };
      const event = { requestId: highest.requestId + 1 + Math.floor(rand() * 5), round: Math.floor(rand() * 10) };
      expect(raiseRound(highest, event), `case ${i}`).toBe(event);
    }
  });

  it("QH-6 (property, seeded): sameRound is reflexive and symmetric on non-null events", () => {
    const rand = prng(SEED + 3);
    const eventOf = (): QuitEvent => {
      const requestId = Math.floor(rand() * 3);
      return rand() < 0.3 ? { requestId } : { requestId, round: Math.floor(rand() * 3) };
    };
    for (let i = 0; i < CASES; i += 1) {
      const a = eventOf();
      const b = eventOf();
      expect(sameRound(a, a), `case ${i}: reflexive`).toBe(true);
      expect(sameRound(a, { ...a }), `case ${i}: reflexive copy`).toBe(true);
      expect(sameRound(a, b), `case ${i}: symmetric`).toBe(sameRound(b, a));
    }
    expect(sameRound(null, { requestId: 1, round: 0 })).toBe(false);
  });
});

describe("raiseRound — a round-less event (ADR-0035 review L-4)", () => {
  it("QH-8: a round-less event for the same request keeps the mark that has a round", () => {
    const highest = { requestId: 4, round: 2 };
    expect(raiseRound(highest, { requestId: 4 })).toBe(highest);
    expect(raiseRound({ requestId: 4 }, { requestId: 4, round: 0 })).toStrictEqual({
      requestId: 4,
      round: 0,
    });
    expect(raiseRound(highest, { requestId: 5 })).toStrictEqual({ requestId: 5 });
  });

  it("QH-8b (property, seeded): folding a mixed sequence keeps the max round once one is seen", () => {
    const rand = prng(SEED + 8);
    for (let i = 0; i < CASES; i += 1) {
      const events: QuitEvent[] = Array.from({ length: 1 + Math.floor(rand() * 8) }, () =>
        rand() < 0.4 ? { requestId: 1 } : { requestId: 1, round: Math.floor(rand() * 6) },
      );
      const folded = events.reduce<QuitEvent | null>((h, e) => raiseRound(h, e), null);
      const rounds = events.flatMap((e) => (e.round === undefined ? [] : [e.round]));
      const want = rounds.length === 0 ? undefined : Math.max(...rounds);
      expect(folded?.round, `case ${i}: ${JSON.stringify(events)}`).toBe(want);
    }
  });
});

describe("runQuitBackstop — the undiscarded ids (ADR-0035 review M-1)", () => {
  it("QH-9: reply gets the writer's counts and the ids redrafted after this request's discard", async () => {
    useDocumentStore.setState({
      documents: [makeDoc("a", true, "A1"), makeDoc("b", true, "B")],
      activeDocumentId: "a",
    });
    const snapshot = takeDiscardSnapshot(7, [{ id: "a", content: "A0" }], ["a"]);
    const reply = vi.fn();

    await runQuitBackstop({ requestId: 7, round: 1 }, snapshot, reply);

    expect(reply.mock.calls).toStrictEqual([
      [{ draftedCount: 2, failedCount: 0, flushFailed: false }, ["a"]],
    ]);
    const context = vi
      .mocked(loggingService.logEventSync)
      .mock.calls.map(([entry]) => entry)
      .find((entry) => entry.event === "app.quit.backstop")?.context;
    expect(JSON.stringify(context)).not.toContain('"a"');
  });
});

describe("runQuitBackstop — the round field of the log", () => {
  it("QH-7: a round-less backstop logs round strictly null and hands reply the writer's counts", async () => {
    useDocumentStore.setState({
      documents: [makeDoc("a", true, "A"), makeDoc("b", true, "B")],
      activeDocumentId: "a",
    });
    core.draftErrors.add("b");
    const reply = vi.fn();

    await runQuitBackstop({ requestId: 7 }, null, reply);

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]![0]).toStrictEqual({
      draftedCount: 1,
      failedCount: 1,
      flushFailed: false,
    });
    const backstop = vi
      .mocked(loggingService.logEventSync)
      .mock.calls.map(([entry]) => entry)
      .filter((entry) => entry.event === "app.quit.backstop");
    expect(backstop).toHaveLength(1);
    const context = backstop[0]!.context ?? {};
    expect(Object.hasOwn(context, "round")).toBe(true);
    expect(context.round).toBeNull();
    expect(context).toMatchObject({ requestId: 7, draftedCount: 1, failedCount: 1 });
  });
});
