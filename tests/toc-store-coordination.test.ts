// @vitest-environment node
/**
 * WI-3.5.3 — `src/stores/tocStore.ts#setEntries`: document scoping plus the end of the
 * unconditional collapse/active reset.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260918-214500.md` §S, cases S1-S13 (laws
 * S-L1 … S-L7 named on each case).
 *
 * ---------------------------------------------------------------------------
 * What happened to S0 (the HEAD-shaped red receipt) — recorded, not dropped
 * ---------------------------------------------------------------------------
 * The matrix specifies S0 as a separate file (`tests/toc-store-reset-receipt.test.ts`)
 * keyed off `entry.id`, so that the recorded red reads "the reset fired" rather than
 * "the type has no `key` field". **S0 is unwritable against this tree**: WI-3.5.1 has
 * already landed in the working tree and deleted `TOCEntry.id` (pinned by case T2 in
 * `tests/heading-identity-model.test.ts`), so an `entry.id` receipt neither compiles
 * under `pnpm typecheck:tests` nor observes anything at runtime.
 *
 * The condition S0 exists to avoid is therefore already absent: with `key` present and
 * minted, **S1 goes red for exactly the right reason** — its wrong-reason guard passes,
 * and the failure is `collapsedIds.has(k) === false` caused by `tocStore.ts:82-83`
 * replacing `collapsedIds` and nulling `activeEntryId` on every call. S1 is the recorded
 * red receipt for WI-3.5.3, and the supersession table's row for S0 is discharged: the
 * successor is live, and the receipt it supersedes was never written.
 *
 * ---------------------------------------------------------------------------
 * Constraints honoured (matrix §0)
 * ---------------------------------------------------------------------------
 * - No mocks: the real Zustand store and the real `coordinateHeadingKeys` matcher (§0.4).
 * - No new dependency (§0.3): S4's edit-script domain is a hand-written generator in this
 *   file and the collapsed subsets come from the in-tree LCG in `tests/helpers/`.
 * - **No literal key strings are ever asserted** (§0.5): the mint counter is store-owned
 *   and never reset, so every expectation below is distinctness / membership / absence
 *   measured against keys the store itself produced.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { asAnchorSlug } from "../src/types/toc";
import type { HeadingKey, ParsedTOCEntry } from "../src/types/toc";
import { useTOCStore } from "../src/stores/tocStore";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";

type Level = 1 | 2 | 3 | 4 | 5 | 6;

/** A heading as these cases describe one: level + text, position optional. */
interface HeadingSpec {
  level: Level;
  text: string;
  line?: number;
  offset?: number;
}

/**
 * Test-owned slugging. The store carries `anchorSlug` through untouched (minting slugs
 * is `tocService`'s job, not the store's), so a two-rule slugger is enough here and
 * keeps S7's "the slug moved" assertion readable.
 */
function slugOf(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "-");
}

function pe(spec: HeadingSpec, index = 0): ParsedTOCEntry {
  return {
    anchorSlug: asAnchorSlug(slugOf(spec.text)),
    level: spec.level,
    text: spec.text,
    lineNumber: spec.line ?? index * 2 + 1,
    offset: spec.offset ?? index * 10,
  };
}

function parsed(specs: readonly HeadingSpec[]): ParsedTOCEntry[] {
  return specs.map((spec, i) => pe(spec, i));
}

function keysNow(): HeadingKey[] {
  return useTOCStore.getState().entries.map((e) => e.key);
}

/** The S1/S2/S3 fixture: one H1 and two H2s. */
const ABC: readonly HeadingSpec[] = [
  { level: 1, text: "Guide" },
  { level: 2, text: "Intro" },
  { level: 2, text: "Setup" },
];

beforeEach(() => {
  useTOCStore.setState({
    entries: [],
    documentId: null,
    activeEntryId: null,
    collapsedIds: new Set<HeadingKey>(),
    byDocument: new Map(),
    isVisible: false,
  });
});

