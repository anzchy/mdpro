// @vitest-environment node
/**
 * D82 characterization (coverage gap in `scripts/control/lock.mjs`
 * `releaseAtomically`, the restore): a restore `linkSync` that fails with
 * anything but EEXIST throws `lock displaced: kept <tomb> (<code>)` since
 * D82-WI-9 S-1 (it was rethrown as-is before): the foreign record survives
 * only in the named tomb, and `.lock` is left absent.
 *
 * Schedule: `.lock` is A's at the pre-check, so the release proceeds; just
 * before the `renameSync(.lock)` it is swapped to B's, so the tomb check
 * refuses and the restore runs; that `linkSync` throws `EPERM` once. Every
 * other fs call is real (tmp dir).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { acquireLock, releaseLock, releaseOrphanLock } from "../../scripts/control/lock.mjs";
import { A, B, N1, N2, cleanupParents, freshParent, lockFile, recordBytes, tombsIn } from "../support/lockSchedules";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupParents();
});

const FNS = [
  { fn: "releaseLock", call: (parent: string) => releaseLock(parent, { run: A, nonce: N1 }) },
  { fn: "releaseOrphanLock", call: (parent: string) => releaseOrphanLock(parent, A) },
] as const;

describe("D82 lock restore: a non-EEXIST link failure", () => {
  it.each(FNS)(
    "$fn — non-EEXIST restore failure: throws naming the tomb, keeps B's record in it, leaves .lock absent (accepted limit, see D82 row)",
    ({ call }) => {
      const parent = freshParent();
      acquireLock(parent, { run: A, nonce: N1 });
      const lock = lockFile(parent);
      const realRename = fs.renameSync;
      let swaps = 0;
      vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
        if (from === lock && swaps++ === 0) fs.writeFileSync(lock, recordBytes(B, N2));
        return realRename(from, to);
      }) as never);
      const links: unknown[][] = [];
      const realLink = fs.linkSync;
      // rule 12: D170-WI-1 creates `.lock.mutex` by a link too, before the restore, so the one fault is aimed at the
      // first link onto `.lock` (the restore) and every other link is real (was `mockImplementationOnce` on any link).
      vi.spyOn(fs, "linkSync").mockImplementation(((...a: unknown[]) => {
        if (a[1] !== lock || links.length > 0) return realLink(...(a as Parameters<typeof fs.linkSync>));
        links.push(a);
        throw Object.assign(new Error("EPERM: operation not permitted, link"), { code: "EPERM" });
      }) as never);

      let caught: unknown;
      try {
        call(parent);
      } catch (e) {
        caught = e;
      }
      vi.restoreAllMocks();

      expect(swaps).toBe(1);
      expect(links).toHaveLength(1);
      expect(links[0][1]).toBe(lock);
      expect(caught).toBeInstanceOf(Error);
      const tombs = tombsIn(parent);
      expect(tombs).toHaveLength(1);
      // D82-WI-9 S-1: non-EEXIST restore failures now name the tomb.
      expect((caught as Error).message).toBe(`lock displaced: kept ${tombs[0]} (EPERM)`);
      expect(links[0][0]).toBe(path.join(parent, tombs[0]));
      expect(fs.readFileSync(path.join(parent, tombs[0]), "utf8")).toBe(recordBytes(B, N2));
      expect(fs.existsSync(lock)).toBe(false);
      expect(fs.readdirSync(parent)).toEqual(tombs);
    },
  );
});
