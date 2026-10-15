// @vitest-environment node
/**
 * D127-WI-5: verify-release gets an explicit rehearsal check mode
 * (`--rehearsal --version X.Y.Z`) that runs the same target, byte and
 * signature checks on a `rehearsal-d76-<sha7>` draft, so a negative rehearsal
 * (a corrupted `.sig` in the rehearsal draft) reaches the signature check.
 * The may-publish decision still refuses every rehearsal tag, and the default
 * mode still refuses a rehearsal tag before reading a single asset.
 *
 * No law: a partition of (mode × tag kind × set state), specified at each
 * class (S2/S3). `gh` is the one faked boundary and the only asset reader, so
 * "zero asset reads" is "zero gh calls".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeMinisignKey, signTauri } from "../support/minisignFixture";
import { REPO, completeSet, replace, writeRepoFiles, type AssetFile } from "../support/releaseSet";
import { REHEARSAL_TAG, SHA, draftRelease, fakeGh, verifiedSet, withFreshManifest } from "../support/releaseDraft";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyReleaseMain } from "../../scripts/release/verify-release.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as gateMain, mayPublish } from "../../scripts/release/gate.mjs";

const key = makeMinisignKey();
const V = "0.3.1";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const ARCHIVE = "mdpro_aarch64.app.tar.gz";

let root: string;
let out: string[];
let err: string[];
let calls: string[][];
let good: AssetFile[];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d127-wi5-")));
  out = [];
  err = [];
  calls = [];
  writeRepoFiles(root, key, { [V]: "### Fixed\n- a fix" });
  good = verifiedSet(root, completeSet(key, V), V, "rehearsal-draft");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const run = (argv: string[], files: AssetFile[], release: object = draftRelease(REHEARSAL_TAG, files)) =>
  verifyReleaseMain([...argv, "--repo", REPO], {
    cwd: root,
    env: {},
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
    runGh: fakeGh(calls, [release], files),
  });
const rehearsal = (files: AssetFile[], release?: object) =>
  run(["--rehearsal", "--tag", REHEARSAL_TAG, "--sha", SHA, "--version", V], files, release);
const downloads = () => calls.filter((c) => c.some((a) => /releases\/assets\/\d+$/.test(a)));

/**
 * The good set with the aarch64 archive's `.sig` replaced by a well-formed
 * signature over other bytes, and latest.json and manifest.json made
 * consistent with it, so the signature check is the only one that can fail.
 */
function corruptedSig(): AssetFile[] {
  const bad = signTauri(key, Buffer.from("not the archive"));
  const latest = JSON.parse(good.find((f) => f.name === "latest.json")!.data.toString("utf8"));
  latest.platforms["darwin-aarch64"].signature = bad;
  const files = replace(replace(good, `${ARCHIVE}.sig`, bad), "latest.json", `${JSON.stringify(latest, null, 2)}\n`);
  return withFreshManifest(files);
}

describe("(a) rehearsal mode: a corrupted .sig", () => {
  it("→ exit 1 at the signature check, every asset downloaded first", () => {
    const files = corruptedSig();
    expect(rehearsal(files)).toBe(1);
    const text = err.join("\n");
    expect(text).toContain(`${ARCHIVE}: ${ARCHIVE}.sig does not verify`);
    expect(text).not.toContain("signature does not match");
    expect(text).not.toContain("manifest.json does not match");
    expect(text).not.toMatch(/never publishable/);
    expect(downloads()).toHaveLength(files.length);
  });
});