// ---------------------------------------------------------------------------
// S1 — REGRESSION (the recorded red): collapse and active survive a re-parse
// ---------------------------------------------------------------------------

describe("S1 collapse and active survive an identical re-parse (WI-3.5.3 regression)", () => {
  it("S1 keeps the collapsed key and the active key across a same-document re-parse", () => {
    useTOCStore.getState().setEntries(parsed(ABC), "doc-a");

    const k = useTOCStore.getState().entries[1].key;
    // Wrong-reason guard: if this fires, the red below is about the key field, not the
    // reset, and the receipt would certify the wrong delta.
    expect(typeof (k as unknown) === "string" && (k as string).length > 0).toBe(true);

    useTOCStore.getState().toggleCollapsed(k);
    useTOCStore.getState().setActiveEntry(k);

    useTOCStore.getState().setEntries(parsed(ABC), "doc-a");

    const after = useTOCStore.getState();
    expect(after.collapsedIds.has(k), "collapse was wiped by the re-parse").toBe(true);
    expect(after.activeEntryId, "active entry was wiped by the re-parse").toBe(k);
    expect(after.entries[1].key, "the heading was re-minted instead of coordinated").toBe(k);
  });
});

// ---------------------------------------------------------------------------
// S2 / S3 — LAW S-L1, idempotence
// ---------------------------------------------------------------------------

describe("S-L1 idempotence", () => {
  it("S2 five further identical calls change nothing observable", () => {
    useTOCStore.getState().setEntries(parsed(ABC), "doc-a");
    const k = useTOCStore.getState().entries[1].key;
    useTOCStore.getState().toggleCollapsed(k);
    useTOCStore.getState().setActiveEntry(k);
    const firstKeys = keysNow();

    for (let call = 1; call <= 5; call += 1) {
      useTOCStore.getState().setEntries(parsed(ABC), "doc-a");
      const s = useTOCStore.getState();
      expect([...s.collapsedIds], `collapse diverged on call ${call}`).toEqual([k]);
      expect(s.activeEntryId, `active diverged on call ${call}`).toBe(k);
      expect(keysNow(), `keys diverged on call ${call}`).toEqual(firstKeys);
      expect(s.byDocument.size, `a same-id call archived on call ${call}`).toBe(0);
    }
  });

  it("S3 collapsedIds keeps reference identity across a no-op re-parse", () => {
    useTOCStore.getState().setEntries(parsed(ABC), "doc-a");
    const k = useTOCStore.getState().entries[1].key;
    useTOCStore.getState().toggleCollapsed(k);
    const ref = useTOCStore.getState().collapsedIds;

    for (let call = 1; call <= 3; call += 1) {
      useTOCStore.getState().setEntries(parsed(ABC), "doc-a");
      expect(
        useTOCStore.getState().collapsedIds,
        `collapsedIds was rebuilt on call ${call} although nothing was pruned`,
      ).toBe(ref);
    }
  });
});

// ---------------------------------------------------------------------------
// S4 — LAW S-L2, conservation over the enumerated edit-script domain
// ---------------------------------------------------------------------------
//
// The domain is WI-3.5.2's (matrix M2/M4/M17): every script of length 1 and 2 over a
// 26-op table applied to a fixed 4-heading base. It is **duplicated here rather than
// extracted to a shared helper** for two reasons: (i) extraction would edit
// `tests/heading-coordination.test.ts`, whose cases are already recorded against
// WI-3.5.2, and a conservation law is not worth touching another work item's evidence
// for; (ii) only the `next` half is needed — the positional oracle (`expectedKeys`) and
// its preconditions belong to the matcher's cases, not to a store-level invariant, so
// the duplicate is the generator without the oracle.

const S4_BASE: readonly HeadingSpec[] = [
  { level: 1, text: "Guide" },
  { level: 2, text: "Intro" },
  { level: 2, text: "Setup" },
  { level: 3, text: "Intro" },
];

