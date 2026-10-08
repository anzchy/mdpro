// @vitest-environment node
/**
 * Characterisation test of `scripts/control/commentBlanker.mjs#blankComments`
 * (WI-1, cases CB-01..CB-14 + CB-03b). No mocks; seeded generators only.
 *
 * Laws: (a) shape preservation, (b) idempotence, (c) a token-grammar oracle
 * that the test builds itself. (a) and (b) are also met by identity and by
 * blank-everything, so (c) is the law that does the specifying.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { blankComments } from "../scripts/control/commentBlanker.mjs";

type Lang = "js" | "rust" | "css";

// Seeded generator (mulberry32). No fast-check by design (plan Deferred).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, 0, xs.length - 1)];
const blankAll = (s: string) => s.replace(/[^\n]/g, " ");

// ---------------------------------------------------------------------------
// CB-01 / CB-02 — random syntax soup
// ---------------------------------------------------------------------------
const SOUP_BASE = ["/", "*", '"', "'", "`", "\\", "r", "b", "#", "\n", "\r", "a", "_", "x", " ", "{", "}", "(", ")", "u", "1", "é", "🙂"];
/** Weighted toward `/`, `*`, quotes and `\n` so unterminated constructs are frequent. */
const SOUP = [...SOUP_BASE, "/", "/", "/", "*", "*", "*", '"', '"', "'", "'", "`", "\n", "\n", "\n"];
const SOUP_SEEDS: Array<[Lang, number]> = [
  ["js", 2026100801],
  ["rust", 2026100802],
  ["css", 2026100803],
];
const SOUP_ITERS = 400;

function soup(seed: number): string[] {
  const r = mulberry32(seed);
  return Array.from({ length: SOUP_ITERS }, () => {
    const len = int(r, 0, 200);
    let s = "";
    while (s.length < len) s += pick(r, SOUP);
    return s;
  });
}
/** UTF-16 indices of every `\n`. */
const newlineIndices = (s: string) => Array.from({ length: s.length }, (_c, i) => i).filter((i) => s[i] === "\n");

describe("blankComments — shape law (CB-01) and idempotence (CB-02)", () => {
  it.each(SOUP_SEEDS)("CB-01 %s seed %i: same length, same \\n indices, each char kept or spaced", (lang, seed) => {
    soup(seed).forEach((text, iter) => {
      const out = blankComments(text, lang);
      expect(out.length, `seed ${seed} iter ${iter}`).toBe(text.length);
      const bad = Array.from({ length: text.length }, (_c, i) => i).find(
        (i) => !(out[i] === text[i] || (out[i] === " " && text[i] !== "\n")),
      );
      expect(bad, `seed ${seed} iter ${iter} i ${bad} in ${JSON.stringify(text)}`).toBeUndefined();
      expect(newlineIndices(out), `seed ${seed} iter ${iter}`).toEqual(newlineIndices(text));
    });
  });

  it.each(SOUP_SEEDS)("CB-02 %s seed %i: blank(blank(x)) === blank(x)", (lang, seed) => {
    soup(seed).forEach((text, iter) => {
      const once = blankComments(text, lang);
      expect(blankComments(once, lang), `seed ${seed} iter ${iter} in ${JSON.stringify(text)}`).toBe(once);
    });
  });
});

// ---------------------------------------------------------------------------
// CB-03 / CB-03b — token-grammar oracle
// ---------------------------------------------------------------------------
type Tok = { text: string; comment: boolean; line?: boolean };
const code = (text: string): Tok => ({ text, comment: false });
const block = (text: string): Tok => ({ text, comment: true });
/** A line comment: always followed by `\n` (or the end of the text). */
const lineC = (text: string): Tok => ({ text, comment: true, line: true });

const IDENTS = ["foo", "x1", "_y", "bar2"].map(code);
const DQ_STRING = code('"a // b"');
const JS_POOL: Tok[] = [
  ...IDENTS,
  DQ_STRING,
  code("'c /* d'"),
  code("`t1 // x\n/* y */ t2`"),
  lineC("// line"),
  block("/* blk \n */"),
  block("/* a /* b */"),
];
const RUST_POOL: Tok[] = [
  ...IDENTS,
  DQ_STRING,
  code('"multi\n// line"'),
  code('r"// r"'),
  code('r#"a "// b" c"#'),
  code('br##"/* x */"##'),
  code("'\"'"),
  code("'\\''"),
  code("'\\u{1F600}'"),
  code("'a"),
  lineC("// line"),
  block("/* o /* i */ o */"),
];
const CSS_POOL: Tok[] = [
  code("a{color:red}"),
  code("url(http://x//y)"),
  code('"s // t"'),
  code("'u /* v'"),
  block("/* c */"),
  code("//not-a-comment"),
];
/** CB-03b: quote-bearing comments and a block opener inside a line comment. */
const QUOTED_COMMENTS: Tok[] = [lineC("// a /* b"), lineC("// it's \"q"), block("/* \"q' */")];
const QUOTED_WEIGHT = 3;
const ORACLE_ITERS = 300;

function sequences(seed: number, pool: Tok[]): Tok[][] {
  const r = mulberry32(seed);
  return Array.from({ length: ORACLE_ITERS }, () => Array.from({ length: int(r, 0, 15) }, () => pick(r, pool)));
}

