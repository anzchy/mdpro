/**
 * D261-WI-1a: the native menu's dispatch table, `dispatchMenuAction`, tested
 * directly rather than through `useMenuEvents`' subscription.
 *
 * Law (totality and uniqueness over the emitted set): every action string
 * `menu.rs` emits, with a well-formed value, reaches exactly one handler,
 * exactly once, with its arguments; any other string reaches none and writes
 * no select line. The totality case reads the emitted set from the Rust
 * source, so a new Rust action without a TypeScript arm fails here.
 *
 * jsdom on purpose: `isModalOpen` reads `document`, and the modal cases put a
 * real `[aria-modal="true"]` node in it.
 *
 * Mock boundary: `@tauri-apps/api/core` only (the refusal's log line goes
 * through `invoke`). The table, the modal guard and the DOM are real.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchMenuAction, type MenuHandlers } from "../src/hooks/menuActionTable";
import { HANDLER_KEYS, ROWS, payloadOf, type HandlerKey, type Row } from "./support/menuActionRows";
import { genSequence, mulberry32, seededShuffle } from "./support/seededSequences";
import { collectionCases } from "./support/collectionCases";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);

type Call = { gen: number; key: HandlerKey; args: unknown[] };
type Select = [controlId: string, context: Record<string, unknown>];

const calls: Call[] = [];
const selects: Select[] = [];
let selectCount = 0;

/** Records each select line and returns a predictable id, `id-1`, `id-2`, ... */
const logMenuSelect = (controlId: string, context: Record<string, unknown> = {}): string => {
  selects.push([controlId, context]);
  selectCount += 1;
  return `id-${selectCount}`;
};

/** All 14 handlers (less `omit`), each recording its own key and arguments. */
const makeHandlers = (gen: number, omit?: HandlerKey): MenuHandlers => {
  const h: Record<string, (...args: unknown[]) => void> = {};
  for (const key of HANDLER_KEYS) {
    if (key === omit) continue;
    h[key] = (...args: unknown[]) => {
      calls.push({ gen, key, args });
    };
  }
  return h as MenuHandlers;
};

/** The actions refused while a modal is open (D165 tab actions, D235 modal openers). */
const REFUSED_WHILE_MODAL = new Set([
  "file.new",
  "file.open",
  "file.close",
  "file.open_recent",
  "file.preferences",
  "paragraph.table",
]);

const EXPECTED_EMITTED_ACTIONS = 19;
// vitest runs from the repo root; under jsdom `import.meta.url` is not a file: URL.
const MENU_RS = join(process.cwd(), "src-tauri/src/menu.rs");
const EMIT_RE = /emit_menu_action\(\s*app,\s*id,\s*"([^"]+)"/g;
const VALUE_FOR: Record<string, string> = { "set-view-mode": "source", "file.open_recent": "/tmp/a.md" };

let modal: HTMLElement | null = null;

beforeEach(() => {
  calls.length = 0;
  selects.length = 0;
  selectCount = 0;
});

afterEach(() => {
  modal?.remove();
  modal = null;
});

const rowLabel = (row: Row) => `${row.n}: ${row.action}${row.value ? `=${row.value}` : ""}`;

describe("dispatchMenuAction: each row reaches its one handler (S2)", () => {
  it.each(collectionCases("tests/menu-action-table.test.ts:87", ROWS.map((row) => [rowLabel(row), row] as const)))("%s", (_label, row) => {
    dispatchMenuAction(payloadOf(row), makeHandlers(0), logMenuSelect);
    expect(calls).toEqual([{ gen: 0, key: row.key, args: [...row.args, "id-1"] }]);
    expect(selects).toEqual([[row.controlId, row.extra]]);
  });
});

