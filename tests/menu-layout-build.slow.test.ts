// @vitest-environment node
/**
 * M1A-WI-7 R1-7b, literal form: every leaf mutation of every table row,
 * reserved entry and inventory row, built into the WHOLE layout, gives bytes
 * that differ from the committed `menu_layout.json`. Several thousand full
 * builds at ~1.5 ms each, so it lives in the slow tier (ADR-0050); the fast
 * per-row twin is tests/menu-layout-build.test.ts.
 * Matrix: .claude/tdd-guardian/tests-20261016-223726.md R1-7b.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { buildMenuLayout, serializeMenuLayout } from "../src/commands/buildMenuLayout";
import { COMMAND_TABLE } from "../src/commands/commandTable";
import type { CommandRow, PerPlatform, Platform } from "../src/commands/commandTable.types";
import { EDITOR_OWNED_CHORDS, type EditorOwnedRow } from "../src/commands/editorOwnedChords";
import { RESERVED_CHORDS } from "../src/commands/reservedChords";
import { inventoryMutations, rowMutations } from "./support/menuLayoutMutations";

const BUDGET_MS = 120_000;
const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
const committed = readFileSync(path.resolve(__dirname, "../src-tauri/src/menu_layout.json"), "utf8");

const bytes = (
  table: readonly CommandRow[],
  reserved: PerPlatform<readonly string[]>,
  inv: readonly EditorOwnedRow[],
): string => serializeMenuLayout(buildMenuLayout(table, reserved, inv));

const replaced = <T>(xs: readonly T[], i: number, x: T): T[] => xs.map((y, j) => (j === i ? x : y));

it(
  "R1-7b: every leaf mutation, built in full, differs from the committed bytes",
  () => {
    expect(bytes(COMMAND_TABLE, RESERVED_CHORDS, EDITOR_OWNED_CHORDS)).toBe(committed);
    let leaves = 0;
    const unchanged: string[] = [];
    const check = (label: string, mutated: string): void => {
      leaves += 1;
      if (mutated === committed) unchanged.push(label);
    };
    COMMAND_TABLE.forEach((row, i) => {
      rowMutations(row).forEach((m, k) => {
        check(`row ${row.id} #${k}`, bytes(replaced(COMMAND_TABLE, i, m), RESERVED_CHORDS, EDITOR_OWNED_CHORDS));
      });
    });
    for (const p of PLATFORMS) {
      RESERVED_CHORDS[p].forEach((chord, i) => {
        const reserved = { ...RESERVED_CHORDS, [p]: replaced(RESERVED_CHORDS[p], i, `${chord}X`) };
        check(`reserved ${p} ${chord}`, bytes(COMMAND_TABLE, reserved, EDITOR_OWNED_CHORDS));
      });
    }
    EDITOR_OWNED_CHORDS.forEach((row, i) => {
      inventoryMutations(row).forEach((m, k) => {
        const inv = replaced(EDITOR_OWNED_CHORDS, i, m);
        check(`inventory ${row.source} ${row.key} #${k}`, bytes(COMMAND_TABLE, RESERVED_CHORDS, inv));
      });
    });
    expect(leaves).toBeGreaterThanOrEqual(580);
    expect(unchanged).toStrictEqual([]);
  },
  BUDGET_MS,
);
