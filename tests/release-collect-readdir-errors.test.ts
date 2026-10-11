// @vitest-environment node
/**
 * D127-WI-3: collect-assets lists each bundle subdirectory, and only ENOENT
 * (the directory is not there) means "no files". Any other readdir error —
 * ENOTDIR, EACCES, EIO — must fail the collect with the error code in the
 * message, for required and optional platforms alike. Before the fix every
 * error read as "no files", so an optional platform whose bundle dir could
 * not be read was silently skipped. Real temp trees, no fs mocks.
 *
 * No law: a partition of readdir outcomes (absent / readable / unreadable),
 * specified at each class (S2/S3).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as collectMain } from "../scripts/release/collect-assets.mjs";

const SIG = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

let root: string;
let out: string[];
let err: string[];
const restore: string[] = [];

const bundle = (triple: string) => path.join(root, "src-tauri", "target", triple, "release", "bundle");
const relBundle = (triple: string, sub: string) => path.join("src-tauri", "target", triple, "release", "bundle", sub);
const put = (file: string, content: string | Buffer) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const listOut = (platform: string): string[] => {
  const d = path.join(root, "dist-release", platform);
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
};
const run = (platform: string): number =>
  collectMain(["--platform", platform, "--version", "0.3.1"], {
    cwd: root,
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d127-wi3-")));
  out = [];
  err = [];
});
afterEach(() => {
  for (const d of restore.splice(0)) fs.chmodSync(d, 0o755);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("collect-assets: a bundle subdirectory that cannot be listed", () => {
  it("required platform: `dmg` is a file, not a directory → exit 1 naming ENOTDIR and the path", () => {
    const b = bundle("aarch64-apple-darwin");
    put(path.join(b, "macos", "mdpro.app.tar.gz"), Buffer.from([0x1f, 0x8b]));
    put(path.join(b, "macos", "mdpro.app.tar.gz.sig"), SIG);
    put(path.join(b, "dmg"), "not a directory");
    expect(run("darwin-aarch64")).toBe(1);
    const text = err.join("\n");
    expect(text).toContain("ENOTDIR");
    expect(text).toContain(relBundle("aarch64-apple-darwin", "dmg"));
    expect(listOut("darwin-aarch64")).toEqual([]);
  });

  it("optional platform: Windows `nsis` is a file → exit 1 naming ENOTDIR, not 'nothing collected'", () => {
    put(path.join(bundle("x86_64-pc-windows-msvc"), "nsis"), "not a directory");
    expect(run("windows-x86_64")).toBe(1);
    expect(err.join("\n")).toContain("ENOTDIR");
    expect(err.join("\n")).toContain(relBundle("x86_64-pc-windows-msvc", "nsis"));
    expect(out.join("\n")).not.toMatch(/nothing collected/);
  });

  it("optional platform: Linux `rpm` is a file beside readable deb/appimage dirs → exit 1, nothing written", () => {
    const b = bundle("x86_64-unknown-linux-gnu");
    put(path.join(b, "deb", "mdpro_0.3.1_amd64.deb"), "deb");
    put(path.join(b, "deb", "mdpro_0.3.1_amd64.deb.sig"), SIG);
    put(path.join(b, "appimage", "mdpro_0.3.1_amd64.AppImage"), "img");
    put(path.join(b, "appimage", "mdpro_0.3.1_amd64.AppImage.sig"), SIG);
    put(path.join(b, "rpm"), "not a directory");
    expect(run("linux-x86_64")).toBe(1);
    expect(err.join("\n")).toContain("ENOTDIR");
    expect(listOut("linux-x86_64")).toEqual([]);
  });

  it.skipIf(isRoot)("optional platform: an unreadable `nsis` dir (mode 000) → exit 1 naming EACCES", () => {
    const nsis = path.join(bundle("x86_64-pc-windows-msvc"), "nsis");
    put(path.join(nsis, "mdpro_0.3.1_x64-setup.exe"), "MZ");
    put(path.join(nsis, "mdpro_0.3.1_x64-setup.exe.sig"), SIG);
    fs.chmodSync(nsis, 0o000);
    restore.push(nsis);
    expect(run("windows-x86_64")).toBe(1);
    expect(err.join("\n")).toContain("EACCES");
    expect(listOut("windows-x86_64")).toEqual([]);
  });
});

describe("collect-assets: ENOENT still means absent", () => {
  it("optional platform: the bundle exists but `nsis` does not → exit 0, nothing collected", () => {
    fs.mkdirSync(bundle("x86_64-pc-windows-msvc"), { recursive: true });
    expect(run("windows-x86_64")).toBe(0);
    expect(out.join("\n")).toMatch(/nothing collected/);
    expect(listOut("windows-x86_64")).toEqual([]);
  });

  it("required platform with no bundle tree → exit 1 as 'missing', with no readdir error code", () => {
    expect(run("darwin-aarch64")).toBe(1);
    const text = err.join("\n");
    expect(text).toMatch(/missing/);
    expect(text).not.toMatch(/ENOENT|ENOTDIR|EACCES/);
  });
});
