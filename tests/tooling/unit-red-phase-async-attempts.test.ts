// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

vi.setConfig({ testTimeout: 90_000 });
const repo = resolve(import.meta.dirname, "../..");
const plugin = existsSync(join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian"));

function scenario(name: string, variant = "alone") {
  const script = join(repo, "tests/tooling/fixtures/unit-red/d301-async-cases.mjs");
  const run = spawnSync(process.execPath, [script, name, variant, repo], { cwd: repo, encoding: "utf8", timeout: 90_000 });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as { red: { status: number; kind: string | null; output: string } };
}

describe.skipIf(!plugin)("D301 attempt and concurrent ownership", () => {
  it.each(["retrySetupFirst", "retrySetupLast", "repeatSetupLast"])("refuses unawaited setup from its own attempt: %s", name => {
    const seen = scenario(name);
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("unawaited async assertion");
    if (name === "retrySetupFirst") {
      expect(seen.red.output).toContain("case[retry=0,repeat=0,body=false,nonBody=true");
      expect(seen.red.output).toContain("origin=hook");
      expect(seen.red.output).toContain("case[retry=1,repeat=0,body=true,nonBody=false");
    } else if (name === "retrySetupLast") {
      expect(seen.red.output).toContain("case[retry=0,repeat=0,body=true,nonBody=false");
      expect(seen.red.output).toContain("case[retry=1,repeat=0,body=false,nonBody=true");
    } else {
      expect(seen.red.output).toContain("case[retry=0,repeat=0,body=true,nonBody=false");
      expect(seen.red.output).toContain("case[retry=0,repeat=1,body=false,nonBody=true");
    }
  });
  it("accepts an awaited setup assertion on retry", () => {
    const seen = scenario("retryAwaited");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
  });
  it("accepts an awaited setup assertion on repeat", () => {
    const seen = scenario("repeatAwaited");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
  });
  it("refuses B's setup async failure beside concurrent A's body RED", () => {
    const seen = scenario("concurrent");
    expect(seen.red.status).toBe(64);
    expect(seen.red.output).toContain("nonBody=true");
    expect(seen.red.output).toContain("A[retry=0,repeat=0,body=true,nonBody=false");
    expect(seen.red.output).toContain("B[retry=0,repeat=0,body=false,nonBody=true");
  });
  it("accepts concurrent A's body RED beside awaited, passing B setup", () => {
    const seen = scenario("concurrent", "awaited");
    expect(seen.red).toMatchObject({ status: 0, kind: "assertion-failure" });
  });
});
