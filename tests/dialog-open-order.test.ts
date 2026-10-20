// @vitest-environment node
/**
 * D42 WI-1: the pure open-order helper `src/utils/dialogOpenOrder.ts`.
 * Matrix: `.claude/tdd-guardian/tests-20261008-131500.md`, Cases 1.1-1.11.
 *
 * Every case reaches the helper through ONE adapter (`step` / `orderOf`), so
 * the carry-token API shape lives in exactly one place in this file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_DIALOG_CANONICAL_ORDER,
  dialogRenderOrder,
  nextDialogOpenOrder,
  type AppDialogId,
  type OpenDialogEntry,
} from "../src/utils/dialogOpenOrder";
import {
  ALL_CLOSED,
  EVENTS,
  NON_MCP_IDS,
  OPEN_TOKEN,
  ORACLE_CANONICAL,
  eventLabel,
  expandEvent,
  freshIds,
  mulberry32,
  oracleSnapshot,
  type DomainEvent,
  type OracleDialogId,
  type Tokens,
} from "./support/dialogOpenOrderOracle";

// ---- adapter: the only code that knows the state shape ----------------------
type State = readonly OpenDialogEntry[];
const EMPTY: State = [];
const step = (s: State, t: Readonly<Tokens>): State =>
  nextDialogOpenOrder(s, t as Readonly<Record<AppDialogId, string | null>>);
const orderOf = (s: State): AppDialogId[] => s.map((e) => e.id);
// -----------------------------------------------------------------------------

const tok = (partial: Partial<Tokens>): Tokens => ({ ...ALL_CLOSED, ...partial });
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const openIds = (t: Readonly<Tokens>) => ORACLE_CANONICAL.filter((id) => t[id] !== null);

/** Run snapshots from the empty state, returning the order after each. */
function run(snapshots: Partial<Tokens>[]): AppDialogId[][] {
  let s = EMPTY;
  return snapshots.map((p) => {
    s = step(s, tok(p));
    return orderOf(s);
  });
}

/** Check one snapshot: oracle equality (1.1), permutation + idempotence (1.3). */
function checkSnapshot(
  prev: State,
  t: Readonly<Tokens>,
  expected: readonly OracleDialogId[],
  where: string,
): State {
  const next = step(prev, t);
  const order = orderOf(next);
  if (!sameList(order, expected)) {
    expect(order, `oracle mismatch at ${where}`).toEqual(expected);
  }
  const want = openIds(t);
  const unique = new Set(order);
  if (
    unique.size !== order.length ||
    !sameList([...order].sort(), [...want].sort()) ||
    !order.every((id) => (ORACLE_CANONICAL as readonly string[]).includes(id))
  ) {
    expect({ order, size: unique.size }, `not a permutation of open ids at ${where}`).toEqual({
      order: want,
      size: want.length,
    });
  }
  const again = step(next, t);
  if (
    again.length !== next.length ||
    !again.every((e, i) => e.id === next[i].id && e.token === next[i].token)
  ) {
    expect(again, `not idempotent at ${where}`).toEqual(next);
  }
  return next;
}

/** Depth-first walk of E^n, n = 1..maxDepth, sharing prefixes. Returns node count. */
function walk(maxDepth: number): number {
  const fresh = freshIds();
  let nodes = 0;
  const visit = (
    depth: number,
    state: State,
    tokens: Tokens,
    oracle: OracleDialogId[],
    path: string,
  ): void => {
    if (depth === maxDepth) return;
    for (const event of EVENTS) {
      nodes += 1;
      const label = path ? `${path},${eventLabel(event)}` : eventLabel(event);
      let s = state;
      let t = tokens;
      let o = oracle;
      expandEvent(tokens, oracle, event, fresh).forEach((snap, i) => {
        s = checkSnapshot(s, snap.tokens, snap.oracle, `${label}#${i}`);
        t = snap.tokens;
        o = snap.oracle;
      });
      visit(depth + 1, s, t, o, label);
    }
  };
  visit(0, EMPTY, { ...ALL_CLOSED }, [], "");
  return nodes;
}