describe("dispatchMenuAction: totality over the actions menu.rs emits (S4)", () => {
  const emitted = new Set([...readFileSync(MENU_RS, "utf8").matchAll(EMIT_RE)].map((m) => m[1]));

  it(`reads exactly ${EXPECTED_EMITTED_ACTIONS} actions and dispatches each once`, () => {
    expect(emitted.size).toBe(EXPECTED_EMITTED_ACTIONS);
    expect([...emitted].sort()).toEqual([...new Set(ROWS.map((r) => r.action))].sort());
    for (const action of emitted) {
      calls.length = 0;
      const value = VALUE_FOR[action];
      const payload = value === undefined ? { action } : { action, value };
      dispatchMenuAction(payload, makeHandlers(0), logMenuSelect);
      expect(calls, action).toHaveLength(1);
    }
  });
});

describe("dispatchMenuAction: unknown and malformed payloads reach nothing (S3)", () => {
  const BAD = [
    { action: "file.bogus" },
    { action: "" },
    { action: "FILE.SAVE" },
    { action: "set-view-mode" },
    { action: "set-view-mode", value: "split" },
    { action: "set-view-mode", value: "" },
    { action: "file.open_recent", value: "" },
    { action: "file.open_recent", value: null },
  ];
  it.each(BAD.map((p) => [JSON.stringify(p), p] as const))("%s", (_label, payload) => {
    dispatchMenuAction(payload, makeHandlers(0), logMenuSelect);
    expect(calls).toEqual([]);
    expect(selects).toEqual([]);
  });
});

describe("dispatchMenuAction: a missing handler (S2)", () => {
  it.each(collectionCases("tests/menu-action-table.test.ts:135", ROWS.map((row) => [rowLabel(row), row] as const)))("%s", (_label, row) => {
    dispatchMenuAction(payloadOf(row), makeHandlers(0, row.key), logMenuSelect);
    expect(calls).toEqual([]);
    // Characterization: Open Recent logs its select line even without a handler.
    const expected: Select[] =
      row.action === "file.open_recent" ? [["menu.file.open_recent", { filePath: "/tmp/a.md" }]] : [];
    expect(selects).toEqual(expected);
  });
});

describe("dispatchMenuAction: a modal is open (S2)", () => {
  beforeEach(() => {
    modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
  });

  it.each(collectionCases("tests/menu-action-table.test.ts:152", ROWS.map((row) => [rowLabel(row), row] as const)))("%s", (_label, row) => {
    dispatchMenuAction(payloadOf(row), makeHandlers(0), logMenuSelect);
    if (REFUSED_WHILE_MODAL.has(row.action)) {
      expect(calls).toEqual([]);
    } else {
      expect(calls).toEqual([{ gen: 0, key: row.key, args: [...row.args, "id-1"] }]);
    }
    expect(selects).toEqual([[row.controlId, row.extra]]);
  });
});

describe("dispatchMenuAction: deterministic and stateless (S5)", () => {
  it("seed 261: a shuffle of the rows three times (51 dispatches) runs each in order", () => {
    const seq = seededShuffle(mulberry32(261), [...ROWS, ...ROWS, ...ROWS]);
    expect(seq).toHaveLength(ROWS.length * 3);
    const handlers = makeHandlers(0);
    for (const row of seq) dispatchMenuAction(payloadOf(row), handlers, logMenuSelect);
    expect(calls).toHaveLength(seq.length);
    expect(calls.map((c) => c.key)).toEqual(seq.map((r) => r.key));
    expect(calls.map((c) => c.args)).toEqual(seq.map((r, i) => [...r.args, `id-${i + 1}`]));
  });

  it.each([261, 262, 263, 264, 265])("seed %i: a generated sequence dispatches one call per row", (seed) => {
    const seq = genSequence(mulberry32(seed), ROWS, 51);
    const handlers = makeHandlers(0);
    for (const row of seq) dispatchMenuAction(payloadOf(row), handlers, logMenuSelect);
    expect(seq.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.key)).toEqual(seq.map((r) => r.key));
    expect(selects.map(([id]) => id)).toEqual(seq.map((r) => r.controlId));
  });
});
