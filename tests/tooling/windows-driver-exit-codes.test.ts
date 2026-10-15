// @vitest-environment node
/**
 * WI-E2E-W (e2e plan rev3 N1) — a failure on Windows fails the Mac-side caller, so a dependent
 * step written after it (`ui.sh … && cdp.sh eval …`) never runs. Before, `cdp.mjs` printed an eval
 * exception and exited 0, and `ui.ps1` logged `ERROR <op>` and carried on.
 *
 * E1–E6 run the real Mac scripts with a fake ssh (tests/support/fakeSsh.ts) that answers as the
 * Windows side now does, in its PowerShell 5.1 mode (`remote`), so a code reaches the Mac only
 * through the D247 wrapper. P1–P3 guard the PowerShell side by its text: there is no pwsh on the Mac
 * or in CI, and the device run (W2–W4) exercises it for real.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh, type SshReply } from "../support/fakeSsh";

const SKILL = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts");
const MAC = path.join(SKILL, "mac");
const WIN = path.join(SKILL, "windows");

const made: FakeSsh[] = [];
afterEach(() => {
  for (const f of made.splice(0)) f.cleanup();
});

function sh(script: SshReply[], line: string) {
  const ssh = makeFakeSsh(script);
  made.push(ssh);
  const r = spawnSync("bash", ["-c", line], { env: { ...ssh.env, S: MAC }, encoding: "utf8", timeout: 20_000 });
  return { ssh, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const b64 = (lines: string[]) => Buffer.from(JSON.stringify(lines), "utf8").toString("base64") + "\r\n";
const EXC = '{\r\n "exception": "ReferenceError: nope is not defined"\r\n}\r\n';

describe("N1 — the Mac wrappers pass a Windows failure on", () => {
  it("E1 cdp.sh eval: an eval exception exits 1 and still prints the error", () => {
    const r = sh([{ execute: true, remote: 1, stdout: EXC }], '"$S/cdp.sh" eval "nope"');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ReferenceError: nope is not defined");
  });

  it("E2 cdp.sh evalf: the same", () => {
    const ssh = makeFakeSsh([]);
    made.push(ssh);
    const js = path.join(ssh.dir, "probe.js");
    fs.writeFileSync(js, "return nope");
    const hash = spawnSync("shasum", ["-a", "256", js], { encoding: "utf8" }).stdout.split(" ")[0];
    const script: SshReply[] = [{ execute: true }, { execute: true }, { execute: true, stdout: `${hash}\r\n` }];
    script.push({ execute: true, remote: 1, stdout: EXC });
    fs.writeFileSync(path.join(ssh.dir, "script.json"), JSON.stringify(script));
    const r = spawnSync("bash", [path.join(MAC, "cdp.sh"), "evalf", js], { env: ssh.env, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toContain("ReferenceError: nope is not defined");
  });

  it("E3 cdp.sh eval: any other remote status comes through unchanged", () => {
    const r = sh([{ execute: true, remote: 7, stdout: '"partial"\r\n' }], '"$S/cdp.sh" eval "1"');
    expect(r.status).toBe(7);
    expect(r.stdout).toContain("partial");
  });

  it("E4 ui.sh: an aborted run exits 1, prints its log, and a dependent step never runs", () => {
    const log = ["click 'X' at 1,1", "ERROR menuclick: menu item not found: Nope", "ABORTED at step 2"];
    const r = sh(
      [{ execute: true, remote: 1, stdout: b64(log) }, { execute: true, stdout: "1\r\n" }],
      '"$S/ui.sh" \'[{"op":"menuclick","path":["Nope"]}]\' && "$S/cdp.sh" eval "__a.text(\\"x\\")"',
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ABORTED at step 2");
    expect(r.ssh.executed().filter((c) => c.includes("eval64")), "the dependent eval did not run").toEqual([]);
  });

  it("E5 ui.sh: a timeout exits 124 and prints the TIMEOUT line", () => {
    const r = sh([{ execute: true, remote: 124, stdout: b64(["TIMEOUT: no ui-out.json after 90 s"]) }], '"$S/ui.sh" \'[]\'');
    expect(r.status).toBe(124);
    expect(r.stdout).toContain("TIMEOUT");
  });

  it("E6 cdp.sh eval: success with empty output is still a failure", () => {
    const r = sh([{ execute: true, exit: 0, stdout: "" }], '"$S/cdp.sh" eval "1"');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NO OUTPUT");
  });
});

const read = (f: string) => fs.readFileSync(path.join(WIN, f), "utf8");

describe("N1 — the PowerShell side reports failure (source guards; W2–W4 run it for real)", () => {
  it("P1 ui.ps1 stops at the first failed step unless the step opts in, and exits 1 when it stopped", () => {
    const ps = read("ui.ps1");
    const handler = ps.slice(ps.lastIndexOf("} catch {"));
    expect(handler).toMatch(/\$s\.onError -ne "continue"/);
    expect(handler).toMatch(/ABORTED at step/);
    expect(handler).toMatch(/\bbreak\b/);
    expect(ps.trimEnd()).toMatch(/if \(\$failed\) \{ exit 1 \}$/);
    expect(ps, "the log is written before the exit").toMatch(/Set-Content -Encoding UTF8 \$Out\s+if \(\$failed\)/);
  });

  it("P2 runi.ps1 exits 124 on its timeout and passes the task's own result on", () => {
    const ps = read("runi.ps1");
    expect(ps).toMatch(/\$code = 124/);
    expect(ps).toMatch(/LastTaskResult/);
    expect(ps.trimEnd()).toMatch(/exit \$code$/);
  });

  it("P3 ui-run.ps1 prints the log whatever happened, then exits with the run's status", () => {
    const ps = read("ui-run.ps1");
    expect(ps).toMatch(/\$rc = \$LASTEXITCODE/);
    expect(ps).toMatch(/ABORTED at step/);
    expect(ps.trimEnd()).toMatch(/exit \$rc$/);
    expect(read("ui.cmd")).toMatch(/exit \/b %errorlevel%/i);
  });
});

describe("N1 (audit b151 Medium) — a failed read is a failure, never an empty answer", () => {
  const DOWN = { exit: 255, stderr: "ssh: connect to host win-desktop port 22: Operation timed out\n" } satisfies SshReply;

  it("R1 pull.sh: both read attempts fail, so it exits non-zero and writes no file", () => {
    const r = sh([DOWN], '"$S/pull.sh" "C:\\Users\\jack\\mdpro-audit\\a.png" a.png');
    expect(r.status).toBe(255);
    expect(fs.existsSync(path.join(r.ssh.dir, "out", "a.png")), "no empty file left behind").toBe(false);
  });

  it("R2 log.sh since: a failed read exits non-zero instead of 0 with no lines", () => {
    const ssh = makeFakeSsh([DOWN]);
    made.push(ssh);
    // A v2 mark (WI-E2E-W item 2): a v1 mark is refused before any read.
    fs.writeFileSync(path.join(ssh.dir, "out", ".logmark"), "v2 12 638950000000000000-3f2a9c\n");
    const r = spawnSync("bash", [path.join(MAC, "log.sh"), "since"], { env: ssh.env, encoding: "utf8" });
    expect(r.status).toBe(255);
  });

  it("R3 log.sh mark: a failed read keeps ssh's status", () => {
    const r = sh([DOWN], '"$S/log.sh" mark');
    expect(r.status).toBe(255);
  });
});

describe("audit b163 H2 — runi.ps1: a run with no readable result is a failure (source guard; no pwsh here)", () => {
  it("P4 a failed Get-ScheduledTaskInfo, or no LastTaskResult, exits 1 instead of reading $null as 0", () => {
    const ps = read("runi.ps1");
    expect(ps).not.toMatch(/\[int64\]\(Get-ScheduledTaskInfo/);
    expect(ps).toMatch(/Get-ScheduledTaskInfo -TaskName \$Name -ErrorAction Stop/);
    expect(ps).toMatch(/\$null -eq \$info -or \$null -eq \$info\.LastTaskResult/);
    expect(ps).toMatch(/runi: \$Name has no result/);
  });
});

describe("audit b163 H3 — a failed decode or write in pull.sh fails its caller", () => {
  const BAD_B64 = { execute: true, stdout: "@@@ not base64 @@@\r\n" } satisfies SshReply;

  it("R4 pull.sh: a reply that does not decode exits non-zero, prints no path and leaves no file", () => {
    const r = sh([BAD_B64], '"$S/pull.sh" "C:\\Users\\jack\\mdpro-audit\\a.png" a.png');
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("a.png");
    expect(fs.existsSync(path.join(r.ssh.dir, "out", "a.png"))).toBe(false);
    expect(fs.existsSync(path.join(r.ssh.dir, "out", "a.png.part"))).toBe(false);
  });

  it("R5 cdp.sh shot: a failed pull fails the shot", () => {
    const r = sh([{ execute: true, stdout: "saved\r\n" }, BAD_B64], '"$S/cdp.sh" shot s1');
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(path.join(r.ssh.dir, "out", "s1.png"))).toBe(false);
  });

  it("R6 control: a reply that decodes still writes the file and prints its path", () => {
    const b64 = Buffer.from("png-bytes").toString("base64");
    const r = sh([{ execute: true, stdout: `${b64}\r\n` }], '"$S/pull.sh" "C:\\Users\\jack\\mdpro-audit\\a.png" a.png');
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(r.ssh.dir, "out", "a.png"), "utf8")).toBe("png-bytes");
    expect(r.stdout.trim()).toBe(path.join(r.ssh.dir, "out", "a.png"));
  });
});