type Op =
  | { kind: "noop" }
  | { kind: "rename"; i: number }
  | { kind: "insert"; i: number }
  | { kind: "delete"; i: number }
  | { kind: "move"; i: number; j: number };

/** 1 noop + 4 renames + 5 inserts + 4 deletes + 12 moves = 26 single ops. */
function buildOpTable(): Op[] {
  const ops: Op[] = [{ kind: "noop" }];
  for (let i = 0; i < S4_BASE.length; i += 1) ops.push({ kind: "rename", i });
  for (let i = 0; i <= S4_BASE.length; i += 1) ops.push({ kind: "insert", i });
  for (let i = 0; i < S4_BASE.length; i += 1) ops.push({ kind: "delete", i });
  for (let i = 0; i < S4_BASE.length; i += 1) {
    for (let j = 0; j < S4_BASE.length; j += 1) {
      if (i !== j) ops.push({ kind: "move", i, j });
    }
  }
  return ops;
}

/** Every script of length 1 and length 2 over the op table: 26 + 676 = 702. */
function buildScripts(): Op[][] {
  const ops = buildOpTable();
  const scripts: Op[][] = ops.map((op) => [op]);
  for (const first of ops) {
    for (const second of ops) scripts.push([first, second]);
  }
  return scripts;
}

function applyOp(list: readonly HeadingSpec[], op: Op, insertSeq: number): HeadingSpec[] {
  const copy = list.map((h) => ({ ...h }));
  switch (op.kind) {
    case "noop":
      return copy;
    case "rename": {
      if (op.i >= copy.length) return copy;
      copy[op.i] = { ...copy[op.i], text: `Renamed ${op.i}` };
      return copy;
    }
    case "insert": {
      if (op.i > copy.length) return copy;
      copy.splice(op.i, 0, { level: 4, text: `Brand new ${insertSeq}` });
      return copy;
    }
    case "delete": {
      if (op.i >= copy.length) return copy;
      copy.splice(op.i, 1);
      return copy;
    }
    case "move": {
      if (op.i >= copy.length) return copy;
      const [moved] = copy.splice(op.i, 1);
      if (op.j > copy.length) return list.map((h) => ({ ...h }));
      copy.splice(op.j, 0, moved);
      return copy;
    }
  }
}

function applyScript(script: readonly Op[]): HeadingSpec[] {
  let current: HeadingSpec[] = S4_BASE.map((h) => ({ ...h }));
  let insertSeq = 0;
  for (const op of script) {
    if (op.kind === "insert") insertSeq += 1;
    current = applyOp(current, op, insertSeq);
  }
  return current;
}

describe("S-L2 conservation", () => {
  it("S4 collapse ⊆ present keys and active ∈ present ∪ {null} after every scripted edit", () => {
    const scripts = buildScripts();
    expect(scripts.length, "the edit-script domain changed size").toBe(702);

    scripts.forEach((script, scriptIndex) => {
      const where = `script #${scriptIndex} ${JSON.stringify(script)}`;
      useTOCStore.setState({
        entries: [],
        documentId: null,
        activeEntryId: null,
        collapsedIds: new Set<HeadingKey>(),
        byDocument: new Map(),
      });

      useTOCStore.getState().setEntries(parsed(S4_BASE), "doc-a");
      const baseKeys = keysNow();

      // Deterministic collapsed subset + one active heading (G0: in-tree LCG, no
      // fast-check).
      const rng = createLcg(DEFAULT_SEED + scriptIndex);
      for (const key of baseKeys) {
        if (rng() % 2 === 0) useTOCStore.getState().toggleCollapsed(key);
      }
      useTOCStore.getState().setActiveEntry(baseKeys[rng() % baseKeys.length]);

      useTOCStore.getState().setEntries(parsed(applyScript(script)), "doc-a");

      const s = useTOCStore.getState();
      const present = new Set<HeadingKey>(s.entries.map((e) => e.key));
      expect(
        [...s.collapsedIds].every((key) => present.has(key)),
        `collapse escaped the present keys — ${where}`,
      ).toBe(true);
      expect(
        s.activeEntryId === null || present.has(s.activeEntryId),
        `active points at a retired key — ${where}`,
      ).toBe(true);
      expect(s.collapsedIds.size, `collapse outgrew the entries — ${where}`).toBeLessThanOrEqual(
        present.size,
      );
      expect(present.size, `keys are not pairwise distinct — ${where}`).toBe(s.entries.length);
    });
  });
});

