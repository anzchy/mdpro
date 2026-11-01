#!/usr/bin/env node
// Purpose: jack-tdd-workflow's thin receipt wrapper (#567 spec r5 § Receipts). It runs the receipt CLI in one of four
// modes, exactly as the spec's Receipts table and .claude/rules/10-tdd.md state the commands, from the git top level of
// the directory it is run from. It adds no argument, variable or receipt logic; it never formats Rust code.
//   node .agents/skills/jack-tdd-workflow/scripts/receipt.mjs <mode> --id <ID> [--test <file>]
// Exit: the receipt command's status; 2 for a refused call (nothing is run); 1 when the command could not start or
// ended on a signal.
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const [mode, ...rest] = process.argv.slice(2);
const opts = new Map();
const stray = [];
for (let i = 0; i < rest.length; i += 2) {
  if ((rest[i] === "--id" || rest[i] === "--test") && !opts.has(rest[i])) opts.set(rest[i], rest[i + 1]);
  else stray.push(rest[i]);
}
const id = opts.get("--id");
const test = opts.get("--test");

// Each command is an argv array, spawned without a shell.
const ENTRY = "scripts/tdd/red-receipt.mjs";
const GUARD = ["scripts/heavy-lock.sh", "--guard-only", "node"];
const MODES = {
  "frontend-record": [...GUARD, ENTRY, "record", "--id", id, "--test", test],
  "frontend-verify": [...GUARD, ENTRY, "verify", "--id", id],
  "rust-record": ["node", ENTRY, "record", "--id", id, "--lane", "rust", "--test", test],
  "rust-verify": ["node", ENTRY, "verify", "--id", id],
};

function fail(status, why, usage = false) {
  process.stderr.write(`receipt.mjs: ${why}\n`);
  if (usage) process.stderr.write(`usage: node receipt.mjs <${Object.keys(MODES).join("|")}> --id <ID> [--test <file>]\n`);
  process.exit(status);
}
const value = (v) => typeof v === "string" && v !== "" && !v.startsWith("--");
if (!Object.hasOwn(MODES, mode)) fail(2, `unknown mode ${JSON.stringify(mode ?? "")}`, true);
if (stray.length) fail(2, `unexpected argument ${JSON.stringify(stray[0])}`, true);
if (!value(id)) fail(2, "--id needs a value", true);
if (mode.endsWith("-record") && !value(test)) fail(2, `${mode} needs --test <file>`, true);
if (mode.endsWith("-verify") && opts.has("--test")) fail(2, `${mode} takes the id only`, true);

// The repository is the git top level of the directory this is run from, never this file's own location: through the
// .claude/skills symlink that would be another checkout.
let top;
try {
  top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
} catch {
  fail(1, "not inside a git repository; run it from the repository");
}

const [command, ...args] = MODES[mode];
const child = spawn(command === "node" ? command : path.join(top, command), args, { stdio: "inherit", cwd: top });
child.on("error", (error) => fail(1, `could not start ${command}: ${error.message}`));
// Pass an interrupt on and wait for the receipt command to finish, so nothing records after the wrapper has gone.
// SIGHUP goes on as SIGTERM: scripts/heavy-lock.sh traps only INT and TERM, and a hung-up guard would orphan its job.
const PASS_ON = { SIGINT: "SIGINT", SIGTERM: "SIGTERM", SIGHUP: "SIGTERM" };
for (const [signal, as] of Object.entries(PASS_ON)) process.on(signal, () => child.kill(as));
child.on("close", (code) => process.exit(code ?? 1));
