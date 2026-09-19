/**
 * WI-3.1 — the heading identity model: `slugBase` + `createAnchorSlugAllocator`
 * (`src/utils/headingIdentity.ts`) and the three identity concepts
 * (`src/types/toc.ts`).
 *
 * Case ids in the titles map to the WI-3.1 test matrix
 * (`.claude/tdd-guardian/tests-20260918-084449.md`): A1-A5 for `slugBase`,
 * B1-B12 for the allocator, C1-C2 for the types.
 *
 * NOTE on C1: `pnpm exec tsc --noEmit` reads `tsconfig.json`, whose `include` is
 * `["src"]`, so it never sees this file. The `@ts-expect-error` assertions below are
 * enforced only by `pnpm typecheck:tests` (`tsc -p tsconfig.test.json`), which is
 * therefore mandatory in this work item's verification list.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { createAnchorSlugAllocator, slugBase } from "../src/utils/headingIdentity";
import { asAnchorSlug, asHeadingKey } from "../src/types/toc";
import type {
  AnchorSlug,
  HeadingKey,
  HeadingPosition,
  ParsedTOCEntry,
  TOCEntry,
} from "../src/types/toc";
import { useTOCStore } from "../src/stores/tocStore";
import {
  CORPUS_ALPHABET,
  DEFAULT_SEED,
  SHAPE_RE,
  createLcg,
  generateCorpus,
  shapeDomain,
} from "./helpers/headingCorpus";

/** Render a string as escaped code points so a failure message is readable in a terminal. */
function cp(value: string): string {
  return [...value].map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase()).join(" ");
}

/** A deterministic `n`-token sequence drawn from the corpus alphabet. */
function tokenSequence(n: number, seed: number = DEFAULT_SEED): string[] {
  const next = createLcg(seed);
  return Array.from({ length: n }, () => CORPUS_ALPHABET[next() % CORPUS_ALPHABET.length]);
}

describe("slugBase (WI-3.1 cases A1-A5)", () => {
  it.each([
    ["A1 ASCII words", "Hello World", "hello-world"],
    ["A1 CJK preserved", "架构设计", "架构设计"],
    ["A1 CJK + digit + punctuation", "第1章: 架构", "第1章-架构"],
    ["A1 separators trimmed", "---title---", "title"],
    ["A1 surrounding whitespace trimmed", "  Spaced  ", "spaced"],
    ["A1 run of punctuation collapses to one hyphen", "a...b", "a-b"],
    ["A1 very long CJK token", "架构".repeat(50), "架构".repeat(50)],
  ])("%s", (_label, input, expected) => {
    expect(slugBase(input)).toBe(expected);
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["separator only", "---"],
    ["punctuation only", "..."],
    ["single emoji", "🎉"],
    ["two emoji", "🎉🎊"],
    ["arrows only", "→←"],
  ])("A2 substitutes the literal \"heading\" when nothing survives normalization: %s", (_label, input) => {
    expect(slugBase(input)).toBe("heading");
    expect(slugBase(input)).not.toBe("");
    expect(slugBase(input).startsWith("-")).toBe(false);
  });

  it("A3 output shape holds over the generated domain (alphabet, pairs, Unicode hazards)", () => {
    for (const input of shapeDomain()) {
      const out = slugBase(input);
      expect(out.length, `empty slug for input ${cp(input)}`).toBeGreaterThan(0);
      expect(out, `shape violated for input ${cp(input)} -> ${cp(out)}`).toMatch(SHAPE_RE);
      // "İ" (U+0130) lowercases to "i" + U+0307 COMBINING DOT ABOVE, which is Mn and
      // therefore not \p{L}. An implementation that classifies BEFORE lowercasing
      // emits that mark; this is the assertion that pins step order.
      expect(
        [...out].some((c) => /\p{M}/u.test(c)),
        `combining mark (e.g. U+0307) survived for input ${cp(input)} -> ${cp(out)}`,
      ).toBe(false);
    }
  });

  it("A4 slugBase is idempotent over the same domain", () => {
    for (const input of shapeDomain()) {
      const once = slugBase(input);
      expect(
        slugBase(once),
        `not a fixed point: ${cp(input)} -> ${cp(once)} -> ${cp(slugBase(once))}`,
      ).toBe(once);
    }
  });

  it.each([
    ["Nl numeral", "Chapter Ⅷ", "chapter-ⅷ"],
    ["No numeral", "Item ①", "item-①"],
    ["No vulgar fraction", "Half ½", "half-½"],
  ])("A5 \\p{N} reaches beyond \\p{Nd}: %s", (_label, input, expected) => {
    expect(slugBase(input)).toBe(expected);
  });
});

