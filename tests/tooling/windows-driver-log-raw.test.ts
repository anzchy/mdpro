// @vitest-environment node
/**
 * WI-E2E-W item 2 (plan §4.7, Codex finding 12): a raw JSONL capture that a run can judge by.
 * `log.sh since` reformats lines, drops fields and skips bad JSON without saying so, so it is a
 * human view only. `log.sh mark` now records the file's byte size and identity (creation time plus
 * the first line's sha256), and `log.sh raw [file]` writes the bytes written since the mark,
 * unchanged, to `$OUT/<file>`. A file smaller than the mark (truncated) or with another identity
 * (replaced) is refused with exit 7, and malformed lines are counted and reported.
 *
 * Runs the real log.sh with a fake ssh (tests/support/fakeSsh.ts) first on PATH. Mocked: ssh only;
 * the fake's stdout stands in for the PowerShell read, whose text is checked by the source guard.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeSsh, type FakeSsh, type SshReply } from "../support/fakeSsh";

const MAC = path.resolve(__dirname, "../../.claude/skills/remote-windows-device-test/scripts/mac");
const ID = "638950000000000000-3f2a9c";
const DOWN = { exit: 255, stderr: "ssh: connect to host win-desktop port 22: Operation timed out\n" } satisfies SshReply;

const made: FakeSsh[] = [];
afterEach(() => {
  for (const f of made.splice(0)) f.cleanup();
});

function logSh(script: SshReply[], mark: string | null, ...args: string[]) {
  const ssh = makeFakeSsh(script);
  made.push(ssh);
  const out = path.join(ssh.dir, "out");
  if (mark !== null) fs.writeFileSync(path.join(out, ".logmark"), mark);
  const r = spawnSync("bash", [path.join(MAC, "log.sh"), ...args], { env: ssh.env, encoding: "utf8", timeout: 20_000 });
  return { ssh, out, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** What the PowerShell read prints: size, identity and, for a read from an offset, the bytes. */
const reply = (size: number, id: string, bytes?: Buffer): SshReply => ({
  execute: true,
  stdout: `size ${size}\r\nid ${id}\r\n` + (bytes ? `b64 ${bytes.toString("base64")}\r\n` : ""),
});

const LINES = [
  '{"ts":"2026-10-15T13:00:00.000Z","level":"info","event":"file.save","status":"success","actionId":"a1","context":{"path":"C:\\\\x.md"}}',
  '{"ts":"2026-10-15T13:00:01.000Z","level":"warn","event":"ui.dialog.open","status":"cancel","context":{"long":"' +
    "z".repeat(400) +
    '"}}',
  '{"ts":"2026-10-15T13:00:02.000Z","level":"error","event":"mcp.confirm.reply","status":"failure","error":"é ünïcode"}',
];
const bytesOf = (lines: string[]) => Buffer.from(lines.map((l) => `${l}\n`).join(""), "utf8");

describe("WI-E2E-W item 2 — log.sh mark records size and identity", () => {
  it("L0 mark writes a v2 mark from one read that asks for no bytes", () => {
    const r = logSh([reply(120, ID)], null, "mark");
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(r.out, ".logmark"), "utf8").trim()).toBe(`v2 120 ${ID}`);
    expect(r.ssh.calls()).toHaveLength(1);
    expect(r.ssh.calls()[0]).toMatch(/\$off = -1\b/);
  });

  it("L0b a reply without a size or identity is a failed mark, and no mark is written", () => {
    const r = logSh([{ execute: true, stdout: "size \r\n" }], null, "mark");
    expect(r.status).toBe(1);
    expect(fs.existsSync(path.join(r.out, ".logmark"))).toBe(false);
  });
});

