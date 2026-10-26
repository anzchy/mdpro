// @vitest-environment node
/**
 * WI-E2E-W item 3 (plan §4.7, Codex finding 13): a run never acts on a window it guessed.
 * The Mac-side `cdp.sh --window <label>` passes the label to cdp.mjs (whose checks are in
 * windows-driver-cdp.test.ts) after the same validation as every other remote value. Native
 * label-to-HWND behavior is covered by windows-driver-native-binding.test.ts and
 * windows-driver-identity.test.ts; this file keeps the original CDP wrapper cases.
 *
 * Runs the real cdp.sh with a fake ssh (tests/support/fakeSsh.ts); ui.ps1 is checked by its text
 * (no pwsh on the Mac or in CI). Mocked: ssh only.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh, type SshReply } from "../support/fakeSsh";

const SKILL = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test");
const MAC = path.join(SKILL, "scripts/mac");

const made: FakeSsh[] = [];
afterEach(() => {
  for (const f of made.splice(0)) f.cleanup();
});
function cdpSh(script: SshReply[], ...args: string[]) {
  const ssh = makeFakeSsh(script);
  made.push(ssh);
  const r = spawnSync("bash", [path.join(MAC, "cdp.sh"), ...args], { env: ssh.env, encoding: "utf8", timeout: 20_000 });
  return { ssh, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("cdp.sh --window", () => {
  it("B1 the label reaches cdp.mjs on the eval call", () => {
    const r = cdpSh([{ execute: true, stdout: '"ok"\r\n' }], "--window", "mdpro-abc", "eval", "1");
    expect(r.status, r.stderr).toBe(0);
    expect(r.ssh.calls()[0]).toMatch(/node cdp\.mjs --window 'mdpro-abc' eval64 /);
  });

  it("B2 an unsafe label is refused before anything is sent, exit 2", () => {
    const r = cdpSh([{ execute: true, stdout: "1" }], "--window", "a'b", "eval", "1");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refusing window label/);
    expect(r.ssh.calls()).toHaveLength(0);
  });

  it("B3 cdp.mjs's window exits come back to the caller with its JSON", () => {
    const out = '{"error":"WINDOW_AMBIGUOUS","candidates":[]}\r\n';
    const r = cdpSh([{ execute: true, remote: 6, stdout: out }], "eval", "1");
    expect(r.status).toBe(6);
    expect(r.stdout).toContain("WINDOW_AMBIGUOUS");
  });

  it("B4 without --window the call is unchanged", () => {
    const r = cdpSh([{ execute: true, stdout: "1\r\n" }], "eval", "1");
    expect(r.status, r.stderr).toBe(0);
    expect(r.ssh.calls()[0]).toMatch(/node cdp\.mjs eval64 /);
  });
});
