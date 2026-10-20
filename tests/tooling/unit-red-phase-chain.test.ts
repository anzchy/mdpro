// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 30_000 });
const repo = resolve(import.meta.dirname, "../..");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));
function scenario(name: string) {
  const script = join(repo, "tests/tooling/fixtures/unit-red/fix1-phase-cases.mjs");
  const result = spawnSync(process.execPath, [script, name, repo], { cwd: repo, encoding: "utf8", timeout: 60_000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { red: { status: number; kind: string }; green: { status: number; verdict: string } | null };
}
describe.skipIf(!plugin)("fix1 chained and scoped fixtures", () => {
  it.each(["fixtureConcurrentPrebuilt", "fixtureFilePrebuilt"])("refuses %s setup failure", name => {
    const result = scenario(name);
    expect(result.red.status).toBe(64);
    expect(result.red.kind).not.toBe("assertion-failure");
  });
  it.each(["fixtureConcurrentBody", "fixtureFileBody"])("accepts %s body RED and GREEN", name => {
    const result = scenario(name);
    expect(result.red).toEqual({ status: 0, kind: "assertion-failure" });
    expect(result.green).toEqual({ status: 0, verdict: "SEPARATION-HELD" });
  });
});
