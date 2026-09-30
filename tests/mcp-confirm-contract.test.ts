/**
 * ADR-0042 WI-6 — TS half of the confirmation wire contract.
 *
 * Cases M-1 and CT-1 (Revision 1) of
 * `.claude/tdd-guardian/tests-20260929-102912.md`. Both lanes read the same
 * bytes, `tests/fixtures/mcp-confirm-contract.json`; the Rust half is P-1 / P-2
 * in `src-tauri/src/services/mcp_confirm/payload_tests.rs` and the verdict
 * serialization in `commands/mcp_confirm_tests.rs`.
 *
 * Two layers, as in `tests/mcp-status-contract.test.ts`:
 * - compile time: the `Record<Union, true>` literals fail `pnpm typecheck:tests`
 *   if a union member is added or removed without the literal following;
 * - run time: the exported domain lists must equal the fixture.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  confirmRequestOf,
  confirmResolvedOf,
  MCP_CONFIRM_OPERATIONS,
  MCP_CONFIRM_OUTCOMES,
  MCP_CONFIRM_TABLE_ACTIONS,
  MCP_CONFIRM_VERDICTS,
  type ConfirmRequest,
  type McpConfirmOperation,
  type McpConfirmOutcome,
  type McpConfirmTableAction,
  type McpConfirmVerdict,
} from "../src/utils/mcpConfirmModel";

interface ConfirmContract {
  $requestKeys: string[];
  $resolvedKeys: string[];
  operations: string[];
  actions: string[];
  outcomes: string[];
  verdicts: string[];
  samples: Array<Record<string, unknown>>;
}

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as ConfirmContract;

const OPS: Record<McpConfirmOperation, true> = { replace: true, insert: true, table: true };
const ACTIONS: Record<McpConfirmTableAction, true> = {
  insert_table: true,
  set_cell: true,
  add_row: true,
  delete_row: true,
  add_column: true,
  delete_column: true,
};
const OUTCOMES: Record<McpConfirmOutcome, true> = {
  approved: true,
  rejected: true,
  timedOut: true,
  cancelled: true,
  withdrawn: true,
};
const VERDICTS: Record<McpConfirmVerdict, true> = {
  resolved: true,
  ignoredUnknown: true,
  ignoredWrongWindow: true,
  ignoredNotShown: true,
};
const REQUEST_KEYS: Record<keyof Required<ConfirmRequest>, true> = {
  requestId: true,
  documentId: true,
  documentTitle: true,
  operation: true,
  action: true,
  expiresInMs: true,
};

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("M-1 accepts every contract sample, field for field", () => {
  it("M-1 all 8 samples parse to exactly their own fields", () => {
    expect(fx.samples).toHaveLength(8);
    for (const [i, sample] of fx.samples.entries()) {
      expect(confirmRequestOf(sample), `sample ${i}`).toStrictEqual({ ...sample });
    }
  });
});

describe("CT-1 TS domains equal the contract fixture", () => {
  it("CT-1 operations", () => {
    expect(sorted(Object.keys(OPS))).toEqual(sorted(fx.operations));
    expect(sorted(MCP_CONFIRM_OPERATIONS)).toEqual(sorted(fx.operations));
  });

  it("CT-1 table actions", () => {
    expect(sorted(Object.keys(ACTIONS))).toEqual(sorted(fx.actions));
    expect(sorted(MCP_CONFIRM_TABLE_ACTIONS)).toEqual(sorted(fx.actions));
  });

  it("CT-1 outcomes, including withdrawn", () => {
    expect(sorted(Object.keys(OUTCOMES))).toEqual(sorted(fx.outcomes));
    expect(sorted(MCP_CONFIRM_OUTCOMES)).toEqual(sorted(fx.outcomes));
    expect(MCP_CONFIRM_OUTCOMES).toContain("withdrawn");
  });

  it("CT-1 verdicts", () => {
    expect(sorted(Object.keys(VERDICTS))).toEqual(sorted(fx.verdicts));
    expect(sorted(MCP_CONFIRM_VERDICTS)).toEqual(sorted(fx.verdicts));
  });

  it("CT-1 ConfirmRequest has exactly the request key set", () => {
    expect(sorted(Object.keys(REQUEST_KEYS))).toEqual(sorted(fx.$requestKeys));
  });

  it("CT-1 confirmResolvedOf accepts every fixture outcome and rejects bogus", () => {
    expect(fx.outcomes).toHaveLength(5);
    for (const outcome of fx.outcomes) {
      expect(confirmResolvedOf({ requestId: "r1", outcome }), outcome).toStrictEqual({
        requestId: "r1",
        outcome,
      });
    }
    expect(confirmResolvedOf({ requestId: "r1", outcome: "bogus" })).toBeNull();
  });
});
