// @vitest-environment node
/**
 * D127-WI-1: an input `latest.json` that parses to a non-object (`null`, a
 * number, a string, an array, a boolean) must fail verify-assets. Before the
 * fix, `null` was the "did not parse" sentinel, so a latest.json holding the
 * literal `null` skipped validation entirely and verified.
 *
 * No law: a closed partition of JSON value kinds, enumerated (S2) — every
 * non-object kind is listed, and the object kind is the existing passing case.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeMinisignKey } from "../support/minisignFixture";
import { REPO, completeSet, writeRepoFiles } from "../support/releaseSet";
import { SHA, draftRelease, fakeGh, verifiedSet, withFreshManifest } from "../support/releaseDraft";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyAssetsMain } from "../../scripts/release/verify-assets.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyReleaseMain } from "../../scripts/release/verify-release.mjs";

const key = makeMinisignKey();

/** Each non-object JSON text and the kind the error must name. */
const NON_OBJECTS: [string, string][] = [
  ["null", "null"],
  ["0", "a number"],
  ["42", "a number"],
  ['"latest"', "a string"],
  ["[]", "an array"],
  ['[{"version":"0.3.1"}]', "an array"],
  ["true", "a boolean"],
  ["false", "a boolean"],
];

let root: string;
let err: string[];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d127-wi1-")));
  err = [];
  writeRepoFiles(root, key, { "0.3.1": "### Fixed\n- a fix" });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** A verified release set on disk with latest.json replaced by `text` and no manifest.json beside it. */
function setWithLatest(text: string): string {
  const dir = path.join(root, "downloaded");
  fs.mkdirSync(dir);
  for (const f of verifiedSet(root, completeSet(key, "0.3.1"), "0.3.1", "draft")) {
    if (f.name === "manifest.json") continue;
    fs.writeFileSync(path.join(dir, f.name), f.name === "latest.json" ? text : f.data);
  }
  return dir;
}

const checkOnly = (dir: string) =>
  verifyAssetsMain(["--dir", dir, "--version", "0.3.1", "--repo", REPO], {
    cwd: root,
    out: () => {},
    err: (s: string) => err.push(s),
  });

describe("verify-assets: an input latest.json that is not a JSON object", () => {
  it("control: the same set with its real latest.json verifies (so the set itself is good)", () => {
    const dir = setWithLatest("");
    fs.rmSync(path.join(dir, "latest.json"));
    expect(checkOnly(dir)).toBe(0);
  });

  it.each(NON_OBJECTS)("latest.json = %s → exit 1 naming it as %s", (text, kind) => {
    expect(checkOnly(setWithLatest(text))).toBe(1);
    expect(err.join("\n")).toContain(`input latest.json is ${kind}, not a JSON object`);
  });

  it("latest.json that is not JSON at all still fails as before", () => {
    expect(checkOnly(setWithLatest("{nope"))).toBe(1);
    expect(err.join("\n")).toContain("input latest.json is not valid JSON");
  });
});

describe("verify-release: a draft whose latest.json is the literal null", () => {
  it("manifest consistent with the null latest.json → exit 1, the latest.json check is what refuses", () => {
    const good = verifiedSet(root, completeSet(key, "0.3.1"), "0.3.1", "draft");
    const files = withFreshManifest(good.map((f) => (f.name === "latest.json" ? { name: f.name, data: Buffer.from("null") } : f)));
    const calls: string[][] = [];
    const code = verifyReleaseMain(["--tag", "v0.3.1", "--sha", SHA, "--repo", REPO], {
      cwd: root,
      env: {},
      out: () => {},
      err: (s: string) => err.push(s),
      runGh: fakeGh(calls, [draftRelease("v0.3.1", files)], files),
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("input latest.json is null, not a JSON object");
    expect(err.join("\n")).not.toContain("manifest.json does not match");
  });
});
