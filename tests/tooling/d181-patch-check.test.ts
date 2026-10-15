// @vitest-environment node
/**
 * D181-WI-1: `checkPatchApplied` — the pure core of the patched-dependency
 * guard. Given a unified diff and a way to read the installed package's files,
 * it says which hunks are not in effect. An incremental `pnpm install` once
 * created the `_patch_hash=` directory with the ORIGINAL files inside
 * (D181), so the only trustworthy answer comes from reading the files.
 *
 * Law (S5): for any file and any single-line edit expressed as a unified diff
 * with context, the patched file passes and the original file fails.
 */
import { describe, expect, it } from "vitest";
import {
  checkPatchApplied,
  PatchParseError,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/deps/patchCheck.mjs";

type Finding = { file: string; hunk: number; header: string; kind: string; expected?: string };
type Files = Record<string, string>;

const reader = (files: Files) => (rel: string): string | null => (rel in files ? files[rel] : null);
const check = (patch: string, files: Files): Finding[] => checkPatchApplied(patch, reader(files));

const ORIGINAL_A = ["one", "two", "three", "old line", "five", "six", "seven", ""].join("\n");
const PATCHED_A = ["one", "two", "three", "new line", "five", "six", "seven", ""].join("\n");
const PATCH_A = [
  "diff --git a/dist/a.js b/dist/a.js",
  "index 111..222 100644",
  "--- a/dist/a.js",
  "+++ b/dist/a.js",
  "@@ -1,7 +1,7 @@",
  " one",
  " two",
  " three",
  "-old line",
  "+new line",
  " five",
  " six",
  " seven",
  "",
].join("\n");

describe("D181-WI-1 checkPatchApplied — single hunk", () => {
  it("a patched file has no findings", () => {
    expect(check(PATCH_A, { "dist/a.js": PATCHED_A })).toEqual([]);
  });

  it("the unpatched original is reported as unpatched, naming file, hunk and the expected line", () => {
    expect(check(PATCH_A, { "dist/a.js": ORIGINAL_A })).toEqual([
      { file: "dist/a.js", hunk: 1, header: "@@ -1,7 +1,7 @@", kind: "unpatched", expected: "new line" },
    ]);
  });

  it("a file the patch touches that does not exist is reported as missing", () => {
    expect(check(PATCH_A, {})).toEqual([
      { file: "dist/a.js", hunk: 0, header: "", kind: "missing" },
    ]);
  });

  it("a file that matches neither side is reported as drifted, not passed", () => {
    const drifted = ["one", "two", "three", "something else", "five", "six", "seven", ""].join("\n");
    const out = check(PATCH_A, { "dist/a.js": drifted });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ file: "dist/a.js", hunk: 1, kind: "drifted", expected: "new line" });
  });

  it("an added line that also appears elsewhere does not make an unapplied hunk pass", () => {
    const decoy = `new line\n${ORIGINAL_A}// trailing\nnew line\n`;
    const out = check(PATCH_A, { "dist/a.js": decoy });
    expect(out.map((f) => f.kind)).toEqual(["unpatched"]);
  });

  it("the added line without its context does not pass", () => {
    const scrambled = ["three", "two", "one", "new line", "seven", "six", "five", ""].join("\n");
    expect(check(PATCH_A, { "dist/a.js": scrambled }).map((f) => f.kind)).toEqual(["drifted"]);
  });

  it("a file holding both the patched and the original block is not passed", () => {
    const both = `${PATCHED_A}${ORIGINAL_A}`;
    expect(check(PATCH_A, { "dist/a.js": both }).map((f) => f.kind)).toEqual(["unpatched"]);
  });

  it("CRLF in the installed file or in the patch text does not change the answer", () => {
    const crlf = (s: string) => s.replace(/\n/g, "\r\n");
    expect(check(PATCH_A, { "dist/a.js": crlf(PATCHED_A) })).toEqual([]);
    expect(check(crlf(PATCH_A), { "dist/a.js": PATCHED_A })).toEqual([]);
    expect(check(crlf(PATCH_A), { "dist/a.js": crlf(ORIGINAL_A) }).map((f) => f.kind)).toEqual(["unpatched"]);
  });

  it("indentation is significant: a whitespace-only difference on an added line is not the patch", () => {
    const tabbed = PATCHED_A.replace("new line", "\tnew line");
    expect(check(PATCH_A, { "dist/a.js": tabbed }).map((f) => f.kind)).toEqual(["drifted"]);
  });

  it("the '\\ No newline at end of file' marker is not treated as content", () => {
    const patch = PATCH_A.replace(" seven\n", " seven\n\\ No newline at end of file\n");
    expect(check(patch, { "dist/a.js": PATCHED_A.replace(/\n$/, "") })).toEqual([]);
  });
});

