// @vitest-environment node
/**
 * D228 — the Windows device driver never replays a command whose response was lost. ssh exits 255
 * both when it could not connect and when the connection dropped after the remote command ran, so
 * a retry on 255 could run a mutation twice (a doubled keystroke, a second chunk append). Mutations
 * now go through `win`, which never retries and reports exit 3 UNKNOWN OUTCOME; idempotent reads go
 * through `win_read`, which still retries once.
 *
 * Runs the real scripts under .claude/skills/remote-windows-device-test/scripts/mac with a fake ssh
 * (tests/support/fakeSsh.ts) first on PATH. Mocked: ssh only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh, type SshReply } from "../support/fakeSsh";

const MAC = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts/mac");
const LOST = { execute: true, exit: 255, stderr: "Connection reset by peer\n" } satisfies SshReply;

const made: FakeSsh[] = [];
afterEach(() => {
  for (const f of made.splice(0)) f.cleanup();
});

function run(script: SshReply[], cmd: string, ...args: string[]) {
  const ssh = makeFakeSsh(script);
  made.push(ssh);
  const r = spawnSync("bash", [path.join(MAC, cmd), ...args], { env: ssh.env, encoding: "utf8", timeout: 20_000 });
  return { ssh, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const count = (list: string[], needle: string) => list.filter((c) => c.includes(needle)).length;

describe("D228 — a mutation whose response was lost runs once and reports an unknown outcome", () => {
  it("T1 cdp.sh eval: executed once, exit 3, UNKNOWN OUTCOME", () => {
    const r = run([LOST, { execute: true, stdout: "ok\n" }], "cdp.sh", "eval", '__a.text("z")');
    expect(count(r.ssh.executed(), "eval64"), r.stderr).toBe(1);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/UNKNOWN OUTCOME/);
  });

  it("T2 ui.sh: the steps ran once, exit 3, and the cleanup backstop ran", () => {
    const r = run([LOST, { execute: true, stdout: "" }], "ui.sh", '[{"op":"key","keys":"z"}]');
    expect(count(r.ssh.executed(), "ui-run.ps1"), r.stderr).toBe(1);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/UNKNOWN OUTCOME/);
    expect(count(r.ssh.calls(), "Get-ScheduledTask"), "cleanup ran").toBe(1);
  });

  it("T3 push.sh: a lost chunk append stops the upload; no chunk runs twice and none after it", () => {
    const ssh = makeFakeSsh([]);
    made.push(ssh);
    const src = path.join(ssh.dir, "big.bin");
    fs.writeFileSync(src, Buffer.alloc(15_000, 7)); // 20 000 base64 chars: three 7 000-char chunks
    const script: SshReply[] = [{ execute: true }, { execute: true }, LOST, { execute: true }];
    fs.writeFileSync(path.join(ssh.dir, "script.json"), JSON.stringify(script));
    const r = spawnSync("bash", [path.join(MAC, "push.sh"), src, "C:\\Users\\jack\\mdpro-audit\\big.bin"], {
      env: ssh.env,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(count(ssh.executed(), "Add-Content"), r.stderr).toBe(2);
    expect(count(ssh.calls(), "Add-Content"), "chunk 3 never sent").toBe(2);
    expect(count(ssh.calls(), "WriteAllBytes"), "no decode of a partial upload").toBe(0);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/partial upload; re-run push/);
  });

  it("T6 mdpro.sh debug: a lost close never relaunches mdpro", () => {
    const r = run([LOST, { execute: true, stdout: "0" }], "mdpro.sh", "debug", "--yes");
    expect(count(r.ssh.executed(), "mdpro-audit-close"), r.stderr).toBe(1);
    expect(count(r.ssh.calls(), "launch.cmd"), "no relaunch").toBe(0);
    expect(r.status).toBe(3);
  });
});

describe("D228 — an idempotent read still retries once on a lost connection", () => {
  it("T4 log.sh mark: 255 without running, then ok", () => {
    const r = run([{ exit: 255 }, { execute: true, stdout: "12\r\n" }], "log.sh", "mark");
    expect(r.ssh.calls()).toHaveLength(2);
    expect(r.status, r.stderr).toBe(0);
  });

  it("T5 mdpro.sh status: 255, then ok", () => {
    const r = run([{ exit: 255 }, { execute: true, stdout: "tauri-app: 1\r\n" }], "mdpro.sh", "status");
    expect(r.ssh.calls()).toHaveLength(2);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("tauri-app: 1");
  });
});

/** Mutation call sites: each `win` call must contain one of these, in this file. */
const MUTATIONS: Record<string, string[]> = {
  "cdp.sh": ["node cdp.mjs evalfile", "node cdp.mjs eval64"],
  "ui.sh": ["ui-run.ps1"],
  "mdpro.sh": ["runi.ps1"],
  "push.sh": ["Add-Content", "WriteAllBytes"],
};

describe("D228 — every remote call is classified", () => {
  it("T7 a `win` call is a listed mutation, everything else uses win_read, and only common.sh runs ssh", () => {
    const unclassified: string[] = [];
    for (const f of fs.readdirSync(MAC).filter((n) => n.endsWith(".sh"))) {
      const lines = fs.readFileSync(path.join(MAC, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/^\s*#.*$/, "");
        if (f !== "common.sh" && /\bssh\s/.test(code)) unclassified.push(`${f}:${i + 1} runs ssh directly`);
        if (f === "common.sh") return;
        if (/(^|[\s($|;&])win\s/.test(code) && !(MUTATIONS[f] ?? []).some((m) => code.includes(m))) {
          unclassified.push(`${f}:${i + 1} ${code.trim().slice(0, 80)}`);
        }
      });
    }
    expect(unclassified).toEqual([]);
  });
});
