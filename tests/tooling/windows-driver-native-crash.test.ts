// @vitest-environment node
/**
 * D248 (audit b169 Medium on D247) — a native crash code is an NTSTATUS, which PowerShell 5.1 sees
 * as a negative Int32 and ssh truncates mod 256: 0xC0000409 (D248's own abort) arrived as 9, and
 * 0xC0000005 (access violation) as 5, which reads as WINDOW_NOT_FOUND. ps_wrap now maps any
 * $LASTEXITCODE outside 0–255 to the reserved 70, NATIVE_CRASH: outcome unknown, as for 3, so a
 * caller never retries on it.
 *
 * Runs the real Mac scripts with the fake ssh's PowerShell 5.1 mode (tests/support/fakeSsh.ts).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, NATIVE_CRASH, type FakeSsh, type SshReply } from "../support/fakeSsh";

const MAC = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts/mac");
const STATUS_STACK_BUFFER_OVERRUN = -1073740791; // 0xC0000409
const STATUS_ACCESS_VIOLATION = -1073741819; // 0xC0000005

const made: FakeSsh[] = [];
afterEach(() => {
  for (const f of made.splice(0)) f.cleanup();
});

function run(script: SshReply[], file: string, ...args: string[]) {
  const ssh = makeFakeSsh(script);
  made.push(ssh);
  const r = spawnSync("bash", [path.join(MAC, file), ...args], { env: ssh.env, encoding: "utf8", timeout: 20_000 });
  return { ssh, status: r.status, stderr: r.stderr };
}

describe("D248 — a native crash reaches the Mac as 70, never as a driver's own code", () => {
  it("N0 the reserved code is 70", () => {
    expect(NATIVE_CRASH).toBe(70);
  });

  it("N1 cdp.sh eval: 0xC0000409 exits 70, with one ssh call (a mutation is never retried)", () => {
    const r = run([{ execute: true, remote: STATUS_STACK_BUFFER_OVERRUN, stdout: '"p2"\r\n' }], "cdp.sh", "eval", "1");
    expect(r.status, r.stderr).toBe(70);
    expect(r.ssh.calls()).toHaveLength(1);
  });

  it("N2 cdp.sh eval: 0xC0000005 exits 70, not 5 (WINDOW_NOT_FOUND)", () => {
    const r = run([{ execute: true, remote: STATUS_ACCESS_VIOLATION }], "cdp.sh", "eval", "1");
    expect(r.status).toBe(70);
  });

  it("N3 a code just past the byte is a crash too; one inside it comes through", () => {
    expect(run([{ execute: true, remote: 256 }], "cdp.sh", "eval", "1").status).toBe(70);
    expect(run([{ execute: true, remote: 254 }], "cdp.sh", "eval", "1").status).toBe(254);
  });

  it("N4 pull.sh (win_read): a crash exits 70 with one ssh call; the read retries only on ssh's 255", () => {
    const r = run([{ execute: true, remote: STATUS_STACK_BUFFER_OVERRUN }], "pull.sh", "C:\\Users\\jack\\mdpro-audit\\x.png", "x.png");
    expect(r.status).toBe(70);
    expect(r.ssh.calls()).toHaveLength(1);
  });

  it("N5 ui.sh: a crash of ui-run.ps1's host exits 70 and is not read as a step failure", () => {
    const r = run([{ execute: true, remote: STATUS_ACCESS_VIOLATION }, { execute: true }], "ui.sh", "[]");
    expect(r.status).toBe(70);
  });
});
