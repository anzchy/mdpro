// @vitest-environment node
/**
 * D247 — win-desktop's OpenSSH runs every remote command in Windows PowerShell 5.1 (its
 * DefaultShell), which exits 1 for any failure. The Windows scripts' own codes (ui.sh's 124,
 * cdp.mjs's CDP_TIMEOUT 3, 4, 5, 6) reached the Mac as 1, and a CDP_TIMEOUT that reads as "ran and
 * failed" invites a re-run of a mutation that may have happened (the D228 class). `win` and
 * `win_read` (scripts/mac/common.sh) now wrap each command so a native program's code comes back,
 * a failed cmdlet stays 1 and success stays 0.
 *
 * The fake ssh's PS 5.1 mode (`remote`, `cmdletFailed`; tests/support/fakeSsh.ts) never passes a
 * code straight through: only the exact D247 wrapper gets the native code back. There is no pwsh
 * on the Mac or in CI; the wrapper's PowerShell is proven on win-desktop (the D247 device check).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, PS51_HEAD, PS51_TAIL, type FakeSsh, type SshReply } from "../support/fakeSsh";

const MAC = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts/mac");

const made: FakeSsh[] = [];
afterEach(() => {
  for (const f of made.splice(0)) f.cleanup();
});

function run(script: SshReply[], file: string, ...args: string[]) {
  const ssh = makeFakeSsh(script);
  made.push(ssh);
  const r = spawnSync("bash", [path.join(MAC, file), ...args], { env: ssh.env, encoding: "utf8", timeout: 20_000 });
  return { ssh, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The fake ssh called directly, the way an unwrapped caller would. */
function bareSsh(reply: SshReply, cmd: string) {
  const ssh = makeFakeSsh([reply]);
  made.push(ssh);
  return spawnSync("ssh", ["win-desktop", cmd], { env: ssh.env, encoding: "utf8" }).status;
}

const b64 = (lines: string[]) => Buffer.from(JSON.stringify(lines), "utf8").toString("base64") + "\r\n";

describe("D247 — the fake models PowerShell 5.1, so it cannot pass a code through", () => {
  it("F1 an unwrapped command with a native failure exits 1, whatever the code", () => {
    for (const code of [3, 4, 5, 6, 124]) expect(bareSsh({ remote: code }, "node cdp.mjs eval64 MQ==")).toBe(1);
  });

  it("F2 the wrapped command gets the native code; success and a failed cmdlet stay 0 and 1", () => {
    const w = (body: string) => PS51_HEAD + body + PS51_TAIL;
    expect(bareSsh({ remote: 3 }, w("node cdp.mjs eval64 MQ=="))).toBe(3);
    expect(bareSsh({ remote: 0 }, w("node cdp.mjs eval64 MQ=="))).toBe(0);
    expect(bareSsh({ cmdletFailed: true }, w("Get-Item nope"))).toBe(1);
  });
});

describe("D247 — the Mac wrappers return the Windows script's own code", () => {
  for (const [code, what] of [
    [3, "CDP_TIMEOUT (unknown outcome)"],
    [4, "CDP_PORT_CLOSED"],
    [5, "WINDOW_NOT_FOUND"],
    [6, "WINDOW_AMBIGUOUS"],
    [1, "an eval exception"],
  ] as const) {
    it(`W${code} cdp.sh eval: cdp.mjs exit ${code} (${what}) reaches the Mac as ${code}`, () => {
      const r = run([{ execute: true, remote: code, stdout: '"x"\r\n' }], "cdp.sh", "eval", "1");
      expect(r.status, r.stderr).toBe(code);
    });
  }

  it("W124 ui.sh: ui-run.ps1's timeout 124 reaches the Mac as 124", () => {
    const r = run(
      [{ execute: true, remote: 124, stdout: b64(["TIMEOUT: no ui-out.json after 90 s"]) }, { execute: true }],
      "ui.sh",
      "[]",
    );
    expect(r.status).toBe(124);
    expect(r.stdout).toContain("TIMEOUT");
  });

  it("W0 cdp.sh eval: success stays 0 and prints the answer", () => {
    const r = run([{ execute: true, remote: 0, stdout: "1\r\n" }], "cdp.sh", "eval", "1");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("1");
  });

  it("WC a read whose cmdlet fails stays 1 (pull.sh), never 0", () => {
    const r = run([{ execute: true, cmdletFailed: true }], "pull.sh", "C:\\Users\\jack\\mdpro-audit\\x.png", "x.png");
    expect(r.status).toBe(1);
  });

  it("WT ssh's own 255 still means an unknown outcome for a mutation: exit 3", () => {
    const r = run([{ execute: true, exit: 255 }], "cdp.sh", "eval", "1");
    expect(r.status).toBe(3);
  });
});

describe("D247 — every remote command is wrapped, and only common.sh calls ssh", () => {
  it("S1 each command sent by a wrapper starts with the head and ends with the tail", () => {
    const r = run([{ execute: true, remote: 0, stdout: "1\r\n" }], "cdp.sh", "--window", "main", "eval", "1");
    expect(r.status, r.stderr).toBe(0);
    const sent = r.ssh.calls();
    expect(sent.length).toBeGreaterThan(0);
    for (const c of sent) {
      expect(c.startsWith(PS51_HEAD), c).toBe(true);
      expect(c.endsWith(PS51_TAIL), c).toBe(true);
    }
  });

  it("S2 no script under scripts/mac runs ssh except common.sh's win and win_read", () => {
    for (const f of fs.readdirSync(MAC).filter((n) => n.endsWith(".sh") && n !== "common.sh")) {
      const code = fs
        .readFileSync(path.join(MAC, f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      expect(code, f).not.toMatch(/(^|[;&|(\s])ssh\s+-/m);
    }
    const common = fs.readFileSync(path.join(MAC, "common.sh"), "utf8");
    const calls = common.split("\n").filter((l) => /^\s*[^#]*\bssh -o/.test(l));
    expect(calls.length).toBeGreaterThan(0);
    for (const l of calls) expect(l, "every ssh call sends the wrapped command").toMatch(/"\$wrapped"/);
  });
});
