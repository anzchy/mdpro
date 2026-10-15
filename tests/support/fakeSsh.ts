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
}

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
process.exitCode = r.exit ?? 0;
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
  fs.writeFileSync(path.join(bin, "ssh"), FAKE, { mode: 0o755 });
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
    },
    executed: () => readLines(path.join(dir, "ledger.jsonl")),
    calls: () => readLines(path.join(dir, "calls.jsonl")),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
