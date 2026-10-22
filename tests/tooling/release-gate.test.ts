// @vitest-environment node
/**
 * D76-WI-5 (as revised by the plan's "D76-WI-5 REVISION" block, ADR-0073):
 * the draft gate, the post-upload check, the publish gate and the read-only
 * `verify-release.mjs` that re-verifies the uploaded draft before publishing.
 *
 * Laws:
 * - A draft is created only for a green verify + green source + a draft mode
 *   + no published release for the tag (G1′, enumerated).
 * - Publishing is allowed exactly when mode = draft, the tag is vX.Y.Z and both
 *   checks are strictly `true` (G7, enumerated cross product). No
 *   rehearsal-draft row is ever publishable (D-7).
 * - verify-release passes only a draft pinned to the expected SHA, with no
 *   published release for the tag, whose downloaded bytes pass verify-assets
 *   (G5, G9), and it makes no state-changing call.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeMinisignKey } from "../support/minisignFixture";
import { REPO, completeSet, replace, writeRepoFiles, writeSet, type AssetFile } from "../support/releaseSet";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { verifyAssetSet } from "../../scripts/release/assetSet.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyAssetsMain } from "../../scripts/release/verify-assets.mjs";
import {
  checkDraftRelease,
  decide,
  main as gateMain,
  manifestWithSelf,
  mayPublish,
  postUpload,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/release/gate.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyReleaseMain } from "../../scripts/release/verify-release.mjs";
import { collectionCases } from "../support/collectionCases";

type Gh = { status: number; stdout: Buffer | string; stderr: string };
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const GREEN = { ok: true, sha: SHA, tag: "v0.3.1" };
const RED = { ok: false, sha: null, tag: null };
const MODES = ["build-only", "draft", "rehearsal-draft"] as const;
const key = makeMinisignKey();

// ---------------------------------------------------------------------------
describe("decide (G1′, G2, G3)", () => {
  const rows = MODES.flatMap((mode) =>
    [true, false].flatMap((verifyOk) =>
      [true, false].flatMap((sourceOk) => [true, false].map((publishedForTag) => ({ mode, verifyOk, sourceOk, publishedForTag }))),
    ),
  );

  it("G1′ enumerates 24 rows", () => {
    expect(rows).toHaveLength(24);
  });

  it.each(collectionCases("tests/tooling/release-gate.test.ts:60", rows))("G1′ %j", ({ mode, verifyOk, sourceOk, publishedForTag }) => {
    const r = decide({ mode, verifyOk, source: sourceOk ? GREEN : RED, publishedForTag });
    const green = verifyOk && sourceOk && !publishedForTag && mode !== "build-only";
    expect(r.createDraft).toBe(green);
    expect(r).not.toHaveProperty("publish");
    if (green) expect(r.draftTag).toBe(mode === "draft" ? "v0.3.1" : "rehearsal-d76-0123456");
  });

  it("G1′ publishedForTag true → no draft in every mode, even when everything else is green", () => {
    for (const mode of MODES) {
      expect(decide({ mode, verifyOk: true, source: GREEN, publishedForTag: true }).createDraft).toBe(false);
    }
  });

  it("publishedForTag missing → no draft (fail closed)", () => {
    expect(decide({ mode: "draft", verifyOk: true, source: GREEN }).createDraft).toBe(false);
  });

  it("G2 a build failure (verify never ran → verifyOk false) → no draft in every mode", () => {
    for (const mode of MODES) {
      expect(decide({ mode, verifyOk: false, source: GREEN, publishedForTag: false }).createDraft).toBe(false);
    }
  });

  it("G3 a signing failure (empty sig → the asset set fails) → no draft", () => {
    const set = completeSet(key, "0.3.1");
    const verifyOk = verifyAssetSet(replace(set, "mdpro_x64.app.tar.gz.sig", ""), "0.3.1").ok;
    expect(verifyOk).toBe(false);
    expect(decide({ mode: "draft", verifyOk, source: GREEN, publishedForTag: false }).createDraft).toBe(false);
  });

  it.each([
    [{ verifyOk: "true" }],
    [{ verifyOk: 1 }],
    [{ source: { ...GREEN, ok: "true" } }],
    [{ source: null }],
    [{ mode: "Draft" }],
    [{ mode: "publish" }],
  ])("non-strict or unknown input %j → no draft, no throw", (over) => {
    const r = decide({ mode: "draft", verifyOk: true, source: GREEN, publishedForTag: false, ...over });
    expect(r.createDraft).toBe(false);
  });

  it("rehearsal-draft tag is rehearsal-d76-<sha7>, never v*", () => {
    const r = decide({ mode: "rehearsal-draft", verifyOk: true, source: { ...GREEN, sha: OTHER_SHA }, publishedForTag: false });
    expect(r).toEqual({ createDraft: true, draftTag: "rehearsal-d76-fedcba9" });
  });
});

// ---------------------------------------------------------------------------
describe("postUpload (G4)", () => {
  const manifest = [
    { name: "a.dmg", size: 10, sha256: "a".repeat(64) },
    { name: "latest.json", size: 3, sha256: "b".repeat(64) },
  ];
  const assets = () => [
    { name: "a.dmg", size: 10, digest: `sha256:${"a".repeat(64)}` },
    { name: "latest.json", size: 3, digest: `sha256:${"b".repeat(64)}` },
  ];

  it("exact match → ok", () => {
    expect(postUpload({ manifest, draftAssets: assets() })).toEqual({ ok: true, errors: [] });
  });

  it("no digest field (older API responses) → names and sizes still decide; ok", () => {
    const a = assets().map(({ name, size }) => ({ name, size }));
    expect(postUpload({ manifest, draftAssets: a }).ok).toBe(true);
    const nul = assets().map((x) => ({ ...x, digest: null }));
    expect(postUpload({ manifest, draftAssets: nul }).ok).toBe(true);
  });

  it("missing asset → fail naming it", () => {
    const r = postUpload({ manifest, draftAssets: assets().slice(0, 1) });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("latest.json");
  });

  it("extra asset → fail naming it", () => {
    const r = postUpload({ manifest, draftAssets: [...assets(), { name: "x.zip", size: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("x.zip");
  });

  it("size off by one → fail", () => {
    const a = assets();
    a[0].size = 11;
    expect(postUpload({ manifest, draftAssets: a }).ok).toBe(false);
  });

  it("digest mismatch → fail; a non-sha256 digest → fail", () => {
    const a = assets();
    a[1].digest = `sha256:${"c".repeat(64)}`;
    expect(postUpload({ manifest, draftAssets: a }).ok).toBe(false);
    const b = assets();
    b[1].digest = `md5:${"b".repeat(32)}`;
    expect(postUpload({ manifest, draftAssets: b }).ok).toBe(false);
  });

  it("an asset name twice → fail", () => {
    expect(postUpload({ manifest, draftAssets: [...assets(), assets()[0]] }).ok).toBe(false);
  });

  it.each([
    [{ manifest: null, draftAssets: [] }],
    [{ manifest: [], draftAssets: "x" }],
    [{ manifest: [], draftAssets: [] }],
  ])("malformed or empty input %j → fail, no throw", (input) => {
    expect(postUpload(input).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("mayPublish (G7)", () => {
  const TAGS = ["v0.3.1", "v0.3.10", "rehearsal-d76-abc1234", "0.3.1", "v0.3.1-rc1", "v0.3", "", " v0.3.1"];
  const FLAGS: unknown[] = [true, false, "true", undefined];
  const VALID_TAGS = new Set(["v0.3.1", "v0.3.10"]);
  const rows = MODES.flatMap((mode) =>
    TAGS.flatMap((tag) =>
      FLAGS.flatMap((postUploadOk) => FLAGS.map((verifyReleaseOk) => ({ mode, tag, postUploadOk, verifyReleaseOk }))),
    ),
  );

  it("G7 the cross product has 384 rows and exactly 2 publishable ones", () => {
    expect(rows).toHaveLength(384);
    const ok = rows.filter((r) => mayPublish(r).ok === true);
    expect(ok).toEqual([
      { mode: "draft", tag: "v0.3.1", postUploadOk: true, verifyReleaseOk: true },
      { mode: "draft", tag: "v0.3.10", postUploadOk: true, verifyReleaseOk: true },
    ]);
  });

  it("G7 every row: ok ⇔ draft ∧ valid v-tag ∧ both flags strictly true; refusals carry a reason", () => {
    for (const r of rows) {
      const want = r.mode === "draft" && VALID_TAGS.has(r.tag) && r.postUploadOk === true && r.verifyReleaseOk === true;
      const got = mayPublish(r);
      expect(got.ok, JSON.stringify(r)).toBe(want);
      if (!want) expect(typeof got.reason === "string" && got.reason.length > 0, JSON.stringify(r)).toBe(true);
    }
  });

  it("G7 no rehearsal-draft row is publishable (D-7)", () => {
    expect(rows.filter((r) => r.mode === "rehearsal-draft").some((r) => mayPublish(r).ok)).toBe(false);
  });

  it.each([null, undefined, "x", 3])("malformed input %j → not ok, no throw", (input) => {
    expect(mayPublish(input).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("checkDraftRelease (G9)", () => {
  const draft = { tag_name: "v0.3.1", draft: true, target_commitish: SHA };

  it("G9 all good → ok", () => {
    expect(checkDraftRelease({ release: draft, sha: SHA, publishedForTag: false })).toEqual({ ok: true, errors: [] });
  });

  it("G9 target mismatch → error", () => {
    const r = checkDraftRelease({ release: { ...draft, target_commitish: OTHER_SHA }, sha: SHA, publishedForTag: false });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/target/);
  });

  it("G9 a branch-name target → error", () => {
    expect(checkDraftRelease({ release: { ...draft, target_commitish: "master" }, sha: SHA, publishedForTag: false }).ok).toBe(false);
  });

  it.each([SHA.slice(0, 7), "", undefined, SHA.toUpperCase(), `${SHA}0`])("G9 short, absent or malformed sha %j → error", (sha) => {
    expect(checkDraftRelease({ release: { ...draft, target_commitish: sha }, sha, publishedForTag: false }).ok).toBe(false);
  });

  it("G9 not a draft → error", () => {
    const r = checkDraftRelease({ release: { ...draft, draft: false }, sha: SHA, publishedForTag: false });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/draft/);
  });

  it("G9 already published for the tag → error", () => {
    const r = checkDraftRelease({ release: draft, sha: SHA, publishedForTag: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/published/);
  });

  it.each([null, undefined, "x"])("G9 release %j → error, no throw", (release) => {
    expect(checkDraftRelease({ release, sha: SHA, publishedForTag: false }).ok).toBe(false);
  });

  it("G9 publishedForTag not strictly false → error (fail closed)", () => {
    expect(checkDraftRelease({ release: draft, sha: SHA }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("gate.mjs CLI (G8)", () => {
  let tmp: string;
  let err: string[];
  const io = (env: Record<string, string> = {}) => ({ cwd: tmp, env, out: () => {}, err: (s: string) => err.push(s) });

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d76-gate-")));
    err = [];
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const mp = (mode: string, tag: string, pu = "ok", vr = "ok") =>
    gateMain(["may-publish", "--mode", mode, "--tag", tag, "--post-upload", pu, "--verify-release", vr], io());

  it("G8 may-publish: a valid draft row → exit 0", () => {
    expect(mp("draft", "v0.3.1")).toBe(0);
  });

  it("G8 may-publish: a rehearsal row → exit 1", () => {
    expect(mp("rehearsal-draft", "rehearsal-d76-abc1234")).toBe(1);
    expect(mp("rehearsal-draft", "v0.3.1")).toBe(1);
  });

  it("G8 may-publish: a non-v* tag → exit 1", () => {
    expect(mp("draft", "0.3.1")).toBe(1);
  });

  it("G8 may-publish: a failed or unknown check → exit 1", () => {
    expect(mp("draft", "v0.3.1", "fail")).toBe(1);
    expect(mp("draft", "v0.3.1", "ok", "fail")).toBe(1);
    expect(mp("draft", "v0.3.1", "true")).toBe(1);
    expect(gateMain(["may-publish", "--mode", "draft", "--tag", "v0.3.1"], io())).toBe(1);
  });

  it("decide: green draft → exit 0 and writes create_draft/draft_tag to GITHUB_OUTPUT", () => {
    const outFile = path.join(tmp, "out.txt");
    const code = gateMain(
      ["decide", "--mode", "draft", "--verify", "ok", "--source", "ok", "--sha", SHA, "--tag", "v0.3.1", "--published-for-tag", "false"],
      io({ GITHUB_OUTPUT: outFile }),
    );
    expect(code).toBe(0);
    const text = fs.readFileSync(outFile, "utf8");
    expect(text).toContain("create_draft=true");
    expect(text).toContain("draft_tag=v0.3.1");
  });

  it("decide: a published release for the tag → exit 1, no draft", () => {
    const outFile = path.join(tmp, "out.txt");
    const code = gateMain(
      ["decide", "--mode", "draft", "--verify", "ok", "--source", "ok", "--sha", SHA, "--tag", "v0.3.1", "--published-for-tag", "true"],
      io({ GITHUB_OUTPUT: outFile }),
    );
    expect(code).toBe(1);
    expect(fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "").not.toContain("create_draft=true");
  });

  it("post-upload: matching manifest/assets files → 0; a size mismatch → 1", () => {
    const manifest = [{ name: "a.dmg", size: 2, sha256: "a".repeat(64) }];
    fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(tmp, "assets.json"), JSON.stringify([{ name: "a.dmg", size: 2 }]));
    const args = ["post-upload", "--manifest", "manifest.json", "--assets", "assets.json"];
    expect(gateMain(args, io())).toBe(0);
    fs.writeFileSync(path.join(tmp, "assets.json"), JSON.stringify([{ name: "a.dmg", size: 3 }]));
    expect(gateMain(args, io())).toBe(1);
  });

  it("post-upload: unreadable input → exit 1", () => {
    expect(gateMain(["post-upload", "--manifest", "nope.json", "--assets", "nope.json"], io())).toBe(1);
  });

  it("an unknown subcommand or no subcommand → exit 1 with usage", () => {
    expect(gateMain(["publish"], io())).toBe(1);
    expect(gateMain([], io())).toBe(1);
    expect(err.join("\n")).toMatch(/usage/);
  });
});

// ---------------------------------------------------------------------------
describe("verify-release.mjs (G5, G9 wired, read-only)", () => {
  let root: string;
  let draftFiles: AssetFile[];
  let calls: string[][];
  let err: string[];

  /** A draft's files as the verify job produced them: 6 assets + latest.json + manifest.json. */
  const buildDraftFiles = (): AssetFile[] => {
    const art = path.join(root, "artifacts");
    const outDir = path.join(root, "release-set");
    writeSet(art, completeSet(key, "0.3.1"));
    const code = verifyAssetsMain(["--dir", art, "--version", "0.3.1", "--repo", REPO, "--mode", "draft", "--out", outDir], {
      cwd: root,
      out: () => {},
      err: () => {},
    });
    expect(code).toBe(0);
    const files = fs.readdirSync(outDir).map((name) => ({ name, data: fs.readFileSync(path.join(outDir, name)) }));
    fs.rmSync(art, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
    return files;
  };

  const release = (over: Record<string, unknown> = {}, files = draftFiles) => ({
    id: 77,
    tag_name: "v0.3.1",
    draft: true,
    target_commitish: SHA,
    assets: files.map((f, i) => ({ id: 1000 + i, name: f.name, size: f.data.length })),
    ...over,
  });

  /** Fake gh: the release list (filtered by tag via --jq, NDJSON) and asset downloads by id. */
  const fakeGh = (releases: object[], files = draftFiles, fail = false) => (args: string[]): Gh => {
    calls.push(args);
    if (fail) return { status: 1, stdout: "", stderr: "HTTP 500" };
    const assetPath = args.find((a) => /releases\/assets\/\d+$/.test(a));
    if (assetPath) {
      const id = Number(assetPath.split("/").pop());
      const f = files[id - 1000];
      return f ? { status: 0, stdout: f.data, stderr: "" } : { status: 1, stdout: "", stderr: "HTTP 404" };
    }
    return { status: 0, stdout: releases.map((r) => JSON.stringify(r)).join("\n"), stderr: "" };
  };

  const run = (args: string[], gh: (a: string[]) => Gh) =>
    verifyReleaseMain(["--repo", REPO, ...args], { cwd: root, env: {}, out: () => {}, err: (s: string) => err.push(s), runGh: gh });

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d76-vrel-")));
    writeRepoFiles(root, key, { "0.3.1": "### Fixed\n- a fix" });
    draftFiles = buildDraftFiles();
    calls = [];
    err = [];
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("a draft pinned to the SHA whose bytes verify → exit 0", () => {
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release()]))).toBe(0);
  });

  it("G5 a rehearsal tag → exit 1, 'never publishable', no gh call", () => {
    expect(run(["--tag", "rehearsal-d76-abc1234", "--sha", SHA], fakeGh([release()]))).toBe(1);
    expect(err.join("\n")).toMatch(/rehearsal drafts are never publishable/);
    expect(calls).toHaveLength(0);
  });

  it.each(["0.3.1", "v0.3.1-rc1", "v0.3", "latest"])("a non-v* tag %j → exit 1, no gh call", (tag) => {
    expect(run(["--tag", tag, "--sha", SHA], fakeGh([release()]))).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it.each([[[]], [["--sha", SHA.slice(0, 7)]], [["--sha", SHA.toUpperCase()]]])(
    "--sha absent or not 40 lowercase hex %j → exit 1, no gh call",
    (extra) => {
      expect(run(["--tag", "v0.3.1", ...extra], fakeGh([release()]))).toBe(1);
      expect(calls).toHaveLength(0);
    },
  );

  it("G9 wired: target_commitish ≠ --sha → exit 1", () => {
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release({ target_commitish: OTHER_SHA })]))).toBe(1);
    expect(err.join("\n")).toMatch(/target/);
  });

  it("G9 wired: the only release for the tag is published → exit 1", () => {
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release({ draft: false })]))).toBe(1);
  });

  it("G9 wired: a published release exists beside the draft → exit 1", () => {
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release(), release({ id: 78, draft: false })]))).toBe(1);
    expect(err.join("\n")).toMatch(/published/);
  });

  it("no release for the tag, or two drafts → exit 1", () => {
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([]))).toBe(1);
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release(), release({ id: 78 })]))).toBe(1);
  });

  it("downloaded bytes that differ from the manifest → exit 1", () => {
    const tampered = draftFiles.map((f) => (f.name.endsWith(".dmg") ? { name: f.name, data: Buffer.from("other bytes") } : f));
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release({}, tampered)], tampered))).toBe(1);
  });

  it("a draft missing latest.json → exit 1", () => {
    const files = draftFiles.filter((f) => f.name !== "latest.json");
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release({}, files)], files))).toBe(1);
  });

  it("a gh failure → exit 1 (fail closed)", () => {
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release()], draftFiles, true))).toBe(1);
  });

  it("read-only: every gh call is a GET `gh api` call", () => {
    expect(run(["--tag", "v0.3.1", "--sha", SHA], fakeGh([release()]))).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c[0]).toBe("api");
      expect(c.join(" ")).not.toMatch(/(-X|--method)\s*(?!GET)\w+/);
      expect(c).not.toContain("release");
    }
  });
});

