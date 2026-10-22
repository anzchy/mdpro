// @vitest-environment node
/**
 * D19-WI-2 — the pure save-result resolver (`src/utils/saveResult.ts`).
 *
 * Law: a save never lowers the edit content and never leaves clean content it did
 * not write (D70: not even content an earlier, newer save had marked clean). Matrix: `.claude/tdd-guardian/tests-20260922-232521-d19.md` §3
 * (W2-applied-plain … W2-pure). Real implementation, no mocks.
 */
import { describe, expect, it } from "vitest";
import { resolveSaveResult, type SaveResultInput, type SaveResolution } from "../src/utils/saveResult";
import type { Document } from "../src/types/document";
import { collectionCases } from "./support/collectionCases";

const SAVED_AT = 1_758_000_000_000;

function makeDoc(overrides: Partial<Document> = {}): Document {
  return Object.freeze({
    id: "doc-a",
    path: "/a.md",
    content: "BASE",
    encoding: "utf-8",
    lineEnding: "lf",
    isModified: true,
    lastSaved: null,
    fileSize: null,
    ...overrides,
  });
}

function makeInput(overrides: Partial<SaveResultInput> = {}): SaveResultInput {
  return Object.freeze({
    current: makeDoc(),
    snapshotContent: "BASE",
    writtenContent: "BASE",
    path: "/a.md",
    savedAt: SAVED_AT,
    ...overrides,
  });
}

function nextOf(r: SaveResolution): Document {
  expect(r.kind, "expected a result with next").not.toBe("closed");
  if (r.kind === "closed") throw new Error("unreachable: asserted above");
  return r.next;
}

describe("resolveSaveResult — named cases", () => {
  it("W2-applied-plain: written === snapshot === current → applied, clean, lastSaved set", () => {
    const current = makeDoc({ content: "BASE", isModified: true, path: "/a.md", lastSaved: null });
    const r = resolveSaveResult(
      makeInput({ current, snapshotContent: "BASE", writtenContent: "BASE", path: "/a.md" }),
    );
    expect(r).toEqual({
      kind: "applied",
      // D214-WI-2: an applied save records the disk text as the baseline, so the
      // expected `next` gains savedContent "BASE" (the content this save wrote).
      next: { ...current, content: "BASE", isModified: false, lastSaved: SAVED_AT, savedContent: "BASE" },
    });
  });

  it("W2-applied-reformat: written !== snapshot, current === snapshot → applied with written content", () => {
    const current = makeDoc({ content: "T0", isModified: true });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "T0", writtenContent: "T0-FMT" }));
    expect(r.kind).toBe("applied");
    const next = nextOf(r);
    expect(next.content).toBe("T0-FMT");
    expect(next.isModified).toBe(false);
  });

  it.each([
    { label: "Save, same path", oldPath: "/a.md" as string | null, newPath: "/a.md" },
    { label: "Save As, null → /chosen.md", oldPath: null as string | null, newPath: "/chosen.md" },
  ])("W2-edited ($label): content kept, dirty passes through, path and lastSaved updated", ({ oldPath, newPath }) => {
    const current = makeDoc({ content: "BASE+NEW", isModified: true, path: oldPath });
    const r = resolveSaveResult(
      makeInput({ current, snapshotContent: "BASE", writtenContent: "BASE", path: newPath }),
    );
    expect(r).toEqual({
      kind: "edited-during-save",
      next: { ...current, path: newPath, lastSaved: SAVED_AT },
    });
  });

  it("W2-closed: current undefined → {kind:'closed'} with no next", () => {
    const r = resolveSaveResult(makeInput({ current: undefined }));
    expect(r).toEqual({ kind: "closed" });
    expect(Object.keys(r)).toEqual(["kind"]);
  });

  it.each([
    { current: "", snapshot: "", written: "", kind: "applied" },
    { current: "x", snapshot: "", written: "", kind: "edited-during-save" },
    { current: "a\n", snapshot: "a", written: "a", kind: "edited-during-save" },
    { current: "a\r\n", snapshot: "a\n", written: "a\n", kind: "edited-during-save" },
    { current: "é", snapshot: "é", written: "é", kind: "edited-during-save" },
  ])(
    "W2-strict-equality: current=$current snapshot=$snapshot → $kind",
    ({ current, snapshot, written, kind }) => {
      const doc = makeDoc({ content: current, isModified: true });
      const r = resolveSaveResult(makeInput({ current: doc, snapshotContent: snapshot, writtenContent: written }));
      expect(r.kind).toBe(kind);
      if (kind === "edited-during-save") {
        expect(nextOf(r).content).toBe(current);
      }
    },
  );

  it("W2-undo-to-snapshot: edited then undone back to the snapshot → applied, clean", () => {
    const current = makeDoc({ content: "BASE", isModified: true });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "BASE", writtenContent: "BASE" }));
    expect(r.kind).toBe("applied");
    expect(nextOf(r).isModified).toBe(false);
  });

  it("W2-store-equals-written: store === written but !== snapshot → edited, stays dirty (conservative)", () => {
    const current = makeDoc({ content: "T0-FMT", isModified: true });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "T0", writtenContent: "T0-FMT" }));
    expect(r.kind).toBe("edited-during-save");
    expect(nextOf(r).isModified).toBe(true);
  });

  it("W2-clean-but-unwritten (D70): clean store content the save did not write → edited, raised dirty", () => {
    // D70: a newer save already marked the buffer clean, then this older save landed
    // last. The disk holds "BASE", so "DISK-X" must not stay clean.
    const current = makeDoc({ content: "DISK-X", isModified: false });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "BASE", writtenContent: "BASE" }));
    expect(r.kind).toBe("edited-during-save");
    const next = nextOf(r);
    expect(next.content).toBe("DISK-X");
    expect(next.isModified).toBe(true);
    expect(next.lastSaved).toBe(SAVED_AT);
  });

  it("W2-clean-and-written (D70): clean store content equal to what was written stays clean", () => {
    const current = makeDoc({ content: "T0-FMT", isModified: false });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "T0", writtenContent: "T0-FMT" }));
    expect(r.kind).toBe("edited-during-save");
    expect(nextOf(r).isModified).toBe(false);
  });

  it("W2-frame-fields: non-content fields of current survive into next", () => {
    const current = makeDoc({
      content: "BASE",
      encoding: "GBK",
      lineEnding: "crlf",
      fileSize: 42,
      isModified: true,
    });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "BASE", writtenContent: "BASE" }));
    const next = nextOf(r);
    expect(next.encoding).toBe("GBK");
    expect(next.lineEnding).toBe("crlf");
    expect(next.fileSize).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// S5 domain: currentContent × isModified × written × path × one extra field.