// ---------------------------------------------------------------------------
// S5 / S6 / S8 — LAWS S-L3, S-L4, S-L6: document scoping
// ---------------------------------------------------------------------------

describe("S-L3 document isolation", () => {
  it("S5 doc B shares nothing with doc A even when the headings are byte-identical", () => {
    const doc: readonly HeadingSpec[] = [
      { level: 1, text: "Guide" },
      { level: 2, text: "Intro" },
    ];

    useTOCStore.getState().setEntries(parsed(doc), "doc-a");
    const aKeys = keysNow();
    const aEntries = useTOCStore.getState().entries;
    const aSlug = aEntries[1].anchorSlug;
    useTOCStore.getState().toggleCollapsed(aKeys[0]);
    useTOCStore.getState().toggleCollapsed(aKeys[1]);
    useTOCStore.getState().setActiveEntry(aKeys[1]);

    useTOCStore.getState().setEntries(parsed(doc), "doc-b");

    const s = useTOCStore.getState();
    expect(s.documentId).toBe("doc-b");
    expect(s.collapsedIds.size, "doc A's collapse leaked into doc B").toBe(0);
    expect(s.activeEntryId, "doc A's active entry leaked into doc B").toBe(null);
    expect(s.entries[0].key, "doc B reused doc A's key").not.toBe(aKeys[0]);
    expect(s.entries[1].key, "doc B reused doc A's key").not.toBe(aKeys[1]);
    // The slug is identical — which is exactly why keying state off the slug would
    // have passed the assertions above and still been wrong.
    expect(s.entries[1].anchorSlug).toBe(aSlug);
    expect(s.byDocument.has("doc-a"), "doc A was not archived").toBe(true);
    expect(s.byDocument.has("doc-b"), "the current document is in its own archive").toBe(false);
  });
});

describe("S-L4 round-trip", () => {
  it("S6 A → B → A restores A's exact collapse set and active entry", () => {
    const a: readonly HeadingSpec[] = [
      { level: 1, text: "Guide" },
      { level: 2, text: "Intro" },
      { level: 2, text: "Setup" },
    ];
    const b: readonly HeadingSpec[] = [
      { level: 1, text: "Other" },
      { level: 2, text: "Notes" },
    ];

    useTOCStore.getState().setEntries(parsed(a), "doc-a");
    const aKeys = keysNow();
    useTOCStore.getState().toggleCollapsed(aKeys[0]);
    useTOCStore.getState().toggleCollapsed(aKeys[2]);
    useTOCStore.getState().setActiveEntry(aKeys[1]);

    useTOCStore.getState().setEntries(parsed(b), "doc-b");
    const bKeys = keysNow();
    useTOCStore.getState().toggleCollapsed(bKeys[0]);

    useTOCStore.getState().setEntries(parsed(a), "doc-a");

    const s = useTOCStore.getState();
    expect([...s.collapsedIds].sort(), "A's collapse set did not come back intact").toEqual(
      [aKeys[0], aKeys[2]].sort(),
    );
    expect(s.activeEntryId, "A's active entry did not come back").toBe(aKeys[1]);
    expect(keysNow(), "A's headings were re-minted on return").toEqual(aKeys);
    expect(s.byDocument.has("doc-b"), "B was not archived on the way back").toBe(true);
    expect(s.byDocument.has("doc-a"), "the current document is in its own archive").toBe(false);
  });
});

