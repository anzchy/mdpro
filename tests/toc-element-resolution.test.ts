/**
 * Purpose: WI-3.6.1 — the pure resolver module `src/utils/tocElementResolution.ts`.
 * Matrix sections §1 (`normalizeHeadingText`), §2 (`collectHeadingElements`),
 * §3 (`resolveHeadingElements`) and §4 (`pickActiveKey`) of
 * `.claude/tdd-guardian/tests-20260919-114230.md` (revision 3).
 *
 * ---------------------------------------------------------------------------
 * Constraints honoured (matrix §0)
 * ---------------------------------------------------------------------------
 * - **No mocks anywhere** (§0.7). The DOM is real jsdom, built by hand from
 *   `(level, text, id)` triples. The resolver, the corpus generator and the LCG are
 *   all the real thing.
 * - **No new dependency** (§0.3, gate G0). `fast-check` is forbidden; every S4/S5
 *   domain below is either an explicit in-file table or the in-tree LCG from
 *   `tests/helpers/headingCorpus.ts`.
 * - **No `Object.hasOwn`** (§0.4) — `lib: ["ES2020"]` rejects it (TS2550).
 * - **No literal key string is ever asserted** (§0.4). Keys come from the test-local
 *   `mintKey` counter and every expectation is distinctness, membership, absence, or
 *   element identity.
 * - **Standing rule H2** (§0.4): every case whose entries come from a generator or a
 *   corpus opens by asserting the entry keys are pairwise distinct. A duplicate key
 *   would make injectivity, the inverse law and conservation all pass vacuously.
 * - **Standing rule H1** (§0.4): all five §3 laws are satisfied by empty maps, so the
 *   `identity` perturbation (E-L1) and both E-L5 group baselines additionally assert
 *   that resolution is *total*. Without those rows the whole §3 law block is vacuous.
 *
 * ---------------------------------------------------------------------------
 * Deviation from the matrix, stated rather than hidden
 * ---------------------------------------------------------------------------
 * The matrix files a shared helper `tests/helpers/milkdownHeadingDom.ts` for the DOM
 * fixtures. WI-3.6.1's brief scopes this change to exactly two files, so the builder
 * lives in this file as `buildProseMirror`. WI-3.6.2/3 may promote it; nothing here
 * depends on where it lives.
 *
 * ---------------------------------------------------------------------------
 * On the DOM ids in these fixtures (matrix §0.5)
 * ---------------------------------------------------------------------------
 * Rows labelled **measured** were printed by a real Milkdown editor mounted in jsdom
 * on 2026-09-19. Rows labelled **derived** were computed from
 * `defaultHeadingIdGenerator` (lowercase + whitespace→hyphen, punctuation preserved)
 * plus `syncHeadingIdPlugin`'s `-#n` dedupe, and are *not* measured. Because the fix
 * makes resolution independent of ids, an outdated or wrong transcription can only
 * weaken realism — it can never produce a false green.
 */
import { describe, expect, it } from "vitest";

import {
  collectHeadingElements,
  normalizeHeadingText,
  pickActiveKey,
  resolveHeadingElements,
} from "../src/utils/tocElementResolution";
import { asAnchorSlug, asHeadingKey } from "../src/types/toc";
import type { HeadingKey, TOCEntry } from "../src/types/toc";
import {
  createLcg,
  DEFAULT_SEED,
  generateCorpus,
  shapeDomain,
} from "./helpers/headingCorpus";

// ---------------------------------------------------------------------------
// Test-local fixtures
// ---------------------------------------------------------------------------

type Level = TOCEntry["level"];

/** Test-local, never reset. No assertion ever compares against the value it makes. */
let keySequence = 0;
function mintKey(): HeadingKey {
  keySequence += 1;
  return asHeadingKey(`test-hk-${keySequence}`);
}

function makeEntry(level: Level, text: string, anchorSlug?: string): TOCEntry {
  const key = mintKey();
  return {
    key,
    anchorSlug: asAnchorSlug(anchorSlug ?? `slug-${keySequence}`),
    level,
    text,
    lineNumber: keySequence,
    offset: keySequence,
    children: [],
  };
}

function makeEntries(specs: ReadonlyArray<readonly [Level, string]>): TOCEntry[] {
  return specs.map(([level, text]) => makeEntry(level, text));
}

interface DomHeadingSpec {
  level: number;
  text: string;
  /** `null`/omitted means the attribute is genuinely absent (P3's shape). */
  id?: string | null;
  dataHeadingId?: string | null;
}

interface Fixture {
  container: HTMLElement;
  proseMirror: HTMLElement;
  headings: HTMLElement[];
}

/** `#milkdown-container > .ProseMirror > hN*`, the shape `App.tsx:139-140` wires. */
function buildProseMirror(specs: ReadonlyArray<DomHeadingSpec>): Fixture {
  const container = document.createElement("div");
  container.id = "milkdown-container";
  const proseMirror = document.createElement("div");
  proseMirror.className = "ProseMirror";
  container.appendChild(proseMirror);

  const headings = specs.map((spec) => {
    const el = document.createElement(`h${spec.level}`);
    el.textContent = spec.text;
    if (spec.id != null) el.id = spec.id;
    if (spec.dataHeadingId != null) {
      el.setAttribute("data-heading-id", spec.dataHeadingId);
    }
    proseMirror.appendChild(el);
    return el;
  });

  return { container, proseMirror, headings };
}

function dom(specs: ReadonlyArray<readonly [number, string]>): DomHeadingSpec[] {
  return specs.map(([level, text]) => ({ level, text }));
}

