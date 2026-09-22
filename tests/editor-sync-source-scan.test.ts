/**
 * D15 WI-2 — matrix case Z-listener-gone (`.claude/tdd-guardian/tests-20260922-163219.md`).
 *
 * `@milkdown/plugin-listener` was the D15/D18 edit path: its callback registration was
 * disposed on the first re-render and never re-registered, it skips every
 * `addToHistory: false` transaction, and its per-transaction debounce is never
 * cancelled on destroy ("Context editorView not found"). The edit-sync plugin replaced
 * it. This case keeps it out of `src/`: re-adding it is a deliberate act that must
 * delete this case.
 *
 * Constraints honoured: no mocks, no new dependency (real `node:fs`, same walker as W5).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "../src");
const LISTENER_PATTERN = /\blistenerCtx\b|@milkdown\/(kit\/)?plugin[-/]listener/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("Z — the Milkdown listener plugin is gone from src/", () => {
  const files = walk(SRC).sort();
  const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

  it("Z-listener-gone no file imports plugin-listener or reads listenerCtx", () => {
    const offending = files
      .filter((f) => LISTENER_PATTERN.test(fs.readFileSync(f, "utf-8")))
      .map(rel);
    expect(offending).toEqual([]);
  });

  it("non-vacuity: the walker sees the edit-sync plugin wired somewhere in src/", () => {
    const users = files
      .filter((f) => /\beditSyncMilkdownPlugin\b/.test(fs.readFileSync(f, "utf-8")))
      .map(rel);
    expect(users.length).toBeGreaterThanOrEqual(1);
    expect(users).toContain("components/Editor/MilkdownEditor.tsx");
  });
});
