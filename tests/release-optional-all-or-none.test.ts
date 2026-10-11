// @vitest-environment node
/**
 * D127-WI-4: an optional platform (D-3: Windows, Linux) is all or none. Its
 * files are either every one present or every one absent; a Linux `.deb`
 * without the `.rpm` (or the reverse) fails. Before the fix each optional
 * file was optional on its own, so a partial Linux row passed in all three
 * places checked here:
 *   (a) verifyAssetSet and the verify-assets CLI,
 *   (b) verify-release on a downloaded draft,
 *   (c) collect-assets in the build job.
 *
 * Law (S4, exhaustive): for every optional platform, the empty subset and the
 * full set of its files pass, and every other subset fails naming that
 * platform. Real temp trees and real minisign signatures; `gh` is the one
 * faked boundary (verify-release).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeMinisignKey } from "./support/minisignFixture";
import { REPO, completeSet, windowsFiles, writeRepoFiles, writeSet, type AssetFile } from "./support/releaseSet";
import { SHA, draftRelease, fakeGh, linuxFiles, verifiedSet, withFreshManifest } from "./support/releaseDraft";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { OPTIONAL_PLATFORMS, expectedAssets } from "../scripts/release/assetNames.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { verifyAssetSet } from "../scripts/release/assetSet.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyAssetsMain } from "../scripts/release/verify-assets.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyReleaseMain } from "../scripts/release/verify-release.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as collectMain } from "../scripts/release/collect-assets.mjs";

type SetResult = { ok: boolean; errors: string[] };
const key = makeMinisignKey();
const V = "0.3.1";
const MAC = completeSet(key, V);
const DEB = `mdpro_${V}_amd64.deb`;
const RPM = `mdpro-${V}-1.x86_64.rpm`;
const APPIMAGE = `mdpro_${V}_amd64.AppImage`;
const LINUX = linuxFiles(key, V);
const OPTIONAL: Record<string, AssetFile[]> = { "windows-x86_64": windowsFiles(key, V), "linux-x86_64": LINUX };
/** `files` minus `name` and its `.sig`. */
const drop = (files: AssetFile[], ...names: string[]) =>
  files.filter((f) => !names.some((n) => f.name === n || f.name === `${n}.sig`));
const msg = (r: SetResult) => r.errors.join("\n");

/** Every subset of `xs`, as index masks 0 .. 2^n - 1. */
const subsets = <T,>(xs: T[]): T[][] =>
  Array.from({ length: 1 << xs.length }, (_, m) => xs.filter((_x, i) => (m >> i) & 1));

describe("(a) verifyAssetSet: optional platforms are all or none", () => {
  it("control: macOS alone (every optional platform absent) and the full set both verify", () => {
    expect(verifyAssetSet(MAC, V)).toMatchObject({ ok: true, errors: [] });
    expect(verifyAssetSet([...MAC, ...OPTIONAL["windows-x86_64"], ...LINUX], V)).toMatchObject({ ok: true, errors: [] });
  });

  it("deb without rpm → not ok, naming the missing rpm", () => {
    const r = verifyAssetSet([...MAC, ...drop(LINUX, RPM)], V);
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain(`linux-x86_64: missing ${RPM}`);
  });

  it("rpm without deb → not ok, naming the missing deb", () => {
    const r = verifyAssetSet([...MAC, ...drop(LINUX, DEB)], V);
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain(`linux-x86_64: missing ${DEB}`);
  });

  it("the deb alone → not ok, naming both the rpm and the AppImage", () => {
    const r = verifyAssetSet([...MAC, ...drop(LINUX, RPM, APPIMAGE)], V);
    expect(r.ok).toBe(false);
    expect(msg(r)).toContain(`linux-x86_64: missing ${RPM}`);
    expect(msg(r)).toContain(`linux-x86_64: missing ${APPIMAGE}`);
  });

  it("the fixtures cover every optional platform the code defines", () => {
    expect(Object.keys(OPTIONAL).sort()).toEqual([...OPTIONAL_PLATFORMS].sort());
    for (const p of OPTIONAL_PLATFORMS) {
      expect(OPTIONAL[p].map((f) => f.name).sort(), p).toEqual([...expectedAssets(p, V)].sort());
    }
  });

  it("property: for every optional platform, only the empty and the full subset of its files pass (exhaustive)", () => {
    for (const p of OPTIONAL_PLATFORMS) {
      const all: AssetFile[] = OPTIONAL[p];
      for (const subset of subsets(all)) {
        const r = verifyAssetSet([...MAC, ...subset], V);
        const label = `${p}: [${subset.map((f) => f.name).join(", ")}]`;
        const whole = subset.length === 0 || subset.length === all.length;
        expect(r.ok, label).toBe(whole);
        if (!whole) expect(msg(r), label).toContain(`${p}: missing`);
      }
    }
  });
});