/** H2 — the key-distinctness guard (matrix §0.4). */
function expectDistinctKeys(entries: readonly TOCEntry[], where: string): void {
  expect(
    new Set(entries.map((e) => e.key)).size,
    `${where}: H2 — entry keys must be pairwise distinct`,
  ).toBe(entries.length);
}

const SEED_LABEL = `seed=0x${DEFAULT_SEED.toString(16)}`;

// ---------------------------------------------------------------------------
// §1 — normalizeHeadingText
// ---------------------------------------------------------------------------

describe("§1 normalizeHeadingText", () => {
  it("NT-1: collapses interior whitespace runs and trims the ends", () => {
    const rows: Array<[string, string, string]> = [
      ["  Intro  ", "Intro", "both ends trimmed"],
      ["Intro\n\ttail", "Intro tail", "newline + tab collapse to one space"],
      ["Intro   tail", "Intro tail", "a three-space run collapses to one"],
      ["Intro", "Intro", "already normal — a fixed point"],
      [" Intro", "Intro", "leading only"],
      // MEASURED note: JS `\s` DOES match U+00A0, so NBSP collapses like any other
      // whitespace. This is the one row a reader will doubt, so it is labelled.
      ["Intro tail", "Intro tail", "NBSP (U+00A0) is matched by /\\s/ in JS"],
    ];

    for (const [input, expected, why] of rows) {
      expect(normalizeHeadingText(input), `${JSON.stringify(input)} — ${why}`).toBe(
        expected,
      );
    }
  });

  it("NT-L1: LAW idempotence and closed output shape over the corpus domain", () => {
    const next = createLcg(DEFAULT_SEED);
    const whitespace = [" ", "\t", "\n", " ", "  "];
    const domain = shapeDomain();
    let inputCount = 0;

    for (const base of domain) {
      for (let kind = 0; kind < 4; kind++) {
        const a = whitespace[next() % whitespace.length];
        const b = whitespace[next() % whitespace.length];
        let x: string;
        if (kind === 0) x = a + base;
        else if (kind === 1) x = base + a;
        else if (kind === 2) x = a + base + b;
        else x = base.slice(0, 1) + a + b + base.slice(1);

        inputCount += 1;
        const where = `${SEED_LABEL} input=${JSON.stringify(x)}`;
        const n = normalizeHeadingText(x);

        expect(typeof n, `${where}: total — must return a string`).toBe("string");
        expect(normalizeHeadingText(n), `${where}: idempotent n(n(x)) === n(x)`).toBe(n);
        expect(n, `${where}: no leading/trailing whitespace`).toBe(n.trim());
        expect(/\s\s/.test(n), `${where}: no interior whitespace run > 1`).toBe(false);
      }
    }

    // Non-vacuity: the domain must not have quietly emptied.
    expect(inputCount).toBe(domain.length * 4);
    expect(domain.length).toBe(191);
  });
});

// ---------------------------------------------------------------------------
// §2 — collectHeadingElements
// ---------------------------------------------------------------------------

