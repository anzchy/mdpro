// @vitest-environment node
/**
 * WI-6 (ADR-0047): artifact digests — `sha256File`, `digestDir`, `parseCodesign`.
 * Matrix: `.claude/tdd-guardian/tests-20261002-155158.md`, unit WI-6, T01..T15;
 * plan decisions O7 and O14.
 *
 * Pinned hex values were computed outside the module with `shasum -a 256`:
 *   printf 'abc' | shasum -a 256
 *   printf ''    | shasum -a 256
 *   printf 'B.txt\0e3b0…b855\na.txt\0ba78…15ad\nsub/c.txt\0ba78…15ad\n' | shasum -a 256
 * (the last with the full 64-hex values written out; 217 bytes).
 *
 * Every call is awaited so the tests hold whether the module is sync or async.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { digestDir, parseCodesign, sha256File } from "../../scripts/control/digests.mjs";

const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const GOLDEN_T04_LINES =
  `B.txt\0${SHA_EMPTY}\n` + `a.txt\0${SHA_ABC}\n` + `sub/c.txt\0${SHA_ABC}\n`;
const GOLDEN_T04 = "89de1835419afadaf8ecb5d8e6689434b82829fd6edddba9147161f1335329d9";

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const fileSha = async (p: string): Promise<string> => await sha256File(p);
const dirSha = async (d: string): Promise<string> => await digestDir(d);

// ---------------------------------------------------------------------------
// Real tmpdir I/O
// ---------------------------------------------------------------------------
const made: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-digests-"));
  made.push(d);
  return d;
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

type Tree = Record<string, string>;
function writeTree(dir: string, files: Tree, order: string[] = Object.keys(files)): string {
  for (const rel of order) {
    const p = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, files[rel]);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Seeded generator (mulberry32). No fast-check by design (plan Deferred).
// ---------------------------------------------------------------------------
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
const hex = (r: Rng, n: number) =>
  Array.from({ length: n }, () => "0123456789abcdef"[int(r, 0, 15)]).join("");
function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(r, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// sha256File
// ---------------------------------------------------------------------------
describe("sha256File", () => {
  it("WI-6/T01 known vectors: 'abc' and the empty file", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "abc"), "abc");
    fs.writeFileSync(path.join(d, "empty"), "");
    expect(await fileSha(path.join(d, "abc"))).toBe(SHA_ABC);
    expect(await fileSha(path.join(d, "empty"))).toBe(SHA_EMPTY);
  });

  it("WI-6/T02 a 1 MiB + 1 byte file hashes across chunk boundaries", async () => {
    const buf = Buffer.alloc(1024 * 1024 + 1);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 251;
    const p = path.join(tmp(), "big.bin");
    fs.writeFileSync(p, buf);
    expect(await fileSha(p)).toBe(createHash("sha256").update(buf).digest("hex"));
  });

  it("WI-6/T03 a missing file rejects with the path in the message", async () => {
    const p = path.join(tmp(), "does-not-exist.bin");
    await expect(Promise.resolve().then(() => sha256File(p))).rejects.toThrow(p);
  });
});

// ---------------------------------------------------------------------------
// digestDir
// ---------------------------------------------------------------------------
const T04_TREE: Tree = { "B.txt": "", "a.txt": "abc", "sub/c.txt": "abc" };

describe("digestDir", () => {
  it("WI-6/T04 golden format: sorted `path NUL sha256 LF` lines, code-unit order", async () => {
    expect(sha(GOLDEN_T04_LINES)).toBe(GOLDEN_T04);
    const d = writeTree(tmp(), T04_TREE);
    expect(await dirSha(d)).toBe(GOLDEN_T04);
  });

  it("WI-6/T05 an empty dir, and a dir holding only an empty subdir, give the empty digest", async () => {
    expect(await dirSha(tmp())).toBe(SHA_EMPTY);
    const d = tmp();
    fs.mkdirSync(path.join(d, "e"));
    expect(await dirSha(d)).toBe(SHA_EMPTY);
  });

  it("WI-6/T06 a missing dir, and a regular file passed as the dir, both throw naming the path", async () => {
    const missing = path.join(tmp(), "nope");
    await expect(Promise.resolve().then(() => digestDir(missing))).rejects.toThrow(missing);
    const file = path.join(tmp(), "plain.txt");
    fs.writeFileSync(file, "x");
    await expect(Promise.resolve().then(() => digestDir(file))).rejects.toThrow(file);
  });

  it("WI-6/T07 creation order and mtimes do not change the digest (seed 7, 20 orders)", async () => {
    const files: Tree = {
      "B.txt": "",
      "a.txt": "abc",
      "a-b.txt": "hello\n",
      "a0.txt": "0",
      "top.md": "# t\n",
      "a/x/one.txt": "one",
      "a/x/two.txt": "two",
      "z/y/three.txt": "three",
    };
    // Hand-sorted in UTF-16 code-unit order: 'B' < 'a'; '-' < '.' < '/' < '0'.
    const sorted = [
      "B.txt",
      "a-b.txt",
      "a.txt",
      "a/x/one.txt",
      "a/x/two.txt",
      "a0.txt",
      "top.md",
      "z/y/three.txt",
    ];
    const expected = sha(sorted.map((p) => `${p}\0${sha(files[p])}\n`).join(""));
    const r = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const order = shuffle(r, Object.keys(files));
      const d = writeTree(tmp(), files, order);
      if (i % 5 === 4) {
        order.forEach((rel, k) => {
          const t = new Date(Date.UTC(2001 + i, 0, 1 + k));
          fs.utimesSync(path.join(d, ...rel.split("/")), t, t);
        });
      }
      expect(await dirSha(d), `seed 7, order ${i}: ${order.join(",")}`).toBe(expected);
    }
  });

  it("WI-6/T08 every content edit, rename, add, move, delete and swap changes the digest; chmod does not", async () => {
    const { "a.txt": _a, ...withoutA } = T04_TREE;
    const { "B.txt": _b, ...withoutB } = T04_TREE;
    const variants: Record<string, Tree> = {
      base: T04_TREE,
      edit: { ...T04_TREE, "a.txt": "abd" },
      rename: { ...withoutA, "a2.txt": "abc" },
      add: { ...T04_TREE, "z.txt": "" },
      move: { ...withoutA, "sub/a.txt": "abc" },
      delete: withoutB,
      swap: { ...T04_TREE, "a.txt": "", "B.txt": "abc" },
    };
    const digests: Record<string, string> = {};
    for (const [name, tree] of Object.entries(variants)) {
      digests[name] = await dirSha(writeTree(tmp(), tree));
    }
    const values = Object.values(digests);
    expect(new Set(values).size, JSON.stringify(digests)).toBe(7);
    expect(digests.base).toBe(GOLDEN_T04);

    const d = writeTree(tmp(), T04_TREE);
    fs.chmodSync(path.join(d, "a.txt"), 0o755);
    expect(await dirSha(d)).toBe(digests.base);
  });
});

// ---------------------------------------------------------------------------
// parseCodesign
// ---------------------------------------------------------------------------
// Real ad-hoc `codesign -dvvv` output (stderr), home path replaced by /Users/someone.
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
const REAL = {
  identifier: "tauri_app-f283913162faab95",
  format: "app bundle with Mach-O thin (arm64)",
  cdhash: "6140cd9271f655c037829fe53d1fc93b80de994e",
  signature: "adhoc",
  teamIdentifier: "not set",
};
/** The fixture with every line starting `prefix` replaced by `next` (dropped when null). */
function edit(prefix: string, next: string | null, lines: string[] = FIXTURE): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (!l.startsWith(prefix)) out.push(l);
    else if (next !== null) out.push(next);
  }
  return out;
}

