// @vitest-environment node
/**
 * The Source withhold (ADR-0022) is the second decision the large-document
 * guard makes against the user's wishes: it turns the Source table tools off.
 * It gets its own event rather than a widened meaning for
 * `editor.large_document.degrade`, which the KNOWN AND ACCEPTED paragraph in
 * `src/utils/largeDocumentDegradeLog.ts` demanded before the predicate existed.
 *
 * The payload is built by a pure function so WHAT gets logged is a behavioural
 * claim. That the call fires is the App call site's business, not this file's.
 *
 * Cases W1-W9 mirror L1-L8 in tests/large-document-degrade-log.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  SOURCE_TABLES_WITHHELD_EVENT,
  buildSourceTablesWithheldLog,
} from "../src/utils/sourceTableWithheldLog";
import { LARGE_DOCUMENT_DEGRADE_EVENT } from "../src/utils/largeDocumentDegradeLog";
import {
  SOURCE_TABLE_ROW_THRESHOLD,
  decideLargeDocumentGuard,
  type LargeDocumentGuardDecision,
} from "../src/utils/largeDocumentGuard";

type WithholdDecision = Extract<
  LargeDocumentGuardDecision,
  { action: "withhold-table-extensions" }
>;

/** A fixed UUID-v4-shaped id: document metadata, never document content. */
const DOC_ID = "3f2a9c1e-7b4d-4e8a-9c6f-1d2e3b4a5c6d";

/** The context allowlist: every key the withhold line may carry, and no other. */
const WITHHELD_CONTEXT_KEYS = ["documentId", "sourceTableRowThreshold", "tableRows"];

const withhold = (over: Partial<WithholdDecision> = {}): WithholdDecision => ({
  action: "withhold-table-extensions",
  message: "irrelevant to this module",
  tableRows: 50_001,
  ...over,
});

describe("source tables withheld log payload", () => {
  it("W1: forwards tableRows unmodified", () => {
    // Two inputs so a hardcoded 50_001 cannot pass.
    expect(
      buildSourceTablesWithheldLog(withhold({ tableRows: 50_001 }), "w-1a", DOC_ID)
        .context?.tableRows,
    ).toBe(50_001);
    expect(
      buildSourceTablesWithheldLog(withhold({ tableRows: 232_982 }), "w-1b", DOC_ID)
        .context?.tableRows,
    ).toBe(232_982);
  });

  it("W2: keeps tableRows: 0 rather than dropping it", () => {
    const payload = buildSourceTablesWithheldLog(withhold({ tableRows: 0 }), "w-2", DOC_ID);
    expect(payload.context).toHaveProperty("tableRows", 0);
  });

  it("W3: reports the threshold from its one home", () => {
    const payload = buildSourceTablesWithheldLog(withhold(), "w-3", DOC_ID);
    expect(payload.context?.sourceTableRowThreshold).toBe(
      SOURCE_TABLE_ROW_THRESHOLD,
    );
  });

  it("W4: carries no document content, driven through the real predicate", () => {
    const SECRET = "alpha-secret-passphrase";
    const decision = decideLargeDocumentGuard({
      viewMode: "source",
      content: `| ${SECRET} |\n`.repeat(50_001),
    });
    expect(decision.action).toBe("withhold-table-extensions");
    if (decision.action !== "withhold-table-extensions") return;

    const serialized = JSON.stringify(
      buildSourceTablesWithheldLog(decision, "w-4", DOC_ID),
    );
    expect(serialized).not.toContain(SECRET);
    expect(serialized.length).toBeLessThan(600);
  });

  it("W5: survives a JSON round-trip across the reachable tableRows range", () => {
    // 5_242_880 = the 10 MB cap / 2 bytes per "|\n".
    const rows = [0, 1, 50_001, 232_982, 5_242_880];
    rows.forEach((tableRows, index) => {
      const payload = buildSourceTablesWithheldLog(
        withhold({ tableRows }),
        `w-5-${index}`,
        DOC_ID,
      );
      expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    });
  });

  it("W6: is a warn/fail event that passes actionId through and names the cause", () => {
    const payload = buildSourceTablesWithheldLog(withhold(), "w-6", DOC_ID);
    expect(payload.level).toBe("warn");
    expect(payload.status).toBe("fail");
    expect(payload.actionId).toBe("w-6");
    expect(payload.event).toBe(SOURCE_TABLES_WITHHELD_EVENT);
    expect(payload.error).toMatch(/table rows/i);
  });

  it("W7: pins the event name as a literal, distinct from the degrade event", () => {
    expect(SOURCE_TABLES_WITHHELD_EVENT).toBe(
      "editor.large_document.source_tables_withheld",
    );
    expect(SOURCE_TABLES_WITHHELD_EVENT).not.toBe(LARGE_DOCUMENT_DEGRADE_EVENT);
  });

  it("W8: builds exactly this payload for a fixed decision", () => {
    expect(
      buildSourceTablesWithheldLog(withhold({ tableRows: 232_982 }), "w-8", DOC_ID),
    ).toEqual({
      level: "warn",
      event: "editor.large_document.source_tables_withheld",
      status: "fail",
      actionId: "w-8",
      context: {
        tableRows: 232_982,
        sourceTableRowThreshold: SOURCE_TABLE_ROW_THRESHOLD,
        documentId: DOC_ID,
      },
      error: "source table extensions withheld: too many table rows",
    });
  });

  it("W9: depends only on (tableRows, actionId), never on the message", () => {
    const one = buildSourceTablesWithheldLog(
      withhold({ message: "SENTINEL-MSG-1", tableRows: 60_000 }),
      "w-9",
      DOC_ID,
    );
    const two = buildSourceTablesWithheldLog(
      withhold({ message: "SENTINEL-MSG-2", tableRows: 60_000 }),
      "w-9",
      DOC_ID,
    );
    expect(one).toEqual(two);
    expect(JSON.stringify(one)).not.toContain("SENTINEL");
    expect(JSON.stringify(two)).not.toContain("SENTINEL");
  });

  it("W10: forwards documentId unmodified", () => {
    // Two ids so a hardcoded id cannot pass.
    const other = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    expect(
      buildSourceTablesWithheldLog(withhold(), "w-10a", DOC_ID).context?.documentId,
    ).toBe(DOC_ID);
    expect(
      buildSourceTablesWithheldLog(withhold(), "w-10b", other).context?.documentId,
    ).toBe(other);
  });

  it("W11: the context key set is exactly the allowlist plus documentId", () => {
    const payload = buildSourceTablesWithheldLog(withhold(), "w-11", DOC_ID);
    expect(Object.keys(payload.context ?? {}).sort()).toEqual(WITHHELD_CONTEXT_KEYS);
  });

  it("W12: no context value equals or contains the document content", () => {
    const SECRET = "beta-secret-passphrase";
    const content = `| ${SECRET} |\n`.repeat(50_001);
    const decision = decideLargeDocumentGuard({ viewMode: "source", content });
    expect(decision.action).toBe("withhold-table-extensions");
    if (decision.action !== "withhold-table-extensions") return;

    const payload = buildSourceTablesWithheldLog(decision, "w-12", DOC_ID);
    expect(payload.context?.documentId).toBe(DOC_ID);
    for (const value of Object.values(payload.context ?? {})) {
      expect(value).not.toBe(content);
      expect(String(value)).not.toContain(SECRET);
    }
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });
});
