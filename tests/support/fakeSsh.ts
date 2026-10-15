/**
 * A fake `ssh` for the Windows device driver's Mac-side scripts
 * (.claude/skills/remote-windows-device-test/scripts/mac/*.sh), so a test can run the real wrappers
 * the way a caller does and see what reached "Windows".
 *
 * `makeFakeSsh(script)` writes an `ssh` executable into a temp `bin/` and returns the env that puts it
 * first on PATH. Each call takes the next scripted reply in order (the last reply repeats once the
 * script runs out). A reply with `execute: true` appends the remote command to the ledger before
 * answering, so a command that ran twice shows up twice: a lost response is `execute: true` with
 * exit 255. `calls()` lists every call, executed or not.
 *
 * `remote` / `cmdletFailed` model win-desktop's OpenSSH, whose DefaultShell is Windows PowerShell
 * 5.1 (D247): the command runs as `powershell -c`, which exits 1 for any failure, so a native
 * program's own code (124, CDP_TIMEOUT 3, 4, 5, 6) never reaches the Mac. Only a command wrapped
 * exactly as `PS51_HEAD + body + PS51_TAIL` gets the native code back; this mode never passes a
 * code straight through. `exit` still wins when set (ssh's own 255).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SshReply {
  /** Exit code of the fake ssh. 255 is what ssh reports for a lost connection. */
  exit?: number;
  stdout?: string;
  stderr?: string;
  /** The remote command ran (it goes in the ledger), whatever the exit code says. */
  execute?: boolean;
  /** PS 5.1 mode: the exit code of the last native program the remote command ran. */
  remote?: number;
  /** PS 5.1 mode: the last statement was a cmdlet that failed (`$?` false, no native code). */
  cmdletFailed?: boolean;
}

/** The D247 wrapper around every remote command (scripts/mac/common.sh `ps_wrap`). */
export const PS51_HEAD = "$global:LASTEXITCODE = 0; ";
export const PS51_TAIL =
  "; $mdproOk = $?; $mdproRc = $LASTEXITCODE; if (-not $mdproOk) { if ($mdproRc) { exit $mdproRc }; exit 1 }; exit 0";

export interface FakeSsh {
  dir: string;
  env: NodeJS.ProcessEnv;
  /** Remote commands that ran, in order. */
  executed(): string[];
  /** Every remote command ssh was asked to run, in order. */
  calls(): string[];
  cleanup(): void;
}

const FAKE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const dir = process.env.FAKE_SSH_DIR;
const args = process.argv.slice(2);
// ssh [-o opt]... host command...
let i = 0;
while (i < args.length && args[i] === "-o") i += 2;
const cmd = args.slice(i + 1).join(" ");
const script = JSON.parse(fs.readFileSync(path.join(dir, "script.json"), "utf8"));
const n = fs.existsSync(path.join(dir, "count")) ? Number(fs.readFileSync(path.join(dir, "count"), "utf8")) : 0;
fs.writeFileSync(path.join(dir, "count"), String(n + 1));
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify(cmd) + "\\n");
const r = script[Math.min(n, script.length - 1)] || {};
if (r.execute) fs.appendFileSync(path.join(dir, "ledger.jsonl"), JSON.stringify(cmd) + "\\n");
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
let code = r.exit;
if (code === undefined && (r.remote !== undefined || r.cmdletFailed)) {
  const failed = (r.remote ?? 0) !== 0 || !!r.cmdletFailed;
  const wrapped = cmd.startsWith(HEAD) && cmd.endsWith(TAIL);
  code = !failed ? 0 : wrapped && r.remote ? r.remote : 1;
}
process.exitCode = code ?? 0;
`;

function readLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as string);
}

export function makeFakeSsh(script: SshReply[]): FakeSsh {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-ssh-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const consts = `const HEAD = ${JSON.stringify(PS51_HEAD)}, TAIL = ${JSON.stringify(PS51_TAIL)};\n`;
  fs.writeFileSync(path.join(bin, "ssh"), FAKE.replace("\n", `\n${consts}`), { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(script));
  const out = path.join(dir, "out");
  fs.mkdirSync(out);
  return {
    dir,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      FAKE_SSH_DIR: dir,
      MDPRO_WIN_OUT: out,
      WIN_RETRY_SLEEP: "0",
      WIN_RELAUNCH_SLEEP: "0",
    },
    executed: () => readLines(path.join(dir, "ledger.jsonl")),
    calls: () => readLines(path.join(dir, "calls.jsonl")),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
