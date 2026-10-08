// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-4: the one-run lock (`scripts/control/lock.mjs`), on a
 * real tmp filesystem. Never faked anywhere.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, WI-4, K-01..K-08;
 * Round 3 (WI-R1): K-R1, K-R2 (`releaseOrphanLock`).
 * Post-red addition: K-R3 (an unreadable `.lock`, acquire into a missing parent).
 *
 * Refusal messages are pinned here as literals, never imported.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  readLock,
  releaseLock,
  releaseOrphanLock,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/lock.mjs";
import { bytes, mulberry32 } from "./support/seededRandom";

const A = "a".repeat(25);
const B = "b".repeat(25);
const N1 = "ab".repeat(32);
const N2 = "01".repeat(32);
const LOCK_MODULE = path.resolve(__dirname, "../scripts/control/lock.mjs");

const dirs: string[] = [];
function freshParent(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lk-"));
  dirs.push(d);
  return d;
}
const lockFile = (parent: string) => path.join(parent, ".lock");
const hex = (r: () => number) => Buffer.from(bytes(r, 32)).toString("hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("lock#acquire / release / read", () => {
  it("K-01 two acquires: exactly one winner, the loser names the holder run only", () => {
    const parent = freshParent();
    expect(acquireLock(parent, { run: A, nonce: N1 })).toEqual({ run: A });
    let message = "";
    try {
      acquireLock(parent, { run: B, nonce: N2 });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toBe(`lock held by run ${A}`);
    expect(message).not.toContain(N1);
    expect(message).not.toContain(N2);
    expect(fs.readdirSync(parent).filter((n) => n === ".lock").length).toBe(1);
    expect(JSON.parse(fs.readFileSync(lockFile(parent), "utf8")).run).toBe(A);
  });

  it("K-02 the file holds { run, nonceDigest } at mode 0600, never the nonce", () => {
    for (const nonce of ["ab".repeat(32), "01".repeat(32)]) {
      const parent = freshParent();
      acquireLock(parent, { run: A, nonce });
      const raw = fs.readFileSync(lockFile(parent), "utf8");
      expect(JSON.parse(raw)).toStrictEqual({ run: A, nonceDigest: sha256(nonce) });
      expect(raw).not.toContain(nonce);
      expect(fs.statSync(lockFile(parent)).mode & 0o777).toBe(0o600);
    }
  });

  it("K-03 release by a non-holder is refused and the lock stays byte-identical", () => {
    const parent = freshParent();
    acquireLock(parent, { run: A, nonce: N1 });
    const before = fs.readFileSync(lockFile(parent));
    const mtimeBefore = fs.statSync(lockFile(parent)).mtimeMs;
    expect(() => releaseLock(parent, { run: B, nonce: N1 })).toThrow(
      `lock names run ${A}, not ${B}`,
    );
    expect(fs.readFileSync(lockFile(parent)).equals(before)).toBe(true);
    expect(fs.statSync(lockFile(parent)).mtimeMs).toBe(mtimeBefore);
  });

  it("K-04 lifecycle absent → held(A) → absent → held(B); release is idempotent", () => {
    const parent = freshParent();
    expect(readLock(parent)).toStrictEqual({ state: "absent" });
    acquireLock(parent, { run: A, nonce: N1 });
    expect(readLock(parent)).toStrictEqual({ state: "held", run: A });
    expect(releaseLock(parent, { run: A, nonce: N1 })).toBe("released");
    expect(fs.existsSync(lockFile(parent))).toBe(false);
    expect(releaseLock(parent, { run: A, nonce: N1 })).toBe("absent");
    expect(acquireLock(parent, { run: B, nonce: N2 })).toEqual({ run: B });
    expect(readLock(parent)).toStrictEqual({ state: "held", run: B });
  });

  it("K-05 cross-process race: exactly one of 6 children wins, 3 rounds", async () => {
    const url = pathToFileURL(LOCK_MODULE).href;
    for (let round = 0; round < 3; round++) {
      const parent = freshParent();
      const startAt = Date.now() + 400;
      const names = Array.from({ length: 6 }, (_, i) => `${round}${i}`.padEnd(25, "z"));
      const src = (name: string) =>
        `import { acquireLock } from ${JSON.stringify(url)};` +
        `while (Date.now() < ${startAt}) {}` +
        `try { acquireLock(${JSON.stringify(parent)}, { run: ${JSON.stringify(name)}, nonce: "n${name}" }); process.stdout.write("won"); }` +
        `catch { process.stdout.write("lost"); }`;
      const outs = await Promise.all(
        names.map(
          (name) =>
            new Promise<string>((resolve, reject) => {
              const child = spawn(process.execPath, ["--input-type=module", "-e", src(name)]);
              let out = "";
              child.stdout.on("data", (c) => (out += c));
              child.on("error", reject);
              child.on("close", () => resolve(out));
            }),
        ),
      );
      expect(outs.every((o) => o === "won" || o === "lost")).toBe(true);
      expect(outs.filter((o) => o === "won").length).toBe(1);
      const winner = names[outs.indexOf("won")];
      expect(JSON.parse(fs.readFileSync(lockFile(parent), "utf8")).run).toBe(winner);
    }
  }, 30_000);

  it("K-06 a corrupt lock reads as corrupt and blocks acquire and release", () => {
    for (const body of ["{", "", '{"run":5}']) {
      const parent = freshParent();
      fs.writeFileSync(lockFile(parent), body, { mode: 0o600 });
      expect(readLock(parent)).toStrictEqual({ state: "corrupt" });
      expect(() => acquireLock(parent, { run: A, nonce: N1 })).toThrow("lock unreadable");
      expect(() => releaseLock(parent, { run: A, nonce: N1 })).toThrow("lock unreadable");
      expect(fs.readFileSync(lockFile(parent), "utf8")).toBe(body);
    }
  });

  it("K-07 the nonce is never in the lock file (seed 2026100806)", () => {
    const r = mulberry32(2026100806);
    for (let i = 0; i < 100; i++) {
      const parent = freshParent();
      const nonce = hex(r);
      acquireLock(parent, { run: A, nonce });
      const raw = fs.readFileSync(lockFile(parent), "utf8");
      expect(raw).not.toContain(nonce);
      expect(JSON.parse(raw).nonceDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("K-08 same run, another nonce: release refused, file kept (seed 2026100810)", () => {
    const r = mulberry32(2026100810);
    for (let i = 0; i < 50; i++) {
      const n1 = hex(r);
      let n2 = hex(r);
      while (n2 === n1) n2 = hex(r);
      const parent = freshParent();
      acquireLock(parent, { run: A, nonce: n1 });
      const before = fs.readFileSync(lockFile(parent));
      const mtimeBefore = fs.statSync(lockFile(parent)).mtimeMs;
      let message = "";
      try {
        releaseLock(parent, { run: A, nonce: n2 });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toBe(`lock for run ${A} holds another nonce`);
      expect(message).not.toContain(n1);
      expect(message).not.toContain(n2);
      expect(fs.readFileSync(lockFile(parent)).equals(before)).toBe(true);
      expect(fs.statSync(lockFile(parent)).mtimeMs).toBe(mtimeBefore);
      expect(releaseLock(parent, { run: A, nonce: n1 })).toBe("released");
      expect(fs.existsSync(lockFile(parent))).toBe(false);
    }
  });
});

describe("lock#releaseOrphanLock (WI-R1): matches on run only, since the nonce went with the run dir", () => {
  const thrown = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return "no throw";
  };

  it("K-R1 held(A) released; absent is a no-op; held(B) and corrupt throw with the bytes kept", () => {
    const held = freshParent();
    acquireLock(held, { run: A, nonce: N1 });
    expect(releaseOrphanLock(held, A)).toBe("released");
    expect(fs.existsSync(lockFile(held))).toBe(false);

    const absent = freshParent();
    expect(releaseOrphanLock(absent, A)).toBe("absent");
    expect(fs.readdirSync(absent)).toEqual([]);

    const other = freshParent();
    acquireLock(other, { run: B, nonce: N2 });
    const otherBytes = fs.readFileSync(lockFile(other));
    expect(thrown(() => releaseOrphanLock(other, A))).toBe(`lock names run ${B}, not ${A}`);
    expect(fs.readFileSync(lockFile(other)).equals(otherBytes)).toBe(true);

    const corrupt = freshParent();
    fs.writeFileSync(lockFile(corrupt), "{", { mode: 0o600 });
    expect(thrown(() => releaseOrphanLock(corrupt, A))).toBe("lock unreadable");
    expect(fs.readFileSync(lockFile(corrupt), "utf8")).toBe("{");
  });

  it("K-R2 a lock naming another run is never removed (seed 2026100820)", () => {
    const r = mulberry32(2026100820);
    const name = () => Buffer.from(bytes(r, 13)).toString("hex").slice(0, 25);
    for (let i = 0; i < 50; i++) {
      const a = name();
      let b = name();
      while (b === a) b = name();
      const parent = freshParent();
      acquireLock(parent, { run: b, nonce: hex(r) });
      const before = fs.readFileSync(lockFile(parent));
      expect(thrown(() => releaseOrphanLock(parent, a))).toBe(`lock names run ${b}, not ${a}`);
      expect(fs.readFileSync(lockFile(parent)).equals(before)).toBe(true);
      expect(releaseOrphanLock(parent, b)).toBe("released");
      expect(fs.existsSync(lockFile(parent))).toBe(false);
    }
  });

  it("K-R3 a .lock that cannot be read as a file is corrupt to every reader; acquire into a missing parent rethrows", () => {
    const parent = freshParent();
    fs.mkdirSync(lockFile(parent));
    expect(readLock(parent)).toStrictEqual({ state: "corrupt" });
    expect(thrown(() => releaseOrphanLock(parent, A))).toBe("lock unreadable");
    expect(thrown(() => acquireLock(parent, { run: A, nonce: N1 }))).toBe("lock unreadable");
    expect(fs.statSync(lockFile(parent)).isDirectory()).toBe(true);
    const missing = path.join(freshParent(), "no-such-parent");
    expect(thrown(() => acquireLock(missing, { run: A, nonce: N1 }))).toMatch(/^ENOENT/);
    expect(fs.existsSync(missing)).toBe(false);
  });
});
