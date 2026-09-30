/**
 * ADR-0042 WI-6 — the pure confirmation payload model.
 *
 * Cases M-2, M-3, M-4, MSG-1, MSG-2 of
 * `.claude/tdd-guardian/tests-20260929-102912.md`. M-1 and CT-1 (the fixture
 * halves) live in `tests/mcp-confirm-contract.test.ts`.
 *
 * Laws:
 * - `confirmRequestOf(p) !== null` iff `p` is well-formed, and accepted input
 *   keeps every contract field and nothing else.
 * - `confirmMessage` contains the title, is distinct per operation (and per
 *   table action), and never contains `documentId` or `requestId`.
 *
 * No mocks: the module under test is pure.
 */
import { describe, expect, it } from "vitest";

import {
  confirmMessage,
  confirmRequestOf,
  type ConfirmRequest,
} from "../src/utils/mcpConfirmModel";

const BASE = {
  requestId: "req-1",
  documentId: "doc-1",
  documentTitle: "Notes",
  operation: "replace",
  expiresInMs: 42000,
} as const;

const TABLE = { ...BASE, operation: "table", action: "set_cell" } as const;

function without(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

describe("M-2 one mutation per field → null", () => {
  const mutations: Array<[string, Record<string, unknown>]> = [
    ["requestId missing", without(BASE, "requestId")],
    ["requestId 42", { ...BASE, requestId: 42 }],
    ["requestId empty", { ...BASE, requestId: "" }],
    ["documentId missing", without(BASE, "documentId")],
    ["documentId null", { ...BASE, documentId: null }],
    ["documentId empty", { ...BASE, documentId: "" }],
    ["documentTitle missing", without(BASE, "documentTitle")],
    ["documentTitle 7", { ...BASE, documentTitle: 7 }],
    ["operation missing", without(BASE, "operation")],
    ["operation delete", { ...BASE, operation: "delete" }],
    ["operation Replace", { ...BASE, operation: "Replace" }],
    ["table action missing", without(TABLE, "action")],
    ["table action 5", { ...TABLE, action: 5 }],
    ["expiresInMs missing", without(BASE, "expiresInMs")],
    ["expiresInMs string", { ...BASE, expiresInMs: "60000" }],
    ["expiresInMs -1", { ...BASE, expiresInMs: -1 }],
    ["expiresInMs NaN", { ...BASE, expiresInMs: Number.NaN }],
    ["expiresInMs Infinity", { ...BASE, expiresInMs: Number.POSITIVE_INFINITY }],
  ];

  it("M-2 the enumeration has every mutation (count asserted)", () => {
    expect(mutations).toHaveLength(18);
  });

  it("M-2 control: the unmutated bases are accepted", () => {
    expect(confirmRequestOf({ ...BASE })).not.toBeNull();
    expect(confirmRequestOf({ ...TABLE })).not.toBeNull();
  });

  it("M-2 every mutation is rejected", () => {
    for (const [label, payload] of mutations) {
      expect(confirmRequestOf(payload), label).toBeNull();
    }
  });
});

describe("M-3 non-object payloads → null", () => {
  it("M-3 undefined, null, string, number, arrays → null without throwing", () => {
    const inputs: unknown[] = [undefined, null, "str", 42, [], [{ ...BASE }]];
    expect(inputs).toHaveLength(6);
    for (const [i, input] of inputs.entries()) {
      expect(() => confirmRequestOf(input), `input ${i}`).not.toThrow();
      expect(confirmRequestOf(input), `input ${i}`).toBeNull();
    }
  });
});

describe("M-4 boundary values accepted", () => {
  it("M-4 expiresInMs 0 is accepted", () => {
    expect(confirmRequestOf({ ...BASE, expiresInMs: 0 })).toStrictEqual({ ...BASE, expiresInMs: 0 });
  });

  it("M-4 an unknown extra key is accepted and dropped", () => {
    expect(confirmRequestOf({ ...BASE, future: 1 })).toStrictEqual({ ...BASE });
  });

  it("M-4 a stray action on a non-table operation is accepted and dropped", () => {
    expect(confirmRequestOf({ ...BASE, action: "x" })).toStrictEqual({ ...BASE });
  });
});

const TITLE = "Q3 plan.md";
const TABLE_ACTIONS = [
  "insert_table",
  "set_cell",
  "add_row",
  "delete_row",
  "add_column",
  "delete_column",
] as const;

function requestsFor(requestId: string, documentId: string): ConfirmRequest[] {
  const base = { requestId, documentId, documentTitle: TITLE, expiresInMs: 60000 };
  return [
    { ...base, operation: "replace" },
    { ...base, operation: "insert" },
    ...TABLE_ACTIONS.map((action) => ({ ...base, operation: "table" as const, action })),
  ];
}

describe("MSG-1 injective over operations and includes the title", () => {
  it("MSG-1 8 operations: each message contains the title, all pairwise distinct", () => {
    const reqs = requestsFor("req-1", "doc-1");
    expect(reqs).toHaveLength(8);
    const msgs = reqs.map(confirmMessage);
    for (const [i, msg] of msgs.entries()) expect(msg, `op ${i}`).toContain(TITLE);
    expect(new Set(msgs).size).toBe(8);
  });
});

describe("MSG-2 never leaks ids", () => {
  it("MSG-2 8 operations × 3 id shapes: no message contains documentId or requestId", () => {
    const ids = ["7c9e6679-7425-40de-944b-e07fc1f90ae7", "doc-123", "x"];
    const combos = ids.flatMap((id) => requestsFor(id, id));
    expect(combos).toHaveLength(24);
    for (const req of combos) {
      expect(TITLE).not.toContain(req.documentId);
      const msg = confirmMessage(req);
      const label = `${req.operation}/${req.action ?? "-"}/${req.documentId}`;
      expect(msg, label).not.toContain(req.documentId);
      expect(msg, label).not.toContain(req.requestId);
    }
  });
});