describe("(b) rehearsal mode: a good set", () => {
  it("→ exit 0, saying the checks passed and the draft is never publishable", () => {
    expect(rehearsal(good)).toBe(0);
    expect(out.join("\n")).toContain(`${REHEARSAL_TAG}: rehearsal draft pinned to ${SHA} verified`);
    expect(out.join("\n")).toMatch(/never publishable/);
    expect(downloads()).toHaveLength(good.length);
  });

  it("every gh call is a read: `gh api` with no method or field flags", () => {
    rehearsal(good);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c[0]).toBe("api");
      expect(c.filter((a) => ["-X", "--method", "-f", "-F", "--field", "--raw-field", "--input"].includes(a))).toEqual([]);
    }
  });

  it("the may-publish decision still refuses the rehearsal tag, even with every check reported ok", () => {
    expect(rehearsal(good)).toBe(0);
    for (const mode of ["rehearsal-draft", "draft"]) {
      expect(mayPublish({ mode, tag: REHEARSAL_TAG, postUploadOk: true, verifyReleaseOk: true }).ok, mode).toBe(false);
      const code = gateMain(["may-publish", "--mode", mode, "--tag", REHEARSAL_TAG, "--post-upload", "ok", "--verify-release", "ok"], {
        out: () => {},
        err: (s: string) => err.push(s),
      });
      expect(code, mode).toBe(1);
    }
    expect(err.join("\n")).toMatch(/not publishable/);
  });

  it("the target check runs: target_commitish ≠ --sha → exit 1 naming the target", () => {
    expect(rehearsal(good, draftRelease(REHEARSAL_TAG, good, { target_commitish: OTHER_SHA }))).toBe(1);
    expect(err.join("\n")).toMatch(/target/);
  });

  it("the byte check runs: an asset whose size differs from manifest.json → exit 1", () => {
    const files = replace(good, `mdpro_${V}_aarch64.dmg`, "a different dmg, longer than the verified one");
    expect(rehearsal(files)).toBe(1);
    expect(err.join("\n")).toContain(`mdpro_${V}_aarch64.dmg`);
  });
});

describe("rehearsal mode refuses what is not a rehearsal check, before any gh call", () => {
  it.each([
    ["a v* tag", ["--rehearsal", "--tag", `v${V}`, "--sha", SHA, "--version", V]],
    ["a rehearsal tag for another SHA", ["--rehearsal", "--tag", "rehearsal-d76-fedcba9", "--sha", SHA, "--version", V]],
    ["no --version", ["--rehearsal", "--tag", REHEARSAL_TAG, "--sha", SHA]],
    ["a --version that is not X.Y.Z", ["--rehearsal", "--tag", REHEARSAL_TAG, "--sha", SHA, "--version", "v0.3.1"]],
    ["a short --sha", ["--rehearsal", "--tag", REHEARSAL_TAG, "--sha", SHA.slice(0, 7), "--version", V]],
  ])("%s → exit 1, no gh call", (_label, argv) => {
    expect(run(argv, good)).toBe(1);
    expect(calls).toHaveLength(0);
  });
});

describe("(c) default mode: a rehearsal tag is refused before any asset is read", () => {
  it("a good rehearsal draft → exit 1, 'never publishable', zero gh calls and zero downloads", () => {
    expect(run(["--tag", REHEARSAL_TAG, "--sha", SHA], good)).toBe(1);
    expect(err.join("\n")).toMatch(/rehearsal drafts are never publishable/);
    expect(calls).toEqual([]);
    expect(downloads()).toEqual([]);
  });

  it("a corrupted rehearsal draft → the same refusal, zero gh calls (the signature is never reached)", () => {
    expect(run(["--tag", REHEARSAL_TAG, "--sha", SHA], corruptedSig())).toBe(1);
    expect(err.join("\n")).not.toContain("does not verify");
    expect(calls).toEqual([]);
  });

  it("--version is a rehearsal-mode argument; default mode refuses it with no gh call", () => {
    expect(run(["--tag", `v${V}`, "--sha", SHA, "--version", V], good, draftRelease(`v${V}`, good))).toBe(1);
    expect(calls).toEqual([]);
  });

  it("control: default mode on a v* draft of the same good bytes is unchanged → exit 0", () => {
    const set = verifiedSet(root, completeSet(key, V), V, "draft");
    expect(run(["--tag", `v${V}`, "--sha", SHA], set, draftRelease(`v${V}`, set))).toBe(0);
    expect(out.join("\n")).toContain(`v${V}: draft pinned to ${SHA} verified`);
    expect(out.join("\n")).not.toMatch(/never publishable/);
  });
});
