// @vitest-environment node
/**
 * D76-WI-2: collect Tauri bundle outputs into their final release-asset names.
 * Plan: `.claude/tdd-guardian/plan-d76-20261010-141631.md`, cases C1..C6, plus
 * the D-3 optional Windows/Linux rule. Real temp dirs as fake bundle trees.
 *
 * No law beyond byte identity of every copy (C1 checks it for each file); the
 * rest is a closed name mapping, specified by example and boundary.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OPTIONAL_PLATFORMS,
  REQUIRED_PLATFORMS,
  expectedAssets,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/release/assetNames.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as collectMain } from "../../scripts/release/collect-assets.mjs";

const SIG = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=";

let root: string;
let out: string[];
let err: string[];

const bundle = (triple: string) => path.join(root, "src-tauri", "target", triple, "release", "bundle");
const put = (file: string, content: string | Buffer) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const outDir = () => path.join(root, "dist-release");
const listOut = (platform: string): string[] => {
  const d = path.join(outDir(), platform);
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
};
const run = (argv: string[]): number =>
  collectMain(argv, { cwd: root, out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

/** A complete macOS bundle tree for one triple; returns the source paths. */
function macTree(triple: string, dmgName: string) {
  const b = bundle(triple);
  const archive = path.join(b, "macos", "mdpro.app.tar.gz");
  const sig = `${archive}.sig`;
  const dmg = path.join(b, "dmg", dmgName);
  put(archive, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00, 0x10]));
  put(sig, `${SIG}\n`);
  put(dmg, Buffer.from("dmg-bytes-\u0000\u0001"));
  fs.mkdirSync(path.join(b, "macos", "mdpro.app"), { recursive: true });
  return { archive, sig, dmg };
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d76-collect-")));
  out = [];
  err = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("expectedAssets / platform constants", () => {
  it("required updater platforms are exactly darwin-aarch64 and darwin-x86_64 (D-3)", () => {
    expect([...REQUIRED_PLATFORMS]).toEqual(["darwin-aarch64", "darwin-x86_64"]);
    expect([...OPTIONAL_PLATFORMS]).toEqual(["windows-x86_64", "linux-x86_64"]);
  });

  it("darwin-aarch64 → the v0.2.6 names, version from the argument", () => {
    expect(expectedAssets("darwin-aarch64", "0.3.1")).toEqual([
      "mdpro_aarch64.app.tar.gz",
      "mdpro_aarch64.app.tar.gz.sig",
      "mdpro_0.3.1_aarch64.dmg",
    ]);
  });

  it("darwin-x86_64 → mdpro_x64.* names", () => {
    expect(expectedAssets("darwin-x86_64", "0.3.1")).toEqual([
      "mdpro_x64.app.tar.gz",
      "mdpro_x64.app.tar.gz.sig",
      "mdpro_0.3.1_x64.dmg",
    ]);
  });

  it("windows-x86_64 → the NSIS installer and its sig", () => {
    expect(expectedAssets("windows-x86_64", "0.3.1")).toEqual([
      "mdpro_0.3.1_x64-setup.exe",
      "mdpro_0.3.1_x64-setup.exe.sig",
    ]);
  });

  it("an unknown platform throws", () => {
    expect(() => expectedAssets("darwin-arm64", "0.3.1")).toThrow(/platform/);
  });
});

