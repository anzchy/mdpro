#!/usr/bin/env node
/**
 * Purpose: Build the dtrack project `.claude/settings.json` for the Mac mini
 * (D177-WI-3): Stop, Notification and SessionStart hooks as `type:"command"`
 * entries running `<node> <push.mjs>`, merged into an existing settings file
 * without dropping its other keys or hooks. Replaces the old
 * build-mini-settings.py, whose `type:"http"` hooks carried the receiver URL
 * and token; this output carries neither (push.mjs reads them on the mini).
 *
 * Usage: node build-mini-settings.mjs <out> [<existing settings>]
 *          --node <abs node path> [--push <path>]
 *
 * Pipeline: args → `<node> -v` ≥ 18 → existing settings (or {}) → per event,
 *   drop old http `:8787/hook` hooks and push.mjs command hooks, drop groups
 *   left empty → append our group → write `<out>` mode 0600.
 *
 * Key decisions:
 * - Refuses a node older than 18: push.mjs needs global fetch and
 *   AbortSignal.timeout. The check runs the given binary, so it is the mini's
 *   node path that is judged, not the one running this script.
 * - `--push` defaults to `~/.mdpro-redesign/hooks/push.mjs`, written with a
 *   literal `~`: the file is built here and runs on the mini, whose home
 *   differs; the hook command goes through a shell, which expands it.
 * - Merging is idempotent: our own earlier entries are removed before ours
 *   are added, so a second run gives the same bytes.
 *
 * @module scripts/device/hooks/build-mini-settings
 * @coordinates-with scripts/device/hooks/push.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const MIN_NODE_MAJOR = 18;
const DEFAULT_PUSH = "~/.mdpro-redesign/hooks/push.mjs";
const HOOK_TIMEOUT_S = 5;
const EVENTS = [
  ["Stop", undefined],
  ["Notification", "permission_prompt|idle_prompt|agent_needs_input|elicitation_dialog"],
  ["SessionStart", "clear|startup|resume"],
];

function fail(msg) {
  process.stderr.write(`build-mini-settings: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--node" || a === "--push") {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) fail(`unknown option ${a}`);
    else pos.push(a);
  }
  if (pos.length < 1 || pos.length > 2) fail("usage: build-mini-settings.mjs <out> [<existing>] --node <abs node> [--push <path>]");
  if (!opts.node) fail("--node <absolute path of the mini's node> is required");
  if (!opts.node.startsWith("/")) fail("--node must be an absolute path");
  return { out: pos[0], existing: pos[1], node: opts.node, push: opts.push ?? DEFAULT_PUSH };
}

function checkNode(node) {
  let version = "";
  try {
    version = execFileSync(node, ["-v"], { encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    fail(`could not run ${node} -v`);
  }
  const major = Number(/^v(\d+)\./.exec(version)?.[1]);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) {
    fail(`${node} reports ${version || "no version"}; push.mjs needs node >= ${MIN_NODE_MAJOR}`);
  }
}

function isOurs(hook) {
  if (!hook || typeof hook !== "object") return false;
  if (hook.type === "http" && typeof hook.url === "string") {
    try {
      const u = new URL(hook.url);
      return u.port === "8787" && u.pathname.endsWith("/hook");
    } catch {
      return false;
    }
  }
  return hook.type === "command" && typeof hook.command === "string" && /(^|[\s/])push\.mjs(\s|$)/.test(hook.command);
}

function readExisting(file) {
  if (!file || !fs.existsSync(file)) return {};
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  return fail(`${file} is not a JSON object`);
}

function merge(base, command) {
  const hooks = base.hooks && typeof base.hooks === "object" ? base.hooks : {};
  for (const [event, matcher] of EVENTS) {
    const kept = (Array.isArray(hooks[event]) ? hooks[event] : [])
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    const group = matcher === undefined ? {} : { matcher };
    group.hooks = [{ type: "command", command, timeout: HOOK_TIMEOUT_S }];
    hooks[event] = [...kept, group];
  }
  return { ...base, hooks };
}

const args = parseArgs(process.argv.slice(2));
checkNode(args.node);
const settings = merge(readExisting(args.existing), `${args.node} ${args.push}`);
const fd = fs.openSync(args.out, "w", 0o600);
fs.writeSync(fd, JSON.stringify(settings, null, 2) + "\n");
fs.closeSync(fd);
fs.chmodSync(args.out, 0o600);
process.stdout.write(`wrote ${args.out}\n`);
