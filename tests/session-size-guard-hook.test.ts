// @vitest-environment node
/**
 * Rule 70 § Session rotation: the PostToolUse hook
 * `.claude/hooks/session-size-guard.sh` counts compactions, human turns and
 * bytes in the session transcript and warns once per level (soft at 5
 * compactions, strong at 10 or at 25 MiB) that the session should write a
 * handoff and be rotated.
 *
 * Each case spawns the real hook with Claude Code's PostToolUse JSON on stdin,
 * against fake JSONL transcripts in os.tmpdir(), with the state dir set by env.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.claude/hooks/session-size-guard.sh");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "session-guard-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const baseEnv: NodeJS.ProcessEnv = { ...process.env };
for (const k of [
  "MDPRO_SESSION_SOFT_COMPACTIONS",
  "MDPRO_SESSION_STRONG_COMPACTIONS",
  "MDPRO_SESSION_STRONG_BYTES",
  "MDPRO_SESSION_GUARD_STATE_DIR",
]) delete baseEnv[k];

let counter = 0;
function fresh() {
  counter += 1;
  const id = `sess-${counter}`;
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, transcript: path.join(dir, "t.jsonl"), stateDir: path.join(dir, "state") };
}

const compact = () => JSON.stringify({ type: "system", subtype: "compact_boundary", content: "Conversation compacted" });
const human = (text = "hello") => JSON.stringify({ type: "user", message: { role: "user", content: text } });
const humanList = (text = "hi") =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const toolResult = () =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } });
const meta = () => JSON.stringify({ type: "user", isMeta: true, message: { role: "user", content: "caveat" } });
const compactSummary = () =>
  JSON.stringify({ type: "user", isCompactSummary: true, message: { role: "user", content: "summary" } });
const assistant = () => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });

function lines(...ls: string[]) {
  return ls.map((l) => `${l}\n`).join("");
}
function repeat(n: number, f: () => string) {
  return Array.from({ length: n }, f);
}

type S = ReturnType<typeof fresh>;

function run(s: S, extraEnv: NodeJS.ProcessEnv = {}, input?: string) {
  const env: NodeJS.ProcessEnv = { ...baseEnv, MDPRO_SESSION_GUARD_STATE_DIR: s.stateDir, ...extraEnv };
  const stdin =
    input ??
    JSON.stringify({ session_id: s.id, transcript_path: s.transcript, hook_event_name: "PostToolUse", tool_name: "Bash" });
  const r = spawnSync("/bin/bash", [HOOK], { input: stdin, env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function parsed(stdout: string) {
  const o = JSON.parse(stdout);
  return o as { systemMessage: string; hookSpecificOutput: { hookEventName: string; additionalContext: string } };
}

describe("session-size-guard: levels", () => {
  it("prints nothing below the soft threshold", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(...repeat(4, compact), human(), assistant()));
    const r = run(s);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("warns soft at exactly 5 compactions, as valid JSON with both fields", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(human(), ...repeat(5, compact), human(), assistant()));
    const r = run(s);
    expect(r.status).toBe(0);
    const o = parsed(r.stdout);
    expect(o.systemMessage).toContain("会话已压缩 5 次");
    expect(o.systemMessage).toContain("你的发言 2 轮");
    expect(o.systemMessage).toContain("下一个 WI 边界");
    expect(o.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(o.hookSpecificOutput.additionalContext).toContain("Session rotation");
    expect(o.hookSpecificOutput.additionalContext).toContain("~/.mdpro-redesign/handoff/");
    expect(o.hookSpecificOutput.additionalContext).toContain("mdpro-delegator");
    expect(o.hookSpecificOutput.additionalContext).toMatch(/5 compactions/);
  });

  it("warns strong at 10 compactions", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(...repeat(10, compact)));
    const o = parsed(run(s).stdout);
    expect(o.systemMessage).toContain("会话已压缩 10 次");
    expect(o.systemMessage).toContain("做完当前步骤就写交接并轮换");
    expect(o.systemMessage).not.toContain("下一个 WI 边界");
  });

  it("warns strong on bytes alone", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(human(), ...repeat(50, assistant)));
    const r = run(s, { MDPRO_SESSION_STRONG_BYTES: "1000" });
    const o = parsed(r.stdout);
    expect(o.systemMessage).toContain("会话已压缩 0 次");
    expect(o.systemMessage).toContain("做完当前步骤就写交接并轮换");
  });

  it("honours the compaction threshold overrides", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(...repeat(2, compact)));
    const o = parsed(run(s, { MDPRO_SESSION_SOFT_COMPACTIONS: "1", MDPRO_SESSION_STRONG_COMPACTIONS: "2" }).stdout);
    expect(o.systemMessage).toContain("做完当前步骤就写交接并轮换");
  });
});

describe("session-size-guard: warn once per level", () => {
  it("a second call at the same level prints nothing", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(...repeat(5, compact)));
    expect(run(s).stdout).not.toBe("");
    fs.appendFileSync(s.transcript, lines(human(), compact()));
    const r = run(s);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("escalates from soft to strong, then stays quiet", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(...repeat(5, compact)));
    expect(parsed(run(s).stdout).systemMessage).toContain("下一个 WI 边界");
    fs.appendFileSync(s.transcript, lines(...repeat(5, compact)));
    expect(parsed(run(s).stdout).systemMessage).toContain("做完当前步骤就写交接并轮换");
    fs.appendFileSync(s.transcript, lines(compact()));
    expect(run(s).stdout).toBe("");
  });

  it("keeps state per session_id", () => {
    const a = fresh();
    fs.writeFileSync(a.transcript, lines(...repeat(5, compact)));
    expect(run(a).stdout).not.toBe("");
    // Same state dir, different session id: warns again.
    const b = { ...fresh(), stateDir: a.stateDir };
    fs.writeFileSync(b.transcript, lines(...repeat(5, compact)));
    expect(run(b).stdout).not.toBe("");
  });
});

describe("session-size-guard: incremental parsing", () => {
  it("counts lines appended between calls", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(human(), ...repeat(3, compact)));
    expect(run(s).stdout).toBe("");
    fs.appendFileSync(s.transcript, lines(compact(), human(), compact()));
    const o = parsed(run(s).stdout);
    expect(o.systemMessage).toContain("会话已压缩 5 次");
    expect(o.systemMessage).toContain("你的发言 2 轮");
  });

  it("does not count a partial trailing line until it is complete", () => {
    const s = fresh();
    const c = compact();
    fs.writeFileSync(s.transcript, lines(...repeat(4, compact)) + c.slice(0, 10));
    expect(run(s).stdout).toBe("");
    fs.appendFileSync(s.transcript, `${c.slice(10)}\n`);
    expect(parsed(run(s).stdout).systemMessage).toContain("会话已压缩 5 次");
  });

  it("re-parses from 0 when the transcript shrinks", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(...repeat(4, compact), ...repeat(20, assistant)));
    expect(run(s).stdout).toBe("");
    // A new, shorter transcript: had the old counts been kept, 4 + 1 = 5 would warn.
    fs.writeFileSync(s.transcript, lines(compact(), human()));
    expect(run(s).stdout).toBe("");
    fs.appendFileSync(s.transcript, lines(...repeat(4, compact)));
    expect(parsed(run(s).stdout).systemMessage).toContain("会话已压缩 5 次");
  });
});

describe("session-size-guard: human turns", () => {
  it("counts string and text-list user messages, not tool_result, isMeta or isCompactSummary", () => {
    const s = fresh();
    fs.writeFileSync(
      s.transcript,
      lines(
        human("a"),
        humanList("b"),
        toolResult(),
        toolResult(),
        meta(),
        compactSummary(),
        assistant(),
        ...repeat(5, compact),
      ),
    );
    const o = parsed(run(s).stdout);
    expect(o.systemMessage).toContain("你的发言 2 轮");
    expect(o.hookSpecificOutput.additionalContext).toMatch(/2 human turns/);
  });
});

describe("session-size-guard: fail open", () => {
  it("skips malformed lines and still counts the rest", () => {
    const s = fresh();
    fs.writeFileSync(s.transcript, `not json\n{"type":\n[1,2]\n"str"\n${lines(...repeat(5, compact))}`);
    const r = run(s);
    expect(r.status).toBe(0);
    expect(parsed(r.stdout).systemMessage).toContain("会话已压缩 5 次");
  });

  it("exits 0 silently when the transcript is missing", () => {
    const s = fresh();
    const r = run(s);
    expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  it.each([["../evil"], ["a b"], [""], ["x/y"]])("exits 0 silently for session_id %j", (id) => {
    const s = fresh();
    fs.writeFileSync(s.transcript, lines(...repeat(10, compact)));
    const r = run(s, {}, JSON.stringify({ session_id: id, transcript_path: s.transcript, hook_event_name: "PostToolUse" }));
    expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
    expect(fs.existsSync(s.stateDir) ? fs.readdirSync(s.stateDir) : []).toEqual([]);
  });

  it.each([["not json"], [""], ["[]"], ['{"session_id": 5}'], ['{"session_id":"ok","transcript_path":7}']])(
    "exits 0 silently for stdin %j",
    (input) => {
      const s = fresh();
      const r = run(s, {}, input);
      expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
    },
  );

  it("exits 0 silently when the state file is corrupt, and recovers", () => {
    const s = fresh();
    fs.mkdirSync(s.stateDir, { recursive: true });
    fs.writeFileSync(path.join(s.stateDir, `${s.id}.json`), "{garbage");
    fs.writeFileSync(s.transcript, lines(...repeat(5, compact)));
    const r = run(s);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(parsed(r.stdout).systemMessage).toContain("会话已压缩 5 次");
  });
});