// ---------------------------------------------------------------------------
describe("static scan (G6)", () => {
  const dir = path.resolve(__dirname, "../../scripts/release");
  const sources = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"));

  it("finds the release scripts", () => {
    expect(sources).toEqual(expect.arrayContaining(["gate.mjs", "verify-release.mjs", "verify-assets.mjs"]));
  });

  it.each(collectionCases("tests/tooling/release-gate.test.ts:464", sources))("G6 %s has no --draft=false and no `release edit`", (f) => {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    expect(text).not.toContain("--draft=false");
    expect(text).not.toMatch(/release\s+edit/);
  });

  it("G6 verify-release.mjs makes no state-changing gh release call", () => {
    const text = fs.readFileSync(path.join(dir, "verify-release.mjs"), "utf8");
    expect(text).not.toMatch(/release\s+(create|edit|delete|upload)/);
  });
});

// ---------------------------------------------------------------------------
// Added after the red: manifest.json is itself a draft asset. GitHub reports a
// sha256 `digest` for every asset, so its expected entry must carry the file's
// own sha256, or a real draft would always fail the post-upload check.
describe("manifest.json as a draft asset (added)", () => {
  const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
  const entries = [{ name: "a.dmg", size: 2, sha256: "a".repeat(64) }];
  const bytes = Buffer.from(JSON.stringify(entries));

  it("manifestWithSelf appends manifest.json's own size and sha256", () => {
    expect(manifestWithSelf(entries, bytes)).toEqual([
      ...entries,
      { name: "manifest.json", size: bytes.length, sha256: sha(bytes) },
    ]);
  });

  it("manifestWithSelf leaves a malformed manifest malformed (postUpload then fails)", () => {
    expect(postUpload({ manifest: manifestWithSelf(null, bytes), draftAssets: [] }).ok).toBe(false);
  });

  it("post-upload CLI: a draft that carries manifest.json with its real digest → 0; a wrong digest → 1", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d76-gate-self-")));
    try {
      fs.writeFileSync(path.join(tmp, "manifest.json"), bytes);
      const draft = (digest: string) => [
        { name: "a.dmg", size: 2, digest: `sha256:${"a".repeat(64)}` },
        { name: "manifest.json", size: bytes.length, digest },
      ];
      const args = ["post-upload", "--manifest", "manifest.json", "--assets", "assets.json"];
      const io = { cwd: tmp, env: {}, out: () => {}, err: () => {} };
      fs.writeFileSync(path.join(tmp, "assets.json"), JSON.stringify(draft(`sha256:${sha(bytes)}`)));
      expect(gateMain(args, io)).toBe(0);
      fs.writeFileSync(path.join(tmp, "assets.json"), JSON.stringify(draft(`sha256:${"0".repeat(64)}`)));
      expect(gateMain(args, io)).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  describe("verify-release with GitHub digests on every asset", () => {
    let root: string;
    const vkey = makeMinisignKey();
    const runWith = (mutate: (a: { name: string; digest: string }[]) => void) => {
      const art = path.join(root, "artifacts");
      const outDir = path.join(root, "release-set");
      writeSet(art, completeSet(vkey, "0.3.1"));
      verifyAssetsMain(["--dir", art, "--version", "0.3.1", "--repo", REPO, "--out", outDir], {
        cwd: root,
        out: () => {},
        err: () => {},
      });
      const files = fs.readdirSync(outDir).map((name) => ({ name, data: fs.readFileSync(path.join(outDir, name)) }));
      const assets = files.map((f, i) => ({ id: 2000 + i, name: f.name, size: f.data.length, digest: `sha256:${sha(f.data)}` }));
      mutate(assets);
      const rel = { tag_name: "v0.3.1", draft: true, target_commitish: SHA, assets };
      const gh = (args: string[]): Gh => {
        const p = args.find((a) => /releases\/assets\/\d+$/.test(a));
        if (p) return { status: 0, stdout: files[Number(p.split("/").pop()) - 2000].data, stderr: "" };
        return { status: 0, stdout: JSON.stringify(rel), stderr: "" };
      };
      return verifyReleaseMain(["--tag", "v0.3.1", "--sha", SHA, "--repo", REPO], {
        cwd: root,
        env: {},
        out: () => {},
        err: () => {},
        runGh: gh,
      });
    };

    beforeEach(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d76-vrel-digest-")));
      writeRepoFiles(root, vkey, { "0.3.1": "### Fixed\n- a fix" });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("every asset with its true digest, manifest.json included → exit 0", () => {
      expect(runWith(() => {})).toBe(0);
    });

    it("one asset whose reported digest differs from the manifest → exit 1", () => {
      expect(runWith((a) => (a.find((x) => x.name.endsWith(".dmg"))!.digest = `sha256:${"0".repeat(64)}`))).toBe(1);
    });
  });
});