describe("createAnchorSlugAllocator (WI-3.1 cases B1-B12)", () => {
  it("B1 suffix collision: x, x, x-1 -> x, x-1, x-1-1", () => {
    const alloc = createAnchorSlugAllocator();
    const out = ["x", "x", "x-1"].map((t) => alloc.allocate(t) as string);
    expect(out).toEqual(["x", "x-1", "x-1-1"]);
    expect([...alloc.taken].sort()).toEqual(["x", "x-1", "x-1-1"].sort());
  });

  it("B2 collision chain deepens correctly", () => {
    const alloc = createAnchorSlugAllocator();
    const out = ["x", "x", "x-1", "x-1"].map((t) => alloc.allocate(t) as string);
    expect(out).toEqual(["x", "x-1", "x-1-1", "x-1-2"]);
    expect(alloc.taken.size).toBe(4);
  });

  it.each([
    ["emoji then literal", ["🎉", "heading"]],
    ["two emoji", ["🎉", "🎊"]],
    ["literal then emoji", ["heading", "🎉"]],
  ])("B3 empty base is substituted BEFORE collision handling: %s", (_label, texts) => {
    const alloc = createAnchorSlugAllocator();
    const out = texts.map((t) => alloc.allocate(t) as string);
    expect(out).toEqual(["heading", "heading-1"]);
    for (const id of out) {
      expect(id).not.toBe("");
      expect(id.startsWith("-")).toBe(false);
    }
  });

  it("B4 seeded taken set is honoured", () => {
    const seeded = createAnchorSlugAllocator(["intro"]);
    expect(seeded.allocate("Intro") as string).toBe("intro-1");
    expect([...seeded.taken].sort()).toEqual(["intro", "intro-1"].sort());

    const doubleSeeded = createAnchorSlugAllocator(["intro", "intro-1"]);
    expect(doubleSeeded.allocate("Intro") as string).toBe("intro-2");
    expect([...doubleSeeded.taken].sort()).toEqual(["intro", "intro-1", "intro-2"].sort());

    const empty = createAnchorSlugAllocator([]);
    expect(empty.allocate("Intro") as string).toBe("intro");
    expect([...empty.taken]).toEqual(["intro"]);
  });

  it("B5 seed occupies the suffix but not the base", () => {
    const alloc = createAnchorSlugAllocator(["x-1"]);
    const out = ["x", "x"].map((t) => alloc.allocate(t) as string);
    expect(out).toEqual(["x", "x-2"]);
    expect([...alloc.taken].sort()).toEqual(["x-1", "x", "x-2"].sort());
  });

  it("B6 taken-set conservation after every allocation", () => {
    const alloc = createAnchorSlugAllocator(["seed-a"]);
    const texts = tokenSequence(30);
    const outputs: string[] = [];

    texts.forEach((text, k) => {
      const id = alloc.allocate(text) as string;
      outputs.push(id);
      expect(alloc.taken.size, `size after step ${k}`).toBe(2 + k);
      expect(alloc.taken.has(id), `taken missing ${id} after step ${k}`).toBe(true);
      expect(alloc.taken.has("seed-a"), `seed evicted at step ${k}`).toBe(true);
    });

    expect(new Set(outputs).size).toBe(outputs.length);
  });

  it("B7 determinism: two fresh allocators produce identical outputs", () => {
    const texts = tokenSequence(200);
    const p = createAnchorSlugAllocator();
    const outP = texts.map((t) => p.allocate(t) as string);

    const q = createAnchorSlugAllocator();
    const outQ = texts.map((t) => q.allocate(t) as string);

    // Third run interleaved after Q's construction: a module-scoped taken set or
    // hint map would show up here as drift.
    const p2 = createAnchorSlugAllocator();
    const outP2 = texts.map((t) => p2.allocate(t) as string);

    expect(outQ).toEqual(outP);
    expect(outP2).toEqual(outP);
    expect(p.taken).not.toBe(q.taken);
    expect([...p.taken].sort()).toEqual([...q.taken].sort());
  });

  it("B8 document uniqueness over Corpus G", () => {
    const corpus = generateCorpus();
    corpus.documents.forEach((doc, index) => {
      const alloc = createAnchorSlugAllocator();
      const slugs = doc.headings.map((t) => alloc.allocate(t) as string);
      const where = `seed=0x${corpus.seed.toString(16)} document=${index}`;

      const duplicates = slugs.filter((s, i) => slugs.indexOf(s) !== i);
      expect(duplicates, `duplicate slugs at ${where}: ${duplicates.join(", ")}`).toEqual([]);
      expect(new Set(slugs).size, where).toBe(slugs.length);

      slugs.forEach((slug, i) => {
        expect(slug, `empty slug at ${where} index=${i}`).not.toBe("");
        expect(slug, `shape violated at ${where} index=${i}`).toMatch(SHAPE_RE);
        const base = slugBase(doc.headings[i]);
        const isBare = slug === base;
        const isSuffixed = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`).test(slug);
        expect(
          isBare || isSuffixed,
          `slug "${slug}" is neither "${base}" nor "${base}-N" at ${where} index=${i}`,
        ).toBe(true);
      });
    });
  });

  // B9 — RESTATED, and the reason is recorded rather than quietly relaxed.
  //
  // The matrix states B9 as an unqualified law: "for every distinct base b, the first
  // heading whose slugBase is b receives exactly b". That law is FALSE for any
  // implementation satisfying the matrix's own case B1, and the two cannot both hold:
  // B1 requires ["x","x","x-1"] -> ["x","x-1","x-1-1"], where the third heading is the
  // FIRST occurrence of base "x-1" and must NOT receive the bare base, because the
  // second heading already took "x-1". Corpus G contains exactly that shape
  // (alphabet tokens "x-1" / "heading-1"), so the unqualified law fails at
  // seed=0x5eed document=0 index=25.
  //
  // B1 is the normative side: it is a plan acceptance criterion and an
  // ADDENDUM-measured expectation. So the missing precondition is restored here —
  // first occurrence of base b gets bare b *when b is not already taken*. Occupancy is
  // read off the ids actually returned, not recomputed, so the case still fails an
  // implementation that suffixes unconditionally ("base-1" on first occurrence),
  // which is the regression B9 exists to catch.
  it("B9 first-occurrence stability over Corpus G (for bases not already taken)", () => {
    const corpus = generateCorpus();
    corpus.documents.forEach((doc, index) => {
      const alloc = createAnchorSlugAllocator();
      const slugs = doc.headings.map((t) => alloc.allocate(t) as string);
      const takenSoFar = new Set<string>();
      let checked = 0;

      doc.headings.forEach((text, i) => {
        const base = slugBase(text);
        if (!takenSoFar.has(base)) {
          checked++;
          expect(
            slugs[i],
            `first occurrence of base "${base}" did not get the bare base ` +
              `(seed=0x${corpus.seed.toString(16)} document=${index} index=${i})`,
          ).toBe(base);
        }
        takenSoFar.add(slugs[i]);
      });

      // Guard against the precondition emptying the case out.
      expect(checked, `no first occurrence was checked in document ${index}`).toBeGreaterThan(0);
    });
  });

  // B10 — replaced per test-matrix ADDENDUM B. The matrix originally asked for an
  // input where the monotone `lastTriedN` hint disagrees with a naive
  // rescan-from-1. No such input exists: `hint[base] = k` is only set when `base-k`
  // was allocated, which required rejecting every n in [1, k-1] as taken; the taken
  // set is monotone non-decreasing (nothing is ever removed), so [1, k] stay taken
  // forever and resuming at k+1 cannot skip a free slot. A counterexample hunt would
  // therefore be a test that cannot fail. What CAN break the proof is the premise:
  // a future `release()` method, or a caller mutating the exposed `taken` set, would
  // make the hint silently skip free ids while every example case above stayed
  // green. That premise is what this case pins.
  it("B10 the hint's premise is guarded: the taken set is append-only and not externally mutable", () => {
    const alloc = createAnchorSlugAllocator(["x"]);

    for (const forbidden of ["release", "remove", "delete", "free", "unregister", "reset", "clear"]) {
      expect(
        (alloc as unknown as Record<string, unknown>)[forbidden],
        `allocator exposes "${forbidden}" — removal breaks the monotone-hint proof`,
      ).toBeUndefined();
    }
    expect(Object.keys(alloc).sort()).toEqual(["allocate", "taken"]);

    // Mutating what `taken` hands back must not reach the allocator's own state.
    const exposed = alloc.taken as Set<string>;
    exposed.add("x-1");
    exposed.delete("x");

    expect(alloc.taken.has("x")).toBe(true);
    expect(alloc.taken.has("x-1")).toBe(false);
    expect(alloc.allocate("X") as string).toBe("x-1");
  });

  it("B11 linearity guard at scale: 20 000 identical headings", () => {
    const alloc = createAnchorSlugAllocator();
    const started = Date.now();
    const out: string[] = [];
    for (let i = 0; i < 20_000; i++) out.push(alloc.allocate("Base") as string);
    const elapsed = Date.now() - started;

    expect(out.length).toBe(20_000);
    expect(out[0]).toBe("base");
    expect(out[19_999]).toBe("base-19999");
    expect(new Set(out).size).toBe(20_000);
    // Secondary guard, not a measurement: an O(n^2) rescan is ~200M iterations here
    // (tens of seconds); the linear implementation is ~20ms.
    expect(elapsed, `20 000 allocations took ${elapsed}ms`).toBeLessThan(5_000);
  });

  it("B12 empty and whitespace heading text through the allocator", () => {
    const alloc = createAnchorSlugAllocator();
    const out = ["", "   ", "heading"].map((t) => alloc.allocate(t) as string);
    expect(out).toEqual(["heading", "heading-1", "heading-2"]);
    expect(alloc.taken.size).toBe(3);
  });
});

describe("heading identity types (WI-3.1 cases C1-C2)", () => {
  it("C1 the three concepts are mutually non-assignable (enforced by pnpm typecheck:tests)", () => {
    const slug: AnchorSlug = asAnchorSlug("intro");
    const key: HeadingKey = asHeadingKey("h-7f3a");
    const position: HeadingPosition = { offsetUtf16: 42, line: 3 };

    // @ts-expect-error an AnchorSlug is not a HeadingKey
    const k: HeadingKey = slug;
    // @ts-expect-error a HeadingKey is not an AnchorSlug
    const s: AnchorSlug = key;
    // @ts-expect-error a bare string is not an AnchorSlug without the mint function
    const s2: AnchorSlug = "raw";
    // @ts-expect-error a bare string is not a HeadingKey without the mint function
    const k2: HeadingKey = "raw";
    // @ts-expect-error a position is not an identity
    const s3: AnchorSlug = position.offsetUtf16 as unknown as string;

    // Positive control, no directive: minting must still be possible, otherwise the
    // case above could pass vacuously via a brand nothing can satisfy.
    const s4: AnchorSlug = asAnchorSlug("ok");

    expect([k, s, s2, k2, s3].every((v) => typeof v === "string" || typeof v === "number")).toBe(true);
    expect(s4 as string).toBe("ok");
    expect(position.line).toBe(3);
  });

  it("C2 mint functions are identity at runtime over the corpus alphabet", () => {
    for (const token of CORPUS_ALPHABET) {
      expect(asAnchorSlug(token) as string).toBe(token);
      expect(asHeadingKey(token) as string).toBe(token);
    }
  });
});

/**
 * WI-3.5.1 cases T1-T3 (test matrix `.claude/tdd-guardian/tests-20260918-214500.md:42-76`).
 *
 * These are Level 1 **compiler-verdict** cases: the assertion is that
 * `pnpm typecheck:tests` exits 0 *with these `@ts-expect-error` directives present*.
 * Vitest does not typecheck (esbuild strips types), so a green vitest run says nothing
 * about T1-T3 — `pnpm typecheck:tests` is the gate. The runtime bodies exist only to
 * keep the locals used (`noUnusedLocals`) and to give the file a place to hold them.
 *
 * Deviation from the matrix, recorded deliberately: the matrix writes T3's call as
 * `setEntries([...], "doc-a")`. The second argument is WI-3.5.3's document scoping and
 * does not exist yet; writing it now would make the directive fire on arity rather than
 * on the forbidden `key`, and would make the positive control fail to compile. T3 is
 * therefore written against WI-3.5.1's one-argument signature; WI-3.5.3 adds the
 * document id to these call sites.
 */
describe("TOCEntry shape (WI-3.5.1 cases T1-T3)", () => {
  beforeEach(() => {
    useTOCStore.setState({
      entries: [],
      activeEntryId: null,
      collapsedIds: new Set<HeadingKey>(),
    });
  });

  it("T1 the brands hold across the new field shape and the key-typed store actions", () => {
    const rest = { level: 2 as const, text: "Intro", lineNumber: 1, offset: 0, children: [] as TOCEntry[] };

    // @ts-expect-error an AnchorSlug is not a HeadingKey — `key` must refuse a slug
    const e1: TOCEntry = { key: asAnchorSlug("intro"), anchorSlug: asAnchorSlug("intro"), ...rest };
    // @ts-expect-error a HeadingKey is not an AnchorSlug — `anchorSlug` must refuse a key
    const e2: TOCEntry = { key: asHeadingKey("k1"), anchorSlug: asHeadingKey("k1"), ...rest };

    const store = useTOCStore.getState();
    // @ts-expect-error collapse state is keyed by HeadingKey, never by AnchorSlug
    store.toggleCollapsed(asAnchorSlug("intro"));
    // @ts-expect-error the active entry is a HeadingKey, never an AnchorSlug
    store.setActiveEntry(asAnchorSlug("intro"));

    // Positive controls, no directive: the correct types must still be accepted,
    // otherwise the four directives above could pass against a type nothing satisfies.
    const ok: TOCEntry = { key: asHeadingKey("k1"), anchorSlug: asAnchorSlug("intro"), ...rest };
    store.toggleCollapsed(asHeadingKey("k1"));
    store.setActiveEntry(asHeadingKey("k1"));
    store.setActiveEntry(null);

    expect([e1, e2, ok].every((e) => e.text === "Intro")).toBe(true);
  });

  it("T2 TOCEntry has no `id` and no `isActive`, and exactly seven fields", () => {
    const entry: TOCEntry = {
      key: asHeadingKey("k1"),
      anchorSlug: asAnchorSlug("intro"),
      level: 2,
      text: "Intro",
      lineNumber: 1,
      offset: 0,
      children: [],
    };

    // @ts-expect-error `id` was split into `key` + `anchorSlug`; it must not come back
    const deadId = entry.id;
    // @ts-expect-error `isActive` was written at useTOC.ts:80 and read nowhere; it is gone
    const deadIsActive = entry.isActive;

    // Exhaustive: a *missing* field fails this literal, and so does an *added* one —
    // which a bare `@ts-expect-error` on a property read would not catch.
    const fields: Record<keyof TOCEntry, true> = {
      key: true,
      anchorSlug: true,
      level: true,
      text: true,
      lineNumber: true,
      offset: true,
      children: true,
    };

    expect(Object.keys(fields).sort()).toEqual(
      ["anchorSlug", "children", "key", "level", "lineNumber", "offset", "text"],
    );
    expect(deadId).toBeUndefined();
    expect(deadIsActive).toBeUndefined();
  });

  it("T3 setEntries takes ParsedTOCEntry and refuses a caller-supplied key", () => {
    const { setEntries } = useTOCStore.getState();

    setEntries([
      // @ts-expect-error only the store mints a HeadingKey; a parser-side caller may not
      { key: asHeadingKey("x"), anchorSlug: asAnchorSlug("intro"), level: 2, text: "Intro", lineNumber: 1, offset: 0 },
    ], "doc-a");

    // Positive control: the same literal without `key` (and without `children`) compiles
    // clean, so the directive above is about `key` and not about the literal as a whole.
    const parsed: ParsedTOCEntry[] = [
      { anchorSlug: asAnchorSlug("intro"), level: 2, text: "Intro", lineNumber: 1, offset: 0 },
    ];
    setEntries(parsed, "doc-a");

    expect(useTOCStore.getState().entries).toHaveLength(1);
  });
});

/**
 * WI-3.5.7 case D2 (test matrix `.claude/tdd-guardian/tests-20260918-214500.md:1073-1085`).
 *
 * D2 exists because WI-3.5.7 legitimately edits the *scope note* of
 * `src/types/toc.ts` a few lines above the coordination contract, and the standing
 * temptation at that moment is to reach four lines lower and edit the specification
 * to match whatever the implementation ended up doing. The digest makes that edit
 * loud. It pins a specification document, not a logic output, and no runner flag can
 * update it — so it is not a snapshot test in rule 10's prohibited sense.
 *
 * Deviation from the matrix, recorded deliberately: the matrix describes the region
 * as "the block between the two `---------` rules". Taken literally that is the one
 * banner *title* line between them, which covers none of the contract. The two rules
 * are a banner (rule / title / rule), not a pair of delimiters. The region pinned
 * here is therefore **the first rule through the last line before the closing `*​/`**
 * — i.e. the banner, the edit-kind table and the RESET prose. That is the block the
 * matrix's own "Refactor that would break this" describes. Both rules are located by
 * content, never by line number, so scope-note growth above them does not shift it.
 *
 * The digest was taken from the file **as amended by WI-3.5.2**, whose clause (c)
 * carve-out (the same-ordinal, same-level continuity policy) is part of the
 * specification the matcher was built against — not from an earlier checkout.
 */
describe("the headingKey coordination contract is a specification, not an output (WI-3.5.7 case D2)", () => {
  const TOC_TYPES = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/types/toc.ts",
  );
  const RULE_RE = /^\s*\*\s-{9,}\s*$/;
  const COMMENT_END_RE = /^\s*\*\/\s*$/;

  /** `{ scopeNote, contractBlock }` — everything above the banner, and the banner onward. */
  function splitHeader(source: string): { scopeNote: string; contractBlock: string } {
    const lines = source.split("\n");
    const rules = lines.reduce<number[]>((acc, line, i) => {
      if (RULE_RE.test(line)) acc.push(i);
      return acc;
    }, []);
    expect(rules, "src/types/toc.ts no longer has exactly two horizontal rules").toHaveLength(2);

    const end = lines.findIndex((line, i) => i > rules[1] && COMMENT_END_RE.test(line));
    expect(end, "no closing `*/` after the contract banner").toBeGreaterThan(rules[1]);

    return {
      scopeNote: lines.slice(0, rules[0]).join("\n"),
      contractBlock: lines.slice(rules[0], end).join("\n"),
    };
  }

  it("D2a the contract block's digest is unchanged", () => {
    // Recompute with:
    //   node -e 'const s=require("fs").readFileSync("src/types/toc.ts","utf-8").split("\n");
    //            const r=[];s.forEach((l,i)=>{if(/^\s*\*\s-{9,}\s*$/.test(l))r.push(i)});
    //            const e=s.findIndex((l,i)=>i>r[1]&&/^\s*\*\/\s*$/.test(l));
    //            console.log(require("crypto").createHash("sha256")
    //              .update(s.slice(r[0],e).join("\n"),"utf8").digest("hex"))'
    // Changing this constant is changing the specification. That is a deliberate act
    // requiring a contract revision, never a step on the way to making a test green.
    const RECORDED = "7979deece024f78ff3c31e122e3282e2015659d53893eef8242ae2d283003661";

    const { contractBlock } = splitHeader(fs.readFileSync(TOC_TYPES, "utf-8"));

    // Guards against a vacuous pass: an extraction that silently collapsed to the
    // banner title would still hash to *something*.
    expect(contractBlock.split("\n").length).toBeGreaterThan(25);
    expect(contractBlock).toContain("| Edit kind | headingKey | Collapse / active state |");
    expect(contractBlock).toContain("**Out of the agreed range — RESET, do not guess.**");
    expect(contractBlock).toContain("same-ordinal, same-level continuity policy");

    expect(
      createHash("sha256").update(contractBlock, "utf8").digest("hex"),
      "the headingKey coordination contract in src/types/toc.ts changed. If that was " +
        "intended, it is a contract revision: say so in the plan and in the commit " +
        "message, then update RECORDED. If it was not, revert it.",
    ).toBe(RECORDED);
  });

  it("D2b the scope note above the contract no longer describes the matcher as future work", () => {
    const { scopeNote } = splitHeader(fs.readFileSync(TOC_TYPES, "utf-8"));

    // Rule 22: the matcher landed in WI-3.5.2/3.5.3, so a scope note still promising
    // it as future work is a stale comment in a file this change set edits.
    expect(scopeNote, "scope note still promises the matcher as future work").not.toMatch(
      /gains\s+\*?\s*that\s+in\s+WI-3\.5/,
    );
    expect(scopeNote).toContain("src/utils/headingCoordination.ts");

    // Control: the WI-3.5.1 correction this note already carries must survive.
    expect(scopeNote).toContain("`TOCEntry`");
    expect(scopeNote).toContain("{@link ParsedTOCEntry}");
  });
});
