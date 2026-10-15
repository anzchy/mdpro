// @vitest-environment node
/**
 * WI-16 (ADR-0047): `digestDir` refuses symlinks and non-regular entries.
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit
 * `digests.mjs#digestDir, non-regular entries (WI-16)`, cases WI-6/T16..T18.
 *
 * Split out of `control-build-digests.test.ts`, which is already past the
 * 300-line limit (rule 50 §6). These cases pin existing behaviour (plan O16).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { DigestError, digestDir, parseCodesign } from "../../scripts/control/digests.mjs";

const made: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-digests-entries-"));
  made.push(d);
  return d;
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Run `fn` and return what it threw; fails the test when nothing was thrown. */
async function thrown(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected digestDir to throw, but it returned a digest");
}

/** Asserts `e` is a DigestError and returns its message. */
function digestErrorMessage(e: unknown): string {
  expect(e).toBeInstanceOf(DigestError);
  return (e as Error).message;
}

describe("digestDir, non-regular entries", () => {
  it("WI-6/T16 a symlink to a file is refused, naming the link", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "a.txt"), "A");
    fs.symlinkSync("a.txt", path.join(d, "link"));

    const msg = digestErrorMessage(await thrown(() => digestDir(d)));
    expect(msg).toMatch(/symlink/);
    expect(msg).toContain("link");
    expect(msg).toContain("only regular files are digested");
  });

  it("WI-6/T17 a symlink to a directory, and a dangling symlink, are each refused", async () => {
    // (i) symlink to a sibling directory
    const outer = tmp();
    fs.mkdirSync(path.join(outer, "target"));
    fs.writeFileSync(path.join(outer, "target", "f.txt"), "F");
    fs.mkdirSync(path.join(outer, "d"));
    fs.symlinkSync("../target", path.join(outer, "d", "ln"));

    const msgDir = digestErrorMessage(await thrown(() => digestDir(path.join(outer, "d"))));
    expect(msgDir).toMatch(/symlink/);
    expect(msgDir).toContain("ln");

    // (ii) dangling symlink
    const d2 = tmp();
    fs.symlinkSync("missing.txt", path.join(d2, "gone"));
    expect(fs.existsSync(path.join(d2, "missing.txt"))).toBe(false);

    const msgGone = digestErrorMessage(await thrown(() => digestDir(d2)));
    expect(msgGone).toMatch(/symlink/);
    expect(msgGone).toContain("gone");
  });

  it.skipIf(process.platform === "win32")(
    "WI-6/T18 a FIFO one level down is refused without being opened",
    async () => {
      const d = tmp();
      fs.mkdirSync(path.join(d, "sub"));
      fs.writeFileSync(path.join(d, "a.txt"), "A");
      const fifo = path.join(d, "sub", "pipe");
      const r = spawnSync("mkfifo", [fifo]);
      // Precondition: a missing mkfifo must fail loudly, not pass vacuously.
      expect(r.error, "mkfifo could not be spawned").toBeUndefined();
      expect(r.status, `mkfifo exited non-zero: ${String(r.stderr)}`).toBe(0);
      expect(fs.lstatSync(fifo).isFIFO()).toBe(true);

      const msg = digestErrorMessage(await thrown(() => digestDir(d)));
      expect(msg).toMatch(/not a regular file/);
      expect(msg).toContain("pipe");
    },
    5_000,
  );
});

// ---------------------------------------------------------------------------
// WI-21: parseCodesign refuses a repeated kept key (WI-6/T19, a pin).
// Matrix unit "`scripts/control/digests.mjs#parseCodesign`, repeated keys (WI-21)".
// ---------------------------------------------------------------------------
// The real ad-hoc `codesign -dvvv` output from control-build-digests.test.ts
// (home path already replaced by /Users/someone), copied: test files do not export.
const FIXTURE = [
  "Executable=/Users/someone/Documents/01_Coding/mac-app/mdpro/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/tauri-app",
  "Identifier=tauri_app-f283913162faab95",
  "Format=app bundle with Mach-O thin (arm64)",
  "CodeDirectory v=20400 size=159160 flags=0x20002(adhoc,linker-signed) hashes=4970+0 location=embedded",
  "Hash type=sha256 size=32",
  "CandidateCDHash sha256=6140cd9271f655c037829fe53d1fc93b80de994e",
  "CandidateCDHashFull sha256=6140cd9271f655c037829fe53d1fc93b80de994e6cb3338db3b24a9789dc85ca",
  "Hash choices=sha256",
  "CMSDigest=6140cd9271f655c037829fe53d1fc93b80de994e6cb3338db3b24a9789dc85ca",
  "CMSDigestType=2",
  "CDHash=6140cd9271f655c037829fe53d1fc93b80de994e",
  "Signature=adhoc",
  "Info.plist=not bound",
  "TeamIdentifier=not set",
  "Sealed Resources=none",
  "Internal requirements=none",
];
const text = (lines: string[]) => `${lines.join("\n")}\n`;

describe("parseCodesign, repeated keys", () => {
  it("WI-6/T19 a repeated Identifier=, CDHash= or Signature= line throws, naming the key", () => {
    // Control: the unmodified fixture parses.
    expect(parseCodesign(text(FIXTURE)).identifier).toBe("tauri_app-f283913162faab95");
    const rows: [string, string][] = [
      ["Identifier", "Identifier=tauri_app-0000000000000000"],
      ["CDHash", "CDHash=0000000000000000000000000000000000000000"],
      ["Signature", "Signature=adhoc"],
    ];
    for (const [key, extra] of rows) {
      const at = FIXTURE.findIndex((l) => l.startsWith(`${key}=`));
      expect(at, key).toBeGreaterThanOrEqual(0);
      const lines = [...FIXTURE.slice(0, at + 1), extra, ...FIXTURE.slice(at + 1)];
      const e = caughtSync(() => parseCodesign(text(lines)));
      expect(e, key).toBeInstanceOf(DigestError);
      expect((e as Error).message, key).toMatch(/appears more than once/);
      expect((e as Error).message, key).toBe(`parseCodesign: ${key}= appears more than once`);
    }
  });
});

function caughtSync(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}
