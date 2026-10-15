// @vitest-environment node
/**
 * WI-18 (ADR-0047): `spawnTool`, the real spawner `pnpm control:build` hands
 * to `runBuild`. Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit
 * `build.mjs#spawnTool` (WI-10/T26, T27, T28, T29).
 *
 * Every child is a real process started from `process.execPath` (node -e …),
 * run in a fresh tmp dir. Nothing is mocked. The missing command is a random
 * name that cannot exist on PATH.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { spawnTool } from "../../scripts/control/build.mjs";

type SpawnResult = { status: number | null; stdout: string; stderr: string };
const spawn = (cmd: string, args: string[], cwd: string, capture: boolean): SpawnResult =>
  spawnTool(cmd, args, { cwd, env: process.env, capture });

let cwd = "";
beforeAll(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-"));
});
afterAll(() => {
  if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
});

const writeBoth = (out: string, err: string, code: number) =>
  `process.stdout.write('${out}');process.stderr.write('${err}');process.exit(${code})`;

describe("WI-10/T26 capture on returns the child's stdout, stderr and status exactly", () => {
  it("(i) a non-zero exit: status 3, stdout 'out', stderr 'err'", () => {
    const r = spawn(process.execPath, ["-e", writeBoth("out", "err", 3)], cwd, true);
    expect(r).toEqual({ status: 3, stdout: "out", stderr: "err" });
  });

  it("(ii) a zero exit: status 0, stdout 'o2', stderr 'e2'", () => {
    const r = spawn(process.execPath, ["-e", writeBoth("o2", "e2", 0)], cwd, true);
    expect(r).toEqual({ status: 0, stdout: "o2", stderr: "e2" });
  });
});

describe("WI-10/T27 capture off returns empty strings and the status", () => {
  it("exit 0 gives { status: 0, stdout: '', stderr: '' }", () => {
    const r = spawn(process.execPath, ["-e", "process.exit(0)"], cwd, false);
    expect(r).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("exit 4 gives { status: 4, stdout: '', stderr: '' }", () => {
    const r = spawn(process.execPath, ["-e", "process.exit(4)"], cwd, false);
    expect(r).toEqual({ status: 4, stdout: "", stderr: "" });
  });
});

describe("WI-10/T28-T29 a missing command gives a null status and a stderr naming it", () => {
  const cmd = `mdpro-no-such-tool-${randomBytes(4).toString("hex")}`;

  it("T28: with capture on", () => {
    const r = spawn(cmd, [], cwd, true);
    expect(r.status).toBeNull();
    expect(r.stderr.length).toBeGreaterThan(0);
    expect(r.stderr).toContain(cmd);
  });

  it("T29: with capture off", () => {
    const r = spawn(cmd, [], cwd, false);
    expect(r.status).toBeNull();
    expect(r.stderr.length).toBeGreaterThan(0);
    expect(r.stderr).toContain(cmd);
  });
});