describe("§2 collectHeadingElements", () => {
  it("CH-1: a flat .ProseMirror yields all six heading levels in source order", () => {
    const { container, headings } = buildProseMirror(
      dom([
        [1, "One"],
        [2, "Two"],
        [3, "Three"],
        [4, "Four"],
        [5, "Five"],
        [6, "Six"],
      ]),
    );

    expect(collectHeadingElements(container)).toEqual(headings);
  });

  it("CH-2: headings nested in blockquotes, list items and divs are still collected", () => {
    const container = document.createElement("div");
    container.id = "milkdown-container";
    const proseMirror = document.createElement("div");
    proseMirror.className = "ProseMirror";
    proseMirror.innerHTML =
      "<h1>A</h1><blockquote><h2>B</h2></blockquote><ul><li><h3>C</h3></li></ul>";
    container.appendChild(proseMirror);

    const planted = Array.from(proseMirror.querySelectorAll("h1, h2, h3"));
    expect(planted).toHaveLength(3);
    expect(collectHeadingElements(container)).toEqual(planted);
  });

  it("CH-3: GUARD — no .ProseMirror yields [] even though the container holds an <h3>", () => {
    const container = document.createElement("div");
    container.id = "milkdown-container";
    // The literal modal title from LinkInsertModal.tsx:107, in the remount window
    // (MilkdownEditor.tsx:304 keys MilkdownProvider on activeDocumentId).
    container.innerHTML =
      '<div class="dialog-card"><h3 class="dialog-title">Insert Link</h3></div>';

    // Wrong-reason guard: the fixture really does contain a heading.
    expect(container.querySelectorAll("h3")).toHaveLength(1);
    expect(container.querySelector(".ProseMirror")).toBeNull();

    expect(collectHeadingElements(container)).toEqual([]);
  });

  it("CH-4: GUARD — an empty .ProseMirror does not reach a heading outside it", () => {
    const { container, proseMirror } = buildProseMirror([]);
    proseMirror.innerHTML = "<p>body</p><p>more body</p>";
    const outside = document.createElement("h2");
    outside.textContent = "Outside";
    container.appendChild(outside);

    // Wrong-reason guard.
    expect(container.querySelectorAll("h2")).toHaveLength(1);

    expect(collectHeadingElements(container)).toEqual([]);
  });

  it("CH-L1: LAW document order + subtree containment over 200 generated nestings", () => {
    const next = createLcg(DEFAULT_SEED);
    const wrappers = ["div", "blockquote", "section", "li"] as const;

    for (let tree = 0; tree < 200; tree++) {
      const where = `${SEED_LABEL} tree=${tree}`;
      const container = document.createElement("div");
      const proseMirror = document.createElement("div");
      proseMirror.className = "ProseMirror";
      container.appendChild(proseMirror);

      const planted: HTMLElement[] = [];
      const headingCount = 1 + (next() % 20);
      for (let h = 0; h < headingCount; h++) {
        if (next() % 3 === 0) {
          const p = document.createElement("p");
          p.textContent = "filler";
          proseMirror.appendChild(p);
        }
        const heading = document.createElement(`h${1 + (next() % 6)}`);
        heading.textContent = `H${h}`;
        let node: HTMLElement = heading;
        const depth = next() % 4;
        for (let d = 0; d < depth; d++) {
          const tag = wrappers[next() % wrappers.length];
          const wrapper = document.createElement(tag === "li" ? "ul" : tag);
          if (tag === "li") {
            const li = document.createElement("li");
            li.appendChild(node);
            wrapper.appendChild(li);
          } else {
            wrapper.appendChild(node);
          }
          node = wrapper;
        }
        proseMirror.appendChild(node);
        planted.push(heading);
      }

      // Decoys live OUTSIDE .ProseMirror — the modal shape, in the container.
      const decoyCount = next() % 3;
      for (let d = 0; d < decoyCount; d++) {
        const decoy = document.createElement("h3");
        decoy.className = "dialog-title";
        decoy.textContent = "Insert Link";
        container.appendChild(decoy);
      }

      const result = collectHeadingElements(container);

      expect(result.length, `${where}: one result per planted heading`).toBe(
        planted.length,
      );
      for (let i = 0; i < result.length; i++) {
        expect(
          proseMirror.contains(result[i]),
          `${where}: result[${i}] must live inside .ProseMirror`,
        ).toBe(true);
        expect(
          result[i].classList.contains("dialog-title"),
          `${where}: result[${i}] must not be a decoy`,
        ).toBe(false);
        if (i + 1 < result.length) {
          expect(
            (result[i].compareDocumentPosition(result[i + 1]) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
              0,
            `${where}: result[${i}] must precede result[${i + 1}] in document order`,
          ).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — resolveHeadingElements: the generated domain shared by E-L1 / E-L2 / E-L4
// ---------------------------------------------------------------------------

/**
 * The ten perturbations of matrix E-L1. Nine are named verbatim there; the tenth,
 * `entry-duplicate-1`, is added here because every other mismatch perturbation makes
 * `domCount > entryCount` and the opposite direction would otherwise be unexercised
 * in the generated domain (E-2 covers it only over an all-identical fixture).
 */
const PERTURBATIONS = [
  "identity",
  "all-texts-identical",
  "identical-text-identical-level",
  "identical-text-different-level",
  "dom-duplicates-1",
  "dom-duplicates-2",
  "dom-duplicates-8",
  "dom-duplicates-64",
  "dom-empty-heading",
  "entry-duplicate-1",
] as const;

type Perturbation = (typeof PERTURBATIONS)[number];

interface PerturbedCase {
  where: string;
  entries: TOCEntry[];
  container: HTMLElement;
  perturbation: Perturbation;
}

function buildPerturbedCase(
  docIndex: number,
  headings: readonly string[],
  perturbation: Perturbation,
  levels: () => number,
): PerturbedCase {
  let entrySpecs: Array<readonly [Level, string]> = headings.map(
    (t) => [1, t] as const,
  );
  let domSpecs: DomHeadingSpec[] = headings.map((t) => ({ level: 1, text: t }));

  const duplicateDom = (n: number): void => {
    const first = domSpecs[0];
    const copies: DomHeadingSpec[] = [];
    for (let i = 0; i < n; i++) copies.push({ ...first });
    domSpecs = [first, ...copies, ...domSpecs.slice(1)];
  };

  switch (perturbation) {
    case "identity":
      break;
    case "all-texts-identical":
      entrySpecs = entrySpecs.map(() => [1, "SAME"] as const);
      domSpecs = domSpecs.map(() => ({ level: 1, text: "SAME" }));
      break;
    case "identical-text-identical-level":
      entrySpecs = entrySpecs.map(() => [3, "SAME"] as const);
      domSpecs = domSpecs.map(() => ({ level: 3, text: "SAME" }));
      break;
    case "identical-text-different-level":
      entrySpecs = entrySpecs.map(() => [1, "SAME"] as const);
      domSpecs = domSpecs.map(() => ({ level: 1 + (levels() % 6), text: "SAME" }));
      break;
    case "dom-duplicates-1":
      duplicateDom(1);
      break;
    case "dom-duplicates-2":
      duplicateDom(2);
      break;
    case "dom-duplicates-8":
      duplicateDom(8);
      break;
    case "dom-duplicates-64":
      duplicateDom(64);
      break;
    case "dom-empty-heading":
      // P3: `#` alone renders as an <h1> with NO id attribute at all.
      domSpecs = [{ level: 1, text: "" }, ...domSpecs];
      break;
    case "entry-duplicate-1":
      entrySpecs = [...entrySpecs, entrySpecs[0]];
      break;
  }

  return {
    where: `${SEED_LABEL} doc=${docIndex} perturbation=${perturbation}`,
    entries: makeEntries(entrySpecs),
    container: buildProseMirror(domSpecs).container,
    perturbation,
  };
}

function forEachPerturbedCase(visit: (c: PerturbedCase) => void): number {
  const documents = generateCorpus().documents.slice(0, 60);
  const levels = createLcg(DEFAULT_SEED);
  let count = 0;
  for (let d = 0; d < documents.length; d++) {
    for (const perturbation of PERTURBATIONS) {
      visit(buildPerturbedCase(d, documents[d].headings, perturbation, levels));
      count += 1;
    }
  }
  return count;
}

describe("§3 resolveHeadingElements — examples and regressions", () => {
  it("E-1: tier 1 happy path — three distinct headings zip by position", () => {
    const entries = makeEntries([
      [1, "Alpha"],
      [2, "Beta"],
      [2, "Gamma"],
    ]);
    const { container, headings } = buildProseMirror([
      // Milkdown-shaped ids (derived from the measured generator rules).
      { level: 1, text: "Alpha", id: "alpha" },
      { level: 2, text: "Beta", id: "beta" },
      { level: 2, text: "Gamma", id: "gamma" },
    ]);

    const { byKey, mismatch } = resolveHeadingElements(entries, container);

    expect(byKey.size).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(byKey.get(entries[i].key)).toBe(headings[i]);
    }
    expect(mismatch).toBeNull();
  });

  it("E-R1: REGRESSION — the `intro` / `intro-#2` suffix-scheme disagreement", () => {
    const entries = makeEntries([
      [1, "Intro"],
      [1, "Intro"],
    ]);
    // Our allocator would have said `intro` / `intro-1`; Milkdown says `intro` /
    // `intro-#2` (both MEASURED). The two namespaces never agree on a duplicate.
    entries[0] = { ...entries[0], anchorSlug: asAnchorSlug("intro") };
    entries[1] = { ...entries[1], anchorSlug: asAnchorSlug("intro-1") };

    const { container, headings } = buildProseMirror([
      { level: 1, text: "Intro", id: "intro" },
      { level: 1, text: "Intro", id: "intro-#2" },
    ]);
    expect(headings[0].hasAttribute("data-heading-id")).toBe(false);
    expect(headings[1].hasAttribute("data-heading-id")).toBe(false);

    const { byKey, mismatch } = resolveHeadingElements(entries, container);

    expect(byKey.get(entries[0].key)).toBe(headings[0]);
    expect(byKey.get(entries[1].key)).toBe(headings[1]);
    expect(byKey.get(entries[0].key)).not.toBe(byKey.get(entries[1].key));
    expect(mismatch).toBeNull();
  });

  it("E-2: `mismatch` is null exactly when the counts agree — all 25 cells", () => {
    for (let entryCount = 0; entryCount <= 4; entryCount++) {
      for (let domCount = 0; domCount <= 4; domCount++) {
        const where = `entryCount=${entryCount} domCount=${domCount}`;
        const entries = makeEntries(
          Array.from({ length: entryCount }, () => [1, "H"] as const),
        );
        expectDistinctKeys(entries, where);
        const { container } = buildProseMirror(
          Array.from({ length: domCount }, () => ({ level: 1, text: "H" })),
        );

        const { byKey, mismatch } = resolveHeadingElements(entries, container);

        if (entryCount === domCount) {
          expect(mismatch, `${where}: counts agree`).toBeNull();
        } else {
          expect(mismatch, `${where}: counts differ`).toEqual({ entryCount, domCount });
        }
        expect(byKey.size, `${where}: resolved count`).toBe(
          Math.min(entryCount, domCount),
        );
      }
    }
  });

  it("E-2b: tier 1 zips by position even when neither text nor level matches", () => {
    const arms: Array<{ name: string; domLevels: [number, number, number] }> = [
      { name: "(a) texts differ, levels agree", domLevels: [1, 1, 1] },
      { name: "(b) texts and levels differ", domLevels: [1, 2, 3] },
    ];

    for (const arm of arms) {
      const entries = makeEntries([
        [1, "E1"],
        [1, "E2"],
        [1, "E3"],
      ]);
      const { container, headings } = buildProseMirror([
        { level: arm.domLevels[0], text: "D1" },
        { level: arm.domLevels[1], text: "D2" },
        { level: arm.domLevels[2], text: "D3" },
      ]);

      const { byKey, mismatch } = resolveHeadingElements(entries, container);

      for (let i = 0; i < 3; i++) {
        expect(byKey.get(entries[i].key), `${arm.name}: entry ${i}`).toBe(headings[i]);
      }
      expect(byKey.size, arm.name).toBe(3);
      expect(mismatch, arm.name).toBeNull();
    }
  });

  it("E-3: tier 2 — one extra DOM heading produces no ordinal-shifted wrong targets", () => {
    const entries = makeEntries([
      [1, "A"],
      [1, "B"],
      [1, "C"],
    ]);
    // dom[1] is the `> #\tTitle` / raw-HTML shape our parser misses and Milkdown renders.
    const { container, headings } = buildProseMirror(
      dom([
        [1, "A"],
        [2, "Extra"],
        [1, "B"],
        [1, "C"],
      ]),
    );

    const { byKey, byElement, mismatch } = resolveHeadingElements(entries, container);

    expect(mismatch).toEqual({ entryCount: 3, domCount: 4 });
    expect(byKey.get(entries[0].key)).toBe(headings[0]);
    expect(byKey.get(entries[1].key)).toBe(headings[2]);
    expect(byKey.get(entries[2].key)).toBe(headings[3]);
    expect(byElement.has(headings[1])).toBe(false);
  });

  it("E-3b: tier 2 matches on level as well as text, in both mirror arms", () => {
    // (a) the correct answer is NOT the first textual candidate.
    const entriesA = makeEntries([
      [2, "Title"],
      [2, "Tail"],
    ]);
    const a = buildProseMirror(
      dom([
        [1, "Title"],
        [2, "Title"],
        [2, "Tail"],
      ]),
    );
    const ra = resolveHeadingElements(entriesA, a.container);
    expect(ra.byKey.get(entriesA[0].key), "(a) must take the h2, not the leading h1").toBe(
      a.headings[1],
    );
    expect(ra.byKey.get(entriesA[1].key)).toBe(a.headings[2]);
    expect(ra.byElement.has(a.headings[0])).toBe(false);
    expect(ra.mismatch).toEqual({ entryCount: 2, domCount: 3 });

    // (b) the mirror — here the correct answer IS the first candidate, so a
    // "skip the first textual match" coincidence cannot pass both arms.
    const entriesB = makeEntries([
      [1, "Title"],
      [1, "Tail"],
    ]);
    const b = buildProseMirror(
      dom([
        [1, "Title"],
        [2, "Title"],
        [1, "Tail"],
      ]),
    );
    const rb = resolveHeadingElements(entriesB, b.container);
    expect(rb.byKey.get(entriesB[0].key), "(b) must take the leading h1").toBe(
      b.headings[0],
    );
    expect(rb.byKey.get(entriesB[1].key)).toBe(b.headings[2]);
    expect(rb.byElement.has(b.headings[1])).toBe(false);
    expect(rb.mismatch).toEqual({ entryCount: 2, domCount: 3 });
  });

  it("E-4a: tier 1 zips an inline-markup heading correctly, because it ignores text", () => {
    const entries = makeEntries([
      [2, "[x](url) tail"],
      [2, "Plain"],
    ]);
    const { container, headings } = buildProseMirror(
      dom([
        [2, "x tail"],
        [2, "Plain"],
      ]),
    );

    const { byKey, mismatch } = resolveHeadingElements(entries, container);

    expect(byKey.get(entries[0].key)).toBe(headings[0]);
    expect(byKey.get(entries[1].key)).toBe(headings[1]);
    expect(byKey.size).toBe(2);
    expect(mismatch).toBeNull();
  });

  it("E-4b: tier 2 known limit — an inline-markup heading is a no-op, never a neighbour", () => {
    const entries = makeEntries([
      [2, "[x](url) tail"],
      [2, "Plain"],
    ]);
    const { container, headings } = buildProseMirror(
      dom([
        [2, "x tail"],
        [2, "Plain"],
        [2, "Extra"],
      ]),
    );

    const { byKey, byElement, mismatch } = resolveHeadingElements(entries, container);

    expect(byKey.has(entries[0].key)).toBe(false);
    expect(byKey.get(entries[1].key)).toBe(headings[1]);
    expect(byKey.size).toBe(1);
    expect(mismatch).toEqual({ entryCount: 2, domCount: 3 });
    expect(byElement.has(headings[0])).toBe(false);
    expect(byElement.has(headings[2])).toBe(false);
  });

  it("E-10: an unmatched entry consumes nothing — the cursor does not advance", () => {
    const entries = makeEntries([
      [1, "Zed [x](url)"],
      [1, "Intro"],
      [1, "Intro"],
    ]);
    const { container, headings } = buildProseMirror(
      dom([
        [1, "Intro"],
        [1, "Intro"],
      ]),
    );

    const { byKey, mismatch } = resolveHeadingElements(entries, container);

    expect(byKey.has(entries[0].key)).toBe(false);
    expect(byKey.get(entries[1].key)).toBe(headings[0]);
    expect(byKey.get(entries[2].key)).toBe(headings[1]);
    expect(byKey.size).toBe(2);
    expect(mismatch).toEqual({ entryCount: 3, domCount: 2 });
  });

  it("E-11: both sides of the tier-2 text predicate are normalized", () => {
    // (a) messy DOM, clean entry.
    const entriesA = makeEntries([
      [2, "Intro tail"],
      [2, "Zulu"],
    ]);
    const containerA = document.createElement("div");
    const pmA = document.createElement("div");
    pmA.className = "ProseMirror";
    pmA.innerHTML = "<h2>\n  Intro <em>tail</em>\n</h2><h2>Zulu</h2><h2>Extra</h2>";
    containerA.appendChild(pmA);
    const domA = Array.from(pmA.querySelectorAll("h2"));
    // Wrong-reason guard: the raw side really is un-normalized.
    expect(domA[0].textContent).not.toBe("Intro tail");

    const ra = resolveHeadingElements(entriesA, containerA);
    expect(ra.byKey.get(entriesA[0].key)).toBe(domA[0]);
    expect(ra.byKey.get(entriesA[1].key)).toBe(domA[1]);
    expect(ra.byKey.size).toBe(2);
    expect(ra.mismatch).toEqual({ entryCount: 2, domCount: 3 });

    // (b) clean DOM, messy entry.
    const entriesB = makeEntries([
      [2, "Intro \n  tail"],
      [2, "Zulu"],
    ]);
    expect(entriesB[0].text).not.toBe("Intro tail");
    const b = buildProseMirror(
      dom([
        [2, "Intro tail"],
        [2, "Zulu"],
        [2, "Extra"],
      ]),
    );

    const rb = resolveHeadingElements(entriesB, b.container);
    expect(rb.byKey.get(entriesB[0].key)).toBe(b.headings[0]);
    expect(rb.byKey.get(entriesB[1].key)).toBe(b.headings[1]);
    expect(rb.byKey.size).toBe(2);
    expect(rb.mismatch).toEqual({ entryCount: 2, domCount: 3 });
  });

  it("E-5: P3 — an empty heading with no id attribute resolves under tier 1", () => {
    const entries = makeEntries([
      [1, "Intro"],
      [1, ""],
      [1, "Outro"],
    ]);
    const { container, headings } = buildProseMirror([
      { level: 1, text: "Intro", id: "intro" },
      { level: 1, text: "" }, // P3: syncHeadingIdPlugin skips it — NO id at all.
      { level: 1, text: "Outro", id: "outro" },
    ]);
    // Wrong-reason guard: the fixture must not drift into an idealised shape.
    expect(headings[1].hasAttribute("id")).toBe(false);

    const { byKey } = resolveHeadingElements(entries, container);

    expect(byKey.get(entries[0].key)).toBe(headings[0]);
    expect(byKey.get(entries[1].key)).toBe(headings[1]);
    expect(byKey.get(entries[2].key)).toBe(headings[2]);
  });

  it("E-6: P3 — an empty heading under tier 2 does not steal another entry's element", () => {
    const entries = makeEntries([
      [1, ""],
      [1, ""],
      [1, "Tail"],
    ]);
    const { container, headings } = buildProseMirror(
      dom([
        [1, ""],
        [1, "Extra"],
        [1, ""],
        [1, "Tail"],
      ]),
    );

    const { byKey, byElement, mismatch } = resolveHeadingElements(entries, container);

    expect(byKey.get(entries[0].key)).toBe(headings[0]);
    expect(byKey.get(entries[1].key)).toBe(headings[2]);
    expect(byKey.get(entries[2].key)).toBe(headings[3]);
    expect(byElement.has(headings[1])).toBe(false);
    expect(mismatch).not.toBeNull();
  });

  it("E-7: GUARD — no .ProseMirror in the root resolves nothing", () => {
    const entries = makeEntries([
      [1, "A"],
      [1, "B"],
      [1, "C"],
    ]);
    const container = document.createElement("div");
    container.id = "milkdown-container";
    container.innerHTML = "<h1>A</h1><h1>B</h1><h1>C</h1>";
    expect(container.querySelectorAll("h1")).toHaveLength(3);

    const { byKey, byElement, mismatch } = resolveHeadingElements(entries, container);

    expect(byKey.size).toBe(0);
    expect(byElement.size).toBe(0);
    expect(mismatch).toEqual({ entryCount: 3, domCount: 0 });
  });

  it("E-8: GUARD — the modal <h3>, with .ProseMirror absent and with it present", () => {
    // (a) the remount window: .ProseMirror ABSENT, entry text identical to the modal
    // title so the deleted text scan would certainly have hit it.
    const containerA = document.createElement("div");
    containerA.id = "milkdown-container";
    containerA.innerHTML =
      '<div class="dialog-card"><h3 class="dialog-title">Insert Link</h3></div>';
    const modalA = containerA.querySelector("h3") as HTMLElement;
    const entriesA = makeEntries([[3, "Insert Link"]]);

    const ra = resolveHeadingElements(entriesA, containerA);
    expect(ra.byKey.size).toBe(0);
    expect(ra.byElement.has(modalA)).toBe(false);

    // (b) the steady state: the same modal, plus a sibling .ProseMirror.
    const b = buildProseMirror(dom([[1, "Doc"]]));
    const card = document.createElement("div");
    card.className = "dialog-card";
    card.innerHTML = '<h3 class="dialog-title">Insert Link</h3>';
    b.container.appendChild(card);
    const modalB = card.querySelector("h3") as HTMLElement;
    const entriesB = makeEntries([[1, "Doc"]]);

    const rb = resolveHeadingElements(entriesB, b.container);
    expect(rb.byKey.get(entriesB[0].key)).toBe(b.headings[0]);
    expect(rb.mismatch).toBeNull();
    expect(rb.byElement.has(modalB)).toBe(false);
  });

  it("E-9: GUARD — empty entries against a populated DOM still reports the mismatch", () => {
    const { container } = buildProseMirror(
      dom([
        [1, "A"],
        [1, "B"],
        [1, "C"],
      ]),
    );

    const { byKey, byElement, mismatch } = resolveHeadingElements([], container);

    expect(byKey.size).toBe(0);
    expect(byElement.size).toBe(0);
    expect(mismatch).toEqual({ entryCount: 0, domCount: 3 });
  });
});

describe("§3 resolveHeadingElements — laws", () => {
  it("E-L1: LAW injectivity over the 600-case perturbed corpus domain", () => {
    let identityRows = 0;
    const total = forEachPerturbedCase(({ where, entries, container, perturbation }) => {
      expectDistinctKeys(entries, where);
      const { byKey } = resolveHeadingElements(entries, container);

      expect(
        new Set(byKey.values()).size,
        `${where}: injective — no two keys may share an Element`,
      ).toBe(byKey.size);

      if (perturbation === "identity") {
        identityRows += 1;
        // H1 non-vacuity: without this row an empty-map resolver satisfies every law.
        expect(byKey.size, `${where}: H1 — tier 1 must resolve every entry`).toBe(
          entries.length,
        );
      }
    });

    expect(total).toBe(600);
    expect(identityRows).toBe(60);
  });

  it("E-L2: LAW round-trip — byElement is the exact inverse of byKey", () => {
    const total = forEachPerturbedCase(({ where, entries, container }) => {
      expectDistinctKeys(entries, where);
      const { byKey, byElement } = resolveHeadingElements(entries, container);

      expect(byElement.size, `${where}: sizes must agree`).toBe(byKey.size);
      for (const [key, element] of byKey) {
        expect(byElement.get(element), `${where}: byElement∘byKey === id`).toBe(key);
      }
      for (const [element, key] of byElement) {
        expect(byKey.get(key), `${where}: byKey∘byElement === id`).toBe(element);
      }
    });

    expect(total).toBe(600);
  });

  it("E-L3: LAW order preservation, including tier 2 with a drop and an insert", () => {
    const documents = generateCorpus().documents.slice(0, 60);
    const next = createLcg(DEFAULT_SEED);
    const edits = ["none", "delete-one", "insert-one"] as const;

    for (let d = 0; d < documents.length; d++) {
      for (const edit of edits) {
        const texts = documents[d].headings;
        const where = `${SEED_LABEL} doc=${d} edit=${edit}`;
        const entries = makeEntries(texts.map((t) => [1, t] as const));
        expectDistinctKeys(entries, where);

        const domSpecs: DomHeadingSpec[] = texts.map((t) => ({ level: 1, text: t }));
        if (edit === "delete-one") {
          domSpecs.splice(next() % domSpecs.length, 1);
        } else if (edit === "insert-one") {
          // The raw-HTML <h2> shape from D1's known-breakers list.
          domSpecs.splice(next() % (domSpecs.length + 1), 0, {
            level: 2,
            text: "RawHtmlHeading",
          });
        }

        const { container } = buildProseMirror(domSpecs);
        const domHeadings = collectHeadingElements(container);
        const { byKey } = resolveHeadingElements(entries, container);

        let previousIndex = -1;
        for (let i = 0; i < entries.length; i++) {
          const element = byKey.get(entries[i].key);
          if (!element) continue;
          const index = domHeadings.indexOf(element);
          expect(index, `${where}: resolved element must be a collected heading`).toBeGreaterThanOrEqual(
            0,
          );
          expect(
            index,
            `${where}: entry ${i} must resolve strictly after the previous resolved entry`,
          ).toBeGreaterThan(previousIndex);
          previousIndex = index;
        }
      }
    }
  });

  it("E-L4: LAW determinism / idempotence, and the DOM is never written", () => {
    const total = forEachPerturbedCase(({ where, entries, container }) => {
      expectDistinctKeys(entries, where);
      const before = container.innerHTML;

      const first = resolveHeadingElements(entries, container);
      const second = resolveHeadingElements(entries, container);

      expect(second.byKey.size, `${where}: sizes must agree across calls`).toBe(
        first.byKey.size,
      );
      for (const [key, element] of first.byKey) {
        expect(second.byKey.get(key), `${where}: identical Element reference`).toBe(
          element,
        );
      }
      expect(second.mismatch, `${where}: mismatch must be stable`).toEqual(
        first.mismatch,
      );
      expect(container.innerHTML, `${where}: D2 — nothing is written to the DOM`).toBe(
        before,
      );
    });

    expect(total).toBe(600);
  });

  it("E-L5: LAW DOM-id independence — one fixture, ten id assignments", () => {
    // Texts from the MEASURED table (§0.5); the last pair is the duplicate case.
    const texts: Array<readonly [Level, string]> = [
      [1, "Introduction"],
      [2, "Hello, World!"],
      [2, "Q&A"],
      [3, "foo_bar"],
      [2, "Intro"],
      [2, "Intro"],
    ];
    const anchorSlugs = [
      "introduction",
      "hello-world",
      "q-a",
      "foo-bar",
      "intro",
      "intro-1",
    ];
    const entries = texts.map(([level, text], i) =>
      makeEntry(level, text, anchorSlugs[i]),
    );
    expectDistinctKeys(entries, "E-L5");

    const fixture = buildProseMirror(
      texts.map(([level, text]) => ({ level, text })),
    );
    const six = fixture.headings;

    type Assignment = { name: string; apply: () => void };
    const assignments: Assignment[] = [
      {
        name: "1-absent",
        apply: () => {
          for (const el of six) {
            el.removeAttribute("id");
            el.removeAttribute("data-heading-id");
          }
        },
      },
      {
        name: "2-duplicated",
        apply: () => {
          for (const el of six) {
            el.removeAttribute("data-heading-id");
            el.id = "intro";
          }
        },
      },
      {
        name: "3-milkdown-shaped",
        apply: () => {
          // MEASURED for rows 1-5; the sixth repeats `intro` deliberately.
          const ids = ["introduction", "hello,-world!", "q&a", "foo_bar", "intro", "intro"];
          six.forEach((el, i) => {
            el.removeAttribute("data-heading-id");
            el.id = ids[i];
          });
        },
      },
      {
        name: "4-milkdown-deduped",
        apply: () => {
          // MEASURED: the real shape syncHeadingIdPlugin produces.
          const ids = [
            "introduction",
            "hello,-world!",
            "q&a",
            "foo_bar",
            "intro",
            "intro-#2",
          ];
          six.forEach((el, i) => {
            el.removeAttribute("data-heading-id");
            el.id = ids[i];
          });
        },
      },
      {
        name: "6-permuted-data-heading-id",
        apply: () => {
          // Deliberately contradicts the measured `data-heading-id === null`: an
          // always-null attribute cannot distinguish "not read" from "read and
          // useless". Each heading claims the NEXT entry's anchorSlug.
          six.forEach((el, i) => {
            el.removeAttribute("id");
            el.setAttribute("data-heading-id", anchorSlugs[(i + 1) % anchorSlugs.length]);
          });
        },
      },
    ];

    const runGroup = (groupName: string): void => {
      assignments[0].apply();
      const baseline = resolveHeadingElements(entries, fixture.container);
      // H1 non-vacuity, asserted for BOTH groups: E-L5 is ADR-0014's tripwire on
      // its own, so a resolver returning empty maps must not satisfy it vacuously.
      expect(baseline.byKey.size, `${groupName}: H1 — all six entries must resolve`).toBe(
        6,
      );

      for (let j = 1; j < assignments.length; j++) {
        assignments[j].apply();
        const run = resolveHeadingElements(entries, fixture.container);
        const where = `${groupName}/${assignments[j].name}`;
        expect(run.byKey.size, `${where}: size must match the baseline`).toBe(
          baseline.byKey.size,
        );
        expect(run.mismatch, `${where}: mismatch must match the baseline`).toEqual(
          baseline.mismatch,
        );
        for (const entry of entries) {
          expect(
            run.byKey.get(entry.key),
            `${where}: identical Element reference as the baseline`,
          ).toBe(baseline.byKey.get(entry.key));
        }
      }
    };

    runGroup("tier1 (6 vs 6)");

    // Tier-2 group: one unmatched interloper, inserted mid-document.
    const extra = document.createElement("h2");
    extra.textContent = "Extra";
    fixture.proseMirror.insertBefore(extra, six[2]);
    expect(collectHeadingElements(fixture.container)).toHaveLength(7);

    runGroup("tier2 (6 vs 7)");
  });
});

// ---------------------------------------------------------------------------
// §4 — pickActiveKey
// ---------------------------------------------------------------------------

describe("§4 pickActiveKey", () => {
  it("K-1: the first visible entry in document order wins, not callback order", () => {
    const entries = makeEntries([
      [1, "A"],
      [2, "B"],
      [2, "C"],
      [3, "D"],
    ]);
    const k = entries.map((e) => e.key);

    expect(pickActiveKey(entries, new Set([k[0]]))).toBe(k[0]);
    expect(pickActiveKey(entries, new Set([k[3]]))).toBe(k[3]);
    expect(pickActiveKey(entries, new Set([k[1], k[3]]))).toBe(k[1]);
    // Insertion order deliberately reversed: iterating the Set would return k[3].
    expect(pickActiveKey(entries, new Set([k[3], k[1]]))).toBe(k[1]);
  });

  it("K-2: GUARD — an empty visible set, and keys absent from entries", () => {
    const entries = makeEntries([
      [1, "A"],
      [2, "B"],
      [2, "C"],
    ]);
    const k = entries.map((e) => e.key);
    const stranger = mintKey();

    expect(pickActiveKey(entries, new Set())).toBeNull();
    expect(pickActiveKey(entries, new Set([stranger]))).toBeNull();
    expect(pickActiveKey(entries, new Set([stranger, k[2]]))).toBe(k[2]);
    expect(pickActiveKey([], new Set([k[0]]))).toBeNull();
  });

  it("K-3: boundary — only the last of six entries is visible", () => {
    const entries = makeEntries([
      [1, "A"],
      [2, "B"],
      [2, "C"],
      [3, "D"],
      [3, "E"],
      [4, "F"],
    ]);
    const k = entries.map((e) => e.key);

    expect(pickActiveKey(entries, new Set([k[5]]))).toBe(k[5]);
  });

  it("K-L1: LAW conservation + minimality + invariance over 920 generated subsets", () => {
    const documents = generateCorpus().documents.slice(0, 40);
    const next = createLcg(DEFAULT_SEED);
    const stranger = mintKey();
    let caseCount = 0;

    const indexOf = (entries: TOCEntry[], key: HeadingKey | null): number =>
      key === null ? Number.POSITIVE_INFINITY : entries.findIndex((e) => e.key === key);

    for (let d = 0; d < documents.length; d++) {
      const entries = makeEntries(
        documents[d].headings.map((t) => [1, t] as const),
      );
      expectDistinctKeys(entries, `${SEED_LABEL} doc=${d}`);
      const keys = entries.map((e) => e.key);

      const subsets: Array<Set<HeadingKey>> = [];
      for (let s = 0; s < 20; s++) {
        const subset = new Set<HeadingKey>();
        for (const key of keys) if (next() % 2 === 0) subset.add(key);
        subsets.push(subset);
      }
      subsets.push(new Set<HeadingKey>());
      subsets.push(new Set(keys));
      subsets.push(new Set([...keys, stranger]));

      for (let s = 0; s < subsets.length; s++) {
        const subset = subsets[s];
        const where = `${SEED_LABEL} doc=${d} subset=${s}`;
        const result = pickActiveKey(entries, subset);
        caseCount += 1;

        // (i) conservation of membership.
        expect(
          result === null || keys.includes(result),
          `${where}: result must be an entry key or null`,
        ).toBe(true);

        // (ii) minimality under document order.
        let expectedIndex = -1;
        for (let i = 0; i < keys.length; i++) {
          if (subset.has(keys[i])) {
            expectedIndex = i;
            break;
          }
        }
        if (expectedIndex === -1) {
          expect(result, `${where}: nothing visible`).toBeNull();
        } else {
          expect(result, `${where}: least visible index`).toBe(keys[expectedIndex]);
        }

        // (iii) invariance under a key that is not in entries.
        const withStranger = new Set(subset);
        withStranger.add(stranger);
        expect(
          pickActiveKey(entries, withStranger),
          `${where}: a stranger key must not change the answer`,
        ).toBe(result);

        // (iv) monotonicity: adding an entry key can only move the answer earlier.
        const absent = keys.filter((key) => !subset.has(key));
        if (absent.length > 0) {
          const chosen = absent[next() % absent.length];
          const widened = new Set(subset);
          widened.add(chosen);
          expect(
            indexOf(entries, pickActiveKey(entries, widened)),
            `${where}: adding a visible key must never move the answer later`,
          ).toBeLessThanOrEqual(indexOf(entries, result));
        }
      }
    }

    expect(caseCount).toBe(40 * 23);
  });
});
