// @vitest-environment node
/**
 * D175-WI-2: a released build must say which release it is. release.yml's
 * app build step sets `MDPRO_RELEASE_ID=<version>@<preflight 40-hex SHA>`
 * (and no other step does, so the sidecar never changes), and verify-release
 * refuses a draft whose macOS app binary (`Contents/MacOS/tauri-app` inside
 * each `.app.tar.gz`) does not carry that exact string.
 *
 * Partition: archive state (good POSIX / good GNU / no id / id only in the
 * sidecar / id in a decoy file / id of another SHA, sha7 or version / not
 * gzip / no tauri-app / truncated / absent) × which arch, then the same check
 * wired into verify-release (default and rehearsal mode), then the workflow
 * shape. `gh` is the one faked boundary; the archives are real gzip + tar.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appTarball, tar, type TarEntry } from "../support/appTarball";
import { makeMinisignKey } from "../support/minisignFixture";
import { REPO, completeSet, writeRepoFiles, type AssetFile } from "../support/releaseSet";
import { REHEARSAL_TAG, SHA, draftRelease, fakeGh, verifiedSet } from "../support/releaseDraft";
import { at, job, scalar, stepRun, steps } from "../support/workflowBlocks";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { MAIN_BINARY, checkReleaseId, findMainBinary, releaseIdArchives, releaseIdFor } from "../../scripts/release/releaseId.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyReleaseMain } from "../../scripts/release/verify-release.mjs";

const V = "0.3.1";
const ID = `${V}@${SHA}`;
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const AARCH = "mdpro_aarch64.app.tar.gz";
const X64 = "mdpro_x64.app.tar.gz";

let dir: string;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d175-")));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const put = (name: string, data: Buffer) => fs.writeFileSync(path.join(dir, name), data);
const check = () => checkReleaseId({ dir, version: V, sha: SHA });
/** Both archives good, then `name` replaced by `data`. */
function setWith(name?: string, data?: Buffer) {
  put(AARCH, appTarball("aarch64", { releaseId: ID }));
  put(X64, appTarball("x64", { releaseId: ID }));
  if (name && data) put(name, data);
}
/** The Tauri layout written with GNU magic and slash-less dir names, as `tar -tvzf` shows the real archive. */
const gnuTarball = (binary: string, extra: TarEntry[] = []) =>
  zlib.gzipSync(
    tar(
      [
        { name: "mdpro.app", dir: true },
        { name: "mdpro.app/Contents", dir: true },
        { name: "mdpro.app/Contents/MacOS", dir: true },
        ...extra,
        { name: "mdpro.app/Contents/MacOS/mdpro_mcp", data: "sidecar" },
        { name: "mdpro.app/Contents/MacOS/tauri-app", data: binary },
      ],
      true,
    ),
  );

describe("releaseIdFor and the archives it is checked in", () => {
  it("the id is exactly <version>@<sha>", () => {
    expect(releaseIdFor(V, SHA)).toBe(`0.3.1@${SHA}`);
    expect(releaseIdFor("1.2.3-rc.1", OTHER_SHA)).toBe(`1.2.3-rc.1@${OTHER_SHA}`);
  });

  it("is checked in both macOS updater archives, in the main binary tauri-app", () => {
    expect([...releaseIdArchives()].sort()).toEqual([AARCH, X64]);
    expect(MAIN_BINARY).toBe("tauri-app");
  });
});

describe("findMainBinary", () => {
  it("returns the tauri-app bytes of a POSIX ustar archive", () => {
    const r = findMainBinary(appTarball("aarch64", { releaseId: ID }));
    expect(r.error).toBeUndefined();
    expect(Buffer.from(r.data).toString("latin1")).toContain(`fake aarch64 tauri-app ${ID} rest of rodata`);
  });

  it("returns the tauri-app bytes of a GNU archive, not the sidecar's", () => {
    const r = findMainBinary(gnuTarball(`bin ${ID}`));
    expect(Buffer.from(r.data).toString("latin1")).toBe(`bin ${ID}`);
  });
});

