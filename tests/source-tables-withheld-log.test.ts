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
      buildSourceTablesWithheldLog(withhold({ tableRows: 50_001 }), "w-1a")
        .context?.tableRows,
    ).toBe(50_001);
    expect(
      buildSourceTablesWithheldLog(withhold({ tableRows: 232_982 }), "w-1b")
        .context?.tableRows,
    ).toBe(232_982);
  });

  it("W2: keeps tableRows: 0 rather than dropping it", () => {
    const payload = buildSourceTablesWithheldLog(withhold({ tableRows: 0 }), "w-2");
    expect(payload.context).toHaveProperty("tableRows", 0);
  });

  it("W3: reports the threshold from its one home", () => {
    const payload = buildSourceTablesWithheldLog(withhold(), "w-3");
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
      buildSourceTablesWithheldLog(decision, "w-4"),
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
      );
      expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    });
  });

  it("W6: is a warn/fail event that passes actionId through and names the cause", () => {
    const payload = buildSourceTablesWithheldLog(withhold(), "w-6");
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
      buildSourceTablesWithheldLog(withhold({ tableRows: 232_982 }), "w-8"),
    ).toEqual({
      level: "warn",
      event: "editor.large_document.source_tables_withheld",
      status: "fail",
      actionId: "w-8",
      context: {
        tableRows: 232_982,
        sourceTableRowThreshold: SOURCE_TABLE_ROW_THRESHOLD,
      },
      error: "source table extensions withheld: too many table rows",
    });
  });

  it("W9: depends only on (tableRows, actionId), never on the message", () => {
    const one = buildSourceTablesWithheldLog(
      withhold({ message: "SENTINEL-MSG-1", tableRows: 60_000 }),
      "w-9",
    );
    const two = buildSourceTablesWithheldLog(
      withhold({ message: "SENTINEL-MSG-2", tableRows: 60_000 }),
      "w-9",
    );
    expect(one).toEqual(two);
    expect(JSON.stringify(one)).not.toContain("SENTINEL");
    expect(JSON.stringify(two)).not.toContain("SENTINEL");
  });
});
