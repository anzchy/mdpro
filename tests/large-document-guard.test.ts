/**
 * WI-1 unit matrix for `src/utils/largeDocumentGuard.ts#decideLargeDocumentGuard`.
 * Cases G1-G22 of `.claude/tdd-guardian/tests-20260919-190500.md`.
 *
 * Mock boundary: NONE. Real implementation, real `TextEncoder`.
 *
 * Scope Lock (ADR-0006:107-113, :201-203): `500 * 1024`, the `<=` direction, and
 * "bytes, with on-disk `fileSize` taking precedence" are FROZEN pending D6.1's
 * WKWebView sweep. Every case below pins current behaviour. Two cases are
 * explicitly labelled CHARACTERIZATION — recorded, not endorsed; do not "fix"
 * them.
 *
 * Global rules obeyed throughout, because the matrix's mutation-killing power
 * depends on them:
 *  - every expectation is `toEqual` on the WHOLE decision object;
 *  - every degrade expectation writes `message` as the full string literal,
 *    never the imported constant (that would be a tautology);
 *  - every degrade expectation pins `bytes` to an exact integer;
 *  - loop cases (G2, G6, G16) collect the returned value UNWRAPPED and assert
 *    after the loop; row labels live in a parallel array. A spread would
 *    snapshot the object and re-hide the aliased-singleton bug G22 hunts.
 *  - U+00E9 is written as the escape "\u00e9" so an NFC/NFD pass over this file
 *    cannot silently turn a 2-byte character into 3 and move G12b's boundary.
 *    U+4E2D and U+1F600 have no decomposition, so they are safe as literals.
 */

import { describe, expect, it } from "vitest";
import type { ViewMode } from "../src/types/editor";
import {
  decideLargeDocumentGuard,
  LARGE_DOCUMENT_DOWNGRADE_MESSAGE,
  LARGE_DOCUMENT_THRESHOLD_BYTES,
  type LargeDocumentGuardDecision,
  type LargeDocumentGuardInput,
} from "../src/utils/largeDocumentGuard";

// --- G2b -------------------------------------------------------------------
// LAW 1's exhaustiveness enforced at compile time, not assumed. This contributes
// no runtime test: the "assertion" is that `pnpm typecheck:tests` exits 0. The
// day a third ViewMode member is added, this fails TS2322 and forces whoever
// added it to visit the test matrix instead of silently shrinking G2's
// quantifier to "the modes someone typed in 2026".
//
// `export` is mandatory, not stylistic: tsconfig.json:19 sets noUnusedLocals and
// tsconfig.test.json extends it, so a module-scope `const _viewModeExhaustive`
// would fail TS6133 today — the wrong diagnostic on the wrong day. TypeScript's
// leading-underscore exemption covers parameters and destructured elements, NOT
// module-scope locals. `export` is exempt from noUnusedLocals; `void x;` would
// have been the equivalent alternative.
const ALL_VIEW_MODES = ["wysiwyg", "source"] as const;
type _ViewModeExhaustive =
  Exclude<ViewMode, (typeof ALL_VIEW_MODES)[number]> extends never ? true : never;
export const _viewModeExhaustive: _ViewModeExhaustive = true;

// --- Shared fixtures -------------------------------------------------------
// Threshold arithmetic: LARGE_DOCUMENT_THRESHOLD_BYTES = 512_000.
// "x"        = 1 UTF-8 byte
// "\u00e9"   = 2 UTF-8 bytes, 1 UTF-16 unit  (precomposed \u00e9)
// "中"        = 3 UTF-8 bytes, 1 UTF-16 unit
// "\u{1F600}" = 4 UTF-8 bytes, 2 UTF-16 units
const ASCII_511_999 = "x".repeat(511_999);
const ASCII_512_001 = "x".repeat(512_001);
const ASCII_600K = "x".repeat(600 * 1024);
const ASCII_2M = "x".repeat(2_000_000);
const CJK_511_998 = "中".repeat(170_666);
const CJK_512_001 = "中".repeat(170_667);
const ACCENT_512_000 = "\u00e9".repeat(256_000);
const ACCENT_512_002 = "\u00e9".repeat(256_001);
const EMOJI_512_000 = "\u{1F600}".repeat(128_000);
const EMOJI_512_004 = "\u{1F600}".repeat(128_001);