describe("(a) verify-assets CLI and (b) verify-release: a partial Linux row", () => {
  let root: string;
  let err: string[];
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d127-wi4-")));
    err = [];
    writeRepoFiles(root, key, { [V]: "### Fixed\n- a fix" });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const cli = (files: AssetFile[]) => {
    const dir = path.join(root, "artifacts");
    const outDir = path.join(root, "release-set");
    writeSet(dir, files);
    const code = verifyAssetsMain(["--dir", dir, "--version", V, "--repo", REPO, "--out", outDir], {
      cwd: root,
      out: () => {},
      err: (s: string) => err.push(s),
    });
    return { code, wrote: fs.existsSync(outDir) };
  };

  /** A draft verified with the full Linux row, then stripped of `names` (manifest recomputed so it is not what fails). */
  const release = (...names: string[]) => {
    const files = withFreshManifest(drop(verifiedSet(root, [...MAC, ...LINUX], V, "draft"), ...names));
    const calls: string[][] = [];
    const code = verifyReleaseMain(["--tag", `v${V}`, "--sha", SHA, "--repo", REPO], {
      cwd: root,
      env: {},
      out: () => {},
      err: (s: string) => err.push(s),
      runGh: fakeGh(calls, [draftRelease(`v${V}`, files)], files),
    });
    return { code, calls };
  };

  it("verify-assets control: the full Linux row → exit 0", () => {
    expect(cli([...MAC, ...LINUX]).code).toBe(0);
  });

  it.each([
    ["deb without rpm", RPM],
    ["rpm without deb", DEB],
  ])("verify-assets: %s → exit 1 naming %s, nothing written", (_label, missing) => {
    const r = cli([...MAC, ...drop(LINUX, missing)]);
    expect(r.code).toBe(1);
    expect(err.join("\n")).toContain(`linux-x86_64: missing ${missing}`);
    expect(r.wrote).toBe(false);
  });

  it("verify-release control: a draft with the full Linux row → exit 0", () => {
    expect(release().code).toBe(0);
  });

  it.each([
    ["deb without rpm", RPM],
    ["rpm without deb", DEB],
  ])("verify-release: a draft with %s → exit 1 naming %s", (_label, missing) => {
    const r = release(missing);
    expect(r.code).toBe(1);
    expect(err.join("\n")).toContain(`linux-x86_64: missing ${missing}`);
    expect(err.join("\n")).not.toContain("does not match");
  });
});

describe("(c) collect-assets: an optional platform's bundle outputs are all or none", () => {
  const SIG = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=";
  let root: string;
  let out: string[];
  let err: string[];
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d127-wi4c-")));
    out = [];
    err = [];
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const bundle = (triple: string) => path.join(root, "src-tauri", "target", triple, "release", "bundle");
  const put = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  /** Linux bundle kinds: [subdir, Tauri output name]. */
  const KINDS: [string, string][] = [
    ["deb", DEB],
    ["rpm", RPM],
    ["appimage", APPIMAGE],
  ];
  const linuxTree = (kinds: [string, string][]) => {
    for (const [dir, name] of kinds) {
      put(path.join(bundle("x86_64-unknown-linux-gnu"), dir, name), `${dir} bytes`);
      put(path.join(bundle("x86_64-unknown-linux-gnu"), dir, `${name}.sig`), SIG);
    }
  };
  const run = (platform: string) =>
    collectMain(["--platform", platform, "--version", V], {
      cwd: root,
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
    });
  const listOut = (platform: string): string[] => {
    const d = path.join(root, "dist-release", platform);
    return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
  };

  it.each([
    ["deb without rpm", "rpm", RPM],
    ["rpm without deb", "deb", DEB],
  ])("Linux %s → exit 1 naming %s's %s, nothing written", (_label, absentDir, missing) => {
    linuxTree(KINDS.filter(([d]) => d !== absentDir));
    expect(run("linux-x86_64")).toBe(1);
    expect(err.join("\n")).toContain(missing);
    expect(out.join("\n")).not.toMatch(/nothing collected/);
    expect(listOut("linux-x86_64")).toEqual([]);
  });

  it("Linux all present → exit 0, all six files collected", () => {
    linuxTree(KINDS);
    expect(run("linux-x86_64")).toBe(0);
    expect(listOut("linux-x86_64")).toEqual([...expectedAssets("linux-x86_64", V)].sort());
  });

  it("Linux all absent (the bundle exists, no outputs) → exit 0, nothing collected", () => {
    fs.mkdirSync(bundle("x86_64-unknown-linux-gnu"), { recursive: true });
    expect(run("linux-x86_64")).toBe(0);
    expect(out.join("\n")).toMatch(/nothing collected/);
    expect(listOut("linux-x86_64")).toEqual([]);
  });

  it("property: every proper, non-empty subset of the Linux kinds fails and writes nothing (exhaustive)", () => {
    const partial = subsets(KINDS).filter((s) => s.length > 0 && s.length < KINDS.length);
    expect(partial).toHaveLength(6);
    for (const kinds of partial) {
      fs.rmSync(path.join(root, "src-tauri"), { recursive: true, force: true });
      err = [];
      linuxTree(kinds);
      const label = kinds.map(([d]) => d).join("+");
      expect(run("linux-x86_64"), label).toBe(1);
      for (const [d, name] of KINDS) if (!kinds.some(([k]) => k === d)) expect(err.join("\n"), label).toContain(name);
      expect(listOut("linux-x86_64"), label).toEqual([]);
    }
  });

  it("Windows: the installer without its sig → exit 1; installer and sig → exit 0; neither → exit 0", () => {
    const nsis = path.join(bundle("x86_64-pc-windows-msvc"), "nsis");
    expect(run("windows-x86_64")).toBe(0);
    put(path.join(nsis, `mdpro_${V}_x64-setup.exe`), "MZ");
    expect(run("windows-x86_64")).toBe(1);
    expect(listOut("windows-x86_64")).toEqual([]);
    put(path.join(nsis, `mdpro_${V}_x64-setup.exe.sig`), SIG);
    expect(run("windows-x86_64")).toBe(0);
    expect(listOut("windows-x86_64")).toEqual([...expectedAssets("windows-x86_64", V)].sort());
  });
});
