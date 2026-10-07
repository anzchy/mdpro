// @vitest-environment node
/**
 * ADR-0035 A3 — the discard snapshot (DS-1..DS-7).
 *
 * When the user confirms Discard for request R, the window records `{id → content}`
 * for the documents it discarded. A re-check for R answers dirty only if the flush
 * failed, or a modified doc is outside the snapshot, or a snapshotted doc's content
 * changed. A snapshot from another request is never applied.
 *
 * Law: for any document set D, snapshot S (taken for R), current request R′ and
 * flush result F:
 *  - dirty ⟺ F failed, or (R′ ≠ R and some doc is modified), or some modified doc's
 *    id is not in S, or some modified doc's id is in S with content ≠ S[id];
 *  - discardedUnchangedCount = #modified docs in S with identical content
 *    (0 when R′ ≠ R).
 *
 * Pure module: no mocks.
 */
import { describe, expect, it } from "vitest";
import { takeDiscardSnapshot, unsavedSinceDiscard } from "../src/utils/quitDiscardSnapshot";

interface Doc {
  id: string;
  content: string;
  isModified: boolean;
}

const assessmentFrom = (docs: readonly Doc[], flushFailed: boolean) => ({
  flushFailed,
  dirtyDocuments: docs.filter((d) => d.isModified).map((d) => ({ id: d.id })),
});

describe("A3 unsavedSinceDiscard", () => {
  it("DS-1 discard, then a re-check with no edits, is clean", () => {
    const docs: Doc[] = [{ id: "a", content: "A1", isModified: true }];
    const snap = takeDiscardSnapshot(5, docs, ["a"]);
    expect(
      unsavedSinceDiscard({ flushFailed: false, dirtyDocuments: [{ id: "a" }] }, docs, snap, 5),
    ).toStrictEqual({ dirty: false, discardedUnchangedCount: 1 });
  });

  it("DS-2 an edit to a discarded doc is dirty", () => {
    const before: Doc[] = [{ id: "a", content: "A1", isModified: true }];
    const snap = takeDiscardSnapshot(5, before, ["a"]);
    const now: Doc[] = [{ id: "a", content: "A1x", isModified: true }];
    expect(unsavedSinceDiscard(assessmentFrom(now, false), now, snap, 5)).toStrictEqual({
      dirty: true,
      discardedUnchangedCount: 0,
    });
  });

  it("DS-3 an edit to another, background doc is dirty", () => {
    const before: Doc[] = [
      { id: "a", content: "A1", isModified: true },
      { id: "b", content: "B0", isModified: false },
    ];
    const snap = takeDiscardSnapshot(5, before, ["a"]);
    const now: Doc[] = [
      { id: "a", content: "A1", isModified: true },
      { id: "b", content: "B1", isModified: true },
    ];
    expect(unsavedSinceDiscard(assessmentFrom(now, false), now, snap, 5)).toStrictEqual({
      dirty: true,
      discardedUnchangedCount: 1,
    });
  });

  it("DS-4 a snapshot from another request is not applied", () => {
    const docs: Doc[] = [{ id: "a", content: "A1", isModified: true }];
    const snap = takeDiscardSnapshot(5, docs, ["a"]);
    expect(unsavedSinceDiscard(assessmentFrom(docs, false), docs, snap, 6)).toStrictEqual({
      dirty: true,
      discardedUnchangedCount: 0,
    });
  });

  it("DS-5 a failed flush is dirty even with a matching snapshot", () => {
    const docs: Doc[] = [{ id: "a", content: "A1", isModified: true }];
    const snap = takeDiscardSnapshot(5, docs, ["a"]);
    expect(unsavedSinceDiscard(assessmentFrom(docs, true), docs, snap, 5)).toStrictEqual({
      dirty: true,
      discardedUnchangedCount: 1,
    });
  });

  it("DS-6 property: the law over generated document sets", () => {
    const seed = 0xad35_0007n;
    let s = seed;
    const below = (n: number): number => {
      s = (s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let z = ((s ^ (s >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return Number((z ^ (z >> 31n)) % BigInt(n));
    };
    const contents = ["", "x", "y", "# T\nz", "x "];
    const pick = () => contents[below(contents.length)];

    for (let i = 0; i < 800; i++) {
      let fresh = 0;
      let docs: Doc[] = Array.from({ length: below(9) }, (_, k) => ({
        id: `d${k}`,
        content: pick(),
        isModified: below(2) === 1,
      }));
      const snapIds = docs.filter(() => below(2) === 1).map((d) => d.id);
      const r = 5 + below(100);
      const snap = takeDiscardSnapshot(r, docs, snapIds);
      const oracleSnap: Record<string, string> = {};
      for (const d of docs) if (snapIds.includes(d.id)) oracleSnap[d.id] = d.content;

      for (let m = below(5); m > 0; m--) {
        const kind = below(4);
        const at = docs.length > 0 ? below(docs.length) : -1;
        if (kind === 0 && at >= 0) {
          docs = docs.map((d, k) => (k === at ? { ...d, content: pick(), isModified: true } : d));
        } else if (kind === 1 && at >= 0) {
          docs = docs.map((d, k) => (k === at ? { ...d, isModified: !d.isModified } : d));
        } else if (kind === 2) {
          docs = [...docs, { id: `n${fresh++}`, content: pick(), isModified: below(2) === 1 }];
        } else if (kind === 3 && at >= 0) {
          docs = docs.filter((_, k) => k !== at);
        }
      }
      const flushFailed = below(10) === 0;
      const rNow = r + below(2);

      const modified = docs.filter((d) => d.isModified);
      const inSnap = (d: Doc) => Object.prototype.hasOwnProperty.call(oracleSnap, d.id);
      const wantDirty =
        flushFailed ||
        (rNow !== r && modified.length > 0) ||
        modified.some((d) => !inSnap(d)) ||
        modified.some((d) => inSnap(d) && oracleSnap[d.id] !== d.content);
      const wantCount =
        rNow !== r ? 0 : modified.filter((d) => inSnap(d) && oracleSnap[d.id] === d.content).length;

      const got = unsavedSinceDiscard(assessmentFrom(docs, flushFailed), docs, snap, rNow);
      expect(got, `seed ${seed} index ${i}`).toStrictEqual({
        dirty: wantDirty,
        discardedUnchangedCount: wantCount,
      });
    }
  });

  it("DS-7 the snapshot copies content (no aliasing)", () => {
    const docs: Doc[] = [{ id: "a", content: "A1", isModified: true }];
    const ids = ["a"];
    const snap = takeDiscardSnapshot(5, docs, ids);
    docs[0].content = "changed";
    ids.length = 0;
    expect(unsavedSinceDiscard(assessmentFrom(docs, false), docs, snap, 5)).toStrictEqual({
      dirty: true,
      discardedUnchangedCount: 0,
    });
  });
});
