/**
 * T-01 r5 (#569): a temporary git repository whose `scripts/heavy-lock.sh` and `scripts/tdd/red-receipt.mjs` are
 * stubs, so the jack-tdd-workflow receipt wrapper can be run for real and every process it reaches is observed.
 * Each stub appends one JSON line to `$T567_STUB_LOG`: the guard and the `bin/node` PATH shim record argv and env,
 * the entry records argv, its script's realpath and its cwd. No real receipt engine exists in the repository.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "../..");
export const SKILL_REL = ".agents/skills/jack-tdd-workflow";
export const WRAPPER_REL = `${SKILL_REL}/scripts/receipt.mjs`;
export const CLAUDE_WRAPPER_REL = ".claude/skills/jack-tdd-workflow/scripts/receipt.mjs";
const NODE = process.execPath;
const GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

export type LogRecord = { who: string; argv?: string[]; env?: Record<string, string>; script?: string; cwd?: string; name?: string };

const logLine = `const log = (r) => require("node:fs").appendFileSync(process.env.T567_STUB_LOG, JSON.stringify(r) + "\\n");`;

/** The real guard traps INT and TERM only, forwards them to its job and re-raises after the job is gone; HUP kills it. */
const guard = `#!${NODE}
${logLine}
const { spawn } = require("node:child_process");
const argv = process.argv.slice(2);
log({ who: "guard", argv, env: process.env, cwd: process.cwd() });
if (process.env.T567_GUARD_EXIT) process.exit(Number(process.env.T567_GUARD_EXIT));
if (argv[0] !== "--guard-only") process.exit(64);
const child = spawn(argv[1], argv.slice(2), { stdio: "inherit" });
let got = null;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { got = sig; log({ who: "guard-sig", name: sig }); child.kill(sig); });
child.on("close", (code, signal) => {
  if (got) { log({ who: "guard-exit" }); process.removeAllListeners(got); process.kill(process.pid, got); return; }
  process.exit(code ?? 128 + (require("node:os").constants.signals[signal] ?? 0));
});
`;

/** A plain exec: records its launch, refuses a script outside the repository, forwards signals, mirrors the result. */
const nodeShim = (repo: string) => `#!${NODE}
${logLine}
const { spawn } = require("node:child_process");
const fs = require("node:fs"); const path = require("node:path");
const argv = process.argv.slice(2);
log({ who: "node", argv, env: process.env });
const script = argv.find((a) => !a.startsWith("-"));
let real = ""; try { real = fs.realpathSync(path.resolve(script ?? "")); } catch {}
if (!script || !real.startsWith(${JSON.stringify(repo)} + path.sep)) { log({ who: "escape", argv }); process.exit(97); }
const child = spawn(${JSON.stringify(NODE)}, argv, { stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
child.on("close", (code, signal) => { if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); } else process.exit(code); });
`;

const entry = `import fs from "node:fs";
const log = (r) => fs.appendFileSync(process.env.T567_STUB_LOG, JSON.stringify(r) + "\\n");
const e = process.env;
const exit = () => process.exit(Number(e.T567_ENTRY_EXIT ?? 0));
log({ who: "entry", argv: process.argv.slice(2), script: fs.realpathSync(process.argv[1]), cwd: fs.realpathSync(process.cwd()) });
if (e.T567_ENTRY_OUT) process.stdout.write(e.T567_ENTRY_OUT + "\\n");
if (e.T567_ENTRY_ERR) process.stderr.write(e.T567_ENTRY_ERR + "\\n");
if (e.T567_ENTRY_SIGKILL) process.kill(process.pid, "SIGKILL");
if (e.T567_ENTRY_BIG) process.stdout.write("x".repeat(Number(e.T567_ENTRY_BIG)), exit);
else if (e.T567_ENTRY_WAIT) {
  const codes = { SIGINT: 130, SIGTERM: 143 };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
    log({ who: "sig", name: sig });
    setTimeout(() => { log({ who: "term-done" }); process.exit(codes[sig]); }, 1000);
  });
  log({ who: "waiting" });
  setTimeout(() => { log({ who: "late" }); process.exit(0); }, 5000);
} else exit();
`;

function write(file: string, text: string, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
}

/** Process env without git's own variables, so a wrapper run never reaches the worktree through GIT_DIR. */
export function cleanEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !k.startsWith("GIT_") && v !== undefined)) as Record<string, string>;
}

export type StubRepo = { top: string; log: string; bin: string; env: (extra?: Record<string, string>) => Record<string, string>; records: () => LogRecord[] };

/** Builds the stub repository. `slowGit` puts a `git` on PATH that sleeps 2 s before the real one. */
export function stubRepo(made: string[], opts: { slowGit?: boolean } = {}): StubRepo {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t567-wrap-")));
  made.push(top);
  const env0 = cleanEnv();
  execFileSync(GIT, ["init", "-q"], { cwd: top, env: env0 });
  write(path.join(top, "scripts/heavy-lock.sh"), guard, 0o755);
  write(path.join(top, "scripts/tdd/red-receipt.mjs"), entry);
  const bin = path.join(top, "bin");
  write(path.join(bin, "node"), nodeShim(top), 0o755);
  write(path.join(bin, "cargo"), `#!${NODE}\n${logLine}\nlog({ who: "cargo", argv: process.argv.slice(2) });\n`, 0o755);
  if (opts.slowGit) write(path.join(bin, "git"), `#!/bin/sh\nsleep 2\nexec ${GIT} "$@"\n`, 0o755);
  write(path.join(top, WRAPPER_REL), fs.readFileSync(path.join(ROOT, WRAPPER_REL), "utf8"));
  fs.mkdirSync(path.join(top, ".claude/skills"), { recursive: true });
  fs.symlinkSync("../../.agents/skills/jack-tdd-workflow", path.join(top, ".claude/skills/jack-tdd-workflow"));
  const log = path.join(top, ".stub-log.jsonl");
  return {
    top, log, bin,
    env: (extra = {}) => ({ ...env0, PATH: `${bin}${path.delimiter}${env0.PATH ?? ""}`, T567_STUB_LOG: log, ...extra }),
    // Only complete lines: a poll can read while a stub is still appending its (large) env record.
    records: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").slice(0, -1).filter(Boolean).map((l) => JSON.parse(l) as LogRecord) : []),
  };
}

export type Run = { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; pid: number };

/** Runs `node <wrapper> ...args` (the wrapper by `wrapper`, default the worktree's canonical path) from `cwd`. */
export function runWrapper(args: string[], o: { cwd: string; env: Record<string, string>; wrapper?: string; command?: string[];
  onStart?: (pid: number) => void }): Promise<Run> {
  const argv = o.command ?? [NODE, o.wrapper ?? path.join(ROOT, WRAPPER_REL), ...args];
  const child = spawn(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += String(d); });
  child.stderr.on("data", (d) => { stderr += String(d); });
  o.onStart?.(child.pid!);
  return new Promise((done) => child.on("close", (status, signal) => done({ status, signal, stdout, stderr, pid: child.pid! })));
}

/** The records as `who argv…` lines, the shape the cases compare. */
export const calls = (records: LogRecord[]) => records.map((r) => [r.who, ...(r.argv ?? [])].join(" "));

/** Polls until `test` holds or `ms` passes. */
export async function until(test: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (test()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return test();
}