const ALLOW: LargeDocumentGuardDecision = { action: "allow" };

describe("decideLargeDocumentGuard", () => {
  // --- G1 ------------------------------------------------------------------
  it("G1: source mode is inert even at an absurd size", () => {
    const result = decideLargeDocumentGuard({
      viewMode: "source",
      fileSize: 10_000_000,
      content: "",
    });
    expect(result).toEqual({ action: "allow" });
  });

  // --- G2 ------------------------------------------------------------------
  it("G2: LAW 1 — every non-wysiwyg mode allows over the whole byte table", () => {
    const NON_WYSIWYG_MODES = ALL_VIEW_MODES.filter((m) => m !== "wysiwyg");
    const BYTE_TABLE = [
      0,
      1,
      511_999,
      512_000,
      512_001,
      512_002,
      1_000_000,
      Number.MAX_SAFE_INTEGER,
      -1,
      NaN,
    ];
    const ROWS: Array<{ fileSize: number | null; content: string; label: string }> = [
      ...BYTE_TABLE.map((n) => ({
        fileSize: n as number | null,
        content: "",
        label: `fileSize=${n}`,
      })),
      {
        fileSize: null,
        content: ASCII_512_001,
        label: "fileSize=null, content=512001 ASCII bytes",
      },
    ];

    // Push UNWRAPPED — no spread, no clone. Labels go in a parallel array.
    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const mode of NON_WYSIWYG_MODES) {
      for (const row of ROWS) {
        results.push(
          decideLargeDocumentGuard({
            viewMode: mode,
            fileSize: row.fileSize,
            content: row.content,
          }),
        );
        labels.push(`mode=${mode}, ${row.label}`);
      }
    }

    expect(results).toHaveLength(NON_WYSIWYG_MODES.length * ROWS.length);
    results.forEach((result, i) => {
      expect(result, labels[i]).toEqual({ action: "allow" });
    });
  });

  // G3 is DELIBERATELY ABSENT. Under the authoritative non-nullable input shape,
  // "inert when no document is open" leaves this unit entirely and survives only
  // as `if (!activeDocument) return;` in the caller, pinned by WI-2's case C5 (a
  // source-text case, below Level 6). The trade is recorded here so the lost
  // Level 1 coverage is visible rather than discovered.

  // --- G4 ------------------------------------------------------------------
  it("G4: boundary — exactly at the threshold allows (<=, not <)", () => {
    const result = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 512_000,
      content: "",
    });
    expect(result).toEqual({ action: "allow" });
  });

  // --- G5 ------------------------------------------------------------------
  it("G5: boundary — one byte over degrades, and reports which byte count it saw", () => {
    const result = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 512_001,
      content: "",
    });
    expect(result).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 512_001,
    });
  });

  // --- G6 ------------------------------------------------------------------
  const BYTE_LADDER = [
    0,
    1,
    511_999,
    512_000,
    512_001,
    512_002,
    1_000_000,
    Number.MAX_SAFE_INTEGER,
  ];

  it("G6: LAW 2 — monotonic and pointwise-correct over the ascending byte ladder", () => {
    // Collected UNWRAPPED and asserted AFTER the loop, both deliberately: an
    // implementation returning a hoisted, per-call-mutated DEGRADE object passes
    // an in-loop version and fails this one (see G22). A spread at push time
    // would restore exactly that hole.
    const results: LargeDocumentGuardDecision[] = [];
    const labels: string[] = [];
    for (const n of BYTE_LADDER) {
      results.push(
        decideLargeDocumentGuard({ viewMode: "wysiwyg", fileSize: n, content: "" }),
      );
      labels.push(`fileSize=${n}`);
    }

    expect(results).toHaveLength(8);

    results.forEach((result, i) => {
      const n = BYTE_LADDER[i];
      if (n > 512_000) {
        expect(result, labels[i]).toEqual({
          action: "degrade-to-source",
          message: "Document exceeds 500KB. Switched to Source mode for performance.",
          bytes: n,
        });
      } else {
        expect(result, labels[i]).toEqual({ action: "allow" });
      }
    });

    // Monotonicity: the boolean sequence never returns to false after a true.
    const degraded = results.map((r) => r.action === "degrade-to-source");
    const firstTrue = degraded.indexOf(true);
    if (firstTrue !== -1) {
      expect(degraded.slice(firstTrue), "no allow after the first degrade").toEqual(
        degraded.slice(firstTrue).map(() => true),
      );
    }
  });

  // --- G7 ------------------------------------------------------------------
  it("G7: LAW 3 — the same ladder descending yields identical results (no hidden state)", () => {
    const ascendingResults = BYTE_LADDER.map((n) =>
      decideLargeDocumentGuard({ viewMode: "wysiwyg", fileSize: n, content: "" }),
    );
    const descendingResults = [...BYTE_LADDER]
      .reverse()
      .map((n) =>
        decideLargeDocumentGuard({ viewMode: "wysiwyg", fileSize: n, content: "" }),
      );

    expect(descendingResults).toEqual([...ascendingResults].reverse());
  });

  // --- G8 ------------------------------------------------------------------
  it("G8: a negative fileSize allows", () => {
    const result = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: -1,
      content: "",
    });
    expect(result).toEqual({ action: "allow" });
  });

  // --- G9 ------------------------------------------------------------------
  it("CHARACTERIZATION — recorded, not endorsed: a NaN fileSize degrades, because NaN <= 512000 is false", () => {
    // Recorded, NOT endorsed. NaN <= 500 * 1024 is false, so NaN falls out of the
    // guard as "too big". fileSize originates as a Rust byte count and NaN may be
    // unreachable in production. Pinned so a future Number.isFinite() guard is a
    // conscious decision with a red test, not a silent behaviour flip. Whether it
    // SHOULD degrade belongs to D6.2.
    const result = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: NaN,
      content: "",
    });
    expect(result).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: NaN,
    });
  });

  // --- G10 -----------------------------------------------------------------
  it("G10: zero is a size, not a falsy — fileSize 0 allows despite 2MB of content", () => {
    // Kills `fileSize || encode(content).length`. That implementation satisfies
    // every other case in this file and fails only here.
    const result = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 0,
      content: ASCII_2M,
    });
    expect(result).toEqual({ action: "allow" });

    // Paired with the same content and a null fileSize, which MUST degrade —
    // the pair is what distinguishes `??` from a truthiness check.
    const measured = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: ASCII_2M,
    });
    expect(measured).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 2_000_000,
    });
  });

  // --- G11 -----------------------------------------------------------------
  it("G11: null size falls back to the content — ASCII boundary pair (1-byte UTF-8)", () => {
    const under = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: ASCII_511_999,
    });
    expect(under).toEqual({ action: "allow" });

    const over = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: ASCII_512_001,
    });
    expect(over).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 512_001,
    });
  });

  // --- G12 -----------------------------------------------------------------
  it("G12: null size counts UTF-8 bytes, not characters — 3-byte CJK pair", () => {
    // 170_666 chars = 511_998 bytes; 170_667 chars = 512_001 bytes. A
    // content.length implementation allows both and fails on (b).
    const under = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: CJK_511_998,
    });
    expect(under).toEqual({ action: "allow" });

    const over = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: CJK_512_001,
    });
    expect(over).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 512_001,
    });
  });

  // --- G12b ----------------------------------------------------------------
  it("G12b: null size counts the 2-byte UTF-8 range correctly — Latin-1 accent pair", () => {
    // Precomposed U+00E9 written as an escape on purpose: an NFD pass over this
    // file would make it 3 bytes and move the boundary. bytes: 512_002 is the
    // discriminating assertion — a counter charging 3 bytes for everything below
    // U+10000 reports 768_003 while agreeing on the action.
    const atBoundary = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: ACCENT_512_000,
    });
    expect(atBoundary).toEqual({ action: "allow" });

    const over = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: ACCENT_512_002,
    });
    expect(over).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 512_002,
    });
  });

  // --- G13 -----------------------------------------------------------------
  it("G13: null size counts UTF-8, not UTF-16 code units — 4-byte emoji pair", () => {
    const atBoundary = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: EMOJI_512_000,
    });
    expect(atBoundary).toEqual({ action: "allow" });

    const over = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: EMOJI_512_004,
    });
    expect(over).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 512_004,
    });
  });

  // --- G14 -----------------------------------------------------------------
  it("G14: empty content with a null size allows", () => {
    const result = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: null,
      content: "",
    });
    expect(result).toEqual({ action: "allow" });
  });

  // --- G15 -----------------------------------------------------------------
  it("CHARACTERIZATION — recorded, not endorsed: the stale on-disk fileSize wins over live content (opened at 400KB, edited to 600KB in memory, does not degrade) — D6.2 owns whether this is right", () => {
    // `fileSize` is the size the file had ON DISK when it was opened. A document
    // grown past the threshold in memory therefore escapes the guard entirely.
    // Whether that is correct is D6.2's question, not this work item's, and a
    // green run here is a record of today's behaviour — not an endorsement of it.
    const result = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 400 * 1024,
      content: ASCII_600K,
    });
    expect(result).toEqual({ action: "allow" });
  });

  // --- G16 -----------------------------------------------------------------
  it("G16: with a non-null fileSize the content is irrelevant", () => {
    const CONTENTS = ["", "x", ACCENT_512_002, CJK_512_001, EMOJI_512_004, ASCII_600K];
    const GROUPS: Array<{ fileSize: number; expected: LargeDocumentGuardDecision }> = [
      { fileSize: 0, expected: { action: "allow" } },
      { fileSize: 512_000, expected: { action: "allow" } },
      {
        fileSize: 512_001,
        expected: {
          action: "degrade-to-source",
          message: "Document exceeds 500KB. Switched to Source mode for performance.",
          bytes: 512_001,
        },
      },
    ];

    for (const group of GROUPS) {
      // Push UNWRAPPED — the group-equality assertion below is computed from the
      // collected objects, so a spread would snapshot each row out of existence.
      const results: LargeDocumentGuardDecision[] = [];
      const labels: string[] = [];
      for (const content of CONTENTS) {
        results.push(
          decideLargeDocumentGuard({
            viewMode: "wysiwyg",
            fileSize: group.fileSize,
            content,
          }),
        );
        labels.push(`fileSize=${group.fileSize}, content.length=${content.length}`);
      }

      expect(results).toHaveLength(CONTENTS.length);
      results.forEach((result, i) => {
        expect(result, labels[i]).toEqual(group.expected);
      });
      expect(
        new Set(results.map((r) => JSON.stringify(r))).size,
        `all rows identical for fileSize=${group.fileSize}`,
      ).toBe(1);
    }
  });

  // --- G17 -----------------------------------------------------------------
  it("G17: LAW 3 — purity: the argument is never mutated and repeat calls agree", () => {
    const ROWS: LargeDocumentGuardInput[] = [
      { viewMode: "source", fileSize: null, content: ASCII_512_001 },
      { viewMode: "source", fileSize: 512_001, content: "" },
      { viewMode: "wysiwyg", fileSize: 1, content: "x" },
      { viewMode: "wysiwyg", fileSize: 512_001, content: "" },
    ];

    for (const input of ROWS) {
      const snapshot = structuredClone(input);
      Object.freeze(input);

      // ES modules are strict mode, so a write to a frozen property throws a
      // TypeError rather than silently no-opping. This is a real assertion.
      expect(() => decideLargeDocumentGuard(input)).not.toThrow();

      const first = decideLargeDocumentGuard(input);
      const second = decideLargeDocumentGuard(input);

      expect(first).toEqual(second);
      expect(input).toEqual(snapshot);
      expect(input.content).toHaveLength(snapshot.content.length);
      expect(input.content).toBe(snapshot.content);
    }
  });

  // --- G18 -----------------------------------------------------------------
  it("G18: the content is not read when the decision does not need it", () => {
    // A getter on a plain object the test constructs is not a mock: it is a legal
    // inhabitant of LargeDocumentGuardInput returning the real value.
    const makeInput = (viewMode: ViewMode, fileSize: number | null) => {
      const state = { reads: 0 };
      const input: LargeDocumentGuardInput = {
        viewMode,
        fileSize,
        get content() {
          state.reads += 1;
          return ASCII_2M;
        },
      };
      return { input, state };
    };

    // (a) mode gate short-circuits before the content is touched.
    const a = makeInput("source", null);
    expect(decideLargeDocumentGuard(a.input)).toEqual({ action: "allow" });
    expect(a.state.reads, "source mode must not read content").toBe(0);

    // (b) the `??` short-circuits before the content is touched.
    const b = makeInput("wysiwyg", 0);
    expect(decideLargeDocumentGuard(b.input)).toEqual({ action: "allow" });
    expect(b.state.reads, "a present fileSize must not read content").toBe(0);

    // (c) positive control — with no fileSize the content IS read and measured.
    const c = makeInput("wysiwyg", null);
    expect(decideLargeDocumentGuard(c.input)).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 2_000_000,
    });
    expect(c.state.reads, "a null fileSize must read content").toBeGreaterThanOrEqual(1);
  });

  // --- G19 -----------------------------------------------------------------
  it("G19: the exported constant and the decision's message are the same string", () => {
    const EXPECTED_MESSAGE =
      "Document exceeds 500KB. Switched to Source mode for performance.";

    expect(LARGE_DOCUMENT_DOWNGRADE_MESSAGE).toBe(EXPECTED_MESSAGE);

    const decision = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 512_001,
      content: "",
    });
    expect(decision.action).toBe("degrade-to-source");
    if (decision.action !== "degrade-to-source") throw new Error("unreachable");
    expect(decision.message).toBe(EXPECTED_MESSAGE);
  });

  // --- G20 -----------------------------------------------------------------
  it("G20: the allow arm carries no payload — the union discriminates cleanly", () => {
    const allowResult = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 1,
      content: "",
    });
    const degradeResult = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 512_001,
      content: "",
    });

    // Object.keys, not Object.hasOwn — the latter is ES2022 and does not compile
    // under this tsconfig's lib (TS2550).
    expect(Object.keys(allowResult)).toEqual(["action"]);
    expect(Object.keys(degradeResult).sort()).toEqual(["action", "bytes", "message"]);
  });

  // --- G21 -----------------------------------------------------------------
  it("G21: the boundary re-stated against the exported threshold constant", () => {
    // The whole divergence catch lives in this one anchor: if the constant moves
    // without the behaviour, this is what goes red.
    expect(LARGE_DOCUMENT_THRESHOLD_BYTES).toBe(512_000);

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        fileSize: LARGE_DOCUMENT_THRESHOLD_BYTES,
        content: "",
      }),
    ).toEqual({ action: "allow" });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        fileSize: LARGE_DOCUMENT_THRESHOLD_BYTES - 1,
        content: "",
      }),
    ).toEqual({ action: "allow" });

    expect(
      decideLargeDocumentGuard({
        viewMode: "wysiwyg",
        fileSize: LARGE_DOCUMENT_THRESHOLD_BYTES + 1,
        content: "",
      }),
    ).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: LARGE_DOCUMENT_THRESHOLD_BYTES + 1,
    });
  });

  // --- G22 -----------------------------------------------------------------
  it("G22: LAW 3 — a returned degrade decision is not invalidated by the next call", () => {
    // The ordering IS the case. Asserting on `first` before the second call would
    // make this G5 again and would let a hoisted, per-call-mutated singleton pass.
    const first = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 512_001,
      content: "",
    });
    const second = decideLargeDocumentGuard({
      viewMode: "wysiwyg",
      fileSize: 1_000_000,
      content: "",
    });

    expect(first).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 512_001,
    });
    expect(second).toEqual({
      action: "degrade-to-source",
      message: "Document exceeds 500KB. Switched to Source mode for performance.",
      bytes: 1_000_000,
    });
    // Scope limit: this applies only to two DEGRADE decisions. A shared frozen
    // ALLOW singleton is a legitimate implementation choice and stays allowed —
    // which is why ALLOW above is declared once and reused by no assertion here.
    expect(first).not.toBe(second);
  });

  // Keeps the shared ALLOW fixture honest: it is a value, not an identity claim.
  it("G20 (shape, restated): the shared allow fixture equals a freshly produced allow", () => {
    expect(
      decideLargeDocumentGuard({ viewMode: "wysiwyg", fileSize: 1, content: "" }),
    ).toEqual(ALLOW);
  });
});
