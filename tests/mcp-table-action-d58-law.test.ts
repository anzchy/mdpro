/**
 * D58 WI-5: the agreement law for `processTableActionEvent` — store and editor agree, and
 * there is no silent third state — as exhaustive bounded enumeration with an oracle.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-131500.md`, "Unit: processTableActionEvent —
 * the agreement law (WI-5)": L1 (768 rows), L1b (16 groups of 32), L2 (125 sequences).
 * The domain and the L1 oracle live in `tests/support/mcpTableD58Domain.ts`. Each row
 * fully resets the fixture, turns a throw into a `bad[]` entry, and runs D58-7 and D58-7b;
 * results are checked as `{ count, first }`. Only `invoke` is mocked; fake timers, never
 * advanced.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processTableActionEvent } from "../src/hooks/mcpTableAction";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import {
  DEL_99,
  DOCB,
  F,
  assertPreconditions,
  bindInvoke,
  closedWorldViolations,
  content,
  deps,
  fakeEditor,
  register,
  resetTableFixture,
  sentinelViolations,
  tableEvt,
  tableLogs,
} from "./helpers/mcpTableD58Fixture";
import { checkL1, l1Rows, rowName, runRow } from "./support/mcpTableD58Domain";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

beforeAll(() => {
  bindInvoke(invoke);
  assertPreconditions();
});

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D58 WI-5: the agreement law", () => {
  it("D58-L1 exhaustive enumeration, 768 rows", () => {
    const rows = l1Rows();
    expect(rows.length).toBe(768);
    const bad: Array<{ row: string; why: string }> = [];
    for (const row of rows) {
      invoke.mockClear();
      const why = checkL1(row, runRow(row));
      if (why.length) bad.push({ row: rowName(row), why: why.join(" | ") });
    }
    expect(bad.length, `first: ${JSON.stringify(bad[0])}`).toBe(0);
  });

  it("D58-L1b outside the flush gate, the flusher and editor columns are irrelevant", () => {
    const groups = new Map<string, Map<string, string[]>>();
    const bad: Array<{ group: string; why: string }> = [];
    for (const row of l1Rows().filter((r) => r.target !== "wysiwyg-active")) {
      invoke.mockClear();
      const o = runRow(row);
      const group = `${row.baseName}/${row.target}/${row.payloadName}`;
      // A pending or failing flusher marks its document modified while arranging, so the raw
      // `isModified` differs by arrangement. Compare contents, whether the other document is
      // untouched, and whether `isModified` equals "arranged || the action succeeded".
      const T = row.event.document_id;
      const other = T === "doc-a" ? "doc-b" : "doc-a";
      const succeeded = o.tableLogs.some((p) => p.status === "success");
      if (o.snaps[T].isModified !== (o.arranged[T].isModified || succeeded))
        bad.push({ group: rowName(row), why: "isModified is not arranged || succeeded" });
      const tuple = JSON.stringify([
        o.snaps[T].content,
        o.snaps[other].content,
        JSON.stringify(o.snaps[other]) === JSON.stringify(o.arranged[other]),
        o.tableLogs,
        o.fake?.parseCalls ?? 0,
        o.fake?.dispatchCalls ?? 0,
        o.cmText,
      ]);
      if (o.flushLogs !== 0) bad.push({ group, why: `${rowName(row)}: flush logged` });
      if (o.counters.some((n) => n !== 0)) bad.push({ group, why: `${rowName(row)}: a flusher ran` });
      if (o.threw !== null) bad.push({ group, why: `${rowName(row)}: threw ${o.threw}` });
      const byTuple = groups.get(group) ?? new Map<string, string[]>();
      byTuple.set(tuple, [...(byTuple.get(tuple) ?? []), rowName(row)]);
      groups.set(group, byTuple);
    }
    expect([...groups.values()].map((g) => [...g.values()].flat().length)).toEqual(Array(16).fill(32));
    for (const [group, byTuple] of groups)
      if (byTuple.size !== 1) bad.push({ group, why: `${byTuple.size} distinct outcomes` });
    expect(bad.length, `first: ${JSON.stringify(bad[0])}`).toBe(0);
  });

  it("D58-L2 stateful sequences: store and editor never diverge, and no typed text is lost", () => {
    type Step = "type" | "set" | "bad" | "boom" | "late";
    const STEPS: Step[] = ["type", "set", "bad", "boom", "late"];
    const sequences = STEPS.flatMap((a) => STEPS.flatMap((b) => STEPS.map((c) => [a, b, c])));
    expect(sequences.length).toBe(125);
    const bad: Array<{ seq: string; why: string }> = [];

    for (const seq of sequences) {
      resetTableFixture({ docA: F, docB: DOCB, active: "doc-a", viewMode: "wysiwyg" });
      invoke.mockClear();
      const fake = fakeEditor("sim", F);
      fake.attach(register("doc-a", () => fake.viewText()));
      const why: string[] = [];
      const typed: string[] = [];
      let lastContent: string | null = null;
      seq.forEach((step, i) => {
        const n = i + 1;
        if (step === "type") {
          fake.typeAtEnd(`t${n}`);
          typed.push(`t${n}`);
          return;
        }
        const e =
          step === "bad" ? DEL_99 : tableEvt({ payload: { row: 1, col: 0, content: `${step === "late" ? "l" : "c"}${n}` } });
        if (step === "set" || step === "late") lastContent = `${step === "late" ? "l" : "c"}${n}`;
        fake.mode = step === "boom" ? "parseThrows" : step === "late" ? "throwAfterDispatch" : "sim";
        try {
          processTableActionEvent(e, deps);
        } catch (err) {
          why.push(`step ${n} threw: ${err instanceof Error ? err.message : String(err)}`);
        }
        fake.mode = "sim";
        if (content("doc-a") !== fake.viewText()) why.push(`(i) diverged after step ${n} (${step})`);
      });
      useMilkdownEditorStore.getState().flushPendingEdits("test");
      const final = content("doc-a") ?? "";
      if (final !== fake.viewText()) why.push("(ii) diverged after the final flush");
      for (const t of typed) if (!final.includes(t)) why.push(`(iii) lost ${t}`);
      if (lastContent !== null && !final.includes(lastContent)) why.push(`(iv) lost ${lastContent}`);
      const tl = tableLogs();
      const count = (s: Step[]) => seq.filter((x) => s.includes(x)).length;
      if (tl.filter((p) => p.status === "success").length !== count(["set"])) why.push("(v) success count");
      if (tl.filter((p) => p.status === "fail").length !== count(["bad", "boom", "late"])) why.push("(v) fail count");
      why.push(...sentinelViolations(), ...closedWorldViolations(["set_cell", "delete_row"]));
      if (why.length) bad.push({ seq: seq.join(","), why: why.join(" | ") });
    }
    expect(bad.length, `first: ${JSON.stringify(bad[0])}`).toBe(0);
  });
});