describe("checkReleaseId", () => {
  it("both archives carry the id → ok, no errors", () => {
    setWith();
    expect(check()).toMatchObject({ ok: true, errors: [], releaseId: ID });
  });

  it("the real (GNU) layout carrying the id → ok", () => {
    setWith(AARCH, gnuTarball(`x ${ID} y`));
    expect(check().ok).toBe(true);
  });

  it("a binary built without MDPRO_RELEASE_ID → fail naming the archive, tauri-app and the id", () => {
    setWith(AARCH, appTarball("aarch64"));
    const r = check();
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain(AARCH);
    expect(r.errors[0]).toContain("tauri-app");
    expect(r.errors[0]).toContain(ID);
    expect(r.errors[0]).toContain("MDPRO_RELEASE_ID");
  });

  it("the id only in the sidecar → fail (the app binary is what is checked)", () => {
    setWith(X64, appTarball("x64", { sidecar: `sidecar ${ID}` }));
    const r = check();
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain(X64);
    expect(r.errors.join("\n")).not.toContain(AARCH);
  });

  it("the id only in a decoy file named tauri-app outside Contents/MacOS → fail", () => {
    setWith(AARCH, gnuTarball("no id here", [{ name: "mdpro.app/Contents/Resources/tauri-app", data: ID }]));
    expect(check().ok).toBe(false);
  });

  it.each([
    ["another SHA", `${V}@${OTHER_SHA}`],
    ["the short SHA", `${V}@${SHA.slice(0, 7)}`],
    ["another version", `0.3.0@${SHA}`],
    ["the old buildId default", "unknown"],
  ])("a binary carrying %s → fail", (_label, embedded) => {
    setWith(AARCH, appTarball("aarch64", { releaseId: embedded }));
    expect(check().ok).toBe(false);
  });

  it("bytes that are not gzip → fail naming the archive", () => {
    setWith(X64, Buffer.from("\u001f\u008b fake x64 app tarball"));
    const r = check();
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(new RegExp(`${X64}.*gzip`));
  });

  it("an archive with no Contents/MacOS/tauri-app → fail naming tauri-app", () => {
    const noBin = zlib.gzipSync(tar([{ name: "mdpro.app/Contents/MacOS/mdpro", data: ID }]));
    setWith(AARCH, noBin);
    const r = check();
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/Contents\/MacOS\/tauri-app/);
  });

  it("a tar cut off inside tauri-app → fail, even though the id's bytes are present", () => {
    const whole = tar([{ name: "mdpro.app/Contents/MacOS/tauri-app", data: `${ID}${"x".repeat(2000)}` }]);
    setWith(AARCH, zlib.gzipSync(whole.subarray(0, 512 + 1024)));
    expect(check().ok).toBe(false);
  });

  it("an archive that is absent → fail naming it", () => {
    setWith();
    fs.rmSync(path.join(dir, X64));
    const r = check();
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain(X64);
  });
});

describe("verify-release checks the release id of the downloaded draft", () => {
  const key = makeMinisignKey();
  let out: string[];
  let err: string[];
  let calls: string[][];
  beforeEach(() => {
    out = [];
    err = [];
    calls = [];
    writeRepoFiles(dir, key, { [V]: "### Fixed\n- a fix" });
  });
  const run = (argv: string[], files: AssetFile[], tag: string) =>
    verifyReleaseMain([...argv, "--repo", REPO], {
      cwd: dir,
      env: {},
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
      runGh: fakeGh(calls, [draftRelease(tag, files)], files),
    });
  const publishRun = (files: AssetFile[]) => run(["--tag", `v${V}`, "--sha", SHA], files, `v${V}`);

  it("a draft whose binaries carry <version>@<sha> → exit 0, naming the id", () => {
    const set = verifiedSet(dir, completeSet(key, V), V, "draft");
    expect(publishRun(set)).toBe(0);
    expect(out.join("\n")).toContain(`release id ${ID}`);
  });

  it("a signed, consistent draft built without MDPRO_RELEASE_ID → exit 1 at the release-id check only", () => {
    const set = verifiedSet(dir, completeSet(key, V, "unknown"), V, "draft");
    expect(publishRun(set)).toBe(1);
    const text = err.join("\n");
    expect(text).toContain(ID);
    expect(text).toContain("MDPRO_RELEASE_ID");
    expect(text).not.toContain("does not verify");
    expect(text).not.toContain("manifest.json does not match");
  });

  it("a draft pinned to SHA whose binaries were built from another commit → exit 1", () => {
    const set = verifiedSet(dir, completeSet(key, V, `${V}@${OTHER_SHA}`), V, "draft");
    expect(publishRun(set)).toBe(1);
    expect(err.join("\n")).toContain(ID);
  });

  it("rehearsal mode runs the same check", () => {
    const set = verifiedSet(dir, completeSet(key, V, "unknown"), V, "rehearsal-draft");
    expect(run(["--rehearsal", "--tag", REHEARSAL_TAG, "--sha", SHA, "--version", V], set, REHEARSAL_TAG)).toBe(1);
    expect(err.join("\n")).toContain(ID);
  });
});

describe("release.yml sets MDPRO_RELEASE_ID on the app build only", () => {
  const TEXT = fs.readFileSync(path.resolve(__dirname, "..", "..", ".github", "workflows", "release.yml"), "utf8");
  const build = steps(job(TEXT, "build"));
  const appBuild = build.find((s) => scalar(s, "name") === "Build and sign (uploads nothing)") ?? "";

  it("the app build step's env carries <preflight version>@<preflight full SHA>", () => {
    expect(stepRun(appBuild)).toMatch(/pnpm tauri build/);
    expect(scalar(at(appBuild, ["env"]), "MDPRO_RELEASE_ID")).toBe(
      "${{ needs.preflight.outputs.version }}@${{ needs.preflight.outputs.sha }}",
    );
  });

  it("no other step, job or workflow env sets it, so the sidecar build never sees it", () => {
    expect(TEXT.match(/MDPRO_RELEASE_ID/g)).toHaveLength(1);
    const sidecar = build.filter((s) => /--bin mdpro_mcp/.test(stepRun(s) ?? ""));
    expect(sidecar).toHaveLength(3);
    for (const s of sidecar) expect(s).not.toContain("MDPRO_RELEASE_ID");
  });

  it("leaves the ADR-0047 buildId alone: release.yml never sets MDPRO_BUILD_ID", () => {
    expect(TEXT).not.toContain("MDPRO_BUILD_ID");
  });
});