describe("parseCodesign", () => {
  it("WI-6/T09 the real ad-hoc fixture parses to exactly the five fields, no path or noise", () => {
    expect(FIXTURE).toHaveLength(16);
    const r = parseCodesign(text(FIXTURE));
    expect(r).toEqual(REAL);
    expect(Object.keys(r)).toHaveLength(5);
    const json = JSON.stringify(r);
    for (const bad of ["/Users", "someone", "mdpro.app", "6cb3338db3b24a9789dc85ca", "20400", "not bound"]) {
      expect(json).not.toContain(bad);
    }
  });

  it("WI-6/T10 cdhash comes from the `CDHash=` line, not the Candidate or CMSDigest lines", () => {
    const A = "a1".repeat(20);
    const B = "b2".repeat(32);
    const C = "c3".repeat(20);
    const D = "d4".repeat(32);
    let lines = edit("CandidateCDHash sha256=", `CandidateCDHash sha256=${A}`);
    lines = edit("CandidateCDHashFull sha256=", `CandidateCDHashFull sha256=${B}`, lines);
    lines = edit("CMSDigest=", `CMSDigest=${D}`, lines);
    lines = edit("CDHash=", `CDHash=${C}`, lines);
    expect(lines.indexOf(`CDHash=${C}`)).toBeGreaterThan(lines.indexOf(`CandidateCDHashFull sha256=${B}`));
    expect(parseCodesign(text(lines)).cdhash).toBe(C);
  });

  it("WI-6/T11 a missing or empty CDHash, Identifier or Format throws naming the field", () => {
    expect(() => parseCodesign(text(edit("CDHash=", null)))).toThrow("CDHash");
    expect(() => parseCodesign(text(edit("CDHash=", "CDHash=")))).toThrow("CDHash");
    expect(() => parseCodesign("")).toThrow("CDHash");
    expect(() => parseCodesign("code object is not signed at all")).toThrow("CDHash");
    expect(() => parseCodesign(text(edit("Identifier=", null)))).toThrow("Identifier");
    expect(() => parseCodesign(text(edit("Format=", null)))).toThrow("Format");
    expect(() => parseCodesign(text(edit("Identifier=", "Identifier=")))).toThrow("Identifier");
  });

  it("WI-6/T12 injected noise never reaches the output (seed 12, 100 variants)", () => {
    const r = mulberry32(12);
    for (let v = 0; v < 100; v++) {
      const ci = hex(r, 40);
      let lines = edit("CDHash=", `CDHash=${ci}`);
      lines = edit("CandidateCDHash sha256=", `CandidateCDHash sha256=${hex(r, 40)}`, lines);
      lines = edit("CandidateCDHashFull sha256=", `CandidateCDHashFull sha256=${hex(r, 64)}`, lines);
      lines = edit("CMSDigest=", `CMSDigest=${hex(r, 64)}`, lines);
      const tokens: string[] = [];
      const n = int(r, 0, 10);
      for (let k = 0; k < n; k++) {
        const tok = `tk${v}n${k}r${hex(r, 8)}`;
        const hexTok = hex(r, 64);
        const forms = [
          { line: `Executable=/Users/u${tok}/x`, token: tok },
          { line: `Info.plist=/p${tok}`, token: tok },
          { line: `Sealed Resources version=2 rules=13 files=${tok}`, token: tok },
          { line: `Authority=/q${tok}`, token: tok },
          { line: `CMSDigest=${hexTok}`, token: hexTok },
        ];
        const f = forms[int(r, 0, forms.length - 1)];
        tokens.push(f.token);
        lines.splice(int(r, 0, lines.length), 0, f.line);
      }
      const out = parseCodesign(text(lines));
      const msg = `seed 12, variant ${v}`;
      expect(out, msg).toEqual({ ...REAL, cdhash: ci });
      const json = JSON.stringify(out);
      expect(json, msg).not.toContain('"/');
      for (const t of tokens) expect(json, `${msg}, token ${t}`).not.toContain(t);
    }
  });

  it("WI-6/T13 a selected value that is a rooted path throws naming the field", () => {
    expect(() => parseCodesign(text(edit("Identifier=", "Identifier=/Users/someone/x")))).toThrow(
      "identifier",
    );
    expect(() => parseCodesign(text(edit("Identifier=", "Identifier=~/x")))).toThrow("identifier");
    expect(() => parseCodesign(text(edit("Format=", "Format=/tmp/f")))).toThrow("format");
    expect(() => parseCodesign(text(edit("TeamIdentifier=", "TeamIdentifier=~someone")))).toThrow(
      "teamIdentifier",
    );
  });

  it("WI-6/T14 Developer-ID style output with `Signature size=` and no `Signature=` gives signature null", () => {
    const r = parseCodesign(text(edit("Signature=", "Signature size=9000")));
    expect(r).toEqual({ ...REAL, signature: null });
  });

  it("WI-6/T15 no `TeamIdentifier=` line gives teamIdentifier null", () => {
    const r = parseCodesign(text(edit("TeamIdentifier=", null)));
    expect(r).toEqual({ ...REAL, teamIdentifier: null });
  });
});