describe("collect-assets CLI", () => {
  it("C1 aarch64 tree → three files with final names, byte-identical copies", () => {
    const src = macTree("aarch64-apple-darwin", "mdpro_0.3.1_aarch64.dmg");
    const code = run(["--platform", "darwin-aarch64", "--version", "0.3.1"]);
    expect(code).toBe(0);
    expect(listOut("darwin-aarch64")).toEqual(
      ["mdpro_0.3.1_aarch64.dmg", "mdpro_aarch64.app.tar.gz", "mdpro_aarch64.app.tar.gz.sig"].sort(),
    );
    const d = path.join(outDir(), "darwin-aarch64");
    expect(fs.readFileSync(path.join(d, "mdpro_aarch64.app.tar.gz")).equals(fs.readFileSync(src.archive))).toBe(true);
    expect(fs.readFileSync(path.join(d, "mdpro_aarch64.app.tar.gz.sig")).equals(fs.readFileSync(src.sig))).toBe(true);
    expect(fs.readFileSync(path.join(d, "mdpro_0.3.1_aarch64.dmg")).equals(fs.readFileSync(src.dmg))).toBe(true);
  });

  it("C2 x64 tree (target x86_64-apple-darwin) → mdpro_x64.* names", () => {
    macTree("x86_64-apple-darwin", "mdpro_0.3.1_x64.dmg");
    expect(run(["--platform", "darwin-x86_64", "--version", "0.3.1"])).toBe(0);
    expect(listOut("darwin-x86_64")).toEqual(
      ["mdpro_0.3.1_x64.dmg", "mdpro_x64.app.tar.gz", "mdpro_x64.app.tar.gz.sig"].sort(),
    );
  });

  it("C3 missing .sig → exit 1 naming mdpro.app.tar.gz.sig, and no partial set is written", () => {
    const src = macTree("aarch64-apple-darwin", "mdpro_0.3.1_aarch64.dmg");
    fs.rmSync(src.sig);
    expect(run(["--platform", "darwin-aarch64", "--version", "0.3.1"])).toBe(1);
    expect(err.join("\n")).toContain("mdpro.app.tar.gz.sig");
    expect(listOut("darwin-aarch64")).toEqual([]);
  });

  it.each([
    ["0-byte", ""],
    ["whitespace-only", " \n\t\n"],
  ])("C4 %s .sig → exit 1, nothing written", (_label, content) => {
    const src = macTree("aarch64-apple-darwin", "mdpro_0.3.1_aarch64.dmg");
    fs.writeFileSync(src.sig, content);
    expect(run(["--platform", "darwin-aarch64", "--version", "0.3.1"])).toBe(1);
    expect(err.join("\n")).toContain("mdpro.app.tar.gz.sig");
    expect(listOut("darwin-aarch64")).toEqual([]);
  });

  it("C5 two .app.tar.gz candidates (a stale bundle) → exit 1 listing both paths", () => {
    const src = macTree("aarch64-apple-darwin", "mdpro_0.3.1_aarch64.dmg");
    const stale = path.join(path.dirname(src.archive), "mdpro-old.app.tar.gz");
    put(stale, "old");
    put(`${stale}.sig`, SIG);
    expect(run(["--platform", "darwin-aarch64", "--version", "0.3.1"])).toBe(1);
    const msg = err.join("\n");
    expect(msg).toContain("mdpro.app.tar.gz");
    expect(msg).toContain("mdpro-old.app.tar.gz");
    expect(listOut("darwin-aarch64")).toEqual([]);
  });

  it("C6 dmg version comes from the argument, not a glob: tree has 0.3.0, version 0.3.1 → missing-file error", () => {
    macTree("aarch64-apple-darwin", "mdpro_0.3.0_aarch64.dmg");
    expect(run(["--platform", "darwin-aarch64", "--version", "0.3.1"])).toBe(1);
    expect(err.join("\n")).toContain("mdpro_0.3.1_aarch64.dmg");
    expect(listOut("darwin-aarch64")).toEqual([]);
  });

  it("C6b a stale second dmg next to the right one → exit 1 listing both", () => {
    const src = macTree("aarch64-apple-darwin", "mdpro_0.3.1_aarch64.dmg");
    put(path.join(path.dirname(src.dmg), "mdpro_0.3.0_aarch64.dmg"), "stale");
    expect(run(["--platform", "darwin-aarch64", "--version", "0.3.1"])).toBe(1);
    expect(err.join("\n")).toContain("mdpro_0.3.0_aarch64.dmg");
  });

  it("missing bundle tree for a required platform → exit 1", () => {
    expect(run(["--platform", "darwin-aarch64", "--version", "0.3.1"])).toBe(1);
    expect(listOut("darwin-aarch64")).toEqual([]);
  });

  it("D-3 Windows present with its sig → copied with its sig", () => {
    const b = bundle("x86_64-pc-windows-msvc");
    put(path.join(b, "nsis", "mdpro_0.3.1_x64-setup.exe"), "MZ");
    put(path.join(b, "nsis", "mdpro_0.3.1_x64-setup.exe.sig"), SIG);
    expect(run(["--platform", "windows-x86_64", "--version", "0.3.1"])).toBe(0);
    expect(listOut("windows-x86_64")).toEqual(["mdpro_0.3.1_x64-setup.exe", "mdpro_0.3.1_x64-setup.exe.sig"]);
  });

  it("D-3 Windows installer present without its sig → exit 1", () => {
    put(path.join(bundle("x86_64-pc-windows-msvc"), "nsis", "mdpro_0.3.1_x64-setup.exe"), "MZ");
    expect(run(["--platform", "windows-x86_64", "--version", "0.3.1"])).toBe(1);
    expect(err.join("\n")).toContain("mdpro_0.3.1_x64-setup.exe.sig");
    expect(listOut("windows-x86_64")).toEqual([]);
  });

  // rule 12: D127-WI-4 makes an optional platform all or none, so "an absent
  // one is not an error" (deb + AppImage without rpm → exit 0) is now the defect
  // itself. The case keeps its purpose (present installers copied with sigs) on
  // a complete Linux row; the partial row is specified to fail in
  // tests/tooling/release-optional-all-or-none.test.ts.
  it("D-3 Linux: present installers are copied with sigs (all three kinds present)", () => {
    const b = bundle("x86_64-unknown-linux-gnu");
    put(path.join(b, "deb", "mdpro_0.3.1_amd64.deb"), "deb");
    put(path.join(b, "deb", "mdpro_0.3.1_amd64.deb.sig"), SIG);
    put(path.join(b, "rpm", "mdpro-0.3.1-1.x86_64.rpm"), "rpm");
    put(path.join(b, "rpm", "mdpro-0.3.1-1.x86_64.rpm.sig"), SIG);
    put(path.join(b, "appimage", "mdpro_0.3.1_amd64.AppImage"), "img");
    put(path.join(b, "appimage", "mdpro_0.3.1_amd64.AppImage.sig"), SIG);
    expect(run(["--platform", "linux-x86_64", "--version", "0.3.1"])).toBe(0);
    expect(listOut("linux-x86_64")).toEqual(
      [
        "mdpro_0.3.1_amd64.AppImage",
        "mdpro_0.3.1_amd64.AppImage.sig",
        "mdpro_0.3.1_amd64.deb",
        "mdpro_0.3.1_amd64.deb.sig",
        "mdpro-0.3.1-1.x86_64.rpm",
        "mdpro-0.3.1-1.x86_64.rpm.sig",
      ].sort(),
    );
  });

  it("D-3 an optional platform with no outputs at all → exit 0, nothing written", () => {
    expect(run(["--platform", "windows-x86_64", "--version", "0.3.1"])).toBe(0);
    expect(listOut("windows-x86_64")).toEqual([]);
  });

  it("bad arguments → exit 1 with usage", () => {
    expect(run(["--platform", "darwin-aarch64"])).toBe(1);
    expect(run(["--platform", "plan9", "--version", "0.3.1"])).toBe(1);
    expect(run(["--platform", "darwin-aarch64", "--version", "v0.3.1"])).toBe(1);
    expect(err.join("\n")).toMatch(/usage/);
  });

  it("the real script runs as a process (entry wiring)", () => {
    macTree("aarch64-apple-darwin", "mdpro_0.3.1_aarch64.dmg");
    const script = path.resolve(__dirname, "../../scripts/release/collect-assets.mjs");
    const r = spawnSync(process.execPath, [script, "--platform", "darwin-aarch64", "--version", "0.3.1"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(listOut("darwin-aarch64")).toHaveLength(3);
  });
});
