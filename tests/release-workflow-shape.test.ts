// @vitest-environment node
/**
 * D76-WI-6: static shape of `.github/workflows/release.yml` (requirements ①–⑤,
 * ADR-0073 auto-publish). Plan `.claude/tdd-guardian/plan-d76-20261010-141631.md`,
 * cases W1–W15 with the WI-6 REVISION variants (W3′, W7′, W13–W15), plus the
 * pinned per-row `--bundles` set and an injection check on `run:` blocks.
 *
 * actionlint is not installed, so this is the local substitute; GitHub's own
 * parser is only met at dispatch (WI-8 R1b). Expression syntax is not checked.
 *
 * The law this file pins (W13 with W2 and gate.mayPublish's G7): no mode but
 * `draft` reaches the one `--draft=false`, because the publish job's `if:` is a
 * literal `inputs.mode == 'draft'` with no `||`, and it needs the draft job.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPTIONAL_PLATFORMS,
  PLATFORM_SPECS,
  REQUIRED_PLATFORMS,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/release/assetNames.mjs";
import { at, items, job, jobIds, keys, list, parentKey, scalar, stepRun, steps, topLevel } from "./support/workflowBlocks";

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, ".github", "workflows", "release.yml");
const TEXT = fs.readFileSync(FILE, "utf8");
const LINES = TEXT.split("\n");

const PREFLIGHT_SHA = "${{ needs.preflight.outputs.sha }}";
/** collect-assets.mjs default `--out`; every uploaded artifact lives under it. */
const OUT_DIR = "dist-release/";

const jobText = (id: string) => job(TEXT, id) ?? "";
const jobSteps = (id: string) => steps(jobText(id));
const runs = (id: string) => jobSteps(id).map((s) => stepRun(s) ?? "");
const usesOf = (s: string) => scalar(s, "uses") ?? "";
const allSteps = () => jobIds(TEXT).flatMap((id) => jobSteps(id).map((s) => ({ id, s })));
const count = (re: RegExp) => (TEXT.match(new RegExp(re.source, "g")) ?? []).length;
const stepIndex = (id: string, re: RegExp) => runs(id).findIndex((r) => re.test(r));

/** Does `flag` in this step's run take the preflight SHA, inline or via a step/job env var? */
function flagTakesPreflightSha(step: string, jobId: string, flag: string): boolean {
  const run = stepRun(step) ?? "";
  const m = run.match(new RegExp(`${flag}[ =]+("?)([^\\s"]+)\\1`));
  if (!m) return false;
  if (m[2] === PREFLIGHT_SHA) return true;
  const v = m[2].match(/^\$\{?([A-Z_][A-Z0-9_]*)\}?$/);
  if (!v) return false;
  const fromEnv = (t: string | null) => scalar(at(t, ["env"]), v[1]);
  return (fromEnv(step) ?? fromEnv(jobText(jobId))) === PREFLIGHT_SHA;
}

describe("trigger and inputs", () => {
  it("W1 runs only on workflow_dispatch: no push, schedule or release trigger", () => {
    expect(keys(topLevel(TEXT, "on") ?? "")).toEqual(["workflow_dispatch"]);
    expect(TEXT).not.toMatch(/^\s*(push|schedule|release|pull_request):/m);
  });

  it("W2 ref and version are required with no default; mode is a build-only-default choice of exactly three", () => {
    const inputs = at(TEXT, ["on", "workflow_dispatch", "inputs"]);
    expect(new Set(keys(inputs ?? ""))).toEqual(new Set(["ref", "version", "mode"]));
    for (const k of ["ref", "version"]) {
      expect(scalar(at(inputs, [k]), "required")).toBe("true");
      expect(scalar(at(inputs, [k]), "default")).toBeNull();
    }
    const mode = at(inputs, ["mode"]);
    expect(scalar(mode, "type")).toBe("choice");
    expect(scalar(mode, "default")).toBe("build-only");
    expect(list(mode, "options")?.slice().sort()).toEqual(["build-only", "draft", "rehearsal-draft"]);
  });
});

