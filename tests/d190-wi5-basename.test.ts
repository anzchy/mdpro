// @vitest-environment node
/**
 * D190-WI-5 (audit W5): `basename` splits on both `/` and `\`, so a Windows
 * path shows its file name, not the whole path. Decisions pinned here:
 * - Trailing separators are ignored (`/a/dir/` -> `dir`).
 * - A path with no name segment (`/`, `C:\`, `\\`) comes back unchanged;
 *   empty stays empty.
 * The three call sites that split on `/` only now use it (source check).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { basename } from "../src/utils/pathBasename";

describe("basename", () => {
  it.each([
    ["Windows drive path", "C:\\Users\\jack\\notes.md", "notes.md"],
    ["UNC path", "\\\\server\\share\\dir\\a.md", "a.md"],
    ["verbatim path", "\\\\?\\C:\\Users\\jack\\a.md", "a.md"],
    ["POSIX path", "/Users/jack/notes/a.md", "a.md"],
    ["mixed separators", "C:\\Users/jack\\docs/a.md", "a.md"],
    ["bare name", "a.md", "a.md"],
    ["POSIX trailing separator", "/Users/jack/dir/", "dir"],
    ["Windows trailing separator", "C:\\Users\\jack\\dir\\", "dir"],
    ["non-ASCII name", "C:\\笔记\\中文.md", "中文.md"],
  ])("%s", (_label, input, expected) => {
    expect(basename(input)).toBe(expected);
  });

  it.each([
    ["empty", ""],
    ["POSIX root", "/"],
    ["drive root", "C:\\"],
    ["drive root, forward slash", "C:/"],
  ])("%s has no name and comes back unchanged", (_label, input) => {
    expect(basename(input)).toBe(input);
  });

  it("returns the last name for every combination of separators", () => {
    const segs = ["a.md", "dir", "C:", "x y", "中文.md"];
    const seps = ["/", "\\"];
    for (const a of segs) {
      for (const b of segs) {
        for (const s1 of seps) {
          for (const s2 of seps) {
            const out = basename(`${a}${s1}${b}${s2}a.md`);
            expect(out).toBe("a.md");
          }
        }
      }
    }
  });
});

describe("call sites use basename, not a '/'-only split", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");
  it.each([
    "src/components/BottomTabs/BottomTabs.tsx",
    "src/hooks/useOpenUrlParam.ts",
    "src/hooks/useUpdater.ts",
  ])("%s", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/import \{ basename \} from "[./]+\/utils\/pathBasename"/);
    expect(src).not.toMatch(/\.split\("\/"\)/);
  });
});