/** Joins tokens with a separator; returns the source and the oracle's expected output. */
function render(seq: Tok[], r: Rng): { src: string; expected: string } {
  let src = "";
  let expected = "";
  seq.forEach((t, k) => {
    if (k > 0) {
      const sep = seq[k - 1].line ? "\n" : pick(r, [" ", "\n"]);
      src += sep;
      expected += sep;
    }
    src += t.text;
    expected += t.comment ? blankAll(t.text) : t.text;
  });
  return { src, expected };
}

function checkOracle(lang: Lang, seed: number, pool: Tok[]) {
  const sepRng = mulberry32(seed ^ 0x5eed);
  sequences(seed, pool).forEach((seq, iter) => {
    const { src, expected } = render(seq, sepRng);
    expect(blankComments(src, lang), `seed ${seed} iter ${iter} in ${JSON.stringify(src)}`).toBe(expected);
  });
}

describe("blankComments — token-grammar oracle (CB-03, CB-03b)", () => {
  it.each<[Lang, number, Tok[]]>([
    ["js", 2026100804, JS_POOL],
    ["rust", 2026100805, RUST_POOL],
    ["css", 2026100806, CSS_POOL],
  ])("CB-03 %s seed %i: comments blanked, every other token verbatim", (lang, seed, pool) => {
    checkOracle(lang, seed, pool);
  });

  it.each<[Lang, number, Tok[]]>([
    ["js", 2026100807, JS_POOL],
    ["rust", 2026100808, RUST_POOL],
  ])("CB-03b %s seed %i: quotes and openers inside comments open nothing", (lang, seed, base) => {
    const pool = [...base, ...QUOTED_COMMENTS.flatMap((t) => Array<Tok>(QUOTED_WEIGHT).fill(t))];
    for (const t of QUOTED_COMMENTS) {
      const hits = sequences(seed, pool).filter((seq) => seq.includes(t)).length;
      expect(hits, `${JSON.stringify(t.text)} appears in too few sequences`).toBeGreaterThanOrEqual(50);
    }
    checkOracle(lang, seed, pool);
  });
});

// ---------------------------------------------------------------------------
// CB-04..CB-14 — examples and boundaries
// ---------------------------------------------------------------------------
describe("blankComments — examples and boundaries", () => {
  it("CB-04 Rust block comments nest", () => {
    expect(blankComments("/* a /* b */ c */ x", "rust")).toBe(" ".repeat(17) + " x");
  });

  it.each<Lang>(["js", "css"])("CB-05 %s block comments do not nest", (lang) => {
    expect(blankComments("/* a /* b */ c */ x", lang)).toBe(" ".repeat(12) + " c */ x");
  });

  it("CB-06 Rust raw strings survive, including a quote inside a hashed raw string", () => {
    const head = 'let a = r#"a "// b" c"#; let b = br#"/* x */"#; let c = r"// y"; ';
    expect(blankComments(head + "// z", "rust")).toBe(head + "    ");
  });

  it("CB-07 a raw-string opener preceded by a word char is a normal string", () => {
    const src = 'fr"a\\" // b"';
    expect(blankComments(src, "rust")).toBe(src);
  });

  it("CB-08 a lifetime tick and a '\"' char literal open no string", () => {
    const src = "fn f<'a>() {} // note\nlet c = '\"'; // two";
    expect(blankComments(src, "rust")).toBe("fn f<'a>() {} " + " ".repeat(7) + "\nlet c = '\"'; " + " ".repeat(6));
  });

  it("CB-09 CSS has no line comments", () => {
    const head = "a { background: url(http://x/y); } ";
    expect(blankComments(head + "/* c */", "css")).toBe(head + " ".repeat(7));
  });

  it("CB-10 a JS template spans lines; a JS double-quoted string stops at a newline", () => {
    const head = "const t = `l1 // no\n/* no */ l2`; ";
    expect(blankComments(head + "// c", "js")).toBe(head + "    ");
    expect(blankComments('x = "abc\n// c', "js")).toBe('x = "abc\n    ');
  });

  it("CB-11 the same text: Rust strings span lines, JS strings do not", () => {
    const src = '"a\n// kept in rust"';
    expect(blankComments(src, "rust")).toBe(src);
    expect(blankComments(src, "js")).toBe('"a\n' + " ".repeat(16));
  });

  it.each<Lang>(["js", "rust"])("CB-12 %s: an escaped backslash ends the string", (lang) => {
    expect(blankComments('"a\\\\" // c', lang)).toBe('"a\\\\"     ');
  });

  it.each<[string, Lang, string]>([
    ["", "js", ""],
    ["", "rust", ""],
    ["", "css", ""],
    ["/* open\nabc", "rust", "       \n   "],
    ['r#"open // x', "rust", 'r#"open // x'],
    ["// eof", "js", "      "],
    ["/* only */", "css", " ".repeat(10)],
  ])("CB-13 %j (%s) → %j", (src, lang, expected) => {
    expect(blankComments(src, lang)).toBe(expected);
  });

  it("CB-14 CRLF: the \\r inside a line comment is blanked, the \\n kept", () => {
    expect(blankComments("a // c\r\nb", "js")).toBe("a " + " ".repeat(5) + "\nb");
  });
});
