// @vitest-environment node
/**
 * D177-WI-3: build-mini-settings.mjs writes dtrack's hooks as command hooks.
 *
 * Stop, Notification (permission_prompt|idle_prompt|agent_needs_input|
 * elicitation_dialog) and SessionStart (clear|startup|resume) each become
 * `{ type: "command", command: "<node> <push>", timeout: 5 }`. Merging keeps
 * every other key and hook but drops old `type:"http"` hooks to `:8787/hook`
 * and earlier push.mjs commands, so a rerun is identical. The output has no
 * header, token or Tailscale address, is mode 0600, and a node older than 18
 * is refused.
 *
 * Boundaries: a temp HOME and output dir; `--node` is the real node or a
 * fake script printing v16.0.0. The 100.x address below is a made-up literal
 * that must be dropped, never a real one.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILDER, makeTemp, rmTemp } from "./support/d177Hooks";

const NOTIFY_MATCHER = "permission_prompt|idle_prompt|agent_needs_input|elicitation_dialog";
const SESSION_MATCHER = "clear|startup|resume";
const FAKE_HTTP_URL = "http://100.99.99.99:8787/hook";
const FAKE_HEADER_TOKEN = "fake-header-token-d177";
const PUSH_PATH = "/opt/dtrack/hooks/push.mjs";

let tmp: string;
let home: string;

type Hook = Record<string, unknown>;
type Group = { matcher?: string; hooks: Hook[] };
type Settings = Record<string, unknown> & { hooks: Record<string, Group[]> };

function build(args: string[]) {
  return spawnSync(process.execPath, [BUILDER, ...args], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    timeout: 10_000,
  });
}

const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as Settings;
const ours = (node: string, push = PUSH_PATH) => ({ type: "command", command: `${node} ${push}`, timeout: 5 });

function existing(): string {
  const httpHook = { type: "http", url: FAKE_HTTP_URL, headers: { "X-Mdpro-Token": FAKE_HEADER_TOKEN }, timeout: 5 };
  const base = {
    model: "opus",
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: {
      Stop: [{ hooks: [httpHook] }, { hooks: [{ type: "command", command: "echo stop-unrelated" }] }],
      Notification: [{ matcher: NOTIFY_MATCHER, hooks: [httpHook] }],
      SessionStart: [{ matcher: SESSION_MATCHER, hooks: [httpHook, { type: "command", command: "/old/node /old/push.mjs" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
    },
  };
  const f = path.join(tmp, "existing.json");
  fs.writeFileSync(f, JSON.stringify(base, null, 2));
  return f;
}

beforeEach(() => {
  tmp = makeTemp("builder");
  home = makeTemp("builder-home");
});

afterEach(() => {
  rmTemp(tmp);
  rmTemp(home);
});

describe("D177-WI-3 build-mini-settings.mjs", () => {
  it("writes the three command hooks with their matchers, mode 0600", () => {
    const out = path.join(tmp, "settings.json");
    const r = build([out, "--node", process.execPath, "--push", PUSH_PATH]);
    expect(r.status).toBe(0);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(out), "out exists").toBe(true);
    const s = read(out);
    expect(s.hooks.Stop).toEqual([{ hooks: [ours(process.execPath)] }]);
    expect(s.hooks.Notification).toEqual([{ matcher: NOTIFY_MATCHER, hooks: [ours(process.execPath)] }]);
    expect(s.hooks.SessionStart).toEqual([{ matcher: SESSION_MATCHER, hooks: [ours(process.execPath)] }]);
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
  });

  it("defaults --push to the hook dir's push.mjs", () => {
    const out = path.join(tmp, "settings.json");
    expect(build([out, "--node", process.execPath]).status).toBe(0);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(out), "out exists").toBe(true);
    const cmd = read(out).hooks.Stop[0].hooks[0].command as string;
    expect(cmd.startsWith(`${process.execPath} `)).toBe(true);
    expect(cmd.endsWith("/.mdpro-redesign/hooks/push.mjs")).toBe(true);
  });

  it("merging drops the old http and push.mjs hooks and keeps unrelated hooks and keys", () => {
    const out = path.join(tmp, "settings.json");
    expect(build([out, existing(), "--node", process.execPath, "--push", PUSH_PATH]).status).toBe(0);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(out), "out exists").toBe(true);
    const s = read(out);
    expect(s.model).toBe("opus");
    expect(s.permissions).toEqual({ allow: ["Bash(ls:*)"] });
    expect(s.hooks.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }]);
    const all = Object.values(s.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
    expect(all.filter((h) => h.type === "http")).toEqual([]);
    expect(all.filter((h) => String(h.command).includes("push.mjs"))).toHaveLength(3);
    expect(s.hooks.Stop.flatMap((g) => g.hooks)).toEqual(
      expect.arrayContaining([{ type: "command", command: "echo stop-unrelated" }, ours(process.execPath)]),
    );
    expect(s.hooks.Stop.flatMap((g) => g.hooks)).toHaveLength(2);
  });

  it("is idempotent: building over its own output gives identical bytes", () => {
    const first = path.join(tmp, "first.json");
    const second = path.join(tmp, "second.json");
    expect(build([first, existing(), "--node", process.execPath, "--push", PUSH_PATH]).status).toBe(0);
    expect(build([second, first, "--node", process.execPath, "--push", PUSH_PATH]).status).toBe(0);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(second), "second exists").toBe(true);
    expect(fs.existsSync(first), "first exists").toBe(true);
    expect(fs.readFileSync(second, "utf8")).toBe(fs.readFileSync(first, "utf8"));
  });

  it("the output carries no token header, headers key or 100.x address", () => {
    const out = path.join(tmp, "settings.json");
    expect(build([out, existing(), "--node", process.execPath, "--push", PUSH_PATH]).status).toBe(0);
    // Checked first so a failure reads as an assertion, not an ENOENT the receipt CLI misreads.
    expect(fs.existsSync(out), "out exists").toBe(true);
    const text = fs.readFileSync(out, "utf8");
    expect(text).not.toMatch(/X-Mdpro-Token/i);
    expect(text).not.toContain('"headers"');
    expect(text).not.toContain(FAKE_HEADER_TOKEN);
    expect(text).not.toMatch(/\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it("refuses a node older than 18 with a message and writes nothing", () => {
    const fakeNode = path.join(tmp, "old-node");
    fs.writeFileSync(fakeNode, "#!/bin/sh\necho v16.0.0\n", { mode: 0o755 });
    const out = path.join(tmp, "settings.json");
    const r = build([out, "--node", fakeNode, "--push", PUSH_PATH]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/v16\.0\.0/);
    expect(r.stderr).toMatch(/18/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("refuses a missing --node", () => {
    const out = path.join(tmp, "settings.json");
    const r = build([out, "--push", PUSH_PATH]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--node/);
    expect(fs.existsSync(out)).toBe(false);
  });
});