interface Replayed {
  state: State;
  tokens: Tokens;
  oracle: OracleDialogId[];
}
function replay(path: readonly DomainEvent[], fresh: () => string): Replayed {
  let r: Replayed = { state: EMPTY, tokens: { ...ALL_CLOSED }, oracle: [] };
  for (const event of path) {
    for (const snap of expandEvent(r.tokens, r.oracle, event, fresh)) {
      r = { state: step(r.state, snap.tokens), tokens: snap.tokens, oracle: snap.oracle };
    }
  }
  return r;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("dialogOpenOrder module shape", () => {
  it("canonical order is today's App.tsx source order, matching the oracle", () => {
    expect([...APP_DIALOG_CANONICAL_ORDER]).toEqual([...ORACLE_CANONICAL]);
  });
});

describe("nextDialogOpenOrder", () => {
  it("1.1 + 1.3: equals the event-log oracle, is a permutation of open ids, and is idempotent, over every event sequence of length <= 4", () => {
    expect(walk(4)).toBe(21 + 441 + 9261 + 194481);
  });

  it("1.2: multi-id snapshots append in canonical order, from every path of length <= 2", () => {
    const fresh = freshIds();
    const paths: DomainEvent[][] = [[]];
    for (const a of EVENTS) {
      paths.push([a]);
      for (const b of EVENTS) paths.push([a, b]);
    }
    let checks = 0;
    for (const path of paths) {
      const start = replay(path, fresh);
      for (let mask = 0; mask < 1 << NON_MCP_IDS.length; mask += 1) {
        for (const mcpOpt of ["null", "same", "fresh"] as const) {
          const next = { ...ALL_CLOSED } as Tokens;
          NON_MCP_IDS.forEach((id, bit) => {
            next[id] = mask & (1 << bit) ? OPEN_TOKEN : null;
          });
          next.mcp =
            mcpOpt === "null" ? null : mcpOpt === "same" ? start.tokens.mcp : fresh();
          const expected = oracleSnapshot(start.oracle, next, mcpOpt === "fresh");
          const got = orderOf(step(start.state, next));
          if (!sameList(got, expected)) {
            expect(
              got,
              `path=${path.map(eventLabel).join(",")} mask=${mask} mcp=${mcpOpt}`,
            ).toEqual(expected);
          }
          checks += 1;
        }
      }
    }
    expect(checks).toBe(paths.length * 192);
  });

  it("1.4: never mutates its inputs, and equal inputs give equal outputs", () => {
    const walkOnce = (): AppDialogId[][] => {
      const rand = mulberry32(0xd42);
      const fresh = freshIds();
      let state: State = EMPTY;
      let tokens: Tokens = { ...ALL_CLOSED };
      let oracle: OracleDialogId[] = [];
      const orders: AppDialogId[][] = [];
      for (let i = 0; i < 500; i += 1) {
        const event = EVENTS[Math.floor(rand() * EVENTS.length)];
        for (const snap of expandEvent(tokens, oracle, event, fresh)) {
          const frozenPrev = deepFreeze(state.map((e) => ({ ...e })));
          const frozenTokens = deepFreeze({ ...snap.tokens });
          expect(() => {
            state = step(frozenPrev, frozenTokens);
          }).not.toThrow();
          tokens = snap.tokens;
          oracle = snap.oracle;
          orders.push(orderOf(state));
        }
      }
      return orders;
    };
    const first = walkOnce();
    expect(first.length).toBeGreaterThanOrEqual(500);
    expect(walkOnce()).toEqual(first);
  });

  it("1.5a: D42 shape, confirm then reload", () => {
    expect(run([{ confirm: "open" }, { confirm: "open", reload: "open" }])).toEqual([
      ["confirm"],
      ["confirm", "reload"],
    ]);
  });

  it("1.5b: D42 shape, reload then confirm", () => {
    expect(run([{ reload: "open" }, { reload: "open", confirm: "open" }])).toEqual([
      ["reload"],
      ["reload", "confirm"],
    ]);
  });

  const boundaryRows: [string, Partial<Tokens>[], AppDialogId[][]][] = [
    ["1. everything closed", [{}], [[]]],
    [
      "2. all seven open in one snapshot",
      [
        {
          recovery: "open",
          reload: "open",
          recreate: "open",
          encoding: "open",
          confirm: "open",
          settings: "open",
          mcp: "r1",
        },
      ],
      [["recovery", "reload", "recreate", "encoding", "confirm", "settings", "mcp"]],
    ],
    ["3. only settings open", [{ settings: "open" }], [["settings"]]],
    [
      "4. close then reopen with a fresh token moves it to the end",
      [
        { confirm: "c1" },
        { confirm: "c1", reload: "open" },
        { reload: "open" },
        { confirm: "c2", reload: "open" },
      ],
      [["confirm"], ["confirm", "reload"], ["reload"], ["reload", "confirm"]],
    ],
    [
      "5. mcp token A -> B with no closed snapshot moves it to the end",
      [{ mcp: "A" }, { mcp: "A", reload: "open" }, { mcp: "B", reload: "open" }],
      [["mcp"], ["mcp", "reload"], ["reload", "mcp"]],
    ],
    [
      "6. mcp token unchanged keeps its position",
      [{ mcp: "A" }, { mcp: "A", reload: "open" }, { mcp: "A", reload: "open" }],
      [["mcp"], ["mcp", "reload"], ["mcp", "reload"]],
    ],
    [
      "7. empty-string token is open (=== null is the only closed marker)",
      [{ recovery: "open" }, { recovery: "" }],
      [["recovery"], ["recovery"]],
    ],
    [
      "8. reopen that reuses the constant token",
      [
        { confirm: "open" },
        { confirm: "open", reload: "open" },
        { reload: "open" },
        { confirm: "open", reload: "open" },
        { confirm: "open", reload: "open", settings: "open" },
      ],
      [
        ["confirm"],
        ["confirm", "reload"],
        ["reload"],
        ["reload", "confirm"],
        ["reload", "confirm", "settings"],
      ],
    ],
    [
      "9. a non-MCP token change while open counts as a reopen",
      [{ reload: "a" }, { reload: "a", confirm: "open" }, { reload: "b", confirm: "open" }],
      [["reload"], ["reload", "confirm"], ["confirm", "reload"]],
    ],
  ];

  it.each(boundaryRows)("1.6 boundary %s", (_name, snapshots, expected) => {
    expect(run(snapshots)).toEqual(expected);
  });

  it("1.6 boundary: an empty prev with one open id gives [id], for every id", () => {
    for (const id of ORACLE_CANONICAL) {
      expect(orderOf(step(EMPTY, tok({ [id]: "x" })))).toEqual([id]);
    }
  });

  const entry = (id: string, token = OPEN_TOKEN) =>
    ({ id, token }) as unknown as OpenDialogEntry;

  it("1.7a: a prev id whose token is now null is dropped", () => {
    const prev = [entry("confirm"), entry("reload")];
    expect(orderOf(step(prev, tok({ confirm: OPEN_TOKEN })))).toEqual(["confirm"]);
  });

  it("1.7b: a duplicate prev id appears once, first occurrence wins", () => {
    const prev = [entry("confirm"), entry("reload"), entry("confirm")];
    expect(orderOf(step(prev, tok({ confirm: OPEN_TOKEN, reload: OPEN_TOKEN })))).toEqual([
      "confirm",
      "reload",
    ]);
  });

  it("1.7c: an id outside AppDialogId never reaches the output", () => {
    const prev = [entry("bogus"), entry("confirm")];
    const tokens = { ...tok({ confirm: OPEN_TOKEN }), bogus: OPEN_TOKEN } as Tokens;
    expect(orderOf(step(prev, tokens))).toEqual(["confirm"]);
  });

  it("1.7d: a missing tokens key is treated as closed", () => {
    const prev = [entry("encoding"), entry("reload")];
    const tokens = tok({ reload: OPEN_TOKEN }) as Partial<Tokens>;
    delete tokens.encoding;
    const order = orderOf(step(prev, tokens as Tokens));
    expect(order).toEqual(["reload"]);
    expect(new Set(order).size).toBe(order.length);
  });

  it("1.11: every non-MCP id survives a constant-token reopen, from every position", () => {
    let runs = 0;
    for (const x of NON_MCP_IDS) {
      const others = ORACLE_CANONICAL.filter((id) => id !== x);
      for (const y of others) {
        for (const z of others) {
          if (y === z) continue;
          const val = (id: OracleDialogId) => (id === "mcp" ? "r1" : OPEN_TOKEN);
          const yz = { [y]: val(y), [z]: val(z) };
          // run 1: [Y, Z, X] -> close X -> reopen X
          expect(
            run([{ [y]: val(y) }, yz, { ...yz, [x]: OPEN_TOKEN }, yz, { ...yz, [x]: OPEN_TOKEN }]),
          ).toEqual([[y], [y, z], [y, z, x], [y, z], [y, z, x]]);
          // run 2: [X, Y, Z] -> close X -> reopen X
          const after = run([
            { [x]: OPEN_TOKEN },
            { [x]: OPEN_TOKEN, [y]: val(y) },
            { ...yz, [x]: OPEN_TOKEN },
            yz,
            { ...yz, [x]: OPEN_TOKEN },
          ]);
          expect(after).toEqual([[x], [x, y], [x, y, z], [y, z], [y, z, x]]);
          expect(after[4].includes(x)).toBe(true);
          runs += 1;
        }
      }
    }
    expect(runs).toBe(6 * 30);
  });
});

describe("dialogRenderOrder", () => {
  it("1.8: open ids first in the given order, then the rest in canonical order, over every ordered subset", () => {
    const subsets: AppDialogId[][] = [];
    const grow = (prefix: AppDialogId[]) => {
      subsets.push(prefix);
      for (const id of APP_DIALOG_CANONICAL_ORDER) {
        if (!prefix.includes(id)) grow([...prefix, id]);
      }
    };
    grow([]);
    expect(subsets.length).toBe(13700);
    for (const input of subsets) {
      const result = dialogRenderOrder(input);
      const k = input.length;
      expect(result.slice(0, k)).toEqual(input);
      expect(result.slice(k)).toEqual(ORACLE_CANONICAL.filter((id) => !input.includes(id)));
      expect(result.length).toBe(7);
      expect(new Set(result).size).toBe(7);
    }
  });

  it("1.9: examples", () => {
    expect(dialogRenderOrder([])).toEqual([...ORACLE_CANONICAL]);
    expect(dialogRenderOrder(["mcp", "recovery"])).toEqual([
      "mcp",
      "recovery",
      "reload",
      "recreate",
      "encoding",
      "confirm",
      "settings",
    ]);
    const reversed = [...ORACLE_CANONICAL].reverse();
    expect(dialogRenderOrder(reversed)).toEqual(reversed);
  });

  it("1.9 guard (added in implementation): repeated and unknown ids still give a permutation of all seven", () => {
    const input = ["confirm", "bogus", "confirm", "mcp"] as unknown as AppDialogId[];
    expect(dialogRenderOrder(input)).toEqual([
      "confirm",
      "mcp",
      "recovery",
      "reload",
      "recreate",
      "encoding",
      "settings",
    ]);
  });
});

describe("module purity", () => {
  it("1.10: the source imports no React, no logging, and reads no window/document", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/utils/dialogOpenOrder.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const imports = code.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.filter((l) => /["']react["']|react-dom/.test(l))).toEqual([]);
    expect(imports.filter((l) => /logging|logger/i.test(l))).toEqual([]);
    expect(code).not.toMatch(/\bwindow\b/);
    expect(code).not.toMatch(/\bdocument\b/);
    expect(source.split("\n").length).toBeLessThan(300);
  });
});
