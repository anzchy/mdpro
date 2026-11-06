// @vitest-environment node
/** GH657: a real Vitest fixture proves inverse build-dependent skipIf registration. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { artifactName, checkCollected, checkShardLists } from "../../scripts/ci/shard-reports.mjs";

const ROOT = path.resolve(__dirname, "../..");
const SHA = "a".repeat(40);

function vitest(args: string[]) {
  return new Promise<{ status: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "vitest", ...args], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

it("shows an equal-count false pass when two inverse skipIf predicates read a build artifact", async () => {
  const fixtureDir = fs.mkdtempSync(path.join(ROOT, "tests/tooling/gh657-fixture-"));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "gh657-inverse-"));
  const artifact = path.join(fixtureDir, "built.txt");
  const testFile = path.join(fixtureDir, "inverse.test.ts");
  const listedPath = path.join(scratch, "listed.json");
  const reportPath = path.join(scratch, "report.json");
  const fixture = `import fs from "node:fs";\nimport { describe, it, expect } from "vitest";\nconst built = fs.existsSync(${JSON.stringify(artifact)});\ndescribe("build-dependent", () => {\n  it.skipIf(built)("listed-only without build", () => expect(true).toBe(true));\n  it.skipIf(!built)("started-only with build", () => expect(true).toBe(true));\n});\n`;
  try {
    fs.writeFileSync(testFile, fixture);
    const relative = path.relative(ROOT, testFile);
    const list = await vitest(["list", relative, `--json=${listedPath}`]);
    expect(list.status, list.stderr).toBe(0);
    fs.writeFileSync(artifact, "built");
    const run = await vitest(["run", relative, "--reporter=json", `--outputFile.json=${reportPath}`]);
    expect(run.status, run.stderr).toBe(0);
    const listed = JSON.parse(fs.readFileSync(listedPath, "utf8")) as Array<{ file: string; name: string }>;
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as unknown;
    expect(listed.map((row) => row.name)).toEqual(["build-dependent > listed-only without build"]);
    expect(checkCollected(report, listed, ROOT)).toEqual({ files: 1, tests: 1 });
    const downloads = path.join(scratch, "downloads");
    for (let shard = 1; shard <= 4; shard++) {
      const dir = path.join(downloads, artifactName("ubuntu-latest", shard, 1));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, ".ci-shard.json"), JSON.stringify({ os: "ubuntu-latest", shard, count: 4, attempt: 1, profile: "ubuntu+rustfmt", sha: SHA }));
      fs.writeFileSync(path.join(dir, ".ci-vitest-tests.json"), JSON.stringify(shard === 1 ? listed : []));
    }
    let error = "";
    try { checkShardLists(downloads, 4, "ubuntu-latest", report, ROOT); } catch (cause) { error = String(cause); }
    expect(error).toContain("listed-only without build");
    expect(error).toContain("started-only with build");
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}, 30_000);
