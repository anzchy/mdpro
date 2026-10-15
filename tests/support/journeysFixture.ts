/**
 * Purpose: Builders for the journey-catalogue gate tests (E2E-WI-1): a valid
 * journey metadata object, the markdown file that carries it, and a temp
 * repository root holding a catalogue, with or without git history.
 *
 * A temp root mirrors the real layout (`tests/journeys/…`, `docs/plans/…`), so
 * the gate's repo-relative paths resolve the same way they do in the tree.
 *
 * @module tests/support/journeysFixture
 * @coordinates-with scripts/journeys/check.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Meta = Record<string, unknown>;

/** A metadata block that passes every schema rule. */
export function validMeta(overrides: Meta = {}): Meta {
  return {
    id: "EJ-001",
    title: "Cold start opens the file given on the command line",
    status: "active",
    area: "文件与文档管理",
    tier: ["smoke", "full"],
    platforms: { macos: { status: "required" }, windows: { status: "required" } },
    fixtures: [],
    tier0: [],
    rust: [],
    projection: "tests/journeys/projections/EJ-001.json",
    ledger: [{ row: "打开文件", cases: ["C1"], covers: ["冷启动带路径参数打开文件"] }],
    cases: [{ id: "C1", mode: "S", intended: "the file opens in one tab, clean" }],
    supersedes: [],
    group: null,
    ...overrides,
  };
}

const BODY = ["## Why", "", "## Setup", "", "## Steps", "", "## Oracle", "", "## Controls", "", "## Failure condition", "", "## Cleanup", ""].join(
  "\n",
);

/** The journey file text: a title, the `json journey` block, then the sections. */
export function journeyMd(meta: Meta | string, body = BODY): string {
  const json = typeof meta === "string" ? meta : JSON.stringify(meta, null, 2);
  return `# ${typeof meta === "string" ? "Journey" : String(meta.title)}\n\n\`\`\`json journey\n${json}\n\`\`\`\n\n${body}`;
}

/** Writes `files` (repo-relative path → content) under a new temp root and returns it. */
export function tempRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "journeys-"));
  writeFiles(root, files);
  return root;
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** Runs git in `root` with a fixed identity, so commits work on any machine. */
export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

/** A temp git repo whose first commit holds `base`; returns the root and that commit's SHA. */
export function repoWithBase(base: Record<string, string>): { root: string; baseSha: string } {
  const root = tempRoot(base);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return { root, baseSha: git(root, "rev-parse", "HEAD") };
}

/** A REGISTRY.md listing `ids`, in the table form the gate reads. */
export function registryMd(ids: string[]): string {
  return ["# Journey registry", "", "| id | title |", "|---|---|", ...ids.map((id) => `| ${id} | — |`), ""].join("\n");
}