describe("WI-E2E-W item 2 — log.sh raw writes the bytes since the mark, unchanged", () => {
  it("L1 three lines after the mark are written byte for byte, every field kept", () => {
    const bytes = bytesOf(LINES);
    const r = logSh([reply(100 + bytes.length, ID, bytes)], `v2 100 ${ID}\n`, "raw", "run1.jsonl");
    expect(r.status, r.stderr).toBe(0);
    expect(r.ssh.calls()[0]).toMatch(/\$off = 100\b/);
    expect(Buffer.compare(fs.readFileSync(path.join(r.out, "run1.jsonl")), bytes)).toBe(0);
    expect(r.stderr).toMatch(/lines: 3 malformed: 0/);
    expect(r.stdout.trim()).toBe(path.join(r.out, "run1.jsonl"));
  });

  it("L2 a malformed line is kept in the file and counted", () => {
    const bytes = bytesOf([LINES[0], '{"ts":"2026-10-15T13:00:01', LINES[2]]);
    const r = logSh([reply(100 + bytes.length, ID, bytes)], `v2 100 ${ID}\n`, "raw", "run2.jsonl");
    expect(r.status, r.stderr).toBe(0);
    expect(Buffer.compare(fs.readFileSync(path.join(r.out, "run2.jsonl")), bytes)).toBe(0);
    expect(r.stderr).toMatch(/lines: 3 malformed: 1/);
  });

  it("L3 a file smaller than the mark is refused as truncated, exit 7, no file", () => {
    const r = logSh([reply(40, ID, Buffer.alloc(0))], `v2 100 ${ID}\n`, "raw", "run3.jsonl");
    expect(r.status).toBe(7);
    expect(r.stderr).toMatch(/truncated/);
    expect(fs.existsSync(path.join(r.out, "run3.jsonl"))).toBe(false);
  });

  it("L4 a file with another identity is refused as replaced, exit 7, no file", () => {
    const bytes = bytesOf(LINES);
    const r = logSh([reply(100 + bytes.length, "638950000000000000-ffff00", bytes)], `v2 100 ${ID}\n`, "raw", "run4.jsonl");
    expect(r.status).toBe(7);
    expect(r.stderr).toMatch(/replaced/);
    expect(fs.existsSync(path.join(r.out, "run4.jsonl"))).toBe(false);
  });

  it("L5 a v1 mark (a line count) is refused before any read, exit 7", () => {
    const r = logSh([reply(100, ID, Buffer.alloc(0))], "12\n", "raw", "run5.jsonl");
    expect(r.status).toBe(7);
    expect(r.stderr).toMatch(/re-mark/);
    expect(r.ssh.calls()).toHaveLength(0);
  });

  it("L6 a failed read keeps ssh's status and writes no file", () => {
    const r = logSh([DOWN], `v2 100 ${ID}\n`, "raw", "run6.jsonl");
    expect(r.status).toBe(255);
    expect(fs.existsSync(path.join(r.out, "run6.jsonl"))).toBe(false);
  });

  it("L7 with no file name it writes raw-<time>.jsonl; an unsafe name is refused with exit 2", () => {
    const bytes = bytesOf([LINES[0]]);
    const ok = logSh([reply(100 + bytes.length, ID, bytes)], `v2 100 ${ID}\n`, "raw");
    expect(ok.status, ok.stderr).toBe(0);
    const written = ok.stdout.trim();
    expect(path.basename(written)).toMatch(/^raw-\d{8}-\d{6}\.jsonl$/);
    expect(Buffer.compare(fs.readFileSync(written), bytes)).toBe(0);

    const bad = logSh([reply(100, ID, Buffer.alloc(0))], `v2 100 ${ID}\n`, "raw", "../escape.jsonl");
    expect(bad.status).toBe(2);
    expect(bad.ssh.calls()).toHaveLength(0);
  });

  it("L8 a size that does not match the bytes returned is refused, exit 7", () => {
    const bytes = bytesOf(LINES);
    const r = logSh([reply(100 + bytes.length + 5, ID, bytes)], `v2 100 ${ID}\n`, "raw", "run8.jsonl");
    expect(r.status).toBe(7);
    expect(fs.existsSync(path.join(r.out, "run8.jsonl"))).toBe(false);
  });
});

describe("WI-E2E-W item 2 — log.sh since stays the human view, over the same read", () => {
  it("S1 since prints one formatted line per event since a v2 mark", () => {
    const bytes = bytesOf(LINES);
    const r = logSh([reply(100 + bytes.length, ID, bytes)], `v2 100 ${ID}\n`, "since", "file.save|mcp");
    expect(r.status, r.stderr).toBe(0);
    const out = r.stdout.trim().split("\n");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/file\.save success/);
    expect(out[1]).toMatch(/mcp\.confirm\.reply failure/);
  });

  it("S2 the usage text says since is not an oracle", () => {
    const text = fs.readFileSync(path.join(MAC, "log.sh"), "utf8");
    expect(text).toMatch(/since.*not an oracle/i);
  });
});

describe("WI-E2E-W item 2 — the PowerShell read (source guard; no pwsh here)", () => {
  const text = fs.readFileSync(path.join(MAC, "log.sh"), "utf8");

  it("G1 it opens the log shared for writing, seeks to the offset and reads bytes, not lines", () => {
    expect(text).toMatch(/FileShare\]::ReadWrite/);
    expect(text).toMatch(/\.Seek\(\$off/);
    expect(text).not.toMatch(/Get-Content/);
  });

  it("G2 the identity is the creation time plus the sha256 of the first line", () => {
    expect(text).toMatch(/CreationTimeUtc\.Ticks/);
    expect(text).toMatch(/SHA256/);
  });
});