describe("D181-WI-1 checkPatchApplied — several files and hunks", () => {
  const body = (n: number, edits: Record<number, string>) =>
    Array.from({ length: n }, (_, i) => edits[i] ?? `line ${i}`).join("\n") + "\n";
  const PATCH = [
    "diff --git a/x.js b/x.js",
    "--- a/x.js",
    "+++ b/x.js",
    "@@ -2,3 +2,3 @@",
    " line 1",
    "-line 2",
    "+X2",
    " line 3",
    "@@ -20,3 +20,4 @@ function tail() {",
    " line 19",
    "-line 20",
    "+X20a",
    "+X20b",
    " line 21",
    "diff --git a/y.cjs b/y.cjs",
    "--- a/y.cjs",
    "+++ b/y.cjs",
    "@@ -5,3 +5,2 @@",
    " line 4",
    "-line 5",
    " line 6",
    "",
  ].join("\n");
  const X_DONE = body(30, { 2: "X2", 20: "X20a\nX20b" });
  const Y_DONE = body(10, {}).replace("line 5\n", "");

  it("every hunk applied: no findings", () => {
    expect(check(PATCH, { "x.js": X_DONE, "y.cjs": Y_DONE })).toEqual([]);
  });

  it("only the hunk that is missing is reported, with its own header and index", () => {
    const halfX = body(30, { 2: "X2" });
    expect(check(PATCH, { "x.js": halfX, "y.cjs": Y_DONE })).toEqual([
      { file: "x.js", hunk: 2, header: "@@ -20,3 +20,4 @@ function tail() {", kind: "unpatched", expected: "X20a" },
    ]);
  });

  it("a removal-only hunk fails while the removed line is still there", () => {
    const out = check(PATCH, { "x.js": X_DONE, "y.cjs": body(10, {}) });
    expect(out).toEqual([{ file: "y.cjs", hunk: 1, header: "@@ -5,3 +5,2 @@", kind: "unpatched", expected: "-line 5" }]);
  });

  it("findings come in patch order across files", () => {
    const out = check(PATCH, { "x.js": body(30, {}) });
    expect(out.map((f) => `${f.file}#${f.hunk}:${f.kind}`)).toEqual([
      "x.js#1:unpatched",
      "x.js#2:unpatched",
      "y.cjs#0:missing",
    ]);
  });
});

describe("D181-WI-1 checkPatchApplied — created and deleted files, bad input", () => {
  it("a patch that creates a file requires it to exist with that content", () => {
    const patch = ["--- /dev/null", "+++ b/new.js", "@@ -0,0 +1,2 @@", "+alpha", "+beta", ""].join("\n");
    expect(check(patch, { "new.js": "alpha\nbeta\n" })).toEqual([]);
    expect(check(patch, {}).map((f) => f.kind)).toEqual(["missing"]);
    expect(check(patch, { "new.js": "alpha\n" }).map((f) => f.kind)).toEqual(["drifted"]);
  });

  it("a patch that deletes a file requires it to be gone", () => {
    const patch = ["--- a/gone.js", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-bye", ""].join("\n");
    expect(check(patch, {})).toEqual([]);
    expect(check(patch, { "gone.js": "bye\n" })).toEqual([
      { file: "gone.js", hunk: 0, header: "", kind: "present" },
    ]);
  });

  it("an append-only hunk, whose old side sits inside its new side, passes when applied and fails when not", () => {
    const patch = ["--- a/t.js", "+++ b/t.js", "@@ -1,2 +1,3 @@", " a", " b", "+c", ""].join("\n");
    expect(check(patch, { "t.js": "a\nb\nc\n" })).toEqual([]);
    expect(check(patch, { "t.js": "a\nb\n" }).map((f) => f.kind)).toEqual(["unpatched"]);
    expect(check(patch, { "t.js": "a\nb\nc\nx\na\nb\n" }).map((f) => f.kind)).toEqual(["unpatched"]);
  });

  it("a patch with no hunks is a parse error, not a pass", () => {
    expect(() => check("", {})).toThrow(PatchParseError);
    expect(() => check("diff --git a/x b/x\n--- a/x\n+++ b/x\n", {})).toThrow(PatchParseError);
  });

  it("a hunk line with no recognised prefix is a parse error", () => {
    const bad = PATCH_A.replace(" five", "?five");
    expect(() => check(bad, { "dist/a.js": PATCHED_A })).toThrow(PatchParseError);
  });
});

// --- S5: generated single-line edits ------------------------------------------------
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

/** A unified diff replacing line `at` of `lines` with `next`, with up to 3 lines of context. */
function diffFor(lines: string[], at: number, next: string): string {
  const from = Math.max(0, at - 3);
  const to = Math.min(lines.length, at + 4);
  const out = ["--- a/f.js", "+++ b/f.js", `@@ -${from + 1},${to - from} +${from + 1},${to - from} @@`];
  for (let i = from; i < to; i += 1) {
    if (i === at) out.push(`-${lines[i]}`, `+${next}`);
    else out.push(` ${lines[i]}`);
  }
  return `${out.join("\n")}\n`;
}

describe("D181-WI-1 checkPatchApplied — law over generated edits (S5)", () => {
  it("for 300 generated files and edits, the patched file passes and the original fails", () => {
    const r = mulberry32(181);
    const vocab = ["a", "b", "c", "x = 1;", "}", "{", "return x;", ""];
    for (let n = 0; n < 300; n += 1) {
      const len = 1 + Math.floor(r() * 25);
      const lines = Array.from({ length: len }, () => vocab[Math.floor(r() * vocab.length)]);
      const at = Math.floor(r() * len);
      const next = `patched ${n}`;
      const patched = lines.slice();
      patched[at] = next;
      const patch = diffFor(lines, at, next);
      const original = `${lines.join("\n")}\n`;
      const after = `${patched.join("\n")}\n`;
      expect(`${n}: ${JSON.stringify(check(patch, { "f.js": after }))}`).toBe(`${n}: []`);
      expect(`${n}: ${check(patch, { "f.js": original }).map((f) => f.kind).join()}`).toBe(`${n}: unpatched`);
    }
  });
});
