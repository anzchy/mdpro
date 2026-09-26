/**
 * D27-WI-4 — the pure mapping from a draft-service outcome to what the recovery dialog does
 * (`src/utils/draftRecoveryOutcome.ts`).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260926-170000.md` cases f6–f8. Pure, no mocks.
 * Invariant (f8): `dropRow XOR toast`; `upsert ⇒ recover ∧ ok`; `gone ⇒ ¬upsert ∧ ¬toast`.
 */
import { describe, expect, it } from "vitest";
import {
  draftRecoveryOutcome,
  type DraftActionOutcome,
} from "../src/utils/draftRecoveryOutcome";

const RESULT = { content: "C", originalPath: "/tmp/a.md", title: "T" };

function docFor(draftId: string, r: { content: string; originalPath: string | null }) {
  return {
    id: draftId,
    path: r.originalPath,
    content: r.content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: true,
    lastSaved: null,
    fileSize: null,
  };
}

const IN_USE = { kind: "gone", reason: "in_use" } as const;
const NOT_FOUND = { kind: "gone", reason: "not_found" } as const;
const ERROR = { kind: "error" } as const;

describe("f6: full outcome table for both actions", () => {
  const rows: Array<[string, DraftActionOutcome, unknown]> = [
    [
      "recover/ok",
      { action: "recover", outcome: { kind: "ok", result: RESULT } },
      { dropRow: true, upsert: docFor("d1", RESULT) },
    ],
    ["recover/in_use", { action: "recover", outcome: IN_USE }, { dropRow: true }],
    ["recover/not_found", { action: "recover", outcome: NOT_FOUND }, { dropRow: true }],
    [
      "recover/error",
      { action: "recover", outcome: ERROR },
      { dropRow: false, toast: "Failed to recover draft" },
    ],
    ["discard/ok", { action: "discard", outcome: { kind: "ok" } }, { dropRow: true }],
    ["discard/in_use", { action: "discard", outcome: IN_USE }, { dropRow: true }],
    ["discard/not_found", { action: "discard", outcome: NOT_FOUND }, { dropRow: true }],
    [
      "discard/error",
      { action: "discard", outcome: ERROR },
      { dropRow: false, toast: "Failed to discard draft" },
    ],
  ];

  it.each(rows)("%s", (_label, input, expected) => {
    const out = draftRecoveryOutcome("d1", input);
    expect(out).toEqual(expected);
    // toEqual ignores undefined-valued keys; absent must mean absent.
    expect(Object.keys(out).sort()).toEqual(Object.keys(expected as object).sort());
  });
});

describe("f7: the upserted Document equals today's App.tsx construction", () => {
  it("(i) file-backed draft", () => {
    const out = draftRecoveryOutcome("d1", {
      action: "recover",
      outcome: { kind: "ok", result: RESULT },
    });
    expect(out.upsert).toStrictEqual({
      id: "d1",
      path: "/tmp/a.md",
      content: "C",
      encoding: "UTF-8",
      lineEnding: "lf",
      isModified: true,
      lastSaved: null,
      fileSize: null,
    });
  });

  it("(ii) untitled draft; id follows draftId", () => {
    const out = draftRecoveryOutcome("u9", {
      action: "recover",
      outcome: { kind: "ok", result: { content: "", originalPath: null, title: "" } },
    });
    expect(out.upsert).toStrictEqual({
      id: "u9",
      path: null,
      content: "",
      encoding: "UTF-8",
      lineEnding: "lf",
      isModified: true,
      lastSaved: null,
      fileSize: null,
    });
  });
});

describe("f8: invariants over the whole domain", () => {
  const domain: DraftActionOutcome[] = [
    { action: "recover", outcome: { kind: "ok", result: RESULT } },
    { action: "recover", outcome: IN_USE },
    { action: "recover", outcome: NOT_FOUND },
    { action: "recover", outcome: ERROR },
    { action: "discard", outcome: { kind: "ok" } },
    { action: "discard", outcome: IN_USE },
    { action: "discard", outcome: NOT_FOUND },
    { action: "discard", outcome: ERROR },
  ];
  const cases = domain.flatMap((input) =>
    ["d1", "other-id"].map((id) => [`${input.action}/${input.outcome.kind}/${id}`, id, input] as const),
  );

  it.each(cases)("%s", (_label, id, input) => {
    const out = draftRecoveryOutcome(id, input);
    expect(out.dropRow).not.toBe(Boolean(out.toast));
    if (out.upsert) {
      expect(input.action).toBe("recover");
      expect(input.outcome.kind).toBe("ok");
      expect(out.upsert.id).toBe(id);
    }
    if (input.outcome.kind === "gone") {
      expect(out.upsert).toBeUndefined();
      expect(out.toast).toBeUndefined();
    }
  });
});
