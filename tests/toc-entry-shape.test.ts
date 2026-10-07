// @vitest-environment node
/**
 * WI-3.5.1 — `buildTOCHierarchy` carries the two identity fields through nesting, and
 * `setEntries` is the only thing that mints a `HeadingKey`.
 *
 * Case ids map to the WI-3.5 test matrix
 * (`.claude/tdd-guardian/tests-20260918-214500.md:84-110`): H1 and H2 for
 * `buildTOCHierarchy`. K1 is an added runtime case for WI-3.5.1's third acceptance
 * criterion ("callers cannot supply a `key`; only the store mints one") — the matrix
 * states that criterion only at the type level (T3), and a type-level case cannot show
 * that the store actually puts a key on each stored entry.
 *
 * NOTE for WI-3.5.3: `setEntries` gains a `documentId` second argument there, so K1's
 * call site will need the extra argument. That is a signature change, not a change to
 * what K1 asserts.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { asAnchorSlug, asHeadingKey } from "../src/types/toc";
import type { HeadingKey, ParsedTOCEntry, TOCEntry } from "../src/types/toc";
import { buildTOCHierarchy, useTOCStore } from "../src/stores/tocStore";

type Level = 1 | 2 | 3 | 4 | 5 | 6;

/** Flat entries built from a level sequence; `key`/`anchorSlug` encode the index. */
function flatFrom(levels: readonly Level[]): TOCEntry[] {
  return levels.map((level, i) => ({
    key: asHeadingKey("k" + i),
    anchorSlug: asAnchorSlug("s" + i),
    level,
    text: "T" + i,
    lineNumber: i + 1,
    offset: i * 10,
    children: [] as TOCEntry[],
  }));
}

function flattenPreOrder(nodes: readonly TOCEntry[]): TOCEntry[] {
  const out: TOCEntry[] = [];
  const visit = (ns: readonly TOCEntry[]) => {
    for (const n of ns) {
      out.push(n);
      visit(n.children);
    }
  };
  visit(nodes);
  return out;
}

/** Index encoded in a test entry's key ("k3" -> 3). */
function indexOf(entry: TOCEntry): number {
  return Number((entry.key as string).slice(1));
}

/** Actual parent index per node, read off the built tree. `-1` means root. */
function actualParents(built: readonly TOCEntry[], size: number): number[] {
  const out = new Array<number>(size).fill(-2); // -2 = never visited
  const visit = (nodes: readonly TOCEntry[], parent: number) => {
    for (const n of nodes) {
      const i = indexOf(n);
      out[i] = parent;
      visit(n.children, i);
    }
  };
  visit(built, -1);
  return out;
}

/** Nearest preceding entry of strictly lower level, or -1 for a root. */
function expectedParents(levels: readonly Level[]): number[] {
  return levels.map((level, i) => {
    for (let j = i - 1; j >= 0; j--) {
      if (levels[j] < level) return j;
    }
    return -1;
  });
}

/** Every level sequence of length 1..5 over {1,2,3} — 3+9+27+81+243 = 363 cases. */
function levelDomain(): Level[][] {
  const alphabet: Level[] = [1, 2, 3];
  const out: Level[][] = [];
  for (let len = 1; len <= 5; len++) {
    const total = alphabet.length ** len;
    for (let n = 0; n < total; n++) {
      const seq: Level[] = [];
      let rest = n;
      for (let p = 0; p < len; p++) {
        seq.push(alphabet[rest % alphabet.length]);
        rest = Math.floor(rest / alphabet.length);
      }
      out.push(seq);
    }
  }
  return out;
}

describe("buildTOCHierarchy (WI-3.5.1 cases H1-H2)", () => {
  it("H1 pre-order flatten round-trips and every parent is the nearest lower-level ancestor", () => {
    const domain = levelDomain();
    expect(domain.length, "domain size").toBe(363);

    for (const levels of domain) {
      const where = "levels=[" + levels.join(",") + "]";
      const flat = flatFrom(levels);
      const built = buildTOCHierarchy(flat);
      const flattened = flattenPreOrder(built);

      // (i) conservation: same entries, same order, same length.
      expect(flattened.length, "length changed for " + where).toBe(flat.length);
      expect(
        flattened.map((e) => e.key as string),
        "pre-order flatten did not round-trip for " + where,
      ).toEqual(flat.map((e) => e.key as string));

      // (ii) exact nearest-ancestor nesting, compared as a whole array.
      expect(
        actualParents(built, flat.length),
        "parent chain wrong for " + where,
      ).toEqual(expectedParents(levels));

      // (iii) carry-through: anchorSlug (and the rest) untouched at each position.
      expect(
        flattened.map((e) => e.anchorSlug as string),
        "anchorSlug not carried through for " + where,
      ).toEqual(flat.map((e) => e.anchorSlug as string));
      expect(
        flattened.map((e) => [e.level, e.text, e.lineNumber, e.offset]),
        "payload not carried through for " + where,
      ).toEqual(flat.map((e) => [e.level, e.text, e.lineNumber, e.offset]));
    }
  });

  it("H2 empty input returns an empty array", () => {
    expect(buildTOCHierarchy([])).toEqual([]);
  });
});

describe("tocStore.setEntries mints the HeadingKey (WI-3.5.1 case K1, added)", () => {
  beforeEach(() => {
    useTOCStore.setState({
      entries: [],
      activeEntryId: null,
      collapsedIds: new Set<HeadingKey>(),
    });
  });

  it("K1 every stored entry gets a non-empty, pairwise-distinct key the caller never supplied", () => {
    const parsed: ParsedTOCEntry[] = [
      { anchorSlug: asAnchorSlug("guide"), level: 1, text: "Guide", lineNumber: 1, offset: 0 },
      { anchorSlug: asAnchorSlug("intro"), level: 2, text: "Intro", lineNumber: 3, offset: 10 },
      { anchorSlug: asAnchorSlug("setup"), level: 2, text: "Setup", lineNumber: 5, offset: 20 },
    ];

    useTOCStore.getState().setEntries(parsed, "doc-k1");
    const stored = useTOCStore.getState().entries;

    expect(stored).toHaveLength(3);
    stored.forEach((entry, i) => {
      expect(typeof (entry.key as unknown), "entry " + i + " has no minted key").toBe("string");
      expect((entry.key as string).length, "entry " + i + " has an empty key").toBeGreaterThan(0);
    });
    expect(new Set(stored.map((e) => e.key as string)).size, "keys are not distinct").toBe(3);

    // The parser's own fields are carried through untouched, and `children` is the
    // store's doing — a `ParsedTOCEntry` cannot carry one.
    expect(stored.map((e) => e.anchorSlug as string)).toEqual(["guide", "intro", "setup"]);
    expect(stored.map((e) => e.text)).toEqual(["Guide", "Intro", "Setup"]);
    expect(stored.map((e) => e.lineNumber)).toEqual([1, 3, 5]);
    expect(stored.every((e) => Array.isArray(e.children) && e.children.length === 0)).toBe(true);
  });

  it("K1b an empty parse stores no entries and mints nothing", () => {
    useTOCStore.getState().setEntries([], "doc-k1b");
    expect(useTOCStore.getState().entries).toEqual([]);
  });
});