describe("jobs, permissions and concurrency", () => {
  it("has exactly the five jobs of the one-run order", () => {
    expect(jobIds(TEXT)).toEqual(["preflight", "build", "verify", "draft", "publish"]);
  });

  it("W4 one constant concurrency group, never cancelled in progress", () => {
    const c = topLevel(TEXT, "concurrency");
    expect(scalar(c, "group")).toBe("release");
    expect(scalar(c, "cancel-in-progress")).toBe("false");
    expect(c).not.toContain("${{");
  });

  it("W7′ top level is contents: read only; contents: write only in jobs draft and publish", () => {
    const top = topLevel(TEXT, "permissions") ?? "";
    expect(keys(top)).toEqual(["contents"]);
    expect(scalar(top, "contents")).toBe("read");
    expect(TEXT).not.toMatch(/actions:\s*write/);
    const writers = jobIds(TEXT).filter((id) => scalar(at(jobText(id), ["permissions"]), "contents") === "write");
    expect(writers).toEqual(["draft", "publish"]);
    expect(count(/contents:\s*write/)).toBe(2);
    expect(TEXT).not.toMatch(/write-all|permissions:\s*write/);
  });

  it("W8 build needs preflight; verify needs build; every later job checks out the preflight SHA", () => {
    expect(list(jobText("build"), "needs")).toContain("preflight");
    expect(list(jobText("verify"), "needs")).toEqual(expect.arrayContaining(["preflight", "build"]));
    for (const id of ["build", "verify", "draft", "publish"]) {
      const co = jobSteps(id).filter((s) => usesOf(s).startsWith("actions/checkout@"));
      expect(co.length, id).toBe(1);
      expect(scalar(at(co[0], ["with"]), "ref"), id).toBe(PREFLIGHT_SHA);
    }
    const pre = jobSteps("preflight").filter((s) => usesOf(s).startsWith("actions/checkout@"));
    expect(scalar(at(pre[0], ["with"]), "ref")).toBe("${{ inputs.ref }}");
    expect(TEXT).not.toContain("github.ref");
    expect(runs("build").some((r) => /git rev-parse HEAD/.test(r))).toBe(true);
  });

  it("W7 draft needs preflight and verify, and its if: excludes build-only", () => {
    expect(list(jobText("draft"), "needs")).toEqual(expect.arrayContaining(["preflight", "verify"]));
    const cond = scalar(jobText("draft"), "if") ?? "";
    expect(cond).toMatch(/inputs\.mode\s*!=\s*'build-only'/);
    expect(cond).not.toContain("||");
  });

  it("W13 publish needs draft, and its if: is the literal mode == 'draft' with no ||", () => {
    expect(list(jobText("publish"), "needs")).toEqual(expect.arrayContaining(["preflight", "draft"]));
    const cond = scalar(jobText("publish"), "if") ?? "";
    expect(cond).toContain("inputs.mode == 'draft'");
    expect(cond).not.toContain("||");
    expect(cond).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
  });
});