describe("S-L6 global key injectivity", () => {
  it("S8 no key is ever observed under two document ids across 20 switches", () => {
    const owners = new Map<HeadingKey, Set<string>>();
    const distinct = new Set<HeadingKey>();

    for (let i = 0; i < 20; i += 1) {
      const documentId = `doc-${i % 3}`;
      useTOCStore.getState().setEntries(parsed([{ level: 2, text: "Intro" }]), documentId);
      const key = useTOCStore.getState().entries[0].key;
      distinct.add(key);
      const seen = owners.get(key) ?? new Set<string>();
      seen.add(documentId);
      owners.set(key, seen);
    }

    expect(distinct.size, "a document re-minted its heading instead of restoring it").toBe(3);
    for (const [key, documents] of owners) {
      expect(documents.size, `key ${String(key)} was handed to more than one document`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// S7 — LAW S-L5, slug-independence
// ---------------------------------------------------------------------------

describe("S-L5 slug-independence", () => {
  it("S7 collapse survives a rename while the anchor slug moves", () => {
    useTOCStore.getState().setEntries(
      parsed([
        { level: 1, text: "Guide" },
        { level: 2, text: "Intro" },
      ]),
      "doc-a",
    );
    const k = useTOCStore.getState().entries[1].key;
    expect(useTOCStore.getState().entries[1].anchorSlug as string).toBe("intro");
    useTOCStore.getState().toggleCollapsed(k);

    useTOCStore.getState().setEntries(
      parsed([
        { level: 1, text: "Guide" },
        { level: 2, text: "Introduction" },
      ]),
      "doc-a",
    );

    const s = useTOCStore.getState();
    expect(s.entries[1].key, "a rename retired the key").toBe(k);
    expect(s.collapsedIds.has(k), "a rename dropped the collapse").toBe(true);
    expect(s.entries[1].anchorSlug as string, "the slug did not move; the case is vacuous").toBe(
      "introduction",
    );
    expect(s.entries[1].text).toBe("Introduction");
  });
});

// ---------------------------------------------------------------------------
// S9 — LAW S-L7, isVisible is not document-scoped
// ---------------------------------------------------------------------------

describe("S-L7 isVisible invariance", () => {
  // Matrix deviation, now discharged: revision 1 of this file used `clearEntries()` as a
  // stand-in because `resetCoordination` did not exist yet. WI-3.5.5 renamed the action,
  // so the step below is the matrix's own `resetCoordination("doc-b")`. This is a
  // **signature change** to the trace, not a change to what S9 asserts — the assertion
  // is still "isVisible is invariant across every step", unchanged in wording and count.
  it("S9 isVisible survives setEntries, a wholesale reset, a document switch and a null id", () => {
    const e = parsed([{ level: 1, text: "Guide" }]);
    const f = parsed([{ level: 2, text: "Notes" }]);

    useTOCStore.getState().setVisibility(true);
    expect(useTOCStore.getState().isVisible, "setVisibility did not take").toBe(true);

    const steps: Array<[string, () => void]> = [
      ["setEntries doc-a", () => useTOCStore.getState().setEntries(e, "doc-a")],
      ["setEntries doc-b", () => useTOCStore.getState().setEntries(f, "doc-b")],
      ["resetCoordination doc-b", () => useTOCStore.getState().resetCoordination("doc-b")],
      ["setEntries doc-a again", () => useTOCStore.getState().setEntries(e, "doc-a")],
      ["setEntries null", () => useTOCStore.getState().setEntries([], null)],
    ];

    for (const [label, step] of steps) {
      step();
      expect(useTOCStore.getState().isVisible, `isVisible was scoped by: ${label}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// S10 / S11 / S12 / S13 — retirement, positions, the null guard, toggle
// ---------------------------------------------------------------------------

describe("retirement, positions and guards", () => {
  it("S10 a deleted heading's state is dropped and never slides onto a neighbour", () => {
    const three: readonly HeadingSpec[] = [
      { level: 2, text: "A" },
      { level: 2, text: "B" },
      { level: 2, text: "C" },
    ];
    useTOCStore.getState().setEntries(parsed(three), "doc-a");
    const [kA, kB, kC] = keysNow();
    useTOCStore.getState().toggleCollapsed(kB);
    useTOCStore.getState().setActiveEntry(kB);

    useTOCStore.getState().setEntries(
      parsed([
        { level: 2, text: "A" },
        { level: 2, text: "C" },
      ]),
      "doc-a",
    );

    const s = useTOCStore.getState();
    expect(s.collapsedIds.size, "state survived the deletion").toBe(0);
    expect(s.activeEntryId, "the active entry survived the deletion").toBe(null);
    expect(s.collapsedIds.has(kA), "collapse slid onto the previous neighbour").toBe(false);
    expect(s.collapsedIds.has(kC), "collapse slid onto the next neighbour").toBe(false);
    expect(s.entries.map((e) => e.key), "the survivors were re-minted").toEqual([kA, kC]);
    expect(s.entries.some((e) => e.key === kB), "the retired key came back").toBe(false);
  });

  it("S11 a preserved key gets the new line number and offset, never the old ones", () => {
    useTOCStore
      .getState()
      .setEntries([pe({ level: 2, text: "Intro", line: 3, offset: 20 })], "doc-a");
    const k = useTOCStore.getState().entries[0].key;

    useTOCStore
      .getState()
      .setEntries([pe({ level: 2, text: "Intro", line: 9, offset: 140 })], "doc-a");

    const entry = useTOCStore.getState().entries[0];
    expect(entry.key, "the key was not preserved across the move").toBe(k);
    expect(entry.lineNumber, "the position was inherited instead of refreshed").toBe(9);
    expect(entry.offset, "the position was inherited instead of refreshed").toBe(140);
  });

  it("S12 setEntries(entries, null) empties everything and archives nothing under null", () => {
    useTOCStore.getState().setEntries(
      parsed([
        { level: 1, text: "Guide" },
        { level: 2, text: "Intro" },
      ]),
      "doc-a",
    );
    useTOCStore.getState().toggleCollapsed(keysNow()[1]);

    useTOCStore.getState().setEntries(parsed([{ level: 2, text: "Whatever" }]), null);

    const s = useTOCStore.getState();
    expect(s.entries, "a null document id still stored entries").toEqual([]);
    expect(s.collapsedIds.size).toBe(0);
    expect(s.activeEntryId).toBe(null);
    expect(s.documentId).toBe(null);
    // Exact list, so a stringified "null" archive key is caught.
    expect([...s.byDocument.keys()]).toEqual(["doc-a"]);
  });

  it("S13 toggleCollapsed is an involution and touches only the named key", () => {
    useTOCStore.getState().setEntries(
      parsed([
        { level: 2, text: "A" },
        { level: 2, text: "B" },
      ]),
      "doc-a",
    );
    const [kA, kB] = keysNow();
    const entriesRef = useTOCStore.getState().entries;

    useTOCStore.getState().toggleCollapsed(kA);
    useTOCStore.getState().toggleCollapsed(kA);
    expect(useTOCStore.getState().collapsedIds.size, "toggle is not an involution").toBe(0);

    useTOCStore.getState().toggleCollapsed(kA);
    useTOCStore.getState().toggleCollapsed(kB);

    const s = useTOCStore.getState();
    expect([...s.collapsedIds].sort()).toEqual([kA, kB].sort());
    expect(s.entries, "toggleCollapsed rebuilt the entries").toBe(entriesRef);
    expect(s.activeEntryId, "toggleCollapsed touched the active entry").toBe(null);
    expect(s.documentId, "toggleCollapsed touched the document id").toBe("doc-a");
  });
});