// ---------------------------------------------------------------------------

const S = "SNAP";
const W_DIFF = "SNAP-FMT";
const OLD_PATH = "/a.md";
const NEW_PATH = "/chosen.md";

type CurrentShape = "absent" | "=S" | "=W≠S" | "other";

interface Row {
  label: string;
  input: SaveResultInput;
}

function buildDomain(): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const shapes: CurrentShape[] = ["absent", "=S", "=W≠S", "other"];
  for (const shape of shapes) {
    for (const isModified of [true, false]) {
      for (const writtenEqualsSnapshot of [true, false]) {
        for (const pathIsNew of [false, true]) {
          for (const encoding of ["utf-8", "GBK"]) {
            const written = writtenEqualsSnapshot ? S : W_DIFF;
            // "=W≠S" collapses into "=S" when W === S.
            if (shape === "=W≠S" && writtenEqualsSnapshot) continue;
            let current: Document | undefined;
            if (shape !== "absent") {
              const content = shape === "=S" ? S : shape === "=W≠S" ? W_DIFF : "OTHER";
              current = makeDoc({ content, isModified, encoding, path: OLD_PATH });
            }
            const path = pathIsNew ? NEW_PATH : OLD_PATH;
            // Absent rows do not depend on isModified or the extra field.
            const key =
              shape === "absent"
                ? `absent|${written}|${path}`
                : `${shape}|${isModified}|${written}|${path}|${encoding}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({
              label: key,
              input: makeInput({ current, snapshotContent: S, writtenContent: written, path }),
            });
          }
        }
      }
    }
  }
  return rows;
}

const DOMAIN = buildDomain();
const FRAME_KEYS: Array<keyof Document> = ["id", "encoding", "lineEnding", "fileSize"];

describe("resolveSaveResult — W2-law (exhaustive S5)", () => {
  it("the domain is the expected size (absent 4 + =S 16 + =W≠S 8 + other 16)", () => {
    expect(DOMAIN.length).toBe(44);
  });

  it.each(collectionCases("tests/save-result.test.ts:217", DOMAIN.map((r) => [r.label, r] as const)))("laws hold on %s", (_label, row) => {
    const { input } = row;
    const r = resolveSaveResult(input);
    const current = input.current;

    // (f) absent ⇔ closed, and closed has no next.
    if (current === undefined) {
      expect(r).toEqual({ kind: "closed" });
      expect(Object.keys(r)).toEqual(["kind"]);
      return;
    }
    expect(r.kind).not.toBe("closed");
    const next = nextOf(r);

    // (a) non-loss.
    if (current.content !== input.snapshotContent) {
      expect(next.content).toBe(current.content);
    }
    // (b′) a dirty → clean transition only happens when applied with the written content.
    if (current.isModified && !next.isModified) {
      expect(r.kind).toBe("applied");
      expect(next.content).toBe(input.writtenContent);
    }
    // (c) monotone dirty.
    if (current.isModified && r.kind !== "applied") {
      expect(next.isModified).toBe(true);
    }
    // (d) honest clean (D70): a clean next holds exactly what was written; dirty is
    // raised only when the store holds content this save did not write.
    if (!next.isModified) {
      expect(next.content).toBe(input.writtenContent);
    }
    if (!current.isModified && r.kind === "edited-during-save") {
      expect(next.isModified).toBe(current.content !== input.writtenContent);
    }
    // (e) frame.
    for (const key of FRAME_KEYS) {
      expect(next[key]).toBe(current[key]);
    }
    // path and lastSaved always record the save.
    expect(next.path).toBe(input.path);
    expect(next.lastSaved).toBe(input.savedAt);
  });

  it("non-vacuity: every kind is hit, (b′) antecedent is live, and current !== snapshot occurs", () => {
    const kinds = new Set<string>();
    let bPrimeLive = false;
    let contentDiffers = false;
    for (const { input } of DOMAIN) {
      const r = resolveSaveResult(input);
      kinds.add(r.kind);
      const current = input.current;
      if (current && r.kind !== "closed") {
        if (current.isModified && !r.next.isModified) bPrimeLive = true;
        if (current.content !== input.snapshotContent) contentDiffers = true;
      }
    }
    expect([...kinds].sort()).toEqual(["applied", "closed", "edited-during-save"]);
    expect(bPrimeLive).toBe(true);
    expect(contentDiffers).toBe(true);
  });
});

describe("resolveSaveResult — W2-idem (S5)", () => {
  const presentRows = DOMAIN.filter((r) => r.input.current !== undefined);

  it.each(collectionCases("tests/save-result.test.ts:283", presentRows.map((r) => [r.label, r] as const)))(
    "resolving next again gives the same next on %s",
    (_label, row) => {
      const r1 = resolveSaveResult(row.input);
      const n1 = nextOf(r1);
      const r2 = resolveSaveResult({ ...row.input, current: Object.freeze({ ...n1 }) });
      expect(nextOf(r2)).toEqual(n1);
    },
  );

  it("reformat row: second pass takes the edited branch and keeps the document clean with formatted content", () => {
    const current = makeDoc({ content: S, isModified: true });
    const input = makeInput({ current, snapshotContent: S, writtenContent: W_DIFF });
    const r1 = resolveSaveResult(input);
    expect(r1.kind).toBe("applied");
    const r2 = resolveSaveResult({ ...input, current: nextOf(r1) });
    expect(r2.kind).toBe("edited-during-save");
    expect(nextOf(r2)).toEqual(nextOf(r1));
    expect(nextOf(r2).content).toBe(W_DIFF);
    expect(nextOf(r2).isModified).toBe(false);
  });
});

describe("resolveSaveResult — W2-pure", () => {
  const fixtures: Array<[string, SaveResultInput]> = [
    ["applied", makeInput({ current: makeDoc({ content: "BASE" }) })],
    ["edited-during-save", makeInput({ current: makeDoc({ content: "BASE+NEW" }) })],
    ["closed", makeInput({ current: undefined })],
  ];

  it.each(fixtures)("%s: frozen input, resolved twice → deep-equal, no throw, fresh next", (kind, input) => {
    let r1: SaveResolution | undefined;
    let r2: SaveResolution | undefined;
    expect(() => {
      r1 = resolveSaveResult(input);
      r2 = resolveSaveResult(input);
    }).not.toThrow();
    expect(r1).toEqual(r2);
    expect(r1?.kind).toBe(kind);
    if (r1 && r1.kind !== "closed") {
      expect(r1.next).not.toBe(input.current);
    }
  });
});

// ---------------------------------------------------------------------------
// D214-WI-2 — the saved-content baseline a save records.
// Law: `next.savedContent ∈ {undefined, writtenContent}`; applied → writtenContent;
// edited → writtenContent, except a document with no baseline that stays dirty keeps
// none (sticky); a clean `next` has `savedContent === content`; idempotent.
// ---------------------------------------------------------------------------

const BASELINES = ["none", "OLD", "=content"] as const;

function buildBaselineDomain(): Row[] {
  const rows: Row[] = [];
  for (const written of [S, W_DIFF]) {
    for (const path of [OLD_PATH, NEW_PATH]) {
      rows.push({
        label: `absent|${written}|${path}`,
        input: makeInput({ current: undefined, snapshotContent: S, writtenContent: written, path }),
      });
    }
    const shapes: CurrentShape[] = written === S ? ["=S", "other"] : ["=S", "=W≠S", "other"];
    for (const shape of shapes) {
      const content = shape === "=S" ? S : shape === "=W≠S" ? W_DIFF : "OTHER";
      for (const isModified of [true, false]) {
        for (const baseline of BASELINES) {
          const savedContent = baseline === "none" ? undefined : baseline === "OLD" ? "OLD" : content;
          const current = makeDoc({ content, isModified, savedContent });
          rows.push({
            label: `${shape}|${isModified}|${written}|baseline=${baseline}`,
            input: makeInput({ current, snapshotContent: S, writtenContent: written }),
          });
        }
      }
    }
  }
  return rows;
}

const BASELINE_DOMAIN = buildBaselineDomain();

describe("D214 R1 — savedContent laws over the exhaustive baseline domain (S5)", () => {
  it("the domain has 34 rows (absent 4 + present 30)", () => {
    expect(BASELINE_DOMAIN.length).toBe(34);
  });

  it.each(collectionCases("tests/save-result.test.ts:371", BASELINE_DOMAIN.map((r) => [r.label, r] as const)))("laws hold on %s", (_label, row) => {
    const { input } = row;
    const r = resolveSaveResult(input);
    const current = input.current;
    if (current === undefined) {
      expect(r).toEqual({ kind: "closed" });
      return;
    }
    const next = nextOf(r);
    expect([undefined, input.writtenContent]).toContain(next.savedContent);
    if (r.kind === "applied") expect(next.savedContent).toBe(input.writtenContent);
    if (r.kind === "edited-during-save") {
      if (current.savedContent !== undefined) expect(next.savedContent).toBe(input.writtenContent);
      else if (next.isModified) expect(next.savedContent).toBeUndefined();
    }
    if (!next.isModified) expect(next.savedContent).toBe(next.content);
    const again = nextOf(resolveSaveResult({ ...input, current: Object.freeze({ ...next }) }));
    expect(again).toEqual(next);
    expect(again.savedContent).toBe(next.savedContent);
  });

  it("non-vacuity: both kinds, a sticky edited row and a baseline-carrying edited row occur", () => {
    const seen = new Set<string>();
    for (const { input } of BASELINE_DOMAIN) {
      const r = resolveSaveResult(input);
      if (r.kind === "closed" || !input.current) continue;
      seen.add(r.kind);
      if (r.kind === "edited-during-save") {
        seen.add(r.next.savedContent === undefined ? "edited-sticky" : "edited-baseline");
      }
    }
    expect([...seen].sort()).toEqual(["applied", "edited-baseline", "edited-during-save", "edited-sticky"]);
  });
});

describe("D214 R2–R4 — named baseline cases", () => {
  it("R2 in-flight edit: the baseline becomes the written text, the live edit stays dirty", () => {
    const current = makeDoc({ content: "MID+NEW", isModified: true, savedContent: "OLD" });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "MID", writtenContent: "MID" }));
    expect(r.kind).toBe("edited-during-save");
    const next = nextOf(r);
    expect([next.content, next.isModified, next.savedContent]).toEqual(["MID+NEW", true, "MID"]);
  });

  it("R3 reformat on save: the baseline is the formatted text", () => {
    const current = makeDoc({ content: "T0", isModified: true, savedContent: "OLD" });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "T0", writtenContent: "T0-FMT" }));
    expect(r.kind).toBe("applied");
    expect(nextOf(r).savedContent).toBe("T0-FMT");
  });

  it("R4 a document without a baseline stays without one through an in-flight edit", () => {
    const current = makeDoc({ content: "MID+NEW", isModified: true, savedContent: undefined });
    const r = resolveSaveResult(makeInput({ current, snapshotContent: "MID", writtenContent: "MID" }));
    expect(r.kind).toBe("edited-during-save");
    expect(nextOf(r).isModified).toBe(true);
    expect(nextOf(r).savedContent).toBeUndefined();
  });
});