describe("the publish path", () => {
  it("W3′ --draft=false appears once, in publish, after verify-release and may-publish", () => {
    expect(count(/--draft=false/)).toBe(1);
    const at3 = stepIndex("publish", /--draft=false/);
    const verify = stepIndex("publish", /node scripts\/release\/verify-release\.mjs/);
    const gate = stepIndex("publish", /node scripts\/release\/gate\.mjs may-publish/);
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(verify);
    expect(at3).toBeGreaterThan(gate);
    expect(TEXT).not.toMatch(/draft:\s*false/);
    expect(TEXT).not.toContain("gh release delete");
  });

  it("W3′ gh release edit appears only in publish, and only as the publish call", () => {
    const edits = allSteps().filter(({ s }) => (stepRun(s) ?? "").includes("gh release edit"));
    expect(edits.map((e) => e.id)).toEqual(["publish"]);
    expect(count(/gh release edit/)).toBe(1);
  });

  it("W14 verify-release gets --sha from preflight; gh release create gets --target from preflight", () => {
    const vr = jobSteps("publish").find((s) => (stepRun(s) ?? "").includes("verify-release.mjs"));
    expect(vr && flagTakesPreflightSha(vr, "publish", "--sha")).toBe(true);
    const cr = jobSteps("draft").find((s) => (stepRun(s) ?? "").includes("gh release create"));
    expect(cr && flagTakesPreflightSha(cr, "draft", "--target")).toBe(true);
  });

  it("W11 no tauri-action or action-gh-release; gh release create only in draft, with --draft and --target", () => {
    expect(TEXT).not.toContain("tauri-apps/tauri-action");
    expect(TEXT).not.toContain("softprops/action-gh-release");
    const creates = allSteps().filter(({ s }) => (stepRun(s) ?? "").includes("gh release create"));
    expect(creates.map((c) => c.id)).toEqual(["draft"]);
    const run = stepRun(creates[0].s) ?? "";
    expect(run).toMatch(/--draft(\s|$)/);
    expect(run).toContain("--target");
  });

  it("draft re-lists every release for the tag (drafts included) and runs gate decide before creating", () => {
    const decide = stepIndex("draft", /node scripts\/release\/gate\.mjs decide/);
    const create = stepIndex("draft", /gh release create/);
    const post = stepIndex("draft", /node scripts\/release\/gate\.mjs post-upload/);
    expect(decide).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(decide);
    expect(post).toBeGreaterThan(create);
    const d = runs("draft")[decide];
    expect(d).toMatch(/gh api --paginate\s+"?repos\/\$\{?GITHUB_REPOSITORY\}?\/releases/);
    expect(d).toContain("--published-for-tag");
    expect(runs("draft")[post]).toContain("--manifest");
    expect(runs("draft")[post]).toContain("--assets");
  });
});

describe("forbidden constructs", () => {
  it("W5 no || true and no continue-on-error anywhere", () => {
    expect(TEXT).not.toMatch(/\|\|\s*true/);
    expect(TEXT).not.toContain("continue-on-error");
  });

  it("W6 no release or tag deletion, no git push, no git tag", () => {
    for (const s of ["gh release delete", "--cleanup-tag", "git push", "git tag"]) expect(TEXT).not.toContain(s);
  });

  it("W9 no step rewrites a version file", () => {
    expect(TEXT).not.toMatch(/sed\s+-i/);
    expect(TEXT).not.toMatch(/\.version\s*=/);
    expect(TEXT).not.toContain("writeFileSync");
  });

  it("W10 every scripts/release/*.mjs the workflow names exists", () => {
    const refs = [...new Set(TEXT.match(/scripts\/release\/[\w.-]+\.mjs/g) ?? [])];
    expect(refs.length).toBeGreaterThanOrEqual(5);
    for (const r of refs) expect(fs.existsSync(path.join(ROOT, r)), r).toBe(true);
  });

  it("stays under 300 lines", () => {
    expect(LINES.length).toBeLessThan(300);
  });
});

describe("build job", () => {
  const matrix = () => items(at(jobText("build"), ["strategy", "matrix", "include"]) ?? "");

  it("W12 an explicit empty-signing-key guard precedes tauri build", () => {
    const guard = jobSteps("build").findIndex(
      (s) => /-z\s+"\$\{?TAURI_SIGNING_PRIVATE_KEY\}?"/.test(stepRun(s) ?? "") && /exit 1/.test(stepRun(s) ?? ""),
    );
    const build = stepIndex("build", /pnpm tauri build/);
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(guard);
    expect(scalar(at(jobSteps("build")[guard], ["env"]), "TAURI_SIGNING_PRIVATE_KEY")).toBe(
      "${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
    );
  });

  it("matrix rows are exactly assetNames' platforms, each with its triple", () => {
    const rows = matrix();
    expect(rows.map((r) => scalar(r, "platform")).sort()).toEqual([...REQUIRED_PLATFORMS, ...OPTIONAL_PLATFORMS].sort());
    for (const r of rows) {
      const p = scalar(r, "platform") as string;
      expect(scalar(r, "rust_target"), p).toBe(PLATFORM_SPECS[p].triple);
      expect(scalar(r, "sidecar_triple"), p).toBe(PLATFORM_SPECS[p].triple);
    }
  });

  // Changed after red (rule 12): the red pinned linux "deb,appimage" from a wrong instruction.
  // v0.2.6 shipped an .rpm + .rpm.sig, and assetNames.mjs expects one, so linux pins rpm too.
  it("each row's --bundles is pinned: darwin app,dmg; windows nsis; linux deb,appimage,rpm", () => {
    const want: Record<string, string> = {
      "darwin-aarch64": "app,dmg",
      "darwin-x86_64": "app,dmg",
      "windows-x86_64": "nsis",
      "linux-x86_64": "deb,appimage,rpm",
    };
    const dirOf: Record<string, string> = { app: "macos", dmg: "dmg", nsis: "nsis", deb: "deb", appimage: "appimage", rpm: "rpm" };
    for (const r of matrix()) {
      const p = scalar(r, "platform") as string;
      const bundles = scalar(r, "bundles") ?? "";
      expect(bundles, p).toBe(want[p]);
      const specDirs = new Set(PLATFORM_SPECS[p].files.map((f: { dir: string }) => f.dir));
      for (const b of bundles.split(",")) expect(specDirs.has(dirOf[b]), `${p} ${b}`).toBe(true);
    }
    const build = runs("build")[stepIndex("build", /pnpm tauri build/)];
    expect(build).toContain("--target ${{ matrix.rust_target }}");
    expect(build).toContain("--bundles ${{ matrix.bundles }}");
  });

  it("collects with collect-assets.mjs before uploading the platform's artifact", () => {
    const collect = stepIndex("build", /node scripts\/release\/collect-assets\.mjs --platform/);
    const upload = jobSteps("build").findIndex((s) => usesOf(s).startsWith("actions/upload-artifact@"));
    expect(collect).toBeGreaterThan(stepIndex("build", /pnpm tauri build/));
    expect(upload).toBeGreaterThan(collect);
  });

  it("verify writes the release set with --out (verify-assets is check-only without it)", () => {
    expect(runs("verify").some((r) => /node scripts\/release\/verify-assets\.mjs .*--out /.test(r))).toBe(true);
  });
});

describe("W15 secrets and artifacts on a public repo", () => {
  it("${{ secrets.* }} appears only as the whole value of a key directly under env:", () => {
    const hits = LINES.map((l, i) => ({ l, i })).filter(({ l }) => l.includes("secrets."));
    expect(hits.length).toBeGreaterThan(0);
    for (const { l, i } of hits) {
      expect(l, `line ${i + 1}`).toMatch(/^\s+[A-Z_][A-Z0-9_]*:\s*\$\{\{\s*secrets\.[A-Z_]+\s*\}\}\s*$/);
      expect(parentKey(TEXT, i), `line ${i + 1}`).toBe("env");
    }
  });

  it("no run: block uses set -x or echoes/prints a secret variable", () => {
    for (const { id, s } of allSteps()) {
      const run = stepRun(s) ?? "";
      expect(run, id).not.toMatch(/set\s+-[a-z]*x/);
      for (const line of run.split("\n")) {
        expect(line, id).not.toMatch(/\b(echo|printf)\b.*\$\{?(TAURI_SIGNING_\w*|GITHUB_TOKEN|GH_TOKEN)\b/);
      }
    }
  });

  it("no run: block interpolates ${{ inputs.* }} or ${{ secrets.* }} (script injection)", () => {
    for (const { id, s } of allSteps()) expect(stepRun(s) ?? "", id).not.toMatch(/\$\{\{\s*(inputs|secrets|github\.event)\./);
  });

  it("every upload-artifact path is under the collect-assets output directory", () => {
    const uploads = allSteps().filter(({ s }) => usesOf(s).startsWith("actions/upload-artifact@"));
    expect(uploads.length).toBeGreaterThanOrEqual(2);
    for (const { id, s } of uploads) {
      const p = scalar(at(s, ["with"]), "path") ?? "";
      expect(p.startsWith(OUT_DIR), `${id}: ${p}`).toBe(true);
      expect(p, id).not.toMatch(/\.\.|~|src-tauri|\n/);
    }
  });
});
