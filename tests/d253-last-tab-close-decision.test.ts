// @vitest-environment node
/**
 * D253-WI-1 (ADR-0112) — the decision after a tab closes.
 *
 * Law: `decideAfterTabClose` returns "close-window" exactly when the window is
 * not `"main"`, no document is left, and the close was a user close. Every
 * other combination is "keep". Covered at S4 by the exhaustive 18-row table
 * over label × remaining × trigger, plus a check that the table holds exactly
 * the two expected close rows (so a constant "keep" or "close-window" fails).
 *
 * Pure function: no mocks.
 */
import { describe, expect, it } from "vitest";
import { decideAfterTabClose, type TabCloseTrigger } from "../src/utils/lastTabClose";

const LABELS = ["main", "doc-1", "window-x"] as const;
const REMAINING = [0, 1, 2] as const;
const TRIGGERS: TabCloseTrigger[] = ["user-close", "other"];

const rows = LABELS.flatMap((windowLabel) =>
  REMAINING.flatMap((remainingDocuments) =>
    TRIGGERS.map((trigger) => ({
      windowLabel,
      remainingDocuments,
      trigger,
      expected:
        windowLabel !== "main" && remainingDocuments === 0 && trigger === "user-close"
          ? ("close-window" as const)
          : ("keep" as const),
    })),
  ),
);

describe("decideAfterTabClose", () => {
  it("the table has 18 rows", () => {
    expect(rows).toHaveLength(18);
  });

  it.each(rows)(
    "$windowLabel, $remainingDocuments left, $trigger → $expected",
    ({ windowLabel, remainingDocuments, trigger, expected }) => {
      expect(decideAfterTabClose({ windowLabel, remainingDocuments, trigger })).toBe(expected);
    },
  );

  it("exactly the two empty secondary windows after a user close are close-window", () => {
    const closing = rows
      .filter((row) => decideAfterTabClose(row) === "close-window")
      .map((row) => `${row.windowLabel}/${row.remainingDocuments}/${row.trigger}`);
    expect(closing).toEqual(["doc-1/0/user-close", "window-x/0/user-close"]);
  });

  it("the main window is never closed, whatever is left", () => {
    for (const remainingDocuments of REMAINING) {
      for (const trigger of TRIGGERS) {
        expect(decideAfterTabClose({ windowLabel: "main", remainingDocuments, trigger })).toBe("keep");
      }
    }
  });
});
